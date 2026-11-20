/**
 * 正式配布物 (MCP) の構成と自己検査。
 *
 * 配布物は 1 つのディレクトリ (zip にして配る) で、次を含む。
 * - `main.js`: 依存を同梱した単一ファイルの stdio MCP サーバ。
 * - `snapshot.json`: DS の固定 snapshot (pin)。
 * - `index.json` / `taxonomy.json` / `jsic.json`: pin が束縛する DS のファイル (bytes / sha256 / git blob)。
 * - `catalog-verification.json`: pin の commit の全本文 (DESIGN.md) を検証した結果 (件数のみ)。
 * - `LICENSE` / `THIRD-PARTY-LICENSES.txt`: 本体と、同梱した依存のライセンス。
 * - `SHA256SUMS`: 上記すべての sha256 (`sha256sum -c` で確認できる形式)。
 *
 * {@link verifyArtifactDir} は、生成直後 (配布前) にも、受け取った側でも同じ規則で検査できる。
 */
import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { loadPinnedCatalogs } from "../ds/catalogs.js";
import { DesignIndexClient } from "../ds/client.js";
import { type DsSnapshotPin, parseDsSnapshotPin } from "../ds/snapshot.js";
import { DesignIndexError } from "../ds/validate.js";
import { type BodyVerification, assertCompleteBodies } from "./verify-bodies.js";

/** チェックサム一覧のファイル名。 */
export const SHA256SUMS_FILE = "SHA256SUMS";
/** 全本文の検証記録のファイル名。 */
export const CATALOG_VERIFICATION_FILE = "catalog-verification.json";
/** 全本文の検証記録のスキーマ識別子。 */
export const CATALOG_VERIFICATION_SCHEMA = "godd-matrix-catalog-verification-v1";

/** pin の 3 ファイルの他に、成果物に必ず含めるファイル。 */
export const REQUIRED_ARTIFACT_FILES = [
  "main.js",
  "snapshot.json",
  "LICENSE",
  "THIRD-PARTY-LICENSES.txt",
  CATALOG_VERIFICATION_FILE,
] as const;

const FILE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;
const SUM_LINE = /^([0-9a-f]{64}) {2}([A-Za-z0-9][A-Za-z0-9._-]{0,99})$/;

function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/** チェックサム一覧 (`<sha256>  <name>\n`、名前順) を作る。名前はディレクトリ区切りを含められない。 */
export function formatSha256Sums(
  files: ReadonlyArray<{ readonly name: string; readonly bytes: Uint8Array }>,
): string {
  const names = new Set<string>();
  for (const file of files) {
    if (!FILE_NAME.test(file.name)) {
      throw new DesignIndexError(`SHA256SUMS: ファイル名が不正です: ${JSON.stringify(file.name)}`);
    }
    if (names.has(file.name))
      throw new DesignIndexError(`SHA256SUMS: 名前が重複しています: ${file.name}`);
    names.add(file.name);
  }
  return [...files]
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
    .map((file) => `${sha256Hex(file.bytes)}  ${file.name}\n`)
    .join("");
}

/** チェックサム一覧を厳密にパースして name → sha256 にする。 */
export function parseSha256Sums(text: string): Map<string, string> {
  if (text.length === 0 || !text.endsWith("\n")) {
    throw new DesignIndexError("SHA256SUMS: 空、または末尾が改行ではありません");
  }
  const sums = new Map<string, string>();
  text
    .slice(0, -1)
    .split("\n")
    .forEach((line, i) => {
      const match = SUM_LINE.exec(line);
      if (!match?.[1] || !match[2]) {
        throw new DesignIndexError(`SHA256SUMS: ${i + 1} 行目の形式が不正です`);
      }
      if (sums.has(match[2])) {
        throw new DesignIndexError(`SHA256SUMS: ${match[2]} が重複しています`);
      }
      sums.set(match[2], match[1]);
    });
  return sums;
}

/** 全本文の検証記録 (件数だけ。時刻・環境情報は含めず、同じ入力から同じ内容になる)。 */
export interface CatalogVerificationReceipt {
  readonly schema: typeof CATALOG_VERIFICATION_SCHEMA;
  readonly repository: string;
  readonly commit: string;
  readonly indexEntries: number;
  readonly bodiesVerified: number;
  readonly bodiesMissing: number;
  readonly bodiesMismatched: number;
  readonly bodiesDuplicated: number;
  readonly unlistedDesignMd: number;
}

/**
 * 全本文の検証結果から記録を作る。完全でない結果、または pin の件数と合わない結果からは作れない。
 * @throws DesignIndexError 検証が完全でない場合。
 */
export function catalogVerificationReceipt(
  pin: DsSnapshotPin,
  result: BodyVerification,
): CatalogVerificationReceipt {
  assertCompleteBodies(result);
  if (result.indexEntries !== pin.index.entryCount) {
    throw new DesignIndexError(
      `検証した index の件数 (${result.indexEntries}) が pin の entryCount (${pin.index.entryCount}) と一致しません`,
    );
  }
  return {
    schema: CATALOG_VERIFICATION_SCHEMA,
    repository: pin.repository,
    commit: pin.commit,
    indexEntries: result.indexEntries,
    bodiesVerified: result.verified,
    bodiesMissing: result.missing.length,
    bodiesMismatched: result.mismatched.length,
    bodiesDuplicated: result.duplicated.length,
    unlistedDesignMd: result.unlisted,
  };
}

const RECEIPT_KEYS = [
  "schema",
  "repository",
  "commit",
  "indexEntries",
  "bodiesVerified",
  "bodiesMissing",
  "bodiesMismatched",
  "bodiesDuplicated",
  "unlistedDesignMd",
] as const;

function checkReceipt(text: string, pin: DsSnapshotPin): void {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (cause) {
    throw new DesignIndexError(
      `${CATALOG_VERIFICATION_FILE}: JSON として不正です: ${(cause as Error).message}`,
    );
  }
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new DesignIndexError(`${CATALOG_VERIFICATION_FILE}: オブジェクトである必要があります`);
  }
  const receipt = raw as Record<string, unknown>;
  const keys = Object.keys(receipt);
  if (keys.length !== RECEIPT_KEYS.length || !RECEIPT_KEYS.every((key) => key in receipt)) {
    throw new DesignIndexError(`${CATALOG_VERIFICATION_FILE}: キーの集合が想定と一致しません`);
  }
  if (receipt.schema !== CATALOG_VERIFICATION_SCHEMA) {
    throw new DesignIndexError(`${CATALOG_VERIFICATION_FILE}: schema が想定と一致しません`);
  }
  if (receipt.repository !== pin.repository || receipt.commit !== pin.commit) {
    throw new DesignIndexError(
      `${CATALOG_VERIFICATION_FILE}: repository / commit が pin と一致しません`,
    );
  }
  const complete =
    receipt.indexEntries === pin.index.entryCount &&
    receipt.bodiesVerified === pin.index.entryCount &&
    receipt.bodiesMissing === 0 &&
    receipt.bodiesMismatched === 0 &&
    receipt.bodiesDuplicated === 0 &&
    typeof receipt.unlistedDesignMd === "number";
  if (!complete) {
    throw new DesignIndexError(
      `${CATALOG_VERIFICATION_FILE}: pin の全 ${pin.index.entryCount} 件の本文を検証した記録ではありません (本文の検証が完全ではありません)`,
    );
  }
}

/** {@link verifyArtifactDir} の結果。 */
export interface ArtifactVerification {
  /** SHA256SUMS に載った (= 成果物の) ファイル名。 */
  readonly files: readonly string[];
  readonly pin: DsSnapshotPin;
  /** pin が束縛する件数 (実際に読み取って一致を確認済み)。 */
  readonly entries: number;
  readonly colors: number;
  readonly moods: number;
  readonly subclasses: number;
}

/**
 * 成果物ディレクトリを検査する (配布前・受領後の両方で使える)。
 * - SHA256SUMS に載った全ファイルの sha256 が一致し、載っていないファイル / ディレクトリが無い。
 * - 必須ファイルがあり、main.js が空でない。
 * - snapshot.json の pin が、同梱の index / taxonomy / jsic のバイトと件数に一致する。
 * - 全本文の検証記録が、pin の全件を検証済みと示している。
 * @throws DesignIndexError いずれかを満たさない場合。
 */
export async function verifyArtifactDir(dir: string): Promise<ArtifactVerification> {
  const dirents = await readdir(dir, { withFileTypes: true });
  const nonFiles = dirents.filter((d) => !d.isFile()).map((d) => d.name);
  if (nonFiles.length > 0) {
    throw new DesignIndexError(
      `成果物に通常のファイルではないもの (サブディレクトリ等) があります: ${nonFiles.join(", ")}`,
    );
  }
  const actual = new Set(dirents.map((d) => d.name));
  if (!actual.has(SHA256SUMS_FILE)) {
    throw new DesignIndexError(`${SHA256SUMS_FILE} がありません`);
  }
  const sums = parseSha256Sums(await readFile(path.join(dir, SHA256SUMS_FILE), "utf8"));

  const unlisted = [...actual].filter((name) => name !== SHA256SUMS_FILE && !sums.has(name));
  if (unlisted.length > 0) {
    throw new DesignIndexError(
      `${SHA256SUMS_FILE} の一覧にないファイルがあります: ${unlisted.join(", ")}`,
    );
  }
  const absent = [...sums.keys()].filter((name) => !actual.has(name));
  if (absent.length > 0) {
    throw new DesignIndexError(
      `${SHA256SUMS_FILE} に載ったファイルが見つかりません: ${absent.join(", ")}`,
    );
  }
  for (const [name, expected] of sums) {
    if (sha256Hex(await readFile(path.join(dir, name))) !== expected) {
      throw new DesignIndexError(`${name} の sha256 が ${SHA256SUMS_FILE} と一致しません`);
    }
  }

  const required = (name: string) => {
    if (!sums.has(name)) throw new DesignIndexError(`必須ファイル ${name} が成果物にありません`);
  };
  for (const name of REQUIRED_ARTIFACT_FILES) required(name);
  const mainJs = await readFile(path.join(dir, "main.js"));
  if (mainJs.length === 0) throw new DesignIndexError("main.js が空です");

  const pin = parseDsSnapshotPin(await readFile(path.join(dir, "snapshot.json"), "utf8"));
  for (const file of [pin.index, pin.taxonomy, pin.jsic]) required(file.path);

  // pin に照合してから解釈する (実行時と同じ読み込み経路で、成果物自身が起動可能な内容であることを確かめる)。
  const index = await DesignIndexClient.load(path.join(dir, pin.index.path), { pin, cache: false });
  const catalogs = await loadPinnedCatalogs(pin, {
    taxonomySource: path.join(dir, pin.taxonomy.path),
    jsicSource: path.join(dir, pin.jsic.path),
  });
  checkReceipt(await readFile(path.join(dir, CATALOG_VERIFICATION_FILE), "utf8"), pin);

  return {
    files: [...sums.keys()],
    pin,
    entries: index.size,
    colors: catalogs.taxonomy.colors.length,
    moods: catalogs.taxonomy.moods.length,
    subclasses: catalogs.jsic.length,
  };
}
