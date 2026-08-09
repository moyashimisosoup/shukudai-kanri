# 宿題ノート：引き継ぎメモ（Claude / Codex 共用）

更新日: 2026-08-09（JST）

このメモは、AIエージェント（Claude Code / Codex）が交代で作業するための共有メモです。
作業を終えたら、変更点と「次に触る人がハマりやすい前提」をここへ書き足してください。

**このファイルは公開リポジトリに入っており、公開版サイトのURLからも読めます。**
追記した内容はそのまま一般に公開されます。次のものは絶対に書かないでください。

- 合言葉（同期用のパスフレーズ）の実物
- 子どもや家族の名前、学校名、宿題の記録内容などの個人情報
- APIキー・トークン・パスワードなどの秘密情報
- ローカルの絶対パス（`C:\Users\...` など。利用者名が含まれるため）

書いてよいのは、コードの構造・設計の意図・ハマりどころ・作業手順など、
「次に触る人が知らないと壊す前提」に限ります。

## 公開先・リポジトリ

- 公開版: https://moyashimisosoup.github.io/shukudai-notebook/
- 家庭用版: https://moyashimisosoup.github.io/shukudai-kanri/
- Git remote: `public-households` = 公開版、`origin` = 家庭用版
- 作業ブランチ: `codex/multi-household-public`（`public-households/main` を追跡）
- 最新コミット: `d0a17aa Keep the bottom tabs in place on iPad`

公開版・家庭用版のコードは同一です。変更は原則として両remoteの `main` へ push してください。

```bash
git push public-households HEAD:main && git push origin HEAD:main
```

## 現在の公開方式（重要）

公開版の GitHub Actions Pages デプロイが、古いデプロイを「進行中」と誤認して失敗しました。そのため公開版は現在、GitHub Pages の `main` ブランチ直配信（legacy）に切り替えています。`.nojekyll` を追加済みです。

- 公開版・家庭用版とも `main` への push で公開される
- `.github/workflows/pages.yml` は残っているため Actions の失敗通知が出る可能性がある。公開は直配信で正常なので、通知を止めたい場合は公開版でこの workflow を無効化/削除することを検討する

## 画面の作り（2026-08-09 に変更・要注意）

iPadOS Safari で `position: fixed` の下タブがスクロール中に浮いて途中で止まる不具合があったため、**ページ全体をスクロールさせない作り**に変更しました。ここを知らずに CSS を触ると崩れます。

```
body（縦フレックス・overflow:hidden・height:100%）
 ├ header.topband   … flex:none。sticky ではない
 ├ div#scroll       … flex:1 / overflow-y:auto。★スクロールするのはここだけ
 │   └ main#view    … 中身。app.js が innerHTML で描き替える
 └ nav.tabbar       … flex:none。fixed ではない
```

- スクロール位置の取得・復元は `window.scrollY` ではなく `assets/app.js` の `scrollBox()`（= `#scroll`）を使う
- 上帯・下タブに `position: fixed` / `sticky` を復活させない
- `body` に `padding-bottom` でタブ分の余白を入れる必要はない
- 印刷時のみ `@media print` で3段構造を解除している（解除しないと1ページで切れる）
- 副作用：スクロールしても Safari のアドレスバーが縮まない（ホーム画面追加のアプリ表示では元から影響なし）

## 直近の修正

1. iPad の下タブ固定（`d0a17aa`）
   - 上記「画面の作り」を参照

2. 連続記録の表示（`8bdefbe`）
   - 「1日 れんぞく」という不自然な表記をやめた
   - `assets/app.js` の `streakLabel()` / `streakLabelKanji()` に文言を集約
   - `streakOf()` は「今日がまだでも昨日までを数える」ため、`streak === 1` には
     「今日やった1日目」と「昨日やって今日はまだ」の2状態がある。`p.isDone` で判別する
   - 今日やった1日目は数やハートで達成が見えているのでバッジを出さない。
     「きのう できたね」→ 2日目以降「◯日 れんぞく」

3. ミニコンテンツの整理（`430f021`）
   - 「おもしろいことば」→「ことば」に改称し、デジャヴ／ドッペルゲンガー／
     カプグラ・デリュージョンを追加
   - 長い言葉：「〇〇学でつかう」をやさしい言い方に置換。宇宙ステーション「きぼう」と
     ユネスコを削除、スーパーノヴァ・レムナント・ネビュラと
     ポリテトラフルオロエチレンを追加
   - リュウグウノオトヒメノモトユイノキリハズシに「日本のことばの中でいちばん長いと
     いわれる」を追記
   - 漢字のなりたちに図を追加（次項）

4. 漢字のなりたち図（`430f021`）
   - `assets/kanji-origin.js` を新設。「もとの絵 → むかしの字 → いまの字」の3コマを
     インライン SVG で自前描画（16字）
   - 外部画像を使わないので著作権・オフラインの問題がない。線は `currentColor` なので
     テーマの色に追従する
   - `assets/data.js` のなりたち項目に `fig:'山'` のようなキーがあり、
     `app.js` の `kanjiOriginHTML()` が対応する SVG を差しこむ
   - 図を増やすときは `KANJI_ORIGIN` に `{pic, old}` を足し、data.js に `fig` を付ける

5. 全ミニコンテンツ確認画面
   - URL: `?debug=content#home`（旧 `?debug=trivia` も可）
   - 「OK」は画面から除外、「削除・再検討」は残し、選択内容をコピーしてAIへ渡せる
   - 判定はその端末の localStorage のみ。共有・外部送信はしない
   - `assets/app.js`: `DEBUG_CONTENT` / `contentDebugHTML()` / `K_TRIVIA_REVIEW` 付近

6. 宿題の記録シート
   - 何も選ばず保存しても、`0/6 に変更しました` のログを作らず達成カウンターも増やさない
   - `assets/app.js` の `saveSheet()` に空入力ガードあり

## 実装済みの主な仕様

- 初期設定: 子どもだけで使う / 保護者と共有する を選択。共有時だけ合言葉（8文字以上）を設定・読み込み
- 同期: Firebaseを使い、合言葉を知る端末間で設定と記録を共有。端末数表示あり
- 個人データ: 子どもの名前・宿題名・記録は端末/共有用Firebaseに保存。管理者側は登録家庭数のみ
- 子ども向け表示: 漢字レベルを初期設定・個別設定から変更可能
- 保護者ページ: 漢字表記固定。子どもへのメッセージ、共有接続、進捗サマリー、設定への導線あり
- テーマ: 端末ごとの設定ではなく、共有設定として同期する仕様
- 毎日項目: デフォルトは「おてつだい」。表示可否、単位（かい／ハート／任意）、並び順を設定可能
- 宿題・毎日項目とも上下ボタンで順番変更可能
- 読書は通常宿題と分けた「読書の記録」として扱う（既存データ互換を維持）
- ミニコンテンツ: なぞなぞ、まめちしき、ことば、頭のたいそう、名言、ことわざ、故事成語、
  むかしのことば、漢字のなりたち、めずらしい生きもの、よくわからないけれどかっこいい長い言葉。
  説明を見た後に次へ進める。宿題をした日は追加でもう1件読める

## 主要ファイル

- `index.html`: アセットのキャッシュバージョン、`#scroll` を含む画面の骨組み
- `assets/app.js`: 画面、状態、設定、記録、ミニコンテンツのUI
- `assets/data.js`: デフォルト設定、宿題サンプル、ミニコンテンツ `FUN`
- `assets/kanji-origin.js`: 漢字のなりたち図（インラインSVG）
- `assets/style.css`: レスポンシブUI、テーマ、iPhone/iPad向け調整
- `assets/sync.js`: Firebase同期・端末数
- `assets/kanji.js`: 漢字レベルに合わせた表示変換
- `.github/workflows/pages.yml`: Actions Pages（公開版では現在不要）

## 次に行う場合の注意

- iPhone/iPad の Safari ではキャッシュが強い。`app.js` / `data.js` / `style.css` / `kanji-origin.js` を
  変更したら `index.html` の `?v=` を更新する（現在 `20260809f`）
- `FUN` は配列の添字がそのまま localStorage の既読履歴・確認状態のキーになっている。
  項目を消す・並べ替えると既存端末の履歴が1つずつズレる（壊れはしないが出題順が乱れる）
- 既存家庭のデータ互換を守るため、`recordStyle:'book'`、`state.books`、`targetUnit` の
  保存形式は軽率に変更しない
- 設定や記録は同期済み家庭にも影響する。削除ではなく非表示・互換処理を優先する
- 上記「画面の作り」の前提（`#scroll` だけがスクロール）を崩さない

## 確認コマンド例

```bash
node --check assets/app.js
node --check assets/data.js
node --check assets/kanji-origin.js
git status --short --branch
```

ブラウザで見るときは、静的サイトなのでローカルの簡易HTTPサーバで `index.html` を開けば動きます。
初期設定を飛ばしたいときは、`localStorage` に `natsu.onboarding.v1 = 'done'` と
`natsu.device.name.v1` を入れてから再読み込みしてください。
