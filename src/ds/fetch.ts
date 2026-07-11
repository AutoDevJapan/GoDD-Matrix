/**
 * ローカルパス / file: / http(s) URL からテキストを取得する共通ヘルパ。
 * index 取込 (client.ts) と DESIGN.md 本文取得 (design.ts) で共有する。
 * 失敗時は DesignIndexError を投げる。
 */
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { DesignIndexError } from "./validate.js";

/** テキスト取得の共通オプション。 */
export interface FetchTextOptions {
  /** fetch 実装の差替 (テスト用)。既定はグローバル fetch。 */
  fetchImpl?: typeof fetch;
  /** ネットワーク取込の中断シグナル。 */
  signal?: AbortSignal;
}

/** 取得元が http(s) URL かどうか。 */
export function isHttpUrl(source: string): boolean {
  return /^https?:\/\//.test(source);
}

/**
 * 取得元 (ローカルパス / file: / http(s) URL) からテキストを取得する。
 * @throws DesignIndexError 取得に失敗した場合。
 */
export async function fetchText(source: string, opts: FetchTextOptions = {}): Promise<string> {
  if (isHttpUrl(source)) {
    const fetchImpl = opts.fetchImpl ?? globalThis.fetch;
    if (typeof fetchImpl !== "function") {
      throw new DesignIndexError("fetch が利用できません。fetchImpl を指定してください");
    }
    const res = await fetchImpl(source, { signal: opts.signal });
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
