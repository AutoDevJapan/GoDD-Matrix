/**
 * 業種 → JSIC 細分類コードの決定 (issue #5 / #18, SSOT §2)。
 *
 * 入力が業種名 / キーワード / コードいずれの場合も解決できるようにする。
 * 母集合は Design-Systems の `jsic.json` (第14回改定, 全 1,473 細分類) を
 * ビルド時にバンドルした {@link JSIC_SUBCLASSES} を source-of-truth とし、
 * ここに存在するコードのみを返す (捏造コード禁止, issue #18)。
 * 代表的な業種には別名・キーワードの overlay ({@link JSIC_OVERLAY}) を付与し、
 * 表記ゆれや口語 (「経営コンサル」「本屋」「SaaS」等) を実在コードへ寄せる。
 * カタログは `scripts/gen-jsic-catalog.mjs` で DS から再生成できる。
 */
import type { JsicCode } from "./index.js";
import { JSIC_SUBCLASSES } from "./jsic-catalog.js";
import { normalizeKey } from "./normalize.js";

/** JSIC 細分類マスタの 1 エントリ。 */
export interface JsicEntry {
  /** JSIC 細分類コード (4桁)。 */
  code: JsicCode;
  /** 細分類名称。 */
  name: string;
  /** 別名・表記ゆれ (完全一致で拾う)。 */
  aliases?: readonly string[];
  /** 業種を示すキーワード (部分一致で拾う)。 */
  keywords?: readonly string[];
}

/** 一致方法。説明/デバッグ用。score 算出の根拠。 */
export type JsicMatchKind = "code" | "name" | "alias" | "keyword";

/** JSIC 解決の 1 候補。score 降順 → code 昇順で優先。 */
export interface JsicCandidate {
  entry: JsicEntry;
  /** 一致の度合い (0 < score <= 1)。完全一致=1。 */
  score: number;
  matchedBy: JsicMatchKind;
}

/** JSIC 解決結果。best は最上位候補 (該当なしなら undefined)。 */
export interface JsicResolution {
  /** 正規化前のクエリ。 */
  query: string;
  best?: JsicCandidate;
  candidates: readonly JsicCandidate[];
}

/** 業種名 / キーワード / コード → JSIC 細分類コードの決定器。 */
export interface JsicResolver {
  /** クエリ文字列から候補を解決する。 */
  resolve(query: string): JsicResolution;
  /** コードから直接エントリを引く。 */
  get(code: JsicCode): JsicEntry | undefined;
}

/** 一致方法ごとの基準スコア (完全一致を優先)。 */
const SCORE: Record<JsicMatchKind, number> = {
  code: 1,
  name: 0.9,
  alias: 0.85,
  keyword: 0.6,
};

/** 1 エントリに対するクエリの最良一致を求める (無ければ undefined)。 */
function scoreEntry(entry: JsicEntry, q: string): JsicCandidate | undefined {
  if (normalizeKey(entry.code) === q) {
    return { entry, score: SCORE.code, matchedBy: "code" };
  }
  const name = normalizeKey(entry.name);
  if (name === q) return { entry, score: SCORE.name, matchedBy: "name" };
  for (const alias of entry.aliases ?? []) {
    if (normalizeKey(alias) === q) return { entry, score: SCORE.alias, matchedBy: "alias" };
  }
  // 部分一致: 名称の双方向 substring は名称一致に次ぐ確度。
  if (name.includes(q) || q.includes(name)) {
    return { entry, score: SCORE.name * 0.8, matchedBy: "name" };
  }
  for (const keyword of entry.keywords ?? []) {
    const k = normalizeKey(keyword);
    if (k.length > 0 && (q.includes(k) || k.includes(q))) {
      return { entry, score: SCORE.keyword, matchedBy: "keyword" };
    }
  }
  return undefined;
}

/**
 * 内蔵マスタに対する JSIC 決定器。
 * 既定の母集合は DS 由来の全 1,473 細分類 ({@link JSIC_CATALOG})。
 * 差し替え/絞り込みのため entries を注入できる。
 */
export class StaticJsicResolver implements JsicResolver {
  private readonly entries: readonly JsicEntry[];
  private readonly byCode: Map<string, JsicEntry>;

  constructor(entries: readonly JsicEntry[] = JSIC_CATALOG) {
    this.entries = entries;
    this.byCode = new Map(entries.map((e) => [e.code, e]));
  }

  get(code: JsicCode): JsicEntry | undefined {
    return this.byCode.get(code);
  }

  resolve(query: string): JsicResolution {
    const q = normalizeKey(query);
    const candidates: JsicCandidate[] = [];
    if (q.length > 0) {
      for (const entry of this.entries) {
        const hit = scoreEntry(entry, q);
        if (hit) candidates.push(hit);
      }
      candidates.sort((a, b) => b.score - a.score || a.entry.code.localeCompare(b.entry.code));
    }
    return { query, best: candidates[0], candidates };
  }
}

/**
 * 代表的な業種の別名・キーワード overlay (実在コード → 表記ゆれ)。
 * キーは {@link JSIC_SUBCLASSES} に存在する実コードのみ (捏造禁止)。
 * 口語・英語・略称を実コードへ寄せ、`select_cells` のデモ入力を安定解決する。
 */
export const JSIC_OVERLAY: Readonly<
  Record<string, { aliases?: readonly string[]; keywords?: readonly string[] }>
> = {
  // 経営コンサルタント業
  "7281": {
    aliases: ["経営コンサルティング業", "コンサルティング業"],
    keywords: ["経営コンサル", "コンサル", "コンサルティング", "consulting"],
  },
  // 書籍・雑誌小売業（古本を除く）
  "6061": {
    aliases: ["書店", "書籍・雑誌小売業"],
    keywords: ["本屋", "書店", "書籍", "雑誌", "bookstore"],
  },
  // 法律事務所
  "7211": {
    aliases: ["弁護士事務所"],
    keywords: ["弁護士", "法律", "law", "legal"],
  },
  // 受託開発ソフトウェア業
  "3911": {
    aliases: ["ソフトウェア開発業", "システム開発業"],
    keywords: ["ソフトウェア", "システム開発", "受託開発", "software", "saas"],
  },
  // デザイン業
  "7261": {
    aliases: ["デザイン事務所", "デザイン"],
    keywords: ["design", "クリエイティブ"],
  },
  // 喫茶店
  "7671": {
    aliases: ["カフェ"],
    keywords: ["カフェ", "喫茶", "coffee", "cafe"],
  },
};

/** DS 細分類 + overlay をマージして {@link JsicEntry} 群を構築する。 */
function buildCatalog(): readonly JsicEntry[] {
  return JSIC_SUBCLASSES.map((s) => {
    const overlay = JSIC_OVERLAY[s.code];
    return {
      code: s.code,
      name: s.name,
      ...(overlay?.aliases ? { aliases: overlay.aliases } : {}),
      ...(overlay?.keywords ? { keywords: overlay.keywords } : {}),
    };
  });
}

/**
 * 既定の JSIC 母集合 (DS 由来の全細分類 + overlay)。
 * `resolve` の探索対象であり、ここに存在するコードのみ返す。
 */
export const JSIC_CATALOG: readonly JsicEntry[] = buildCatalog();

/**
 * 代表的な業種の curated サブセット ({@link JSIC_CATALOG} のうち overlay 付きのもの)。
 * デモ/テスト用途の便宜的な小集合。実コード (経営コンサル=7281 / 書籍雑誌=6061 ほか) を保持する。
 */
export const MINIMAL_JSIC: readonly JsicEntry[] = JSIC_CATALOG.filter((e) =>
  Object.hasOwn(JSIC_OVERLAY, e.code),
);
