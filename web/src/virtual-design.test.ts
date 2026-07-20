import { describe, expect, it } from "vitest";
import type { DesignIndexEntry } from "../../src/ds/types.js";
import { buildVirtualDesign } from "./virtual-design.js";

const entry: DesignIndexEntry = {
  id: "virtual_6061_h17b-lt_minimal",
  path: "design-md/6061/h17b-lt/minimal/DESIGN.md",
  jsic: "6061",
  color: "h17b-lt",
  mood: "minimal",
  tags: ["dashboard", "minimal"],
  hash: "",
};

describe("buildVirtualDesign", () => {
  it("builds a deterministic Japanese specification with core design sections", () => {
    const labels = {
      title: "仮想デザイン",
      industry: "ソフトウェア業",
      color: "明るい青",
      mood: "ミニマル",
      swatches: ["#112233", "#ffffff"],
    };

    const first = buildVirtualDesign(entry, "ja", labels);
    expect(buildVirtualDesign(entry, "ja", labels)).toBe(first);
    expect(first).toContain("## カラートークン");
    expect(first).toContain("## タイポグラフィ");
    expect(first).toContain("## レスポンシブとアクセシビリティ");
    expect(first).not.toContain("## Design direction");
  });

  it("keeps an English specification free of Japanese industry text", () => {
    const result = buildVirtualDesign(entry, "en", {
      title: "Virtual design",
      industry: "Information services",
      color: "Light blue",
      mood: "Minimal",
      swatches: ["#112233"],
    });

    expect(result).toContain("Industry: Information services");
    expect(result).toContain("## Responsive behavior and accessibility");
    expect(result).not.toContain("ソフトウェア業");
  });

  it("renders a stable fallback when tags are missing", () => {
    const result = buildVirtualDesign({ ...entry, tags: undefined }, "en", {
      title: "Virtual design",
      industry: "Information services",
      color: "Blue",
      mood: "Minimal",
      swatches: [],
    });
    expect(result).toContain("- Tags: —");
    expect(result).toContain("- No color tokens available");
  });

  it("varies deterministic design decisions by cell variant", () => {
    const labels = {
      title: "Virtual design",
      industry: "Information services",
      color: "Blue",
      mood: "Minimal",
      swatches: ["#112233"],
    };

    expect(buildVirtualDesign({ ...entry, variant: 1 }, "en", labels)).not.toBe(
      buildVirtualDesign({ ...entry, variant: 2 }, "en", labels),
    );
  });
});
