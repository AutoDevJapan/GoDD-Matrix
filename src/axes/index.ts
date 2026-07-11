/**
 * 軸 (SSOT §2): 業種 (JSIC 細分類) × カラー (PCCS + 無彩色) × ムード。
 * 実際の決定ロジックは issue #5 で実装する。ここでは共有型のみ定義する。
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
