/**
 * 軸 (SSOT §2): 業種 (JSIC 細分類) × カラー (PCCS + 無彩色) × ムード。
 * ここで共有型を定義し、決定ロジック (issue #5) を再輸出する。
 */

/** JSIC 細分類コード (例: "7621")。 */
export type JsicCode = string;

/** カラー軸 (PCCS 24 色相 + トーン / 無彩色) の正規化キー。 */
export type ColorKey = string;

/** ムード軸の正規化キー。 */
export type MoodKey = string;

/** レンダー / 選定に渡す確定済みの軸 context。 */
export interface AxisContext {
  jsic: JsicCode;
  color: ColorKey;
  mood: MoodKey;
  /** 補助タグ (タイポ体系・レイアウト原型など、ディレクトリに掛けない属性)。 */
  tags?: readonly string[];
}

export { normalizeKey } from "./normalize.js";
export {
  type JsicCandidate,
  type JsicEntry,
  type JsicMatchKind,
  type JsicResolution,
  type JsicResolver,
  MINIMAL_JSIC,
  StaticJsicResolver,
} from "./jsic.js";
export {
  MINIMAL_COLORS,
  MINIMAL_MOODS,
  type SlugResolver,
  StaticColorResolver,
  StaticMoodResolver,
  StaticSlugResolver,
  type TaxonomyCandidate,
  type TaxonomyEntry,
  type TaxonomyResolution,
} from "./taxonomy.js";
export {
  type AxisDecision,
  type AxisDefaults,
  type AxisName,
  type AxisResolvers,
  type CellSelection,
  type DecideOptions,
  decideAxes,
  type DesignBrief,
  selectCells,
} from "./decide.js";
