/**
 * Vercel Function: `GET /health` (rewrite 経由)。
 *
 * 監視・デプロイ検証用の 200 応答。認証不要。ロジックは共有モジュール
 * ({@link handleHealth}) に集約し、本ファイルは Node ランタイムへの配線のみを担う。
 * Vercel の Node 関数は `(req, res)` で呼ばれるため {@link toNodeListener} で橋渡しする。
 * ビルド成果物 (`dist/`) を参照するため、Vercel の buildCommand で `pnpm build` を実行する。
 */
import { handleHealth } from "../dist/mcp/http.js";
import { toNodeListener } from "../dist/mcp/node-adapter.js";

export default toNodeListener((req) => handleHealth(req));
