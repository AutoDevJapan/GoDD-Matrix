/**
 * GoDD-Matrix 公開エントリ (SSOT item3: 選定/合成ツール)。
 * データフロー: 要望 -> 軸決定 -> (index 取込 / レンダー) -> Claude 用プロンプト合成。
 */
export { VERSION } from "./version.js";
export type { AxisContext, ColorKey, JsicCode, MoodKey } from "./axes/index.js";
export {
  type AxisDecision,
  type AxisDefaults,
  type AxisName,
  type AxisResolvers,
  type CellSelection,
  type DecideOptions,
  decideAxes,
  type DesignBrief,
  type JsicCandidate,
  type JsicEntry,
  type JsicResolution,
  type JsicResolver,
  MINIMAL_COLORS,
  MINIMAL_JSIC,
  MINIMAL_MOODS,
  normalizeKey,
  selectCells,
  type SlugResolver,
  StaticColorResolver,
  StaticJsicResolver,
  StaticMoodResolver,
  StaticSlugResolver,
  type TaxonomyCandidate,
  type TaxonomyEntry,
  type TaxonomyResolution,
} from "./axes/index.js";
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
export {
  type ComposedPrompt,
  type PromptProvenance,
  synthesizePrompt,
} from "./prompt/index.js";
export {
  type ComposeResult,
  createMatrixServer,
  createRuntime,
  type DecideAxesResult,
  DS_BASE_ENV,
  type MatrixBriefInput,
  type MatrixRuntime,
  MCP_TOOLS,
  runCompose,
  runDecideAxes,
  runSelectCells,
  type RuntimeOptions,
  type SelectCellsResult,
} from "./mcp/index.js";
