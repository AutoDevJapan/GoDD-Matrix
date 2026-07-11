/**
 * Generator レンダー API クライアント (SSOT §4)。
 * Matrix は partial を内包せず、レンダー API を叩くだけ (moat 秘匿)。
 * 実装は issue #4。ここでは共有型のみ定義する。
 */
import type { AxisContext } from "../axes/index.js";

/** レンダー API へ渡す入力。軸 context をそのまま用いる。 */
export type RenderRequest = AxisContext;

/** レンダー結果 (DESIGN.md 本文とメタ)。 */
export interface RenderResult {
  designMarkdown: string;
}
