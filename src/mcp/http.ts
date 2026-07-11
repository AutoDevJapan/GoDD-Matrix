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

/** JSON レスポンスを生成する小さなヘルパ。 */
function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
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

  let runtimePromise: Promise<MatrixRuntime> | undefined;

  async function resolveRuntime(): Promise<MatrixRuntime> {
    if (!runtimePromise) runtimePromise = runtimeFactory();
    try {
      return await runtimePromise;
    } catch (err) {
      runtimePromise = undefined; // env 修正後に再試行できるようにする
      const message = err instanceof Error ? err.message : String(err);
      return createUnavailableRuntime(message);
    }
  }

  function isAuthorized(req: Request): boolean {
    if (!apiKey) return true;
    const provided = req.headers.get(API_KEY_HEADER);
    return provided !== null && constantTimeEqual(provided, apiKey);
  }

  return async function handleMcp(req: Request): Promise<Response> {
    if (!isAuthorized(req)) {
      return jsonResponse(
        {
          jsonrpc: "2.0",
          error: { code: -32001, message: "認証に失敗しました (x-api-key)" },
          id: null,
        },
        401,
      );
    }

    const runtime = await resolveRuntime();
    const server = createMatrixServer(runtime);
    // stateless: セッションを持たず、リクエスト毎に完結させる (サーバレス向け)。
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    try {
      await server.connect(transport);
      return await transport.handleRequest(req);
    } finally {
      // リクエスト完結後にサーバ/トランスポートを閉じ、リソースを解放する。
      await transport.close().catch(() => {});
      await server.close().catch(() => {});
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
