#!/usr/bin/env node
/**
 * GoDD Matrix 静的 Web アプリのビルド (issue #28)。
 *
 * esbuild で `web/src/main.ts` を単一 ESM (`web/dist/assets/app.js`) にバンドルし、
 * 静的資産 (index.html / styles.css) を `web/dist/` へ配置する。GitHub Pages で
 * そのまま配信できる純静的成果物を生成する (サーバ不要・秘密なし)。
 */
import { cp, mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const root = path.resolve(fileURLToPath(new URL(".", import.meta.url)), "..");
const webSrc = path.join(root, "web", "src");
const outDir = path.join(root, "web", "dist");

await rm(outDir, { recursive: true, force: true });
await mkdir(path.join(outDir, "assets"), { recursive: true });

await build({
  entryPoints: [path.join(webSrc, "main.ts")],
  outfile: path.join(outDir, "assets", "app.js"),
  bundle: true,
  format: "esm",
  platform: "browser",
  target: ["es2020"],
  minify: true,
  sourcemap: true,
  legalComments: "none",
});

await cp(path.join(webSrc, "index.html"), path.join(outDir, "index.html"));
await cp(path.join(webSrc, "styles.css"), path.join(outDir, "styles.css"));
// Jekyll を無効化 (アンダースコア始まりのパス等を素通しし、静的資産をそのまま配信)。
await writeFile(path.join(outDir, ".nojekyll"), "");

process.stdout.write(`[build-web] 生成: ${path.relative(root, outDir)}\n`);
