import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { DesignIndexClient } from "../ds/client.js";
import { DesignBodyClient, DesignResolver } from "../ds/design.js";
import type { DesignIndexEntry } from "../ds/types.js";
import { type MatrixRuntime, runCompose, runDecideAxes, runSelectCells } from "./tools.js";

const baseDir = fileURLToPath(new URL("../ds/__fixtures__", import.meta.url));
const BODY_PATH = "design-md/7412/h17b-lt/trustworthy/DESIGN.md";
const markdown = readFileSync(path.join(baseDir, BODY_PATH), "utf8");
const realHash = `sha256:${createHash("sha256").update(markdown, "utf8").digest("hex")}`;

const entry: DesignIndexEntry = {
  id: "7412_h17b-lt_trustworthy",
  path: BODY_PATH,
  jsic: "7412",
  color: "h17b-lt",
  mood: "trustworthy",
  tags: ["professional"],
  title: "経営コンサルタント業 × ライトブルー × 信頼",
  hash: realHash,
  createdAt: "2026-07-11T00:00:00Z",
};

/** 材化済みセルを1件だけ持つインメモリ runtime (副作用はローカル fixture のみ)。 */
function makeRuntime(): MatrixRuntime {
  const index = new DesignIndexClient({ version: 1, entries: [entry] });
  const body = new DesignBodyClient(baseDir);
  return { index, resolver: new DesignResolver(index, body) };
}

describe("runDecideAxes", () => {
  it("業種/カラー/ムードが全て解決すると context を確定する", () => {
    const res = runDecideAxes({ industry: "コンサル", color: "ライトブルー", mood: "信頼" });
    expect(res.resolved).toBe(true);
    expect(res.context).toEqual({ jsic: "7412", color: "h17b-lt", mood: "trustworthy" });
    expect(res.unresolved).toEqual([]);
    expect(res.axes.jsic.best?.code).toBe("7412");
    expect(res.axes.color.best?.slug).toBe("h17b-lt");
    expect(res.axes.mood.best?.slug).toBe("trustworthy");
  });

  it("解決できない業種は未解決を明示し候補は空", () => {
    const res = runDecideAxes({
      industry: "存在しない業種xyz",
      color: "ライトブルー",
      mood: "信頼",
    });
    expect(res.resolved).toBe(false);
    expect(res.context).toBeUndefined();
    expect(res.unresolved).toContain("jsic");
    expect(res.axes.jsic.best).toBeUndefined();
  });
});

describe("runSelectCells", () => {
  it("確定軸に一致する候補セルを返す", () => {
    const res = runSelectCells(
      { industry: "コンサル", color: "ライトブルー", mood: "信頼" },
      makeRuntime(),
    );
    expect(res.resolved).toBe(true);
    expect(res.candidates).toHaveLength(1);
    expect(res.candidates[0]?.id).toBe("7412_h17b-lt_trustworthy");
  });

  it("未解決軸があれば候補を引かず空", () => {
    const res = runSelectCells({ industry: "存在しない業種xyz" }, makeRuntime());
    expect(res.resolved).toBe(false);
    expect(res.candidates).toEqual([]);
  });
});

describe("runCompose", () => {
  it("材化済みセルを解決し Claude 用プロンプトを合成する", async () => {
    const res = await runCompose(
      { industry: "コンサル", color: "ライトブルー", mood: "信頼" },
      makeRuntime(),
    );
    expect(res.resolved).toBe(true);
    if (!res.resolved) return;
    expect(res.context).toEqual({ jsic: "7412", color: "h17b-lt", mood: "trustworthy" });
    expect(res.candidateCount).toBe(1);
    expect(res.prompt.provenance).toBe("materialized");
    expect(res.prompt.hasDesignBody).toBe(true);
    expect(res.prompt.systemPrompt).toContain("専門性と誠実さ");
    expect(res.prompt.userPrompt).toContain("コンサル");
  });

  it("未解決軸があればプロンプトを合成せず候補提示を返す", async () => {
    const res = await runCompose({ industry: "存在しない業種xyz" }, makeRuntime());
    expect(res.resolved).toBe(false);
    if (res.resolved) return;
    expect(res.unresolved).toContain("jsic");
    expect(res.axes.jsic.query).toBeDefined();
  });
});
