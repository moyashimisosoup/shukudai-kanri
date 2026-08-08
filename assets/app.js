/* =========================================================
   app.js — はじめ夏休みの宿題一覧
   データは この iPad の中（localStorage）に ほぞんされます。
   ========================================================= */
(function () {
'use strict';

/* ---------------------------------------------------------
   ほぞん
   --------------------------------------------------------- */
/* ?new=1 は、今の家庭データと同期に触れず初期設定だけを試すための隔離モード。 */
const TEST_MODE = new URLSearchParams(location.search).get('new') === '1';
/* 保護者画面の確認用。preview専用キーだけを作るため、普段の家庭データには触れない。 */
const DEBUG_PARENT = TEST_MODE && new URLSearchParams(location.search).get('debug') === 'parent';
const K_CFG = TEST_MODE ? 'natsu.preview.config.v1' : 'natsu.config.v2';
const K_ST  = TEST_MODE ? 'natsu.preview.state.v1'  : 'natsu.state.v2';
/* 初期設定は端末ごとに一度だけ表示する。家庭の設定そのものは従来どおり
   Firebase（あいことば）経由で共有し、端末の役割・表示名だけは端末内に残す。 */
const K_ONBOARD = TEST_MODE ? 'natsu.preview.onboarding.v1' : 'natsu.onboarding.v1';
const K_ROLE = TEST_MODE ? 'natsu.preview.role.v1' : 'natsu.device.role.v1';
const K_NAME = TEST_MODE ? 'natsu.preview.name.v1' : 'natsu.device.name.v1';
const K_READING = TEST_MODE ? 'natsu.preview.reading.v1' : 'natsu.device.reading.v1';
const K_THEME = TEST_MODE ? 'natsu.preview.theme.v1' : 'natsu.device.theme.v1';
const K_METRIC = 'natsu.metric.registered.v1';
/* URL の隠し入口。静的サイトなので認証ではなく、通常画面に出さないための合図。 */
const STATS_PARAM = 'stats';
const STATS_VALUE = 'family-count';

/* おためしURLを開くたびに、前回のおためし内容を消して必ず初期画面にする。
   消すのは preview 専用キーだけで、普段の家庭データ・あいことばには触れない。 */
if(TEST_MODE){
  try{
    [K_CFG, K_ST, K_ONBOARD, K_ROLE, K_NAME, K_READING, K_THEME].forEach(k=>localStorage.removeItem(k));
    if(DEBUG_PARENT){
      localStorage.setItem(K_ONBOARD, 'done');
      localStorage.setItem(K_ROLE, 'parent');
      localStorage.setItem(K_NAME, 'おためし');
    }
  }catch(e){}
}

const TABS = ['welcome','stats','home','log','calendar','books','writes','settings','config'];

function isBook(t){ return t && t.type === 'count' && t.recordStyle === 'book'; }
function isFree(t){ return t && t.type === 'daily' && t.recordStyle === 'free'; }
function bookFields(t){
  return Object.assign({ author:false, publisher:false, rating:true }, (t && t.bookFields) || {});
}

const THEMES = [
  { id:'notebook', name:'ノート', note:'みずいろの ほうがんノート' },
  { id:'sunny',    name:'おひさま', note:'あかるい クリームいろ' },
  { id:'soda',     name:'ソーダ', note:'すずしい みずいろと ミント' },
  { id:'berry',    name:'ベリー', note:'やさしい むらさきと きのみいろ' },
  { id:'block',    name:'ブロック', note:'しかくい デザイン' },
  { id:'cat',      name:'ネコ', note:'ねこちゃんの やさしい デザイン' }
];
const THEME_IDS = THEMES.map(t=>t.id);
const THEME_META = { notebook:'#14375E', sunny:'#59422E', soda:'#155466', berry:'#55344F', block:'#31422B', cat:'#62483F' };
const DAILY_UNIT_PRESETS = ['かい','ハート','ふん','ページ','もん'];
const PARENT_SENDERS = ['おかあさん','おとうさん','その他','名前表示なし'];

function taskKind(t){ return t && t.group === 'daily' ? 'daily' : (isBook(t) ? 'book' : 'normal'); }
/* 設定画面で見えている欄ごとに順番を替える。必須・チャレンジ・読書・まいにちを
   またいで動かすと、子ども画面での順番が分かりにくくなるため分けておく。 */
function taskOrderBucket(t){ return t && (t.group === 'daily' ? 'daily' : (isBook(t) ? 'book' : t.group)); }
function dailyUnitPreset(unit){ return DAILY_UNIT_PRESETS.includes(unit) ? unit : 'custom'; }
function applyTheme(theme){
  const id = THEME_IDS.includes(theme) ? theme : 'notebook';
  document.documentElement.dataset.theme = id;
  const meta = document.querySelector('meta[name="theme-color"]');
  if(meta) meta.setAttribute('content', THEME_META[id]);
}

let config, state;
let tab = 'home';
let timer = null;
let funIdx = 0, funOpen = false;
/* カレンダーが 見せている月（その月の1日）と、下にひらいている日。
   描き直しても 見ている場所が とばないよう、画面の外で おぼえておく */
let calMonth = null;
let calDay = null;
let openConfigTaskId = null;
/* 「かいたもの いちらん」が いま見せている 課題。#writes:<taskId> から 入る。
   ハッシュには 課題の id が のこるので、画面を 描き直しても 見失わない */
let writesTaskId = null;

/* ミニコンテンツは 1日に 引ける かずを かぎる。
   いくらでも 引きなおせると、宿題より そちらに いってしまう */
const FUN_MAX = 3;

/* schema 5 → 6：しあげの2段階（マルつけ・なおし）を きめられた課題に足す。
   おうちの人が 直した名前や 項目を 消さないよう、wrapUp 以外は さわらない */
function migrate5to6(c){
  (c.tasks || []).forEach(t=>{
    if(t && WRAP_UP_IDS.indexOf(t.id) >= 0) t.wrapUp = true;
  });
  c.schema = 6;
  return c;
}

/* state の形は ここ1か所で決める。以前は 読みこみ・削除・取りこみの
   3か所で それぞれ 作っていて、books を足し忘れた場所があった。
   books が無いまま 保護者ページや 本の一覧を開くと 例外で止まり、
   画面が切りかわらない（リンクが効かないように見える）ので、
   入口を ひとつに まとめる */
function emptyState(){ return { schema:SCHEMA, progress:{}, logs:[], books:[] }; }
/* 「まいにち」の例は設定に残すが、新規家庭の子ども画面では初期非表示。 */
function freshConfig(){
  return normalizeConfig(deepCopy(DEFAULT_CONFIG));
}

function normalizeConfig(c){
  if(!c || typeof c !== 'object') return deepCopy(DEFAULT_CONFIG);
  if(!Array.isArray(c.tasks)) c.tasks = [];
  if(typeof c.showDaily !== 'boolean') c.showDaily = false;
  const msg = c.parentMessage && typeof c.parentMessage === 'object' ? c.parentMessage : {};
  c.parentMessage = {
    enabled: !!msg.enabled,
    sender: PARENT_SENDERS.includes(msg.sender) ? msg.sender : 'おかあさん',
    customSender: String(msg.customSender || '').trim().slice(0, 20),
    text: String(msg.text || '').trim().slice(0, 80)
  };
  return c;
}

function normalizeState(s){
  if(!s || typeof s !== 'object' || !s.progress) return emptyState();
  if(!s.schema) s.schema = SCHEMA;
  if(!Array.isArray(s.logs))  s.logs  = [];
  if(!Array.isArray(s.books)) s.books = [];
  return s;
}

function loadAll(){
  try{
    const c = JSON.parse(localStorage.getItem(K_CFG) || 'null');
    if(c && c.schema === SCHEMA)   config = normalizeConfig(c);
    else if(c && c.schema === 5) { config = normalizeConfig(migrate5to6(c)); saveCfg(); }
    else                           config = freshConfig();
  }catch(e){ config = freshConfig(); }
  applyTheme(getLocal(K_THEME) || 'notebook');

  try{
    state = normalizeState(JSON.parse(localStorage.getItem(K_ST) || 'null'));
  }catch(e){ state = emptyState(); }

  /* きょうの ぶんを まだ 1つも 引いていなければ、ここで 1つめを 引く */
  const ft = funToday();
  if(ft.seen.length) funIdx = ft.seen[ft.seen.length - 1];
  else funPick();
  funOpen = false;
}
function saveCfg(){
  config = normalizeConfig(config);
  applyTheme(getLocal(K_THEME) || 'notebook');
  localStorage.setItem(K_CFG, JSON.stringify(config));
  markSaved('config');
  syncPush('config');
}
function saveSt(){
  localStorage.setItem(K_ST, JSON.stringify(state));
  markSaved('state');
  syncPush('state');
}
function deepCopy(o){ return JSON.parse(JSON.stringify(o)); }
function getLocal(key){ try{ return localStorage.getItem(key) || ''; }catch(e){ return ''; } }
function setLocal(key, value){ try{ localStorage.setItem(key, value); }catch(e){} }
function isStandalone(){ return window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true; }
function isStatsURL(){ return new URLSearchParams(location.search).get(STATS_PARAM) === STATS_VALUE; }
function cleanCode(value){ return String(value || '').trim().normalize('NFKC').replace(/\s+/g,'').replace(/[\/\u0000-\u001f]/g,''); }
function readingGrade(){
  const g = Number(getLocal(K_READING) || 2);
  return [0,1,2,9].includes(g) ? g : 2;
}
function readingOptions(selected){
  const labels = { 0:'すべてひらがな', 1:'小学1年生まで', 2:'小学2年生まで', 9:'漢字のまま' };
  return [0,1,2,9].map(g=>`<option value="${g}"${g===Number(selected)?' selected':''}>${labels[g]}</option>`).join('');
}

/* ---------------------------------------------------------
   ほかの端末と 合わせる

   保存先は これまで通り localStorage。同期は その上に 足すだけで、
   sync.js が 読めなくても・電波が 無くても アプリは そのまま動く。
   （sync.js は module なので app.js より あとに 動きだす。
     だから ここは いつも「あれば呼ぶ」の形にしておく）
   --------------------------------------------------------- */
function syncPush(kind){
  if(window.NatsuSync) window.NatsuSync.push(kind);
}

/* logs と books は id を 持っているので、両方の端末のぶんを
   足し合わせられる。同じ id は 新しい方を のこす。
   （子が 電波の無い所で 3件 記録し、親が そのあいだに 感想を 直した——
     という場合でも、どちらも 消えない） */
function mergeById(local, remote, newerWins){
  const out = new Map();
  (remote || []).forEach(x => { if(x && x.id) out.set(x.id, x); });
  (local  || []).forEach(x => {
    if(!x || !x.id) return;
    const r = out.get(x.id);
    out.set(x.id, (r && !newerWins(x, r)) ? r : x);
  });
  return Array.from(out.values());
}

/* progress は 数（done）や 日づけ（days）の かたまりで、id が 無い。
   ここは「進んだ方を のこす」で そろえる。

   子が 電波の無い所で ⑦まで すすめている あいだに 親が 保護者ページを 開くと、
   親の端末の 古い ⑥ が あとから 保存されることが ある。時刻の 新旧だけで 決めると
   その ⑥ が 勝ってしまい、子の やったことが 消える。
   数は 減らない ものとして あつかえば、どちらが 先に とどいても 結果は 同じになる。

   その代わり「⑥に もどす」という 引き算の 訂正は 相手の端末に とどかない。
   訂正は 子の端末で 行う（おうちの人は 進捗を 見るのが 主）という 前提で この形にしている。

     lp … この端末の progress  例 { t1:{done:6}, t9:{days:{'2026-08-06':1}} }
     rp … 相手の端末の progress
     localIsNewer … この端末の state のほうが あとに 保存されたか
*/
function mergeProgress(lp, rp, localIsNewer){
  const out = {};
  const ids = new Set([...Object.keys(lp || {}), ...Object.keys(rp || {})]);

  ids.forEach(id=>{
    const a = (lp && lp[id]) || {};
    const b = (rp && rp[id]) || {};
    /* 知らない欄（あとで 足したもの）は 新しい方を のこす */
    const p = Object.assign({}, localIsNewer ? b : a, localIsNewer ? a : b);

    /* かず（なつスキルの ⑦、本の さつ数）… 大きい方 */
    if('done' in a || 'done' in b) p.done = Math.max(a.done|0, b.done|0);

    /* まいにちノルマ … 日ごとに 独立しているので 全部あわせ、同じ日は 多い方 */
    if(a.days || b.days){
      const days = Object.assign({}, b.days);
      Object.keys(a.days || {}).forEach(k=>{
        days[k] = Math.max(a.days[k]|0, days[k]|0);
      });
      p.days = days;
    }

    /* だんかい式の チェック … どちらかで ついていれば ついたまま */
    ['steps','wrap'].forEach(key=>{
      if(!Array.isArray(a[key]) && !Array.isArray(b[key])) return;
      const x = a[key] || [], y = b[key] || [];
      p[key] = Array.from({ length: Math.max(x.length, y.length) }, (_, i)=> !!x[i] || !!y[i]);
    });

    out[id] = p;
  });

  return out;
}

function mergeState(local, remote, localIsNewer){
  const out = normalizeState(deepCopy(localIsNewer ? local : remote));
  out.logs  = mergeById(local.logs,  remote.logs,  (a,b)=> String(a.at||'') >= String(b.at||''));
  out.books = mergeById(local.books, remote.books, ()=> localIsNewer);
  out.progress = mergeProgress(local.progress || {}, remote.progress || {}, localIsNewer);
  out.logs.sort((a,b)=> String(a.at||'').localeCompare(String(b.at||'')));
  if(out.logs.length > 3000) out.logs = out.logs.slice(-3000);
  /* ミニコンテンツは 基本1日3回。端末ごとに かぞえる（下の stripLocal を 見てください）*/
  if(local.fun) out.fun = local.fun; else delete out.fun;
  return out;
}

/* ミニコンテンツの「きょう 何回 引いたか」と 一巡履歴は 記録では なく、
   その端末の いまの ようす。これを 共有すると、おうちの人が 保護者ページを
   開いただけで 子の 回数が 減ってしまうので、送らない */
function stripLocal(s){
  const o = Object.assign({}, s);
  delete o.fun;
  return o;
}

/* この端末の state / config を いつ保存したか。
   相手と どちらが 新しいか くらべるのに つかう */
const K_AT = 'natsu.savedAt.v1';
function savedAt(){
  try{ return JSON.parse(localStorage.getItem(K_AT) || '{}'); }catch(e){ return {}; }
}
function markSaved(kind){
  const a = savedAt(); a[kind] = Date.now();
  try{ localStorage.setItem(K_AT, JSON.stringify(a)); }catch(e){}
}

/* sync.js から 呼ばれる入口。相手の端末の中身が とどいたとき */
function applyRemote(remote){
  const at = savedAt();
  let changed = false;

  /* config（設定）は 中身を 混ぜても 意味が 通らないので、
     あとに 保存された方を まるごと 採る */
  if(remote.config && remote.configAt > (at.config || 0)){
    config = normalizeConfig(remote.config);
    localStorage.setItem(K_CFG, JSON.stringify(config));
    markSaved('config');
    changed = true;
  }

  if(remote.state){
    const merged = mergeState(normalizeState(state),
                              normalizeState(remote.state),
                              (at.state || 0) >= remote.stateAt);
    if(JSON.stringify(merged) !== JSON.stringify(state)){
      state = merged;
      localStorage.setItem(K_ST, JSON.stringify(state));
      markSaved('state');
      changed = true;
      /* 合わせた結果は 相手にも 返す。
         3台め（きょうだいの端末）が あっても そろう */
      syncPush('state');
    }
  }

  if(changed) render({ keepScroll:true });
}

window.NatsuApp = {
  current: () => ({ config, state: stripLocal(state) }),
  onRemote: applyRemote
};

/* ---------------------------------------------------------
   こまごました どうぐ
   --------------------------------------------------------- */
const $  = (s, r) => (r||document).querySelector(s);
const $$ = (s, r) => Array.from((r||document).querySelectorAll(s));

function esc(s){
  return String(s == null ? '' : s)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}
function clamp(n,a,b){ return Math.max(a, Math.min(b, n)); }
function maru(n){ return (n>=1 && n<=20) ? String.fromCharCode(0x245F + n) : String(n); }
function pad2(n){ return String(n).padStart(2,'0'); }

function parseLocal(s){
  // 'YYYY-MM-DDTHH:mm' を その場所の時間として よむ
  if(!s) return new Date(NaN);
  const m = String(s).match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
  if(!m) return new Date(s);
  return new Date(+m[1], +m[2]-1, +m[3], +m[4], +m[5], 0, 0);
}
function dayKey(d){ return d.getFullYear()+'-'+pad2(d.getMonth()+1)+'-'+pad2(d.getDate()); }
function dayOfYear(d){
  return Math.floor((d - new Date(d.getFullYear(),0,0)) / 86400000);
}
const WD = ['日','月','火','水','木','金','土'];
function fmtDate(d){ return (d.getMonth()+1)+'月'+d.getDate()+'日（'+WD[d.getDay()]+'）'; }
function fmtTime(d){ return pad2(d.getHours())+':'+pad2(d.getMinutes()); }
function keyToDate(k){ const p = k.split('-'); return new Date(+p[0], +p[1]-1, +p[2]); }

function toast(msg){
  const t = $('#toast');
  t.textContent = msg; t.hidden = false;
  clearTimeout(toast._t);
  toast._t = setTimeout(()=>{ t.hidden = true; }, 2200);
}
function stamp(text){
  const el = $('#stamp');
  $('#stampText').textContent = text || 'できた！';
  el.hidden = false;
  clearTimeout(stamp._t);
  // アニメーションを やりなおす
  const m = $('.stamp-mark'); m.style.animation = 'none'; void m.offsetWidth; m.style.animation = '';
  stamp._t = setTimeout(()=>{ el.hidden = true; }, 900);
}

/* ---------------------------------------------------------
   すすみぐあいの けいさん
   --------------------------------------------------------- */
/* しあげの2段階（マルつけ・なおし）が つく課題か */
function hasWrap(t){ return !!(t && t.wrapUp && (t.type === 'count' || t.type === 'step')); }

/* ほぞんされた wrap を かならず 真偽値の はいれつに する（無ければ 未着手） */
function wrapOf(p){
  const a = Array.isArray(p.wrap) ? p.wrap : [];
  return WRAP_LABELS.map((_,i)=> !!a[i]);
}

/* しあげの2段階を すすみぐあいに 織りこむ。
   done / total / text は 番号（段階）そのままの数を のこす。
   14ばんの課題が 16ばんに 見えると まちがえるため。
   バーも 番号（段階）だけの わりあいに する。マルつけ・なおしは
   バーの そとの ランプで 見せるので、pct には 足さない。
   足すと 14/14 なのに バーが 埋まらず、ちぐはぐに 見える。
   完了（isDone）の 判定にだけ 2段階を 足す */
function withWrap(task, p, r){
  r.numDone  = r.isDone;        // 番号（段階）を ぜんぶ 終えたか
  r.wrap     = wrapOf(p);
  r.allDone  = r.done;
  r.allTotal = r.total;
  if(!hasWrap(task)) return r;
  const w = r.wrap.filter(Boolean).length;
  // allDone / allTotal は 2段階こみの かぞえかた（ほかから 使うので のこす）
  r.allDone  = r.done + w;
  r.allTotal = r.total + r.wrap.length;
  r.isDone   = r.numDone && w >= r.wrap.length;
  return r;
}

function prog(task){
  const p = state.progress[task.id] || {};
  if(task.type === 'count'){
    const total = Math.max(1, task.total|0);
    const done  = clamp(p.done|0, 0, total);
    return withWrap(task, p,
           { done, total, pct: done/total*100, unit: task.unit || 'こ',
             text: done+'/'+total+(task.unit||''), isDone: done >= total });
  }
  if(task.type === 'step'){
    const steps = task.steps || [];
    const arr = Array.isArray(p.steps) ? p.steps : [];
    const done = steps.reduce((a,_,i)=> a + (arr[i] ? 1 : 0), 0);
    const total = Math.max(1, steps.length);
    return withWrap(task, p,
           { done, total, pct: done/total*100, unit:'',
             text: done+'/'+steps.length, isDone: done >= steps.length, arr });
  }
  // daily
  const days = p.days || {};
  const today = days[dayKey(new Date())] | 0;
  const target = Math.max(1, task.target|0);
  return withWrap(task, p,
         { done: today, total: target, pct: clamp(today/target*100,0,100),
           unit: task.targetUnit || 'かい',
           text: today+'/'+target+(task.targetUnit||''), isDone: today >= target,
           streak: streakOf(days, target), days });
}

function streakOf(days, target){
  let n = 0;
  const d = new Date();
  for(let i=0;i<400;i++){
    const k = dayKey(d);
    if((days[k]|0) >= target) n++;
    else if(i > 0) break;         // きょう まだでも、きのうまでの れんぞくは かぞえる
    else if((days[k]|0) === 0) { /* きょうは まだ */ }
    d.setDate(d.getDate()-1);
  }
  return n;
}

function nextLabel(task){
  const p = prog(task);
  if(p.isDone) return null;
  // 番号（段階）が ぜんぶ おわったら、さいごの2段階を 出す
  if(hasWrap(task) && p.numDone){
    const i = p.wrap.findIndex(v => !v);
    return { lead:'つぎは', num:'', tail: WRAP_LABELS[i] };
  }
  if(task.type === 'count'){
    const n = p.done + 1;
    return task.numbered
      ? { lead:'つぎは', num: maru(n), tail:'' }
      : { lead:'つぎは', num: String(n), tail: (task.unit||'')+'め' };
  }
  if(task.type === 'step'){
    const i = (task.steps||[]).findIndex((_,k)=> !(p.arr && p.arr[k]));
    return { lead:'つぎは', num:'', tail:'「'+(task.steps[i]||'')+'」' };
  }
  const nokori = Math.max(0, p.total - p.done);
  return { lead:'きょうは あと', num:String(nokori), tail: task.targetUnit || 'かい' };
}

/* しゅくだい ぜんたいの すすみぐあい（かならずやる だけ／まいにちアプリは のぞく）
   ここも 番号（段階）だけで かぞえる。カードの バーと 同じ ものさしに して
   おかないと、保護者ページの「必須の宿題 ○%」だけ 数字が ずれて見える */
function overall(group){
  let done = 0, total = 0;
  config.tasks.filter(t => t.group === group && t.type !== 'daily').forEach(t=>{
    const p = prog(t); done += p.done; total += p.total;
  });
  return { done, total, pct: total ? done/total*100 : 0 };
}

/* ---------------------------------------------------------
   ビュー：はじめの設定
   iOS はブラウザ側の「ホーム画面に追加」を Web ページから直接開けないため、
   先に分かりやすく案内し、あとから追加した場合の同期方法も明記する。 */
function viewWelcome(){
  const S = window.NatsuSync;
  const hasSync = !TEST_MODE && !!(S && S.configured());
  const installed = isStandalone();
  return `
  <section class="welcome" aria-labelledby="welcomeTitle">
    <p class="welcome-kicker">${TEST_MODE ? 'おためし モード' : 'はじめの じゅんび'}</p>
    <h2 id="welcomeTitle">しゅくだいノート</h2>
    <div class="paper welcome-step">
      <span class="welcome-num">1</span>
      <div><h3>ホーム画面に 追加しよう</h3>
      <p>${installed ? 'この端末はホーム画面から開いています。' : 'iPad / iPhone では、Safari の共有ボタン →「ホーム画面に追加」を押すと、いつも同じ場所から開けます。'}</p>
      <p class="set-note">あとでホーム画面に追加したときも、あいことばを読み込めば、同じ家庭の複数の端末で同じ記録と設定を使えます。</p></div>
    </div>
    <div class="paper welcome-step">
      <span class="welcome-num">2</span>
      <div><h3>どうやって つかう？</h3>
      <div class="welcome-roles">
        <button class="btn btn-go welcome-role" data-welcome-mode="solo" type="button">こどもだけで つかう<br><small>すぐに つかえます</small></button>
        <button class="btn welcome-role welcome-role--share" data-welcome-mode="share" type="button">${icon('users')}<span>保護者も 共有する<br><small>あとからでも 設定できます</small></span></button>
      </div>
      ${TEST_MODE ? '<p class="set-note">おためしモードでは、いま使っている家庭のデータ・あいことば・集計には触れません。</p>' : (hasSync ? '' : '<p class="set-note">同期の準備が未設定のため、この端末だけで使います。あとから設定画面で同期を有効にできます。</p>')}</div>
    </div>
    <div class="paper welcome-form" id="welcomeForm" hidden></div>
  </section>`;
}
function icon(name){
  const svg = window.CodeXIcons && window.CodeXIcons[name];
  return svg ? `<span class="codex-icon" aria-hidden="true">${svg}</span>` : '';
}
function parentSenderOptions(selected){
  return PARENT_SENDERS.map(value=>`<option value="${value}"${value===selected?' selected':''}>${parentSenderLabel(value)}</option>`).join('');
}
function parentSenderLabel(value){
  const useKanji = readingGrade() >= 2;
  if(value === 'おかあさん') return useKanji ? 'お母さん' : 'おかあさん';
  if(value === 'おとうさん') return useKanji ? 'お父さん' : 'おとうさん';
  return value;
}
function parentMessageHeading(msg){
  if(msg.sender === '名前表示なし') return 'おうちの人からの メッセージ';
  const sender = msg.sender === 'その他' ? (msg.customSender || 'おうちの人') : parentSenderLabel(msg.sender);
  return `${sender}からの メッセージ`;
}
function bindParentSender(selectId, customWrapId){
  const select = $('#'+selectId), wrap = $('#'+customWrapId);
  if(!select || !wrap) return;
  const update = ()=>{ wrap.hidden = select.value !== 'その他'; };
  select.addEventListener('change', update);
  update();
}

function welcomeRolePickerHTML(){
  return `<h3>この端末は だれが つかう？</h3>
    <div class="welcome-roles">
      <button class="btn btn-go welcome-role" data-welcome-role="parent" type="button">おうちの人の端末<br><small>合言葉を 作る</small></button>
      <button class="btn welcome-role" data-welcome-role="child" type="button">こどもの端末<br><small>合言葉を 入れる</small></button>
    </div>
    <p class="set-note">同じ合言葉を入れると、同じ家庭の複数の端末で使えます。</p>`;
}

function welcomeFormHTML(role, sharing){
  const S = window.NatsuSync;
  const syncReady = !!sharing && !TEST_MODE && !!(S && S.configured());
  const name = getLocal(K_NAME);
  const code = role === 'parent' && syncReady ? S.makeCode() : '';
  return role === 'parent' ? `
    <h3>おうちの人の 設定</h3>
    <label class="lab">こどもの なまえ
      <input id="welcomeName" type="text" value="${esc(name)}" autocomplete="name" placeholder="例：はな"></label>
    <label class="lab">漢字は何年生の字まで読めますか？
      <select id="welcomeReading">${readingOptions(readingGrade())}</select></label>
    ${syncReady ? `<label class="lab">このおうちの あいことば（8文字以上）
      <input id="welcomeCode" type="text" value="${esc(code)}" autocapitalize="off" autocorrect="off" spellcheck="false"></label>
      <p class="set-note">こどもの端末など、複数の端末で同じ合言葉を入れると、同じ記録と設定を使えます。</p>`
      : '<p class="set-note">いまは同期を使わず、この端末だけで始めます。</p>'}
    ${privacyNoteHTML()}
    <button class="btn btn-go btn-wide" id="welcomeStart" data-role="parent" data-sharing="yes" type="button">保護者ページを 開く</button>` : `
    <h3>こどもの 設定</h3>
    <label class="lab">なまえを 確認しよう
      <input id="welcomeName" type="text" value="${esc(name)}" autocomplete="name" placeholder="例：はな"></label>
    <label class="lab">漢字は何年生の字まで読めますか？
      <select id="welcomeReading">${readingOptions(readingGrade())}</select></label>
    ${syncReady ? `<label class="lab">おうちの人から もらった あいことば
      <input id="welcomeCode" type="text" autocapitalize="off" autocorrect="off" spellcheck="false" placeholder="あいことばを 入れる"></label>
      <p class="set-note">読みこむと、おうちの人が決めた宿題と記録を、複数の端末で使えます。</p>`
      : '<p class="set-note">いまは同期を使わず、この端末だけで始めます。</p>'}
    ${privacyNoteHTML()}
    <button class="btn btn-go btn-wide" id="welcomeStart" data-role="child" data-sharing="${sharing?'yes':'no'}" type="button">こども画面を 開く</button>`;
}

function privacyNoteHTML(){
  return `<p class="privacy-note">管理者に届くのは登録家庭数だけです。名前・宿題名・記録内容・アクセス元は届きません。共有設定済み端末数は、このおうち用のランダムな番号だけで数えます。</p>`;
}

function welcomeMessageChoiceHTML(){
  const msg = config.parentMessage;
  return `
    <p class="welcome-kicker">さいごの かくにん</p>
    <h3>おうちの人からの メッセージを 使いますか？</h3>
    <p>保護者ページから、こどもの画面へ短いメッセージを出せます。</p>
    <label class="lab" for="welcomeMessageSender">だれからの メッセージ？
      <select id="welcomeMessageSender">${parentSenderOptions(msg.sender)}</select></label>
    <label class="lab sender-custom" id="welcomeMessageCustomWrap" for="welcomeMessageCustom" hidden>表示する名前
      <input id="welcomeMessageCustom" type="text" maxlength="20" value="${esc(msg.customSender)}" placeholder="例：おばあちゃん"></label>
    <div class="welcome-roles welcome-message-actions">
      <button class="btn btn-go welcome-role" data-message-choice="yes" type="button">使う</button>
      <button class="btn welcome-role" data-message-choice="no" type="button">今は 使わない</button>
    </div>
    <p class="set-note">あとから保護者ページで変更できます。</p>`;
}

/* ---------------------------------------------------------
   ビュー：登録家庭数（URL の隠し入口からだけ開く） */
function viewStats(){
  return `
  <section class="welcome" aria-labelledby="statsTitle">
    <p class="welcome-kicker">うんよう よう</p>
    <h2 id="statsTitle">登録家庭数</h2>
    <div class="paper welcome-form">
      <p class="set-note">初期設定を完了した家庭を、名前や記録内容を見ずに数えています。</p>
      <p class="stats-count" id="statsCount">読みこんでいます…</p>
      <p class="set-note" id="statsNote">この画面は通常のメニューには表示されません。</p>
    </div>
  </section>`;
}

/* ---------------------------------------------------------
   ビュー：ホーム
   --------------------------------------------------------- */
function viewHome(){
  const must  = config.tasks.filter(t=>t.group==='must');
  const opt   = config.tasks.filter(t=>t.group==='option');
  const daily = config.showDaily ? config.tasks.filter(t=>t.group==='daily') : [];
  const o = overall('must');
  const nokori = must.filter(t=>!prog(t).isDone).length;

  // 今日のぶんが終わっていれば、まいにちの欄は下へ下がって邪魔をしない
  const dailyAllDone = daily.length > 0 && daily.every(t => prog(t).isDone);
  const dailySec = daily.length
    ? sectionHTML('daily','まいにち すこしずつ',
        dailyAllDone ? 'きょうは ぜんぶ できた！' : 'きょうの ぶん', daily)
    : '';

  return `
  <section class="count">
    <p class="count-lead">なつやすみ おわりまで　<b>あと</b></p>
    <div id="cdBox"></div>
    ${paceHTML(o)}
  </section>

  ${parentMessageHTML()}

  ${dailyAllDone ? '' : dailySec}
  ${sectionHTML('must','かならず やる', nokori>0 ? 'のこり '+nokori+'こ' : 'ぜんぶ できた！', must)}
  ${opt.length   ? sectionHTML('opt','つぎに やる','かならず やるが すんだら、ここから えらぼう', opt) : ''}

  <section class="sec">
    <div class="sec-head"><h2>きょう やったこと</h2><span class="sec-note">${fmtDate(new Date())}</span></div>
    <div class="paper today-list">${todayHTML()}</div>
  </section>

  ${dailyAllDone ? dailySec : ''}
  ${funHTML()}
  `;
}

function parentMessageHTML(){
  const msg = config.parentMessage;
  if(!msg.enabled || !msg.text) return '';
  const heading = parentMessageHeading(msg);
  return `
  <section class="home-parent-message" aria-label="${esc(heading)}">
    <div class="paper parent-message-note">
      <strong>${esc(heading)}</strong>
      <p>${esc(msg.text)}</p>
    </div>
  </section>`;
}

/* 宿題の進捗率 − 夏休みの経過率 から、進み具合を判定する */
function verdictOf(gap){
  if(gap >= 8)   return { cls:'v-good', msg:'よゆうだね！このちょうし！' };
  if(gap <= -18) return { cls:'v-hmm',  msg:'きょうは がんばりどき！' };
  if(gap <= -6)  return { cls:'v-hmm',  msg:'すこし いそごう！' };
  return { cls:'v-ok', msg:'いいペース！' };
}

/* 夏休みの経過率（％） */
function natsuPct(){
  const st = parseLocal(config.startAt), en = parseLocal(config.endAt);
  const span = en - st;
  return span > 0 ? clamp((new Date() - st) / span * 100, 0, 100) : 0;
}

function paceHTML(o){
  const natsu = natsuPct();
  const todo = o.pct;
  const gap = todo - natsu;

  const v = verdictOf(gap), cls = v.cls, msg = v.msg;

  return `
  <div class="pace">
    <div class="pace-row">
      <span class="pace-name">なつやすみ</span>
      <div class="bar"><div class="bar-fill bar-fill--natsu" style="width:${natsu.toFixed(1)}%"></div></div>
      <span class="pace-pct">${Math.round(natsu)}%</span>
    </div>
    <div class="pace-row">
      <span class="pace-name">しゅくだい</span>
      <div class="bar"><div class="bar-fill bar-fill--todo" style="width:${todo.toFixed(1)}%"></div></div>
      <span class="pace-pct">${Math.round(todo)}%</span>
    </div>
    <p class="pace-verdict ${cls}">${msg}</p>
  </div>`;
}

function sectionHTML(kind, title, note, tasks){
  return `
  <section class="sec sec-${kind}">
    <div class="sec-head"><h2>${esc(title)}</h2><span class="sec-note">${esc(note)}</span></div>
    <div class="task-list${kind==='daily' ? ' task-list--2up' : ''}">${tasks.map(taskHTML).join('')}</div>
  </section>`;
}

/* 14/14 の よこに ならべる ランプ。
   マルつけ・なおしは バーの すすみとは べつものなので、
   バーに まぜず、済んだら 点灯する 項目として 出す */
function wrapMarksHTML(t, p){
  if(!hasWrap(t)) return '';
  return `<span class="wrapmarks">${WRAP_LABELS.map((s,i)=>
    `<span class="wrapmark${p.wrap[i] ? ' is-on' : ''}">${esc(s)}</span>`).join('')}</span>`;
}

function taskHTML(t){
  const p = prog(t);
  const nx = nextLabel(t);

  let meter;
  if(isFree(t)){
    const today = (state.logs || []).filter(l =>
      l.taskId === t.id && dayKey(new Date(l.at)) === dayKey(new Date()));
    const last = today[today.length - 1];
    meter = `<div class="free-body">${last
      ? `<p class="free-said">${esc((last.memo || '').split('\n')[0])}</p>`
      : `<p class="free-ask">${esc(t.freeHint || 'きょうの ことを かいてみよう。')}</p>`}</div>`;
  }
  else if(t.type === 'daily'){
    if((t.targetUnit||'') === 'ハート'){
      const n = Math.max(p.total, p.done);
      let hearts = '';
      for(let i=1;i<=n;i++) hearts += `<span class="heart${i<=p.done?' on':''}">❤️</span>`;
      meter = `<div class="task-meter"><div class="hearts">${hearts}</div>
        ${p.streak>0 ? `<span class="streak">${p.streak}日 れんぞく</span>` : ''}
      </div>`;
    }else{
      meter = `<div class="task-meter task-meter--bar task-meter--daily">
        <div class="bar"><div class="bar-fill" style="width:${p.pct.toFixed(1)}%"></div></div>
        <span class="task-count">${esc(p.text)}</span>
        ${p.streak>0 ? `<span class="streak">${p.streak}日 れんぞく</span>` : ''}
      </div>`;
    }
  }else{
    // count と step は 同じ 見た目。ランプは 14/14 の すぐ よこに ならべる
    meter = `<div class="task-meter task-meter--bar">
        <div class="bar"><div class="bar-fill" style="width:${p.pct.toFixed(1)}%"></div></div>
        <span class="task-count">${esc(p.text)}</span>${wrapMarksHTML(t, p)}
      </div>`;
  }

  return `
  <article class="task${p.isDone?' is-done':''}${
    (!p.isDone && p.numDone && hasWrap(t))?' is-almost':''}${isFree(t)?' task-free':''}">
    <h3 class="task-name">${esc(t.name)}</h3>
    ${nx && !isFree(t) ? `<p class="task-next">${nx.lead}
        ${nx.num ? `<span class="next-num">${esc(nx.num)}</span>` : ''}${esc(nx.tail)}</p>` : ''}
    ${meter}
    <div class="task-act">
      <button class="btn ${p.isDone?'btn-ghost':'btn-do'}" data-open="${esc(t.id)}" type="button">
        ${isFree(t) ? (p.isDone ? 'また かく' : 'かく') : (p.isDone ? 'なおす' : 'やった！')}
      </button>
      ${isBook(t) && p.done > 0
        ? `<a class="btn btn-sm btn-ghost task-sub" href="#books">よんだ本を 見る</a>` : ''}
      ${hasWrites(t)
        ? `<a class="btn btn-sm btn-ghost task-sub" href="#writes:${esc(t.id)}">かいたものを 見る</a>` : ''}
    </div>
  </article>`;
}

function todayHTML(){
  const k = dayKey(new Date());
  const rows = state.logs.filter(l => dayKey(new Date(l.at)) === k);
  if(!rows.length) return `<p class="empty">まだ ないよ。<br>「きろくする」から 入れてね。</p>`;
  return rows.slice().reverse().map(logRowHTML).join('');
}

function logRowHTML(l){
  return `
  <div class="today-item">
    <span class="ti-time">${fmtTime(new Date(l.at))}</span>
    <div class="ti-body">
      <div class="ti-name">${esc(l.name)}</div>
      <div class="ti-what">${esc(l.what)}</div>
      ${l.memo ? `<div class="ti-memo">${esc(l.memo)}</div>` : ''}
    </div>
  </div>`;
}

/* {漢字|よみ} を ふりがなに する。さきに esc() で エスケープしてから
   自分の タグだけを 入れるので、本文に < や > が あっても こわれない。
   ふつうの （かっこ）は そのまま のこる（読みがなでは ない ものが あるため） */
function rubyHTML(text){
  return esc(text).replace(/\{([^{}|]+)\|([^{}|]+)\}/g,
    (_, base, yomi) => `<ruby>${base}<rt>${yomi}</rt></ruby>`);
}

/* きょうの 3件は日づけが かわったら 0から かぞえなおす。
   history は日を またいで のこし、FUNを ぜんぶ読むまで 同じ内容を 出さない。 */
function funToday(){
  const key = dayKey(new Date());
  let f = state.fun;
  if(!f || typeof f !== 'object') f = {};
  const valid = xs => Array.from(new Set((Array.isArray(xs) ? xs : [])
    .filter(i => Number.isInteger(i) && i >= 0 && i < FUN.length)));
  /* 旧データには history がないので、その日の seen を最初の履歴として 引きつぐ */
  const history = valid(Array.isArray(f.history) ? f.history : f.seen);
  const seen = f.key === key ? valid(f.seen) : [];
  f = { key, seen, history };
  state.fun = f;
  return f;
}

/* まだ この一巡で 出していない ものから ひとつ ランダムに えらぶ。
   ぜんぶ 出しきったら、新しい一巡を はじめる */
function funPick(){
  const f = funToday();
  let rest = FUN.map((_, i)=> i).filter(i => f.history.indexOf(i) < 0);
  if(!rest.length){ f.history = []; rest = FUN.map((_, i)=> i); }
  const pool = rest;
  funIdx = pool[Math.floor(Math.random() * pool.length)];
  funOpen = false;
  f.seen.push(funIdx);
  f.history.push(funIdx);
  saveSt();
}

function didSomethingToday(){
  const key = dayKey(new Date());
  return (state.logs || []).some(l => dayKey(new Date(l.at)) === key);
}

function funLimit(){ return FUN_MAX + (didSomethingToday() ? 1 : 0); }

function funHTML(){
  const f = FUN[funIdx % FUN.length];
  const seenCount = funToday().seen.length;
  const bonus = didSomethingToday();
  const left = Math.max(0, funLimit() - seenCount);
  const isQuiz = f.t === 'なぞなぞ' || f.t === '頭のたいそう';
  return `
  <section class="paper fun">
    <span class="fun-tag">${esc(f.t)}</span>
    ${f.t === 'むかしのことば'
      ? '<p class="fun-note">つかってみよう。ひみつの あんごうに なるかもね！</p>'
      : ''}
    <p class="fun-q">${rubyHTML(f.q)}</p>
    ${funOpen ? `<p class="fun-a">${rubyHTML(f.a)}</p>` : ''}
    ${bonus && seenCount === FUN_MAX
      ? '<p class="fun-bonus fun-bonus--on">「できた！」が ふえたので、きょうは もうひとつ！</p>'
      : ''}
    <div class="fun-row">
      ${funOpen ? '' : `<button class="btn btn-sm" data-fun="open" type="button">${
        isQuiz ? 'こたえを 見る' : 'つづきを 見る'}</button>`}
      ${funOpen && left > 0
        ? `<button class="btn btn-sm" data-fun="next" type="button">つぎの はなし（あと ${left}かい）</button>`
        : ''}
      ${funOpen && left === 0 && !bonus && seenCount >= FUN_MAX
        ? '<span class="fun-bonus">「できた！」が ふえたら、もうひとつ 読めるよ。</span>'
        : ''}
      ${funOpen && left === 0 && (bonus || seenCount < FUN_MAX)
        ? '<span class="fun-owari">きょうは ここまで。また あした！</span>'
        : ''}
    </div>
  </section>`;
}

/* --- カウントダウン（1びょうごと） --- */
function renderCountdown(){
  const box = $('#cdBox');
  if(!box) return;
  const en = parseLocal(config.endAt);
  let ms = en - new Date();
  if(!(ms === ms)){ box.innerHTML = `<p class="count-over">おわりの日を せっていしてね</p>`; return; }
  if(ms <= 0){ box.innerHTML = `<p class="count-over">なつやすみは おわりました 🎒</p>`; return; }

  const d = Math.floor(ms/86400000);
  const h = Math.floor(ms/3600000) % 24;
  const m = Math.floor(ms/60000) % 60;
  const s = Math.floor(ms/1000) % 60;

  const unit = (v, lab, big) =>
    `<div class="cd-unit${big?' cd-unit--big':''}">` +
    pad2(v).split('').map(c=>`<span class="cd-d">${c}</span>`).join('') +
    `<span class="cd-lab">${lab}</span></div>`;

  box.innerHTML = `<div class="cd">${unit(d,'にち',true)}${unit(h,'じかん')}${unit(m,'ふん')}${unit(s,'びょう')}</div>`;
}

/* ---------------------------------------------------------
   ビュー：よんだ本の一覧（紙のカードへ書き写すためのページ）
   --------------------------------------------------------- */
function viewBooks(){
  const tasks = config.tasks.filter(isBook);
  const rows = state.books.slice().sort((a,b)=> a.nth - b.nth);

  // 冊数は課題の進捗を正とする。一覧に出るのは中身を記録したぶんだけ
  const done = tasks.reduce((a,t)=> a + prog(t).done, 0);
  const total = tasks.reduce((a,t)=> a + (t.total|0), 0);

  const head = `
    <div class="paper parent-head">
      <div>
        <h2 style="font-size:24px">よんだ本</h2>
        <p style="font-size:17px">ぜんぶで ${done}さつ　あと ${Math.max(0, total - done)}さつ</p>
      </div>
      <a class="btn btn-sm" href="#home">もどる</a>
    </div>`;

  if(!rows.length){
    return head + `<div class="paper"><p class="empty">まだ 1さつも きろくして いないよ。<br>
      「のこりの しゅくだい」から きろくしてね。</p></div>`;
  }

  return head + `
    <p class="set-note paper" style="padding:14px 18px;font-size:17px">
      カードに 書きうつすときは、この ページを 見ながら 書いてね。</p>
    ${rows.map(b=>`
      <article class="bookcard">
        <div class="bookcard-head">
          <span class="book-no">${b.nth}</span>
          <h3 class="bookcard-title">${esc(b.title)}</h3>
          <button class="btn btn-sm btn-ghost" data-open="${esc(b.taskId)}"
            data-book="${esc(b.id)}" type="button">なおす</button>
        </div>
        <dl class="bookcard-fields">
          ${b.author    ? `<dt>さくしゃ</dt><dd>${esc(b.author)}</dd>` : ''}
          ${b.publisher ? `<dt>しゅっぱんしゃ</dt><dd>${esc(b.publisher)}</dd>` : ''}
          <dt>よんだ日</dt><dd>${esc(fmtDate(keyToDate(b.date)))}</dd>
          ${b.rating ? `<dt>おすすめ度</dt><dd class="bk-stars">${'★'.repeat(b.rating)}${'☆'.repeat(3-b.rating)}</dd>` : ''}
        </dl>
        ${(b.memoOut || b.memo) ? `
          <div class="bookcard-memo">
            <span class="bookcard-memo-lab">かんそう</span>
            <p>${esc(b.memoOut || b.memo)}</p>
          </div>` : ''}
      </article>`).join('')}`;
}

/* ---------------------------------------------------------
   ビュー：かいたもの いちらん（紙のカードへ書き写すためのページ）
   --------------------------------------------------------- */
/* その課題で 文を 書いた きろくだけを 古い順に あつめる。
   かんさつは 書いた順に 読めたほうが、そだち かたが つながって 見える。
   ログの at は UTC の ISO なので、かならず Date に なおしてから ならべる */
function writeLogsOf(taskId){
  return (state.logs || [])
    .filter(l => l.taskId === taskId && String(l.memo || '').trim())
    .sort((a, b) => new Date(a.at) - new Date(b.at));
}

/* 一覧への 入口を 出すか どうか。課題の id では なく「文を 書いた きろくが
   あるか」で きめるので、きゅうり・読書ゆうびん いがいの 段階の課題でも
   自動で 出る。番号でかぞえる 課題（本のきろくなど）には 出さない */
function hasWrites(t){
  return !!t && t.type === 'step' && writeLogsOf(t.id).length > 0;
}

function viewWrites(){
  const t = (config.tasks || []).find(x => x.id === writesTaskId);
  const rows = t ? writeLogsOf(t.id) : [];

  if(!rows.length){
    return `
    <div class="paper parent-head">
      <div><h2 style="font-size:24px">かいたもの</h2></div>
      <a class="btn btn-sm" href="#home">もどる</a>
    </div>
    <div class="paper"><p class="empty">まだ かいたものが ないよ。<br>
      <a href="#home">のこりの しゅくだい</a> から きろくしてね。</p></div>`;
  }

  return `
  <div class="paper parent-head">
    <div>
      <h2 style="font-size:24px">${esc(t.name)}　かいたもの</h2>
      <p style="font-size:17px">ぜんぶで ${rows.length}かい</p>
    </div>
    <a class="btn btn-sm" href="#home">もどる</a>
  </div>
  <p class="write-lead paper">カードに 書きうつすときは、この ページを 見ながら 書いてね。</p>
  ${rows.map(l=>{
    const d = new Date(l.at);
    return `
    <article class="paper write-card">
      <div class="write-head">
        <span class="write-date">${esc(fmtDate(d))}</span>
        <span class="write-time">${esc(fmtTime(d))}</span>
      </div>
      <p class="write-memo">${esc(l.memo)}</p>
    </article>`;
  }).join('')}
  <section class="sec write-kanji">
    <div class="sec-head"><h2>ひらがなに する</h2>
      <span class="sec-note">カードに うつす まえに</span></div>
    <div class="paper write-kanji-body">
      <p class="write-hint">ならっていない かんじが ないか しらべられるよ。</p>
      <div class="write-acts">
        <button class="btn btn-sm btn-do" id="wrCheck" type="button">かんじを しらべる</button>
      </div>

      <div id="wrCheckWrap" hidden>
        <div class="kj-box">
          <span class="write-lab">ならっていない かんじ</span>
          <p class="kj-list" id="wrUnlearned"></p>
          <p class="kj-view" id="wrMarked"></p>
          <p class="write-hint" id="wrCheckNote"></p>
        </div>
        <div class="write-acts">
          <button class="btn btn-sm" id="wrFix" type="button">ぜんぶ ひらがなに して</button>
        </div>
        <p class="write-note" id="wrDictNote"></p>
      </div>

      <div id="wrOutWrap" hidden>
        <span class="write-lab">かきうつす文（2年生までの かんじ）</span>
        <p class="write-hint">カードには この文を うつしてね。なおしても いいよ。</p>
        <textarea class="write-out" id="wrOut" rows="10"></textarea>
        <p class="write-note" id="wrOutNote"></p>
      </div>
    </div>
  </section>`;
}

/* 一覧ぜんぶを ひとつづきの 文に する（しらべる ときだけ 使う）。
   日づけごとに 分けなくても、どの かんじが ならっていないかは 分かる */
function writesAllText(){
  return writeLogsOf(writesTaskId).map(l => String(l.memo || '')).join('\n');
}

/* 1だんめ：ならっていない漢字を すぐ 見せる。通信も 待ち時間も ない */
function checkWrites(){
  const src = writesAllText().trim();
  if(!src) return;

  const un = unlearnedKanji(src);
  $('#wrCheckWrap').hidden = false;
  $('#wrMarked').innerHTML = markUnlearnedHTML(src);   // すでにエスケープ済み

  if(!un.length){
    $('#wrUnlearned').textContent = 'なし';
    $('#wrCheckNote').textContent = 'ぜんぶ 2年生までの かんじだったよ。そのまま カードに うつせるね。';
    $('#wrFix').hidden = true;
    $('#wrDictNote').textContent = '';
  }else{
    $('#wrUnlearned').textContent = un.join('　');
    $('#wrCheckNote').textContent = 'いろの ついた かんじは まだ ならって いないよ。ひらがなで 書こう。';
    $('#wrFix').hidden = false;
    /* 端末に辞書が残っていれば通信は起きない。案内は実際の状態に合わせる */
    if(!needsDictDownload()){
      $('#wrDictNote').textContent = 'じしょは よみこみずみ。すぐ できるよ。';
    }else{
      $('#wrDictNote').textContent = 'じしょを かくにん しています…';
      dictOnDevice().then(has=>{
        $('#wrDictNote').textContent = has
          ? 'じしょは この タブレットに あるよ。すぐ できる。'
          : '「ぜんぶ ひらがなに して」を おすと、じしょ（やく' + dictSizeMB()
            + 'MB）を よみこみます。はじめの 1回だけなので、Wi-Fi の ある ところで おしてね。';
      });
    }
  }
  $('#wrCheckWrap').scrollIntoView({ block:'nearest' });
}

/* 2だんめ：辞書を使って ぜんぶ ひらがなに直す（明示的に押したときだけ） */
function fixWrites(){
  const rows = writeLogsOf(writesTaskId);
  const wrap = $('#wrOutWrap'), note = $('#wrOutNote'), btn = $('#wrFix');
  if(!rows.length) return;

  const first = needsDictDownload();
  btn.disabled = true;
  btn.textContent = first ? 'じしょを よみこみ中…' : 'なおしています…';
  if(first){
    $('#wrDictNote').textContent = 'じしょを よみこんでいます。'
      + 'ほかの ところは さわれるから、まっててね。';
    /* 何ファイルまで進んだかを出す。だまって待たせると、動いているのか
       止まっているのか 分からず、大人でも原因を追えなくなる */
    setDictProgress(p=>{
      $('#wrDictNote').textContent = 'じしょを よみこみ中… '
        + p.done + ' / ' + p.total + '（' + (p.bytes / 1048576).toFixed(1) + 'MB）';
    });
  }

  /* 1件ずつ 順に 変換する。ぜんぶ つないで 1回で 変換すると、
     どこが どの日の 文なのか 分からなくなり、カードに うつせない。
     1件 しくじっても そこだけ 元の文で のこし、ほかは 出す */
  const fails = [];
  const un = [];
  rows.reduce((chain, l)=> chain.then(parts =>
    convertForTranscription(String(l.memo || '')).then(r=>{
      const day = fmtDate(new Date(l.at));
      if(r.ok) r.unlearned.forEach(ch=>{ if(un.indexOf(ch) < 0) un.push(ch); });
      else     fails.push(day + '（' + r.reason + '）');
      parts.push('【' + day + '】\n' + r.text);
      return parts;
    })
  ), Promise.resolve([])).then(parts=>{
    $('#wrOut').value = parts.join('\n\n');
    wrap.hidden = false;
    if(fails.length){
      note.textContent = 'いまは じどうで なおせません（' + fails.join('、') + '）。'
        + '上の いろが ついた かんじを、じぶんで ひらがなに してね。';
      $('#wrDictNote').textContent = '';
    }else{
      note.textContent = un.length
        ? 'ならっていない かんじ（' + un.join('・') + '）を ひらがなに しました。'
        : 'ぜんぶ 2年生までの かんじだったよ。';
      $('#wrDictNote').textContent = 'じしょの よみこみは おわりました。つぎからは すぐ できるよ。';
    }
    wrap.scrollIntoView({ block:'nearest' });
  }).finally(()=>{
    setDictProgress(null);
    btn.disabled = false;
    btn.textContent = 'ぜんぶ ひらがなに して';
  });
}

/* ---------------------------------------------------------
   ビュー：やったこと（きろく）
   --------------------------------------------------------- */
function viewLog(){
  if(!state.logs.length){
    return `<div class="paper"><p class="empty">まだ きろくが ないよ。</p></div>`;
  }
  const byDay = {};
  state.logs.forEach(l=>{
    const k = dayKey(new Date(l.at));
    (byDay[k] = byDay[k] || []).push(l);
  });
  const keys = Object.keys(byDay).sort().reverse();
  return keys.map(k=>`
    <section class="sec">
      <div class="day-head">${fmtDate(keyToDate(k))}<span class="cnt">${byDay[k].length}こ</span></div>
      <div class="paper today-list">${byDay[k].slice().reverse().map(logRowHTML).join('')}</div>
    </section>`).join('');
}

/* ---------------------------------------------------------
   ビュー：カレンダー
   --------------------------------------------------------- */
/* その日を みどりに ぬるか どうか。基準を変えたいときは この関数だけを直せばよい。
   いまの基準：
     'all'  … その日の きろくが 1件いじょう ある（なにか やれば みどり）
     'none' … きろくが ない
   ぜんぶ やった日だけを みどりにすると、みどりの日が とても少なくなって
   かえって やる気が しぼむ。つづいていることが 見えるほうを だいじにする */
function calDayMark(key){
  return calLogsOf(key).length ? 'all' : 'none';
}

/* ログの at は UTC の ISO なので、かならず その場所の日づけに なおしてから くらべる */
function calLogsOf(key){
  return state.logs.filter(l => dayKey(new Date(l.at)) === key);
}

/* 夏休みの はじめ／おわり。日づけだけを見たいので 0:00 に そろえる。
   せっていが 空のときは null（＝かぎをかけない） */
function calRange(){
  const cut = s=>{
    const d = parseLocal(s);
    return (d.getTime() === d.getTime()) ? new Date(d.getFullYear(), d.getMonth(), d.getDate()) : null;
  };
  return { start: cut(config.startAt), end: cut(config.endAt) };
}
function calMonthTop(d){ return new Date(d.getFullYear(), d.getMonth(), 1); }

/* その日に きろくが ある課題の group を、決まった順で ならべる（色の丸のもと） */
function calGroupsOf(logs){
  const found = {};
  logs.forEach(l=>{
    const t = config.tasks.find(x => x.id === l.taskId);
    if(t) found[t.group] = true;
  });
  return ['must','option','daily'].filter(g => found[g]);
}
function calHasFree(logs){
  return logs.some(l=>{
    const t = config.tasks.find(x => x.id === l.taskId);
    return isFree(t);
  });
}

function viewCalendar(){
  const now = new Date(), todayKey = dayKey(now);
  const r = calRange();
  const dailyEnabled = !!config.showDaily && config.tasks.some(t=>t.group==='daily');
  const freeEnabled = dailyEnabled && config.tasks.some(isFree);
  if(!calMonth) calMonth = calMonthTop(now);

  const top = calMonth;
  const y = top.getFullYear(), m = top.getMonth();
  const lastDate = new Date(y, m+1, 0).getDate();

  // 夏休みの外の月へは いかせない（せっていが 空なら 自由に うごける）
  const canPrev = !r.start || top > calMonthTop(r.start);
  const canNext = !r.end   || top < calMonthTop(r.end);

  const wd = WD.map((w,i)=>
    `<div class="cal-wd${i===0?' cal-wd--sun':''}${i===6?' cal-wd--sat':''}">${w}</div>`).join('');

  let cells = '';
  for(let i=0; i<top.getDay(); i++) cells += `<div class="cal-cell cal-cell--blank"></div>`;

  for(let d=1; d<=lastDate; d++){
    const date = new Date(y, m, d);
    const key = dayKey(date);
    const logs = calLogsOf(key);
    const mark = calDayMark(key);
    const out = (r.start && date < r.start) || (r.end && date > r.end);

    const cls = ['cal-day'];
    if(key === todayKey)   cls.push('is-today');
    if(key === calDay)     cls.push('is-sel');
    if(out)                cls.push('is-out');
    if(mark === 'all')     cls.push('is-all');
    if(date > now && !out) cls.push('is-mirai');

    const dots = calGroupsOf(logs).map(g=>
      `<span class="cal-dot cal-dot--${g}"></span>`).join('');

    cells += `
      <button class="${cls.join(' ')}" data-day="${key}" type="button"
        aria-pressed="${key === calDay ? 'true' : 'false'}"
        aria-label="${esc(fmtDate(date))}">
        <span class="cal-num">${d}</span>
        <span class="cal-dots">${dots}${calHasFree(logs) ? `<span class="cal-free">📝</span>` : ''}</span>
      </button>`;
  }

  return `
  <section class="sec">
    <div class="cal-nav paper">
      <button class="btn btn-sm btn-ghost" data-calmove="-1" type="button"
        ${canPrev ? '' : 'disabled'}>◀ まえの月</button>
      <h2 class="cal-title">${y}年 ${m+1}月</h2>
      <button class="btn btn-sm btn-ghost" data-calmove="1" type="button"
        ${canNext ? '' : 'disabled'}>つぎの月 ▶</button>
    </div>

    <div class="paper cal-paper">
      <div class="cal-grid cal-grid--wd">${wd}</div>
      <div class="cal-grid">${cells}</div>
    </div>

    <div class="paper cal-legend">
      <span class="cal-leg"><span class="cal-dot cal-dot--must"></span>かならず やる</span>
      <span class="cal-leg"><span class="cal-dot cal-dot--option"></span>つぎに やる</span>
      ${dailyEnabled ? `<span class="cal-leg"><span class="cal-dot cal-dot--daily"></span>まいにち</span>` : ''}
      <span class="cal-leg"><span class="cal-leg-box"></span>なにか やった日</span>
      ${freeEnabled ? `<span class="cal-leg"><span class="cal-free">📝</span>なんでも きろく</span>` : ''}
    </div>
  </section>

  ${calDay ? calDetailHTML(calDay) : `
    <div class="paper"><p class="empty">日づけを おすと、その日の きろくが 見られるよ。</p></div>`}
  `;
}

function calDetailHTML(key){
  const logs = calLogsOf(key).slice().sort((a,b)=> new Date(a.at) - new Date(b.at));
  const books = state.books.filter(b => b.date === key);

  const bookHTML = books.map(b=>`
    <div class="cal-book">
      <div class="cal-book-title">${esc(b.title)}</div>
      ${b.rating ? `<div class="cal-book-stars">${'★'.repeat(b.rating)}${'☆'.repeat(3-b.rating)}</div>` : ''}
      ${(b.memoOut || b.memo) ? `<p class="cal-book-memo">${esc(b.memoOut || b.memo)}</p>` : ''}
    </div>`).join('');

  const body = logs.length
    ? `<div class="paper today-list">${logs.map(logRowHTML).join('')}</div>`
    : `<div class="paper"><p class="empty">この日は きろくが ないよ</p></div>`;

  return `
  <section class="sec cal-detail">
    <div class="day-head">${esc(fmtDate(keyToDate(key)))}<span class="cnt">${logs.length}こ</span></div>
    ${body}
    ${books.length ? `
      <div class="day-head">よんだ本<span class="cnt">${books.length}さつ</span></div>
      <div class="paper cal-books">${bookHTML}</div>` : ''}
  </section>`;
}

/* ---------------------------------------------------------
   ビュー：せってい（おうちの人むけ）
   --------------------------------------------------------- */
/* ---------------------------------------------------------
   保護者ページ（最初の画面）— 進捗の一覧
   --------------------------------------------------------- */
function viewParent(){
  const now = new Date();
  const en = parseLocal(config.endAt);
  const ms = en - now;
  const nat = natsuPct();
  const s = overall('must');
  const so = overall('option');

  const row = t=>{
    const p = prog(t);
    const nx = nextLabel(t);
    const next = p.isDone ? '完了'
      : (t.type === 'daily' ? (isFree(t) ? (p.done ? '本日記入済み' : '本日未記入')
                                         : '本日 ' + p.done + '/' + p.total + (t.targetUnit||''))
                            : (nx ? '次は ' + nx.num + nx.tail : ''));
    return `
      <tr class="${p.isDone ? 'is-done' : ''}">
        <th>${esc(t.name)}</th>
        <td class="pg-bar"><div class="bar"><div class="bar-fill" style="width:${p.pct.toFixed(1)}%"></div></div></td>
        <td class="pg-num">${esc(p.text)}</td>
        <td class="pg-next">${esc(next)}</td>
      </tr>`;
  };

  const group = (kind, label)=>{
    const list = config.tasks.filter(t=>t.group===kind);
    if(!list.length) return '';
    return `
      <section class="sec">
        <div class="sec-head"><h2>${label}</h2>
          <span class="sec-note">${list.filter(t=>prog(t).isDone).length}/${list.length} 完了</span></div>
        <div class="paper"><table class="pgtable">${list.map(row).join('')}</table></div>
      </section>`;
  };

  return `
  <div class="paper parent-head">
    <div>
      <h2>保護者用ページ</h2>
      <p>${esc(config.title)}</p>
    </div>
    <a class="btn btn-sm" href="#config">設定</a>
    <a class="btn btn-sm" href="#home">子ども画面へ</a>
  </div>

  ${syncPromptHTML()}

  ${window.NatsuSync && window.NatsuSync.getCode() ? `<p class="set-note sync-device-count" id="syncDeviceCount">このおうちで共有設定済みの端末：${window.NatsuSync.deviceCount()}台</p>` : ''}

  ${parentMessageEditorHTML()}

  <section class="paper pstat">
    <div class="pstat-grid">
      <div><span class="pstat-lab">残り</span>
        <span class="pstat-val">${ms > 0
          ? `<span class="pstat-num">${Math.floor(ms/86400000)}</span><small class="pstat-unit">日</small><span class="pstat-num">${Math.floor(ms/3600000)%24}</span><small class="pstat-unit">時間</small>`
          : '終了'}</span></div>
      <div><span class="pstat-lab">夏休みの経過</span>
        <span class="pstat-val">${Math.round(nat)}<small>%</small></span></div>
      <div><span class="pstat-lab">必須の宿題</span>
        <span class="pstat-val">${Math.round(s.pct)}<small>% (${s.done}/${s.total})</small></span></div>
      <div><span class="pstat-lab">つぎに やる</span>
        <span class="pstat-val">${so.total ? Math.round(so.pct) : 0}<small>% (${so.done}/${so.total})</small></span></div>
    </div>
  </section>

  ${group('must','必ずやる')}
  ${group('option','つぎに やる')}
  ${bookSectionHTML()}

  <section class="sec">
    <div class="sec-head"><h2>進捗サマリー</h2></div>
    <div class="paper">
      <p class="set-note">現在の進捗をプレーンテキストで書き出します。コピーしてメールやメッセージに貼り付けられます。</p>
      <div class="set-actions">
        <label style="font-size:16px;font-weight:900;display:flex;align-items:center;gap:8px">記録の範囲
          <select id="sumDays" style="width:auto;min-width:130px;padding:8px 10px">
            <option value="7">直近7日</option>
            <option value="30">直近30日</option>
            <option value="0">全期間</option>
            <option value="-1">記録は含めない</option>
          </select>
        </label>
        <button class="btn btn-sm btn-do" id="sumMake" type="button">サマリーを生成</button>
      </div>
      <div style="padding:0 16px 4px">
        <textarea id="sumOut" rows="14" readonly placeholder="「サマリーを生成」を押すとここに表示されます"
          style="font-family:var(--font-num);font-size:14px;line-height:1.7"></textarea>
      </div>
      <div class="set-actions">
        <button class="btn btn-sm" id="sumCopy" type="button">コピー</button>
        <button class="btn btn-sm" id="sumSave" type="button">.txt で保存</button>
      </div>
    </div>
  </section>

  <div class="set-actions" style="padding:8px 0 24px">
    <a class="btn btn-wide" href="#config" style="text-decoration:none;text-align:center">設定ページを開く</a>
  </div>

  ${privacyNoteHTML()}`;
}

function parentMessageEditorHTML(){
  const msg = config.parentMessage;
  return `
  <section class="sec parent-message-editor">
    <div class="sec-head"><h2>こどもへの メッセージ</h2><span class="sec-note">80文字まで</span></div>
    <div class="paper parent-message-form">
      <div class="parent-message-fields">
        <div class="parent-sender-fields">
          <label class="lab" for="parentMessageSender">表示する名前（より）
            <select id="parentMessageSender">${parentSenderOptions(msg.sender)}</select></label>
          <label class="lab sender-custom" id="parentMessageCustomWrap" for="parentMessageCustom" hidden>名前
            <input id="parentMessageCustom" type="text" maxlength="20" value="${esc(msg.customSender)}" placeholder="例：おばあちゃん"></label>
        </div>
        <label class="lab parent-message-text" for="parentMessageText">メッセージ
          <textarea id="parentMessageText" rows="1" maxlength="80" placeholder="例：きょうも おつかれさま！">${esc(msg.text)}</textarea></label>
      </div>
      <div class="parent-message-controls">
        <label class="parent-message-toggle"><input id="parentMessageEnabled" type="checkbox"${msg.enabled?' checked':''}> こども画面に 表示する</label>
        <button class="btn btn-sm btn-do btn-icon-text" id="parentMessageSave" type="button">${icon('save')}<span>保存する</span></button>
      </div>
      <p class="set-note">空欄またはチェックを外したときは、こども画面に表示されません。</p>
    </div>
  </section>`;
}

/* 「べつの端末と つなぐ」。あいことばを 親の端末で 作り、子の端末に 同じものを 入れる。
   Firebase を 設定していないうちは、その旨だけを 出す */
const SYNC_LABEL = {
  off:        ['—',  'つないでいません'],
  connecting: ['…',  'つないでいます'],
  online:     ['✓',  'つながっています'],
  offline:    ['⌛', 'オフライン（この端末にためています）'],
  error:      ['!',  'つながりません']
};

/* まだ あいことばを 入れていない（＝この端末は ひとりぼっち）か。
   Firebase の 用意が すんでいて、あいことばだけ 無い ときに true */
function syncNeedsSetup(){
  const S = window.NatsuSync;
  return !!(S && S.configured() && !S.getCode());
}

/* 保護者ページの いちばん上に 出す ぶん。
   まだ つないでいない あいだは、進捗より先に ここを 見てほしい。
   つないだ あとは 出さない（設定ページの 元の場所に もどる） */
function syncPromptHTML(){
  if(!syncNeedsSetup()) return '';
  return `
  <section class="sec sync-prompt">
    ${syncSectionHTML({ lead:'この端末の記録は、まだこの端末の中だけにあります。'
                           + 'あいことばを決めると、同じ家庭の複数の端末で使えます。' })}
  </section>`;
}

function syncSectionHTML(opts){
  const lead = opts && opts.lead;
  const S = window.NatsuSync;
  if(!S){
    return `
  <section class="sec">
    <div class="sec-head"><h2>べつの端末と つなぐ</h2></div>
    <div class="paper">
      <p class="set-note">同期の読み込みに失敗しました。記録はこの端末に保存されています。</p>
    </div>
  </section>`;
  }

  if(!S.configured()){
    return `
  <section class="sec">
    <div class="sec-head"><h2>べつの端末と つなぐ</h2></div>
    <div class="paper">
      <p class="set-note">まだ準備ができていません。<code>assets/sync.js</code> の
      <code>FIREBASE_CONFIG</code> に Firebase の設定を貼ると、この欄が使えるようになります。
      手順は README の「端末間で共有する」にあります。</p>
    </div>
  </section>`;
  }

  const code = S.getCode();
  const [mark, text] = SYNC_LABEL[S.status()] || SYNC_LABEL.off;

  return `
  <section class="sec">
    <div class="sec-head"><h2>べつの端末と つなぐ</h2>
      <span class="sec-note" id="syncStatus">${mark} ${esc(S.statusText() || text)}</span></div>
    <div class="paper">
      ${lead ? `<p class="set-note sync-lead">${esc(lead)}</p>` : ''}
      <p class="set-note">同じ「あいことば」を入れた複数の端末で、同じ記録と設定を使えます。</p>
      <div class="set-row"><span class="lab">あいことば</span>
        <input type="text" id="syncCode" value="${esc(code)}" spellcheck="false"
               autocapitalize="off" autocorrect="off" placeholder="まだ ありません"></div>
      <div class="set-actions">
        <button class="btn btn-sm" id="syncSave" type="button">この あいことばで つなぐ</button>
        <button class="btn btn-sm" id="syncCopy" type="button">コピー</button>
        ${code ? '' : '<button class="btn btn-sm" id="syncMake" type="button">新しく作る</button>'}
      </div>
      ${code ? `<p class="set-note sync-device-count" id="syncDeviceCount">このおうちで共有設定済みの端末：${S.deviceCount()}台</p><div class="set-actions">
        <button class="btn btn-sm btn-danger" id="syncOff" type="button">つなぐのをやめる</button>
      </div>` : ''}
    </div>
  </section>`;
}

/* 保護者ページの本の記録一覧。書名や読んだ日はここから訂正できる */
function bookSectionHTML(){
  if(!config.tasks.some(isBook)) return '';
  const rows = state.books.slice().sort((a,b)=> (b.date||'').localeCompare(a.date||'') || b.nth - a.nth);

  return `
  <section class="sec">
    <div class="sec-head"><h2>本の記録</h2><span class="sec-note">${rows.length}冊</span></div>
    <div class="paper">
      ${rows.length ? rows.map(b=>`
        <div class="book-row">
          <span class="book-no">${b.nth}</span>
          <div class="book-main">
            <div class="book-title">${esc(b.title)}</div>
            <div class="book-sub">${[
              b.date, b.author, b.publisher,
              b.rating ? '★'.repeat(b.rating) : ''
            ].filter(Boolean).map(esc).join('　')}</div>
            ${b.memoOut || b.memo ? `<div class="book-memo">${esc(b.memoOut || b.memo)}</div>` : ''}
          </div>
          <button class="btn btn-sm" data-open="${esc(b.taskId)}" data-book="${esc(b.id)}" type="button">編集</button>
          <button class="icon-btn del" data-delbook="${esc(b.id)}" title="削除" type="button">🗑</button>
        </div>`).join('')
      : `<p class="empty">まだ記録がありません。</p>`}
      <p class="set-note">「編集」で書名・読んだ日・感想を訂正できます。削除すると冊数も1つ戻ります。</p>
    </div>
  </section>`;
}

/* ---------------------------------------------------------
   きろくシート
   --------------------------------------------------------- */
let sheetTask = null, sheetSel = null, sheetSteps = null, sheetWrap = null;
let sheetRating = 0, sheetBookId = null;

function openSheet(id, editBookId){
  const t = config.tasks.find(x=>x.id===id);
  if(!t) return;
  sheetTask = t;
  const p = prog(t);

  if(isBook(t)){ openBookSheet(t, p, editBookId); return; }
  if(isFree(t)){ openFreeSheet(t); return; }

  let body = '';
  if(t.type === 'count'){
    sheetSel = p.done;
    body += `
    <div class="field">
      <span class="lab">どこまで やった？</span>
      <p class="hint">やった ところを おしてね。そこまで ぜんぶ できたことに なるよ。</p>
      <p class="sel-say" id="selSay">${selSayText(t, sheetSel)}</p>
      <div class="nums" id="nums">${numsHTML(t, sheetSel)}</div>
    </div>`;
  }
  else if(t.type === 'step'){
    sheetSteps = (t.steps||[]).map((_,i)=> !!(p.arr && p.arr[i]));
    body += `
    <div class="field">
      <span class="lab">できた ところを おしてね</span>
      <div class="steps" id="steps">${stepsHTML(t, sheetSteps)}</div>
    </div>`;
  }
  else {
    sheetSel = p.done;
    const max = Math.max(p.total, 5);
    body += `
    <div class="field">
      <span class="lab">きょうは どのくらい できた？</span>
      <p class="hint">1日の めあては ${p.total}${esc(t.targetUnit||'')}だよ。</p>
      <div class="tally" id="tally">
        ${Array.from({length:max+1},(_,i)=>
          `<button class="tally-btn${i===sheetSel?' sel':''}" data-n="${i}" type="button">${i}</button>`).join('')}
      </div>
    </div>`;
  }

  // さいごの しあげ（マルつけ・なおし）。番号や段階を ぜんぶ 終えてから 見せる
  if(hasWrap(t)){
    sheetWrap = p.wrap.slice();
    body += `
    <div class="field field-wrap" id="wrapField"${p.numDone ? '' : ' hidden'}>
      <span class="lab">さいごの しあげ</span>
      <p class="hint">ぜんぶ おわったね！ できた ところを おしてね。</p>
      <div class="steps" id="wraps">${wrapsHTML(sheetWrap)}</div>
    </div>`;
  }

  // 観察の観点。count と step のどちらでも出す
  if((t.questions||[]).length){
    body += `<div class="field">
      <span class="lab">かんさつ してみよう</span>
      <p class="hint">わかるところだけで いいよ。こえで 入れても OK。</p>
      ${t.questions.map((q,i)=>`
        <div class="q">
          <p class="q-t"><span class="qn">${i+1}</span>${esc(q)}</p>
          <div class="mic-row">
            <textarea data-q="${i}" rows="2" placeholder="かいてみよう"></textarea>
            ${micBtn('q'+i)}
          </div>
        </div>`).join('')}
    </div>`;
  }

  body += `
  <div class="field">
    <span class="lab">${esc(t.memoLabel || 'やったことを かこう')}<span style="font-weight:700;color:var(--ai-usu);font-size:15px">（なくても OK）</span></span>
    <div class="mic-row">
      <textarea id="memo" rows="3" placeholder="れい：きょうは しずかに できた"></textarea>
      ${micBtn('memo')}
    </div>
    <p class="mic-note">${hasSR()
      ? '🎤 を おすと こえで かけるよ。'
      : 'キーボードの 🎤 マークを おすと、こえで かけるよ。'}</p>
  </div>`;

  $('#sheetTitle').textContent = t.name;
  $('#sheetBody').innerHTML = body;
  $('#sheetBody').scrollTop = 0;
  $('#sheetWrap').hidden = false;
  document.body.style.overflow = 'hidden';
}

/* ---------------------------------------------------------
   本の記録シート
   --------------------------------------------------------- */
function openBookSheet(t, p, editBookId){
  const f = bookFields(t);
  const b = editBookId ? state.books.find(x=>x.id===editBookId) : null;
  sheetBookId = b ? b.id : null;
  sheetRating = b ? (b.rating|0) : 0;

  const nth = b ? b.nth : p.done + 1;
  const val = k => esc(b ? (b[k] || '') : '');

  const body = `
  <p class="book-nth">${t.numbered ? maru(nth) : nth}さつめ</p>

  <div class="field">
    <span class="lab">本の なまえ<span class="need-mark">かならず 入れてね</span></span>
    <div class="mic-row">
      <input type="text" id="bkTitle" value="${val('title')}" placeholder="れい：あばれネコ">
      ${micBtn('bkTitle')}
    </div>
    <p class="need-msg" id="bkTitleNeed" hidden>本の なまえが ないと きろく できないよ。</p>
  </div>

  ${f.author ? `
  <div class="field">
    <span class="lab">さくしゃ</span>
    <div class="mic-row">
      <input type="text" id="bkAuthor" value="${val('author')}" placeholder="かいた人の なまえ">
      ${micBtn('bkAuthor')}
    </div>
  </div>` : ''}

  ${f.publisher ? `
  <div class="field">
    <span class="lab">しゅっぱんしゃ</span>
    <div class="mic-row">
      <input type="text" id="bkPublisher" value="${val('publisher')}" placeholder="本を 出した ところ">
      ${micBtn('bkPublisher')}
    </div>
  </div>` : ''}

  <div class="field">
    <span class="lab">よんだ日</span>
    <input type="date" id="bkDate" value="${esc(b ? b.date : dayKey(new Date()))}">
  </div>

  ${f.rating ? `
  <div class="field">
    <span class="lab">おすすめ度</span>
    <div class="stars" id="bkStars">
      ${[1,2,3].map(n=>`<button class="star${n<=sheetRating?' on':''}" data-star="${n}"
          type="button" aria-label="★${n}">★</button>`).join('')}
      <span class="star-say" id="bkStarSay">${starSay(sheetRating)}</span>
    </div>
  </div>` : ''}

  <div class="field">
    <span class="lab">ひとこと感想</span>
    <p class="hint">こえで 入れても いいよ。書けたら「かんじを しらべる」を おしてね。</p>
    <div class="mic-row">
      <textarea id="bkMemo" rows="3" placeholder="おもしろかった ところを かこう">${esc(b ? (b.memo||'') : '')}</textarea>
      ${micBtn('bkMemo')}
    </div>
    <div class="set-actions" style="padding:12px 0 0">
      <button class="btn btn-sm btn-do" id="bkCheck" type="button">かんじを しらべる</button>
    </div>

    <div id="bkCheckWrap" hidden>
      <div class="kj-box">
        <span class="lab" style="display:block">ならっていない かんじ</span>
        <p class="kj-list" id="bkUnlearned"></p>
        <p class="kj-view" id="bkMarked"></p>
        <p class="hint" id="bkCheckNote"></p>
      </div>
      <div class="set-actions" style="padding:12px 0 0">
        <button class="btn btn-sm" id="bkFix" type="button">ぜんぶ ひらがなに して</button>
      </div>
      <p class="mic-note" id="bkDictNote"></p>
    </div>

    <div id="bkOutWrap" ${b && b.memoOut ? '' : 'hidden'}>
      <span class="lab" style="margin-top:16px;display:block">かきうつす文（2年生までの かんじ）</span>
      <p class="hint">カードには この文を うつしてね。なおしても いいよ。</p>
      <textarea id="bkOut" rows="3">${esc(b ? (b.memoOut||'') : '')}</textarea>
      <p class="mic-note" id="bkOutNote"></p>
    </div>
  </div>`;

  $('#sheetTitle').textContent = t.name;
  $('#sheetBody').innerHTML = body;
  $('#sheetSave').textContent = 'できた！';
  $('#sheetBody').scrollTop = 0;
  $('#sheetWrap').hidden = false;
  document.body.style.overflow = 'hidden';
}

/* ---------------------------------------------------------
   なんでもきろくシート（毎日の自由記述）
   --------------------------------------------------------- */
function openFreeSheet(t){
  $('#sheetTitle').textContent = t.name;
  $('#sheetBody').innerHTML = `
    <div class="field">
      <span class="lab">${esc(t.memoLabel || 'きょうは なにを した？')}</span>
      <p class="hint">${esc(t.freeHint || 'なんでも いいよ。')}</p>
      <div class="mic-row">
        <textarea id="freeMemo" rows="6" placeholder="かいてみよう"></textarea>
        ${micBtn('freeMemo')}
      </div>
      <p class="mic-note">${hasSR()
        ? '🎤 を おすと こえで かけるよ。'
        : 'キーボードの 🎤 マークを おすと、こえで かけるよ。'}</p>
    </div>
    ${freeTodayHTML(t)}`;
  $('#sheetSave').textContent = 'かけた！';
  $('#sheetBody').scrollTop = 0;
  $('#sheetWrap').hidden = false;
  document.body.style.overflow = 'hidden';
}

/* 今日すでに書いたぶんを見せる。1日に何回でも書き足せる */
function freeTodayHTML(t){
  const today = state.logs.filter(l =>
    l.taskId === t.id && dayKey(new Date(l.at)) === dayKey(new Date()));
  if(!today.length) return '';
  return `
    <div class="field">
      <span class="lab">きょう かいたこと</span>
      <div class="paper today-list">${today.slice().reverse().map(l=>`
        <div class="today-item">
          <span class="ti-time">${fmtTime(new Date(l.at))}</span>
          <div class="ti-body"><div class="ti-memo" style="margin-top:0">${esc(l.memo)}</div></div>
        </div>`).join('')}</div>
    </div>`;
}

function saveFreeSheet(){
  const t = sheetTask;
  const text = ($('#freeMemo').value || '').trim();
  if(!text){ toast('なにか かいてね'); $('#freeMemo').focus(); return; }

  const now = new Date();
  const days = Object.assign({}, (state.progress[t.id] || {}).days || {});
  days[dayKey(now)] = Math.max(1, days[dayKey(now)] | 0);
  state.progress[t.id] = Object.assign({}, state.progress[t.id], { days });

  state.logs.push({
    id: 'l' + now.getTime() + Math.floor(Math.random()*1000),
    at: now.toISOString(), taskId: t.id, name: t.name,
    what: 'きょうの きろく', memo: text
  });
  saveSt();

  closeSheet();
  stamp('かけたね！');
  setTimeout(()=> render({ keepScroll:true }), 60);
}

function starSay(n){
  return n === 3 ? 'とても おすすめ' : n === 2 ? 'おすすめ' : n === 1 ? 'ふつう' : 'まだ えらんでいない';
}

function saveBookSheet(){
  const t = sheetTask;
  const title = ($('#bkTitle').value || '').trim();
  const need = $('#bkTitleNeed'), titleBox = $('#bkTitle');
  if(!title){
    /* 感想を書いて かんじも 直したあとに ここで 止まると、
       画面の下のほうを 見ている ので 何も 起きていないように 見える。
       入力らんまで もどして、その場に 理由を 出す */
    if(need) need.hidden = false;
    titleBox.classList.add('is-need');
    titleBox.scrollIntoView({ block:'center' });
    titleBox.focus();
    toast('本の なまえを 入れてね');
    return;
  }
  if(need) need.hidden = true;
  titleBox.classList.remove('is-need');

  const now = new Date();
  const memo = ($('#bkMemo').value || '').trim();
  const out  = ($('#bkOut') && $('#bkOut').value.trim()) || '';
  const rec = {
    taskId: t.id,
    title,
    author:    ($('#bkAuthor')    && $('#bkAuthor').value.trim())    || '',
    publisher: ($('#bkPublisher') && $('#bkPublisher').value.trim()) || '',
    date:      ($('#bkDate').value) || dayKey(now),
    rating:    sheetRating|0,
    memo, memoOut: out
  };

  if(sheetBookId){
    // 訂正。冊数は変わらないので進捗はそのまま
    const i = state.books.findIndex(x=>x.id===sheetBookId);
    if(i >= 0) state.books[i] = Object.assign(state.books[i], rec);
  }else{
    const p = prog(t);
    rec.id = 'b' + now.getTime() + Math.floor(Math.random()*1000);
    rec.nth = p.done + 1;
    state.books.push(rec);
    state.progress[t.id] = Object.assign({}, state.progress[t.id], { done: rec.nth });
    state.logs.push({
      id: 'l' + now.getTime() + Math.floor(Math.random()*1000),
      at: now.toISOString(), taskId: t.id, name: t.name,
      what: (t.numbered ? maru(rec.nth) : rec.nth + (t.unit||'')) + '　「' + title + '」',
      memo: [rec.author && 'さくしゃ：' + rec.author,
             rec.rating ? 'おすすめ度 ' + '★'.repeat(rec.rating) : '',
             out || memo].filter(Boolean).join('\n')
    });
  }
  saveSt();

  const done = prog(t).isDone;
  closeSheet();
  stamp(sheetBookId ? 'なおしたよ' : (done ? 'ぜんぶ よんだ！' : 'よめたね！'));
  setTimeout(()=> render({ keepScroll:true }), 60);
}

/* 1だんめ：ならっていない漢字を すぐ 見せる。通信も 待ち時間も ない */
function checkKanji(){
  const src = ($('#bkMemo').value || '').trim();
  if(!src){ toast('さきに 感想を かいてね'); $('#bkMemo').focus(); return; }

  const un = unlearnedKanji(src);
  $('#bkCheckWrap').hidden = false;
  $('#bkMarked').innerHTML = markUnlearnedHTML(src);

  if(!un.length){
    $('#bkUnlearned').textContent = 'なし';
    $('#bkCheckNote').textContent = 'ぜんぶ 2年生までの かんじだったよ。そのまま カードに うつせるね。';
    $('#bkFix').hidden = true;
    $('#bkDictNote').textContent = '';
  }else{
    $('#bkUnlearned').textContent = un.join('　');
    $('#bkCheckNote').textContent = 'いろの ついた かんじは まだ ならって いないよ。ひらがなで 書こう。';
    $('#bkFix').hidden = false;
    /* 端末に辞書が残っていれば通信は起きない。案内は実際の状態に合わせる */
    if(!needsDictDownload()){
      $('#bkDictNote').textContent = 'じしょは よみこみずみ。すぐ できるよ。';
    }else{
      $('#bkDictNote').textContent = 'じしょを かくにん しています…';
      dictOnDevice().then(has=>{
        $('#bkDictNote').textContent = has
          ? 'じしょは この タブレットに あるよ。すぐ できる。'
          : '「ぜんぶ ひらがなに して」を おすと、じしょ（やく' + dictSizeMB()
            + 'MB）を よみこみます。はじめの 1回だけなので、Wi-Fi の ある ところで おしてね。';
      });
    }
  }
  $('#bkCheckWrap').scrollIntoView({ block:'nearest' });
}

/* 2だんめ：辞書を使って ぜんぶ ひらがなに直す（明示的に押したときだけ） */
function fixKanji(){
  const src = ($('#bkMemo').value || '').trim();
  const wrap = $('#bkOutWrap'), note = $('#bkOutNote'), btn = $('#bkFix');
  if(!src){ toast('さきに 感想を かいてね'); return; }

  const first = needsDictDownload();
  btn.disabled = true;
  btn.textContent = first ? 'じしょを よみこみ中…' : 'なおしています…';
  if(first){
    $('#bkDictNote').textContent = 'じしょを よみこんでいます。'
      + 'ほかの ところは さわれるから、まっててね。';
    /* 何ファイルまで進んだかを出す。だまって待たせると、動いているのか
       止まっているのか 分からず、大人でも原因を追えなくなる */
    setDictProgress(p=>{
      $('#bkDictNote').textContent = 'じしょを よみこみ中… '
        + p.done + ' / ' + p.total + '（' + (p.bytes / 1048576).toFixed(1) + 'MB）';
    });
  }

  convertForTranscription(src).then(r=>{
    $('#bkOut').value = r.text;
    wrap.hidden = false;
    if(r.ok){
      note.textContent = r.unlearned.length
        ? 'ならっていない かんじ（' + r.unlearned.join('・') + '）を ひらがなに しました。'
        : 'ぜんぶ 2年生までの かんじだったよ。';
      $('#bkDictNote').textContent = 'じしょの よみこみは おわりました。つぎからは すぐ できるよ。';
    }else{
      note.textContent = 'いまは じどうで なおせません（' + r.reason + '）。'
        + '上の いろが ついた かんじを、じぶんで ひらがなに してね。';
      $('#bkDictNote').textContent = '';
    }
    wrap.scrollIntoView({ block:'nearest' });
  }).finally(()=>{
    setDictProgress(null);
    btn.disabled = false;
    btn.textContent = 'ぜんぶ ひらがなに して';
  });
}

function numsHTML(t, sel){
  return Array.from({length: Math.max(1,t.total|0)}, (_,k)=>{
    const n = k+1;
    const cls = n===sel ? 'num sel' : (n<sel ? 'num done' : 'num');
    return `<button class="${cls}" data-n="${n}" type="button">${t.numbered ? maru(n) : n}</button>`;
  }).join('');
}
function selSayText(t, sel){
  if(!sel) return 'まだ ひとつも やっていない';
  const label = t.numbered ? maru(sel) : sel + (t.unit||'');
  return (sel >= (t.total|0)) ? label + ' まで ぜんぶ できた！' : label + ' まで できた';
}
function stepsHTML(t, arr){
  return (t.steps||[]).map((s,i)=>
    `<button class="step${arr[i]?' on':''}" data-i="${i}" type="button">
       <span class="box">✓</span><span>${esc(s)}</span>
     </button>`).join('');
}

/* しあげの2段階。段階式（step）と おなじ 見た目・おなじ そうさに する */
function wrapsHTML(arr){
  /* ここは 幅が あるので、みじかい「マルつけ」ではなく
     だれが やることか 分かる 言い方を つかう */
  return WRAP_LABELS_FULL.map((s,i)=>
    `<button class="step${arr[i]?' on':''}" data-w="${i}" type="button">
       <span class="box">✓</span><span>${esc(s)}</span>
     </button>`).join('');
}

/* 番号（段階）を いま ぜんぶ おしたら、その場で しあげの欄を 出す */
function syncWrapField(){
  const f = $('#wrapField');
  if(!f || !sheetTask) return;
  const t = sheetTask;
  const ok = t.type === 'count'
    ? (sheetSel|0) >= Math.max(1, t.total|0)
    : !!(sheetSteps && sheetSteps.length && sheetSteps.every(Boolean));
  f.hidden = !ok;
}

function closeSheet(){
  $('#sheetWrap').hidden = true;
  document.body.style.overflow = '';
  stopSR();
  sheetTask = null; sheetSel = null; sheetSteps = null; sheetWrap = null;
  sheetRating = 0; sheetBookId = null;
  $('#sheetSave').textContent = 'きろくする';
}

function saveSheet(){
  const t = sheetTask;
  if(!t) return;
  if(isBook(t)){ saveBookSheet(); return; }
  if(isFree(t)){ saveFreeSheet(); return; }
  const p = prog(t);
  const memo = ($('#memo') && $('#memo').value.trim()) || '';
  const now = new Date();
  let what = '';
  let ok = true;

  if(t.type === 'count'){
    const before = p.done;
    const after = clamp(sheetSel|0, 0, t.total|0);
    state.progress[t.id] = Object.assign({}, state.progress[t.id], { done: after });
    if(after > before){
      what = t.numbered
        ? maru(before+1) + (after>before+1 ? '〜'+maru(after) : '') + ' できた'
        : (before+1) + (after>before+1 ? '〜'+after : '') + (t.unit||'') + ' できた';
    }else if(after < before){
      what = (t.numbered ? maru(after) : after+(t.unit||'')) + ' まで に なおした';
    }else{
      what = 'すすみは そのまま';
    }
  }
  else if(t.type === 'step'){
    const before = (p.arr||[]);
    const added = (t.steps||[]).filter((s,i)=> sheetSteps[i] && !before[i]);
    state.progress[t.id] = Object.assign({}, state.progress[t.id], { steps: sheetSteps.slice() });
    what = added.length ? added.join('・') + ' が できた'
                        : (sheetSteps.filter(Boolean).length + '/' + (t.steps||[]).length + ' に なおした');
    ok = true;
  }
  else {
    const n = clamp(sheetSel|0, 0, 99);
    const days = Object.assign({}, (state.progress[t.id]||{}).days || {});
    days[dayKey(now)] = n;
    state.progress[t.id] = Object.assign({}, state.progress[t.id], { days });
    what = n + (t.targetUnit||'かい') + ' できた';
  }

  // さいごの しあげ。done / steps とは べつに のこす
  if(hasWrap(t) && sheetWrap){
    const added = WRAP_LABELS.filter((s,i)=> sheetWrap[i] && !p.wrap[i]);
    state.progress[t.id] = Object.assign({}, state.progress[t.id], { wrap: sheetWrap.slice() });
    if(added.length) what = [what, added.join('・') + ' が できた'].filter(Boolean).join('　');
  }

  // かんさつの こたえを メモに くっつける
  const qs = $$('#sheetBody [data-q]');
  const ans = qs.map((el,i)=>{
    const v = el.value.trim();
    return v ? '・' + (t.questions[i] || '') + '\n　→ ' + v : '';
  }).filter(Boolean).join('\n');

  const fullMemo = [ans, memo].filter(Boolean).join('\n');

  state.logs.push({
    id: 'l' + now.getTime() + Math.floor(Math.random()*1000),
    at: now.toISOString(),
    taskId: t.id, name: t.name, what, memo: fullMemo
  });
  if(state.logs.length > 3000) state.logs = state.logs.slice(-3000);
  saveSt();

  const after = prog(t);
  closeSheet();
  stamp(after.isDone ? 'ぜんぶ できた！' : 'できた！');
  setTimeout(()=> render({ keepScroll:true }), 60);
  return ok;
}

/* --- こえ入力 --- */
let sr = null, srTargetId = null;
function hasSR(){ return !!(window.SpeechRecognition || window.webkitSpeechRecognition); }
function micBtn(id){
  if(!hasSR()) return '';
  return `<button class="mic" data-mic="${id}" type="button" aria-label="こえで 入れる">🎤</button>`;
}
function startSR(btn, targetEl){
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  stopSR();
  try{
    sr = new SR();
    sr.lang = 'ja-JP'; sr.interimResults = false; sr.continuous = false;
    sr.onresult = e=>{
      const txt = Array.from(e.results).map(r=>r[0].transcript).join('');
      targetEl.value = (targetEl.value ? targetEl.value + ' ' : '') + txt;
    };
    sr.onend = ()=>{ btn.classList.remove('rec'); sr = null; };
    sr.onerror = ()=>{ btn.classList.remove('rec'); toast('こえが きこえなかったよ'); };
    sr.start();
    btn.classList.add('rec');
  }catch(e){ toast('こえ入力が つかえません'); }
}
function stopSR(){ if(sr){ try{ sr.stop(); }catch(e){} sr = null; } $$('.mic.rec').forEach(b=>b.classList.remove('rec')); }

/* ---------------------------------------------------------
   えがく
   --------------------------------------------------------- */
/* keepScroll: 今の位置のまま描き直す。タブを変えたときだけ先頭に戻す */
function render(opts){
  const keepScroll = !!(opts && opts.keepScroll);
  const y = window.scrollY;
  /* 同期の到着などで画面を描き直しても、保護者が入力途中の内容を
     消さない。保存前のメッセージ、サマリー、チェックの状態も含めて
     同じ id の欄へ戻す。 */
  const formDraft = captureFormDraft();

  const shownTitle = TEST_MODE && (!getLocal(K_ONBOARD) || DEBUG_PARENT) ? 'おためし用の設定' : config.title;
  $('#appTitle').textContent = shownTitle;
  $('#todayLabel').textContent = fmtDate(new Date());
  document.title = shownTitle;

  const v = $('#view');
  if(timer){ clearInterval(timer); timer = null; }

  if(tab === 'welcome')       v.innerHTML = viewWelcome();
  else if(tab === 'stats')    v.innerHTML = viewStats();
  else if(tab === 'home')     v.innerHTML = viewHome();
  else if(tab === 'log')      v.innerHTML = viewLog();
  else if(tab === 'calendar') v.innerHTML = viewCalendar();
  else if(tab === 'books')    v.innerHTML = viewBooks();
  else if(tab === 'writes')   v.innerHTML = viewWrites();
  else if(tab === 'config')   v.innerHTML = viewConfig();
  else                        v.innerHTML = viewParent();

  restoreFormDraft(formDraft);

  $$('.tab').forEach(b=> b.classList.toggle('is-on', b.dataset.tab === tab));
  // 子ども画面以外ではタブバーを隠す（それぞれ「もどる」で戻す）
  const noTabs = (tab !== 'home' && tab !== 'log' && tab !== 'calendar');
  $('.tabbar').hidden = noTabs;
  document.body.classList.toggle('no-tabbar', noTabs);

  if(tab === 'home'){
    renderCountdown();
    timer = setInterval(renderCountdown, 1000);
  }
  if(tab === 'welcome')  bindWelcome();
  if(tab === 'stats')    bindStats();
  if(tab === 'settings'){ bindParent(); bindSync(); }
  if(tab === 'config')   bindConfig();
  window.scrollTo(0, keepScroll ? y : 0);
  applyReadingDisplay();
}

function captureFormDraft(){
  const out = {};
  $$('#view input[id], #view textarea[id], #view select[id]').forEach(el=>{
    if(el.type === 'file') return;
    out[el.id] = (el.type === 'checkbox' || el.type === 'radio')
      ? { checked:el.checked, type:el.type }
      : { value:el.value, type:el.type };
  });
  return out;
}
function restoreFormDraft(draft){
  Object.entries(draft || {}).forEach(([id, saved])=>{
    const el = document.getElementById(id);
    if(!el || el.type === 'file') return;
    if(saved.type === 'checkbox' || saved.type === 'radio') el.checked = !!saved.checked;
    else el.value = saved.value;
  });
}

/* 設定は「この端末」「おうちの宿題」「まいにち」に分ける。
   内部の type / recordStyle は旧データ互換のため変えない。 */
function themeChoicesHTML(){
  const current = THEME_IDS.includes(getLocal(K_THEME)) ? getLocal(K_THEME) : 'notebook';
  return THEMES.map(t=>`
    <label class="theme-choice theme-choice--${t.id}">
      <input type="radio" name="theme" value="${t.id}"${t.id===current?' checked':''}>
      <span class="theme-swatch" aria-hidden="true"><i></i><i></i><i></i></span>
      <span class="theme-name">${esc(t.name)}</span>
      <small>${esc(t.note)}</small>
    </label>`).join('');
}

function taskSummary(t){
  if(isBook(t)) return `${Math.max(1,t.total|0)}さつ`;
  if(t.group === 'daily') return isFree(t) ? 'ことばで きろく' : `1日 ${Math.max(1,t.target|0)}${esc(t.targetUnit||'')}`;
  if(t.type === 'step') return `${(t.steps||[]).length}この じゅんばん`;
  return `${Math.max(1,t.total|0)}${esc(t.unit||'')}`;
}

function taskEditorRow(t, i){
  const opt = (v,cur,label) => `<option value="${v}"${v===cur?' selected':''}>${label}</option>`;
  const kind = taskKind(t);
  const unitMode = dailyUnitPreset(t.targetUnit||'');
  const bf = bookFields(t);
  const groupField = kind === 'daily' ? '' : `
    <label class="set-field"><span>表示する場所</span><select data-f="group">
      ${opt('must',t.group,'かならず やる')}${opt('option',t.group,'つぎに やる')}
    </select></label>`;

  let fields = '';
  if(kind === 'book'){
    fields = `${groupField}
      <label class="set-field"><span>目標の冊数</span><span class="set-inline"><input type="number" data-f="total" min="1" max="200" value="${t.total|0}"><b>さつ</b></span></label>
      <fieldset class="set-field set-field--wide set-checks"><legend>本ごとに のこすこと</legend>
        <label><input type="checkbox" data-bf="author"${bf.author?' checked':''}> さくしゃ</label>
        <label><input type="checkbox" data-bf="publisher"${bf.publisher?' checked':''}> しゅっぱんしゃ</label>
        <label><input type="checkbox" data-bf="rating"${bf.rating?' checked':''}> おすすめ度</label>
      </fieldset>
      <p class="set-help set-field--wide">本の名前・読んだ日・ひとことを1冊ずつ残します。</p>`;
  }else if(kind === 'daily'){
    fields = `
      <label class="set-field"><span>きろくの しかた</span><select data-f="recordStyle">
        ${opt('',t.recordStyle||'','かずで きろく')}${opt('free',t.recordStyle||'','ことばで きろく')}
      </select></label>
      ${!isFree(t) ? `
        <label class="set-field"><span>1日の めあて</span><input type="number" data-f="target" min="1" max="999" value="${t.target|0}"></label>
        <label class="set-field"><span>単位</span><select data-f="targetUnitPreset">
          ${DAILY_UNIT_PRESETS.map(u=>opt(u,unitMode,u)).join('')}${opt('custom',unitMode,'そのほか（自由）')}
        </select></label>
        ${unitMode==='custom' ? `<label class="set-field"><span>単位を 入力</span><input type="text" data-f="targetUnitCustom" maxlength="8" value="${esc(t.targetUnit||'')}"></label>` : ''}
      ` : `
        <label class="set-field set-field--wide"><span>こどもへの よびかけ</span>
          <input type="text" data-f="freeHint" value="${esc(t.freeHint||'')}" placeholder="きょうの ことを かいてみよう"></label>`}
      <label class="set-field set-field--wide"><span>${isFree(t)?'見出し':'メモ欄の 見出し'}</span>
        <input type="text" data-f="memoLabel" value="${esc(t.memoLabel||'')}" placeholder="やったことを かこう"></label>`;
  }else{
    fields = `${groupField}
      <label class="set-field"><span>すすめかた</span><select data-f="type">
        ${opt('count',t.type,'回数・ページで すすむ')}${opt('step',t.type,'じゅんばんに すすむ')}
      </select></label>
      ${t.type==='count' ? `
        <label class="set-field"><span>ぜんぶで</span><input type="number" data-f="total" min="1" max="200" value="${t.total|0}"></label>
        <label class="set-field"><span>単位</span><input type="text" data-f="unit" maxlength="8" value="${esc(t.unit||'')}"></label>
        <label class="set-field set-check"><input type="checkbox" data-f="numbered"${t.numbered?' checked':''}> つぎの番号を ①②で 表示</label>` : `
        <label class="set-field set-field--wide"><span>じゅんばん（1行に1つ）</span>
          <textarea data-f="steps" rows="${Math.max(3,(t.steps||[]).length)}">${esc((t.steps||[]).join('\n'))}</textarea></label>`}
      <label class="set-field set-field--wide set-check"><input type="checkbox" data-f="wrapUp"${t.wrapUp?' checked':''}> さいごに「マルつけ」と「なおし」を つける</label>
      <label class="set-field set-field--wide"><span>きろくするときの しつもん（なくてもOK）</span>
        <textarea data-f="questions" rows="3" placeholder="はっぱの かたちや いろは？">${esc((t.questions||[]).join('\n'))}</textarea></label>
      <label class="set-field set-field--wide"><span>メモ欄の 見出し</span>
        <input type="text" data-f="memoLabel" value="${esc(t.memoLabel||'')}" placeholder="やったことを かこう"></label>`;
  }

  const label = kind === 'book' ? '読書' : (kind === 'daily' ? 'まいにち' : (t.type === 'step' ? 'じゅんばん' : 'かず'));
  return `<details class="set-task" data-i="${i}"${t.id===openConfigTaskId?' open':''}>
    <summary class="set-task-summary"><span class="set-kind set-kind--${kind}">${label}</span>
      <strong>${esc(t.name)}</strong><span class="set-task-meta">${taskSummary(t)}</span></summary>
    <div class="set-task-body">
      <label class="set-field set-field--wide"><span>項目の名前</span><input type="text" data-f="name" maxlength="60" value="${esc(t.name)}"></label>
      <div class="set-grid">${fields}</div>
      <div class="set-task-actions">
        <button class="btn btn-sm btn-ghost btn-icon-text" data-move="-1" type="button" aria-label="${esc(t.name)}を上へ移動">${icon('chevronUp')}<span>上へ</span></button>
        <button class="btn btn-sm btn-ghost btn-icon-text" data-move="1" type="button" aria-label="${esc(t.name)}を下へ移動">${icon('chevronDown')}<span>下へ</span></button>
        <button class="btn btn-sm btn-danger btn-icon-text" data-del="1" type="button" aria-label="${esc(t.name)}を削除">${icon('trash')}<span>削除</span></button>
      </div>
    </div>
  </details>`;
}

function taskGroupHTML(rows, empty){
  return rows.length ? rows.map(({t,i})=>taskEditorRow(t,i)).join('') : `<p class="set-empty">${esc(empty)}</p>`;
}

function viewConfig(){
  const rows = config.tasks.map((t,i)=>({t,i}));
  const normal = rows.filter(({t})=>taskKind(t)==='normal');
  const books = rows.filter(({t})=>taskKind(t)==='book');
  const daily = rows.filter(({t})=>taskKind(t)==='daily');
  return `
  <div class="paper parent-head config-head"><div><h2>設定</h2><p>変更は すぐに 保存されます。</p></div>
    <span class="autosave" aria-live="polite">自動保存</span><a class="btn btn-sm" href="#settings">もどる</a></div>

  <section class="sec config-sec"><div class="sec-head"><h2>この端末の 表示</h2></div><div class="paper">
    <div class="set-row"><label class="lab" for="cfgChildName">こどもの 名前</label><input type="text" id="cfgChildName" maxlength="30" value="${esc(config.childName||getLocal(K_NAME)||'')}"></div>
    <div class="set-row"><label class="lab" for="cfgReadingGrade">読める漢字</label><select id="cfgReadingGrade">${readingOptions(readingGrade())}</select></div>
    <p class="set-note">名前と漢字の表示は、この端末に合わせます。</p>
    <fieldset class="theme-picker"><legend>いろと デザイン</legend><div class="theme-grid">${themeChoicesHTML()}</div></fieldset>
  </div></section>

  <section class="sec config-sec"><div class="sec-head"><h2>基本設定</h2></div><div class="paper">
    <div class="set-row"><label class="lab" for="cfgTitle">タイトル</label><input type="text" id="cfgTitle" value="${esc(config.title)}"></div>
    <div class="set-row"><label class="lab" for="cfgStart">はじまる日</label><input type="datetime-local" id="cfgStart" value="${esc(config.startAt)}"></div>
    <div class="set-row"><label class="lab" for="cfgEnd">おわる日</label><input type="datetime-local" id="cfgEnd" value="${esc(config.endAt)}"></div>
    <p class="set-note">日づけはカウントダウンとペースの計算に使います。</p>
  </div></section>

  <section class="sec config-sec"><div class="sec-head"><h2>ふつうの 宿題</h2><span class="sec-note">${normal.length}こ</span></div>
    <p class="config-lead">上へ・下へで、この欄の順番を変えられます。</p>
    <div class="paper task-editor" id="normalTaskEditor">${taskGroupHTML(normal,'まだ 項目は ありません。')}</div>
    <div class="set-actions"><button class="btn btn-sm btn-icon-text" id="addNormalTask" type="button">${icon('plus')}<span>宿題を 追加</span></button></div>
  </section>

  <section class="sec config-sec"><div class="sec-head"><h2>読書の きろく</h2><span class="sec-note">${books.length}こ</span></div>
    <p class="config-lead">本の名前・読んだ日・ひとことを1冊ずつ残す、読書専用の項目です。上へ・下へで順番を変えられます。</p>
    <div class="paper task-editor" id="bookTaskEditor">${taskGroupHTML(books,'読書の きろくを 使わないときは、空のままでOKです。')}</div>
    <div class="set-actions"><button class="btn btn-sm btn-icon-text" id="addBookTask" type="button">${icon('plus')}<span>読書を 追加</span></button></div>
  </section>

  <section class="sec config-sec"><div class="sec-head"><h2>まいにち</h2><span class="sec-note">学習アプリなど</span></div>
    <div class="paper daily-settings">
      <label class="daily-switch"><input type="checkbox" id="cfgShowDaily"${config.showDaily?' checked':''}>
        <span><strong>こども画面に 表示する</strong><small>学習アプリ・音読・おてつだいなどに使えます。</small></span></label>
      <p class="config-lead">上へ・下へで順番を変えられます。</p>
      <div class="task-editor" id="dailyTaskEditor">${taskGroupHTML(daily,'まいにちの 項目は まだありません。')}</div>
      <div class="set-actions"><button class="btn btn-sm btn-icon-text" id="addDailyTask" type="button">${icon('plus')}<span>まいにちを 追加</span></button></div>
    </div>
  </section>

  ${syncSectionHTML()}

  <section class="sec config-sec"><div class="sec-head"><h2>データ管理</h2></div><details class="paper set-advanced"><summary>バックアップと 初期化</summary>
    <div class="set-advanced-body"><p class="set-note">記録はこの端末に保存されます。時々バックアップすると安心です。</p>
    <div class="set-actions"><button class="btn btn-sm" id="expBtn" type="button">書き出す</button><button class="btn btn-sm" id="impBtn" type="button">読み込む</button><input type="file" id="impFile" accept="application/json,.json" hidden></div>
    <div class="set-actions"><button class="btn btn-sm btn-danger" id="resetCfg" type="button">項目を 元に戻す</button><button class="btn btn-sm btn-danger" id="resetAll" type="button">記録を すべて削除</button></div></div>
  </details></section>

  `;
}

/* 選んだ学年より難しい漢字を、表示後にひらがなへ直す。
   辞書は選択した端末で一度だけ読み込み、同じ文の変換結果は使い回す。 */
let readingPass = 0;
const readingCache = new Map();
function applyReadingDisplay(){
  const grade = readingGrade();
  if(typeof setReadingGrade !== 'function') return;
  setReadingGrade(grade);
  /* 保護者用ページと設定画面は大人が読むため、端末の漢字レベルに
     かかわらず元の漢字表記を保つ。変換するのは子ども向け画面だけ。 */
  if(tab === 'settings' || tab === 'config' || tab === 'stats') return;
  if(grade === 9 || !getLocal(K_READING) || typeof convertForTranscription !== 'function') return;
  const root = $('#view');
  const pass = ++readingPass;
  const nodes = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let node;
  while((node = walker.nextNode())){
    const parent = node.parentElement;
    if(!parent || parent.closest('script,style,textarea,option,select,[data-no-reading]')) continue;
    if(/[\u3400-\u9fff]/.test(node.nodeValue || '')) nodes.push(node);
  }
  nodes.forEach(node=>{
    const original = node.nodeValue || '';
    const match = original.match(/^(\s*)([\s\S]*?)(\s*)$/);
    const lead = match ? match[1] : '', body = match ? match[2] : original, tail = match ? match[3] : '';
    const key = grade + '\u0000' + body;
    const work = readingCache.has(key) ? Promise.resolve(readingCache.get(key))
      : convertForTranscription(body).then(result=>{
          const text = result && result.ok ? result.text : body;
          readingCache.set(key, text);
          return text;
        });
    work.then(text=>{
      if(pass === readingPass && root.contains(node)) node.nodeValue = lead + text + tail;
    }).catch(()=>{});
  });
}

function bindWelcome(){
  const form = $('#welcomeForm');
  const openForm = (role, sharing)=>{
    form.innerHTML = welcomeFormHTML(role, sharing);
    form.hidden = false;
    form.scrollIntoView({ behavior:'smooth', block:'nearest' });
    bindWelcomeStart();
  };
  $$('[data-welcome-mode]').forEach(btn => btn.addEventListener('click', ()=>{
    /* module の sync.js が読み込み途中なら、あいことば無しで始めて
       しまわないよう一度だけ待ってもらう。読み込み完了時に画面は自動更新する。 */
    if(!window.NatsuSync && !TEST_MODE){ toast('同期の準備を 読みこんでいます…'); return; }
    if(btn.dataset.welcomeMode === 'solo') return openForm('child', false);
    form.innerHTML = welcomeRolePickerHTML();
    form.hidden = false;
    form.scrollIntoView({ behavior:'smooth', block:'nearest' });
    $$('[data-welcome-role]', form).forEach(roleBtn => roleBtn.addEventListener('click', ()=>openForm(roleBtn.dataset.welcomeRole, true)));
  }));
}

function bindWelcomeStart(){
  const start = $('#welcomeStart');
  start.addEventListener('click', ()=>{
    const role = start.dataset.role;
    const sharing = start.dataset.sharing === 'yes';
    const name = String($('#welcomeName').value || '').trim();
    const grade = Number($('#welcomeReading').value);
    const S = window.NatsuSync;
    const codeEl = $('#welcomeCode');
    const code = codeEl ? cleanCode(codeEl.value) : '';
    if(!name){ toast('なまえを 入れてください'); $('#welcomeName').focus(); return; }
    if(sharing && !TEST_MODE && S && S.configured() && code.length < 8){ toast('あいことばを 8文字以上 入れてください'); if(codeEl) codeEl.focus(); return; }
    setLocal(K_NAME, name);
    setLocal(K_ROLE, role);
    setLocal(K_READING, grade);
    if(typeof setReadingGrade === 'function') setReadingGrade(grade);
    setLocal(K_ONBOARD, 'done');
    config.childName = name;
    if(config.title === DEFAULT_CONFIG.title) config.title = name + 'の なつやすみの しゅくだい';
    saveCfg();
    if(sharing && !TEST_MODE && S && S.configured()){
      S.reconnect(code);
      /* 同じ家庭を複数の親端末で数えないよう、あいことば由来の匿名IDで重複を除く。 */
      S.registerHousehold(code).catch(()=>{});
    }
    if(role === 'parent' && sharing){
      const form = $('#welcomeForm');
      form.innerHTML = welcomeMessageChoiceHTML();
      bindParentSender('welcomeMessageSender', 'welcomeMessageCustomWrap');
      $$('[data-message-choice]', form).forEach(btn=>btn.addEventListener('click', ()=>{
        config.parentMessage.enabled = btn.dataset.messageChoice === 'yes';
        config.parentMessage.sender = $('#welcomeMessageSender').value;
        config.parentMessage.customSender = String($('#welcomeMessageCustom').value || '').trim().slice(0, 20);
        saveCfg();
        location.hash = 'settings';
        if(config.parentMessage.enabled) toast('保護者ページに メッセージ欄を 用意しました');
      }));
      form.scrollIntoView({ behavior:'smooth', block:'nearest' });
      return;
    }
    location.hash = role === 'parent' ? 'settings' : 'home';
  });
}

function bindStats(){
  const S = window.NatsuSync;
  const out = $('#statsCount');
  const note = $('#statsNote');
  if(!S || !S.configured()){
    out.textContent = '集計を読みこめません';
    note.textContent = 'Firebase の設定を確認してください。';
    return;
  }
  S.getRegistrationCount().then(count=>{
    out.textContent = Number(count || 0).toLocaleString('ja-JP') + ' 家庭';
  }).catch(()=>{
    out.textContent = '集計を読みこめません';
    note.textContent = 'Firestore のルールに metrics の読み取り許可を追加してください。';
  });
}

/* ---------------------------------------------------------
   せっていの そうさ
   --------------------------------------------------------- */
/* 保護者ページ（進捗一覧）— サマリーの生成と書き出し */
function bindParent(){
  bindParentSender('parentMessageSender', 'parentMessageCustomWrap');
  const messageText = $('#parentMessageText');
  const fitMessageText = ()=>{
    if(!messageText) return;
    messageText.style.height = 'auto';
    messageText.style.height = Math.max(56, Math.min(messageText.scrollHeight, 180)) + 'px';
  };
  fitMessageText();
  messageText.addEventListener('input', fitMessageText);
  $('#parentMessageSave').addEventListener('click', ()=>{
    const sender = $('#parentMessageSender').value;
    config.parentMessage.sender = PARENT_SENDERS.includes(sender) ? sender : 'おかあさん';
    config.parentMessage.customSender = String($('#parentMessageCustom').value || '').trim().slice(0, 20);
    config.parentMessage.text = String($('#parentMessageText').value || '').trim().slice(0, 80);
    config.parentMessage.enabled = $('#parentMessageEnabled').checked && !!config.parentMessage.text;
    $('#parentMessageEnabled').checked = config.parentMessage.enabled;
    saveCfg();
    toast(config.parentMessage.enabled ? 'こども画面に 表示しました' : 'メッセージを 非表示にしました');
  });
  $('#sumMake').addEventListener('click', ()=>{
    $('#sumOut').value = buildSummary(+$('#sumDays').value);
    toast('サマリーを生成しました');
  });
  $('#sumCopy').addEventListener('click', ()=>{
    const ta = $('#sumOut');
    if(!ta.value){ toast('先に「サマリーを生成」を押してください'); return; }
    copyText(ta);
  });
  $('#sumSave').addEventListener('click', ()=>{
    const text = $('#sumOut').value || buildSummary(+$('#sumDays').value);
    // Excel やメモ帳で文字化けしないよう BOM を付ける
    const blob = new Blob(['﻿' + text], {type:'text/plain;charset=utf-8'});
    downloadBlob(blob, 'shukudai-summary-' + dayKey(new Date()) + '.txt');
    toast('保存しました');
  });
}

/* 「べつの端末と つなぐ」の そうさ。
   sync.js が 無い／未設定のときは 何も つながない（画面には 案内だけ 出ている） */
function bindSync(){
  const S = window.NatsuSync;
  if(!S || !S.configured()) return;

  /* つなぎ具合が かわったら 見出しの右の文字だけ 書きかえる。
     画面ごと 描き直すと 入力中の あいことばが 消えてしまう */
  if(!bindSync._watching){
    bindSync._watching = true;
    S.onStatus((st, text)=>{
      const el = $('#syncStatus');
      if(!el) return;
      const [mark, def] = SYNC_LABEL[st] || SYNC_LABEL.off;
      el.textContent = mark + ' ' + (text || def);
    });
  }
  if(!bindSync._deviceWatching){
    bindSync._deviceWatching = true;
    S.onDeviceCount(count=>{
      const el = $('#syncDeviceCount');
      if(el) el.textContent = 'このおうちで共有設定済みの端末：' + count + '台';
    });
  }

  /* 保護者ページでは あいことばが 無いときだけ 欄が 出る。
     出ていない ときは つなぐ そうさも いらない */
  const input = $('#syncCode');
  if(!input) return;

  $('#syncSave').addEventListener('click', ()=>{
    const c = cleanCode(input.value);
    if(c.length < 8){ toast('あいことばを 8文字以上 入れてください'); return; }
    S.reconnect(c);
    toast('つないでいます…');
    render({ keepScroll:true });
  });

  $('#syncCopy').addEventListener('click', ()=>{
    if(!input.value){ toast('先に あいことばを 作ってください'); return; }
    copyText(input);
  });

  const make = $('#syncMake');
  if(make) make.addEventListener('click', ()=>{
    input.value = S.makeCode();
    toast('作りました。「この あいことばで つなぐ」を押してください');
  });

  const off = $('#syncOff');
  if(off) off.addEventListener('click', ()=>{
    if(!confirm('この端末を切り離しますか？\nこの端末の記録は残りますが、他の端末とはそろわなくなります。')) return;
    S.setCode('');
    S.disconnect();
    render({ keepScroll:true });
    toast('切り離しました');
  });
}

/* 保護者ページ（設定）*/
function bindConfig(){
  $('#cfgChildName').addEventListener('change', e=>{
    const name = e.target.value.trim();
    config.childName = name;
    setLocal(K_NAME, name);
    saveCfg();
  });
  $('#cfgTitle').addEventListener('change', e=>{
    config.title = e.target.value || 'なつやすみの しゅくだい';
    saveCfg(); render({ keepScroll:true });
  });
  $('#cfgReadingGrade').addEventListener('change', e=>{
    const grade = Number(e.target.value);
    setLocal(K_READING, grade);
    if(typeof setReadingGrade === 'function') setReadingGrade(grade);
    render({ keepScroll:true });
  });
  $('#cfgStart').addEventListener('change', e=>{ config.startAt = e.target.value; saveCfg(); });
  $('#cfgEnd').addEventListener('change',   e=>{ config.endAt   = e.target.value; saveCfg(); });

  $$('.theme-choice input[name="theme"]').forEach(input=>input.addEventListener('change', e=>{
    if(!THEME_IDS.includes(e.target.value)) return;
    setLocal(K_THEME, e.target.value);
    applyTheme(e.target.value);
  }));
  $('#cfgShowDaily').addEventListener('change', e=>{
    config.showDaily = e.target.checked;
    saveCfg();
  });

  const ed = $('#view');
  ed.addEventListener('change', e=>{
    const row = e.target.closest('.set-task'); if(!row) return;
    const t = config.tasks[+row.dataset.i]; if(!t) return;

    const bf = e.target.dataset.bf;
    if(bf){
      t.bookFields = Object.assign(bookFields(t), { [bf]: e.target.checked });
      saveCfg(); return;
    }

    const f = e.target.dataset.f; if(!f) return;

    if(f === 'targetUnitPreset'){
      t.targetUnit = e.target.value === 'custom' ? '' : e.target.value;
      openConfigTaskId = t.id;
      saveCfg(); render({ keepScroll:true }); return;
    }
    if(f === 'targetUnitCustom'){
      t.targetUnit = e.target.value.trim().slice(0,8);
      saveCfg(); return;
    }
    if(f === 'recordStyle'){
      const v = e.target.value;
      if(v === 'book'){ t.recordStyle = 'book'; t.bookFields = bookFields(t); }
      else if(v === 'free'){
        t.recordStyle = 'free';
        t.target = t.target || 1; t.targetUnit = t.targetUnit || 'かい';
        t.memoLabel = t.memoLabel || 'きょうは なにを した？';
      }
      else delete t.recordStyle;
      openConfigTaskId = t.id;
      saveCfg(); render({ keepScroll:true }); return;
    }
    if(f === 'numbered')        t.numbered = e.target.checked;
    // 外しても progress の wrap は 消さない。付けなおしたら 前の状態が また見える
    else if(f === 'wrapUp')     t.wrapUp = e.target.checked;
    else if(f === 'total')      t.total = clamp(+e.target.value||1, 1, 200);
    else if(f === 'target')     t.target = clamp(+e.target.value||1, 1, 999);
    else if(f === 'steps')      t.steps = e.target.value.split('\n').map(s=>s.trim()).filter(Boolean);
    else if(f === 'questions')  t.questions = e.target.value.split('\n').map(s=>s.trim()).filter(Boolean);
    else if(f === 'type'){
      t.type = e.target.value;
      if(t.type==='count'  && !t.total) { t.total = 10; t.unit = t.unit || 'ばん'; t.numbered = true; }
      if(t.type==='step'   && !(t.steps||[]).length) t.steps = ['はじめる','とちゅう','かんせい！'];
      if(t.type==='daily'  && !t.target){ t.target = 1; t.targetUnit = t.targetUnit || 'かい'; }
      if(t.type==='daily') t.group = 'daily';
      openConfigTaskId = t.id;
      saveCfg(); render({ keepScroll:true }); return;
    }
    else if(f === 'group'){
      t.group = e.target.value;
      if(t.group==='daily' && t.type!=='daily'){ t.type='daily'; t.target = t.target||1; t.targetUnit = t.targetUnit||'かい'; }
      openConfigTaskId = t.id;
      saveCfg(); render({ keepScroll:true }); return;
    }
    else t[f] = e.target.value;

    saveCfg();
  });

  ed.addEventListener('click', e=>{
    const row = e.target.closest('.set-task'); if(!row) return;
    const i = +row.dataset.i;
    const mv = e.target.closest('[data-move]');
    if(mv){
      const same = config.tasks.map((t,idx)=>({t,idx})).filter(x=>taskOrderBucket(x.t)===taskOrderBucket(config.tasks[i]));
      const at = same.findIndex(x=>x.idx===i);
      const next = same[at + (+mv.dataset.move)];
      if(!next) return;
      const j = next.idx;
      const a = config.tasks; const tmp = a[i]; a[i] = a[j]; a[j] = tmp;
      saveCfg(); render({ keepScroll:true }); return;
    }
    if(e.target.closest('[data-del]')){
      const t = config.tasks[i];
      if(confirm('「'+t.name+'」を削除しますか？\nこれまでの記録は残ります。')){
        openConfigTaskId = null;
        config.tasks.splice(i,1); saveCfg(); render({ keepScroll:true });
      }
    }
  });

  $('#addNormalTask').addEventListener('click', ()=>{
    const added = {
      id: 't' + Date.now(), group:'option', type:'count',
      name:'あたらしい しゅくだい', total:10, unit:'かい', numbered:false,
      memoLabel:'やったことを かこう'
    };
    config.tasks.push(added); openConfigTaskId = added.id;
    saveCfg(); render({ keepScroll:true });
  });
  $('#addBookTask').addEventListener('click', ()=>{
    const added = { id:'book-'+Date.now(), group:'must', type:'count', recordStyle:'book',
      name:'読書の きろく', total:10, unit:'さつ', numbered:true,
      bookFields:{ author:true, publisher:false, rating:true } };
    config.tasks.push(added); openConfigTaskId = added.id;
    saveCfg(); render({ keepScroll:true });
  });
  $('#addDailyTask').addEventListener('click', ()=>{
    const added = { id:'daily-'+Date.now(), group:'daily', type:'daily',
      name:'おてつだい', target:1, targetUnit:'かい', memoLabel:'やったこと' };
    config.tasks.push(added); openConfigTaskId = added.id;
    config.showDaily = true;
    saveCfg(); render({ keepScroll:true });
  });

  bindSync();

  $('#expBtn').addEventListener('click', exportData);
  $('#impBtn').addEventListener('click', ()=> $('#impFile').click());
  $('#impFile').addEventListener('change', importData);

  $('#resetCfg').addEventListener('click', ()=>{
    if(confirm('項目を初期状態に戻しますか？\nこれまでの記録は残ります。')){
      config = freshConfig(); saveCfg(); render(); toast('初期状態に戻しました');
    }
  });
  $('#resetAll').addEventListener('click', ()=>{
    if(confirm('進捗と記録をすべて削除しますか？\nこの操作は取り消せません。')){
      state = emptyState(); saveSt(); render(); toast('削除しました');
    }
  });
}

/* ---------------------------------------------------------
   進捗サマリー（保護者向けのテキスト出力）
   --------------------------------------------------------- */
const GROUP_LABEL = { must:'かならず やる', option:'つぎに やる', daily:'まいにち' };

function summaryLine(t){
  const p = prog(t);
  const pct = Math.round(p.pct);

  if(t.type === 'daily'){
    const mark = p.isDone ? '✓ ' : '・';
    return mark + t.name + '  今日 ' + p.done + '/' + p.total + (t.targetUnit||'')
         + (p.streak > 0 ? '  ' + p.streak + '日連続' : '  連続なし');
  }
  if(p.isDone) return '✓ ' + t.name + '  ' + p.text + '  完了';

  const nx = nextLabel(t);
  const next = nx ? '  次は ' + (nx.num ? nx.num : '') + nx.tail : '';
  return '・' + t.name + '  ' + p.text + '  ' + pct + '%' + next;
}

function buildSummary(logDays){
  const now = new Date();
  const en = parseLocal(config.endAt);
  const ms = en - now;
  const o = natsuPct();
  const s = overall('must');
  const so = overall('option');
  const L = [];

  L.push('■ ' + config.title);
  L.push(fmtDate(now) + ' ' + fmtTime(now) + ' 時点');
  L.push('');

  if(ms > 0){
    L.push('夏休み終了まで  あと ' + Math.floor(ms/86400000) + '日'
         + (Math.floor(ms/3600000) % 24) + '時間');
  }else{
    L.push('夏休みは終了しました');
  }
  L.push('夏休みの経過  ' + Math.round(o) + '%');
  L.push('必須の宿題    ' + Math.round(s.pct) + '%  (' + s.done + '/' + s.total + ')');
  if(so.total) L.push('つぎに やる  ' + Math.round(so.pct) + '%  (' + so.done + '/' + so.total + ')');

  ['must','option','daily'].forEach(g=>{
    const list = config.tasks.filter(t=>t.group===g);
    if(!list.length) return;
    L.push('');
    L.push('【' + GROUP_LABEL[g] + '】');
    list.forEach(t=> L.push(summaryLine(t)));
  });

  // 読書のきろくは書き写しに使うため、書名を全冊分そのまま出す
  if(state.books.length){
    L.push('');
    L.push('【読んだ本　' + state.books.length + '冊】');
    state.books.slice().sort((a,b)=> a.nth - b.nth).forEach(b=>{
      L.push(b.nth + '. ' + b.title
        + (b.author ? '／' + b.author : '')
        + (b.publisher ? '／' + b.publisher : '')
        + '　' + b.date
        + (b.rating ? '　' + '★'.repeat(b.rating) : ''));
      const memo = b.memoOut || b.memo;
      if(memo) memo.split('\n').forEach(line=> L.push('    ' + line));
    });
  }

  if(logDays !== -1){
    const from = new Date();
    from.setHours(0,0,0,0);
    if(logDays > 0) from.setDate(from.getDate() - (logDays - 1));
    else from.setTime(0);

    const rows = state.logs.filter(l => new Date(l.at) >= from);
    L.push('');
    L.push('【記録' + (logDays > 0 ? '（直近' + logDays + '日）' : '（全期間）') + '　' + rows.length + '件】');
    if(!rows.length){
      L.push('（記録なし）');
    }else{
      const byDay = {};
      rows.forEach(l=>{ const k = dayKey(new Date(l.at)); (byDay[k] = byDay[k] || []).push(l); });
      Object.keys(byDay).sort().reverse().forEach(k=>{
        L.push(fmtDate(keyToDate(k)));
        byDay[k].slice().reverse().forEach(l=>{
          L.push('  ' + fmtTime(new Date(l.at)) + '  ' + l.name + ' … ' + l.what);
          if(l.memo) l.memo.split('\n').forEach(line=> L.push('      ' + line));
        });
      });
    }
  }

  return L.join('\n');
}

function downloadBlob(blob, filename){
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(()=>URL.revokeObjectURL(url), 1000);
}

/* iPad Safari では clipboard API が使えない場面があるので選択方式も残す */
function copyText(ta){
  const done = ()=> toast('コピーしました');
  if(navigator.clipboard && window.isSecureContext){
    navigator.clipboard.writeText(ta.value).then(done, ()=> legacy());
  }else legacy();

  function legacy(){
    ta.removeAttribute('readonly');
    ta.focus(); ta.setSelectionRange(0, ta.value.length);
    let ok = false;
    try{ ok = document.execCommand('copy'); }catch(e){}
    ta.setAttribute('readonly','');
    ok ? done() : toast('コピーできませんでした。長押しで選択してください');
  }
}

function exportData(){
  const blob = new Blob([JSON.stringify({config, state}, null, 2)], {type:'application/json'});
  downloadBlob(blob, 'natsuyasumi-' + dayKey(new Date()) + '.json');
  toast('書き出しました');
}

function importData(e){
  const f = e.target.files && e.target.files[0];
  if(!f) return;
  const fr = new FileReader();
  fr.onload = ()=>{
    try{
      const o = JSON.parse(fr.result);
      if(!o || !o.config || !o.state) throw new Error('ファイル形式が異なります');
      if(!confirm('現在のデータを、読み込んだ内容で置き換えます。よろしいですか？')) return;
      config = o.config; state = normalizeState(o.state);
      saveCfg(); saveSt(); render(); toast('読み込みました');
    }catch(err){ alert('読み込めませんでした：' + err.message); }
  };
  fr.readAsText(f);
  e.target.value = '';
}

/* ---------------------------------------------------------
   イベント
   --------------------------------------------------------- */
document.addEventListener('click', e=>{

  const tabBtn = e.target.closest('.tab');
  if(tabBtn){
    const t = tabBtn.dataset.tab;
    // hashchange で描画する。同じ hash なら発火しないので自分で描く
    if(routeFromHash() === t) render(); else location.hash = t;
    return;
  }

  const calMove = e.target.closest('[data-calmove]');
  if(calMove){
    calMonth = new Date(calMonth.getFullYear(), calMonth.getMonth() + (+calMove.dataset.calmove), 1);
    calDay = null;                       // 月がかわると その日は もう見えないので とじる
    render({ keepScroll:true });
    return;
  }
  const calCell = e.target.closest('[data-day]');
  if(calCell){
    const k = calCell.dataset.day;
    calDay = (calDay === k) ? null : k;  // 同じ日を もう一度おすと とじる
    render({ keepScroll:true });
    return;
  }

  const open = e.target.closest('[data-open]');
  if(open){ openSheet(open.dataset.open, open.dataset.book); return; }

  if(e.target.closest('#bkCheck')){ checkKanji(); return; }
  if(e.target.closest('#bkFix')){ fixKanji(); return; }
  if(e.target.closest('#wrCheck')){ checkWrites(); return; }
  if(e.target.closest('#wrFix')){ fixWrites(); return; }

  const delBook = e.target.closest('[data-delbook]');
  if(delBook){
    const b = state.books.find(x=>x.id===delBook.dataset.delbook);
    if(b && confirm('「'+b.title+'」の記録を削除しますか？\n冊数も1つ戻ります。')){
      state.books = state.books.filter(x=>x.id!==b.id);
      // 残りの冊に通し番号を振り直し、進捗を実際の冊数に合わせる
      const same = state.books.filter(x=>x.taskId===b.taskId)
        .sort((x,y)=> x.nth - y.nth);
      same.forEach((x,i)=> x.nth = i+1);
      state.progress[b.taskId] = Object.assign({}, state.progress[b.taskId], { done: same.length });
      saveSt(); render({ keepScroll:true }); toast('削除しました');
    }
    return;
  }

  const star = e.target.closest('[data-star]');
  if(star){
    const n = +star.dataset.star;
    sheetRating = (n === sheetRating) ? 0 : n;   // 同じ星をもう一度おすと取り消し
    $$('#bkStars .star').forEach(b=> b.classList.toggle('on', +b.dataset.star <= sheetRating));
    $('#bkStarSay').textContent = starSay(sheetRating);
    return;
  }

  const fun = e.target.closest('[data-fun]');
  if(fun){
    if(fun.dataset.fun === 'open') funOpen = true;
    else{
      /* 説明を 読むまで 次へは 進めない。1日に 引ける かずも ここで かぎる。
         ボタンは 上限で 消えるが、
         連打や 古い画面から 押された ときのために ここでも 止める */
      if(!funOpen || funToday().seen.length >= funLimit()) return;
      funPick();
    }
    // カードだけ差し替える。ページは動かない
    const card = $('.fun');
    if(card) card.outerHTML = funHTML();
    else render({ keepScroll:true });
    return;
  }

  // シート内
  if(e.target.closest('#sheetClose') || e.target.closest('#sheetCancel') || e.target.id === 'sheetBack'){
    closeSheet(); return;
  }
  if(e.target.closest('#sheetSave')){ saveSheet(); return; }

  const num = e.target.closest('#nums .num');
  if(num){
    const n = +num.dataset.n;
    sheetSel = (n === sheetSel) ? n - 1 : n;   // 同じところを もう一度おすと 1つ もどる
    $('#nums').innerHTML = numsHTML(sheetTask, sheetSel);
    $('#selSay').textContent = selSayText(sheetTask, sheetSel);
    syncWrapField();
    return;
  }
  const st = e.target.closest('#steps .step');
  if(st){
    const i = +st.dataset.i;
    sheetSteps[i] = !sheetSteps[i];
    $('#steps').innerHTML = stepsHTML(sheetTask, sheetSteps);
    syncWrapField();
    return;
  }
  const wp = e.target.closest('#wraps .step');
  if(wp){
    const i = +wp.dataset.w;
    sheetWrap[i] = !sheetWrap[i];
    $('#wraps').innerHTML = wrapsHTML(sheetWrap);
    return;
  }
  const ta = e.target.closest('#tally .tally-btn');
  if(ta){
    sheetSel = +ta.dataset.n;
    $$('#tally .tally-btn').forEach(b=> b.classList.toggle('sel', +b.dataset.n === sheetSel));
    return;
  }
  const mic = e.target.closest('[data-mic]');
  if(mic){
    const id = mic.dataset.mic;
    // 観察の質問は data-q、それ以外は同じ id の入力欄
    const el = /^q\d+$/.test(id) ? $('#sheetBody [data-q="'+id.slice(1)+'"]') : $('#'+id);
    if(el){ if(mic.classList.contains('rec')) stopSR(); else startSR(mic, el); }
    return;
  }
});

document.addEventListener('keydown', e=>{
  if(e.key === 'Escape' && !$('#sheetWrap').hidden) closeSheet();
});

// タブを もどってきたら 日づけを 更新
document.addEventListener('visibilitychange', ()=>{ if(!document.hidden && tab==='home') render(); });

/* ---------------------------------------------------------
   おうちの人だけの 入口（タイトルを 3秒 長押し）

   iOS で「ホーム画面に追加」した アイコンは、Safari とは 別の
   入れもの（localStorage）を 持つ。だから Safari で あいことばを
   入れても、アイコンの方には つたわらない。
   アイコンには アドレス欄が 無く、こども画面から 保護者ページへの
   導線も わざと 置いていないので、そのままでは あいことばを
   入れる手立てが ない。

   画面には 何も出さず、長押しだけで 保護者ページへ 行けるようにする。
   子どもが たまたま 見つけても 困らないよう、ふつうに 触るより
   長い 3秒に してある。
   --------------------------------------------------------- */
(function(){
  /* 帯ぜんたいを 受け口に する。タイトルの 文字は 短いことが あり、
     その 右がわの すき間を 押しても 反応しないと 当てにくい */
  const el = $('.topband') || $('#appTitle');
  if(!el) return;

  const HOLD_MS  = 2000;   // 長押しの ながさ
  const MOVE_TOL = 14;     // 指の ゆれを 許す はば（px）
  const TAPS     = 5;      // 連続タップの かず
  const TAP_GAP  = 800;    // タップの あいだの ゆるされる 間（ms）

  let timerId = null, sx = 0, sy = 0;
  let taps = 0, lastTap = 0;

  function open(){
    cancel();
    taps = 0;
    if(routeFromHash() === 'config') return;
    location.hash = 'config';
  }

  function start(x, y){
    sx = x; sy = y;
    clearTimeout(timerId);
    timerId = setTimeout(open, HOLD_MS);
  }
  function moved(x, y){
    /* 指は じっとしていても 1〜2px は ゆれる。
       ここで すぐ 打ち切ると、実機では ほとんど 成功しない。
       画面を 動かすほど 動いたときだけ やめる */
    if(Math.abs(x - sx) > MOVE_TOL || Math.abs(y - sy) > MOVE_TOL) cancel();
  }
  function cancel(){ clearTimeout(timerId); timerId = null; }

  el.addEventListener('touchstart', e=>{
    const t = e.touches[0]; if(t) start(t.clientX, t.clientY);
  }, { passive:true });
  el.addEventListener('touchmove', e=>{
    const t = e.touches[0]; if(t) moved(t.clientX, t.clientY);
  }, { passive:true });
  el.addEventListener('touchend',    cancel);
  el.addEventListener('touchcancel', cancel);

  /* パソコンで ためすとき用 */
  el.addEventListener('mousedown', e=> start(e.clientX, e.clientY));
  el.addEventListener('mousemove', e=>{ if(timerId) moved(e.clientX, e.clientY); });
  el.addEventListener('mouseup',    cancel);
  el.addEventListener('mouseleave', cancel);

  /* 長押しは iOS だと 文字の 選択や 虫めがねに 取られて
     途中で 切れることが ある。とんとん と 5回 つづけて たたく方でも
     開けるようにして、どちらか 通れば よい ことにする */
  el.addEventListener('click', ()=>{
    const now = performance.now();
    taps = (now - lastTap > TAP_GAP) ? 1 : taps + 1;
    lastTap = now;
    if(taps >= TAPS) open();
  });

  /* 長押しで 文字が 選ばれたり、虫めがねが 出たり しないように */
  el.style.webkitUserSelect = 'none';
  el.style.userSelect = 'none';
  el.style.webkitTouchCallout = 'none';
})();

/* ---------------------------------------------------------
   ルーティング（#home / #record / #log / #settings）
   --------------------------------------------------------- */
/* かいたもの いちらんだけは 課題を えらぶので '#writes:<taskId>' の形にする。
   ハッシュに 課題を のせておけば、もどる・すすむでも 同じ画面に かえれる */
function routeFromHash(){
  if(isStatsURL()) return 'stats';
  const h = (location.hash || '').replace(/^#/, '');
  const c = h.indexOf(':');
  const name = c < 0 ? h : h.slice(0, c);
  if(name === 'writes'){ writesTaskId = c < 0 ? writesTaskId : h.slice(c + 1); return 'writes'; }
  const requested = TABS.indexOf(h) >= 0 ? h : 'home';
  /* すでにこの端末で使い始めている家庭は、導線変更で止めない。
     保存済みデータのない新規端末だけ、最初の設定に案内する。 */
  const hasExistingData = !!(getLocal(K_CFG) || getLocal(K_ST));
  /* おためしモードでは起動時の内部データを「設定済み」と数えない。 */
  if(requested !== 'welcome' && !getLocal(K_ONBOARD) && (TEST_MODE || !hasExistingData)) return 'welcome';
  return requested;
}
window.addEventListener('hashchange', ()=>{
  const t = routeFromHash();
  /* writes は 同じタブのまま 課題だけ かわることが あるので、
     タブが 同じでも 描き直す */
  if(t !== tab || t === 'writes'){ tab = t; render(); }
});

/* sync.js は module なので、ページを 開いて 最初の render() の時点では
   まだ 動いていない。「せってい」タブを 見ている 最中に 追いついたら、
   ここで もう1回 描き直す（そうしないと「べつの端末と つなぐ」の欄が
   ずっと「読み込みに失敗しました」のまま 固まって見える） */
window.addEventListener('natsu:sync-ready', ()=>{
  if(tab === 'welcome' || tab === 'stats' || tab === 'config' || tab === 'settings') render({ keepScroll:true });
}, { once:true });

/* ---------------------------------------------------------
   はじめる
   --------------------------------------------------------- */
loadAll();
if(typeof setReadingGrade === 'function') setReadingGrade(readingGrade());
tab = routeFromHash();
render();

})();
