/* SPDX-License-Identifier: Apache-2.0 */
/* =========================================================
   kanji.js — 習った漢字の判定と、書き写し用の変換
   =========================================================
   感想を音声入力するとまだ習っていない漢字が混ざるため、紙の記録カードへ
   書き写せるように、習っていない漢字をひらがなへ直す。

   学年は小1〜小6を選べる。しゅくだいノート本体は今のところ小2までしか
   使わないが（app.js の readingOptions）、「かなにする」は6年まで使う。

   変換には形態素解析（kuromoji.js）が要る。CDN から遅延読み込みし、
   読み込めなかった場合は「習っていない漢字を目印で示す」だけに
   フォールバックする。オフラインでも記録自体は必ずできる。
   ========================================================= */

/* --- 学年別漢字配当表（小学校学習指導要領・平成29年告示 別表） -----------
   1行が配当表の1行（20字）。表そのものと目で突き合わせられるように、
   並びも折り返しも原本に合わせてある。字数は表の括弧書きと同じ。
   出どころと検算のしかたは docs/kanji-grades.md を見てください。
   ------------------------------------------------------------------------ */

/* 小学1年 80字 */
const KANJI_G1 =
  '一右雨円王音下火花貝学気九休玉金空月犬見' +
  '五口校左三山子四糸字耳七車手十出女小上森' +
  '人水正生青夕石赤千川先早草足村大男竹中虫' +
  '町天田土二日入年白八百文木本名目立力林六';

/* 小学2年 160字 */
const KANJI_G2 =
  '引羽雲園遠何科夏家歌画回会海絵外角楽活間' +
  '丸岩顔汽記帰弓牛魚京強教近兄形計元言原戸' +
  '古午後語工公広交光考行高黄合谷国黒今才細' +
  '作算止市矢姉思紙寺自時室社弱首秋週春書少' +
  '場色食心新親図数西声星晴切雪船線前組走多' +
  '太体台地池知茶昼長鳥朝直通弟店点電刀冬当' +
  '東答頭同道読内南肉馬売買麦半番父風分聞米' +
  '歩母方北毎妹万明鳴毛門夜野友用曜来里理話';

/* 小学3年 200字 */
const KANJI_G3 =
  '悪安暗医委意育員院飲運泳駅央横屋温化荷界' +
  '開階寒感漢館岸起期客究急級宮球去橋業曲局' +
  '銀区苦具君係軽血決研県庫湖向幸港号根祭皿' +
  '仕死使始指歯詩次事持式実写者主守取酒受州' +
  '拾終習集住重宿所暑助昭消商章勝乗植申身神' +
  '真深進世整昔全相送想息速族他打対待代第題' +
  '炭短談着注柱丁帳調追定庭笛鉄転都度投豆島' +
  '湯登等動童農波配倍箱畑発反坂板皮悲美鼻筆' +
  '氷表秒病品負部服福物平返勉放味命面問役薬' +
  '由油有遊予羊洋葉陽様落流旅両緑礼列練路和';

/* 小学4年 202字 */
const KANJI_G4 =
  '愛案以衣位茨印英栄媛塩岡億加果貨課芽賀改' +
  '械害街各覚潟完官管関観願岐希季旗器機議求' +
  '泣給挙漁共協鏡競極熊訓軍郡群径景芸欠結建' +
  '健験固功好香候康佐差菜最埼材崎昨札刷察参' +
  '産散残氏司試児治滋辞鹿失借種周祝順初松笑' +
  '唱焼照城縄臣信井成省清静席積折節説浅戦選' +
  '然争倉巣束側続卒孫帯隊達単置仲沖兆低底的' +
  '典伝徒努灯働特徳栃奈梨熱念敗梅博阪飯飛必' +
  '票標不夫付府阜富副兵別辺変便包法望牧末満' +
  '未民無約勇要養浴利陸良料量輪類令冷例連老' +
  '労録';

/* 小学5年 193字 */
const KANJI_G5 =
  '圧囲移因永営衛易益液演応往桜可仮価河過快' +
  '解格確額刊幹慣眼紀基寄規喜技義逆久旧救居' +
  '許境均禁句型経潔件険検限現減故個護効厚耕' +
  '航鉱構興講告混査再災妻採際在財罪殺雑酸賛' +
  '士支史志枝師資飼示似識質舎謝授修述術準序' +
  '招証象賞条状常情織職制性政勢精製税責績接' +
  '設絶祖素総造像増則測属率損貸態団断築貯張' +
  '停提程適統堂銅導得毒独任燃能破犯判版比肥' +
  '非費備評貧布婦武復複仏粉編弁保墓報豊防貿' +
  '暴脈務夢迷綿輸余容略留領歴';

/* 小学6年 191字 */
const KANJI_G6 =
  '胃異遺域宇映延沿恩我灰拡革閣割株干巻看簡' +
  '危机揮貴疑吸供胸郷勤筋系敬警劇激穴券絹権' +
  '憲源厳己呼誤后孝皇紅降鋼刻穀骨困砂座済裁' +
  '策冊蚕至私姿視詞誌磁射捨尺若樹収宗就衆従' +
  '縦縮熟純処署諸除承将傷障蒸針仁垂推寸盛聖' +
  '誠舌宣専泉洗染銭善奏窓創装層操蔵臓存尊退' +
  '宅担探誕段暖値宙忠著庁頂腸潮賃痛敵展討党' +
  '糖届難乳認納脳派拝背肺俳班晩否批秘俵腹奮' +
  '並陛閉片補暮宝訪亡忘棒枚幕密盟模訳郵優預' +
  '幼欲翌乱卵覧裏律臨朗論';

/* 添え字が学年になるように、先頭に空きを1つ置く */
const KANJI_BY_GRADE = ['', KANJI_G1, KANJI_G2, KANJI_G3, KANJI_G4, KANJI_G5, KANJI_G6];
const READING_GRADES = [0,1,2,3,4,5,6,9];

let readingGrade = 2;
let LEARNED = new Set([...KANJI_G1, ...KANJI_G2]);

/* 表示に使う「読める漢字」の学年。9 は漢字をそのまま表示する設定。
   0 は「まだ何も習っていない」で、slice(1,1) が空になるので特別扱いは要らない。
   9 のときも一応ぜんぶ習った扱いにしておく。呼ぶ側はどこも 9 を先に見て
   打ち切るが、見落としたときに要らない印が出るより出ないほうがまだ安全。 */
function setReadingGrade(grade){
  const g = Number(grade);
  readingGrade = READING_GRADES.includes(g) ? g : 2;
  LEARNED = new Set(KANJI_BY_GRADE.slice(1, readingGrade + 1).join(''));
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
   そのまま書き写せる。

   語まるごとなのは、辞書が返すのが語全体の読み（スイゾクカン）だけで、
   どの字がどの音かを教えてくれないから。だから「水族館」は水が既習でも
   「すいぞくかん」になる。文字ごとに割るには音訓表と、連濁・音便・熟字訓の
   処理が要る。中途半端にやると誤った読みが黙って紙に出るので、今は割らない。 */
function tokensToKana(tokens){
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
    .then(tokens => ({ ok:true, text: tokensToKana(tokens), unlearned }))
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
