# 共有データの手動削除（管理者向け）

`retention-admin.js` は管理者PCの `127.0.0.1` だけで開く簡易画面である。公開サイトには
管理権限もFirebase認証情報も置かない。共有ID（Firestore Console に見える64桁の文書ID）を
明示して確認し、同意した対象だけを削除する。

## 事前条件

1. `firestore.rules` をConsoleへ反映する。墓標を検知した旧端末の再作成を拒否するために必要。
2. 管理者PCで `npm ci --prefix functions` を実行する。
3. Firebase / Google Cloudの管理用サービスアカウント鍵を、PC上の安全な場所にだけ保存する。
   鍵をリポジトリや画面入力欄へ置かない。
4. PowerShellで鍵の場所を指定してから起動する。

```powershell
$env:GOOGLE_APPLICATION_CREDENTIALS = '安全な場所にあるサービスアカウント鍵.json'
node tools/retention-admin.js
```

画面に出た `http://127.0.0.1:8787/` を同じPCで開く。終了はターミナルで `Ctrl+C`。

## 操作

1. Firestore Console などで把握した `households` の64桁IDを貼る。
2. **削除候補を確認**し、最終活動と90日判定を確認する。暗号化された記録内容は表示しない。
3. 通常は90日経過した対象だけを削除する。期限前も削除する場合だけチェックを入れる。
4. 表示された `削除 N 件` を入力し、確認ダイアログにも同意する。

処理は各対象について、`household_tombstones/<ID>` の作成と
`households/<ID>` の削除を同じバッチで実行する。墓標は残るため、古いオフライン端末が
再接続しても元の共有IDを復活させられない。

## 費用と範囲

- Cloud Functions / Cloud Scheduler は使わない。管理者が実行したときだけFirestoreの読み書きが発生する。
- Firestoreの無料枠を超えなければ追加請求はないが、管理用APIの利用権限と鍵の保管責任は必要。
- `lastActivityAt` が未導入の既存文書では `configAt` / `stateAt` を参考表示する。端末時計由来なので、最終判断は管理者が行う。
- 端末内のlocalStorageや利用者が保存したJSONは、管理者PCから消去できない。墓標を検知した新しいアプリは、端末内の旧データを消し、新規登録へ案内する。
