import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { beforeEach, describe, expect, it } from "vitest";
import { DesignIndexClient } from "../ds/client.js";
import { DesignBodyClient, DesignResolver } from "../ds/design.js";
import type { DesignIndexEntry } from "../ds/types.js";
import { MCP_TOOLS } from "./index.js";
import { createMatrixServer } from "./server.js";
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

/** サーバとクライアントを inMemory transport で接続する。 */
async function connectClient(): Promise<Client> {
  const server = createMatrixServer(makeRuntime());
  const client = new Client({ name: "test-client", version: "0.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return client;
}

/** CallToolResult の text content を JSON として取り出す。 */
function parsePayload(result: CallToolResult): Record<string, unknown> {
  const first = result.content[0];
  expect(first?.type).toBe("text");
  return JSON.parse((first as { text: string }).text);
}

describe("createMatrixServer", () => {
  let client: Client;

  beforeEach(async () => {
    client = await connectClient();
  });

  it("tools/list に 3 ツールを登録する", async () => {
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name).sort();
    expect(names).toEqual([MCP_TOOLS.compose, MCP_TOOLS.decideAxes, MCP_TOOLS.selectCells].sort());
    const compose = tools.find((t) => t.name === MCP_TOOLS.compose);
    expect(compose?.inputSchema).toBeDefined();
    expect(compose?.description).toContain("プロンプト");
  });

  it("compose ツールが確定軸から DESIGN.md を解決してプロンプトを返す", async () => {
    const result = (await client.callTool({
      name: MCP_TOOLS.compose,
      arguments: { industry: "コンサル", color: "ライトブルー", mood: "信頼" },
    })) as CallToolResult;

    expect(result.isError ?? false).toBe(false);
    const payload = parsePayload(result);
    expect(payload.resolved).toBe(true);
    const prompt = payload.prompt as { systemPrompt: string; provenance: string };
    expect(prompt.provenance).toBe("materialized");
    expect(prompt.systemPrompt).toContain("専門性と誠実さ");
    expect(result.structuredContent).toMatchObject({ resolved: true });
  });

  it("decide_axes ツールが各軸の解決を返す", async () => {
    const result = (await client.callTool({
      name: MCP_TOOLS.decideAxes,
      arguments: { industry: "コンサル", color: "ライトブルー", mood: "信頼" },
    })) as CallToolResult;
    const payload = parsePayload(result);
    expect(payload.resolved).toBe(true);
    expect(payload.context).toEqual({ jsic: "7412", color: "h17b-lt", mood: "trustworthy" });
  });

  it("select_cells ツールが候補セルを返す", async () => {
    const result = (await client.callTool({
      name: MCP_TOOLS.selectCells,
      arguments: { industry: "コンサル", color: "ライトブルー", mood: "信頼" },
    })) as CallToolResult;
    const payload = parsePayload(result);
    const candidates = payload.candidates as ReadonlyArray<{ id: string }>;
    expect(candidates).toHaveLength(1);
    expect(candidates[0]?.id).toBe("7412_h17b-lt_trustworthy");
  });

  it("解決不能な要望の compose は isError で候補を返す", async () => {
    const result = (await client.callTool({
      name: MCP_TOOLS.compose,
      arguments: { industry: "存在しない業種xyz" },
    })) as CallToolResult;
    expect(result.isError).toBe(true);
    const payload = parsePayload(result);
    expect(payload.resolved).toBe(false);
    expect(payload.unresolved).toContain("jsic");
  });
});
