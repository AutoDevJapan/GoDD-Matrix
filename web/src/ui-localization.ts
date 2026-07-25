import type { ComposedPrompt } from "../../src/prompt/synthesize.js";
import type { Locale } from "./lib.js";

/** Pick the locale-specific half of the bundled `English / 日本語` color label. */
export function localizedColorName(name: string, slug: string, locale: Locale): string {
  const [english, japanese] = name.split(" / ").map((part) => part.trim());
  if (locale === "ja") return japanese || english || slug;
  return english || slug;
}

function lineValue(lines: readonly string[], prefix: string, fallback = "Not specified"): string {
  const line = lines.find((candidate) => candidate.startsWith(prefix));
  const value = line?.slice(prefix.length).trim();
  if (!value) return fallback;
  if (value === "指定なし") return "Not specified";
  if (value === "なし") return "None";
  return value;
}

/** User-facing notes: never expose materialization / synthesis jargon. */
function localizeNotice(notice: string, locale: Locale): string | null {
  if (notice.startsWith("警告: DESIGN.md の hash 検証に失敗")) {
    return locale === "ja"
      ? "警告: DESIGN.md の整合性チェックに失敗しました。本文が index と一致しない可能性があります。"
      : "Warning: DESIGN.md integrity check failed; the body may not match the index.";
  }
  if (notice.startsWith("未材化セルのため") || notice.includes("材化品質ゲート")) {
    return null;
  }
  if (notice.startsWith("確定 DESIGN.md 本文がありません:")) {
    return locale === "ja"
      ? "DESIGN.md 本文を取得できませんでした。"
      : "The resolved DESIGN.md body is unavailable.";
  }
  const color = /^カラー軸は要望で未指定のため、推定 slug '(.+)' を適用しました。$/.exec(notice);
  if (color) {
    return locale === "ja"
      ? `カラーが未指定のため、推定 slug '${color[1]}' を適用しました。`
      : `No color was requested; inferred slug '${color[1]}' is applied.`;
  }
  const mood = /^ムード軸は要望で未指定のため、推定 slug '(.+)' を適用しました。$/.exec(notice);
  if (mood) {
    return locale === "ja"
      ? `ムードが未指定のため、推定 slug '${mood[1]}' を適用しました。`
      : `No mood was requested; inferred slug '${mood[1]}' is applied.`;
  }
  if (/材化|未材化|リアルタイム合成|materializ|synthesis/i.test(notice)) {
    return null;
  }
  return notice;
}

function designBody(systemPrompt: string): string | undefined {
  const begin = "===== DESIGN.md ここから =====";
  const end = "===== DESIGN.md ここまで =====";
  const start = systemPrompt.indexOf(begin);
  const finish = systemPrompt.indexOf(end, start + begin.length);
  if (start < 0 || finish < 0) return undefined;
  return systemPrompt.slice(start + begin.length, finish).replace(/^\n|\n$/g, "");
}

function localizedSource(prompt: ComposedPrompt, locale: Locale): string {
  if (prompt.provenance === "materialized") {
    return locale === "ja" ? "DESIGN.md 本文を取得済み。" : "Resolved DESIGN.md body is available.";
  }
  if (prompt.provenance === "rendered") {
    return locale === "ja"
      ? "DESIGN.md 本文を生成して表示しています。"
      : "DESIGN.md body was generated for this preview.";
  }
  return locale === "ja"
    ? "DESIGN.md 本文は取得できませんでした。"
    : "No resolved DESIGN.md body is available.";
}

function buildEnglishShell(prompt: ComposedPrompt): string {
  const systemLines = prompt.systemPrompt.split("\n");
  const userLines = prompt.userPrompt.split("\n");
  const body = designBody(prompt.systemPrompt);
  const source = localizedSource(prompt, "en");
  const notices = prompt.notices
    .map((notice) => localizeNotice(notice, "en"))
    .filter((notice): notice is string => Boolean(notice));

  const system = [
    "# Role",
    "You are a production-minded design engineer. Treat the resolved DESIGN.md as the single source of truth and produce an implementable deliverable that matches the user's request.",
    "",
    "# Output language (highest priority)",
    "Generate all user-facing copy, headings, body text, buttons, labels, placeholders, and error messages in **English**. Code identifiers, technical terms, and file paths may remain unchanged.",
    "",
    "# Resolved axes (SSOT §2)",
    `- Industry (JSIC subclass): ${lineValue(systemLines, "- 業種 (JSIC 細分類):")}`,
    `- Color: ${lineValue(systemLines, "- カラー:")}`,
    `- Mood: ${lineValue(systemLines, "- ムード:")}`,
    `- Supporting tags: ${lineValue(systemLines, "- 補助タグ:", "None")}`,
    "",
    "# Source",
    source,
    "",
    "# Notes",
    ...(notices.length > 0 ? notices.map((notice) => `- ${notice}`) : ["- No special notes."]),
    "",
    "# Hard requirements",
    "- Prefer the colors, typography, spacing, radii, shadows, and mood defined in DESIGN.md. Do not invent extra tokens.",
    "- If tokens exist in the body, treat them as the source of truth.",
    "- Keep the first viewport as one composition; do not turn non-dashboard work into a dashboard.",
    "- Give each section one job, one headline, and a short supporting line.",
    "- Make any brand/product name a hero-level signal, not only nav text.",
    "- Limit motion to 2–3 intentional moves and respect prefers-reduced-motion.",
    "- Preserve contrast, readability, and visible focus states.",
    "",
    "# Forbidden",
    "- Generic AI looks: purple-gradient defaults, heavy glow, pill clusters, multi-layer decorative shadows, emoji decoration.",
    "- Floating hero badges/stickers and decorative stat strips.",
    "- Card spam when cards are not interaction containers.",
    "- Replacing DESIGN.md with an unrelated design system.",
    "- Leaving placeholder copy (lorem / TODO / sample text) in the deliverable.",
    "",
    "# Pre-flight checks",
    "- Colors, type, and mood match DESIGN.md",
    "- One primary CTA and a clear next action",
    "- First viewport works on mobile",
    "- Accessible contrast and keyboard use are possible",
    "",
    "# Resolved design specification (full DESIGN.md)",
    body === undefined
      ? "The resolved DESIGN.md could not be loaded. Respect the axes above and use established design principles."
      : `===== DESIGN.md BEGIN =====\n${body}\n===== DESIGN.md END =====`,
  ].join("\n");

  const user = [
    "# Request",
    `- Industry: ${lineValue(userLines, "- 業種:")}`,
    `- Preferred color: ${lineValue(userLines, "- 希望カラー:")}`,
    `- Preferred mood: ${lineValue(userLines, "- 希望ムード:")}`,
    `- Additional tags: ${lineValue(userLines, "- 追加タグ:", "None")}`,
    "- Output language: English",
    "",
    "# Deliverable instructions",
    "Generate an implementable design deliverable from the request and resolved specification.",
    "Prefer including: (1) layout summary (2) key component direction (3) token application notes (4) implementation caveats.",
    "Do not overwrite the specification with unrelated trend aesthetics.",
  ].join("\n");

  return `${system}\n\n${user}`;
}

function buildJapaneseShell(prompt: ComposedPrompt): string {
  const systemLines = prompt.systemPrompt.split("\n");
  const userLines = prompt.userPrompt.split("\n");
  const body = designBody(prompt.systemPrompt);
  const source = localizedSource(prompt, "ja");
  const notices = prompt.notices
    .map((notice) => localizeNotice(notice, "ja"))
    .filter((notice): notice is string => Boolean(notice));

  const system = [
    "# 役割",
    "あなたはプロダクション志向のデザインエンジニアです。確定した DESIGN.md を単一の正とし、要望に沿った実装可能な成果物を生成してください。",
    "",
    "# 出力言語（最優先）",
    "ユーザー向けの文言・見出し・本文・ボタン・ラベル・プレースホルダ・エラーメッセージはすべて **日本語** で生成してください。コード識別子・技術用語・ファイルパスはそのままで構いません。",
    "",
    "# 確定軸 (SSOT §2)",
    `- 業種 (JSIC 細分類): ${lineValue(systemLines, "- 業種 (JSIC 細分類):", "指定なし")}`,
    `- カラー: ${lineValue(systemLines, "- カラー:", "指定なし")}`,
    `- ムード: ${lineValue(systemLines, "- ムード:", "指定なし")}`,
    `- 補助タグ: ${lineValue(systemLines, "- 補助タグ:", "なし")}`,
    "",
    "# 出典",
    source,
    "",
    "# 注意",
    ...(notices.length > 0 ? notices.map((notice) => `- ${notice}`) : ["- 特記事項なし。"]),
    "",
    "# 必須要件",
    "- DESIGN.md で定義された色・タイポ・余白・半径・影・ムードを優先し、余分なトークンを発明しない。",
    "- 本文にトークンがある場合はそれを正とする。",
    "- 最初のビューポートは一つの構図として保つ。ダッシュボード以外をダッシュボード化しない。",
    "- 各セクションは一つの目的・一つの見出し・短い補足文にする。",
    "- ブランド／プロダクト名はナビ文言だけでなくヒーロー級のシグナルにする。",
    "- モーションは意図的な 2〜3 箇所に限り、prefers-reduced-motion を尊重する。",
    "- コントラスト・可読性・フォーカス可視性を保つ。",
    "",
    "# 禁止事項",
    "- 汎用的な AI 見た目（紫グラデ既定、過度なグロー、ピル密集、多層装飾影、絵文字装飾）。",
    "- ヒーロー上の浮遊バッジ／ステッカーや装飾的な統計帯。",
    "- 操作コンテナでないカードの乱用。",
    "- DESIGN.md を無関係なデザインシステムで置き換えること。",
    "- 成果物にプレースホルダ文言（lorem / TODO / サンプル）を残すこと。",
    "",
    "# 事前チェック",
    "- 色・書体・ムードが DESIGN.md と一致している",
    "- 主 CTA が一つで次の行動が明確",
    "- 最初のビューポートがモバイルでも成立する",
    "- コントラストとキーボード操作が可能",
    "",
    "# 確定デザイン仕様（DESIGN.md 全文）",
    body === undefined
      ? "DESIGN.md 本文を読み込めませんでした。上記の確定軸を尊重し、一般原則に基づいて生成してください。"
      : `===== DESIGN.md ここから =====\n${body}\n===== DESIGN.md ここまで =====`,
  ].join("\n");

  const user = [
    "# 要望",
    `- 業種: ${lineValue(userLines, "- 業種:", "指定なし")}`,
    `- 希望カラー: ${lineValue(userLines, "- 希望カラー:", "指定なし")}`,
    `- 希望ムード: ${lineValue(userLines, "- 希望ムード:", "指定なし")}`,
    `- 追加タグ: ${lineValue(userLines, "- 追加タグ:", "なし")}`,
    "- 出力言語: 日本語",
    "",
    "# 成果物の指示",
    "要望と確定仕様から、実装可能なデザイン成果物を生成してください。",
    "可能なら (1) レイアウト要約 (2) 主要コンポーネント方針 (3) トークン適用メモ (4) 実装上の注意 を含めてください。",
    "仕様を無関係なトレンド美学で上書きしないでください。",
  ].join("\n");

  return `${system}\n\n${user}`;
}

/** Localize the prompt shell for the detail UI; never expose internal materialization jargon. */
export function localizePromptPreview(prompt: ComposedPrompt, locale: Locale): string {
  return locale === "ja" ? buildJapaneseShell(prompt) : buildEnglishShell(prompt);
}
