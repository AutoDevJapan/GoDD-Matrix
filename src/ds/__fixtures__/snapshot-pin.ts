/**
 * テスト用: 本物の Design-Systems と同じ形 (index / taxonomy / jsic の 3 ファイル) の
 * 最小 snapshot と、それを指す pin を作る。製品コードからは参照しない。
 */
import { createHash } from "node:crypto";
import { type DsSnapshotPin, type PinnedFile, SNAPSHOT_SCHEMA } from "../snapshot.js";

export const FIXTURE_REPOSITORY = "AutoDevJapan/GoDD-Design-Systems";
export const FIXTURE_COMMIT = "7d3ed9a3d171fee1b3f63f62ac73b71e102e8892";
export const FIXTURE_RAW_BASE = `https://raw.githubusercontent.com/${FIXTURE_REPOSITORY}/${FIXTURE_COMMIT}/`;

export function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export function gitBlobSha1(bytes: Uint8Array): string {
  return createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex");
}

export function jsonBytes(value: unknown): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(value));
}

/** 本物の taxonomy.json と同じ形。旧 slug と新 slug が同じ名称を共有する点も本物と同じ。 */
export const SAMPLE_TAXONOMY = {
  version: 1,
  colors: {
    "ac-bk": color("黒", "black", "achromatic", "無彩色系"),
    black: color("黒", "black", "achromatic", "無彩色系"),
    "h17b-lt": color("ライトトーンの青", "light blue", "blue", "青系"),
    "lt-h17": color("ライトトーンの青", "light blue", "blue", "青系"),
    "lt-h18": color("ライトトーンの青", "light blue", "blue", "青系"),
    "v-h02": color("ビビッドトーンの赤", "vivid red", "red", "赤系"),
  },
  moods: {
    elegant: { name_ja: "優雅", name_en: "elegant", axis: "格" },
    luxurious: { name_ja: "高級", name_en: "luxurious", axis: "格" },
    minimal: { name_ja: "ミニマル", name_en: "minimal", axis: "性格" },
    trustworthy: { name_ja: "信頼", name_en: "trustworthy", axis: "情緒" },
  },
} as const;

function color(nameJa: string, nameEn: string, family: string, familyJa: string) {
  return {
    name_ja: nameJa,
    name_en: nameEn,
    family,
    family_ja: familyJa,
    family_en: family,
  };
}

/** 本物の jsic.json と同じ形 (subclass に code / name ほか)。同名の細分類を含む。 */
export const SAMPLE_JSIC = {
  meta: { revision: "第14回改定" },
  subclass: [
    { code: "0100", name: "主として管理事務を行う本社等", major: "A" },
    { code: "1000", name: "主として管理事務を行う本社等", major: "B" },
    { code: "3914", name: "ゲームソフトウェア業", major: "G" },
    { code: "6061", name: "書籍・雑誌小売業（古本を除く）", major: "I" },
    { code: "7281", name: "経営コンサルタント業", major: "L" },
  ],
} as const;

export const SAMPLE_COLOR_COUNT = Object.keys(SAMPLE_TAXONOMY.colors).length;
export const SAMPLE_MOOD_COUNT = Object.keys(SAMPLE_TAXONOMY.moods).length;
export const SAMPLE_SUBCLASS_COUNT = SAMPLE_JSIC.subclass.length;

export const taxonomyBytes = jsonBytes(SAMPLE_TAXONOMY);
export const jsicBytes = jsonBytes(SAMPLE_JSIC);

export function fileIdentity(path: string, bytes: Uint8Array): PinnedFile {
  return { path, bytes: bytes.length, sha256: sha256Hex(bytes), gitBlob: gitBlobSha1(bytes) };
}

export interface PinParts {
  readonly index: Uint8Array;
  readonly entryCount: number;
  readonly taxonomy?: Uint8Array;
  readonly jsic?: Uint8Array;
}

/** 3 ファイルのバイト列から、それらに一致する pin を組み立てる。 */
export function makePin(parts: PinParts): DsSnapshotPin {
  return {
    schema: SNAPSHOT_SCHEMA,
    repository: FIXTURE_REPOSITORY,
    commit: FIXTURE_COMMIT,
    index: { ...fileIdentity("index.json", parts.index), entryCount: parts.entryCount },
    taxonomy: {
      ...fileIdentity("taxonomy.json", parts.taxonomy ?? taxonomyBytes),
      colorCount: SAMPLE_COLOR_COUNT,
      moodCount: SAMPLE_MOOD_COUNT,
    },
    jsic: {
      ...fileIdentity("jsic.json", parts.jsic ?? jsicBytes),
      subclassCount: SAMPLE_SUBCLASS_COUNT,
    },
  };
}
