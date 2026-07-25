import { describe, expect, it } from "vitest";
import type { DesignIndexEntry } from "../../src/ds/types.js";
import {
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
