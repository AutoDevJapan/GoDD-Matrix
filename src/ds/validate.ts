/**
 * `index.json` の構造検証 (Design-Systems index.schema.json 準拠)。
 * 外部依存を持たない手書きバリデータ。不正時は DesignIndexError を投げる。
 */
import type { DesignIndex, DesignIndexEntry } from "./types.js";

/** index の取込・検証失敗を表すエラー。 */
export class DesignIndexError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DesignIndexError";
  }
}

const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const JSIC = /^[0-9]{4}$/;
const ID = /^[0-9]{4}_[a-z0-9]+(-[a-z0-9]+)*_[a-z0-9]+(-[a-z0-9]+)*(_v[1-9][0-9]*)?$/;
const ENTRY_PATH =
  /^design-md\/[0-9]{4}\/[a-z0-9]+(-[a-z0-9]+)*\/[a-z0-9]+(-[a-z0-9]+)*(\/v[1-9][0-9]*)?\/DESIGN\.md$/;
const HASH = /^sha256:[0-9a-f]{64}$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireString(
  obj: Record<string, unknown>,
  key: string,
  where: string,
  pattern?: RegExp,
): string {
  const value = obj[key];
  if (typeof value !== "string") {
    throw new DesignIndexError(`${where}: "${key}" は文字列である必要があります`);
  }
  if (pattern && !pattern.test(value)) {
    throw new DesignIndexError(
      `${where}: "${key}" が不正な形式です (値: ${JSON.stringify(value)})`,
    );
  }
  return value;
}

function optionalString(
  obj: Record<string, unknown>,
  key: string,
  where: string,
): string | undefined {
  const value = obj[key];
  if (value === undefined) return undefined;
  if (typeof value !== "string") {
    throw new DesignIndexError(`${where}: "${key}" は文字列である必要があります`);
  }
  return value;
}

function optionalInteger(
  obj: Record<string, unknown>,
  key: string,
  where: string,
): number | undefined {
  const value = obj[key];
  if (value === undefined) return undefined;
  if (typeof value !== "number" || !Number.isInteger(value)) {
    throw new DesignIndexError(`${where}: "${key}" は整数である必要があります`);
  }
  return value;
}

function validateEntry(raw: unknown, where: string): DesignIndexEntry {
  if (!isRecord(raw)) {
    throw new DesignIndexError(`${where}: エントリはオブジェクトである必要があります`);
  }

  const entry: DesignIndexEntry = {
    id: requireString(raw, "id", where, ID),
    path: requireString(raw, "path", where, ENTRY_PATH),
    jsic: requireString(raw, "jsic", where, JSIC),
    color: requireString(raw, "color", where, SLUG),
    mood: requireString(raw, "mood", where, SLUG),
    variant: optionalInteger(raw, "variant", where) ?? 0,
    title: requireString(raw, "title", where),
    hash: requireString(raw, "hash", where, HASH),
    createdAt: requireString(raw, "createdAt", where),
  };

  if (raw.tags !== undefined) {
    if (!Array.isArray(raw.tags)) {
      throw new DesignIndexError(`${where}: "tags" は配列である必要があります`);
    }
    const tags = raw.tags.map((tag, i) => {
      if (typeof tag !== "string" || !SLUG.test(tag)) {
        throw new DesignIndexError(`${where}: tags[${i}] が不正な slug です`);
      }
      return tag;
    });
    entry.tags = tags;
  }

  const updatedAt = optionalString(raw, "updatedAt", where);
  if (updatedAt !== undefined) entry.updatedAt = updatedAt;

  const license = optionalString(raw, "license", where);
  if (license !== undefined) entry.license = license;

  return entry;
}

/**
 * 未検証の値を検証済み DesignIndex に変換する。
 * @throws DesignIndexError 構造/形式が不正な場合。
 */
export function validateDesignIndex(raw: unknown): DesignIndex {
  if (!isRecord(raw)) {
    throw new DesignIndexError("index はオブジェクトである必要があります");
  }
  if (typeof raw.version !== "number" || !Number.isInteger(raw.version) || raw.version < 1) {
    throw new DesignIndexError('"version" は 1 以上の整数である必要があります');
  }
  if (!Array.isArray(raw.entries)) {
    throw new DesignIndexError('"entries" は配列である必要があります');
  }

  const entries = raw.entries.map((entry, i) => validateEntry(entry, `entries[${i}]`));

  const seenIds = new Set<string>();
  const seenPaths = new Set<string>();
  for (const entry of entries) {
    if (seenIds.has(entry.id)) {
      throw new DesignIndexError(`重複した entry id です: ${entry.id}`);
    }
    if (seenPaths.has(entry.path)) {
      throw new DesignIndexError(`重複した entry path です: ${entry.path}`);
    }
    seenIds.add(entry.id);
    seenPaths.add(entry.path);
  }

  const index: DesignIndex = { version: raw.version, entries };
  if (raw.generatedAt !== undefined) {
    if (typeof raw.generatedAt !== "string") {
      throw new DesignIndexError('"generatedAt" は文字列である必要があります');
    }
    index.generatedAt = raw.generatedAt;
  }
  return index;
}

/**
 * JSON 文字列をパースして検証済み DesignIndex を返す。
 * @throws DesignIndexError JSON パース失敗または構造不正の場合。
 */
export function parseDesignIndex(text: string): DesignIndex {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (cause) {
    throw new DesignIndexError(
      `index.json の JSON パースに失敗しました: ${(cause as Error).message}`,
    );
  }
  return validateDesignIndex(raw);
}
