import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  SAMPLE_COLOR_COUNT,
  SAMPLE_MOOD_COUNT,
  SAMPLE_SUBCLASS_COUNT,
  jsicBytes,
  makePin,
  taxonomyBytes,
} from "../ds/__fixtures__/snapshot-pin.js";
import {
  CATALOG_VERIFICATION_FILE,
  SHA256SUMS_FILE,
  catalogVerificationReceipt,
  formatSha256Sums,
  parseSha256Sums,
  verifyArtifactDir,
} from "./artifact.js";
import type { BodyVerification } from "./verify-bodies.js";

const enc = (s: string) => new TextEncoder().encode(s);
const sha = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

const tempDirs: string[] = [];
function tempDir(): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), "godd-matrix-art-"));
  tempDirs.push(dir);
  return dir;
}
afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const body = enc("# 本文\n");
const cell = (id: string, jsic: string) => ({
  id,
  path: `design-md/${jsic}/ac-bk/cool/DESIGN.md`,
  jsic,
  color: "ac-bk",
  mood: "cool",
  title: id,
  hash: `sha256:${sha(body)}`,
  createdAt: "2026-07-11T00:00:00Z",
});
const indexBytes = enc(
  JSON.stringify({
    version: 1,
    entries: [cell("0100_ac-bk_cool", "0100"), cell("1000_ac-bk_cool", "1000")],
  }),
);
const pin = makePin({ index: indexBytes, entryCount: 2 });
const complete: BodyVerification = {
  indexEntries: 2,
  verified: 2,
  mismatched: [],
  missing: [],
  duplicated: [],
  unlisted: 0,
};

/** 整合した成果物ディレクトリを作る。files で内容を差し替え / 追加できる。SHA256SUMS は最後に生成する。 */
function makeArtifact(files: Record<string, Uint8Array | null> = {}, sums = true): string {
  const dir = tempDir();
  const base: Record<string, Uint8Array> = {
    "main.js": enc("console.log('mcp');\n"),
    "snapshot.json": enc(JSON.stringify(pin)),
    "index.json": indexBytes,
    "taxonomy.json": taxonomyBytes,
    "jsic.json": jsicBytes,
    LICENSE: enc("MIT License\n"),
    "THIRD-PARTY-LICENSES.txt": enc("zod\nMIT\n"),
    [CATALOG_VERIFICATION_FILE]: enc(JSON.stringify(catalogVerificationReceipt(pin, complete))),
  };
  for (const [name, bytes] of Object.entries(files)) {
    if (bytes === null) delete base[name];
    else base[name] = bytes;
  }
  for (const [name, bytes] of Object.entries(base)) writeFileSync(path.join(dir, name), bytes);
  if (sums) {
    writeFileSync(
      path.join(dir, SHA256SUMS_FILE),
      formatSha256Sums(Object.entries(base).map(([name, bytes]) => ({ name, bytes }))),
    );
  }
  return dir;
}

describe("formatSha256Sums / parseSha256Sums", () => {
  it("sha256sum 互換の形式で、名前順に出力する", () => {
    const text = formatSha256Sums([
      { name: "b.txt", bytes: enc("b") },
      { name: "a.txt", bytes: enc("a") },
    ]);
    expect(text).toBe(`${sha(enc("a"))}  a.txt\n${sha(enc("b"))}  b.txt\n`);
    expect([...parseSha256Sums(text).keys()]).toEqual(["a.txt", "b.txt"]);
  });

  it("パス区切りや親ディレクトリを含む名前は出力できない", () => {
    expect(() => formatSha256Sums([{ name: "../x", bytes: enc("x") }])).toThrow();
    expect(() => formatSha256Sums([{ name: "d/x", bytes: enc("x") }])).toThrow();
  });

  const hex = "a".repeat(64);
  const invalid: Array<[string, string]> = [
    ["ハッシュが短い", "abc  a.txt\n"],
    ["区切りが 1 つ", `${hex} a.txt\n`],
    ["バイナリ印 (*)", `${hex} *a.txt\n`],
    ["パス区切りを含む", `${hex}  d/a.txt\n`],
    ["同じ名前が重複", `${hex}  a.txt\n${hex}  a.txt\n`],
    ["空行", `${hex}  a.txt\n\n`],
    ["大文字の hex", `${"A".repeat(64)}  a.txt\n`],
  ];
  it.each(invalid)("パースで拒否する: %s", (_name, text) => {
    expect(() => parseSha256Sums(text)).toThrow();
  });
});

describe("catalogVerificationReceipt", () => {
  it("全件検証済みの結果から、件数だけの受領記録を作る (時刻・環境情報は含めない)", () => {
    expect(catalogVerificationReceipt(pin, complete)).toEqual({
      schema: "godd-matrix-catalog-verification-v1",
      repository: pin.repository,
      commit: pin.commit,
      indexEntries: 2,
      bodiesVerified: 2,
      bodiesMissing: 0,
      bodiesMismatched: 0,
      bodiesDuplicated: 0,
      unlistedDesignMd: 0,
    });
  });

  it("不完全な検証結果からは作れない", () => {
    expect(() =>
      catalogVerificationReceipt(pin, { ...complete, missing: ["0100_ac-bk_cool"] }),
    ).toThrow();
    // 内部は整合していても、pin が束縛する件数 (2) と違えば作れない。
    expect(() =>
      catalogVerificationReceipt(pin, { ...complete, indexEntries: 3, verified: 3 }),
    ).toThrow(/entryCount/);
  });
});

describe("verifyArtifactDir", () => {
  it("整合した成果物を受理し、pin が束縛する件数を返す", async () => {
    const result = await verifyArtifactDir(makeArtifact());
    expect(result).toMatchObject({
      entries: 2,
      colors: SAMPLE_COLOR_COUNT,
      moods: SAMPLE_MOOD_COUNT,
      subclasses: SAMPLE_SUBCLASS_COUNT,
    });
    expect(result.files).toContain("main.js");
  });

  it("SHA256SUMS に載ったファイルが 1 バイトでも変わっていれば拒否する", async () => {
    const dir = makeArtifact();
    const file = path.join(dir, "main.js");
    const changed = readFileSync(file);
    changed[0] = (changed[0] ?? 0) ^ 0x01;
    writeFileSync(file, changed);
    await expect(verifyArtifactDir(dir)).rejects.toThrow(/main\.js.*sha256/);
  });

  it("SHA256SUMS に載っていないファイルが混ざっていれば拒否する", async () => {
    const dir = makeArtifact();
    writeFileSync(path.join(dir, "extra.js"), enc("evil"));
    await expect(verifyArtifactDir(dir)).rejects.toThrow(/extra\.js/);
  });

  it("SHA256SUMS に載ったファイルが無ければ拒否する", async () => {
    const dir = makeArtifact();
    rmSync(path.join(dir, "LICENSE"));
    await expect(verifyArtifactDir(dir)).rejects.toThrow(/LICENSE/);
  });

  it("SHA256SUMS が無ければ拒否する", async () => {
    await expect(verifyArtifactDir(makeArtifact({}, false))).rejects.toThrow(/SHA256SUMS/);
  });

  it("サブディレクトリがあれば拒否する", async () => {
    const dir = makeArtifact();
    mkdirSync(path.join(dir, "sub"));
    await expect(verifyArtifactDir(dir)).rejects.toThrow(/sub/);
  });

  it("main.js が空なら拒否する", async () => {
    await expect(verifyArtifactDir(makeArtifact({ "main.js": enc("") }))).rejects.toThrow(
      /main\.js/,
    );
  });

  it("必須ファイル (ライセンス / 検証記録) が欠けた成果物は、SHA256SUMS が整合していても拒否する", async () => {
    await expect(verifyArtifactDir(makeArtifact({ LICENSE: null }))).rejects.toThrow(/LICENSE/);
    await expect(
      verifyArtifactDir(makeArtifact({ "THIRD-PARTY-LICENSES.txt": null })),
    ).rejects.toThrow(/THIRD-PARTY/);
    await expect(
      verifyArtifactDir(makeArtifact({ [CATALOG_VERIFICATION_FILE]: null })),
    ).rejects.toThrow(/catalog-verification/);
  });

  it("index を差し替えて SHA256SUMS を作り直しても、pin (snapshot.json) と合わなければ拒否する", async () => {
    const swapped = enc(
      JSON.stringify({
        version: 1,
        entries: [cell("0100_ac-bk_cool", "0100"), cell("2000_ac-bk_cool", "2000")],
      }),
    );
    await expect(verifyArtifactDir(makeArtifact({ "index.json": swapped }))).rejects.toThrow(
      /index.*(sha256|bytes)/,
    );
  });

  it("taxonomy / jsic を差し替えても同様に拒否する", async () => {
    const swapped = enc(JSON.stringify({ version: 1, colors: { x: {} }, moods: { y: {} } }));
    await expect(verifyArtifactDir(makeArtifact({ "taxonomy.json": swapped }))).rejects.toThrow(
      /taxonomy/,
    );
    const jsic = enc(JSON.stringify({ subclass: [{ code: "0001", name: "a" }] }));
    await expect(verifyArtifactDir(makeArtifact({ "jsic.json": jsic }))).rejects.toThrow(/jsic/);
  });

  it("旧形式の pin (taxonomy / jsic が無い) は拒否する", async () => {
    const { taxonomy: _t, jsic: _j, ...legacy } = pin;
    await expect(
      verifyArtifactDir(makeArtifact({ "snapshot.json": enc(JSON.stringify(legacy)) })),
    ).rejects.toThrow(/snapshot/);
  });

  it("本文の検証記録が不完全 / 別の commit なら拒否する", async () => {
    const incomplete = { ...catalogVerificationReceipt(pin, complete), bodiesMissing: 1 };
    await expect(
      verifyArtifactDir(
        makeArtifact({ [CATALOG_VERIFICATION_FILE]: enc(JSON.stringify(incomplete)) }),
      ),
    ).rejects.toThrow(/本文|検証/);
    const other = { ...catalogVerificationReceipt(pin, complete), commit: "0".repeat(40) };
    await expect(
      verifyArtifactDir(makeArtifact({ [CATALOG_VERIFICATION_FILE]: enc(JSON.stringify(other)) })),
    ).rejects.toThrow(/commit/);
    const fewer = { ...catalogVerificationReceipt(pin, complete), bodiesVerified: 1 };
    await expect(
      verifyArtifactDir(makeArtifact({ [CATALOG_VERIFICATION_FILE]: enc(JSON.stringify(fewer)) })),
    ).rejects.toThrow(/件数|本文|検証/);
  });
});
