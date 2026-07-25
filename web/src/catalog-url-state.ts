/**
 * URL state for virtual catalog browse (issue #71).
 * Preserves search / filter / sort / cursor; cell permalink remains orthogonal.
 */
import { CELL_PARAM } from "./lib.js";
import type { ResultSortOrder } from "./result-sorting.js";

export const URL_PARAM_Q = "q";
export const URL_PARAM_CATEGORY = "cat";
export const URL_PARAM_STYLE = "style";
export const URL_PARAM_INDUSTRY = "ind";
export const URL_PARAM_COLOR = "color";
export const URL_PARAM_SORT = "sort";
export const URL_PARAM_CURSOR = "cursor";

export interface CatalogUrlState {
  readonly q: string;
  readonly category: string | null;
  readonly style: string | null;
  readonly industry: string | null;
  readonly color: string | null;
  readonly sort: ResultSortOrder;
  readonly cursor: string | null;
  readonly cell: string | null;
}

export const EMPTY_CATALOG_URL_STATE: CatalogUrlState = {
  q: "",
  category: null,
  style: null,
  industry: null,
  color: null,
  sort: "popular",
  cursor: null,
  cell: null,
};

function optParam(params: URLSearchParams, key: string): string | null {
  const value = params.get(key);
  return value && value.length > 0 ? value : null;
}

/** Parse browse + cell state from a URL search string. */
export function parseCatalogUrlState(search: string): CatalogUrlState {
  const params = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  const sortRaw = params.get(URL_PARAM_SORT);
  const sort: ResultSortOrder = sortRaw === "newest" ? "newest" : "popular";
  return {
    q: params.get(URL_PARAM_Q) ?? "",
    category: optParam(params, URL_PARAM_CATEGORY),
    style: optParam(params, URL_PARAM_STYLE),
    industry: optParam(params, URL_PARAM_INDUSTRY),
    color: optParam(params, URL_PARAM_COLOR),
    sort,
    cursor: optParam(params, URL_PARAM_CURSOR),
    cell: optParam(params, CELL_PARAM),
  };
}

/**
 * Serialize browse state into a query string (leading `?` when non-empty).
 * Omits defaults so shared URLs stay short. `cell` is included only when provided.
 */
export function buildCatalogUrlSearch(state: CatalogUrlState): string {
  const params = new URLSearchParams();
  if (state.q.trim()) params.set(URL_PARAM_Q, state.q);
  if (state.category) params.set(URL_PARAM_CATEGORY, state.category);
  if (state.style) params.set(URL_PARAM_STYLE, state.style);
  if (state.industry) params.set(URL_PARAM_INDUSTRY, state.industry);
  if (state.color) params.set(URL_PARAM_COLOR, state.color);
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
