import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchBytes } from "./fetch.js";
import { DesignIndexError } from "./validate.js";

const tempDirs: string[] = [];
afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function serving(response: () => Response): typeof fetch {
  return vi.fn(async () => response()) as unknown as typeof fetch;
}

describe("fetchBytes", () => {
  it("http(s) の応答をバイト列のまま返す (BOM も不正な UTF-8 も変えない)", async () => {
    const raw = new Uint8Array([0xef, 0xbb, 0xbf, 0x61, 0xff, 0xfe, 0x62]);
    const got = await fetchBytes("https://x.test/a", {
      fetchImpl: serving(() => new Response(raw, { status: 200 })),
    });
    expect(Array.from(got)).toEqual(Array.from(raw));
  });

  it("上限を超える応答は拒否する", async () => {
    await expect(
      fetchBytes("https://x.test/a", {
        maxBytes: 8,
        fetchImpl: serving(() => new Response(new Uint8Array(9), { status: 200 })),
      }),
    ).rejects.toThrow(DesignIndexError);
  });

  it("content-length が上限を超える応答は本文を読まず拒否する", async () => {
    await expect(
      fetchBytes("https://x.test/a", {
        maxBytes: 8,
        fetchImpl: serving(
          () => new Response("x", { status: 200, headers: { "content-length": "9" } }),
        ),
      }),
    ).rejects.toThrow(/content-length/);
  });

  it("HTTP エラーは拒否する", async () => {
    await expect(
      fetchBytes("https://x.test/a", {
        fetchImpl: serving(() => new Response("nope", { status: 404 })),
      }),
    ).rejects.toThrow(/HTTP 404/);
  });

  it("ローカルファイルを読み、上限超過は拒否する", async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "godd-matrix-fetch-"));
    tempDirs.push(dir);
    const file = path.join(dir, "a.bin");
    writeFileSync(file, new Uint8Array([1, 2, 3, 4]));
    expect(Array.from(await fetchBytes(file))).toEqual([1, 2, 3, 4]);
    await expect(fetchBytes(file, { maxBytes: 3 })).rejects.toThrow(DesignIndexError);
  });
});
