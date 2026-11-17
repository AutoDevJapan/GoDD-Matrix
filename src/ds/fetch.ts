/**
 * ローカルパス / file: / http(s) URL からテキスト・バイト列を取得する共通ヘルパ。
 * index 取込 (client.ts) と DESIGN.md 本文取得 (design.ts) で共有する。
 * 失敗時は DesignIndexError を投げる。
 */
import { readFile, stat } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { DesignIndexError } from "./validate.js";

/** テキスト取得の共通オプション。 */
export interface FetchTextOptions {
  /** fetch 実装の差替 (テスト用)。既定はグローバル fetch。 */
  fetchImpl?: typeof fetch;
  /** ネットワーク取込の中断シグナル。 */
  signal?: AbortSignal;
}

/** バイト取得のオプション。 */
export interface FetchBytesOptions extends FetchTextOptions {
  /** 受け入れる最大バイト数。超過は読み切る前に DesignIndexError。既定 {@link DEFAULT_MAX_BYTES}。 */
  maxBytes?: number;
}

/** {@link fetchBytes} の既定の上限 (64 MiB)。 */
export const DEFAULT_MAX_BYTES = 64 * 1024 * 1024;

/** 取得元が http(s) URL かどうか。 */
export function isHttpUrl(source: string): boolean {
  return /^https?:\/\//.test(source);
}

function resolveFetch(opts: FetchTextOptions): typeof fetch {
  const fetchImpl = opts.fetchImpl ?? globalThis.fetch;
  if (typeof fetchImpl !== "function") {
    throw new DesignIndexError("fetch が利用できません。fetchImpl を指定してください");
  }
  return fetchImpl;
}

/**
 * 取得元 (ローカルパス / file: / http(s) URL) からテキストを取得する。
 * @throws DesignIndexError 取得に失敗した場合。
 */
export async function fetchText(source: string, opts: FetchTextOptions = {}): Promise<string> {
  if (isHttpUrl(source)) {
    const res = await resolveFetch(opts)(source, { signal: opts.signal });
    if (!res.ok) {
      throw new DesignIndexError(`リソースの取得に失敗しました (HTTP ${res.status}): ${source}`);
    }
    return res.text();
  }
  const filePath = source.startsWith("file:") ? fileURLToPath(source) : source;
  try {
    return await readFile(filePath, "utf8");
  } catch (cause) {
    throw new DesignIndexError(
      `リソースの読み込みに失敗しました: ${source} (${(cause as Error).message})`,
    );
  }
}

/** 応答本文を、上限を超えた時点で読み切らずに打ち切ってバイト列にする。 */
async function readBounded(res: Response, limit: number, source: string): Promise<Uint8Array> {
  if (!res.body) return new Uint8Array(0);
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > limit) {
        await reader.cancel();
        throw new DesignIndexError(`リソースが上限 (${limit} bytes) を超えています: ${source}`);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

/**
 * 取得元 (ローカルパス / file: / http(s) URL) からバイト列をそのまま取得する。
 * 文字コード変換をしないため、ハッシュ照合 (バイト束縛) に使える。
 * @throws DesignIndexError 取得に失敗した場合、または上限 (maxBytes) を超えた場合。
 */
export async function fetchBytes(
  source: string,
  opts: FetchBytesOptions = {},
): Promise<Uint8Array> {
  const limit = opts.maxBytes ?? DEFAULT_MAX_BYTES;
  if (isHttpUrl(source)) {
    const res = await resolveFetch(opts)(source, { signal: opts.signal });
    if (!res.ok) {
      throw new DesignIndexError(`リソースの取得に失敗しました (HTTP ${res.status}): ${source}`);
    }
    const declared = res.headers.get("content-length");
    const encoding = res.headers.get("content-encoding");
    if (declared !== null && (!encoding || encoding === "identity") && Number(declared) > limit) {
      await res.body?.cancel();
      throw new DesignIndexError(
        `リソースが上限を超えています (content-length ${declared} > ${limit}): ${source}`,
      );
    }
    return readBounded(res, limit, source);
  }
  const filePath = source.startsWith("file:") ? fileURLToPath(source) : source;
  try {
    const info = await stat(filePath);
    if (info.size > limit) {
      throw new DesignIndexError(`リソースが上限 (${limit} bytes) を超えています: ${source}`);
    }
    return new Uint8Array(await readFile(filePath));
  } catch (cause) {
    if (cause instanceof DesignIndexError) throw cause;
    throw new DesignIndexError(
      `リソースの読み込みに失敗しました: ${source} (${(cause as Error).message})`,
    );
  }
}
