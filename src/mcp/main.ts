#!/usr/bin/env node
/**
 * GoDD-Matrix MCP サーバ 起動エントリ (stdio) — issue #7。
 *
 * 環境変数から {@link MatrixRuntime} を構築し、stdio transport で MCP サーバを起動する。
 * JSON-RPC は stdout を専有するため、ログ・エラーは stderr にのみ出力する。
 *
 * 必要な環境変数:
 * - `GODD_DS_INDEX` : Design-Systems index.json の取込元 (パス / URL)。必須。
 * - `GODD_DS_BASE`  : DESIGN.md 本文の解決 base。任意 (未指定は index の所在から推定)。
 * - `GENERATOR_RENDER_URL`     : 未材化セルの Generator レンダー API ベース URL。任意。
 * - `GENERATOR_RENDER_API_KEY` : 同 API の認証キー (x-api-key)。任意。
 *   両方が設定された場合のみ未材化セルが `rendered` フォールバックへ通る。
 *   未設定なら未材化は従来どおり `unavailable`。
 */
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createRuntime } from "./runtime.js";
import { createMatrixServer } from "./server.js";

async function main(): Promise<void> {
  const runtime = await createRuntime();
  const server = createMatrixServer(runtime);
  const transport = new StdioServerTransport();
  await server.connect(transport);
  process.stderr.write("[godd-matrix] MCP サーバを起動しました (stdio, tools/list 登録済み)\n");
}

main().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  process.stderr.write(`[godd-matrix] 起動に失敗しました: ${message}\n`);
  process.exitCode = 1;
});
