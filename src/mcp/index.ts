/**
 * MCP サーバ提供形態 (SSOT §5, issue #7)。
 *
 * GoDD-Matrix を GitHub ネイティブに提供するための MCP サーバ層。
 * 既存パイプライン (#5 決定 / #2 index / #3 本文 / #6 合成) を薄くツール化し、
 * `@modelcontextprotocol/sdk` の stdio サーバとして公開する。
 */

/** MCP が公開する tool 名 (安定 ID)。 */
export const MCP_TOOLS = {
  /** 要望 → 確定軸 → DESIGN.md 解決 → Claude 用プロンプト合成。 */
  compose: "godd_matrix_compose",
  /** 要望 → 各軸の解決 (確定 context / 未解決軸 / 候補)。 */
  decideAxes: "godd_matrix_decide_axes",
  /** 要望 → 確定軸 → index 候補セル選定。 */
  selectCells: "godd_matrix_select_cells",
} as const;

export { createMatrixServer } from "./server.js";
export {
  API_KEY_HEADER,
  createHttpHandler,
  createMcpRequestHandler,
  DEFAULT_HEALTH_PATH,
  DEFAULT_MCP_PATH,
  handleHealth,
  type HttpHandlerOptions,
  MCP_API_KEY_ENV,
  type McpHandlerOptions,
} from "./http.js";
export { createRuntime, DS_BASE_ENV, type RuntimeOptions } from "./runtime.js";
export {
  type ComposeResult,
  type DecideAxesResult,
  type MatrixBriefInput,
  type MatrixRuntime,
  runCompose,
  runDecideAxes,
  runSelectCells,
  type SelectCellsResult,
} from "./tools.js";
