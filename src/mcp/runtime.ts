/**
 * MCP サーバの実行時依存 ({@link MatrixRuntime}) を環境から構築する (issue #7)。
 *
 * 副作用 (index 取込・本文 fetch クライアント生成) はここに集約する。
 * - index 取込元: 引数 or 環境変数 {@link DS_INDEX_ENV} (`GODD_DS_INDEX`)。
 *   ローカルパス / file: / http(s) URL を受け付ける ({@link DesignIndexClient.load} 規約)。
 * - DESIGN.md 本文の解決 base: 引数 or 環境変数 {@link DS_BASE_ENV} (`GODD_DS_BASE`)。
 *   未指定なら index 取込元の所在 (親ディレクトリ / 親 URL) を既定に採用する。
 */
import path from "node:path";
import { DS_INDEX_ENV, DesignIndexClient, type LoadOptions } from "../ds/client.js";
import { DesignBodyClient, type DesignBodyOptions, DesignResolver } from "../ds/design.js";
import { isHttpUrl } from "../ds/fetch.js";
import type { MatrixRuntime } from "./tools.js";

/** DESIGN.md 本文の解決 base を差し替える環境変数名。 */
export const DS_BASE_ENV = "GODD_DS_BASE";

/** {@link createRuntime} のオプション (テスト / 明示指定用)。 */
export interface RuntimeOptions {
  /** index 取込元。省略時は環境変数 GODD_DS_INDEX。 */
  indexSource?: string;
  /** DESIGN.md 本文の解決 base。省略時は GODD_DS_BASE、なければ index 取込元から推定。 */
  bodyBase?: string;
  /** index 取込の挙動 (fetch 差替 / キャッシュ等)。 */
  loadOptions?: LoadOptions;
  /** 本文 fetch の挙動 (fetch 差替 / hash 検証等)。 */
  bodyOptions?: DesignBodyOptions;
}

/** index 取込元から DESIGN.md 本文 base を推定する (index の所在ディレクトリ)。 */
function deriveBase(indexSource: string): string {
  if (isHttpUrl(indexSource) || indexSource.startsWith("file:")) {
    return new URL(".", indexSource).toString();
  }
  return path.dirname(path.resolve(indexSource));
}

/**
 * 環境 (または明示指定) から {@link MatrixRuntime} を構築する。
 * @throws Error index 取込元が未指定のとき。
 */
export async function createRuntime(opts: RuntimeOptions = {}): Promise<MatrixRuntime> {
  const indexSource = opts.indexSource ?? process.env[DS_INDEX_ENV];
  if (!indexSource) {
    throw new Error(
      `index 取込元が未指定です。引数または環境変数 ${DS_INDEX_ENV} を設定してください`,
    );
  }
  const bodyBase = opts.bodyBase ?? process.env[DS_BASE_ENV] ?? deriveBase(indexSource);

  const index = await DesignIndexClient.load(indexSource, opts.loadOptions);
  const body = new DesignBodyClient(bodyBase, opts.bodyOptions);
  const resolver = new DesignResolver(index, body);
  return { index, resolver };
}
