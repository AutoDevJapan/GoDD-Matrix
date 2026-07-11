/**
 * カラー / ムード軸の slug 決定 (issue #5, SSOT §2)。
 *
 * カラーは PCCS 24 色相 × トーン + 無彩色、ムードは独自定義 (約50) を slug で表す。
 * 本来の定義 (Design-Systems `taxonomy.md`) は未取込のため最小マッピングを内蔵し、
 * 差し替え/拡張できるよう {@link SlugResolver} を interface 化する。
 *
 * slug 体系:
 * - カラー (有彩色): `h{PCCS色相番号}{a|b}-{トーン略号}` 例 `h17b-lt` (色相17b × light)。
 * - カラー (無彩色): `white` / `black` / `gray-{段階}`。
 * - ムード: 意味を表す英小文字 slug 例 `trustworthy` / `minimal`。
 */
import type { ColorKey, MoodKey } from "./index.js";
import { normalizeKey } from "./normalize.js";

/** taxonomy マスタの 1 エントリ。slug が正規キー、aliases が入力の受け口。 */
export interface TaxonomyEntry<Slug extends string> {
  /** 正規 slug (ディレクトリ/index に使う確定キー)。 */
  slug: Slug;
  /** 人間可読ラベル (日本語)。 */
  label: string;
  /** 別名・色名/語 (日英, 表記ゆれ)。完全一致 → 部分一致で拾う。 */
  aliases?: readonly string[];
}

/** 解決の 1 候補。score 降順 → slug 昇順で優先。 */
export interface TaxonomyCandidate<Slug extends string> {
  entry: TaxonomyEntry<Slug>;
  /** 一致の度合い (0 < score <= 1)。完全一致=1。 */
  score: number;
}

/** 解決結果。best は最上位候補 (該当なしなら undefined)。 */
export interface TaxonomyResolution<Slug extends string> {
  query: string;
  best?: TaxonomyCandidate<Slug>;
  candidates: readonly TaxonomyCandidate<Slug>[];
}

/** slug ベース軸 (カラー/ムード) の決定器 interface。 */
export interface SlugResolver<Slug extends string> {
  resolve(query: string): TaxonomyResolution<Slug>;
  get(slug: Slug): TaxonomyEntry<Slug> | undefined;
}

/** 1 エントリに対するクエリの最良一致 (無ければ undefined)。 */
function scoreEntry<Slug extends string>(
  entry: TaxonomyEntry<Slug>,
  q: string,
): TaxonomyCandidate<Slug> | undefined {
  if (normalizeKey(entry.slug) === q) return { entry, score: 1 };
  if (normalizeKey(entry.label) === q) return { entry, score: 0.95 };
  let best = 0;
  for (const alias of entry.aliases ?? []) {
    const a = normalizeKey(alias);
    if (a.length === 0) continue;
    if (a === q) best = Math.max(best, 0.9);
    else if (q.includes(a) || a.includes(q)) best = Math.max(best, 0.6);
  }
  return best > 0 ? { entry, score: best } : undefined;
}

/**
 * 内蔵マスタに対する汎用 slug 決定器 (カラー/ムード共用)。
 * `taxonomy.md` 取込後は entries を差し替えて拡張する。
 */
export class StaticSlugResolver<Slug extends string> implements SlugResolver<Slug> {
  private readonly entries: readonly TaxonomyEntry<Slug>[];
  private readonly bySlug: Map<string, TaxonomyEntry<Slug>>;

  constructor(entries: readonly TaxonomyEntry<Slug>[]) {
    this.entries = entries;
    this.bySlug = new Map(entries.map((e) => [e.slug, e]));
  }

  get(slug: Slug): TaxonomyEntry<Slug> | undefined {
    return this.bySlug.get(slug);
  }

  resolve(query: string): TaxonomyResolution<Slug> {
    const q = normalizeKey(query);
    const candidates: TaxonomyCandidate<Slug>[] = [];
    if (q.length > 0) {
      for (const entry of this.entries) {
        const hit = scoreEntry(entry, q);
        if (hit) candidates.push(hit);
      }
      candidates.sort((a, b) => b.score - a.score || a.entry.slug.localeCompare(b.entry.slug));
    }
    return { query, best: candidates[0], candidates };
  }
}

/** 最小カラー マッピング (拡張前提の暫定シード)。 */
export const MINIMAL_COLORS: readonly TaxonomyEntry<ColorKey>[] = [
  {
    slug: "h17b-lt",
    label: "ライトブルー",
    aliases: ["ライトブルー", "水色", "青", "ブルー", "lightblue", "blue", "sky"],
  },
  { slug: "white", label: "ホワイト", aliases: ["白", "ホワイト", "white", "オフホワイト"] },
  { slug: "black", label: "ブラック", aliases: ["黒", "ブラック", "black"] },
  { slug: "gray-3", label: "グレー", aliases: ["灰", "グレー", "gray", "grey"] },
  {
    slug: "h2v-vv",
    label: "ビビッドレッド",
    aliases: ["赤", "レッド", "red", "vivid-red"],
  },
  {
    slug: "h12s-sf",
    label: "ソフトグリーン",
    aliases: ["緑", "グリーン", "green"],
  },
];

/** 最小ムード マッピング (拡張前提の暫定シード)。 */
export const MINIMAL_MOODS: readonly TaxonomyEntry<MoodKey>[] = [
  {
    slug: "trustworthy",
    label: "信頼",
    aliases: ["信頼", "誠実", "堅実", "trust", "trustworthy", "reliable"],
  },
  {
    slug: "minimal",
    label: "ミニマル",
    aliases: ["ミニマル", "シンプル", "簡潔", "minimal", "simple", "clean"],
  },
  {
    slug: "energetic",
    label: "エネルギッシュ",
    aliases: ["活発", "元気", "躍動", "energetic", "vivid", "dynamic"],
  },
  {
    slug: "elegant",
    label: "エレガント",
    aliases: ["上品", "優雅", "高級", "elegant", "luxury", "refined"],
  },
  {
    slug: "playful",
    label: "遊び心",
    aliases: ["遊び心", "楽しい", "ポップ", "playful", "pop", "fun"],
  },
];

/** カラー軸の既定決定器 (最小マスタ)。 */
export class StaticColorResolver extends StaticSlugResolver<ColorKey> {
  constructor(entries: readonly TaxonomyEntry<ColorKey>[] = MINIMAL_COLORS) {
    super(entries);
  }
}

/** ムード軸の既定決定器 (最小マスタ)。 */
export class StaticMoodResolver extends StaticSlugResolver<MoodKey> {
  constructor(entries: readonly TaxonomyEntry<MoodKey>[] = MINIMAL_MOODS) {
    super(entries);
  }
}
