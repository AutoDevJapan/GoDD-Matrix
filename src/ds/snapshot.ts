/**
 * Design-Systems 取込の固定 (snapshot pin) — 正式 MCP 配布でのバイト束縛。
 *
 * pin は DS リポジトリの不変 commit と、その commit 直下の 3 ファイルのバイト同一性
 * (bytes / sha256 / git blob) を宣言する。
 * - `index.json`: 全セルの索引 (+ entries 件数)。
 * - `taxonomy.json`: カラー / ムード軸の語彙 (+ 色数 / ムード数)。
 * - `jsic.json`: 業種 (JSIC 細分類) の語彙 (+ 細分類数)。
 * いずれも pin に照合できるまで解釈しない。DESIGN.md 本文は pin 済み index の各 `entry.hash` で
 * 検証するため、1 つの pin が索引・軸の語彙・全本文を同じ snapshot に束縛する
 * (取得先は同じ commit の raw URL)。
 */
import { createHash } from "node:crypto";
import { DesignIndexError } from "./validate.js";

/** pin (`snapshot.json`) のスキーマ識別子。 */
export const SNAPSHOT_SCHEMA = "godd-matrix-ds-snapshot-v1";

/** pin が宣言できる index のバイト数の上限。 */
export const MAX_INDEX_BYTES = 256 * 1024 * 1024;

/** pin が宣言できる taxonomy / jsic のバイト数の上限。 */
export const MAX_CATALOG_BYTES = 16 * 1024 * 1024;

const REPOSITORY = /^[A-Za-z0-9][A-Za-z0-9-]{0,38}\/[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;
const COMMIT = /^[0-9a-f]{40}$/;
const SHA256 = /^[0-9a-f]{64}$/;
const FILE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;

/** commit 直下の 1 ファイルのバイト同一性。 */
export interface PinnedFile {
  /** commit 直下のファイル名 (ディレクトリ区切りは不可)。 */
  readonly path: string;
  /** バイト数。 */
  readonly bytes: number;
  /** sha256 (小文字 hex)。 */
  readonly sha256: string;
  /** git blob SHA-1 (GitHub 上の同一性)。 */
  readonly gitBlob: string;
}

/** DS の固定 snapshot と、その 3 ファイル (index / taxonomy / jsic) のバイト同一性。 */
export interface DsSnapshotPin {
  readonly schema: typeof SNAPSHOT_SCHEMA;
  /** DS リポジトリ (`owner/name`)。 */
  readonly repository: string;
  /** DS の commit (40 桁の小文字 hex)。ブランチ名は使わない。 */
  readonly commit: string;
  readonly index: PinnedFile & {
    /** index の entries 件数 (完全集合の件数)。 */
    readonly entryCount: number;
  };
  readonly taxonomy: PinnedFile & {
    /** taxonomy のカラー数 (完全集合の件数)。 */
    readonly colorCount: number;
    /** taxonomy のムード数 (完全集合の件数)。 */
    readonly moodCount: number;
  };
  readonly jsic: PinnedFile & {
    /** jsic の細分類数 (完全集合の件数)。 */
    readonly subclassCount: number;
  };
}

/** tool の結果へ載せる出所。pin の同一性だけを持つ。 */
export interface SnapshotProvenance {
  readonly repository: string;
  readonly commit: string;
  readonly indexSha256: string;
  readonly indexBytes: number;
  readonly entryCount: number;
  readonly taxonomySha256: string;
  readonly jsicSha256: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireExactKeys(obj: Record<string, unknown>, keys: readonly string[], where: string) {
  for (const key of Object.keys(obj)) {
    if (!keys.includes(key)) {
      throw new DesignIndexError(`${where}: 未知のキー "${key}" は受け付けません`);
    }
  }
  for (const key of keys) {
    if (!(key in obj)) throw new DesignIndexError(`${where}: "${key}" がありません`);
  }
}

function requireText(obj: Record<string, unknown>, key: string, where: string, pattern: RegExp) {
  const value = obj[key];
  if (typeof value !== "string" || !pattern.test(value)) {
    throw new DesignIndexError(`${where}: "${key}" が不正な形式です`);
  }
  return value;
}

function requireInteger(
  obj: Record<string, unknown>,
  key: string,
  where: string,
  min: number,
  max: number,
) {
  const value = obj[key];
  if (typeof value !== "number" || !Number.isInteger(value) || value < min || value > max) {
    throw new DesignIndexError(
      `${where}: "${key}" は ${min} 以上 ${max} 以下の整数である必要があります`,
    );
  }
  return value;
}

/** pin の 1 ファイル記述 (キー集合の厳密検査つき) を取り出す。個別の件数キーは呼び出し側が読む。 */
function readFileEntry(
  raw: Record<string, unknown>,
  key: string,
  countKeys: readonly string[],
  maxBytes: number,
): { obj: Record<string, unknown>; where: string; file: PinnedFile } {
  const obj = raw[key];
  if (!isRecord(obj)) {
    throw new DesignIndexError(`snapshot pin: "${key}" はオブジェクトである必要があります`);
  }
  const where = `snapshot pin.${key}`;
  requireExactKeys(obj, ["path", "bytes", "sha256", "gitBlob", ...countKeys], where);
  return {
    obj,
    where,
    file: {
      path: requireText(obj, "path", where, FILE_NAME),
      bytes: requireInteger(obj, "bytes", where, 1, maxBytes),
      sha256: requireText(obj, "sha256", where, SHA256),
      gitBlob: requireText(obj, "gitBlob", where, COMMIT),
    },
  };
}

/**
 * 未検証の値を検証済みの {@link DsSnapshotPin} に変換する。未知のキーは受け付けない。
 * @throws DesignIndexError 構造/形式が不正な場合。
 */
export function validateDsSnapshotPin(raw: unknown): DsSnapshotPin {
  if (!isRecord(raw)) throw new DesignIndexError("snapshot pin はオブジェクトである必要があります");
  requireExactKeys(
    raw,
    ["schema", "repository", "commit", "index", "taxonomy", "jsic"],
    "snapshot pin",
  );
  if (raw.schema !== SNAPSHOT_SCHEMA) {
    throw new DesignIndexError(`snapshot pin: "schema" は ${SNAPSHOT_SCHEMA} である必要があります`);
  }
  const index = readFileEntry(raw, "index", ["entryCount"], MAX_INDEX_BYTES);
  const taxonomy = readFileEntry(raw, "taxonomy", ["colorCount", "moodCount"], MAX_CATALOG_BYTES);
  const jsic = readFileEntry(raw, "jsic", ["subclassCount"], MAX_CATALOG_BYTES);
  const paths = [index.file.path, taxonomy.file.path, jsic.file.path];
  if (new Set(paths).size !== paths.length) {
    throw new DesignIndexError(
      "snapshot pin: index / taxonomy / jsic の path は互いに異なる必要があります",
    );
  }
  return {
    schema: SNAPSHOT_SCHEMA,
    repository: requireText(raw, "repository", "snapshot pin", REPOSITORY),
    commit: requireText(raw, "commit", "snapshot pin", COMMIT),
    index: {
      ...index.file,
      entryCount: requireInteger(index.obj, "entryCount", index.where, 0, Number.MAX_SAFE_INTEGER),
    },
    taxonomy: {
      ...taxonomy.file,
      colorCount: requireInteger(
        taxonomy.obj,
        "colorCount",
        taxonomy.where,
        1,
        Number.MAX_SAFE_INTEGER,
      ),
      moodCount: requireInteger(
        taxonomy.obj,
        "moodCount",
        taxonomy.where,
        1,
        Number.MAX_SAFE_INTEGER,
      ),
    },
    jsic: {
      ...jsic.file,
      subclassCount: requireInteger(
        jsic.obj,
        "subclassCount",
        jsic.where,
        1,
        Number.MAX_SAFE_INTEGER,
      ),
    },
  };
}

/**
 * `snapshot.json` の本文をパースして検証済みの pin を返す。
 * @throws DesignIndexError JSON として不正、または構造/形式が不正な場合。
 */
export function parseDsSnapshotPin(text: string): DsSnapshotPin {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (cause) {
    throw new DesignIndexError(
      `snapshot pin の JSON パースに失敗しました: ${(cause as Error).message}`,
    );
  }
  return validateDsSnapshotPin(raw);
}

/** pin の commit に固定した raw URL の base (末尾 `/`)。index も軸の語彙も本文もここから解決する。 */
export function snapshotRawBase(pin: DsSnapshotPin): string {
  return `https://raw.githubusercontent.com/${pin.repository}/${pin.commit}/`;
}

/** pin の 1 ファイルの既定の取得先 (commit に固定した raw URL)。 */
export function snapshotFileUrl(pin: DsSnapshotPin, file: PinnedFile): string {
  return `${snapshotRawBase(pin)}${file.path}`;
}

/** pin の index の既定の取得先 (commit に固定した raw URL)。 */
export function snapshotIndexUrl(pin: DsSnapshotPin): string {
  return snapshotFileUrl(pin, pin.index);
}

/**
 * 取得したファイルのバイト列が pin の宣言と同一か検証する。解釈 (パース) の前に呼ぶこと。
 * @param label 拒否理由に示すファイルの呼び名 (例: `index` / `taxonomy` / `jsic`)。
 * @throws DesignIndexError バイト数 / sha256 / git blob のいずれかが一致しない場合。
 */
export function verifyPinnedFileBytes(bytes: Uint8Array, file: PinnedFile, label: string): void {
  if (bytes.length !== file.bytes) {
    throw new DesignIndexError(
      `${label} のバイト数が pin と一致しません (bytes: 実測 ${bytes.length} / pin ${file.bytes})`,
    );
  }
  if (createHash("sha256").update(bytes).digest("hex") !== file.sha256) {
    throw new DesignIndexError(`${label} の sha256 が pin と一致しません`);
  }
  const blob = createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex");
  if (blob !== file.gitBlob) {
    throw new DesignIndexError(`${label} の git blob が pin と一致しません`);
  }
}

/**
 * 取得した index のバイト列が pin と同一か検証する。解釈 (パース) の前に呼ぶこと。
 * @throws DesignIndexError バイト数 / sha256 / git blob のいずれかが一致しない場合。
 */
export function verifyIndexBytes(bytes: Uint8Array, pin: DsSnapshotPin): void {
  verifyPinnedFileBytes(bytes, pin.index, "index");
}

/**
 * 解釈後の index の件数が pin と一致するか検証する (完全集合であることの確認)。
 * @throws DesignIndexError 件数が一致しない場合。
 */
export function verifyIndexEntryCount(count: number, pin: DsSnapshotPin): void {
  if (count !== pin.index.entryCount) {
    throw new DesignIndexError(
      `index の件数 (entryCount) が pin と一致しません (実測 ${count} / pin ${pin.index.entryCount})`,
    );
  }
}

/** tool の結果へ載せる出所 (pin の同一性のみ)。 */
export function snapshotProvenance(pin: DsSnapshotPin): SnapshotProvenance {
  return {
    repository: pin.repository,
    commit: pin.commit,
    indexSha256: pin.index.sha256,
    indexBytes: pin.index.bytes,
    entryCount: pin.index.entryCount,
    taxonomySha256: pin.taxonomy.sha256,
    jsicSha256: pin.jsic.sha256,
  };
}
