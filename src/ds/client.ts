/**
 * Design-Systems `index.json` 取込クライアント (issue #2, SSOT §5)。
 * - ローカルパス / file: / http(s) URL から取込。取込元は環境変数で差替可能。
 * - インメモリキャッシュ (取込元単位。pin 指定時は pin 単位)。
 * - 軸 (業種/カラー/ムード) / タグによる filter/query。
 * - 正式配布: pin 指定時は、バイト同一性 (bytes / sha256 / git blob) と件数を検証してから解釈する。
 */
import type { AxisContext } from "../axes/index.js";
import { fetchBytes, fetchText } from "./fetch.js";
import { type DsSnapshotPin, verifyIndexBytes, verifyIndexEntryCount } from "./snapshot.js";
import type { DesignIndex, DesignIndexEntry } from "./types.js";
import { DesignIndexError, parseDesignIndex } from "./validate.js";

/** 取込元を差し替える環境変数名。値はローカルパスまたは URL。 */
export const DS_INDEX_ENV = "GODD_DS_INDEX";

/** query 条件。指定した軸/タグの AND で絞り込む。未指定の軸は無視。 */
export interface IndexQuery {
  /** JSIC 細分類コード (完全一致)。 */
  jsic?: string;
  /** カラー軸 slug (完全一致)。 */
  color?: string;
  /** ムード軸 slug (完全一致)。 */
  mood?: string;
  /** 指定タグを「すべて」含む (AND)。 */
  tags?: readonly string[];
}

/** load の挙動オプション。 */
export interface LoadOptions {
  /** fetch 実装の差替 (テスト用)。既定はグローバル fetch。 */
  fetchImpl?: typeof fetch;
  /** インメモリキャッシュを使うか。既定 true。 */
  cache?: boolean;
  /** ネットワーク取込の中断シグナル。 */
  signal?: AbortSignal;
  /**
   * 正式配布の pin。指定時は取込んだバイトを pin に照合してから解釈し、
   * 一致しなければ DesignIndexError を投げる (キャッシュも pin 単位)。
   */
  pin?: DsSnapshotPin;
}

const clientCache = new Map<string, Promise<DesignIndexClient>>();

/** pin 違いでキャッシュを共有しないためのキー。 */
function cacheKey(source: string, pin: DsSnapshotPin | undefined): string {
  return pin ? `${source}\0${pin.index.sha256}` : source;
}

function resolveSource(source?: string): string {
  const resolved = source ?? process.env[DS_INDEX_ENV];
  if (!resolved) {
    throw new DesignIndexError(
      `取込元が未指定です。引数または環境変数 ${DS_INDEX_ENV} を設定してください`,
    );
  }
  return resolved;
}

function tagsMatch(entryTags: readonly string[] | undefined, wanted: readonly string[]): boolean {
  if (wanted.length === 0) return true;
  const set = new Set(entryTags ?? []);
  return wanted.every((tag) => set.has(tag));
}

/** pin に照合したバイトだけを解釈して取込む。 */
async function loadPinned(
  source: string,
  pin: DsSnapshotPin,
  opts: LoadOptions,
): Promise<DesignIndexClient> {
  const bytes = await fetchBytes(source, { ...opts, maxBytes: pin.index.bytes });
  verifyIndexBytes(bytes, pin);
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new DesignIndexError("index が UTF-8 として不正です");
  }
  const client = DesignIndexClient.fromJson(text);
  verifyIndexEntryCount(client.size, pin);
  return client;
}

/**
 * 取込済み index を保持し、軸/タグ検索を提供するクライアント。
 */
export class DesignIndexClient {
  readonly index: DesignIndex;
  private readonly byId: Map<string, DesignIndexEntry>;

  constructor(index: DesignIndex) {
    this.index = index;
    this.byId = new Map(index.entries.map((entry) => [entry.id, entry]));
  }

  /** 全エントリ。 */
  get entries(): readonly DesignIndexEntry[] {
    return this.index.entries;
  }

  /** エントリ総数。 */
  get size(): number {
    return this.index.entries.length;
  }

  /** id でエントリを引く。 */
  get(id: string): DesignIndexEntry | undefined {
    return this.byId.get(id);
  }

  /** 軸/タグ条件でエントリを絞り込む。 */
  query(q: IndexQuery = {}): DesignIndexEntry[] {
    const tags = q.tags ?? [];
    return this.index.entries.filter((entry) => {
      if (q.jsic !== undefined && entry.jsic !== q.jsic) return false;
      if (q.color !== undefined && entry.color !== q.color) return false;
      if (q.mood !== undefined && entry.mood !== q.mood) return false;
      return tagsMatch(entry.tags, tags);
    });
  }

  /** AxisContext から候補セルを引く (query の糖衣)。 */
  byAxis(ctx: AxisContext): DesignIndexEntry[] {
    return this.query({
      jsic: ctx.jsic,
      color: ctx.color,
      mood: ctx.mood,
      tags: ctx.tags,
    });
  }

  /** JSON 文字列から構築する。 */
  static fromJson(text: string): DesignIndexClient {
    return new DesignIndexClient(parseDesignIndex(text));
  }

  /**
   * 取込元 (ローカルパス / file: / http(s) URL) から取込む。
   * source 省略時は環境変数 GODD_DS_INDEX を使用。既定でキャッシュする。
   * opts.pin 指定時はバイト同一性と件数を検証する (正式配布)。
   */
  static async load(source?: string, opts: LoadOptions = {}): Promise<DesignIndexClient> {
    const resolved = resolveSource(source);
    const useCache = opts.cache !== false;
    const key = cacheKey(resolved, opts.pin);

    const cached = useCache ? clientCache.get(key) : undefined;
    if (cached) return cached;

    const promise = opts.pin
      ? loadPinned(resolved, opts.pin, opts)
      : fetchText(resolved, opts).then((text) => DesignIndexClient.fromJson(text));

    if (useCache) {
      clientCache.set(key, promise);
      promise.catch(() => clientCache.delete(key));
    }
    return promise;
  }

  /** キャッシュを破棄する (取込元を指定すればその取込元のみ。pin 違いの分も含む)。 */
  static clearCache(source?: string): void {
    if (source === undefined) {
      clientCache.clear();
      return;
    }
    for (const key of [...clientCache.keys()]) {
      if (key === source || key.startsWith(`${source}\0`)) clientCache.delete(key);
    }
  }
}
