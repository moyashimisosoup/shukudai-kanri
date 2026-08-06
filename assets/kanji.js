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

const LEARNED = new Set([...KANJI_G1, ...KANJI_G2]);

function isKanji(ch){
  const c = ch.codePointAt(0);
  return (c >= 0x4E00 && c <= 0x9FFF) || (c >= 0x3400 && c <= 0x4DBF);
}

/* まだ習っていない漢字を、重複なく出現順で返す */
function unlearnedKanji(text){
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
const KUROMOJI_BASE = 'https://unpkg.com/kuromoji@0.1.2';
const DICT_MB = 17;

let worker = null;
let workerPromise = null;
let seq = 0;
const pending = {};

/* 辞書をまだ持っていないか。初回の読み込みを事前に知らせるために使う */
function needsDictDownload(){ return !worker; }
function dictSizeMB(){ return DICT_MB; }

function ensureWorker(){
  if(worker) return Promise.resolve(worker);
  if(workerPromise) return workerPromise;

  workerPromise = new Promise((resolve, reject)=>{
    if(typeof Worker === 'undefined'){
      reject(new Error('この ブラウザでは つかえません')); return;
    }
    let w;
    try{ w = new Worker('assets/kanji-worker.js'); }
    catch(e){ workerPromise = null; reject(new Error('じしょが よみこめません')); return; }

    // 17MB の取得と展開。回線が細いと数分かかることがある
    const timer = setTimeout(()=>{
      workerPromise = null; try{ w.terminate(); }catch(e){}
      reject(new Error('時間が かかりすぎました'));
    }, 300000);

    w.onmessage = ev=>{
      const m = ev.data || {};
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

    w.postMessage({
      type:'init',
      libUrl: KUROMOJI_BASE + '/build/kuromoji.js',
      dicPath: KUROMOJI_BASE + '/dict/'
    });
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
