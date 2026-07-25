/**
 * Design-Systems index の取得 (issue #88 / index-paging / ADR-0003)。
 *
 * 1. 任意: ローカル `web-index.json`（E2E / オフライン）
 * 2. 公開 `index-summary.json` を raw main から先読み（ファセット・件数・pageCount）
 * 3. 明細はページシャードを取得（既定: Release `index-pages` の `{n}.json`。
 *    ブラウザ CORS 回避のため Pages は同オリジンミラーを `pageUrl` で渡す）
 * 4. シャード取得失敗時のみ `index.json` 全件へフォールバック（非推奨ログ付き）
 */
import type { DesignIndex, DesignIndexEntry } from "../../src/ds/types.js";
import { parseDesignIndex } from "../../src/ds/validate.js";
import { DS_INDEX_SUMMARY_URL, DS_INDEX_URL, dsIndexPageUrl } from "./lib.js";

/** index-summary.json の 1 ファセット値。 */
export interface IndexFacetCount {
  readonly value: string;
  readonly count: number;
}

/** index-summary.json（entries なし）。 */
export interface IndexSummary {
  readonly version: 1;
  readonly generatedAt: string;
  readonly sourceGeneratedAt: string;
  readonly entryCount: number;
  readonly pageSize: number;
  readonly pageCount: number;
  readonly facets: {
    readonly jsic: readonly IndexFacetCount[];
    readonly color: readonly IndexFacetCount[];
    readonly mood: readonly IndexFacetCount[];
    readonly tag: readonly IndexFacetCount[];
  };
}

/** 明細の取得経路。 */
export type IndexEntriesSource = "local" | "shards" | "index-fallback";

/** カタログ bootstrap 結果。summary だけで UI を描画できる。 */
export interface CatalogBootstrap {
  readonly summary: IndexSummary;
  readonly entries: readonly DesignIndexEntry[];
  readonly entriesSource: IndexEntriesSource;
}

export interface LoadCatalogOptions {
  readonly fetcher?: typeof fetch;
  readonly warn?: (message: string) => void;
  /** ローカル web-index.json を試すか。既定 true（E2E / オフライン）。 */
  readonly tryLocalWebIndex?: boolean;
  readonly localWebIndexUrl?: string;
  readonly summaryUrl?: string;
  readonly indexUrl?: string;
  readonly pageUrl?: (page: number) => string;
}

export const INDEX_FULL_FETCH_DEPRECATED =
  "[GoDD Matrix] Release `index-pages` のページシャード取得に失敗したため index.json 全件取得にフォールバックしています（非推奨）。https://github.com/AutoDevJapan/GoDD-Design-Systems/blob/main/documents/spec/index-paging.md";

const EMPTY_FACETS: IndexSummary["facets"] = {
  jsic: [],
  color: [],
  mood: [],
  tag: [],
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireNonNegInt(obj: Record<string, unknown>, key: string): number {
  const value = obj[key];
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    throw new Error(`index-summary: "${key}" は 0 以上の整数である必要があります`);
  }
  return value;
}

function requireIsoString(obj: Record<string, unknown>, key: string): string {
  const value = obj[key];
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`index-summary: "${key}" は非空文字列である必要があります`);
  }
  return value;
}

function parseFacetList(raw: unknown, axis: string): IndexFacetCount[] {
  if (!Array.isArray(raw)) {
    throw new Error(`index-summary: facets.${axis} は配列である必要があります`);
  }
  return raw.map((item, i) => {
    if (!isRecord(item)) {
      throw new Error(`index-summary: facets.${axis}[${i}] はオブジェクトである必要があります`);
    }
    const value = item.value;
    const count = item.count;
    if (typeof value !== "string" || value.length === 0) {
      throw new Error(`index-summary: facets.${axis}[${i}].value が不正です`);
    }
    if (typeof count !== "number" || !Number.isInteger(count) || count < 1) {
      throw new Error(`index-summary: facets.${axis}[${i}].count が不正です`);
    }
    return { value, count };
  });
}

/** 任意 JSON を {@link IndexSummary} に検証する。不正時は Error。 */
export function parseIndexSummary(raw: unknown): IndexSummary {
  if (!isRecord(raw)) {
    throw new Error("index-summary はオブジェクトである必要があります");
  }
  if (raw.version !== 1) {
    throw new Error('index-summary: "version" は 1 である必要があります');
  }
  if (!isRecord(raw.facets)) {
    throw new Error('index-summary: "facets" はオブジェクトである必要があります');
  }
  const entryCount = requireNonNegInt(raw, "entryCount");
  const pageSize = requireNonNegInt(raw, "pageSize");
  if (pageSize !== 1000) {
    throw new Error('index-summary: "pageSize" は 1000 である必要があります');
  }
  const pageCount = requireNonNegInt(raw, "pageCount");
  const expectedPages = entryCount === 0 ? 0 : Math.ceil(entryCount / pageSize);
  if (pageCount !== expectedPages) {
    throw new Error(
      `index-summary: pageCount (${pageCount}) が ceil(entryCount/pageSize)=${expectedPages} と不一致です`,
    );
  }
  return {
    version: 1,
    generatedAt: requireIsoString(raw, "generatedAt"),
    sourceGeneratedAt: requireIsoString(raw, "sourceGeneratedAt"),
    entryCount,
    pageSize,
    pageCount,
    facets: {
      jsic: parseFacetList(raw.facets.jsic, "jsic"),
      color: parseFacetList(raw.facets.color, "color"),
      mood: parseFacetList(raw.facets.mood, "mood"),
      tag: parseFacetList(raw.facets.tag, "tag"),
    },
  };
}

/** entries から最小 summary を合成する（ローカル web-index / フォールバック用）。 */
export function summaryFromEntries(
  entries: readonly DesignIndexEntry[],
  generatedAt = "1970-01-01T00:00:00.000Z",
): IndexSummary {
  const entryCount = entries.length;
  const pageSize = 1000;
  return {
    version: 1,
    generatedAt,
    sourceGeneratedAt: generatedAt,
    entryCount,
    pageSize,
    pageCount: entryCount === 0 ? 0 : Math.ceil(entryCount / pageSize),
    facets: EMPTY_FACETS,
  };
}

async function fetchJson(
  fetcher: typeof fetch,
  url: string,
): Promise<{ ok: true; data: unknown } | { ok: false; status: number }> {
  const response = await fetcher(url, { cache: "no-cache" });
  if (!response.ok) return { ok: false, status: response.status };
  return { ok: true, data: await response.json() };
}

async function loadLocalWebIndex(
  fetcher: typeof fetch,
  url: string,
): Promise<DesignIndex | undefined> {
  try {
    const response = await fetcher(url, { cache: "no-cache" });
    if (!response.ok) return undefined;
    return parseDesignIndex(await response.text());
  } catch {
    return undefined;
  }
}

async function fetchSummary(fetcher: typeof fetch, url: string): Promise<IndexSummary | undefined> {
  try {
    const result = await fetchJson(fetcher, url);
    if (!result.ok) return undefined;
    return parseIndexSummary(result.data);
  } catch {
    return undefined;
  }
}

async function loadEntriesFromShards(
  fetcher: typeof fetch,
  summary: IndexSummary,
  pageUrl: (page: number) => string,
): Promise<DesignIndexEntry[] | undefined> {
  if (summary.pageCount <= 0) return [];

  const first = await fetchJson(fetcher, pageUrl(0));
  if (!first.ok) return undefined;

  const pages: unknown[] = [first.data];
  for (let page = 1; page < summary.pageCount; page++) {
    const next = await fetchJson(fetcher, pageUrl(page));
    if (!next.ok) return undefined;
    pages.push(next.data);
  }

  const entries: DesignIndexEntry[] = [];
  for (const [i, raw] of pages.entries()) {
    if (!isRecord(raw) || !Array.isArray(raw.entries)) return undefined;
    if (typeof raw.page === "number" && raw.page !== i) return undefined;
    const index = parseDesignIndex(
      JSON.stringify({
        version: 1,
        generatedAt: typeof raw.generatedAt === "string" ? raw.generatedAt : summary.generatedAt,
        entries: raw.entries,
      }),
    );
    entries.push(...index.entries);
  }

  if (entries.length !== summary.entryCount) return undefined;
  return entries;
}

async function loadFullIndexDeprecated(
  fetcher: typeof fetch,
  url: string,
  warn: (message: string) => void,
): Promise<DesignIndex> {
  warn(INDEX_FULL_FETCH_DEPRECATED);
  const response = await fetcher(url, { cache: "no-cache" });
  if (!response.ok) {
    throw new Error(`index.json の取得に失敗しました: HTTP ${response.status}`);
  }
  return parseDesignIndex(await response.text());
}

async function resolveEntries(
  summary: IndexSummary,
  options: Required<Pick<LoadCatalogOptions, "fetcher" | "warn" | "indexUrl" | "pageUrl">>,
): Promise<{ entries: readonly DesignIndexEntry[]; entriesSource: IndexEntriesSource }> {
  const fromShards = await loadEntriesFromShards(options.fetcher, summary, options.pageUrl);
  if (fromShards) {
    return { entries: fromShards, entriesSource: "shards" };
  }
  const full = await loadFullIndexDeprecated(options.fetcher, options.indexUrl, options.warn);
  return { entries: full.entries, entriesSource: "index-fallback" };
}

function resolveOptions(options: LoadCatalogOptions): {
  fetcher: typeof fetch;
  warn: (message: string) => void;
  tryLocal: boolean;
  localUrl: string;
  summaryUrl: string;
  indexUrl: string;
  pageUrl: (page: number) => string;
} {
  return {
    fetcher: options.fetcher ?? fetch,
    warn: options.warn ?? ((message) => console.warn(message)),
    tryLocal: options.tryLocalWebIndex !== false,
    localUrl: options.localWebIndexUrl ?? "web-index.json",
    summaryUrl: options.summaryUrl ?? DS_INDEX_SUMMARY_URL,
    indexUrl: options.indexUrl ?? DS_INDEX_URL,
    pageUrl: options.pageUrl ?? dsIndexPageUrl,
  };
}

/**
 * カタログ用 index を summary 先読みで取得する。
 * summary が取れればファセット/件数は entries 無しでも利用可能。
 */
export async function loadCatalogIndex(
  options: LoadCatalogOptions = {},
): Promise<CatalogBootstrap> {
  const opts = resolveOptions(options);

  if (opts.tryLocal) {
    const local = await loadLocalWebIndex(opts.fetcher, opts.localUrl);
    if (local) {
      return {
        summary: summaryFromEntries(local.entries, local.generatedAt),
        entries: local.entries,
        entriesSource: "local",
      };
    }
  }

  const summary = await fetchSummary(opts.fetcher, opts.summaryUrl);
  if (summary) {
    const resolved = await resolveEntries(summary, opts);
    return { summary, ...resolved };
  }

  const full = await loadFullIndexDeprecated(opts.fetcher, opts.indexUrl, opts.warn);
  return {
    summary: summaryFromEntries(full.entries, full.generatedAt),
    entries: full.entries,
    entriesSource: "index-fallback",
  };
}

/**
 * summary だけ先に返し、明細はバックグラウンドで解決する二相 bootstrap。
 * カタログ UI は summary 到着時点でファセット/総件数を描画できる。
 */
export async function loadCatalogBootstrap(options: LoadCatalogOptions = {}): Promise<{
  readonly summary: IndexSummary;
  readonly entriesSource: IndexEntriesSource | "pending";
  readonly entriesPromise: Promise<CatalogBootstrap>;
}> {
  const opts = resolveOptions(options);

  if (opts.tryLocal) {
    const local = await loadLocalWebIndex(opts.fetcher, opts.localUrl);
    if (local) {
      const boot: CatalogBootstrap = {
        summary: summaryFromEntries(local.entries, local.generatedAt),
        entries: local.entries,
        entriesSource: "local",
      };
      return {
        summary: boot.summary,
        entriesSource: "local",
        entriesPromise: Promise.resolve(boot),
      };
    }
  }

  const summary = await fetchSummary(opts.fetcher, opts.summaryUrl);
  if (!summary) {
    const entriesPromise = loadCatalogIndex({ ...options, tryLocalWebIndex: false });
    const boot = await entriesPromise;
    return {
      summary: boot.summary,
      entriesSource: boot.entriesSource,
      entriesPromise,
    };
  }

  const entriesPromise = resolveEntries(summary, opts).then((resolved) => ({
    summary,
    ...resolved,
  }));

  return {
    summary,
    entriesSource: "pending",
    entriesPromise,
  };
}
