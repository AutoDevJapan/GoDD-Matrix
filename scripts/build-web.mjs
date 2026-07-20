#!/usr/bin/env node
/**
 * GoDD Matrix 静的 Web アプリのビルド (issue #28)。
 *
 * esbuild で `web/src/main.ts` を単一 ESM (`web/dist/assets/app.js`) にバンドルし、
 * 静的資産 (index.html / styles.css) を `web/dist/` へ配置する。GitHub Pages で
 * そのまま配信できる純静的成果物を生成する (サーバ不要・秘密なし)。
 */
import { cp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const root = path.resolve(fileURLToPath(new URL(".", import.meta.url)), "..");
const webSrc = path.join(root, "web", "src");
const outDir = path.join(root, "web", "dist");

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
  plugins: [nodeMockPlugin],
});

const timestamp = Date.now();
let html = await readFile(path.join(webSrc, "index.html"), "utf8");
html = html.replace('href="./styles.css"', `href="./styles.css?t=${timestamp}"`);
html = html.replace('src="./assets/app.js"', `src="./assets/app.js?t=${timestamp}"`);
await writeFile(path.join(outDir, "index.html"), html, "utf8");

// Bundle templates, manifest, and compat for browser execution
const parentRoot = path.join(root, "..");
const templatesBundle = {
  template: await readFile(path.join(parentRoot, "templates", "DESIGN.md.hbs"), "utf8"),
  partials: {},
  manifest: JSON.parse(await readFile(path.join(parentRoot, "manifest.json"), "utf8")),
  compat: JSON.parse(await readFile(path.join(parentRoot, "compat.json"), "utf8")),
};

const partialsDir = path.join(parentRoot, "partials");
const sections = await readdir(partialsDir);
for (const section of sections) {
  const sectionDir = path.join(partialsDir, section);
  const stat = await readdir(sectionDir);
  for (const file of stat) {
    if (file.endsWith(".hbs")) {
      const id = file.replace(".hbs", "");
      const content = await readFile(path.join(sectionDir, file), "utf8");
      templatesBundle.partials[id] = content;
    }
  }
}
await writeFile(
  path.join(outDir, "templates-bundle.json"),
  JSON.stringify(templatesBundle),
  "utf8",
);

await cp(path.join(webSrc, "styles.css"), path.join(outDir, "styles.css"));
try {
  await cp(path.join(webSrc, "web-index.json"), path.join(outDir, "web-index.json"));
} catch (err) {}
// Jekyll を無効化 (アンダースコア始まりのパス等を素通しし、静的資産をそのまま配信)。
await writeFile(path.join(outDir, ".nojekyll"), "");

process.stdout.write(`[build-web] 生成: ${path.relative(root, outDir)}\n`);
