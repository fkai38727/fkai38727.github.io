# N/F Project Board

N と F の2人で使う、GitHub Pages向けの静的プロジェクト管理ボードです。

## できること

- プロジェクト作成、担当、締切、状態、メモの登録
- タスク登録、締切、URL、担当者割り当て、N/F別一覧
- カレンダーで Available / Maybe / Busy の登録
- タイムカード登録と今月の合計時間
- URL置き場
- アイデアメモ置き場
- 簡易パスワードロック
- JSONエクスポート / インポート

## ゼロ円運用の前提

このアプリはサーバーやデータベースを使いません。データは開いたブラウザの `localStorage` に保存されます。

- 月額費用: 0円
- 外部DB: なし
- ログイン: なし
- 自動同期: なし

N と F が別々の端末で使う場合は、画面右上の `Export` と `Import` でJSONを共有してください。リアルタイム同期が必要な場合は、別途データ保存先が必要になります。

## Google Driveに保存したい場合

Google Drive for desktopを使っている場合は、`Export` 時の保存ダイアログでGoogle Driveの同期フォルダを選べます。`Import` では、そのフォルダにあるJSONを選んで読み込めます。

保存先を選ぶ機能に対応していないブラウザでは、通常のダウンロード先にJSONが保存されます。その場合は、保存後にGoogle Driveへ移動してください。

## パスワード

初期パスワードは `narai2001` です。変更したい場合は `project-board/app.js` の `BOARD_PASSWORD` を書き換えてください。

これは静的サイト向けの簡易ロックです。コードを読める人にはパスワードが見えるため、重要情報や機密情報の保護には使わないでください。

## GitHub Pagesで公開

このリポジトリの `.github/workflows/deploy-project-board.yml` が `project-board` フォルダだけをGitHub Pagesへ公開します。

1. GitHubで公開リポジトリを作成します。
2. このリポジトリを `main` ブランチへ push します。
3. GitHubの `Settings` → `Pages` を開きます。
4. `Build and deployment` の source を `GitHub Actions` にします。
5. `Actions` タブで `Deploy Project Board` が成功したら、PagesのURLで開けます。

## ローカルで開く

`index.html` をブラウザで開くだけで動きます。

```text
project-board/index.html
```
