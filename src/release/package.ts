/**
 * 正式配布物 (MCP) の生成。
 *
 * 生成は「すべて検証してから、まとめて書く」順で行い、検証に失敗した場合は出力先に何も書かない。
 * 1. main.js: `src/mcp/main.ts` を依存ごと 1 ファイルへバンドルする (esbuild)。同梱した依存のライセンスも集める。
 * 2. index / taxonomy / jsic: pin (bytes / sha256 / git blob) に照合する。取得先は
 *    ローカルディレクトリ、または pin の commit に固定した raw URL。
 * 3. 全本文: pin の commit の tarball を 1 パスで読み、index の全エントリについて本文が存在し、
 *    生バイトの sha256 が entry.hash と一致することを確かめる (欠落・不一致・重複は拒否)。
 * 4. 書き出し後、{@link verifyArtifactDir} で成果物自身を検査する。
 */
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { createGunzip } from "node:zlib";
import { build } from "esbuild";
import { fetchBytes } from "../ds/fetch.js";
import {
  type DsSnapshotPin,
  type PinnedFile,
  parseDsSnapshotPin,
  snapshotFileUrl,
  verifyIndexEntryCount,
  verifyPinnedFileBytes,
} from "../ds/snapshot.js";
import { parseDesignIndex } from "../ds/validate.js";
import {
  type ArtifactVerification,
  CATALOG_VERIFICATION_FILE,
  SHA256SUMS_FILE,
  catalogVerificationReceipt,
  formatSha256Sums,
  verifyArtifactDir,
} from "./artifact.js";
import {
  type PackageLicense,
  formatThirdPartyLicenses,
  packageRootsFromInputs,
} from "./licenses.js";
import { type BodyVerification, verifyBodiesInTar } from "./verify-bodies.js";

/** {@link packageMcp} のオプション。 */
export interface PackageOptions {
  /** リポジトリの root (src/ / LICENSE / node_modules を含む)。 */
  readonly repoRoot: string;
  /** 成果物の出力先。存在しないか空でなければならない。 */
  readonly outDir: string;
  /** pin ファイル。省略時は `<repoRoot>/ds-snapshot.pin.json`。 */
  readonly pinFile?: string;
  /** index / taxonomy / jsic のローカルコピー置き場。省略時は pin の commit に固定した raw URL。 */
  readonly sourceDir?: string;
  /** 本文を含む tar.gz のローカルコピー。省略時は pin の commit の codeload tarball。 */
  readonly tarball?: string;
  /** fetch 実装の差替 (テスト用)。 */
  readonly fetchImpl?: typeof fetch;
  /** 進捗の通知先。 */
  readonly onProgress?: (message: string) => void;
}

/** {@link packageMcp} の結果。 */
export interface PackageResult {
  readonly outDir: string;
  /** 書き出した成果物の自己検査の結果。 */
  readonly verification: ArtifactVerification;
  /** 全本文の検証結果。 */
  readonly bodies: BodyVerification;
  /** main.js の sha256。 */
  readonly mainJsSha256: string;
  /** main.js に同梱した依存 (名前@版)。 */
  readonly dependencies: readonly string[];
}

/** 同梱した依存が CommonJS の require を使えるようにする (ESM 出力)。 */
const REQUIRE_SHIM =
  'import { createRequire as __godd_createRequire } from "node:module";\nconst require = __godd_createRequire(import.meta.url);';

function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

async function bundleMain(repoRoot: string): Promise<{ code: Uint8Array; inputs: string[] }> {
  const result = await build({
    absWorkingDir: repoRoot,
    entryPoints: ["src/mcp/main.ts"],
    outfile: "main.js",
    bundle: true,
    platform: "node",
    target: "node20",
    format: "esm",
    write: false,
    metafile: true,
    legalComments: "none",
    logLevel: "silent",
    banner: { js: REQUIRE_SHIM },
  });
  const output = result.outputFiles[0];
  if (!output || result.outputFiles.length !== 1) {
    throw new Error("バンドル結果が 1 ファイルではありません");
  }
  return { code: output.contents, inputs: Object.keys(result.metafile.inputs) };
}

function licenseId(pkg: Record<string, unknown>, where: string): string {
  const license = pkg.license;
  if (typeof license === "string" && license.length > 0) return license;
  if (typeof license === "object" && license !== null) {
    const type = (license as { type?: unknown }).type;
    if (typeof type === "string" && type.length > 0) return type;
  }
  throw new Error(`${where}: package.json にライセンス識別子がありません`);
}

async function collectLicenses(
  repoRoot: string,
  inputs: readonly string[],
): Promise<{ text: string; dependencies: string[] }> {
  const packages: PackageLicense[] = [];
  for (const relative of packageRootsFromInputs(inputs)) {
    const root = path.join(repoRoot, relative);
    const meta = JSON.parse(await readFile(path.join(root, "package.json"), "utf8")) as Record<
      string,
      unknown
    >;
    if (typeof meta.name !== "string" || typeof meta.version !== "string") {
      throw new Error(`${relative}: package.json に name / version がありません`);
    }
    const files = (await readdir(root))
      .filter((name) => /^(licen[cs]e|copying|notice)(\.[A-Za-z0-9]+)?$/i.test(name))
      .sort();
    const texts = await Promise.all(files.map((name) => readFile(path.join(root, name), "utf8")));
    packages.push({
      name: meta.name,
      version: meta.version,
      license: licenseId(meta, relative),
      text: texts.join("\n\n"),
    });
  }
  return {
    text: formatThirdPartyLicenses(packages),
    dependencies: packages.map((p) => `${p.name}@${p.version}`).sort(),
  };
}

async function readPinned(
  pin: DsSnapshotPin,
  file: PinnedFile,
  label: string,
  options: PackageOptions,
): Promise<Uint8Array> {
  const source = options.sourceDir
    ? path.join(options.sourceDir, file.path)
    : snapshotFileUrl(pin, file);
  const bytes = await fetchBytes(source, {
    maxBytes: file.bytes,
    ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
  });
  verifyPinnedFileBytes(bytes, file, label);
  return bytes;
}

/** 本文を含む tar (gunzip 済み) のチャンク列。ローカルの tar.gz、または pin の commit の codeload。 */
async function* openTarball(
  pin: DsSnapshotPin,
  options: PackageOptions,
): AsyncGenerator<Uint8Array> {
  const gunzip = createGunzip();
  if (options.tarball) {
    createReadStream(options.tarball)
      .on("error", (error) => gunzip.destroy(error))
      .pipe(gunzip);
  } else {
    const url = `https://codeload.github.com/${pin.repository}/tar.gz/${pin.commit}`;
    const response = await (options.fetchImpl ?? fetch)(url, {
      redirect: "follow",
      signal: AbortSignal.timeout(15 * 60 * 1000),
    });
    if (!response.ok || !response.body) {
      throw new Error(`本文の tarball を取得できません (HTTP ${response.status}): ${url}`);
    }
    Readable.fromWeb(response.body as import("node:stream/web").ReadableStream<Uint8Array>)
      .on("error", (error) => gunzip.destroy(error))
      .pipe(gunzip);
  }
  for await (const chunk of gunzip) yield chunk as Uint8Array;
}

/**
 * 正式配布物を生成して検査する。
 * @throws Error 出力先が空でない / 依存・ライセンスが集まらない / pin に一致しない / 本文が不完全、のいずれか。
 *   検証に失敗した場合、出力先には何も書かない。
 */
export async function packageMcp(options: PackageOptions): Promise<PackageResult> {
  const say = options.onProgress ?? (() => undefined);
  const pinFile = options.pinFile ?? path.join(options.repoRoot, "ds-snapshot.pin.json");
  const pinBytes = await readFile(pinFile);
  const pin = parseDsSnapshotPin(pinBytes.toString("utf8"));

  await mkdir(options.outDir, { recursive: true });
  if ((await readdir(options.outDir)).length > 0) {
    throw new Error(`出力先が空ではありません: ${options.outDir}`);
  }

  say("main.js をバンドルします");
  const bundle = await bundleMain(options.repoRoot);
  const licenses = await collectLicenses(options.repoRoot, bundle.inputs);

  say("index / taxonomy / jsic を pin に照合します");
  const [indexBytes, taxonomyBytes, jsicBytes] = await Promise.all([
    readPinned(pin, pin.index, "index", options),
    readPinned(pin, pin.taxonomy, "taxonomy", options),
    readPinned(pin, pin.jsic, "jsic", options),
  ]);
  const entries = parseDesignIndex(
    new TextDecoder("utf-8", { fatal: true }).decode(indexBytes),
  ).entries;
  verifyIndexEntryCount(entries.length, pin);

  say(`全 ${entries.length} 件の本文を検証します`);
  const bodies = await verifyBodiesInTar(entries, openTarball(pin, options));
  const receipt = catalogVerificationReceipt(pin, bodies);

  const files: Record<string, Uint8Array> = {
    "main.js": bundle.code,
    "snapshot.json": pinBytes,
    [pin.index.path]: indexBytes,
    [pin.taxonomy.path]: taxonomyBytes,
    [pin.jsic.path]: jsicBytes,
    [CATALOG_VERIFICATION_FILE]: new TextEncoder().encode(`${JSON.stringify(receipt, null, 2)}\n`),
    LICENSE: new Uint8Array(await readFile(path.join(options.repoRoot, "LICENSE"))),
    "THIRD-PARTY-LICENSES.txt": new TextEncoder().encode(licenses.text),
  };
  const sums = formatSha256Sums(Object.entries(files).map(([name, bytes]) => ({ name, bytes })));

  say("成果物を書き出します");
  for (const [name, bytes] of Object.entries(files)) {
    await writeFile(path.join(options.outDir, name), bytes, { flag: "wx" });
  }
  await writeFile(path.join(options.outDir, SHA256SUMS_FILE), sums, { flag: "wx" });

  say("成果物を検査します");
  const verification = await verifyArtifactDir(options.outDir);
  return {
    outDir: options.outDir,
    verification,
    bodies,
    mainJsSha256: sha256Hex(bundle.code),
    dependencies: licenses.dependencies,
  };
}
