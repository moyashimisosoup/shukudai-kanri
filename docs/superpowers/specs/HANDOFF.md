# 引継ぎ

最終更新: 2026年8月17日（v1.3.20 公開時点）

## いまの状態

- ブランチ `codex/multi-household-public` → `public-households/main` へ push 済み
- 公開版 **v1.3.20**、キャッシュ版 `20260817c`
- テスト **221件 全パス**（`node --test tests/*.test.js`）
- 作業ツリーは清潔。未公開の変更なし

## 公開手順（毎回これ）

1. `assets/app.js` の `RELEASE_VERSION`
2. `index.html` の `application-version` と `?v=` のキャッシュ版（style.css / app.js）
3. `package.json` と `package-lock.json`（2か所）
4. `start/updates.html` に履歴を1行足し、「バージョン番号の見方」の版も直す
5. `tests/sync-regression.test.js` の「公開版番号v…をそろえる」テストを更新
6. 全件テスト → `git push public-households codex/multi-household-public:main`

## テストの走らせ方（資源節約）

- 開発中は名前で絞る … `node --test --test-name-pattern '<語>' tests/sync-regression.test.js`
- 全件は**公開直前に一度だけ**（憲章 裁定の順序7、9章 Fail）

## 判断基準

憲章 [`docs/PRODUCT_POLICY.md`](../../PRODUCT_POLICY.md) の **5章「操作の手ごたえと確認」** が本文。要点だけ:

- 安全な操作に確認を挟まない（確認は「危険がある」と読まれる）
- 待てるものは聞かない（継ぎ目まで待てば中断の選択肢も要らない）
- 平常時の画面に要素を足さない
- 「元に戻す」は時系列ではなく場所（欄ごと）で持つ
- 失われないものを「失われる」と警告しない
- 既にある事実で判定できるなら、覚えることを増やさない
- 規則を破るときは規則を消さず、**理由つきの例外**として登録する

## 検査の型（実際に取り逃がした事象から）

- 単体で切り出す検査は**呼び出し経路の欠落を見つけられない**。「関数が正しい」と
  「関数が呼ばれる」は別。実機で通すまで分からない
- テストのハーネスが**既定値で本番の条件を回避していないか**疑う
- 検査スクリプトの結果は**数で妥当性を確かめる**（配当表の抽出ミスは字数で気づいた）

## 直近で入れた仕組み（触るとき注意）

| 仕組み | 場所 | 注意 |
|---|---|---|
| 版の自動取り込み | `checkForNewVersion` / `adoptNewVersionIfSafe` / `noticeAdopted` | 起動と前面復帰の継ぎ目でだけ動く。経過時間で止めない（起動直後に走るため無効化される）。ループ防止は `K_UPDATE_RELOADED_FOR` |
| 宿題編集の取り消し | `configTaskBase` / `TASK_FIELD_KEYS` / `refreshTaskRow` | 基準は**最初の変更の直前**に控える（`toggle` では取りこぼす）。`change` の分岐は `saveCfg()` だけで描き直さないものが多く、`refreshTaskRow` を呼ばないと印が出ない |
| 学年で言い方を変える | `grownUpWording()` / `wording()` / `PACE_MESSAGES_ADULT` | 小4以上と9（漢字のまま）が対象。**大人側の漢字は小4までの配当**に収める。例外は `STAMP_KANJI_EXCEPTIONS`（いまは「了」＝スタンプ「完了！」のみ） |
| 書きかけの保護 | `sheetInputsChanged` / `confirmLeaveSheet` / `popstate` | シートを開くとき履歴を1つ足す。閉じたら `history.back()` で回収 |

## 未処理

- なし（控え [`BACKLOG.md`](BACKLOG.md) は空）

## 保留中の外部作業

`start/` の漢字レベル説明を更新する背景タスクが別セッションで走っていた可能性がある。
**その内容は本セッションで対応済み**（説明の更新に加え、上帯を `nav-bar__inner` /
`nav-links` / `mobile-menu` へ差し替え）。同じファイルを重ねて編集すると巻き戻るため、
残っていれば止めること。
