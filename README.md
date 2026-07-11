# GoDD-Matrix

業種と要望から最適なデザインシステムを選定し、デザイン案の提案と、
AI (Claude 等) に渡すデザインプロンプトの生成を行うツール。

- GoDD-Design-Systems カタログに接続
- 業種 / 要望 -> デザイン案提案 + プロンプト合成

GoDD SSOT における **item3 (選定/合成ツール)**。データフローは
「要望 -> 軸決定 (業種/カラー/ムード) -> index 取込 / レンダー -> Claude 用プロンプト合成」。

提供形態は 3 つ: **静的 Web アプリ (GitHub Pages)** / stdio MCP / HTTP MCP (Vercel)。

## 検索&コピペ Web ページ (GitHub Pages, issue #28)

**公開 URL: <https://autodevjapan.github.io/GoDD-Matrix/>**

ブラウザだけで動く**完全クライアントサイド**の静的サイト。サーバ / サーバレス関数を
持たないため、リクエスト課金や濫用リスクがない (閲覧者自身のブラウザで動くだけ)。

- **データ取得**: 公開 Design-Systems の `index.json` と `DESIGN.md` を
  `raw.githubusercontent.com` から直接 fetch。JSIC コード→業種名は Matrix にバンドル
  済みの `src/axes/jsic-catalog.ts` (全 1,473 件)、カラー/ムード slug の表示名は
  `src/axes/taxonomy.ts` を利用。
- **検索/絞り込み**: 業種 (名称/キーワード/コード)・カラー・ムード・タグ・自由文で
  DS セルを絞り込む。軸解決は `src/axes` の `decideAxes` (キーワード/別名一致) を
  ブラウザ向けにバンドルして再現する。
- **プロンプト合成 + コピペ**: セルを選ぶと DESIGN.md 本文を取得し、
  `src/prompt/synthesizePrompt` をブラウザ内で実行して Claude 用プロンプト
  (system / user) を生成。SHA-256 で hash 検証したうえで「system プロンプト」
  「user プロンプト」「DESIGN.md 本文」をワンクリックでコピーできる。未材化セルは
  「未材化 (Generator レンダーが必要)」と明示する。
- **秘密は一切扱わない** (全て公開データ・クライアントサイド)。

### ローカルで動かす

```bash
pnpm build:web                       # web/dist/ に静的成果物を生成 (esbuild)
pnpm typecheck:web                   # web の型チェック (DOM lib)
npx serve web/dist                   # 任意の静的サーバで配信して確認
# もしくは: python -m http.server -d web/dist 8080
```

`http://localhost:<port>/` を開くと検索・コピーを試せる (`crypto.subtle` の hash 検証は
https / localhost の secure context で有効)。

### デプロイ

`.github/workflows/pages.yml` が `main` への push (web/ や src/ の変更時) と手動
dispatch で `pnpm build:web` → `web/dist` を GitHub Pages へ公開する
(`configure-pages` + `upload-pages-artifact` + `deploy-pages`)。
basePath はリポジトリ名 `/GoDD-Matrix` (資産参照は相対パス)。

## 必要環境

- Node.js >= 20
- pnpm

## 開発

```bash
pnpm install       # 依存インストール
pnpm build         # dist/ へビルド (tsc)
pnpm typecheck     # 型チェックのみ
pnpm test          # 単体テスト (vitest)
pnpm lint          # Lint + format チェック (biome)
pnpm lint:fix      # 自動修正
```

## ディレクトリ構成

```
src/
  axes/        軸 (業種 JSIC / カラー PCCS / ムード) の型と決定ロジック
  ds/          Design-Systems 接続 (index 取込 / DESIGN.md fetch)
  generator/   Generator レンダー API クライアント
  prompt/      Claude 用プロンプト合成
  mcp/         MCP サーバ (GitHub ネイティブ提供形態)
  index.ts     公開エントリ
```

## MCP サーバ (GitHub ネイティブ提供形態)

既存パイプライン (軸決定 → index → DESIGN.md 解決 → プロンプト合成) を
[Model Context Protocol](https://modelcontextprotocol.io) の stdio サーバとして公開する。

```bash
pnpm build
GODD_DS_INDEX=./path/to/index.json node dist/mcp/main.js   # bin: godd-matrix-mcp
```

### 環境変数

| 変数 | 必須 | 説明 |
| --- | --- | --- |
| `GODD_DS_INDEX` | ○ | Design-Systems `index.json` の取込元 (ローカルパス / file: / http(s) URL)。 |
| `GODD_DS_BASE` | | DESIGN.md 本文の解決 base。未指定なら `GODD_DS_INDEX` の所在から推定。 |

### 公開ツール (tools/list)

| tool | 概要 |
| --- | --- |
| `godd_matrix_compose` | 要望 (業種/カラー/ムード) → 確定軸 → DESIGN.md 解決 → Claude 用プロンプト (system/user) 合成。 |
| `godd_matrix_decide_axes` | 要望 → 各軸 (JSIC/カラー/ムード) の解決 (確定 context / 未解決軸 / 候補)。副作用なし。 |
| `godd_matrix_select_cells` | 要望 → 確定軸 → index に一致する候補セル。 |

各ツールは共通入力 `{ industry: string; color?: string; mood?: string; tags?: string[] }` を受け取る。
未解決軸がある場合、`compose` はプロンプトを合成せず候補を提示して `isError` を返す。

## HTTP トランスポート / Vercel デプロイ (issue #8)

stdio エントリ (`dist/mcp/main.js`) に加え、同じ MCP サーバ (3 ツール) を
[Streamable HTTP](https://modelcontextprotocol.io) トランスポートで公開する。
URL でホストできるため Vercel Function として配信する。

- `GET /health` — ヘルスチェック (200, 認証不要)。
- `POST /mcp` — MCP Streamable HTTP エンドポイント。stateless モード
  (セッション非永続) で、リクエスト毎に MCP サーバを生成する。
- 認証: `x-api-key` ヘッダ (期待値は env `GODD_MCP_API_KEY`)。未設定なら認証無効。

配信は `api/mcp.ts` / `api/health.ts` (Vercel Node Function) が共有ハンドラ
(`src/mcp/http.ts`) を呼ぶ。Vercel の Node 関数は `(req, res)` で呼ばれるため
`src/mcp/node-adapter.ts` が Web 標準 `Request` / `Response` へ橋渡しする。

### 追加の環境変数 (HTTP / Vercel)

| 変数 | 必須 | 説明 |
| --- | --- | --- |
| `GODD_MCP_API_KEY` | | `POST /mcp` の `x-api-key` 期待値。未設定なら認証無効。 |
| `GODD_MCP_MAX_BODY_BYTES` | | `POST /mcp` のリクエストボディ上限 (bytes)。既定 1 MiB。超過は 413。 |
| `GENERATOR_RENDER_URL` | | 未材化セルの Generator レンダー API ベース URL。未設定なら未材化は `unavailable`。 |
| `GENERATOR_RENDER_API_KEY` | | 同 API の認証キー。`GENERATOR_RENDER_URL` と両方揃った場合のみ有効。 |

### デプロイ (4 環境)

`.github/workflows/deploy.yml` が Vercel へデプロイする。

| 環境 | トリガ | 反映先 |
| --- | --- | --- |
| preview | PR | プレビュー URL |
| dev | `main` への push | 本番 (dev live) |
| stg | 手動 dispatch (`target=stg`) | 本番 |
| prd | 手動 dispatch (`target=prd`) | 本番 (Environment `production` の承認ゲート付き) |

必要な GitHub Secrets: `VERCEL_TOKEN` / `VERCEL_ORG_ID` / `VERCEL_PROJECT_ID` /
`GODD_MCP_API_KEY`。

各モジュールの実装は個別 issue で追加する。
