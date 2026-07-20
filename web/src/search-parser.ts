import type { Taxonomy } from "./lib.js";

const STYLES = [
  { v: "minimal", ja: "ミニマル", en: "Minimal" },
  { v: "retro", ja: "レトロ", en: "Retro" },
  { v: "brutalist", ja: "ブルータリズム", en: "Brutalist" },
  { v: "glass", ja: "グラスモーフィズム", en: "Glassmorphism" },
  { v: "corporate", ja: "コーポレート", en: "Corporate" },
  { v: "dark", ja: "ダーク", en: "Dark" },
  { v: "neu", ja: "ニューモーフィズム", en: "Neumorphism" },
  { v: "playful", ja: "プレイフル", en: "Playful" },
] as const;

const COLORS = [
  { name: "Indigo / インディゴ", slug: "indigo" },
  { name: "Sky / スカイ", slug: "light-blue" },
  { name: "Emerald / エメラルド", slug: "green" },
  { name: "Amber / アンバー", slug: "yellow" },
  { name: "Rose / ローズ", slug: "orange" },
  { name: "Violet / バイオレット", slug: "blue" },
  { name: "Slate / スレート", slug: "warm-gray" },
  { name: "Ink / インク", slug: "black" },
] as const;

const STYLE_TAXONOMY_MAP: Readonly<Record<string, string>> = {
  vintage: "retro",
  elegant: "glass",
  tech: "dark",
  warm: "neu",
  organic: "playful",
};

const COLOR_TAXONOMY_MAP: Readonly<Record<string, string>> = {
  "h17b-lt": "indigo",
  "h12s-sf": "green",
  "gray-3": "yellow",
  "h2v-vv": "rose",
  black: "black",
};

/** Resolve a free-text style/mood term to the UI style key. */
export function findStyleValue(term: string, taxonomy?: Taxonomy): string | null {
  const normalized = term.toLowerCase().trim();
  if (!normalized) return null;

  for (const style of STYLES) {
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

  for (const color of COLORS) {
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
