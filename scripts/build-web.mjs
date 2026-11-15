#!/usr/bin/env node
/**
 * GoDD Matrix 静的 Web アプリのビルド (issue #28)。
 *
 * esbuild で `web/src/main.ts` を単一 ESM (`web/dist/assets/app.js`) にバンドルし、
 * 静的資産 (index.html / styles.css) を `web/dist/` へ配置する。GitHub Pages で
 * そのまま配信できる純静的成果物を生成する (サーバ不要・秘密なし)。
 */
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { BuildInputs, inventoryBuildOutput } from "./web-build-inputs.mjs";

const root = path.resolve(fileURLToPath(new URL(".", import.meta.url)), "..");
const webSrc = path.join(root, "web", "src");
const outDir = path.join(root, "web", "dist");

const inputs = new BuildInputs(root);
for (const filename of [
  "scripts/build-web.mjs",
  "scripts/web-build-inputs.mjs",
  "package.json",
  "pnpm-lock.yaml",
]) {
  await inputs.read(filename);
}
await inputs.config("web/tsconfig.json");

await rm(path.join(root, "web/build-inputs.json"), { force: true });
await rm(outDir, { recursive: true, force: true });
await mkdir(path.join(outDir, "assets"), { recursive: true });

// esbuild plugin to mock node:fs/path/url for the browser build
const nodeMockPlugin = {
  name: "node-mock",
  setup(build) {
    build.onResolve({ filter: /^node:(fs|path|url)/ }, (args) => {
      return { path: args.path, namespace: "node-mock-ns" };
    });
    build.onLoad({ filter: /.*/, namespace: "node-mock-ns" }, () => {
      return {
        contents: `
          export function existsSync() { return false; }
          export function readFileSync() { return ''; }
          export function join(...args) { return args.join('/'); }
          export function dirname(p) { return p; }
          export function fileURLToPath(u) { return u; }
        `,
        loader: "js",
      };
    });
  },
};

const compiled = await build({
  absWorkingDir: root,
  metafile: true,
  tsconfig: path.join(root, "web/tsconfig.json"),
  entryPoints: [path.join(webSrc, "main.ts")],
  outfile: path.join(outDir, "assets", "app.js"),
  bundle: true,
  format: "esm",
  platform: "browser",
  target: ["es2020"],
  minify: true,
  sourcemap: true,
  legalComments: "none",
  plugins: [nodeMockPlugin, inputs.compilerPlugin()],
});

const timestamp = Date.now();
let html = (await inputs.read(path.join(webSrc, "index.html"))).toString("utf8");
html = html.replace('href="./styles.css"', `href="./styles.css?t=${timestamp}"`);
html = html.replace('src="./assets/app.js"', `src="./assets/app.js?t=${timestamp}"`);
await writeFile(path.join(outDir, "index.html"), html, "utf8");

await inputs.copyFile(path.join(webSrc, "styles.css"), path.join(outDir, "styles.css"));
await mkdir(path.join(outDir, "assets"), { recursive: true });
await inputs.copyTree(path.join(webSrc, "assets"), path.join(outDir, "assets"));
await inputs.copyFile(
  path.join(webSrc, "web-index.json"),
  path.join(outDir, "web-index.json"),
  true,
);
// Jekyll を無効化 (アンダースコア始まりのパス等を素通しし、静的資産をそのまま配信)。
await writeFile(path.join(outDir, ".nojekyll"), "");

const receipt = await inputs.receipt(compiled.metafile, await inventoryBuildOutput(outDir));
await writeFile(path.join(root, "web/build-inputs.json"), `${JSON.stringify(receipt, null, 2)}\n`, {
  flag: "wx",
});

process.stdout.write(`[build-web] 生成: ${path.relative(root, outDir)}\n`);
