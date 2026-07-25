import { describe, expect, it } from "vitest";
import { editableSwatchesFromTokens, resolveDetailColorOverrides } from "./detail-color-state.ts";
import { extractColorTokens } from "./lib.ts";

describe("resolveDetailColorOverrides", () => {
  const base = ["#f6efef", "#d51a1a"];

  it("resets to base swatches by default", () => {
    expect(resolveDetailColorOverrides(base, ["#3b82f6", "#22c55e"])).toEqual(base);
  });

  it("keeps current overrides when preserveColors is set", () => {
    const current = ["#3b82f6", "#22c55e"];
    expect(resolveDetailColorOverrides(base, current, true)).toEqual(current);
  });

  it("resets when override length mismatches even if preserveColors is set", () => {
    expect(resolveDetailColorOverrides(base, ["#3b82f6"], true)).toEqual(base);
  });
});

describe("editableSwatchesFromTokens", () => {
  const fallback = ["#cccccc", "#8a8a8a"];

  it("returns fallback when no tokens are present", () => {
    expect(editableSwatchesFromTokens([], fallback)).toEqual(fallback);
  });

  it("prefers primary and accent roles from a color-system table", () => {
    expect(
      editableSwatchesFromTokens(
        [
          { role: "primary", hex: "#c72323" },
          { role: "secondary", hex: "#171717" },
          { role: "accent", hex: "#fafafa" },
          { role: "bg", hex: "#ffffff" },
        ],
        fallback,
      ),
    ).toEqual(["#c72323", "#fafafa"]);
  });

  it("falls back to secondary when accent is missing", () => {
    expect(
      editableSwatchesFromTokens(
        [
          { role: "primary", hex: "#c72323" },
          { role: "secondary", hex: "#171717" },
        ],
        fallback,
      ),
    ).toEqual(["#c72323", "#171717"]);
  });

  it("uses first two tokens when roles are numeric (virtual DESIGN.md)", () => {
    expect(
      editableSwatchesFromTokens(
        [
          { role: "1", hex: "#f6efef" },
          { role: "2", hex: "#d51a1a" },
        ],
        fallback,
      ),
    ).toEqual(["#f6efef", "#d51a1a"]);
  });

  it("materialized token hexes become replace keys (approx would no-op)", () => {
    const markdown = [
      "| Primary | `--color-primary` | `#C72323` |",
      "| Accent | `--color-accent` | `#171717` |",
      "| Background | `--color-bg` | `#FAFAFA` |",
    ].join("\n");
    const base = editableSwatchesFromTokens(extractColorTokens(markdown), fallback);
    expect(base).toEqual(["#c72323", "#171717"]);
    expect(fallback.every((hex) => !markdown.toLowerCase().includes(hex))).toBe(true);

    let next = markdown;
    for (let i = 0; i < base.length; i++) {
      const from = base[i];
      const to = ["#22c55e", "#0f172a"][i];
      if (!from || !to) continue;
      next = next.replace(new RegExp(from.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi"), to);
    }
    expect(next).toContain("#22c55e");
    expect(next).toContain("#0f172a");
    expect(next).not.toMatch(/#c72323/i);
  });
});
