/**
 * MCP サーバ提供形態 (SSOT §5 / 未確定事項 §1: MCP サーバ有力)。
 * 実装は issue #7。ここでは公開 tool 名の定数のみ定義する。
 */

/** MCP が公開する tool 名。 */
export const MCP_TOOLS = {
  /** 要望 -> 候補 DESIGN.md セルの選定。 */
  selectDesign: "select_design",
  /** 選定結果 -> Claude 用プロンプト合成。 */
  composePrompt: "compose_prompt",
} as const;
