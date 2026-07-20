import type { DesignIndexEntry } from "../../src/ds/types.js";

export type ResultSortOrder = "popular" | "newest";

function createdAtMillis(entry: DesignIndexEntry): number {
  const value = entry.createdAt ? Date.parse(entry.createdAt) : Number.NaN;
  return Number.isFinite(value) ? value : 0;
}

/** Return a sorted copy; input order and entries are never mutated. */
export function sortDesignEntries(
  entries: readonly DesignIndexEntry[],
  order: ResultSortOrder,
): DesignIndexEntry[] {
  if (order === "popular") return [...entries];
  return [...entries].sort((left, right) => {
    const dateDifference = createdAtMillis(right) - createdAtMillis(left);
    if (dateDifference !== 0) return dateDifference;
    const variantDifference = (right.variant ?? 0) - (left.variant ?? 0);
    if (variantDifference !== 0) return variantDifference;
    return left.id.localeCompare(right.id, "en");
  });
}

/**
 * Map a displayed virtual-result rank to its deterministic combination index.
 *
 * Virtual results have no analytics or publication timestamp. Their generator order is therefore
 * the stable popularity rank, while later generated variants are treated as newer. Reversing the
 * bijection for Newest keeps pagination O(page size) without duplicates or skipped combinations.
 */
export function virtualIndexAtRank(rank: number, total: number, order: ResultSortOrder): number {
  if (!Number.isSafeInteger(rank) || !Number.isSafeInteger(total) || total <= 0) {
    throw new RangeError("rank and total must describe a non-empty safe-integer result set");
  }
  if (rank < 0 || rank >= total) throw new RangeError("rank is outside the result set");
  return order === "popular" ? rank : total - rank - 1;
}
