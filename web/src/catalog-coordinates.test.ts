import { describe, expect, it } from "vitest";
import { categoryFromEntry, parseCanonicalCellId, styleFromEntry } from "./catalog-coordinates.js";

describe("catalog coordinates consumption", () => {
  it("parses a versioned canonicalCellId", () => {
    expect(parseCanonicalCellId("v1:virtual_7281_h17b-lt_elegant_cadmin_sglass_v0")).toEqual({
      version: 1,
      canonicalCellId: "v1:virtual_7281_h17b-lt_elegant_cadmin_sglass_v0",
      jsic: "7281",
      color: "h17b-lt",
      mood: "elegant",
      category: "admin",
      style: "glass",
      variant: 0,
    });
  });

  it("rejects unversioned or malformed ids", () => {
    expect(parseCanonicalCellId("virtual_7281_h17b-lt_elegant_cadmin_sglass_v0")).toBeUndefined();
    expect(parseCanonicalCellId("v1:not-a-virtual-id")).toBeUndefined();
  });

  it("prefers published coordinates over legacy heuristics", () => {
    const entry = {
      id: "7281_h17b-lt_elegant",
      canonicalCellId: "v1:virtual_7281_h17b-lt_elegant_cadmin_sglass_v0",
    };
    expect(categoryFromEntry(entry, () => "lp")).toBe("admin");
    expect(styleFromEntry(entry, () => "minimal")).toBe("glass");
  });

  it("falls back when canonicalCellId is absent", () => {
    expect(categoryFromEntry({ id: "7281_h17b-lt_elegant" }, () => "dashboard")).toBe("dashboard");
    expect(styleFromEntry({ id: "7281_h17b-lt_elegant" }, () => "glass")).toBe("glass");
    expect(categoryFromEntry({ id: "virtual_x", tags: ["portfolio", "retro"] }, () => "lp")).toBe(
      "portfolio",
    );
    expect(styleFromEntry({ id: "virtual_x", tags: ["portfolio", "retro"] }, () => "minimal")).toBe(
      "retro",
    );
  });
});
