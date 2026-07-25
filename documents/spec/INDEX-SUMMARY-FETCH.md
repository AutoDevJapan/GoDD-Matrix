# index-summary 先読み (Matrix issue #88)

Design-Systems の [index-paging 契約](https://github.com/AutoDevJapan/GoDD-Design-Systems/blob/main/documents/spec/index-paging.md) / [ADR-0003](https://github.com/AutoDevJapan/GoDD-Design-Systems/blob/main/documents/adr/0003-index-pages-release-publish.md) に従い、公開 UI は全件 `index.json` を必須にしない。

## 取得手順

1. （任意）ローカル `web-index.json` — E2E / オフライン用
2. `GET .../main/index-summary.json`（raw）— 件数・ファセット・`pageCount`
3. 明細が必要なときページシャードを取得（0-based, `PAGE_SIZE=1000`）
   - **正本（ADR-0003）**: GitHub Release タグ `index-pages` の asset
     - `https://github.com/AutoDevJapan/GoDD-Design-Systems/releases/download/index-pages/{n}.json`
     - 任意: 同 Release の `manifest.json`（`pagesBaseUrl` / `pageCount`）
   - **Pages UI（ブラウザ）**: Release asset は CORS を返さないため、`pages.yml` が
     Release zip を `web/dist/index/pages/` へ同期した**同オリジンミラー**を
     `dsIndexPageMirrorUrl` 経由で取得する（正本データは Release 由来）
4. シャード取得失敗時のみ `index.json` 全件へフォールバック（`console.warn` で非推奨を明示）

実装: `web/src/index-loader.ts` / URL ビルダ `dsIndexPageUrl`（正本）・`dsIndexPageMirrorUrl`（Pages）。
配線: `web/src/main.ts` の bootstrap。ミラー同期: `scripts/sync-index-pages.mjs`。

## URL 早見

| 用途 | URL |
|---|---|
| summary | `https://raw.githubusercontent.com/AutoDevJapan/GoDD-Design-Systems/main/index-summary.json` |
| page 正本 | `https://github.com/AutoDevJapan/GoDD-Design-Systems/releases/download/index-pages/{n}.json` |
| page ミラー (Pages) | `./index/pages/{n}.json`（サイトルート相対） |
| 全件フォールバック | `https://raw.githubusercontent.com/AutoDevJapan/GoDD-Design-Systems/main/index.json` |

`raw.githubusercontent.com/.../main/index/pages/{n}.json` は予約パスであり、Phase 1 の配信正本ではない（git に置かない）。

## 受け入れ

- summary が取れるとき、カタログ UI は `index.json` なしでファセット用メタと総件数 (`data-ds-entry-count`) を持てる
- Pages で Release ミラーが届いているとき、明細は `entriesSource=shards`（`data-ds-index-source=shards`）になり、非推奨フォールバック警告は出ない
- シャード未取得環境では明示的フォールバックが残り、非推奨ログが出る
