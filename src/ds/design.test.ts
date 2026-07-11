import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { DesignIndexClient } from "./client.js";
import {
  DesignBodyClient,
  type DesignRenderer,
  DesignResolver,
  resolveDesignLocation,
  verifyDesignHash,
} from "./design.js";
import type { DesignIndexEntry } from "./types.js";
import { DesignIndexError } from "./validate.js";

const baseDir = fileURLToPath(new URL("./__fixtures__", import.meta.url));
const BODY_PATH = "design-md/7412/h17b-lt/trustworthy/DESIGN.md";
const markdown = readFileSync(path.join(baseDir, BODY_PATH), "utf8");
const realHash = `sha256:${createHash("sha256").update(markdown, "utf8").digest("hex")}`;
const ZERO_HASH = `sha256:${"0".repeat(64)}`;

function entryWith(hash: string): DesignIndexEntry {
  return {
    id: "7412_h17b-lt_trustworthy",
    path: BODY_PATH,
    jsic: "7412",
    color: "h17b-lt",
    mood: "trustworthy",
    title: "経営コンサルタント業 × ライトブルー × 信頼",
    hash,
    createdAt: "2026-07-11T00:00:00Z",
  };
}

describe("resolveDesignLocation", () => {
  it("http(s) base は末尾スラッシュを補い base 配下に解決する", () => {
    expect(resolveDesignLocation("https://example.test/repo", BODY_PATH)).toBe(
      `https://example.test/repo/${BODY_PATH}`,
    );
    expect(resolveDesignLocation("https://example.test/repo/", BODY_PATH)).toBe(
      `https://example.test/repo/${BODY_PATH}`,
    );
  });

  it("ローカルディレクトリ base は絶対パスに解決する", () => {
    const resolved = resolveDesignLocation(baseDir, BODY_PATH);
    expect(path.isAbsolute(resolved)).toBe(true);
    expect(readFileSync(resolved, "utf8")).toBe(markdown);
  });
});

describe("verifyDesignHash", () => {
  it("一致する hash で true", () => {
    expect(verifyDesignHash(markdown, realHash)).toBe(true);
  });
  it("不一致の hash で false", () => {
    expect(verifyDesignHash(markdown, ZERO_HASH)).toBe(false);
  });
});

describe("DesignBodyClient.fetch", () => {
  it("ローカルディレクトリから本文を取得し hash を検証する", async () => {
    const c = new DesignBodyClient(baseDir);
    const doc = await c.fetch(entryWith(realHash));
    expect(doc.markdown).toBe(markdown);
    expect(doc.hashVerified).toBe(true);
    expect(doc.entry.id).toBe("7412_h17b-lt_trustworthy");
  });

  it("hash 不一致は hashVerified:false で返す (既定は投げない)", async () => {
    const c = new DesignBodyClient(baseDir);
    const doc = await c.fetch(entryWith(ZERO_HASH));
    expect(doc.hashVerified).toBe(false);
  });

  it("requireHash で hash 不一致時に投げる", async () => {
    const c = new DesignBodyClient(baseDir, { requireHash: true });
    await expect(c.fetch(entryWith(ZERO_HASH))).rejects.toThrow(DesignIndexError);
  });

  it("http(s) base を fetchImpl で取得する", async () => {
    const fetchImpl = vi.fn(async () => new Response(markdown, { status: 200 }));
    const c = new DesignBodyClient("https://example.test/repo/", {
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    const doc = await c.fetch(entryWith(realHash));
    expect(doc.markdown).toBe(markdown);
    expect(doc.source).toBe(`https://example.test/repo/${BODY_PATH}`);
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it("同一エントリをキャッシュし取得を重複させない", async () => {
    const fetchImpl = vi.fn(async () => new Response(markdown, { status: 200 }));
    const c = new DesignBodyClient("https://example.test/repo/", {
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    const entry = entryWith(realHash);
    const [a, b] = await Promise.all([c.fetch(entry), c.fetch(entry)]);
    expect(a).toBe(b);
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it("cache:false はキャッシュしない", async () => {
    const fetchImpl = vi.fn(async () => new Response(markdown, { status: 200 }));
    const c = new DesignBodyClient("https://example.test/repo/", {
      cache: false,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    const entry = entryWith(realHash);
    await c.fetch(entry);
    await c.fetch(entry);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("存在しない本文は DesignIndexError で投げる", async () => {
    const c = new DesignBodyClient(baseDir);
    const missing = { ...entryWith(realHash), path: "design-md/9999/none/none/DESIGN.md" };
    await expect(c.fetch(missing)).rejects.toThrow(DesignIndexError);
  });

  it("HTTP エラーで投げる", async () => {
    const fetchImpl = vi.fn(async () => new Response("nope", { status: 404 }));
    const c = new DesignBodyClient("https://example.test/repo/", {
      cache: false,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    await expect(c.fetch(entryWith(realHash))).rejects.toThrow(/HTTP 404/);
  });

  it("clearCache 後は再取得する", async () => {
    const fetchImpl = vi.fn(async () => new Response(markdown, { status: 200 }));
    const c = new DesignBodyClient("https://example.test/repo/", {
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    const entry = entryWith(realHash);
    await c.fetch(entry);
    c.clearCache(entry);
    await c.fetch(entry);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
});

describe("DesignResolver", () => {
  const ctx = { jsic: "7412", color: "h17b-lt", mood: "trustworthy" };

  function indexWith(hash: string): DesignIndexClient {
    return new DesignIndexClient({ version: 1, entries: [entryWith(hash)] });
  }

  it("材化済みセルは本文を fetch する", async () => {
    const resolver = new DesignResolver(indexWith(realHash), new DesignBodyClient(baseDir));
    const res = await resolver.resolve(ctx);
    expect(res.status).toBe("materialized");
    if (res.status === "materialized") {
      expect(res.document.markdown).toBe(markdown);
      expect(res.document.hashVerified).toBe(true);
    }
  });

  it("未材化かつ renderer 未設定は unavailable (未取得)", async () => {
    const emptyIndex = new DesignIndexClient({ version: 1, entries: [] });
    const resolver = new DesignResolver(emptyIndex, new DesignBodyClient(baseDir));
    const res = await resolver.resolve(ctx);
    expect(res.status).toBe("unavailable");
    if (res.status === "unavailable") {
      expect(res.reason).toContain("未材化");
      expect(res.request).toEqual(ctx);
    }
  });

  it("未材化セルは renderer にフォールバックする", async () => {
    const emptyIndex = new DesignIndexClient({ version: 1, entries: [] });
    const renderer: DesignRenderer = {
      render: vi.fn(async () => ({ designMarkdown: "# rendered" })),
    };
    const resolver = new DesignResolver(emptyIndex, new DesignBodyClient(baseDir), renderer);
    const res = await resolver.resolve(ctx);
    expect(res.status).toBe("rendered");
    if (res.status === "rendered") {
      expect(res.result.designMarkdown).toBe("# rendered");
    }
    expect(renderer.render).toHaveBeenCalledWith(ctx);
  });
});
