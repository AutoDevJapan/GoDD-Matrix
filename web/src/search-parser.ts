import {
  COLOR_FAMILIES,
  type Taxonomy,
  colorFamily,
  expandColorFilter,
  facetLabel,
  isColorFamilyKey,
} from "./lib.js";

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

/** 旧パレット slug / 別名 → 色合い（系統）キー。 */
const PALETTE_TO_FAMILY: Readonly<Record<string, string>> = {
  indigo: "blue",
  インディゴ: "blue",
  "light-blue": "blue",
  lightblue: "blue",
  sky: "blue",
  スカイ: "blue",
  水色: "blue",
  青: "blue",
  green: "green",
  emerald: "green",
  エメラルド: "green",
  緑: "green",
  yellow: "yellow",
  amber: "yellow",
  アンバー: "yellow",
  黄: "yellow",
  orange: "orange",
  rose: "red",
  ローズ: "red",
  red: "red",
  赤: "red",
  blue: "blue",
  violet: "purple",
  バイオレット: "purple",
  purple: "purple",
  紫: "purple",
  "warm-gray": "neutral",
  slate: "neutral",
  スレート: "neutral",
  gray: "neutral",
  grey: "neutral",
  black: "neutral",
  ink: "neutral",
  インク: "neutral",
  white: "neutral",
};

type StyleKey = (typeof SEARCH_STYLES)[number]["v"];

const STYLE_TAXONOMY_MAP: Readonly<Record<string, StyleKey>> = {
  vintage: "retro",
  elegant: "glass",
  tech: "dark",
  warm: "neu",
  organic: "playful",
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

/** Resolve a free-text color term to a color-family key (色合い). */
export function findColorValue(term: string, taxonomy?: Taxonomy): string | null {
  const normalized = term.toLowerCase().trim();
  if (!normalized) return null;

  const alias = PALETTE_TO_FAMILY[normalized] ?? PALETTE_TO_FAMILY[normalized.replace(/\s+/g, "-")];
  if (alias) return alias;

  // Exact family key / label first, then substring (prefer shorter keys like green over yellowgreen).
  for (const family of COLOR_FAMILIES) {
    const ja = facetLabel("color", family.key, taxonomy, "ja").toLowerCase();
    const en = facetLabel("color", family.key, taxonomy, "en").toLowerCase();
    if (family.key === normalized || ja === normalized || en === normalized) {
      return family.key;
    }
  }
  const substringHits = COLOR_FAMILIES.filter((family) => {
    const ja = facetLabel("color", family.key, taxonomy, "ja").toLowerCase();
    const en = facetLabel("color", family.key, taxonomy, "en").toLowerCase();
    return (
      ja.includes(normalized) ||
      en.includes(normalized) ||
      normalized.includes(family.key) ||
      family.key.includes(normalized)
    );
  }).sort((a, b) => a.key.length - b.key.length);
  if (substringHits[0]) return substringHits[0].key;

  for (const [slug, item] of Object.entries(taxonomy?.colors ?? {})) {
    if (
      slug.toLowerCase() === normalized ||
      item.name_ja?.toLowerCase().includes(normalized) ||
      item.name_en?.toLowerCase().includes(normalized) ||
      item.family?.toLowerCase().includes(normalized) ||
      item.family_ja?.toLowerCase().includes(normalized) ||
      item.family_en?.toLowerCase().includes(normalized)
    ) {
      if (item.family && isColorFamilyKey(item.family)) return item.family;
      return colorFamily(slug).key;
    }
  }

  // 旧パレット表示名の部分一致（Indigo / スカイ など）
  for (const [key, family] of Object.entries(PALETTE_TO_FAMILY)) {
    if (normalized.includes(key) || key.includes(normalized)) return family;
  }

  return null;
}

const STYLE_TO_MOOD: Readonly<Record<StyleKey, string>> = {
  minimal: "minimal",
  retro: "vintage",
  brutalist: "brutalist",
  glass: "elegant",
  corporate: "corporate",
  dark: "tech",
  neu: "warm",
  playful: "organic",
};

/** Convert a UI style key or dynamically matched taxonomy slug into a downstream mood slug. */
export function resolveMoodSlug(style: string): string {
  return STYLE_TO_MOOD[style as StyleKey] ?? style;
}

/**
 * 色合いキー（または具体 slug）を仮想/材化カタログの具体色 slug 群へ展開する。
 * 系統フィルタで 0 件やグレー偏りにならないことが契約。
 */
export function resolveColorSlugs(color: string, taxonomy?: Taxonomy): string[] {
  const family = PALETTE_TO_FAMILY[color] ?? (isColorFamilyKey(color) ? color : null);
  if (family) return expandColorFilter(family, undefined, taxonomy);
  return expandColorFilter(color, undefined, taxonomy);
}
