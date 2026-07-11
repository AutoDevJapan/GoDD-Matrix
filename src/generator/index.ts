/**
 * Generator レンダー API クライアント (SSOT §4)。
 * Matrix は partial を内包せず、レンダー API を叩くだけ (moat 秘匿)。
 * ここでは共有型を定義し、実装 ({@link ./client}) を再輸出する。
 */
import type { AxisContext } from "../axes/index.js";

/** レンダー API へ渡す入力。軸 context をそのまま用いる。 */
export type RenderRequest = AxisContext;

/**
 * レンダー結果 (DESIGN.md 本文とメタ)。
 * Matrix は moat 秘匿のため本文 (designMarkdown) のみを主に扱い、
 * 付随メタ (document/selection/validation) は不透明値として透過保持する。
 */
export interface RenderResult {
  /** レンダーされた DESIGN.md 本文 (API レスポンス `markdown` のマッピング先)。 */
  designMarkdown: string;
  /** 構造化ドキュメント (API レスポンス `document`)。任意・不透明。 */
  document?: unknown;
  /** セル選定メタ (API レスポンス `selection`)。任意・不透明。 */
  selection?: unknown;
  /** 検証結果メタ (API レスポンス `validation`)。任意・不透明。 */
  validation?: unknown;
}

export {
  GENERATOR_RENDER_API_KEY_ENV,
  GENERATOR_RENDER_URL_ENV,
  GeneratorRenderClient,
  type GeneratorRenderClientOptions,
  GeneratorRenderError,
  type GeneratorRenderErrorKind,
} from "./client.js";
