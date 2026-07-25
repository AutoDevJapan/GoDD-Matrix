#!/usr/bin/env node
/**
 * Design-Systems Release `index-pages` からページシャードを取得し、
 * Matrix Pages 同オリジンミラー (`web/dist/index/pages/`) へ展開する。
 *
 * GitHub Release asset はブラウザ CORS を返さないため、Pages 配信前に同期する。
 * 正本 URL は `releases/download/index-pages/{n}.json`（ADR-0003）。
 */
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { createWriteStream } from "node:fs";
import { copyFile, mkdir, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";

const RELEASE_TAG = "index-pages";
const ZIP_URL = `https://github.com/AutoDevJapan/GoDD-Design-Systems/releases/download/${RELEASE_TAG}/index-pages.zip`;

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const outDir = resolve(root, process.argv[2] ?? "web/dist/index/pages");

const work = join(tmpdir(), `godd-index-pages-${randomBytes(6).toString("hex")}`);
const zipPath = join(work, "index-pages.zip");
const extractDir = join(work, "extract");

await rm(work, { recursive: true, force: true });
await mkdir(extractDir, { recursive: true });
await mkdir(outDir, { recursive: true });

process.stdout.write(`[sync-index-pages] GET ${ZIP_URL}\n`);
const response = await fetch(ZIP_URL, { redirect: "follow" });
if (!response.ok || !response.body) {
  throw new Error(`Release zip の取得に失敗: HTTP ${response.status}`);
}
await pipeline(Readable.fromWeb(response.body), createWriteStream(zipPath));

try {
  execFileSync("unzip", ["-q", "-o", zipPath, "-d", extractDir], { stdio: "inherit" });
} catch {
  // Windows 10+ / 一部環境: tar が zip を展開できる
  execFileSync("tar", ["-xf", zipPath, "-C", extractDir], { stdio: "inherit" });
}

const pagesSrc = join(extractDir, "index", "pages");
const files = (await readdir(pagesSrc)).filter((name) => name.endsWith(".json"));
if (files.length === 0) {
  throw new Error(`zip 内に index/pages/*.json がありません: ${pagesSrc}`);
}
for (const name of files) {
  await copyFile(join(pagesSrc, name), join(outDir, name));
}

await rm(work, { recursive: true, force: true });
process.stdout.write(`[sync-index-pages] mirrored ${files.length} pages → ${outDir}\n`);
