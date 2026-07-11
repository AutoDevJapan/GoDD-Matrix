/**
 * Vercel Function: `POST /mcp` ほか (rewrite 経由)。
 *
 * GoDD-Matrix MCP サーバ (3 ツール) を Streamable HTTP トランスポートで公開する。
 * ハンドラはコールドスタート時に一度だけ生成し、ランタイム (index 取込等) のキャッシュを
 * ウォームインスタンス間で共有する。認証は `x-api-key` (env `GODD_MCP_API_KEY`)。
 * env `GENERATOR_RENDER_URL` / `GENERATOR_RENDER_API_KEY` が未設定なら未材化セルは
 * 従来どおり `unavailable` にフォールバックする。
 *
 * Vercel の Node 関数は `(req, res)` で呼ばれるため {@link toNodeListener} で橋渡しする。
 * ロジックは共有モジュール ({@link createMcpRequestHandler}) に集約。参照先はビルド成果物 (`dist/`)。
 */
import { createMcpRequestHandler, resolveMaxBodyBytes } from "../dist/mcp/http.js";
import { toNodeListener } from "../dist/mcp/node-adapter.js";

// Web 層 (Content-Length 早期拒否) と Node ブリッジ (実バイト上限) で同一の上限を用いる。
const maxBodyBytes = resolveMaxBodyBytes();

export default toNodeListener(createMcpRequestHandler(), { maxBodyBytes });
