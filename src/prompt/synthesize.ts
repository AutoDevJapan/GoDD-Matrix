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
 * - 実運用品質: hallmark / awesome-design-md 系の「遵守・禁止・検証」を明示し、
 *   DESIGN.md をルールとして読ませる。
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

/** {@link synthesizePrompt} の追加オプション。 */
export interface SynthesizeOptions {
  /**
   * 生成する成果物（作りたいサイト）の言語。ユーザー向けの全テキスト（UI コピー・見出し・
   * 本文・ラベル）をこの言語で出力するよう、合成プロンプトへ指示を注入する。任意の言語名を
   * 受け付ける（"English" / "Français" / "简体中文" / "日本語" など）。空/未指定なら注入しない
   * （従来どおり DESIGN.md の言語に委ねる）。翻訳は下流の生成エージェントが行い、本モジュールは
   * 指示文字列を組むだけ（純関数・決定論を維持）。
   */
  readonly outputLanguage?: string;
}

/** 出力言語の指示ブロック（未指定なら空配列）。 */
function outputLanguageLines(outputLanguage: string | undefined): string[] {
  if (isBlank(outputLanguage)) return [];
  const lang = (outputLanguage as string).trim();
  return [
    "# 出力言語 (最優先)",
    `ユーザー向けに表示される全テキスト（UI コピー・見出し・本文・ボタン・ラベル・プレースホルダ・エラーメッセージ等）を **${lang}** で生成してください。DESIGN.md 本文が別言語で書かれていても、成果物のユーザー可視テキストは必ず ${lang} にします。コード識別子・技術用語・ファイルパスはこの限りではありません。`,
    "",
  ];
}

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
  options: SynthesizeOptions = {},
): ComposedPrompt {
  const body = designBody(resolved);
  const notices = buildNotices(brief, resolved, ctx);
  const languageLines = outputLanguageLines(options.outputLanguage);

  const systemPrompt = [
    "# 役割",
    "あなたは本番品質の UI/UX を実装するデザインエンジニアです。以下の確定デザイン仕様 (DESIGN.md) を**唯一の正**として扱い、ユーザー要望に沿った実装可能な成果物を生成してください。",
    "",
    ...languageLines,
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
    "# 遵守事項 (必須)",
    "- DESIGN.md に定義された配色・タイポグラフィ・スペーシング・半径・影・ムードを優先する。未定義のトークンを勝手に追加しない。",
    "- トークン（CSS 変数 / カラーロール / フォントスタック）が本文にある場合は、それをソース・オブ・トゥルースとして実装に落とす。",
    "- 最初のビューポートは一つの構図として読ませる。ダッシュボードでない限りダッシュボード化しない。",
    "- セクションは一つの目的・一つの見出し・短い補足に絞る。",
    "- ブランド/プロダクト名がある場合はヒーロー級の信号にする（ナビ文言だけにしない）。",
    "- モーションは 2〜3 の意図的な動きに留め、装飾ノイズにしない。`prefers-reduced-motion` を尊重する。",
    "- コントラストと可読性を確保し、フォーカス状態を見えるようにする。",
    "",
    "# 禁止事項",
    "- 汎用 AI っぽい見た目: 紫グラデ偏重、過度な glow、丸ピルの羅列、多層シャドウの装飾、絵文字装飾。",
    "- ヒーロー上の浮遊バッジ / ステッカー / 統計ストリップの濫造。",
    "- カードの乱用（操作の器でないカードを増やさない）。",
    "- DESIGN.md と矛盾する別デザインシステムへの勝手な置換。",
    "- プレースホルダ文言（lorem / TODO / sample text）を本番コピーとして残すこと。",
    "",
    "# 出力前チェック",
    "- 配色・書体・ムードが DESIGN.md と一致しているか",
    "- 主要 CTA が一つに絞られ、次アクションが明確か",
    "- モバイルでも最初の画面が破綻していないか",
    "- アクセシブルなコントラストとキーボード操作が可能か",
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
    ...(isBlank(options.outputLanguage)
      ? []
      : [`- 出力言語: ${(options.outputLanguage as string).trim()}`]),
    "",
    "# 成果物への指示",
    "上記の要望と確定デザイン仕様に基づいて、すぐ実装・レビューできるデザイン成果物を生成してください。",
    "可能なら次を含めてください: (1) 画面構成の要約 (2) 主要コンポーネント方針 (3) トークン適用の要点 (4) 実装時の注意点。",
    "仕様に無い装飾や別系統のトレンド意匠で上書きしないでください。",
  ].join("\n");

  return {
    systemPrompt,
    userPrompt,
    provenance: resolved.status,
    hasDesignBody: body !== undefined,
    notices,
  };
}
