/**
 * Generator レンダー API クライアント実装 (issue #4, SSOT §4/§5)。
 *
 * Matrix は partial (moat) を内包せず、Generator の private レンダー API を
 * 叩くだけで未材化セルの DESIGN.md 本文を得る。本クライアントは
 * {@link DesignRenderer} を実装し、{@link DesignResolver} に注入されて
 * 未材化セルの `rendered` フォールバックに接続される。
 *
 * API 契約:
 * - `POST {baseUrl}/render` : 認証ヘッダ `x-api-key: <apiKey>`。
 *   body は flat な軸 context `{ jsic, color, mood, tags? }`。
 *   レスポンス `{ markdown, document, selection, validation }`。
 * - `GET {baseUrl}/health` : 200 で疎通確認。
 *
 * 認証情報・エンドポイントは環境変数から注入し、値はリポジトリに残さない。
 */
import type { DesignRenderer } from "../ds/design.js";
import type { RenderRequest, RenderResult } from "./index.js";

/** レンダー API のベース URL を注入する環境変数名。 */
export const GENERATOR_RENDER_URL_ENV = "GENERATOR_RENDER_URL";
/** レンダー API の認証キー (x-api-key) を注入する環境変数名。 */
export const GENERATOR_RENDER_API_KEY_ENV = "GENERATOR_RENDER_API_KEY";

/** {@link GeneratorRenderError} の分類。 */
export type GeneratorRenderErrorKind =
  /** 認証失敗 (401/403)。リトライ不可。 */
  | "auth"
  /** 不正リクエスト (4xx, 認証以外)。リトライ不可。 */
  | "request"
  /** サーバエラー (5xx)。リトライ対象。 */
  | "server"
  /** タイムアウト (timeoutMs 超過)。リトライ対象。 */
  | "timeout"
  /** ネットワーク / fetch 例外。リトライ対象。 */
  | "network"
  /** レスポンス本文が契約に反する (markdown 欠落等)。リトライ不可。 */
  | "response";

/** レンダー API 呼び出しの失敗。分類と (あれば) HTTP ステータスを保持する。 */
export class GeneratorRenderError extends Error {
  readonly kind: GeneratorRenderErrorKind;
  readonly status?: number;

  constructor(
    kind: GeneratorRenderErrorKind,
    message: string,
    options?: { status?: number; cause?: unknown },
  ) {
    super(message, options?.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = "GeneratorRenderError";
    this.kind = kind;
    this.status = options?.status;
  }

  /** このエラーがリトライ対象か (5xx / timeout / network)。 */
  get retryable(): boolean {
    return this.kind === "server" || this.kind === "timeout" || this.kind === "network";
  }
}

/** {@link GeneratorRenderClient} の挙動オプション。 */
export interface GeneratorRenderClientOptions {
  /** レンダー API のベース URL (例: `https://generator.example/api`)。 */
  baseUrl: string;
  /** 認証キー (x-api-key ヘッダに載せる)。 */
  apiKey: string;
  /** fetch 実装の差替 (テスト用)。既定はグローバル fetch。 */
  fetchImpl?: typeof fetch;
  /** 1 リクエストあたりのタイムアウト (ms)。既定 30000。 */
  timeoutMs?: number;
  /** リトライ回数 (5xx / timeout / network に対して)。既定 2。 */
  retries?: number;
  /** リトライ間隔 (ms)。試行ごとに線形バックオフ。既定 250。 */
  retryDelayMs?: number;
  /** 外部からの中断シグナル (タイムアウトとは独立に合流させる)。 */
  signal?: AbortSignal;
}

/** ミリ秒スリープ (リトライバックオフ用)。 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** レスポンス JSON から {@link RenderResult} を組み立てる。markdown 欠落は response エラー。 */
function toRenderResult(data: unknown, source: string): RenderResult {
  if (typeof data !== "object" || data === null) {
    throw new GeneratorRenderError("response", `レンダー API のレスポンスが不正です (${source})`);
  }
  const body = data as Record<string, unknown>;
  if (typeof body.markdown !== "string") {
    throw new GeneratorRenderError(
      "response",
      `レンダー API のレスポンスに markdown 文字列がありません (${source})`,
    );
  }
  return {
    designMarkdown: body.markdown,
    document: body.document,
    selection: body.selection,
    validation: body.validation,
  };
}

/**
 * Generator レンダー API を叩く {@link DesignRenderer} 実装。
 * 未材化セルの本文を API 経由で取得する (moat は API 側に秘匿)。
 */
export class GeneratorRenderClient implements DesignRenderer {
  /** 末尾スラッシュを除いた正規化済みベース URL。 */
  readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;
  private readonly retries: number;
  private readonly retryDelayMs: number;
  private readonly signal?: AbortSignal;

  constructor(opts: GeneratorRenderClientOptions) {
    if (!opts.baseUrl) {
      throw new GeneratorRenderError("request", "baseUrl が未指定です");
    }
    if (!opts.apiKey) {
      throw new GeneratorRenderError("auth", "apiKey が未指定です");
    }
    this.baseUrl = opts.baseUrl.replace(/\/+$/, "");
    this.apiKey = opts.apiKey;
    const fetchImpl = opts.fetchImpl ?? globalThis.fetch;
    if (typeof fetchImpl !== "function") {
      throw new GeneratorRenderError(
        "network",
        "fetch が利用できません。fetchImpl を指定してください",
      );
    }
    this.fetchImpl = fetchImpl;
    this.timeoutMs = opts.timeoutMs ?? 30_000;
    this.retries = Math.max(0, opts.retries ?? 2);
    this.retryDelayMs = Math.max(0, opts.retryDelayMs ?? 250);
    this.signal = opts.signal;
  }

  /**
   * 環境変数からクライアントを構築する。URL/キー未設定なら undefined を返す
   * (呼び出し側は renderer 無し = 現状の `unavailable` にフォールバックする)。
   * @param overrides タイムアウト等の追加設定 (env 由来の URL/キーを上書きも可)。
   */
  static fromEnv(
    overrides: Partial<GeneratorRenderClientOptions> = {},
    env: NodeJS.ProcessEnv = process.env,
  ): GeneratorRenderClient | undefined {
    const baseUrl = overrides.baseUrl ?? env[GENERATOR_RENDER_URL_ENV];
    const apiKey = overrides.apiKey ?? env[GENERATOR_RENDER_API_KEY_ENV];
    if (!baseUrl || !apiKey) return undefined;
    return new GeneratorRenderClient({ ...overrides, baseUrl, apiKey });
  }

  /** レンダー API を叩き未材化セルの DESIGN.md 本文を得る ({@link DesignRenderer})。 */
  async render(request: RenderRequest): Promise<RenderResult> {
    const url = `${this.baseUrl}/render`;
    const payload: Record<string, unknown> = {
      jsic: request.jsic,
      color: request.color,
      mood: request.mood,
    };
    if (request.tags && request.tags.length > 0) payload.tags = request.tags;

    const res = await this.requestWithRetry(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": this.apiKey,
      },
      body: JSON.stringify(payload),
    });

    let data: unknown;
    try {
      data = await res.json();
    } catch (cause) {
      throw new GeneratorRenderError(
        "response",
        `レンダー API のレスポンス解析に失敗しました (${url})`,
        {
          cause,
        },
      );
    }
    return toRenderResult(data, url);
  }

  /**
   * 疎通確認 (`GET /health`)。200 で true。
   * ネットワーク / タイムアウト等の失敗時は false を返す (安全なプローブ)。
   */
  async health(): Promise<boolean> {
    const url = `${this.baseUrl}/health`;
    try {
      const res = await this.fetchOnce(url, {
        method: "GET",
        headers: { "x-api-key": this.apiKey },
      });
      return res.status === 200;
    } catch {
      return false;
    }
  }

  /** リトライ付きで HTTP を実行し、非 2xx はステータスに応じたエラーへ写像する。 */
  private async requestWithRetry(url: string, init: RequestInit): Promise<Response> {
    let lastError: GeneratorRenderError | undefined;
    for (let attempt = 0; attempt <= this.retries; attempt++) {
      try {
        const res = await this.fetchOnce(url, init);
        if (res.ok) return res;
        const error = this.errorForStatus(res.status, url);
        if (!error.retryable || attempt === this.retries) throw error;
        lastError = error;
      } catch (err) {
        const error = this.normalizeError(err, url);
        // 呼び出し側のキャンセル (外部 signal) はリトライ対象にしない。
        if (this.signal?.aborted || !error.retryable || attempt === this.retries) throw error;
        lastError = error;
      }
      if (this.retryDelayMs > 0) await sleep(this.retryDelayMs * (attempt + 1));
    }
    // ループは throw か return で必ず抜けるが、型安全のため保険。
    throw (
      lastError ??
      new GeneratorRenderError("network", `レンダー API 呼び出しに失敗しました (${url})`)
    );
  }

  /** タイムアウトと外部シグナルを合流させた単発 fetch。 */
  private async fetchOnce(url: string, init: RequestInit): Promise<Response> {
    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, this.timeoutMs);
    const onExternalAbort = () => controller.abort();
    if (this.signal) {
      if (this.signal.aborted) controller.abort();
      else this.signal.addEventListener("abort", onExternalAbort, { once: true });
    }
    try {
      return await this.fetchImpl(url, { ...init, signal: controller.signal });
    } catch (cause) {
      if (timedOut) {
        throw new GeneratorRenderError("timeout", `レンダー API がタイムアウトしました (${url})`, {
          cause,
        });
      }
      throw new GeneratorRenderError("network", `レンダー API への接続に失敗しました (${url})`, {
        cause,
      });
    } finally {
      clearTimeout(timer);
      if (this.signal) this.signal.removeEventListener("abort", onExternalAbort);
    }
  }

  /** HTTP ステータスをエラー分類へ写像する。 */
  private errorForStatus(status: number, url: string): GeneratorRenderError {
    if (status === 401 || status === 403) {
      return new GeneratorRenderError(
        "auth",
        `レンダー API の認証に失敗しました (HTTP ${status}): ${url}`,
        {
          status,
        },
      );
    }
    if (status >= 500) {
      return new GeneratorRenderError(
        "server",
        `レンダー API がサーバエラーを返しました (HTTP ${status}): ${url}`,
        {
          status,
        },
      );
    }
    return new GeneratorRenderError(
      "request",
      `レンダー API が不正リクエストを返しました (HTTP ${status}): ${url}`,
      {
        status,
      },
    );
  }

  /** 例外を {@link GeneratorRenderError} に正規化する (既に該当型ならそのまま)。 */
  private normalizeError(err: unknown, url: string): GeneratorRenderError {
    if (err instanceof GeneratorRenderError) return err;
    return new GeneratorRenderError("network", `レンダー API 呼び出しに失敗しました (${url})`, {
      cause: err,
    });
  }
}
