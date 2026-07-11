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
  readonly family?: string;
  readonly family_ja?: string;
}

/** taxonomy.json のムード項目 (全フィールド任意)。 */
export interface TaxonomyMood {
  readonly name_ja?: string;
  readonly axis?: string;
}

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
    ...(optString(e.family) ? { family: optString(e.family) } : {}),
    ...(optString(e.family_ja) ? { family_ja: optString(e.family_ja) } : {}),
  }));
  const moods = parseRecord<TaxonomyMood>(obj.moods, (e) => ({
    ...(optString(e.name_ja) ? { name_ja: optString(e.name_ja) } : {}),
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
 * カラー slug → 表示ラベル。taxonomy の `name_ja` を最優先し、無ければ bundled ラベル、
 * 最後に slug をそのまま返す (taxonomy 未達でも従来どおり動作)。
 */
export function labelForColor(slug: string, taxonomy?: Taxonomy): string {
  return taxonomy?.colors[slug]?.name_ja ?? colorLabelBySlug.get(slug) ?? slug;
}

/**
 * ムード slug → 表示ラベル。taxonomy の `name_ja` を最優先し、無ければ bundled ラベル、
 * 最後に slug をそのまま返す (taxonomy 未達でも従来どおり動作)。
 */
export function labelForMood(slug: string, taxonomy?: Taxonomy): string {
  return taxonomy?.moods[slug]?.name_ja ?? moodLabelBySlug.get(slug) ?? slug;
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
}

/**
 * 選択セルの確定 DESIGN.md から Claude 用プロンプトを合成する。
 * 既存 `synthesizePrompt` (純関数) をそのまま呼ぶ。
 */
export function composePromptForCell(input: ComposeInput): ComposedPrompt {
  const { entry, markdown, hashVerified, request } = input;
  const ctx = contextFromEntry(entry);
  const brief: DesignBrief = {
    industry: request?.industry?.trim() || jsicName(entry.jsic),
    ...(request?.color?.trim() ? { color: request.color } : {}),
    ...(request?.mood?.trim() ? { mood: request.mood } : {}),
    ...(entry.tags && entry.tags.length > 0 ? { tags: entry.tags } : {}),
  };
  const resolution = materializedResolution(entry, markdown, designRawUrl(entry), hashVerified);
  return synthesizePrompt(brief, resolution, ctx);
}
