import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { DesignIndexClient } from "../ds/client.js";
import { decideAxes, selectCells } from "./decide.js";

const fixturePath = fileURLToPath(new URL("../ds/__fixtures__/index.valid.json", import.meta.url));
const index = DesignIndexClient.fromJson(readFileSync(fixturePath, "utf8"));

describe("decideAxes", () => {
  it("要望 (業種名/色/ムード) から AxisContext を確定する", () => {
    const d = decideAxes({
      industry: "経営コンサルタント",
      color: "ライトブルー",
      mood: "信頼",
    });
    expect(d.unresolved).toHaveLength(0);
    expect(d.context).toEqual({ jsic: "7412", color: "h17b-lt", mood: "trustworthy" });
  });

  it("JSIC コード直接指定でも解決する", () => {
    const d = decideAxes({ industry: "5910", color: "白", mood: "ミニマル" });
    expect(d.context).toEqual({ jsic: "5910", color: "white", mood: "minimal" });
  });

  it("tags を context に引き継ぐ", () => {
    const d = decideAxes({
      industry: "7412",
      color: "青",
      mood: "信頼",
      tags: ["professional"],
    });
    expect(d.context?.tags).toEqual(["professional"]);
  });

  it("カラー/ムード未指定は defaults を適用する", () => {
    const d = decideAxes(
      { industry: "経営コンサル" },
      { defaults: { color: "white", mood: "minimal" } },
    );
    expect(d.context).toEqual({ jsic: "7412", color: "white", mood: "minimal" });
  });

  it("未解決軸を列挙し context は未確定", () => {
    const d = decideAxes({ industry: "宇宙旅行代理店", color: "ありえない色" });
    expect(d.context).toBeUndefined();
    expect(d.unresolved).toContain("jsic");
    expect(d.unresolved).toContain("color");
    expect(d.unresolved).toContain("mood");
  });

  it("resolver を差し替えられる", () => {
    const d = decideAxes(
      { industry: "x", color: "y", mood: "z" },
      {
        resolvers: {
          jsic: {
            resolve: () => ({
              query: "x",
              best: { entry: { code: "0001", name: "custom" }, score: 1, matchedBy: "code" },
              candidates: [],
            }),
            get: () => undefined,
          },
        },
        defaults: { color: "white", mood: "minimal" },
      },
    );
    expect(d.context?.jsic).toBe("0001");
  });
});

describe("selectCells (要望 → 軸 → 候補セル)", () => {
  it("確定 context で index の候補セルを引く", () => {
    const sel = selectCells(
      { industry: "経営コンサルタント業", color: "ライトブルー", mood: "信頼" },
      index,
    );
    expect(sel.context).toEqual({ jsic: "7412", color: "h17b-lt", mood: "trustworthy" });
    expect(sel.candidates.map((e) => e.id)).toEqual(["7412_h17b-lt_trustworthy"]);
  });

  it("tags でさらに絞り込む", () => {
    const hit = selectCells(
      { industry: "7412", color: "青", mood: "ミニマル", tags: ["serif-display"] },
      index,
    );
    expect(hit.candidates.map((e) => e.id)).toEqual(["7412_h17b-lt_minimal"]);

    const miss = selectCells(
      { industry: "7412", color: "青", mood: "ミニマル", tags: ["editorial"] },
      index,
    );
    expect(miss.candidates).toHaveLength(0);
  });

  it("未材化セル (index に無い軸) は候補空", () => {
    const sel = selectCells({ industry: "喫茶店", color: "赤", mood: "遊び心" }, index);
    expect(sel.context).toEqual({ jsic: "7681", color: "h2v-vv", mood: "playful" });
    expect(sel.candidates).toHaveLength(0);
  });

  it("軸未解決なら候補を引かない", () => {
    const sel = selectCells({ industry: "宇宙旅行代理店" }, index);
    expect(sel.context).toBeUndefined();
    expect(sel.candidates).toHaveLength(0);
  });
});
