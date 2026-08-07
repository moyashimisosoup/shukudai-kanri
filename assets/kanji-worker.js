/* =========================================================
   kanji-worker.js — 形態素解析をメインスレッドから追い出す
   =========================================================
   kuromoji の辞書は 18MB を 95MB へ展開する。この展開と索引の構築は
   同期処理なので、メインスレッドでやると数秒間 画面が固まる。
   ワーカーに閉じ込めれば、読み込み中も画面は動く。

   辞書の取得は kuromoji 任せにせず、このファイルが引き受ける。理由は3つ。
     ・Cache API に残せば、2回目からは通信なしで開ける
     ・1ファイルずつ結果を返せるので、進捗を画面に出せる
     ・空の応答や壊れた応答を、その場でエラーとして返せる
       （kuromoji のままだと例外が投げっぱなしになり、build() が
        永久に返らず「待っているのか壊れたのか」が分からなくなる）
   ========================================================= */

const CACHE = 'kanji-dict-v1';   /* 辞書を差し替えたら番号を上げる */
const FILES = 12;                /* kuromoji が取りに行く辞書ファイルの数 */

let tokenizer = null;
let done = 0, bytes = 0, fromCache = 0;

/* --- 辞書1ファイルの取得。kuromoji から呼ばれる --- */

function cacheOpen(){
  /* http:// で開いていると caches が無い。その場合は毎回ネットから取る */
  if(typeof caches === 'undefined') return Promise.resolve(null);
  return caches.open(CACHE).catch(()=> null);
}

function gunzip(blob){
  /* サーバが .gz に Content-Encoding: gzip を付けて返すと、ブラウザが
     先に展開してしまう。その場合ここで展開すると二重展開で壊れるので、
     gzip の目印（1f 8b）が残っているかを見てから決める */
  return blob.slice(0, 2).arrayBuffer().then(head => {
    const b = new Uint8Array(head);
    if(b.length < 2 || b[0] !== 0x1f || b[1] !== 0x8b) return blob.arrayBuffer();

    /* ブラウザ内蔵の展開。kuromoji 同梱の zlib.js より速い */
    if(typeof DecompressionStream === 'function'){
      const stream = blob.stream().pipeThrough(new DecompressionStream('gzip'));
      return new Response(stream).arrayBuffer();
    }
    const zlib = self.__kuromojiZlib;
    if(!zlib) return Promise.reject(new Error('この ブラウザでは じしょを ひらけません'));
    return blob.arrayBuffer().then(ab =>
      new zlib.Zlib.Gunzip(new Uint8Array(ab)).decompress().buffer);
  });
}

function loadOne(url){
  return cacheOpen()
    .then(c => c ? c.match(url).catch(()=> null) : null)
    .then(hit => {
      if(hit){ fromCache++; return hit.blob(); }
      return fetch(url).then(res => {
        if(!res.ok) throw new Error('よみこみ失敗 (' + res.status + ')');
        return res.blob();
      }).then(blob => {
        /* 0バイトで 200 が返ることが実際にある。ここで弾かないと
           展開で例外になり、原因の分からない停止になる */
        if(!blob.size) throw new Error('じしょの ファイルが からっぽです');
        return cacheOpen()
          .then(c => c ? c.put(url, new Response(blob.slice())).catch(()=>{}) : null)
          .then(()=> blob);
      });
    })
    .then(blob => {
      bytes += blob.size;
      return gunzip(blob);
    })
    .then(buf => {
      done++;
      self.postMessage({ type:'progress', done, total:FILES, bytes, cached:fromCache });
      return buf;
    });
}

self.__kuromojiLoad = function(url, callback){
  loadOne(url).then(
    buf => callback(null, buf),
    err => callback((err && err.message) ? err.message : String(err), null)
  );
};

/* --- メインスレッドとのやりとり --- */

self.onmessage = function (e) {
  const msg = e.data || {};

  if (msg.type === 'init') {
    if (tokenizer) { self.postMessage({ type:'ready', ok:true, cached:true }); return; }
    done = 0; bytes = 0; fromCache = 0;
    try {
      importScripts(msg.libUrl);
    } catch (err) {
      self.postMessage({ type:'ready', ok:false, error:'じしょの プログラムが よみこめません' });
      return;
    }
    kuromoji.builder({ dicPath: msg.dicPath }).build(function (err, tk) {
      if (err) {
        self.postMessage({ type:'ready', ok:false, error:String(err) });
        return;
      }
      tokenizer = tk;
      /* 全部キャッシュから来たなら、次回以降も通信は起きない */
      self.postMessage({ type:'ready', ok:true, cached: fromCache === FILES });
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
