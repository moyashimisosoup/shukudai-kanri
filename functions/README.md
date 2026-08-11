# 活動メタデータ記録（保持方針 第1段階）

`recordHouseholdActivity` は、`households/<houseId>` の暗号化済み `config` または
`state` が変わった時だけ、次の平文メタデータを記録する。

- `lastActivityAt`: Firestore イベントのサーバー時刻
- `expiresAt`: `lastActivityAt` の90日後
- `retentionVersion`: `1`
- `retentionEligibleAt`: 初回記録時点の90日後（以後は動かさない）

`devices` だけの更新、snapshot受信、Function自身のメタデータ更新は活動に数えない。
この段階では自動削除、墓標、警告、scheduled functionを実装していない。

## デプロイ前提と順序

Cloud Functions のデプロイには Firebase プロジェクトの **Blaze プラン**と、デプロイ担当者の
権限が必要になる。リージョンは `asia-northeast1`、ランタイムは Node.js 20 としている。

既存クライアントとの互換性を保つため、必ず次の順で公開する。

1. `firestore.rules` を先にデプロイする。
2. ルール反映を確認する。
3. `recordHouseholdActivity` をデプロイする。

Function を先に公開すると、旧ルールが新しいメタデータ欄を未知の欄として扱い、その後の
クライアント更新を拒否する可能性がある。

この変更でルートに `firebase.json` を新設した。今後、対象を指定しない `firebase deploy` は
FirestoreルールとFunctionsの両方をデプロイ対象にし得る。意図しない同時公開を避けるため、
段階導入中は `--only firestore:rules` または `--only functions:recordHouseholdActivity` を明示する。

現時点ではコードとテストを用意しただけで、Function はデプロイしていない。
