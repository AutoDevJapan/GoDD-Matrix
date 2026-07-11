/**
 * `src/axes/jsic-catalog.ts` を Design-Systems の `jsic.json` から再生成する (issue #18)。
 *
 * JSIC 細分類 (subclass, 4桁) の code / name を source-of-truth として取り込み、
 * ビルド時にバンドルできる TypeScript モジュールへ変換する。捏造コードを避けるため、
 * Matrix 側では本スクリプトが生成した catalog のみを業種解決の母集合とする。
 *
 * 取込元は環境変数 `GODD_JSIC_SOURCE` (ローカルパス / http(s) URL) で差し替え可。
 * 既定は DS リポジトリの公開 raw URL。
 *
 * 使い方: `node scripts/gen-jsic-catalog.mjs` (生成後に `pnpm lint:fix` で整形する)
 */
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const DEFAULT_SOURCE =
  "https://raw.githubusercontent.com/AutoDevJapan/GoDD-Design-Systems/main/jsic.json";

const OUT_PATH = fileURLToPath(new URL("../src/axes/jsic-catalog.ts", import.meta.url));

/** ローカルパス / http(s) URL から JSON テキストを取得する。 */
async function fetchSource(source) {
  if (/^https?:\/\//.test(source)) {
    const res = await fetch(source);
    if (!res.ok) throw new Error(`取得失敗 (HTTP ${res.status}): ${source}`);
    return res.text();
  }
  return readFile(source, "utf8");
}

function esc(s) {
  return s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

async function main() {
  const source = process.env.GODD_JSIC_SOURCE ?? DEFAULT_SOURCE;
  const raw = await fetchSource(source);
  const doc = JSON.parse(raw);
  const subclasses = doc.subclass;
  if (!Array.isArray(subclasses) || subclasses.length === 0) {
    throw new Error("jsic.json の subclass 配列が空です");
  }

  const seen = new Set();
  const rows = [];
  for (const e of subclasses) {
    if (typeof e.code !== "string" || typeof e.name !== "string") {
      throw new Error(`不正な subclass エントリ: ${JSON.stringify(e)}`);
    }
    if (seen.has(e.code)) throw new Error(`code 重複: ${e.code}`);
    seen.add(e.code);
    rows.push(`  { code: "${esc(e.code)}", name: "${esc(e.name)}" },`);
  }

  const revision = doc.meta?.revision ?? "unknown";
  const header = `/**
 * JSIC 細分類カタログ (自動生成; 手で編集しない)。
 *
 * 出典: AutoDevJapan/GoDD-Design-Systems \`jsic.json\` の subclass (4桁細分類)。
 * 改定: ${revision}
 * 再生成: \`node scripts/gen-jsic-catalog.mjs\`
 *
 * 業種名 → JSIC コード解決 (${"src/axes/jsic.ts"}) の母集合。ここに無いコードは
 * 存在しないものとして扱い、捏造コードを禁ずる。
 */

/** JSIC 細分類の 1 エントリ (code と名称のみ)。 */
export interface JsicSubclass {
  /** JSIC 細分類コード (4桁)。 */
  readonly code: string;
  /** 細分類名称。 */
  readonly name: string;
}

/** JSIC 細分類の全件 (${rows.length} 件)。 */
export const JSIC_SUBCLASSES: readonly JsicSubclass[] = [
`;

  const out = `${header}${rows.join("\n")}\n];\n`;
  await writeFile(OUT_PATH, out, "utf8");
  console.log(`生成: ${OUT_PATH} (${rows.length} 件, 出典改定=${revision})`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
