import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { DesignBrief } from "../axes/decide.js";
import type { AxisContext } from "../axes/index.js";
import type { DesignResolution } from "../ds/design.js";
import type { DesignIndexEntry } from "../ds/types.js";
import { synthesizePrompt } from "./synthesize.js";

const baseDir = fileURLToPath(new URL("./__fixtures__", import.meta.url));
const BODY_PATH = "design-md/7281/h17b-lt/trustworthy/DESIGN.md";
const markdown = readFileSync(path.join(baseDir, BODY_PATH), "utf8");

const entry: DesignIndexEntry = {
  id: "7281_h17b-lt_trustworthy",
  path: BODY_PATH,
  jsic: "7281",
  color: "h17b-lt",
  mood: "trustworthy",
  title: "経営コンサルタント業 × ライトブルー × 信頼",
  hash: "sha256:0",
  createdAt: "2026-07-11T00:00:00Z",
};

const ctx: AxisContext = { jsic: "7281", color: "h17b-lt", mood: "trustworthy" };

const brief: DesignBrief = {
  industry: "経営コンサルタント",
  color: "ライトブルー",
  mood: "信頼",
};

function materialized(hashVerified = true): DesignResolution {
  return {
    status: "materialized",
    document: { entry, markdown, source: path.join(baseDir, BODY_PATH), hashVerified },
  };
}

describe("synthesizePrompt (材化済み)", () => {
  it("確定 DESIGN.md 全文と確定軸を system プロンプトへ埋め込む", () => {
    const out = synthesizePrompt(brief, materialized(), ctx);
    expect(out.provenance).toBe("materialized");
    expect(out.hasDesignBody).toBe(true);
    // 必須要素
    expect(out.systemPrompt).toContain("# 役割");
    expect(out.systemPrompt).toContain("# 確定軸 (SSOT §2)");
    expect(out.systemPrompt).toContain("業種 (JSIC 細分類): 7281");
    expect(out.systemPrompt).toContain("カラー: h17b-lt");
    expect(out.systemPrompt).toContain("ムード: trustworthy");
    // DESIGN.md 全文を欠落なく含む
    expect(out.systemPrompt).toContain(markdown);
    expect(out.systemPrompt).toContain("===== DESIGN.md ここから =====");
    expect(out.systemPrompt).toContain("===== DESIGN.md ここまで =====");
    // 出所行
    expect(out.systemPrompt).toContain(entry.id);
    expect(out.systemPrompt).toContain("hash検証: 済");
  });

  it("要望を user プロンプトへ構造化する", () => {
    const out = synthesizePrompt(brief, materialized(), ctx);
    expect(out.userPrompt).toContain("# 要望");
    expect(out.userPrompt).toContain("業種: 経営コンサルタント");
    expect(out.userPrompt).toContain("希望カラー: ライトブルー");
    expect(out.userPrompt).toContain("希望ムード: 信頼");
  });

  it("軸が全指定なら特記事項なし", () => {
    const out = synthesizePrompt(brief, materialized(), ctx);
    expect(out.notices).toEqual([]);
    expect(out.systemPrompt).toContain("特記事項なし");
  });

  it("決定論: 同一入力は同一出力 (純関数)", () => {
    const a = synthesizePrompt(brief, materialized(), ctx);
    const b = synthesizePrompt(brief, materialized(), ctx);
    expect(a).toEqual(b);
    expect(a.systemPrompt).toBe(b.systemPrompt);
    expect(a.userPrompt).toBe(b.userPrompt);
  });

  it("補助タグを system / user に反映する", () => {
    const withTags: AxisContext = { ...ctx, tags: ["grid", "sans"] };
    const out = synthesizePrompt({ ...brief, tags: ["grid", "sans"] }, materialized(), withTags);
    expect(out.systemPrompt).toContain("補助タグ: grid, sans");
    expect(out.userPrompt).toContain("追加タグ: grid, sans");
  });

  it("hash 不一致は警告 notice を出す", () => {
    const out = synthesizePrompt(brief, materialized(false), ctx);
    expect(out.systemPrompt).toContain("hash検証: 不一致");
    expect(out.notices.some((n) => n.includes("hash 検証に失敗"))).toBe(true);
  });
});

describe("synthesizePrompt (未指定軸の明示)", () => {
  it("カラー/ムード未指定は推定 slug を notice で明示する", () => {
    const blankBrief: DesignBrief = { industry: "経営コンサルタント" };
    const out = synthesizePrompt(blankBrief, materialized(), ctx);
    expect(out.notices[0]).toContain("カラー軸は要望で未指定");
    expect(out.notices[0]).toContain("h17b-lt");
    expect(out.notices[1]).toContain("ムード軸は要望で未指定");
    expect(out.notices[1]).toContain("trustworthy");
    expect(out.userPrompt).toContain("希望カラー: 指定なし");
    expect(out.userPrompt).toContain("希望ムード: 指定なし");
  });
});

describe("synthesizePrompt (未材化)", () => {
  it("レンダーフォールバック本文を埋め込み、フォールバック notice を出す", () => {
    const resolved: DesignResolution = {
      status: "rendered",
      request: ctx,
      result: { designMarkdown: "# レンダー本文\n本文サンプル" },
    };
    const out = synthesizePrompt(brief, resolved, ctx);
    expect(out.provenance).toBe("rendered");
    expect(out.hasDesignBody).toBe(true);
    expect(out.systemPrompt).toContain("# レンダー本文");
    expect(out.notices.some((n) => n.includes("フォールバック本文"))).toBe(true);
  });

  it("本文取得不可は DESIGN.md ブロックを出さず、理由を notice で明示する", () => {
    const resolved: DesignResolution = {
      status: "unavailable",
      request: ctx,
      reason: "未材化セル: index にエントリがなく、レンダーも未設定です",
    };
    const out = synthesizePrompt(brief, resolved, ctx);
    expect(out.provenance).toBe("unavailable");
    expect(out.hasDesignBody).toBe(false);
    expect(out.systemPrompt).not.toContain("===== DESIGN.md ここから =====");
    expect(out.systemPrompt).toContain("取得できませんでした (未材化)");
    expect(out.notices.some((n) => n.includes("未材化セル: index にエントリがなく"))).toBe(true);
  });
});
