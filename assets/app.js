/* SPDX-License-Identifier: Apache-2.0 */
/* =========================================================
   app.js — はじめ夏休みの宿題一覧
   データは この iPad の中（localStorage）に ほぞんされます。
   ========================================================= */
(function () {
'use strict';

/* この端末が いま動かしている 版。index.html の ?v= を そのまま よむので、
   書きうつす 手間も ずれも ない。
   iPad は index.html を つよく ためこむので、再起動しても 古い版の ままの
   ことが ある。端末どうしで 記録を 合わせる やり方は 版で ちがうため、
   「両方とも 新しい版か」を その場で 見られるように しておく。 */
const APP_VER = (function(){
  const s = document.currentScript;
  const m = s && String(s.src || '').match(/[?&]v=([^&]*)/);
  return m ? decodeURIComponent(m[1]) : '（不明）';
})();
function appVersionHTML(version){
  const text = String(version || '');
  const match = text.match(/^(.*?)([A-Za-z]+)$/);
  return match ? `${esc(match[1])}<span class="app-version-suffix">${esc(match[2])}</span>` : esc(text);
}

/* ---------------------------------------------------------
   ほぞん
   --------------------------------------------------------- */
/* ?new=1 は、今のグループデータと同期に触れず初期設定だけを試すための隔離モード。 */
const TEST_MODE = new URLSearchParams(location.search).get('new') === '1';
/* 保護者画面の確認用。preview専用キーだけを作るため、普段のグループデータには触れない。 */
const DEBUG_PARENT = TEST_MODE && new URLSearchParams(location.search).get('debug') === 'parent';
/* 初期設定の確認用。合言葉欄と注意事項まで表示するが、preview専用キー以外には触れない。 */
const DEBUG_WELCOME_ROLE = TEST_MODE ? new URLSearchParams(location.search).get('debug') : '';
const DEBUG_WELCOME = DEBUG_WELCOME_ROLE === 'welcome-parent' || DEBUG_WELCOME_ROLE === 'welcome-child';
/* ミニコンテンツを確認するときだけ、全項目を一覧で出す隠し入口。
   既存の trivia URL もそのまま使えるようにする。 */
const DEBUG_CONTENT = ['trivia','content'].includes(new URLSearchParams(location.search).get('debug'));
const K_CFG = TEST_MODE ? 'natsu.preview.config.v1' : 'natsu.config.v2';
const K_ST  = TEST_MODE ? 'natsu.preview.state.v1'  : 'natsu.state.v2';
/* 初期設定は端末ごとに一度だけ表示する。グループの設定そのものは従来どおり
   Firebase（あいことば）経由で共有し、端末の役割・表示名だけは端末内に残す。 */
const K_ONBOARD = TEST_MODE ? 'natsu.preview.onboarding.v1' : 'natsu.onboarding.v1';
/* 人が じぶんで えらんだ 合言葉。
   ホーム画面に 追加した アプリは、**起動URLに 招待の 合言葉が 焼きついて
   いる**。そのため 共有を 解除しても、作り直しても、次に ホーム画面から
   開いた 瞬間に URL の 合言葉で つなぎ直され、前の グループに 戻ってしまう。
   起動URLは あとから 書きかえられないので、「人が どれを えらんだか」を
   この端末に おぼえておき、URL より そちらを 優先する。
   解除した ときは 'none' を 入れて、どこにも つながらないことを おぼえる */
const K_CODE_CHOSEN = TEST_MODE ? 'natsu.preview.sync.chosen.v1' : 'natsu.sync.chosen.v1';
function rememberChosenCode(code){ setLocal(K_CODE_CHOSEN, String(code || 'none')); }
const K_ROLE = TEST_MODE ? 'natsu.preview.role.v1' : 'natsu.device.role.v1';
const K_NAME = TEST_MODE ? 'natsu.preview.name.v1' : 'natsu.device.name.v1';
const K_READING = TEST_MODE ? 'natsu.preview.reading.v1' : 'natsu.device.reading.v1';
const K_THEME = TEST_MODE ? 'natsu.preview.theme.v1' : 'natsu.device.theme.v1';
/* 共有へ入る子どもが初期設定で選んだデザイン。グループの設定を受け取ったあとに
   1度だけ反映し、受信前の初期値を先に送る事故を避ける。 */
const K_WELCOME_THEME = TEST_MODE ? 'natsu.preview.welcome.theme.v1' : 'natsu.welcome.theme.v1';
/* 既存グループへの参加画面で変更した名前・漢字設定。グループの設定を最初に
   受け取ったあとで1度だけ重ね、参加端末の初期値による上書きを防ぐ。 */
const K_WELCOME_JOIN = TEST_MODE ? 'natsu.preview.welcome.join.v1' : 'natsu.welcome.join.v1';
/* 管理者が共有データを削除処理に入れた端末だけ、古い内容を新しい合言葉へ
   送り直さず、最初の登録画面で理由を表示する。 */
const K_RETIRED_NOTICE = TEST_MODE ? 'natsu.preview.retired.notice.v1' : 'natsu.retired.notice.v1';
/* sync.js が この端末に ふった ランダム番号。一覧で「この端末」を 見わけるのに つかう */
/* この端末の 呼び名（父・母 など）。共有した ときに 端末を 見わけるため。
   端末ごとの ものなので 同期しない（同期すると 全部 同じ名前に なる） */
const K_DEVICE_LABEL = TEST_MODE ? 'natsu.preview.device.label.v1' : 'natsu.device.label.v1';
const K_DEVICE_ID = TEST_MODE ? 'natsu.preview.sync.device.v1' : 'natsu.sync.device.v1';
const K_TRIVIA_REVIEW = TEST_MODE ? 'natsu.preview.trivia-review.v1' : 'natsu.trivia-review.v1';
const K_METRIC = 'natsu.metric.registered.v1';
/* URL の隠し入口。静的サイトなので認証ではなく、通常画面に出さないための合図。 */
const STATS_PARAM = 'stats';
const STATS_VALUE = 'family-count';

/* おためしURLを開くたびに、前回のおためし内容を消して必ず初期画面にする。
   消すのは preview 専用キーだけで、普段のグループデータ・あいことばには触れない。 */
if(TEST_MODE){
  try{
    [K_CFG, K_ST, K_ONBOARD, K_ROLE, K_NAME, K_READING, K_THEME, K_WELCOME_THEME, K_WELCOME_JOIN].forEach(k=>localStorage.removeItem(k));
    if(DEBUG_PARENT){
      localStorage.setItem(K_ONBOARD, 'done');
      localStorage.setItem(K_ROLE, 'parent');
      localStorage.setItem(K_NAME, 'おためし');
    }
  }catch(e){}
}

const TABS = ['welcome','stats','home','log','calendar','books','writes','settings','tasks','config'];
/* 大人が読む画面。かな変換をかけず、クレジットと入力元の印を出す。
   ページを足したら ここにも 足すこと（足し忘れると 子ども向けの
   かな変換が 設定画面に かかる） */
function isAdultTab(t){ return t === 'settings' || t === 'tasks' || t === 'config'; }

function isBook(t){ return t && t.type === 'count' && t.recordStyle === 'book'; }
function isFree(t){ return t && t.type === 'daily' && t.recordStyle === 'free'; }
/* 「文章で記録」の 既定の 呼びかけ。何も 決めていない 項目に つかう。
   白い 欄だけ 出されると 子どもの 手が 止まるので、例を ならべておく */
const FREE_HINT_DEFAULT = '今日のはっけん、今おもっていること、わかったこと、おぼえたこと、あそび、かぞく、ゲーム…なんでも書いてみよう。';
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
let openSyncDetails = false;
/* Chromium 系が出す「インストール」確認は、利用者が押すまでここで預かる。
   iOS Safari はこのイベントを出さないため、同じボタンで手順案内へ切り替える。 */
let deferredInstallPrompt = null;
let funIdx = 0, funOpen = false;
/* カレンダーが 見せている月（その月の1日）と、下にひらいている日。
   描き直しても 見ている場所が とばないよう、画面の外で おぼえておく */
let calMonth = null;
let calDay = null;
let openConfigTaskId = null;
let welcomeThemeChoice = '';
let welcomeJoinVerified = null;
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
function emptyState(){ return { schema:SCHEMA, resetAt:0, progress:{}, logs:[], books:[], trash:[], gone:[], reads:[], messages:[] }; }

/* 消した記録を のこす数。
   これは「思い出のため」だけでは なく、消したことを 相手の端末に つたえる
   墓標も かねている。ここから あふれた ぶんは、相手が ずっと オフラインだった
   場合に かぎり 復活しうる。ふだんは 数秒で とどくので 50もあれば 足りる */
const TRASH_MAX = 50;
/* 「まいにち」の例は設定に残すが、新規グループの子ども画面では初期非表示。 */
function freshConfig(){
  return normalizeConfig(deepCopy(DEFAULT_CONFIG));
}
function defaultTitleFor(childName){
  const name = String(childName || '').trim();
  return name ? name + 'の夏休みの宿題' : 'しゅくだいノート';
}
function isGeneratedTitle(title, childName){
  const value = String(title || '').trim();
  const name = String(childName || '').trim();
  return !value || value === 'はじめ夏休みの宿題' || value === 'なつやすみの しゅくだい'
    || value === 'しゅくだいノート'
    || (name && (value === name + 'の なつやすみの しゅくだい' || value === defaultTitleFor(name)));
}

function normalizeConfig(c){
  if(!c || typeof c !== 'object') return deepCopy(DEFAULT_CONFIG);
  if(!Array.isArray(c.tasks)) c.tasks = [];
  if(isGeneratedTitle(c.title, c.childName)) c.title = defaultTitleFor(c.childName);
  /* これまで端末内だけだったデザインは、おうちの設定として同期する。
     既存グループは、最初の保存時にその端末で選んでいたデザインを引き継ぐ。 */
  if(!THEME_IDS.includes(c.theme)){
    const legacyTheme = getLocal(K_THEME);
    c.theme = THEME_IDS.includes(legacyTheme) ? legacyTheme : 'notebook';
  }
  if(typeof c.showDaily !== 'boolean') c.showDaily = false;
  /* 読める漢字。既存グループは、その端末に のこっている 値を 引きつぐ */
  if(![0,1,2,9].includes(Number(c.readingGrade))){
    const legacy = Number(getLocal(K_READING));
    c.readingGrade = [0,1,2,9].includes(legacy) ? legacy : 2;
  }else c.readingGrade = Number(c.readingGrade);
  /* 記録の1行けし。ふだんは 切っておく。
     入れっぱなしだと、子どもが 誤って 記録を 消してしまう */
  if(typeof c.allowLogDelete !== 'boolean') c.allowLogDelete = false;
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
  /* 「記録をすべて削除」した時刻。同じグループの古い端末が、削除前の一式を
     あとから送り返しても復活させないための世代番号として使う。 */
  s.resetAt = ms(s.resetAt);
  if(!Array.isArray(s.logs))  s.logs  = [];
  if(!Array.isArray(s.books)) s.books = [];
  if(!Array.isArray(s.trash)) s.trash = [];
  if(!Array.isArray(s.gone))  s.gone  = [];
  if(!Array.isArray(s.reads)) s.reads = [];
  if(!Array.isArray(s.messages)) s.messages = [];
  return s;
}

/* ---------------------------------------------------------
   進みぐあいの 書きかえ

   数や チェックを 書きかえるときは、「いつ その値に なったか」も のこす。
   これが ないと、⑦を⑥に もどす 訂正が、相手の端末が 持っている 古い ⑦ に
   押し戻されてしまう（相手は ただ 持っているだけで、新しく ⑦に したわけでは ない）。
   時刻を くらべれば、「新しく そうした方」が 勝つので、
   進んだ ぶんは 消えず、訂正だけが とどく。
   --------------------------------------------------------- */
/* 時刻（ミリ秒）は 13けたに なるので、32ビットに 入らない。
   これまで `|0` で 数に していたが、それだと 負の数に 化ける。

     1786312076482 | 0  →  -394318654

   時刻の 無い側は 0 なので、0 のほうが 大きく なってしまい、
   「何も 入っていない側」が「実際に 記録された側」に 勝っていた
   （読書ゆうびんの ①が 親の端末に とどかなかった 原因）。
   両方に 時刻が ある ときは、どちらも 同じように 化けて 大小が
   たまたま 保たれるので、番号の 同期は 動いて 見えていた。 */
function ms(v){
  const n = Number(v);
  /* 旧版が `時刻 | 0` で保存した負の値は、元の13けたへ戻せない。
     「時刻なし」として扱えば、安全側の合流規則で値を救い、次の保存時には
     壊れた時刻自体も取り除ける。 */
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function stampArray(before, after, at, t){
  const b = Array.isArray(before) ? before : [];
  const a = Array.isArray(after)  ? after  : [];
  const old = Array.isArray(at) ? at : [];
  return a.map((v,i)=> (!!v === !!b[i]) ? ms(old[i]) : t);
}
function stampDays(before, after, at, t){
  const b = before || {}, a = after || {}, old = at || {};
  const out = {};
  Object.keys(a).forEach(k=>{ out[k] = ((a[k]|0) === (b[k]|0)) ? ms(old[k]) : t; });
  return out;
}
function progPatch(id, patch, when){
  const t = when || Date.now();
  const cur = state.progress[id] || {};
  const next = Object.assign({}, cur, patch);
  if('done'  in patch && (cur.done|0) !== (patch.done|0)) next.doneAt = t;
  if('steps' in patch) next.stepsAt = stampArray(cur.steps, patch.steps, cur.stepsAt, t);
  if('wrap'  in patch) next.wrapAt  = stampArray(cur.wrap,  patch.wrap,  cur.wrapAt,  t);
  if('days'  in patch) next.daysAt  = stampDays(cur.days,   patch.days,  cur.daysAt,  t);
  state.progress[id] = next;
  return next;
}

/* きょう 読んだ ミニコンテンツの ひかえ。

   きろく（logs）には 入れない。入れると「やったこと」が ふえ、
   カレンダーが みどりに なり、ごほうびの 判定（didSomethingToday）まで
   動いてしまう。読んだだけで 宿題を した ことには しない。
   あとから ふりかえる ためだけの、べつの ひかえに する。 */
const READS_MAX = 400;
function pushRead(i){
  const f = FUN[i];
  if(!f) return;
  if(!Array.isArray(state.reads)) state.reads = [];
  const now = new Date();
  const id = 'r' + now.getTime() + '-' + i;
  if(state.reads.some(r=> r.id === id)) return;
  state.reads.push({ id, at: now.toISOString(), t: f.t, q: f.q });
  if(state.reads.length > READS_MAX) state.reads = state.reads.slice(-READS_MAX);
  saveSt();
}
function readsOf(key){
  return (state.reads || []).filter(r => dayKey(new Date(r.at)) === key);
}
/* その日に 読んだ ぶんの 一覧。読んだ ものが ない 日は 何も 出さない */
function readsHTML(key){
  const rows = readsOf(key);
  if(!rows.length) return '';
  return `
  <div class="paper reads">
    <p class="reads-head">よんだ ミニコンテンツ<span class="reads-cnt">${rows.length}こ</span></p>
    ${rows.map(r=>`
      <div class="reads-row">
        <span class="reads-tag">${esc(r.t)}</span>
        <span class="reads-q">${rubyHTML(r.q)}</span>
      </div>`).join('')}
  </div>`;
}

/* 消した「印」だけの ひかえ。中身は のこさない。
   デバッグ用の 1行けしなど、数が 多くなる 消しかたは こちらを つかい、
   おうちの人に 見せる trash（中身つき）を うめないようにする */
const GONE_MAX = 300;
function pushGone(id){
  if(!Array.isArray(state.gone)) state.gone = [];
  state.gone = state.gone.filter(x=> x && x.id !== id);
  state.gone.unshift({ id, at: Date.now() });
  if(state.gone.length > GONE_MAX) state.gone = state.gone.slice(0, GONE_MAX);
}

/* ---------------------------------------------------------
   同期の記録（調べもの用）

   端末どうしで 記録が 合わないとき、どちらの端末の どの値が
   勝ったのかが 分からないと 直しようがない。
   合わせた ときに 変わった ところだけを、その端末に のこす。
   外へは 送らない。
   --------------------------------------------------------- */
const K_TRACE = 'natsu.sync.trace.v1';
const TRACE_MAX = 40;
function traceRead(){
  try{ const a = JSON.parse(getLocal(K_TRACE) || '[]'); return Array.isArray(a) ? a : []; }
  catch(e){ return []; }
}
function traceAdd(rows){
  if(!rows.length) return;
  const a = rows.concat(traceRead()).slice(0, TRACE_MAX);
  setLocal(K_TRACE, JSON.stringify(a));
}
/* 送り主を 見わける。送るとき、devices の中に 送った時刻（lastAt）を
   stateAt と 同じ値で のこしている。それを 突き合わせる。
   新しい 欄を 作らないのは、規則の 許可キーから 外れると 書けなくなるため */
function senderIdOf(stateAt){
  const S = window.NatsuSync;
  const map = (S && typeof S.devices === 'function') ? S.devices() : {};
  const hit = Object.keys(map).find(id=>{
    const v = map[id];
    return v && typeof v === 'object' && ms(v.lastAt) === ms(stateAt);
  });
  return hit || '';
}
/* 端末の ランダム番号 → 「親(1)」などの 見やすい 名前 */
function deviceLabelOf(id){
  if(!id) return '';
  const S = window.NatsuSync;
  const map = (S && typeof S.devices === 'function') ? S.devices() : {};
  const row = deviceRows(map).find(r=> r.id === id);
  return row ? row.label : '';
}

/* 設定を グループ側で 置きかえた ときの ようす。
   設定は 合流できず「まるごと どちらか」なので、採否の 理由が 分からないと
   デザインや 題名が 戻る 事故を 追えない。目に 見える 欄だけ のこす。 */
const TRACE_CONFIG_FIELDS = ['theme','title','childName','readingGrade','showDaily'];
/* 課題そのものは 長すぎて そのままでは のこせない。
   「いくつ あったか」を 欄に して のこす。まいにちの 項目が
   グループぜんたいから 消えた ときに、どちら側の 値が 勝ったのかを
   これで 追える（数だけなので 個人情報は 出ない） */
function taskCensus(c){
  const tasks = Array.isArray((c || {}).tasks) ? c.tasks : [];
  return {
    'tasks（数）': String(tasks.length),
    'まいにち（数）': String(tasks.filter(t => t && t.group === 'daily').length)
  };
}
function traceConfig(before, after, mineAt, theirsAt, first){
  const at = Date.now();
  const meId = getLocal(K_DEVICE_ID);
  const id = first ? 'config（つないだ直後）' : 'config';
  const censusBefore = taskCensus(before), censusAfter = taskCensus(after);
  const rows = TRACE_CONFIG_FIELDS
    .filter(f => String((before || {})[f]) !== String((after || {})[f]))
    .map(f => ({ at, id, f, meId, youId:'',
                 mine: String((before || {})[f]), mineAt,
                 theirs: String((after || {})[f]), theirsAt,
                 won: String((after || {})[f]), remoteAt: theirsAt }));
  Object.keys(censusBefore)
    .filter(f => censusBefore[f] !== censusAfter[f])
    .forEach(f => rows.push({ at, id, f, meId, youId:'',
                 mine: censusBefore[f], mineAt,
                 theirs: censusAfter[f], theirsAt,
                 won: censusAfter[f], remoteAt: theirsAt }));
  traceAdd(rows);
}

/* 合わせる前と あとの progress を くらべ、変わった ところを 書きだす */
function traceProgress(before, after, remote, remoteAt){
  const rows = [];
  const at = Date.now();
  const meId = getLocal(K_DEVICE_ID);
  const youId = senderIdOf(remoteAt);
  const ids = new Set([...Object.keys(before || {}), ...Object.keys(after || {})]);
  ids.forEach(id=>{
    const b = (before || {})[id] || {}, a = (after || {})[id] || {}, r = (remote || {})[id] || {};
    if((b.done|0) !== (a.done|0)){
      rows.push({ at, id, f:'done', meId, youId,
                  mine:(b.done|0), mineAt:ms(b.doneAt),
                  theirs:(r.done|0), theirsAt:ms(r.doneAt),
                  won:(a.done|0), remoteAt: ms(remoteAt) });
    }
    ['wrap','steps'].forEach(k=>{
      const x = JSON.stringify(b[k] || []), y = JSON.stringify(a[k] || []);
      if(x !== y) rows.push({ at, id, f:k, meId, youId, mine:x, mineAt:JSON.stringify(b[k+'At'] || []),
                              theirs:JSON.stringify(r[k] || []), theirsAt:JSON.stringify(r[k+'At'] || []),
                              won:y, remoteAt: ms(remoteAt) });
    });
  });
  traceAdd(rows);
}

/* 消した記録を のこす。中身は おうちの人だけが 見る。
   id は 消した記録の id そのもの。これが 墓標に なる */
function pushTrash(entry){
  if(!Array.isArray(state.trash)) state.trash = [];
  state.trash = state.trash.filter(x=> x && x.id !== entry.id);
  state.trash.unshift(Object.assign({ at: Date.now(), by: logBy() }, entry));
  if(state.trash.length > TRASH_MAX) state.trash = state.trash.slice(0, TRASH_MAX);
}

function loadAll(){
  try{
    const c = JSON.parse(localStorage.getItem(K_CFG) || 'null');
    if(c && c.schema === SCHEMA)   config = normalizeConfig(c);
    else if(c && c.schema === 5) { config = normalizeConfig(migrate5to6(c)); saveCfg(); }
    else                           config = freshConfig();
  }catch(e){ config = freshConfig(); }
  applyTheme(config.theme);

  try{
    state = normalizeState(JSON.parse(localStorage.getItem(K_ST) || 'null'));
  }catch(e){ state = emptyState(); }

  /* きょうの ぶんを まだ 1つも 引いていなければ、ここで 1つめを 引く。
     豆知識の確認URLでは、確認だけで日ごとの抽選履歴を動かさない。 */
  if(!DEBUG_CONTENT){
    const ft = funToday();
    if(ft.seen.length) funIdx = ft.seen[ft.seen.length - 1];
    else funPick();
  }
  funOpen = false;
  /* 旧しきの 1件だけの メッセージを、新しい ならびへ 移す（1度だけ） */
  migrateMessages();
}
/* 設定は 中身を 混ぜられないので「あとに 保存した方が まるごと 勝つ」。
   だから「いつ 保存したか」を 押す タイミングが そのまま 事故に なる。

   おうちに つないだ ばかりで、まだ おうちの 設定を 受け取っていない 端末は、
   手元の 設定が 新しいのか 古いのか わからない。そこで 保存すると
   「いま」の 時刻が つき、まだ 何も 受け取っていない 初期値が
   おうち全体に 配られて、みんなの デザインや 題名が 消える。

   初期設定の 画面が まさに この形だった。名前を 入れて saveCfg() を 呼び、
   そのあとで つなぎに いくので、初期値が かならず 勝っていた。

   受け取る 前は、手元にだけ 書いて 時刻を 押さない。こうすると
   おうちの 設定が とどいた とき かならず そちらが 勝つ。
   1回 受け取った あとは ふつうに 保存する。 */
function configHeldBack(){
  const S = window.NatsuSync;
  return !!(S && typeof S.awaitingFirstSnapshot === 'function' && S.awaitingFirstSnapshot());
}
function saveCfg(){
  config = normalizeConfig(config);
  applyTheme(config.theme);
  localStorage.setItem(K_CFG, JSON.stringify(config));
  if(configHeldBack()) return;
  markSaved('config');
  syncPush('config');
}

/* よその おうち（または はずされる 前の 自分）で 保存した 時刻は、
   これから 入る おうちの 時刻と くらべても 意味が ない。
   ちがう あいことばに つなぐ ときは 0 に もどし、おうちの 中身が
   かならず 勝つようにする。もどさないと、よそで 保存した 古い 内容が
   「新しい」と 判定され、おうち全体に 配られる。

   記録（state）の 時刻は 落とさない。記録は 値ごとに 時刻を 持って
   合流する（mergeProgress）ので、ここで 落とす 必要が なく、
   落とすと 安全側に 倒れすぎる。 */
const K_CFG_HOUSE = TEST_MODE ? 'natsu.preview.config.house.v1' : 'natsu.config.house.v1';
function forgetConfigStampForNewHousehold(code){
  const c = String(code || '');
  if(!c || getLocal(K_CFG_HOUSE) === c) return;
  const a = savedAt();
  delete a.config;
  try{ localStorage.setItem(K_AT, JSON.stringify(a)); }catch(e){}
  /* 「記録をすべて削除」の 世代番号（resetAt）も 落とす。

     これは **前の おうちで 全部 消した**という 印で、これから 入る
     おうちには 関係が ない。のこしたまま 入ると、mergeState が
     「新しい世代は こちら」と 判断し、**入った先の おうちの 記録を
     まるごと 捨てる**（左右の どちらかを emptyState() に する）。
     設定は 受け取れているのに 記録だけ 来ない、という 形で 出る。
     消したことを 伝えたい 相手は 前の おうちなので、ここで 手放す。 */
  if(state && ms(state.resetAt)){
    state.resetAt = 0;
    try{ localStorage.setItem(K_ST, JSON.stringify(state)); }catch(e){}
  }
  setLocal(K_CFG_HOUSE, c);
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
function homeInstallPlatform(ua, touchPoints){
  const text = String(ua || '');
  const ios = /iPad|iPhone|iPod/.test(text) || (/Macintosh/.test(text) && Number(touchPoints) > 1);
  if(ios) return 'ios';
  if(/Android/i.test(text)) return 'android';
  if(/Windows|Macintosh|Linux/i.test(text)) return 'desktop';
  return 'other';
}
/* 呼び名を 付けていない 端末の 既定の 表示。
   ブラウザは 機種名（iPhone SE など）までは 教えてくれないので、
   分かるのは この程度の 大きな くくりだけ。個体を 特定できる 値は
   ふくめない（呼び名を 付ければ そちらが 優先される）。 */
function deviceKindLabel(ua, touchPoints){
  const text = String(ua || '');
  if(/iPad/.test(text) || (/Macintosh/.test(text) && Number(touchPoints) > 1)) return 'iPad';
  if(/iPhone/.test(text)) return 'iPhone';
  if(/iPod/.test(text))   return 'iPod';
  if(/Android/i.test(text)) return /Mobile/i.test(text) ? 'Android' : 'Androidタブレット';
  if(/Windows/i.test(text)) return 'Windows';
  if(/Macintosh/i.test(text)) return 'Mac';
  return 'この端末';
}
function homeInstallGuideHTML(){
  if(isStandalone()) return '';
  const platform = homeInstallPlatform(navigator.userAgent, navigator.maxTouchPoints);
  const text = platform === 'ios'
    ? 'Safariでこのページを開き、画面下（iPadは上）の共有ボタン □↑ を押して、「ホーム画面に追加」→「追加」を選びます。LINEなどのアプリ内ブラウザでは、先に「Safariで開く」を選んでください。'
    : platform === 'android'
      ? 'Chromeなどのメニュー ⋮ を開き、「ホーム画面に追加」または「アプリをインストール」を選びます。表示名を確認して追加してください。'
      : platform === 'desktop'
        ? 'ブラウザのアドレス欄にあるインストールの印、またはメニューから「インストール」／「アプリとしてインストール」を選びます。'
        : 'お使いのブラウザのメニューから「ホーム画面に追加」または「インストール」を選びます。';
  return `
  <section class="sec home-install">
    <div class="sec-head"><h2>ホーム画面に追加</h2></div>
    <div class="paper home-install-paper">
      <p class="set-note">いつも使う端末では、ホーム画面に追加しておくと見つけやすくなります。</p>
      <p class="set-note">「この端末は <b>保護者の端末</b>」を選んでいれば、追加したアイコンからは<b>この保護者ページが開きます</b>（子ども画面はページ内の「子ども画面へ」から見られます）。選んでいないときは子ども画面が開きます。設定は「ほかの端末と共有」→「この端末の表示と役割」で変えられます。</p>
      <div class="set-actions"><button class="btn btn-sm" id="homeInstallBtn" type="button">ホーム画面に追加する</button></div>
      <p class="set-note home-install-guide" id="homeInstallGuide" hidden>${esc(text)}</p>
    </div>
  </section>`;
}
function isStatsURL(){ return new URLSearchParams(location.search).get(STATS_PARAM) === STATS_VALUE; }
function cleanCode(value){ return String(value || '').trim().normalize('NFKC').replace(/\s+/g,'').replace(/[\/\u0000-\u001f]/g,''); }
/* 読める漢字は これまで 端末ごとの 設定だった。
   そのため おうちの人の端末で 変えても、子どもの端末は そのままで、
   保護者から 直せない状態に なっていた。
   デザイン（テーマ）と 同じく おうちの設定として 同期する。
   まだ config に 無い グループは、その端末に のこっている 値を 引きつぐ。 */
function readingGrade(){
  const c = config && Number(config.readingGrade);
  if([0,1,2,9].includes(c)) return c;
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
/* 値ひとつぶんの 勝ち負け。
   どちらかに 時刻が あれば「あとで そうした方」が 勝つ。
   両方に 時刻が 無い（＝どちらも 古い版の端末）ときだけ、
   これまで通りの 安全側（進んだ方・ついている方）に たおす。
   これで、更新していない 端末を 新しい版に 入れかえるまでの あいだも
   いまと同じ 動きの まま つかえる */
function pickStamped(aVal, aAt, bVal, bAt, fallback){
  const x = ms(aAt), y = ms(bAt);
  if(!x && !y) return { value: fallback, at: 0 };
  if(x === y)  return { value: fallback, at: x };
  return x > y ? { value: aVal, at: x } : { value: bVal, at: y };
}

function mergeProgress(lp, rp, localIsNewer){
  const out = {};
  const ids = new Set([...Object.keys(lp || {}), ...Object.keys(rp || {})]);

  ids.forEach(id=>{
    const a = (lp && lp[id]) || {};
    const b = (rp && rp[id]) || {};
    /* 知らない欄（あとで 足したもの）は 新しい方を のこす */
    const p = Object.assign({}, localIsNewer ? b : a, localIsNewer ? a : b);

    /* かず（なつスキルの ⑦、本の さつ数） */
    if('done' in a || 'done' in b){
      const r = pickStamped(a.done|0, a.doneAt, b.done|0, b.doneAt,
                            Math.max(a.done|0, b.done|0));
      p.done = r.value;
      if(r.at) p.doneAt = r.at; else delete p.doneAt;
    }

    /* まいにちノルマ … 日ごとに 独立しているので 日づけごとに くらべる */
    if(a.days || b.days){
      const days = {}, daysAt = {};
      const keys = new Set([...Object.keys(a.days || {}), ...Object.keys(b.days || {})]);
      keys.forEach(k=>{
        const av = (a.days || {})[k] | 0, bv = (b.days || {})[k] | 0;
        const r = pickStamped(av, (a.daysAt || {})[k], bv, (b.daysAt || {})[k],
                              Math.max(av, bv));
        days[k] = r.value;
        if(r.at) daysAt[k] = r.at;
      });
      p.days = days;
      if(Object.keys(daysAt).length) p.daysAt = daysAt; else delete p.daysAt;
    }

    /* だんかい式の チェック … ますごとに くらべる。
       ちがう ますを それぞれの端末で さわっても、どちらも 消えない */
    [['steps','stepsAt'], ['wrap','wrapAt']].forEach(([key, atKey])=>{
      if(!Array.isArray(a[key]) && !Array.isArray(b[key])) return;
      const x = a[key] || [], y = b[key] || [];
      const xa = a[atKey] || [], ya = b[atKey] || [];
      const len = Math.max(x.length, y.length);
      const val = [], at = [];
      for(let i=0; i<len; i++){
        const r = pickStamped(!!x[i], xa[i], !!y[i], ya[i], !!x[i] || !!y[i]);
        val.push(r.value); at.push(ms(r.at));
      }
      p[key] = val;
      if(at.some(Boolean)) p[atKey] = at; else delete p[atKey];
    });

    out[id] = p;
  });

  return out;
}

/* 中身が 同じかどうかを くらべる。
   JSON.stringify を そのまま くらべると、欄の 名前の 並び順が ちがうだけで
   「変わった」と 見なしてしまう。合わせるたびに 欄を 作り直している ので、
   並び順は かんたんに 入れかわる。
   そうなると「変わった → 相手に 送る → 相手も 変わったと 思って 送り返す」が
   いつまでも 止まらず、画面が 描き直され つづける。
   名前を そろえてから くらべる */
function canon(v){
  if(Array.isArray(v)) return v.map(canon);
  if(v && typeof v === 'object'){
    const o = {};
    Object.keys(v).sort().forEach(k=>{ o[k] = canon(v[k]); });
    return o;
  }
  return v;
}
function sameState(a, b){
  return JSON.stringify(canon(a)) === JSON.stringify(canon(b));
}

function mergeState(local, remote, localIsNewer){
  /* 全削除は配列を空にするだけだと、相手が持つ古い配列との合流で復活する。
     resetAt が新しい側だけを同じ世代のデータとして採用し、その世代番号を
     全端末へ返す。全端末が受け取ったあとの新しい記録は同じ世代で合流する。 */
  const resetAt = Math.max(ms(local.resetAt), ms(remote.resetAt));
  const left  = ms(local.resetAt)  === resetAt ? local  : emptyState();
  const right = ms(remote.resetAt) === resetAt ? remote : emptyState();
  const out = normalizeState(deepCopy(localIsNewer ? left : right));
  out.resetAt = resetAt;
  out.logs  = mergeById(left.logs,  right.logs,  (a,b)=> String(a.at||'') >= String(b.at||''));
  out.books = mergeById(left.books, right.books, ()=> localIsNewer);

  /* 消したものの ひかえ。これが 墓標に なるので、合併したあとに
     消された ものを 取りのぞく。これが 無いと、相手の端末が まだ 持っている
     本の記録が そのまま よみがえる */
  out.trash = mergeById(left.trash, right.trash, (a,b)=> ms(a.at) >= ms(b.at))
    .sort((x,y)=> ms(y.at) - ms(x.at))
    .slice(0, TRASH_MAX);
  /* 印だけの ひかえ。1行けしなど、中身を のこさない 消しかたの 墓標 */
  /* メッセージは id で 合流。両方の 親が 同時に 送っても どちらも のこる。
     3件を こえたら 新しい ものから 3件（どの端末でも 同じ 結果に なる） */
  out.messages = mergeById(left.messages, right.messages, (a,b)=> String(a.at||'') >= String(b.at||''))
    .sort((x,y)=> String(x.at||'').localeCompare(String(y.at||'')))
    .slice(-MESSAGES_MAX);

  out.reads = mergeById(left.reads, right.reads, (a,b)=> String(a.at||'') >= String(b.at||''))
    .sort((x,y)=> String(x.at||'').localeCompare(String(y.at||'')))
    .slice(-READS_MAX);

  out.gone = mergeById(left.gone, right.gone, (a,b)=> ms(a.at) >= ms(b.at))
    .sort((x,y)=> ms(y.at) - ms(x.at))
    .slice(0, GONE_MAX);

  const gone = new Set([...out.trash.map(x=> x.id), ...out.gone.map(x=> x.id)]);
  if(gone.size){
    out.books = out.books.filter(b=> !gone.has(b.id));
    out.logs  = out.logs.filter(l=> !gone.has(l.id));
  }

  out.progress = mergeProgress(left.progress || {}, right.progress || {}, localIsNewer);
  /* 並びは どの端末でも 同じに なるように そろえる。
     同じ時刻の 記録が あると 並びが 端末ごとに ちがい、
     それだけで「変わった」と 判定されて 送り合いが 止まらなくなる */
  const byIdThen = key => (a,b)=>
    String(a[key]||'').localeCompare(String(b[key]||'')) ||
    String(a.id||'').localeCompare(String(b.id||''));
  out.logs.sort(byIdThen('at'));
  out.books.sort(byIdThen('date'));
  out.trash.sort((a,b)=> ms(b.at)-ms(a.at) || String(a.id||'').localeCompare(String(b.id||'')));
  out.gone.sort((a,b)=> ms(b.at)-ms(a.at) || String(a.id||'').localeCompare(String(b.id||'')));
  if(out.logs.length > 3000) out.logs = out.logs.slice(-3000);
  /* ミニコンテンツは 基本1日3回。端末ごとに かぞえる（下の stripLocal を 見てください）*/
  if(left.fun) out.fun = left.fun; else delete out.fun;
  return out;
}

function resetState(when){
  const out = emptyState();
  out.resetAt = ms(when) || Date.now();
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
/* 受信したデータには、送信側が保存した時刻を残す。
   受信した「今」を入れると、通信の遅れであとから届く新しい設定まで
   古いものと誤判定し、毎日の項目などが古い設定で見え続けてしまう。 */
function markReceivedAt(kind, at){
  const stamp = ms(at);
  if(!stamp) return;
  const a = savedAt(); a[kind] = stamp;
  try{ localStorage.setItem(K_AT, JSON.stringify(a)); }catch(e){}
}

/* sync.js から 呼ばれる入口。相手の端末の中身が とどいたとき */
function applyRemote(remote){
  const at = savedAt();
  let changed = false;

  /* config（設定）は 中身を 混ぜても 意味が 通らないので、
     あとに 保存された方を まるごと 採る。

     時刻は かならず ms() を 通す。旧版が `時刻 | 0` で 保存した 負の値が
     そのまま 入っていると、`負の数 > 0` が 成り立たず グループの 設定が
     いつまでも 採られない（QR で 入った 端末だけ デザインが 初期値の まま
     という 形で 出た）。

     つないでから 最初の 1回は、時刻を くらべずに グループの 設定を 採る。
     まだ 一度も 受け取っていない 端末には、手元の 設定が グループより
     新しいと 言える 根拠が ない。よそで つけた 時刻・壊れた 時刻・
     同じ あいことばに 入り直した ときの 古い 時刻印が のこっていても、
     ここで かならず グループ側に そろう。 */
  const remoteConfigAt = ms(remote.configAt);
  const localConfigAt  = ms(at.config);
  const remoteThemeMissing = !!(remote.config && !THEME_IDS.includes(remote.config.theme));
  if(remote.config && (remote.first || remoteConfigAt > localConfigAt)){
    const beforeConfig = config;
    config = normalizeConfig(remote.config);
    applyTheme(config.theme);
    localStorage.setItem(K_CFG, JSON.stringify(config));
    markReceivedAt('config', remoteConfigAt);
    traceConfig(beforeConfig, config, localConfigAt, remoteConfigAt, remote.first);
    /* グループ側の 時刻が 壊れている（0 に なる）ときは、採ったあと
       正しい 時刻で 送り返して グループの 時刻印を 直す。中身は 同じなので
       ほかの端末の 表示は 変わらず、次からは ふつうの 比較に 戻る */
    if(!remoteConfigAt){ markSaved('config'); syncPush('config'); }
    /* デザイン共有前から使っているグループでは remote.config に theme が無い。
       既存端末は自分が実際に使ってきた色をグループ設定へ移行する。一方、招待URLで
       入ったばかりの端末は初期色しか知らないため、移行元にしてはいけない。 */
    else if(remoteThemeMissing && !joinCodeFromURL()){
      markSaved('config');
      syncPush('config');
    }
    changed = true;
  }

  if(remote.state){
    const before = deepCopy(state.progress || {});
    const localState = normalizeState(state);
    const remoteState = normalizeState(remote.state);
    const merged = mergeState(localState,
                              remoteState,
                              ms(at.state) >= ms(remote.stateAt));
    /* 手元がすでに正しくても、相手が古ければ合流結果を返す必要がある。
       特に同期の準備前に削除した場合、gone/resetAt は手元にだけあり、
       ここで返さないと次の保存までほかの端末へ届かない。fun は端末専用なので比較しない。 */
    const remoteNeedsUpdate = !sameState(stripLocal(merged), stripLocal(remoteState));
    if(!sameState(merged, state)){
      /* どちらの端末の どの値が 勝ったのかを のこす。調べもの用 */
      traceProgress(before, merged.progress, (remote.state || {}).progress, remote.stateAt);
      state = merged;
      localStorage.setItem(K_ST, JSON.stringify(state));
      markSaved('state');
      changed = true;
    }
    /* 合わせた結果は相手にも返す。3台めがあっても同じ状態へ収束する。 */
    if(remoteNeedsUpdate) syncPush('state');
  }

  /* **グループの 設定を まだ 受け取れていない うちは、ここから 先へ 進まない。**

     この先は、初期設定で 選んだ 名前・漢字・デザインを 手元の config に
     入れて saveCfg() する。saveCfg() は グループぜんたいへ 送る。
     つまり remote.config が 無い ときに ここを 通ると、**参加した ばかりの
     端末の 初期値（既定の宿題・まいにち なし・初期デザイン）が
     グループの 設定として 配られる**。

     グループを 作った 直後に QR を 読むと、作った側の 最初の 送信が まだ
     届いておらず、文書は あるのに config が 無い snapshot が 1回 来る。
     ここが「参加すると まいにちの 項目が 消える」「デザインが 移らない」の
     正体。あとで ホーム画面から 開き直すと 直る ことが あったのは、
     その ときには config が そろっていて first で 採れていたため。

     取っておいた 初期設定は 消さずに 残す。次の snapshot で グループの
     設定を 受け取れた ときに、あらためて 反映する。 */
  if(!remote.config){
    if(changed) render({ keepScroll:true });
    return;
  }

  /* 初期設定で子どもが選んだデザインは、グループの設定を受け取ってから反映する。
     受信前に送ると、端末内の初期設定一式でグループの設定を上書きしてしまうため、
     デザイン1項目だけをここで確定し、すぐ通常の保存手順へ戻す。 */
  let welcomeChanged = false;
  let welcomeTheme = null;
  try{ welcomeTheme = JSON.parse(getLocal(K_WELCOME_THEME) || 'null'); }catch(e){}
  /* 一時デザインは、確認済みの同じ合言葉へ手動参加したときだけ使う。
     旧版の文字列だけの値や、別のグループ・招待URLから入ったときの残りは捨てる。 */
  try{ localStorage.removeItem(K_WELCOME_THEME); }catch(e){}
  const syncApi = typeof window !== 'undefined' ? window.NatsuSync : null;
  const activeCode = syncApi && typeof syncApi.getCode === 'function' ? syncApi.getCode() : '';
  if(welcomeTheme && welcomeTheme.code === activeCode && THEME_IDS.includes(welcomeTheme.theme)){
    if(config.theme !== welcomeTheme.theme){
      config.theme = welcomeTheme.theme;
      welcomeChanged = true;
    }
  }

  let joinPrefs = null;
  try{ joinPrefs = JSON.parse(getLocal(K_WELCOME_JOIN) || 'null'); }catch(e){}
  if(joinPrefs && typeof joinPrefs === 'object'){
    try{ localStorage.removeItem(K_WELCOME_JOIN); }catch(e){}
    if(joinPrefs.hasName){
      const oldName = config.childName;
      const nextName = String(joinPrefs.childName || '').trim().slice(0, 30);
      const titleWasGenerated = isGeneratedTitle(config.title, oldName);
      if(nextName !== String(oldName || '')){
        config.childName = nextName;
        if(titleWasGenerated) config.title = defaultTitleFor(nextName);
        welcomeChanged = true;
      }
    }
    if(joinPrefs.hasGrade && [0,1,2,9].includes(Number(joinPrefs.readingGrade))
       && Number(config.readingGrade) !== Number(joinPrefs.readingGrade)){
      config.readingGrade = Number(joinPrefs.readingGrade);
      welcomeChanged = true;
    }
  }
  if(welcomeChanged){ saveCfg(); changed = true; }

  if(changed) render({ keepScroll:true });
}

window.NatsuApp = {
  current: () => ({ config, state: stripLocal(state) }),
  onRemote: applyRemote,
  /* 墓標を受け取ったときは、端末に残った古い内容を消す。これを残すと
     新しい合言葉を作ったときに、削除済みの記録を別グループへ送ってしまう。 */
  onHouseholdRetired(){
    config = freshConfig();
    state = emptyState();
    try{
      [K_CFG, K_ST, K_ONBOARD, K_ROLE, K_NAME, K_READING, K_THEME,
       K_WELCOME_THEME, K_WELCOME_JOIN, K_CFG_HOUSE, K_AT].forEach(k=>localStorage.removeItem(k));
    }catch(e){}
    rememberChosenCode('none');
    setLocal(K_RETIRED_NOTICE, '1');
    if(location.hash !== '#welcome') location.hash = 'welcome';
    else { tab = 'welcome'; render(); }
  },
  /* sync.js が グループの文書を 新しく 作る ときだけ 呼ばれる。
     これは「この端末の 設定が グループの 中身に なる」瞬間なので、
     意図せず 起きたときに 気づけるよう 記録に のこす。
     文書IDは 合言葉そのものでは ない（SHA-256）が、念のため 頭だけ */
  onHouseholdCreate(houseId){
    const census = taskCensus(config);
    traceAdd([{ at:Date.now(), id:'グループを新しく作った', f:'tasks（数）',
                meId:getLocal(K_DEVICE_ID), youId:'',
                mine:census['tasks（数）'], mineAt:0,
                theirs:'（グループの文書なし）', theirsAt:0,
                won:census['tasks（数）'] + '／まいにち ' + census['まいにち（数）'],
                remoteAt:0 }]);
  },
  /* 端末の 見わけに つかう ぶんだけ。呼び名を 付けていない ときは
     「iPhone」「iPad」ほどの 大きな くくりを 既定に する。
     機種名や 個体を 特定できる 値は 送らない */
  deviceInfo: () => ({
    role:  getLocal(K_ROLE),
    name:  String(config.childName || getLocal(K_NAME) || '').trim(),
    label: (String(getLocal(K_DEVICE_LABEL) || '').trim()
            || deviceKindLabel(navigator.userAgent, navigator.maxTouchPoints)).slice(0, 12),
    ver:   APP_VER
  })
};

/* ---------------------------------------------------------
   こまごました どうぐ
   --------------------------------------------------------- */
const $  = (s, r) => (r||document).querySelector(s);
const $$ = (s, r) => Array.from((r||document).querySelectorAll(s));
/* 設定は「宿題を決める」と「アプリの設定」の 2ページに 分かれている。
   片方に しか 無い 欄を $('#x').addEventListener で 直に つなぐと、
   もう片方の ページでは null になって **そこから 下の 束ねが すべて 止まる**。
   実際、宿題ページを 分けた ときに #cfgShowDaily が 設定ページから 消え、
   削除ボタンが 効かず、保存されないまま 既定の宿題が 戻る事故が 起きた。
   無い ものは だまって とばす */
function on(sel, ev, fn, root){
  const el = $(sel, root);
  if(el) el.addEventListener(ev, fn);
  return el;
}

function esc(s){
  return String(s == null ? '' : s)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}
function clamp(n,a,b){ return Math.max(a, Math.min(b, n)); }
function dailyCountSelection(selected, raw){
  const text = String(raw == null ? '' : raw).trim();
  const more = /^\d+$/.test(text) ? Number(text) : 0;
  return more >= 6 ? clamp(more, 6, 99) : clamp(selected|0, 0, 99);
}
function dailyMorePrompt(task){
  const unit = unitAdult((task && task.targetUnit) || 'かい');
  return unit === '回'
    ? '6回以上のときは、何回できたか 入れてね。'
    : '6' + unit + '以上のときは、いくつできたか 入れてね。';
}
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
const WD_READING = { 日:'にち', 月:'げつ', 火:'か', 水:'すい', 木:'もく', 金:'きん', 土:'ど' };
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

/* 「1日 れんぞく」は 言い方が おかしいので、1日のうちは 「れんぞく」を つかわない。
   streakOf は きょうが まだでも きのうまでを 数えるため、1日には
   「きょう やった1日目」と「きのう やって きょうは まだ」の 2つが ある。
   p.isDone（きょうの ぶんが すんだか）で 見わける。
   きょう やった1日目は、できた ことが 数や ハートで もう 見えているので
   何も 出さない。ここは あくまで れんぞくの ための そえ書き。 */
function streakLabel(p){
  if(!(p.streak > 0)) return '';
  if(p.streak >= 2) return p.streak + '日 れんぞく';
  return p.isDone ? '' : 'きのう できたね';
}
function streakLabelKanji(p){
  if(!(p.streak > 0)) return '連続なし';
  if(p.streak >= 2) return p.streak + '日連続';
  return p.isDone ? '' : '昨日できた';
}

function bookCountUnit(adult, grade){
  const g = grade == null ? readingGrade() : Number(grade);
  return adult || g === 9 ? '冊' : 'さつ';
}
function bookOrdinal(n, adult, grade){
  return String(n) + bookCountUnit(adult, grade) + '目';
}

function nextLabel(task, adult){
  const p = prog(task);
  if(p.isDone) return null;
  // 番号（段階）が ぜんぶ おわったら、さいごの2段階を 出す
  if(hasWrap(task) && p.numDone){
    const i = p.wrap.findIndex(v => !v);
    return { lead:'つぎは', num:'', tail: WRAP_LABELS[i] };
  }
  if(task.type === 'count'){
    const n = p.done + 1;
    if(isBook(task)) return { lead:'つぎは', num:String(n), tail:bookCountUnit(adult)+'目' };
    return countUsesCircle(task)
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

/* 本とプリントは、①②より「1冊目」「1枚目」のほうが
   何を数えているか分かる。古い設定の numbered は残したまま、表示だけ整える。 */
function isSheetCount(task){
  return task && ['まい','枚'].includes(String(task.unit || '').trim());
}
function countUsesCircle(task){
  return !!(task && task.numbered) && !isBook(task) && !isSheetCount(task);
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
  const hasSync = DEBUG_WELCOME || (!TEST_MODE && !!(S && S.configured()));
  const installed = isStandalone();
  const previewRole = DEBUG_WELCOME_ROLE === 'welcome-parent' ? 'parent' : 'child';
  return `
  <section class="welcome" aria-labelledby="welcomeTitle">
    <p class="welcome-kicker">${TEST_MODE ? 'おためし モード' : 'はじめの じゅんび'}</p>
    <h2 id="welcomeTitle">しゅくだいノート</h2>
    ${getLocal(K_RETIRED_NOTICE) ? `<div class="welcome-retired" role="status"><b>共有データを削除しています</b><p>この共有データは削除処理中のため、もう使えません。新しい合言葉で始めてください。</p></div>` : ''}
    <div class="paper welcome-step">
      <span class="welcome-num">1</span>
      <div><h3>ホーム画面に 追加しよう</h3>
      <p>${installed ? 'この端末はホーム画面から開いています。' : 'iPad / iPhone では、Safari の共有ボタン →「ホーム画面に追加」を押すと、いつも同じ場所から開けます。'}</p>
      <p class="set-note">あとでホーム画面に追加したときも、あいことばを読み込めば、同じグループの複数の端末で同じ記録と設定を使えます。</p></div>
    </div>
    <div class="paper welcome-step">
      <span class="welcome-num">2</span>
      <div><h3>どうやって つかう？</h3>
      <div class="welcome-roles">
        <button class="btn welcome-role" data-welcome-mode="solo" type="button" aria-pressed="false"><span class="welcome-role-copy"><b>こどもだけでつかう</b><small>すぐにつかえます</small></span></button>
        <button class="btn welcome-role welcome-role--share${DEBUG_WELCOME ? ' is-selected' : ''}" data-welcome-mode="share" type="button" aria-pressed="${DEBUG_WELCOME ? 'true' : 'false'}">${icon('users')}<span class="welcome-role-copy"><b>保護者も共有する</b><small>あとからでも設定できます</small></span></button>
      </div>
      ${TEST_MODE ? '<p class="set-note">おためしモードでは、いま使っているグループのデータ・あいことば・集計には触れません。</p>' : (hasSync ? '' : '<p class="set-note">同期の準備が未設定のため、この端末だけで使います。あとから設定画面で同期を有効にできます。</p>')}</div>
    </div>
    <div class="welcome-form" id="welcomeForm"${DEBUG_WELCOME ? '' : ' hidden'}>${DEBUG_WELCOME
      ? (previewRole === 'parent' ? welcomeParentSharePickerHTML(3) : welcomeFormHTML('child', true, 3)) : ''}</div>
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
/* ---------------------------------------------------------
   こどもへの メッセージ（さいだい3人ぶん）

   config ではなく state に 置く。config は「あとに保存した方で
   まるごと 置きかえる」ので、2台の親が 同時に 送ると 片方が 消える。
   記録と 同じく id で 合流させれば、どちらも のこる。

   消したときは gone（印だけの ひかえ）に 入れる。
   これが 無いと 相手の端末から また 出てくる。
   --------------------------------------------------------- */
const MESSAGES_MAX = 3;
function messages(){
  const gone = new Set((state.gone || []).map(g=> g.id));
  return (state.messages || [])
    .filter(m => m && m.id && m.text && !gone.has(m.id))
    .sort((a,b)=> String(a.at||'').localeCompare(String(b.at||'')))
    .slice(-MESSAGES_MAX);
}
function messageHeading(m){
  if(!m) return '';
  if(m.sender === '名前表示なし') return 'おうちの人より';
  const sender = m.sender === 'その他' ? (m.customSender || 'おうちの人') : parentSenderLabel(m.sender);
  return `${sender}より`;
}
/* 旧しきの 1件だけの メッセージを、新しい ならびへ 移す。
   1度だけ 動けばよいので、移したことを config に のこす */
/* 移すものが ある ときだけ 書きこむ。

   起動のたびに saveCfg() を 呼んでは いけない。開いたばかりの端末は
   まだ おうちの 設定を 受け取って おらず、手元は 初期値のまま。
   それを 新しい 時刻で 送ると、設定は「あとに保存した方が勝つ」ので、
   全部の端末の デザインなどが 初期値に 戻ってしまう（実際に 起きた）。 */
function migrateMessages(){
  const old = config.parentMessage;
  if(!old || !old.enabled || !old.text) return;   // 移すものが ない
  if(config.parentMessageMoved) return;
  if(!Array.isArray(state.messages)) state.messages = [];
  if(state.messages.length){ config.parentMessageMoved = true; return; }
  state.messages.push({
    id: 'm-legacy-' + Date.now(),
    sender: old.sender, customSender: old.customSender,
    text: old.text, at: new Date().toISOString(), by: logBy()
  });
  saveSt();
  config.parentMessageMoved = true;
  saveCfg();
}

function parentMessageHeading(msg){
  if(msg.sender === '名前表示なし') return 'おうちの人より';
  const sender = msg.sender === 'その他' ? (msg.customSender || 'おうちの人') : parentSenderLabel(msg.sender);
  return `${sender}より`;
}
function bindParentSender(selectId, customWrapId){
  const select = $('#'+selectId), wrap = $('#'+customWrapId);
  if(!select || !wrap) return;
  const update = ()=>{ wrap.hidden = select.value !== 'その他'; };
  select.addEventListener('change', update);
  update();
}

function welcomeStepHTML(number, title, body, className){
  return `<div class="paper welcome-step welcome-flow-step${className ? ' ' + className : ''}">
    <span class="welcome-num">${number}</span>
    <div><h3>${title}</h3>${body}</div>
  </div>`;
}

function welcomeRolePickerHTML(){
  return welcomeStepHTML(3, 'この端末は だれが つかう？', `
      <div class="welcome-roles">
        <button class="btn welcome-role" data-welcome-role="parent" type="button" aria-pressed="false">おうちの人の端末<br><small>合言葉を作る・入力する</small></button>
        <button class="btn welcome-role" data-welcome-role="child" type="button" aria-pressed="false">こどもの端末<br><small>合言葉を 入れる</small></button>
      </div>
      <p class="set-note">同じ合言葉を入れると、同じグループの複数の端末で使えます。</p>`)
    + '<div id="welcomeRoleForm"></div>';
}

function welcomeParentSharePickerHTML(step){
  return welcomeStepHTML(step, '合言葉は ありますか？', `
    <div class="welcome-roles welcome-parent-share-choices">
      <button class="btn welcome-role" data-parent-share="create" type="button" aria-pressed="false">
        <span class="welcome-role-copy"><b>まだない</b><small>新しく合言葉を作る</small></span></button>
      <button class="btn welcome-role" data-parent-share="join" type="button" aria-pressed="false">
        <span class="welcome-role-copy"><b>すでにある</b><small>今あるグループに参加する</small></span></button>
    </div>
    <p class="set-note">最初の保護者は「まだない」を、ほかの保護者が作った共有へ参加するときは「すでにある」を選びます。</p>`)
    + '<div id="welcomeParentShareForm"></div>';
}

/* 名前と 漢字の 設定は グループぜんたいの 設定なので、保護者端末・子ども端末の
   どちらで 入れても 同じ ところに 入る。先に もう一方で 入れて あるなら
   もう一度 入れる 必要は ない。入れなかった ときは、つないだ あとに
   グループの 設定が とどいて そちらが つかわれる。 */
function alreadySetNoteHTML(side){
  return side === 'child'
    ? `<p class="set-note" id="welcomeExistingNote">あいことばを かくにんすると、おうちで きめた なまえと よめる かんじが ここに はいるよ。</p>`
    : `<p class="set-note" id="welcomeExistingNote">合言葉を確認すると、共有中のお子さんの名前と漢字設定を表示します。</p>`;
}

function welcomeJoinCheckHTML(side){
  const child = side === 'child';
  return `<div class="set-actions welcome-join-check">
      <button class="btn btn-sm" id="welcomeJoinCheck" type="button">${child ? 'あいことばを かくにん' : '合言葉を確認する'}</button>
      <span class="set-note" id="welcomeJoinStatus" role="status" aria-live="polite"></span>
    </div>`;
}

/* 共有する ときだけ 出す、この端末の 呼び名。
   入れなくても 進める。端末の一覧で「父」「母」と見分けるための名前。 */
function deviceLabelFieldHTML(role){
  const child = role === 'child';
  return `<label class="lab">この端末の呼び名（任意）
      <input id="welcomeDeviceLabel" type="text" maxlength="12"
             value="${esc(getLocal(K_DEVICE_LABEL))}" placeholder="${child ? '例：子ども用iPad' : '例：父、母'}"></label>
    <p class="set-note">共有中の端末一覧で見分けるための呼び名です（${child ? '子ども用iPadなど' : '父、母など'}）。
    入れないときは「${esc(deviceKindLabel(navigator.userAgent, navigator.maxTouchPoints))}」のように端末の種類で表示されます。
    </p>`;
}

/* 初期設定の中で、設定ページへ移動する前に共有方法まで確認できるようにする。
   保護者側はここで作った合言葉をQRとリンクにし、子ども側は受け取った
   合言葉を使う順番を明示する。 */
function welcomeShareSetupHTML(role, code){
  if(role === 'child') return `
    <div class="welcome-share-setup" id="welcomeShareSetup" aria-label="共有をはじめる手順">
      <ol>
        <li>保護者から受け取った合言葉を、上の欄に入力します。</li>
        <li>下のボタンを押すと、同じグループの宿題・設定・記録を読み込みます。</li>
      </ol>
      <p class="set-note">保護者からQRコードや招待リンクを受け取った場合は、それを開くと合言葉を入力せずに接続できます。</p>
    </div>`;
  const url = inviteURLForCode(code);
  return `
    <div class="welcome-share-setup" id="welcomeShareSetup" aria-label="ほかの端末をつなぐ手順">
      <ol>
        <li>まだ使い始めていない子ども端末では、下のQRコードを読み取ります。</li>
        <li>すでに使っている子ども端末では、画面のタイトルを5回タップして保護者ページを開き、共有設定で合言葉を入力します。</li>
        <li>離れた端末には、招待リンクを家族だけに送ります。</li>
      </ol>
      ${url ? `<div class="welcome-invite">
        <label class="lab" for="welcomeInviteUrl">ほかの端末へ渡す招待リンク
          <input type="text" id="welcomeInviteUrl" value="${esc(url)}" readonly onfocus="this.select()"></label>
        <button class="btn btn-sm" id="welcomeInviteCopy" type="button">リンクをコピー</button>
        ${inviteQrHTML(url)}
      </div>` : '<p class="set-note">合言葉を8文字以上にすると、QRコードと招待リンクを表示できます。</p>'}
      <p class="set-note"><b>QRと招待リンクは合言葉そのものです。</b>信頼できる家族だけに渡してください。</p>
    </div>`;
}

function welcomeParentConnectionPlanHTML(mode, code, nextStep){
  if(mode === 'now') return `
    <div class="welcome-connect-plan" id="welcomeConnectPlan">
      ${welcomeShareSetupHTML('parent', code)}
      <button class="btn btn-go btn-wide" id="welcomeStart" data-role="parent" data-sharing="yes"
        data-creating="yes" data-next-step="${Number(nextStep) || 8}" type="button">保護者ページを開く</button>
    </div>`;
  return `
    <div class="welcome-connect-plan" id="welcomeConnectPlan">
      <p class="set-note welcome-recommend"><b>できれば、先に子ども端末も接続しておくことをおすすめします。</b></p>
      <p class="set-note">あとから共有するときは、子ども画面のタイトルを5回タップして保護者ページを開き、冒頭の「共有なし：共有の設定はこちら」から合言葉を作成・入力できます。</p>
      <button class="btn btn-go btn-wide" id="welcomeStart" data-role="parent" data-sharing="yes"
        data-creating="yes" data-next-step="${Number(nextStep) || 8}" type="button">先に保護者ページを開く</button>
    </div>`;
}

function welcomeParentCreateChoiceHTML(step, code){
  return welcomeStepHTML(step, '子ども端末を いつつなぐ？', `
    <div class="welcome-roles welcome-connect-choices">
      <button class="btn welcome-role" data-child-connect="now" type="button" aria-pressed="false">
        <span class="welcome-role-copy"><b>今つなぐ</b><small>QRと手順を表示する</small></span></button>
      <button class="btn welcome-role" data-child-connect="later" type="button" aria-pressed="false">
        <span class="welcome-role-copy"><b>あとでつなぐ</b><small>先に保護者設定へ進む</small></span></button>
    </div>
    <div id="welcomeConnectChoiceForm"></div>`, 'welcome-connect-step');
}

function welcomeThemeHTML(step){
  const current = THEME_IDS.includes(welcomeThemeChoice) ? welcomeThemeChoice
    : (THEME_IDS.includes(config.theme) ? config.theme : 'notebook');
  return welcomeStepHTML(step, 'どの色が すき？', `
    <p>すきな色を えらんでね。画面が その色に かわります。</p>
    <fieldset class="theme-picker welcome-theme-picker">
      <legend>色と デザイン</legend>
      <div class="theme-grid">${themeChoicesHTML('welcomeTheme', current)}</div>
    </fieldset>`);
}

function welcomeFormHTML(role, sharing, firstStep, parentShareMode){
  const S = window.NatsuSync;
  const syncReady = !!sharing && (DEBUG_WELCOME || (!TEST_MODE && !!(S && S.configured())));
  const name = getLocal(K_NAME);
  const creating = role === 'parent' && parentShareMode !== 'join';
  const code = role === 'parent' && syncReady && creating ? (DEBUG_WELCOME ? 'おためし共有コード' : S.makeCode()) : '';
  const start = Number(firstStep) || (sharing ? 4 : 3);
  if(role === 'parent'){
    const settingsBody = `
      ${creating ? '' : alreadySetNoteHTML('parent')}
      <label class="lab">子どもの名前（任意）
        <input id="welcomeName" type="text" value="${esc(name)}" autocomplete="name" placeholder="入力しなくてもかまいません"></label>
      <label class="lab">漢字は何年生の字まで読めますか？
        <select id="welcomeReading">${readingOptions(readingGrade())}</select></label>
      ${deviceLabelFieldHTML('parent')}`;
    if(!syncReady) return welcomeStepHTML(start, '共有の準備',
      '<p class="set-note">同期の準備を読み込めませんでした。通信を確認して、もう一度開いてください。</p>');
    if(!creating){
      const join = welcomeStepHTML(start, '今あるグループに参加', `
        <label class="lab">共有中の合言葉
          <input id="welcomeCode" type="text" autocapitalize="off" autocorrect="off" spellcheck="false" placeholder="合言葉を入力"></label>
        <p class="set-note">合言葉を作った保護者から受け取り、同じグループの宿題・設定・記録を読み込みます。</p>
        ${welcomeJoinCheckHTML('parent')}
        ${inAppBrowserNoteHTML()}`);
      const settings = `<div id="welcomeJoinSettings" hidden>${welcomeStepHTML(start + 1, '保護者の設定', `${settingsBody}
        <button class="btn btn-go btn-wide" id="welcomeStart" data-role="parent" data-sharing="yes"
          data-creating="no" data-next-step="${start + 2}" type="button" hidden>このグループに参加する</button>`)}</div>`;
      return join + settings;
    }
    /* 合言葉は 自動作成の まま つかって もらうのが 安全。
       手で 決めると 短く・覚えやすい＝当てられやすい ものに なりがちで、
       ふだんの パスワードを 使いまわす 人も 出る。
       そこで 既定は 読み取り専用に して、どうしても 自分で 決めたい人だけ
       ボタンを 押して 手入力に 切りかえる（ひと手間 かける）。 */
    const create = welcomeStepHTML(start, '合言葉を作ろう', `
      <label class="lab">このグループの合言葉（16文字・おまかせで作成）
        <input id="welcomeCode" type="text" value="${esc(code)}" readonly autocapitalize="off" autocorrect="off" spellcheck="false"></label>
      <p class="set-note">この合言葉で、新しいグループの共有を始めます。覚える必要はありません。QRコードか招待リンクで、ほかの端末へ渡します。</p>
      <div class="set-actions welcome-code-actions">
        <button class="btn btn-sm btn-ghost" id="welcomeCodeCustom" type="button">自分で決めた合言葉を使う</button>
        ${/* 手入力に した あと、戻り道が 無かった。自分で 考えて みて
              「やっぱり おまかせで いい」と 思った 人が、初期設定を
              やり直す しか なくなる */''}
        <button class="btn btn-sm btn-ghost" id="welcomeCodeAuto" type="button" hidden>おまかせに戻す</button>
      </div>
      <p class="set-note welcome-code-warn" id="welcomeCodeWarn" hidden>自分で決める場合は、8文字以上にしてください。ふだん使っているパスワードや、家族の名前・誕生日など推測できる言葉は使わないでください。</p>
      ${privacyNoteHTML()}
      ${inAppBrowserNoteHTML()}`);
    const settings = welcomeStepHTML(start + 1, '保護者の設定', settingsBody);
    return create + settings + welcomeParentCreateChoiceHTML(start + 2, code);
  }

  const theme = welcomeThemeHTML(start);
  const settings = welcomeStepHTML(start + 1, 'なまえを 入れよう', `
    ${sharing ? alreadySetNoteHTML('child') : ''}
    <label class="lab">なまえ（入れなくても いいよ）
      <input id="welcomeName" type="text" value="${esc(name)}" autocomplete="name" placeholder="入れなくても いいよ"></label>
    <label class="lab">よめる かんじを えらぼう
      <select id="welcomeReading">${readingOptions(readingGrade())}</select></label>`);
  if(!sharing){
    return theme + settings + welcomeStepHTML(start + 2, 'じゅんび できたよ', `
      <p>この端末だけで しゅくだいノートを はじめます。</p>
      <button class="btn btn-go btn-wide" id="welcomeStart" data-role="child" data-sharing="no" type="button" aria-label="こども画面を開く">はじめる</button>`);
  }
  const share = welcomeStepHTML(start + 2, 'おうちの きろくに つなごう', `
    ${syncReady ? `<label class="lab">おうちの人から もらった あいことば
      <input id="welcomeCode" type="text" autocapitalize="off" autocorrect="off" spellcheck="false" placeholder="あいことばを 入れる"></label>
      <p class="set-note">つながると、おうちの人が決めた宿題と記録を使えます。</p>
      ${welcomeJoinCheckHTML('child')}
      ${inAppBrowserNoteHTML()}
      ${deviceLabelFieldHTML('child')}
      ${welcomeShareSetupHTML('child', '')}`
      : '<p class="set-note">同期の準備を読み込めませんでした。通信を確認して、もう一度開いてください。</p>'}
    <button class="btn btn-go btn-wide" id="welcomeStart" data-role="child" data-sharing="yes" type="button" hidden aria-label="確認した合言葉でこのグループに参加する">このグループに参加する</button>`);
  return theme + settings + share;
}

/* 作者の表示。CC BY 4.0 は「利用する形に応じた合理的な方法」での
   クレジット表示を求めるので、複製・改変して公開した人にも
   そのまま残るよう、画面の中に置いておく。
   子ども画面には出さず、保護者ページと設定の最後に小さく出す。 */
/* 作品の 名前は「しゅくだいノート」。
   画面の 見出し（config.title）は 家ごとに 変えられるので、
   作品を さす 名前は こちらに 固定しておく。

   ライセンスの 名前を 画面に ならべても、つかう人には 意味が 通らない。
   「ライセンス」の 一語だけを リンクに して、中身は リンク先に まかせる。
   このリンクは 作者の 義務では ないが、丸ごと コピーした人が
   そのまま 条件を みたせるように のこしてある。 */
/* **この CREDIT を 自分の名前に 置きかえないこと。**
   ここは「作品の 出どころ」を 示す 表示で、CC BY 4.0 が 残すことを 求めている。
   改変して 公開する ときは、この表示を **残した うえで**、あなたの名義と
   「変更を 加えた」旨を 足すこと（置きかえは 表示義務を 満たさない）。
   詳しくは LICENSE-CONTENT.md を 見ること。 */
const CREDIT = {
  title: 'しゅくだいノート',
  author: 'moyashimisosoup',
  year: '2026',
  url: 'https://github.com/moyashimisosoup/shukudai-notebook'
};
function creditHTML(){
  return `
  <p class="credit">
    <span class="credit-part"><span class="credit-name">${esc(CREDIT.title)}</span> &copy; ${esc(CREDIT.year)} ${esc(CREDIT.author)}</span>
    <br><span class="credit-part"><a href="${CREDIT.url}" target="_blank" rel="noopener">ライセンス</a></span>
    <span class="credit-part">ver ${esc(APP_VER)}</span>
  </p>`;
}

function privacyNoteHTML(){
  return `<aside class="privacy-note">
    <span><b>注意事項</b><small>合言葉と共有データの取り扱い</small></span>
    <button class="btn btn-sm btn-ghost" type="button" data-share-safety>内容を確認</button>
  </aside>
  <p class="set-note retention-note">共有データは、どの端末からも更新が90日間ない場合、管理者の確認後に削除します。見るだけでは期間は延びません。端末だけで使うデータは対象外です。</p>`;
}
function shareSafetyText(){
  return [
    '共有する前にご確認ください',
    '',
    '・合言葉には、普段使っているパスワードや秘密の言葉を使わないでください。このアプリが自動で作る合言葉の利用をおすすめします。',
    '・QRコードや招待リンクを受け取った人は、グループの共有データに接続できます。信頼できる相手だけに渡してください。',
    '・名前・宿題・記録は、端末間で共有するためクラウドに保存されます。保存の前にこの端末で暗号化するため、保管しているサーバー側では中身を読めません。',
    '・鍵は合言葉から作られ、どこにも送られません。**合言葉をすべての端末で忘れると、クラウド上の記録は誰にも復元できません。** 大切な記録は「データ管理」から書き出して保管してください。',
    '・共有データは、どの端末からも更新が90日間ない場合、管理者の確認後に削除します。画面を開いて見るだけでは期間は延びません。端末だけで使うデータは対象外です。',
    '・住所、学校名、連絡先など、知られて困る情報は入力しないでください。'
  ].join('\n');
}
/* グループは 見つかったが、この端末では あけられない ときの 案内。
   参加の 確認と、つないだ あとの 両方で 同じ 言い方に そろえる。
   「合言葉を 確認してください」だけだと、正しい 合言葉を 持っている 人が
   何度も 入れ直す ことに なる（実際に そうなった） */
function unreadableJoinText(){
  return 'このグループは、暗号化に対応する前の方式で保存されています。'
    + '保護者の端末を最新に更新したうえで、合言葉を作り直してください。';
}
function confirmShareSafety(){
  return confirm(shareSafetyText() + '\n\n内容を確認して接続しますか？');
}

function welcomeMessageChoiceHTML(step){
  const msg = config.parentMessage;
  return welcomeStepHTML(Number(step) || 6, 'こどもへの メッセージ', `
    <p>保護者ページから、こどもの画面へ短いメッセージを出せます。</p>
    <label class="lab" for="welcomeMessageSender">だれからの メッセージ？
      <select id="welcomeMessageSender">${parentSenderOptions(msg.sender)}</select></label>
    <label class="lab sender-custom" id="welcomeMessageCustomWrap" for="welcomeMessageCustom" hidden>表示する名前
      <input id="welcomeMessageCustom" type="text" maxlength="20" value="${esc(msg.customSender)}" placeholder="例：おばあちゃん"></label>
    <div class="welcome-roles welcome-message-actions">
      <button class="btn btn-go welcome-role" data-message-choice="yes" type="button">使う</button>
      <button class="btn welcome-role" data-message-choice="no" type="button">今は 使わない</button>
    </div>
    <p class="set-note">あとから保護者ページで変更できます。</p>`);
}

/* ---------------------------------------------------------
   ビュー：登録グループ数（URL の隠し入口からだけ開く） */
function viewStats(){
  return `
  <section class="welcome" aria-labelledby="statsTitle">
    <p class="welcome-kicker">うんよう よう</p>
    <h2 id="statsTitle">登録グループ数</h2>
    <div class="paper welcome-form">
      <p class="set-note">初期設定を完了したグループを、名前や記録内容を見ずに数えています。</p>
      <p class="stats-count" id="statsCount">読みこんでいます…</p>
      <p class="set-note" id="statsNote">この画面は通常のメニューには表示されません。</p>
    </div>
  </section>`;
}

/* ---------------------------------------------------------
   ビュー：ホーム
   --------------------------------------------------------- */
/* 課題が 1つも 無いときの ホーム。
   「かならず やる」を 空のまま 出すと「ぜんぶ できた！」に なり、
   まだ 何も 登録していない のに 終わったように 見える。
   ペースの 計算も 分母が 無く 意味を なさないので、丸ごと 差しかえる。 */
function homeEmptyHTML(){
  return `
  <section class="sec">
    <div class="paper empty-home">
      <p class="empty-home-lead">まだ しゅくだいが ないよ。</p>
      <p class="empty-home-note" data-no-reading>宿題を登録してください。保護者ページの「宿題」から追加できます。</p>
      <a class="btn btn-go btn-wide" href="#tasks" data-no-reading>宿題を決めるページを開く</a>
    </div>
  </section>`;
}

/* 招待リンク・QR で 入った 端末は、初期設定を とばして つながる。
   そのため 役割（保護者／子ども）を 一度も 聞いていない。
   これまでは そのまま 子ども画面に 出ていたので、保護者が 自分の端末を
   つないだ ときも「ホーム画面に追加」の 案内が 子ども向けページの
   ものしか 出なかった。先に どちらの端末かを 聞き、それぞれの
   ページへ 送る（追加の案内は どちらの ページにも すでに ある）。 */
function joinRoleNeeded(){
  return sharingOn() && !getLocal(K_ROLE);
}
function joinRolePickHTML(){
  return `
  <section class="sec join-role" data-no-reading>
    <div class="paper join-role-body">
      <p class="join-install-for">おうちの共有につながりました</p>
      <h2 class="join-role-head">この端末は どちらですか？</h2>
      <p class="set-note">選ぶと、それぞれのページと「ホーム画面に追加」の手順を表示します。あとから「アプリの設定」→「ほかの端末と共有」で変更できます。</p>
      <div class="join-role-actions">
        <button class="btn btn-go btn-wide" data-join-role="parent" type="button">保護者の端末</button>
        <button class="btn btn-go btn-wide" data-join-role="child" type="button">子どもの端末</button>
      </div>
    </div>
  </section>`;
}

function viewHome(){
  if(DEBUG_CONTENT) return contentDebugHTML();
  if(joinRoleNeeded()) return joinRolePickHTML();
  if(!config.tasks.length) return homeEmptyHTML();
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

  ${joinInstallTransferHTML()}

  ${dailyAllDone ? '' : dailySec}
  ${sectionHTML('must','かならず やる', nokori>0 ? 'のこり '+nokori+'しゅるい' : 'ぜんぶ できた！', must)}
  ${opt.length   ? sectionHTML('opt','つぎに やる','かならず やるが すんだら、ここから えらぼう', opt) : ''}

  <section class="sec">
    <div class="sec-head"><h2>きょう やったこと</h2><span class="sec-note">${fmtDate(new Date())}</span></div>
    <div class="paper today-list">${todayHTML()}</div>
  </section>

  ${dailyAllDone ? dailySec : ''}
  ${funHTML()}
  `;
}

/* ?debug=content#home （旧 ?debug=trivia も可）
   日ごとの回数制限や抽選に影響させず、ミニコンテンツを全件確認する。 */
function contentDebugHTML(){
  const status = contentReviewStatus();
  const all = FUN.map((f,i)=>({f,i}));
  const rows = all.filter(({i})=>status[i] !== 'ok');
  const reviewed = Object.values(status).filter(v=>v === 'review').length;
  const ok = Object.values(status).filter(v=>v === 'ok').length;
  return `
  <section class="sec fun-debug">
    <div class="sec-head"><h2>ミニコンテンツ（確認用）</h2><span class="sec-note">残り ${rows.length}件</span></div>
    <div class="paper fun-debug-tools">
      <p>OKを付けた項目は一覧から消えます。「削除・再検討」は、この端末だけに一時保存されます。</p>
      <button class="btn btn-sm" data-content-copy type="button">再検討項目をコピー</button>
      <button class="btn btn-sm btn-ghost" data-content-reset-ok type="button">OKをすべてもどす</button>
      <span class="fun-debug-count" id="contentReviewCount">再検討 ${reviewed}こ・OK ${ok}こ</span>
      <p class="set-note">コピーした文章を、このチャットに貼り付けてください。</p>
    </div>
    <div class="fun-debug-list">${rows.map(({f,i},n)=>`
      <article class="paper fun fun-debug-card">
        <span class="fun-tag">${esc(f.t)} ${n+1}</span>
        <p class="fun-q">${rubyHTML(f.q)}</p>
        <p class="fun-a">${rubyHTML(f.a)}</p>
        ${f.fig ? kanjiOriginHTML(f.fig) : ''}
        <div class="fun-debug-checks">
          <label class="fun-debug-check"><input type="checkbox" data-content-ok="${i}"> OK</label>
          <label class="fun-debug-check"><input type="checkbox" data-content-review="${i}"${status[i] === 'review'?' checked':''}> 削除・再検討</label>
        </div>
      </article>`).join('')}</div>
  </section>`;
}

function contentReviewStatus(){
  try{
    const raw = JSON.parse(getLocal(K_TRIVIA_REVIEW) || '{}');
    if(Array.isArray(raw)) return Object.fromEntries(raw.filter(i=>Number.isInteger(i) && FUN[i]).map(i=>[i,'review']));
    if(!raw || typeof raw !== 'object') return {};
    return Object.fromEntries(Object.entries(raw)
      .filter(([i,v])=>Number.isInteger(+i) && FUN[+i] && (v === 'ok' || v === 'review')));
  }catch(e){ return {}; }
}
function saveContentReview(status){ setLocal(K_TRIVIA_REVIEW, JSON.stringify(status)); }
function contentReviewText(){
  const status = contentReviewStatus();
  const rows = Object.keys(status).filter(i=>status[i] === 'review').map(i=>FUN[+i]);
  return rows.length ? rows.map((f,n)=>`${n+1}. ${f.q}\n${f.a}`).join('\n\n') : '';
}

/* こども画面。とどいている ぶんを ぜんぶ ならべる（たたまない）。
   3件までなので、たたむより そのまま 見えた ほうが 気づける */
function parentMessageHTML(){
  const rows = messages();
  if(!rows.length) return '';
  return `
  <section class="home-parent-message" aria-label="おうちの人からの メッセージ">
    <div class="paper parent-message-stack">
    ${rows.map(m=>`
    <div class="parent-message-note">
      <strong>${esc(messageHeading(m))}</strong>
      <p>${esc(m.text)}</p>
    </div>`).join('')}
    </div>
  </section>`;
}

/* 宿題の進捗率 − 夏休みの経過率 から、進み具合を判定する。
   「よゆう」は全体と必須の両方が十分に先行しているときだけにする。
   任意だけを先に進めても、必須の遅れを隠さないため。 */
const PACE_MESSAGES = {
  good: ['よゆうだね！このちょうし！', 'とっても いいペース！', 'すすみぐあい ばっちり！', 'このまま いこう！',
    'こつこつ すすんでいるね！', 'いいリズムで できているよ！', 'しっかり すすんでいるね！', 'ここまで よく すすんだね！'],
  focus: ['「かならず やる」を さきに やると いいかも！', 'まずは「かならず やる」から すすめよう！',
    '「かならず やる」を ひとつずつ かたづけよう！', 'つぎの宿題の前に「かならず やる」を やろう！',
    'きょうは「かならず やる」を えらんでみよう！', '「かならず やる」を ひとつ すすめよう！',
    'まずは だいじな宿題から！', '「かならず やる」に もどってみよう！'],
  hurry: ['きょうは がんばりどき！', 'いまから ひとつずつ すすもう！', 'すこしずつ とりもどそう！', 'まずは できるところから！',
    'ひとつ えらんで はじめよう！', 'ちいさく すすめば だいじょうぶ！', 'きょうの ひとつを すすめよう！', 'できるぶんから やってみよう！'],
  steady: ['いいペース！', 'このちょうしで すすめよう！', 'あわてず ひとつずつ！', '毎日すこしずつ すすもう！',
    'きょうも ひとつ すすめよう！', 'じぶんのペースで だいじょうぶ！', 'つぎの ひとつへ いってみよう！', 'こつこつ つづけよう！']
};
function paceMessage(kind, overallGap, mustGap){
  const rows = PACE_MESSAGES[kind];
  /* 同じ進捗でも毎日少し表情を変える。日付を足すだけなので、
     同じ日の再描画では文言がころころ変わらない。 */
  const day = Math.floor(Date.now() / 86400000);
  const n = Math.abs(Math.round(overallGap * 10) + Math.round(mustGap * 10) + day);
  return rows[n % rows.length];
}
function verdictOf(overallGap, mustGap){
  if(overallGap >= 8 && mustGap >= 8) return { cls:'v-good', msg:paceMessage('good', overallGap, mustGap) };
  if(overallGap >= 0 && mustGap < 0) return { cls:'v-hmm', msg:paceMessage('focus', overallGap, mustGap), focusMust:true };
  if(mustGap <= -18) return { cls:'v-hmm', msg:paceMessage('hurry', overallGap, mustGap) };
  if(mustGap <= -6)  return { cls:'v-hmm', msg:paceMessage('hurry', overallGap, mustGap) };
  return { cls:'v-ok', msg:paceMessage('steady', overallGap, mustGap) };
}

/* 夏休みの経過率（％） */
function natsuPct(){
  const st = parseLocal(config.startAt), en = parseLocal(config.endAt);
  const span = en - st;
  return span > 0 ? clamp((new Date() - st) / span * 100, 0, 100) : 0;
}

/* 開始から今までの平均進捗で、全体（必須＋任意）の完了日を見積もる。
   まいにちの項目は overall() と同じく除く。実績が少ないうちは不安定な
   日付を断定せず、「進捗を増やすと表示できる」と次の行動を示す。 */
function completionForecast(done, total, startAt, now){
  const all = Math.max(0, Number(total) || 0);
  const finished = clamp(Number(done) || 0, 0, all);
  if(!all) return { kind:'empty' };
  if(finished >= all) return { kind:'done' };

  const start = startAt instanceof Date ? startAt : parseLocal(startAt);
  const current = now instanceof Date ? now : new Date(now || Date.now());
  const elapsed = current - start;
  const enoughDone = Math.max(2, Math.ceil(all * .03));
  if(!(elapsed >= 2 * 86400000) || finished < enoughDone) return { kind:'more' };

  const at = new Date(start.getTime() + elapsed * all / finished);
  if(!(at.getTime() === at.getTime())) return { kind:'more' };
  return { kind:'date', at, label:(at.getMonth() + 1) + '月' + at.getDate() + '日' };
}
function forecastText(forecast, child){
  if(forecast.kind === 'date') return child
    ? 'かんりょうよそく：いまのペースだと' + forecast.label
    : '完了予測 ' + forecast.label;
  if(forecast.kind === 'done') return child ? 'しゅくだい ぜんぶ できた！' : '完了予測　完了';
  if(forecast.kind === 'empty') return child ? '' : '宿題を登録すると予測できます';
  return child ? 'すすむと めやすが でるよ' : '進捗が増えると予測できます';
}

/* しゅくだいバーは「かならず やる」と「つぎに やる」を あわせて 出す。
   必須だけで 作ると、任意の 宿題を やっても バーが 動かず、
   必須が おわると そこで 止まってしまう。やったことは かならず
   目に 見えて 増える、という ところを いちばん だいじにする。

   ただし「よゆう」の判定は、全体と必須の両方を見る。任意をたくさん
   やるほど「よゆう」と出て必須の遅れが隠れることを防ぐため。
   バーが伸びているのに必須がおくれているときは、その理由をそえる。 */
function paceHTML(o){
  const natsu = natsuPct();
  const opt = overall('option');
  const allDone  = o.done + opt.done;
  const allTotal = o.total + opt.total;
  const todo = allTotal ? allDone / allTotal * 100 : 0;   // バーは 合算
  const mustShare = allTotal ? o.done / allTotal * 100 : 0;
  const mustGap = o.pct - natsu;

  /* のこりは「ばん」や「まい」の 合計では 数が 大きすぎて 伝わらない。
     見出しの「かならず やる のこり ◯しゅるい」と 同じ 課題の数で かぞえる */
  const left = group => config.tasks
    .filter(t => t.group === group && t.type !== 'daily' && !prog(t).isDone).length;
  const mustLeft = left('must');
  const optLeft  = left('option');
  const allGap = todo - natsu;
  const forecast = completionForecast(allDone, allTotal, config.startAt, new Date());
  const forecastCopy = forecastText(forecast, true);
  const forecastHTML = forecast.kind === 'date'
    ? `<span>かんりょうよそく：</span><span>いまのペースだと${esc(forecast.label)}</span>`
    : esc(forecastCopy);
  const v = verdictOf(allGap, mustGap);
  let cls = v.cls, msg = v.msg;

  /* 「かならず やる」を ぜんぶ 終えたのに、「つぎに やる」が のこっていて
     ぜんたいでは 足りない、という ことが ある。そこで「よゆうだね！」と
     出すと、まだ のこっていることが 伝わらない。

     必須が のこっている あいだは ここを 通さない。通すと、数は 任意の ぶんだけ
     なのに 必須も 終わったように 読めてしまう（そういう 出かたを していた）。
     必須が のこる 場合は、下の「さきに やろう！」が 受けもつ。 */
  if(mustLeft === 0 && optLeft > 0 && allGap <= -6){
    cls = 'v-hmm';
    msg = 'かならず やるは ぜんぶ できた！ のこり ' + optLeft + 'しゅるい';
  }
  /* バーは 伸びているのに おくれている、という 分かりにくい 状態のときだけ、
     何が のこっているのかを はっきり 伝える */
  const warn = (!v.focusMust && mustGap < -6 && mustLeft > 0 && opt.done > 0)
    ? `<p class="pace-warn">「かならず やる」が あと ${mustLeft}しゅるい のこっているよ。さきに やろう！</p>`
    : '';

  return `
  <div class="pace">
    <div class="pace-row">
      <span class="pace-name">なつやすみ</span>
      <div class="bar"><div class="bar-fill bar-fill--natsu" style="width:${natsu.toFixed(1)}%"></div></div>
      <span class="pace-pct">${Math.round(natsu)}%</span>
    </div>
    <div class="pace-row">
      <span class="pace-name">しゅくだい</span>
      <div class="bar">
        <div class="bar-fill bar-fill--todo" style="width:${todo.toFixed(1)}%"></div>
        <div class="bar-fill bar-fill--must" style="width:${mustShare.toFixed(1)}%"></div>
      </div>
      <span class="pace-pct">${Math.round(todo)}%</span>
    </div>
    ${opt.total ? `<p class="pace-legend">
      <span class="pace-key pace-key--must"></span>かならず やる
      <span class="pace-key pace-key--opt"></span>つぎに やる</p>` : ''}
    <p class="pace-verdict ${cls}">${msg}</p>
    ${forecastCopy ? `<p class="pace-forecast">${forecastHTML}</p>` : ''}
    ${warn}
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
        ${streakLabel(p) ? `<span class="streak">${streakLabel(p)}</span>` : ''}
      </div>`;
    }else{
      meter = `<div class="task-meter task-meter--bar task-meter--daily">
        <div class="bar"><div class="bar-fill" style="width:${p.pct.toFixed(1)}%"></div></div>
        <span class="task-count">${esc(p.text)}</span>
        ${streakLabel(p) ? `<span class="streak">${streakLabel(p)}</span>` : ''}
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
    ${nx && !isFree(t) ? `<p class="task-next"><span class="next-lead">${esc(nx.lead)}</span>
        ${nx.num ? `<span class="next-num">${esc(nx.num)}</span>` : ''}<span class="next-tail">${esc(nx.tail)}</span></p>` : ''}
    ${meter}
    <div class="task-act">
      <button class="btn ${p.isDone?'btn-ghost':'btn-do'}" data-open="${esc(t.id)}" type="button">
        ${isFree(t) ? (p.isDone ? 'また かく' : 'かく') : (p.isDone ? 'ついか／なおす' : 'やった！')}
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

/* 保護者ページでは、今日の入力をそのまま確認できるようにする。
   シートでの「追加／なおす」も必ず logs に1件残るため、子ども・保護者の
   どちらが操作したかを含め、ここが当日の確認用の正本になる。 */
function parentTodayLogsHTML(){
  const k = dayKey(new Date());
  const rows = (state.logs || []).filter(l => dayKey(new Date(l.at)) === k);
  return `
  <section class="sec parent-today-logs">
    <div class="sec-head"><h2>今日の記録</h2><span class="sec-note">${fmtDate(new Date())}</span></div>
    <div class="paper today-list">${rows.length
      ? rows.slice().reverse().map(logRowHTML).join('')
      : '<p class="empty">本日の記録はまだありません。</p>'}</div>
    <p class="set-note parent-log-help">保護者が直したぶんも、ここに残ります。${
      config.allowLogDelete ? ''
        : '<button type="button" class="linkish" id="logCareJump">1件ずつ消せるようにする</button>'}</p>
  </section>`;
}

/* だれが 記録したか。
   共有していないグループは 端末が 1つなので 見分ける必要が なく、
   よけいな 表示を 出さない。共有している ときだけ のこす。 */
function sharingOn(){
  const S = window.NatsuSync;
  return !!(S && S.configured() && String(S.getCode() || '').length >= 8);
}
function logBy(){
  if(!sharingOn()) return '';
  const role = getLocal(K_ROLE);
  return (role === 'parent' || role === 'child') ? role : '';
}
/* 入れた人の 印。**おうちの人が 入れた ぶんだけ** 出す。
   子どもが 入れた ぶんは、そちらが ふつうなので 何も 付けない
   （以前は 子どもの 名前を 出していて、今日の記録の 全件に
     名前が ならび、かえって 読みにくかった）。
   `l.by` は 記録した ときの この端末の 役割で、記録と いっしょに
   同期される。古い記録に `by` が 無くても、その場合は 印が 出ないだけ */
function logByLabel(l){
  return (l && l.by === 'parent') ? '親' : '';
}

function logRowHTML(l){
  /* だれが 入れたかは、おうちの人が 見るための もの。
     子ども画面では じゃまに なるので 出さない */
  const by = isAdultTab(tab) ? logByLabel(l) : '';
  return `
  <div class="today-item">
    <span class="ti-time">${fmtTime(new Date(l.at))}</span>
    <div class="ti-body">
      <div class="ti-name">${esc(l.name)}</div>
      <div class="ti-what">${esc(l.what)}${
        by ? `<span class="ti-by">（${esc(by)}）</span>` : ''}</div>
      ${l.memo ? `<div class="ti-memo">${esc(l.memo)}</div>` : ''}
    </div>
    ${canDeleteLog() ? `<button class="icon-btn del ti-del" data-dellog="${esc(l.id)}"
            title="この記録を消す" aria-label="この記録を消す" type="button">🗑</button>` : ''}
  </div>`;
}

/* 記録の1行けしを 出してよいか。
   設定で 入れたうえで、この端末が おうちの人の端末の ときだけ。
   子どもの端末では 出さない（誤って 消して しまわない ように） */
function canDeleteLog(){
  return !!config.allowLogDelete && getLocal(K_ROLE) === 'parent';
}

/* {漢字|よみ} を ふりがなに する。さきに esc() で エスケープしてから
   自分の タグだけを 入れるので、本文に < や > が あっても こわれない。
   ふつうの （かっこ）は そのまま のこる（読みがなでは ない ものが あるため） */
function rubyHTML(text){
  return esc(text).replace(/\{([^{}|]+)\|([^{}|]+)\}/g,
    (_, base, yomi) => `<ruby>${base}<rt>${yomi}</rt></ruby>`);
}

/* 漢字の なりたちは 絵が ないと 分かりにくいので、
   assets/kanji-origin.js の 自作SVGを そえる。
   読みこめていない ときは 何も 出さず、文だけで なりたつ */
function kanjiOriginHTML(key){
  const svg = (typeof KANJI_ORIGIN === 'object' && KANJI_ORIGIN && KANJI_ORIGIN[key]) || '';
  return svg ? `<figure class="fun-fig">${svg}</figure>` : '';
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
/* 読める漢字の せっていに あわせて、出す内容を えらぶ。
   小2までの せっていでは、名言・故事成語・古語のように
   背景を 知らないと 味わえない ものを 出さない（lv:3）。
   「漢字のまま」＝3年生いじょう と みなして ぜんぶ 出す。 */
function funAllowed(i){
  const f = FUN[i];
  if(!f) return false;
  return readingGrade() >= 9 ? true : (Number(f.lv) || 2) <= 2;
}

function funPick(){
  const f = funToday();
  let rest = FUN.map((_, i)=> i).filter(i => funAllowed(i) && f.history.indexOf(i) < 0);
  if(!rest.length){ f.history = []; rest = FUN.map((_, i)=> i).filter(funAllowed); }
  if(!rest.length) rest = FUN.map((_, i)=> i);   // 念のため（ぜんぶ 対象外の とき）
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
    ${funOpen ? `<p class="fun-a">${rubyHTML(f.a)}</p>${f.fig ? kanjiOriginHTML(f.fig) : ''}` : ''}
    <div class="fun-row">
      ${funOpen ? '' : `<button class="btn btn-sm" data-fun="open" type="button">${
        isQuiz ? 'こたえを 見る' : (f.ask || 'つづきを 見る')}</button>`}
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
    ${/* きほんの 3つを 読みおえ、ごほうびの 1つが のこっている ときだけ 出す。
          説明と まぎれないよう、ボタンの 下に 小さく。
          前は「3つ目に 出るはず」なのに 出かたが ずれて 見えていたので、
          「のこりが あるか（left）」で 判断するように した */
      funOpen && bonus && seenCount >= FUN_MAX && left > 0
      ? '<p class="fun-bonus--on">「できた！」が ふえたので、きょうは もうひとつ 読めるよ。</p>'
      : ''}
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

  const childBookUnit = bookCountUnit();
  const head = `
    <div class="paper parent-head">
      <div>
        <h2 style="font-size:24px">よんだ本</h2>
        <p style="font-size:17px">ぜんぶで ${done}${childBookUnit}　あと ${Math.max(0, total - done)}${childBookUnit}</p>
      </div>
      <a class="btn btn-sm" href="#home">もどる</a>
    </div>`;

  if(!rows.length){
    return head + `<div class="paper"><p class="empty">まだ 1${childBookUnit}も きろくして いないよ。<br>
      「のこりの しゅくだい」から きろくしてね。</p></div>`;
  }

  return head + `
    <p class="set-note paper" style="padding:14px 18px;font-size:17px">
      カードに 書きうつすときは、この ページを 見ながら 書いてね。</p>
    ${rows.map(b=>`
      <article class="bookcard">
        <div class="bookcard-head">
          <span class="book-no">${bookOrdinal(b.nth)}</span>
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
  const byDay = {};
  state.logs.forEach(l=>{
    const k = dayKey(new Date(l.at));
    (byDay[k] = byDay[k] || []).push(l);
  });
  /* 宿題は していなくても ミニコンテンツは 読んだ、という日も
     ふりかえれるように、読んだ日も 見出しに ならべる */
  (state.reads || []).forEach(r=>{
    const k = dayKey(new Date(r.at));
    if(!byDay[k]) byDay[k] = [];
  });
  const keys = Object.keys(byDay).sort().reverse();
  if(!keys.length){
    return `<div class="paper"><p class="empty">まだ きろくが ないよ。</p></div>`;
  }
  return keys.map(k=>`
    <section class="sec">
      <div class="day-head">${fmtDate(keyToDate(k))}<span class="cnt">${byDay[k].length}こ</span></div>
      ${byDay[k].length
        ? `<div class="paper today-list">${byDay[k].slice().reverse().map(logRowHTML).join('')}</div>`
        : ''}
      ${readsHTML(k)}
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

  const reads = readsHTML(key);
  const body = (logs.length
    ? `<div class="paper today-list">${logs.map(logRowHTML).join('')}</div>`
    : (reads ? '' : `<div class="paper"><p class="empty">この日は きろくが ないよ</p></div>`)) + reads;

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
  /* 子ども画面のバーは 必須＋任意の 合算なので、保護者ページでも
     同じ「全体」を 並べて 出す。必須だけを 見ていると、
     子どもの画面で 何が 起きているのかが 分からなくなるため */
  const allDone  = s.done + so.done;
  const allTotal = s.total + so.total;
  const forecast = completionForecast(allDone, allTotal, config.startAt, now);

  const row = t=>{
    const p = prog(t);
    const nx = nextLabel(t, true);
    const next = p.isDone ? '完了'
      : (t.type === 'daily' ? (isFree(t) ? (p.done ? '本日記入済み' : '本日未記入')
                                         : '本日 ' + p.done + '/' + p.total + unitAdult(t.targetUnit))
                            : (nx ? '次は ' + nx.num + nx.tail : ''));
    return `
      <tr class="${p.isDone ? 'is-done' : ''}">
        <th>${esc(t.name)}</th>
        <td class="pg-bar"><div class="bar"><div class="bar-fill" style="width:${p.pct.toFixed(1)}%"></div></div></td>
        <td class="pg-num">${esc(adultText(t, p))}</td>
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
  ${adultNavHTML('settings')}
  <div class="paper parent-head">
    <div>
      <div class="parent-head-title"><h2>保護者用ページ</h2>${parentShareBadgeHTML()}</div>
      <p>${esc(config.title)}</p>
    </div>
  </div>

  ${syncPromptHTML()}

  ${parentChildGuideHTML()}

  ${homeInstallGuideHTML()}

  <section class="paper pstat">
    <div class="pstat-left">
      <span class="pstat-lab">夏休みの残り</span>
      <span class="pstat-val">${ms > 0
        ? `<span class="pstat-num">${Math.floor(ms/86400000)}</span><small class="pstat-unit">日</small><span class="pstat-num">${Math.floor(ms/3600000)%24}</span><small class="pstat-unit">時間</small>`
        : '終了'}</span>
      <span class="pstat-forecast">${esc(forecastText(forecast, false))}</span>
    </div>
    <div class="pstat-bars">
      ${/* 経過とすぐ見くらべたいのは「全体」なので、経過の真下に置く。
            必須・つぎにやる は その内わけとして 下に つづける */''}
      ${pstatRow('夏休みの経過', nat, '', 'natsu')}
      ${pstatRow('全体の進捗', allTotal ? allDone/allTotal*100 : 0, `${allDone}/${allTotal}`, 'all', allTotal ? s.done/allTotal*100 : 0)}
      ${pstatRow('必須の宿題', s.pct, `${s.done}/${s.total}`, 'must')}
      ${so.total ? pstatRow('つぎに やる', so.pct, `${so.done}/${so.total}`, 'opt') : ''}
    </div>
  </section>

  ${parentMessageEditorHTML()}

  ${parentTodayLogsHTML()}

  ${group('must','必ずやる')}
  ${group('option','つぎに やる')}
  ${bookSectionHTML()}
  ${trashSectionHTML()}

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

  ${privacyNoteHTML()}
  ${creditHTML()}`;
}

/* まねきリンク。これを LINE などで 送れば、受けとった側は
   開くだけで つながる（あいことばの 打ち直しが いらない）。

   openExternalBrowser=1 は LINE の 決まりで、LINE の中の ブラウザでは なく
   ふだんの ブラウザで 開かせる。ほかの アプリでは ただ 無視される。
   これが ないと、LINE の中で 設定して しまい、あとで Safari で 開いたときに
   また 設定が 必要に なる。 */
function inviteURLForCode(code){
  code = cleanCode(code || '');
  if(!code) return '';
  return location.origin + location.pathname +
         '?' + JOIN_PARAM + '=' + encodeURIComponent(code) +
         '&r=' + Date.now() +          // ためこんだ古い画面を 配らないための 印
         '&openExternalBrowser=1';
}
function inviteURL(){
  const S = window.NatsuSync;
  return inviteURLForCode((S && S.getCode()) || '');
}
/* まねきリンクを そのまま QR にする。
   となりに いる 人に わたすときは、リンクを 送るより カメラで 読む ほうが 早い。

   ライブラリが 読めなかった ときは 空文字を かえす。QR が 出ないだけで、
   下の リンク欄と コピーは そのまま 使える。
   色は わざと 白地に 黒。カメラは 明暗の 差で 読むので、
   画面の 色づかい（--surface など）に 合わせては いけない。 */
function inviteQrHTML(url){
  if(typeof qrcode !== 'function') return '';
  try{
    const qr = qrcode(0, 'M');     // 0 = 中身の 長さに 合わせて 大きさを 決める
    qr.addData(url);
    qr.make();
    /* scalable:true で width/height を つけさせず、はばは CSS に まかせる。
       margin は QR の きまりで 4セル 以上 いる（これが ないと 読めない） */
    const svg = qr.createSvgTag({ cellSize:4, margin:16, scalable:true,
                                  title:'べつの端末に わたす まねきリンクの QRコード' });
    return `
    <div class="invite-qr">${svg}</div>
    <p class="set-note">となりに ある端末なら、この QR を カメラで 読むだけでも つながります。</p>`;
  }catch(e){
    return '';
  }
}

function inviteHTML(){
  const url = inviteURL();
  if(!url) return '';
  return `
  <div class="invite">
    <p class="set-note"><b>べつの端末に わたす</b>：このリンクを送ると、受け取った人は開くだけでつながります。あいことばの入力は要りません。</p>
    <div class="set-row">
      <input type="text" id="inviteUrl" value="${esc(url)}" readonly onfocus="this.select()">
    </div>
    <div class="set-actions">
      <button class="btn btn-sm" id="inviteCopy" type="button">リンクをコピー</button>
    </div>
    ${inviteQrHTML(url)}
    <p class="set-note">このリンクは<b>「あいことば」そのもの</b>です。見た人は誰でもつながれるので、SNSなどに貼らないでください。受け取る側は、開いたあと<b>ホーム画面に追加</b>しておくと、次からは一度で開けます。</p>
  </div>`;
}

/* LINE などの アプリの中の ブラウザで 開かれた ときの ことわり。
   ここで 設定しても、あとで ふだんの ブラウザで 開くと 別あつかいに なる */
function inAppBrowserNoteHTML(){
  const ua = navigator.userAgent || '';
  if(!/Line\/|FBAN|FBAV|Instagram|Twitter/i.test(ua)) return '';
  return `
  <p class="set-note inapp-note"><b>アプリの中のブラウザで開いています。</b>
  このまま設定すると、あとで Safari などで開いたときに、もう一度設定が必要になります。
  画面右上の「…」から<b>「ブラウザで開く」</b>を選んでから設定することをおすすめします。</p>`;
}

/* いま とどいている メッセージ。どの端末からでも 消せる */
function messageListHTML(){
  const rows = messages();
  if(!rows.length) return '<p class="msg-empty">送信後、ここに表示されます。</p>';
  return `
  <div class="msg-list">
    ${rows.map(m=>`
      <div class="msg-row">
        <div class="msg-main">
          <span class="msg-from">${esc(messageHeading(m))}</span>
          <span class="msg-text">${esc(m.text)}</span>
        </div>
        <button class="icon-btn del" data-delmsg="${esc(m.id)}" type="button"
                title="このメッセージを消す" aria-label="${esc(messageHeading(m))}のメッセージを消す">🗑</button>
      </div>`).join('')}
  </div>`;
}

function parentMessageEditorHTML(){
  const msg = config.parentMessage;
  return `
  <section class="sec parent-message-editor">
    <div class="sec-head"><h2>子どもへのメッセージ</h2><span class="sec-note">80文字まで</span></div>
    <div class="paper parent-message-form">
      <div class="parent-message-fields">
        <div class="parent-sender-fields">
          <label class="lab" for="parentMessageSender">表示する名前
            <select id="parentMessageSender">${parentSenderOptions(msg.sender)}</select></label>
          <label class="lab sender-custom" id="parentMessageCustomWrap" for="parentMessageCustom" hidden>名前
            <input id="parentMessageCustom" type="text" maxlength="20" value="${esc(msg.customSender)}" placeholder="例：おばあちゃん"></label>
        </div>
        <span class="parent-message-from" aria-hidden="true">より</span>
        <label class="lab parent-message-text" for="parentMessageText">メッセージ
          <textarea id="parentMessageText" rows="1" maxlength="80" placeholder="例：きょうも おつかれさま！">${esc(msg.text)}</textarea></label>
        <button class="btn btn-sm btn-do btn-icon-text parent-message-send" id="parentMessageSave" type="button">${icon('send')}<span>送る</span></button>
      </div>
      <p class="set-note parent-message-help">子ども画面には新しい順に最大${MESSAGES_MAX}件を表示します。同じ名前で送ると、その名前のメッセージを上書きします。</p>
      ${messageListHTML()}
    </div>
  </section>`;
}

/* 「べつの端末と つなぐ」。あいことばを 親の端末で 作り、子の端末に 同じものを 入れる。
   Firebase を 設定していないうちは、その旨だけを 出す */
/* 状態の 文言は ここだけ。描き直しと、sync.js からの 通知の
   両方が つかう。以前は 通知の 側が #syncStatus を 直接 書きかえて
   いたので、描き直しで 直しても すぐ 上書きされて 元に 戻った */
function syncStatusText(status, text){
  const S = window.NatsuSync;
  const [mark, def] = SYNC_LABEL[status] || SYNC_LABEL.off;
  /* この端末だけの ときに「つながっています」と 出すと、もう 相手が
     いるように 読める。実際は 相手を 待っている 状態なので そう書く */
  const alone = status === 'online' && S && typeof S.deviceCount === 'function'
                && S.deviceCount() <= 1;
  return mark + ' ' + (alone ? 'ほかの端末を待っています' : (text || def));
}

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
                           + 'あいことばを決めると、同じグループの複数の端末で使えます。' })}
  </section>`;
}

/* 共有している 端末の 一覧。
   「親(1)」「子(はじめ)」のように 見わけられる ようにする。
   番号は 先に つないだ 順。同じ 役割の 中だけで かぞえる。
   古い版は devices の 中身が true しか 無いので、その場合は
   「えらんでいない」に なる（役割を えらべば 次から 出る）。 */
function deviceRows(map){
  /* はずした端末は、消さずに 印だけ のこして ある（その端末に
     気づかせて あいことばを 消させるため）。一覧からは のぞく */
  const rows = Object.keys(map || {})
    .filter(id => { const v = (map || {})[id]; return !(v && typeof v === 'object' && v.revoked); })
    .map(id=>{
    const v = map[id];
    const o = (v && typeof v === 'object') ? v : {};
    return {
      id,
      role: o.role || '',
      name: String(o.name  || '').trim(),   // こどもの なまえ
      own:  String(o.label || '').trim(),   // この端末に つけた 呼び名（父・母 など）
      ver:  o.ver || '',
      at:   ms(o.at)
    };
  });
  rows.sort((a,b)=> (a.at - b.at) || a.id.localeCompare(b.id));

  /* 呼び名を 付けていない 端末が 1台だけなら、番号は 付けない。
     2台以上 あって はじめて「親(1)」「親(2)」と 区別する */
  const bare = {};
  rows.forEach(r=>{ if(!r.own) bare[r.role] = (bare[r.role] | 0) + 1; });
  const seen = {};
  const dup = {};
  rows.forEach(r=>{ if(r.own) dup[r.own] = (dup[r.own] | 0) + 1; });
  const usedOwn = {};

  rows.forEach(r=>{
    /* 役割は 呼び名とは 別に 出す。呼び名（父・iPad など）だけでは
       どちらが 保護者の端末か 分からず、解除する 相手を まちがえる */
    r.roleLabel = r.role === 'parent' ? '親' : r.role === 'child' ? '子' : '未設定';
    if(r.own){
      usedOwn[r.own] = (usedOwn[r.own] | 0) + 1;
      r.label = r.own + (dup[r.own] > 1 ? '(' + usedOwn[r.own] + ')' : '');
      /* 呼び名が すでに 役割そのものなら、同じ字を 2度 出さない */
      r.roleShown = r.own !== r.roleLabel;
      return;
    }
    seen[r.role] = (seen[r.role] | 0) + 1;
    const num = bare[r.role] > 1 ? '(' + seen[r.role] + ')' : '';
    if(r.role === 'parent')     r.label = '親' + num;
    else if(r.role === 'child') r.label = r.name ? '子(' + r.name + ')' + num : '子' + num;
    else                        r.label = 'えらんでいない' + num;
    r.roleShown = false;          // 呼び名の中に すでに 役割が 入っている
  });
  return rows;
}
/* 版は「日づけ＋アルファベットの通し」（20260810w → …z → aa → ab → …）。
   ふつうに 文字として ならべると、'w' > 'a' なので **1文字の 版が
   2文字の 版に 勝って しまう**。z を こえて aa に 回った あとは、
   いちばん 古い 端末が「いちばん 新しい」と 判定され、実際に 新しい 端末に
   （古い）が つき、更新の 案内も あべこべに 出る（実機で そうなっていた）。

   通しの 長さを 先に くらべれば、a…z → aa…az の 順に ならぶ。 */
function verKey(v){
  const m = /^(\d+)([a-z]*)$/.exec(String(v || ''));
  if(!m) return null;
  return { date: Number(m[1]), len: m[2].length, tail: m[2] };
}
function newestVer(vers){
  const list = (vers || []).filter(Boolean);
  if(!list.length) return '';
  /* 形の ちがう 版が 混ざったら、くらべずに あきらめる。
     まちがった（古い）を つけるより、何も つけない ほうが よい */
  const keys = list.map(verKey);
  if(keys.some(k => !k)) return '';
  let best = 0;
  for(let i = 1; i < list.length; i++){
    const a = keys[i], b = keys[best];
    if(a.date !== b.date ? a.date > b.date
       : a.len !== b.len ? a.len > b.len
       : a.tail > b.tail) best = i;
  }
  return list[best];
}

/* 保護者ページの見出しでは、端末の総数よりも「子ども端末と共有できているか」を
   先に伝える。台数や個々の端末の管理は設定ページの一覧で行うため、ここでは
   最小限の状態だけを短いバッジで示す。 */
function parentShareSummary(rows, mine, fallbackName){
  const other = (rows || []).filter(r => r && r.id !== mine);
  const children = other.filter(r => r.role === 'child');
  if(children.length){
    const name = String(children[0].name || fallbackName || '').trim();
    return {
      state: 'child',
      full: name ? name + 'と共有中' : '子ども端末と共有中',
      short: name ? name + 'と共有中' : '子どもと共有中'
    };
  }
  if(other.length) return { state:'other', full:'ほかの端末と共有中', short:'ほかの端末と共有中' };
  return { state:'waiting', full:'共有設定済み・子ども端末の接続待ち', short:'子ども端末の接続待ち' };
}

function parentShareBadgeHTML(){
  const S = window.NatsuSync;
  if(!S || !S.configured()) return '';
  if(!S.getCode()) return `<button class="parent-share-badge is-none" id="parentShareBadge" type="button"
    title="共有なし・共有の設定を開く">
    <span class="parent-share-mark" aria-hidden="true">共有なし</span>
    <span class="parent-share-full">：共有の設定はこちら</span>
    <span class="parent-share-short">：設定</span>
  </button>`;
  const summary = parentShareSummary(
    deviceRows(typeof S.devices === 'function' ? S.devices() : {}),
    getLocal(K_DEVICE_ID), config.childName || getLocal(K_NAME)
  );
  return `<button class="parent-share-badge is-${summary.state}" id="parentShareBadge" type="button" title="${esc(summary.full)}">
    <span class="parent-share-mark" aria-hidden="true">共有</span>
    <span class="parent-share-full">${esc(summary.full)}</span>
    <span class="parent-share-short">${esc(summary.short)}</span>
  </button>`;
}

function deviceListHTML(){
  const S = window.NatsuSync;
  const map = (S && typeof S.devices === 'function') ? S.devices() : {};
  const rows = deviceRows(map);
  if(!rows.length) return '<p class="set-note">ほかの端末の情報がまだ届いていません。</p>';
  const mine = getLocal(K_DEVICE_ID);
  const newest = newestVer(rows.map(r=> r.ver));
  return `<ul class="dev-list">${rows.map(r=>`
    <li class="dev-row${r.id === mine ? ' is-me' : ''}">
      <span class="dev-main">
        <span class="dev-name">${esc(r.label)}</span>
        ${r.roleShown ? `<span class="dev-role is-${esc(r.role || 'none')}">${esc(r.roleLabel)}</span>` : ''}
        ${r.ver ? `<span class="dev-ver${newest && r.ver !== newest ? ' is-old' : ''}">ver ${esc(r.ver)}${
          newest && r.ver !== newest ? '（古い）' : ''}</span>` : '<span class="dev-ver">ver ―</span>'}
      </span>
      ${r.id === mine
        ? '<span class="dev-me">この端末</span>'
        : `<button class="btn btn-sm btn-ghost dev-off" data-devoff="${esc(r.id)}" type="button">解除</button>`}
    </li>`).join('')}</ul>
    ${/* 説明が 4段落 続くと 一覧そのものが 押し出される。ふだんは たたむ。
          data-details-key を 付けないと、detailsKey() が 見出しの 文字を
          鍵に してしまい、同じ 文の 折りたたみが 巻きぞえで 開く */''}
    <details class="set-advanced sync-help" data-details-key="deviceHelp">
      <summary>この一覧の見かた</summary>
      <div class="set-advanced-body">
        <p class="set-note">「親」「子」は、それぞれの端末の「この端末は」で選んだ役割です。「未設定」の端末では、その端末の共有設定から選んでください。</p>
        <p class="set-note">使わなくなった端末は「解除」で共有から切り離せます。解除した端末は、次に開いたときに合言葉が消え、再接続には入力し直しが必要になります。LINEなどの一時的なブラウザで接続してしまい、その端末から操作できなくなったときに使ってください。記録そのものは消えません。</p>
      </div>
    </details>
    ${/* 版ちがいの 注意は 実害の 警告なので たたまない */''}
    ${[...new Set(rows.map(r=> r.ver).filter(Boolean))].length > 1
      ? '<p class="set-note dev-warn">古いバージョンの端末があります。その端末で「アプリ情報」の<b>最新に更新する</b>を実行してください。古いままだと、修正や削除がその端末から元に戻されることがあります。</p>'
      : ''}`;
}

function syncSectionHTML(opts){
  const lead = opts && opts.lead;
  const S = window.NatsuSync;
  if(!S){
    return `
  <section class="sec" id="syncSection">
    <div class="sec-head"><h2>ほかの端末と共有</h2></div>
    <div class="paper">
      <p class="set-note">同期の読み込みに失敗しました。記録はこの端末に保存されています。</p>
    </div>
  </section>`;
  }

  if(!S.configured()){
    return `
  <section class="sec" id="syncSection">
    <div class="sec-head"><h2>ほかの端末と共有</h2></div>
    <div class="paper">
      <p class="set-note">同期機能は未設定です。<code>assets/sync.js</code> の
      <code>FIREBASE_CONFIG</code> に Firebase の設定を貼り付けると、この欄が使えるようになります。
      手順は README の「端末間で共有する」を参照してください。</p>
    </div>
  </section>`;
  }

  const code = S.getCode();

  return `
  <section class="sec" id="syncSection">
    <div class="sec-head"><h2>ほかの端末と共有</h2>
      <span class="sec-note" id="syncStatus">${esc(syncStatusText(S.status(), S.statusText()))}</span></div>
    <div class="paper">
      ${lead ? `<p class="set-note sync-lead">${esc(lead)}</p>` : ''}
      <p class="set-note">同じ「合言葉」を入力した複数の端末で、同じ記録と設定を共有できます。</p>
      ${code ? `
      ${/* 共有ずみの 画面。ここに 出ているのは **すでに 使っている**
            合言葉で、これから つなぐ ものでは ない。以前は
            「この合言葉で接続」と 書いてあり、作った 本人には
            「まだ つながっていないのか」と 読めた。
            ふだんは 見せるだけに して、打ち直しは たたんで おく */''}
      ${/* **id を 参加の 欄と 分けること。** 同じ id だと、
            captureFormDraft が 拾った 古い 値が 描き直しの あとで
            書きもどされ、解除しても 前の 合言葉が のこる／
            おまかせを 押しても 新しい 合言葉が 出ない、が 起きる */''}
      <div class="set-row"><span class="lab">このグループの合言葉</span>
        <input type="text" id="syncCodeShown" value="${esc(code)}" spellcheck="false"
               autocapitalize="off" autocorrect="off" placeholder="未設定" readonly></div>
      <p class="set-note">ほかの端末では、この合言葉を入力するか、下の「ほかの端末から読み取る」のQRコード・招待リンクを使ってください。</p>
      <div class="set-actions">
        <button class="btn btn-sm" id="syncCopy" type="button">コピー</button>
      </div>
      <details class="set-advanced" data-details-key="syncRejoin">
        <summary>べつの合言葉につなぎ直す</summary>
        <div class="set-advanced-body">
          <p class="set-note">いま入っているグループから離れ、入力した合言葉のグループにつなぎ直します。この端末の記録は残ります。</p>
          <div class="set-row"><span class="lab">つなぎ直す合言葉</span>
            <input type="text" id="syncRejoinCode" value="" spellcheck="false"
                   autocapitalize="off" autocorrect="off" placeholder="受け取った合言葉"></div>
          <div class="set-actions">
            <button class="btn btn-sm" id="syncSave" type="button">入力した合言葉につなぎ直す</button>
          </div>
        </div>
      </details>` : `
      <!-- まだ 共有していない ときは、「作る」と「入る」を 分ける。
           以前は 1つの 欄と「この合言葉で接続」だけで、作成しただけで
           共有が 始まるのか、接続を 押して はじめて 始まるのかが
           読み取れなかった。**作成した 時点で 共有が 始まる**ように 挙動を
           そろえ、文言も そう書く -->
      <div class="sync-start">
        <h3 class="sync-subhead">はじめて共有する</h3>
        <p class="set-note">「おまかせ」を押すと、当てられにくい16文字の合言葉をこの端末が作ります。押した時点でこの端末の宿題・設定・記録がグループの内容になり、ほかの端末から読み取れるようになります。そのあとに出るQRコード・招待リンクを、ほかの端末で読み取ってください。</p>
        <div class="set-actions">
          <button class="btn btn-go" id="syncMake" type="button">合言葉をつくる（おまかせ）</button>
        </div>
        ${/* 最初の設定と同じく、ここでも 自分で 決められるように する。
              決め方が ちがっても、押した 時点で 共有が 始まるのは 同じ */''}
        <details class="set-advanced" data-details-key="syncOwnCode">
          <summary>合言葉を自分でつくる</summary>
          <div class="set-advanced-body">
            <p class="set-note">8文字以上にしてください。ふだん使っているパスワードや、家族の名前・誕生日など推測できる言葉は使わないでください。おまかせで作るほうが安全です。</p>
            <div class="set-row"><span class="lab">決めた合言葉</span>
              <input type="text" id="syncOwnCode" value="" spellcheck="false"
                     autocapitalize="off" autocorrect="off" placeholder="8文字以上"></div>
            <div class="set-actions">
              <button class="btn btn-go" id="syncMakeOwn" type="button">この合言葉でつくる</button>
            </div>
          </div>
        </details>
      </div>
      <div class="sync-start">
        <h3 class="sync-subhead">ほかの端末で作った合言葉に参加する</h3>
        <div class="set-row"><span class="lab">合言葉</span>
          <input type="text" id="syncCode" value="" spellcheck="false"
                 autocapitalize="off" autocorrect="off" placeholder="受け取った合言葉"></div>
        <div class="set-actions">
          <button class="btn btn-sm" id="syncVerify" type="button">接続を確認</button>
        </div>
        <p class="set-note" id="syncJoinStatus" aria-live="polite"></p>
        <div class="set-actions">
          <button class="btn btn-go" id="syncSave" type="button" hidden>このグループに参加する</button>
        </div>
      </div>`}
      ${code ? `<details class="set-advanced sync-detail"${opts && opts.openDetails ? ' open' : ''}>
        <summary><span class="sync-device-count" id="syncDeviceCount">共有リンク・端末ごとの設定（設定済み：${S.deviceCount()}台）</span></summary>
        <div class="set-advanced-body">
          <h3 class="sync-subhead">ほかの端末から読み取る</h3>
          ${inviteHTML()}
          <h3 class="sync-subhead">接続中の端末</h3>
           <div id="syncDeviceList">${deviceListHTML()}</div>
           <h3 class="sync-subhead">この端末の表示と役割</h3>
           <div class="sync-local-settings">
             <div class="set-row"><span class="lab">この端末の呼び名</span>
               <input type="text" id="deviceLabel" maxlength="12"
                      value="${esc(getLocal(K_DEVICE_LABEL))}" placeholder="例：父、母"></div>
             <div class="set-row"><span class="lab">この端末は</span>
               <select id="deviceRole">
                 <option value=""${getLocal(K_ROLE) ? '' : ' selected'}>未選択</option>
                 <option value="child"${getLocal(K_ROLE) === 'child' ? ' selected' : ''}>子どもの端末</option>
                 <option value="parent"${getLocal(K_ROLE) === 'parent' ? ' selected' : ''}>保護者の端末</option>
               </select></div>
             <details class="set-advanced sync-help" data-details-key="deviceOwnHelp">
               <summary>呼び名と役割のくわしい説明</summary>
               <div class="set-advanced-body">
                 <p class="set-note">呼び名と役割は、この端末で決めます。共有中は、ほかの端末の一覧にも見分けるための情報として表示されますが、ほかの端末から変更されることはありません。</p>
                 <p class="set-note">呼び名は、共有中の端末一覧で見分けるための名前です（父、母など）。未設定のときは「${esc(deviceKindLabel(navigator.userAgent, navigator.maxTouchPoints))}」のように端末の種類で表示されます。ブラウザは機種名（iPhone SE など）までは通知しないため、細かく分けたいときは呼び名を入れてください。</p>
                 <p class="set-note">この端末を使う人を選ぶと、共有中は保護者ページの記録に「誰が入力したか」が小さく表示されます。「保護者の端末」を選ぶと、「アプリの設定」の「記録の手入れ」で1件ずつ削除できるように設定できます。</p>
               </div>
             </details>
           </div>
           <h3 class="sync-subhead">共有を解除する</h3>
           <p class="set-note">この端末だけを共有から外します。ほかの端末や記録はそのまま残ります。この端末をもう一度参加させるには、合言葉を入力し直してください。</p>
           <div class="set-actions">
             <button class="btn btn-sm btn-danger" id="syncOff" type="button">共有を解除する</button>
           </div>
        </div>
      </details>` : ''}
    </div>
  </section>`;
}

/* 保護者ページの すすみぐあい。
   数字を 5つ ならべると 折り返しが 半端に なり、くらべにくい。
   子ども画面と 同じ バーで そろえ、上から下へ 目で 追えるようにする。 */
/* inner … 全体の 行だけ、内わけ（必須の ぶん）を 上に かさねる。

   3本を 色の 濃さだけで 分けると、「全体」と「つぎに やる」が
   おなじ うすい緑に なって 見分けが つかない。かといって 全体に
   別の 濃さを あてると、子ども画面の うすい層と ずれる。
   そこで 色では なく **かたち**で 分ける。全体の 行は 子ども画面の
   バーを そのまま 持ちこむ（うすい＝ぜんぶ／こい＝かならず やる）。
   3本が「全体 ＝ 必須 ＋ つぎに やる」と 読めるように なる。 */
function pstatRow(label, pct, count, kind, inner){
  const p = clamp(Number(pct) || 0, 0, 100);
  const q = clamp(Number(inner) || 0, 0, 100);
  return `
    <div class="pstat-row">
      <span class="pstat-row-lab">${esc(label)}</span>
      <div class="bar"><div class="bar-fill pstat-fill--${kind}" style="width:${p.toFixed(1)}%"></div>${
        inner === undefined ? '' :
        `<div class="bar-fill pstat-fill--inner" style="width:${q.toFixed(1)}%"></div>`}</div>
      <span class="pstat-row-num">${Math.round(p)}<small>%</small>${
        count ? `<small class="pstat-row-cnt">${esc(count)}</small>` : ''}</span>
    </div>`;
}

/* 消した記録のひかえ。保護者ページにだけ出す。
   子ども画面には出さない（消したことを蒸し返さないため）。
   データ自体は同期するので、子の端末で消した中身もここに出る */
function trashSectionHTML(){
  const rows = (state.trash || []).slice(0, 20);
  if(!rows.length) return '';
  const kindLabel = { book:'本の記録' };
  return `
  <section class="sec">
    <div class="sec-head"><h2>消した記録</h2><span class="sec-note">${rows.length}件</span></div>
    <details class="paper set-advanced">
      <summary>消した中身を見る</summary>
      <div class="set-advanced-body">
        <p class="set-note">削除ボタンで消した記録の控えです。新しい順に最大${TRASH_MAX}件まで残り、あふれた分から消えます。冊数などの数字は戻したままで、ここから元に戻すことはできません。</p>
        ${rows.map(r=>`
        <div class="trash-row">
          <div class="trash-head">
            <span class="trash-kind">${esc(kindLabel[r.kind] || r.kind || '記録')}</span>
            <span class="trash-at">${esc(fmtDate(new Date(r.at)))} ${esc(fmtTime(new Date(r.at)))}</span>
            ${logByLabel(r) ? `<span class="trash-by">${esc(logByLabel(r))}</span>` : ''}
          </div>
          <div class="trash-title">${esc(r.title || '')}</div>
          ${r.text ? `<div class="trash-text">${esc(r.text)}</div>` : ''}
        </div>`).join('')}
      </div>
    </details>
  </section>`;
}

/* 同期で 値が 入れかわった ところの ひかえ（調べもの用）。
   「こちらの値・その時刻」と「相手の値・その時刻」、どちらが 勝ったかを 出す。
   端末の 中だけに のこり、外へは 送らない */
function syncTraceHTML(){
  const rows = traceRead();
  const t = ms => ms ? fmtTime(new Date(ms)) + ':' + pad2(new Date(ms).getSeconds()) : '（なし）';
  return `
  <section class="sec config-sec config-sec--quiet">
    <details class="paper set-advanced">
      <summary>デバッグ用：同期の記録（${rows.length}件）</summary>
      <div class="set-advanced-body">
        <p class="set-note">開発者向けの記録です。通常の利用では触る必要はありません。記録が元に戻ってしまうときに、どちらの端末のどの値が採用されたかを調べるために使います。この端末の中だけに残り、外へは送りません。</p>
        <div class="set-actions">
          <button class="btn btn-sm" id="traceCopy" type="button">コピー</button>
          <button class="btn btn-sm btn-ghost" id="traceClear" type="button">消す</button>
        </div>
        ${rows.length ? '<div class="trace-list">' + rows.map(r=>{
          const me  = deviceLabelOf(r.meId)  || 'この端末';
          const you = deviceLabelOf(r.youId) || 'もう一方の端末';
          return `
          <div class="trace-row">
            <div class="trace-head">${esc(fmtTime(new Date(r.at)))} ・ ${esc(r.id)} の ${esc(r.f)}</div>
            <div class="trace-body">${esc(me)}：<b>${esc(String(r.mine))}</b>（${esc(t(typeof r.mineAt === 'number' ? r.mineAt : 0))}）
            ／ ${esc(you)}：<b>${esc(String(r.theirs))}</b>（${esc(t(typeof r.theirsAt === 'number' ? r.theirsAt : 0))}）
            → のこった値：<b>${esc(String(r.won))}</b></div>
          </div>`; }).join('') + '</div>'
        : '<p class="set-empty">まだ ありません。</p>'}
      </div>
    </details>
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
          <span class="book-no">${bookOrdinal(b.nth, true)}</span>
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
      <span class="lab">${isSheetCount(t) ? '何' + esc(unitAdult(t.unit||'まい')) + '目までやった？' : 'どこまで やった？'}</span>
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
    const max = 5;
    const more = p.done > max ? p.done : '';
    body += `
    <div class="field">
      <span class="lab">きょうは どのくらい できた？</span>
      <p class="hint">1日の めあては ${p.total}${esc(t.targetUnit||'')}だよ。</p>
      <div class="tally" id="tally">
        ${Array.from({length:max+1},(_,i)=>
          `<button class="tally-btn${i===sheetSel?' sel':''}" data-n="${i}" type="button">${i}</button>`).join('')}
      </div>
      <label class="daily-more" for="dailyMore">
        <span class="daily-more-label">${esc(dailyMorePrompt(t))}</span>
        <input id="dailyMore" type="number" inputmode="numeric" min="6" max="99" value="${more}" placeholder="6" aria-label="${esc(dailyMorePrompt(t))}">
        <span class="daily-more-unit">${esc(t.targetUnit||'かい')}</span>
      </label>
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
    <p class="mic-note">${micNoteHTML()}</p>
  </div>`;

  $('#sheetTitle').textContent = t.name;
  $('#sheetBody').innerHTML = body;
  $('#sheetBody').scrollTop = 0;
  $('#sheetWrap').hidden = false;
  applyReadingDisplay($('#sheetWrap'));
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
  <p class="book-nth"><strong>${bookOrdinal(nth)}の本</strong></p>

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
  applyReadingDisplay($('#sheetWrap'));
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
      <p class="hint">${esc(t.freeHint || FREE_HINT_DEFAULT)}</p>
      <div class="mic-row">
        <textarea id="freeMemo" rows="6" placeholder="かいてみよう"></textarea>
        ${micBtn('freeMemo')}
      </div>
      <p class="mic-note">${micNoteHTML()}</p>
    </div>
    ${freeTodayHTML(t)}`;
  $('#sheetSave').textContent = 'かけた！';
  $('#sheetBody').scrollTop = 0;
  $('#sheetWrap').hidden = false;
  applyReadingDisplay($('#sheetWrap'));
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
  progPatch(t.id, { days });

  state.logs.push({
    id: 'l' + now.getTime() + Math.floor(Math.random()*1000),
    at: now.toISOString(), by: logBy(), taskId: t.id, name: t.name,
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
    progPatch(t.id, { done: rec.nth });
    state.logs.push({
      id: 'l' + now.getTime() + Math.floor(Math.random()*1000),
      at: now.toISOString(), by: logBy(), taskId: t.id, name: t.name,
      what: rec.nth + '冊　「' + title + '」',
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
    return `<button class="${cls}" data-n="${n}" type="button">${countUsesCircle(t) ? maru(n) : n}</button>`;
  }).join('');
}
function selSayText(t, sel){
  if(!sel) return 'まだ ひとつも やっていない';
  const label = countUsesCircle(t) ? maru(sel) : sel + (t.unit||'');
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
  const moreInput = $('#dailyMore');
  const dailySelection = dailyCountSelection(sheetSel, moreInput && moreInput.value);
  const hasAnswer = $$('#sheetBody [data-q]').some(el=>el.value.trim());
  const hasSelection = t.type === 'count' ? (sheetSel|0) > 0
    : t.type === 'step' ? !!(sheetSteps && sheetSteps.some(Boolean))
    : dailySelection > 0;
  const hasWrapSelection = !!(sheetWrap && sheetWrap.some(Boolean));
  /* 何も選ばずに保存しても 0/6 の訂正ログを作らない。
     そのような空ログが「できた！」の回数を増やすことも防ぐ。

     ただし **すでに 記録が ある ものを 0 に もどす**のは、
     まちがえて 押した ぶんの 取り消しであって「空の保存」ではない。
     以前は ここで まとめて 止めていたので、1回でも 押して しまうと
     二度と 0 に もどせなかった。記録が ある ときだけ 聞いて 通す。 */
  const hadValue = (p.done | 0) > 0;
  if(!hasSelection && !hasWrapSelection && !memo && !hasAnswer){
    if(!hadValue){
      toast('やったところを えらんでね');
      return;
    }
    if(!confirm('きょうは やらなかったことに しますか？\n' +
                'いまの きろく（' + p.text + '）を 0 に もどします。')) return;
  }
  const now = new Date();
  let what = '';
  let ok = true;

  if(t.type === 'count'){
    const before = p.done;
    const after = clamp(sheetSel|0, 0, t.total|0);
    progPatch(t.id, { done: after });
    if(after > before){
      what = countUsesCircle(t)
        ? maru(before+1) + (after>before+1 ? '〜'+maru(after) : '') + ' できた'
        : (before+1) + (after>before+1 ? '〜'+after : '') + (t.unit||'') + ' できた';
    }else if(after < before){
      what = (countUsesCircle(t) ? maru(after) : after+(t.unit||'')) + ' まで に なおした';
    }else{
      what = 'すすみは そのまま';
    }
  }
  else if(t.type === 'step'){
    const before = (p.arr||[]);
    const added = (t.steps||[]).filter((s,i)=> sheetSteps[i] && !before[i]);
    progPatch(t.id, { steps: sheetSteps.slice() });
    what = added.length ? added.join('・') + ' が できた'
                        : (sheetSteps.filter(Boolean).length + '/' + (t.steps||[]).length + ' に なおした');
    ok = true;
  }
  else {
    const n = clamp(dailySelection, 0, 99);
    const days = Object.assign({}, (state.progress[t.id]||{}).days || {});
    days[dayKey(now)] = n;
    progPatch(t.id, { days });
    /* 0 は「できた」ではない。取り消したことが 記録に のこるようにする */
    what = n > 0 ? n + (t.targetUnit||'かい') + ' できた'
                 : 'きょうは やらなかったことに した';
  }

  // さいごの しあげ。done / steps とは べつに のこす
  if(hasWrap(t) && sheetWrap){
    const added = WRAP_LABELS.filter((s,i)=> sheetWrap[i] && !p.wrap[i]);
    progPatch(t.id, { wrap: sheetWrap.slice() });
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
    at: now.toISOString(), by: logBy(),
    taskId: t.id, name: t.name, what, memo: fullMemo
  });
  if(state.logs.length > 3000) state.logs = state.logs.slice(-3000);
  saveSt();

  const after = prog(t);
  closeSheet();
  /* 取り消し（0 にもどした）ときに「できた！」の はんこは 出さない。
     押しまちがいを 直しに 来た人に、できたと 言わない */
  if((after.done | 0) === 0 && hadValue) toast('0 に もどしました');
  else stamp(after.isDone ? 'ぜんぶ できた！' : 'できた！');
  setTimeout(()=> render({ keepScroll:true }), 60);
  return ok;
}

/* --- こえ入力 --- */
let sr = null;
function hasSR(){ return !!(window.SpeechRecognition || window.webkitSpeechRecognition); }
function micNoteHTML(){
  if(!hasSR()) return 'キーボードの 🎤 マークを おすと、こえで かけるよ。';
  return '🎤 を おすと こえで かけるよ。'
    + '<span class="mic-permission-help">確認が毎回出るときは、SafariのWebサイト設定で「マイク」を「許可」にしてください。</span>';
}
function micBtn(id){
  if(!hasSR()) return '';
  return `<button class="mic" data-mic="${id}" type="button" aria-label="こえで 入れる" aria-pressed="false">🎤</button>`;
}
function finishSR(session, btn){
  if(sr === session) sr = null;
  if(btn){ btn.classList.remove('rec'); btn.setAttribute('aria-pressed', 'false'); }
}
function srErrorMessage(code){
  if(code === 'not-allowed' || code === 'service-not-allowed'){
    return 'マイクを使えません。SafariのWebサイト設定で、マイクを「許可」にしてください。';
  }
  if(code === 'audio-capture') return 'マイクが見つかりません。端末のマイク設定を確認してください。';
  if(code === 'network') return '音声入力に接続できません。通信を確認して、もう一度おしてください。';
  if(code === 'no-speech') return 'こえが きこえなかったよ。マイクに近づいて、もう一度おしてね。';
  if(code === 'aborted') return '音声入力が中断されました。もう一度おすと再開できます。';
  return '音声入力を終えました。もう一度おすと再開できます。';
}
function startSR(btn, targetEl){
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  stopSR();
  try{
    const session = new SR();
    let gotResult = false, hadError = false;
    session._manualStop = false;
    sr = session;
    session.lang = 'ja-JP'; session.interimResults = false; session.continuous = false;
    session.onstart = ()=>{
      if(sr !== session) return;
      btn.classList.add('rec');
      btn.setAttribute('aria-pressed', 'true');
    };
    session.onresult = e=>{
      if(sr !== session) return;
      const txt = Array.from(e.results).map(r=>r[0].transcript).join('');
      gotResult = !!txt;
      targetEl.value = (targetEl.value ? targetEl.value + ' ' : '') + txt;
      targetEl.dispatchEvent(new Event('input', { bubbles:true }));
    };
    session.onerror = e=>{
      if(sr !== session) return;
      hadError = true;
      const manual = !!session._manualStop;
      const code = String(e && e.error || '');
      finishSR(session, btn);
      if(!manual) toast(srErrorMessage(code));
    };
    session.onend = ()=>{
      if(sr !== session) return;
      const manual = !!session._manualStop;
      finishSR(session, btn);
      if(!manual && !gotResult && !hadError) toast(srErrorMessage('no-speech'));
    };
    session.start();
    btn.classList.add('rec');
    btn.setAttribute('aria-pressed', 'true');
  }catch(e){
    sr = null;
    btn.classList.remove('rec');
    btn.setAttribute('aria-pressed', 'false');
    toast('音声入力を始められません。少し待って、もう一度おしてください。');
  }
}
function stopSR(){
  const active = sr;
  sr = null;
  if(active){
    active._manualStop = true;
    try{ typeof active.abort === 'function' ? active.abort() : active.stop(); }catch(e){}
  }
  $$('.mic.rec').forEach(b=>{ b.classList.remove('rec'); b.setAttribute('aria-pressed', 'false'); });
}

/* ---------------------------------------------------------
   えがく
   --------------------------------------------------------- */
/* スクロールするのは #scroll の中だけ。ページ自体は 動かさない。
   古い作りの画面でも こわれないよう、見つからなければ ページに もどす */
function scrollBox(){ return $('#scroll') || document.scrollingElement || document.documentElement; }

/* keepScroll: 今の位置のまま描き直す。タブを変えたときだけ先頭に戻す */
function render(opts){
  const keepScroll = !!(opts && opts.keepScroll);
  const y = scrollBox().scrollTop;
  /* 同期の到着などで画面を描き直しても、保護者が入力途中の内容を
     消さない。保存前のメッセージ、サマリー、チェックの状態も含めて
     同じ id の欄へ戻す。 */
  const formDraft = captureFormDraft();
  const openDetails = captureOpenDetails();

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
  else if(tab === 'tasks')    v.innerHTML = viewTasks();
  else if(tab === 'config')   v.innerHTML = viewConfig();
  else                        v.innerHTML = viewParent();

  restoreFormDraft(formDraft);
  restoreOpenDetails(openDetails);

  $$('.tab').forEach(b=> b.classList.toggle('is-on', b.dataset.tab === tab));
  // 子ども画面以外ではタブバーを隠す（それぞれ「もどる」で戻す）
  const noTabs = (tab !== 'home' && tab !== 'log' && tab !== 'calendar');
  $('.tabbar').hidden = noTabs;
  document.body.classList.toggle('no-tabbar', noTabs);
  /* 保護者ページと設定は、大人が読む画面。見出しの見え方をそろえるために印をつける */
  document.body.classList.toggle('adult-view', isAdultTab(tab));

  if(tab === 'home'){
    renderCountdown();
    timer = setInterval(renderCountdown, 1000);
  }
  if(tab === 'welcome')  bindWelcome();
  if(tab === 'stats')    bindStats();
  if(tab === 'settings'){ bindParent(); bindSync(); }
  if(isAdultTab(tab)) bindAdultNav();
  if(tab === 'tasks' || tab === 'config') bindConfig();
  scrollBox().scrollTop = keepScroll ? y : 0;
  applyReadingDisplay();
  jumpToSection();
}

/* 設定ページは 長い。「共有設定を開きますか？」から 来たのに
   いちばん上に 出されると、目あての 欄を さがすことに なる。
   飛び先を ここに 預けて、描き直した あとで 1回だけ そこへ 寄せる。

   ページ全体では なく #scroll だけが 動くので、scrollIntoView では なく
   scrollTop を 自分で 足す（「画面の作り」の 前提）。 */
let pendingJump = '';
function jumpTo(sel){ pendingJump = sel; }
function jumpToSection(){
  if(!pendingJump) return;
  const sel = pendingJump;
  pendingJump = '';
  /* 1回 寄せて 終わりに できない。漢字の ふりわけ（kuromoji）は あとから
     終わるので、寄せた あとに 上の 中身が のびて、目あての 欄が
     画面の 下へ 押し出される（実際に 450px ほど ずれた）。
     落ちつくまで 短いあいだ 追いかけ、2回 続けて 合っていれば やめる。 */
  let tries = 0, stable = 0;
  const settle = ()=>{
    const el = $(sel);
    if(!el) return;
    const box = scrollBox();
    /* 目あての 位置は「画面の 上」では なく「#scroll の 上」。
       #scroll は 上帯の 下（57px あたり）から 始まるので、画面の 上を
       ねらうと 見出しが 上帯の 裏に かくれる */
    const top = box.getBoundingClientRect ? box.getBoundingClientRect().top : 0;
    const gap = el.getBoundingClientRect().top - top - 12;
    if(Math.abs(gap) <= 1){
      if(++stable >= 2) return;
    }else{
      stable = 0;
      box.scrollTop = Math.max(0, box.scrollTop + gap);
    }
    if(++tries < 10) setTimeout(settle, 60);
  };
  settle();
}

/* 折りたたみの 開け閉めは、描き直すと 元に もどってしまう。
   同期が とどくたびに 閉じると 中を 読めないので、開いていた ものを おぼえておく。
   id が 無い ものは 見出しの 文字で 見わける */
/* 描き直しの前後で「同じ折りたたみ」と言えるための鍵。
   見出しの文字を鍵にすると、**同じ名前の項目が すべて 巻きぞえで 開く**。
   毎日の項目は 既定の名前が「おてつだい」なので、2つ足しただけで 起きる。
   利用者からは「順番を 入れかえると 下の項目が 展開される」と 見える。
   数えた番号（idx:）も、並べかえで ずれるので 鍵にできない。
   中身で 見分けが つくものは `data-details-key` を 付けること */
function detailsKey(d, i){
  const s = d.querySelector('summary');
  return d.dataset.detailsKey ? 'key:' + d.dataset.detailsKey
    : (d.id || (s ? 'sum:' + s.textContent.trim() : 'idx:' + i));
}
function captureOpenDetails(){
  const out = {};
  $$('#view details').forEach((d,i)=>{ if(d.open) out[detailsKey(d, i)] = true; });
  return out;
}
function restoreOpenDetails(map){
  if(!map) return;
  $$('#view details').forEach((d,i)=>{ if(map[detailsKey(d, i)]) d.open = true; });
}

/* 描き直しを またいで、入力とちゅうの 内容を 消さない しくみ。

   読み取り専用の 欄は のぞく。そこに 出ているのは 人が 打った ものでは
   なく、アプリが 入れた 値。もどすと **アプリが たった今 入れ直した 値を、
   ひとつ 前の 値で 上書きして しまう**。 */
function captureFormDraft(){
  const out = {};
  $$('#view input[id], #view textarea[id], #view select[id]').forEach(el=>{
    if(el.type === 'file' || el.readOnly || el.disabled) return;
    out[el.id] = (el.type === 'checkbox' || el.type === 'radio')
      ? { checked:el.checked, type:el.type }
      : { value:el.value, type:el.type };
  });
  return out;
}
function restoreFormDraft(draft){
  Object.entries(draft || {}).forEach(([id, saved])=>{
    const el = document.getElementById(id);
    if(!el || el.type === 'file' || el.readOnly || el.disabled) return;
    if(saved.type === 'checkbox' || saved.type === 'radio') el.checked = !!saved.checked;
    else el.value = saved.value;
  });
}

/* 設定は「この端末」「おうちの宿題」「まいにち」に分ける。
   内部の type / recordStyle は旧データ互換のため変えない。 */
function themeChoicesHTML(fieldName, selected){
  const name = fieldName || 'theme';
  const current = THEME_IDS.includes(selected) ? selected
    : (THEME_IDS.includes(config.theme) ? config.theme : 'notebook');
  return THEMES.map(t=>`
    <label class="theme-choice theme-choice--${t.id}">
      <input type="radio" name="${esc(name)}" value="${t.id}"${t.id===current?' checked':''}>
      <span class="theme-swatch" aria-hidden="true"><i></i><i></i><i></i></span>
      <span class="theme-name">${esc(t.name)}</span>
      <small>${esc(t.note)}</small>
    </label>`).join('');
}

/* 単位は 子ども画面の 見え方に あわせて ひらがなで もっている。
   保護者ページと 設定では 大人向けの 漢字に 読みかえて 出す。
   もとの データは 変えない（子ども画面は これまで どおり） */
const ADULT_UNIT = { ばん:'番', まい:'枚', さつ:'冊', かい:'回', こ:'個', ページ:'ページ', ぷん:'分', ふん:'分' };
function unitAdult(u){
  const s = String(u || '').trim();
  return ADULT_UNIT[s] || s;
}

/* 進捗の 文字（14/14ばん など）の 単位だけを 大人向けに 読みかえる。
   prog() の text は 子ども画面でも つかうので、ここでは 作り直す */
function adultText(t, p){
  if(isBook(t))            return p.done + '/' + p.total + '冊';
  if(t.type === 'daily')   return p.done + '/' + p.total + unitAdult(t.unit);
  if(t.type === 'step')    return p.done + '/' + p.total;
  return p.done + '/' + p.total + unitAdult(t.unit);
}

function taskSummary(t){
  if(isBook(t)) return `${Math.max(1,t.total|0)}冊`;
  if(t.group === 'daily') return isFree(t) ? '文章で記録' : `1日 ${Math.max(1,t.target|0)}${esc(unitAdult(t.targetUnit))}`;
  if(t.type === 'step') return `${(t.steps||[]).length}段階`;
  return `${Math.max(1,t.total|0)}${esc(unitAdult(t.unit))}`;
}

function taskEditorRow(t, i){
  const opt = (v,cur,label) => `<option value="${v}"${v===cur?' selected':''}>${label}</option>`;
  const kind = taskKind(t);
  const unitMode = dailyUnitPreset(t.targetUnit||'');
  const bf = bookFields(t);
  const groupField = kind === 'daily' ? '' : `
    <label class="set-field"><span>表示する場所</span><select data-f="group">
      ${opt('must',t.group,'必ず行う')}${opt('option',t.group,'次に行う')}
    </select></label>`;

  let fields = '';
  if(kind === 'book'){
    fields = `${groupField}
      <label class="set-field"><span>目標の冊数</span><span class="set-inline"><input type="number" data-f="total" min="1" max="200" value="${t.total|0}"><b>冊</b></span></label>
      <fieldset class="set-field set-field--wide set-checks"><legend>本ごとに残す項目</legend>
        <label><input type="checkbox" data-bf="author"${bf.author?' checked':''}> 作者</label>
        <label><input type="checkbox" data-bf="publisher"${bf.publisher?' checked':''}> 出版社</label>
        <label><input type="checkbox" data-bf="rating"${bf.rating?' checked':''}> おすすめ度</label>
      </fieldset>
      <p class="set-help set-field--wide">本の名前・読んだ日・一言を1冊ずつ残します。</p>`;
  }else if(kind === 'daily'){
    fields = `
      <label class="set-field"><span>記録方法</span><select data-f="recordStyle">
        ${opt('',t.recordStyle||'','数で記録')}${opt('free',t.recordStyle||'','文章で記録')}
      </select></label>
      ${!isFree(t) ? `
        <label class="set-field"><span>1日の目標</span><input type="number" data-f="target" min="1" max="999" value="${t.target|0}"></label>
        <label class="set-field"><span>単位</span><select data-f="targetUnitPreset">
          ${DAILY_UNIT_PRESETS.map(u=>opt(u,unitMode,u)).join('')}${opt('custom',unitMode,'そのほか（自由）')}
        </select></label>
        ${unitMode==='custom' ? `<label class="set-field"><span>単位を入力</span><input type="text" data-f="targetUnitCustom" maxlength="8" value="${esc(t.targetUnit||'')}"></label>` : ''}
      ` : `
        <label class="set-field set-field--wide"><span>子どもへの呼びかけ</span>
          <input type="text" data-f="freeHint" value="${esc(t.freeHint||'')}" placeholder="${esc(FREE_HINT_DEFAULT)}"></label>`}
      <label class="set-field set-field--wide"><span>${isFree(t)?'見出し':'メモ欄の見出し'}</span>
        <input type="text" data-f="memoLabel" value="${esc(t.memoLabel||'')}" placeholder="やったことを書く"></label>`;
  }else{
    fields = `${groupField}
      <label class="set-field"><span>進め方</span><select data-f="type">
        ${opt('count',t.type,'回数・ページで進める')}${opt('step',t.type,'段階をクリア')}
      </select></label>
      ${t.type==='count' ? `
        <label class="set-field"><span>合計</span><input type="number" data-f="total" min="1" max="200" value="${t.total|0}"></label>
        <label class="set-field"><span>単位</span><input type="text" data-f="unit" maxlength="8" value="${esc(t.unit||'')}"></label>
        <label class="set-field set-check"><input type="checkbox" data-f="numbered"${t.numbered?' checked':''}> 次の番号を①②で表示</label>` : `
        <label class="set-field set-field--wide"><span>段階（1行に1つ）</span>
          <textarea data-f="steps" rows="${Math.max(3,(t.steps||[]).length)}">${esc((t.steps||[]).join('\n'))}</textarea></label>`}
      <label class="set-field set-field--wide set-check"><input type="checkbox" data-f="wrapUp"${t.wrapUp?' checked':''}> 「丸付け・直し」の項目を表示</label>
      <label class="set-field set-field--wide"><span>記録するときの質問（任意）</span>
        <textarea data-f="questions" rows="3" placeholder="葉っぱの形や色は？">${esc((t.questions||[]).join('\n'))}</textarea></label>
      <label class="set-field set-field--wide"><span>メモ欄の見出し</span>
        <input type="text" data-f="memoLabel" value="${esc(t.memoLabel||'')}" placeholder="やったことを書く"></label>`;
  }

  const label = kind === 'book' ? '読書' : (kind === 'daily' ? '毎日' : (t.type === 'step' ? '段階' : '数'));
  return `<details class="set-task" data-i="${i}" data-details-key="task:${esc(t.id)}"${t.id===openConfigTaskId?' open':''}>
    <summary class="set-task-summary"><span class="set-kind set-kind--${kind}">${label}</span>
      <strong>${esc(t.name)}</strong><span class="set-task-meta">${taskSummary(t)}</span>
      <span class="set-task-move" aria-label="${esc(t.name)}の順番を変える">
        <button class="set-task-move-btn" data-move="-1" type="button" aria-label="${esc(t.name)}を上へ移動">▲</button>
        <button class="set-task-move-btn" data-move="1" type="button" aria-label="${esc(t.name)}を下へ移動">▼</button>
      </span></summary>
    <div class="set-task-body">
      <label class="set-field set-field--wide"><span>項目の名前</span><input type="text" data-f="name" maxlength="60" value="${esc(t.name)}"></label>
      <div class="set-grid">${fields}</div>
      <div class="set-task-actions">
        <button class="btn btn-sm btn-danger btn-icon-text" data-del="1" type="button" aria-label="${esc(t.name)}を削除">${icon('trash')}<span>削除</span></button>
      </div>
    </div>
  </details>`;
}

function taskGroupHTML(rows, empty){
  return rows.length ? rows.map(({t,i})=>taskEditorRow(t,i)).join('') : `<p class="set-empty">${esc(empty)}</p>`;
}

/* 宿題の欄は4つとも この1つの型で 組む。
   案内（必要な欄だけ）→（毎日の項目だけ スイッチ）→ 一覧 → 追加ボタン、の順。

   追加ボタンを 紙の中の いちばん下に 置くのは、押したとき どの欄に
   足されるのかを ボタンの 居場所そのもので 示すため。
   前は「必ず行う宿題」の 紙の外に 1つだけ 出ていて、しかも 押すと
   「次に行う宿題」に 足されていた。見えている場所と 足される場所が
   ちがうと、どう直せばよいか 画面から 読みとれない。 */
function taskSectionHTML(o){
  return `
  <section class="sec config-sec">
    <div class="sec-head"><h2>${esc(o.title)}</h2><span class="sec-note">${o.rows.length}件</span></div>
    <div class="paper task-settings">
      ${o.head || ''}
      ${o.note ? `<p class="config-section-note">${esc(o.note)}</p>` : ''}
      <div class="task-editor" id="${o.editorId}">${taskGroupHTML(o.rows, o.empty)}</div>
      <div class="set-actions"><button class="btn btn-sm btn-icon-text" id="${o.addId}" type="button">${icon('plus')}<span>${esc(o.addLabel)}</span></button></div>
    </div>
  </section>`;
}

/* 保護者ページの 使い方の 案内。
   ずっと 出していると 画面の 上ばかり とるので、読んだら 消せるように する。
   消した ことは この端末に だけ のこす（グループの 設定に 入れると、
   1台で 消しただけで 全部の 端末から 消える）。 */
const K_GUIDE_DONE = TEST_MODE ? 'natsu.preview.guide.parent.v1' : 'natsu.guide.parent.v1';
function parentChildGuideHTML(){
  if(getLocal(K_GUIDE_DONE) === 'done') return '';
  return `
  <aside class="paper parent-child-guide">
    <div class="parent-child-guide-body">
      <h2>保護者の方へ</h2>
      <p>お子さんの誤操作などで記録の修正が必要になったときは、「子ども画面へ」から、子どもが見ている画面を開いてください。進捗の修正は、子ども画面で該当する項目を開いて行います。</p>
    </div>
    <button class="btn btn-sm" id="parentGuideOk" type="button">OK</button>
  </aside>`;
}

/* 大人向けの3ページを行き来する帯。
   下の .tabbar は 子ども画面 専用なので つかえない（render() の noTabs）。
   position:fixed / sticky は 3層レイアウトを 壊すので つかわない。
   #view の 中を ふつうに 流す。

   role="tab" ではなく ふつうの <a> ＋ aria-current。
   ここは ハッシュを 変えて #view ごと 描き直す 本物の 画面遷移で、
   tabpanel が 常設されない。role="tab" を 名乗ると aria-controls・
   矢印キー・roving tabindex が 要るのに、得られるものが 無い。
   <a> なら フォーカスも「戻る」も ブラウザ任せで 正しく 動く。 */
const ADULT_PAGES = [
  { tab:'settings', href:'#settings', short:'進捗',   title:'保護者用ページ' },
  { tab:'tasks',    href:'#tasks',    short:'宿題',   title:'宿題を決める' },
  { tab:'config',   href:'#config',   short:'設定',   title:'アプリの設定' }
];
function adultNavHTML(current){
  return `
  <nav class="pagenav" aria-label="保護者向けのページ">
    ${ADULT_PAGES.map(p=>`<a class="pagenav-item" href="${p.href}"${
      p.tab === current ? ' aria-current="page"' : ''}>${esc(p.short)}</a>`).join('')}
    <a class="pagenav-child" id="openChildPage" href="#home">子ども画面へ</a>
  </nav>`;
}
function adultHeadHTML(current, lead){
  const page = ADULT_PAGES.find(p=>p.tab === current) || ADULT_PAGES[0];
  return `
  ${adultNavHTML(current)}
  <div class="paper parent-head config-head"><div><h2>${esc(page.title)}</h2><p>${esc(lead)}</p></div>
    <span class="autosave" aria-live="polite">自動保存</span></div>`;
}

/* 宿題そのものを決めるページ。
   「必ず行う」「次に行う」は 独立した 欄では なく、課題ごとの group。
   ならべかえの まとまり（taskOrderBucket）も group 単位なので、
   画面も 分けた ほうが 実際の 動きと そろう。 */
function viewTasks(){
  const rows = config.tasks.map((t,i)=>({t,i}));
  const must   = rows.filter(({t})=>taskKind(t)==='normal' && t.group === 'must');
  const option = rows.filter(({t})=>taskKind(t)==='normal' && t.group !== 'must');
  const books  = rows.filter(({t})=>taskKind(t)==='book');
  const daily  = rows.filter(({t})=>taskKind(t)==='daily');
  /* 「子ども画面に表示する」は 毎日の項目 だけの もの。
     ほかの3つには 対応する 切りかえが 無いので、この欄にだけ 足す */
  const dailySwitch = `<label class="daily-switch"><input type="checkbox" id="cfgShowDaily"${config.showDaily?' checked':''}>
        <span><strong>子ども画面に表示する</strong><small>学習アプリ・音読・おてつだい・日記やメモなどに使えます。</small></span></label>`;
  return `
  ${adultHeadHTML('tasks', '変更はすぐに保存されます。')}

  ${taskSectionHTML({
    title:'必ず行う宿題', rows:must, editorId:'mustTaskEditor',
    note:'子ども画面の「かならず やる」に出ます。上へ・下へで順番を変更できます。「表示する場所」を変えると、下の「次に行う宿題」へ移ります。',
    empty:'まだ項目はありません。', addId:'addMustTask', addLabel:'必ず行う宿題を追加' })}

  ${taskSectionHTML({
    title:'次に行う宿題', rows:option, editorId:'optionTaskEditor',
    note:'必ず行う宿題が終わってから取り組む欄です。進みぐあいの判定には数えません。',
    empty:'まだ項目はありません。', addId:'addOptionTask', addLabel:'次に行う宿題を追加' })}

  ${taskSectionHTML({
    title:'読書の記録', rows:books, editorId:'bookTaskEditor',
    note:'本の名前・読んだ日・一言を1冊ずつ残す読書専用の項目です。上へ・下へで順番を変更できます。',
    empty:'読書の記録を使わないときは、空のままで構いません。', addId:'addBookTask', addLabel:'読書を追加' })}

  ${taskSectionHTML({
    title:'毎日の項目', rows:daily, editorId:'dailyTaskEditor', head:dailySwitch,
    empty:'毎日の項目はまだありません。', addId:'addDailyTask', addLabel:'毎日の項目を追加' })}

  ${creditHTML()}
  `;
}

function viewConfig(){
  const openShareSettings = openSyncDetails;
  openSyncDetails = false;
  return `
  ${adultHeadHTML('config', '変更はすぐに保存されます。')}

  <section class="sec config-sec"><div class="sec-head"><h2>名前と画面の設定</h2></div><div class="paper">
    <div class="set-row"><label class="lab" for="cfgChildName">子どもの名前（任意・グループで共有）</label><input type="text" id="cfgChildName" maxlength="30" value="${esc(config.childName||getLocal(K_NAME)||'')}"></div>
    <p class="set-note">入力しなくても使えます。共有中に入力した場合は、保護者・子どもの端末で同じ名前を表示します。</p>
    <div class="set-row"><label class="lab" for="cfgReadingGrade">読める漢字</label><select id="cfgReadingGrade">${readingOptions(readingGrade())}</select></div>
    <p class="set-note">名前と読める漢字は、グループの設定として共有します。保護者の端末で変更すると、子どもの端末の表示も数秒で切り替わります。</p>
    <fieldset class="theme-picker"><legend>色とデザイン（グループで共有）</legend><div class="theme-grid">${themeChoicesHTML()}</div></fieldset>
    <p class="set-note">このページで変更すると、共有中の子ども端末のデザインも変更されます。</p>
  </div></section>

  <section class="sec config-sec"><div class="sec-head"><h2>基本設定</h2></div><div class="paper">
    <div class="set-row"><label class="lab" for="cfgTitle">タイトル</label><input type="text" id="cfgTitle" value="${esc(config.title)}"></div>
    <div class="set-row"><label class="lab" for="cfgStart">開始日</label><input type="datetime-local" id="cfgStart" value="${esc(config.startAt)}"></div>
    <div class="set-row"><label class="lab" for="cfgEnd">終了日</label><input type="datetime-local" id="cfgEnd" value="${esc(config.endAt)}"></div>
    <p class="set-note">日付はカウントダウンとペースの計算に使います。</p>
  </div></section>

  ${syncSectionHTML({ openDetails:openShareSettings })}

  <section class="sec config-sec"><div class="sec-head"><h2>アプリ情報</h2>
    <span class="sec-note">${appVersionHTML(APP_VER)}</span></div>
    <div class="paper">
      <p class="set-note">この端末は <b>ver ${esc(APP_VER)}</b> を動かしています。
      同期の仕組みはバージョンによって変わるため、<b>共有しているすべての端末を同じバージョンに揃えてください</b>。
      片方が古いままだと、訂正が相手の端末から元に戻されることがあります。</p>
      <div class="set-actions">
        <button class="btn btn-sm" id="appUpdate" type="button">最新に更新する</button>
      </div>
      <p class="set-note">iPad は古い画面を保存しているため、閉じて開き直すだけでは新しくならないことがあります。
      このボタンは、保存された古い画面を使わずに読み直します。記録は消えません。</p>
    </div>
  </section>

  <section class="sec config-sec" id="logCareSection"><div class="sec-head"><h2>記録の手入れ</h2></div>
    <div class="paper log-care-paper">
      <label class="opt-toggle">
        <input type="checkbox" id="allowLogDelete"${config.allowLogDelete ? ' checked' : ''}>
        <span class="opt-toggle-text">
          <b>「やったこと」の削除を有効にする</b>
          <small>誤って付けた記録を「やったこと」の一覧から1件ずつ削除できます。削除しても宿題の進捗の数値は変わらず、元には戻せません。</small>
        </span>
      </label>
      <p class="set-note">削除できるのは「この端末は <b>保護者の端末</b>」を選んだ端末の「やったこと」の一覧からのみです。子どもの端末には削除ボタンを表示しません。進捗の数値は変わりません。</p>
      ${config.allowLogDelete && getLocal(K_ROLE) !== 'parent'
        ? '<p class="set-note dev-warn"><b>この端末は「保護者の端末」に設定されていません。</b>「ほかの端末と共有」→「共有リンク・端末ごとの設定」→「この端末は」で選択してください。</p>'
        : ''}
    </div>
  </section>

  <section class="sec config-sec"><div class="sec-head"><h2>データ管理</h2></div><details class="paper set-advanced"><summary>バックアップと初期化</summary>
    <div class="set-advanced-body"><p class="set-note">記録はこの端末に保存されます。定期的にバックアップすると安心です。</p>
    <div class="set-actions"><button class="btn btn-sm" id="expBtn" type="button">書き出す</button><button class="btn btn-sm" id="impBtn" type="button">読み込む</button><input type="file" id="impFile" accept="application/json,.json" hidden></div>
    <div class="set-actions"><button class="btn btn-sm btn-danger" id="resetCfg" type="button">宿題の項目をすべて消す</button><button class="btn btn-sm btn-danger" id="resetAll" type="button">記録をすべて削除</button></div>
    <p class="set-note">「宿題の項目をすべて消す」は、宿題・読書・毎日の項目を空にします。記録と、名前・デザイン・期間の設定は残ります。</p></div>
  </details></section>

  ${syncTraceHTML()}

  ${creditHTML()}
  `;
}

/* 選んだ学年より難しい漢字を、表示後にひらがなへ直す。
   辞書は選択した端末で一度だけ読み込み、同じ文の変換結果は使い回す。 */
let readingPass = 0;
const readingCache = new Map();
function applyReadingDisplay(targetRoot){
  const grade = readingGrade();
  if(typeof setReadingGrade !== 'function') return;
  setReadingGrade(grade);
  /* 保護者用ページと設定画面は大人が読むため、端末の漢字レベルに
     かかわらず元の漢字表記を保つ。変換するのは子ども向け画面だけ。 */
  if(isAdultTab(tab) || tab === 'stats') return;
  if(grade === 9 || !getLocal(K_READING) || typeof convertForTranscription !== 'function') return;
  const root = targetRoot || $('#view');
  if(!root) return;
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
    const readingBody = readingContextText(body, grade);
    const key = grade + '\u0000' + readingBody;
    const work = readingCache.has(key) ? Promise.resolve(readingCache.get(key))
      : convertForTranscription(readingBody).then(result=>{
          const text = result && result.ok ? result.text : readingBody;
          readingCache.set(key, text);
          return text;
        });
    work.then(text=>{
      if(pass === readingPass && root.contains(node)) node.nodeValue = lead + text + tail;
    }).catch(()=>{});
  });
}

/* 辞書だけでは文脈のない「月」を「つき」と読む。
   曜日の括弧は「げつ」、全ひらがな設定の日付は「がつ」を先に確定する。
   小学1年生以上では「月」「日」が既習なので、日付の漢字をそのまま残す。 */
function readingContextText(body, grade){
  let text = String(body || '').replace(/（([日月火水木金土])）/g,
    (all, day)=>'（' + WD_READING[day] + '）');
  if(Number(grade) === 0) text = text.replace(/(\d{1,2})月(?=\d{1,2}日)/g, '$1がつ');
  return text;
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
    $$('[data-welcome-mode]').forEach(option=>{
      const selected = option === btn;
      option.classList.toggle('is-selected', selected);
      option.setAttribute('aria-pressed', String(selected));
    });
    if(btn.dataset.welcomeMode === 'solo') return openForm('child', false);
    form.innerHTML = welcomeRolePickerHTML();
    form.hidden = false;
    form.scrollIntoView({ behavior:'smooth', block:'nearest' });
    $$('[data-welcome-role]', form).forEach(roleBtn => roleBtn.addEventListener('click', ()=>{
      $$('[data-welcome-role]', form).forEach(option=>{
        const selected = option === roleBtn;
        option.classList.toggle('is-selected', selected);
        option.setAttribute('aria-pressed', String(selected));
      });
      const role = roleBtn.dataset.welcomeRole;
      const roleForm = $('#welcomeRoleForm');
      if(role === 'parent'){
        roleForm.innerHTML = welcomeParentSharePickerHTML(4);
        bindWelcomeParentShare(roleForm, 4);
      }else{
        roleForm.innerHTML = welcomeFormHTML('child', true, 4);
        bindWelcomeStart();
      }
      roleForm.scrollIntoView({ behavior:'smooth', block:'nearest' });
    }));
  }));
  if(DEBUG_WELCOME){
    if(DEBUG_WELCOME_ROLE === 'welcome-parent') bindWelcomeParentShare(form, 3);
    else bindWelcomeStart();
  }
}

function selectWelcomeChoice(buttons, active){
  buttons.forEach(option=>{
    const selected = option === active;
    option.classList.toggle('is-selected', selected);
    option.setAttribute('aria-pressed', String(selected));
  });
}

function bindWelcomeParentShare(root, step){
  const buttons = $$('[data-parent-share]', root);
  buttons.forEach(btn=>btn.addEventListener('click', ()=>{
    selectWelcomeChoice(buttons, btn);
    const out = $('#welcomeParentShareForm', root);
    out.innerHTML = welcomeFormHTML('parent', true, Number(step) + 1, btn.dataset.parentShare);
    bindWelcomeStart();
    out.scrollIntoView({ behavior:'smooth', block:'nearest' });
  }));
}

function bindWelcomeStart(){
  const form = $('#welcomeForm');
  $$('input[name="welcomeTheme"]', form).forEach(input=>{
    if(input.dataset.welcomeBound) return;
    input.dataset.welcomeBound = '1';
    input.addEventListener('change', ()=>{
      if(!THEME_IDS.includes(input.value)) return;
      welcomeThemeChoice = input.value;
      applyTheme(input.value);
    });
  });
  const bindInviteCopy = ()=>{
    const copy = $('#welcomeInviteCopy');
    if(copy) copy.addEventListener('click', ()=>{
      const input = $('#welcomeInviteUrl');
      if(input && input.value) copyPlainText(input.value);
    });
  };
  bindInviteCopy();
  const plans = $$('[data-child-connect]', form);
  plans.forEach(btn=>{
    if(btn.dataset.welcomeBound) return;
    btn.dataset.welcomeBound = '1';
    btn.addEventListener('click', ()=>{
      selectWelcomeChoice(plans, btn);
      const code = cleanCode(($('#welcomeCode') && $('#welcomeCode').value) || '');
      const out = $('#welcomeConnectChoiceForm');
      const planStep = Number(btn.closest('.welcome-step').querySelector('.welcome-num').textContent) || 7;
      out.innerHTML = welcomeParentConnectionPlanHTML(btn.dataset.childConnect, code, planStep + 1);
      bindWelcomeStart();
      out.scrollIntoView({ behavior:'smooth', block:'nearest' });
    });
  });
  /* 自動で作った合言葉を、押した人だけ 手入力に 切りかえる。
     欄を はじめから 書きかえられる ようにすると、短い・覚えやすい
     ＝当てられやすい 合言葉に なりやすいため、ひと手間 はさむ */
  const customBtn = $('#welcomeCodeCustom', form);
  const autoBtn = $('#welcomeCodeAuto', form);
  /* 手入力と おまかせを 行き来する。おまかせに 戻す ときは
     その場で 作り直す（前の 値を 覚えておいて 戻すと、
     手入力の あいだに 見せた 合言葉と ずれる） */
  const setCodeMode = custom=>{
    const input = $('#welcomeCode', form);
    if(!input) return;
    const label = input.closest('.lab');
    input.readOnly = !custom;
    if(custom){
      input.value = '';
      input.placeholder = '8文字以上で入力';
      if(label) label.firstChild.nodeValue = 'このグループの合言葉（自分で決める）';
    }else{
      const S = window.NatsuSync;
      input.value = (S && typeof S.makeCode === 'function') ? S.makeCode() : input.value;
      input.placeholder = '';
      if(label) label.firstChild.nodeValue = 'このグループの合言葉（16文字・おまかせで作成）';
    }
    const warn = $('#welcomeCodeWarn', form);
    if(warn) warn.hidden = !custom;
    if(customBtn) customBtn.hidden = custom;
    if(autoBtn) autoBtn.hidden = !custom;
    if(custom) input.focus();
  };
  if(customBtn && !customBtn.dataset.welcomeBound){
    customBtn.dataset.welcomeBound = '1';
    customBtn.addEventListener('click', ()=> setCodeMode(true));
  }
  if(autoBtn && !autoBtn.dataset.welcomeBound){
    autoBtn.dataset.welcomeBound = '1';
    autoBtn.addEventListener('click', ()=> setCodeMode(false));
  }
  const start = $('#welcomeStart');
  if(!start || start.dataset.welcomeBound) return;
  start.dataset.welcomeBound = '1';
  const codeInput = $('#welcomeCode');
  const joinCheck = $('#welcomeJoinCheck');
  if(joinCheck && codeInput && !joinCheck.dataset.welcomeBound){
    joinCheck.dataset.welcomeBound = '1';
    const status = $('#welcomeJoinStatus');
    const resetVerified = ()=>{
      welcomeJoinVerified = null;
      start.hidden = true;
      const settings = $('#welcomeJoinSettings');
      if(settings) settings.hidden = true;
      if(status) status.textContent = '';
    };
    codeInput.addEventListener('input', resetVerified);
    joinCheck.addEventListener('click', async ()=>{
      const S = window.NatsuSync;
      const code = cleanCode(codeInput.value);
      resetVerified();
      if(code.length < 8){
        if(status) status.textContent = 'あいことばを 8文字以上 入れてください';
        codeInput.focus();
        return;
      }
      if(!S || typeof S.verifyHousehold !== 'function'){
        if(status) status.textContent = '接続の準備を読み込めませんでした。もう一度開いてください。';
        return;
      }
      joinCheck.disabled = true;
      if(status) status.textContent = '接続しています…';
      try{
        /* おためし画面は普段のFirebaseへ触れない。見た目と操作だけを
           確認できるよう、現在のpreview設定を接続先として扱う。 */
        const result = TEST_MODE
          ? { found:true, config:deepCopy(config) }
          : await S.verifyHousehold(code);
        if(cleanCode(codeInput.value) !== code) return;
        if(!result || !result.found){
          if(status) status.textContent = '接続できませんでした。合言葉を確認してください。';
          return;
        }
        if(result.unreadable){
          if(status) status.textContent = unreadableJoinText();
          return;
        }
        const remoteConfig = result.config && typeof result.config === 'object' ? result.config : {};
        welcomeJoinVerified = { code, config:deepCopy(remoteConfig) };
        const remoteName = String(remoteConfig.childName || '').trim();
        const remoteGrade = Number(remoteConfig.readingGrade);
        const remoteTheme = THEME_IDS.includes(remoteConfig.theme) ? remoteConfig.theme : '';
        const nameInput = $('#welcomeName');
        const readingInput = $('#welcomeReading');
        if(nameInput) nameInput.value = remoteName;
        if(readingInput && [0,1,2,9].includes(remoteGrade)) readingInput.value = String(remoteGrade);
        if(remoteTheme && start.dataset.role === 'child'){
          const themeInput = $('input[name="welcomeTheme"][value="' + remoteTheme + '"]', form);
          if(themeInput){
            themeInput.checked = true;
            welcomeThemeChoice = remoteTheme;
            applyTheme(remoteTheme);
          }
        }
        const note = $('#welcomeExistingNote');
        if(note){
          if(start.dataset.role === 'child'){
            note.textContent = remoteName
              ? 'なまえや よめる かんじを かえなくて よければ、そのまま「このグループに参加する」を おしてね。'
              : 'なまえは まだ きまっていないよ（入れなくても いいよ）。下から 入れられるよ。';
          }else{
            note.textContent = remoteName
              ? 'お子さんの名前・漢字の扱いに変更がなければ、そのまま「このグループに参加する」を押してください。'
              : 'お子さんの名前は未設定です（任意入力）。以下から設定できます。';
          }
        }
        const settings = $('#welcomeJoinSettings');
        if(settings) settings.hidden = false;
        start.hidden = false;
        if(status) status.textContent = '接続しました ✓';
      }catch(e){
        if(status) status.textContent = '接続できませんでした。通信と合言葉を確認してください。';
      }finally{
        joinCheck.disabled = false;
      }
    });
  }
  if(codeInput && start.dataset.role === 'parent' && start.dataset.creating === 'yes' && !codeInput.readOnly) codeInput.addEventListener('change', ()=>{
    const setup = $('#welcomeShareSetup');
    if(setup){
      setup.outerHTML = welcomeShareSetupHTML('parent', cleanCode(codeInput.value));
      bindInviteCopy();
    }
  });
  start.addEventListener('click', ()=>{
    const role = start.dataset.role;
    const sharing = start.dataset.sharing === 'yes';
    const name = String($('#welcomeName').value || '').trim();
    const grade = Number($('#welcomeReading').value);
    const S = window.NatsuSync;
    const codeEl = $('#welcomeCode');
    const code = codeEl ? cleanCode(codeEl.value) : '';
    const creating = start.dataset.creating === 'yes';
    const themeEl = $('input[name="welcomeTheme"]:checked', $('#welcomeForm'));
    const chosenTheme = themeEl && THEME_IDS.includes(themeEl.value) ? themeEl.value : config.theme;
    /* 名前は どの 経路でも 任意。すでに ある グループへ 入る ときは、
       まず グループ側の 設定を受け取り、この画面で変えた場合だけ後から反映する。 */
    const joining = sharing && (role === 'child' || !creating);
    if(sharing && !TEST_MODE && S && S.configured() && code.length < 8){ toast('あいことばを 8文字以上 入れてください'); if(codeEl) codeEl.focus(); return; }
    if(joining && !TEST_MODE && (!welcomeJoinVerified || welcomeJoinVerified.code !== code)){
      toast('先に合言葉の接続を確認してください');
      if(codeEl) codeEl.focus();
      return;
    }
    /* おまかせの 合言葉（欄が 読み取り専用の まま）は 確認を 出さない。
       自分で 決めた ときだけ 出す */
    const autoCode = !!(codeEl && codeEl.readOnly);
    if(creating && !autoCode && !TEST_MODE && S && S.configured() && !confirmShareSafety()) return;
    try{ localStorage.removeItem(K_RETIRED_NOTICE); }catch(e){}
    const verifiedConfig = joining && welcomeJoinVerified ? welcomeJoinVerified.config || {} : {};
    if(joining && welcomeJoinVerified && welcomeJoinVerified.config){
      config = normalizeConfig(deepCopy(welcomeJoinVerified.config));
    }
    const devLabel = String(($('#welcomeDeviceLabel') && $('#welcomeDeviceLabel').value) || '')
      .trim().slice(0, 12);
    if(devLabel) setLocal(K_DEVICE_LABEL, devLabel);
    else try{ localStorage.removeItem(K_DEVICE_LABEL); }catch(e){}
    if(name) setLocal(K_NAME, name);
    else try{ localStorage.removeItem(K_NAME); }catch(e){}
    setLocal(K_ROLE, role);
    setLocal(K_READING, grade);
    if(typeof setReadingGrade === 'function') setReadingGrade(grade);
    setLocal(K_ONBOARD, 'done');
    if(!joining) config.readingGrade = grade;   // おうちの設定として 共有する
    if(role === 'child' && THEME_IDS.includes(chosenTheme)){
      setLocal(K_THEME, chosenTheme);
      applyTheme(chosenTheme);
      if(sharing && joining && chosenTheme !== verifiedConfig.theme){
        setLocal(K_WELCOME_THEME, JSON.stringify({ code, theme:chosenTheme }));
      }
      else{
        if(!sharing) config.theme = chosenTheme;
        try{ localStorage.removeItem(K_WELCOME_THEME); }catch(e){}
      }
    }
    const oldName = config.childName;
    const titleWasGenerated = isGeneratedTitle(config.title, oldName);
    if(!joining){
      config.childName = name;
      if(titleWasGenerated) config.title = defaultTitleFor(name);
    }
    if(joining){
      const baseName = String(verifiedConfig.childName || '').trim();
      const baseGrade = Number(verifiedConfig.readingGrade);
      const prefs = {
        hasName: name !== baseName,
        childName: name,
        hasGrade: [0,1,2,9].includes(grade) && grade !== baseGrade,
        readingGrade: grade
      };
      if(prefs.hasName || prefs.hasGrade) setLocal(K_WELCOME_JOIN, JSON.stringify(prefs));
      else try{ localStorage.removeItem(K_WELCOME_JOIN); }catch(e){}
    }else saveCfg();
    if(sharing && !TEST_MODE && S && S.configured()){
      if(typeof S.forgetRevokedCode === 'function') S.forgetRevokedCode();
      forgetConfigStampForNewHousehold(code);
      rememberChosenCode(code);
      /* 参加は「あるグループへ入る」。文書が無かったときに、この端末の
         初期値でグループを作らせない（joining を渡す意味はそこだけ） */
      S.reconnect(code, { joining });
      /* 同じグループを複数の親端末で数えないよう、あいことば由来の匿名IDで重複を除く。 */
      S.registerHousehold(code).catch(()=>{});
    }
    if(role === 'parent' && sharing){
      const form = $('#welcomeForm');
      form.innerHTML = welcomeMessageChoiceHTML(start.dataset.nextStep);
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
    out.textContent = Number(count || 0).toLocaleString('ja-JP') + ' グループ';
  }).catch(()=>{
    out.textContent = '集計を読みこめません';
    note.textContent = 'Firestore のルールに metrics の読み取り許可を追加してください。';
  });
}

/* ---------------------------------------------------------
   せっていの そうさ
   --------------------------------------------------------- */
/* 保護者ページ（進捗一覧）— サマリーの生成と書き出し */
function bindParentShareBadge(){
  const badge = $('#parentShareBadge');
  if(!badge) return;
  badge.onclick = ()=>{
    const S = window.NatsuSync;
    const hasCode = !!(S && S.getCode());
    const message = hasCode
      ? '共有設定を開きますか？\n接続中の端末の確認・追加・解除ができます。'
      : '共有の接続設定を開きますか？\n合言葉を作るか、受け取った合言葉を入力できます。';
    if(!confirm(message)) return;
    openSyncDetails = true;
    jumpTo('#syncSection');
    location.hash = 'config';
  };
}
/* 大人向け3ページに共通の帯。settings 以外でも 子ども画面へ 行けるように、
   render() から どのページでも 呼ぶ */
function bindAdultNav(){
  const openChild = $('#openChildPage');
  if(openChild) openChild.addEventListener('click', e=>{
    e.preventDefault();
    if(confirm('子ども画面へ移動します。\n保護者ページに戻るには、画面上部のタイトルを5回タップするか、2秒長押ししてください。')) location.hash = 'home';
  });
  const guideOk = $('#parentGuideOk');
  if(guideOk) guideOk.addEventListener('click', ()=>{
    setLocal(K_GUIDE_DONE, 'done');
    render({ keepScroll:true });
  });
}

function bindParent(){
  const S = window.NatsuSync;
  if(S && !bindParent._devicesWatching && typeof S.onDevices === 'function'){
    bindParent._devicesWatching = true;
    S.onDevices(()=>{
      if(tab !== 'settings') return;
      const badge = $('#parentShareBadge');
      if(badge){
        badge.outerHTML = parentShareBadgeHTML();
        bindParentShareBadge();
      }
    });
  }
  bindParentShareBadge();
  const homeInstall = $('#homeInstallBtn');
  if(homeInstall) homeInstall.addEventListener('click', async ()=>{
    /* Android Chrome / Edge などが利用可能なときだけ、OSの確認を直接出せる。
       それ以外（iOSを含む）は、同じボタンから正しい手順を見せる。 */
    const prompt = deferredInstallPrompt;
    if(prompt && typeof prompt.prompt === 'function'){
      deferredInstallPrompt = null;
      try{
        await prompt.prompt();
        const choice = await prompt.userChoice;
        toast(choice && choice.outcome === 'accepted' ? 'ホーム画面に追加しました' : '追加はいつでもできます');
      }catch(e){ toast('追加の画面を開けませんでした。下の手順で追加してください'); }
      render({ keepScroll:true });
      return;
    }
    const guide = $('#homeInstallGuide');
    if(guide){
      guide.hidden = false;
      homeInstall.hidden = true;
      guide.scrollIntoView({ behavior:'smooth', block:'nearest' });
    }
  });
  bindParentSender('parentMessageSender', 'parentMessageCustomWrap');
  const messageText = $('#parentMessageText');
  const fitMessageText = ()=>{
    if(!messageText) return;
    messageText.style.height = 'auto';
    messageText.style.height = Math.max(48, Math.min(messageText.scrollHeight, 144)) + 'px';
  };
  fitMessageText();
  messageText.addEventListener('input', fitMessageText);
  $('#parentMessageSave').addEventListener('click', ()=>{
    const senderRaw = $('#parentMessageSender').value;
    const sender = PARENT_SENDERS.includes(senderRaw) ? senderRaw : 'おかあさん';
    const customSender = String($('#parentMessageCustom').value || '').trim().slice(0, 20);
    const text = String($('#parentMessageText').value || '').trim().slice(0, 80);
    if(!text){ toast('メッセージを 入れてください'); return; }

    /* つぎに 送る ぶんの 見出し。同じ 見出しが すでに あれば 差しかえる */
    const draft = { sender, customSender, text };
    const heading = messageHeading(draft);
    const now = messages();
    const same = now.find(m => messageHeading(m) === heading);

    if(same){
      if(!confirm('「' + heading + '」の メッセージは すでに あります。\n差しかえますか？')) return;
      pushGone(same.id);
    }else if(now.length >= MESSAGES_MAX){
      /* いっぱいの ときは、どれと 入れかえるかを えらんでもらう */
      const list = now.map((m,i)=> (i+1) + '：' + messageHeading(m) + '　' + m.text).join('\n');
      const ans = prompt('メッセージは ' + MESSAGES_MAX + '件までです。\n' +
        'どれと 入れかえますか？ 番号を 入れてください。\n\n' + list, '1');
      const n = Number(ans);
      if(!(n >= 1 && n <= now.length)) { toast('入れかえを やめました'); return; }
      pushGone(now[n-1].id);
    }

    if(!Array.isArray(state.messages)) state.messages = [];
    state.messages.push(Object.assign({
      id: 'm' + Date.now() + Math.floor(Math.random()*1000),
      at: new Date().toISOString(),
      by: logBy()
    }, draft));
    /* 3件を こえた ぶんは、古い ものから 落とす（合流の 規則と そろえる） */
    state.messages = messages();
    saveSt();
    $('#parentMessageText').value = '';
    render({ keepScroll:true });
    toast('おくりました');
  });

  const delMsg = $('.msg-list');
  if(delMsg) delMsg.addEventListener('click', e=>{
    const b = e.target.closest('[data-delmsg]');
    if(!b) return;
    const m = messages().find(x => x.id === b.dataset.delmsg);
    if(!m) return;
    if(!confirm('このメッセージを 消しますか？\n「' + m.text + '」')) return;
    pushGone(m.id);                       // 印を のこさないと 相手の端末から 戻る
    state.messages = (state.messages || []).filter(x => x.id !== m.id);
    saveSt();
    render({ keepScroll:true });
    toast('消しました');
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

  /* この端末が こども用か おうちの人用か。記録に そえる 名前に つかう。
     端末ごとの 設定なので 同期しない（同期すると 全部の端末が 同じに なる） */
  /* ほかの端末を 一覧から はずす。どの端末からでも できる。
     一時的な ブラウザで つないでしまい、その端末から 操作できなく
     なった ときの ための 逃げ道 */
  const devList = $('#syncDeviceList');
  if(devList) devList.addEventListener('click', async e=>{
    const b = e.target.closest('[data-devoff]');
    if(!b) return;
    const id = b.dataset.devoff;
    const row = deviceRows(S.devices()).find(r => r.id === id);
    const name = row ? row.label : 'この端末';
    if(!confirm('「' + name + '」を 共有から はずしますか？\n' +
                'その端末では あいことばが 消え、つなぐには 入れ直しが 必要に なります。\n' +
                '記録そのものは 消えません。')) return;
    b.disabled = true;
    const ok = await S.removeDevice(id);
    const el = $('#syncDeviceList');
    if(el) el.innerHTML = deviceListHTML();
    toast(ok ? '「' + name + '」を はずしました' : 'はずせませんでした');
  });

  /* 端末の 呼び名。打っている 途中で 送ると うるさいので、
     欄から はなれた ときに ためる */
  const devLabel = $('#deviceLabel');
  if(devLabel){
    const save = ()=>{
      const v = String(devLabel.value || '').trim().slice(0, 12);
      const before = getLocal(K_DEVICE_LABEL);
      if(v === before) return;
      if(v) setLocal(K_DEVICE_LABEL, v);
      else try{ localStorage.removeItem(K_DEVICE_LABEL); }catch(e){}
      if(typeof S.refreshDevice === 'function') S.refreshDevice();
      const el = $('#syncDeviceList');
      if(el) el.innerHTML = deviceListHTML();
      toast(v ? 'この端末を「' + v + '」にしました' : '呼び名を けしました');
    };
    devLabel.addEventListener('change', save);
    devLabel.addEventListener('blur', save);
  }

  const roleSel = $('#deviceRole');
  if(roleSel){
    roleSel.addEventListener('change', ()=>{
      const v = roleSel.value;
      if(v === 'child' || v === 'parent') setLocal(K_ROLE, v);
      else try{ localStorage.removeItem(K_ROLE); }catch(e){}
      /* えらび直したことを、ほかの端末の 一覧にも すぐ とどける */
      if(typeof S.refreshDevice === 'function') S.refreshDevice();
      toast('この端末の設定を変えました');
    });
  }

  /* つなぎ具合が かわったら 見出しの右の文字だけ 書きかえる。
     画面ごと 描き直すと 入力中の あいことばが 消えてしまう */
  if(!bindSync._watching){
    bindSync._watching = true;
    S.onStatus((st, text)=>{
      const el = $('#syncStatus');
      if(!el) return;
      el.textContent = syncStatusText(st, text);
    });
  }
  if(!bindSync._deviceWatching){
    bindSync._deviceWatching = true;
    S.onDeviceCount(count=>{
      /* 1台→2台で「待っています」から「つながっています」に変わる */
      const st = $('#syncStatus');
      if(st) st.textContent = syncStatusText(S.status(), S.statusText());
      const el = $('#syncDeviceCount');
      if(el) el.textContent = '共有リンク・端末ごとの設定（設定済み：' + count + '台）';
    });
  }
  /* 端末の 一覧は とどくのが 遅れる ことが ある。
     画面ごと 描き直すと 入力中の あいことばが 消えるので、ここだけ 差し替える */
  if(!bindSync._devicesWatching && typeof S.onDevices === 'function'){
    bindSync._devicesWatching = true;
    S.onDevices(()=>{
      const el = $('#syncDeviceList');
      if(el) el.innerHTML = deviceListHTML();
    });
  }

  /* 打ちこむ 欄は 2つ ある。まだ 共有していない ときは #syncCode、
     共有ずみで つなぎ直す ときは #syncRejoinCode。
     共有ずみの #syncCode は「いま使っている 合言葉」を 見せるだけの
     読み取り専用なので、そちらを 読んでは いけない */
  const input = $('#syncRejoinCode') || $('#syncCode');
  if(!input) return;

  const verify = $('#syncVerify');
  const joinStatus = $('#syncJoinStatus');
  const save = $('#syncSave');
  /* 参加は 確認できた あいことばだけ。存在しない あいことばで
     つなぐと、この端末の 設定で 新しい グループが できてしまう */
  let verified = '';
  const resetVerified = ()=>{
    verified = '';
    if(verify){
      if(save) save.hidden = true;
      if(joinStatus) joinStatus.textContent = '';
    }
  };
  if(verify) input.addEventListener('input', resetVerified);

  if(save) save.addEventListener('click', ()=>{
    const c = cleanCode(input.value);
    if(c.length < 8){ toast('合言葉を8文字以上入力してください'); return; }
    /* 確認の 段を 出している ときは、確認ずみの あいことばだけ 通す。
       すでに 共有ずみの 画面（確認の段が 無い）は これまで通り */
    if(verify && verified !== c){ toast('先に「接続を確認」を押してください'); return; }
    if(!confirmShareSafety()) return;
    if(typeof S.forgetRevokedCode === 'function') S.forgetRevokedCode();
    forgetConfigStampForNewHousehold(c);
    rememberChosenCode(c);
    S.reconnect(c, { joining: !!verify });
    toast('接続しています…');
    render({ keepScroll:true });
  });

  if(verify) verify.addEventListener('click', async ()=>{
    const c = cleanCode(input.value);
    resetVerified();
    if(c.length < 8){
      if(joinStatus) joinStatus.textContent = '合言葉を8文字以上入力してください。';
      input.focus();
      return;
    }
    if(typeof S.verifyHousehold !== 'function'){
      if(joinStatus) joinStatus.textContent = '接続の準備を読み込めませんでした。もう一度開いてください。';
      return;
    }
    verify.disabled = true;
    if(joinStatus) joinStatus.textContent = '接続しています…';
    try{
      const result = await S.verifyHousehold(c);
      if(cleanCode(input.value) !== c) return;
      if(!result || !result.found){
        if(joinStatus) joinStatus.textContent = '接続できませんでした。合言葉を確認してください。';
        return;
      }
      /* グループは あったが、中身を あけられない。ここで 通してしまうと
         「接続しました ✓」の あとに 参加できない、という 行き止まりに なる */
      if(result.unreadable){
        if(joinStatus) joinStatus.textContent = unreadableJoinText();
        return;
      }
      verified = c;
      if(joinStatus) joinStatus.textContent = '接続しました ✓　このグループに参加できます。';
      if(save) save.hidden = false;
    }catch(err){
      if(joinStatus) joinStatus.textContent = '接続を確認できませんでした。通信を確認してください。';
    }finally{
      verify.disabled = false;
    }
  });

  const copy = $('#syncCopy');
  if(copy) copy.addEventListener('click', ()=>{
    /* コピーするのは いま 使っている 合言葉。つなぎ直す 欄では ない */
    const shown = $('#syncCodeShown');
    if(!shown || !shown.value){ toast('先に合言葉を作成してください'); return; }
    copyText(shown);
  });

  /* 「作成する」で 共有が 始まる。以前は 作成しても つながらず、
     さらに「この合言葉で接続」を 押す 必要が あった。
     どちらを 押した 時点で ほかの端末から 読めるのかが 分からない、
     という 指摘に そって 1操作に まとめた */
  /* auto … おまかせで 作った 合言葉。
     おまかせの 合言葉は この端末が 当てられにくい 16文字を 作るので、
     「短い 合言葉を つかわないで」という 注意は あてはまらない。
     押すたびに 出す ぶんだけ じゃまなので 出さない。
     自分で 決める ときだけ 出す（そこが 弱くなる ところ）。
     どちらの 場合も、注意事項は 画面に 出したままに してある */
  const startSharing = (code, auto)=>{
    if(!auto && !confirmShareSafety()) return;
    if(typeof S.forgetRevokedCode === 'function') S.forgetRevokedCode();
    forgetConfigStampForNewHousehold(code);
    rememberChosenCode(code);
    S.reconnect(code);
    S.registerHousehold(code).catch(()=>{});
    openSyncDetails = true;          // QR・招待リンクをすぐ開いて見せる
    toast('作成しました。ほかの端末から この合言葉で 読み取れます');
    render({ keepScroll:true });
  };
  on('#syncMake', 'click', ()=> startSharing(S.makeCode(), true));
  on('#syncMakeOwn', 'click', ()=>{
    const input = $('#syncOwnCode');
    const c = cleanCode(input ? input.value : '');
    if(c.length < 8){
      toast('合言葉は 8文字以上に してください');
      if(input) input.focus();
      return;
    }
    startSharing(c);
  });

  const off = $('#syncOff');
  if(off) off.addEventListener('click', ()=>{
    if(!confirm('この端末を切り離しますか？\nこの端末の記録は残りますが、他の端末とはそろわなくなります。')) return;
    /* ホーム画面版は 起動URLに 合言葉が のこる。おぼえておかないと、
       次に 開いた 瞬間に 同じグループへ つなぎ直されて 解除が 効かない */
    rememberChosenCode('none');
    S.setCode('');
    S.disconnect();
    render({ keepScroll:true });
    toast('切り離しました');
  });
}

/* 保護者ページ（設定）*/
function bindConfig(){
  on('#cfgChildName', 'change', e=>{
    const name = e.target.value.trim();
    const oldName = config.childName;
    const titleWasGenerated = isGeneratedTitle(config.title, oldName);
    config.childName = name;
    if(titleWasGenerated) config.title = defaultTitleFor(name);
    setLocal(K_NAME, name);
    saveCfg();
  });
  on('#cfgTitle', 'change', e=>{
    config.title = e.target.value.trim() || defaultTitleFor(config.childName);
    saveCfg(); render({ keepScroll:true });
  });
  on('#cfgReadingGrade', 'change', e=>{
    const grade = Number(e.target.value);
    /* おうちの設定として 同期する。おうちの人の端末で 変えれば、
       子どもの端末の 表示も 数秒で 追いつく */
    config.readingGrade = grade;
    setLocal(K_READING, grade);          // 古い版の端末との つなぎ
    if(typeof setReadingGrade === 'function') setReadingGrade(grade);
    saveCfg();
    render({ keepScroll:true });
  });
  on('#cfgStart', 'change', e=>{ config.startAt = e.target.value; saveCfg(); });
  on('#cfgEnd', 'change',   e=>{ config.endAt   = e.target.value; saveCfg(); });

  $$('.theme-choice input[name="theme"]').forEach(input=>input.addEventListener('change', e=>{
    if(!THEME_IDS.includes(e.target.value)) return;
    config.theme = e.target.value;
    saveCfg();
  }));
  on('#cfgShowDaily', 'change', e=>{
    config.showDaily = e.target.checked;
    saveCfg();
  });

  /* #view は 描き直しても 要素そのものは のこる。ここに 毎回 addEventListener すると
     リスナーが 積み重なり、1回の タップで 何度も 動いてしまう。並べかえの ▲▼ は
     入れ替えては また 戻すを くり返して 何も 起きないように 見え、そのたびに
     保存と 描き直しが 走るので、iPad では ほかの ボタンも 効かなくなる。
     ここだけは 1度だけ 束ねる（中の ボタンは 描き直しの たびに 束ね直す） */
  const ed = $('#view');
  if(!bindConfig._edBound){
  bindConfig._edBound = true;

  /* どの行を 開いているかを おぼえる。
     以前は「種類」「表示する場所」を 変えた ときにしか おぼえておらず、
     人が 手で 開いた 行は 記録されなかった。そのため 並べかえなどで
     描き直すと、開いていた 行が 閉じ、**前に いじった 別の行が 開く**。
     利用者からは「順番を 入れかえると 下の項目が 展開される」と 見える。
     toggle は バブルしないので capture で とる */
  ed.addEventListener('toggle', e=>{
    const row = e.target.closest && e.target.closest('.set-task');
    if(!row) return;
    const t = config.tasks[+row.dataset.i]; if(!t) return;
    if(row.open) openConfigTaskId = t.id;
    else if(openConfigTaskId === t.id) openConfigTaskId = null;
  }, true);

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
      e.preventDefault();
      e.stopPropagation();
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
  }

  /* 押したボタンの 欄に 足す。group を まちがえると、足したものが
     別の欄に 現れて「追加できていない」ように 見える */
  function addNormalTask(group){
    const added = {
      id: 't' + Date.now(), group, type:'count',
      name:'あたらしい しゅくだい', total:10, unit:'かい', numbered:false,
      memoLabel:'やったことを かこう'
    };
    config.tasks.push(added); openConfigTaskId = added.id;
    saveCfg(); render({ keepScroll:true });
  }
  on('#addMustTask',   'click', ()=>addNormalTask('must'));
  on('#addOptionTask', 'click', ()=>addNormalTask('option'));
  on('#addBookTask', 'click', ()=>{
    const added = { id:'book-'+Date.now(), group:'must', type:'count', recordStyle:'book',
      name:'読書の きろく', total:10, unit:'さつ', numbered:true,
      bookFields:{ author:true, publisher:false, rating:true } };
    config.tasks.push(added); openConfigTaskId = added.id;
    saveCfg(); render({ keepScroll:true });
  });
  on('#addDailyTask', 'click', ()=>{
    const added = { id:'daily-'+Date.now(), group:'daily', type:'daily',
      name:'おてつだい', target:1, targetUnit:'かい', memoLabel:'やったこと' };
    config.tasks.push(added); openConfigTaskId = added.id;
    config.showDaily = true;
    saveCfg(); render({ keepScroll:true });
  });

  bindSync();

  /* ためこんだ画面を通さずに読み直す。
     アドレスに毎回ちがう印を付けると、iPad も 取り直さざるを得なくなる */
  const upd = $('#appUpdate');
  if(upd) upd.addEventListener('click', ()=>{
    location.replace(cacheBustURL(location.href, Date.now()));
  });

  const ald = $('#allowLogDelete');
  if(ald) ald.addEventListener('change', ()=>{
    config.allowLogDelete = ald.checked;
    saveCfg(); render({ keepScroll:true });
    toast(ald.checked ? '「やったこと」の削除を有効にしました' : '「やったこと」の削除を無効にしました');
  });

  const inv = $('#inviteCopy');
  if(inv) inv.addEventListener('click', ()=>{
    const el = $('#inviteUrl');
    if(el && el.value) copyPlainText(el.value);
  });

  const tc = $('#traceCopy');
  if(tc) tc.addEventListener('click', ()=>{
    const rows = traceRead();
    const text = ['版 ' + APP_VER + ' / 役割 ' + (getLocal(K_ROLE) || '未選択') +
                  ' / 現在時刻 ' + new Date().toISOString()]
      .concat(rows.map(r=> JSON.stringify(r))).join('\n');
    copyPlainText(text);
  });
  const tx = $('#traceClear');
  if(tx) tx.addEventListener('click', ()=>{
    setLocal(K_TRACE, '[]'); render({ keepScroll:true }); toast('消しました');
  });

  on('#expBtn', 'click', exportData);
  on('#impBtn', 'click', ()=> $('#impFile').click());
  on('#impFile', 'change', importData);

  /* 以前は freshConfig() でサンプルの宿題一式が復活していた。
     「消したのに知らない宿題が並ぶ」ため、空にして登録をうながす。
     名前・デザイン・期間などの設定は項目ではないので残す。 */
  on('#resetCfg', 'click', ()=>{
    if(confirm('宿題の項目をすべて消しますか？\nこれまでの記録は残ります。')){
      config.tasks = [];
      config.showDaily = false;
      saveCfg(); render(); toast('宿題の項目を消しました');
    }
  });
  on('#resetAll', 'click', ()=>{
    if(confirm('進捗と記録をすべての共有端末から削除しますか？\nこの操作は取り消せません。')){
      state = resetState(Date.now()); saveSt(); render(); toast('すべての端末へ削除を送信しました');
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
         + (streakLabelKanji(p) ? '  ' + streakLabelKanji(p) : '');
  }
  if(p.isDone) return '✓ ' + t.name + '  ' + p.text + '  完了';

  const nx = nextLabel(t, true);
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
function copyPlainText(text){
  const done = ()=>toast('コピーしました');
  if(navigator.clipboard && window.isSecureContext){
    navigator.clipboard.writeText(text).then(done, legacy);
  }else legacy();

  function legacy(){
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly','');
    ta.style.cssText = 'position:fixed;left:-9999px;top:0';
    document.body.appendChild(ta);
    ta.select();
    let ok = false;
    try{ ok = document.execCommand('copy'); }catch(e){}
    ta.remove();
    ok ? done() : toast('コピーできませんでした');
  }
}

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

/* 「最新に更新する」用。文字列置換では ?r=... の位置や値の形によって
   `?` / `&` が壊れるため、URL API で既存の引数を保ったまま r だけ更新する。 */
function cacheBustURL(href, when){
  const url = new URL(href, location.href);
  url.searchParams.set('r', String(when || Date.now()));
  return url.pathname + url.search + url.hash;
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
document.addEventListener('change', e=>{
  const ok = e.target.closest('[data-content-ok]');
  const review = e.target.closest('[data-content-review]');
  if(!ok && !review) return;
  const status = contentReviewStatus();
  const i = +(ok || review).dataset[ok ? 'contentOk' : 'contentReview'];
  if(ok){
    if(ok.checked) status[i] = 'ok'; else delete status[i];
    saveContentReview(status);
    render({ keepScroll:true });
    return;
  }
  if(review.checked) status[i] = 'review'; else delete status[i];
  saveContentReview(status);
  const reviewed = Object.values(status).filter(v=>v === 'review').length;
  const done = Object.values(status).filter(v=>v === 'ok').length;
  const count = $('#contentReviewCount');
  if(count) count.textContent = '再検討 ' + reviewed + 'こ・OK ' + done + 'こ';
});

document.addEventListener('click', e=>{

  if(e.target.closest('[data-share-safety]')){
    alert(shareSafetyText());
    return;
  }

  const tabBtn = e.target.closest('.tab');
  if(tabBtn){
    const t = tabBtn.dataset.tab;
    // hashchange で描画する。同じ hash なら発火しないので自分で描く
    if(routeFromHash() === t) render(); else location.hash = t;
    return;
  }

  /* 長い説明を 書くかわりに、その場から 飛ばす。
     設定ページは 長いので、着いた先まで 寄せないと 意味が ない */
  if(e.target.closest('#logCareJump')){
    jumpTo('#logCareSection');
    location.hash = 'config';
    return;
  }

  if(e.target.closest('#joinRemove')){
    clearJoinCodeFromURL();
    render({ keepScroll:true });
    toast('招待リンクの共有コードをURLから消しました');
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

  /* 招待で つながった 端末に、どちらの端末かを 聞く。
     選んだ 役割は この端末だけの 設定（グループの 設定には 入れない）。
     保護者を 選んだら、そのまま 保護者ページへ 送る */
  const joinRole = e.target.closest('[data-join-role]');
  if(joinRole){
    const role = joinRole.dataset.joinRole;
    setLocal(K_ROLE, role);
    if(typeof window.NatsuSync?.refreshDevice === 'function') window.NatsuSync.refreshDevice();
    if(role === 'parent') location.hash = 'settings';
    else render();
    return;
  }

  const open = e.target.closest('[data-open]');
  if(open){ openSheet(open.dataset.open, open.dataset.book); return; }

  if(e.target.closest('[data-content-copy]')){
    const text = contentReviewText();
    if(!text){ toast('先に項目をえらんでね'); return; }
    copyPlainText(text);
    return;
  }
  if(e.target.closest('[data-content-reset-ok]')){
    const status = contentReviewStatus();
    Object.keys(status).forEach(i=>{ if(status[i] === 'ok') delete status[i]; });
    saveContentReview(status);
    render({ keepScroll:true });
    return;
  }

  if(e.target.closest('#bkCheck')){ checkKanji(); return; }
  if(e.target.closest('#bkFix')){ fixKanji(); return; }
  if(e.target.closest('#wrCheck')){ checkWrites(); return; }
  if(e.target.closest('#wrFix')){ fixWrites(); return; }

  /* 記録を 1行だけ 消す。数（すすみぐあい）は さわらない。
     消した印を のこさないと、相手の端末から また 戻ってくる */
  const delLog = e.target.closest('[data-dellog]');
  if(delLog){
    if(!canDeleteLog()) return;      // 画面に のこっていても、切ってあれば 消さない
    const id = delLog.dataset.dellog;
    const l = (state.logs || []).find(x=> x.id === id);
    if(l && confirm('この記録を消しますか？\n「' + (l.what || '') + '」\nすすみぐあいの数字は そのままです。')){
      pushGone(id);
      state.logs = state.logs.filter(x=> x.id !== id);
      saveSt(); render({ keepScroll:true }); toast('消しました');
    }
    return;
  }

  const delBook = e.target.closest('[data-delbook]');
  if(delBook){
    const b = state.books.find(x=>x.id===delBook.dataset.delbook);
    if(b && confirm('「'+b.title+'」の記録を削除しますか？\n冊数も1つ戻ります。')){
      /* 消した中身を おうちの人むけに のこす。
         同時に、これが 相手の端末へ「消した」ことを つたえる 墓標に なる */
      pushTrash({
        id: b.id, kind:'book', taskId: b.taskId, title: b.title,
        text: [b.date, b.author && 'さくしゃ：' + b.author,
               b.rating ? 'おすすめ度 ' + '★'.repeat(b.rating) : '',
               b.memo].filter(Boolean).join('\n')
      });
      state.books = state.books.filter(x=>x.id!==b.id);
      // 残りの冊に通し番号を振り直し、進捗を実際の冊数に合わせる
      const same = state.books.filter(x=>x.taskId===b.taskId)
        .sort((x,y)=> x.nth - y.nth);
      same.forEach((x,i)=> x.nth = i+1);
      progPatch(b.taskId, { done: same.length });
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
    if(fun.dataset.fun === 'open'){ funOpen = true; pushRead(funIdx); }
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
    const more = $('#dailyMore');
    if(more) more.value = '';
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
   おうちの人だけの 入口（タイトルを 2秒 長押し）

   iOS で「ホーム画面に追加」した アイコンは、Safari とは 別の
   入れもの（localStorage）を 持つ。だから Safari で あいことばを
   入れても、アイコンの方には つたわらない。
   アイコンには アドレス欄が 無く、こども画面から 保護者ページへの
   導線も わざと 置いていないので、そのままでは あいことばを
   入れる手立てが ない。

   画面には 何も出さず、長押しだけで 保護者ページへ 行けるようにする。
   子どもが たまたま 見つけても 困らないよう、ふつうに 触るより
   長い 2秒に してある。
   --------------------------------------------------------- */
(function(){
  /* 帯ぜんたいを 受け口に する。タイトルの 文字は 短いことが あり、
     その 右がわの すき間を 押しても 反応しないと 当てにくい */
  const el = $('.topband') || $('#appTitle');
  if(!el) return;

  /* iPhone の「画面いちばん上を さわると 先頭に もどる」は、
     ページ ぜんたいが スクロールする ときだけ 効く。この アプリは
     中身の ところ（#scroll）だけを スクロールさせる 作りなので 効かない
     （下タブが iPad で ずれる のを 直すために そうした）。
     そのかわり、上の 帯を さわったら 先頭に もどるように しておく。
     長押しや 5回タップの 合図とは ぶつからない（あちらは 押しつづける・
     くりかえす ことで 成りたつ） */
  el.addEventListener('click', ()=>{
    const box = scrollBox();
    if(box && box.scrollTop > 0){
      try{ box.scrollTo({ top:0, behavior:'smooth' }); }
      catch(e){ box.scrollTop = 0; }
    }
  });

  const HOLD_MS  = 2000;   // 長押しの ながさ
  const MOVE_TOL = 14;     // 指の ゆれを 許す はば（px）
  const TAPS     = 5;      // 連続タップの かず
  const TAP_GAP  = 800;    // タップの あいだの ゆるされる 間（ms）

  let timerId = null, sx = 0, sy = 0;
  let taps = 0, lastTap = 0;

  function open(){
    cancel();
    taps = 0;
    if(routeFromHash() === 'settings') return;
    location.hash = 'settings';
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
  /* すでにこの端末で使い始めているグループは、導線変更で止めない。
     保存済みデータのない新規端末だけ、最初の設定に案内する。 */
  const hasExistingData = !!(getLocal(K_CFG) || getLocal(K_ST));
  /* おためしモードでは起動時の内部データを「設定済み」と数えない。 */
  if(requested !== 'welcome' && !getLocal(K_ONBOARD) && (TEST_MODE || !hasExistingData)) return 'welcome';
  /* ホーム画面の アイコンから 開いた ときに、どの画面を 出すか。

     これまでは URL の # だけで 決めていた。ところが iOS の
     「ホーム画面に追加」が おぼえるのは **追加した ときの URL** で、
     そこに # が 残るかは こちらから 決められない。残らなければ
     上の行で 'home'（子ども画面）に なる。保護者が「親端末」を
     えらんで 追加しても 子ども画面が 開く、いちど 閉じて 開き直すと
     子ども画面に なる、は これ。

     そこで **この端末が 保護者の端末か**を 見る。役割は 端末ごとの
     設定で、初期設定・招待後の えらび直し・共有の設定でしか つかない。
     子どもの端末では ぜったいに 立たないので、子ども画面から 保護者
     ページへ 抜ける 道（5回タップ・長押し）は これまで通り 唯一のまま。

     # が 付いている ときは さわらない。保護者ページの「子ども画面へ」は
     #home を 付けるので、そちらは これまで通り 子ども画面へ 行く。 */
  if(!location.hash && isStandalone() && getLocal(K_ROLE) === 'parent') return 'settings';
  return requested;
}
window.addEventListener('hashchange', ()=>{
  const t = routeFromHash();
  /* writes は 同じタブのまま 課題だけ かわることが あるので、
     タブが 同じでも 描き直す */
  if(t !== tab || t === 'writes'){ tab = t; render(); }
});

/* iOS / iPadOS のホーム画面アプリは、すでに開いている画面を前面へ戻すときに
   表示倍率と左端の位置を誤って保持することがある。実際に拡大を検出したときだけ
   viewport の上限を一瞬 1 にして標準倍率へ戻し、すぐ解除して通常の拡大操作は残す。 */
function repairStandaloneViewport(){
  const view = window.visualViewport;
  if(!isStandalone() || !view || Number(view.scale) <= 1.01) return;
  const meta = document.querySelector('meta[name="viewport"]');
  if(!meta) return;
  const normal = 'width=device-width, initial-scale=1, viewport-fit=cover';
  meta.setAttribute('content', normal + ', maximum-scale=1');
  setTimeout(()=> meta.setAttribute('content', normal), 120);
}
window.addEventListener('pageshow', ()=> setTimeout(repairStandaloneViewport, 120));
document.addEventListener('visibilitychange', ()=>{
  if(!document.hidden) setTimeout(repairStandaloneViewport, 120);
});

/* sync.js は module なので、ページを 開いて 最初の render() の時点では
   まだ 動いていない。「せってい」タブを 見ている 最中に 追いついたら、
   ここで もう1回 描き直す（そうしないと「べつの端末と つなぐ」の欄が
   ずっと「読み込みに失敗しました」のまま 固まって見える） */
/* ---------------------------------------------------------
   まねきリンク（?join=あいことば）

   ブラウザが ちがえば 保存する ところも 別なので、Safari と
   LINE の中の ブラウザは 「べつの端末」に なる。これは ブラウザの
   きまりで、こちらからは 一つに まとめられない。
   そのかわり、リンクを 開くだけで つながるようにして、
   打ち直す 手間を なくす。

   iPhone / iPad のホーム画面追加は、追加時点のURLを起動URLとして使う。
   そのため通常ブラウザでは、追加されるまで join を残す。ホーム画面版で
   最初に開いたときだけ消せば、別の保存領域にも共有コードを渡しつつ、
   以後のURL・履歴には残さない。 */
const JOIN_PARAM = 'join';
function joinCodeFromURL(){
  const q = new URLSearchParams(location.search);
  return cleanCode(q.get(JOIN_PARAM) || '');
}
function clearJoinCodeFromURL(){
  const q = new URLSearchParams(location.search);
  if(!q.has(JOIN_PARAM)) return;
  q.delete(JOIN_PARAM);
  const rest = q.toString();
  try{
    history.replaceState(null, '', location.pathname + (rest ? '?' + rest : '') + location.hash);
  }catch(e){}
}
function joinInstallTransferHTML(){
  const code = joinCodeFromURL();
  if(isStandalone() || !code) return '';
  /* はずされた あいことばの ままでは つながらない。
     「引き継げる準備が できています」は うそに なるので 出さない */
  const S = window.NatsuSync;
  if(S && typeof S.revokedCode === 'function' && S.revokedCode() === code) return '';
  /* 子ども画面に 出るが、読むのは 大人。data-no-reading を 付けて
     かな変換の 対象から 外す（変換すると「きょうゆうコード」などに なり、
     大人が 読めない 案内に なってしまう）。 */
  const step = homeInstallPlatform(navigator.userAgent, navigator.maxTouchPoints) === 'ios'
    ? '画面下（iPadは上）の共有ボタン <span class="nowrap">□↑</span> を押す'
    : 'ブラウザのメニューから「ホーム画面に追加」／「アプリをインストール」を選ぶ';
  return `
  <section class="sec join-install-transfer" data-no-reading>
    <div class="paper">
      <p class="join-install-for">おうちの方に読んでもらってね</p>
      <h3 class="join-install-head">ホーム画面に追加する手順</h3>
      <ol class="join-install-steps">
        <li><b>このページを開いたまま</b>、${step}</li>
        <li>「ホーム画面に追加」→「追加」を押す</li>
        <li>追加されたアイコンを<b>一度開く</b></li>
      </ol>
      <div class="set-actions"><button class="btn btn-sm btn-ghost" id="joinRemove" type="button">追加しない</button></div>
    </div>
  </section>`;
}
function takeJoinCode(){
  const code = joinCodeFromURL();
  if(!code) return '';
  if(isStandalone()) clearJoinCodeFromURL();
  return code;
}
function applyJoinCode(){
  const code = takeJoinCode();
  const S = window.NatsuSync;
  if(!code || !S || !S.configured() || code.length < 8) return;
  if(S.getCode() === code) return;          // すでに 同じ あいことば
  /* はずされた 端末が、リンクを 開き直す だけで 戻れては いけない。
     ホーム画面版は 起動URL に あいことばが 焼きついている ので、
     これが 無いと 起動する たびに 戻ってしまう。
     入れ直しは 人が 設定画面で 打つ（そこで 忘れる） */
  if(typeof S.revokedCode === 'function' && S.revokedCode() === code) return;
  /* 人が 設定画面で えらんだ 合言葉が あるなら、そちらが 正しい。
     ホーム画面版の 起動URLに のこった 古い 招待で 引き戻さない */
  const chosen = getLocal(K_CODE_CHOSEN);
  if(chosen && chosen !== code) return;
  /* 手動参加で選んだ色が残っていても、招待URLのグループへ持ち込まない。
     招待では接続先のグループデザインが常に正となる。 */
  try{ localStorage.removeItem(K_WELCOME_THEME); }catch(e){}
  setLocal(K_ONBOARD, 'done');              // 招かれた側は 初期設定を とばす
  forgetConfigStampForNewHousehold(code);
  /* 招待リンクは かならず「あるグループへ入る」。見つからないときに
     この端末の初期値でグループを作ると、招いた側の設定が消える */
  rememberChosenCode(code);
  S.reconnect(code, { joining:true });
  toast('おうちの 共有に つながりました');
  if(routeFromHash() === 'welcome') location.hash = 'home';
  render({ keepScroll:true });
}

window.addEventListener('natsu:sync-ready', ()=>{
  applyJoinCode();
  if(tab === 'welcome' || tab === 'stats' || isAdultTab(tab)) render({ keepScroll:true });
}, { once:true });

/* PWAとしての追加確認を使えるブラウザでは、勝手に出さず保護者ページの
   ボタンを押したときだけ出す。Safari / Firefoxなどは下の案内に自然に落ちる。 */
window.addEventListener('beforeinstallprompt', e=>{
  e.preventDefault();
  deferredInstallPrompt = e;
  if(tab === 'settings') render({ keepScroll:true });
});
window.addEventListener('appinstalled', ()=>{
  deferredInstallPrompt = null;
  toast('ホーム画面に追加しました');
  if(tab === 'settings') render({ keepScroll:true });
});

/* ---------------------------------------------------------
   はじめる
   --------------------------------------------------------- */
loadAll();
if(typeof setReadingGrade === 'function') setReadingGrade(readingGrade());
tab = routeFromHash();
if(typeof window.natsuBootProgress === 'function') window.natsuBootProgress(100, '表示します');
render();

})();
