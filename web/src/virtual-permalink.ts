export interface VirtualPermalinkAxes {
  readonly jsic: string;
  readonly color: string;
  readonly mood: string;
  readonly category: string;
  readonly style: string;
  readonly variant: number;
}

export interface VirtualPermalinkCatalog {
  readonly jsic: ReadonlySet<string>;
  readonly colors: ReadonlySet<string>;
  readonly categories: ReadonlySet<string>;
  readonly styles: ReadonlySet<string>;
  readonly moodForStyle: (style: string) => string;
}

const SLUG = "[a-z0-9][a-z0-9-]*";
export const MAX_VIRTUAL_VARIANT = 3999;
const VIRTUAL_ID = new RegExp(
  `^virtual_([0-9]{4})_(${SLUG})_(${SLUG})_c(${SLUG})_s(${SLUG})_v(0|[1-9][0-9]*)$`,
);

/** Encode every axis needed to reproduce a virtual result after a reload. */
export function buildVirtualPermalinkId(axes: VirtualPermalinkAxes): string {
  return `virtual_${axes.jsic}_${axes.color}_${axes.mood}_c${axes.category}_s${axes.style}_v${axes.variant}`;
}

/** Parse the canonical virtual ID. Semantic catalog validation is performed by the caller. */
export function parseVirtualPermalinkId(id: string): VirtualPermalinkAxes | undefined {
  const match = VIRTUAL_ID.exec(id);
  if (!match) return undefined;

  const variant = Number(match[6]);
  if (!Number.isSafeInteger(variant) || variant < 0 || variant > MAX_VIRTUAL_VARIANT) {
    return undefined;
  }

  return {
    jsic: match[1] ?? "",
    color: match[2] ?? "",
    mood: match[3] ?? "",
    category: match[4] ?? "",
    style: match[5] ?? "",
    variant,
  };
}

/** Reject syntactically valid IDs that cannot have been produced by the current catalog. */
export function validateVirtualPermalinkAxes(
  axes: VirtualPermalinkAxes,
  catalog: VirtualPermalinkCatalog,
): boolean {
  return (
    catalog.jsic.has(axes.jsic) &&
    catalog.colors.has(axes.color) &&
    catalog.categories.has(axes.category) &&
    catalog.styles.has(axes.style) &&
    catalog.moodForStyle(axes.style) === axes.mood
  );
}
