import type { DesignIndexEntry } from "../../src/ds/types.js";
import { categoryFromEntry, styleFromEntry } from "./catalog-coordinates.js";
import { type Locale, approxSwatchesForColor, extractColorTokens } from "./lib.js";

export type PreviewLayout = "single-column" | "sidebar" | "split-view" | "modular-grid";
export type PreviewDensity = "comfortable" | "compact" | "spacious";

export interface DesignPreviewSpec {
  readonly category: string;
  readonly style: string;
  readonly layout: PreviewLayout;
  readonly density: PreviewDensity;
  readonly fontFamily: string;
  readonly radius: string;
  readonly componentPattern: string;
  readonly colors: readonly {
    readonly role: string;
    readonly hex: string;
    readonly label: string;
  }[];
}

const JAPANESE_LAYOUTS: Readonly<Record<string, PreviewLayout>> = {
  単一カラム: "single-column",
  サイドバー: "sidebar",
  分割ビュー: "split-view",
  モジュラーグリッド: "modular-grid",
};

const JAPANESE_DENSITIES: Readonly<Record<string, PreviewDensity>> = {
  標準: "comfortable",
  高密度: "compact",
  ゆったり: "spacious",
};

function firstMatch(markdown: string, pattern: RegExp): string | undefined {
  return pattern.exec(markdown)?.[1]?.trim();
}

function parseLayout(markdown: string): PreviewLayout | undefined {
  const raw = firstMatch(markdown, /(?:構成|Structure):\s*([^（,(\n]+)/i);
  if (!raw) return undefined;
  if (raw in JAPANESE_LAYOUTS) return JAPANESE_LAYOUTS[raw];
  return ["single-column", "sidebar", "split-view", "modular-grid"].includes(raw)
    ? (raw as PreviewLayout)
    : undefined;
}

function parseDensity(markdown: string): PreviewDensity | undefined {
  const raw = firstMatch(markdown, /(?:バリアント|Variant):[^\n]*[/／]\s*([^）\n)]+)/i);
  if (!raw) return undefined;
  if (raw in JAPANESE_DENSITIES) return JAPANESE_DENSITIES[raw];
  return ["comfortable", "compact", "spacious"].includes(raw) ? (raw as PreviewDensity) : undefined;
}

function parseFontFamily(markdown: string): string | undefined {
  return firstMatch(markdown, /(?:書体ペア（CSS）|Font pair):\s*`?([^`\n]+)`?/i);
}

function parseRadius(markdown: string): string | undefined {
  return firstMatch(markdown, /(?:角丸トークン|Corner-radius token):\s*`?([^`\n]+)`?/i);
}

function parseComponentPattern(markdown: string): string | undefined {
  return firstMatch(markdown, /(?:コンポーネント構成|Component pattern):\s*([^\n]+)/i);
}

function previewColors(markdown: string, locale: Locale): DesignPreviewSpec["colors"] {
  const extracted = [...extractColorTokens(markdown, locale)];
  const knownRoles = new Set(extracted.map((color) => color.role));
  const genericToken = /--(?:color-)?([a-z0-9-]+)[^#\n]*(#[0-9a-fA-F]{3,6})\b/g;
  let match = genericToken.exec(markdown);
  while (match !== null) {
    const role = (match[1] ?? "").toLowerCase();
    const hex = (match[2] ?? "").toLowerCase();
    if (role && !knownRoles.has(role)) {
      knownRoles.add(role);
      extracted.push({ role, hex, label: role });
    }
    match = genericToken.exec(markdown);
  }
  return extracted;
}

/** Convert the structured parts of DESIGN.md into a safe, deterministic site-preview spec. */
export function buildDesignPreviewSpec(
  markdown: string,
  entry: DesignIndexEntry,
  locale: Locale,
): DesignPreviewSpec {
  const colors = previewColors(markdown, locale);
  return {
    category: categoryFromEntry(entry, () => entry.tags?.[0] ?? "general") || "general",
    style: styleFromEntry(entry, () => entry.tags?.[1] ?? entry.mood) || entry.mood,
    layout: parseLayout(markdown) ?? "single-column",
    density: parseDensity(markdown) ?? "comfortable",
    fontFamily: parseFontFamily(markdown) ?? "system-ui, sans-serif",
    radius: parseRadius(markdown) ?? "8px",
    componentPattern: parseComponentPattern(markdown) ?? "task-first",
    colors:
      colors.length > 0
        ? colors
        : approxSwatchesForColor(entry.color, locale).map((swatch, index) => ({
            role: `color-${index + 1}`,
            hex: swatch.hex,
            label: swatch.label || `Color ${index + 1}`,
          })),
  };
}
