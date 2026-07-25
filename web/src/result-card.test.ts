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
  it("shows direction, not a raw axis dump", () => {
    const title = buildDirectionTitle(entry, "ja");
    expect(title).toContain("ダッシュボード");
    expect(title).toContain("青");
    expect(title).not.toContain("h17b-lt");
    expect(title).not.toContain("6061");
  });

  it("builds a readable English direction line", () => {
    const title = buildDirectionTitle(entry, "en");
    expect(title).toContain("Dashboard");
    expect(title).toContain("·");
  });
});

describe("buildEntryTags", () => {
  it("puts differentiating axes into tags under the title", () => {
    const tags = buildEntryTags(entry, "ja");
    const labels = tags.map((t) => t.label);
    expect(tags.some((t) => t.kind === "industry" && t.label.length > 0)).toBe(true);
    expect(labels).toContain("ダッシュボード");
    expect(labels).toContain("ミニマル");
    expect(labels).toContain("ライトブルー");
    expect(labels).toContain("バリエーション 2");
    expect(tags.some((t) => t.kind === "source")).toBe(true);
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
