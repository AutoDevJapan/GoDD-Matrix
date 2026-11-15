import { describe, expect, it } from "vitest";
import { applyCatalogUrlState, parseCatalogUrlState } from "./catalog-url-state.js";
import {
  CANONICAL_CATEGORIES,
  CANONICAL_COLORS,
  CANONICAL_JSIC_CODES,
  CANONICAL_STYLES,
  VIRTUAL_SPACE_VERSION,
  VIRTUAL_VARIANT_COUNT,
  canonicalVirtualTotal,
  catalogCategory,
  catalogStyle,
  decodeCatalogCursor,
  encodeCatalogCursor,
  enrichWithMaterialized,
  entryFromVirtualAxes,
  exactFilteredCount,
  pageCatalog,
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
    expect(VIRTUAL_SPACE_VERSION).toBe(3);
    expect(VIRTUAL_VARIANT_COUNT).toBe(4000);
    expect(CANONICAL_CATEGORIES.length).toBe(16);
    expect(CANONICAL_STYLES.length).toBe(16);
    expect(CANONICAL_COLORS.length).toBeGreaterThanOrEqual(6);
    expect(CANONICAL_JSIC_CODES.length).toBeGreaterThan(1400);
    expect(canonicalVirtualTotal()).toBeGreaterThan(1_000_000_000);
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
      categories: ["dashboard"],
      styles: ["minimal"],
      colors: ["neutral"],
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
    expect(exactFilteredCount({ categories: ["not-a-category"], sort: "popular" })).toBe(0);
  });

  it("matches game development JSIC when filtering for ゲーム", () => {
    const axes = resolveFilteredAxes({
      industryTerms: ["ゲーム"],
      sort: "popular",
    });
    expect(axes.jsicCodes).toContain("3914");
    expect(axes.jsicCodes).toContain("8065");
  });

  it("narrows to game-dev vertical codes only (no arcade keyword bleed)", () => {
    const axes = resolveFilteredAxes({
      verticals: ["game-dev"],
      sort: "popular",
    });
    expect(axes.jsicCodes).toEqual(["3914"]);
  });
});

describe("rank / unrank bijection", () => {
  it("round-trips every digit at the boundaries", () => {
    const query = {
      categories: ["lp"],
      styles: ["minimal"],
      industries: ["G"],
      colors: ["neutral"],
      sort: "popular" as const,
    };
    const filtered = resolveFilteredAxes(query);
    const total = exactFilteredCount(query);
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
      { categories: ["dashboard"], styles: ["minimal"], sort: "popular" },
      { pageSize: 48, page: 1 },
    );
    const ids = page.items.map((item) => item.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("query-bound cursor pagination", () => {
  it("encodes and decodes a fingerprint-bound cursor", () => {
    const query = { categories: ["blog"], sort: "newest" as const };
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
    const materialized: readonly CatalogEntry[] = [
      {
        id: "6061_white_minimal",
        path: "design-md/6061/white/minimal/DESIGN.md",
        jsic: "6061",
        color: "white",
        mood: "minimal",
        title: "Materialized overlay fixture",
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
    const materialized: readonly CatalogEntry[] = [
      {
        id: "6061_white_minimal",
        path: "design-md/6061/white/minimal/DESIGN.md",
        jsic: "6061",
        color: "white",
        mood: "minimal",
        title: "Materialized overlay fixture",
        hash: "sha256:abc",
        createdAt: "2026-07-21T00:00:00Z",
        canonicalCellId: "v1:virtual_6061_white_minimal_cadmin_sminimal_v0",
      },
    ];
    expect(enrichWithMaterialized(intended, materialized).hash).toBe("sha256:abc");
    expect(enrichWithMaterialized(otherSlot, materialized).hash).toBe("");
  });
});

type CatalogEntry = Parameters<typeof enrichWithMaterialized>[0];

function publishedEntry(jsic = "6061", color = "dp-h21", mood = "cool", variant = 0): CatalogEntry {
  return {
    id: `${jsic}_${color}_${mood}${variant ? `_v${variant}` : ""}`,
    jsic,
    color,
    mood,
    variant,
    path: `design-md/${jsic}/${color}/${mood}${variant ? `/v${variant}` : ""}/DESIGN.md`,
    title: `${jsic} published design`,
    hash: `sha256:${"a".repeat(64)}`,
    createdAt: "2026-07-21T00:00:00Z",
    canonicalCellId: `v1:virtual_${jsic}_${color}_${mood}_clp_sminimal_v${variant}`,
  };
}

describe("materialized and virtual catalog union", () => {
  it("preserves the original virtual space and invalidates old virtual-only cursors", () => {
    const query = { sort: "popular" as const };
    const old = pageVirtualCatalog(query, { pageSize: 25 });
    const page = pageCatalog(query, [], { pageSize: 25 });
    expect(page.items).toEqual(old.items);
    expect(page.total).toBe(19_608_576_000);
    expect(page.total).toBe(canonicalVirtualTotal());
    expect(decodeCatalogCursor(old.cursor, page.queryFingerprint)).toBeUndefined();
  });

  it("reaches every synthetic 51,729-row corpus entry through both boundaries", () => {
    const rows = Array.from({ length: 51_729 }, (_, i) =>
      publishedEntry(
        CANONICAL_JSIC_CODES[i % CANONICAL_JSIC_CODES.length],
        "dp-h21",
        "cool",
        Math.floor(i / CANONICAL_JSIC_CODES.length),
      ),
    );
    const query = { sort: "popular" as const };
    const reached: string[] = [];
    for (let startRank = 0; startRank < rows.length; startRank += 997) {
      const page = pageCatalog(query, rows, { pageSize: 997, startRank });
      reached.push(...page.items.filter((entry) => entry.hash).map((entry) => entry.id));
      expect(page.total).toBe(canonicalVirtualTotal() + rows.length);
    }
    expect(reached).toEqual(rows.map((entry) => entry.id));
    expect(new Set(reached).size).toBe(51_729);
    const boundary = pageCatalog(query, rows, { pageSize: 2, startRank: rows.length - 1 });
    expect(boundary.items[0]).toBe(rows.at(-1));
    expect(boundary.items[1]?.id).toBe(pageVirtualCatalog(query, { pageSize: 1 }).items[0]?.id);
    const last = pageCatalog(query, rows, { pageSize: 1, startRank: boundary.total - 1 });
    expect(last.items[0]?.id).toBe(
      pageVirtualCatalog(query, {
        pageSize: 1,
        startRank: canonicalVirtualTotal() - 1,
      }).items[0]?.id,
    );
  });

  for (const sort of ["popular", "newest"] as const) {
    it(`deduplicates the exact identity across all narrow-query pages for ${sort}`, () => {
      const inside = publishedEntry("6061", "white", "minimal", 1);
      const differentMood = publishedEntry("6061", "white", "cool", 2);
      const rows = [inside, differentMood];
      const query = {
        categories: ["lp"],
        styles: ["minimal"],
        industryTerms: ["6061"],
        colors: ["white"],
        sort,
      };
      const original = pageVirtualCatalog(query, { pageSize: 10_000 });
      const replaced = "virtual_6061_white_minimal_clp_sminimal_v1";
      const prefix = sort === "popular" ? rows : [differentMood, inside];
      const expected = [
        ...prefix.map((entry) => entry.id),
        ...original.items.map((entry) => entry.id).filter((id) => id !== replaced),
      ];
      const first = pageCatalog(query, rows, { pageSize: 127 });
      const found: string[] = [];
      for (let page = 1; page <= first.pageCount; page++) {
        const next = pageCatalog(query, rows, { pageSize: 127, page });
        found.push(...next.items.map((entry) => entry.id));
        expect(
          pageCatalog(query, rows, {
            pageSize: 127,
            startRank: decodeCatalogCursor(next.cursor, next.queryFingerprint),
          }).items,
        ).toEqual(next.items);
      }
      expect(first.total).toBe(original.total + 1);
      expect(found).toEqual(expected);
      expect(new Set(found).size).toBe(found.length);
      expect(found).not.toContain(replaced);
    });
  }

  it("applies exact colors and combined facets without manufacturing virtual matches", () => {
    const row = publishedEntry();
    const query = { colors: ["dp-h21"], industryTerms: ["6061"], sort: "popular" as const };
    const options = { pageSize: 25 };
    expect(pageCatalog(query, [row], options).items).toEqual([row]);
    expect(pageCatalog(query, [row], options).total).toBe(1);
    for (const delta of [
      { colors: ["not-a-color"] },
      { categories: ["dashboard"] },
      { styles: ["glass"] },
      { verticals: ["game-dev"] },
      { industryTerms: ["3914"] },
      { industries: ["A"] },
    ])
      expect(pageCatalog({ ...query, ...delta }, [row], options).total).toBe(0);
  });

  it("binds a cursor to complete index contents and deduplicates repeated input IDs", () => {
    const row = publishedEntry();
    const query = { sort: "popular" as const };
    const first = pageCatalog(query, [row, row], { pageSize: 25 });
    expect(first.total).toBe(canonicalVirtualTotal() + 1);
    expect(first.items.filter((entry) => entry.id === row.id)).toHaveLength(1);
    const changed = pageCatalog(query, [{ ...row, hash: `sha256:${"b".repeat(64)}` }], {
      pageSize: 25,
    });
    expect(decodeCatalogCursor(first.cursor, changed.queryFingerprint)).toBeUndefined();
    expect(
      decodeCatalogCursor(first.cursor, pageCatalog(query, [], { pageSize: 25 }).queryFingerprint),
    ).toBeUndefined();
  });

  it("keeps an already materialized row rather than replacing it with a legacy body", () => {
    const row = publishedEntry();
    const legacy = {
      ...row,
      id: "legacy",
      canonicalCellId: undefined,
      hash: `sha256:${"b".repeat(64)}`,
    };
    expect(enrichWithMaterialized(row, [legacy])).toBe(row);
  });

  it("keeps legacy display coordinates while preferring published coordinates", () => {
    const row = publishedEntry();
    expect(catalogCategory(row)).toBe("lp");
    expect(catalogStyle(row)).toBe("minimal");
    expect(catalogStyle({ ...row, canonicalCellId: undefined, mood: "elegant" })).toBe("glass");
    expect(CANONICAL_CATEGORIES).toContain(catalogCategory({ ...row, canonicalCellId: undefined }));
  });
});

describe("combined catalog facets and empty boundaries", () => {
  it("keeps family, category, style and industry selection aligned with result cards", () => {
    const row = publishedEntry("3914", "white", "minimal", 3);
    const query = {
      categories: ["lp"],
      styles: ["minimal"],
      colors: ["neutral"],
      verticals: ["game-dev"],
      industryTerms: ["3914"],
      sort: "popular" as const,
    };
    const page = pageCatalog(query, [row], { pageSize: 25 });
    expect(page.items[0]).toBe(row);
    expect(page.total).toBe(pageVirtualCatalog(query, { pageSize: 1 }).total);
    expect(catalogCategory(page.items[0] as CatalogEntry)).toBe("lp");
    expect(catalogStyle(page.items[0] as CatalogEntry)).toBe("minimal");
  });
  it("uses existing newest order for materialized rows before virtual rows", () => {
    const older = publishedEntry("6061", "dp-h21", "cool", 2);
    const newer = { ...publishedEntry("6061", "dp-h21", "cool", 1), createdAt: "2026-08-01" };
    expect(pageCatalog({ sort: "newest" }, [older, newer], { pageSize: 2 }).items).toEqual([
      newer,
      older,
    ]);
  });
  it("keeps an empty query result explicit and clamps an out-of-range page", () => {
    const empty = pageCatalog(
      { categories: ["not-a-category"], sort: "popular" },
      [publishedEntry()],
      { pageSize: 25, page: 500 },
    );
    expect(empty).toMatchObject({ items: [], total: 0, page: 1, pageCount: 1, startRank: 0 });
    const query = { colors: ["dp-h21"], sort: "popular" as const };
    const row = publishedEntry();
    const end = pageCatalog(query, [row], { pageSize: 25, page: 500 });
    expect(end).toMatchObject({ items: [row], total: 1, page: 1, pageCount: 1 });
  });
});

describe("legacy v3 link normalization", () => {
  const legacyQuery = {
    categories: [],
    styles: [],
    industries: [],
    verticals: ["game-dev"],
    colors: ["blue"],
    industryTerms: [],
    sort: "popular" as const,
  };

  it("recognizes the supplied normal v3 tuple and preserves browse/cell state on reset", () => {
    expect(queryFingerprint(legacyQuery)).toBe("625e0093");
    expect(decodeCatalogCursor("v3.625e0093.25", queryFingerprint(legacyQuery))).toBe(25);
    const virtual = pageVirtualCatalog(legacyQuery, { pageSize: 25, page: 2 }).items[0];
    expect(virtual).toBeDefined();
    if (!virtual) throw new Error("missing legacy positive");
    expect(restoreCanonicalVirtualEntry(virtual.id)?.id).toBe(virtual.id);
    const incoming = new URL("https://autodevjapan.github.io/GoDD-Matrix/");
    incoming.searchParams.set("job", "game-dev");
    incoming.searchParams.set("color", "blue");
    incoming.searchParams.set("cursor", "v3.625e0093.25");
    incoming.searchParams.set("cell", virtual.id);
    const state = parseCatalogUrlState(incoming.search);
    const rows = [publishedEntry("3914", virtual.color, "minimal")];
    const first = pageCatalog(legacyQuery, rows, { pageSize: 25 });
    const rank = decodeCatalogCursor(state.cursor ?? "", first.queryFingerprint) ?? 0;
    expect(rank).toBe(0); // Obsolete ordinal resets; the valid v3 search is not an invalid query.
    const normalized = new URL(
      applyCatalogUrlState(incoming.href, { ...state, cursor: first.cursor }),
    );
    expect({ ...parseCatalogUrlState(normalized.search), cursor: null }).toEqual({
      ...state,
      cursor: null,
    });
    expect(first.total).toBeGreaterThan(0);
    expect(restoreCanonicalVirtualEntry(state.cell ?? "")?.id).toBe(virtual.id);
  });

  it("keeps q/facets/sort/cell and back-to-browse state for a normal old link", () => {
    const query = {
      categories: ["lp"],
      styles: ["minimal"],
      industries: ["G"],
      verticals: ["game-dev"],
      colors: ["blue"],
      industryTerms: ["3914"],
      sort: "newest" as const,
    };
    const virtual = pageVirtualCatalog(query, { pageSize: 25 }).items[0];
    if (!virtual) throw new Error("missing legacy filtered positive");
    const oldCursor = encodeCatalogCursor(queryFingerprint(query), 25);
    expect(decodeCatalogCursor(oldCursor, queryFingerprint(query))).toBe(25);
    const state = {
      q: "3914",
      categories: query.categories,
      styles: query.styles,
      industries: query.industries,
      verticals: query.verticals,
      colors: query.colors,
      sort: query.sort,
      cursor: oldCursor,
      cell: virtual.id,
    };
    const before = new URL(
      applyCatalogUrlState("https://autodevjapan.github.io/GoDD-Matrix/", state),
    );
    const parsed = parseCatalogUrlState(before.search);
    const rows = [publishedEntry("3914", virtual.color, "minimal")];
    const first = pageCatalog(query, rows, { pageSize: 25 });
    expect(decodeCatalogCursor(oldCursor, first.queryFingerprint)).toBeUndefined();
    const after = new URL(applyCatalogUrlState(before.href, { ...parsed, cursor: first.cursor }));
    expect({ ...parseCatalogUrlState(after.search), cursor: null }).toEqual({
      ...parsed,
      cursor: null,
    });
    const back = new URL(
      applyCatalogUrlState(after.href, {
        ...parseCatalogUrlState(after.search),
        cell: null,
      }),
    );
    expect(parseCatalogUrlState(back.search)).toEqual({
      ...parsed,
      cursor: first.cursor,
      cell: null,
    });
    expect(first.total).toBeGreaterThan(0);
  });

  it("separately rejects malformed, wrong-version and query-mismatched cursors", () => {
    const page = pageCatalog(legacyQuery, [], { pageSize: 25 });
    for (const bad of [
      "invalid",
      "v0.625e0093.25",
      "v3.deadbeef.25",
      `v3.${page.queryFingerprint}.9007199254740992`,
    ])
      expect(decodeCatalogCursor(bad, page.queryFingerprint)).toBeUndefined();
  });

  it("keeps the position of a current merged cursor on the same-index reload", () => {
    const virtual = pageVirtualCatalog(legacyQuery, { pageSize: 1 }).items[0];
    if (!virtual) throw new Error("missing virtual positive");
    const rows = [publishedEntry("3914", virtual.color, "minimal")];
    const next = pageCatalog(legacyQuery, rows, { pageSize: 25, page: 2 });
    const state = parseCatalogUrlState(`?job=game-dev&color=blue&cursor=${next.cursor}`);
    const rank = decodeCatalogCursor(state.cursor ?? "", next.queryFingerprint);
    expect(rank).toBe(25);
    expect(pageCatalog(legacyQuery, rows, { pageSize: 25, startRank: rank }).items).toEqual(
      next.items,
    );
  });
});
