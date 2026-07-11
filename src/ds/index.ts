/**
 * Design-Systems 接続 (SSOT §5)。
 * - index.json 取込 (issue #2): 型 / 検証 / 取込クライアント。
 * - DESIGN.md 本文 fetch / 未材化はレンダー委譲 (issue #3)。
 */
export type { DesignIndex, DesignIndexEntry } from "./types.js";
export {
  DS_INDEX_ENV,
  DesignIndexClient,
  type IndexQuery,
  type LoadOptions,
} from "./client.js";
export { DesignIndexError, parseDesignIndex, validateDesignIndex } from "./validate.js";
