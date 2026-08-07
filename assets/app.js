/* =========================================================
   app.js — はじめ夏休みの宿題一覧
   データは この iPad の中（localStorage）に ほぞんされます。
   ========================================================= */
(function () {
'use strict';

/* ---------------------------------------------------------
   ほぞん
   --------------------------------------------------------- */
const K_CFG = 'natsu.config.v2';
const K_ST  = 'natsu.state.v2';

const TABS = ['home','log','calendar','books','writes','settings','config'];

function isBook(t){ return t && t.type === 'count' && t.recordStyle === 'book'; }
function isFree(t){ return t && t.type === 'daily' && t.recordStyle === 'free'; }
function bookFields(t){
  return Object.assign({ author:false, publisher:false, rating:true }, (t && t.bookFields) || {});
}

let config, state;
let tab = 'home';
let timer = null;
let funIdx = 0, funOpen = false;
/* カレンダーが 見せている月（その月の1日）と、下にひらいている日。
   描き直しても 見ている場所が とばないよう、画面の外で おぼえておく */
let calMonth = null;
let calDay = null;
/* 「かいたもの いちらん」が いま見せている 課題。#writes:<taskId> から 入る。
   ハッシュには 課題の id が のこるので、画面を 描き直しても 見失わない */
let writesTaskId = null;

/* なぞなぞ・まめちしきは 1日に 引ける かずを かぎる。
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
    if(c && c.schema === SCHEMA)   config = c;
    else if(c && c.schema === 5) { config = migrate5to6(c); saveCfg(); }
    else                           config = deepCopy(DEFAULT_CONFIG);
  }catch(e){ config = deepCopy(DEFAULT_CONFIG); }

  try{
    state = normalizeState(JSON.parse(localStorage.getItem(K_ST) || 'null'));
  }catch(e){ state = emptyState(); }

  /* きょうの ぶんを まだ 1つも 引いていなければ、ここで 1つめを 引く */
  const ft = funToday();
  if(ft.seen.length) funIdx = ft.seen[ft.seen.length - 1];
  else funPick();
  funOpen = false;
}
function saveCfg(){ localStorage.setItem(K_CFG, JSON.stringify(config)); }
function saveSt(){ localStorage.setItem(K_ST, JSON.stringify(state)); }
function deepCopy(o){ return JSON.parse(JSON.stringify(o)); }

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
   ビュー：ホーム
   --------------------------------------------------------- */
function viewHome(){
  const must  = config.tasks.filter(t=>t.group==='must');
  const opt   = config.tasks.filter(t=>t.group==='option');
  const daily = config.tasks.filter(t=>t.group==='daily');
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

  ${dailyAllDone ? '' : dailySec}
  ${sectionHTML('must','かならず やる', nokori>0 ? 'のこり '+nokori+'こ' : 'ぜんぶ できた！', must)}
  ${opt.length   ? sectionHTML('opt','もうすこし チャレンジ','じかんが あるとき', opt) : ''}

  <section class="sec">
    <div class="sec-head"><h2>きょう やったこと</h2><span class="sec-note">${fmtDate(new Date())}</span></div>
    <div class="paper today-list">${todayHTML()}</div>
  </section>

  ${dailyAllDone ? dailySec : ''}
  ${funHTML()}
  `;
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
    const n = Math.max(p.total, p.done);
    let hearts = '';
    for(let i=1;i<=n;i++) hearts += `<span class="heart${i<=p.done?' on':''}">❤️</span>`;
    meter = `<div class="task-meter">
        <div class="hearts">${hearts}</div>
        ${p.streak>0 ? `<span class="streak">${p.streak}日 れんぞく</span>` : ''}
      </div>`;
  }else{
    // count と step は 同じ 見た目。ランプは 14/14 の すぐ よこに ならべる
    meter = `<div class="task-meter">
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

/* きょうの ぶんの おぼえがき。日づけが かわったら 0から かぞえなおす */
function funToday(){
  const key = dayKey(new Date());
  let f = state.fun;
  if(!f || f.key !== key || !Array.isArray(f.seen)){ f = { key, seen: [] }; state.fun = f; }
  return f;
}

/* まだ きょう 出していない ものから ひとつ ランダムに えらぶ。
   ぜんぶ 出しきったら また 全体から えらぶ */
function funPick(){
  const f = funToday();
  const rest = FUN.map((_, i)=> i).filter(i => f.seen.indexOf(i) < 0);
  const pool = rest.length ? rest : FUN.map((_, i)=> i);
  funIdx = pool[Math.floor(Math.random() * pool.length)];
  funOpen = false;
  f.seen.push(funIdx);
  saveSt();
}

function funHTML(){
  const f = FUN[funIdx % FUN.length];
  const left = FUN_MAX - funToday().seen.length;
  return `
  <section class="paper fun">
    <span class="fun-tag">${esc(f.t)}</span>
    <p class="fun-q">${rubyHTML(f.q)}</p>
    ${funOpen ? `<p class="fun-a">${rubyHTML(f.a)}</p>` : ''}
    <div class="fun-row">
      ${funOpen ? '' : `<button class="btn btn-sm" data-fun="open" type="button">${
        f.t === 'なぞなぞ' ? 'こたえを 見る' : 'つづきを 見る'}</button>`}
      ${left > 0
        ? `<button class="btn btn-sm" data-fun="next" type="button">つぎの はなし（あと ${left}かい）</button>`
        : `<span class="fun-owari">きょうは ここまで。また あした！</span>`}
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
      <span class="cal-leg"><span class="cal-dot cal-dot--option"></span>もうすこし チャレンジ</span>
      <span class="cal-leg"><span class="cal-dot cal-dot--daily"></span>まいにち</span>
      <span class="cal-leg"><span class="cal-leg-box"></span>なにか やった日</span>
      <span class="cal-leg"><span class="cal-free">📝</span>なんでも きろく</span>
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

  <section class="paper pstat">
    <div class="pstat-grid">
      <div><span class="pstat-lab">残り</span>
        <span class="pstat-val">${ms > 0 ? Math.floor(ms/86400000) + '日' + (Math.floor(ms/3600000)%24) + '時間' : '終了'}</span></div>
      <div><span class="pstat-lab">夏休みの経過</span>
        <span class="pstat-val">${Math.round(nat)}<small>%</small></span></div>
      <div><span class="pstat-lab">必須の宿題</span>
        <span class="pstat-val">${Math.round(s.pct)}<small>% (${s.done}/${s.total})</small></span></div>
      <div><span class="pstat-lab">できればやる</span>
        <span class="pstat-val">${so.total ? Math.round(so.pct) : 0}<small>% (${so.done}/${so.total})</small></span></div>
    </div>
  </section>

  ${group('must','必ずやる')}
  ${group('option','できればやる')}
  ${group('daily','毎日')}

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
    <a class="btn btn-wide" href="#config" style="text-decoration:none;text-align:center">設定を変更する</a>
  </div>`;
}

/* ---------------------------------------------------------
   保護者ページ（設定）
   --------------------------------------------------------- */
function viewConfig(){
  const t2opt = (v,cur,label) => `<option value="${v}"${v===cur?' selected':''}>${label}</option>`;

  const taskRows = config.tasks.map((t,i)=>`
    <div class="set-task" data-i="${i}">
      <div class="set-task-top">
        <input type="text" data-f="name" value="${esc(t.name)}">
        <button class="icon-btn" data-move="-1" title="上へ移動" type="button">↑</button>
        <button class="icon-btn" data-move="1" title="下へ移動" type="button">↓</button>
        <button class="icon-btn del" data-del="1" title="削除" type="button">🗑</button>
      </div>
      <div class="set-grid">
        <label>区分
          <select data-f="group">
            ${t2opt('must',t.group,'必ずやる')}
            ${t2opt('option',t.group,'できればやる')}
            ${t2opt('daily',t.group,'毎日')}
          </select>
        </label>
        <label>進め方
          <select data-f="type">
            ${t2opt('count',t.type,'番号・数')}
            ${t2opt('step',t.type,'段階式')}
            ${t2opt('daily',t.type,'毎日のノルマ')}
          </select>
        </label>
        ${t.type==='count' ? `
          <label>全体量 <input type="number" data-f="total" min="1" max="200" value="${t.total|0}"></label>
          <label>単位 <input type="text" data-f="unit" value="${esc(t.unit||'')}" style="width:96px"></label>
          <label><input type="checkbox" data-f="numbered"${t.numbered?' checked':''}> ①②で表示</label>
          <label>記録形式
            <select data-f="recordStyle">
              ${t2opt('',t.recordStyle||'','通常')}
              ${t2opt('book',t.recordStyle||'','本の記録')}
            </select>
          </label>
        ` : ''}
        ${(t.type==='count' || t.type==='step') ? `
          <label><input type="checkbox" data-f="wrapUp"${t.wrapUp?' checked':''}> マルつけして もらう・なおし を つける</label>
        ` : ''}
        ${isBook(t) ? (bf => `
          <label><input type="checkbox" data-bf="author"${bf.author?' checked':''}> さくしゃ欄</label>
          <label><input type="checkbox" data-bf="publisher"${bf.publisher?' checked':''}> しゅっぱんしゃ欄</label>
          <label><input type="checkbox" data-bf="rating"${bf.rating?' checked':''}> おすすめ度（★1〜3）</label>
        `)(bookFields(t)) : ''}
        ${t.type==='daily' ? `
          <label>記録形式
            <select data-f="recordStyle">
              ${t2opt('',t.recordStyle||'','ノルマ（回数）')}
              ${t2opt('free',t.recordStyle||'','自由記述')}
            </select>
          </label>
        ` : ''}
        ${t.type==='daily' && !isFree(t) ? `
          <label>1日のノルマ <input type="number" data-f="target" min="1" max="20" value="${t.target|0}"></label>
          <label>単位 <input type="text" data-f="targetUnit" value="${esc(t.targetUnit||'')}" style="width:110px"></label>
        ` : ''}
      </div>
      ${isBook(t) ? `
        <p class="set-note" style="padding:0">本の記録形式では、書名・読んだ日・ひとこと感想を1冊ずつ入力し、
        1件の登録で進捗が1つ進みます。感想は「かんじを しらべる」で習っていない漢字に印が付き、
        さらに「ぜんぶ ひらがなに して」で書き写し用の文を作れます（辞書約17MBの読み込みが必要）。</p>` : ''}
      ${t.type==='step' ? `
        <label class="lab" style="font-size:16px">段階の項目（1行に1つ・子どもに表示されます）
          <textarea data-f="steps" rows="${Math.max(3,(t.steps||[]).length)}">${esc((t.steps||[]).join('\n'))}</textarea>
        </label>` : ''}
      ${t.type!=='daily' && !isBook(t) ? `
        <label class="lab" style="font-size:16px">記録時に表示する質問（1行に1つ・任意）
          <textarea data-f="questions" rows="3" placeholder="例：はっぱの 形や 色は どんな かんじ？">${esc((t.questions||[]).join('\n'))}</textarea>
        </label>` : ''}
      ${isFree(t) ? `
        <label class="lab" style="font-size:16px">よびかけの一言（子どもに表示されます）
          <input type="text" data-f="freeHint" value="${esc(t.freeHint||'')}"
            placeholder="みたもの・あそび・ゲーム・ともだち・かぞく……なんでも いいよ。">
        </label>` : ''}
      ${!isBook(t) ? `
      <label class="lab" style="font-size:16px">${isFree(t) ? '見出し' : 'メモ欄の見出し'}（子どもに表示されます）
        <input type="text" data-f="memoLabel" value="${esc(t.memoLabel||'')}" placeholder="やったことを かこう">
      </label>` : ''}
    </div>`).join('');

  return `
  <div class="paper parent-head">
    <div>
      <h2>設定</h2>
      <p>期間と宿題の項目を変更できます。</p>
    </div>
    <a class="btn btn-sm" href="#settings">保護者ページへ戻る</a>
  </div>

  <section class="sec">
    <div class="sec-head"><h2>基本設定</h2></div>
    <div class="paper">
      <div class="set-row"><span class="lab">タイトル</span>
        <input type="text" id="cfgTitle" value="${esc(config.title)}"></div>
      <div class="set-row"><span class="lab">夏休みの開始</span>
        <input type="datetime-local" id="cfgStart" value="${esc(config.startAt)}"></div>
      <div class="set-row"><span class="lab">夏休みの終了</span>
        <input type="datetime-local" id="cfgEnd" value="${esc(config.endAt)}"></div>
      <p class="set-note">終了日時はカウントダウンの基準になります。開始日時と合わせて、
      ペースメーターの「夏休みの経過率」の算出にも使われます。学校から配布された日程に合わせてください。</p>
    </div>
  </section>

  <section class="sec">
    <div class="sec-head"><h2>宿題の項目</h2><span class="sec-note">${config.tasks.length}件</span></div>
    <div class="paper" id="taskEditor">${taskRows}</div>
    <div class="set-actions">
      <button class="btn btn-sm" id="addTask" type="button">＋ 項目を追加</button>
    </div>
  </section>

  <section class="sec">
    <div class="sec-head"><h2>データ</h2></div>
    <div class="paper">
      <p class="set-note">記録は端末内（localStorage）にのみ保存され、サーバーには送信されません。
      Safari の履歴・サイトデータを削除すると失われます。定期的にバックアップを取ってください。</p>
      <div class="set-actions">
        <button class="btn btn-sm" id="expBtn" type="button">⬇ バックアップを書き出す</button>
        <button class="btn btn-sm" id="impBtn" type="button">⬆ バックアップを読み込む</button>
        <input type="file" id="impFile" accept="application/json,.json" hidden>
      </div>
      <div class="set-actions">
        <button class="btn btn-sm btn-danger" id="resetCfg" type="button">項目を初期状態に戻す</button>
        <button class="btn btn-sm btn-danger" id="resetAll" type="button">記録をすべて削除</button>
      </div>
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
      <input type="text" id="bkAuthor" value="${val('author')}" placeholder="れい：キューライス">
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

  $('#appTitle').textContent = config.title;
  $('#todayLabel').textContent = fmtDate(new Date());
  document.title = config.title;

  const v = $('#view');
  if(timer){ clearInterval(timer); timer = null; }

  if(tab === 'home')          v.innerHTML = viewHome();
  else if(tab === 'log')      v.innerHTML = viewLog();
  else if(tab === 'calendar') v.innerHTML = viewCalendar();
  else if(tab === 'books')    v.innerHTML = viewBooks();
  else if(tab === 'writes')   v.innerHTML = viewWrites();
  else if(tab === 'config')   v.innerHTML = viewConfig();
  else                        v.innerHTML = viewParent();

  $$('.tab').forEach(b=> b.classList.toggle('is-on', b.dataset.tab === tab));
  // 子ども画面以外ではタブバーを隠す（それぞれ「もどる」で戻す）
  const noTabs = (tab !== 'home' && tab !== 'log' && tab !== 'calendar');
  $('.tabbar').hidden = noTabs;
  document.body.classList.toggle('no-tabbar', noTabs);

  if(tab === 'home'){
    renderCountdown();
    timer = setInterval(renderCountdown, 1000);
  }
  if(tab === 'settings') bindParent();
  if(tab === 'config')   bindConfig();
  window.scrollTo(0, keepScroll ? y : 0);
}

/* ---------------------------------------------------------
   せっていの そうさ
   --------------------------------------------------------- */
/* 保護者ページ（進捗一覧）— サマリーの生成と書き出し */
function bindParent(){
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

/* 保護者ページ（設定）*/
function bindConfig(){
  $('#cfgTitle').addEventListener('change', e=>{
    config.title = e.target.value || 'なつやすみの しゅくだい';
    saveCfg(); render({ keepScroll:true });
  });
  $('#cfgStart').addEventListener('change', e=>{ config.startAt = e.target.value; saveCfg(); });
  $('#cfgEnd').addEventListener('change',   e=>{ config.endAt   = e.target.value; saveCfg(); });

  const ed = $('#taskEditor');
  ed.addEventListener('change', e=>{
    const row = e.target.closest('.set-task'); if(!row) return;
    const t = config.tasks[+row.dataset.i]; if(!t) return;

    const bf = e.target.dataset.bf;
    if(bf){
      t.bookFields = Object.assign(bookFields(t), { [bf]: e.target.checked });
      saveCfg(); return;
    }

    const f = e.target.dataset.f; if(!f) return;

    if(f === 'recordStyle'){
      const v = e.target.value;
      if(v === 'book'){ t.recordStyle = 'book'; t.bookFields = bookFields(t); }
      else if(v === 'free'){
        t.recordStyle = 'free';
        t.target = 1; t.targetUnit = 'かい';
        t.memoLabel = t.memoLabel || 'きょうは なにを した？';
      }
      else delete t.recordStyle;
      saveCfg(); render({ keepScroll:true }); return;
    }
    if(f === 'numbered')        t.numbered = e.target.checked;
    // 外しても progress の wrap は 消さない。付けなおしたら 前の状態が また見える
    else if(f === 'wrapUp')     t.wrapUp = e.target.checked;
    else if(f === 'total')      t.total = clamp(+e.target.value||1, 1, 200);
    else if(f === 'target')     t.target = clamp(+e.target.value||1, 1, 20);
    else if(f === 'steps')      t.steps = e.target.value.split('\n').map(s=>s.trim()).filter(Boolean);
    else if(f === 'questions')  t.questions = e.target.value.split('\n').map(s=>s.trim()).filter(Boolean);
    else if(f === 'type'){
      t.type = e.target.value;
      if(t.type==='count'  && !t.total) { t.total = 10; t.unit = t.unit || 'ばん'; t.numbered = true; }
      if(t.type==='step'   && !(t.steps||[]).length) t.steps = ['はじめる','とちゅう','かんせい！'];
      if(t.type==='daily'  && !t.target){ t.target = 1; t.targetUnit = t.targetUnit || 'かい'; }
      if(t.type==='daily') t.group = 'daily';
      saveCfg(); render({ keepScroll:true }); return;
    }
    else if(f === 'group'){
      t.group = e.target.value;
      if(t.group==='daily' && t.type!=='daily'){ t.type='daily'; t.target = t.target||1; t.targetUnit = t.targetUnit||'かい'; }
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
      const j = i + (+mv.dataset.move);
      if(j < 0 || j >= config.tasks.length) return;
      const a = config.tasks; const tmp = a[i]; a[i] = a[j]; a[j] = tmp;
      saveCfg(); render({ keepScroll:true }); return;
    }
    if(e.target.closest('[data-del]')){
      const t = config.tasks[i];
      if(confirm('「'+t.name+'」を削除しますか？\nこれまでの記録は残ります。')){
        config.tasks.splice(i,1); saveCfg(); render({ keepScroll:true });
      }
    }
  });

  $('#addTask').addEventListener('click', ()=>{
    config.tasks.push({
      id: 't' + Date.now(), group:'option', type:'count',
      name:'あたらしい しゅくだい', total:10, unit:'ばん', numbered:true,
      memoLabel:'やったことを かこう'
    });
    saveCfg(); render({ keepScroll:true });
  });

  $('#expBtn').addEventListener('click', exportData);
  $('#impBtn').addEventListener('click', ()=> $('#impFile').click());
  $('#impFile').addEventListener('change', importData);

  $('#resetCfg').addEventListener('click', ()=>{
    if(confirm('項目を初期状態に戻しますか？\nこれまでの記録は残ります。')){
      config = deepCopy(DEFAULT_CONFIG); saveCfg(); render(); toast('初期状態に戻しました');
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
const GROUP_LABEL = { must:'かならずやる', option:'できればやる', daily:'まいにち' };

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
  if(so.total) L.push('できればやる  ' + Math.round(so.pct) + '%  (' + so.done + '/' + so.total + ')');

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
      /* 1日に 引ける かずを かぎる。ボタンは 上限で 消えるが、
         連打や 古い画面から 押された ときのために ここでも 止める */
      if(funToday().seen.length >= FUN_MAX) return;
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
   ルーティング（#home / #record / #log / #settings）
   --------------------------------------------------------- */
/* かいたもの いちらんだけは 課題を えらぶので '#writes:<taskId>' の形にする。
   ハッシュに 課題を のせておけば、もどる・すすむでも 同じ画面に かえれる */
function routeFromHash(){
  const h = (location.hash || '').replace(/^#/, '');
  const c = h.indexOf(':');
  const name = c < 0 ? h : h.slice(0, c);
  if(name === 'writes'){ writesTaskId = c < 0 ? writesTaskId : h.slice(c + 1); return 'writes'; }
  return TABS.indexOf(h) >= 0 ? h : 'home';
}
window.addEventListener('hashchange', ()=>{
  const t = routeFromHash();
  /* writes は 同じタブのまま 課題だけ かわることが あるので、
     タブが 同じでも 描き直す */
  if(t !== tab || t === 'writes'){ tab = t; render(); }
});

/* ---------------------------------------------------------
   はじめる
   --------------------------------------------------------- */
loadAll();
tab = routeFromHash();
render();

})();
