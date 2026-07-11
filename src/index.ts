/**
 * GoDD-Matrix 公開エントリ (SSOT item3: 選定/合成ツール)。
 * データフロー: 要望 -> 軸決定 -> (index 取込 / レンダー) -> Claude 用プロンプト合成。
 */
export { VERSION } from "./version.js";
export type { AxisContext, ColorKey, JsicCode, MoodKey } from "./axes/index.js";
export {
  DS_INDEX_ENV,
  type DesignIndex,
  DesignIndexClient,
  DesignIndexError,
  type DesignIndexEntry,
  type IndexQuery,
  type LoadOptions,
  parseDesignIndex,
  validateDesignIndex,
} from "./ds/index.js";
export type { RenderRequest, RenderResult } from "./generator/index.js";
export type { ComposedPrompt } from "./prompt/index.js";
export { MCP_TOOLS } from "./mcp/index.js";
