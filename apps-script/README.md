# Apps Script sync

このフォルダの `Code.gs` は、N/F Project Board と Google Sheets を同期するための Google Apps Script です。

## 使い方

1. Google Driveで Apps Script を新規作成します。
2. `Code.gs` の中身を Apps Script エディタへ貼り付けます。
3. `デプロイ` -> `新しいデプロイ` -> 種類は `ウェブアプリ` を選びます。
4. 実行ユーザーは `自分`、アクセスできるユーザーは `全員` にします。
5. デプロイ後に出る `ウェブアプリURL` を `project-board/app.js` の `SHEET_SYNC_URL` に入れます。

対象スプシ:

https://docs.google.com/spreadsheets/d/1HksG87TBRQv9sic0ZrHLbuuIxg6uDWG5WKPrsu1nsMU/edit

同期トークンは簡易ロックのパスワードと同じ `narai2001` です。静的サイトのコードに入るため、強い認証ではありません。
