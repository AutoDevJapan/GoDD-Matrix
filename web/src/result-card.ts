import type { DesignIndexEntry } from "../../src/ds/types.js";
import { categoryFromEntry, styleFromEntry } from "./catalog-coordinates.js";
import { FILTER_CATEGORIES } from "./filter-taxonomy.js";
import {
  type Locale,
  type Taxonomy,
  approxSwatchesForColor,
  colorFamily,
  facetLabel,
  familySwatchHex,
  jsicMajor,
  labelForMood,
} from "./lib.js";
import { SEARCH_STYLES } from "./search-parser.js";

export interface ResultTag {
  readonly kind: "industry" | "color" | "mood" | "category" | "style" | "variant";
  readonly label: string;
}

/** カード上の色識別キュー（タイトル/業種タグとは分離。#90 密度を維持しつつ色差を区別）。 */
export interface CardColorCue {
  readonly familyKey: string;
  readonly label: string;
  readonly swatchHex: string;
}

const CATEGORY_LABELS: Readonly<Record<string, { ja: string; en: string }>> = Object.fromEntries(
  FILTER_CATEGORIES.map((item) => [item.v, { ja: item.ja, en: item.en }]),
);

const STYLE_LABELS: Readonly<Record<string, { ja: string; en: string }>> = Object.fromEntries(
  SEARCH_STYLES.map((style) => [style.v, { ja: style.ja, en: style.en }]),
);

// A mood is an implementation detail used by the prompt generator. It is not
// the style the user selected, so it must not replace that style in card titles.
const STYLE_TITLE_FORMS: Readonly<Record<string, { jaSuffix: "な" | "系" | "の"; en: string }>> = {
  minimal: { jaSuffix: "な", en: "Minimal" },
  corporate: { jaSuffix: "な", en: "Corporate" },
  editorial: { jaSuffix: "な", en: "Editorial" },
  brutalist: { jaSuffix: "系", en: "Brutalist" },
  glass: { jaSuffix: "系", en: "Glassmorphism" },
  soft: { jaSuffix: "の", en: "Soft UI" },
  dark: { jaSuffix: "な", en: "Dark" },
  playful: { jaSuffix: "な", en: "Playful" },
  luxury: { jaSuffix: "な", en: "Luxury" },
  retro: { jaSuffix: "な", en: "Retro" },
  industrial: { jaSuffix: "系", en: "Industrial" },
  flat: { jaSuffix: "な", en: "Flat" },
  swiss: { jaSuffix: "の", en: "Swiss" },
  organic: { jaSuffix: "な", en: "Organic" },
  tech: { jaSuffix: "系", en: "Tech" },
  warm: { jaSuffix: "な", en: "Warm" },
};

function categoryOf(entry: DesignIndexEntry): string | undefined {
  return categoryFromEntry(entry, () => entry.tags?.[0] ?? "") || undefined;
}

function styleOf(entry: DesignIndexEntry): string | undefined {
  return styleFromEntry(entry, () => entry.tags?.[1] ?? "") || undefined;
}

function localizeMap(
  map: Readonly<Record<string, { ja: string; en: string }>>,
  key: string | undefined,
  locale: Locale,
): string | undefined {
  if (!key) return undefined;
  const hit = map[key];
  if (!hit) return key;
  return locale === "ja" ? hit.ja : hit.en;
}

function styleTitle(entry: DesignIndexEntry, locale: Locale, taxonomy?: Taxonomy): string {
  const selectedStyle = styleOf(entry);
  const form = selectedStyle ? STYLE_TITLE_FORMS[selectedStyle] : undefined;
  if (form) {
    return locale === "ja"
      ? `${localizeMap(STYLE_LABELS, selectedStyle, locale) ?? selectedStyle}${form.jaSuffix}`
      : form.en;
  }
  return labelForMood(entry.mood, taxonomy, locale);
}

function dedupeTagsByLabel(tags: readonly ResultTag[]): ResultTag[] {
  const seen = new Set<string>();
  const out: ResultTag[] = [];
  for (const tag of tags) {
    const key = tag.label.trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(tag);
  }
  return out;
}

/**
 * カードタイトルは方向性のみ。色は詳細で変更できるためタイトルにも載せない。
 */
export function buildDirectionTitle(
  entry: DesignIndexEntry,
  locale: Locale,
  taxonomy?: Taxonomy,
): string {
  const direction = styleTitle(entry, locale, taxonomy);
  const category = localizeMap(CATEGORY_LABELS, categoryOf(entry), locale);

  if (locale === "en") {
    const bits = [direction, category].filter(Boolean);
    return bits.join(" · ");
  }

  if (category) return `${direction}${category}`;
  return direction;
}

/**
 * カード下のタグは業種（＋必要なら variant）のみ。
 * 色・ムード・カテゴリ/スタイルはタイトルと重複しやすいので出さない。
 * 色の識別は {@link buildCardColorCue} 側へ寄せる。
 */
export function buildEntryTags(
  entry: DesignIndexEntry,
  locale: Locale,
  _taxonomy?: Taxonomy,
): ResultTag[] {
  const tags: ResultTag[] = [];
  const major = jsicMajor(entry.jsic);
  // Browse tags match facet/detail badges: major division for both locales.
  const industry = locale === "en" ? (major.label_en ?? major.label) : major.label;
  if (industry) tags.push({ kind: "industry", label: industry });

  const variant = entry.variant ?? 0;
  if (variant > 0) {
    tags.push({
      kind: "variant",
      label: locale === "ja" ? `バリエーション ${variant}` : `Variant ${variant}`,
    });
  }

  return dedupeTagsByLabel(tags);
}

/**
 * 人気順などで色軸だけが違うカードを区別するための短い色キュー。
 * variant=0 でも必ず返す（Variant タグが無い場合の識別子）。
 */
export function buildCardColorCue(
  entry: DesignIndexEntry,
  locale: Locale,
  taxonomy?: Taxonomy,
): CardColorCue {
  const family = colorFamily(entry.color);
  const label = facetLabel("color", family.key, taxonomy, locale);
  // Prefer family representative. approxSwatches[0] is surface (L≈95) and reads as white.
  const swatchHex =
    familySwatchHex(family.key) ??
    approxSwatchesForColor(entry.color, locale).find((s) => s.role === "primary")?.hex ??
    "#94a3b8";
  return { familyKey: family.key, label, swatchHex };
}

/** 同一ページ内の id 重複を除去（先頭優先・順序維持）。 */
export function dedupeEntriesById(entries: readonly DesignIndexEntry[]): DesignIndexEntry[] {
  const seen = new Set<string>();
  const out: DesignIndexEntry[] = [];
  for (const entry of entries) {
    if (seen.has(entry.id)) continue;
    seen.add(entry.id);
    out.push(entry);
  }
  return out;
}

export const PAGE_SIZE_OPTIONS = [10, 25, 50, 100, 250, 500, 1000] as const;
export type PageSizeOption = (typeof PAGE_SIZE_OPTIONS)[number];

export function clampPageSize(value: number): PageSizeOption {
  const n = Math.floor(value);
  if (PAGE_SIZE_OPTIONS.includes(n as PageSizeOption)) return n as PageSizeOption;
  let best: PageSizeOption = 25;
  let bestDist = Number.POSITIVE_INFINITY;
  for (const option of PAGE_SIZE_OPTIONS) {
    const dist = Math.abs(option - n);
    if (dist < bestDist) {
      best = option;
      bestDist = dist;
    }
  }
  return best;
}
