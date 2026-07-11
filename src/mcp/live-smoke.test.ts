/**
 * live スモークテスト (issue #22): デプロイ済み `POST /mcp` の実疎通確認。
 *
 * opt-in: 環境変数 {@link MCP_URL_ENV} (`GODD_MATRIX_MCP_URL`) が指定された時のみ実行。
 * 未指定なら describe ごと skip され、通常 CI はハーメティックのまま
 * ({@link ./integration.test.ts} が回帰ガードを担う)。
 *
 * 実行例:
 *   GODD_MATRIX_MCP_URL=https://godd-matrix.vercel.app/mcp \
 *   GODD_MCP_API_KEY=xxxxx pnpm test live-smoke
 *
 * 本番の実データに対して、代表入力「経営コンサル × ライトブルー × 信頼」で
 * select_cells が候補 >= 1、compose が本文注入 (hasDesignBody) を返すことを確認する。
 * ネットワーク越しのため、per-request タイムアウトと簡易リトライでフレークを抑える。
 */
import { describe, expect, it } from "vitest";

/** live スモークの対象 URL を指定する環境変数名 (未指定なら skip)。 */
const MCP_URL_ENV = "GODD_MATRIX_MCP_URL";
/** 認証キー (`x-api-key`) を渡す環境変数名。サーバの GODD_MCP_API_KEY と一致させる。 */
const API_KEY_ENV = "GODD_MCP_API_KEY";

const mcpUrl = process.env[MCP_URL_ENV];
const apiKey = process.env[API_KEY_ENV];

/** 1 リクエストのタイムアウト (ms)。 */
const REQUEST_TIMEOUT_MS = 15_000;
/** ネットワーク揺らぎ対策のリトライ回数。 */
const MAX_ATTEMPTS = 3;

const REPRESENTATIVE_BRIEF = {
  industry: "経営コンサル",
  color: "ライトブルー",
  mood: "信頼",
} as const;

const EXPECTED_CELL_ID = "7281_h17b-lt_trustworthy";

/** JSON-RPC tools/call を live URL に投げ、structuredContent を返す (リトライ付き)。 */
async function callToolLive(
  name: string,
  args: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    accept: "application/json, text/event-stream",
  };
  if (apiKey) headers["x-api-key"] = apiKey;

  const payload = JSON.stringify({
    jsonrpc: "2.0",
    id: 1,
    method: "tools/call",
    params: { name, arguments: args },
  });

  let lastError: unknown;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const res = await fetch(mcpUrl as string, {
        method: "POST",
        headers,
        body: payload,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status} from ${mcpUrl}`);
      const body = (await res.json()) as {
        error?: unknown;
        result?: { isError?: boolean; structuredContent?: Record<string, unknown> };
      };
      if (body.error) throw new Error(`JSON-RPC error: ${JSON.stringify(body.error)}`);
      if (body.result?.isError) {
        throw new Error(`tool error: ${JSON.stringify(body.result.structuredContent)}`);
      }
      const sc = body.result?.structuredContent;
      if (!sc) throw new Error("structuredContent がありません");
      return sc;
    } catch (err) {
      lastError = err;
      if (attempt < MAX_ATTEMPTS) await new Promise((r) => setTimeout(r, 500 * attempt));
    }
  }
  throw lastError;
}

// URL 未指定なら丸ごと skip (ハーメティック維持)。
describe.skipIf(!mcpUrl)("live スモーク: デプロイ済み /mcp の実疎通 (opt-in)", () => {
  it("select_cells が候補 >= 1 を返す", async () => {
    const sc = (await callToolLive("godd_matrix_select_cells", { ...REPRESENTATIVE_BRIEF })) as {
      resolved: boolean;
      candidates: Array<{ id: string }>;
    };
    expect(sc.resolved).toBe(true);
    expect(sc.candidates.length).toBeGreaterThanOrEqual(1);
    expect(sc.candidates.map((c) => c.id)).toContain(EXPECTED_CELL_ID);
  });

  it("compose が hasDesignBody=true で本文を返す", async () => {
    const sc = (await callToolLive("godd_matrix_compose", { ...REPRESENTATIVE_BRIEF })) as {
      resolved: boolean;
      candidateCount?: number;
      prompt?: { hasDesignBody: boolean; provenance: string };
    };
    expect(sc.resolved).toBe(true);
    expect(sc.candidateCount).toBeGreaterThanOrEqual(1);
    expect(sc.prompt?.hasDesignBody).toBe(true);
  });
});
