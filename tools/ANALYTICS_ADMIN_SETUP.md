# ローカル解析管理ページの再開メモ

状態: Cloudflare APIトークンは作成済み。管理PCでの環境変数設定待ち。

公開サイトやGitにはトークンを保存しない。管理PCで、次の環境変数を設定してから再開する。

```powershell
[Environment]::SetEnvironmentVariable('CF_API_TOKEN', '<Cloudflareの読み取り専用トークン>', 'User')
[Environment]::SetEnvironmentVariable('CF_ACCOUNT_ID', '<CloudflareのアカウントID>', 'User')
[Environment]::SetEnvironmentVariable('CF_ANALYTICS_HOST', 'moyashimisosoup.github.io', 'User')
```

設定後はPowerShellを開き直す。トークンの値をチャット、ソースコード、Gitに貼らないこと。

再開時の実装対象:

- `tools/analytics-admin.js`: 127.0.0.1だけで待ち受け、Cloudflare GraphQL APIへ問い合わせる。
- `tools/analytics-admin.html`: PV、訪問数、日別推移、ページ別、流入元、端末別を表示する。
- Firebaseの `metrics/registrations` は登録グループ数として併記する。家庭ごとの内容・合言葉は読まない。
