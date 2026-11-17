import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { makePin } from "./__fixtures__/snapshot-pin.js";
import { DesignIndexClient } from "./client.js";
import { DesignBodyClient } from "./design.js";
import type { DesignIndexEntry } from "./types.js";
import { DesignIndexError } from "./validate.js";

const fixturePath = fileURLToPath(new URL("./__fixtures__/index.valid.json", import.meta.url));
const fixtureBytes = new Uint8Array(readFileSync(fixturePath));
const SOURCE = "https://index.test/index.json";

function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/** テスト用の pin。index のバイト同一性と件数を宣言する (taxonomy / jsic は最小の固定値)。 */
function pinFor(bytes: Uint8Array, entryCount = 3) {
  return makePin({ index: bytes, entryCount });
}

/** 長さを変えずに 1 文字だけ違えた index (JSON としては有効なまま)。 */
function tamperedSameLength(): Uint8Array {
  const text = Buffer.from(fixtureBytes).toString("utf8");
  const changed = text.replace("a52a165a297d54aa", "a52a165a297d54ab");
  expect(changed).not.toBe(text);
  const bytes = new Uint8Array(Buffer.from(changed, "utf8"));
  expect(bytes.length).toBe(fixtureBytes.length);
  return bytes;
}

function serving(bytes: Uint8Array): typeof fetch {
  return vi.fn(async () => new Response(bytes, { status: 200 })) as unknown as typeof fetch;
}

const tempDirs: string[] = [];
function tempDir(): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), "godd-matrix-pin-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  DesignIndexClient.clearCache();
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("pin 付き index 取込 (解釈前のバイト束縛)", () => {
  it("pin と同一のバイトなら取り込み、件数も pin と一致する", async () => {
    const c = await DesignIndexClient.load(fixturePath, {
      cache: false,
      pin: pinFor(fixtureBytes),
    });
    expect(c.size).toBe(3);
  });

  it("同じ長さで 1 文字だけ違うバイトは拒否する (pin なしの従来取込は気付けない)", async () => {
    const bad = tamperedSameLength();
    const legacy = await DesignIndexClient.load(SOURCE, { cache: false, fetchImpl: serving(bad) });
    expect(legacy.size).toBe(3);
    await expect(
      DesignIndexClient.load(SOURCE, {
        cache: false,
        fetchImpl: serving(bad),
        pin: pinFor(fixtureBytes),
      }),
    ).rejects.toThrow(DesignIndexError);
  });

  it("長さが違う (途中で切れた) バイトは拒否する", async () => {
    const truncated = fixtureBytes.slice(0, fixtureBytes.length - 5);
    await expect(
      DesignIndexClient.load(SOURCE, {
        cache: false,
        fetchImpl: serving(truncated),
        pin: pinFor(fixtureBytes),
      }),
    ).rejects.toThrow(/bytes/);
  });

  it("pin の entryCount と実際の件数が違えば拒否する", async () => {
    await expect(
      DesignIndexClient.load(fixturePath, { cache: false, pin: pinFor(fixtureBytes, 2) }),
    ).rejects.toThrow(/entryCount/);
  });

  it("pin ごとにキャッシュを分け、検証前の結果を再利用しない", async () => {
    const good = pinFor(fixtureBytes);
    const fetchImpl = serving(fixtureBytes);
    await DesignIndexClient.load(SOURCE, { fetchImpl, pin: good });
    const wrong = { ...good, index: { ...good.index, sha256: "0".repeat(64) } };
    await expect(DesignIndexClient.load(SOURCE, { fetchImpl, pin: wrong })).rejects.toThrow(
      DesignIndexError,
    );
  });

  it("ローカルファイルも同じ pin で検証する", async () => {
    const file = path.join(tempDir(), "index.json");
    writeFileSync(file, tamperedSameLength());
    await expect(
      DesignIndexClient.load(file, { cache: false, pin: pinFor(fixtureBytes) }),
    ).rejects.toThrow(/sha256/);
  });
});

describe("DESIGN.md 本文のバイト束縛", () => {
  const base = "https://raw.test/ds/";
  const entryFor = (hash: string): DesignIndexEntry => ({
    id: "7281_h17b-lt_trustworthy",
    path: "design-md/7281/h17b-lt/trustworthy/DESIGN.md",
    jsic: "7281",
    color: "h17b-lt",
    mood: "trustworthy",
    title: "本文のバイト束縛",
    hash,
    createdAt: "2026-07-11T00:00:00Z",
  });

  it("hash は生バイトの sha256 で判定する (BOM 付き本文でも一致する)", async () => {
    const body = new Uint8Array([0xef, 0xbb, 0xbf, ...Buffer.from("# 本文\n", "utf8")]);
    const client = new DesignBodyClient(base, { fetchImpl: serving(body), requireHash: true });
    const doc = await client.fetch(entryFor(`sha256:${sha256Hex(body)}`));
    expect(doc.hashVerified).toBe(true);
    expect(doc.markdown).toBe("# 本文\n");
  });

  it("hash 不一致の本文は requireHash で拒否し、内容を返さない", async () => {
    const body = new Uint8Array(Buffer.from("# 本文\n", "utf8"));
    const client = new DesignBodyClient(base, { fetchImpl: serving(body), requireHash: true });
    await expect(client.fetch(entryFor(`sha256:${"0".repeat(64)}`))).rejects.toThrow(/hash/);
  });

  it("上限 (4 MiB) を超える本文は拒否する", async () => {
    const huge = new Uint8Array(5 * 1024 * 1024).fill(0x61);
    const client = new DesignBodyClient(base, { fetchImpl: serving(huge) });
    await expect(client.fetch(entryFor(`sha256:${sha256Hex(huge)}`))).rejects.toThrow(
      DesignIndexError,
    );
  });
});
