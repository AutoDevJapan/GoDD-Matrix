import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DesignRenderer } from "../ds/design.js";
import { GENERATOR_RENDER_API_KEY_ENV, GENERATOR_RENDER_URL_ENV } from "../generator/index.js";
import { createRuntime } from "./runtime.js";

const indexSource = fileURLToPath(new URL("../ds/__fixtures__/index.valid.json", import.meta.url));
const bodyBase = fileURLToPath(new URL("../ds/__fixtures__", import.meta.url));
/** index に存在しない (未材化) 軸 context。 */
const unmaterialized = { jsic: "9999", color: "black", mood: "bold" };

afterEach(() => {
  delete process.env[GENERATOR_RENDER_URL_ENV];
  delete process.env[GENERATOR_RENDER_API_KEY_ENV];
});

describe("createRuntime の renderer 配線", () => {
  it("renderer 明示注入時、未材化セルが rendered フォールバックする", async () => {
    const renderer: DesignRenderer = {
      render: vi.fn(async () => ({ designMarkdown: "# injected" })),
    };
    const rt = await createRuntime({
      indexSource,
      bodyBase,
      loadOptions: { cache: false },
      renderer,
    });
    const res = await rt.resolver.resolve(unmaterialized);
    expect(res.status).toBe("rendered");
    if (res.status === "rendered") {
      expect(res.result.designMarkdown).toBe("# injected");
    }
    expect(renderer.render).toHaveBeenCalledWith(unmaterialized);
  });

  it("renderer 未設定 (env なし) なら未材化は unavailable", async () => {
    const rt = await createRuntime({ indexSource, bodyBase, loadOptions: { cache: false } });
    const res = await rt.resolver.resolve(unmaterialized);
    expect(res.status).toBe("unavailable");
  });

  it("env 設定時は GeneratorRenderClient が構築され HTTP モック経由で rendered する", async () => {
    process.env[GENERATOR_RENDER_URL_ENV] = "https://generator.test/api";
    process.env[GENERATOR_RENDER_API_KEY_ENV] = "secret-key";
    const fetchImpl = vi.fn(
      async () =>
        new Response(JSON.stringify({ markdown: "# from-http" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    );
    const rt = await createRuntime({
      indexSource,
      bodyBase,
      loadOptions: { cache: false },
      rendererOptions: { fetchImpl: fetchImpl as unknown as typeof fetch },
    });
    const res = await rt.resolver.resolve(unmaterialized);
    expect(res.status).toBe("rendered");
    if (res.status === "rendered") {
      expect(res.result.designMarkdown).toBe("# from-http");
    }
    // x-api-key ヘッダと /render エンドポイントで叩いている。
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://generator.test/api/render");
    expect((init.headers as Record<string, string>)["x-api-key"]).toBe("secret-key");
  });

  it("材化済みセルは renderer を使わず本文を返す", async () => {
    const renderer: DesignRenderer = { render: vi.fn(async () => ({ designMarkdown: "x" })) };
    const rt = await createRuntime({
      indexSource,
      bodyBase,
      loadOptions: { cache: false },
      renderer,
    });
    const res = await rt.resolver.resolve({ jsic: "7281", color: "h17b-lt", mood: "trustworthy" });
    expect(res.status).toBe("materialized");
    expect(renderer.render).not.toHaveBeenCalled();
  });
});
