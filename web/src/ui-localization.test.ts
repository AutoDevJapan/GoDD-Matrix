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
    expect(result).toContain("# Request");
    expect(result).toContain("id: cell-1, hash verification: passed");
    expect(result).toContain("No color was requested; inferred slug 'h17b-lt' is applied.");
    expect(result).not.toContain("# 役割");
    expect(result).not.toContain("# 要望");
    expect(result).not.toContain("指定なし");
    expect(result).not.toContain("ソフトウェア業");
    expect(result).toContain("- Industry: Information and Communications");
    expect(result).toContain("- Preferred color: Not specified");
    expect(result).toContain("# ソース由来の固有名");
  });

  it("does not leak a Japanese unavailable reason into the English shell", () => {
    const unavailable = {
      ...prompt,
      notices: ["確定 DESIGN.md 本文がありません: 未材化セル: 6061"],
    };

    const result = localizePromptPreview(unavailable, "en");

    expect(result).toContain("The resolved DESIGN.md body is unavailable.");
    expect(result).not.toContain("未材化セル");
  });

  it("preserves an actionable unavailable reason that is already English", () => {
    const unavailable = {
      ...prompt,
      notices: ["確定 DESIGN.md 本文がありません: DESIGN.md not pre-materialized in Git"],
    };

    expect(localizePromptPreview(unavailable, "en")).toContain(
      "The resolved DESIGN.md body is unavailable: DESIGN.md not pre-materialized in Git",
    );
  });

  it("keeps the Japanese prompt byte-for-byte apart from the existing separator", () => {
    expect(localizePromptPreview(prompt, "ja")).toBe(
      `${prompt.systemPrompt}\n\n${prompt.userPrompt}`,
    );
  });
});
