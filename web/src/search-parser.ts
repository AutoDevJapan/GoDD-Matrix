import type { Taxonomy } from "./lib.js";

export const SEARCH_STYLES = [
  { v: "minimal", ja: "ミニマル", en: "Minimal" },
  { v: "retro", ja: "レトロ", en: "Retro" },
  { v: "brutalist", ja: "ブルータリズム", en: "Brutalist" },
  { v: "glass", ja: "グラスモーフィズム", en: "Glassmorphism" },
  { v: "corporate", ja: "コーポレート", en: "Corporate" },
  { v: "dark", ja: "ダーク", en: "Dark" },
  { v: "neu", ja: "ニューモーフィズム", en: "Neumorphism" },
  { v: "playful", ja: "プレイフル", en: "Playful" },
] as const;

export const SEARCH_COLORS = [
  { hex: "#6366f1", name: "Indigo / インディゴ", slug: "indigo" },
  { hex: "#0ea5e9", name: "Sky / スカイ", slug: "light-blue" },
  { hex: "#10b981", name: "Emerald / エメラルド", slug: "green" },
  { hex: "#f59e0b", name: "Amber / アンバー", slug: "yellow" },
  { hex: "#f43f5e", name: "Rose / ローズ", slug: "orange" },
  { hex: "#8b5cf6", name: "Violet / バイオレット", slug: "blue" },
  { hex: "#64748b", name: "Slate / スレート", slug: "warm-gray" },
  { hex: "#0f172a", name: "Ink / インク", slug: "black" },
] as const;

type StyleKey = (typeof SEARCH_STYLES)[number]["v"];
type ColorKey = (typeof SEARCH_COLORS)[number]["slug"];

const STYLE_TAXONOMY_MAP: Readonly<Record<string, StyleKey>> = {
  vintage: "retro",
  elegant: "glass",
  tech: "dark",
  warm: "neu",
  organic: "playful",
};

const COLOR_TAXONOMY_MAP: Readonly<Record<string, ColorKey>> = {
  "h17b-lt": "indigo",
  "h12s-sf": "green",
  "gray-3": "yellow",
  "h2v-vv": "orange",
  black: "black",
};

/** Resolve a free-text style/mood term to the UI style key. */
export function findStyleValue(term: string, taxonomy?: Taxonomy): string | null {
  const normalized = term.toLowerCase().trim();
  if (!normalized) return null;

  for (const style of SEARCH_STYLES) {
    if (
      style.v === normalized ||
      style.ja.toLowerCase().includes(normalized) ||
      style.en.toLowerCase().includes(normalized)
    ) {
      return style.v;
    }
  }

  for (const [slug, item] of Object.entries(taxonomy?.moods ?? {})) {
    if (
      slug.toLowerCase() === normalized ||
      item.name_ja?.toLowerCase().includes(normalized) ||
      item.name_en?.toLowerCase().includes(normalized)
    ) {
      return STYLE_TAXONOMY_MAP[slug] ?? slug;
    }
  }
  return null;
}

/** Resolve a free-text color term to the UI palette key. */
export function findColorValue(term: string, taxonomy?: Taxonomy): string | null {
  const normalized = term.toLowerCase().trim();
  if (!normalized) return null;

  for (const color of SEARCH_COLORS) {
    if (
      color.slug === normalized ||
      color.name.toLowerCase().includes(normalized) ||
      color.slug.replace("-", "").toLowerCase().includes(normalized)
    ) {
      return color.slug;
    }
  }

  for (const [slug, item] of Object.entries(taxonomy?.colors ?? {})) {
    if (
      slug.toLowerCase() === normalized ||
      item.name_ja?.toLowerCase().includes(normalized) ||
      item.name_en?.toLowerCase().includes(normalized) ||
      item.family?.toLowerCase().includes(normalized) ||
      item.family_ja?.toLowerCase().includes(normalized) ||
      item.family_en?.toLowerCase().includes(normalized)
    ) {
      return COLOR_TAXONOMY_MAP[slug] ?? slug;
    }
  }
  return null;
}
