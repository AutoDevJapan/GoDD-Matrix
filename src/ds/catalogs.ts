/**
 * Design-Systems の語彙ファイル (`taxonomy.json` / `jsic.json`) の読み取りと、
 * それを母集合にした軸 (業種 / カラー / ムード) の resolver の構築。
 *
 * 正式配布では、軸の語彙も index・本文と同じ snapshot (pin) に束縛する。pin に照合できた
 * バイトだけを解釈し、件数 (色数 / ムード数 / 細分類数) も pin と一致して初めて使う。
 * これにより、MCP が引ける軸の値は、index が持つ実カタログと同じ commit のものになる。
 *
 * 同じ名称を複数のエントリが共有する場合 (旧 slug と新 slug、同名の細分類) は、曖昧な入力で
 * 任意の 1 件を選ばず、候補を返して選ばせる ({@link ResolveOptions.rejectTies})。
 */
import type { AxisResolvers } from "../axes/decide.js";
import type { JsicSubclass } from "../axes/jsic-catalog.js";
import { StaticJsicResolver, buildJsicCatalog } from "../axes/jsic.js";
import { StaticSlugResolver, type TaxonomyEntry } from "../axes/taxonomy.js";
import { type FetchTextOptions, fetchBytes } from "./fetch.js";
import { type DsSnapshotPin, snapshotFileUrl, verifyPinnedFileBytes } from "./snapshot.js";
import { DesignIndexError } from "./validate.js";

/** taxonomy のカラー 1 件。 */
export interface DsTaxonomyColor {
  readonly slug: string;
  readonly nameJa: string;
  readonly nameEn: string;
  readonly family: string;
  readonly familyJa: string;
  readonly familyEn: string;
}

/** taxonomy のムード 1 件。 */
export interface DsTaxonomyMood {
  readonly slug: string;
  readonly nameJa: string;
  readonly nameEn: string;
  readonly axis: string;
}

/** taxonomy.json の全件。 */
export interface DsTaxonomy {
  readonly colors: readonly DsTaxonomyColor[];
  readonly moods: readonly DsTaxonomyMood[];
}

/** pin に束縛された軸の語彙 (taxonomy + JSIC 細分類)。 */
export interface DsAxisCatalogs {
  readonly taxonomy: DsTaxonomy;
  readonly jsic: readonly JsicSubclass[];
}

const SLUG = /^[a-z0-9][a-z0-9-]{0,63}$/;
const JSIC_CODE = /^[0-9]{4}$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseJson(text: string, label: string): unknown {
  try {
    return JSON.parse(text);
  } catch (cause) {
    throw new DesignIndexError(
      `${label} の JSON パースに失敗しました: ${(cause as Error).message}`,
    );
  }
}

function requireName(obj: Record<string, unknown>, key: string, where: string): string {
  const value = obj[key];
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new DesignIndexError(`${where}: "${key}" は空でない文字列である必要があります`);
  }
  return value;
}

/** slug をキーにした項目の map を、(slug, 項目) の配列として検証しつつ取り出す。 */
function readSlugRecords(
  raw: Record<string, unknown>,
  key: "colors" | "moods",
): Array<[string, Record<string, unknown>]> {
  const map = raw[key];
  if (!isRecord(map) || Object.keys(map).length === 0) {
    throw new DesignIndexError(`taxonomy: "${key}" は空でないオブジェクトである必要があります`);
  }
  return Object.entries(map).map(([slug, item]) => {
    if (!SLUG.test(slug)) {
      throw new DesignIndexError(`taxonomy.${key}: slug "${slug}" の形式が不正です`);
    }
    if (!isRecord(item)) {
      throw new DesignIndexError(`taxonomy.${key}.${slug}: オブジェクトである必要があります`);
    }
    return [slug, item];
  });
}

/**
 * `taxonomy.json` の本文を検証して読み取る。必要な項目が無い / 空の項目は拒否する。
 * @throws DesignIndexError JSON として不正、または構造が不正な場合。
 */
export function parseDsTaxonomy(text: string): DsTaxonomy {
  const raw = parseJson(text, "taxonomy");
  if (!isRecord(raw)) throw new DesignIndexError("taxonomy: オブジェクトである必要があります");
  if (raw.version !== 1)
    throw new DesignIndexError('taxonomy: "version" は 1 である必要があります');
  const colors = readSlugRecords(raw, "colors").map(([slug, item]): DsTaxonomyColor => {
    const where = `taxonomy.colors.${slug}`;
    return {
      slug,
      nameJa: requireName(item, "name_ja", where),
      nameEn: requireName(item, "name_en", where),
      family: requireName(item, "family", where),
      familyJa: requireName(item, "family_ja", where),
      familyEn: requireName(item, "family_en", where),
    };
  });
  const moods = readSlugRecords(raw, "moods").map(([slug, item]): DsTaxonomyMood => {
    const where = `taxonomy.moods.${slug}`;
    return {
      slug,
      nameJa: requireName(item, "name_ja", where),
      nameEn: requireName(item, "name_en", where),
      axis: requireName(item, "axis", where),
    };
  });
  return { colors, moods };
}

/**
 * `jsic.json` の本文から細分類 (4 桁コードと名称) を検証して読み取る。他のキーは無視する。
 * @throws DesignIndexError JSON として不正、または細分類が不正 / 重複の場合。
 */
export function parseDsJsic(text: string): readonly JsicSubclass[] {
  const raw = parseJson(text, "jsic");
  if (!isRecord(raw)) throw new DesignIndexError("jsic: オブジェクトである必要があります");
  const list = raw.subclass;
  if (!Array.isArray(list) || list.length === 0) {
    throw new DesignIndexError('jsic: "subclass" は空でない配列である必要があります');
  }
  const seen = new Set<string>();
  return list.map((item, i): JsicSubclass => {
    const where = `jsic.subclass[${i}]`;
    if (!isRecord(item)) throw new DesignIndexError(`${where}: オブジェクトである必要があります`);
    const code = item.code;
    if (typeof code !== "string" || !JSIC_CODE.test(code)) {
      throw new DesignIndexError(`${where}: "code" は 4 桁の数字である必要があります`);
    }
    if (seen.has(code)) throw new DesignIndexError(`${where}: code "${code}" が重複しています`);
    seen.add(code);
    return { code, name: requireName(item, "name", where) };
  });
}

function decodeUtf8(bytes: Uint8Array, label: string): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new DesignIndexError(`${label} が UTF-8 として不正です`);
  }
}

function requireCount(actual: number, expected: number, field: string): void {
  if (actual !== expected) {
    throw new DesignIndexError(`${field} が pin と一致しません (実測 ${actual} / pin ${expected})`);
  }
}

/** {@link loadPinnedCatalogs} の取得元。省略時は pin の commit に固定した raw URL。 */
export interface LoadCatalogsOptions extends FetchTextOptions {
  /** taxonomy.json の取得元 (ローカルパス / file: / http(s) URL)。正式配布の同梱ファイル用。 */
  taxonomySource?: string;
  /** jsic.json の取得元 (ローカルパス / file: / http(s) URL)。正式配布の同梱ファイル用。 */
  jsicSource?: string;
}

/**
 * pin に束縛された軸の語彙 (taxonomy + JSIC 細分類) を取り込む。
 * 取得したバイトを pin (bytes / sha256 / git blob) に照合してから解釈し、
 * 色数 / ムード数 / 細分類数も pin と一致して初めて返す。
 * @throws DesignIndexError 取得失敗、バイト不一致、構造不正、件数不一致のいずれか。
 */
export async function loadPinnedCatalogs(
  pin: DsSnapshotPin,
  opts: LoadCatalogsOptions = {},
): Promise<DsAxisCatalogs> {
  const { taxonomySource, jsicSource, ...fetchOptions } = opts;
  const [taxonomyBytes, jsicBytes] = await Promise.all([
    fetchBytes(taxonomySource ?? snapshotFileUrl(pin, pin.taxonomy), {
      ...fetchOptions,
      maxBytes: pin.taxonomy.bytes,
    }),
    fetchBytes(jsicSource ?? snapshotFileUrl(pin, pin.jsic), {
      ...fetchOptions,
      maxBytes: pin.jsic.bytes,
    }),
  ]);
  verifyPinnedFileBytes(taxonomyBytes, pin.taxonomy, "taxonomy");
  verifyPinnedFileBytes(jsicBytes, pin.jsic, "jsic");
  const taxonomy = parseDsTaxonomy(decodeUtf8(taxonomyBytes, "taxonomy"));
  const jsic = parseDsJsic(decodeUtf8(jsicBytes, "jsic"));
  requireCount(taxonomy.colors.length, pin.taxonomy.colorCount, "taxonomy の色数 (colorCount)");
  requireCount(taxonomy.moods.length, pin.taxonomy.moodCount, "taxonomy のムード数 (moodCount)");
  requireCount(jsic.length, pin.jsic.subclassCount, "jsic の細分類数 (subclassCount)");
  return { taxonomy, jsic };
}

function toEntry(item: { slug: string; nameJa: string; nameEn: string }): TaxonomyEntry<string> {
  return {
    slug: item.slug,
    label: item.nameJa,
    // 日英の名称を完全一致・部分一致の入口にする (別名の発明はしない)。
    aliases: [...new Set([item.nameJa, item.nameEn])],
  };
}

/**
 * 取り込んだ語彙を母集合にした軸 resolver を作る。
 * - カラー / ムード: taxonomy の全 slug と日英の名称。
 * - 業種: jsic の全細分類 + 既存の別名 overlay (実在コードのみ)。
 * 同点首位は確定しない ({@link ResolveOptions.rejectTies})。slug / コードの完全一致は常に確定する。
 */
export function toAxisResolvers(catalogs: DsAxisCatalogs): Required<AxisResolvers> {
  const options = { rejectTies: true } as const;
  return {
    jsic: new StaticJsicResolver(buildJsicCatalog(catalogs.jsic), options),
    color: new StaticSlugResolver(catalogs.taxonomy.colors.map(toEntry), options),
    mood: new StaticSlugResolver(catalogs.taxonomy.moods.map(toEntry), options),
  };
}
