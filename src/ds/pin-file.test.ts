import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { JSIC_SUBCLASSES } from "../axes/jsic-catalog.js";
import { parseDsSnapshotPin } from "./snapshot.js";

const root = fileURLToPath(new URL("../../", import.meta.url));
const pinText = readFileSync(`${root}ds-snapshot.pin.json`, "utf8");
const realIndexScript = readFileSync(`${root}scripts/prepare-real-index.mjs`, "utf8");

/** prepare-real-index.mjs の固定値 (実カタログ検査が使う index の同一性) を取り出す。 */
function scriptConstant(pattern: RegExp): string {
  const match = pattern.exec(realIndexScript);
  if (!match?.[1]) throw new Error(`prepare-real-index.mjs から値を取り出せません: ${pattern}`);
  return match[1];
}

describe("ds-snapshot.pin.json (正式配布の固定 snapshot)", () => {
  const pin = parseDsSnapshotPin(pinText);

  it("実カタログ検査 (prepare-real-index.mjs) と同じ commit / index の同一性を指す", () => {
    expect(pin.commit).toBe(scriptConstant(/const commit = "([0-9a-f]{40})"/));
    expect(pin.index.sha256).toBe(scriptConstant(/sha256: "([0-9a-f]{64})"/));
    expect(pin.index.gitBlob).toBe(scriptConstant(/gitBlob: "([0-9a-f]{40})"/));
    expect(String(pin.index.bytes)).toBe(scriptConstant(/bytes: ([0-9_]+)/).replaceAll("_", ""));
  });

  it("取得先は ブランチ名ではなく commit に固定した raw URL を導く", () => {
    expect(pin.commit).toMatch(/^[0-9a-f]{40}$/);
    expect(pin.index.path).toBe("index.json");
    expect(pin.index.entryCount).toBeGreaterThan(0);
  });

  it("軸の語彙 (taxonomy / jsic) も同じ commit の固定ファイルとして束縛している", () => {
    expect(pin.taxonomy.path).toBe("taxonomy.json");
    expect(pin.taxonomy.colorCount).toBeGreaterThan(0);
    expect(pin.taxonomy.moodCount).toBeGreaterThan(0);
    expect(pin.jsic.path).toBe("jsic.json");
    expect(pin.jsic.subclassCount).toBeGreaterThan(0);
    const identities = [pin.index, pin.taxonomy, pin.jsic].map((f) => f.sha256);
    expect(new Set(identities).size).toBe(3);
  });

  it("同梱の JSIC カタログ (旧構成の母集合) は、pin の jsic.json と同じ件数", () => {
    expect(JSIC_SUBCLASSES.length).toBe(pin.jsic.subclassCount);
  });
});
