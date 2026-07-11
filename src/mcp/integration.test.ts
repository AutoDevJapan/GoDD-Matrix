/**
 * 統合スモークテスト (issue #22): パイプライン全経路の回帰ガード。
 *
 * #18 (live で select_cells が候補0件になる不整合) の解消を回帰から守るため、
 * 代表入力「経営コンサル × ライトブルー × 信頼」で
 *   index 取込 (createRuntime) → 軸決定 (decideAxes) → 候補セル (selectCells)
 *   → DESIGN.md 本文解決 (DesignResolver) → プロンプト合成 (synthesizePrompt)
 * が **HTTP MCP 経由**で通しで動作することを検証する。
 *
 * ハーメティック維持: リポジトリ内 fixture (index.valid.json + DESIGN.md) を
 * 実ファイル IO で取り込む。ネットワークに依存しないため CI 既定で常時実行され、
 * フレークしない。live サーバへの疎通確認は {@link ./live-smoke.test.ts} (opt-in)。
 *
 * ここで固定する不変条件 (#18 の成果):
 * - select_cells: 候補 >= 1 (7281_h17b-lt_trustworthy を先頭に返す)。
 * - compose: candidateCount >= 1 かつ hasDesignBody = true (DESIGN.md 本文注入)。
 */
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import { createMcpRequestHandler } from "./http.js";
import { MCP_TOOLS } from "./index.js";
import { createRuntime } from "./runtime.js";

/** 代表入力: #18 の再現ケース (経営コンサル × ライトブルー × 信頼)。 */
const REPRESENTATIVE_BRIEF = {
  industry: "経営コンサル",
  color: "ライトブルー",
  mood: "信頼",
} as const;

/** 代表入力が解決すべき確定セル id。 */
const EXPECTED_CELL_ID = "7281_h17b-lt_trustworthy";

/** リポジトリ内 fixture (実ファイル IO で取り込む)。 */
const indexSource = fileURLToPath(new URL("../ds/__fixtures__/index.valid.json", import.meta.url));
const bodyBase = fileURLToPath(new URL("../ds/__fixtures__", import.meta.url));

/** MCP へ POST する JSON-RPC リクエストを組み立てる。 */
function mcpRequest(body: unknown): Request {
  return new Request("https://example.test/mcp", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
    },
    body: JSON.stringify(body),
  });
}

/** tools/call の structuredContent を HTTP MCP 経由で取り出す。 */
async function callTool(
  handle: (req: Request) => Promise<Response>,
  name: string,
  args: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const res = await handle(
    mcpRequest({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }),
  );
  expect(res.status).toBe(200);
  const body = (await res.json()) as { result: { structuredContent: Record<string, unknown> } };
  return body.result.structuredContent;
}

describe("統合スモーク: 代表入力の全経路 (HTTP MCP, ハーメティック)", () => {
  let handle: (req: Request) => Promise<Response>;

  beforeAll(() => {
    // 実 fixture を createRuntime で取り込む (index 取込 → parse → 本文 fetch を通す)。
    handle = createMcpRequestHandler({
      runtimeFactory: () => createRuntime({ indexSource, bodyBase, loadOptions: { cache: false } }),
    });
  });

  it("select_cells が候補 >= 1 を返す (#18 回帰ガード)", async () => {
    const sc = (await callTool(handle, MCP_TOOLS.selectCells, {
      ...REPRESENTATIVE_BRIEF,
    })) as {
      resolved: boolean;
      context?: { jsic: string; color: string; mood: string };
      candidates: Array<{ id: string }>;
    };

    expect(sc.resolved).toBe(true);
    expect(sc.context).toEqual({ jsic: "7281", color: "h17b-lt", mood: "trustworthy" });
    // #18 の核心: 候補が 0 件にならないこと。
    expect(sc.candidates.length).toBeGreaterThanOrEqual(1);
    expect(sc.candidates[0]?.id).toBe(EXPECTED_CELL_ID);
  });

  it("compose が candidateCount>=1 かつ hasDesignBody=true で本文を注入する", async () => {
    const sc = (await callTool(handle, MCP_TOOLS.compose, {
      ...REPRESENTATIVE_BRIEF,
    })) as {
      resolved: boolean;
      context?: { jsic: string; color: string; mood: string };
      candidateCount?: number;
      prompt?: {
        systemPrompt: string;
        provenance: string;
        hasDesignBody: boolean;
      };
    };

    expect(sc.resolved).toBe(true);
    expect(sc.context).toEqual({ jsic: "7281", color: "h17b-lt", mood: "trustworthy" });
    // #18 の核心: 候補が確定し、DESIGN.md 本文が合成に載ること。
    expect(sc.candidateCount).toBeGreaterThanOrEqual(1);
    expect(sc.prompt?.provenance).toBe("materialized");
    expect(sc.prompt?.hasDesignBody).toBe(true);
    // 本文注入の実証: 確定 DESIGN.md の見出しが system プロンプトに含まれる。
    expect(sc.prompt?.systemPrompt).toContain("===== DESIGN.md ここから =====");
    expect(sc.prompt?.systemPrompt).toContain("経営コンサルタント業 × ライトブルー × 信頼");
  });
});
