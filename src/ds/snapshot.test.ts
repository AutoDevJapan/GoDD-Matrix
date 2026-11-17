import { describe, expect, it } from "vitest";
import {
  FIXTURE_RAW_BASE,
  SAMPLE_COLOR_COUNT,
  SAMPLE_MOOD_COUNT,
  SAMPLE_SUBCLASS_COUNT,
  jsicBytes,
  makePin,
  taxonomyBytes,
} from "./__fixtures__/snapshot-pin.js";
import {
  MAX_CATALOG_BYTES,
  MAX_INDEX_BYTES,
  SNAPSHOT_SCHEMA,
  parseDsSnapshotPin,
  snapshotFileUrl,
  snapshotIndexUrl,
  snapshotProvenance,
  snapshotRawBase,
  verifyIndexBytes,
  verifyIndexEntryCount,
  verifyPinnedFileBytes,
} from "./snapshot.js";
import { DesignIndexError } from "./validate.js";

const bytes = new TextEncoder().encode('{"version":1,"entries":[]}');

function validPin() {
  return makePin({ index: bytes, entryCount: 0 });
}

type FileKey = "index" | "taxonomy" | "jsic";

/** pin を浅く複製し、指定したファイル記述の一部を差し替える。 */
function withFile(key: FileKey, patch: Record<string, unknown>): Record<string, unknown> {
  const pin = validPin();
  return { ...pin, [key]: { ...pin[key], ...patch } };
}

/** pin から 1 つのキーを取り除く。 */
function without(key: string): Record<string, unknown> {
  const { [key]: _removed, ...rest } = validPin() as unknown as Record<string, unknown>;
  return rest;
}

describe("parseDsSnapshotPin", () => {
  it("正しい pin (index / taxonomy / jsic) を受理する", () => {
    const pin = parseDsSnapshotPin(JSON.stringify(validPin()));
    expect(pin).toEqual(validPin());
    expect(pin.taxonomy.colorCount).toBe(SAMPLE_COLOR_COUNT);
    expect(pin.taxonomy.moodCount).toBe(SAMPLE_MOOD_COUNT);
    expect(pin.jsic.subclassCount).toBe(SAMPLE_SUBCLASS_COUNT);
  });

  const invalid: Array<[string, Record<string, unknown>]> = [
    ["schema 違い", { ...validPin(), schema: "other" }],
    ["未知のキー (最上位)", { ...validPin(), extra: 1 }],
    ["未知のキー (index)", withFile("index", { extra: 1 })],
    ["未知のキー (taxonomy)", withFile("taxonomy", { extra: 1 })],
    ["未知のキー (jsic)", withFile("jsic", { extra: 1 })],
    ["taxonomy が無い", without("taxonomy")],
    ["jsic が無い", without("jsic")],
    ["repository 形式不正", { ...validPin(), repository: "../x" }],
    ["commit が短縮形", { ...validPin(), commit: "7d3ed9a" }],
    ["commit が大文字", { ...validPin(), commit: "7D3ED9A3D171FEE1B3F63F62AC73B71E102E8892" }],
    ["path にディレクトリ区切り (index)", withFile("index", { path: "a/index.json" })],
    ["path にディレクトリ区切り (taxonomy)", withFile("taxonomy", { path: "a/taxonomy.json" })],
    ["path が親ディレクトリ (jsic)", withFile("jsic", { path: ".." })],
    ["taxonomy の path が index と同じ", withFile("taxonomy", { path: "index.json" })],
    ["jsic の path が taxonomy と同じ", withFile("jsic", { path: "taxonomy.json" })],
    ["bytes が 0", withFile("index", { bytes: 0 })],
    ["bytes が小数", withFile("index", { bytes: 10.5 })],
    ["index の bytes が上限超過", withFile("index", { bytes: MAX_INDEX_BYTES + 1 })],
    ["taxonomy の bytes が上限超過", withFile("taxonomy", { bytes: MAX_CATALOG_BYTES + 1 })],
    ["jsic の bytes が上限超過", withFile("jsic", { bytes: MAX_CATALOG_BYTES + 1 })],
    ["sha256 が不正 (index)", withFile("index", { sha256: "abc" })],
    ["sha256 が大文字 (taxonomy)", withFile("taxonomy", { sha256: "A".repeat(64) })],
    ["gitBlob が不正 (jsic)", withFile("jsic", { gitBlob: "z".repeat(40) })],
    ["entryCount が負", withFile("index", { entryCount: -1 })],
    ["entryCount が小数", withFile("index", { entryCount: 1.5 })],
    ["colorCount が 0", withFile("taxonomy", { colorCount: 0 })],
    ["moodCount が小数", withFile("taxonomy", { moodCount: 1.5 })],
    ["subclassCount が 0", withFile("jsic", { subclassCount: 0 })],
    ["subclassCount が負", withFile("jsic", { subclassCount: -3 })],
  ];
  it.each(invalid)("拒否する: %s", (_name, raw) => {
    expect(() => parseDsSnapshotPin(JSON.stringify(raw))).toThrow(DesignIndexError);
  });

  it("JSON として不正な入力を拒否する", () => {
    expect(() => parseDsSnapshotPin("{")).toThrow(DesignIndexError);
  });
});

describe("verifyIndexBytes", () => {
  it("pin と同一のバイト列を受理する", () => {
    expect(() => verifyIndexBytes(bytes, validPin())).not.toThrow();
  });

  it("長さの違いを拒否する", () => {
    expect(() => verifyIndexBytes(bytes.slice(1), validPin())).toThrow(/bytes/);
  });

  it("同じ長さでも内容が違えば sha256 で拒否する", () => {
    const changed = bytes.slice();
    changed[0] = 0x5b;
    expect(changed.length).toBe(bytes.length);
    expect(() => verifyIndexBytes(changed, validPin())).toThrow(/sha256/);
  });

  it("sha256 が一致しても git blob が違えば拒否する", () => {
    const pin = parseDsSnapshotPin(JSON.stringify(withFile("index", { gitBlob: "0".repeat(40) })));
    expect(() => verifyIndexBytes(bytes, pin)).toThrow(/git blob/);
  });
});

describe("verifyPinnedFileBytes (taxonomy / jsic)", () => {
  it("pin と同一のバイト列を受理する", () => {
    const pin = validPin();
    expect(() => verifyPinnedFileBytes(taxonomyBytes, pin.taxonomy, "taxonomy")).not.toThrow();
    expect(() => verifyPinnedFileBytes(jsicBytes, pin.jsic, "jsic")).not.toThrow();
  });

  it("拒否理由にどのファイルかを示す", () => {
    const pin = validPin();
    expect(() => verifyPinnedFileBytes(taxonomyBytes.slice(1), pin.taxonomy, "taxonomy")).toThrow(
      /taxonomy.*bytes/,
    );
    expect(() => verifyPinnedFileBytes(taxonomyBytes, pin.jsic, "jsic")).toThrow(/jsic/);
  });

  it("同じ長さで 1 文字だけ違うバイトは sha256 で拒否する", () => {
    const pin = validPin();
    const changed = taxonomyBytes.slice();
    changed[changed.length - 3] = (changed[changed.length - 3] ?? 0) ^ 0x01;
    expect(changed.length).toBe(taxonomyBytes.length);
    expect(() => verifyPinnedFileBytes(changed, pin.taxonomy, "taxonomy")).toThrow(/sha256/);
  });

  it("sha256 が一致しても git blob が違えば拒否する", () => {
    const pin = parseDsSnapshotPin(
      JSON.stringify(withFile("taxonomy", { gitBlob: "0".repeat(40) })),
    );
    expect(() => verifyPinnedFileBytes(taxonomyBytes, pin.taxonomy, "taxonomy")).toThrow(
      /git blob/,
    );
  });
});

describe("verifyIndexEntryCount", () => {
  it("件数が pin と一致すれば受理し、違えば拒否する", () => {
    const pin = validPin();
    expect(() => verifyIndexEntryCount(0, pin)).not.toThrow();
    expect(() => verifyIndexEntryCount(1, pin)).toThrow(/entryCount/);
  });
});

describe("取得先と出所", () => {
  it("commit に固定した raw URL を導出する (ブランチ名は使わない)", () => {
    const pin = validPin();
    expect(snapshotRawBase(pin)).toBe(FIXTURE_RAW_BASE);
    expect(snapshotIndexUrl(pin)).toBe(`${FIXTURE_RAW_BASE}index.json`);
    expect(snapshotFileUrl(pin, pin.taxonomy)).toBe(`${FIXTURE_RAW_BASE}taxonomy.json`);
    expect(snapshotFileUrl(pin, pin.jsic)).toBe(`${FIXTURE_RAW_BASE}jsic.json`);
  });

  it("出所 (provenance) は pin の同一性だけを返す (index / taxonomy / jsic)", () => {
    const pin = validPin();
    expect(snapshotProvenance(pin)).toEqual({
      repository: pin.repository,
      commit: pin.commit,
      indexSha256: pin.index.sha256,
      indexBytes: pin.index.bytes,
      entryCount: 0,
      taxonomySha256: pin.taxonomy.sha256,
      jsicSha256: pin.jsic.sha256,
    });
  });

  it("スキーマ識別子は v1 のまま", () => {
    expect(SNAPSHOT_SCHEMA).toBe("godd-matrix-ds-snapshot-v1");
  });
});
