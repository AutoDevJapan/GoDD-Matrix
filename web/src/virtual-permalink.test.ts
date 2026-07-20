import { describe, expect, it } from "vitest";
import {
  buildVirtualPermalinkId,
  parseVirtualPermalinkId,
  validateVirtualPermalinkAxes,
} from "./virtual-permalink.js";

const catalog = {
  jsic: new Set(["6061"]),
  colors: new Set(["h17b-lt"]),
  categories: new Set(["dashboard"]),
  styles: new Set(["minimal"]),
  moodForStyle: (style: string) => (style === "minimal" ? "minimal" : "unknown"),
};

describe("virtual permalink IDs", () => {
  it("round-trips every virtual axis and the full variant", () => {
    const axes = {
      jsic: "6061",
      color: "h17b-lt",
      mood: "minimal",
      category: "dashboard",
      style: "minimal",
      variant: 3971,
    } as const;

    const id = buildVirtualPermalinkId(axes);

    expect(id).toBe("virtual_6061_h17b-lt_minimal_cdashboard_sminimal_v3971");
    expect(parseVirtualPermalinkId(id)).toEqual(axes);
  });

  it.each([
    "",
    "6061_h17b-lt_minimal_cdashboard_sminimal_v1",
    "virtual_606_h17b-lt_minimal_cdashboard_sminimal_v1",
    "virtual_6061_h17b-lt_minimal_cdashboard_sminimal_v-1",
    "virtual_6061_h17b-lt_minimal_cdashboard_sminimal_v01",
    "virtual_6061_h17b-lt_minimal_cdashboard_sminimal_v1_extra",
    "virtual_6061_H17B-LT_minimal_cdashboard_sminimal_v1",
    "virtual_6061_h17b-lt_minimal_cdashboard_sminimal_v4000",
    "virtual_6061_h17b-lt_minimal_cdashboard_sminimal_v9007199254740992",
  ])("rejects malformed or unsafe ID %s", (id) => {
    expect(parseVirtualPermalinkId(id)).toBeUndefined();
  });

  it.each([
    ["jsic", "9999"],
    ["color", "unknown"],
    ["category", "unknown"],
    ["style", "unknown"],
    ["mood", "retro"],
  ] as const)("rejects a syntactically valid but unknown or inconsistent %s", (key, value) => {
    const axes = {
      jsic: "6061",
      color: "h17b-lt",
      mood: "minimal",
      category: "dashboard",
      style: "minimal",
      variant: 7,
      [key]: value,
    };

    expect(validateVirtualPermalinkAxes(axes, catalog)).toBe(false);
  });
});
