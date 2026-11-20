#!/usr/bin/env node
/**
 * 正式配布物 (MCP) を生成する。使い方と検証内容は src/release/package.ts を参照。
 *
 *   pnpm build
 *   node scripts/package-mcp.mjs --out <dir> [--pin <file>] [--source-dir <dir>] [--tarball <file>]
 */
const entry = new URL("../dist/release/package-cli.js", import.meta.url);
let cli;
try {
  cli = await import(entry.href);
} catch (error) {
  if (error?.code !== "ERR_MODULE_NOT_FOUND") throw error;
  process.stderr.write("dist/ がありません。先に `pnpm build` を実行してください。\n");
  process.exit(2);
}
process.exitCode = await cli.runPackageCli(process.argv.slice(2));
