/**
 * GoDD Matrix 静的 Web アプリのドメインロジック (issue #28)。
 *
 * 既存の純パイプライン (`decideAxes` / `synthesizePrompt`) と Matrix にバンドル済みの
 * カタログ (JSIC 細分類 / taxonomy) をブラウザ向けに再利用する。
 * - DOM / ネットワークには依存しない (決定論・純関数群 = テスト可能)。
 * - 副作用 (index / DESIGN.md の fetch, hash 検証, クリップボード) は `main.ts` が担う。
 */
import { type AxisDecision, type DesignBrief, decideAxes } from "../../src/axes/decide.js";
import type { AxisContext } from "../../src/axes/index.js";
import { JSIC_SUBCLASSES } from "../../src/axes/jsic-catalog.js";
import { MINIMAL_COLORS, MINIMAL_MOODS } from "../../src/axes/taxonomy.js";
import type { DesignResolution } from "../../src/ds/design.js";
import type { DesignIndexEntry } from "../../src/ds/types.js";
import { type ComposedPrompt, synthesizePrompt } from "../../src/prompt/synthesize.js";

/** 公開 Design-Systems リポジトリの raw ベース (末尾スラッシュ必須)。 */
export const DS_RAW_BASE =
  "https://raw.githubusercontent.com/AutoDevJapan/GoDD-Design-Systems/main/";

/** 公開 index.json の URL。 */
export const DS_INDEX_URL = `${DS_RAW_BASE}index.json`;

/** 公開 taxonomy.json の URL (DS がムード/カラーの機械可読な日本語名を公開する契約, issue #33)。 */
export const DS_TAXONOMY_URL = `${DS_RAW_BASE}taxonomy.json`;

const jsicNameByCode = new Map(JSIC_SUBCLASSES.map((e) => [e.code, e.name]));
const colorLabelBySlug = new Map(MINIMAL_COLORS.map((e) => [e.slug, e.label]));
const moodLabelBySlug = new Map(MINIMAL_MOODS.map((e) => [e.slug, e.label]));

// ---------------------------------------------------------------------------
// DS taxonomy.json (issue #33): ムード/カラーの機械可読な日本語名を実行時に取り込む。
// 契約: { version, colors: { "<slug>": { name_ja, family, family_ja } },
//         moods: { "<slug>": { name_ja, axis } } }
// フェイルセーフ: fetch 失敗・形状不正でも例外を投げず、bundled ラベル/slug にフォールバック。
// ---------------------------------------------------------------------------

/** taxonomy.json のカラー項目 (全フィールド任意)。 */
export interface TaxonomyColor {
  readonly name_ja?: string;
  readonly name_en?: string;
  readonly family?: string;
  readonly family_ja?: string;
  readonly family_en?: string;
}

/** taxonomy.json のムード項目 (全フィールド任意)。 */
export interface TaxonomyMood {
  readonly name_ja?: string;
  readonly name_en?: string;
  readonly axis?: string;
}

/** UI の表示言語。既定は日本語 (従来動作)。 */
export type Locale = "ja" | "en";

/** DS が公開する taxonomy (実行時 fetch)。欠損に強い形 (フェイルセーフ)。 */
export interface Taxonomy {
  readonly version?: string;
  readonly colors: Readonly<Record<string, TaxonomyColor>>;
  readonly moods: Readonly<Record<string, TaxonomyMood>>;
}

/** 空 taxonomy (fetch 失敗・未達時のフォールバック)。 */
export const EMPTY_TAXONOMY: Taxonomy = { colors: {}, moods: {} };

/** 値が非空文字列ならそれを、さもなくば undefined を返す。 */
function optString(v: unknown): string | undefined {
  return typeof v === "string" && v.length > 0 ? v : undefined;
}

/** slug→項目 の生 map を正規化する (object でない値は握りつぶす)。 */
function parseRecord<T>(raw: unknown, pick: (e: Record<string, unknown>) => T): Record<string, T> {
  const out: Record<string, T> = {};
  if (typeof raw !== "object" || raw === null) return out;
  for (const [slug, v] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof v !== "object" || v === null) continue;
    out[slug] = pick(v as Record<string, unknown>);
  }
  return out;
}

/**
 * 任意の JSON 値を {@link Taxonomy} に正規化する (フェイルセーフ・純関数)。
 * 形状不正・欠損は握りつぶし、取れる範囲だけ拾って残りは空にする。例外は投げない。
 */
export function parseTaxonomy(raw: unknown): Taxonomy {
  if (typeof raw !== "object" || raw === null) return EMPTY_TAXONOMY;
  const obj = raw as Record<string, unknown>;
  const colors = parseRecord<TaxonomyColor>(obj.colors, (e) => ({
    ...(optString(e.name_ja) ? { name_ja: optString(e.name_ja) } : {}),
    ...(optString(e.name_en) ? { name_en: optString(e.name_en) } : {}),
    ...(optString(e.family) ? { family: optString(e.family) } : {}),
    ...(optString(e.family_ja) ? { family_ja: optString(e.family_ja) } : {}),
    ...(optString(e.family_en) ? { family_en: optString(e.family_en) } : {}),
  }));
  const moods = parseRecord<TaxonomyMood>(obj.moods, (e) => ({
    ...(optString(e.name_ja) ? { name_ja: optString(e.name_ja) } : {}),
    ...(optString(e.name_en) ? { name_en: optString(e.name_en) } : {}),
    ...(optString(e.axis) ? { axis: optString(e.axis) } : {}),
  }));
  const version = optString(obj.version);
  return { ...(version ? { version } : {}), colors, moods };
}

/** JSIC 細分類コード → 業種名 (未知コードはコードのまま返す)。 */
export function jsicName(code: string): string {
  return jsicNameByCode.get(code) ?? code;
}

/**
 * カラー slug → 表示ラベル。`locale === "en"` なら taxonomy の `name_en` を最優先し、無ければ
 * `name_ja` → bundled ラベル → slug の順にフォールバックする。既定は `"ja"`（従来どおり）。
 * 英語データが無い slug（未達 taxonomy 等）でも必ず何か表示できる。
 */
export function labelForColor(slug: string, taxonomy?: Taxonomy, locale: Locale = "ja"): string {
  const entry = taxonomy?.colors[slug];
  const localized = locale === "en" ? (entry?.name_en ?? entry?.name_ja) : entry?.name_ja;
  return localized ?? colorLabelBySlug.get(slug) ?? slug;
}

/**
 * ムード slug → 表示ラベル。`locale === "en"` なら taxonomy の `name_en` を最優先し、無ければ
 * `name_ja` → bundled ラベル → slug の順にフォールバックする。既定は `"ja"`（従来どおり）。
 */
export function labelForMood(slug: string, taxonomy?: Taxonomy, locale: Locale = "ja"): string {
  const entry = taxonomy?.moods[slug];
  const localized = locale === "en" ? (entry?.name_en ?? entry?.name_ja) : entry?.name_ja;
  return localized ?? moodLabelBySlug.get(slug) ?? slug;
}

/** カラー slug → 表示ラベル (未知 slug は slug のまま返す)。{@link labelForColor} の taxonomy 無し版。 */
export function colorLabel(slug: string): string {
  return labelForColor(slug);
}

/** ムード slug → 表示ラベル (未知 slug は slug のまま返す)。{@link labelForMood} の taxonomy 無し版。 */
export function moodLabel(slug: string): string {
  return labelForMood(slug);
}

/** DESIGN.md 本文の raw URL を entry.path から解決する。 */
export function designRawUrl(entry: DesignIndexEntry): string {
  return new URL(entry.path, DS_RAW_BASE).toString();
}

// ---------------------------------------------------------------------------
// セルへのパーマリンク (issue #35): 選択セルを ?cell=<id> で URL に反映し、共有可能にする。
// DOM/ネットワーク非依存の純関数 (決定論・テスト可能)。副作用 (URL 反映) は main.ts が担う。
// ---------------------------------------------------------------------------

/** URL クエリのセル指定に使うパラメータ名。 */
export const CELL_PARAM = "cell";

/** URL search 文字列 (例 `?cell=6061_white_minimal`) から選択セル ID を取り出す。無ければ null。 */
export function parseCellParam(search: string): string | null {
  const id = new URLSearchParams(search).get(CELL_PARAM);
  return id && id.length > 0 ? id : null;
}

/**
 * 現在ページ URL とセル ID から、そのセルだけを開く共有用パーマリンク (`?cell=<id>`) を組む。
 * 既存の検索/ファセット等のクエリは落とし、共有に最適な最小 URL にする (決定論・純関数)。
 */
export function buildCellPermalink(pageUrl: string, cellId: string): string {
  const url = new URL(pageUrl);
  url.search = "";
  url.hash = "";
  url.searchParams.set(CELL_PARAM, cellId);
  return url.toString();
}

/** id で材化済みセルを引く (見つからなければ undefined)。パーマリンク復元に使う。 */
export function findEntryById(
  entries: readonly DesignIndexEntry[],
  id: string,
): DesignIndexEntry | undefined {
  return entries.find((e) => e.id === id);
}

/** 検索フォームの入力。全て任意。 */
export interface SearchInput {
  /** 業種名 / キーワード / JSIC コード。 */
  industry?: string;
  /** カラー (色名 / slug)。 */
  color?: string;
  /** ムード。 */
  mood?: string;
  /** 追加タグ (AND 一致)。 */
  tags?: readonly string[];
  /** 自由文 (メタへの包含一致)。 */
  text?: string;
}

/** {@link searchCells} の結果。 */
export interface SearchResult {
  /** 各軸の解決 (best 候補 / 未解決)。UI の「解決した軸」表示に使う。 */
  decision: AxisDecision;
  /** 条件に一致した候補セル。 */
  matches: readonly DesignIndexEntry[];
}

/** 検索入力を {@link DesignBrief} へ (industry は必須なので空文字で補う)。 */
function toBrief(input: SearchInput): DesignBrief {
  return {
    industry: input.industry ?? "",
    ...(input.color?.trim() ? { color: input.color } : {}),
    ...(input.mood?.trim() ? { mood: input.mood } : {}),
    ...(input.tags && input.tags.length > 0 ? { tags: input.tags } : {}),
  };
}

/** 自由文語がエントリのメタ (業種名 / タイトル / slug / コード / タグ) に含まれるか。 */
function matchesText(entry: DesignIndexEntry, term: string, taxonomy?: Taxonomy): boolean {
  const q = term.trim().toLowerCase();
  if (!q) return true;
  const hay = [
    entry.jsic,
    jsicName(entry.jsic),
    entry.color,
    labelForColor(entry.color, taxonomy),
    entry.mood,
    labelForMood(entry.mood, taxonomy),
    entry.title ?? "",
    ...(entry.tags ?? []),
  ]
    .join(" ")
    .toLowerCase();
  return hay.includes(q);
}

/**
 * 要望 (業種 / カラー / ムード / タグ / 自由文) から候補セルを絞り込む。
 *
 * 各軸は `decideAxes` の resolver (キーワード / 別名一致) で解決し、best が取れた軸だけ
 * を完全一致フィルタに使う。業種を入力したが JSIC を解決できなかった場合は、業種語を
 * 自由文としてメタ一致に回す (握りつぶさない)。自由文 (`text`) は常に AND 条件。
 * 何も指定が無ければ全件を返す (初期ブラウズ)。
 */
export function searchCells(
  entries: readonly DesignIndexEntry[],
  input: SearchInput,
  taxonomy?: Taxonomy,
): SearchResult {
  const decision = decideAxes(toBrief(input));
  const industryText = input.industry?.trim() ?? "";
  const jsic = industryText ? decision.jsic.best?.entry.code : undefined;
  const color = input.color?.trim() ? decision.color.best?.entry.slug : undefined;
  const mood = input.mood?.trim() ? decision.mood.best?.entry.slug : undefined;
  const tags = input.tags ?? [];

  const textTerms: string[] = [];
  if (input.text?.trim()) textTerms.push(input.text.trim());
  // 業種を入力したのに JSIC 未解決なら、業種語を自由文一致に落とす。
  if (industryText && jsic === undefined) textTerms.push(industryText);

  const matches = entries.filter((e) => {
    if (jsic !== undefined && e.jsic !== jsic) return false;
    if (color !== undefined && e.color !== color) return false;
    if (mood !== undefined && e.mood !== mood) return false;
    if (tags.length > 0) {
      const set = new Set(e.tags ?? []);
      if (!tags.every((t) => set.has(t))) return false;
    }
    return textTerms.every((t) => matchesText(e, t, taxonomy));
  });

  return { decision, matches };
}

// ---------------------------------------------------------------------------
// 検索マッチのハイライト (issue #39): 自由文の一致箇所を <mark> で強調するための
// 純関数。DOM 非依存で「テキスト → 断片列 (match フラグ付き)」に分割し、DOM 構築は
// main.ts が textContent 経由で安全に行う (innerHTML 不使用 = XSS 安全)。
// ---------------------------------------------------------------------------

/** ハイライト用のテキスト断片。`match=true` の断片を `<mark>` で強調する。 */
export interface HighlightSegment {
  readonly text: string;
  readonly match: boolean;
}

/** 自由文の値 (例 `"信頼 editorial"`) を、ハイライト対象の語 (トークン) 列に分割する。 */
export function highlightTermsFromText(text: string | undefined): string[] {
  if (!text) return [];
  return text
    .split(/[\s、,]+/)
    .map((t) => t.trim())
    .filter((t) => t.length > 0);
}

/**
 * `text` を `terms` (大文字小文字を無視) の出現で分割し、一致断片へ印を付ける (決定論・純関数)。
 * 各位置で最長一致する語を採り、非一致部と隣接する同種断片はまとめる。空 `text` や有効な語が
 * 無い場合は単一の非一致断片を返す。XSS 安全: 呼び手は各断片を textContent で DOM 化する。
 */
export function highlightMatches(
  text: string,
  terms: readonly string[],
): readonly HighlightSegment[] {
  const norm = [...new Set(terms.map((t) => t.trim().toLowerCase()).filter((t) => t.length > 0))];
  if (text.length === 0 || norm.length === 0) return [{ text, match: false }];
  const lower = text.toLowerCase();
  const raw: HighlightSegment[] = [];
  let plainStart = 0;
  let i = 0;
  const flushPlain = (end: number): void => {
    if (end > plainStart) raw.push({ text: text.slice(plainStart, end), match: false });
  };
  while (i < text.length) {
    let best = 0;
    for (const t of norm) {
      if (t.length > best && lower.startsWith(t, i)) best = t.length;
    }
    if (best > 0) {
      flushPlain(i);
      raw.push({ text: text.slice(i, i + best), match: true });
      i += best;
      plainStart = i;
    } else {
      i += 1;
    }
  }
  flushPlain(text.length);
  // 隣接する同種 (連続一致 / 連続非一致) をまとめて断片を最小化する。
  const merged: HighlightSegment[] = [];
  for (const seg of raw) {
    const last = merged[merged.length - 1];
    if (last && last.match === seg.match) {
      merged[merged.length - 1] = { text: last.text + seg.text, match: last.match };
    } else {
      merged.push(seg);
    }
  }
  return merged.length > 0 ? merged : [{ text, match: false }];
}

/** エントリから確定軸 context を組む。 */
export function contextFromEntry(entry: DesignIndexEntry): AxisContext {
  return {
    jsic: entry.jsic,
    color: entry.color,
    mood: entry.mood,
    ...(entry.tags && entry.tags.length > 0 ? { tags: entry.tags } : {}),
  };
}

/** 材化済みセルの {@link DesignResolution} をブラウザで組む。 */
export function materializedResolution(
  entry: DesignIndexEntry,
  markdown: string,
  source: string,
  hashVerified: boolean,
): DesignResolution {
  return { status: "materialized", document: { entry, markdown, source, hashVerified } };
}

// ---------------------------------------------------------------------------
// ファセット絞り込み + ページング (issue #31): 大コーパス向けの純ロジック。
// DOM/ネットワーク非依存 (決定論・テスト可能)。UI 配線は main.ts が担う。
// ---------------------------------------------------------------------------

/** ファセット軸。 */
export type FacetAxis = "industry" | "color" | "mood" | "tag";

/** ファセット軸の列挙 (描画順)。 */
export const FACET_AXES: readonly FacetAxis[] = ["industry", "color", "mood", "tag"];

/** ファセット軸の見出し。 */
export const FACET_TITLES: Record<FacetAxis, string> = {
  industry: "業種 (大分類)",
  color: "カラー系統",
  mood: "ムード",
  tag: "タグ",
};

/** JSIC 大分類 (SSOT/総務省 第14回改定)。中分類 (先頭2桁) の範囲で引く。 */
interface JsicDivision {
  readonly code: string;
  readonly label: string;
  readonly from: number;
  readonly to: number;
}
const JSIC_DIVISIONS: readonly JsicDivision[] = [
  { code: "A", label: "農業，林業", from: 1, to: 2 },
  { code: "B", label: "漁業", from: 3, to: 4 },
  { code: "C", label: "鉱業，採石業，砂利採取業", from: 5, to: 5 },
  { code: "D", label: "建設業", from: 6, to: 8 },
  { code: "E", label: "製造業", from: 9, to: 32 },
  { code: "F", label: "電気・ガス・熱供給・水道業", from: 33, to: 36 },
  { code: "G", label: "情報通信業", from: 37, to: 41 },
  { code: "H", label: "運輸業，郵便業", from: 42, to: 49 },
  { code: "I", label: "卸売業，小売業", from: 50, to: 61 },
  { code: "J", label: "金融業，保険業", from: 62, to: 67 },
  { code: "K", label: "不動産業，物品賃貸業", from: 68, to: 70 },
  { code: "L", label: "学術研究，専門・技術サービス業", from: 71, to: 74 },
  { code: "M", label: "宿泊業，飲食サービス業", from: 75, to: 77 },
  { code: "N", label: "生活関連サービス業，娯楽業", from: 78, to: 80 },
  { code: "O", label: "教育，学習支援業", from: 81, to: 82 },
  { code: "P", label: "医療，福祉", from: 83, to: 85 },
  { code: "Q", label: "複合サービス事業", from: 86, to: 87 },
  { code: "R", label: "サービス業（他に分類されないもの）", from: 88, to: 96 },
  { code: "S", label: "公務（他に分類されるものを除く）", from: 97, to: 98 },
  { code: "T", label: "分類不能の産業", from: 99, to: 99 },
];
const jsicDivisionByCode = new Map(JSIC_DIVISIONS.map((d) => [d.code, d]));

/** JSIC 大分類 (letter コード + 名称)。 */
export interface JsicMajor {
  readonly code: string;
  readonly label: string;
}
const UNKNOWN_MAJOR: JsicMajor = { code: "?", label: "分類不明" };

/** JSIC 細分類コード → 大分類 (letter + 名称)。範囲外/不正は「分類不明」。 */
export function jsicMajor(code: string): JsicMajor {
  const major = Number.parseInt(code.slice(0, 2), 10);
  if (!Number.isFinite(major)) return UNKNOWN_MAJOR;
  const div = JSIC_DIVISIONS.find((d) => major >= d.from && major <= d.to);
  return div ? { code: div.code, label: div.label } : UNKNOWN_MAJOR;
}

/** カラー系統 (PCCS 色相番号を系統にまとめたもの)。 */
export interface ColorFamily {
  readonly key: string;
  readonly label: string;
}
const NEUTRAL_FAMILY: ColorFamily = { key: "neutral", label: "無彩色" };
const HUE_FAMILIES: readonly { readonly hues: readonly number[]; readonly family: ColorFamily }[] =
  [
    { hues: [1, 2, 3, 24], family: { key: "red", label: "赤系" } },
    { hues: [4, 5, 6], family: { key: "orange", label: "オレンジ系" } },
    { hues: [7, 8, 9], family: { key: "yellow", label: "黄系" } },
    { hues: [10, 11], family: { key: "yellowgreen", label: "黄緑系" } },
    { hues: [12, 13, 14], family: { key: "green", label: "緑系" } },
    { hues: [15], family: { key: "bluegreen", label: "青緑系" } },
    { hues: [16, 17, 18], family: { key: "blue", label: "青系" } },
    { hues: [19, 20], family: { key: "bluepurple", label: "青紫系" } },
    { hues: [21, 22], family: { key: "purple", label: "紫系" } },
    { hues: [23], family: { key: "redpurple", label: "赤紫系" } },
  ];
const familyByHue = new Map<number, ColorFamily>();
for (const g of HUE_FAMILIES) for (const h of g.hues) familyByHue.set(h, g.family);
const familyByKey = new Map<string, ColorFamily>([
  [NEUTRAL_FAMILY.key, NEUTRAL_FAMILY],
  ...HUE_FAMILIES.map((g) => [g.family.key, g.family] as const),
]);

/** カラー slug → 色系統。slug 内の `h{PCCS色相番号}` から導出。無彩色は「無彩色」。 */
export function colorFamily(slug: string): ColorFamily {
  const m = /h(\d{1,2})/i.exec(slug);
  const raw = m?.[1];
  if (raw === undefined) return NEUTRAL_FAMILY;
  return familyByHue.get(Number.parseInt(raw, 10)) ?? NEUTRAL_FAMILY;
}

/** 各軸で entry が属するファセット値 (industry=大分類 / color=系統 / mood / tag)。 */
function entryFacetValues(entry: DesignIndexEntry, axis: FacetAxis): readonly string[] {
  if (axis === "industry") return [jsicMajor(entry.jsic).code];
  if (axis === "color") return [colorFamily(entry.color).key];
  if (axis === "mood") return [entry.mood];
  return entry.tags ?? [];
}

/**
 * ファセット値の表示ラベル。
 * - industry / color は「大分類 / 色系統」の client 計算ラベル (一貫性のため taxonomy に依らない)。
 * - mood は taxonomy の `name_ja` を優先 (無ければ bundled ラベル → slug)。
 */
function facetLabel(axis: FacetAxis, value: string, taxonomy?: Taxonomy): string {
  if (axis === "industry") return jsicDivisionByCode.get(value)?.label ?? value;
  if (axis === "color") return familyByKey.get(value)?.label ?? value;
  if (axis === "mood") return labelForMood(value, taxonomy);
  return value;
}

/** 選択中のファセット (軸ごとの値集合)。 */
export interface FacetSelection {
  readonly industry: readonly string[];
  readonly color: readonly string[];
  readonly mood: readonly string[];
  readonly tag: readonly string[];
}

/** 空の選択 (全件ブラウズ)。 */
export const EMPTY_SELECTION: FacetSelection = { industry: [], color: [], mood: [], tag: [] };

/** ある軸の選択に entry が合致するか (同一軸 OR / 選択空なら true)。 */
function matchesAxis(
  entry: DesignIndexEntry,
  axis: FacetAxis,
  selected: readonly string[],
): boolean {
  if (selected.length === 0) return true;
  const values = entryFacetValues(entry, axis);
  return selected.some((s) => values.includes(s));
}

/** 全軸に合致するか (軸跨ぎ AND)。`except` 軸は無視 (件数算出用)。 */
export function matchesFacets(
  entry: DesignIndexEntry,
  selection: FacetSelection,
  except?: FacetAxis,
): boolean {
  return FACET_AXES.every((axis) => axis === except || matchesAxis(entry, axis, selection[axis]));
}

/** 選択に合致する entry だけを返す (軸跨ぎ AND / 同一軸 OR)。 */
export function filterByFacets(
  entries: readonly DesignIndexEntry[],
  selection: FacetSelection,
): DesignIndexEntry[] {
  return entries.filter((e) => matchesFacets(e, selection));
}

/** 軸の値をトグルした新しい選択を返す (不変)。 */
export function toggleFacet(
  selection: FacetSelection,
  axis: FacetAxis,
  value: string,
): FacetSelection {
  const current = selection[axis];
  const next = current.includes(value) ? current.filter((v) => v !== value) : [...current, value];
  return { ...selection, [axis]: next };
}

/** いずれかの軸で選択があるか。 */
export function hasAnyFacet(selection: FacetSelection): boolean {
  return FACET_AXES.some((axis) => selection[axis].length > 0);
}

/** 1 ファセット値の表示情報 (件数バッジ付き)。 */
export interface FacetValueItem {
  readonly value: string;
  readonly label: string;
  readonly count: number;
  readonly selected: boolean;
}

/** 1 軸のファセット表示 (チップ群)。 */
export interface FacetGroupView {
  readonly axis: FacetAxis;
  readonly title: string;
  readonly items: readonly FacetValueItem[];
}

/**
 * ファセット群を集計する。各値の件数は「その軸を除く選択」を反映した文脈依存カウント
 * (クリック時に得られる件数)。件数降順 → ラベル昇順。選択済みの値は 0 件でも残す。
 */
export function computeFacetGroups(
  entries: readonly DesignIndexEntry[],
  selection: FacetSelection,
  taxonomy?: Taxonomy,
): FacetGroupView[] {
  return FACET_AXES.map((axis) => {
    const counts = new Map<string, number>();
    for (const entry of entries) {
      if (!matchesFacets(entry, selection, axis)) continue;
      for (const value of new Set(entryFacetValues(entry, axis))) {
        counts.set(value, (counts.get(value) ?? 0) + 1);
      }
    }
    for (const value of selection[axis]) if (!counts.has(value)) counts.set(value, 0);
    const items: FacetValueItem[] = [...counts.entries()].map(([value, count]) => ({
      value,
      count,
      label: facetLabel(axis, value, taxonomy),
      selected: selection[axis].includes(value),
    }));
    items.sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, "ja"));
    return { axis, title: FACET_TITLES[axis], items };
  });
}

/** ページング結果。 */
export interface Page<T> {
  readonly items: readonly T[];
  /** 1 起点の現在ページ (範囲内にクランプ済み)。 */
  readonly page: number;
  /** 総ページ数 (最低 1)。 */
  readonly pageCount: number;
  /** 全件数。 */
  readonly total: number;
  /** 1 ページの件数。 */
  readonly pageSize: number;
}

/** items を pageSize でページングする。page は範囲内にクランプする。 */
export function paginate<T>(items: readonly T[], page: number, pageSize: number): Page<T> {
  const size = Math.max(1, Math.floor(pageSize));
  const total = items.length;
  const pageCount = Math.max(1, Math.ceil(total / size));
  const clamped = Math.min(Math.max(1, Math.floor(page) || 1), pageCount);
  const start = (clamped - 1) * size;
  return {
    items: items.slice(start, start + size),
    page: clamped,
    pageCount,
    total,
    pageSize: size,
  };
}

/** {@link composePromptForCell} の入力。 */
export interface ComposeInput {
  entry: DesignIndexEntry;
  /** raw から取得した DESIGN.md 全文。 */
  markdown: string;
  /** index の hash と本文 sha256 が一致したか。 */
  hashVerified: boolean;
  /** 元の検索要望 (notices に反映)。省略時はエントリの軸から補う。 */
  request?: SearchInput;
  /**
   * 作りたいサイトの言語。指定すると合成プロンプトへ「ユーザー可視テキストをこの言語で出力せよ」
   * と注入する。任意の言語名を受け付ける（下流の生成エージェントが翻訳する。Matrix は保存しない）。
   * 空/未指定なら注入しない。UI（Matrix）の表示言語とは独立。
   */
  outputLanguage?: string;
}

// ---------------------------------------------------------------------------
// カラースウォッチ (issue #37): セルカードにカラーパレットを色見本で表示する。
// - 一覧カード: color slug (PCCS 色相/トーン) からクライアントで近似色を導出 (fetch 不要)。
// - 選択セル: DESIGN.md 本文の color-system 実トークン色 (`--color-*`) を抽出して差し替え。
// DOM/ネットワーク非依存の純関数 (決定論・テスト可能)。描画/取得は main.ts が担う。
// de-brand: ラベルは商標色名を使わず「役割 + PCCS 表現 (色系統/トーン)」で表す。
// ---------------------------------------------------------------------------

/** 1 スウォッチ (色見本)。role=機械キー / hex=#rrggbb / label=日本語の役割・色ラベル。 */
export interface Swatch {
  readonly role: string;
  /** 正規化済み `#rrggbb` (小文字)。 */
  readonly hex: string;
  /** de-brand なラベル (役割 + 色系統/トーン)。title/aria-label に使う。 */
  readonly label: string;
}

/** 0..1 にクランプ。 */
function clamp01(v: number): number {
  return Math.min(1, Math.max(0, v));
}

/** 値を [lo, hi] にクランプ。 */
function clampRange(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

/** HSL (h:0-360, s/l:0-100) → `#rrggbb` (小文字)。決定論・純関数。 */
export function hslToHex(h: number, s: number, l: number): string {
  const sn = clamp01(s / 100);
  const ln = clamp01(l / 100);
  const hh = ((h % 360) + 360) % 360;
  const c = (1 - Math.abs(2 * ln - 1)) * sn;
  const x = c * (1 - Math.abs(((hh / 60) % 2) - 1));
  const m = ln - c / 2;
  let r = 0;
  let g = 0;
  let b = 0;
  if (hh < 60) [r, g, b] = [c, x, 0];
  else if (hh < 120) [r, g, b] = [x, c, 0];
  else if (hh < 180) [r, g, b] = [0, c, x];
  else if (hh < 240) [r, g, b] = [0, x, c];
  else if (hh < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  const to = (v: number): string =>
    Math.round((v + m) * 255)
      .toString(16)
      .padStart(2, "0");
  return `#${to(r)}${to(g)}${to(b)}`;
}

/** PCCS 24 色相番号 → HSL 色相角 (度) の近似。ブラウズ用の視覚的目安。 */
const PCCS_HUE_ANGLE: Readonly<Record<number, number>> = {
  1: 345,
  2: 0,
  3: 11,
  4: 20,
  5: 28,
  6: 38,
  7: 46,
  8: 53,
  9: 64,
  10: 78,
  11: 95,
  12: 125,
  13: 150,
  14: 168,
  15: 180,
  16: 193,
  17: 208,
  18: 220,
  19: 234,
  20: 250,
  21: 266,
  22: 284,
  23: 305,
  24: 326,
};

/** PCCS トーンの近似 (基準となる主色の彩度/明度)。 */
interface ToneSpec {
  readonly label: string;
  readonly s: number;
  readonly l: number;
}

/** PCCS トーン略号 → 近似 (彩度/明度) + 日本語ラベル。 */
const PCCS_TONES: Readonly<Record<string, ToneSpec>> = {
  v: { label: "ビビッド", s: 95, l: 50 },
  b: { label: "ブライト", s: 85, l: 62 },
  s: { label: "ストロング", s: 78, l: 47 },
  dp: { label: "ディープ", s: 90, l: 32 },
  lt: { label: "ライト", s: 55, l: 73 },
  sf: { label: "ソフト", s: 45, l: 60 },
  d: { label: "ダル", s: 38, l: 48 },
  dk: { label: "ダーク", s: 60, l: 28 },
  p: { label: "ペール", s: 28, l: 86 },
  ltg: { label: "ライトグレイッシュ", s: 16, l: 72 },
  g: { label: "グレイッシュ", s: 16, l: 50 },
  dkg: { label: "ダークグレイッシュ", s: 18, l: 28 },
};
/** トーン未特定時の既定 (中庸なストロング)。 */
const DEFAULT_TONE: ToneSpec = { label: "ストロング", s: 78, l: 47 };

/** 無彩色の種別。 */
type NeutralKind = "white" | "black" | "gray";

/** color slug の解析結果 (PCCS 色相/トーン or 無彩色)。 */
export interface ParsedColor {
  /** 無彩色ならその種別、有彩色なら null。 */
  readonly neutral: NeutralKind | null;
  /** PCCS 色相番号 (1..24)。無彩色/未特定は null。 */
  readonly hue: number | null;
  /** PCCS トーン略号 ({@link PCCS_TONES} のキー)。未特定は null。 */
  readonly tone: string | null;
}

/**
 * color slug を PCCS 色相/トーン or 無彩色へ解析する (決定論・純関数, 例外なし)。
 * 対応する slug 体系:
 * - 無彩色: `white` / `ac-w` / `black` / `ac-bk` / `gray-N` / `grey…`。
 * - 有彩色 (トーン先頭): `{tone}-h{NN}` 例 `d-h07` / `v-h03` / `sf-h05` / `dkg-h01`。
 * - 有彩色 (色相先頭・旧式): `h{NN}{a|b}-{tone}` 例 `h17b-lt`。
 * 色相が取れない/範囲外は無彩色 (gray) として扱う (画面は壊れない)。
 */
export function parseColorSlug(slug: string): ParsedColor {
  const s = slug.trim().toLowerCase();
  if (/^(ac-?w|white|off-?white|ivory)/.test(s)) return { neutral: "white", hue: null, tone: null };
  if (/^(ac-?bk|black|ink)/.test(s)) return { neutral: "black", hue: null, tone: null };
  if (/^gr[ae]y/.test(s)) return { neutral: "gray", hue: null, tone: null };
  const hm = /h(\d{1,2})/.exec(s);
  const hue = hm ? Number.parseInt(hm[1] ?? "", 10) : Number.NaN;
  if (!Number.isFinite(hue) || hue < 1 || hue > 24) {
    return { neutral: "gray", hue: null, tone: null };
  }
  const pre = /^([a-z]+)-h\d/.exec(s)?.[1];
  const suf = /h\d{1,2}[a-z]?-([a-z]+)/.exec(s)?.[1];
  const cand = pre ?? suf ?? null;
  const tone = cand && cand in PCCS_TONES ? cand : null;
  return { neutral: null, hue, tone };
}

/** 無彩色種別ごとの 4 段階スウォッチ (背景→主色→中間→前景)。 */
function neutralSwatches(kind: NeutralKind): readonly Swatch[] {
  const ramps: Readonly<Record<NeutralKind, readonly [number, number, number, number]>> = {
    white: [99, 92, 62, 22],
    gray: [90, 70, 45, 18],
    black: [80, 54, 30, 10],
  };
  const [bg, primary, mid, ink] = ramps[kind];
  const g = (l: number): string => hslToHex(0, 0, l);
  return [
    { role: "surface", hex: g(bg), label: "背景（無彩色・淡）" },
    { role: "primary", hex: g(primary), label: "主色（無彩色）" },
    { role: "accent", hex: g(mid), label: "中間（無彩色）" },
    { role: "ink", hex: g(ink), label: "前景（無彩色・暗）" },
  ];
}

/** 有彩色 (色相角 + トーン) から 4 段階スウォッチ (背景/主色/強調/前景) を導出。 */
function chromaticSwatches(hue: number, toneKey: string | null): readonly Swatch[] {
  const angle = PCCS_HUE_ANGLE[hue] ?? 0;
  const tone: ToneSpec = PCCS_TONES[toneKey ?? ""] ?? DEFAULT_TONE;
  const familyLabel = (familyByHue.get(hue) ?? NEUTRAL_FAMILY).label;
  return [
    {
      role: "surface",
      hex: hslToHex(angle, clampRange(tone.s * 0.35, 12, 34), 95),
      label: `背景（${familyLabel}・淡）`,
    },
    {
      role: "primary",
      hex: hslToHex(angle, tone.s, tone.l),
      label: `主色（${tone.label} × ${familyLabel}）`,
    },
    {
      role: "accent",
      hex: hslToHex(angle, Math.min(100, tone.s + 12), clampRange(tone.l * 0.62, 26, 46)),
      label: `強調（${familyLabel}・濃）`,
    },
    {
      role: "ink",
      hex: hslToHex(angle, Math.min(tone.s, 22), 15),
      label: `前景（${familyLabel}・暗）`,
    },
  ];
}

/**
 * color slug から近似カラーパレット (4 スウォッチ) を導出する (決定論・純関数)。
 * 一覧カードで DESIGN.md を取得せずに配色を視覚化するための近似。
 * 実際のトークン色は {@link extractColorTokens} で DESIGN.md 本文から取り出す。
 */
export function approxSwatchesForColor(slug: string): readonly Swatch[] {
  const parsed = parseColorSlug(slug);
  if (parsed.neutral) return neutralSwatches(parsed.neutral);
  // hue は parseColorSlug の契約上ここでは非 null (無彩色でなければ 1..24)。
  return chromaticSwatches(parsed.hue ?? 1, parsed.tone);
}

/**
 * カラー系統キー (`colorFamily` の `key`) → 代表色 `#rrggbb` (系統ファセットチップのスウォッチ用)。
 * その系統の中央付近の PCCS 色相角をストロング相当のトーンで表す (決定論・純関数)。
 * 無彩色は中庸グレー、未知キーは null (呼び手はスウォッチを省く)。
 */
export function familySwatchHex(familyKey: string): string | null {
  if (familyKey === NEUTRAL_FAMILY.key) return hslToHex(0, 0, 62);
  const group = HUE_FAMILIES.find((g) => g.family.key === familyKey);
  if (!group) return null;
  // 系統に属する色相の中央を代表色相に採る (両端に偏らない見本)。
  const hue = group.hues[Math.floor(group.hues.length / 2)] ?? group.hues[0] ?? 1;
  const angle = PCCS_HUE_ANGLE[hue] ?? 0;
  return hslToHex(angle, 80, 50);
}

/** カラートークン role (英小文字) → 日本語の役割ラベル。未知 role は role をそのまま使う。 */
const TOKEN_ROLE_LABELS: Readonly<Record<string, string>> = {
  primary: "主色",
  secondary: "副色",
  accent: "強調",
  neutral: "中間色",
  bg: "背景",
  background: "背景",
  surface: "面",
  fg: "前景",
  foreground: "前景",
  muted: "抑え",
  border: "境界",
};

/** `#rgb`/`#rrggbb` を検証し `#rrggbb` (小文字) に正規化する。不正は null。 */
function normalizeHex(raw: string): string | null {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(raw.trim());
  if (!m) return null;
  const h = (m[1] ?? "").toLowerCase();
  return h.length === 3 ? `#${h[0]}${h[0]}${h[1]}${h[1]}${h[2]}${h[2]}` : `#${h}`;
}

/**
 * DESIGN.md 本文の color-system テーブルから実トークン色を抽出する (決定論・純関数)。
 * 行例: `| Primary | \`--color-primary\` | #F91F06 |` → `{ role:"primary", hex:"#f91f06", label:"主色" }`。
 * 値セルの hex は素の `#f91f06` でもバッククォート括り `` `#2f6fb0` `` でも拾う (次セル `|` は跨がない)。
 * 出現順を保ち、同一 role は初出のみ採用。トークンが無ければ空配列 (呼び手が近似へフォールバック)。
 */
export function extractColorTokens(markdown: string): readonly Swatch[] {
  const out: Swatch[] = [];
  const seen = new Set<string>();
  const re = /--color-([a-z0-9-]+)[^|#]*\|[^#|]*(#[0-9a-fA-F]{3,6})\b/g;
  let m = re.exec(markdown);
  while (m !== null) {
    const role = (m[1] ?? "").toLowerCase();
    const hex = normalizeHex(m[2] ?? "");
    if (hex && !seen.has(role)) {
      seen.add(role);
      out.push({ role, hex, label: TOKEN_ROLE_LABELS[role] ?? role });
    }
    m = re.exec(markdown);
  }
  return out;
}

/**
 * 選択セルの確定 DESIGN.md から Claude 用プロンプトを合成する。
 * 既存 `synthesizePrompt` (純関数) をそのまま呼ぶ。
 */
export function composePromptForCell(input: ComposeInput): ComposedPrompt {
  const { entry, markdown, hashVerified, request, outputLanguage } = input;
  const ctx = contextFromEntry(entry);
  const brief: DesignBrief = {
    industry: request?.industry?.trim() || jsicName(entry.jsic),
    ...(request?.color?.trim() ? { color: request.color } : {}),
    ...(request?.mood?.trim() ? { mood: request.mood } : {}),
    ...(entry.tags && entry.tags.length > 0 ? { tags: entry.tags } : {}),
  };
  const resolution = materializedResolution(entry, markdown, designRawUrl(entry), hashVerified);
  return synthesizePrompt(brief, resolution, ctx, {
    ...(outputLanguage?.trim() ? { outputLanguage: outputLanguage.trim() } : {}),
  });
}
