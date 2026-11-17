import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  FIXTURE_COMMIT,
  FIXTURE_RAW_BASE,
  jsicBytes,
  makePin,
  taxonomyBytes,
} from "../ds/__fixtures__/snapshot-pin.js";
import { DS_INDEX_ENV, DesignIndexClient } from "../ds/client.js";
import { DesignIndexError } from "../ds/validate.js";
import { DS_BASE_ENV, createRuntime } from "./runtime.js";
import { runDecideAxes } from "./tools.js";

const fixtureDir = fileURLToPath(new URL("../ds/__fixtures__", import.meta.url));
const RAW = FIXTURE_RAW_BASE;
const BODY_PATH = "design-md/7281/h17b-lt/trustworthy/DESIGN.md";
const ctx = { jsic: "7281", color: "h17b-lt", mood: "trustworthy" };

function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

const tempDirs: string[] = [];
function tempDir(): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), "godd-matrix-rt-"));
  tempDirs.push(dir);
  return dir;
}

/**
 * index の hash が本文と一致する整合した 1 件の snapshot (index / taxonomy / jsic / 本文) を
 * 一時ディレクトリに作る。(既存 fixture の index.valid.json は本文と hash が一致しないため使えない。)
 */
function makeSnapshot() {
  const dir = tempDir();
  const body = new Uint8Array(readFileSync(path.join(fixtureDir, BODY_PATH)));
  const bodyFile = path.join(dir, BODY_PATH);
  mkdirSync(path.dirname(bodyFile), { recursive: true });
  writeFileSync(bodyFile, body);
  const index = {
    version: 1,
    entries: [
      {
        id: "7281_h17b-lt_trustworthy",
        path: BODY_PATH,
        jsic: "7281",
        color: "h17b-lt",
        mood: "trustworthy",
        title: "snapshot-title-a",
        hash: `sha256:${sha256Hex(body)}`,
        createdAt: "2026-07-11T00:00:00Z",
      },
    ],
  };
  const indexBytes = new Uint8Array(Buffer.from(JSON.stringify(index, null, 2), "utf8"));
  const indexFile = path.join(dir, "index.json");
  const taxonomyFile = path.join(dir, "taxonomy.json");
  const jsicFile = path.join(dir, "jsic.json");
  writeFileSync(indexFile, indexBytes);
  writeFileSync(taxonomyFile, taxonomyBytes);
  writeFileSync(jsicFile, jsicBytes);
  return {
    dir,
    body,
    bodyFile,
    indexBytes,
    indexFile,
    taxonomyFile,
    jsicFile,
    pin: makePin({ index: indexBytes, entryCount: 1 }),
  };
}

/** ファイルの 1 バイトだけを変えた (長さも JSON 構造も同じ) コピーを別の場所に書き出す。 */
function writeFlipped(from: string, needle: string, replacement: string): string {
  const text = readFileSync(from, "utf8");
  const changed = text.replace(needle, replacement);
  expect(changed).not.toBe(text);
  expect(Buffer.byteLength(changed)).toBe(Buffer.byteLength(text));
  const file = path.join(tempDir(), path.basename(from));
  writeFileSync(file, changed, "utf8");
  return file;
}

/** index の title を同じ長さの別の値に変えた JSON (構造は有効なまま) を書き出す。 */
function writeTamperedIndex(from: Uint8Array): string {
  const text = Buffer.from(from).toString("utf8");
  const changed = text.replace("snapshot-title-a", "snapshot-title-b");
  expect(changed).not.toBe(text);
  const file = path.join(tempDir(), "index.json");
  writeFileSync(file, changed, "utf8");
  return file;
}

beforeEach(() => {
  delete process.env[DS_INDEX_ENV];
  delete process.env[DS_BASE_ENV];
});

afterEach(() => {
  DesignIndexClient.clearCache();
  delete process.env[DS_INDEX_ENV];
  delete process.env[DS_BASE_ENV];
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("createRuntime の snapshot 束縛", () => {
  it("pin に一致する index と本文を検証し、出所 (provenance) を保持する", async () => {
    const s = makeSnapshot();
    const rt = await createRuntime({
      snapshot: s.pin,
      indexSource: s.indexFile,
      taxonomySource: s.taxonomyFile,
      jsicSource: s.jsicFile,
      bodyBase: s.dir,
      loadOptions: { cache: false },
    });
    expect(rt.snapshot).toEqual({
      repository: s.pin.repository,
      commit: FIXTURE_COMMIT,
      indexSha256: s.pin.index.sha256,
      indexBytes: s.pin.index.bytes,
      entryCount: 1,
      taxonomySha256: s.pin.taxonomy.sha256,
      jsicSha256: s.pin.jsic.sha256,
    });
    const res = await rt.resolver.resolve(ctx);
    expect(res.status).toBe("materialized");
    if (res.status === "materialized") expect(res.document.hashVerified).toBe(true);
  });

  it("改竄した index は runtime を返す前に拒否する", async () => {
    const s = makeSnapshot();
    await expect(
      createRuntime({
        snapshot: s.pin,
        indexSource: writeTamperedIndex(s.indexBytes),
        taxonomySource: s.taxonomyFile,
        jsicSource: s.jsicFile,
        bodyBase: s.dir,
        loadOptions: { cache: false },
      }),
    ).rejects.toThrow(DesignIndexError);
  });

  it("環境変数で index の場所を変えても pin 検証は外れない", async () => {
    const s = makeSnapshot();
    process.env[DS_INDEX_ENV] = writeTamperedIndex(s.indexBytes);
    await expect(
      createRuntime({
        snapshot: s.pin,
        taxonomySource: s.taxonomyFile,
        jsicSource: s.jsicFile,
        bodyBase: s.dir,
        loadOptions: { cache: false },
      }),
    ).rejects.toThrow(DesignIndexError);
  });

  it("改竄した taxonomy / jsic は runtime を返す前に拒否する (軸の語彙も同じ snapshot に束縛)", async () => {
    const s = makeSnapshot();
    const common = {
      snapshot: s.pin,
      indexSource: s.indexFile,
      bodyBase: s.dir,
      loadOptions: { cache: false },
    };
    await expect(
      createRuntime({
        ...common,
        taxonomySource: writeFlipped(s.taxonomyFile, '"black"', '"Black"'),
        jsicSource: s.jsicFile,
      }),
    ).rejects.toThrow(/taxonomy.*sha256/);
    await expect(
      createRuntime({
        ...common,
        taxonomySource: s.taxonomyFile,
        jsicSource: writeFlipped(s.jsicFile, "7281", "7282"),
      }),
    ).rejects.toThrow(/jsic.*sha256/);
  });

  it("本文が改竄されていれば拒否する (pin なしの従来動作は不一致を印にするだけ)", async () => {
    const s = makeSnapshot();
    writeFileSync(s.bodyFile, `${Buffer.from(s.body).toString("utf8")}\n改竄`, "utf8");
    const legacy = await createRuntime({
      indexSource: s.indexFile,
      bodyBase: s.dir,
      loadOptions: { cache: false },
    });
    const old = await legacy.resolver.resolve(ctx);
    expect(old.status === "materialized" && old.document.hashVerified).toBe(false);

    const pinned = await createRuntime({
      snapshot: s.pin,
      indexSource: s.indexFile,
      taxonomySource: s.taxonomyFile,
      jsicSource: s.jsicFile,
      bodyBase: s.dir,
      loadOptions: { cache: false },
    });
    await expect(pinned.resolver.resolve(ctx)).rejects.toThrow(/hash/);
  });

  it("bodyOptions で requireHash:false を指定しても snapshot 指定時は強制する", async () => {
    const s = makeSnapshot();
    writeFileSync(s.bodyFile, `${Buffer.from(s.body).toString("utf8")}\n改竄`, "utf8");
    const rt = await createRuntime({
      snapshot: s.pin,
      indexSource: s.indexFile,
      taxonomySource: s.taxonomyFile,
      jsicSource: s.jsicFile,
      bodyBase: s.dir,
      loadOptions: { cache: false },
      bodyOptions: { requireHash: false },
    });
    await expect(rt.resolver.resolve(ctx)).rejects.toThrow(/hash/);
  });

  it("既定の取得先は pin の commit に固定した raw URL (index / taxonomy / jsic / 本文)", async () => {
    const s = makeSnapshot();
    const urls: string[] = [];
    const serving = (files: Record<string, Uint8Array>) =>
      vi.fn(async (url: string) => {
        urls.push(String(url));
        const bytes = files[String(url)];
        return bytes ? new Response(bytes, { status: 200 }) : new Response("no", { status: 404 });
      }) as unknown as typeof fetch;
    const rt = await createRuntime({
      snapshot: s.pin,
      loadOptions: {
        cache: false,
        fetchImpl: serving({
          [`${RAW}index.json`]: s.indexBytes,
          [`${RAW}taxonomy.json`]: taxonomyBytes,
          [`${RAW}jsic.json`]: jsicBytes,
        }),
      },
      bodyOptions: { fetchImpl: serving({ [`${RAW}${BODY_PATH}`]: s.body }) },
    });
    const res = await rt.resolver.resolve(ctx);
    expect(res.status).toBe("materialized");
    expect([...urls].sort()).toEqual(
      [`${RAW}index.json`, `${RAW}taxonomy.json`, `${RAW}jsic.json`, `${RAW}${BODY_PATH}`].sort(),
    );
  });
});

describe("createRuntime の軸 (taxonomy / jsic から作る resolver)", () => {
  it("snapshot 指定時は runtime が軸 resolver を持ち、最小表に無い slug も確定できる", async () => {
    const s = makeSnapshot();
    const rt = await createRuntime({
      snapshot: s.pin,
      indexSource: s.indexFile,
      taxonomySource: s.taxonomyFile,
      jsicSource: s.jsicFile,
      bodyBase: s.dir,
      loadOptions: { cache: false },
    });
    expect(rt.axes).toBeDefined();
    const res = runDecideAxes({ industry: "7281", color: "lt-h18", mood: "elegant" }, rt);
    expect(res.context).toEqual({ jsic: "7281", color: "lt-h18", mood: "elegant" });
  });

  it("snapshot なしの従来構成は軸 resolver を持たず、最小表のまま", async () => {
    const s = makeSnapshot();
    const rt = await createRuntime({
      indexSource: s.indexFile,
      bodyBase: s.dir,
      loadOptions: { cache: false },
    });
    expect(rt.axes).toBeUndefined();
    expect(runDecideAxes({ industry: "7281", color: "lt-h18", mood: "elegant" }, rt).resolved).toBe(
      false,
    );
  });
});
