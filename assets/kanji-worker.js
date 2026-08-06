/* =========================================================
   kanji-worker.js — 形態素解析をメインスレッドから追い出す
   =========================================================
   kuromoji の辞書は 17MB を 95MB へ展開する。この展開と索引の構築は
   同期処理なので、メインスレッドでやると数秒間 画面が固まる。
   ワーカーに閉じ込めれば、読み込み中も画面は動く。
   ========================================================= */

let tokenizer = null;

self.onmessage = function (e) {
  const msg = e.data || {};

  if (msg.type === 'init') {
    if (tokenizer) { self.postMessage({ type:'ready', ok:true }); return; }
    try {
      importScripts(msg.libUrl);
    } catch (err) {
      self.postMessage({ type:'ready', ok:false, error:'じしょの プログラムが よみこめません' });
      return;
    }
    kuromoji.builder({ dicPath: msg.dicPath }).build(function (err, tk) {
      if (err) {
        self.postMessage({ type:'ready', ok:false, error:'じしょが よみこめません' });
        return;
      }
      tokenizer = tk;
      self.postMessage({ type:'ready', ok:true });
    });
    return;
  }

  if (msg.type === 'tokenize') {
    if (!tokenizer) {
      self.postMessage({ type:'tokens', id:msg.id, ok:false, error:'じしょが まだ ありません' });
      return;
    }
    // 表層形と読みだけ返す。判定はメイン側で行う
    const tokens = tokenizer.tokenize(msg.text).map(t => ({ s: t.surface_form, r: t.reading }));
    self.postMessage({ type:'tokens', id:msg.id, ok:true, tokens });
  }
};
