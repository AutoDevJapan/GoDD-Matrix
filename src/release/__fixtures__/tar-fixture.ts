/**
 * テスト用: 最小の tar (ustar + pax) を組み立てる。製品コードからは参照しない。
 */

const BLOCK = 512;

function writeString(target: Uint8Array, offset: number, value: string, length: number): void {
  const bytes = new TextEncoder().encode(value);
  if (bytes.length > length) throw new Error(`tar fixture: field too long (${value})`);
  target.set(bytes, offset);
}

function octal(value: number, length: number): string {
  return `${value.toString(8).padStart(length - 1, "0")}\0`;
}

/** 1 つの tar ヘッダ (512 バイト) を作る。chksum も正しく計算する。 */
export function tarHeader(name: string, size: number, type: string): Uint8Array {
  const header = new Uint8Array(BLOCK);
  writeString(header, 0, name, 100);
  writeString(header, 100, octal(0o644, 8), 8);
  writeString(header, 108, octal(0, 8), 8);
  writeString(header, 116, octal(0, 8), 8);
  writeString(header, 124, octal(size, 12), 12);
  writeString(header, 136, octal(0, 12), 12);
  header.fill(0x20, 148, 156); // chksum は計算中は空白
  writeString(header, 156, type, 1);
  writeString(header, 257, "ustar\0", 6);
  writeString(header, 263, "00", 2);
  let sum = 0;
  for (const byte of header) sum += byte;
  writeString(header, 148, `${sum.toString(8).padStart(6, "0")}\0 `, 8);
  return header;
}

function padded(data: Uint8Array): Uint8Array {
  const out = new Uint8Array(Math.ceil(data.length / BLOCK) * BLOCK);
  out.set(data);
  return out;
}

/** pax 拡張ヘッダの本文 (`<長さ> key=value\n` の列) を作る。 */
export function paxData(records: Record<string, string>): Uint8Array {
  const parts: Uint8Array[] = [];
  for (const [key, value] of Object.entries(records)) {
    const body = ` ${key}=${value}\n`;
    let length = new TextEncoder().encode(body).length;
    // 長さフィールド自身の桁数も含めて自己無撞着な値を求める。
    let total = length + String(length).length;
    total = length + String(total).length;
    length = total;
    parts.push(new TextEncoder().encode(`${length}${body}`));
  }
  const all = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const part of parts) {
    all.set(part, at);
    at += part.length;
  }
  return all;
}

export interface TarFixtureEntry {
  readonly path: string;
  readonly data?: Uint8Array;
  /** 既定は通常ファイル ("0")。ディレクトリは "5"。 */
  readonly type?: string;
  /** 指定すると、直前に pax 拡張ヘッダ ("x") を置く。 */
  readonly pax?: Record<string, string>;
}

/** エントリ列から tar のバイト列を作る (末尾に 2 つのゼロブロック)。 */
export function buildTar(entries: readonly TarFixtureEntry[]): Uint8Array {
  const blocks: Uint8Array[] = [];
  for (const entry of entries) {
    const data = entry.data ?? new Uint8Array(0);
    if (entry.pax) {
      const pax = paxData(entry.pax);
      blocks.push(tarHeader("PaxHeader/entry", pax.length, "x"), padded(pax));
    }
    blocks.push(tarHeader(entry.path.slice(-100), data.length, entry.type ?? "0"), padded(data));
  }
  blocks.push(new Uint8Array(BLOCK * 2));
  const out = new Uint8Array(blocks.reduce((n, b) => n + b.length, 0));
  let at = 0;
  for (const block of blocks) {
    out.set(block, at);
    at += block.length;
  }
  return out;
}

/** バイト列を指定サイズずつに刻んだ AsyncIterable にする (チャンク境界のテスト用)。 */
export async function* chunked(bytes: Uint8Array, size: number): AsyncGenerator<Uint8Array> {
  for (let at = 0; at < bytes.length; at += size) {
    yield bytes.slice(at, at + size);
  }
}
