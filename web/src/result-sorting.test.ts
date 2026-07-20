import { describe, expect, it } from "vitest";
import type { DesignIndexEntry } from "../../src/ds/types.js";
import { sortDesignEntries, virtualIndexAtRank } from "./result-sorting.js";

function entry(id: string, createdAt: string, variant = 0): DesignIndexEntry {
  return {
    id,
    path: `design-md/${id}/DESIGN.md`,
    jsic: "6061",
    color: "blue",
    mood: "minimal",
    hash: `sha256:${id}`,
    createdAt,
    variant,
  };
}

describe("sortDesignEntries", () => {
  const entries = [
    entry("materialized-a", "2025-01-01"),
    entry("materialized-b", "2026-01-01"),
    { ...entry("virtual-c", "2026-01-01", 3), hash: "" },
  ];

  it("defines Popular as the curated catalog rank when analytics are unavailable", () => {
    expect(sortDesignEntries(entries, "popular").map(({ id }) => id)).toEqual([
      "materialized-a",
      "materialized-b",
      "virtual-c",
    ]);
    expect(entries.map(({ id }) => id)).toEqual(["materialized-a", "materialized-b", "virtual-c"]);
  });

  it("defines Newest as date, variant, then ID and supports mixed materialized/virtual entries", () => {
    expect(sortDesignEntries(entries, "newest").map(({ id }) => id)).toEqual([
      "virtual-c",
      "materialized-b",
      "materialized-a",
    ]);
  });

  it("is deterministic across repeated calls", () => {
    expect(sortDesignEntries(entries, "popular")).toEqual(sortDesignEntries(entries, "popular"));
    expect(sortDesignEntries(entries, "newest")).toEqual(sortDesignEntries(entries, "newest"));
  });

  it("actually changes materialized order and keeps page boundaries stable", () => {
    const popular = sortDesignEntries(entries, "popular").map(({ id }) => id);
    const newest = sortDesignEntries(entries, "newest").map(({ id }) => id);
    expect(popular).not.toEqual(newest);

    for (const order of ["popular", "newest"] as const) {
      const sorted = sortDesignEntries(entries, order);
      const firstPage = sorted.slice(0, 2).map(({ id }) => id);
      const secondPage = sorted.slice(2, 4).map(({ id }) => id);
      expect(firstPage).toEqual(
        sortDesignEntries(entries, order)
          .slice(0, 2)
          .map(({ id }) => id),
      );
      expect(new Set([...firstPage, ...secondPage]).size).toBe(entries.length);
    }
  });
});

describe("virtualIndexAtRank", () => {
  it("changes virtual ordering between Popular and Newest", () => {
    expect(Array.from({ length: 6 }, (_, rank) => virtualIndexAtRank(rank, 6, "popular"))).toEqual([
      0, 1, 2, 3, 4, 5,
    ]);
    expect(Array.from({ length: 6 }, (_, rank) => virtualIndexAtRank(rank, 6, "newest"))).toEqual([
      5, 4, 3, 2, 1, 0,
    ]);
  });

  it("keeps adjacent pages stable, exhaustive, and duplicate-free", () => {
    const pageSize = 4;
    for (const order of ["popular", "newest"] as const) {
      const pages = Array.from({ length: 3 }, (_, page) =>
        Array.from({ length: pageSize }, (_, offset) =>
          virtualIndexAtRank(page * pageSize + offset, 12, order),
        ),
      );
      const flattened = pages.flat();
      expect(new Set(flattened).size).toBe(12);
      expect([...flattened].sort((left, right) => left - right)).toEqual(
        Array.from({ length: 12 }, (_, index) => index),
      );
      expect(pages).toEqual(
        Array.from({ length: 3 }, (_, page) =>
          Array.from({ length: pageSize }, (_, offset) =>
            virtualIndexAtRank(page * pageSize + offset, 12, order),
          ),
        ),
      );
    }
  });
});
