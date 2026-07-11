/**
 * MCP ツールのドメインロジック (issue #7, SSOT §5)。
 *
 * 既存の純パイプライン (#5 軸決定 / #2 index / #3 本文解決 / #6 合成) を、
 * MCP の I/O 層から独立した薄いツール関数として束ねる。
 * - 純ロジック (軸決定・合成) は既存実装を再利用する。
 * - 副作用 (index 取込・DESIGN.md 本文 fetch) は注入された {@link MatrixRuntime}
 *   に閉じ込め、本モジュール自体は決定論的な変換に徹する。
 * - 出力は JSON シリアライズ可能な DTO に整形し、MCP の structuredContent に載せる。
 */
import { type AxisName, type DesignBrief, decideAxes, selectCells } from "../axes/decide.js";
import type { AxisContext } from "../axes/index.js";
import type { JsicResolution } from "../axes/jsic.js";
import type { TaxonomyResolution } from "../axes/taxonomy.js";
import type { DesignIndexClient } from "../ds/client.js";
import type { DesignResolver } from "../ds/design.js";
import type { DesignIndexEntry } from "../ds/types.js";
import { type ComposedPrompt, synthesizePrompt } from "../prompt/synthesize.js";

/** ツール共通の入力 (要望)。{@link DesignBrief} と同形。 */
export interface MatrixBriefInput {
  /** 業種名 / キーワード / JSIC 細分類コード (必須)。 */
  industry: string;
  /** 希望カラー (色名 / slug)。任意。 */
  color?: string;
  /** 希望ムード。任意。 */
  mood?: string;
  /** 追加タグ (タイポ / レイアウト等)。任意。 */
  tags?: readonly string[];
}

/**
 * 副作用を担う実行時依存 (index 取込・本文解決)。
 * テストではインメモリ実装を注入でき、本番は {@link ./runtime.createRuntime} が env から構築する。
 */
export interface MatrixRuntime {
  index: DesignIndexClient;
  resolver: DesignResolver;
}

/** JSIC 軸候補の要約 (serializable)。 */
export interface JsicCandidateDto {
  code: string;
  name: string;
  score: number;
  matchedBy?: string;
}

/** slug 軸 (カラー / ムード) 候補の要約 (serializable)。 */
export interface SlugCandidateDto {
  slug: string;
  label: string;
  score: number;
}

/** 各軸の解決要約 (best + 上位候補)。 */
export interface AxesSummary {
  jsic: { query: string; best?: JsicCandidateDto; candidates: readonly JsicCandidateDto[] };
  color: { query: string; best?: SlugCandidateDto; candidates: readonly SlugCandidateDto[] };
  mood: { query: string; best?: SlugCandidateDto; candidates: readonly SlugCandidateDto[] };
}

/** 候補を返す上限 (曖昧入力でも出力が膨らみすぎないように)。 */
const MAX_CANDIDATES = 5;

/** 入力を {@link DesignBrief} へ正規化する (未指定の任意項目は落とす)。 */
function toBrief(input: MatrixBriefInput): DesignBrief {
  return {
    industry: input.industry,
    ...(input.color !== undefined ? { color: input.color } : {}),
    ...(input.mood !== undefined ? { mood: input.mood } : {}),
    ...(input.tags && input.tags.length > 0 ? { tags: input.tags } : {}),
  };
}

function summarizeJsic(r: JsicResolution): AxesSummary["jsic"] {
  return {
    query: r.query,
    best: r.best
      ? { code: r.best.entry.code, name: r.best.entry.name, score: r.best.score }
      : undefined,
    candidates: r.candidates.slice(0, MAX_CANDIDATES).map((c) => ({
      code: c.entry.code,
      name: c.entry.name,
      score: c.score,
      matchedBy: c.matchedBy,
    })),
  };
}

function summarizeSlug<Slug extends string>(
  r: TaxonomyResolution<Slug>,
): { query: string; best?: SlugCandidateDto; candidates: readonly SlugCandidateDto[] } {
  return {
    query: r.query,
    best: r.best
      ? { slug: r.best.entry.slug, label: r.best.entry.label, score: r.best.score }
      : undefined,
    candidates: r.candidates.slice(0, MAX_CANDIDATES).map((c) => ({
      slug: c.entry.slug,
      label: c.entry.label,
      score: c.score,
    })),
  };
}

function summarizeAxes(
  jsic: JsicResolution,
  color: TaxonomyResolution<string>,
  mood: TaxonomyResolution<string>,
): AxesSummary {
  return {
    jsic: summarizeJsic(jsic),
    color: summarizeSlug(color),
    mood: summarizeSlug(mood),
  };
}

/** {@link runDecideAxes} の出力。 */
export interface DecideAxesResult {
  /** 全軸が解決し context が確定したか。 */
  resolved: boolean;
  /** 全軸解決時の確定 context。 */
  context?: AxisContext;
  /** 解決できなかった軸。 */
  unresolved: readonly AxisName[];
  /** 各軸の解決要約 (候補提示)。 */
  axes: AxesSummary;
}

/**
 * 要望 → 軸決定 (#5)。副作用なし・決定論。
 * カラー / ムード未指定時の既定適用は行わず、未解決は明示する。
 */
export function runDecideAxes(input: MatrixBriefInput): DecideAxesResult {
  const decision = decideAxes(toBrief(input));
  return {
    resolved: decision.context !== undefined,
    context: decision.context,
    unresolved: decision.unresolved,
    axes: summarizeAxes(decision.jsic, decision.color, decision.mood),
  };
}

/** {@link runSelectCells} の出力。 */
export interface SelectCellsResult {
  resolved: boolean;
  context?: AxisContext;
  unresolved: readonly AxisName[];
  /** context に一致する index の候補セル (未確定なら空)。 */
  candidates: readonly DesignIndexEntry[];
}

/** 要望 → 軸決定 → index 候補セル選定 (#5 + #2)。 */
export function runSelectCells(input: MatrixBriefInput, rt: MatrixRuntime): SelectCellsResult {
  const selection = selectCells(toBrief(input), rt.index);
  return {
    resolved: selection.context !== undefined,
    context: selection.context,
    unresolved: selection.decision.unresolved,
    candidates: selection.candidates,
  };
}

/** {@link runCompose} の出力。軸が未解決なら prompt は返さず候補を返す。 */
export type ComposeResult =
  | {
      resolved: true;
      context: AxisContext;
      /** 一致した候補セル数 (先頭を採用)。 */
      candidateCount: number;
      /** Claude 用プロンプト (system / user) と出所・注意メタ。 */
      prompt: ComposedPrompt;
    }
  | {
      resolved: false;
      unresolved: readonly AxisName[];
      axes: AxesSummary;
    };

/**
 * 要望 → 軸決定 → 候補セル → 確定 DESIGN.md 解決 → Claude 用プロンプト合成
 * (#5 → #2 → #3 → #6) を一気通貫で実行する主ツール。
 * 未解決軸がある場合はプロンプトを合成せず、候補提示付きの未解決結果を返す。
 */
export async function runCompose(
  input: MatrixBriefInput,
  rt: MatrixRuntime,
): Promise<ComposeResult> {
  const brief = toBrief(input);
  const selection = selectCells(brief, rt.index);
  const ctx = selection.context;
  if (ctx === undefined) {
    const d = selection.decision;
    return {
      resolved: false,
      unresolved: d.unresolved,
      axes: summarizeAxes(d.jsic, d.color, d.mood),
    };
  }
  const resolved = await rt.resolver.resolve(ctx);
  const prompt = synthesizePrompt(brief, resolved, ctx);
  return {
    resolved: true,
    context: ctx,
    candidateCount: selection.candidates.length,
    prompt,
  };
}
