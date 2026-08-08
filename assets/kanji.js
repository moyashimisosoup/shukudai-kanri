/* =========================================================
   kanji.js — 小2までに習う漢字の判定と、書き写し用の変換
   =========================================================
   感想を音声入力すると小3以上の漢字が混ざるため、紙の記録カードへ
   書き写せるように、習っていない漢字をひらがなへ直す。

   変換には形態素解析（kuromoji.js）が要る。CDN から遅延読み込みし、
   読み込めなかった場合は「習っていない漢字を目印で示す」だけに
   フォールバックする。オフラインでも記録自体は必ずできる。
   ========================================================= */

/* 小学1年 80字 */
const KANJI_G1 =
  '一右雨円王音下火花貝学気九休玉金空月犬見五口校左三山子四糸字耳七車手十出女小上' +
  '森人水正生青夕石赤千川先早草足村大男竹中虫町天田土二日入年白八百文木本名目立力林六';

/* 小学2年 160字 */
const KANJI_G2 =
  '引羽雲園遠何科夏家歌画回会海絵外角楽活間丸岩顔汽記帰弓牛魚京強教近兄形計元言原戸' +
  '古午後語工公広交光考行高黄合谷国黒今才細作算止市矢姉思紙寺自時室社弱首秋週春書少' +
  '場色食心新親図数西声星晴切雪船線前組走多太体台地池知茶昼長鳥朝直通弟店点電刀冬当' +
  '東答頭同道読内南肉馬売買麦半番父風分聞米歩母方北毎妹万明鳴毛門夜野友用曜来里理話';

let readingGrade = 2;
let LEARNED = new Set([...KANJI_G1, ...KANJI_G2]);

/* 表示に使う「読める漢字」の学年。9 は漢字をそのまま表示する設定。 */
function setReadingGrade(grade){
  const g = Number(grade);
  readingGrade = [0,1,2,9].includes(g) ? g : 2;
  LEARNED = new Set(readingGrade === 0 ? '' : readingGrade === 1 ? KANJI_G1 : KANJI_G1 + KANJI_G2);
}
function getReadingGrade(){ return readingGrade; }

function isKanji(ch){
  const c = ch.codePointAt(0);
  return (c >= 0x4E00 && c <= 0x9FFF) || (c >= 0x3400 && c <= 0x4DBF);
}

/* まだ習っていない漢字を、重複なく出現順で返す */
function unlearnedKanji(text){
  if(readingGrade === 9) return [];
  const out = [];
  const seen = new Set();
  for(const ch of String(text || '')){
    if(isKanji(ch) && !LEARNED.has(ch) && !seen.has(ch)){ seen.add(ch); out.push(ch); }
  }
  return out;
}

function kataToHira(s){
  return String(s || '').replace(/[ァ-ヶ]/g, c =>
    String.fromCharCode(c.charCodeAt(0) - 0x60));
}

/* --- 形態素解析はワーカーの中だけで動かす --- */

/* 辞書はこのサイトに同梱してある。外部の CDN に置いていたころは、
   応答が 0バイトで返る・極端に遅いといった事故で読み込めなくなった。
   ワーカーからは相対パスが解決できないので、絶対 URL にして渡す */
/* 基準はページの URL ではなく、この kanji.js 自身の置き場所にする。
   ページ側を基準にすると、末尾のスラッシュが無い URL（ホーム画面に
   追加したときなど）で 1つ上の階層に解決され、404 になる */
const ASSET_DIR = new URL('.',
  (typeof document !== 'undefined' && document.currentScript)
    ? document.currentScript.src
    : location.href).href;
const KUROMOJI_LIB  = ASSET_DIR + 'kuromoji.js';
const KUROMOJI_DICT = ASSET_DIR + 'dict/';
const DICT_CACHE = 'kanji-dict-v1';
const DICT_FILES = 12;
const DICT_MB = 18;

/* 何も進まないまま この時間が過ぎたら あきらめる。全体の制限時間にすると
   「遅いだけ」の回線を切ってしまうので、止まったときだけ打ち切る */
const STALL_MS = 60000;

let worker = null;
let workerPromise = null;
let seq = 0;
const pending = {};
let onDictProgress = null;

/* 読み込みの進み具合を受け取る。画面に出すのは app.js の仕事 */
function setDictProgress(fn){ onDictProgress = fn; }

/* このページで辞書を組み立て済みか */
function needsDictDownload(){ return !worker; }
function dictSizeMB(){ return DICT_MB; }

/* 端末に辞書が残っているか。残っていれば通信なしで開ける。
   「はじめの1回だけ」という案内を正しく出すために使う */
function dictOnDevice(){
  if(typeof caches === 'undefined') return Promise.resolve(false);
  return caches.open(DICT_CACHE)
    .then(c => c.keys())
    .then(keys => keys.length >= DICT_FILES)
    .catch(()=> false);
}

function ensureWorker(){
  if(worker) return Promise.resolve(worker);
  if(workerPromise) return workerPromise;

  /* ワーカーを作れるかどうかは、Promise を作る前に決めておく。
     executor の中で workerPromise を null に戻しても、直後の代入で
     上書きされてしまい、失敗した Promise を永久に返し続けることになる */
  if(typeof Worker === 'undefined'){
    return Promise.reject(new Error('この ブラウザでは つかえません'));
  }
  let w;
  try{ w = new Worker(ASSET_DIR + 'kanji-worker.js'); }
  catch(e){ return Promise.reject(new Error('じしょが よみこめません')); }

  workerPromise = new Promise((resolve, reject)=>{
    let timer = null;
    const giveUp = ()=>{
      workerPromise = null; try{ w.terminate(); }catch(e){}
      reject(new Error('とちゅうで とまってしまいました'));
    };
    const arm = ()=>{ clearTimeout(timer); timer = setTimeout(giveUp, STALL_MS); };
    arm();

    w.onmessage = ev=>{
      const m = ev.data || {};
      if(m.type === 'progress'){
        arm();                      // 1ファイル進むたびに待ち時間を数えなおす
        if(onDictProgress) onDictProgress(m);
        return;
      }
      if(m.type === 'ready'){
        clearTimeout(timer);
        if(m.ok){ worker = w; resolve(w); }
        else { workerPromise = null; try{ w.terminate(); }catch(e){} reject(new Error(m.error)); }
        return;
      }
      if(m.type === 'tokens'){
        const p = pending[m.id];
        if(!p) return;
        delete pending[m.id];
        m.ok ? p.resolve(m.tokens) : p.reject(new Error(m.error));
      }
    };
    w.onerror = ()=>{
      clearTimeout(timer); workerPromise = null;
      reject(new Error('じしょが よみこめません'));
    };

    w.postMessage({ type:'init', libUrl: KUROMOJI_LIB, dicPath: KUROMOJI_DICT });
  });
  return workerPromise;
}

function tokenizeInWorker(text){
  return ensureWorker().then(w => new Promise((resolve, reject)=>{
    const id = ++seq;
    pending[id] = { resolve, reject };
    w.postMessage({ type:'tokenize', id, text });
  }));
}

/* 習っていない漢字を含む語だけ、まるごとひらがなに置きかえる。
   「面白かった」→「おもしろかった」のように送りがなごと直るので、
   そのまま書き写せる。 */
function tokensToGrade2(tokens){
  return tokens.map(t=>{
    const sf = t.s;
    if(![...sf].some(isKanji)) return sf;
    if([...sf].every(ch => !isKanji(ch) || LEARNED.has(ch))) return sf;
    if(!t.r || t.r === '*') return sf;        // 辞書に読みがない語はそのまま
    return kataToHira(t.r);
  }).join('');
}

/* ぜんぶひらがなに直す。辞書が必要なのはこの関数だけ */
function convertForTranscription(text){
  const src = String(text || '').trim();
  if(!src) return Promise.resolve({ ok:true, text:'', unlearned:[] });

  const unlearned = unlearnedKanji(src);
  if(!unlearned.length) return Promise.resolve({ ok:true, text:src, unlearned:[] });

  return tokenizeInWorker(src)
    .then(tokens => ({ ok:true, text: tokensToGrade2(tokens), unlearned }))
    .catch(err => ({ ok:false, text:src, unlearned, reason: err.message }));
}

/* 習っていない漢字に印を付けた HTML。辞書がなくても すぐ出せる */
function markUnlearnedHTML(text){
  return [...String(text || '')].map(ch=>{
    const e = ch.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    if(ch === '\n') return '<br>';
    return (isKanji(ch) && !LEARNED.has(ch)) ? '<mark class="kj-x">' + e + '</mark>' : e;
  }).join('');
}
