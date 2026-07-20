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

function localizeNotice(notice: string): string {
  if (notice.startsWith("警告: DESIGN.md の hash 検証に失敗")) {
    return "Warning: DESIGN.md hash verification failed; the body may not match the index.";
  }
  if (notice.startsWith("未材化セルのため")) {
    return "This cell is not materialized; using the Generator-rendered fallback body.";
  }
  if (notice.startsWith("確定 DESIGN.md 本文がありません:")) {
    return `The resolved DESIGN.md body is unavailable:${notice.slice("確定 DESIGN.md 本文がありません:".length)}`;
  }
  const color = /^カラー軸は要望で未指定のため、推定 slug '(.+)' を適用しました。$/.exec(notice);
  if (color) return `No color was requested; inferred slug '${color[1]}' is applied.`;
  const mood = /^ムード軸は要望で未指定のため、推定 slug '(.+)' を適用しました。$/.exec(notice);
  if (mood) return `No mood was requested; inferred slug '${mood[1]}' is applied.`;
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

function localizedSource(prompt: ComposedPrompt, systemLines: readonly string[]): string {
  if (prompt.provenance === "materialized") {
    const source = systemLines.find((line) => line.startsWith("材化済みセルの確定 DESIGN.md 本文"));
    const match = /\(id: (.+), hash検証: (済|不一致)\)/.exec(source ?? "");
    if (match) {
      return `Resolved from materialized DESIGN.md (id: ${match[1]}, hash verification: ${match[2] === "済" ? "passed" : "failed"}).`;
    }
    return "Resolved from a materialized DESIGN.md.";
  }
  if (prompt.provenance === "rendered") {
    return "Resolved from a deterministic fallback render (not through the materialization quality gate).";
  }
  return "No resolved DESIGN.md body is available.";
}

/** Localize only the generated prompt shell; corpus DESIGN.md content is preserved verbatim. */
export function localizePromptPreview(prompt: ComposedPrompt, locale: Locale): string {
  if (locale === "ja") return `${prompt.systemPrompt}\n\n${prompt.userPrompt}`;

  const systemLines = prompt.systemPrompt.split("\n");
  const userLines = prompt.userPrompt.split("\n");
  const body = designBody(prompt.systemPrompt);
  const source = localizedSource(prompt, systemLines);
  const notices =
    prompt.notices.length > 0 ? prompt.notices.map(localizeNotice) : ["No special notes."];

  const system = [
    "# Role",
    "You are the GoDD design-prompt synthesis assistant. Follow the resolved DESIGN.md specification and the user's request exactly, including its color, typography, and mood decisions.",
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
    ...notices.map((notice) => `- ${notice}`),
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
    "Generate the design deliverable from the request and resolved specification above.",
  ].join("\n");

  return `${system}\n\n${user}`;
}
