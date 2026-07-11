import { describe, expect, it } from "vitest";
import { type JsicEntry, MINIMAL_JSIC, StaticJsicResolver } from "./jsic.js";

const resolver = new StaticJsicResolver();

describe("StaticJsicResolver", () => {
  it("JSIC コード完全一致は score 1 (code)", () => {
    const r = resolver.resolve("7412");
    expect(r.best?.entry.code).toBe("7412");
    expect(r.best?.score).toBe(1);
    expect(r.best?.matchedBy).toBe("code");
  });

  it("細分類名の完全一致で解決する", () => {
    const r = resolver.resolve("経営コンサルタント業");
    expect(r.best?.entry.code).toBe("7412");
    expect(r.best?.matchedBy).toBe("name");
  });

  it("別名で解決する", () => {
    const r = resolver.resolve("コンサルティング業");
    expect(r.best?.entry.code).toBe("7412");
    expect(r.best?.matchedBy).toBe("alias");
  });

  it("キーワード部分一致で解決する", () => {
    const r = resolver.resolve("経営コンサルの会社");
    expect(r.best?.entry.code).toBe("7412");
  });

  it("英語キーワードで解決する", () => {
    expect(resolver.resolve("SaaS のシステム開発").best?.entry.code).toBe("3971");
    expect(resolver.resolve("cafe").best?.entry.code).toBe("7681");
  });

  it("表記ゆれ (全角/大小文字/空白) を吸収する", () => {
    expect(resolver.resolve("  ＣＯＮＳＵＬＴＩＮＧ ").best?.entry.code).toBe("7412");
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
    expect(r.best?.entry.code).toBe("7521");
  });

  it("get はコードからエントリを引く", () => {
    expect(resolver.get("5910")?.name).toBe("書籍・雑誌小売業");
    expect(resolver.get("0000")).toBeUndefined();
  });

  it("マスタを差し替えて拡張できる", () => {
    const custom: JsicEntry[] = [{ code: "9999", name: "テスト業", keywords: ["てすと"] }];
    const r = new StaticJsicResolver(custom);
    expect(r.resolve("てすと").best?.entry.code).toBe("9999");
    expect(r.resolve("7412").best).toBeUndefined();
  });

  it("内蔵シードは fixture の JSIC を含む", () => {
    const codes = MINIMAL_JSIC.map((e) => e.code);
    expect(codes).toContain("7412");
    expect(codes).toContain("5910");
  });
});
