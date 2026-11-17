#!/usr/bin/env node
/**
 * GoDD-Matrix MCP サーバ 起動エントリ (stdio) — issue #7。
 *
 * 環境変数から {@link MatrixRuntime} を構築し、stdio transport で MCP サーバを起動する。
 * JSON-RPC は stdout を専有するため、ログ・エラーは stderr にのみ出力する。
 *
 * 必要な環境変数:
 * - `GODD_DS_INDEX` : Design-Systems index.json の取込元 (パス / URL)。必須。
 *   ただし正式配布物 (隣に `snapshot.json` がある場合) では任意 (下記)。
 * - `GODD_DS_BASE`  : DESIGN.md 本文の解決 base。任意 (未指定は index の所在から推定)。
 * - `GENERATOR_RENDER_URL`     : 未材化セルの Generator レンダー API ベース URL。任意。
 * - `GENERATOR_RENDER_API_KEY` : 同 API の認証キー (x-api-key)。任意。
 *   両方が設定された場合のみ未材化セルが `rendered` フォールバックへ通る。
 *   未設定なら未材化は従来どおり `unavailable`。
 *
 * 正式配布物 (`snapshot.json` を隣に置く / 環境変数 `GODD_DS_SNAPSHOT` で指定):
 * - index と軸の語彙 (taxonomy / jsic) は pin (bytes / sha256 / git blob / 件数) に一致するまで
 *   解釈せず、不一致なら起動しない。隣に同名のファイルがあればそれを使い、無ければ pin の raw URL。
 * - 本文は必ず hash 検証する。取得先の既定は pin の commit に固定した raw URL (隣に `index.json`
 *   があればそれを index として使う)。取得先を環境変数で変えても検証は外れない。
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { DS_INDEX_ENV } from "../ds/client.js";
import { createRuntime } from "./runtime.js";
import { createMatrixServer } from "./server.js";
import { discoverSnapshot } from "./snapshot-source.js";

async function main(): Promise<void> {
  const found = await discoverSnapshot(path.dirname(fileURLToPath(import.meta.url)));
  const indexSource = process.env[DS_INDEX_ENV] ?? found?.bundledIndex;
  const runtime = await createRuntime({
    ...(found ? { snapshot: found.pin } : {}),
    ...(found?.bundledTaxonomy ? { taxonomySource: found.bundledTaxonomy } : {}),
    ...(found?.bundledJsic ? { jsicSource: found.bundledJsic } : {}),
    ...(indexSource !== undefined ? { indexSource } : {}),
  });
  const server = createMatrixServer(runtime);
  const transport = new StdioServerTransport();
  await server.connect(transport);
  const snapshot = runtime.snapshot;
  const mode = snapshot
    ? `DS ${snapshot.commit.slice(0, 12)} / index sha256:${snapshot.indexSha256.slice(0, 16)} / ${snapshot.entryCount} 件を検証済み`
    : "pin なし (従来の環境変数指定)";
  process.stderr.write(
    `[godd-matrix] MCP サーバを起動しました (stdio, tools/list 登録済み, ${mode})\n`,
  );
}

main().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  process.stderr.write(`[godd-matrix] 起動に失敗しました: ${message}\n`);
  process.exitCode = 1;
});
