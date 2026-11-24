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
- **stdio MCP サーバ** — GitHub ネイティブに MCP クライアント (Codex / Claude Code / Claude Desktop 等)
  から使う。正式配布物 (固定 snapshot に束縛した zip) は Actions で生成する。
- **HTTP MCP トランスポート** — `src/mcp/http.ts` / `api/` にコードとして残るが、
  **現在はどこにもデプロイしていない** (旧 Vercel プロジェクトは廃止済み)。自前ホストは可能。

## 検索&コピペ Web ページ (GitHub Pages, issue #28)

**公開 URL: <https://autodevjapan.github.io/GoDD-Matrix/>**

ブラウザだけで動く**完全クライアントサイド**の静的サイト。サーバ / サーバレス関数を
持たないため、リクエスト課金や濫用リスクがない (閲覧者自身のブラウザで動くだけ)。

- **データ取得**: 公開 Design-Systems の `index-summary.json`（raw main）を先読みし、件数・
  ファセットを `index.json` 無しで描画する (issue #88 / DS `index-paging` / ADR-0003)。
  初回ブート中（summary 到着前）は件数を `0` と出さず「読み込み中… / Loading…」と表示する (issue #94)。
  明細の正本は GitHub Release タグ `index-pages` の `{n}.json`。Release asset はブラウザ
  CORS 非対応のため、Pages デプロイ時に同オリジンへミラー同期して取得する。シャード取得
  失敗時のみ非推奨ログ付きで `index.json` 全件へフォールバックする。`DESIGN.md` は
  `raw.githubusercontent.com` から直接 fetch。JSIC コード→業種名は Matrix にバンドル済みの
  `src/axes/jsic-catalog.ts` (全 1,473 件)、カラー/ムード slug の表示名は
  `src/axes/taxonomy.ts` を利用。
- **検索/絞り込み**: 左サイドバーでカテゴリ・スタイル・業種（JSIC 大分類）・色合い（系統）
  を絞り込み、自由文検索と併用できる。色フィルタは具体色ではなく色合いキーで展開するため、
  選択直後に 0 件やグレー偏りになりにくい。表示件数は 10〜1000 をユーザーが選択可能。
  結果カードはタイトルで方向性を示し、業種タグで差分を表示する。色軸だけが違う
  カードは小さなスウォッチと短い色系統ラベルで区別する (issue #97。タイトルや日付フッタには色を戻さない)。
- **プロンプト合成 + コピペ**: 材化済みセルは公開 raw URL から DESIGN.md 本文を取得し、
  index の SHA-256 とブラウザ内で照合する。仮想セルは決定論的な standalone 仕様を
  ブラウザ内で合成し、`rendered` として区別する。取得不能な材化済みセルはエラーを明示し、
  未取得本文をコピーまたはダウンロードさせない。取得・合成できた本文は
  `src/prompt/synthesizePrompt` で system / user プロンプトへ組み込み、詳細画面から
  結合済みプロンプトをコピーまたはダウンロードできる。合成プロンプトには遵守事項・禁止事項・
  出力前チェックを含め、実運用でそのままエージェントへ渡せる品質を目指す。
  hash 不一致時は本文を保持したまま警告を表示し、リンク共有は本文の取得状態にかかわらず利用できる。
  ヘッダは GoDD Matrix ブランド（ロゴ / favicon 付き）。
- **仮想カタログ (issue #71 / #92)**: バージョン付き正準空間（カテゴリ×スタイル×JSIC×カラー×
  バリアント、v3 で約 196 億セル）をクライアントで定義する。件数は軸サイズの積で厳密に求め、
  安定な rank/unrank とクエリ束縛カーソルでページングする。未材化セルもローカル合成で
  表示でき、材化済みと軸が一致する場合は DESIGN.md を優先取得する。
  フィルタはバッジ式マルチセレクトで、アコーディオン内をスクロールして全選択肢を選べる。
- **共有可能な状態 (URL 同期)**: 検索・ファセット・ソート・カーソルに加え、選択セルを
  `?cell=<id>` として URL に反映する。遠いページ番号へのジャンプも同じカーソル契約で
  復元できる。「共有リンク」は現在の閲覧状態を含む URL をコピーする。
- **秘密は一切扱わない** (全て公開データ・クライアントサイド)。
- **Browser E2E**: `pnpm test:e2e` は全suiteのローカル実行。CI は同一リポジトリから `main` 向けのPRで、
  対象入力に変更がある場合に限り、
  `virtual-catalog.spec.ts` の全18ケースを固定buildに対して1回実行し、配信response上で修復を除く負例4種
  (色入力のselectionとstale、待機中deep linkのURL追跡、到着時のcolor editor保持)を既存quality job内で確認し、固定buildと証跡を1日保存する。
  合成fixtureを使うCIの確認と、本人ChromeでのPrd受入は区別する。
  buildはcompilerへ渡したimport入力とコピーしたHTML/CSS/assets、明示したweb tsconfigのextends、
  package/lockを捕捉する。CIは開始時にもtracked入力をHEADと照合し、同じdistのままsourceが変わっても拒否する。
  `web/src`と`src`の変更・未追跡ファイルも確認し、解決先になり得る新しいimportの追加を見落とさない。
  任意の生成catalogは内容を捕捉し、trackedである場合はHEADとも照合する。
  同条件のPRでは、同じquality jobの実data検査が固定版の全51729件をSHA/bytes/Git blobで
  照合してproduction consumerへ渡す。これらのbrowser／実data検査は `main` pushやfork PRでは実行しない。
  合成51729件の対照と実dataの結果を分け、実data検査の未実行・skip・失敗では通常artifactを発行しない。

### ローカルで動かす

```bash
pnpm build:web                       # web/dist/ に静的成果物を生成 (esbuild)
pnpm typecheck:web                   # web の型チェック (DOM lib)
pnpm test:e2e                        # Playwright (全suiteのローカル実行; CI は virtual-catalog spec のみ)
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

公開先はこの既存 Pages の **Prd のみ**。手動実行もこのリポジトリの `main` に限り、
他のブランチ・タグ・fork は静的ビルドと配備の両方をスキップする。
`github-pages` はこの Prd を供する GitHub 環境名として保持する。
旧 Vercel 用のコードは保持するが、`vercel.json` の Git 自動配備を無効にする。
配備範囲と機能の確認手順は [Prd の配備](documents/deployment/PRD.md) を参照。

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
  release/     正式配布物 (MCP) の生成と検査 (tar 読取 / 全本文の照合 / 成果物の自己検査)
  index.ts     公開エントリ
```

## MCP サーバ (GitHub ネイティブ提供形態)

既存パイプライン (軸決定 → index → DESIGN.md 解決 → プロンプト合成) を
[Model Context Protocol](https://modelcontextprotocol.io) の stdio サーバとして公開する。

### 正式配布物 (推奨)

`.github/workflows/mcp-artifact.yml` が、stdio MCP の配布物 (zip) を生成してビルド来歴 (attestation)
を付ける (手動実行、または生成物に関わる PR)。正式配布物は main からの手動実行で作ったもので、PR の実行が作る zip は
試験ビルドです (確認手順は下の「受け取った側の確認と登録」)。zip の中身:

| ファイル | 内容 |
| --- | --- |
| `main.js` | 依存を同梱した単一ファイルの stdio MCP サーバ (Node.js >= 20) |
| `snapshot.json` | DS の固定 snapshot (commit と、下の 3 ファイルのバイト同一性・件数) |
| `index.json` / `taxonomy.json` / `jsic.json` | 全セルの索引 (51,729 件)・色 / ムードの語彙 (299 / 69)・業種の語彙 (1,473 細分類) |
| `catalog-verification.json` | 生成時に、全本文 (DESIGN.md) を pin の commit と照合した記録 (件数のみ) |
| `LICENSE` / `THIRD-PARTY-LICENSES.txt` | 本体と、同梱した依存のライセンス |
| `SHA256SUMS` | 上記すべての sha256 (`sha256sum -c SHA256SUMS` で確認できる) |

束縛と検証:

- **生成時**: `index.json` / `taxonomy.json` / `jsic.json` を pin (bytes / sha256 / git blob / 件数) に照合する。
  さらに pin の commit の tarball を 1 パスで読み、index の全エントリについて本文が存在し、
  生バイトの sha256 が `entry.hash` に一致することを確かめる。欠落・不一致・重複が 1 件でもあれば成果物を作らない。
- **起動時**: 同梱ファイルを pin に再照合してから解釈する。不一致なら理由を出して起動しない
  (環境変数指定の従来動作へ黙って戻らない)。
- **実行時**: DESIGN.md 本文は取得のたびに `entry.hash` と照合し、不一致は拒否する。取得先は pin の commit に
  固定した raw URL で、`GODD_DS_BASE` で変えても検証は外れない。
- **対象外**: Generator (`GENERATOR_RENDER_URL` / `GENERATOR_RENDER_API_KEY`) を設定すると、index に無い組合せ
  (未材化セル) の本文を外部から得て `provenance: "rendered"` で返す。この本文は pin の検証対象ではない
  (検証するのは index に載る材化済みの本文だけ)。結果の `snapshot` は pin (軸と index) の出所で、rendered の本文の出所ではない。
- 3 ツール (`compose` / `decide_axes` / `select_cells`) とも、結果の `snapshot` に検証済みの出所
  (commit と index / taxonomy / jsic の sha256) を載せる。pin なしの従来構成では `snapshot` キー自体を付けない。

#### 受け取った側の確認と登録

この版のサーバーは [run `44655701843`、attempt `1` の ZIP（artifact `14593605352`）](https://github.com/AutoDevJapan/GoDD-Matrix/actions/runs/44655701843/artifacts/14593605352)です。初めて取得する場合は GitHub にサインインし、リポジトリの読み取り権限があるアカウントで ZIP のまま保存します。Codex と Claude Code で同じ ZIP を使います。
別の版を使うときは、先に[プランナーの受領手順](documents/mcp-formal-host-registration.md)に従ってプランナーを取得してください。`--release-info` 対応版では、展開先で次のどちらかを実行すると、その版のサーバーの `artifactUrl`、run・attempt・コミット、ZIP 名・サイズ・SHA-256、記録時の保持期限を表示します。あらかじめ `NODE_BIN`（Bash）または `$NodeBin`（PowerShell）に、そのホストで使う Node.js 20 以上の実行ファイルの絶対パスを設定します。

```bash
"$NODE_BIN" scripts/plan-mcp-hosts.mjs --release-info
```

```powershell
& $NodeBin .\scripts\plan-mcp-hosts.mjs --release-info
```

[MCP artifact の実行一覧](https://github.com/AutoDevJapan/GoDD-Matrix/actions/workflows/mcp-artifact.yml)で記載の `main` の手動実行が成功し、同じ ID・名前・digest の ZIP が保持期間内にあることを確認してください。`--release-info` を持たない旧プランナーでも、対応するソースの `FORMAL_MCP_RELEASE` で配布元の識別子と ZIP のハッシュを確認できます。
ZIP を保存したディレクトリで、ZIP の SHA-256、ビルド来歴、展開したファイルのチェックサムを順に確認してください。以下は上記の artifact `14593605352` を `gh`、`sha256sum`、`unzip` で検証する Bash の例です。後継版は、その版を指定するレビュー済みプランナーのコミットと SHA-256 を使います。

```bash
sha=ece931cb71c191ab1b977629e3fdac1846bb07d1
archive="godd-matrix-mcp-${sha}.zip"
printf '%s  %s\n' 14fd21b3e610b0cf7b307eb7746dd9d4ae99c4fb7744722f6c9296f096bb20e3 "$archive" | sha256sum -c - &&
  gh attestation verify "$archive" --repo AutoDevJapan/GoDD-Matrix \
    --signer-workflow AutoDevJapan/GoDD-Matrix/.github/workflows/mcp-artifact.yml \
    --source-ref refs/heads/main --source-digest "$sha" &&
  mkdir matrix-consumer && unzip "$archive" -d matrix-consumer &&
  (cd matrix-consumer/godd-matrix-mcp && sha256sum -c SHA256SUMS)
```

ZIP 名の `<sha>`（上の例の `$sha`）は、その実行がビルドしたコミット (`GITHUB_SHA`) です。実行の種類で、確認に使う値が変わります。

| 実行 | `--source-ref` | `<sha>` | 扱い |
| --- | --- | --- | --- |
| `main` からの手動実行 (`workflow_dispatch`) | `refs/heads/main` | main のコミット | 正式配布物 |
| PR の実行 (生成物に関わる同一リポジトリの PR) | `refs/pull/<N>/merge` | PR の merge ref の合成コミット (PR の head でも main でもない) | 試験ビルド。配布しない |

`--repo` だけの確認は、PR の試験ビルドにも成功します。試験ビルドを正式配布物と取り違えないよう、
`--signer-workflow` / `--source-ref` / `--source-digest` で、署名した workflow とビルド元の ref・コミットまで
固定して確認します。これらのフラグは gh のバージョンによっては無いので、`gh attestation verify --help` で
確認してください ([gh attestation verify の手引き](https://cli.github.com/manual/gh_attestation_verify))。

登録用プランナーは [CI の実行一覧](https://github.com/AutoDevJapan/GoDD-Matrix/actions/workflows/ci.yml)から、レビュー済みの `main` コミットを選んで取得します。そのコミットの `src/release/host-registration.ts` で、`FORMAL_MCP_RELEASE` の配布元と ZIP の SHA-256、`FORMAL_MCP_FILES` の9ファイルのサイズとハッシュが、受領したサーバーのものと一致することを確かめてください。
[プランナーの受領手順](documents/mcp-formal-host-registration.md)に従い、同じ run ID・attempt の品質ジョブが `completed/success` で、プランナーの準備とアップロードも成功していることを確認します。
保持期間内の `godd-matrix-planner-<checkout-sha>-<attempt>` が1件だけあることを確かめ、その ID で取得した ZIP の SHA-256 を Actions の digest と照合します。次に `SOURCE.json` のコミット・run・attempt、8ファイルの構成、7件のチェックサムを確認します。

このサーバー ZIP の Actions 保持期限は 2026-12-04 01:44:06 UTC、同じ9ファイルを対象とした[プランナーの配布例](https://github.com/AutoDevJapan/GoDD-Matrix/actions/runs/45218109910/artifacts/14838598556)の保持期限は 2026-12-07 16:35:31 UTC です。サーバー ZIP の保持期限後も、期限内に受け取って署名とハッシュを検証した同一の ZIP を使えます。
初めて取得する時点でサーバー ZIP が失効・削除されていれば、その ID からは取得できません。後継の正式版を使うには、その版の取得元とハッシュを指定したレビュー済みプランナーと、対応する `main` の手動実行が必要です。両方が案内されるまでは新規登録を保留してください。

1. プランナーに同梱の `documents/mcp-formal-module-scope.package.json.template` を、上で作った `matrix-consumer` の直下に `package.json` としてコピーします。末尾の LF を含む18バイトを保つと、Node.js は直下の `godd-matrix-mcp/main.js` を ES モジュールとして読み込めます。
2. プランナーを展開したディレクトリで、次の例の3つのパスを実際の絶対パスに置き換えて実行します。指定するのは、そのホストで使う Node.js 20 以上の実行ファイル、`main.js` があるディレクトリ、Matrix を使うプロジェクトのルートです。配布例のプランナーを使う場合は、サーバーのディレクトリの末尾に区切り文字を付けません。

   **macOS・Linux（Bash、表示に `jq` を使用）**

   ```bash
   NODE_BIN='/usr/local/bin/node'
   ARTIFACT_DIR='/home/user/matrix-consumer/godd-matrix-mcp'
   PROJECT_DIR='/home/user/my-project'
   (
     plan=$("$NODE_BIN" scripts/plan-mcp-hosts.mjs --node "$NODE_BIN" --platform posix \
       --artifact-dir "$ARTIFACT_DIR" --project-dir "$PROJECT_DIR") &&
       jq -ej '.codexProjectToml | strings' <<<"$plan" &&
       jq -e '.claudeProjectJson | fromjson | objects' <<<"$plan"
   )
   ```

   **Windows（PowerShell）**

   ```powershell
   $NodeBin = 'C:\Program Files\nodejs\node.exe'
   $ArtifactDir = 'C:\matrix-consumer\godd-matrix-mcp'
   $ProjectDir = 'C:\work\my-project'
   $savedEncoding = [Console]::OutputEncoding
   try {
     [Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
     $raw = & $NodeBin .\scripts\plan-mcp-hosts.mjs --node $NodeBin --platform win32 --artifact-dir $ArtifactDir --project-dir $ProjectDir
     if ($LASTEXITCODE -ne 0) { throw 'プランナーの出力を確認できませんでした。' }
     $plan = ($raw -join "`n") | ConvertFrom-Json -ErrorAction Stop
     $claude = $plan.claudeProjectJson | ConvertFrom-Json -ErrorAction Stop
     $plan.codexProjectToml                 # Codex 用の TOML
     $claude | ConvertTo-Json -Depth 10     # Claude Code 用の JSON
   } finally { [Console]::OutputEncoding = $savedEncoding }
   ```

3. プランナーはサーバーの9ファイルと親の `package.json` を照合し、2つの設定を文字列として1つの JSON にまとめます。上の例では外側の JSON を解析し、`codexProjectToml` はデコードした TOML 本文として、`claudeProjectJson` はさらに JSON として解析して表示します。設定には、この表示結果を使います。

   - **Codex** では、表示した TOML を信頼済みプロジェクトの `.codex/config.toml` に取り込みます。ファイルがなければこの本文で作成します。`[mcp_servers."godd-matrix-formal"]` と `[mcp_servers."godd-matrix-formal".env]` は各1つだけにし、既存テーブルには該当キーを照合して必要な値だけを反映します。
     同名登録が HTTP なら、その登録にある HTTP 専用のキー（`url`、`bearer_token_env_var` など）と子テーブル（`http_headers`、`oauth` など）を取り除き、接続設定を生成案の `command`・`args`・`cwd`・`env` に入れ替えます。ツールの承認や利用制限など、両方式に共通する設定は引き継ぎます。
   - **Claude Code** はプロジェクト直下の `.mcp.json` の `mcpServers` に、表示した JSON の `mcpServers` から `godd-matrix-formal` の項目だけを取り込みます。同名の項目がすでに stdio なら、該当する値だけを更新します。HTTP など別方式なら、その項目の `url`・`headers` など旧方式の接続設定を取り除き、生成案の `"type": "stdio"`・`command`・`args`・`env` に入れ替えます。ファイルを新規作成する場合は、表示した JSON 全体を使えます。

   Codex に取り込む前に、実際に使う作業ディレクトリ・プロファイルで[有効になる設定レイヤー](https://learn.chatgpt.com/docs/config-file/config-basic#configuration-precedence)を確認します。
   ユーザー設定（`$CODEX_HOME/config.toml`、既定は `~/.codex/config.toml`）、選択したプロファイル（`$CODEX_HOME/<名前>.config.toml`）、信頼済みプロジェクトのルートから作業ディレクトリまでの `.codex/config.toml` をたどります。適用中のシステム・管理設定や起動時の `-c` 指定も含め、`mcp_servers.godd-matrix-formal` に `url` や `http_headers` などの HTTP 専用キーがあるかをキー名で調べ、定義元を特定します。
   同名テーブルはキーごとに統合されるため、ユーザー設定の `url` とプロジェクトの `command` が両方残ると、設定を読み込めません。編集権限があり、他のプロジェクトの利用を壊さずに変更できる元定義だけを stdio に移行します。共有・管理設定に変更できない旧定義があれば、衝突が解決するまでこの登録を起動しません。
   解消後は同じ作業ディレクトリで次の3項目を設定案と照合します（Bash と `jq`）。利用時に `--profile` や `-c` を指定している場合は、下の `codex` と `mcp` の間にも同じ指定を入れます。

   ```bash
   (
     set -o pipefail
     codex mcp get godd-matrix-formal --json |
       jq -e 'select(.enabled == true) | .transport
              | select(.type == "stdio" and .env.GODD_DS_SNAPSHOT != null)
              | {command, args, GODD_DS_SNAPSHOT: .env.GODD_DS_SNAPSHOT}'
   )
   ```

   Claude Code では、プロジェクト直下の `.mcp.json` と[同名登録の優先順位](https://code.claude.com/docs/en/mcp#scope-hierarchy-and-precedence)を確認し、有効なスコープの `godd-matrix-formal` にある `command`、`args`、`env.GODD_DS_SNAPSHOT` を個別に設定案と照合します。接続状態は `/mcp` でこのサーバーを選んで確認します。他のサーバーや既定の承認・権限はそのまま保持します。

正式版の登録名は両方とも `godd-matrix-formal` です。`godd-matrix` をすでに登録している場合も、既存の設定を残したまま追加できます。
この設定では同じ `main.js` と固定版の snapshot・索引を使い、DESIGN.md の取得先を固定コミットに合わせます。Generator の URL・API キーと `NODE_OPTIONS` はサーバーの起動時に空にします。

### 開発用 (pin なし)

```bash
pnpm build
GODD_DS_INDEX=./path/to/index.json node dist/mcp/main.js   # bin: godd-matrix-mcp
pnpm package:mcp --out ./out/godd-matrix-mcp                # 正式配布物を手元で生成 (要 pnpm build)
```

pin なしの従来構成は、軸の語彙が組込みの最小表 (色 6 件 / ムード 5 件。業種は同梱の全 1,473 細分類) で、
本文の hash 検証も強制しない。実カタログ (色 299 / ムード 69) を引けるのは正式配布物 (pin 指定) のみ。
正式配布物 (pin 指定) は、この最小表の別名 (例: 色の「ブルー」→ `h17b-lt`、ムードの「シンプル」→ `minimal`) を使わない。

### 環境変数

| 変数 | 必須 | 説明 |
| --- | --- | --- |
| `GODD_DS_SNAPSHOT` | | `snapshot.json` (pin) の場所。未指定なら `main.js` の隣の `snapshot.json`。指定した pin が無い / 不正なら起動しない。 |
| `GODD_DS_INDEX` | ○ (pin なし) | Design-Systems `index.json` の取込元 (ローカルパス / file: / http(s) URL)。正式配布物では同梱の `index.json` を使うため不要。配布物の `snapshot.json` が無い状態でこれを設定すると、pin の検証なしの従来動作で起動する (stderr に「pin なし」と出る)。 |
| `GODD_DS_BASE` | | DESIGN.md 本文の解決 base。未指定なら (pin 指定時) pin の commit の raw URL、(pin なし) `GODD_DS_INDEX` の所在から推定。 |
| `GENERATOR_RENDER_URL` | | 未材化セル (index に無い軸の組合せ) の Generator レンダー API ベース URL。**配布物でも**、設定すると、その組合せの `compose` が `POST <URL>/render` で軸の JSON (`jsic` / `color` / `mood`、あれば `tags`) を外部へ送る。返る本文は `provenance: "rendered"` で、pin の検証対象ではない。未設定なら未材化は `unavailable`。 |
| `GENERATOR_RENDER_API_KEY` | | 同 API の認証キー (`x-api-key` ヘッダ)。`GENERATOR_RENDER_URL` と両方揃った場合のみ有効。 |

### 公開ツール (tools/list)

| tool | 概要 |
| --- | --- |
| `godd_matrix_compose` | 要望 (業種/カラー/ムード) → 確定軸 → DESIGN.md 解決 → Claude 用プロンプト (system/user) 合成。 |
| `godd_matrix_decide_axes` | 要望 → 各軸 (JSIC/カラー/ムード) の解決 (確定 context / 未解決軸 / 候補)。副作用なし。 |
| `godd_matrix_select_cells` | 要望 → 確定軸 → index に一致する候補セル。 |

各ツールは共通入力 `{ industry: string; color?: string; mood?: string; tags?: string[] }` を受け取る。
未解決軸がある場合、`compose` はプロンプトを合成せず候補を提示して `isError` を返す。

- 3 ツールとも環境を変更しない参照系で、`readOnlyHint: true` / `destructiveHint: false` /
  `idempotentHint: true` を宣言する (承認を要求するかどうかを決めるホストがこの注釈を読む)。
  外部 (本文の raw URL、設定時は Generator) を読む `compose` だけ `openWorldHint: true`。Generator を設定した場合、
  これらの注釈は「その Generator が環境を変えず、同じ入力に同じ結果を返す」前提の宣言になる。
  注釈が無いと、承認ポリシーが `never` の Codex (`codex exec`, 0.167.0 で確認) は呼び出しを
  `MCP tool call requires approval, but approval policy is never` として拒否する。
- カラー / ムードは、DS の slug (例: `lt-h17` / `trustworthy`) または日英の名称で指定する。
  slug と JSIC コードは完全一致で常に 1 件に確定する。同じ名称を複数の slug / 細分類が共有する曖昧な入力
  (例: 「ライトトーンの青」) は、任意の 1 件を選ばず未解決にして候補を返すので、候補の slug で再実行する。
  語彙のどの名称・slug にも一致しない日常語は、近い語を当てずに候補 0 の未解決になる
  (現在の pin の例: 色の「ブルー」「ネイビー」、ムードの「シンプル」「上品」「クール」)。DS の slug か、語彙にある名称で指定する。
- index に無い軸の組合せ (未材化セル) は、Generator (`GENERATOR_RENDER_URL` / `GENERATOR_RENDER_API_KEY`)
  が設定されていなければ `unavailable` として明示する (軸情報だけでプロンプトを合成し、本文は捏造しない)。
  設定されていれば、その Generator へ軸の JSON を送り、返った本文を `provenance: "rendered"` で返す
  (pin の検証対象外。結果の `snapshot` は pin のまま付く)。

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

## 事業者情報の開示請求（2026-10-10）
販売者は AutoDevJapan、問い合わせ先は contact@autodevjapan.com を保持する。
氏名・所在地・電話番号の正式情報をこのリポジトリに複製せず、常時掲載しない。
既存の法的ページ・購入前条件欄、または法的ページのない公開サイトの共通フッターから
[事業者情報の開示請求](https://autodevjapan.com/api/disclosure)へ案内する。
メールでの開示請求も受け付ける。請求処理と正式原本は共通の公式サイトが管理する。
この変更は表示導線のみであり、本番POSTの受入、実課金、販売開始を完了扱いしない。
親ToDo2174が正式原本と本番POSTを受け入れるまで、導線のPRは下書きで保持する。

## ライセンス

本リポジトリのコードは、`package.json` の既存表記と同じ [MIT License](LICENSE) で提供します。
外部から取得する GoDD-Design-Systems のカタログ・`DESIGN.md`、配信されるフォント、
依存パッケージには、それぞれの配布元のライセンス・出典表示が適用されます。
本リポジトリのライセンスは、それらの利用条件や表示義務を置き換えません。

業種の語彙 (`jsic.json`) は、総務省の「日本標準産業分類」(第14回改定) を出典とする公的分類です。`jsic.json` の
`meta.source` に、出典 (総務省 / e-Stat) と、二次利用は政府標準利用規約 (CC BY 4.0 互換) に準拠する旨が記載されています。
正式配布物はこのファイルをバイト同一で同梱するので、再配布するときは `meta` を削らずに保持してください。
