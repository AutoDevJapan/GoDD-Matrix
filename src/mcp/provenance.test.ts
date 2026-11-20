import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it } from "vitest";
import { DesignIndexClient } from "../ds/client.js";
import { DesignBodyClient, DesignResolver } from "../ds/design.js";
import type { DesignIndexEntry } from "../ds/types.js";
import { MCP_TOOLS } from "./index.js";
import { createMatrixServer } from "./server.js";
import { type MatrixRuntime, runCompose, runDecideAxes, runSelectCells } from "./tools.js";

const baseDir = fileURLToPath(new URL("../ds/__fixtures__", import.meta.url));
const BODY_PATH = "design-md/7281/h17b-lt/trustworthy/DESIGN.md";
const markdown = readFileSync(path.join(baseDir, BODY_PATH), "utf8");
const realHash = `sha256:${createHash("sha256").update(markdown, "utf8").digest("hex")}`;

const entry: DesignIndexEntry = {
  id: "7281_h17b-lt_trustworthy",
  path: BODY_PATH,
  jsic: "7281",
  color: "h17b-lt",
  mood: "trustworthy",
  title: "経営コンサルタント業 × ライトブルー × 信頼",
  hash: realHash,
  createdAt: "2026-07-11T00:00:00Z",
};

const snapshot = {
  repository: "AutoDevJapan/GoDD-Design-Systems",
  commit: "7d3ed9a3d171fee1b3f63f62ac73b71e102e8892",
  indexSha256: "62eb8dbde50783aba4fc15f4578a979342cf2cb06fa40bc03c67e2412c879fe0",
  indexBytes: 32_815_467,
  entryCount: 51_729,
  taxonomySha256: "ac72de4725369093d2171fe69b9076ff03ca0a364ea5ba21d29c6637ea08a88e",
  jsicSha256: "aae7d353c92cdc17d115ea11ac1a5493041222c1edc0d81722dc00753e053034",
};

function makeRuntime(withSnapshot: boolean): MatrixRuntime {
  const index = new DesignIndexClient({ version: 1, entries: [entry] });
  const resolver = new DesignResolver(index, new DesignBodyClient(baseDir));
  return withSnapshot ? { index, resolver, snapshot } : { index, resolver };
}

const resolvable = { industry: "コンサル", color: "ライトブルー", mood: "信頼" };
const unresolvable = { industry: "存在しない業種xyz" };

const TOOL_NAMES = [MCP_TOOLS.compose, MCP_TOOLS.decideAxes, MCP_TOOLS.selectCells];

async function connect(runtime: MatrixRuntime): Promise<Client> {
  const server = createMatrixServer(runtime);
  const client = new Client({ name: "test-client", version: "0.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return client;
}

describe("snapshot の出所 (provenance) を結果へ載せる", () => {
  it("compose は確定・未解決のどちらでも pin の同一性を返す", async () => {
    const rt = makeRuntime(true);
    expect((await runCompose(resolvable, rt)).snapshot).toEqual(snapshot);
    expect((await runCompose(unresolvable, rt)).snapshot).toEqual(snapshot);
  });

  it("select_cells も pin の同一性を返す", () => {
    expect(runSelectCells(resolvable, makeRuntime(true)).snapshot).toEqual(snapshot);
  });

  it("decide_axes も確定・未解決のどちらでも pin の同一性を返す", () => {
    const rt = makeRuntime(true);
    expect(runDecideAxes(resolvable, rt).snapshot).toEqual(snapshot);
    expect(runDecideAxes(unresolvable, rt).snapshot).toEqual(snapshot);
  });

  it("snapshot が無い runtime の結果には snapshot キー自体を付けない", async () => {
    const rt = makeRuntime(false);
    expect("snapshot" in (await runCompose(resolvable, rt))).toBe(false);
    expect("snapshot" in runSelectCells(resolvable, rt)).toBe(false);
    expect("snapshot" in runDecideAxes(resolvable, rt)).toBe(false);
  });

  it("runtime を渡さない decide_axes (純関数としての呼び出し) にも snapshot キーを付けない", () => {
    expect("snapshot" in runDecideAxes(resolvable)).toBe(false);
  });

  it("MCP の tool 境界 (structuredContent) でも 3 ツールとも同じ値が返る", async () => {
    const client = await connect(makeRuntime(true));
    for (const name of TOOL_NAMES) {
      const result = await client.callTool({ name, arguments: resolvable });
      expect((result.structuredContent as { snapshot?: unknown }).snapshot, name).toEqual(snapshot);
    }
  });

  it("MCP の tool 境界でも、pin が無い runtime の結果には 3 ツールとも snapshot キーを付けない", async () => {
    const client = await connect(makeRuntime(false));
    for (const name of TOOL_NAMES) {
      const result = await client.callTool({ name, arguments: resolvable });
      expect("snapshot" in (result.structuredContent as object), name).toBe(false);
    }
  });
});
