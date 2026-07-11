/**
 * GoDD-Matrix MCP サーバの組立 (issue #7, SSOT §5)。
 *
 * 公式 TS SDK (`@modelcontextprotocol/sdk`) の高水準 {@link McpServer} に、
 * 既存パイプラインを薄くラップした 3 ツールを登録する。副作用は {@link MatrixRuntime}
 * に閉じ込め、本モジュールは「入力スキーマ ↔ ドメイン関数」の配線のみを担う。
 *
 * 公開ツール:
 * - `godd_matrix_compose`      : 要望 → 確定軸 → DESIGN.md 解決 → プロンプト合成。
 * - `godd_matrix_decide_axes`  : 要望 → 各軸の解決 (候補提示)。
 * - `godd_matrix_select_cells` : 要望 → 確定軸 → index 候補セル。
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { VERSION } from "../version.js";
import { MCP_TOOLS } from "./index.js";
import { type MatrixRuntime, runCompose, runDecideAxes, runSelectCells } from "./tools.js";

/** 要望入力の zod スキーマ (全ツール共通)。 */
const briefShape = {
  industry: z.string().min(1).describe("業種名 / キーワード / JSIC 細分類コード (必須)"),
  color: z.string().optional().describe("希望カラー (色名 / slug)。任意"),
  mood: z.string().optional().describe("希望ムード。任意"),
  tags: z.array(z.string()).optional().describe("追加タグ (タイポ / レイアウト等)。任意"),
} as const;

/** ドメイン結果を MCP の CallToolResult (text + structuredContent) に載せる。 */
function toolResult(payload: object, isError = false): CallToolResult {
  return {
    content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
    structuredContent: payload as Record<string, unknown>,
    isError,
  };
}

/**
 * ランタイムを注入して MCP サーバを組み立てる。
 * stdio / inMemory いずれの transport にも接続できる (副作用は runtime に集約)。
 */
export function createMatrixServer(runtime: MatrixRuntime): McpServer {
  const server = new McpServer(
    { name: "godd-matrix", version: VERSION },
    { capabilities: { tools: {} } },
  );

  server.registerTool(
    MCP_TOOLS.compose,
    {
      title: "GoDD Matrix: プロンプト合成",
      description:
        "要望 (業種 / カラー / ムード) から軸を決定し、候補セルの確定 DESIGN.md を解決して Claude 用プロンプト (system / user) を合成する。未解決軸があれば候補を提示する。",
      inputSchema: briefShape,
    },
    async (args) => {
      const result = await runCompose(args, runtime);
      return toolResult(result, !result.resolved);
    },
  );

  server.registerTool(
    MCP_TOOLS.decideAxes,
    {
      title: "GoDD Matrix: 軸決定",
      description:
        "要望から業種 (JSIC) / カラー / ムードの各軸を解決し、確定 context と未解決軸・候補を返す (副作用なし)。",
      inputSchema: briefShape,
    },
    async (args) => toolResult(runDecideAxes(args)),
  );

  server.registerTool(
    MCP_TOOLS.selectCells,
    {
      title: "GoDD Matrix: 候補セル選定",
      description:
        "要望から軸を決定し、Design-Systems index に一致する候補セル (材化済み DESIGN.md) を返す。",
      inputSchema: briefShape,
    },
    async (args) => toolResult(runSelectCells(args, runtime)),
  );

  return server;
}
