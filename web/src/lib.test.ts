import { describe, expect, it } from "vitest";
import type { DesignIndexEntry } from "../../src/ds/types.js";
import {
  colorLabel,
  composePromptForCell,
  contextFromEntry,
  designRawUrl,
  jsicName,
  moodLabel,
  searchCells,
} from "./lib.js";

/** 公開 index のミラー (材化済み 2 セル)。 */
const consulting: DesignIndexEntry = {
  id: "7281_h17b-lt_trustworthy",
  path: "design-md/7281/h17b-lt/trustworthy/DESIGN.md",
  jsic: "7281",
  color: "h17b-lt",
  mood: "trustworthy",
  tags: ["professional", "geometric-grid", "sans-serif"],
  title: "経営コンサルタント業 × ライトブルー × 信頼",
  hash: "sha256:aaaa",
  createdAt: "2026-07-11T00:00:00Z",
};
const bookstore: DesignIndexEntry = {
  id: "6061_white_minimal",
  path: "design-md/6061/white/minimal/DESIGN.md",
  jsic: "6061",
  color: "white",
  mood: "minimal",
  tags: ["editorial", "serif-display"],
  title: "書籍・雑誌小売業 × ホワイト × ミニマル",
  hash: "sha256:bbbb",
  createdAt: "2026-07-11T00:00:00Z",
};
const entries: readonly DesignIndexEntry[] = [consulting, bookstore];

describe("カタログ参照", () => {
  it("JSIC コードを業種名に解決する", () => {
    expect(jsicName("7281")).toContain("コンサル");
    expect(jsicName("0000")).toBe("0000"); // 未知はコードのまま
  });
  it("color/mood slug をラベルに解決する", () => {
    expect(colorLabel("h17b-lt")).toBe("ライトブルー");
    expect(colorLabel("white")).toBe("ホワイト");
    expect(moodLabel("unknown-mood")).toBe("unknown-mood");
  });
});

describe("designRawUrl", () => {
  it("公開 raw の絶対 URL を組む", () => {
    expect(designRawUrl(bookstore)).toBe(
      "https://raw.githubusercontent.com/AutoDevJapan/GoDD-Design-Systems/main/design-md/6061/white/minimal/DESIGN.md",
    );
  });
});

describe("searchCells", () => {
  it("指定なしなら全件を返す", () => {
    const r = searchCells(entries, {});
    expect(r.matches).toHaveLength(2);
  });

  it("業種キーワードで JSIC を解決して絞り込む", () => {
    const r = searchCells(entries, { industry: "コンサル" });
    expect(r.decision.jsic.best?.entry.code).toBe("7281");
    expect(r.matches.map((e) => e.id)).toEqual(["7281_h17b-lt_trustworthy"]);
  });

  it("カラー別名 (青) で slug を解決して絞り込む", () => {
    const r = searchCells(entries, { color: "青" });
    expect(r.decision.color.best?.entry.slug).toBe("h17b-lt");
    expect(r.matches.map((e) => e.id)).toEqual(["7281_h17b-lt_trustworthy"]);
  });

  it("タグ AND で絞り込む", () => {
    expect(searchCells(entries, { tags: ["editorial"] }).matches).toHaveLength(1);
    expect(searchCells(entries, { tags: ["editorial", "sans-serif"] }).matches).toHaveLength(0);
  });

  it("自由文でタイトル/名称を横断検索する", () => {
    expect(searchCells(entries, { text: "書籍" }).matches.map((e) => e.id)).toEqual([
      "6061_white_minimal",
    ]);
  });

  it("業種入力が JSIC 未解決なら自由文一致に落とす", () => {
    // index に無い業種語。JSIC は解決するかもしれないが、一致セルが無ければ 0 件。
    const r = searchCells(entries, { industry: "存在しない業種zzz" });
    expect(r.matches).toHaveLength(0);
  });
});

describe("contextFromEntry / composePromptForCell", () => {
  it("エントリから確定軸 context を組む", () => {
    expect(contextFromEntry(consulting)).toEqual({
      jsic: "7281",
      color: "h17b-lt",
      mood: "trustworthy",
      tags: ["professional", "geometric-grid", "sans-serif"],
    });
  });

  it("DESIGN.md からプロンプトを合成する (本文を system に埋め込む)", () => {
    const markdown = "# DESIGN\nライトブルーで信頼感のあるレイアウト。";
    const prompt = composePromptForCell({
      entry: consulting,
      markdown,
      hashVerified: true,
      request: { industry: "コンサル", color: "青", mood: "信頼" },
    });
    expect(prompt.provenance).toBe("materialized");
    expect(prompt.hasDesignBody).toBe(true);
    expect(prompt.systemPrompt).toContain(markdown);
    expect(prompt.systemPrompt).toContain("7281");
    expect(prompt.userPrompt).toContain("コンサル");
  });

  it("要望でカラー/ムード未指定なら notices に推定適用を明示する", () => {
    const prompt = composePromptForCell({
      entry: consulting,
      markdown: "# DESIGN",
      hashVerified: true,
    });
    expect(prompt.notices.some((n) => n.includes("カラー軸"))).toBe(true);
    expect(prompt.notices.some((n) => n.includes("ムード軸"))).toBe(true);
  });
});
