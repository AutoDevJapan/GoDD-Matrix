import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { SAMPLE_JSIC, SAMPLE_TAXONOMY } from "../ds/__fixtures__/snapshot-pin.js";
import { parseDsJsic, parseDsTaxonomy, toAxisResolvers } from "../ds/catalogs.js";
import { DesignIndexClient } from "../ds/client.js";
import { DesignBodyClient, DesignResolver } from "../ds/design.js";
import type { DesignIndexEntry } from "../ds/types.js";
import { type MatrixRuntime, runCompose, runDecideAxes, runSelectCells } from "./tools.js";

const baseDir = fileURLToPath(new URL("../ds/__fixtures__", import.meta.url));
const BODY_PATH = "design-md/7281/h17b-lt/trustworthy/DESIGN.md";
const markdown = readFileSync(path.join(baseDir, BODY_PATH), "utf8");
const realHash = `sha256:${createHash("sha256").update(markdown, "utf8").digest("hex")}`;

const entry: DesignIndexEntry = {
  id: "7281_h17b-lt_trustworthy",
  path: BODY_PATH,
  jsic: "7281",
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
    expect(res.context).toEqual({ jsic: "7281", color: "h17b-lt", mood: "trustworthy" });
    expect(res.unresolved).toEqual([]);
    expect(res.axes.jsic.best?.code).toBe("7281");
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
    expect(res.candidates[0]?.id).toBe("7281_h17b-lt_trustworthy");
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
    expect(res.context).toEqual({ jsic: "7281", color: "h17b-lt", mood: "trustworthy" });
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

describe("runtime.axes (正式配布の snapshot から作った軸 resolver)", () => {
  // index のセルは、本物の DS と同じく最小表に無い色 slug (lt-h17) を使う。
  const pinnedEntry: DesignIndexEntry = {
    ...entry,
    id: "7281_lt-h17_trustworthy",
    color: "lt-h17",
  };
  const axes = toAxisResolvers({
    taxonomy: parseDsTaxonomy(JSON.stringify(SAMPLE_TAXONOMY)),
    jsic: parseDsJsic(JSON.stringify(SAMPLE_JSIC)),
  });
  function pinnedRuntime(): MatrixRuntime {
    const index = new DesignIndexClient({ version: 1, entries: [pinnedEntry] });
    return { index, resolver: new DesignResolver(index, new DesignBodyClient(baseDir)), axes };
  }
  const brief = { industry: "7281", color: "lt-h17", mood: "trustworthy" };

  it("最小表に無い slug でも、runtime の軸 resolver があれば確定する (従来は未解決)", () => {
    expect(runDecideAxes(brief).resolved).toBe(false);
    expect(runDecideAxes(brief).unresolved).toContain("color");
    const res = runDecideAxes(brief, pinnedRuntime());
    expect(res.resolved).toBe(true);
    expect(res.context).toEqual({ jsic: "7281", color: "lt-h17", mood: "trustworthy" });
  });

  it("同じ名称を共有する色名は確定せず、候補から slug を選べるよう返す", () => {
    const res = runDecideAxes({ ...brief, color: "ライトトーンの青" }, pinnedRuntime());
    expect(res.resolved).toBe(false);
    expect(res.unresolved).toEqual(["color"]);
    expect(res.axes.color.best).toBeUndefined();
    expect(res.axes.color.candidates.map((c) => c.slug)).toEqual(["h17b-lt", "lt-h17", "lt-h18"]);
  });

  it("select_cells は runtime の軸 resolver で確定した軸から候補セルを引く", () => {
    const res = runSelectCells(brief, pinnedRuntime());
    expect(res.resolved).toBe(true);
    expect(res.candidates.map((c) => c.id)).toEqual(["7281_lt-h17_trustworthy"]);
  });

  it("compose は確定した軸の本文 (hash 検証済み) からプロンプトを合成する", async () => {
    const res = await runCompose(brief, pinnedRuntime());
    expect(res.resolved).toBe(true);
    if (!res.resolved) return;
    expect(res.context.color).toBe("lt-h17");
    expect(res.prompt.provenance).toBe("materialized");
    expect(res.prompt.systemPrompt).toContain("専門性と誠実さ");
  });

  it("compose は曖昧な色名を既定で握りつぶさず、候補つきの未解決を返す", async () => {
    const res = await runCompose({ ...brief, color: "ライトトーンの青" }, pinnedRuntime());
    expect(res.resolved).toBe(false);
    if (res.resolved) return;
    expect(res.unresolved).toEqual(["color"]);
    expect(res.axes.color.candidates).toHaveLength(3);
  });
});
