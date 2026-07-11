import { describe, expect, it } from "vitest";
import {
  MINIMAL_COLORS,
  MINIMAL_MOODS,
  StaticColorResolver,
  StaticMoodResolver,
  StaticSlugResolver,
  type TaxonomyEntry,
} from "./taxonomy.js";

const color = new StaticColorResolver();
const mood = new StaticMoodResolver();

describe("StaticColorResolver", () => {
  it("slug 完全一致は score 1", () => {
    const r = color.resolve("h17b-lt");
    expect(r.best?.entry.slug).toBe("h17b-lt");
    expect(r.best?.score).toBe(1);
  });

  it("日本語ラベルで解決する", () => {
    expect(color.resolve("ライトブルー").best?.entry.slug).toBe("h17b-lt");
  });

  it("色名の別名 (日英) で解決する", () => {
    expect(color.resolve("青").best?.entry.slug).toBe("h17b-lt");
    expect(color.resolve("blue").best?.entry.slug).toBe("h17b-lt");
    expect(color.resolve("白").best?.entry.slug).toBe("white");
    expect(color.resolve("black").best?.entry.slug).toBe("black");
  });

  it("表記ゆれ (全角/大小文字) を吸収する", () => {
    expect(color.resolve("ＷＨＩＴＥ").best?.entry.slug).toBe("white");
  });

  it("該当なしは best undefined", () => {
    expect(color.resolve("たまむしいろ").best).toBeUndefined();
    expect(color.resolve("").candidates).toHaveLength(0);
  });

  it("内蔵シードは fixture の color slug を含む", () => {
    const slugs = MINIMAL_COLORS.map((e) => e.slug);
    expect(slugs).toContain("h17b-lt");
    expect(slugs).toContain("white");
  });
});

describe("StaticMoodResolver", () => {
  it("slug 完全一致で解決する", () => {
    expect(mood.resolve("trustworthy").best?.entry.slug).toBe("trustworthy");
  });

  it("日本語/別名で解決する", () => {
    expect(mood.resolve("信頼").best?.entry.slug).toBe("trustworthy");
    expect(mood.resolve("シンプル").best?.entry.slug).toBe("minimal");
    expect(mood.resolve("上品な雰囲気").best?.entry.slug).toBe("elegant");
  });

  it("内蔵シードは fixture の mood slug を含む", () => {
    const slugs = MINIMAL_MOODS.map((e) => e.slug);
    expect(slugs).toContain("trustworthy");
    expect(slugs).toContain("minimal");
  });
});

describe("StaticSlugResolver 拡張", () => {
  it("マスタを差し替えて拡張できる", () => {
    const entries: TaxonomyEntry<string>[] = [
      { slug: "neon", label: "ネオン", aliases: ["ネオン", "neon"] },
    ];
    const r = new StaticSlugResolver(entries);
    expect(r.resolve("neon").best?.entry.slug).toBe("neon");
    expect(r.get("neon")?.label).toBe("ネオン");
    expect(r.resolve("信頼").best).toBeUndefined();
  });

  it("候補は score 降順 → slug 昇順で安定ソートされる", () => {
    const r = mood.resolve("minimal");
    const scores = r.candidates.map((c) => c.score);
    expect(scores).toEqual([...scores].sort((a, b) => b - a));
  });
});
