import { describe, expect, it } from "vitest";
import type { DesignIndexEntry } from "../../src/ds/types.js";
import {
  buildCardColorCue,
  buildDirectionTitle,
  buildEntryTags,
  clampPageSize,
  dedupeEntriesById,
} from "./result-card.js";

const entry: DesignIndexEntry = {
  id: "virtual_6061_h17b-lt_minimal_dashboard_minimal_v2",
  path: "design-md/6061/h17b-lt/minimal/DESIGN.md",
  jsic: "6061",
  color: "h17b-lt",
  mood: "minimal",
  title: "VIRTUAL DESIGN: ソフトウェア業 × h17b-lt × minimal",
  hash: "",
  variant: 2,
  tags: ["dashboard", "minimal", "saas"],
  createdAt: "2026-07-20",
};

describe("buildDirectionTitle", () => {
  it("shows mood + surface without packing color into the title", () => {
    const title = buildDirectionTitle(entry, "ja");
    expect(title).toContain("ダッシュボード");
    expect(title).toMatch(/ミニマル/);
    expect(title).not.toContain("青");
    expect(title).not.toContain("赤");
    expect(title).not.toContain("h17b-lt");
    expect(title).not.toContain("6061");
  });

  it("does not repeat mood when style label matches mood", () => {
    const title = buildDirectionTitle(entry, "ja");
    // tags[1]=minimal matches mood — surface should be category (dashboard), not a second ミニマル
    expect(title).toBe("ミニマルなダッシュボード");
  });

  it("builds a readable English direction line", () => {
    const title = buildDirectionTitle(entry, "en");
    expect(title).toContain("Dashboard");
    expect(title).toContain("·");
    expect(title.toLowerCase()).not.toContain("blue");
  });

  it.each([
    ["swiss", "スイススタイルのダッシュボード"],
    ["flat", "フラットなダッシュボード"],
    ["playful", "プレイフルなダッシュボード"],
    ["industrial", "インダストリアル系ダッシュボード"],
    ["tech", "テック系ダッシュボード"],
    ["editorial", "エディトリアルなダッシュボード"],
  ])("keeps the selected %s style in Japanese", (style, expected) => {
    const styled = { ...entry, mood: "minimal", tags: ["dashboard", style, "saas"] };
    expect(buildDirectionTitle(styled, "ja")).toBe(expected);
  });

  it("uses canonical coordinates when materialized tags are stale", () => {
    const materialized = {
      ...entry,
      id: "design-1",
      tags: ["dashboard", "minimal", "saas"],
      canonicalCellId: "v3:virtual_6061_h17b-lt_minimal_cdashboard_sswiss_v2",
    };
    expect(buildDirectionTitle(materialized, "ja")).toBe("スイススタイルのダッシュボード");
  });
});

describe("buildEntryTags", () => {
  it("keeps industry (+ variant) and drops color/mood/style duplicates", () => {
    const tags = buildEntryTags(entry, "ja");
    const labels = tags.map((t) => t.label);
    expect(tags.some((t) => t.kind === "industry" && t.label.length > 0)).toBe(true);
    expect(labels).toContain("卸売業，小売業");
    expect(labels).toContain("バリエーション 2");
    expect(labels).not.toContain("ミニマル");
    expect(labels).not.toContain("ダッシュボード");
    expect(labels).not.toContain("ライトブルー");
    expect(tags.some((t) => t.kind === "color")).toBe(false);
    expect(tags.some((t) => t.kind === "mood")).toBe(false);
    expect(tags.some((t) => t.kind === "source")).toBe(false);
    expect(labels.join(" ")).not.toMatch(/材化|合成|Virtual|Pre-generated/i);
  });

  it("uses JSIC major-division labels for both JA and EN (not fine-class 本社等)", () => {
    const hqEntry: DesignIndexEntry = {
      ...entry,
      id: "virtual_0100_h2v-vv_minimal_clp_sminimal_v0",
      jsic: "0100",
      variant: 0,
    };
    const ja = buildEntryTags(hqEntry, "ja");
    const en = buildEntryTags(hqEntry, "en");
    expect(ja.find((t) => t.kind === "industry")?.label).toBe("農業，林業");
    expect(en.find((t) => t.kind === "industry")?.label).toBe("Agriculture and Forestry");
    expect(ja.map((t) => t.label).join(" ")).not.toContain("本社");
  });

  it("dedupes identical labels", () => {
    const tags = buildEntryTags(entry, "ja");
    const labels = tags.map((t) => t.label);
    expect(new Set(labels).size).toBe(labels.length);
  });
});

describe("buildCardColorCue", () => {
  it("returns a short family label and swatch even when variant is 0", () => {
    const base = { ...entry, variant: 0 };
    const cue = buildCardColorCue(base, "ja");
    expect(cue.familyKey).toBe("blue");
    expect(cue.label).toBe("青系");
    expect(cue.swatchHex).toMatch(/^#[0-9a-f]{6}$/i);
    // Tags stay industry-focused — no Variant N when variant=0
    expect(buildEntryTags(base, "ja").some((t) => t.kind === "variant")).toBe(false);
  });

  it("distinguishes adjacent popular results that differ only by color", () => {
    const blue = buildCardColorCue({ ...entry, color: "h17b-lt", variant: 0 }, "ja");
    const red = buildCardColorCue({ ...entry, color: "v-h03", variant: 0 }, "ja");
    expect(blue.familyKey).not.toBe(red.familyKey);
    expect(blue.label).not.toBe(red.label);
    expect(blue.swatchHex.toLowerCase()).not.toBe(red.swatchHex.toLowerCase());
  });

  it("uses saturated family swatch, not near-white surface (#102)", () => {
    const lightRed = buildCardColorCue({ ...entry, color: "lt-h03", variant: 0 }, "ja");
    expect(lightRed.label).toBe("赤系");
    // Surface approx is L≈95 (~#f2e…); family sample must stay chromatic.
    const hex = lightRed.swatchHex.toLowerCase();
    expect(hex).toMatch(/^#[0-9a-f]{6}$/);
    expect(hex).not.toMatch(/^#f[0-9a-f]{5}$/i);
    const r = Number.parseInt(hex.slice(1, 3), 16);
    const g = Number.parseInt(hex.slice(3, 5), 16);
    const b = Number.parseInt(hex.slice(5, 7), 16);
    expect(r).toBeGreaterThan(g);
    expect(r).toBeGreaterThan(b);
  });

  it("uses English family labels without putting color into the title", () => {
    const cue = buildCardColorCue(entry, "en");
    expect(cue.label).toBe("Blues");
    expect(buildDirectionTitle(entry, "en").toLowerCase()).not.toContain("blue");
  });
});

describe("dedupeEntriesById", () => {
  it("keeps the first occurrence of each id", () => {
    const a = { ...entry, id: "a" };
    const b = { ...entry, id: "b" };
    expect(dedupeEntriesById([a, a, b, a]).map((e) => e.id)).toEqual(["a", "b"]);
  });
});

describe("clampPageSize", () => {
  it("accepts allowed sizes and snaps others", () => {
    expect(clampPageSize(10)).toBe(10);
    expect(clampPageSize(1000)).toBe(1000);
    expect(clampPageSize(24)).toBe(25);
    expect(clampPageSize(900)).toBe(1000);
  });
});
