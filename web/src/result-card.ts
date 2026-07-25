import type { DesignIndexEntry } from "../../src/ds/types.js";
import { FILTER_CATEGORIES } from "./filter-taxonomy.js";
import {
  type Locale,
  type Taxonomy,
  colorFamily,
  facetLabel,
  jsicMajor,
  jsicName,
  labelForColor,
  labelForMood,
} from "./lib.js";
import { SEARCH_STYLES } from "./search-parser.js";

export interface ResultTag {
  readonly kind: "industry" | "color" | "mood" | "category" | "style" | "variant";
  readonly label: string;
}

const CATEGORY_LABELS: Readonly<Record<string, { ja: string; en: string }>> = Object.fromEntries(
  FILTER_CATEGORIES.map((item) => [item.v, { ja: item.ja, en: item.en }]),
);

const STYLE_LABELS: Readonly<Record<string, { ja: string; en: string }>> = Object.fromEntries(
  SEARCH_STYLES.map((style) => [style.v, { ja: style.ja, en: style.en }]),
);

function categoryOf(entry: DesignIndexEntry): string | undefined {
  return entry.tags?.[0];
}

function styleOf(entry: DesignIndexEntry): string | undefined {
  return entry.tags?.[1];
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

/**
 * カードタイトルは「方向性」を示す短文。軸の羅列はタグ側へ寄せる。
 */
export function buildDirectionTitle(
  entry: DesignIndexEntry,
  locale: Locale,
  taxonomy?: Taxonomy,
): string {
  const mood = labelForMood(entry.mood, taxonomy, locale);
  const family = facetLabel("color", colorFamily(entry.color).key, taxonomy, locale);
  const category = localizeMap(CATEGORY_LABELS, categoryOf(entry), locale);
  const style = localizeMap(STYLE_LABELS, styleOf(entry), locale);
  const surface = category ?? style;

  if (locale === "en") {
    const bits = [mood, family, surface].filter(Boolean);
    return bits.join(" · ");
  }

  if (surface) return `${mood}な${family}の${surface}`;
  return `${mood} × ${family}`;
}

/** タイトル下に出す差分タグ（業種・色・ムード・カテゴリ等）。 */
export function buildEntryTags(
  entry: DesignIndexEntry,
  locale: Locale,
  taxonomy?: Taxonomy,
): ResultTag[] {
  const tags: ResultTag[] = [];
  const major = jsicMajor(entry.jsic);
  const industry =
    locale === "en" ? (major.label_en ?? major.label) : jsicName(entry.jsic) || major.label;
  tags.push({ kind: "industry", label: industry });

  tags.push({
    kind: "color",
    label: labelForColor(entry.color, taxonomy, locale),
  });
  tags.push({
    kind: "mood",
    label: labelForMood(entry.mood, taxonomy, locale),
  });

  const category = localizeMap(CATEGORY_LABELS, categoryOf(entry), locale);
  if (category) tags.push({ kind: "category", label: category });

  const style = localizeMap(STYLE_LABELS, styleOf(entry), locale);
  if (style) tags.push({ kind: "style", label: style });

  const variant = entry.variant ?? 0;
  if (variant > 0) {
    tags.push({
      kind: "variant",
      label: locale === "ja" ? `バリエーション ${variant}` : `Variant ${variant}`,
    });
  }

  return tags;
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
