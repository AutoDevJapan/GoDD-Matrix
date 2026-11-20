import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { jsicBytes, makePin, taxonomyBytes } from "../ds/__fixtures__/snapshot-pin.js";
import { DesignIndexError } from "../ds/validate.js";
import { DS_SNAPSHOT_ENV, discoverSnapshot } from "./snapshot-source.js";

const indexBytes = new TextEncoder().encode('{"version":1,"entries":[]}');
const pinJson = JSON.stringify(makePin({ index: indexBytes, entryCount: 0 }));

const tempDirs: string[] = [];
function tempDir(): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), "godd-matrix-src-"));
  tempDirs.push(dir);
  return dir;
}
afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("discoverSnapshot", () => {
  it("snapshot.json が無ければ従来の環境変数指定動作のまま (undefined)", async () => {
    expect(await discoverSnapshot(tempDir(), {})).toBeUndefined();
  });

  it("隣の snapshot.json を読み、同じ場所の index を同梱 index として返す", async () => {
    const dir = tempDir();
    writeFileSync(path.join(dir, "snapshot.json"), pinJson);
    writeFileSync(path.join(dir, "index.json"), indexBytes);
    const found = await discoverSnapshot(dir, {});
    expect(found?.pin.commit).toBe("7d3ed9a3d171fee1b3f63f62ac73b71e102e8892");
    expect(found?.bundledIndex).toBe(path.join(dir, "index.json"));
  });

  it("同梱 index が無ければ bundledIndex は無い (pin の raw URL を使う)", async () => {
    const dir = tempDir();
    writeFileSync(path.join(dir, "snapshot.json"), pinJson);
    const found = await discoverSnapshot(dir, {});
    expect(found?.pin.index.entryCount).toBe(0);
    expect(found?.bundledIndex).toBeUndefined();
    expect(found?.bundledTaxonomy).toBeUndefined();
    expect(found?.bundledJsic).toBeUndefined();
  });

  it("同じ場所の taxonomy / jsic も同梱ファイルとして返す (pin の path 名で探す)", async () => {
    const dir = tempDir();
    writeFileSync(path.join(dir, "snapshot.json"), pinJson);
    writeFileSync(path.join(dir, "taxonomy.json"), taxonomyBytes);
    writeFileSync(path.join(dir, "jsic.json"), jsicBytes);
    const found = await discoverSnapshot(dir, {});
    expect(found?.bundledTaxonomy).toBe(path.join(dir, "taxonomy.json"));
    expect(found?.bundledJsic).toBe(path.join(dir, "jsic.json"));
    expect(found?.bundledIndex).toBeUndefined();
  });

  it("旧形式 (taxonomy / jsic の無い) pin は拒否し、従来動作へ黙って戻らない", async () => {
    const dir = tempDir();
    const { taxonomy: _t, jsic: _j, ...legacy } = JSON.parse(pinJson);
    writeFileSync(path.join(dir, "snapshot.json"), JSON.stringify(legacy));
    await expect(discoverSnapshot(dir, {})).rejects.toThrow(DesignIndexError);
  });

  it("環境変数で指した snapshot が無ければ拒否し、従来動作へ黙って戻らない", async () => {
    const missing = path.join(tempDir(), "none.json");
    await expect(discoverSnapshot(tempDir(), { [DS_SNAPSHOT_ENV]: missing })).rejects.toThrow(
      /snapshot/,
    );
  });

  it("環境変数で指した snapshot を、隣の snapshot.json より優先する", async () => {
    const entryDir = tempDir();
    writeFileSync(path.join(entryDir, "snapshot.json"), "{");
    const other = tempDir();
    writeFileSync(path.join(other, "pin.json"), pinJson);
    const found = await discoverSnapshot(entryDir, {
      [DS_SNAPSHOT_ENV]: path.join(other, "pin.json"),
    });
    expect(found?.pin.index.path).toBe("index.json");
  });

  it("隣の snapshot.json が不正なら拒否し、従来動作へ黙って戻らない", async () => {
    const dir = tempDir();
    writeFileSync(path.join(dir, "snapshot.json"), "{");
    await expect(discoverSnapshot(dir, {})).rejects.toThrow(DesignIndexError);
  });
});
