import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import {
  StdioClientTransport,
  getDefaultEnvironment,
} from "@modelcontextprotocol/sdk/client/stdio.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  FIXTURE_COMMIT,
  jsicBytes,
  makePin,
  taxonomyBytes,
} from "../ds/__fixtures__/snapshot-pin.js";
import { buildTar } from "./__fixtures__/tar-fixture.js";
import { verifyArtifactDir } from "./artifact.js";
import { packageMcp } from "./package.js";

const repoRoot = fileURLToPath(new URL("../../", import.meta.url));
const enc = (s: string) => new TextEncoder().encode(s);
const sha = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

const cells = [
  {
    id: "7281_lt-h17_trustworthy",
    jsic: "7281",
    color: "lt-h17",
    mood: "trustworthy",
    body: "# 信頼の青\n専門性と誠実さ\n",
  },
  {
    id: "6061_ac-bk_minimal",
    jsic: "6061",
    color: "ac-bk",
    mood: "minimal",
    body: "# 黒のミニマル\n",
  },
].map((c) => ({
  ...c,
  path: `design-md/${c.jsic}/${c.color}/${c.mood}/DESIGN.md`,
  bytes: enc(c.body),
}));

const index = {
  version: 1,
  entries: cells.map((c) => ({
    id: c.id,
    path: c.path,
    jsic: c.jsic,
    color: c.color,
    mood: c.mood,
    title: c.id,
    hash: `sha256:${sha(c.bytes)}`,
    createdAt: "2026-07-11T00:00:00Z",
  })),
};
const indexBytes = enc(JSON.stringify(index));
const pin = makePin({ index: indexBytes, entryCount: cells.length });

const tempDirs: string[] = [];
function tempDir(): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), "godd-matrix-pkg-"));
  tempDirs.push(dir);
  return dir;
}

let work: string; // pin / source files / tarball / bodies
beforeAll(() => {
  work = tempDir();
  writeFileSync(path.join(work, "pin.json"), JSON.stringify(pin, null, 2));
  mkdirSync(path.join(work, "source"));
  writeFileSync(path.join(work, "source", "index.json"), indexBytes);
  writeFileSync(path.join(work, "source", "taxonomy.json"), taxonomyBytes);
  writeFileSync(path.join(work, "source", "jsic.json"), jsicBytes);
  const tar = buildTar([
    { path: `GoDD-Design-Systems-${FIXTURE_COMMIT}/`, type: "5" },
    { path: `GoDD-Design-Systems-${FIXTURE_COMMIT}/index.json`, data: indexBytes },
    ...cells.map((c) => ({
      path: `GoDD-Design-Systems-${FIXTURE_COMMIT}/${c.path}`,
      data: c.bytes,
    })),
  ]);
  writeFileSync(path.join(work, "bodies.tar.gz"), gzipSync(tar));
  // 実行時に本文を読むローカルの置き場 (GODD_DS_BASE)
  for (const c of cells) {
    const file = path.join(work, "bodies", c.path);
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, c.bytes);
  }
});
afterAll(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function options(out: string, over: Partial<Parameters<typeof packageMcp>[0]> = {}) {
  return {
    repoRoot,
    outDir: out,
    pinFile: path.join(work, "pin.json"),
    sourceDir: path.join(work, "source"),
    tarball: path.join(work, "bodies.tar.gz"),
    ...over,
  };
}

describe("packageMcp (正式配布物の生成)", () => {
  it("束縛した 3 ファイル・全本文の検証記録・ライセンス・チェックサムを含む成果物を作る", async () => {
    const out = path.join(tempDir(), "artifact");
    const result = await packageMcp(options(out));
    expect(result.bodies).toMatchObject({
      indexEntries: 2,
      verified: 2,
      missing: [],
      mismatched: [],
    });
    expect(result.verification.entries).toBe(2);
    expect(readdirSync(out).sort()).toEqual([
      "LICENSE",
      "SHA256SUMS",
      "THIRD-PARTY-LICENSES.txt",
      "catalog-verification.json",
      "index.json",
      "jsic.json",
      "main.js",
      "snapshot.json",
      "taxonomy.json",
    ]);
    await expect(verifyArtifactDir(out)).resolves.toMatchObject({ entries: 2 });
    const licenses = readFileSync(path.join(out, "THIRD-PARTY-LICENSES.txt"), "utf8");
    expect(licenses).toContain("@modelcontextprotocol/sdk@");
    expect(licenses).toContain("zod@");
    expect(readFileSync(path.join(out, "LICENSE"), "utf8")).toBe(
      readFileSync(path.join(repoRoot, "LICENSE"), "utf8"),
    );
    const main = readFileSync(path.join(out, "main.js"), "utf8");
    expect(main.startsWith("#!/usr/bin/env node")).toBe(true);
    // pin はコミット済みの定義をそのまま (バイト同一で) 載せる。
    expect(readFileSync(path.join(out, "snapshot.json"), "utf8")).toBe(
      readFileSync(path.join(work, "pin.json"), "utf8"),
    );
  }, 60_000);

  it("本文が tarball に欠けていれば、何も書かずに拒否する", async () => {
    const out = path.join(tempDir(), "artifact");
    const tar = buildTar([
      { path: `r-${FIXTURE_COMMIT}/${cells[0]?.path}`, data: cells[0]?.bytes },
    ]);
    const partial = path.join(tempDir(), "partial.tar.gz");
    writeFileSync(partial, gzipSync(tar));
    await expect(packageMcp(options(out, { tarball: partial }))).rejects.toThrow(/見つかりません/);
    expect(readdirSync(out)).toEqual([]);
  }, 60_000);

  it("本文が 1 バイト違えば、何も書かずに拒否する", async () => {
    const out = path.join(tempDir(), "artifact");
    const changed = cells.map((c, i) => ({
      path: `r-${FIXTURE_COMMIT}/${c.path}`,
      data: i === 1 ? enc("# 黒のミニマルX\n") : c.bytes,
    }));
    const tampered = path.join(tempDir(), "tampered.tar.gz");
    writeFileSync(tampered, gzipSync(buildTar(changed)));
    await expect(packageMcp(options(out, { tarball: tampered }))).rejects.toThrow(
      /6061_ac-bk_minimal/,
    );
    expect(readdirSync(out)).toEqual([]);
  }, 60_000);

  it("index / taxonomy / jsic が pin と違えば、何も書かずに拒否する", async () => {
    for (const name of ["index.json", "taxonomy.json", "jsic.json"]) {
      const source = tempDir();
      for (const file of ["index.json", "taxonomy.json", "jsic.json"]) {
        const bytes = readFileSync(path.join(work, "source", file));
        if (file === name) bytes[bytes.length - 3] = (bytes[bytes.length - 3] ?? 0) ^ 0x01;
        writeFileSync(path.join(source, file), bytes);
      }
      const out = path.join(tempDir(), "artifact");
      await expect(packageMcp(options(out, { sourceDir: source }))).rejects.toThrow(
        new RegExp(`${name.replace(".json", "")}.*sha256`),
      );
      expect(readdirSync(out)).toEqual([]);
    }
  }, 60_000);

  it("空でない出力先には書かない", async () => {
    const out = tempDir();
    writeFileSync(path.join(out, "keep.txt"), "x");
    await expect(packageMcp(options(out))).rejects.toThrow(/空/);
    expect(readdirSync(out)).toEqual(["keep.txt"]);
  }, 60_000);
});

describe("生成した成果物 (main.js) の実行", () => {
  let out: string;
  beforeAll(async () => {
    out = path.join(tempDir(), "artifact");
    await packageMcp(options(out));
  }, 60_000);

  function env(): Record<string, string> {
    return { ...getDefaultEnvironment(), GODD_DS_BASE: path.join(work, "bodies") };
  }

  async function withClient<T>(run: (client: Client) => Promise<T>): Promise<T> {
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [path.join(out, "main.js")],
      env: env(),
      stderr: "pipe",
    });
    const client = new Client({ name: "pkg-test", version: "0.0.0" });
    await client.connect(transport);
    try {
      return await run(client);
    } finally {
      await client.close();
    }
  }

  it("単独で stdio MCP として起動し、3 ツールを読み取り専用として公開する", async () => {
    await withClient(async (client) => {
      const { tools } = await client.listTools();
      expect(tools.map((t) => t.name).sort()).toEqual([
        "godd_matrix_compose",
        "godd_matrix_decide_axes",
        "godd_matrix_select_cells",
      ]);
      for (const tool of tools) expect(tool.annotations?.readOnlyHint).toBe(true);
    });
  }, 60_000);

  it("同梱の語彙 (最小表に無い slug) で軸を確定し、同梱 index から候補セルを返す", async () => {
    await withClient(async (client) => {
      const r = await client.callTool({
        name: "godd_matrix_select_cells",
        arguments: { industry: "7281", color: "lt-h17", mood: "信頼" },
      });
      const sc = r.structuredContent as {
        resolved: boolean;
        candidates: Array<{ id: string }>;
        snapshot: { indexSha256: string };
      };
      expect(sc.resolved).toBe(true);
      expect(sc.candidates.map((c) => c.id)).toEqual(["7281_lt-h17_trustworthy"]);
      expect(sc.snapshot.indexSha256).toBe(pin.index.sha256);
    });
  }, 60_000);

  it("曖昧な色名は確定せず、候補を返して未解決にする", async () => {
    await withClient(async (client) => {
      const r = await client.callTool({
        name: "godd_matrix_decide_axes",
        arguments: { industry: "7281", color: "ライトトーンの青", mood: "信頼" },
      });
      const sc = r.structuredContent as {
        resolved: boolean;
        unresolved: string[];
        axes: { color: { candidates: Array<{ slug: string }> } };
      };
      expect(sc.resolved).toBe(false);
      expect(sc.unresolved).toEqual(["color"]);
      expect(sc.axes.color.candidates.map((c) => c.slug).slice(0, 3)).toEqual([
        "h17b-lt",
        "lt-h17",
        "lt-h18",
      ]);
    });
  }, 60_000);

  it("compose は pin 済み index の本文を hash 検証して合成し、本文が改竄されていれば拒否する", async () => {
    await withClient(async (client) => {
      const r = await client.callTool({
        name: "godd_matrix_compose",
        arguments: { industry: "7281", color: "lt-h17", mood: "trustworthy" },
      });
      const sc = r.structuredContent as {
        resolved: boolean;
        prompt: { provenance: string; systemPrompt: string };
      };
      expect(sc.resolved).toBe(true);
      expect(sc.prompt.provenance).toBe("materialized");
      expect(sc.prompt.systemPrompt).toContain("専門性と誠実さ");
    });
    const bodyFile = path.join(work, "bodies", cells[0]?.path ?? "");
    const original = readFileSync(bodyFile);
    try {
      writeFileSync(bodyFile, Buffer.concat([original, enc("改竄")]));
      await withClient(async (client) => {
        const r = await client.callTool({
          name: "godd_matrix_compose",
          arguments: { industry: "7281", color: "lt-h17", mood: "trustworthy" },
        });
        expect(r.isError).toBe(true);
        expect(JSON.stringify(r.content)).toMatch(/hash/);
      });
    } finally {
      writeFileSync(bodyFile, original);
    }
  }, 60_000);

  it("同梱の index / taxonomy / jsic が pin と違えば、起動せず理由を出して終了する", () => {
    for (const name of ["index.json", "taxonomy.json", "jsic.json"]) {
      const tampered = path.join(tempDir(), "artifact");
      mkdirSync(tampered);
      for (const file of readdirSync(out)) {
        const bytes = readFileSync(path.join(out, file));
        if (file === name) bytes[bytes.length - 3] = (bytes[bytes.length - 3] ?? 0) ^ 0x01;
        writeFileSync(path.join(tampered, file), bytes);
      }
      const run = spawnSync(process.execPath, [path.join(tampered, "main.js")], {
        env: env(),
        input: "",
        encoding: "utf8",
        timeout: 30_000,
      });
      expect(run.status, name).not.toBe(0);
      expect(run.stderr, name).toContain(name.replace(".json", ""));
      expect(run.stderr, name).toMatch(/sha256|bytes/);
    }
  }, 60_000);
});
