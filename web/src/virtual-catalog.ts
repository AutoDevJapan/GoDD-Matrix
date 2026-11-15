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
import { categoryFromEntry, parseCanonicalCellId, styleFromEntry } from "./catalog-coordinates.js";
import { FILTER_CATEGORIES, INDUSTRY_VERTICALS } from "./filter-taxonomy.js";
import {
  type Locale,
  VIRTUAL_COLOR_CATALOG,
  colorFamily,
  expandColorFilter,
  isColorFamilyKey,
  jsicMajor,
  jsicName,
} from "./lib.js";
import { type ResultSortOrder, sortDesignEntries, virtualIndexAtRank } from "./result-sorting.js";
import { SEARCH_STYLES, resolveMoodSlug } from "./search-parser.js";
import {
  MAX_VIRTUAL_VARIANT,
  buildVirtualPermalinkId,
  parseVirtualPermalinkId,
  validateVirtualPermalinkAxes,
} from "./virtual-permalink.js";

/** Bump when axis membership or mixed-radix digit order changes. */
export const VIRTUAL_SPACE_VERSION = 3 as const;

/** Inclusive max variant; count is MAX_VIRTUAL_VARIANT + 1. */
export const VIRTUAL_VARIANT_COUNT = MAX_VIRTUAL_VARIANT + 1;

export const CANONICAL_CATEGORIES = FILTER_CATEGORIES.map((item) => item.v);

export const CANONICAL_STYLES = SEARCH_STYLES.map((style) => style.v);

/** Stable color axis — representative slug per family (+ neutrals) from issue #72. */
export const CANONICAL_COLORS = [...VIRTUAL_COLOR_CATALOG];

/** Sorted JSIC fine-class codes (stable lexicographic order). */
export const CANONICAL_JSIC_CODES = Object.freeze(
  [...JSIC_SUBCLASSES].map((entry) => entry.code).sort((left, right) => left.localeCompare(right)),
);

export interface VirtualCatalogQuery {
  /** Multi-select surface categories (empty / omitted = all). */
  readonly categories?: readonly string[];
  /** Multi-select visual styles. */
  readonly styles?: readonly string[];
  /** JSIC division letters (A–T). */
  readonly industries?: readonly string[];
  /** Curated job vertical keys from filter-taxonomy. */
  readonly verticals?: readonly string[];
  /** Color family keys or concrete slugs (OR). */
  readonly colors?: readonly string[];
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

/** Full canonical cardinality (must stay far above 100 million for issues #71 / #92). */
export function canonicalVirtualTotal(): number {
  return assertSafeProduct([
    CANONICAL_CATEGORIES.length,
    CANONICAL_STYLES.length,
    CANONICAL_JSIC_CODES.length,
    CANONICAL_COLORS.length,
    VIRTUAL_VARIANT_COUNT,
  ]);
}

function jsicMatchesTerm(code: string, term: string): boolean {
  const t = term.toLowerCase();
  const name = jsicName(code) || "";
  const major = jsicMajor(code);
  const overlay = JSIC_OVERLAY[code];
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
}

/** Free-text industry tokens: every term must match (AND). */
function jsicMatchesIndustryTerms(code: string, terms: readonly string[]): boolean {
  if (terms.length === 0) return true;
  return terms.every((term) => jsicMatchesTerm(code, term));
}

function pickKnown(selected: readonly string[] | undefined, known: readonly string[]): string[] {
  if (!selected || selected.length === 0) return [...known];
  const knownSet = new Set(known);
  return selected.filter((value) => knownSet.has(value));
}

function expandColorSelections(selected: readonly string[] | undefined): string[] {
  if (!selected || selected.length === 0) return [...CANONICAL_COLORS];
  const out = new Set<string>();
  for (const value of selected) {
    for (const color of expandColorFilter(value, CANONICAL_COLORS)) {
      if (CANONICAL_COLORS.includes(color)) out.add(color);
    }
  }
  return [...out];
}

function resolveJsicCodes(query: VirtualCatalogQuery): string[] {
  const majors = query.industries ?? [];
  const verticals = query.verticals ?? [];
  let jsicCodes = [...CANONICAL_JSIC_CODES];

  if (majors.length > 0 || verticals.length > 0) {
    // Vertical chips bind to curated JSIC codes only (keywords stay for free-text search).
    const verticalCodeSet = new Set<string>();
    for (const key of verticals) {
      const vertical = INDUSTRY_VERTICALS.find((item) => item.v === key);
      if (!vertical) continue;
      for (const code of vertical.codes) verticalCodeSet.add(code);
    }
    jsicCodes = jsicCodes.filter((code) => {
      if (majors.includes(jsicMajor(code).code)) return true;
      if (verticalCodeSet.has(code)) return true;
      return false;
    });
  }

  const industryTerms = query.industryTerms ?? [];
  if (industryTerms.length > 0) {
    jsicCodes = jsicCodes.filter((code) => jsicMatchesIndustryTerms(code, industryTerms));
  }
  return jsicCodes;
}

/** Resolve the filtered axis lists for a query (no cell enumeration). */
export function resolveFilteredAxes(query: VirtualCatalogQuery): FilteredVirtualAxes {
  return {
    categories: pickKnown(query.categories, CANONICAL_CATEGORIES),
    styles: pickKnown(query.styles, CANONICAL_STYLES),
    jsicCodes: resolveJsicCodes(query),
    colors: expandColorSelections(query.colors),
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
    // Keep the user-selected style in metadata; mood is only the prompt-engine
    // axis and may intentionally map several styles to one mood.
    title: `${jsicName(axes.jsic) || axes.jsic} × ${axes.color} × ${axes.style}`,
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
  if (entry.hash) return entry;
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
    categories: [...(query.categories ?? [])].sort(),
    styles: [...(query.styles ?? [])].sort(),
    industries: [...(query.industries ?? [])].sort(),
    verticals: [...(query.verticals ?? [])].sort(),
    colors: [...(query.colors ?? [])].sort(),
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

/** Same legacy coordinates used by result cards, with published coordinates taking precedence. */
export function catalogCategory(entry: DesignIndexEntry): string {
  return categoryFromEntry(entry, () => {
    const index = (entry.id || "").charCodeAt(0) % FILTER_CATEGORIES.length;
    return FILTER_CATEGORIES[index]?.v || "";
  });
}

export function catalogStyle(entry: DesignIndexEntry): string {
  return styleFromEntry(entry, () => {
    const styles: Readonly<Record<string, string>> = {
      minimal: "minimal",
      elegant: "glass",
      bold: "brutalist",
      brutalist: "brutalist",
      tech: "tech",
      organic: "organic",
      warm: "warm",
      vintage: "retro",
      corporate: "corporate",
    };
    return styles[entry.mood] ?? "minimal";
  });
}

interface CatalogView {
  readonly entries: readonly DesignIndexEntry[];
  readonly filtered: FilteredVirtualAxes;
  readonly virtualTotal: number;
  readonly excludedRanks: readonly number[];
  readonly total: number;
  readonly fingerprint: string;
}
interface MaterializedCatalog {
  readonly entries: readonly DesignIndexEntry[];
  readonly fingerprint: string;
  readonly views: Map<string, CatalogView>;
}
// Callers replace this readonly array when a new index arrives; views never mutate index rows.
const materializedCatalogs = new WeakMap<readonly DesignIndexEntry[], MaterializedCatalog>();

function materializedCatalog(entries: readonly DesignIndexEntry[]): MaterializedCatalog {
  const cached = materializedCatalogs.get(entries);
  if (cached) return cached;
  const unique = new Map<string, DesignIndexEntry>();
  for (const entry of entries) {
    if (entry.hash && !unique.has(entry.id)) unique.set(entry.id, entry);
  }
  const result = {
    entries: [...unique.values()],
    fingerprint: fnv1aHex(JSON.stringify(entries)),
    views: new Map<string, CatalogView>(),
  };
  materializedCatalogs.set(entries, result);
  return result;
}

function matchesColorSelection(color: string, selected: readonly string[] | undefined): boolean {
  return (
    !selected?.length ||
    selected.some(
      (value) => value === color || (isColorFamilyKey(value) && colorFamily(color).key === value),
    )
  );
}

function catalogView(query: VirtualCatalogQuery, source: MaterializedCatalog): CatalogView {
  const key = JSON.stringify(query);
  const cached = source.views.get(key);
  if (cached) return cached;
  const filtered: FilteredVirtualAxes = {
    ...resolveFilteredAxes(query),
    // A concrete materialized color outside the fixed virtual axis has no virtual counterpart.
    colors: CANONICAL_COLORS.filter((color) => matchesColorSelection(color, query.colors)),
  };
  const categories = new Set(pickKnown(query.categories, CANONICAL_CATEGORIES));
  const styles = new Set(pickKnown(query.styles, CANONICAL_STYLES));
  const jsic = new Set(filtered.jsicCodes);
  const restrictJsic = Boolean(
    query.industries?.length || query.verticals?.length || query.industryTerms?.length,
  );
  const entries = sortDesignEntries(
    source.entries.filter(
      (entry) =>
        (!query.categories?.length || categories.has(catalogCategory(entry))) &&
        (!query.styles?.length || styles.has(catalogStyle(entry))) &&
        (!restrictJsic || jsic.has(entry.jsic)) &&
        matchesColorSelection(entry.color, query.colors),
    ),
    query.sort,
  );
  const virtualTotal = assertSafeProduct([
    filtered.categories.length,
    filtered.styles.length,
    filtered.jsicCodes.length,
    filtered.colors.length,
    filtered.variantCount,
  ]);
  const excluded = new Set<number>();
  for (const entry of entries) {
    const coords = entry.canonicalCellId
      ? parseCanonicalCellId(entry.canonicalCellId)
      : parseVirtualPermalinkId(entry.id);
    // Rank ignores mood: only an identical emitted permalink can replace a virtual cell.
    if (
      !coords ||
      coords.jsic !== entry.jsic ||
      coords.color !== entry.color ||
      coords.mood !== entry.mood ||
      coords.variant !== (entry.variant ?? 0) ||
      coords.mood !== resolveMoodSlug(coords.style)
    )
      continue;
    const rank = rankInFilteredView(coords, filtered);
    if (rank !== undefined) excluded.add(virtualIndexAtRank(rank, virtualTotal, query.sort));
  }
  const excludedRanks = [...excluded].sort((a, b) => a - b);
  const total = entries.length + virtualTotal - excludedRanks.length;
  if (!Number.isSafeInteger(total)) throw new RangeError("catalog exceeds safe integer range");
  const result: CatalogView = {
    entries,
    filtered,
    virtualTotal,
    excludedRanks,
    total,
    fingerprint: fnv1aHex(`materialized-v1:${queryFingerprint(query)}:${source.fingerprint}`),
  };
  // Bound retained filter views while keeping distant page reads O(page size * log(materialized)).
  if (source.views.size >= 32) {
    const oldest = source.views.keys().next().value;
    if (oldest !== undefined) source.views.delete(oldest);
  }
  source.views.set(key, result);
  return result;
}

function excludedThrough(ranks: readonly number[], rank: number): number {
  let low = 0;
  let high = ranks.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if ((ranks[middle] ?? Number.POSITIVE_INFINITY) <= rank) low = middle + 1;
    else high = middle;
  }
  return low;
}

function remainingVirtualRank(rank: number, excluded: readonly number[]): number {
  let low = rank;
  let high = rank + excluded.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (middle + 1 - excludedThrough(excluded, middle) > rank) high = middle;
    else low = middle + 1;
  }
  return low;
}

/**
 * Materialized rows first, followed by the unchanged virtual space minus exact duplicate cells.
 * This is a union, not a larger color-axis Cartesian product.
 * Each input row keeps its ID/path/hash.
 */
export function pageCatalog(
  query: VirtualCatalogQuery,
  materialized: readonly DesignIndexEntry[],
  options: { readonly pageSize: number; readonly page?: number; readonly startRank?: number },
): VirtualCatalogPage {
  const view = catalogView(query, materializedCatalog(materialized));
  const pageSize = Math.max(1, Math.floor(options.pageSize));
  if (!Number.isSafeInteger(pageSize)) throw new RangeError("invalid catalog page size");
  const pageCount = Math.max(1, Math.ceil(view.total / pageSize));
  const requested =
    options.startRank === undefined
      ? (Math.min(Math.max(1, Math.floor(options.page ?? 1)), pageCount) - 1) * pageSize
      : Math.floor(options.startRank);
  if (!Number.isSafeInteger(requested)) throw new RangeError("invalid catalog rank");
  const startRank = Math.min(Math.max(0, requested), Math.max(0, view.total - 1));
  const items: DesignIndexEntry[] = [];
  for (let rank = startRank; rank < Math.min(startRank + pageSize, view.total); rank++) {
    if (rank < view.entries.length) {
      const entry = view.entries[rank];
      if (entry) items.push(entry);
      continue;
    }
    const displayRank = remainingVirtualRank(rank - view.entries.length, view.excludedRanks);
    const axes = unrankInFilteredView(
      virtualIndexAtRank(displayRank, view.virtualTotal, query.sort),
      view.filtered,
    );
    if (!axes) throw new Error("catalog rank has no virtual cell");
    items.push(entryFromVirtualAxes(axes));
  }
  return {
    items,
    total: view.total,
    page: view.total ? Math.floor(startRank / pageSize) + 1 : 1,
    pageCount,
    pageSize,
    startRank,
    cursor: encodeCatalogCursor(view.fingerprint, startRank),
    queryFingerprint: view.fingerprint,
  };
}
