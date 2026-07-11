import { describe, expect, it, vi } from "vitest";
import {
  GENERATOR_RENDER_API_KEY_ENV,
  GENERATOR_RENDER_URL_ENV,
  GeneratorRenderClient,
  GeneratorRenderError,
} from "./client.js";
import type { RenderRequest } from "./index.js";

const ctx: RenderRequest = { jsic: "7281", color: "h17b-lt", mood: "trustworthy" };

/** JSON レスポンスを組み立てる。 */
function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function client(fetchImpl: typeof fetch, overrides = {}): GeneratorRenderClient {
  return new GeneratorRenderClient({
    baseUrl: "https://generator.test/api/",
    apiKey: "secret-key",
    fetchImpl,
    retries: 0,
    retryDelayMs: 0,
    ...overrides,
  });
}

describe("GeneratorRenderClient.render (正常系)", () => {
  it("POST /render に x-api-key と flat body を送り markdown を designMarkdown へ写像する", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({
        markdown: "# rendered",
        document: { a: 1 },
        selection: { cell: "x" },
        validation: { ok: true },
      }),
    );
    const res = await client(fetchImpl as unknown as typeof fetch).render({
      ...ctx,
      tags: ["serif"],
    });

    expect(res.designMarkdown).toBe("# rendered");
    expect(res.document).toEqual({ a: 1 });
    expect(res.selection).toEqual({ cell: "x" });
    expect(res.validation).toEqual({ ok: true });

    expect(fetchImpl).toHaveBeenCalledOnce();
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    // 末尾スラッシュは正規化される。
    expect(url).toBe("https://generator.test/api/render");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>)["x-api-key"]).toBe("secret-key");
    expect(JSON.parse(init.body as string)).toEqual({
      jsic: "7281",
      color: "h17b-lt",
      mood: "trustworthy",
      tags: ["serif"],
    });
  });

  it("tags が空なら body に含めない", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ markdown: "x" }));
    await client(fetchImpl as unknown as typeof fetch).render(ctx);
    const [, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    const body = JSON.parse(init.body as string);
    expect(body).toEqual({ jsic: "7281", color: "h17b-lt", mood: "trustworthy" });
    expect(body).not.toHaveProperty("tags");
  });
});

describe("GeneratorRenderClient.render (エラー系)", () => {
  it("401 は auth エラーでリトライしない", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ error: "no" }, 401));
    const c = client(fetchImpl as unknown as typeof fetch, { retries: 2 });
    const err = await c.render(ctx).catch((e) => e);
    expect(err).toBeInstanceOf(GeneratorRenderError);
    expect((err as GeneratorRenderError).kind).toBe("auth");
    expect((err as GeneratorRenderError).status).toBe(401);
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it("400 は request エラーでリトライしない", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ error: "bad" }, 400));
    const c = client(fetchImpl as unknown as typeof fetch, { retries: 2 });
    const err = await c.render(ctx).catch((e) => e);
    expect((err as GeneratorRenderError).kind).toBe("request");
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it("5xx はリトライ上限まで再試行し server エラーで投げる", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ error: "boom" }, 503));
    const c = client(fetchImpl as unknown as typeof fetch, { retries: 2, retryDelayMs: 0 });
    const err = await c.render(ctx).catch((e) => e);
    expect((err as GeneratorRenderError).kind).toBe("server");
    expect((err as GeneratorRenderError).status).toBe(503);
    // 初回 + リトライ 2 回 = 3。
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it("5xx の後に成功すればリトライで回復する", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ error: "boom" }, 500))
      .mockResolvedValueOnce(jsonResponse({ markdown: "# ok" }));
    const c = client(fetchImpl as unknown as typeof fetch, { retries: 2, retryDelayMs: 0 });
    const res = await c.render(ctx);
    expect(res.designMarkdown).toBe("# ok");
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("markdown 欠落レスポンスは response エラー", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ document: {} }));
    const c = client(fetchImpl as unknown as typeof fetch);
    const err = await c.render(ctx).catch((e) => e);
    expect((err as GeneratorRenderError).kind).toBe("response");
  });

  it("タイムアウトは timeout エラー", async () => {
    // signal が abort されるまで解決しない fetch (タイマ発火で abort)。
    const fetchImpl = vi.fn(
      (_url: string, init: RequestInit) =>
        new Promise<Response>((_, reject) => {
          init.signal?.addEventListener("abort", () =>
            reject(new DOMException("aborted", "AbortError")),
          );
        }),
    );
    const c = client(fetchImpl as unknown as typeof fetch, { timeoutMs: 10, retries: 0 });
    const err = await c.render(ctx).catch((e) => e);
    expect((err as GeneratorRenderError).kind).toBe("timeout");
  });

  it("外部 signal で中断すると network エラー", async () => {
    const controller = new AbortController();
    const fetchImpl = vi.fn(
      (_url: string, init: RequestInit) =>
        new Promise<Response>((_, reject) => {
          init.signal?.addEventListener("abort", () =>
            reject(new DOMException("aborted", "AbortError")),
          );
        }),
    );
    const c = client(fetchImpl as unknown as typeof fetch, {
      signal: controller.signal,
      timeoutMs: 10_000,
      retries: 0,
    });
    const p = c.render(ctx).catch((e) => e);
    controller.abort();
    const err = await p;
    expect((err as GeneratorRenderError).kind).toBe("network");
  });
});

describe("GeneratorRenderClient.health", () => {
  it("200 で true", async () => {
    const fetchImpl = vi.fn(async () => new Response("ok", { status: 200 }));
    expect(await client(fetchImpl as unknown as typeof fetch).health()).toBe(true);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://generator.test/api/health");
    expect((init.headers as Record<string, string>)["x-api-key"]).toBe("secret-key");
  });

  it("非 200 は false", async () => {
    const fetchImpl = vi.fn(async () => new Response("no", { status: 503 }));
    expect(await client(fetchImpl as unknown as typeof fetch).health()).toBe(false);
  });

  it("ネットワーク例外は false", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error("ECONNREFUSED");
    });
    expect(await client(fetchImpl as unknown as typeof fetch).health()).toBe(false);
  });
});

describe("GeneratorRenderClient.fromEnv", () => {
  it("URL/キー両方設定で instance を返す", () => {
    const c = GeneratorRenderClient.fromEnv({}, {
      [GENERATOR_RENDER_URL_ENV]: "https://gen.test",
      [GENERATOR_RENDER_API_KEY_ENV]: "k",
    } as NodeJS.ProcessEnv);
    expect(c).toBeInstanceOf(GeneratorRenderClient);
    expect(c?.baseUrl).toBe("https://gen.test");
  });

  it("URL 未設定なら undefined", () => {
    const c = GeneratorRenderClient.fromEnv({}, {
      [GENERATOR_RENDER_API_KEY_ENV]: "k",
    } as NodeJS.ProcessEnv);
    expect(c).toBeUndefined();
  });

  it("キー未設定なら undefined", () => {
    const c = GeneratorRenderClient.fromEnv({}, {
      [GENERATOR_RENDER_URL_ENV]: "https://gen.test",
    } as NodeJS.ProcessEnv);
    expect(c).toBeUndefined();
  });

  it("overrides で URL/キーを補える", () => {
    const c = GeneratorRenderClient.fromEnv(
      { baseUrl: "https://override.test", apiKey: "ok" },
      {} as NodeJS.ProcessEnv,
    );
    expect(c).toBeInstanceOf(GeneratorRenderClient);
  });
});

describe("GeneratorRenderClient constructor", () => {
  it("baseUrl 未指定は request エラー", () => {
    expect(() => new GeneratorRenderClient({ baseUrl: "", apiKey: "k" })).toThrow(
      GeneratorRenderError,
    );
  });
  it("apiKey 未指定は auth エラー", () => {
    const err = (() => {
      try {
        new GeneratorRenderClient({ baseUrl: "https://x.test", apiKey: "" });
      } catch (e) {
        return e;
      }
    })();
    expect((err as GeneratorRenderError).kind).toBe("auth");
  });
});
