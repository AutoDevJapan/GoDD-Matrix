# GoDD-Matrix

業種と要望から最適なデザインシステムを選定し、デザイン案の提案と、
AI (Claude 等) に渡すデザインプロンプトの生成を行うツール。

- GoDD-Design-Systems カタログに接続
- 業種 / 要望 -> デザイン案提案 + プロンプト合成

GoDD SSOT における **item3 (選定/合成ツール)**。データフローは
「要望 -> 軸決定 (業種/カラー/ムード) -> index 取込 / レンダー -> Claude 用プロンプト合成」。

現在準備中 (WIP)。

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

各モジュールの実装は個別 issue で追加する。
