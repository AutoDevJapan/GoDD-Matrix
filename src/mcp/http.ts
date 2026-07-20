/**
 * GoDD-Matrix MCP サーバの Streamable HTTP トランスポート (issue #8, SSOT §5)。
 *
 * 既存の {@link createMatrixServer}（3 ツール）を、Web 標準 (Request / Response) の
 * Streamable HTTP トランスポートで公開する。stdio エントリ（#7 `main.ts`）は維持し、
 * こちらは Vercel Function など「URL でホストする」実行形態のためのハンドラを提供する。
 *
 * - 状態を持たない (stateless) モード: リクエストごとに MCP サーバ + トランスポートを
 *   生成し、セッションを永続化しない。サーバレス / 水平スケールに馴染む。
 * - 認証: `x-api-key` ヘッダの薄い層。期待値は環境変数 {@link MCP_API_KEY_ENV}
 *   (`GODD_MCP_API_KEY`)。未設定なら認証は無効 (誰でも到達可能)。
 * - ヘルスチェック ({@link handleHealth}) は認証不要で 200 を返す。
 * - ランタイム (index 取込等) は遅延生成しキャッシュする。生成に失敗しても
 *   `initialize` / `tools/list` は応答でき、ツール実行時のみ明確なエラーを返す。
 *
 * Vercel などファイルベースルーティングでは {@link createMcpRequestHandler} /
 * {@link handleHealth} を各エンドポイント関数から個別に呼ぶ。ローカルサーバや
 * テストでは {@link createHttpHandler} がパスで両者を振り分ける。
 */
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { VERSION } from "../version.js";
import { type Logger, createConsoleLogger, newRequestId } from "./logger.js";
import { createRuntime } from "./runtime.js";
import { createMatrixServer } from "./server.js";
import type { MatrixRuntime } from "./tools.js";

/** `x-api-key` の期待値を差し替える環境変数名。 */
export const MCP_API_KEY_ENV = "GODD_MCP_API_KEY";

/** 認証に用いるリクエストヘッダ名 (小文字)。 */
export const API_KEY_HEADER = "x-api-key";

/** 既定の MCP エンドポイントパス。 */
export const DEFAULT_MCP_PATH = "/mcp";

/** 既定のヘルスチェックパス。 */
export const DEFAULT_HEALTH_PATH = "/health";

/** リクエストボディ上限 (bytes) を差し替える環境変数名。 */
export const MAX_BODY_BYTES_ENV = "GODD_MCP_MAX_BODY_BYTES";

/** リクエストボディの既定上限 (1 MiB)。JSON-RPC の MCP リクエストには十分。 */
export const DEFAULT_MAX_BODY_BYTES = 1_048_576;

/**
 * リクエストボディ上限 (bytes) を決定する。明示指定 > 環境変数 > 既定の順。
 * 正の有限値のみ採用し、不正値は既定にフォールバックする。
 */
export function resolveMaxBodyBytes(explicit?: number): number {
  if (explicit !== undefined && Number.isFinite(explicit) && explicit > 0) return explicit;
  const raw = process.env[MAX_BODY_BYTES_ENV];
  if (raw !== undefined) {
    const parsed = Number.parseInt(raw, 10);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  return DEFAULT_MAX_BODY_BYTES;
}

/** MCP リクエストハンドラのオプション。 */
export interface McpHandlerOptions {
  /**
   * `x-api-key` の期待値。未指定 (undefined / 空文字) なら認証は無効化する。
   * 省略時は環境変数 {@link MCP_API_KEY_ENV} を参照する。
   */
  apiKey?: string;
  /**
   * MatrixRuntime のファクトリ (遅延生成)。省略時は環境変数から {@link createRuntime}。
   * テストではインメモリ実装を注入できる。
   */
  runtimeFactory?: () => Promise<MatrixRuntime>;
  /**
   * リクエストボディの最大バイト数。宣言値と実際のストリームの双方を検査する。
   * 省略時は環境変数 {@link MAX_BODY_BYTES_ENV} / 既定 {@link DEFAULT_MAX_BODY_BYTES}。
   */
  maxBodyBytes?: number;
  /**
   * 構造化ログの出力先。省略時は {@link createConsoleLogger} (JSON Lines を console へ)。
   * 認証済み API キー等の秘密はマスク対象として自動登録する。
   */
  logger?: Logger;
}

/** {@link createHttpHandler} のオプション (パス設定を追加)。 */
export interface HttpHandlerOptions extends McpHandlerOptions {
  /** MCP エンドポイントパス。既定は {@link DEFAULT_MCP_PATH}。 */
  mcpPath?: string;
  /** ヘルスチェックパス。既定は {@link DEFAULT_HEALTH_PATH}。 */
  healthPath?: string;
}

/**
 * 定数時間の文字列比較 (タイミング攻撃対策)。長さが異なれば即 false。
 * Web 標準のみで実装し、node:crypto に依存しない (Workers / Deno 等でも動作)。
 */
function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return mismatch === 0;
}

/** JSON レスポンスを生成する小さなヘルパ (追加ヘッダ任意)。 */
function jsonResponse(body: unknown, status: number, headers?: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

/** MCP エンドポイントが応答へ付与する相関 ID ヘッダ名。 */
export const REQUEST_ID_HEADER = "x-request-id";

/** JSON-RPC の method / tool 名を軽量に抽出した観測用メタ。 */
interface RpcMeta {
  method?: string;
  tool?: string;
}

class RequestBodyTooLargeError extends Error {}

/** Read at most maxBytes, then rebuild the request so downstream consumers can parse it normally. */
async function enforceBodyLimit(req: Request, maxBytes: number): Promise<Request> {
  const declared = Number.parseInt(req.headers.get("content-length") ?? "", 10);
  if (Number.isFinite(declared) && declared > maxBytes) throw new RequestBodyTooLargeError();
  if (!req.body) return req;

  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        throw new RequestBodyTooLargeError();
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new Request(req.url, {
    method: req.method,
    headers: req.headers,
    body,
  });
}

/**
 * リクエストボディ (クローン) から JSON-RPC の method / tool を推定する (ログ用)。
 * 本体消費を避けるため clone を読む。パース不能・GET(SSE) は空を返す (握り潰さずログは継続)。
 * バッチ (配列) は先頭要素を代表とする。
 */
async function peekRpcMeta(req: Request): Promise<RpcMeta> {
  if (req.method !== "POST") return {};
  try {
    const text = await req.clone().text();
    if (!text) return {};
    const parsed = JSON.parse(text) as unknown;
    const first = Array.isArray(parsed) ? parsed[0] : parsed;
    if (first === null || typeof first !== "object") return {};
    const obj = first as { method?: unknown; params?: { name?: unknown } };
    const method = typeof obj.method === "string" ? obj.method : undefined;
    const tool = typeof obj.params?.name === "string" ? obj.params.name : undefined;
    return { method, tool };
  } catch {
    return {};
  }
}

/**
 * ツール実行時にのみ「ランタイム未構築」を明示するスタブを作る。
 * `tools/list` はランタイムを参照しないため、この状態でも一覧応答は成立する。
 */
function createUnavailableRuntime(reason: string): MatrixRuntime {
  return new Proxy({} as MatrixRuntime, {
    get(_target, prop) {
      // 実利用される runtime プロパティ (index / resolver) のみで失敗させる。
      // `then` 等はここで undefined を返し、async return での thenable 判定を通す。
      if (prop === "index" || prop === "resolver") {
        throw new Error(`MatrixRuntime を初期化できません: ${reason}`);
      }
      return undefined;
    },
  });
}

/**
 * ヘルスチェック応答 (認証不要)。GET / HEAD で 200、それ以外は 405。
 * パスに依存しないため、任意のエンドポイントから呼べる。
 */
export function handleHealth(req: Request): Response {
  if (req.method !== "GET" && req.method !== "HEAD") {
    return jsonResponse({ error: "method_not_allowed" }, 405);
  }
  return jsonResponse(
    { status: "ok", service: "godd-matrix", version: VERSION, transport: "streamable-http" },
    200,
  );
}

/**
 * MCP エンドポイントハンドラを構築する (パス非依存)。
 * `x-api-key` を検証し、リクエスト毎に stateless な MCP サーバ + トランスポートを
 * 生成して JSON-RPC を処理する。ランタイムはクロージャにキャッシュし、生成失敗時は
 * 次回リクエストで再試行できるようキャッシュを破棄する。
 */
export function createMcpRequestHandler(
  options: McpHandlerOptions = {},
): (req: Request) => Promise<Response> {
  const apiKey = options.apiKey ?? process.env[MCP_API_KEY_ENV];
  const runtimeFactory = options.runtimeFactory ?? (() => createRuntime());
  const maxBodyBytes = resolveMaxBodyBytes(options.maxBodyBytes);
  // API キーはマスク対象として登録し、誤ってログへ漏れないようにする。
  const logger = options.logger ?? createConsoleLogger({ secrets: [apiKey] });

  let runtimePromise: Promise<MatrixRuntime> | undefined;

  async function resolveRuntime(log: Logger): Promise<MatrixRuntime> {
    if (!runtimePromise) runtimePromise = runtimeFactory();
    try {
      return await runtimePromise;
    } catch (err) {
      runtimePromise = undefined; // env 修正後に再試行できるようにする
      const message = err instanceof Error ? err.message : String(err);
      // 黙ってフォールバックせず理由を記録する (ツール実行時に明示エラーへ写像)。
      log.error("mcp.runtime.unavailable", { error: message });
      return createUnavailableRuntime(message);
    }
  }

  function isAuthorized(req: Request): boolean {
    if (!apiKey) return true;
    const provided = req.headers.get(API_KEY_HEADER);
    return provided !== null && constantTimeEqual(provided, apiKey);
  }

  return async function handleMcp(req: Request): Promise<Response> {
    const requestId = newRequestId();
    const log = logger.child({ requestId });
    const startedAt = Date.now();
    const idHeader = { [REQUEST_ID_HEADER]: requestId };
    let boundedReq: Request;
    try {
      boundedReq = await enforceBodyLimit(req, maxBodyBytes);
    } catch (error) {
      if (!(error instanceof RequestBodyTooLargeError)) throw error;
      log.warn("mcp.body.too_large", {
        status: 413,
        durationMs: Date.now() - startedAt,
        maxBodyBytes,
      });
      return jsonResponse(
        {
          jsonrpc: "2.0",
          error: {
            code: -32600,
            message: `リクエストボディが上限 (${maxBodyBytes} bytes) を超えています`,
          },
          id: null,
        },
        413,
        idHeader,
      );
    }

    const meta = await peekRpcMeta(boundedReq);
    log.info("mcp.request.start", { method: meta.method, tool: meta.tool });

    if (!isAuthorized(boundedReq)) {
      log.warn("mcp.auth.failed", {
        status: 401,
        durationMs: Date.now() - startedAt,
        method: meta.method,
        tool: meta.tool,
      });
      return jsonResponse(
        {
          jsonrpc: "2.0",
          error: { code: -32001, message: "認証に失敗しました (x-api-key)" },
          id: null,
        },
        401,
        idHeader,
      );
    }

    const runtime = await resolveRuntime(log);
    const server = createMatrixServer(runtime);
    // stateless: セッションを持たず、リクエスト毎に完結させる (サーバレス向け)。
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    try {
      await server.connect(transport);
      const res = await transport.handleRequest(boundedReq);
      log.info("mcp.request.end", {
        method: meta.method,
        tool: meta.tool,
        status: res.status,
        durationMs: Date.now() - startedAt,
      });
      return res;
    } catch (err) {
      // トランスポート層の想定外例外を握り潰さず記録し、構造化 JSON-RPC エラーを返す。
      const message = err instanceof Error ? err.message : String(err);
      log.error("mcp.request.error", {
        method: meta.method,
        tool: meta.tool,
        status: 500,
        durationMs: Date.now() - startedAt,
        error: message,
      });
      return jsonResponse(
        {
          jsonrpc: "2.0",
          error: { code: -32603, message: "内部エラーが発生しました" },
          id: null,
        },
        500,
        idHeader,
      );
    } finally {
      // リクエスト完結後にサーバ/トランスポートを閉じ、リソースを解放する。
      // 失敗しても応答は成立しているため、握り潰さず warn で記録するに留める。
      await transport.close().catch((err: unknown) => {
        log.warn("mcp.transport.close_failed", {
          error: err instanceof Error ? err.message : String(err),
        });
      });
      await server.close().catch((err: unknown) => {
        log.warn("mcp.server.close_failed", {
          error: err instanceof Error ? err.message : String(err),
        });
      });
    }
  };
}

/**
 * ローカルサーバ / テスト向けの統合ルータ。パス ({@link HttpHandlerOptions.mcpPath}
 * / {@link HttpHandlerOptions.healthPath}) で MCP / health を振り分ける。
 * Vercel 等ファイルベースルーティングでは個別ハンドラを直接使うこと。
 */
export function createHttpHandler(
  options: HttpHandlerOptions = {},
): (req: Request) => Promise<Response> {
  const mcpPath = options.mcpPath ?? DEFAULT_MCP_PATH;
  const healthPath = options.healthPath ?? DEFAULT_HEALTH_PATH;
  const handleMcp = createMcpRequestHandler(options);

  return async function handle(req: Request): Promise<Response> {
    const { pathname } = new URL(req.url);
    if (pathname === healthPath) return handleHealth(req);
    if (pathname === mcpPath) return handleMcp(req);
    return jsonResponse({ error: "not_found", path: pathname }, 404);
  };
}
