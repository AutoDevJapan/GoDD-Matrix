import { describe, expect, it } from "vitest";
import type { DesignIndexEntry } from "../../src/ds/types.js";
import {
  EMPTY_SELECTION,
  EMPTY_TAXONOMY,
  type Taxonomy,
  colorFamily,
  colorLabel,
  composePromptForCell,
  computeFacetGroups,
  contextFromEntry,
  designRawUrl,
  filterByFacets,
  jsicMajor,
  jsicName,
  labelForColor,
  labelForMood,
  moodLabel,
  paginate,
  parseTaxonomy,
  searchCells,
  toggleFacet,
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

describe("parseTaxonomy (フェイルセーフ)", () => {
  it("契約形状を正規化する", () => {
    const tx = parseTaxonomy({
      version: "1.0.0",
      colors: { "h17b-lt": { name_ja: "空色", family: "blue", family_ja: "青系" } },
      moods: { bold: { name_ja: "大胆", axis: "energy" } },
    });
    expect(tx.version).toBe("1.0.0");
    expect(tx.colors["h17b-lt"]).toEqual({ name_ja: "空色", family: "blue", family_ja: "青系" });
    expect(tx.moods.bold).toEqual({ name_ja: "大胆", axis: "energy" });
  });

  it("object でない/欠損は空へ (例外を投げない)", () => {
    expect(parseTaxonomy(null)).toEqual(EMPTY_TAXONOMY);
    expect(parseTaxonomy("nope")).toEqual(EMPTY_TAXONOMY);
    expect(parseTaxonomy(42)).toEqual(EMPTY_TAXONOMY);
    expect(parseTaxonomy({})).toEqual(EMPTY_TAXONOMY);
  });

  it("不正な項目・型を握りつぶし取れる範囲だけ拾う", () => {
    const tx = parseTaxonomy({
      colors: { good: { name_ja: "良" }, bad: "not-object", empty: {} },
      moods: 123,
      version: 7,
    });
    expect(tx.colors.good).toEqual({ name_ja: "良" });
    expect(tx.colors).not.toHaveProperty("bad");
    expect(tx.colors.empty).toEqual({}); // object だが name_ja 等が無い → 空項目
    expect(tx.moods).toEqual({});
    expect(tx.version).toBeUndefined();
  });
});

describe("labelForColor / labelForMood (name_ja 優先・フォールバック)", () => {
  const tx: Taxonomy = {
    colors: { "h17b-lt": { name_ja: "空色" } },
    moods: { minimal: { name_ja: "極小" }, bold: { name_ja: "大胆" } },
  };

  it("taxonomy の name_ja を最優先する", () => {
    expect(labelForColor("h17b-lt", tx)).toBe("空色"); // bundled ラベル(ライトブルー)より優先
    expect(labelForMood("minimal", tx)).toBe("極小"); // bundled ラベル(ミニマル)より優先
    expect(labelForMood("bold", tx)).toBe("大胆"); // bundled に無い slug も日本語化
  });

  it("taxonomy に無い slug は bundled ラベルへフォールバック", () => {
    expect(labelForColor("white", tx)).toBe("ホワイト");
    expect(labelForMood("trustworthy", tx)).toBe("信頼");
  });

  it("bundled にも無い slug は slug のまま", () => {
    expect(labelForColor("h99z-xx", tx)).toBe("h99z-xx");
    expect(labelForMood("brutalist", tx)).toBe("brutalist");
  });

  it("taxonomy 欠損時 (undefined) は bundled ラベル → slug", () => {
    expect(labelForColor("h17b-lt")).toBe("ライトブルー");
    expect(labelForMood("minimal")).toBe("ミニマル");
    expect(labelForMood("brutalist")).toBe("brutalist");
    // taxonomy 無し版の薄いラッパも同値
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

describe("jsicMajor (大分類)", () => {
  it("細分類コードを大分類 (letter + 名称) に解決する", () => {
    expect(jsicMajor("7281")).toEqual({ code: "L", label: "学術研究，専門・技術サービス業" });
    expect(jsicMajor("6061")).toEqual({ code: "I", label: "卸売業，小売業" });
    expect(jsicMajor("0100")).toEqual({ code: "A", label: "農業，林業" });
    expect(jsicMajor("2900").code).toBe("E"); // 製造業 (09-32)
  });
  it("不正/範囲外は分類不明", () => {
    expect(jsicMajor("zz00").code).toBe("?");
  });
});

describe("colorFamily (系統)", () => {
  it("PCCS 色相番号から系統を導出する", () => {
    expect(colorFamily("h17b-lt")).toEqual({ key: "blue", label: "青系" });
    expect(colorFamily("d-h07").key).toBe("yellow");
    expect(colorFamily("v-h03").key).toBe("red");
    expect(colorFamily("dp-h24").key).toBe("red");
  });
  it("無彩色 (h を含まない) は無彩色", () => {
    expect(colorFamily("white")).toEqual({ key: "neutral", label: "無彩色" });
    expect(colorFamily("ac-w").key).toBe("neutral");
  });
});

describe("facets", () => {
  const cells: readonly DesignIndexEntry[] = [
    { ...consulting },
    { ...bookstore },
    {
      id: "8036_v-h03_pop",
      path: "design-md/8036/v-h03/pop/DESIGN.md",
      jsic: "8036",
      color: "v-h03",
      mood: "pop",
      tags: ["editorial"],
      title: "娯楽業 × 赤 × ポップ",
      hash: "sha256:cccc",
      createdAt: "2026-07-11T00:00:00Z",
    },
  ];

  it("実在値だけを集計し件数を付ける", () => {
    const groups = computeFacetGroups(cells, EMPTY_SELECTION);
    const industry = groups.find((g) => g.axis === "industry");
    expect(industry?.items.map((i) => i.value).sort()).toEqual(["I", "L", "N"]);
    const tag = groups.find((g) => g.axis === "tag");
    expect(tag?.items.find((i) => i.value === "editorial")?.count).toBe(2);
  });

  it("同一軸 OR で絞り込む", () => {
    // color 系統 red OR blue → consulting(blue) + entertainment(red)
    const orSel = toggleFacet(toggleFacet(EMPTY_SELECTION, "color", "blue"), "color", "red");
    expect(
      filterByFacets(cells, orSel)
        .map((e) => e.id)
        .sort(),
    ).toEqual(["7281_h17b-lt_trustworthy", "8036_v-h03_pop"]);
  });

  it("軸跨ぎ AND で絞り込む", () => {
    // color red AND tag editorial → entertainment のみ
    const sel = toggleFacet(toggleFacet(EMPTY_SELECTION, "color", "red"), "tag", "editorial");
    expect(filterByFacets(cells, sel).map((e) => e.id)).toEqual(["8036_v-h03_pop"]);
  });

  it("文脈依存カウント (他軸選択を反映)", () => {
    const sel = toggleFacet(EMPTY_SELECTION, "color", "red");
    const groups = computeFacetGroups(cells, sel);
    const tag = groups.find((g) => g.axis === "tag");
    // red を選ぶと editorial の候補件数は 1 (entertainment のみ)
    expect(tag?.items.find((i) => i.value === "editorial")?.count).toBe(1);
  });

  it("ムードファセットのラベルに taxonomy の name_ja を適用する", () => {
    const tx: Taxonomy = { colors: {}, moods: { pop: { name_ja: "ポップ" } } };
    const groups = computeFacetGroups(cells, EMPTY_SELECTION, tx);
    const mood = groups.find((g) => g.axis === "mood");
    // taxonomy 有り: pop → 「ポップ」。bundled にも無い slug なので name_ja が効く。
    expect(mood?.items.find((i) => i.value === "pop")?.label).toBe("ポップ");
    // taxonomy 未達: slug 表示にフォールバック (画面は壊れない)。
    const fallback = computeFacetGroups(cells, EMPTY_SELECTION);
    const moodFb = fallback.find((g) => g.axis === "mood");
    expect(moodFb?.items.find((i) => i.value === "pop")?.label).toBe("pop");
  });

  it("toggleFacet は不変で追加/除去する", () => {
    const s1 = toggleFacet(EMPTY_SELECTION, "mood", "pop");
    expect(s1.mood).toEqual(["pop"]);
    expect(EMPTY_SELECTION.mood).toEqual([]); // 元は不変
    expect(toggleFacet(s1, "mood", "pop").mood).toEqual([]);
  });
});

describe("paginate", () => {
  const items = Array.from({ length: 50 }, (_, i) => i);
  it("ページを切り出す", () => {
    const p = paginate(items, 2, 24);
    expect(p.items).toHaveLength(24);
    expect(p.items[0]).toBe(24);
    expect(p.pageCount).toBe(3);
  });
  it("範囲外ページをクランプする", () => {
    expect(paginate(items, 99, 24).page).toBe(3);
    expect(paginate(items, 0, 24).page).toBe(1);
  });
  it("空でも pageCount は 1", () => {
    const p = paginate([], 1, 24);
    expect(p.pageCount).toBe(1);
    expect(p.total).toBe(0);
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
