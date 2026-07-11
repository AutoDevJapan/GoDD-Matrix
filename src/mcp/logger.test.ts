import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  LOG_ENABLED_ENV,
  LOG_LEVEL_ENV,
  type LogRecord,
  createConsoleLogger,
  createNoopLogger,
  maskSecrets,
  newRequestId,
} from "./logger.js";

/** レコードを配列に集める sink を作る (構造検証用)。 */
function capture(): { records: LogRecord[]; sink: (r: LogRecord) => void } {
  const records: LogRecord[] = [];
  return { records, sink: (r) => records.push(r) };
}

const FIXED_NOW = () => new Date("2026-07-11T00:00:00.000Z");

describe("createConsoleLogger", () => {
  it("timestamp / level / msg と任意フィールドを持つ構造化レコードを出力する", () => {
    const { records, sink } = capture();
    const log = createConsoleLogger({ sink, now: FIXED_NOW, level: "debug" });
    log.info("mcp.request.start", { method: "tools/call", tool: "godd_matrix_compose" });

    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      timestamp: "2026-07-11T00:00:00.000Z",
      level: "info",
      msg: "mcp.request.start",
      method: "tools/call",
      tool: "godd_matrix_compose",
    });
  });

  it("閾値未満のレベルは出力しない", () => {
    const { records, sink } = capture();
    const log = createConsoleLogger({ sink, level: "warn" });
    log.debug("d");
    log.info("i");
    log.warn("w");
    log.error("e");
    expect(records.map((r) => r.level)).toEqual(["warn", "error"]);
  });

  it("child でバインド (requestId) を伝播する", () => {
    const { records, sink } = capture();
    const root = createConsoleLogger({ sink, level: "debug" });
    const child = root.child({ requestId: "req-123" });
    child.info("mcp.request.start");
    child.error("mcp.request.error", { status: 500 });

    expect(records).toHaveLength(2);
    expect(records[0]?.requestId).toBe("req-123");
    expect(records[1]?.requestId).toBe("req-123");
    expect(records[1]?.status).toBe(500);
  });

  it("child は親のバインドに追加する (入れ子)", () => {
    const { records, sink } = capture();
    const log = createConsoleLogger({ sink, level: "debug", bindings: { service: "godd" } });
    log.child({ requestId: "r1" }).info("x");
    expect(records[0]).toMatchObject({ service: "godd", requestId: "r1" });
  });

  it("秘密値をフィールドから *** にマスクする", () => {
    const { records, sink } = capture();
    const log = createConsoleLogger({ sink, level: "debug", secrets: ["super-secret-key"] });
    log.error("mcp.runtime.unavailable", {
      error: "認証失敗: key=super-secret-key を確認",
      tool: "x",
    });
    expect(records[0]?.error).toBe("認証失敗: key=*** を確認");
    expect(records[0]?.error).not.toContain("super-secret-key");
  });

  it("ネストしたオブジェクト内の秘密値もマスクする", () => {
    const { records, sink } = capture();
    const log = createConsoleLogger({ sink, level: "debug", secrets: ["topsecret"] });
    log.info("x", { detail: { header: "Bearer topsecret" } as unknown as string });
    expect(JSON.stringify(records[0])).not.toContain("topsecret");
  });

  it("undefined / 空の秘密値は無視する (誤マスクしない)", () => {
    const { records, sink } = capture();
    const log = createConsoleLogger({ sink, level: "debug", secrets: [undefined, ""] });
    log.info("x", { error: "普通のメッセージ" });
    expect(records[0]?.error).toBe("普通のメッセージ");
  });

  it("enabled=false なら何も出力しない", () => {
    const { records, sink } = capture();
    const log = createConsoleLogger({ sink, enabled: false, level: "debug" });
    log.error("e");
    expect(records).toHaveLength(0);
  });
});

describe("createConsoleLogger (環境変数)", () => {
  const original = { level: process.env[LOG_LEVEL_ENV], enabled: process.env[LOG_ENABLED_ENV] };

  beforeEach(() => {
    delete process.env[LOG_LEVEL_ENV];
    delete process.env[LOG_ENABLED_ENV];
  });

  afterEach(() => {
    if (original.level === undefined) delete process.env[LOG_LEVEL_ENV];
    else process.env[LOG_LEVEL_ENV] = original.level;
    if (original.enabled === undefined) delete process.env[LOG_ENABLED_ENV];
    else process.env[LOG_ENABLED_ENV] = original.enabled;
  });

  it("GODD_MCP_LOG_LEVEL でレベルを制御する", () => {
    process.env[LOG_LEVEL_ENV] = "error";
    const { records, sink } = capture();
    const log = createConsoleLogger({ sink });
    log.info("i");
    log.error("e");
    expect(records.map((r) => r.level)).toEqual(["error"]);
  });

  it("GODD_MCP_LOG=off でログを無効化する", () => {
    process.env[LOG_ENABLED_ENV] = "off";
    const { records, sink } = capture();
    const log = createConsoleLogger({ sink, level: "debug" });
    log.error("e");
    expect(records).toHaveLength(0);
  });
});

describe("maskSecrets", () => {
  it("秘密が無ければ原本を返す", () => {
    const record = { a: "x", b: 1 };
    expect(maskSecrets(record, [])).toEqual(record);
  });

  it("文字列・ネスト・非文字列を適切に扱う", () => {
    const out = maskSecrets({ s: "aXa", n: 5, o: { k: "Xy" } }, ["X"]);
    expect(out).toEqual({ s: "a***a", n: 5, o: { k: "***y" } });
  });
});

describe("createNoopLogger", () => {
  it("呼び出しても例外を投げず child も noop", () => {
    const log = createNoopLogger();
    expect(() => {
      log.info("x");
      log.child({ requestId: "r" }).error("y");
    }).not.toThrow();
  });
});

describe("newRequestId", () => {
  it("毎回異なる非空の ID を返す", () => {
    const a = newRequestId();
    const b = newRequestId();
    expect(a).not.toBe(b);
    expect(a.length).toBeGreaterThan(0);
  });
});
