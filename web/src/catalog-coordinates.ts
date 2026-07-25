import { type VirtualPermalinkAxes, parseVirtualPermalinkId } from "./virtual-permalink.js";

const VERSIONED = /^v([1-9][0-9]*):(virtual_.+)$/;

export interface CanonicalCatalogCoordinates extends VirtualPermalinkAxes {
  readonly version: number;
  readonly canonicalCellId: string;
}

/** Parse a versioned Design-Systems `canonicalCellId` (`v{N}:virtual_…`). */
export function parseCanonicalCellId(value: string): CanonicalCatalogCoordinates | undefined {
  const match = VERSIONED.exec(value);
  if (!match) return undefined;
  const version = Number(match[1]);
  if (!Number.isSafeInteger(version) || version < 1) return undefined;
  const virtualId = match[2] ?? "";
  const axes = parseVirtualPermalinkId(virtualId);
  if (!axes) return undefined;
  return { version, canonicalCellId: value, ...axes };
}

/** Prefer published coordinates; fall back for legacy index rows without `canonicalCellId`. */
export function categoryFromEntry(
  entry: {
    readonly id?: string;
    readonly tags?: readonly string[];
    readonly canonicalCellId?: string;
  },
  legacyCategory: () => string,
): string {
  const coords = entry.canonicalCellId ? parseCanonicalCellId(entry.canonicalCellId) : undefined;
  if (coords) return coords.category;
  if (entry.id?.startsWith("virtual_")) return entry.tags?.[0] || "";
  return legacyCategory();
}

/** Prefer published coordinates; fall back for legacy index rows without `canonicalCellId`. */
export function styleFromEntry(
  entry: {
    readonly id?: string;
    readonly tags?: readonly string[];
    readonly canonicalCellId?: string;
  },
  legacyStyle: () => string,
): string {
  const coords = entry.canonicalCellId ? parseCanonicalCellId(entry.canonicalCellId) : undefined;
  if (coords) return coords.style;
  if (entry.id?.startsWith("virtual_")) return entry.tags?.[1] || "";
  return legacyStyle();
}
