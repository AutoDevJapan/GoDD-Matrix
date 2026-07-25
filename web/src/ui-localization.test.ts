import { describe, expect, it } from "vitest";
import type { ComposedPrompt } from "../../src/prompt/synthesize.js";
import { localizePromptPreview, localizedColorName } from "./ui-localization.js";

const prompt: ComposedPrompt = {
  systemPrompt: [
    "# 役割",
    "# 確定軸 (SSOT §2)",
    "- 業種 (JSIC 細分類): 6061",
    "- カラー: h17b-lt",
    "- ムード: minimal",
    "- 補助タグ: dashboard",
    "材化済みセルの確定 DESIGN.md 本文 (id: cell-1, hash検証: 済)。",
    "===== DESIGN.md ここから =====",
    "# ソース由来の固有名",
    "===== DESIGN.md ここまで =====",
  ].join("\n"),
  userPrompt: [
    "# 要望",
    "- 業種: Information and Communications",
    "- 希望カラー: 指定なし",
    "- 希望ムード: 指定なし",
    "- 追加タグ: dashboard",
  ].join("\n"),
  provenance: "materialized",
  hasDesignBody: true,
  notices: ["カラー軸は要望で未指定のため、推定 slug 'h17b-lt' を適用しました。"],
};

describe("search UI localization", () => {
  it("uses one language for bundled color labels", () => {
    expect(localizedColorName("Indigo / インディゴ", "indigo", "en")).toBe("Indigo");
    expect(localizedColorName("Indigo / インディゴ", "indigo", "ja")).toBe("インディゴ");
  });
});

describe("detail prompt localization", () => {
  it("localizes the English prompt shell while preserving corpus content", () => {
    const result = localizePromptPreview(prompt, "en");

    expect(result).toContain("# Role");
    expect(result).toContain("# Resolved axes (SSOT §2)");
    expect(result).toContain("# Hard requirements");
    expect(result).toContain("# Forbidden");
    expect(result).toContain("# Request");
    expect(result).toContain("# Deliverable instructions");
    expect(result).toContain("Resolved DESIGN.md body is available.");
    expect(result).toContain("No color was requested; inferred slug 'h17b-lt' is applied.");
    expect(result).not.toContain("# 役割");
    expect(result).not.toContain("指定なし");
    expect(result).not.toMatch(/材化|未材化|materializ/i);
    expect(result).toContain("- Industry: Information and Communications");
    expect(result).toContain("- Preferred color: Not specified");
    expect(result).toContain("# ソース由来の固有名");
  });

  it("does not leak unavailable / materialization jargon into the English shell", () => {
    const unavailable = {
      ...prompt,
      notices: ["確定 DESIGN.md 本文がありません: 未材化セル: 6061"],
    };

    const result = localizePromptPreview(unavailable, "en");

    expect(result).toContain("The resolved DESIGN.md body is unavailable.");
    expect(result).not.toContain("未材化セル");
    expect(result).not.toMatch(/材化|materializ/i);
  });

  it("keeps actionable English unavailable reasons as a generic unavailable note", () => {
    const unavailable = {
      ...prompt,
      notices: ["確定 DESIGN.md 本文がありません: DESIGN.md not pre-materialized in Git"],
    };

    const result = localizePromptPreview(unavailable, "en");
    expect(result).toContain("The resolved DESIGN.md body is unavailable.");
    expect(result).not.toMatch(/materializ|未材化|材化/i);
  });

  it("rewrites the Japanese shell without materialization jargon", () => {
    const result = localizePromptPreview(prompt, "ja");

    expect(result).toContain("# 役割");
    expect(result).toContain("# 確定軸 (SSOT §2)");
    expect(result).toContain("DESIGN.md 本文を取得済み。");
    expect(result).toContain("# ソース由来の固有名");
    expect(result).not.toMatch(/材化|未材化|リアルタイム合成/);
  });

  it("drops Japanese materialization notices from the detail preview", () => {
    const unavailable = {
      ...prompt,
      provenance: "rendered" as const,
      notices: [
        "未材化セルのため、Generator レンダーのフォールバック本文を使用しています (材化品質ゲート未通過)。",
        "確定 DESIGN.md 本文がありません: 未材化セル: 6061",
      ],
    };
    const result = localizePromptPreview(unavailable, "ja");
    expect(result).toContain("DESIGN.md 本文を生成して表示しています。");
    expect(result).toContain("DESIGN.md 本文を取得できませんでした。");
    expect(result).not.toMatch(/材化|未材化|リアルタイム合成/);
  });
});
