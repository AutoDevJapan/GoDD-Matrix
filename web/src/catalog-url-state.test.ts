import { describe, expect, it } from "vitest";
import {
  EMPTY_CATALOG_URL_STATE,
  applyCatalogUrlState,
  buildCatalogUrlSearch,
  parseCatalogUrlState,
} from "./catalog-url-state.js";

describe("catalog URL state", () => {
  it("round-trips search, filters, sort, and cursor", () => {
    const state = {
      q: "dashboard minimal",
      category: "dashboard",
      style: "minimal",
      industry: "saas",
      color: "indigo",
      sort: "newest" as const,
      cursor: "v1.abcd1234.2400",
      cell: null,
    };
    const search = buildCatalogUrlSearch(state);
    expect(search).toContain("q=dashboard");
    expect(search).toContain("cat=dashboard");
    expect(search).toContain("style=minimal");
    expect(search).toContain("ind=saas");
    expect(search).toContain("color=indigo");
    expect(search).toContain("sort=newest");
    expect(search).toContain("cursor=v1.abcd1234.2400");
    expect(parseCatalogUrlState(search)).toEqual(state);
  });

  it("omits popular sort and empty defaults", () => {
    expect(buildCatalogUrlSearch(EMPTY_CATALOG_URL_STATE)).toBe("");
    expect(parseCatalogUrlState("")).toEqual(EMPTY_CATALOG_URL_STATE);
  });

  it("preserves cell alongside browse state", () => {
    const state = {
      ...EMPTY_CATALOG_URL_STATE,
      q: "finance",
      cell: "virtual_6061_white_minimal_cdashboard_sminimal_v0",
    };
    const url = applyCatalogUrlState("https://example.test/GoDD-Matrix/", state);
    expect(url).toContain("cell=virtual_6061_white_minimal_cdashboard_sminimal_v0");
    expect(url).toContain("q=finance");
    expect(parseCatalogUrlState(new URL(url).search).cell).toBe(state.cell);
  });
});
