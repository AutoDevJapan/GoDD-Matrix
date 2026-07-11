import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { DesignIndexClient } from "../ds/client.js";
import { DesignBodyClient, DesignResolver } from "../ds/design.js";
import type { DesignIndexEntry } from "../ds/types.js";
import { createHttpHandler, createMcpRequestHandler, handleHealth } from "./http.js";
import { MCP_TOOLS } from "./index.js";
import type { MatrixRuntime } from "./tools.js";

const baseDir = fileURLToPath(new URL("../ds/__fixtures__", import.meta.url));
const BODY_PATH = "design-md/7412/h17b-lt/trustworthy/DESIGN.md";
const markdown = readFileSync(path.join(baseDir, BODY_PATH), "utf8");
const realHash = `sha256:${createHash("sha256").update(markdown, "utf8").digest("hex")}`;

const entry: DesignIndexEntry = {
  id: "7412_h17b-lt_trustworthy",
  path: BODY_PATH,
  jsic: "7412",
  color: "h17b-lt",
  mood: "trustworthy",
  title: "経営コンサルタント業 × ライトブルー × 信頼",
  hash: realHash,
  createdAt: "2026-07-11T00:00:00Z",
};

function makeRuntime(): MatrixRuntime {
  const index = new DesignIndexClient({ version: 1, entries: [entry] });
  const body = new DesignBodyClient(baseDir);
  return { index, resolver: new DesignResolver(index, body) };
}

/** MCP へ POST する JSON-RPC リクエストを組み立てる。 */
function mcpRequest(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request("https://example.test/mcp", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

const INITIALIZE = {
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "test", version: "0.0.0" },
  },
};

/** JSON レスポンス本文を取り出す (enableJsonResponse=true 前提)。 */
async function readJson(res: Response): Promise<Record<string, unknown>> {
  return (await res.json()) as Record<string, unknown>;
}

describe("handleHealth", () => {
  it("GET で 200 と service 情報を返す", async () => {
    const res = handleHealth(new Request("https://example.test/health"));
    expect(res.status).toBe(200);
    const body = await readJson(res);
    expect(body).toMatchObject({
      status: "ok",
      service: "godd-matrix",
      transport: "streamable-http",
    });
    expect(typeof body.version).toBe("string");
  });

  it("POST など GET/HEAD 以外は 405", () => {
    const res = handleHealth(new Request("https://example.test/health", { method: "POST" }));
    expect(res.status).toBe(405);
  });
});

describe("createMcpRequestHandler", () => {
  it("initialize に serverInfo と capabilities を返す", async () => {
    const handle = createMcpRequestHandler({ runtimeFactory: async () => makeRuntime() });
    const res = await handle(mcpRequest(INITIALIZE));
    expect(res.status).toBe(200);
    const body = await readJson(res);
    const result = body.result as { serverInfo: { name: string }; capabilities: object };
    expect(result.serverInfo.name).toBe("godd-matrix");
    expect(result.capabilities).toHaveProperty("tools");
  });

  it("tools/list に 3 ツールを返す (stateless)", async () => {
    const handle = createMcpRequestHandler({ runtimeFactory: async () => makeRuntime() });
    const res = await handle(
      mcpRequest({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} }),
    );
    expect(res.status).toBe(200);
    const body = await readJson(res);
    const tools = (body.result as { tools: Array<{ name: string }> }).tools;
    const names = tools.map((t) => t.name).sort();
    expect(names).toEqual([MCP_TOOLS.compose, MCP_TOOLS.decideAxes, MCP_TOOLS.selectCells].sort());
  });

  it("compose ツールを HTTP 経由で実行できる", async () => {
    const handle = createMcpRequestHandler({ runtimeFactory: async () => makeRuntime() });
    const res = await handle(
      mcpRequest({
        jsonrpc: "2.0",
        id: 3,
        method: "tools/call",
        params: {
          name: MCP_TOOLS.compose,
          arguments: { industry: "コンサル", color: "ライトブルー", mood: "信頼" },
        },
      }),
    );
    const body = await readJson(res);
    const result = body.result as { structuredContent: { resolved: boolean } };
    expect(result.structuredContent.resolved).toBe(true);
  });

  it("API キー設定時、x-api-key 不一致は 401", async () => {
    const handle = createMcpRequestHandler({
      apiKey: "secret-key",
      runtimeFactory: async () => makeRuntime(),
    });
    const unauth = await handle(mcpRequest(INITIALIZE));
    expect(unauth.status).toBe(401);
    const ok = await handle(mcpRequest(INITIALIZE, { "x-api-key": "secret-key" }));
    expect(ok.status).toBe(200);
  });

  it("Content-Length が maxBodyBytes 超過なら 413 (処理前に拒否)", async () => {
    let built = false;
    const handle = createMcpRequestHandler({
      maxBodyBytes: 32,
      runtimeFactory: async () => {
        built = true;
        return makeRuntime();
      },
    });
    // 実クライアント / Vercel は content-length を付与する (node-adapter が写す)。
    const res = await handle(mcpRequest(INITIALIZE, { "content-length": "1000000" }));
    expect(res.status).toBe(413);
    const body = await readJson(res);
    expect((body.error as { code: number }).code).toBe(-32600);
    // 過大ボディはランタイム構築より前に弾く。
    expect(built).toBe(false);
  });

  it("maxBodyBytes 以内なら通常どおり処理する", async () => {
    const handle = createMcpRequestHandler({
      maxBodyBytes: 1_048_576,
      runtimeFactory: async () => makeRuntime(),
    });
    const res = await handle(mcpRequest(INITIALIZE));
    expect(res.status).toBe(200);
  });

  it("ランタイム生成失敗でも tools/list は応答する (遅延フォールバック)", async () => {
    const handle = createMcpRequestHandler({
      runtimeFactory: async () => {
        throw new Error("index 未設定");
      },
    });
    const res = await handle(
      mcpRequest({ jsonrpc: "2.0", id: 4, method: "tools/list", params: {} }),
    );
    expect(res.status).toBe(200);
    const body = await readJson(res);
    expect((body.result as { tools: unknown[] }).tools).toHaveLength(3);
  });

  it("ランタイム未構築時にツール実行するとエラー結果を返す", async () => {
    const handle = createMcpRequestHandler({
      runtimeFactory: async () => {
        throw new Error("index 未設定");
      },
    });
    const res = await handle(
      mcpRequest({
        jsonrpc: "2.0",
        id: 5,
        method: "tools/call",
        params: { name: MCP_TOOLS.selectCells, arguments: { industry: "コンサル" } },
      }),
    );
    const body = await readJson(res);
    // ツール実行はエラー (isError または JSON-RPC error) になる。
    const hasError =
      body.error !== undefined || (body.result as { isError?: boolean })?.isError === true;
    expect(hasError).toBe(true);
  });
});

describe("createHttpHandler", () => {
  it("パスで health / mcp / 404 を振り分ける", async () => {
    const handle = createHttpHandler({ runtimeFactory: async () => makeRuntime() });
    const health = await handle(new Request("https://example.test/health"));
    expect(health.status).toBe(200);

    const mcp = await handle(mcpRequest(INITIALIZE));
    expect(mcp.status).toBe(200);

    const missing = await handle(new Request("https://example.test/nope"));
    expect(missing.status).toBe(404);
  });
});
