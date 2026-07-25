import { describe, expect, it } from "vitest";
import type { Taxonomy } from "./lib.js";
import {
  findColorValue,
  findStyleValue,
  resolveColorSlugs,
  resolveMoodSlug,
} from "./search-parser.js";

const taxonomy: Taxonomy = {
  moods: {
    vintage: { name_ja: "懐古的", name_en: "Vintage" },
    serene: { name_ja: "穏やか", name_en: "Serene" },
  },
  colors: {
    "h17b-lt": {
      name_ja: "明るい青",
      name_en: "Light blue",
      family: "blue",
      family_ja: "青系",
      family_en: "Blues",
    },
    "custom-coral": { name_ja: "珊瑚色", name_en: "Coral", family: "orange" },
    "h2v-vv": { name_ja: "鮮やかな赤", name_en: "Vivid red" },
  },
};

describe("findStyleValue", () => {
  it.each([
    [" minimal ", "minimal"],
    ["ミニマル", "minimal"],
    ["GLASSMORPHISM", "glass"],
  ])("resolves bundled style %s", (term, expected) => {
    expect(findStyleValue(term, taxonomy)).toBe(expected);
  });

  it("matches taxonomy mood names and preserves an unmapped taxonomy slug", () => {
    expect(findStyleValue("懐古", taxonomy)).toBe("retro");
    expect(findStyleValue("VINTAGE", taxonomy)).toBe("retro");
    expect(findStyleValue("穏やか", taxonomy)).toBe("serene");
  });

  it("returns null for blank and unknown terms or missing taxonomy", () => {
    expect(findStyleValue("  ", taxonomy)).toBeNull();
    expect(findStyleValue("懐古的")).toBeNull();
    expect(findStyleValue("unknown", taxonomy)).toBeNull();
  });
});

describe("findColorValue (色合い)", () => {
  it.each([
    [" LIGHTBLUE ", "blue"],
    ["スカイ", "blue"],
    ["violet", "purple"],
    ["indigo", "blue"],
    ["青系", "blue"],
    ["Greens", "green"],
    ["無彩色", "neutral"],
  ])("resolves %s to a color-family key", (term, expected) => {
    expect(findColorValue(term, taxonomy)).toBe(expected);
  });

  it("matches taxonomy color names and families to family keys", () => {
    expect(findColorValue("明るい青", taxonomy)).toBe("blue");
    expect(findColorValue("BLUES", taxonomy)).toBe("blue");
    expect(findColorValue("珊瑚", taxonomy)).toBe("orange");
    expect(findColorValue("鮮やかな赤", taxonomy)).toBe("red");
  });

  it("returns null for blank and unknown terms or missing taxonomy", () => {
    expect(findColorValue("\t", taxonomy)).toBeNull();
    expect(findColorValue("unknown-color-xyz", taxonomy)).toBeNull();
  });
});

describe("resolveColorSlugs (色合い展開)", () => {
  it("expands a family key to concrete catalog slugs (never gray-only / empty)", () => {
    const blues = resolveColorSlugs("blue", taxonomy);
    expect(blues.length).toBeGreaterThan(0);
    expect(blues).toContain("h17b-lt");
    expect(blues.some((slug) => slug.includes("gray"))).toBe(false);

    const yellows = resolveColorSlugs("yellow", taxonomy);
    expect(yellows.length).toBeGreaterThan(0);
    expect(yellows.some((slug) => /h8|h7|h9/i.test(slug))).toBe(true);

    const neutrals = resolveColorSlugs("neutral", taxonomy);
    expect(neutrals).toEqual(expect.arrayContaining(["white", "gray-3", "black"]));
  });

  it("maps legacy palette aliases to family expansions", () => {
    expect(resolveColorSlugs("indigo", taxonomy)).toEqual(resolveColorSlugs("blue", taxonomy));
    expect(resolveColorSlugs("warm-gray", taxonomy)).toEqual(
      resolveColorSlugs("neutral", taxonomy),
    );
  });

  it("keeps a concrete taxonomy slug when explicitly resolved via family path", () => {
    const orange = resolveColorSlugs("orange", taxonomy);
    expect(orange).toContain("custom-coral");
    expect(orange).toContain("h5b-sf");
  });
});

describe("parser consumer contract", () => {
  it("preserves dynamically matched mood slugs for generated combinations", () => {
    const parsed = findStyleValue("穏やか", taxonomy);
    expect(parsed).toBe("serene");
    expect(resolveMoodSlug(parsed as string)).toBe("serene");
  });

  it("family-filtered color expansion stays non-empty for UI filters", () => {
    const parsed = findColorValue("青系", taxonomy);
    expect(parsed).toBe("blue");
    expect(resolveColorSlugs(parsed as string, taxonomy).length).toBeGreaterThan(0);
  });
});
