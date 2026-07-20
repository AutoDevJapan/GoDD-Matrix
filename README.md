# GoDD-Matrix

業種と要望から最適なデザインシステムを選定し、デザイン案の提案と、
AI (Claude 等) に渡すデザインプロンプトの生成を行うツール。

- GoDD-Design-Systems カタログに接続
- 業種 / 要望 -> デザイン案提案 + プロンプト合成

GoDD SSOT における **item3 (選定/合成ツール)**。データフローは
「要望 -> 軸決定 (業種/カラー/ムード) -> index 取込 / レンダー -> Claude 用プロンプト合成」。

提供形態:

- **静的 Web アプリ (GitHub Pages)** — 現在の主提供形態。公開 URL で誰でも利用可能
  (完全クライアントサイド)。
- **stdio MCP サーバ** — GitHub ネイティブに MCP クライアント (Claude Desktop 等) から使う。
- **HTTP MCP トランスポート** — `src/mcp/http.ts` / `api/` にコードとして残るが、
  **現在はどこにもデプロイしていない** (旧 Vercel プロジェクトは廃止済み)。自前ホストは可能。

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
- **プロンプト合成 + コピペ**: 材化済みセルは公開 raw URL から DESIGN.md 本文を取得し、
  index の SHA-256 とブラウザ内で照合する。仮想セルは決定論的な standalone 仕様を
  ブラウザ内で合成し、`rendered` として区別する。取得不能な材化済みセルはエラーを明示し、
  未取得本文をコピーまたはダウンロードさせない。取得・合成できた本文は
  `src/prompt/synthesizePrompt` で system / user プロンプトへ組み込み、詳細画面から
  結合済みプロンプトをコピーまたはダウンロードできる。hash 不一致時は本文を保持したまま
  警告を表示し、リンク共有は本文の取得状態にかかわらず利用できる。
- **共有可能な状態 (URL 同期)**: 検索・ファセット・ページに加え、選択セルを
  `?cell=<id>` として URL に反映する。その URL を開くと該当セルが選択・プロンプト表示
  された状態で復元されるため、特定セルをそのまま共有できる。「このセルのリンクをコピー」
  ボタンで最小の共有 URL (`?cell=<id>`) を得られる。
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

## HTTP トランスポート (issue #8, コードのみ・未デプロイ)

> **注記**: この HTTP トランスポートは**コードとして残しているが、現在はどこにも
> デプロイしていない**。旧 Vercel プロジェクトは廃止済みで、デプロイ用ワークフロー
> (`deploy.yml`) と関連 GitHub Secrets も撤去済み。現在稼働している公開提供形態は
> **GitHub Pages の静的 Web アプリ**のみ。以下は自前ホスト (任意の Node ランタイム / 関数)
> する場合の参考であり、`vercel.json` / `api/` はその足場として残置している。

stdio エントリ (`dist/mcp/main.js`) に加え、同じ MCP サーバ (3 ツール) を
[Streamable HTTP](https://modelcontextprotocol.io) トランスポートで公開できる。
URL でホストできるため、任意のサーバレス関数 / Node ランタイムで配信可能。

- `GET /health` — ヘルスチェック (200, 認証不要)。
- `POST /mcp` — MCP Streamable HTTP エンドポイント。stateless モード
  (セッション非永続) で、リクエスト毎に MCP サーバを生成する。
- 認証: `x-api-key` ヘッダ (期待値は env `GODD_MCP_API_KEY`)。未設定なら認証無効。

配信は `api/mcp.ts` / `api/health.ts` (Node Function) が共有ハンドラ
(`src/mcp/http.ts`) を呼ぶ。関数ランタイムが `(req, res)` で呼ぶ場合は
`src/mcp/node-adapter.ts` が Web 標準 `Request` / `Response` へ橋渡しする。

### 追加の環境変数 (HTTP)

| 変数 | 必須 | 説明 |
| --- | --- | --- |
| `GODD_MCP_API_KEY` | | `POST /mcp` の `x-api-key` 期待値。未設定なら認証無効。 |
| `GODD_MCP_MAX_BODY_BYTES` | | `POST /mcp` のリクエストボディ上限 (bytes)。既定 1 MiB。超過は 413。 |
| `GENERATOR_RENDER_URL` | | 未材化セルの Generator レンダー API ベース URL。未設定なら未材化は `unavailable`。 |
| `GENERATOR_RENDER_API_KEY` | | 同 API の認証キー。`GENERATOR_RENDER_URL` と両方揃った場合のみ有効。 |
