import { describe, expect, it } from "vitest";
import type { Taxonomy } from "./lib.js";
import { findColorValue, findStyleValue } from "./search-parser.js";

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

describe("findColorValue", () => {
  it.each([
    [" LIGHTBLUE ", "light-blue"],
    ["スカイ", "light-blue"],
    ["violet", "blue"],
  ])("resolves bundled palette alias %s", (term, expected) => {
    expect(findColorValue(term, taxonomy)).toBe(expected);
  });

  it("matches taxonomy color names, families, and slugs", () => {
    expect(findColorValue("明るい青", taxonomy)).toBe("indigo");
    expect(findColorValue("BLUES", taxonomy)).toBe("indigo");
    expect(findColorValue("珊瑚", taxonomy)).toBe("custom-coral");
    expect(findColorValue("custom-coral", taxonomy)).toBe("custom-coral");
    expect(findColorValue("鮮やかな赤", taxonomy)).toBe("orange");
  });

  it("returns null for blank and unknown terms or missing taxonomy", () => {
    expect(findColorValue("\t", taxonomy)).toBeNull();
    expect(findColorValue("珊瑚色")).toBeNull();
    expect(findColorValue("unknown", taxonomy)).toBeNull();
  });
});
