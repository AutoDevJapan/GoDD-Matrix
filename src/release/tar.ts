/**
 * 最小の tar リーダー (ストリーム処理)。GitHub の codeload tarball (gunzip 済み) から、
 * 通常ファイルの path と本文を 1 件ずつ取り出す。ディスクへ書かない。
 *
 * 対応: ustar / pax 拡張ヘッダ (`x` の path・size) / GNU 長いパス名 (`L`)。
 * 拒否: ヘッダのチェックサム不一致、本文の途中切れ、上限を超えるファイル。
 * 終端のゼロブロックを読んだら、その後ろは読まない。
 */

/** tar 中の通常ファイル 1 件。 */
export interface TarFile {
  /** tar 内のパス (pax / GNU 長いパス名を反映済み)。 */
  readonly path: string;
  readonly data: Uint8Array;
}

/** {@link readTarFiles} のオプション。 */
export interface ReadTarOptions {
  /** true を返すパスだけ本文を読み込んで返す。false のファイルは読み飛ばす (既定: すべて)。 */
  readonly filter?: (path: string) => boolean;
  /** 読み込んで返す 1 ファイルの上限 (bytes)。既定 64 MiB。読み飛ばすファイルには適用しない。 */
  readonly maxFileBytes?: number;
}

/** tar の形式不正・途中切れ・上限超過。 */
export class TarFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TarFormatError";
  }
}

const BLOCK = 512;
const DEFAULT_MAX_FILE_BYTES = 64 * 1024 * 1024;
const MAX_PAX_BYTES = 1024 * 1024;
const EMPTY = new Uint8Array(0);

function concat(parts: readonly Uint8Array[]): Uint8Array {
  if (parts.length === 1 && parts[0]) return parts[0];
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

/** AsyncIterable のチャンク列から、必要なバイト数だけを取り出す。 */
class ByteReader {
  private readonly iterator: AsyncIterator<Uint8Array>;
  private buffer: Uint8Array = EMPTY;

  constructor(chunks: AsyncIterable<Uint8Array>) {
    this.iterator = chunks[Symbol.asyncIterator]();
  }

  /** まだ消費していない保持バイト数 (take が失敗したときは、読めた分)。 */
  get buffered(): number {
    return this.buffer.length;
  }

  /** ちょうど n バイトを取り出す。入力が先に終わったら undefined (読めた分は buffered に残る)。 */
  async take(n: number): Promise<Uint8Array | undefined> {
    if (this.buffer.length >= n) {
      const out = this.buffer.subarray(0, n);
      this.buffer = this.buffer.subarray(n);
      return out;
    }
    const parts: Uint8Array[] = [this.buffer];
    let have = this.buffer.length;
    while (have < n) {
      const next = await this.iterator.next();
      if (next.done) {
        this.buffer = concat(parts);
        return undefined;
      }
      if (next.value.length === 0) continue;
      parts.push(next.value);
      have += next.value.length;
    }
    const all = concat(parts);
    this.buffer = all.subarray(n);
    return all.subarray(0, n);
  }

  /** n バイトを読み飛ばす。入力が先に終わったら false。 */
  async skip(n: number): Promise<boolean> {
    let remaining = n;
    while (remaining > 0) {
      if (this.buffer.length === 0) {
        const next = await this.iterator.next();
        if (next.done) return false;
        this.buffer = next.value;
        continue;
      }
      const k = Math.min(remaining, this.buffer.length);
      this.buffer = this.buffer.subarray(k);
      remaining -= k;
    }
    return true;
  }

  async close(): Promise<void> {
    await this.iterator.return?.();
  }
}

function cString(bytes: Uint8Array): string {
  const end = bytes.indexOf(0);
  return new TextDecoder().decode(end < 0 ? bytes : bytes.subarray(0, end));
}

function parseSize(field: Uint8Array): number {
  if ((field[0] ?? 0) & 0x80) {
    // GNU の base-256 表記 (8 GiB 超)。先頭ビットを除いた big-endian。
    let value = (field[0] ?? 0) & 0x7f;
    for (let i = 1; i < field.length; i++) value = value * 256 + (field[i] ?? 0);
    if (!Number.isSafeInteger(value)) throw new TarFormatError("tar: size が大きすぎます");
    return value;
  }
  const text = cString(field).trim();
  if (text === "") return 0;
  if (!/^[0-7]+$/.test(text)) throw new TarFormatError("tar: size の形式が不正です");
  return Number.parseInt(text, 8);
}

function verifyChecksum(header: Uint8Array): void {
  const stored = cString(header.subarray(148, 156)).trim();
  if (!/^[0-7]+$/.test(stored)) throw new TarFormatError("tar: ヘッダのチェックサムが不正です");
  let sum = 0;
  for (let i = 0; i < BLOCK; i++) sum += i >= 148 && i < 156 ? 0x20 : (header[i] ?? 0);
  if (sum !== Number.parseInt(stored, 8)) {
    throw new TarFormatError("tar: ヘッダのチェックサムが一致しません");
  }
}

/** pax の `<長さ> key=value\n` の列を key → value にする。 */
function parsePax(data: Uint8Array): Record<string, string> {
  const out: Record<string, string> = {};
  let at = 0;
  while (at < data.length) {
    const space = data.indexOf(0x20, at);
    if (space < 0) break;
    const length = Number.parseInt(new TextDecoder().decode(data.subarray(at, space)), 10);
    if (!Number.isInteger(length) || length <= space - at + 1 || at + length > data.length) {
      throw new TarFormatError("tar: pax ヘッダの形式が不正です");
    }
    const record = new TextDecoder().decode(data.subarray(space + 1, at + length - 1));
    const eq = record.indexOf("=");
    if (eq > 0) out[record.slice(0, eq)] = record.slice(eq + 1);
    at += length;
  }
  return out;
}

/**
 * gunzip 済みの tar のチャンク列から、通常ファイルを 1 件ずつ返す。
 * @throws TarFormatError 形式不正 / 途中切れ / 上限超過。
 */
export async function* readTarFiles(
  chunks: AsyncIterable<Uint8Array>,
  options: ReadTarOptions = {},
): AsyncGenerator<TarFile> {
  const maxFileBytes = options.maxFileBytes ?? DEFAULT_MAX_FILE_BYTES;
  const reader = new ByteReader(chunks);
  let pendingPath: string | undefined;
  let pendingSize: number | undefined;
  try {
    for (;;) {
      const header = await reader.take(BLOCK);
      if (header === undefined) {
        if (reader.buffered === 0) return; // ブロック境界での正常な終端
        throw new TarFormatError("tar: ヘッダの途中で終わっています");
      }
      if (header.every((b) => b === 0)) return; // 終端のゼロブロック
      verifyChecksum(header);

      const type = String.fromCharCode(header[156] || 0x30);
      let name = cString(header.subarray(0, 100));
      const prefix = cString(header.subarray(345, 500));
      if (prefix && cString(header.subarray(257, 262)) === "ustar") name = `${prefix}/${name}`;
      let size = parseSize(header.subarray(124, 136));
      const padded = Math.ceil(size / BLOCK) * BLOCK;

      if (type === "x" || type === "g" || type === "L") {
        if (size > MAX_PAX_BYTES) throw new TarFormatError("tar: 拡張ヘッダが大きすぎます");
        const body = await reader.take(padded);
        if (body === undefined) throw new TarFormatError("tar: 拡張ヘッダの途中で終わっています");
        const data = body.subarray(0, size);
        if (type === "x") {
          const records = parsePax(data);
          pendingPath = records.path ?? pendingPath;
          if (records.size !== undefined) pendingSize = Number.parseInt(records.size, 10);
        } else if (type === "L") {
          pendingPath = cString(data);
        }
        continue;
      }

      const path = pendingPath ?? name;
      if (pendingSize !== undefined) size = pendingSize;
      pendingPath = undefined;
      pendingSize = undefined;
      const total = Math.ceil(size / BLOCK) * BLOCK;

      const isFile = type === "0" || type === "\0";
      if (!isFile || !(options.filter?.(path) ?? true)) {
        if (!(await reader.skip(total))) {
          throw new TarFormatError(`tar: ${path} の本文の途中で終わっています`);
        }
        continue;
      }
      if (size > maxFileBytes) {
        throw new TarFormatError(`tar: ${path} が上限 (${maxFileBytes} bytes) を超えています`);
      }
      const body = await reader.take(total);
      if (body === undefined) throw new TarFormatError(`tar: ${path} の本文の途中で終わっています`);
      yield { path, data: body.subarray(0, size) };
    }
  } finally {
    await reader.close();
  }
}
