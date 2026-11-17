/**
 * 正式配布物の snapshot pin (`snapshot.json`) の発見 (stdio エントリ用)。
 *
 * - 環境変数 {@link DS_SNAPSHOT_ENV} があればそのファイルを読む (無ければ拒否)。
 * - 無ければ、エントリ (`main.js`) と同じディレクトリの `snapshot.json` を読む。
 * - どちらも無ければ undefined (従来の環境変数指定動作)。存在するが不正なら拒否し、
 *   従来動作へ黙って戻らない。
 */
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { type DsSnapshotPin, parseDsSnapshotPin } from "../ds/snapshot.js";
import { DesignIndexError } from "../ds/validate.js";

/** pin ファイルの場所を明示する環境変数名。 */
export const DS_SNAPSHOT_ENV = "GODD_DS_SNAPSHOT";

/** エントリの隣に置く pin ファイル名。 */
export const SNAPSHOT_FILE_NAME = "snapshot.json";

const MAX_SNAPSHOT_FILE_BYTES = 64 * 1024;

/** 発見した pin と、同じ場所に同梱された index / taxonomy / jsic (あれば)。 */
export interface DiscoveredSnapshot {
  readonly pin: DsSnapshotPin;
  /** 読み込んだ pin ファイルの絶対パス。 */
  readonly file: string;
  /** pin ファイルと同じディレクトリにある index ファイル (無ければ undefined)。 */
  readonly bundledIndex?: string;
  /** pin ファイルと同じディレクトリにある taxonomy ファイル (無ければ undefined)。 */
  readonly bundledTaxonomy?: string;
  /** pin ファイルと同じディレクトリにある jsic ファイル (無ければ undefined)。 */
  readonly bundledJsic?: string;
}

function isNotFound(cause: unknown): boolean {
  return (cause as NodeJS.ErrnoException | undefined)?.code === "ENOENT";
}

async function isFile(candidate: string): Promise<boolean> {
  try {
    return (await stat(candidate)).isFile();
  } catch {
    return false;
  }
}

async function readPinFile(file: string): Promise<string> {
  const info = await stat(file);
  if (!info.isFile() || info.size > MAX_SNAPSHOT_FILE_BYTES) {
    throw new DesignIndexError(
      `snapshot の読み込みに失敗しました: 通常のファイルではないか大きすぎます (${file})`,
    );
  }
  return readFile(file, "utf8");
}

/**
 * 正式配布物の snapshot pin を発見する。
 * @param entryDir エントリ (`main.js`) のあるディレクトリ。
 * @throws DesignIndexError 明示された pin が無い、または pin が不正な場合。
 */
export async function discoverSnapshot(
  entryDir: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<DiscoveredSnapshot | undefined> {
  const explicit = env[DS_SNAPSHOT_ENV];
  const file = explicit ? path.resolve(explicit) : path.join(entryDir, SNAPSHOT_FILE_NAME);
  let text: string;
  try {
    text = await readPinFile(file);
  } catch (cause) {
    if (!explicit && isNotFound(cause)) return undefined;
    if (cause instanceof DesignIndexError) throw cause;
    throw new DesignIndexError(
      `snapshot の読み込みに失敗しました: ${file} (${(cause as Error).message})`,
    );
  }
  const pin = parseDsSnapshotPin(text);
  const dir = path.dirname(file);
  const bundled = async (name: string): Promise<string | undefined> => {
    const candidate = path.join(dir, name);
    return (await isFile(candidate)) ? candidate : undefined;
  };
  const [bundledIndex, bundledTaxonomy, bundledJsic] = await Promise.all([
    bundled(pin.index.path),
    bundled(pin.taxonomy.path),
    bundled(pin.jsic.path),
  ]);
  return {
    pin,
    file,
    ...(bundledIndex ? { bundledIndex } : {}),
    ...(bundledTaxonomy ? { bundledTaxonomy } : {}),
    ...(bundledJsic ? { bundledJsic } : {}),
  };
}
