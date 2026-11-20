import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { DesignIndexEntry } from "../ds/types.js";
import { DesignIndexError } from "../ds/validate.js";
import { buildTar, chunked } from "./__fixtures__/tar-fixture.js";
import { assertCompleteBodies, verifyBodiesInTar } from "./verify-bodies.js";

const enc = (s: string) => new TextEncoder().encode(s);
const hashOf = (bytes: Uint8Array) => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;

function entry(id: string, body: Uint8Array): DesignIndexEntry {
  const [jsic = "", color = "", mood = ""] = id.split("_");
  return {
    id,
    path: `design-md/${jsic}/${color}/${mood}/DESIGN.md`,
    jsic,
    color,
    mood,
    title: id,
    hash: hashOf(body),
    createdAt: "2026-07-11T00:00:00Z",
  };
}

const bodyA = enc("# A\n本文A\n");
const bodyB = new Uint8Array([0xef, 0xbb, 0xbf, ...enc("# B (BOM 付き)\r\n")]);
const entries = [entry("0100_ac-bk_cool", bodyA), entry("0100_lt-h17_zen", bodyB)];
const ROOT = "repo-7d3ed9a";

const archive = (files: Array<[string, Uint8Array]>) =>
  buildTar([
    { path: `${ROOT}/`, type: "5" },
    { path: `${ROOT}/index.json`, data: enc("{}") },
    ...files.map(([p, data]) => ({ path: `${ROOT}/${p}`, data })),
  ]);

describe("verifyBodiesInTar", () => {
  it("全件が揃い、生バイトの sha256 が entry.hash と一致すれば完全 (BOM / CRLF も生のまま)", async () => {
    const tar = archive([
      ["design-md/0100/ac-bk/cool/DESIGN.md", bodyA],
      ["design-md/0100/lt-h17/zen/DESIGN.md", bodyB],
    ]);
    const result = await verifyBodiesInTar(entries, chunked(tar, 300));
    expect(result).toEqual({
      indexEntries: 2,
      verified: 2,
      mismatched: [],
      missing: [],
      duplicated: [],
      unlisted: 0,
    });
    expect(() => assertCompleteBodies(result)).not.toThrow();
  });

  it("本文が 1 バイト違えば不一致として id を返し、完全とは認めない", async () => {
    const changed = bodyA.slice();
    changed[2] = 0x42;
    const tar = archive([
      ["design-md/0100/ac-bk/cool/DESIGN.md", changed],
      ["design-md/0100/lt-h17/zen/DESIGN.md", bodyB],
    ]);
    const result = await verifyBodiesInTar(entries, chunked(tar, 4096));
    expect(result.mismatched).toEqual(["0100_ac-bk_cool"]);
    expect(result.verified).toBe(1);
    expect(() => assertCompleteBodies(result)).toThrow(/0100_ac-bk_cool/);
  });

  it("tar に無い本文は missing として id を返し、完全とは認めない", async () => {
    const tar = archive([["design-md/0100/ac-bk/cool/DESIGN.md", bodyA]]);
    const result = await verifyBodiesInTar(entries, chunked(tar, 4096));
    expect(result.missing).toEqual(["0100_lt-h17_zen"]);
    expect(() => assertCompleteBodies(result)).toThrow(DesignIndexError);
    // 件数の不一致 (verified / indexEntries) とは別に、欠落した本文の id を名指しして拒否する。
    expect(() => assertCompleteBodies(result)).toThrow(/見つかりません.*0100_lt-h17_zen/);
  });

  it("同じ path が 2 回出る tar は、後の複製が違っていても見逃さず拒否する", async () => {
    const tar = archive([
      ["design-md/0100/ac-bk/cool/DESIGN.md", bodyA],
      ["design-md/0100/lt-h17/zen/DESIGN.md", bodyB],
      ["design-md/0100/ac-bk/cool/DESIGN.md", enc("別の本文")],
    ]);
    const result = await verifyBodiesInTar(entries, chunked(tar, 4096));
    expect(result.duplicated).toEqual(["0100_ac-bk_cool"]);
    expect(() => assertCompleteBodies(result)).toThrow(/重複/);
  });

  it("index に無い DESIGN.md は数えるだけで、検証対象 (index) の完全性は損なわない", async () => {
    const tar = archive([
      ["design-md/0100/ac-bk/cool/DESIGN.md", bodyA],
      ["design-md/0100/lt-h17/zen/DESIGN.md", bodyB],
      ["design-md/9999/x/y/DESIGN.md", enc("extra")],
      ["README.md", enc("not a design")],
    ]);
    const result = await verifyBodiesInTar(entries, chunked(tar, 4096));
    expect(result.unlisted).toBe(1);
    expect(() => assertCompleteBodies(result)).not.toThrow();
  });

  it("先頭のディレクトリ名 (repo-commit) を除いた path で index と突き合わせる", async () => {
    const tar = buildTar([
      { path: "design-md/0100/ac-bk/cool/DESIGN.md", data: bodyA }, // 先頭要素が無い = 別の path
    ]);
    const result = await verifyBodiesInTar([entries[0] as DesignIndexEntry], chunked(tar, 4096));
    expect(result.verified).toBe(0);
    expect(result.missing).toEqual(["0100_ac-bk_cool"]);
  });

  it("入力のチャンク境界に依らず同じ結果になる", async () => {
    const tar = archive([
      ["design-md/0100/ac-bk/cool/DESIGN.md", bodyA],
      ["design-md/0100/lt-h17/zen/DESIGN.md", bodyB],
    ]);
    const whole = await verifyBodiesInTar(entries, chunked(tar, 1 << 16));
    for (const size of [1, 511, 513]) {
      expect(await verifyBodiesInTar(entries, chunked(tar, size))).toEqual(whole);
    }
  });

  it("途中で切れた tar は完全として扱わず、エラーにする", async () => {
    const tar = archive([
      ["design-md/0100/ac-bk/cool/DESIGN.md", bodyA],
      ["design-md/0100/lt-h17/zen/DESIGN.md", bodyB],
    ]);
    await expect(verifyBodiesInTar(entries, chunked(tar.slice(0, 1700), 4096))).rejects.toThrow(
      /途中で終わ/,
    );
  });

  it("index のエントリが 0 件なら完全と認めない (空の検証を成功にしない)", async () => {
    const result = await verifyBodiesInTar([], chunked(archive([]), 4096));
    expect(() => assertCompleteBodies(result)).toThrow(/0 件/);
  });
});
