/**
 * Late arrival of the full catalog index (summary-first boot).
 *
 * The browse screen is usable before the index arrives. Two things must survive that arrival
 * without taking over what the user is doing:
 * 1. A `?cell=` link that could not be resolved yet opens once the index is there, but only while
 *    the user has left the browse URL alone (no search, filter, sort, paging, other cell or back).
 * 2. Re-opening the cell that is already on screen keeps its color editor (focus, caret, draft)
 *    when that editor was built for the same cell, locale and number of colors.
 */

/** A `?cell=` link that is waiting for the catalog. */
export interface PendingDeepLink {
  /** Report one browse-URL write with the href before and after it. */
  noteUrlWrite(before: string, after: string): void;
  /** Hand the cell over once, and only if the URL has not moved since the link was armed. */
  claim(currentHref: string): string | null;
}

/**
 * `armedHref` is the URL the page had written for itself when it started to wait. Any later change
 * is navigation by the user and sticks: returning to the same URL (clear a search, close another
 * cell) does not bring the link back.
 */
export function createPendingDeepLink(cell: string, armedHref: string): PendingDeepLink {
  let moved = false;
  return {
    noteUrlWrite(before, after) {
      if (before !== armedHref || after !== before) moved = true;
    },
    claim(currentHref) {
      const untouched = !moved && currentHref === armedHref;
      moved = true;
      return untouched ? cell : null;
    },
  };
}

/** What a rendered color editor was built for. */
export interface ColorEditorMarker {
  readonly cellId: string;
  readonly locale: string;
  readonly count: number;
}

/** The part of an element that remembers the marker. */
export interface ColorEditorHost {
  getAttribute(name: string): string | null;
  setAttribute(name: string, value: string): void;
  removeAttribute(name: string): void;
}

const MARKER_ATTRIBUTE = "data-built-for";

function markerKey(marker: ColorEditorMarker): string {
  return JSON.stringify([marker.cellId, marker.locale, marker.count]);
}

/** Remember what the editor shows now; `null` forgets it while the editor is being rebuilt. */
export function writeColorEditorMarker(
  host: ColorEditorHost,
  marker: ColorEditorMarker | null,
): void {
  if (marker === null) {
    host.removeAttribute(MARKER_ATTRIBUTE);
    return;
  }
  host.setAttribute(MARKER_ATTRIBUTE, markerKey(marker));
}

/**
 * True when the editor on screen was completely built for `wanted` and still holds that many
 * blocks, so it can stay in place with its focus, caret and unfinished text.
 */
export function colorEditorReusable(
  host: ColorEditorHost,
  wanted: ColorEditorMarker,
  renderedBlocks: number,
): boolean {
  return (
    host.getAttribute(MARKER_ATTRIBUTE) === markerKey(wanted) && renderedBlocks === wanted.count
  );
}
