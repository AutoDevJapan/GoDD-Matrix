import { describe, expect, it, vi } from "vitest";
import {
  INDEX_FULL_FETCH_DEPRECATED,
  loadCatalogBootstrap,
  loadCatalogIndex,
  parseIndexSummary,
  summaryFromEntries,
} from "./index-loader.js";
import { DS_INDEX_PAGES_RELEASE_BASE, dsIndexPageUrl } from "./lib.js";

const ENTRY_A = {
  id: "6061_white_minimal",
  path: "design-md/6061/white/minimal/DESIGN.md",
  jsic: "6061",
  color: "white",
  mood: "minimal",
  title: "Bookstore",
  hash: `sha256:${"a".repeat(64)}`,
  createdAt: "2026-07-21T00:00:00Z",
};
const ENTRY_B = {
  id: "7281_h17b-lt_trustworthy",
  path: "design-md/7281/h17b-lt/trustworthy/DESIGN.md",
  jsic: "7281",
  color: "h17b-lt",
  mood: "trustworthy",
  title: "Consulting",
  hash: `sha256:${"b".repeat(64)}`,
  createdAt: "2026-07-21T00:00:00Z",
};

const SUMMARY = {
  version: 1 as const,
  generatedAt: "2026-07-20T12:34:54.523Z",
  sourceGeneratedAt: "2026-07-20T12:34:54.523Z",
  entryCount: 2,
  pageSize: 1000,
  pageCount: 1,
  facets: {
    jsic: [{ value: "6061", count: 1 }],
    color: [{ value: "white", count: 1 }],
    mood: [{ value: "minimal", count: 1 }],
    tag: [{ value: "editorial", count: 1 }],
  },
};

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("parseIndexSummary", () => {
  it("accepts a valid summary", () => {
    expect(parseIndexSummary(SUMMARY).entryCount).toBe(2);
  });

  it("rejects pageCount mismatch", () => {
    expect(() => parseIndexSummary({ ...SUMMARY, pageCount: 9 })).toThrow(/pageCount/);
  });
});

describe("summaryFromEntries", () => {
  it("computes pageCount from entry length", () => {
    const summary = summaryFromEntries([ENTRY_A, ENTRY_B], "2026-01-01T00:00:00.000Z");
    expect(summary.entryCount).toBe(2);
    expect(summary.pageCount).toBe(1);
    expect(summary.pageSize).toBe(1000);
  });
});

describe("dsIndexPageUrl (Release正本)", () => {
  it("builds GitHub Release download URLs for page shards", () => {
    expect(dsIndexPageUrl(0)).toBe(
      "https://github.com/AutoDevJapan/GoDD-Design-Systems/releases/download/index-pages/0.json",
    );
    expect(dsIndexPageUrl(51)).toBe(`${DS_INDEX_PAGES_RELEASE_BASE}51.json`);
  });
});

describe("loadCatalogIndex", () => {
  it("prefers local web-index when present", async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("web-index.json")) {
        return jsonResponse({ version: 1, entries: [ENTRY_A] });
      }
      throw new Error(`unexpected fetch: ${url}`);
    });
    const warn = vi.fn();
    const boot = await loadCatalogIndex({ fetcher, warn, tryLocalWebIndex: true });
    expect(boot.entriesSource).toBe("local");
    expect(boot.entries).toHaveLength(1);
    expect(warn).not.toHaveBeenCalled();
  });

  it("loads summary then Release page shards without touching index.json", async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("web-index.json")) return new Response(null, { status: 404 });
      if (url.includes("index-summary.json")) return jsonResponse(SUMMARY);
      if (url === dsIndexPageUrl(0) || url.endsWith("/releases/download/index-pages/0.json")) {
        return jsonResponse({
          version: 1,
          page: 0,
          pageSize: 1000,
          entryCount: 2,
          generatedAt: SUMMARY.generatedAt,
          entries: [ENTRY_A, ENTRY_B],
        });
      }
      if (url.includes("index.json") && !url.includes("index-summary")) {
        throw new Error("full index must not be fetched");
      }
      throw new Error(`unexpected fetch: ${url}`);
    });
    const warn = vi.fn();
    const boot = await loadCatalogIndex({ fetcher, warn, tryLocalWebIndex: true });
    expect(boot.entriesSource).toBe("shards");
    expect(boot.summary.facets.mood[0]?.value).toBe("minimal");
    expect(boot.entries.map((e) => e.id)).toEqual([ENTRY_A.id, ENTRY_B.id]);
    expect(warn).not.toHaveBeenCalled();
    expect(fetcher.mock.calls.map(([u]) => String(u))).toContain(dsIndexPageUrl(0));
    expect(
      fetcher.mock.calls.some(
        ([u]) => /(?:^|\/)index\.json(?:\?|$)/.test(String(u)) && !String(u).includes("summary"),
      ),
    ).toBe(false);
  });

  it("falls back to full index.json with a deprecation warning when Release shards fail", async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("web-index.json")) return new Response(null, { status: 404 });
      if (url.includes("index-summary.json")) return jsonResponse(SUMMARY);
      if (url.includes("/releases/download/index-pages/"))
        return new Response(null, { status: 404 });
      if (url.includes("index.json") && !url.includes("index-summary")) {
        return jsonResponse({ version: 1, generatedAt: SUMMARY.generatedAt, entries: [ENTRY_A] });
      }
      throw new Error(`unexpected fetch: ${url}`);
    });
    const warn = vi.fn();
    const boot = await loadCatalogIndex({ fetcher, warn, tryLocalWebIndex: true });
    expect(boot.entriesSource).toBe("index-fallback");
    expect(boot.summary.entryCount).toBe(2);
    expect(boot.entries).toHaveLength(1);
    expect(warn).toHaveBeenCalledWith(INDEX_FULL_FETCH_DEPRECATED);
  });
});

describe("loadCatalogBootstrap", () => {
  it("returns summary before entries resolve (summary-only first paint)", async () => {
    let resolvePage: ((value: Response) => void) | undefined;
    const pageGate = new Promise<Response>((resolve) => {
      resolvePage = resolve;
    });

    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("web-index.json")) return new Response(null, { status: 404 });
      if (url.includes("index-summary.json")) return jsonResponse(SUMMARY);
      if (url === dsIndexPageUrl(0) || url.endsWith("/releases/download/index-pages/0.json")) {
        return pageGate;
      }
      throw new Error(`unexpected fetch: ${url}`);
    });

    const boot = await loadCatalogBootstrap({
      fetcher,
      warn: vi.fn(),
      tryLocalWebIndex: true,
    });

    expect(boot.entriesSource).toBe("pending");
    expect(boot.summary.entryCount).toBe(2);
    expect(boot.summary.facets.jsic[0]?.count).toBe(1);

    resolvePage?.(
      jsonResponse({
        version: 1,
        page: 0,
        pageSize: 1000,
        entryCount: 2,
        generatedAt: SUMMARY.generatedAt,
        entries: [ENTRY_A, ENTRY_B],
      }),
    );

    const resolved = await boot.entriesPromise;
    expect(resolved.entriesSource).toBe("shards");
    expect(resolved.entries).toHaveLength(2);
  });
});
