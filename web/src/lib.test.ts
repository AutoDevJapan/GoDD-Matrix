import { describe, expect, it } from "vitest";
import type { DesignIndexEntry } from "../../src/ds/types.js";
import {
  EMPTY_SELECTION,
  EMPTY_TAXONOMY,
  type Swatch,
  type Taxonomy,
  approxSwatchesForColor,
  buildCellPermalink,
  colorFamily,
  colorLabel,
  composePromptForCell,
  computeFacetGroups,
  contextFromEntry,
  designRawUrl,
  extractColorTokens,
  familySwatchHex,
  filterByFacets,
  findEntryById,
  highlightMatches,
  highlightTermsFromText,
  hslToHex,
  jsicMajor,
  jsicName,
  labelForColor,
  labelForMood,
  moodLabel,
  paginate,
  parseCellParam,
  parseColorSlug,
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

describe("セルへのパーマリンク (issue #35)", () => {
  const PAGE = "https://autodevjapan.github.io/GoDD-Matrix/";

  it("?cell=<id> からセル ID を取り出す (無ければ null)", () => {
    expect(parseCellParam("?cell=6061_white_minimal")).toBe("6061_white_minimal");
    expect(parseCellParam("?industry=%E3%82%B3&cell=7281_h17b-lt_trustworthy")).toBe(
      "7281_h17b-lt_trustworthy",
    );
    expect(parseCellParam("")).toBeNull();
    expect(parseCellParam("?industry=x")).toBeNull();
    expect(parseCellParam("?cell=")).toBeNull(); // 空値は未指定扱い
  });

  it("共有用パーマリンクは既存クエリ/ハッシュを落とし ?cell=<id> だけにする", () => {
    expect(buildCellPermalink(PAGE, "6061_white_minimal")).toBe(`${PAGE}?cell=6061_white_minimal`);
    // 既存の検索/ファセット/ページ/ハッシュは共有 URL から除外する。
    expect(
      buildCellPermalink(`${PAGE}?industry=book&f_color=blue&page=3#x`, "8036_v-h03_pop"),
    ).toBe(`${PAGE}?cell=8036_v-h03_pop`);
  });

  it("build → parse で往復し ID を復元できる (パーマリンク復元)", () => {
    const link = buildCellPermalink(PAGE, consulting.id);
    const restoredId = parseCellParam(new URL(link).search);
    expect(restoredId).toBe(consulting.id);
    expect(findEntryById(entries, restoredId ?? "")).toBe(consulting);
  });

  it("findEntryById は未知 ID で undefined", () => {
    expect(findEntryById(entries, "6061_white_minimal")).toBe(bookstore);
    expect(findEntryById(entries, "does_not_exist")).toBeUndefined();
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

describe("familySwatchHex (系統代表色, issue #39)", () => {
  it("既知の系統キーは正規化済み #rrggbb を返す", () => {
    for (const key of ["red", "orange", "yellow", "green", "blue", "purple"]) {
      expect(familySwatchHex(key)).toMatch(/^#[0-9a-f]{6}$/);
    }
  });
  it("無彩色は彩度ゼロのグレー (R=G=B)", () => {
    const hex = familySwatchHex("neutral");
    expect(hex).toMatch(/^#([0-9a-f]{2})\1\1$/);
  });
  it("colorFamily の key と往復で一貫する (slug → 系統 → 代表色)", () => {
    expect(familySwatchHex(colorFamily("h17b-lt").key)).toMatch(/^#[0-9a-f]{6}$/);
    expect(familySwatchHex(colorFamily("v-h03").key)).toMatch(/^#[0-9a-f]{6}$/);
  });
  it("未知キーは null (呼び手はスウォッチを省ける)", () => {
    expect(familySwatchHex("no-such-family")).toBeNull();
    expect(familySwatchHex("")).toBeNull();
  });
  it("系統ごとに異なる代表色 (赤系 ≠ 青系)", () => {
    expect(familySwatchHex("red")).not.toBe(familySwatchHex("blue"));
  });
});

describe("highlightTermsFromText (issue #39)", () => {
  it("空白/読点/カンマで語に分割する", () => {
    expect(highlightTermsFromText("信頼 editorial")).toEqual(["信頼", "editorial"]);
    expect(highlightTermsFromText("青、白, ミニマル")).toEqual(["青", "白", "ミニマル"]);
  });
  it("空/未指定は空配列", () => {
    expect(highlightTermsFromText("")).toEqual([]);
    expect(highlightTermsFromText(undefined)).toEqual([]);
    expect(highlightTermsFromText("   ")).toEqual([]);
  });
});

describe("highlightMatches (issue #39)", () => {
  it("一致箇所を match=true 断片に切り出す", () => {
    expect(highlightMatches("経営コンサルタント業", ["コンサル"])).toEqual([
      { text: "経営", match: false },
      { text: "コンサル", match: true },
      { text: "タント業", match: false },
    ]);
  });
  it("大文字小文字を無視し、元の表記を保つ", () => {
    expect(highlightMatches("Editorial Serif", ["editorial"])).toEqual([
      { text: "Editorial", match: true },
      { text: " Serif", match: false },
    ]);
  });
  it("複数語を強調し、隣接する同種断片はまとめる", () => {
    // "赤" と "ポップ" が隣接 → それぞれ mark だが連続 match はまとめる。
    expect(highlightMatches("赤ポップ", ["赤", "ポップ"])).toEqual([
      { text: "赤ポップ", match: true },
    ]);
  });
  it("最長一致を優先する (部分被り)", () => {
    expect(highlightMatches("editorial", ["edit", "editorial"])).toEqual([
      { text: "editorial", match: true },
    ]);
  });
  it("語が無い/空テキストは単一の非一致断片", () => {
    expect(highlightMatches("書店", [])).toEqual([{ text: "書店", match: false }]);
    expect(highlightMatches("書店", ["  "])).toEqual([{ text: "書店", match: false }]);
    expect(highlightMatches("", ["x"])).toEqual([{ text: "", match: false }]);
  });
  it("マッチが無ければ全体が非一致", () => {
    expect(highlightMatches("書店", ["カフェ"])).toEqual([{ text: "書店", match: false }]);
  });
  it("再構成すると元テキストに一致する (無損失分割)", () => {
    const text = "経営コンサル × 信頼 editorial";
    const rebuilt = highlightMatches(text, ["コンサル", "editorial"])
      .map((s) => s.text)
      .join("");
    expect(rebuilt).toBe(text);
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

describe("カラースウォッチ (issue #37)", () => {
  const HEX6 = /^#[0-9a-f]{6}$/;

  describe("hslToHex", () => {
    it("原色/白黒を正しく変換する", () => {
      expect(hslToHex(0, 100, 50)).toBe("#ff0000");
      expect(hslToHex(120, 100, 50)).toBe("#00ff00");
      expect(hslToHex(240, 100, 50)).toBe("#0000ff");
      expect(hslToHex(0, 0, 100)).toBe("#ffffff");
      expect(hslToHex(0, 0, 0)).toBe("#000000");
    });
    it("範囲外の入力もクランプ/巻き戻しして #rrggbb を返す", () => {
      expect(hslToHex(360, 100, 50)).toBe("#ff0000"); // 360 は 0 と同値
      expect(hslToHex(0, 150, 120)).toMatch(HEX6); // s/l クランプ
    });
  });

  describe("parseColorSlug", () => {
    it("無彩色 slug を種別へ解決する", () => {
      expect(parseColorSlug("white")).toEqual({ neutral: "white", hue: null, tone: null });
      expect(parseColorSlug("ac-w")).toEqual({ neutral: "white", hue: null, tone: null });
      expect(parseColorSlug("ac-bk")).toEqual({ neutral: "black", hue: null, tone: null });
      expect(parseColorSlug("black")).toEqual({ neutral: "black", hue: null, tone: null });
      expect(parseColorSlug("gray-3")).toEqual({ neutral: "gray", hue: null, tone: null });
    });
    it("トーン先頭形 {tone}-h{NN} を解析する", () => {
      expect(parseColorSlug("d-h07")).toEqual({ neutral: null, hue: 7, tone: "d" });
      expect(parseColorSlug("v-h03")).toEqual({ neutral: null, hue: 3, tone: "v" });
      expect(parseColorSlug("sf-h05")).toEqual({ neutral: null, hue: 5, tone: "sf" });
      expect(parseColorSlug("dkg-h01")).toEqual({ neutral: null, hue: 1, tone: "dkg" });
      expect(parseColorSlug("ltg-h24")).toEqual({ neutral: null, hue: 24, tone: "ltg" });
    });
    it("色相先頭形 (旧式) h{NN}{a|b}-{tone} を解析する", () => {
      expect(parseColorSlug("h17b-lt")).toEqual({ neutral: null, hue: 17, tone: "lt" });
    });
    it("未知トーンは tone=null、色相の取れない/範囲外は無彩色 gray へ", () => {
      expect(parseColorSlug("zz-h09")).toEqual({ neutral: null, hue: 9, tone: null });
      expect(parseColorSlug("h99-lt").neutral).toBe("gray"); // 範囲外色相
      expect(parseColorSlug("mystery").neutral).toBe("gray");
    });
  });

  describe("approxSwatchesForColor", () => {
    const isValid = (sw: readonly Swatch[]): boolean =>
      sw.length === 4 &&
      sw.every((s) => HEX6.test(s.hex) && s.label.length > 0 && s.role.length > 0);

    it("有彩色は 4 スウォッチ (背景/主色/強調/前景) を #rrggbb で返す", () => {
      const sw = approxSwatchesForColor("v-h03");
      expect(isValid(sw)).toBe(true);
      expect(sw.map((s) => s.role)).toEqual(["surface", "primary", "accent", "ink"]);
      // 赤系 (h03) の主色は赤成分が最大になる。
      const primary = sw[1].hex;
      const r = Number.parseInt(primary.slice(1, 3), 16);
      const g = Number.parseInt(primary.slice(3, 5), 16);
      const b = Number.parseInt(primary.slice(5, 7), 16);
      expect(r).toBeGreaterThan(g);
      expect(r).toBeGreaterThan(b);
    });
    it("無彩色も 4 スウォッチ (全て無彩) を返す", () => {
      const sw = approxSwatchesForColor("white");
      expect(isValid(sw)).toBe(true);
      // 無彩色は r=g=b。
      for (const s of sw) {
        expect(s.hex.slice(1, 3)).toBe(s.hex.slice(3, 5));
        expect(s.hex.slice(3, 5)).toBe(s.hex.slice(5, 7));
      }
    });
    it("de-brand ラベル (役割 + 色系統/トーン) を持つ", () => {
      const sw = approxSwatchesForColor("v-h03");
      expect(sw[1].label).toContain("主色");
      expect(sw[1].label).toContain("赤系");
      expect(sw[1].label).toContain("ビビッド");
    });
    it("決定論的 (同 slug は同結果)", () => {
      expect(approxSwatchesForColor("sf-h12")).toEqual(approxSwatchesForColor("sf-h12"));
    });
    it("トーンで主色の明度が変わる (ペール > ディープ)", () => {
      const light = approxSwatchesForColor("p-h13")[1].hex;
      const deep = approxSwatchesForColor("dp-h13")[1].hex;
      const lum = (hex: string): number =>
        Number.parseInt(hex.slice(1, 3), 16) +
        Number.parseInt(hex.slice(3, 5), 16) +
        Number.parseInt(hex.slice(5, 7), 16);
      expect(lum(light)).toBeGreaterThan(lum(deep));
    });
  });

  describe("extractColorTokens", () => {
    const md = [
      "## カラーシステム / color-system",
      "| 役割 | トークン | 値 |",
      "| --- | --- | --- |",
      "| Primary | `--color-primary` | #F91F06 |",
      "| Secondary | `--color-secondary` | #A33F33 |",
      "| Accent | `--color-accent` | #0DF297 |",
      "| Neutral | `--color-neutral` | #9A817E |",
      "| Background | `--color-bg` | #F8F7F7 |",
      "| Foreground | `--color-fg` | #28201F |",
    ].join("\n");

    it("color-system テーブルからトークン色を出現順に抽出し小文字正規化する", () => {
      const tokens = extractColorTokens(md);
      expect(tokens.map((t) => t.role)).toEqual([
        "primary",
        "secondary",
        "accent",
        "neutral",
        "bg",
        "fg",
      ]);
      expect(tokens[0]).toEqual({ role: "primary", hex: "#f91f06", label: "主色" });
      expect(tokens.find((t) => t.role === "bg")?.label).toBe("背景");
      expect(tokens.find((t) => t.role === "fg")?.hex).toBe("#28201f");
    });
    it("トークンが無い本文は空配列 (呼び手が近似へフォールバック)", () => {
      expect(extractColorTokens("# DESIGN\n本文にトークン表なし")).toEqual([]);
    });
    it("3 桁 hex を 6 桁へ展開し、同一 role は初出のみ採用", () => {
      const t = extractColorTokens(
        "| P | `--color-primary` | #f00 |\n| P2 | `--color-primary` | #0f0 |",
      );
      expect(t).toHaveLength(1);
      expect(t[0].hex).toBe("#ff0000");
    });
    it("値セルがバッククォート括り (`#2f6fb0`) の表記も拾う", () => {
      // 実コーパスには素の #hex とバッククォート括りの両方が存在する。
      const t = extractColorTokens("| Primary | `--color-primary` | `#2F6FB0` |");
      expect(t).toEqual([{ role: "primary", hex: "#2f6fb0", label: "主色" }]);
    });
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
