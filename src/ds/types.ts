/**
 * Design-Systems `index.json` のスキーマ型 (SSOT §2, §5)。
 * 出典: Design-Systems `documents/schema/index.schema.json`。
 * 材化済みセル (design-md/{jsic}/{color}/{mood}/) のメタデータ。
 */
import type { ColorKey, JsicCode, MoodKey } from "../axes/index.js";

/** index.json の 1 エントリ (材化済みセルのメタ)。id で一意。accrete で不変。 */
export interface DesignIndexEntry {
  /** セルの安定 ID。形式 `{jsic}_{color}_{mood}`。 */
  id: string;
  /** リポジトリ相対の DESIGN.md パス (design-md/{jsic}/{color}/{mood}/DESIGN.md)。 */
  path: string;
  /** JSIC 細分類コード (4桁)。 */
  jsic: JsicCode;
  /** カラー軸 slug (有彩色 {hue}-{tone} または無彩色 slug)。 */
  color: ColorKey;
  /** ムード軸 slug。 */
  mood: MoodKey;
  /** タイポ体系・レイアウト原型など、軸に掛けない差別化/検索用タグ。任意。 */
  tags?: readonly string[];
  /** 人間可読の見出し (ブラウズ/SEO 用)。 */
  title: string;
  /** DESIGN.md 本文の内容ハッシュ。形式 `sha256:{64桁hex}`。 */
  hash: string;
  /** 材化 (初回生成) 時刻。ISO 8601 / RFC 3339。 */
  createdAt: string;
  /** 再材化/更新時刻。任意。 */
  updatedAt?: string;
  /** このセルのライセンス識別子 (SPDX)。任意。既定はリポジトリの MIT。 */
  license?: string;
}

/** index.json のエンベロープ。 */
export interface DesignIndex {
  /** スキーマのメジャーバージョン。 */
  version: number;
  /** この index を最後に生成/更新した時刻。任意。 */
  generatedAt?: string;
  /** 材化済みセルのメタデータ。id で一意。 */
  entries: readonly DesignIndexEntry[];
}
