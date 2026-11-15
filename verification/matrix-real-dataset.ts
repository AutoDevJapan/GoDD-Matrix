import { strict as assert } from "node:assert";
import { createHash } from "node:crypto";
import type { DesignIndexEntry } from "../src/ds/types.js";
import { parseDesignIndex } from "../src/ds/validate.js";
import { parseCanonicalCellId } from "../web/src/catalog-coordinates.js";
import { colorFamily, isColorFamilyKey } from "../web/src/lib.js";
import { sortDesignEntries } from "../web/src/result-sorting.js";
import { findStyleValue } from "../web/src/search-parser.js";
import {
  CANONICAL_COLORS,
  CANONICAL_STYLES,
  canonicalVirtualTotal,
  pageCatalog,
  restoreCanonicalVirtualEntry,
} from "../web/src/virtual-catalog.js";

function entryClasses(entry: DesignIndexEntry): string[] {
  const coords = entry.canonicalCellId ? parseCanonicalCellId(entry.canonicalCellId) : undefined;
  return [
    `mood:${entry.mood}`,
    ...(entry.tags ?? []).map((tag) => `tag:${tag}`),
    ...(coords ? [`category:${coords.category}`, `style:${coords.style}`] : []),
    entry.canonicalCellId ? "canonical" : "legacy",
  ];
}

function publishedStyleQuery(rawStyle: string): string {
  const style = findStyleValue(rawStyle);
  assert.ok(
    style && CANONICAL_STYLES.includes(style),
    `No UI style for published style ${rawStyle}`,
  );
  return style;
}

/** Verify the fixed published index through the production catalog consumer. */
export function assertFixedRealDataset(bytes: Uint8Array) {
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  assert.equal(sha256, "62eb8dbde50783aba4fc15f4578a979342cf2cb06fa40bc03c67e2412c879fe0");
  const entries = parseDesignIndex(Buffer.from(bytes).toString("utf8")).entries;
  assert.equal(entries.length, 51_729);
  assert.equal(new Set(entries.map((entry) => entry.id)).size, 51_729);
  const colors = new Set(entries.map((entry) => entry.color));
  const moods = new Set(entries.map((entry) => entry.mood));
  const tags = new Set(entries.flatMap((entry) => [...(entry.tags ?? [])]));
  const overlapIds = new Set<string>();
  const categories = new Set<string>();
  const styles = new Set<string>();
  let canonicalRows = 0;
  let legacyRows = 0;
  let unparseableCanonicalRows = 0;
  for (const entry of entries) {
    if (entry.canonicalCellId) {
      canonicalRows++;
      const coordinates = parseCanonicalCellId(entry.canonicalCellId);
      if (!coordinates) unparseableCanonicalRows++;
      else {
        categories.add(coordinates.category);
        styles.add(coordinates.style);
      }
      const id = entry.canonicalCellId.replace(/^v[1-9][0-9]*:/, "");
      const restored = restoreCanonicalVirtualEntry(id);
      if (
        restored &&
        restored.id === id &&
        restored.jsic === entry.jsic &&
        restored.color === entry.color &&
        restored.mood === entry.mood &&
        (restored.variant ?? 0) === (entry.variant ?? 0)
      )
        overlapIds.add(id);
    } else legacyRows++;
  }

  let prefixRowsChecked = 0;
  for (const sort of ["popular", "newest"] as const) {
    const expected = sortDesignEntries(entries, sort);
    for (let startRank = 0; startRank < entries.length; startRank += 1000) {
      const page = pageCatalog({ sort }, entries, { pageSize: 1000, startRank });
      const take = Math.min(1000, entries.length - startRank);
      assert.deepEqual(page.items.slice(0, take), expected.slice(startRank, startRank + take));
      assert.equal(page.total, canonicalVirtualTotal() + entries.length - overlapIds.size);
      prefixRowsChecked += take;
    }
  }

  let colorRowsChecked = 0;
  for (const color of colors) {
    const expected = entries.filter(
      (entry) =>
        entry.color === color ||
        (isColorFamilyKey(color) && colorFamily(entry.color).key === color),
    );
    for (let startRank = 0; startRank < expected.length; startRank += 1000) {
      const page = pageCatalog({ colors: [color], sort: "popular" }, entries, {
        pageSize: 1000,
        startRank,
      });
      const take = Math.min(1000, expected.length - startRank);
      assert.deepEqual(page.items.slice(0, take), expected.slice(startRank, startRank + take));
      colorRowsChecked += take;
    }
  }

  const representatives = new Map<string, DesignIndexEntry>();
  const classes = new Set<string>();
  for (const entry of entries) {
    for (const key of entryClasses(entry)) {
      if (!classes.has(key)) {
        classes.add(key);
        representatives.set(entry.id, entry);
      }
    }
  }
  const suppliedPositiveIDs = ["9293_dp-h21_cool", "4121_s-h01_authoritative"];
  for (const id of suppliedPositiveIDs) {
    const entry = entries.find((item) => item.id === id);
    assert.ok(entry, `fixed dataset lacks supplied positive ${id}`);
    representatives.set(entry.id, entry);
  }
  const verifiedClasses = new Set<string>();
  const verifiedPositiveIDs = new Set<string>();
  let representativeQueries = 0;
  for (const entry of representatives.values()) {
    const coords = entry.canonicalCellId ? parseCanonicalCellId(entry.canonicalCellId) : undefined;
    const query = {
      colors: [entry.color],
      industryTerms: [entry.jsic],
      sort: "popular" as const,
      ...(coords
        ? { categories: [coords.category], styles: [publishedStyleQuery(coords.style)] }
        : {}),
    };
    let found = false;
    for (let startRank = 0; startRank < entries.length; startRank += 128) {
      const page = pageCatalog(query, entries, { pageSize: 128, startRank });
      if (
        page.items.some(
          (item) => item.id === entry.id && item.path === entry.path && item.hash === entry.hash,
        )
      ) {
        found = true;
        break;
      }
      if (!page.items.some((item) => item.hash)) break;
    }
    assert.ok(found, `materialized query unreachable: ${entry.id}`);
    for (const key of entryClasses(entry)) verifiedClasses.add(key);
    if (suppliedPositiveIDs.includes(entry.id)) verifiedPositiveIDs.add(entry.id);
    representativeQueries++;
  }
  assert.deepEqual([...verifiedClasses].sort(), [...classes].sort());
  assert.deepEqual([...verifiedPositiveIDs].sort(), [...suppliedPositiveIDs].sort());
  return {
    sha256,
    entryCount: entries.length,
    uniqueIDs: new Set(entries.map((entry) => entry.id)).size,
    prefixRowsChecked,
    colorRowsChecked,
    requiredClasses: [...classes].sort(),
    representativeClasses: [...verifiedClasses].sort(),
    knownPositiveIDs: [...verifiedPositiveIDs].sort(),
    distinctColors: colors.size,
    distinctMoods: moods.size,
    distinctTags: tags.size,
    distinctCategories: categories.size,
    distinctStyles: styles.size,
    nonRepresentativeColorRows: entries.filter((entry) => !CANONICAL_COLORS.includes(entry.color))
      .length,
    canonicalRows,
    legacyRows,
    unparseableCanonicalRows,
    overlappingVirtualCells: overlapIds.size,
    representativeQueries,
    legacyCoverage: legacyRows
      ? "actual rows exercised"
      : "absent in fixed dataset; synthetic only",
    classification: "fixed real-index production consumer",
  };
}
