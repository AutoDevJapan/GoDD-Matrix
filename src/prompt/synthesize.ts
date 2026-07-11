/**
 * Claude 用プロンプト合成 (issue #6, SSOT §6/§10)。
 *
 * データフロー (SSOT): 要望 (DesignBrief) →(#5) decideAxes → {@link AxisContext}
 * → selectCells → 候補セル →(#3) {@link DesignResolver} で確定 DESIGN.md 本文
 * → 本モジュールで Claude 用プロンプト (system / user) へ合成する。
 *
 * 方針:
 * - 純関数・決定論・テンプレート化: 同一入力 → 同一出力。副作用・時刻・乱数を持たない。
 * - `services/ai` の注入点 (SSOT §10) に載せる想定で、確定 DESIGN.md 全文を
 *   システムプロンプトへ埋め込む。
 * - 未材化 (レンダーフォールバック / 本文取得不可) と、要望で未指定だった軸は
 *   `notices` と本文で明示する (握りつぶさない)。
 */
import type { DesignBrief } from "../axes/decide.js";
import type { AxisContext } from "../axes/index.js";
import type { DesignResolution } from "../ds/design.js";

/** 確定 DESIGN.md 本文の出所。{@link DesignResolution} の status と対応。 */
export type PromptProvenance = DesignResolution["status"];

/** DESIGN.md 本文を囲む境界マーカー (本文中の ``` と衝突しないため独自マーカーを使う)。 */
const BODY_BEGIN = "===== DESIGN.md ここから =====";
const BODY_END = "===== DESIGN.md ここまで =====";

/** Claude へ渡すプロンプト構造 (システム / ユーザー)。 */
export interface ComposedPrompt {
  /** services/ai の注入点に載せるシステムプロンプト文字列。確定 DESIGN.md 全文を含む。 */
  systemPrompt: string;
  /** 要望を構造化したユーザープロンプト文字列。 */
  userPrompt: string;
  /** 確定 DESIGN.md 本文の出所。 */
  provenance: PromptProvenance;
  /** DESIGN.md 本文を埋め込めたか (unavailable は false)。 */
  hasDesignBody: boolean;
  /** 未材化 / 未指定軸など、明示すべき注意 (決定論的な順序)。 */
  notices: readonly string[];
}

/** 希望が空 (未入力) かどうか。空白のみも未入力扱い (decide.ts と同じ判定)。 */
function isBlank(hint: string | undefined): boolean {
  return hint === undefined || hint.trim().length === 0;
}

/** 表示用: 空なら既定文字列に落とす。 */
function orElse(value: string | undefined, fallback: string): string {
  return isBlank(value) ? fallback : (value as string).trim();
}

/** タグ配列を表示用文字列に。空なら「なし」。 */
function formatTags(tags: readonly string[] | undefined): string {
  return tags && tags.length > 0 ? tags.join(", ") : "なし";
}

/** 解決結果から DESIGN.md 本文を取り出す (未取得なら undefined)。 */
function designBody(resolved: DesignResolution): string | undefined {
  switch (resolved.status) {
    case "materialized":
      return resolved.document.markdown;
    case "rendered":
      return resolved.result.designMarkdown;
    case "unavailable":
      return undefined;
  }
}

/** 出所を人間可読の 1 行に。 */
function provenanceLine(resolved: DesignResolution): string {
  switch (resolved.status) {
    case "materialized": {
      const verified = resolved.document.hashVerified ? "済" : "不一致";
      return `材化済みセルの確定 DESIGN.md 本文 (id: ${resolved.document.entry.id}, hash検証: ${verified})。`;
    }
    case "rendered":
      return "未材化セル。Generator レンダーによるフォールバック本文 (材化品質ゲート未通過)。";
    case "unavailable":
      return "未材化かつ本文取得不可。軸情報のみで合成。";
  }
}

/**
 * 明示すべき注意を決定論的な順序で組む。
 * 順序: 出所由来 (hash / フォールバック / 未取得) → カラー未指定 → ムード未指定。
 */
function buildNotices(brief: DesignBrief, resolved: DesignResolution, ctx: AxisContext): string[] {
  const notices: string[] = [];

  if (resolved.status === "materialized" && !resolved.document.hashVerified) {
    notices.push("警告: DESIGN.md の hash 検証に失敗しています (本文が index と不一致の可能性)。");
  }
  if (resolved.status === "rendered") {
    notices.push(
      "未材化セルのため、Generator レンダーのフォールバック本文を使用しています (材化品質ゲート未通過)。",
    );
  }
  if (resolved.status === "unavailable") {
    notices.push(`確定 DESIGN.md 本文がありません: ${resolved.reason}`);
  }

  if (isBlank(brief.color)) {
    notices.push(`カラー軸は要望で未指定のため、推定 slug '${ctx.color}' を適用しました。`);
  }
  if (isBlank(brief.mood)) {
    notices.push(`ムード軸は要望で未指定のため、推定 slug '${ctx.mood}' を適用しました。`);
  }

  return notices;
}

/** notices を箇条書きに。空なら「特記事項なし」。 */
function formatNotices(notices: readonly string[]): string {
  if (notices.length === 0) return "特記事項なし";
  return notices.map((n) => `- ${n}`).join("\n");
}

/** DESIGN.md 本文ブロック (未取得は明示のプレースホルダ)。 */
function bodyBlock(body: string | undefined): string {
  if (body === undefined) {
    return "確定デザイン仕様 (DESIGN.md) は取得できませんでした (未材化)。上記の確定軸を尊重し、一般原則に基づいて生成してください。";
  }
  return `${BODY_BEGIN}\n${body}\n${BODY_END}`;
}

/**
 * 要望・確定軸・解決済み DESIGN.md から Claude 用プロンプトを合成する (純関数)。
 *
 * @param brief 元の生成要望 (未指定軸の明示に使う)。
 * @param resolved DESIGN.md の解決結果 ({@link DesignResolution})。
 * @param ctx 確定済みの軸 context (全軸解決済み)。
 * @returns system / user プロンプトと出所・注意メタ。
 */
export function synthesizePrompt(
  brief: DesignBrief,
  resolved: DesignResolution,
  ctx: AxisContext,
): ComposedPrompt {
  const body = designBody(resolved);
  const notices = buildNotices(brief, resolved, ctx);

  const systemPrompt = [
    "# 役割",
    "あなたは GoDD デザインプロンプト合成アシスタントです。以下の確定デザイン仕様 (DESIGN.md) に厳密に従い、ユーザーの要望に沿った成果物を生成してください。仕様に明記された配色・タイポグラフィ・ムードから逸脱しないでください。",
    "",
    "# 確定軸 (SSOT §2)",
    `- 業種 (JSIC 細分類): ${ctx.jsic}`,
    `- カラー: ${ctx.color}`,
    `- ムード: ${ctx.mood}`,
    `- 補助タグ: ${formatTags(ctx.tags)}`,
    "",
    "# 出所",
    provenanceLine(resolved),
    "",
    "# 注意",
    formatNotices(notices),
    "",
    "# 確定デザイン仕様 (DESIGN.md 全文)",
    bodyBlock(body),
  ].join("\n");

  const userPrompt = [
    "# 要望",
    `- 業種: ${orElse(brief.industry, "指定なし")}`,
    `- 希望カラー: ${orElse(brief.color, "指定なし")}`,
    `- 希望ムード: ${orElse(brief.mood, "指定なし")}`,
    `- 追加タグ: ${formatTags(brief.tags)}`,
    "",
    "上記の要望と確定デザイン仕様に基づいて、デザイン成果物を生成してください。",
  ].join("\n");

  return {
    systemPrompt,
    userPrompt,
    provenance: resolved.status,
    hasDesignBody: body !== undefined,
    notices,
  };
}
