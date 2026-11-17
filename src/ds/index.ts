/**
 * Design-Systems 接続 (SSOT §5)。
 * - index.json 取込 (issue #2): 型 / 検証 / 取込クライアント。
 * - DESIGN.md 本文 fetch / 未材化はレンダー委譲 (issue #3)。
 */
export type { DesignIndex, DesignIndexEntry } from "./types.js";
export {
  type DsAxisCatalogs,
  type DsTaxonomy,
  type DsTaxonomyColor,
  type DsTaxonomyMood,
  type LoadCatalogsOptions,
  loadPinnedCatalogs,
  parseDsJsic,
  parseDsTaxonomy,
  toAxisResolvers,
} from "./catalogs.js";
export {
  DS_INDEX_ENV,
  DesignIndexClient,
  type IndexQuery,
  type LoadOptions,
} from "./client.js";
export {
  DesignBodyClient,
  type DesignBodyOptions,
  type DesignDocument,
  type DesignRenderer,
  DesignResolver,
  type DesignResolution,
  MAX_DESIGN_BODY_BYTES,
  resolveDesignLocation,
  verifyDesignHash,
} from "./design.js";
export {
  DEFAULT_MAX_BYTES,
  type FetchBytesOptions,
  type FetchTextOptions,
  fetchBytes,
  fetchText,
  isHttpUrl,
} from "./fetch.js";
export {
  type DsSnapshotPin,
  MAX_CATALOG_BYTES,
  MAX_INDEX_BYTES,
  parseDsSnapshotPin,
  type PinnedFile,
  SNAPSHOT_SCHEMA,
  type SnapshotProvenance,
  snapshotFileUrl,
  snapshotIndexUrl,
  snapshotProvenance,
  snapshotRawBase,
  validateDsSnapshotPin,
  verifyIndexBytes,
  verifyIndexEntryCount,
  verifyPinnedFileBytes,
} from "./snapshot.js";
export { DesignIndexError, parseDesignIndex, validateDesignIndex } from "./validate.js";
