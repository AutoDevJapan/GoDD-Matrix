import { describe, expect, it, vi } from "vitest";
import { EMPTY_TAXONOMY } from "./lib.js";
import { TAXONOMY_CACHE_KEY, TAXONOMY_CACHE_TTL_MS, loadTaxonomy } from "./taxonomy-cache.js";

const NOW = 2_000_000_000_000;
const RAW_TAXONOMY = {
  version: "test",
  colors: { blue: { name_en: "Blue" } },
  moods: { calm: { name_en: "Calm" } },
};

function storage(initial: string | null = null) {
  let value = initial;
  return {
    getItem: vi.fn(() => value),
    setItem: vi.fn((_key: string, next: string) => {
      value = next;
    }),
  };
}

function successfulFetch() {
  return vi.fn(async () => new Response(JSON.stringify(RAW_TAXONOMY), { status: 200 }));
}

describe("loadTaxonomy", () => {
  it("returns a fresh cached taxonomy without fetching", async () => {
    const cache = storage(
      JSON.stringify({ timestamp: NOW - TAXONOMY_CACHE_TTL_MS + 1, data: RAW_TAXONOMY }),
    );
    const fetcher = successfulFetch();

    const result = await loadTaxonomy({ storage: cache, fetcher, now: () => NOW });

    expect(result.version).toBe("test");
    expect(fetcher).not.toHaveBeenCalled();
  });

  it.each([
    ["expired", JSON.stringify({ timestamp: NOW - TAXONOMY_CACHE_TTL_MS, data: RAW_TAXONOMY })],
    ["from the future", JSON.stringify({ timestamp: NOW + 1, data: {} })],
    ["malformed", "not json"],
    ["missing data", JSON.stringify({ timestamp: NOW - 1 })],
    ["null data", JSON.stringify({ timestamp: NOW - 1, data: null })],
    ["scalar data", JSON.stringify({ timestamp: NOW - 1, data: "taxonomy" })],
  ])("refreshes a %s cache entry", async (_label, cached) => {
    const cache = storage(cached);
    const fetcher = successfulFetch();

    const result = await loadTaxonomy({ storage: cache, fetcher, now: () => NOW });

    expect(result.version).toBe("test");
    expect(fetcher).toHaveBeenCalledOnce();
    expect(cache.setItem).toHaveBeenCalledWith(
      TAXONOMY_CACHE_KEY,
      JSON.stringify({ timestamp: NOW, data: RAW_TAXONOMY }),
    );
  });

  it("still returns fetched data when storage is unavailable", async () => {
    const unavailableStorage = {
      getItem: vi.fn(() => {
        throw new Error("blocked");
      }),
      setItem: vi.fn(() => {
        throw new Error("blocked");
      }),
    };

    const result = await loadTaxonomy({
      storage: unavailableStorage,
      fetcher: successfulFetch(),
      now: () => NOW,
    });

    expect(result.version).toBe("test");
  });

  it("falls back to an empty taxonomy when fetching fails", async () => {
    const fetcher = vi.fn(async () => new Response(null, { status: 503 }));

    await expect(loadTaxonomy({ storage: storage(), fetcher, now: () => NOW })).resolves.toEqual(
      EMPTY_TAXONOMY,
    );
  });

  it("uses an expired taxonomy as a stale fallback when refresh fails", async () => {
    const cache = storage(
      JSON.stringify({ timestamp: NOW - TAXONOMY_CACHE_TTL_MS, data: RAW_TAXONOMY }),
    );
    const fetcher = vi.fn(async () => new Response(null, { status: 503 }));

    const result = await loadTaxonomy({ storage: cache, fetcher, now: () => NOW });

    expect(result.version).toBe("test");
    expect(fetcher).toHaveBeenCalledOnce();
  });
});
