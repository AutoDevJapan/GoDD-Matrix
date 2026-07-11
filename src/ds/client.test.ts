import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DS_INDEX_ENV, DesignIndexClient } from "./client.js";
import { DesignIndexError } from "./validate.js";

const fixturePath = fileURLToPath(new URL("./__fixtures__/index.valid.json", import.meta.url));
const fixtureText = readFileSync(fixturePath, "utf8");

function client(): DesignIndexClient {
  return DesignIndexClient.fromJson(fixtureText);
}

afterEach(() => {
  DesignIndexClient.clearCache();
  vi.unstubAllEnvs();
});

describe("DesignIndexClient query", () => {
  it("全エントリを保持する", () => {
    const c = client();
    expect(c.size).toBe(3);
    expect(c.entries).toHaveLength(3);
  });

  it("id でエントリを引く", () => {
    const c = client();
    expect(c.get("6061_white_minimal")?.title).toContain("ミニマル");
    expect(c.get("nope")).toBeUndefined();
  });

  it("業種 (jsic) で絞り込む", () => {
    const hits = client().query({ jsic: "7281" });
    expect(hits.map((e) => e.id)).toEqual(["7281_h17b-lt_trustworthy", "7281_h17b-lt_minimal"]);
  });

  it("カラー + ムードの AND で絞り込む", () => {
    const hits = client().query({ color: "h17b-lt", mood: "minimal" });
    expect(hits).toHaveLength(1);
    expect(hits[0]?.id).toBe("7281_h17b-lt_minimal");
  });

  it("タグは全一致 (AND) で絞り込む", () => {
    const c = client();
    expect(c.query({ tags: ["professional"] })).toHaveLength(2);
    expect(c.query({ tags: ["professional", "serif-display"] })).toHaveLength(1);
    expect(c.query({ tags: ["nonexistent"] })).toHaveLength(0);
  });

  it("空 query は全件返す", () => {
    expect(client().query()).toHaveLength(3);
  });

  it("byAxis で AxisContext から引く", () => {
    const hits = client().byAxis({ jsic: "7281", color: "h17b-lt", mood: "trustworthy" });
    expect(hits).toHaveLength(1);
    expect(hits[0]?.id).toBe("7281_h17b-lt_trustworthy");
  });
});

describe("DesignIndexClient.load", () => {
  it("ローカルパスから取込む", async () => {
    const c = await DesignIndexClient.load(fixturePath);
    expect(c.size).toBe(3);
  });

  it("環境変数 GODD_DS_INDEX から取込む", async () => {
    vi.stubEnv(DS_INDEX_ENV, fixturePath);
    const c = await DesignIndexClient.load();
    expect(c.size).toBe(3);
  });

  it("取込元未指定で投げる", async () => {
    vi.stubEnv(DS_INDEX_ENV, "");
    await expect(DesignIndexClient.load()).rejects.toThrow(DesignIndexError);
  });

  it("http(s) URL を fetchImpl で取込む", async () => {
    const fetchImpl = vi.fn(async () => new Response(fixtureText, { status: 200 }));
    const c = await DesignIndexClient.load("https://example.test/index.json", {
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(c.size).toBe(3);
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it("HTTP エラーで投げる", async () => {
    const fetchImpl = vi.fn(async () => new Response("nope", { status: 404 }));
    await expect(
      DesignIndexClient.load("https://example.test/missing.json", {
        cache: false,
        fetchImpl: fetchImpl as unknown as typeof fetch,
      }),
    ).rejects.toThrow(/HTTP 404/);
  });

  it("同一取込元をキャッシュし fetch を重複させない", async () => {
    const fetchImpl = vi.fn(async () => new Response(fixtureText, { status: 200 }));
    const url = "https://example.test/cached.json";
    const opts = { fetchImpl: fetchImpl as unknown as typeof fetch };
    const [a, b] = await Promise.all([
      DesignIndexClient.load(url, opts),
      DesignIndexClient.load(url, opts),
    ]);
    expect(a).toBe(b);
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it("cache:false はキャッシュしない", async () => {
    const fetchImpl = vi.fn(async () => new Response(fixtureText, { status: 200 }));
    const url = "https://example.test/nocache.json";
    const opts = { cache: false, fetchImpl: fetchImpl as unknown as typeof fetch };
    await DesignIndexClient.load(url, opts);
    await DesignIndexClient.load(url, opts);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
});
