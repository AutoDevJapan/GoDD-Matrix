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

/** Web 標準ハンドラ ((Request) => Response)。 */
export type WebHandler = (req: Request) => Response | Promise<Response>;

/** body-parser (Vercel / Next 等) が付与しうる `body` プロパティ。 */
type WithBody = IncomingMessage & { body?: unknown };

/** Node リクエストから Web `Request` のボディ (Uint8Array) を得る。GET/HEAD は無し。 */
async function readBody(req: IncomingMessage): Promise<Uint8Array | undefined> {
  const method = req.method ?? "GET";
  if (method === "GET" || method === "HEAD") return undefined;

  // body-parser 済みなら再シリアライズして使う (生ストリームは消費済みのことがある)。
  const parsed = (req as WithBody).body;
  if (parsed !== undefined && parsed !== null) {
    if (parsed instanceof Uint8Array) return parsed;
    if (typeof parsed === "string") return new TextEncoder().encode(parsed);
    return new TextEncoder().encode(JSON.stringify(parsed));
  }

  const chunks: Uint8Array[] = [];
  for await (const chunk of req) {
    chunks.push(typeof chunk === "string" ? new TextEncoder().encode(chunk) : chunk);
  }
  if (chunks.length === 0) return undefined;
  const total = chunks.reduce((n, c) => n + c.byteLength, 0);
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
async function toWebRequest(req: IncomingMessage): Promise<Request> {
  const host = req.headers.host ?? "localhost";
  const url = new URL(req.url ?? "/", `https://${host}`);
  const body = await readBody(req);
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
 * Vercel の Node 関数は `export default toNodeListener(handler)` として用いる。
 */
export function toNodeListener(
  handler: WebHandler,
): (req: IncomingMessage, res: ServerResponse) => Promise<void> {
  return async function listener(req: IncomingMessage, res: ServerResponse): Promise<void> {
    try {
      const webReq = await toWebRequest(req);
      const webRes = await handler(webReq);
      await sendWebResponse(res, webRes);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (!res.headersSent) {
        res.statusCode = 500;
        res.setHeader("content-type", "application/json");
      }
      res.end(JSON.stringify({ error: "internal_error", message }));
    }
  };
}
