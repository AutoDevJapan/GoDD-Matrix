/** Decide whether to keep in-session color edits when reopening a detail view. */
export function resolveDetailColorOverrides(
  baseSwatches: readonly string[],
  currentOverrides: readonly string[],
  preserveColors?: boolean,
): string[] {
  if (!preserveColors || currentOverrides.length !== baseSwatches.length) {
    return [...baseSwatches];
  }
  return [...currentOverrides];
}

export interface ColorTokenLike {
  readonly role: string;
  readonly hex: string;
}

/**
 * Pick Primary / Accent hexes for the detail color editor from DESIGN.md tokens.
 * Falls back to the provided approx swatches when the body has no color-system table.
 */
export function editableSwatchesFromTokens(
  tokens: readonly ColorTokenLike[],
  fallback: readonly string[],
): string[] {
  if (tokens.length === 0) {
    return [...fallback];
  }
  const byRole = new Map(tokens.map((token) => [token.role, token.hex]));
  const primary = byRole.get("primary") ?? tokens[0]?.hex;
  const accent = byRole.get("accent") ?? byRole.get("secondary") ?? tokens[1]?.hex ?? primary;
  if (!primary || !accent) {
    return [...fallback];
  }
  return [primary, accent];
}
