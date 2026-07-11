/**
 * Node HTTP ({@link IncomingMessage} / {@link ServerResponse}) と Web 標準
 * (Request / Response) ハンドラの橋渡し (issue #8)。
 *
 * Vercel の Node ランタイム関数は従来型の `(req, res)` シグネチャで呼び出されるため、
 * Web 標準ハンドラ ({@link ./http}) をそのまま `export default` すると `res` が
 * 終端されずタイムアウトする。本アダプタは Node のリクエストを Web `Request` に変換し、
 * ハンドラの `Response` を Node の `res` へ書き戻す。
 *
 * ボディは body-parser 済み (`req.body`) を優先し、無ければ生ストリームを読む
 * (JSON 応答 = `enableJsonResponse` 前提のため、ここでは非ストリーミングで完結する)。
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import { type Logger, createConsoleLogger } from "./logger.js";

/** Web 標準ハンドラ ((Request) => Response)。 */
export type WebHandler = (req: Request) => Response | Promise<Response>;

/** {@link toNodeListener} の挙動オプション。 */
export interface NodeListenerOptions {
  /**
   * リクエストボディの最大バイト数。超過すると読み取りを中断し 413 を返す。
   * 未指定なら上限なし (従来動作)。0 以下は無視する。
   */
  maxBodyBytes?: number;
  /**
   * 構造化ログの出力先。省略時は {@link createConsoleLogger}。
   * Node ブリッジで発生した 500 / 413 の理由を記録する (握り潰し防止)。
   */
  logger?: Logger;
}

/** body-parser (Vercel / Next 等) が付与しうる `body` プロパティ。 */
type WithBody = IncomingMessage & { body?: unknown };

/**
 * リクエストボディがサイズ上限を超えたことを表す。{@link toNodeListener} が
 * これを捕捉して 413 (Payload Too Large) 応答へ写像する。
 */
export class PayloadTooLargeError extends Error {
  readonly maxBytes: number;
  constructor(maxBytes: number) {
    super(`リクエストボディが上限 (${maxBytes} bytes) を超えています`);
    this.name = "PayloadTooLargeError";
    this.maxBytes = maxBytes;
  }
}

/** 有効な上限 (正の有限値) のときだけ true。 */
function hasLimit(maxBytes: number | undefined): maxBytes is number {
  return maxBytes !== undefined && Number.isFinite(maxBytes) && maxBytes > 0;
}

/**
 * Node リクエストから Web `Request` のボディ (Uint8Array) を得る。GET/HEAD は無し。
 * `maxBytes` を指定すると、Content-Length / 実バイト数のいずれかが超過した時点で
 * {@link PayloadTooLargeError} を投げ、無制限のメモリ蓄積を防ぐ。
 */
async function readBody(req: IncomingMessage, maxBytes?: number): Promise<Uint8Array | undefined> {
  const method = req.method ?? "GET";
  if (method === "GET" || method === "HEAD") return undefined;

  // Content-Length があれば読み取り前に早期拒否する (安価な多層防御)。
  if (hasLimit(maxBytes)) {
    const declared = Number.parseInt(req.headers["content-length"] ?? "", 10);
    if (Number.isFinite(declared) && declared > maxBytes) {
      throw new PayloadTooLargeError(maxBytes);
    }
  }

  // body-parser 済みなら再シリアライズして使う (生ストリームは消費済みのことがある)。
  const parsed = (req as WithBody).body;
  if (parsed !== undefined && parsed !== null) {
    const bytes =
      parsed instanceof Uint8Array
        ? parsed
        : new TextEncoder().encode(typeof parsed === "string" ? parsed : JSON.stringify(parsed));
    if (hasLimit(maxBytes) && bytes.byteLength > maxBytes) {
      throw new PayloadTooLargeError(maxBytes);
    }
    return bytes;
  }

  const chunks: Uint8Array[] = [];
  let total = 0;
  for await (const chunk of req) {
    const bytes = typeof chunk === "string" ? new TextEncoder().encode(chunk) : chunk;
    total += bytes.byteLength;
    // 上限超過は読み切らずに中断する (メモリ枯渇の防止)。
    if (hasLimit(maxBytes) && total > maxBytes) {
      throw new PayloadTooLargeError(maxBytes);
    }
    chunks.push(bytes);
  }
  if (chunks.length === 0) return undefined;
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    merged.set(c, offset);
    offset += c.byteLength;
  }
  return merged;
}

/** Node リクエストヘッダを Web `Headers` に写す。 */
function toHeaders(req: IncomingMessage): Headers {
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (value === undefined) continue;
    if (Array.isArray(value)) {
      for (const v of value) headers.append(key, v);
    } else {
      headers.set(key, value);
    }
  }
  return headers;
}

/** Node リクエストを Web `Request` に変換する。 */
async function toWebRequest(req: IncomingMessage, maxBytes?: number): Promise<Request> {
  const host = req.headers.host ?? "localhost";
  const url = new URL(req.url ?? "/", `https://${host}`);
  const body = await readBody(req, maxBytes);
  return new Request(url, {
    method: req.method ?? "GET",
    headers: toHeaders(req),
    ...(body !== undefined ? { body } : {}),
  });
}

/** Web `Response` を Node `res` へ書き戻す。 */
async function sendWebResponse(res: ServerResponse, webRes: Response): Promise<void> {
  res.statusCode = webRes.status;
  webRes.headers.forEach((value, key) => {
    res.setHeader(key, value);
  });
  const buffer = Buffer.from(await webRes.arrayBuffer());
  res.end(buffer);
}

/**
 * Web 標準ハンドラを Node の `(req, res)` リスナに変換する。
 * Vercel の Node 関数は `export default toNodeListener(handler, { maxBodyBytes })` として用いる。
 * `options.maxBodyBytes` 超過のボディは読み切らずに 413 を返す。
 */
export function toNodeListener(
  handler: WebHandler,
  options: NodeListenerOptions = {},
): (req: IncomingMessage, res: ServerResponse) => Promise<void> {
  const logger = options.logger ?? createConsoleLogger();
  return async function listener(req: IncomingMessage, res: ServerResponse): Promise<void> {
    try {
      const webReq = await toWebRequest(req, options.maxBodyBytes);
      const webRes = await handler(webReq);
      await sendWebResponse(res, webRes);
    } catch (err) {
      if (err instanceof PayloadTooLargeError) {
        logger.warn("node.body.too_large", {
          status: 413,
          path: req.url,
          maxBodyBytes: err.maxBytes,
        });
        if (!res.headersSent) {
          res.statusCode = 413;
          res.setHeader("content-type", "application/json");
        }
        res.end(JSON.stringify({ error: "payload_too_large", message: err.message }));
        return;
      }
      // 500 応答の理由を記録する (従来は無記録で本番診断が不能だった)。
      const message = err instanceof Error ? err.message : String(err);
      logger.error("node.request.error", {
        status: 500,
        method: req.method,
        path: req.url,
        error: message,
      });
      if (!res.headersSent) {
        res.statusCode = 500;
        res.setHeader("content-type", "application/json");
      }
      // 内部例外メッセージはクライアントへ露出しない (秘密混入の恐れ)。ログにのみ残す。
      res.end(JSON.stringify({ error: "internal_error" }));
    }
  };
}
