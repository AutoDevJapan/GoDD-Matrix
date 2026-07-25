/**
 * URL state for virtual catalog browse (issue #71).
 * Preserves search / filter / sort / cursor; cell permalink remains orthogonal.
 */
import { parseMultiParam, serializeMultiParam } from "./filter-taxonomy.js";
import { CELL_PARAM } from "./lib.js";
import type { ResultSortOrder } from "./result-sorting.js";

export const URL_PARAM_Q = "q";
export const URL_PARAM_CATEGORY = "cat";
export const URL_PARAM_STYLE = "style";
export const URL_PARAM_INDUSTRY = "ind";
export const URL_PARAM_JOB = "job";
export const URL_PARAM_COLOR = "color";
export const URL_PARAM_SORT = "sort";
export const URL_PARAM_CURSOR = "cursor";

export interface CatalogUrlState {
  readonly q: string;
  readonly categories: readonly string[];
  readonly styles: readonly string[];
  readonly industries: readonly string[];
  readonly verticals: readonly string[];
  readonly colors: readonly string[];
  readonly sort: ResultSortOrder;
  readonly cursor: string | null;
  readonly cell: string | null;
}

export const EMPTY_CATALOG_URL_STATE: CatalogUrlState = {
  q: "",
  categories: [],
  styles: [],
  industries: [],
  verticals: [],
  colors: [],
  sort: "popular",
  cursor: null,
  cell: null,
};

function setMultiParam(params: URLSearchParams, key: string, values: readonly string[]): void {
  const serialized = serializeMultiParam(values);
  if (serialized) params.set(key, serialized);
}

/** Parse browse + cell state from a URL search string. */
export function parseCatalogUrlState(search: string): CatalogUrlState {
  const params = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  const sortRaw = params.get(URL_PARAM_SORT);
  const sort: ResultSortOrder = sortRaw === "newest" ? "newest" : "popular";
  const cursor = params.get(URL_PARAM_CURSOR);
  const cell = params.get(CELL_PARAM);
  return {
    q: params.get(URL_PARAM_Q) ?? "",
    categories: parseMultiParam(params.get(URL_PARAM_CATEGORY)),
    styles: parseMultiParam(params.get(URL_PARAM_STYLE)),
    industries: parseMultiParam(params.get(URL_PARAM_INDUSTRY)),
    verticals: parseMultiParam(params.get(URL_PARAM_JOB)),
    colors: parseMultiParam(params.get(URL_PARAM_COLOR)),
    sort,
    cursor: cursor && cursor.length > 0 ? cursor : null,
    cell: cell && cell.length > 0 ? cell : null,
  };
}

/**
 * Serialize browse state into a query string (leading `?` when non-empty).
 * Omits defaults so shared URLs stay short. `cell` is included only when provided.
 */
export function buildCatalogUrlSearch(state: CatalogUrlState): string {
  const params = new URLSearchParams();
  if (state.q.trim()) params.set(URL_PARAM_Q, state.q);
  setMultiParam(params, URL_PARAM_CATEGORY, state.categories);
  setMultiParam(params, URL_PARAM_STYLE, state.styles);
  setMultiParam(params, URL_PARAM_INDUSTRY, state.industries);
  setMultiParam(params, URL_PARAM_JOB, state.verticals);
  setMultiParam(params, URL_PARAM_COLOR, state.colors);
  if (state.sort !== "popular") params.set(URL_PARAM_SORT, state.sort);
  if (state.cursor) params.set(URL_PARAM_CURSOR, state.cursor);
  if (state.cell) params.set(CELL_PARAM, state.cell);
  const encoded = params.toString();
  return encoded ? `?${encoded}` : "";
}

/** Apply browse state onto an absolute page URL (pathname preserved, hash cleared). */
export function applyCatalogUrlState(pageUrl: string, state: CatalogUrlState): string {
  const url = new URL(pageUrl);
  url.search = buildCatalogUrlSearch(state);
  url.hash = "";
  return url.toString();
}
