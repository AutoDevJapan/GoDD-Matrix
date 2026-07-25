import { describe, expect, it } from "vitest";
import {
  CANONICAL_CATEGORIES,
  CANONICAL_COLORS,
  CANONICAL_JSIC_CODES,
  CANONICAL_STYLES,
  VIRTUAL_SPACE_VERSION,
  VIRTUAL_VARIANT_COUNT,
  canonicalVirtualTotal,
  decodeCatalogCursor,
  encodeCatalogCursor,
  enrichWithMaterialized,
  entryFromVirtualAxes,
  exactFilteredCount,
  pageVirtualCatalog,
  queryFingerprint,
  rankInFilteredView,
  resolveFilteredAxes,
  restoreCanonicalVirtualEntry,
  unrankInFilteredView,
} from "./virtual-catalog.js";
import { parseVirtualPermalinkId } from "./virtual-permalink.js";

describe("canonical virtual space", () => {
  it("is versioned and exceeds 100 million unique cells", () => {
    expect(VIRTUAL_SPACE_VERSION).toBe(1);
    expect(VIRTUAL_VARIANT_COUNT).toBe(4000);
    expect(CANONICAL_CATEGORIES.length).toBe(8);
    expect(CANONICAL_STYLES.length).toBe(8);
    expect(CANONICAL_COLORS.length).toBeGreaterThanOrEqual(6);
    expect(CANONICAL_JSIC_CODES.length).toBeGreaterThan(1400);
    expect(canonicalVirtualTotal()).toBeGreaterThan(100_000_000);
    expect(canonicalVirtualTotal()).toBe(
      CANONICAL_CATEGORIES.length *
        CANONICAL_STYLES.length *
        CANONICAL_JSIC_CODES.length *
        CANONICAL_COLORS.length *
        VIRTUAL_VARIANT_COUNT,
    );
  });

  it("keeps JSIC codes sorted for a stable radix", () => {
    expect(CANONICAL_JSIC_CODES).toEqual(
      [...CANONICAL_JSIC_CODES].sort((left, right) => left.localeCompare(right)),
    );
  });
});

describe("exact filtered counts", () => {
  it("returns the full space when unfiltered", () => {
    expect(exactFilteredCount({ sort: "popular" })).toBe(canonicalVirtualTotal());
  });

  it("computes exact products without enumerating cells", () => {
    const query = {
      category: "dashboard",
      style: "minimal",
      colorPalette: "neutral",
      sort: "popular" as const,
    };
    const axes = resolveFilteredAxes(query);
    expect(axes.categories).toEqual(["dashboard"]);
    expect(axes.styles).toEqual(["minimal"]);
    expect(axes.colors.length).toBeGreaterThan(0);
    expect(exactFilteredCount(query)).toBe(
      axes.categories.length *
        axes.styles.length *
        axes.jsicCodes.length *
        axes.colors.length *
        axes.variantCount,
    );
  });

  it("returns zero for an unknown category instead of inventing cells", () => {
    expect(exactFilteredCount({ category: "not-a-category", sort: "popular" })).toBe(0);
  });
});

describe("rank / unrank bijection", () => {
  it("round-trips every digit at the boundaries", () => {
    const filtered = resolveFilteredAxes({
      category: "lp",
      style: "minimal",
      industry: "G",
      colorPalette: "neutral",
      sort: "popular",
    });
    const total = exactFilteredCount({
      category: "lp",
      style: "minimal",
      industry: "G",
      colorPalette: "neutral",
      sort: "popular",
    });
    expect(total).toBeGreaterThan(0);

    for (const rank of [0, 1, total - 1, Math.floor(total / 2)]) {
      const axes = unrankInFilteredView(rank, filtered);
      expect(axes).toBeDefined();
      if (!axes) continue;
      expect(rankInFilteredView(axes, filtered)).toBe(rank);
      const entry = entryFromVirtualAxes(axes);
      expect(parseVirtualPermalinkId(entry.id)).toMatchObject({
        jsic: axes.jsic,
        color: axes.color,
        mood: axes.mood,
        category: axes.category,
        style: axes.style,
        variant: axes.variant,
      });
    }
  });

  it("rejects out-of-range ranks", () => {
    const filtered = resolveFilteredAxes({ sort: "popular" });
    expect(unrankInFilteredView(-1, filtered)).toBeUndefined();
    expect(unrankInFilteredView(canonicalVirtualTotal(), filtered)).toBeUndefined();
  });

  it("produces unique IDs across a page window", () => {
    const page = pageVirtualCatalog(
      { category: "dashboard", style: "minimal", sort: "popular" },
      { pageSize: 48, page: 1 },
    );
    const ids = page.items.map((item) => item.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("query-bound cursor pagination", () => {
  it("encodes and decodes a fingerprint-bound cursor", () => {
    const query = { category: "blog", sort: "newest" as const };
    const fingerprint = queryFingerprint(query);
    const cursor = encodeCatalogCursor(fingerprint, 2400);
    expect(decodeCatalogCursor(cursor, fingerprint)).toBe(2400);
    expect(decodeCatalogCursor(cursor, "deadbeef")).toBeUndefined();
    expect(decodeCatalogCursor("v0.aaaaaaaa.1", fingerprint)).toBeUndefined();
  });

  it("supports distant ordinal jumps in O(page size)", () => {
    const query = { sort: "popular" as const };
    const distant = pageVirtualCatalog(query, { pageSize: 24, page: 1_000_000 });
    expect(distant.page).toBe(1_000_000);
    expect(distant.items).toHaveLength(24);
    expect(distant.startRank).toBe((1_000_000 - 1) * 24);

    const fromCursor = pageVirtualCatalog(query, {
      pageSize: 24,
      startRank: decodeCatalogCursor(distant.cursor, distant.queryFingerprint),
    });
    expect(fromCursor.items.map((item) => item.id)).toEqual(distant.items.map((item) => item.id));
  });

  it("changes order between popular and newest without duplicates", () => {
    const popular = pageVirtualCatalog({ sort: "popular" }, { pageSize: 12, page: 1 });
    const newest = pageVirtualCatalog({ sort: "newest" }, { pageSize: 12, page: 1 });
    expect(popular.items.map((item) => item.id)).not.toEqual(newest.items.map((item) => item.id));
    expect(new Set(popular.items.map((item) => item.id)).size).toBe(12);
    expect(new Set(newest.items.map((item) => item.id)).size).toBe(12);
  });
});

describe("addressability and materialized overlay", () => {
  it("restores every canonical virtual permalink", () => {
    const page = pageVirtualCatalog({ sort: "popular" }, { pageSize: 5, page: 1 });
    for (const item of page.items) {
      expect(restoreCanonicalVirtualEntry(item.id)?.id).toBe(item.id);
    }
  });

  it("enriches virtual cells with materialized path/hash when axes match", () => {
    const virtual = entryFromVirtualAxes({
      jsic: "6061",
      color: "white",
      mood: "minimal",
      category: "dashboard",
      style: "minimal",
      variant: 0,
    });
    const materialized = [
      {
        id: "6061_white_minimal",
        path: "design-md/6061/white/minimal/DESIGN.md",
        jsic: "6061",
        color: "white",
        mood: "minimal",
        hash: "sha256:abc",
        createdAt: "2026-07-21T00:00:00Z",
      },
    ];
    const enriched = enrichWithMaterialized(virtual, materialized);
    expect(enriched.id).toBe(virtual.id);
    expect(enriched.hash).toBe("sha256:abc");
    expect(enriched.path).toBe(materialized[0]?.path);
  });

  it("overlays only the canonicalCellId slot when coordinates are published", () => {
    const intended = entryFromVirtualAxes({
      jsic: "6061",
      color: "white",
      mood: "minimal",
      category: "admin",
      style: "minimal",
      variant: 0,
    });
    const otherSlot = entryFromVirtualAxes({
      jsic: "6061",
      color: "white",
      mood: "minimal",
      category: "dashboard",
      style: "minimal",
      variant: 0,
    });
    const materialized = [
      {
        id: "6061_white_minimal",
        path: "design-md/6061/white/minimal/DESIGN.md",
        jsic: "6061",
        color: "white",
        mood: "minimal",
        hash: "sha256:abc",
        createdAt: "2026-07-21T00:00:00Z",
        canonicalCellId: "v1:virtual_6061_white_minimal_cadmin_sminimal_v0",
      },
    ];
    expect(enrichWithMaterialized(intended, materialized).hash).toBe("sha256:abc");
    expect(enrichWithMaterialized(otherSlot, materialized).hash).toBe("");
  });
});
