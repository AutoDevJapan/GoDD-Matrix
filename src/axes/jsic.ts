/**
 * 業種 → JSIC 細分類コードの決定 (issue #5, SSOT §2)。
 *
 * 入力が業種名 / キーワード / コードいずれの場合も解決できるようにする。
 * 本来の JSIC マスタ (Design-Systems `jsic.json`, 1,473 細分類) は未取込のため、
 * ここでは最小マッピングを内蔵しつつ、差し替え/拡張できるよう {@link JsicResolver}
 * を interface 化する。`jsic.json` 取込後は同 interface の別実装に置換すればよい。
 */
import type { JsicCode } from "./index.js";
import { normalizeKey } from "./normalize.js";

/** JSIC 細分類マスタの 1 エントリ (最小; 将来 `jsic.json` に置換)。 */
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
 * 内蔵マスタ (最小) に対する JSIC 決定器。
 * 既定は {@link MINIMAL_JSIC}。`jsic.json` 取込後は entries を差し替えて使う。
 */
export class StaticJsicResolver implements JsicResolver {
  private readonly entries: readonly JsicEntry[];
  private readonly byCode: Map<string, JsicEntry>;

  constructor(entries: readonly JsicEntry[] = MINIMAL_JSIC) {
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
 * 最小 JSIC マッピング (拡張前提の暫定シード)。
 * fixture (7412 / 5910) を含む代表的な細分類のみ。差し替え/追加で拡張する。
 */
export const MINIMAL_JSIC: readonly JsicEntry[] = [
  {
    code: "7412",
    name: "経営コンサルタント業",
    aliases: ["経営コンサルティング業", "コンサルティング業"],
    keywords: ["コンサル", "コンサルティング", "経営", "consulting"],
  },
  {
    code: "5910",
    name: "書籍・雑誌小売業",
    aliases: ["書店"],
    keywords: ["本屋", "書店", "書籍", "雑誌", "bookstore"],
  },
  {
    code: "7211",
    name: "法律事務所",
    aliases: ["弁護士事務所"],
    keywords: ["弁護士", "法律", "law", "legal"],
  },
  {
    code: "3971",
    name: "受託開発ソフトウェア業",
    aliases: ["ソフトウェア開発業", "システム開発業"],
    keywords: ["ソフトウェア", "システム開発", "受託開発", "software", "saas"],
  },
  {
    code: "7521",
    name: "デザイン業",
    aliases: ["デザイン事務所"],
    keywords: ["デザイン", "design", "クリエイティブ"],
  },
  {
    code: "7681",
    name: "喫茶店",
    aliases: ["カフェ"],
    keywords: ["カフェ", "喫茶", "coffee", "cafe"],
  },
];
