import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  FIXTURE_RAW_BASE,
  SAMPLE_COLOR_COUNT,
  SAMPLE_JSIC,
  SAMPLE_MOOD_COUNT,
  SAMPLE_SUBCLASS_COUNT,
  SAMPLE_TAXONOMY,
  jsicBytes,
  jsonBytes,
  makePin,
  taxonomyBytes,
} from "./__fixtures__/snapshot-pin.js";
import { loadPinnedCatalogs, parseDsJsic, parseDsTaxonomy, toAxisResolvers } from "./catalogs.js";
import { DesignIndexError } from "./validate.js";

const indexBytes = new TextEncoder().encode('{"version":1,"entries":[]}');

const tempDirs: string[] = [];
function tempDir(): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), "godd-matrix-cat-"));
  tempDirs.push(dir);
  return dir;
}
afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** URL ごとに決まったバイトを返す fetch (呼ばれた URL も記録する)。 */
function serving(files: Record<string, Uint8Array>) {
  const urls: string[] = [];
  const fetchImpl = vi.fn(async (url: string) => {
    urls.push(String(url));
    const body = files[String(url)];
    return body ? new Response(body, { status: 200 }) : new Response("not found", { status: 404 });
  }) as unknown as typeof fetch;
  return { fetchImpl, urls };
}

describe("parseDsTaxonomy", () => {
  it("本物と同じ形の taxonomy を、色 / ムードの名称付きで読み取る", () => {
    const t = parseDsTaxonomy(JSON.stringify(SAMPLE_TAXONOMY));
    expect(t.colors).toHaveLength(SAMPLE_COLOR_COUNT);
    expect(t.moods).toHaveLength(SAMPLE_MOOD_COUNT);
    expect(t.colors.find((c) => c.slug === "lt-h17")).toEqual({
      slug: "lt-h17",
      nameJa: "ライトトーンの青",
      nameEn: "light blue",
      family: "blue",
      familyJa: "青系",
      familyEn: "blue",
    });
    expect(t.moods.find((m) => m.slug === "trustworthy")).toEqual({
      slug: "trustworthy",
      nameJa: "信頼",
      nameEn: "trustworthy",
      axis: "情緒",
    });
  });

  type Entries = Record<string, Record<string, unknown>>;
  type TaxonomyDoc = { version: number; colors: Entries; moods: Entries };
  const base = (): TaxonomyDoc => JSON.parse(JSON.stringify(SAMPLE_TAXONOMY));
  const lightBlue = (t: TaxonomyDoc) => t.colors["lt-h17"] ?? {};
  const minimal = (t: TaxonomyDoc) => t.moods.minimal ?? {};
  const invalid: Array<[string, (t: TaxonomyDoc) => unknown]> = [
    ["オブジェクトでない", () => []],
    ["version が 1 でない", (t) => ({ ...t, version: 2 })],
    ["colors が無い", ({ colors: _c, ...rest }) => rest],
    ["colors が空", (t) => ({ ...t, colors: {} })],
    ["moods が配列", (t) => ({ ...t, moods: [] })],
    ["moods が空", (t) => ({ ...t, moods: {} })],
    ["色の slug が大文字", (t) => ({ ...t, colors: { ...t.colors, "Lt-H17": lightBlue(t) } })],
    ["色の項目がオブジェクトでない", (t) => ({ ...t, colors: { ...t.colors, "x-1": "青" } })],
    [
      "色の name_ja が空",
      (t) => ({ ...t, colors: { ...t.colors, "x-1": { ...lightBlue(t), name_ja: "" } } }),
    ],
    [
      "色の name_en が無い",
      (t) => {
        const { name_en: _n, ...rest } = lightBlue(t);
        return { ...t, colors: { ...t.colors, "x-1": rest } };
      },
    ],
    [
      "色の family が文字列でない",
      (t) => ({ ...t, colors: { ...t.colors, "x-1": { ...lightBlue(t), family: 3 } } }),
    ],
    [
      "ムードの axis が無い",
      (t) => {
        const { axis: _a, ...rest } = minimal(t);
        return { ...t, moods: { ...t.moods, "x-1": rest } };
      },
    ],
    [
      "ムードの name_ja が空白だけ",
      (t) => ({ ...t, moods: { ...t.moods, "x-1": { ...minimal(t), name_ja: "  " } } }),
    ],
  ];
  it.each(invalid)("拒否する: %s", (_name, mutate) => {
    expect(() => parseDsTaxonomy(JSON.stringify(mutate(base())))).toThrow(DesignIndexError);
  });

  it("JSON として不正な入力を拒否する", () => {
    expect(() => parseDsTaxonomy("{")).toThrow(DesignIndexError);
  });
});

describe("parseDsJsic", () => {
  it("subclass の code / name を読み取る (他のキーは無視)", () => {
    const list = parseDsJsic(JSON.stringify(SAMPLE_JSIC));
    expect(list).toHaveLength(SAMPLE_SUBCLASS_COUNT);
    expect(list[4]).toEqual({ code: "7281", name: "経営コンサルタント業" });
  });

  const invalid: Array<[string, unknown]> = [
    ["オブジェクトでない", []],
    ["subclass が無い", { meta: {} }],
    ["subclass が空", { subclass: [] }],
    ["code が 4 桁でない", { subclass: [{ code: "72811", name: "x" }] }],
    ["code が数字でない", { subclass: [{ code: "72A1", name: "x" }] }],
    ["name が空", { subclass: [{ code: "7281", name: "" }] }],
    ["name が文字列でない", { subclass: [{ code: "7281", name: 1 }] }],
    [
      "code が重複",
      {
        subclass: [
          { code: "7281", name: "a" },
          { code: "7281", name: "b" },
        ],
      },
    ],
    ["項目がオブジェクトでない", { subclass: ["7281"] }],
  ];
  it.each(invalid)("拒否する: %s", (_name, raw) => {
    expect(() => parseDsJsic(JSON.stringify(raw))).toThrow(DesignIndexError);
  });

  it("JSON として不正な入力を拒否する", () => {
    expect(() => parseDsJsic("not json")).toThrow(DesignIndexError);
  });
});

describe("loadPinnedCatalogs (解釈前のバイト束縛)", () => {
  const pin = makePin({ index: indexBytes, entryCount: 0 });
  const urlTaxonomy = `${FIXTURE_RAW_BASE}taxonomy.json`;
  const urlJsic = `${FIXTURE_RAW_BASE}jsic.json`;

  it("既定では pin の commit に固定した raw URL から取得し、pin と件数に照合して返す", async () => {
    const { fetchImpl, urls } = serving({ [urlTaxonomy]: taxonomyBytes, [urlJsic]: jsicBytes });
    const catalogs = await loadPinnedCatalogs(pin, { fetchImpl });
    expect([...urls].sort()).toEqual([urlJsic, urlTaxonomy].sort());
    expect(catalogs.taxonomy.colors).toHaveLength(SAMPLE_COLOR_COUNT);
    expect(catalogs.taxonomy.moods).toHaveLength(SAMPLE_MOOD_COUNT);
    expect(catalogs.jsic).toHaveLength(SAMPLE_SUBCLASS_COUNT);
  });

  it("同梱ファイル (ローカルパス) も同じ pin で検証して使える", async () => {
    const dir = tempDir();
    const taxonomyFile = path.join(dir, "taxonomy.json");
    const jsicFile = path.join(dir, "jsic.json");
    writeFileSync(taxonomyFile, taxonomyBytes);
    writeFileSync(jsicFile, jsicBytes);
    const catalogs = await loadPinnedCatalogs(pin, {
      taxonomySource: taxonomyFile,
      jsicSource: jsicFile,
      fetchImpl: vi.fn(async () => {
        throw new Error("ネットワークは使わない");
      }) as unknown as typeof fetch,
    });
    expect(catalogs.taxonomy.colors).toHaveLength(SAMPLE_COLOR_COUNT);
  });

  it("同じ長さで 1 文字だけ違う taxonomy は、解釈する前に拒否する", async () => {
    const changed = taxonomyBytes.slice();
    const at = Buffer.from(changed).indexOf("black");
    changed[at] = 0x42; // "black" -> "Black" (長さも JSON 構造も変わらない)
    const { fetchImpl } = serving({ [urlTaxonomy]: changed, [urlJsic]: jsicBytes });
    await expect(loadPinnedCatalogs(pin, { fetchImpl })).rejects.toThrow(/taxonomy.*sha256/);
  });

  it("改竄した jsic も拒否する", async () => {
    const changed = jsicBytes.slice();
    changed[changed.length - 5] = (changed[changed.length - 5] ?? 0) ^ 0x01;
    const { fetchImpl } = serving({ [urlTaxonomy]: taxonomyBytes, [urlJsic]: changed });
    await expect(loadPinnedCatalogs(pin, { fetchImpl })).rejects.toThrow(/jsic.*sha256/);
  });

  it("途中で切れた (短い) ファイルを拒否する", async () => {
    const { fetchImpl } = serving({
      [urlTaxonomy]: taxonomyBytes.slice(0, taxonomyBytes.length - 4),
      [urlJsic]: jsicBytes,
    });
    await expect(loadPinnedCatalogs(pin, { fetchImpl })).rejects.toThrow(DesignIndexError);
  });

  it("pin の件数と実際の件数が違えば拒否する (完全集合でない)", async () => {
    const wrongCount = {
      ...pin,
      taxonomy: { ...pin.taxonomy, colorCount: SAMPLE_COLOR_COUNT + 1 },
    };
    const { fetchImpl } = serving({ [urlTaxonomy]: taxonomyBytes, [urlJsic]: jsicBytes });
    await expect(loadPinnedCatalogs(wrongCount, { fetchImpl })).rejects.toThrow(/colorCount/);
    const wrongJsic = { ...pin, jsic: { ...pin.jsic, subclassCount: 1 } };
    await expect(loadPinnedCatalogs(wrongJsic, { fetchImpl })).rejects.toThrow(/subclassCount/);
  });

  it("バイトが pin と一致しても中身が taxonomy として不正なら拒否する", async () => {
    const bad = jsonBytes({ version: 1, colors: {}, moods: {} });
    const badPin = makePin({ index: indexBytes, entryCount: 0, taxonomy: bad });
    const { fetchImpl } = serving({ [urlTaxonomy]: bad, [urlJsic]: jsicBytes });
    await expect(loadPinnedCatalogs(badPin, { fetchImpl })).rejects.toThrow(DesignIndexError);
  });

  it("取得に失敗したファイルがあれば拒否する", async () => {
    const { fetchImpl } = serving({ [urlTaxonomy]: taxonomyBytes });
    await expect(loadPinnedCatalogs(pin, { fetchImpl })).rejects.toThrow(/HTTP 404/);
  });
});

describe("toAxisResolvers (taxonomy / jsic の全件から軸を解く)", () => {
  const resolvers = toAxisResolvers({
    taxonomy: parseDsTaxonomy(JSON.stringify(SAMPLE_TAXONOMY)),
    jsic: parseDsJsic(JSON.stringify(SAMPLE_JSIC)),
  });

  it("taxonomy の全 slug を、実在する値として引ける", () => {
    for (const slug of Object.keys(SAMPLE_TAXONOMY.colors)) {
      expect(resolvers.color.get(slug)?.slug).toBe(slug);
      expect(resolvers.color.resolve(slug).best?.score).toBe(1);
    }
    for (const slug of Object.keys(SAMPLE_TAXONOMY.moods)) {
      expect(resolvers.mood.get(slug)?.slug).toBe(slug);
    }
    for (const row of SAMPLE_JSIC.subclass) {
      expect(resolvers.jsic.get(row.code)?.name).toBe(row.name);
    }
  });

  it("slug (または JSIC コード) の完全一致は常に 1 件に確定する", () => {
    expect(resolvers.color.resolve("lt-h17").best?.entry.slug).toBe("lt-h17");
    expect(resolvers.color.resolve("LT-H17").best?.entry.slug).toBe("lt-h17");
    expect(resolvers.jsic.resolve("0100").best?.entry.code).toBe("0100");
  });

  it("同じ名称を共有する色は、首位が複数あるので確定せず候補を返す", () => {
    const r = resolvers.color.resolve("ライトトーンの青");
    expect(r.best).toBeUndefined();
    expect(r.candidates.map((c) => c.entry.slug)).toEqual(["h17b-lt", "lt-h17", "lt-h18"]);
    const en = resolvers.color.resolve("light blue");
    expect(en.best).toBeUndefined();
    expect(en.candidates).toHaveLength(3);
  });

  it("名称が一意なら名称 (日英) と部分一致で確定する", () => {
    expect(resolvers.color.resolve("ビビッドトーンの赤").best?.entry.slug).toBe("v-h02");
    expect(resolvers.color.resolve("vivid red").best?.entry.slug).toBe("v-h02");
    expect(resolvers.color.resolve("赤").best?.entry.slug).toBe("v-h02");
  });

  it("部分一致が複数に及ぶ曖昧な入力は確定しない", () => {
    expect(resolvers.color.resolve("青").best).toBeUndefined();
    expect(resolvers.color.resolve("青").candidates.length).toBeGreaterThan(1);
  });

  it("ムードは名称 (日英) で解き、別のムードの語を取り違えない", () => {
    expect(resolvers.mood.resolve("信頼").best?.entry.slug).toBe("trustworthy");
    expect(resolvers.mood.resolve("高級").best?.entry.slug).toBe("luxurious");
    expect(resolvers.mood.resolve("優雅").best?.entry.slug).toBe("elegant");
    expect(resolvers.mood.resolve("trust").best?.entry.slug).toBe("trustworthy");
    expect(resolvers.mood.resolve("存在しない語").best).toBeUndefined();
  });

  it("業種は名称・既存の別名 overlay で解き、同名の細分類は確定しない", () => {
    expect(resolvers.jsic.resolve("経営コンサルタント業").best?.entry.code).toBe("7281");
    expect(resolvers.jsic.resolve("本屋").best?.entry.code).toBe("6061");
    const head = resolvers.jsic.resolve("主として管理事務を行う本社等");
    expect(head.best).toBeUndefined();
    expect(head.candidates.map((c) => c.entry.code)).toEqual(["0100", "1000"]);
  });

  it("overlay は、この snapshot に実在する細分類にだけ付く (捏造コードを作らない)", () => {
    expect(resolvers.jsic.get("7211")).toBeUndefined();
    expect(resolvers.jsic.resolve("弁護士").best).toBeUndefined();
  });
});
