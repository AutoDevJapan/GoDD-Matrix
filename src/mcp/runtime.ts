/**
 * MCP サーバの実行時依存 ({@link MatrixRuntime}) を環境から構築する (issue #7)。
 *
 * 副作用 (index 取込・本文 fetch クライアント生成) はここに集約する。
 * - index 取込元: 引数 or 環境変数 {@link DS_INDEX_ENV} (`GODD_DS_INDEX`)。
 *   ローカルパス / file: / http(s) URL を受け付ける ({@link DesignIndexClient.load} 規約)。
 * - DESIGN.md 本文の解決 base: 引数 or 環境変数 {@link DS_BASE_ENV} (`GODD_DS_BASE`)。
 *   未指定なら index 取込元の所在 (親ディレクトリ / 親 URL) を既定に採用する。
 * - 正式配布 (snapshot pin 指定): index はバイト同一性と件数を pin に照合してから解釈し、
 *   本文は必ず hash 検証する (requireHash 強制)。取得先を変えても検証は外れない。
 *   軸の語彙 (taxonomy / jsic) も同じ pin に照合してから解釈し、色・ムード・業種の resolver を
 *   その全件から作る (最小表ではなく、index が持つ実カタログと同じ commit の語彙)。
 *   取得先の既定は pin の commit に固定した raw URL。
 */
import path from "node:path";
import { loadPinnedCatalogs, toAxisResolvers } from "../ds/catalogs.js";
import { DS_INDEX_ENV, DesignIndexClient, type LoadOptions } from "../ds/client.js";
import {
  DesignBodyClient,
  type DesignBodyOptions,
  type DesignRenderer,
  DesignResolver,
} from "../ds/design.js";
import { type FetchTextOptions, isHttpUrl } from "../ds/fetch.js";
import {
  type DsSnapshotPin,
  snapshotIndexUrl,
  snapshotProvenance,
  snapshotRawBase,
} from "../ds/snapshot.js";
import { GeneratorRenderClient, type GeneratorRenderClientOptions } from "../generator/index.js";
import type { MatrixRuntime } from "./tools.js";

/** DESIGN.md 本文の解決 base を差し替える環境変数名。 */
export const DS_BASE_ENV = "GODD_DS_BASE";

/** {@link createRuntime} のオプション (テスト / 明示指定用)。 */
export interface RuntimeOptions {
  /** index 取込元。省略時は環境変数 GODD_DS_INDEX (snapshot 指定時は pin の raw URL)。 */
  indexSource?: string;
  /** DESIGN.md 本文の解決 base。省略時は GODD_DS_BASE、なければ index 取込元から推定 (snapshot 指定時は pin の raw URL)。 */
  bodyBase?: string;
  /** index 取込の挙動 (fetch 差替 / キャッシュ等)。 */
  loadOptions?: LoadOptions;
  /** 本文 fetch の挙動 (fetch 差替 / hash 検証等)。 */
  bodyOptions?: DesignBodyOptions;
  /**
   * 未材化セルの Generator レンダー ({@link DesignRenderer})。
   * 明示指定なら最優先。省略時は環境変数 (GENERATOR_RENDER_URL / _API_KEY) から
   * 構築を試み、未設定なら renderer 無し (未材化は `unavailable`) にフォールバックする。
   */
  renderer?: DesignRenderer;
  /** env から renderer を構築する際の追加設定 (タイムアウト / fetch 差替等)。 */
  rendererOptions?: Partial<GeneratorRenderClientOptions>;
  /**
   * 正式配布の snapshot pin。指定時は index のバイト同一性・件数を検証し、
   * 本文の hash 検証を強制する (bodyOptions.requireHash の指定は上書きされる)。
   * 軸の語彙 (taxonomy / jsic) も pin に照合して取り込む。
   */
  snapshot?: DsSnapshotPin;
  /** snapshot 指定時の taxonomy.json の取得元 (同梱ファイル)。省略時は pin の raw URL。 */
  taxonomySource?: string;
  /** snapshot 指定時の jsic.json の取得元 (同梱ファイル)。省略時は pin の raw URL。 */
  jsicSource?: string;
  /** 語彙 (taxonomy / jsic) 取得の挙動。省略時は loadOptions の fetchImpl / signal を使う。 */
  catalogOptions?: FetchTextOptions;
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
 * @throws Error index 取込元が未指定のとき。snapshot 指定時は index が pin に一致しないとき。
 */
export async function createRuntime(opts: RuntimeOptions = {}): Promise<MatrixRuntime> {
  const pin = opts.snapshot;
  const indexSource =
    opts.indexSource ?? process.env[DS_INDEX_ENV] ?? (pin ? snapshotIndexUrl(pin) : undefined);
  if (!indexSource) {
    throw new Error(
      `index 取込元が未指定です。引数または環境変数 ${DS_INDEX_ENV} を設定してください`,
    );
  }
  const bodyBase =
    opts.bodyBase ??
    process.env[DS_BASE_ENV] ??
    (pin ? snapshotRawBase(pin) : deriveBase(indexSource));

  const catalogFetch: FetchTextOptions = {
    ...(opts.loadOptions?.fetchImpl ? { fetchImpl: opts.loadOptions.fetchImpl } : {}),
    ...(opts.loadOptions?.signal ? { signal: opts.loadOptions.signal } : {}),
    ...opts.catalogOptions,
  };
  const [index, catalogs] = await Promise.all([
    DesignIndexClient.load(indexSource, {
      ...opts.loadOptions,
      ...(pin ? { pin } : {}),
    }),
    pin
      ? loadPinnedCatalogs(pin, {
          ...catalogFetch,
          ...(opts.taxonomySource !== undefined ? { taxonomySource: opts.taxonomySource } : {}),
          ...(opts.jsicSource !== undefined ? { jsicSource: opts.jsicSource } : {}),
        })
      : undefined,
  ]);
  const body = new DesignBodyClient(bodyBase, {
    ...opts.bodyOptions,
    ...(pin ? { requireHash: true } : {}),
  });
  const renderer = opts.renderer ?? GeneratorRenderClient.fromEnv(opts.rendererOptions);
  const resolver = new DesignResolver(index, body, renderer);
  return pin && catalogs
    ? { index, resolver, axes: toAxisResolvers(catalogs), snapshot: snapshotProvenance(pin) }
    : { index, resolver };
}
