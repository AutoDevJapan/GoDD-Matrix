import { describe, expect, it } from "vitest";
import { resolveDetailColorOverrides } from "./detail-color-state.ts";

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
