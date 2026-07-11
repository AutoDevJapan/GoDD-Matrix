/**
 * Claude 用プロンプト合成 (issue #6, SSOT §6/§10)。
 * 確定 DESIGN.md 全文と確定軸・要望を Claude 用プロンプト (system / user) へ合成する。
 */
export {
  type ComposedPrompt,
  type PromptProvenance,
  synthesizePrompt,
} from "./synthesize.js";
