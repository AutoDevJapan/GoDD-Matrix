/**
 * DESIGN.md 本文 fetch クライアント (issue #3, SSOT §5)。
 * - index の {@link DesignIndexEntry.path} を base に対して解決し、本文を取得する。
 * - 取込元はローカルディレクトリ / file: / http(s) base URL。
 * - 解決済みロケーション単位でインメモリキャッシュ。
 * - index の hash と本文 sha256 の一致を検証 (requireHash で不一致を致命化)。
 * - 未材化セル (index にエントリなし) は「未取得」として表現し、将来の
 *   Generator レンダーへフォールバックする受け口を interface で用意する
 *   (実呼び出しは issue #4)。
 */
import { createHash } from "node:crypto";
import path from "node:path";
import type { AxisContext } from "../axes/index.js";
import type { RenderRequest, RenderResult } from "../generator/index.js";
import type { DesignIndexClient } from "./client.js";
import { type FetchTextOptions, fetchText, isHttpUrl } from "./fetch.js";
import type { DesignIndexEntry } from "./types.js";
import { DesignIndexError } from "./validate.js";

/** DESIGN.md 本文の取得結果。 */
export interface DesignDocument {
  /** 取得したセルの index エントリ。 */
  entry: DesignIndexEntry;
  /** DESIGN.md 本文。 */
  markdown: string;
  /** 解決済みの取得元 (絶対パス / URL)。 */
  source: string;
  /** index の hash と本文 sha256 が一致したか。 */
  hashVerified: boolean;
}

/**
 * 未材化セルのフォールバック描画の受け口 (SSOT §4/§5)。
 * Matrix は partial を内包せず Generator のレンダー API を叩く。
 * 実装は issue #4。ここでは interface のみを定義する。
 */
export interface DesignRenderer {
  render(request: RenderRequest): Promise<RenderResult>;
}

/** DesignBodyClient の挙動オプション。 */
export interface DesignBodyOptions extends FetchTextOptions {
  /** インメモリキャッシュを使うか。既定 true。 */
  cache?: boolean;
  /** hash 不一致時に DesignIndexError を投げるか。既定 false (フラグに反映のみ)。 */
  requireHash?: boolean;
}

/** base の末尾に "/" を補う (URL 相対解決を base 配下に固定するため)。 */
function ensureTrailingSlash(base: string): string {
  return base.endsWith("/") ? base : `${base}/`;
}

/** base (ディレクトリ / file: / http(s)) に対して entry.path を解決する。 */
export function resolveDesignLocation(base: string, entryPath: string): string {
  if (isHttpUrl(base) || base.startsWith("file:")) {
    return new URL(entryPath, ensureTrailingSlash(base)).toString();
  }
  return path.resolve(base, entryPath);
}

/** 本文の sha256 が index の hash (`sha256:{hex}`) に一致するか。 */
export function verifyDesignHash(markdown: string, expected: string): boolean {
  const digest = createHash("sha256").update(markdown, "utf8").digest("hex");
  return `sha256:${digest}` === expected;
}

/**
 * 材化済みセルの DESIGN.md 本文を取得するクライアント。
 * base は index の path が相対解決される起点 (Design-Systems リポジトリのルート)。
 */
export class DesignBodyClient {
  /** path 解決の起点。 */
  readonly base: string;
  private readonly opts: DesignBodyOptions;
  private readonly cache = new Map<string, Promise<DesignDocument>>();

  constructor(base: string, opts: DesignBodyOptions = {}) {
    this.base = base;
    this.opts = opts;
  }

  /** entry の DESIGN.md 取得元を解決する。 */
  resolve(entry: DesignIndexEntry): string {
    return resolveDesignLocation(this.base, entry.path);
  }

  /**
   * entry の DESIGN.md 本文を取得する。既定でロケーション単位にキャッシュする。
   * @throws DesignIndexError 取得失敗、または requireHash 時の hash 不一致。
   */
  async fetch(entry: DesignIndexEntry): Promise<DesignDocument> {
    const source = this.resolve(entry);
    const useCache = this.opts.cache !== false;

    const cached = useCache ? this.cache.get(source) : undefined;
    if (cached) return cached;

    const promise = fetchText(source, this.opts).then((markdown): DesignDocument => {
      const hashVerified = verifyDesignHash(markdown, entry.hash);
      if (this.opts.requireHash && !hashVerified) {
        throw new DesignIndexError(`DESIGN.md の hash 検証に失敗しました: ${entry.id} (${source})`);
      }
      return { entry, markdown, source, hashVerified };
    });

    if (useCache) {
      this.cache.set(source, promise);
      promise.catch(() => this.cache.delete(source));
    }
    return promise;
  }

  /** キャッシュを破棄する (entry 指定でその1件のみ)。 */
  clearCache(entry?: DesignIndexEntry): void {
    if (entry === undefined) {
      this.cache.clear();
    } else {
      this.cache.delete(this.resolve(entry));
    }
  }
}

/** 軸 context から DESIGN.md を解決した結果。 */
export type DesignResolution =
  /** 材化済み: index にエントリがあり本文を取得できた。 */
  | { status: "materialized"; document: DesignDocument }
  /** 未材化だがレンダーで生成した (実装は #4)。 */
  | { status: "rendered"; request: RenderRequest; result: RenderResult }
  /** 未取得: 未材化かつレンダー未設定。 */
  | { status: "unavailable"; request: RenderRequest; reason: string };

/**
 * 軸 context → DESIGN.md を解決する。材化済みなら本文を fetch し、
 * 未材化セルは「未取得」を表現しつつ、renderer があればフォールバック描画する。
 */
export class DesignResolver {
  constructor(
    private readonly index: DesignIndexClient,
    private readonly body: DesignBodyClient,
    private readonly renderer?: DesignRenderer,
  ) {}

  /** ctx に対応する DESIGN.md を解決する。 */
  async resolve(ctx: AxisContext): Promise<DesignResolution> {
    const entry = this.index.byAxis(ctx)[0];
    if (entry) {
      return { status: "materialized", document: await this.body.fetch(entry) };
    }
    if (this.renderer) {
      return { status: "rendered", request: ctx, result: await this.renderer.render(ctx) };
    }
    return {
      status: "unavailable",
      request: ctx,
      reason: "未材化セル: index にエントリがなく、レンダーも未設定です",
    };
  }
}
