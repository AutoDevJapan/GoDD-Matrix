/**
 * GoDD-Matrix 公開エントリ (SSOT item3: 選定/合成ツール)。
 * データフロー: 要望 -> 軸決定 -> (index 取込 / レンダー) -> Claude 用プロンプト合成。
 */
export { VERSION } from "./version.js";
export type { AxisContext, ColorKey, JsicCode, MoodKey } from "./axes/index.js";
export {
  DS_INDEX_ENV,
  DesignBodyClient,
  type DesignBodyOptions,
  type DesignDocument,
  type DesignIndex,
  DesignIndexClient,
  DesignIndexError,
  type DesignIndexEntry,
  type DesignRenderer,
  type DesignResolution,
  DesignResolver,
  fetchText,
  type FetchTextOptions,
  type IndexQuery,
  isHttpUrl,
  type LoadOptions,
  parseDesignIndex,
  resolveDesignLocation,
  validateDesignIndex,
  verifyDesignHash,
} from "./ds/index.js";
export type { RenderRequest, RenderResult } from "./generator/index.js";
export type { ComposedPrompt } from "./prompt/index.js";
export { MCP_TOOLS } from "./mcp/index.js";
