import { DS_TAXONOMY_URL, EMPTY_TAXONOMY, type Taxonomy, parseTaxonomy } from "./lib.js";

export const TAXONOMY_CACHE_KEY = "godd_taxonomy_cache";
export const TAXONOMY_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

interface TaxonomyCacheEntry {
  readonly timestamp: number;
  readonly data: unknown;
}

interface TaxonomyStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface LoadTaxonomyOptions {
  readonly storage?: TaxonomyStorage;
  readonly fetcher?: typeof fetch;
  readonly now?: () => number;
}

function parseCacheEntry(value: string): TaxonomyCacheEntry | undefined {
  try {
    const parsed: unknown = JSON.parse(value);
    if (typeof parsed !== "object" || parsed === null) return undefined;

    const entry = parsed as Record<string, unknown>;
    if (typeof entry.timestamp !== "number" || !Number.isFinite(entry.timestamp)) {
      return undefined;
    }
    if (typeof entry.data !== "object" || entry.data === null || Array.isArray(entry.data)) {
      return undefined;
    }
    return { timestamp: entry.timestamp, data: entry.data };
  } catch {
    return undefined;
  }
}

/** Load taxonomy data, reusing a successful response for up to 24 hours. */
export async function loadTaxonomy(options: LoadTaxonomyOptions = {}): Promise<Taxonomy> {
  const storage = options.storage ?? localStorage;
  const fetcher = options.fetcher ?? fetch;
  const now = options.now ?? Date.now;
  const timestamp = now();
  let staleTaxonomy: Taxonomy | undefined;

  try {
    const cached = storage.getItem(TAXONOMY_CACHE_KEY);
    if (cached !== null) {
      const entry = parseCacheEntry(cached);
      const age = entry ? timestamp - entry.timestamp : Number.POSITIVE_INFINITY;
      if (entry && age >= 0 && age < TAXONOMY_CACHE_TTL_MS) {
        return parseTaxonomy(entry.data);
      }
      if (entry && age >= TAXONOMY_CACHE_TTL_MS) {
        staleTaxonomy = parseTaxonomy(entry.data);
      }
    }
  } catch {
    // Storage may be disabled; continue with a network request.
  }

  try {
    const response = await fetcher(DS_TAXONOMY_URL, { cache: "no-cache" });
    if (!response.ok) return staleTaxonomy ?? EMPTY_TAXONOMY;

    const data: unknown = await response.json();
    try {
      storage.setItem(TAXONOMY_CACHE_KEY, JSON.stringify({ timestamp, data }));
    } catch {
      // A full or disabled storage must not prevent taxonomy rendering.
    }
    return parseTaxonomy(data);
  } catch {
    return staleTaxonomy ?? EMPTY_TAXONOMY;
  }
}
