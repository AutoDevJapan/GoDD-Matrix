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
