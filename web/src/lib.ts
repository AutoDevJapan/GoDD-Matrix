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

const jsicNameByCode = new Map(JSIC_SUBCLASSES.map((e) => [e.code, e.name]));
const colorLabelBySlug = new Map(MINIMAL_COLORS.map((e) => [e.slug, e.label]));
const moodLabelBySlug = new Map(MINIMAL_MOODS.map((e) => [e.slug, e.label]));

/** JSIC 細分類コード → 業種名 (未知コードはコードのまま返す)。 */
export function jsicName(code: string): string {
  return jsicNameByCode.get(code) ?? code;
}

/** カラー slug → 表示ラベル (未知 slug は slug のまま返す)。 */
export function colorLabel(slug: string): string {
  return colorLabelBySlug.get(slug) ?? slug;
}

/** ムード slug → 表示ラベル (未知 slug は slug のまま返す)。 */
export function moodLabel(slug: string): string {
  return moodLabelBySlug.get(slug) ?? slug;
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
function matchesText(entry: DesignIndexEntry, term: string): boolean {
  const q = term.trim().toLowerCase();
  if (!q) return true;
  const hay = [
    entry.jsic,
    jsicName(entry.jsic),
    entry.color,
    colorLabel(entry.color),
    entry.mood,
    moodLabel(entry.mood),
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
    return textTerms.every((t) => matchesText(e, t));
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
