import { describe, expect, it } from "vitest";
import { buildTar, chunked, tarHeader } from "./__fixtures__/tar-fixture.js";
import { type TarFile, readTarFiles } from "./tar.js";

const enc = (s: string) => new TextEncoder().encode(s);
const dec = (b: Uint8Array) => new TextDecoder().decode(b);

async function collect(
  chunks: AsyncIterable<Uint8Array>,
  options?: Parameters<typeof readTarFiles>[1],
): Promise<TarFile[]> {
  const out: TarFile[] = [];
  for await (const file of readTarFiles(chunks, options)) out.push(file);
  return out;
}

const sample = buildTar([
  { path: "repo-abc/", type: "5" },
  { path: "repo-abc/a.txt", data: enc("alpha") },
  { path: "repo-abc/dir/b.txt", data: enc("b".repeat(700)) }, // 512 バイトをまたぐ本文
  { path: "repo-abc/empty.txt", data: enc("") },
]);

describe("readTarFiles", () => {
  it("通常ファイルだけを順に返し、ディレクトリは返さない", async () => {
    const files = await collect(chunked(sample, 1 << 16));
    expect(files.map((f) => f.path)).toEqual([
      "repo-abc/a.txt",
      "repo-abc/dir/b.txt",
      "repo-abc/empty.txt",
    ]);
    expect(dec(files[0]?.data ?? new Uint8Array())).toBe("alpha");
    expect(files[1]?.data.length).toBe(700);
    expect(files[2]?.data.length).toBe(0);
  });

  it("入力のチャンク境界がどこでも同じ結果になる (1 バイト単位 / 513 バイト単位)", async () => {
    const whole = await collect(chunked(sample, 1 << 16));
    for (const size of [1, 7, 512, 513]) {
      const files = await collect(chunked(sample, size));
      expect(files.map((f) => [f.path, f.data.length])).toEqual(
        whole.map((f) => [f.path, f.data.length]),
      );
    }
  });

  it("pax 拡張ヘッダの path を、直後のエントリの名前として使う", async () => {
    const longPath = `repo-abc/${"d/".repeat(60)}DESIGN.md`;
    const tar = buildTar([
      { path: "repo-abc/ignored-short-name", data: enc("body"), pax: { path: longPath } },
    ]);
    const files = await collect(chunked(tar, 4096));
    expect(files.map((f) => f.path)).toEqual([longPath]);
  });

  it("グローバル pax ヘッダ (g) は読み飛ばす", async () => {
    const tar = buildTar([{ path: "pax_global_header", type: "g", data: enc("52 comment=x\n") }]);
    expect(await collect(chunked(tar, 4096))).toEqual([]);
  });

  it("filter が false のファイルは本文を返さず、後続のファイルは正しく読める", async () => {
    const files = await collect(chunked(sample, 100), {
      filter: (path) => path.endsWith("empty.txt") || path.endsWith("a.txt"),
    });
    expect(files.map((f) => f.path)).toEqual(["repo-abc/a.txt", "repo-abc/empty.txt"]);
  });

  it("本文が途中で切れた tar を拒否する", async () => {
    const truncated = sample.slice(0, 512 + 512 + 600);
    await expect(collect(chunked(truncated, 4096))).rejects.toThrow(/途中で終わ/);
  });

  it("ヘッダの chksum が合わない tar を拒否する", async () => {
    const broken = sample.slice();
    broken[0] = (broken[0] ?? 0) ^ 0x01;
    await expect(collect(chunked(broken, 4096))).rejects.toThrow(/チェックサム/);
  });

  it("上限を超えるファイルは本文を読み込まず拒否する", async () => {
    await expect(collect(chunked(sample, 4096), { maxFileBytes: 600 })).rejects.toThrow(/上限/);
  });

  it("終端のゼロブロックで読み取りを終え、その後ろの内容は無視する", async () => {
    const trailing = new Uint8Array(sample.length + 700);
    trailing.set(sample);
    trailing.fill(0x41, sample.length);
    const files = await collect(chunked(trailing, 4096));
    expect(files).toHaveLength(3);
  });

  it("空の入力は空として扱う", async () => {
    expect(await collect(chunked(new Uint8Array(0), 16))).toEqual([]);
  });

  it("tarHeader のフィクスチャ自体が 512 バイト", () => {
    expect(tarHeader("x", 0, "0")).toHaveLength(512);
  });
});
