import { describe, expect, it } from "vitest";
import { formatThirdPartyLicenses, packageRootsFromInputs } from "./licenses.js";

describe("packageRootsFromInputs (esbuild の入力一覧から、同梱した依存の root を求める)", () => {
  it("pnpm 配置の scoped / unscoped を、パッケージの root に畳む", () => {
    const roots = packageRootsFromInputs([
      "node_modules/.pnpm/@modelcontextprotocol+sdk@1.29.0_zod@4.4.3/node_modules/@modelcontextprotocol/sdk/dist/esm/server/mcp.js",
      "node_modules/.pnpm/@modelcontextprotocol+sdk@1.29.0_zod@4.4.3/node_modules/@modelcontextprotocol/sdk/dist/esm/types.js",
      "node_modules/.pnpm/zod@4.4.3/node_modules/zod/v4/core/index.js",
    ]);
    expect(roots).toEqual([
      "node_modules/.pnpm/@modelcontextprotocol+sdk@1.29.0_zod@4.4.3/node_modules/@modelcontextprotocol/sdk",
      "node_modules/.pnpm/zod@4.4.3/node_modules/zod",
    ]);
  });

  it("通常配置と入れ子の node_modules は、最後の node_modules の直下を root にする", () => {
    expect(
      packageRootsFromInputs([
        "node_modules/ajv/lib/ajv.js",
        "node_modules/a/node_modules/b/index.js",
        "node_modules/@s/p/x.js",
      ]),
    ).toEqual(["node_modules/@s/p", "node_modules/a/node_modules/b", "node_modules/ajv"]);
  });

  it("自分のソース (node_modules の外) は含めない", () => {
    expect(packageRootsFromInputs(["src/mcp/main.ts", "src/ds/client.ts"])).toEqual([]);
  });

  it("Windows 区切りも受け付ける", () => {
    expect(packageRootsFromInputs(["node_modules\\zod\\index.js"])).toEqual(["node_modules/zod"]);
  });
});

describe("formatThirdPartyLicenses", () => {
  const pkg = (name: string, text = "MIT License\nCopyright (c) someone") => ({
    name,
    version: "1.0.0",
    license: "MIT",
    text,
  });

  it("パッケージごとに名前・版・ライセンス識別子と全文を、名前順に並べる", () => {
    const out = formatThirdPartyLicenses([pkg("zod"), pkg("ajv")]);
    expect(out.indexOf("ajv@1.0.0")).toBeLessThan(out.indexOf("zod@1.0.0"));
    expect(out).toContain("ajv@1.0.0 (MIT)");
    expect(out).toContain("MIT License\nCopyright (c) someone");
    expect(out.endsWith("\n")).toBe(true);
  });

  it("ライセンス全文が無いパッケージを含む一覧は作れない", () => {
    expect(() => formatThirdPartyLicenses([pkg("zod", "  \n")])).toThrow(/zod/);
  });

  it("同じ名前・版の重複は 1 件にまとめる", () => {
    const out = formatThirdPartyLicenses([pkg("zod"), pkg("zod")]);
    expect(out.match(/zod@1\.0\.0/g)).toHaveLength(1);
  });

  it("パッケージが 0 件なら拒否する (バンドルした依存のライセンスを出し忘れない)", () => {
    expect(() => formatThirdPartyLicenses([])).toThrow();
  });
});
