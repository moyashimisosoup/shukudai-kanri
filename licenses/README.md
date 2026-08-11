# licenses/

同梱している第三者の著作物のうち、**条文がそのファイル自身の中に入っていないもの**の
配布条件を、上流の配布物からそのまま持ってきて置いてあります。

条文がファイルの冒頭に入っているもの（`assets/vendor/qrcode.js`、`assets/kuromoji.js` など）は、
ここには置いていません。出自の一覧は [`../NOTICE`](../NOTICE) を見てください。

## mecab-ipadic-COPYING

`assets/dict/*.dat.gz`（形態素解析用の辞書）の配布条件です。

この辞書は kuromoji.js に付属していたもので、kuromoji の
[`kuromoji-ipadic/NOTICE.md`](https://github.com/atilika/kuromoji/blob/master/kuromoji-ipadic/NOTICE.md)
によれば `mecab-ipadic-2.7.0-20070801` から作られています。
そこで、その配布物そのものから `COPYING` を取り出して置きました。

| | |
|---|---|
| 出どころ | `mecab-ipadic-2.7.0-20070801.tar.gz` 内の `COPYING` |
| 取得元 | http://atilika.com/releases/mecab-ipadic/mecab-ipadic-2.7.0-20070801.tar.gz |
| 取得日 | 2026-08-11 |
| sha256 | `fca02d9adb601d101eccdf3131119abfff2d9c825ef5c759d7a89ebbaa972099` |
| 大きさ | 3,795 バイト |

権利者は奈良先端科学技術大学院大学（NAIST）ほか。辞書の項目の多くは
ICOT Free Software に由来し、その条件も同じ条文の中に書かれています。

### 中身をいじっていないことの確かめかた

    sha256sum licenses/mecab-ipadic-COPYING

上の表の値と一致すれば、上流の配布物と1バイトも違いません。
[taku910/mecab](https://github.com/taku910/mecab/blob/master/mecab-ipadic/COPYING)
にある同名のファイルとも一致することを確認しています。

### 2点、見てのとおりでない点

- **末尾に 2バイトのごみ（`0xF7 0xF7`）が付いています。** 上流の時点で入っているもので、
  EUC-JP の未定義領域にあたり、文字として意味を持ちません。取り除くと sha256 が
  合わなくなり「原文のまま」と言えなくなるので、あえて残してあります。
  そのためこのファイルは UTF-8 として読めません。テキストエディタが文字化けを
  報告することがありますが、条文の本文は ASCII だけでできています。
- **改行の自動変換をかけていません。** [`../.gitattributes`](../.gitattributes) で
  `licenses/**` を `-text` にしてあります。Windows で checkout しても LF のままです。
