/**
 * Design-Systems 接続 (SSOT §5)。
 * - index.json 取込 (issue #2)
 * - DESIGN.md 本文 fetch / 未材化はレンダー委譲 (issue #3)
 * ここでは共有型のみ定義する。
 */
import type { ColorKey, JsicCode, MoodKey } from "../axes/index.js";

/** index.json の 1 エントリ (材化済みセルのメタ)。 */
export interface DesignIndexEntry {
  jsic: JsicCode;
  color: ColorKey;
  mood: MoodKey;
  /** Design-Systems リポジトリ内の DESIGN.md 相対パス。 */
  path: string;
  tags: readonly string[];
}
