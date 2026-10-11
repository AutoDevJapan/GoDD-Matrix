# GoDD-Matrix の Prd 配備

## 公開先と許可範囲

既存の https://autodevjapan.github.io/GoDD-Matrix/ だけを公開先として保持する。
AutoDevJapan/GoDD-Matrix（repository ID 1293650669）の `main` が配備元。
新しいサイトや Prd、Preview、dev、stg を作成しない。
GitHub 環境 `github-pages` は既存 Prd の配信に必要なため保持する。
環境名や過去の `production_environment: false` だけで非Prdとは判定しない。

## 再生成を防ぐ設定

- Pages の push は `main` のみ。手動実行も build / deploy の両ジョブで
  リポジトリ名と `refs/heads/main` を確認する。他ブランチ・タグ・fork はスキップする。
- GitHub 環境の配備許可も `main` の branch ポリシーだけに限定する。
- CI の pull_request は lint、型検査、単体テスト、ビルドのみで、配備しない。
- 旧 Vercel の deploy ワークフローは存在しない。HTTP MCP のコード・アダプターは
  成果物として保持するが、`vercel.json` の `git.deploymentEnabled: false` で
  Git からの自動配備を無効にする。手動で新しいホストを作る許可ではない。

設定の意味は [GitHub の job 条件](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax#jobsjob_idif)
と [Vercel の Git 配備設定](https://vercel.com/docs/project-configuration/git-configuration) に従う。

## 保持するデータと機能

Pages は `web/dist` の静的ファイルを配信する。公開カタログは
GoDD-Design-Systems の raw main の summary と `index-pages` Release が正本で、
Pages ビルド時に同一オリジンの `index/pages/` へシャードを複製する。
外部コーパスは別製品の共有データであり、この作業では変更・削除しない。
`DESIGN.md` は公開 raw URL から読み、仮想セルはブラウザ内で合成する。

サーバーDB、ユーザーアカウント、購入、OAuth、Webhook、Cron、課金ストレージは
この静的アプリにない。HTTP MCP の認証設定は未配備コードの設定であり、Pages の
ログイン機能ではない。GitHub Secrets は値を読まず、名前と件数だけを確認する。
外部の実リソースIDが確認できないものは作成・移行・削除しない。

ブラウザの保存対象は言語 `godd_locale` と表示件数 `godd_page_size`。
検索・ファセット・ソート・カーソル・選択セルは URL から復元する。
プロンプトのコピーと Markdown ダウンロードはクライアント内で行う。
オリジンとパスを変えないため、既存の設定や共有 URL を移行する必要はない。

## 受入確認

1. GitHub API の owner / repository ID、Pages 設定、実配備IDと SHA、commit の存在、
   成功ステータス、既存 URL の HTML を対応づける。
2. オーナーの Chrome で検索、絞り込み、詳細と合成プロンプト、コピー、
   ダウンロードを確認する。言語と表示件数は再読込後に復元し、選択セルは URL から復元する。
3. ログイン・購入・サーバー保存・DB復元は、`web/src/main.ts` と `web/src/index.html`
   および画面で機能がないことを確認して N/A と記録する。実決済は行わない。
4. 旧 development / preview の履歴は実配備先と状態を照合する。inactive 履歴と
   稼働リソースを区別し、取得失敗を不在とみなさない。必要なソースは Git に保持する。
5. PR の同じ head の CI と別モデルレビューを確認してから許可された手順でマージする。
   マージ後の Pages 配備 SHA と画面を再確認する。
6. 非 main の手動 Pages 実行が両ジョブをスキップし、新しい配備を作らないことを確認する。

実操作・非Prd不在・再生成なし・CI・レビュー・マージ後の確認結果は共有 ToDo #2387 の
製品別台帳 `remaining-products/results/GoDD-Matrix.json` に記録する。
台帳に未確認項目があれば、設定変更や受付だけで完了としない。
