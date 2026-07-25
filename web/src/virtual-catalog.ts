/**
 * Versioned canonical virtual catalog (issue #71).
 *
 * Space = categories × styles × JSIC × colors × variants, ranked with a stable
 * mixed-radix bijection. Filtered counts are exact products of axis sizes — the
 * full cell space is never enumerated.
 */
import { JSIC_SUBCLASSES } from "../../src/axes/jsic-catalog.js";
import { JSIC_OVERLAY } from "../../src/axes/jsic.js";
import type { DesignIndexEntry } from "../../src/ds/types.js";
import { parseCanonicalCellId } from "./catalog-coordinates.js";
import {
  type Locale,
  VIRTUAL_COLOR_CATALOG,
  expandColorFilter,
  jsicMajor,
  jsicName,
} from "./lib.js";
import { type ResultSortOrder, virtualIndexAtRank } from "./result-sorting.js";
import { SEARCH_STYLES, resolveMoodSlug } from "./search-parser.js";
import {
  MAX_VIRTUAL_VARIANT,
  buildVirtualPermalinkId,
  parseVirtualPermalinkId,
  validateVirtualPermalinkAxes,
} from "./virtual-permalink.js";

/** Bump when axis membership or mixed-radix digit order changes. */
export const VIRTUAL_SPACE_VERSION = 1 as const;

/** Inclusive max variant; count is MAX_VIRTUAL_VARIANT + 1. */
export const VIRTUAL_VARIANT_COUNT = MAX_VIRTUAL_VARIANT + 1;

export const CANONICAL_CATEGORIES = [
  "lp",
  "dashboard",
  "mobile",
  "portfolio",
  "ecommerce",
  "admin",
  "blog",
  "form",
] as const;

export const CANONICAL_STYLES = SEARCH_STYLES.map((style) => style.v);

/** Stable color axis — representative slug per family (+ neutrals) from issue #72. */
export const CANONICAL_COLORS = [...VIRTUAL_COLOR_CATALOG];

/** Sorted JSIC fine-class codes (stable lexicographic order). */
export const CANONICAL_JSIC_CODES = Object.freeze(
  [...JSIC_SUBCLASSES].map((entry) => entry.code).sort((left, right) => left.localeCompare(right)),
);

export interface VirtualCatalogQuery {
  readonly category?: string | null;
  readonly style?: string | null;
  /** JSIC division letter (A–T), matching the sidebar industry facet. */
  readonly industry?: string | null;
  /** Color family key or concrete slug. */
  readonly colorPalette?: string | null;
  readonly industryTerms?: readonly string[];
  readonly sort: ResultSortOrder;
}

export interface FilteredVirtualAxes {
  readonly categories: readonly string[];
  readonly styles: readonly string[];
  readonly jsicCodes: readonly string[];
  readonly colors: readonly string[];
  readonly variantCount: number;
}

export interface VirtualCatalogPage {
  readonly items: readonly DesignIndexEntry[];
  readonly total: number;
  readonly page: number;
  readonly pageCount: number;
  readonly pageSize: number;
  /** 0-based rank of the first item in the filtered+sorted view. */
  readonly startRank: number;
  readonly cursor: string;
  readonly queryFingerprint: string;
}

function assertSafeProduct(factors: readonly number[]): number {
  let total = 1;
  for (const factor of factors) {
    if (!Number.isSafeInteger(factor) || factor < 0) {
      throw new RangeError("axis size must be a non-negative safe integer");
    }
    if (factor === 0) return 0;
    if (total > Number.MAX_SAFE_INTEGER / factor) {
      throw new RangeError("virtual space exceeds Number.MAX_SAFE_INTEGER");
    }
    total *= factor;
  }
  return total;
}

/** Full canonical cardinality (must stay above 100 million for issue #71). */
export function canonicalVirtualTotal(): number {
  return assertSafeProduct([
    CANONICAL_CATEGORIES.length,
    CANONICAL_STYLES.length,
    CANONICAL_JSIC_CODES.length,
    CANONICAL_COLORS.length,
    VIRTUAL_VARIANT_COUNT,
  ]);
}

function jsicMatchesIndustryTerms(code: string, terms: readonly string[]): boolean {
  if (terms.length === 0) return true;
  const name = jsicName(code) || "";
  const major = jsicMajor(code);
  const overlay = JSIC_OVERLAY[code];
  return terms.every((term) => {
    const t = term.toLowerCase();
    if (
      code.toLowerCase().includes(t) ||
      name.toLowerCase().includes(t) ||
      major.code.toLowerCase().includes(t) ||
      major.label.toLowerCase().includes(t) ||
      major.label_en?.toLowerCase().includes(t)
    ) {
      return true;
    }
    if (overlay?.aliases?.some((alias) => alias.toLowerCase().includes(t))) return true;
    if (overlay?.keywords?.some((keyword) => keyword.toLowerCase().includes(t))) return true;
    return false;
  });
}

/** Resolve the filtered axis lists for a query (no cell enumeration). */
export function resolveFilteredAxes(query: VirtualCatalogQuery): FilteredVirtualAxes {
  const categories = query.category
    ? CANONICAL_CATEGORIES.includes(query.category as (typeof CANONICAL_CATEGORIES)[number])
      ? [query.category]
      : []
    : [...CANONICAL_CATEGORIES];

  const styles = query.style
    ? (CANONICAL_STYLES as readonly string[]).includes(query.style)
      ? [query.style]
      : []
    : [...CANONICAL_STYLES];

  let jsicCodes = [...CANONICAL_JSIC_CODES];
  if (query.industry) {
    const major = query.industry;
    jsicCodes = jsicCodes.filter((code) => jsicMajor(code).code === major);
  }
  const industryTerms = query.industryTerms ?? [];
  if (industryTerms.length > 0) {
    jsicCodes = jsicCodes.filter((code) => jsicMatchesIndustryTerms(code, industryTerms));
  }

  const colorPalette = query.colorPalette;
  const colors = colorPalette
    ? expandColorFilter(colorPalette, CANONICAL_COLORS).filter((color) =>
        CANONICAL_COLORS.includes(color),
      )
    : [...CANONICAL_COLORS];

  return {
    categories,
    styles,
    jsicCodes,
    colors,
    variantCount: VIRTUAL_VARIANT_COUNT,
  };
}

/** Exact match count = product of filtered axis sizes. */
export function exactFilteredCount(query: VirtualCatalogQuery): number {
  const axes = resolveFilteredAxes(query);
  return assertSafeProduct([
    axes.categories.length,
    axes.styles.length,
    axes.jsicCodes.length,
    axes.colors.length,
    axes.variantCount,
  ]);
}

/**
 * Mixed-radix rank inside a filtered view.
 * Digit order (LSB → MSB): color, jsic, style, category, variant.
 */
export function rankInFilteredView(
  axes: {
    readonly category: string;
    readonly style: string;
    readonly jsic: string;
    readonly color: string;
    readonly variant: number;
  },
  filtered: FilteredVirtualAxes,
): number | undefined {
  const categoryIdx = filtered.categories.indexOf(axes.category);
  const styleIdx = filtered.styles.indexOf(axes.style);
  const jsicIdx = filtered.jsicCodes.indexOf(axes.jsic);
  const colorIdx = filtered.colors.indexOf(axes.color);
  if (categoryIdx < 0 || styleIdx < 0 || jsicIdx < 0 || colorIdx < 0) return undefined;
  if (
    !Number.isSafeInteger(axes.variant) ||
    axes.variant < 0 ||
    axes.variant >= filtered.variantCount
  ) {
    return undefined;
  }

  const colorLen = filtered.colors.length;
  const jsicLen = filtered.jsicCodes.length;
  const styleLen = filtered.styles.length;
  const categoryLen = filtered.categories.length;
  const base = ((categoryIdx * styleLen + styleIdx) * jsicLen + jsicIdx) * colorLen + colorIdx;
  return axes.variant * (categoryLen * styleLen * jsicLen * colorLen) + base;
}

/** Inverse of {@link rankInFilteredView}. */
export function unrankInFilteredView(
  rank: number,
  filtered: FilteredVirtualAxes,
):
  | {
      readonly category: string;
      readonly style: string;
      readonly jsic: string;
      readonly color: string;
      readonly mood: string;
      readonly variant: number;
    }
  | undefined {
  const total = assertSafeProduct([
    filtered.categories.length,
    filtered.styles.length,
    filtered.jsicCodes.length,
    filtered.colors.length,
    filtered.variantCount,
  ]);
  if (!Number.isSafeInteger(rank) || rank < 0 || rank >= total) return undefined;

  const colorLen = filtered.colors.length;
  const jsicLen = filtered.jsicCodes.length;
  const styleLen = filtered.styles.length;
  const baseCombinations = filtered.categories.length * styleLen * jsicLen * colorLen;
  const variant = Math.floor(rank / baseCombinations);
  let rem = rank % baseCombinations;

  const colorIdx = rem % colorLen;
  rem = Math.floor(rem / colorLen);
  const jsicIdx = rem % jsicLen;
  rem = Math.floor(rem / jsicLen);
  const styleIdx = rem % styleLen;
  const categoryIdx = Math.floor(rem / styleLen);

  const category = filtered.categories[categoryIdx];
  const style = filtered.styles[styleIdx];
  const jsic = filtered.jsicCodes[jsicIdx];
  const color = filtered.colors[colorIdx];
  if (!category || !style || !jsic || !color) return undefined;

  return {
    category,
    style,
    jsic,
    color,
    mood: resolveMoodSlug(style),
    variant,
  };
}

/** Build a DesignIndexEntry for a virtual cell (locally renderable). */
export function entryFromVirtualAxes(axes: {
  readonly jsic: string;
  readonly color: string;
  readonly mood: string;
  readonly category: string;
  readonly style: string;
  readonly variant: number;
}): DesignIndexEntry {
  const id = buildVirtualPermalinkId(axes);
  return {
    id,
    path: `design-md/${axes.jsic}/${axes.color}/${axes.mood}/DESIGN.md`,
    jsic: axes.jsic,
    color: axes.color,
    mood: axes.mood,
    title: `VIRTUAL DESIGN: ${jsicName(axes.jsic)} × ${axes.color} × ${axes.mood}`,
    hash: "",
    variant: axes.variant,
    createdAt: "2026-07-20",
    tags: [axes.category, axes.style, jsicMajor(axes.jsic).code],
  };
}

/** Prefer materialized path/hash for the intended catalog slot (#272). */
export function enrichWithMaterialized(
  entry: DesignIndexEntry,
  materialized: readonly DesignIndexEntry[],
): DesignIndexEntry {
  // Published canonicalCellId pins the exact virtual slot (category/style inclusive).
  const byCanonical = materialized.find((item) => {
    if (!item.hash || !item.canonicalCellId) return false;
    const coords = parseCanonicalCellId(item.canonicalCellId);
    if (!coords) return false;
    return (
      buildVirtualPermalinkId({
        jsic: coords.jsic,
        color: coords.color,
        mood: coords.mood,
        category: coords.category,
        style: coords.style,
        variant: coords.variant,
      }) === entry.id
    );
  });
  // Legacy rows without coordinates: keep jsic×color×mood overlay.
  const hit =
    byCanonical ??
    materialized.find(
      (item) =>
        Boolean(item.hash) &&
        !item.canonicalCellId &&
        item.jsic === entry.jsic &&
        item.color === entry.color &&
        item.mood === entry.mood,
    );
  if (!hit) return entry;
  return {
    ...entry,
    path: hit.path,
    hash: hit.hash,
    createdAt: hit.createdAt ?? entry.createdAt,
    ...(hit.canonicalCellId === undefined ? {} : { canonicalCellId: hit.canonicalCellId }),
  };
}

function fnv1aHex(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

/** Stable fingerprint of the query dimensions that bind a cursor. */
export function queryFingerprint(query: VirtualCatalogQuery): string {
  const normalized = {
    v: VIRTUAL_SPACE_VERSION,
    category: query.category ?? "",
    style: query.style ?? "",
    industry: query.industry ?? "",
    colorPalette: query.colorPalette ?? "",
    industryTerms: [...(query.industryTerms ?? [])].map((term) => term.toLowerCase()).sort(),
    sort: query.sort,
  };
  return fnv1aHex(JSON.stringify(normalized));
}

/** Encode a query-bound cursor: `v{version}.{fingerprint}.{rank}`. */
export function encodeCatalogCursor(fingerprint: string, rank: number): string {
  if (!Number.isSafeInteger(rank) || rank < 0) {
    throw new RangeError("cursor rank must be a non-negative safe integer");
  }
  return `v${VIRTUAL_SPACE_VERSION}.${fingerprint}.${rank}`;
}

/** Decode a cursor; returns undefined when version/fingerprint/rank are invalid. */
export function decodeCatalogCursor(
  cursor: string,
  expectedFingerprint: string,
): number | undefined {
  const match = /^v(\d+)\.([0-9a-f]{8})\.(\d+)$/.exec(cursor);
  if (!match) return undefined;
  const version = Number(match[1]);
  const fingerprint = match[2] ?? "";
  const rank = Number(match[3]);
  if (version !== VIRTUAL_SPACE_VERSION) return undefined;
  if (fingerprint !== expectedFingerprint) return undefined;
  if (!Number.isSafeInteger(rank) || rank < 0) return undefined;
  return rank;
}

/**
 * Page the filtered virtual catalog from a 0-based start rank (cursor) or page.
 * Distant ordinal jumps are just large `startRank` / `page` values — still O(pageSize).
 */
export function pageVirtualCatalog(
  query: VirtualCatalogQuery,
  options: {
    readonly pageSize: number;
    readonly page?: number;
    readonly startRank?: number;
  },
): VirtualCatalogPage {
  const pageSize = Math.max(1, Math.floor(options.pageSize));
  const filtered = resolveFilteredAxes(query);
  const total = exactFilteredCount(query);
  const pageCount = Math.max(1, Math.ceil(total / pageSize) || 1);
  const fingerprint = queryFingerprint(query);

  let startRank: number;
  if (options.startRank !== undefined) {
    startRank = Math.min(Math.max(0, Math.floor(options.startRank)), Math.max(0, total - 1));
  } else {
    const page = Math.min(Math.max(1, Math.floor(options.page ?? 1)), pageCount);
    startRank = total === 0 ? 0 : (page - 1) * pageSize;
  }

  const page = total === 0 ? 1 : Math.floor(startRank / pageSize) + 1;
  const items: DesignIndexEntry[] = [];
  if (total > 0) {
    for (
      let displayRank = startRank;
      displayRank < Math.min(startRank + pageSize, total);
      displayRank++
    ) {
      const combinationIndex = virtualIndexAtRank(displayRank, total, query.sort);
      const axes = unrankInFilteredView(combinationIndex, filtered);
      if (!axes) continue;
      items.push(entryFromVirtualAxes(axes));
    }
  }

  return {
    items,
    total,
    page,
    pageCount,
    pageSize,
    startRank,
    cursor: encodeCatalogCursor(fingerprint, startRank),
    queryFingerprint: fingerprint,
  };
}

/** Restore a virtual entry from a permalink id against the canonical catalog. */
export function restoreCanonicalVirtualEntry(id: string): DesignIndexEntry | undefined {
  const axes = parseVirtualPermalinkId(id);
  if (!axes) return undefined;
  if (
    !validateVirtualPermalinkAxes(axes, {
      jsic: new Set(CANONICAL_JSIC_CODES),
      colors: new Set(CANONICAL_COLORS),
      categories: new Set(CANONICAL_CATEGORIES),
      styles: new Set(CANONICAL_STYLES),
      moodForStyle: resolveMoodSlug,
    })
  ) {
    return undefined;
  }
  return entryFromVirtualAxes(axes);
}

/** Human-readable label helper for docs/tests. */
export function describeVirtualSpace(locale: Locale = "en"): string {
  const total = canonicalVirtualTotal();
  return locale === "ja"
    ? `仮想空間 v${VIRTUAL_SPACE_VERSION}: ${total.toLocaleString("ja-JP")} セル`
    : `Virtual space v${VIRTUAL_SPACE_VERSION}: ${total.toLocaleString("en-US")} cells`;
}
