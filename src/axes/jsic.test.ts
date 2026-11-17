import { describe, expect, it } from "vitest";
import {
  JSIC_CATALOG,
  JSIC_OVERLAY,
  type JsicEntry,
  MINIMAL_JSIC,
  StaticJsicResolver,
  buildJsicCatalog,
} from "./jsic.js";

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

describe("buildJsicCatalog (snapshot の細分類 + 既存 overlay)", () => {
  const subclasses = [
    { code: "7281", name: "経営コンサルタント業" },
    { code: "0100", name: "主として管理事務を行う本社等" },
    { code: "1000", name: "主として管理事務を行う本社等" },
  ];

  it("渡した細分類だけを母集合にし、実在コードの overlay だけを付ける", () => {
    const catalog = buildJsicCatalog(subclasses);
    expect(catalog.map((e) => e.code)).toEqual(["7281", "0100", "1000"]);
    expect(catalog[0]?.keywords).toEqual(JSIC_OVERLAY["7281"]?.keywords);
    expect(catalog[1]?.aliases).toBeUndefined();
    expect(catalog.some((e) => e.code === "7211")).toBe(false);
  });

  it("同梱カタログは、同梱の細分類を渡した結果と一致する", () => {
    expect(buildJsicCatalog(JSIC_CATALOG.map((e) => ({ code: e.code, name: e.name })))).toEqual(
      JSIC_CATALOG,
    );
  });
});

describe("StaticJsicResolver: 同点首位の扱い", () => {
  const entries = buildJsicCatalog([
    { code: "0100", name: "主として管理事務を行う本社等" },
    { code: "1000", name: "主として管理事務を行う本社等" },
    { code: "7281", name: "経営コンサルタント業" },
  ]);

  it("既定は同点なら code 昇順の先頭を best にする (従来どおり)", () => {
    expect(
      new StaticJsicResolver(entries).resolve("主として管理事務を行う本社等").best?.entry.code,
    ).toBe("0100");
  });

  it("rejectTies では同名の細分類を確定せず、候補は全て返す", () => {
    const r = new StaticJsicResolver(entries, { rejectTies: true }).resolve(
      "主として管理事務を行う本社等",
    );
    expect(r.best).toBeUndefined();
    expect(r.candidates.map((c) => c.entry.code)).toEqual(["0100", "1000"]);
  });

  it("rejectTies でも、コードの完全一致や一意な名称は確定する", () => {
    const resolver = new StaticJsicResolver(entries, { rejectTies: true });
    expect(resolver.resolve("1000").best?.entry.code).toBe("1000");
    expect(resolver.resolve("経営コンサルタント業").best?.entry.code).toBe("7281");
  });
});
