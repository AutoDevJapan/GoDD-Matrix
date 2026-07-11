/**
 * Claude 用プロンプト合成 (SSOT §6-3, §10)。
 * 確定 DESIGN.md 全文をシステムプロンプト断片へ合成する。
 * 実装は issue #6。ここでは共有型のみ定義する。
 */

/** Claude へ注入するプロンプト断片。 */
export interface ComposedPrompt {
  /** services/ai の注入点に載せるシステムプロンプト文字列。 */
  systemPrompt: string;
}
