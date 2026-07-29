import { describe, expect, it } from "vitest";
import type { DesignIndexEntry } from "../../src/ds/types.js";
import { buildDesignPreviewSpec, previewTextColor } from "./design-preview.js";

const entry: DesignIndexEntry = {
  id: "virtual_6061_h17b-lt_minimal_cdashboard_sswiss_v2",
  path: "design-md/6061/h17b-lt/minimal/DESIGN.md",
  jsic: "6061",
  color: "h17b-lt",
  mood: "minimal",
  title: "Example",
  hash: "",
  variant: 2,
  tags: ["dashboard", "swiss", "saas"],
  createdAt: "2026-07-20",
};

describe("buildDesignPreviewSpec", () => {
  it("uses structured Japanese DESIGN.md values instead of a fixed mock", () => {
    const spec = buildDesignPreviewSpec(
      [
        "- バリアント: 2（モジュラーグリッド / 高密度）",
        "- 書体ペア（CSS）: `ui-monospace, system-ui`",
        "- 構成: モジュラーグリッド（主要タスクを最短導線に置く）",
        "- 角丸トークン: `0px`",
        "- コンポーネント構成: 情報高密度",
        "- `--primary`: `#2563eb`",
        "- `--background`: `#f8fafc`",
      ].join("\n"),
      entry,
      "ja",
    );

    expect(spec).toMatchObject({
      category: "dashboard",
      style: "swiss",
      layout: "modular-grid",
      density: "compact",
      fontFamily: "ui-monospace, system-ui",
      radius: "0px",
      componentPattern: "情報高密度",
    });
    expect(spec.colors.map((color) => color.hex)).toContain("#2563eb");
  });

  it("parses English layout and falls back safely when a field is missing", () => {
    const spec = buildDesignPreviewSpec(
      [
        "- Variant: 2 (sidebar / spacious)",
        "- Font pair: `ui-serif, system-ui`",
        "- Structure: sidebar, placing the primary task first",
        "- Corner-radius token: `12px`",
      ].join("\n"),
      entry,
      "en",
    );

    expect(spec.layout).toBe("sidebar");
    expect(spec.density).toBe("spacious");
    expect(spec.fontFamily).toBe("ui-serif, system-ui");
    expect(spec.radius).toBe("12px");
    expect(spec.componentPattern).toBe("task-first");
  });
});

describe("previewTextColor", () => {
  it("rejects a white foreground token on a near-white preview surface", () => {
    expect(previewTextColor("#f8fafc", "#ffffff")).toBe("#18202a");
  });

  it("keeps white text for a dark preview surface", () => {
    expect(previewTextColor("#10131a", "#ffffff")).toBe("#ffffff");
  });
});
