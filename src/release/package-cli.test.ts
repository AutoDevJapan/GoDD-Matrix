import { describe, expect, it } from "vitest";
import { parseCliArgs } from "./package-cli.js";

describe("parseCliArgs", () => {
  it("--out だけで受け付ける", () => {
    expect(parseCliArgs(["--out", "dist-mcp"])).toEqual({ out: "dist-mcp" });
  });

  it("任意の入力 (pin / source-dir / tarball) を受け取る", () => {
    expect(
      parseCliArgs(["--out", "o", "--pin", "p.json", "--source-dir", "s", "--tarball", "t.tgz"]),
    ).toEqual({ out: "o", pin: "p.json", sourceDir: "s", tarball: "t.tgz" });
  });

  it("--out が無ければ拒否する", () => {
    expect(() => parseCliArgs(["--pin", "p.json"])).toThrow(/--out/);
    expect(() => parseCliArgs([])).toThrow(/--out/);
  });

  it("未知の引数 / 値の欠落 / 重複を拒否する", () => {
    expect(() => parseCliArgs(["--out", "o", "--force", "1"])).toThrow(/未知/);
    expect(() => parseCliArgs(["--out"])).toThrow(/値/);
    expect(() => parseCliArgs(["--out", "--pin", "p"])).toThrow(/値/);
    expect(() => parseCliArgs(["--out", "a", "--out", "b"])).toThrow(/重複/);
  });
});
