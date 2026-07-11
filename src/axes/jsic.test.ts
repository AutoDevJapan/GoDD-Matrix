import { describe, expect, it } from "vitest";
import { JSIC_CATALOG, type JsicEntry, MINIMAL_JSIC, StaticJsicResolver } from "./jsic.js";

const resolver = new StaticJsicResolver();

describe("StaticJsicResolver", () => {
  it("JSIC コード完全一致は score 1 (code)", () => {
    const r = resolver.resolve("7281");
    expect(r.best?.entry.code).toBe("7281");
    expect(r.best?.score).toBe(1);
    expect(r.best?.matchedBy).toBe("code");
  });

  it("細分類名の完全一致で解決する", () => {
    const r = resolver.resolve("経営コンサルタント業");
    expect(r.best?.entry.code).toBe("7281");
    expect(r.best?.matchedBy).toBe("name");
  });

  it("別名で解決する", () => {
    const r = resolver.resolve("コンサルティング業");
    expect(r.best?.entry.code).toBe("7281");
    expect(r.best?.matchedBy).toBe("alias");
  });

  it("キーワード部分一致で解決する", () => {
    const r = resolver.resolve("経営コンサルの会社");
    expect(r.best?.entry.code).toBe("7281");
  });

  it("英語/口語キーワードで解決する", () => {
    expect(resolver.resolve("SaaS のシステム開発").best?.entry.code).toBe("3911");
    expect(resolver.resolve("cafe").best?.entry.code).toBe("7671");
    expect(resolver.resolve("本屋").best?.entry.code).toBe("6061");
  });

  it("表記ゆれ (全角/大小文字/空白) を吸収する", () => {
    expect(resolver.resolve("  ＣＯＮＳＵＬＴＩＮＧ ").best?.entry.code).toBe("7281");
  });

  it("該当なしは best undefined・候補空", () => {
    const r = resolver.resolve("宇宙旅行代理店");
    expect(r.best).toBeUndefined();
    expect(r.candidates).toHaveLength(0);
  });

  it("空クエリは候補を返さない", () => {
    expect(resolver.resolve("").candidates).toHaveLength(0);
    expect(resolver.resolve("   ").best).toBeUndefined();
  });

  it("候補は score 降順 → code 昇順で安定ソートされる", () => {
    const r = resolver.resolve("デザイン");
    const scores = r.candidates.map((c) => c.score);
    const sorted = [...scores].sort((a, b) => b - a);
    expect(scores).toEqual(sorted);
    expect(r.best?.entry.code).toBe("7261");
  });

  it("get はコードからエントリを引く", () => {
    expect(resolver.get("6061")?.name).toContain("書籍・雑誌小売業");
    expect(resolver.get("0000")).toBeUndefined();
  });

  it("マスタを差し替えて拡張できる", () => {
    const custom: JsicEntry[] = [{ code: "9998", name: "テスト業", keywords: ["てすと"] }];
    const r = new StaticJsicResolver(custom);
    expect(r.resolve("てすと").best?.entry.code).toBe("9998");
    expect(r.resolve("7281").best).toBeUndefined();
  });
});

describe("JSIC_CATALOG (DS jsic.json バンドル)", () => {
  it("DS 由来の全細分類 (1,473 件) を母集合に持つ", () => {
    expect(JSIC_CATALOG.length).toBe(1473);
  });

  it("デモ入力の業種が DS の実コードに解決する (捏造コードを含まない)", () => {
    const cases: Array<[string, string]> = [
      ["経営コンサルタント業", "7281"],
      ["書籍・雑誌小売業", "6061"],
      ["法律事務所", "7211"],
      ["受託開発ソフトウェア業", "3911"],
      ["デザイン業", "7261"],
      ["喫茶店", "7671"],
    ];
    for (const [industry, code] of cases) {
      expect(resolver.resolve(industry).best?.entry.code).toBe(code);
    }
  });

  it("旧・捏造コード (7412 / 5910) はカタログに存在せず解決しない", () => {
    expect(resolver.get("7412")).toBeUndefined();
    expect(resolver.get("5910")).toBeUndefined();
    expect(resolver.resolve("7412").best).toBeUndefined();
  });

  it("curated サブセット (MINIMAL_JSIC) は実コードを含む", () => {
    const codes = MINIMAL_JSIC.map((e) => e.code);
    expect(codes).toContain("7281");
    expect(codes).toContain("6061");
    expect(codes).not.toContain("7412");
  });
});
