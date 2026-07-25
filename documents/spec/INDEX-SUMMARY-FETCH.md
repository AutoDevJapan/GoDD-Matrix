# index-summary 先読み (Matrix issue #88)

Design-Systems の [index-paging 契約](https://github.com/AutoDevJapan/GoDD-Design-Systems/blob/main/documents/spec/index-paging.md) に従い、公開 UI は全件 `index.json` を必須にしない。

## 取得手順

1. （任意）ローカル `web-index.json` — E2E / オフライン用
2. `GET .../main/index-summary.json` — 件数・ファセット・`pageCount`
3. 明細が必要なとき `index/pages/{n}.json`（0-based）
4. ページシャード未公開時は `index.json` 全件へフォールバック（`console.warn` で非推奨を明示）

実装: `web/src/index-loader.ts`。配線: `web/src/main.ts` の bootstrap。

## 受け入れ

- summary が取れるとき、カタログ UI は `index.json` なしでファセット用メタと総件数 (`data-ds-entry-count`) を持てる
- シャード未公開環境では明示的フォールバックが残り、非推奨ログが出る
