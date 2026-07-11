import { type Server, createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { handleHealth } from "./http.js";
import { toNodeListener } from "./node-adapter.js";

let server: Server | undefined;

afterEach(async () => {
  if (server) {
    await new Promise<void>((resolve) => server?.close(() => resolve()));
    server = undefined;
  }
});

/** 与えた Web ハンドラを Node サーバとして起動し、base URL を返す。 */
async function listen(handler: Parameters<typeof toNodeListener>[0]): Promise<string> {
  server = createServer(toNodeListener(handler));
  await new Promise<void>((resolve) => server?.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return `http://127.0.0.1:${port}`;
}

describe("toNodeListener", () => {
  it("GET を Web Request に変換し Response を Node res へ書き戻す", async () => {
    const base = await listen((req) => handleHealth(req));
    const res = await fetch(`${base}/health`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: string };
    expect(body.status).toBe("ok");
  });

  it("POST の生ボディを読み取ってハンドラに渡す", async () => {
    const base = await listen(async (req) => {
      const text = await req.text();
      return new Response(JSON.stringify({ echo: text, method: req.method }), {
        status: 201,
        headers: { "content-type": "application/json" },
      });
    });
    const res = await fetch(`${base}/x`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ hello: "世界" }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { echo: string; method: string };
    expect(body.method).toBe("POST");
    expect(JSON.parse(body.echo)).toEqual({ hello: "世界" });
  });

  it("ハンドラ例外を 500 に変換する", async () => {
    const base = await listen(() => {
      throw new Error("boom");
    });
    const res = await fetch(`${base}/x`);
    expect(res.status).toBe(500);
    const body = (await res.json()) as { error: string; message: string };
    expect(body.error).toBe("internal_error");
    expect(body.message).toBe("boom");
  });
});
