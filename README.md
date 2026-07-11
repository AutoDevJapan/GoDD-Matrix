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

各モジュールの実装は個別 issue で追加する (本 PR は骨組みのみ)。
