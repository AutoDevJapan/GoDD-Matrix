/**
 * 全本文 (DESIGN.md) の完全性検証: index の全エントリについて、pin の commit の tarball に本文が
 * 存在し、生バイトの sha256 が `entry.hash` に一致することを確かめる (正式配布物の生成時に実行)。
 *
 * - 取得は呼び出し側 (gunzip 済みの tar のチャンク列)。ここはディスクに書かず、1 パスで処理する。
 * - 本文は文字列に変換せず生バイトで照合する (BOM・改行を変えない)。実行時の検証 (design.ts) と同じ規則。
 * - tar に無い / 不一致 / 同じ path が複数回出る、のいずれかがあれば完全と認めない。
 */
import { verifyDesignHash } from "../ds/design.js";
import type { DesignIndexEntry } from "../ds/types.js";
import { DesignIndexError } from "../ds/validate.js";
import { readTarFiles } from "./tar.js";

/** 検証結果。配列は entry.id。 */
export interface BodyVerification {
  /** 検証対象の index エントリ数。 */
  readonly indexEntries: number;
  /** 本文が存在し、sha256 が entry.hash に一致した件数。 */
  readonly verified: number;
  /** 本文はあるが sha256 が一致しなかった entry.id。 */
  readonly mismatched: readonly string[];
  /** tar に本文が無かった entry.id。 */
  readonly missing: readonly string[];
  /** tar に同じ path が複数回現れた entry.id。 */
  readonly duplicated: readonly string[];
  /** index に載っていない `design-md/**\/DESIGN.md` の件数 (参考。完全性の判定には使わない)。 */
  readonly unlisted: number;
}

/** tar の先頭ディレクトリ (`<repo>-<commit>/`) を除いた path。 */
function stripTopDirectory(tarPath: string): string {
  const at = tarPath.indexOf("/");
  return at < 0 ? tarPath : tarPath.slice(at + 1);
}

function isDesignBody(path: string): boolean {
  return path.startsWith("design-md/") && path.endsWith("/DESIGN.md");
}

/**
 * index の全エントリの本文を tar (gunzip 済み) に照合する。
 * @throws TarFormatError tar が壊れている / 途中で切れている場合。
 */
export async function verifyBodiesInTar(
  entries: readonly DesignIndexEntry[],
  tar: AsyncIterable<Uint8Array>,
): Promise<BodyVerification> {
  const byPath = new Map(entries.map((entry) => [entry.path, entry]));
  const seen = new Set<string>();
  const mismatched: string[] = [];
  const duplicated: string[] = [];
  let verified = 0;
  let unlisted = 0;

  for await (const file of readTarFiles(tar, {
    filter: (path) => isDesignBody(stripTopDirectory(path)),
  })) {
    const relative = stripTopDirectory(file.path);
    const entry = byPath.get(relative);
    if (!entry) {
      unlisted++;
      continue;
    }
    if (seen.has(relative)) {
      duplicated.push(entry.id);
      continue;
    }
    seen.add(relative);
    if (verifyDesignHash(file.data, entry.hash)) verified++;
    else mismatched.push(entry.id);
  }

  const missing = entries.filter((entry) => !seen.has(entry.path)).map((entry) => entry.id);
  return { indexEntries: entries.length, verified, mismatched, missing, duplicated, unlisted };
}

function sample(ids: readonly string[]): string {
  const head = ids.slice(0, 5).join(", ");
  return ids.length > 5 ? `${head} ほか ${ids.length - 5} 件` : head;
}

/**
 * 検証結果が「index の全エントリが検証済み」であることを確かめる。
 * @throws DesignIndexError 0 件 / 欠落 / 不一致 / 重複のいずれかがある場合。
 */
export function assertCompleteBodies(result: BodyVerification): void {
  if (result.indexEntries === 0) {
    throw new DesignIndexError("本文の検証対象 (index) が 0 件です。完全性は確認できません");
  }
  const problems: string[] = [];
  if (result.missing.length > 0) {
    problems.push(`本文が見つかりません (${result.missing.length} 件): ${sample(result.missing)}`);
  }
  if (result.mismatched.length > 0) {
    problems.push(
      `本文の sha256 が entry.hash と一致しません (${result.mismatched.length} 件): ${sample(result.mismatched)}`,
    );
  }
  if (result.duplicated.length > 0) {
    problems.push(
      `同じ path の本文が重複しています (${result.duplicated.length} 件): ${sample(result.duplicated)}`,
    );
  }
  if (problems.length > 0) throw new DesignIndexError(problems.join(" / "));
  if (result.verified !== result.indexEntries) {
    throw new DesignIndexError(
      `検証済みの件数が index の件数と一致しません (${result.verified} / ${result.indexEntries})`,
    );
  }
}
