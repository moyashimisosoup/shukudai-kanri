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
/* 公開向けのアプリ版。APP_VER はキャッシュ更新のための内部配信番号。 */
const RELEASE_VERSION = '1.12.0';
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
async function rememberChosenCode(code){
  const value = String(code || 'none');
  if(value === 'none'){ setLocal(K_CODE_CHOSEN, 'none'); return 'none'; }
  const fingerprint = await codeFingerprint(value);
  setLocal(K_CODE_CHOSEN, 'fp:' + fingerprint);
  return fingerprint;
}
async function chosenCodeMatches(code){
  const saved = getLocal(K_CODE_CHOSEN);
  if(!saved) return true;
  if(saved === 'none') return false;
  const fingerprint = await codeFingerprint(code);
  if(saved.slice(0, 3) === 'fp:') return saved === 'fp:' + fingerprint;
  /* 旧版の平文コピーは比較したこの1回でfingerprintへ置換する。 */
  const oldFingerprint = await codeFingerprint(saved);
  setLocal(K_CODE_CHOSEN, 'fp:' + oldFingerprint);
  return oldFingerprint === fingerprint;
}
const K_ROLE = TEST_MODE ? 'natsu.preview.role.v1' : 'natsu.device.role.v1';
const K_NAME = TEST_MODE ? 'natsu.preview.name.v1' : 'natsu.device.name.v1';
const K_READING = TEST_MODE ? 'natsu.preview.reading.v1' : 'natsu.device.reading.v1';
/* 任意質問の回答は共有stateに入れる。通信を始める直前の描き直しや古い
   キャッシュに消されて入力欄が空に見えないよう、この端末にも同じ控えを持つ。 */
const K_QUESTION_ANSWERS = TEST_MODE ? 'natsu.preview.question.answers.v1' : 'natsu.question.answers.v1';
/* 「やったこと」を1件ずつ消す設定は、この端末の保護者だけの安全装置。
   共有configへ入れると別端末までONになるため、専用の端末内キーへ分ける。 */
const K_ALLOW_LOG_DELETE = TEST_MODE ? 'natsu.preview.allow-log-delete.v1' : 'natsu.allow-log-delete.v1';
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
/* 記念日を見た足跡はこの端末だけ。共有 state や保持期限の活動には加えない。 */
const K_KINENBI_VIEWED = TEST_MODE ? 'natsu.preview.kinenbi.viewed.v1' : 'natsu.kinenbi.viewed.v1';
/* サンプルの宿題が入ったままであることの案内を、閉じたかどうか。
   **config / state に入れてはいけない。** 入れると saveCfg()/saveSt() で
   暗号文が変わり、90日の保持期限が「活動あり」と数えてしまう。
   さらに共有すると、1台で閉じただけで全部の端末から消える。
   保護者と子どもは別の端末を見ているので、しるしも別にする。 */
const K_SAMPLE_PARENT = TEST_MODE ? 'natsu.preview.sample.parent.v1' : 'natsu.sample.parent.v1';
const K_SAMPLE_CHILD  = TEST_MODE ? 'natsu.preview.sample.child.v1'  : 'natsu.sample.child.v1';
/* 保護者の本一覧だけの並び順。端末ごとの見やすさなので共有データには
   入れない。キー文字列は前の配信で選んだ向きを引き継ぐため変えない。 */
const K_PARENT_BOOK_ORDER = TEST_MODE ? 'natsu.preview.book.task.order.v1' : 'natsu.book.task.order.v1';
/* 保護者ページの共有・ホーム画面追加の案内を、今は使わない人が閉じたしるし。
   端末ごとの選択なので config / state には入れない。共有データを変更すると
   90日の保持期限に影響し、1台で閉じた案内が家族全員から消えてしまう。 */
const K_SYNC_PROMPT_DONE = TEST_MODE ? 'natsu.preview.prompt.sync.v1' : 'natsu.prompt.sync.v1';
const K_HOME_INSTALL_DONE = TEST_MODE ? 'natsu.preview.prompt.install.v1' : 'natsu.prompt.install.v1';
const K_METRIC = 'natsu.metric.registered.v1';
/* 新しい版を静かに取り込む仕組み用。前回いつ index.html を確認したかを
   端末に持ち、visibilitychange のたびに毎回問い合わせないようにする。 */
/* 「完走！」を もう 出したか。**この端末の 中だけ** の しるしで、
   SHARED_CONFIG_KEYS / SHARED_STATE_KEYS の allowlist には 足さない。
   祝いを 見たかどうかは 家族で 合わせる 記録では ないし、
   合わせると 片方の 端末で 見た だけで もう片方に 出なくなる。 */
const K_FINALE_DONE = TEST_MODE ? 'natsu.preview.finale.shown.v1' : 'natsu.finale.shown.v1';
const K_UPDATE_CHECKED = TEST_MODE ? 'natsu.preview.update.checked.v1' : 'natsu.update.checked.v1';
/* GitHub Pages は公開直後、古い index.html をしばらく返し続けることがある。
   歯止めが無いと、まだ新しくなっていないサーバーへ向けて読み直しを
   永久に繰り返してしまう。読み直した版を覚えておき、同じ版では二度読み直さない。 */
const K_UPDATE_RELOADED_FOR = TEST_MODE ? 'natsu.preview.update.reloaded.v1' : 'natsu.update.reloaded.v1';
/* URL の隠し入口。静的サイトなので認証ではなく、通常画面に出さないための合図。 */
const STATS_PARAM = 'stats';
const STATS_VALUE = 'family-count';

/* おためしURLを開くたびに、前回のおためし内容を消して必ず初期画面にする。
   消すのは preview 専用キーだけで、普段のグループデータ・あいことばには触れない。 */
if(TEST_MODE){
  try{
    [K_CFG, K_ST, K_ONBOARD, K_ROLE, K_NAME, K_READING, K_THEME, K_WELCOME_THEME, K_WELCOME_JOIN,
     K_QUESTION_ANSWERS, K_ALLOW_LOG_DELETE,
     K_SAMPLE_PARENT, K_SAMPLE_CHILD, K_SYNC_PROMPT_DONE, K_HOME_INSTALL_DONE].forEach(k=>localStorage.removeItem(k));
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
const FREE_HINT_DEFAULT = '今日のはっけん、今おもっていること、わかったこと、おぼえたこと、あそび、かぞく、ゲーム…なんでもかいてみよう。';
/* 「読める漢字」に小4以上を選んだ子むけの、同じ内容の大人びた言い方。
   親が freeHint を自分で決めているときは そちらを優先するので、
   ここは既定の呼びかけを 出すときだけ 使う。使う漢字は 小4までの配当に限る。 */
const FREE_HINT_ADULT = '今日の発見、今思っていること、分かったこと、覚えたこと、遊び、家族、ゲーム…なんでも書いてみよう。';
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
/* 設定画面で見えている欄ごとに順番を替える。欄は group と同じ 分けかたなので、
   ならべかえも group の 中だけで 動かす。**読書も ここでは 分けない** ――
   読書は 必須か 任意の 課題の 一つで、子ども画面では ほかの 宿題と
   同じ 並びに 出る。ここで 分けると 設定でしか 動かせない 順番が でき、
   読書だけ いつも 端に 寄る。 */
function taskOrderBucket(t){ return t && t.group; }
function dailyUnitPreset(unit){ return DAILY_UNIT_PRESETS.includes(unit) ? unit : 'custom'; }
/* 「宿題を決める」の 画面の欄 と、その欄が 書きかえる 設定のキーの 対応。
   recordStyle は bookFields も 連動して 決めるので、戻すときは まとめて 戻す。
   targetUnitPreset / targetUnitCustom は どちらも targetUnit を 書く、
   一つの値の 見せ方ちがい（同時には 出ない）。
   「進め方」（type）の 欄は 読書も 選べる。読書に しても type は 'count' の
   ままで recordStyle だけが 変わるので、この 欄は 両方を 見る。
   **bookFields は 入れない** ―― 入れると「本ごとに残す項目」を 1つ 押しただけで
   「進め方」まで 変えたことに なる（欄は 別に 出ている） */
const TASK_FIELD_KEYS = {
  name:['name'], group:['group'], type:['type','recordStyle'], total:['total'], unit:['unit'],
  numbered:['numbered'], steps:['steps'], wrapUp:['wrapUp'], wrapBy:['wrapBy'],
  questions:['questions'], memoLabel:['memoLabel'], freeHint:['freeHint'], target:['target'],
  targetUnitPreset:['targetUnit'], targetUnitCustom:['targetUnit'],
  recordStyle:['recordStyle','bookFields'], bookFields:['bookFields']
};
/* 「アプリの設定」で見せる欄と、設定の中で持つ値の対応。共有する欄も
   端末だけの欄も、開いたときの控えとこの対応で比べれば同じ作法で戻せる。 */
const CONFIG_FIELD_KEYS = {
  childName:['childName'], readingGrade:['readingGrade'], theme:['theme'],
  title:['title'], startAt:['startAt'], endAt:['endAt'],
  periodLabel:['periodLabel'], periodLabelKana:['periodLabelKana'],
  deadlineLabel:['deadlineLabel'], deadlineLabelKana:['deadlineLabelKana']
};
/* いま その課題で 画面に出ている欄の 名前一覧。taskEditorRow の
   分岐と そろえてある。「何か所 変えたか」を 数えるときに使う
   ―― targetUnitPreset と targetUnitCustom のように 同じキーを持つ欄が
   あるので、実際に 出ている 欄だけを 数えないと 二重に数えてしまう */
function taskEditorFieldNames(t){
  const kind = taskKind(t);
  const names = ['name'];
  if(kind === 'book'){
    names.push('group','type','total','bookFields');
  }else if(kind === 'daily'){
    names.push('recordStyle');
    if(!isFree(t)){
      names.push('target', dailyUnitPreset(t.targetUnit||'') === 'custom' ? 'targetUnitCustom' : 'targetUnitPreset');
    }else{
      names.push('freeHint');
    }
    names.push('memoLabel');
  }else{
    names.push('group','type');
    if(t.type === 'count') names.push('total','unit','numbered');
    else names.push('steps');
    names.push('wrapUp');
    if(t.wrapUp) names.push('wrapBy');
    names.push('questions','memoLabel');
  }
  return names;
}
/* base（変える前の 控え）と 今の t を、名前の欄1つぶんずつ 見くらべる */
function changedTaskFieldNames(t, base){
  if(!base) return [];
  return taskEditorFieldNames(t).filter(name=>
    TASK_FIELD_KEYS[name].some(k => JSON.stringify(base[k]) !== JSON.stringify(t[k]))
  );
}
/* 行を 閉じた ときが「ひと区切り」。基準が この課題の ものなら、
   変えた 欄の 数を まとめて 知らせ、基準を 手放す（＝ここから 先が
   次の 基準）。触っていなければ 何も出さない */
function noticeTaskRowClosed(t){
  /* 作ったばかりの 課題は、閉じた ところで ひと区切り。ここから 先の
     書きかえが「変更」になる。数ではなく、足したという 事実を 知らせる */
  if(configTaskNewId === t.id){
    configTaskNewId = null;
    configTaskBase = null;
    toast('宿題を追加しました');
    return;
  }
  if(!configTaskBase || configTaskBase.id !== t.id) return;
  const n = changedTaskFieldNames(t, configTaskBase.snap).length;
  if(n > 0){ toast(n + 'か所 変更しました'); configTaskBase = null; }
}
/* ✓ と「元に戻す」は 描き直しの ときに 付く。この画面は 欄を 離れた
   ときに 保存するだけで 描き直さない ものが 多く、そのままでは 変えた
   しるしが いつまでも 出ない。欄を 離れた あとなので 描き直しても
   入力の じゃまには ならないが、つぎの 欄へ 移った 直後の ことも あるので、
   その欄へ focus を 返す。 */
function refreshTaskRow(t){
  openConfigTaskId = t.id;
  const active = document.activeElement;
  const row = active && active.closest ? active.closest('.set-task') : null;
  const key = row && row.dataset.detailsKey === 'task:' + t.id
    ? (active.dataset.f || active.dataset.bf || '') : '';
  render({ keepScroll:true });
  if(!key) return;
  const sel = '.set-task[data-details-key="task:' + t.id + '"] ';
  const back = $(sel + '[data-f="' + key + '"]') || $(sel + '[data-bf="' + key + '"]');
  if(back) back.focus();
}
/* 欄を 変えた ことで 画面を 組み直す ときの 居場所返し。
   「表示する場所」と「進め方」は 押した とたんに 行が 動いたり
   欄の 顔ぶれが 変わったり するので、押した 欄が いちど 消える。
   キーボードで 操作している 人は、そこで 行き先を 失う。 */
function refocusTaskField(t, inner){
  const back = $('.set-task[data-details-key="task:' + t.id + '"] ' + inner);
  if(back) back.focus();
}
function applyTheme(theme){
  const id = THEME_IDS.includes(theme) ? theme : 'notebook';
  /* 演出の 粒は 切りかえる 前の テーマの 色で 描かれている。
     残すと 古い色の 粒だけが 新しい 画面に 浮く。片づけは
     stopCelebration() の 一箇所に まとめてある。
     **「変わったとき だけ」に すること。** applyTheme() は 描き直しの
     たびに 呼ばれるので、素で 呼ぶと 保存の 60ms あとの render() が
     出したばかりの 演出を 消す（実際に 踏んだ：完走が 出なかった）。 */
  if(document.documentElement.dataset.theme !== id
     && typeof stopCelebration === 'function') stopCelebration();
  document.documentElement.dataset.theme = id;
  const meta = document.querySelector('meta[name="theme-color"]');
  if(meta) meta.setAttribute('content', THEME_META[id]);
}

let config, state;
let tab = 'home';
let timer = null;
let kinenbiNudgeShown = false;
let kinenbiRenderedDay = '';
let openSyncDetails = false;
/* Chromium 系が出す「インストール」確認は、利用者が押すまでここで預かる。
   iOS Safari はこのイベントを出さないため、同じボタンで手順案内へ切り替える。 */
let deferredInstallPrompt = null;
let funIdx = 0, funOpen = false;
/* きょう 読んだ ぶんの どこを 見て いるか（funToday().seen の 添字）。
   さいごが いまの 1件。◀ で 前に 読んだ ものへ 戻れる。
   これが あると「読み終わったか」を 当てなくて よくなる。
   新しく 引ける かずは これまで どおり 上限で しばるので、
   たどれても 増えない。 */
let funPos = -1;
/* カレンダーが 見せている月（その月の1日）と、下にひらいている日。
   描き直しても 見ている場所が とばないよう、画面の外で おぼえておく */
let calMonth = null;
let calDay = null;
let openConfigTaskId = null;
/* 「宿題を決める」で いま 変えている 課題の 基準（もどり先）。
   最初の 変更の 直前の スナップショットを 1課題ぶんだけ 持つ。
   別の課題を いじったら、そちらに 置きかわる（1課題ぶんで 足りる） */
let configTaskBase = null;
/* 「アプリの設定」を開いた時点の控え。画面を描き直しても残し、別ページへ
   出たら render() で手放すので、「元に戻す」はこのページを開いた時点へ戻る。 */
let configBase = null;
/* いま 作ったばかりで、まだ 一度も 行を 閉じていない 課題。
   作った 直後の 入力は「変更」ではなく「はじめて 書く」ことなので、
   ✓ と「元に戻す」は 出さない。戻り先が 既定の 名前では 意味がない */
let configTaskNewId = null;
/* index.html を確認して見つけた新しい版。取り込みは静かに行うため、
   保護者の「アプリ情報」に事実として一言そえる以外には使わない。 */
let newVersionAvailable = false;
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
function emptyState(){ return { schema:SCHEMA, resetAt:0, progress:{}, logs:[], books:[], trash:[], gone:[], reads:[], messages:[], questionAnswers:{} }; }

/* 消した記録を のこす数。
   これは「思い出のため」だけでは なく、消したことを 相手の端末に つたえる
   墓標も かねている。ここから あふれた ぶんは、相手が ずっと オフラインだった
   場合に かぎり 復活しうる。ふだんは 数秒で とどくので 50もあれば 足りる */
const TRASH_MAX = 50;
/* 「まいにち」の例は設定に残すが、新規グループの子ども画面では初期非表示。 */
function freshConfig(){
  return normalizeConfig(deepCopy(DEFAULT_CONFIG));
}
/* 期間・目標日の呼び名。既定は これまでの 表示と 同じ 語なので、
   設定を さわらない 家庭の 見え方は 1文字も 変わらない。
   漢字は 保護者ページ、かなは 子ども画面で 使う。読みは 機械で 作らず、
   対で 入れて もらう（人名・固有名詞は 正しく 読めないため）。 */
const LABEL_DEFAULTS = {
  periodLabel:       '夏休み',
  periodLabelKana:   'なつやすみ',
  deadlineLabel:     '夏休み終了',
  deadlineLabelKana: 'なつやすみ おわり'
};
const LABEL_KEYS = ['periodLabel','periodLabelKana','deadlineLabel','deadlineLabelKana'];
/* せまい端末（320px）でも 折り返しで 収まる 長さに 切る。
   .pace-name は 104px の 枠なので、これ以上は 行数が ふえて 読みにくい */
const LABEL_MAX = 12;
function normalizeLabel(value, fallback){
  const s = String(value == null ? '' : value).replace(/\s+/g, ' ').trim().slice(0, LABEL_MAX);
  return s || fallback;
}
/* 表示のことばを ととのえる。**欄が 無い 旧データには 既定を 補う**
   （補わないと、かなが 空に なって 子ども画面が 漢字に 変わって しまう）。
   欄が あって 空なら、利用者が 消したという ことなので、漢字は 既定へ
   もどし、かなは 空のまま 残して 表示のときに 漢字へ 落とす。
   ここでは 保存も 同期も しない。起動しただけで ほかの端末の 設定を
   まき戻さないため、保存は 利用者が 何かを 変えた ときだけに する */
function normalizeLabelConfig(c){
  LABEL_KEYS.forEach(key=>{
    if(!Object.prototype.hasOwnProperty.call(c, key)){ c[key] = LABEL_DEFAULTS[key]; return; }
    c[key] = normalizeLabel(c[key], key.endsWith('Kana') ? '' : LABEL_DEFAULTS[key]);
  });
  return c;
}
/* 表示語は ここだけで 組み立てる。各画面が 自前で つなぐと、
   助詞と 終了後の 文型が また 分かれる。
   かなが 空のときは 漢字表記を そのまま 出す（保存できない 状態を 作らない） */
function periodWord(kana){
  const base = config.periodLabel || LABEL_DEFAULTS.periodLabel;
  return kana ? (config.periodLabelKana || base) : base;
}
function deadlineWord(kana){
  const base = config.deadlineLabel || LABEL_DEFAULTS.deadlineLabel;
  return kana ? (config.deadlineLabelKana || base) : base;
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
  /* 課題は 必ず 必須・任意・毎日の どれかに 属する。どれでもない 課題は
     子ども画面の どの欄でも 拾われず（viewHome は group で 絞る）、
     設定の 一覧にも 出ない ―― 手元から 消えたように 見える。
     **任意へ 寄せる。** 必須へ 入れると「必須の宿題」の 進捗の 分母が
     黙って 増え、保護者が ふだん 見ている 数字が 跳ぶ。 */
  c.tasks.forEach(t=>{
    if(!t || t.group === 'must' || t.group === 'option' || t.group === 'daily') return;
    /* まいにち型は 欄が 1つしか 無いので、型のほうを 手がかりに する */
    t.group = t.type === 'daily' ? 'daily' : 'option';
  });
  if(isGeneratedTitle(c.title, c.childName)) c.title = defaultTitleFor(c.childName);
  /* これまで端末内だけだったデザインは、おうちの設定として同期する。
     既存グループは、最初の保存時にその端末で選んでいたデザインを引き継ぐ。 */
  if(!THEME_IDS.includes(c.theme)){
    const legacyTheme = getLocal(K_THEME);
    c.theme = THEME_IDS.includes(legacyTheme) ? legacyTheme : 'notebook';
  }
  if(typeof c.showDaily !== 'boolean') c.showDaily = false;
  /* 表示のことば（期間名・目標日名）。旧データの補いは normalizeLabelConfig() */
  normalizeLabelConfig(c);
  /* 宿題の一覧の写真。**印だけ**を共有する（画像は端末の中）。
     ここに画像を入れると1文書1MiBの上限にあたり、家庭ぜんぶの同期が止まる */
  const poster = c.poster && typeof c.poster === 'object' ? c.poster : {};
  /* 名前は **任意**。空のままなら 帯には 印だけを 出す。
     ここで 既定の 語を 入れて しまうと、消した つもりの 名前が 戻る。

     枠ごとの 合図は `ats`（0〜3まいめ）。旧い 1枚だけの 設定（`at` だけ）は
     0まいめと して 引きつぐ。`at` には **max(ats) を 入れない** ―― 旧い 版の
     端末は `at` を 見て「これまでの ID（＝0まいめ）」を 取りに 行くので、
     ほかの 枠の 時刻が 入ると 0まいめを 新しい ものと 取りちがえる */
  const posterAts = [];
  const rawAts = Array.isArray(poster.ats) ? poster.ats : [];
  for(let i = 0; i < POSTER_MAX; i++){
    const at = Number(rawAts[i]);
    posterAts.push(at > 0 ? at : 0);
  }
  if(!posterAts[0]) posterAts[0] = Number(poster.at) > 0 ? Number(poster.at) : 0;
  c.poster = {
    label: String(poster.label == null ? '' : poster.label).trim().slice(0, 6),
    at: posterAts[0],
    ats: posterAts
  };
  /* 読める漢字。既存グループは、その端末に のこっている 値を 引きつぐ。
     0/1/2/9 だけだった 旧データも、この一覧に 入っているので そのまま通る。 */
  if(!READING_GRADE_OPTIONS.includes(Number(c.readingGrade))){
    const legacy = Number(getLocal(K_READING));
    c.readingGrade = READING_GRADE_OPTIONS.includes(legacy) ? legacy : 2;
  }else c.readingGrade = Number(c.readingGrade);
  /* 旧版の共有trueは端末内ONへ移さず、安全側のOFFに倒す。 */
  delete c.allowLogDelete;
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
  if(!s.questionAnswers || typeof s.questionAnswers !== 'object' || Array.isArray(s.questionAnswers)) s.questionAnswers = {};
  Object.keys(s.questionAnswers).forEach(id=>{
    const row = s.questionAnswers[id];
    if(!row || typeof row !== 'object'){ delete s.questionAnswers[id]; return; }
    row.answers = Array.isArray(row.answers) ? row.answers.map(v=>String(v || '').slice(0, 800)) : [];
    row.at = ms(row.at);
  });
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
  /* **だれが 読んだか。** readsもfunも端末内だけだが、同じ端末を親子で
     使い分けたときの表示を混ぜないため、記録（logs）と同じ役割印を持つ。 */
  state.reads.push({ id, at: now.toISOString(), t: f.t, q: f.q, by: logBy() });
  if(state.reads.length > READS_MAX) state.reads = state.reads.slice(-READS_MAX);
  saveLocalState();
}
/* 子ども画面（やったこと・カレンダー）は **子どもの ぶんだけ**。
   保護者が 自分の 端末で 読んだ ものを、子どもの ふりかえりに 混ぜない。
   古い ひかえには `by` が 無いので、その ぶんは 子ども あつかいに する
   （いまの 見え方を 変えない）。 */
function readsOf(key, adult){
  return (state.reads || []).filter(r =>
    dayKey(new Date(r.at)) === key && (adult || r.by !== 'parent'));
}
/* その日に 読んだ ぶんの 一覧。読んだ ものが ない 日は 何も 出さない。
   `adult` の ときだけ 保護者の ぶんも 出し、そちらに 印を 付ける
   （子どもの ぶんは "ふつう" なので 無印。logs の logByLabel と 同じ規則） */
function readsHTML(key, adult){
  const rows = readsOf(key, adult);
  if(!rows.length) return '';
  const head = adult ? '読んだミニコンテンツ' : 'よんだ ミニコンテンツ';
  return `
  <div class="paper reads">
    <p class="reads-head">${esc(head)}<span class="reads-cnt">${rows.length}こ</span></p>
    ${rows.map(r=>`
      <div class="reads-row">
        <span class="reads-tag">${esc(r.t)}</span>
        <span class="reads-q" data-no-reading>${rubyHTML(r.q)}</span>
        ${r.by === 'parent' ? '<span class="reads-by">（親）</span>' : ''}
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
const TRACE_CONFIG_FIELDS = ['theme','title','childName','readingGrade','showDaily',
  'periodLabel','periodLabelKana','deadlineLabel','deadlineLabelKana'];
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
    if(ft.seen.length){ funIdx = ft.seen[ft.seen.length - 1]; funPos = ft.seen.length - 1; }
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
async function forgetConfigStampForNewHousehold(code){
  const c = String(code || '');
  if(!c) return;
  const fingerprint = await codeFingerprint(c);
  const marker = 'fp:' + fingerprint;
  const savedHouse = getLocal(K_CFG_HOUSE);
  if(savedHouse === marker) return;
  /* 旧版はここへ合言葉そのものを置いていた。同じ共有先なら削除世代や
     保存時刻を落とさず、比較用fingerprintへ置き換えるだけにする。 */
  if(savedHouse && savedHouse.slice(0, 3) !== 'fp:'
     && await codeFingerprint(savedHouse) === fingerprint){
    setLocal(K_CFG_HOUSE, marker);
    return;
  }
  clearQuestionAnswerCache();
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
  setLocal(K_CFG_HOUSE, marker);
}
function clearHouseholdLocalCopies(){
  clearQuestionAnswerCache();
  try{
    [K_CFG_HOUSE, K_WELCOME_THEME, K_WELCOME_JOIN, K_AT].forEach(k=>localStorage.removeItem(k));
  }catch(e){}
}
function saveSt(){
  /* 子どもが自分の端末で内容を変えた時刻だけを共有する。保護者側の同期確認・
     合流結果の送り返しでは更新しないため、「子どもの最終記録」として使える。 */
  if(getLocal(K_ROLE) === 'child') state.childActivityAt = Date.now();
  saveLocalState();
  markSaved('state');
  syncPush('state');
}
/* funと「読んだもの」は端末内だけ。共有時刻・childActivityAt・同期予約を
   動かさないため、開く／見るだけで90日の保持期限は延びない。 */
function saveLocalState(){
  localStorage.setItem(K_ST, JSON.stringify(state));
}
function deepCopy(o){ return JSON.parse(JSON.stringify(o)); }
function getLocal(key){ try{ return localStorage.getItem(key) || ''; }catch(e){ return ''; } }
function setLocal(key, value){ try{ localStorage.setItem(key, value); }catch(e){} }
async function codeFingerprint(code){
  const normalized = String(code || '').trim().normalize('NFKC').replace(/\s+/g, '').toLowerCase();
  const bytes = new TextEncoder().encode(normalized);
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  return Array.from(digest, b=>b.toString(16).padStart(2, '0')).join('');
}
async function migrateAppSecretFingerprints(){
  const chosen = getLocal(K_CODE_CHOSEN);
  if(chosen && chosen !== 'none' && chosen.slice(0, 3) !== 'fp:'){
    setLocal(K_CODE_CHOSEN, 'fp:' + await codeFingerprint(chosen));
  }
  const house = getLocal(K_CFG_HOUSE);
  if(house && house.slice(0, 3) !== 'fp:'){
    setLocal(K_CFG_HOUSE, 'fp:' + await codeFingerprint(house));
  }
}
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
  if(isStandalone() || getLocal(K_HOME_INSTALL_DONE) === 'done') return '';
  const platform = homeInstallPlatform(navigator.userAgent, navigator.maxTouchPoints);
  const text = platform === 'ios'
    ? 'Safariでこのページを開き、画面下（iPadは上）の共有ボタン □↑ を押して、「ホーム画面に追加」→「追加」を選びます。LINEなどのアプリ内ブラウザでは、先に「Safariで開く」を選んでください。'
    : platform === 'android'
      ? 'Chromeなどのメニュー ⋮ を開き、「ホーム画面に追加」または「アプリをインストール」を選びます。表示名を確認して追加してください。'
      : platform === 'desktop'
        ? 'ブラウザのアドレス欄にあるインストールの印、またはメニューから「インストール」／「アプリとしてインストール」を選びます。'
        : 'お使いのブラウザのメニューから「ホーム画面に追加」または「インストール」を選びます。';
  /* 追加すれば消える一時的な案内なので、常設の項目とは見た目を分ける。
     `.sec` + `.sec-head` にすると、buildAdultSectionToc() が h2 を拾って
     i マークと目次の行を足してしまう。i マークは「いつでも読み返せる
     常設項目の補足」のための仕掛けで、読んだら消える案内には合わない。
     「保護者の方へ」と同じく、見出し帯を持たない枠だけの aside にする。 */
  return `
  <aside class="paper home-install-notice">
    <div class="home-install-notice-body">
      <h2>ホーム画面に追加</h2>
      <p>追加をおすすめします。ホーム画面からアプリのように使用できるようになります。</p>
      <p class="set-note home-install-guide" id="homeInstallGuide" hidden>${esc(text)}</p>
    </div>
    <div class="home-install-actions">
      <button class="btn btn-sm btn-go" id="homeInstallBtn" type="button">ホーム画面に追加する</button>
      <button class="btn btn-sm btn-ghost" id="homeInstallDismiss" type="button">今は追加しない</button>
    </div>
  </aside>`;
}
function isStatsURL(){ return new URLSearchParams(location.search).get(STATS_PARAM) === STATS_VALUE; }
function cleanCode(value){ return String(value || '').trim().normalize('NFKC').replace(/\s+/g,'').replace(/[\/\u0000-\u001f]/g,''); }
/* 「読める漢字」で選べる値。kanji.js の READING_GRADES（小1〜小6の実学年、
   0=すべてひらがな、9=漢字のまま）と 必ず そろえる。
   別々に 書き写すと どちらかだけ 直したときに ズレるので、
   kanji.js が 先に 読み込まれている ときは その配列を そのまま使い、
   万一 読み込めていなくても 同じ並びに フォールバックする。 */
const READING_GRADE_OPTIONS = (typeof READING_GRADES !== 'undefined' && Array.isArray(READING_GRADES))
  ? READING_GRADES.slice() : [0,1,2,3,4,5,6,9];
/* 読める漢字は これまで 端末ごとの 設定だった。
   そのため おうちの人の端末で 変えても、子どもの端末は そのままで、
   保護者から 直せない状態に なっていた。
   デザイン（テーマ）と 同じく おうちの設定として 同期する。
   まだ config に 無い グループは、その端末に のこっている 値を 引きつぐ。 */
function readingGrade(){
  const c = config && Number(config.readingGrade);
  if(READING_GRADE_OPTIONS.includes(c)) return c;
  const g = Number(getLocal(K_READING) || 2);
  return READING_GRADE_OPTIONS.includes(g) ? g : 2;
}
function readingOptions(selected){
  const labels = {
    0:'すべてひらがな', 1:'小学1年生まで', 2:'小学2年生まで', 3:'小学3年生まで',
    4:'小学4年生まで', 5:'小学5年生まで', 6:'小学6年生まで', 9:'漢字のまま'
  };
  return READING_GRADE_OPTIONS.map(g=>`<option value="${g}"${g===Number(selected)?' selected':''}>${labels[g]}</option>`).join('');
}
/* 「かんじを しらべる」カード（かきうつす文）の案内文で使う言い方。
   unlearnedKanji() は setReadingGrade(readingGrade()) で 実際の設定に あわせて
   判定しているので、案内も その学年に あわせる。以前は 小1・小2しか
   選べなかったので「2年生までの」で 固定していたが、いまは 小3〜小6も
   選べるため、選んだ学年を そのまま 出す。0・9は 学年で言えないので別の言い方にする。 */
function learnedKanjiLabel(){
  const g = readingGrade();
  if(g === 9) return 'つかえる';
  if(g >= 1 && g <= 6) return g + '年生までの';
  return 'ならった';
}
/* 「読める漢字」に小4以上を選んだ子には、子ども画面の呼びかけの文（はんこ・
   励まし文・記録シートの一言）を 少し大人びた言い方に切りかえる。
   9（漢字のまま）は 数だけ見ると4以上に含まれるが、読みちがえを防ぐため
   ここで明示しておく。判定を あちこちに 書き散らすと、あとで水準を
   変えるときに 取りこぼすので、この関数だけに まとめる。 */
function grownUpWording(){
  const g = readingGrade();
  return g >= 4 || g === 9;
}
/* 呼びかけの文だけを、上の判定にあわせて選ぶ。タブ名・見出し・ボタンの
   名前・設定画面は 画面の骨組みなので ここを 使わない。
   大人びた側の文に使う漢字は、必ず 小4までの配当表に 収める
   （呼びだす側で選んだ学年の子が 読めない字を 出さないため）。 */
function wording(child, adult){
  return grownUpWording() ? adult : child;
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

  /* 閲覧履歴はこの端末だけ。暗号文へ送らず、受信側の履歴も取り込まない。 */
  out.reads = (left.reads || []).slice(-READS_MAX);

  /* 観察・自由研究の任意質問は、課題ごとに最後に確定した回答を残す。
     回答の保存時刻で選ぶため、別端末で古い入力欄を開いたままでも
     新しく保存した回答が古い内容で戻されない。 */
  out.questionAnswers = {};
  const questionTaskIds = new Set([...Object.keys(left.questionAnswers || {}), ...Object.keys(right.questionAnswers || {})]);
  questionTaskIds.forEach(id=>{
    const a = left.questionAnswers && left.questionAnswers[id];
    const b = right.questionAnswers && right.questionAnswers[id];
    const pick = !b || (a && (ms(a.at) > ms(b.at) || (ms(a.at) === ms(b.at) && localIsNewer))) ? a : b;
    if(pick) out.questionAnswers[id] = deepCopy(pick);
  });

  out.gone = mergeById(left.gone, right.gone, (a,b)=> ms(a.at) >= ms(b.at))
    .sort((x,y)=> ms(y.at) - ms(x.at))
    .slice(0, GONE_MAX);

  const gone = new Set([...out.trash.map(x=> x.id), ...out.gone.map(x=> x.id)]);
  if(gone.size){
    out.books = out.books.filter(b=> !gone.has(b.id));
    out.logs  = out.logs.filter(l=> !gone.has(l.id));
  }

  out.progress = mergeProgress(left.progress || {}, right.progress || {}, localIsNewer);
  const childActivityAt = Math.max(ms(left.childActivityAt), ms(right.childActivityAt));
  if(childActivityAt) out.childActivityAt = childActivityAt;
  else delete out.childActivityAt;
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
function resetSharedState(when){
  state = resetState(when);
  clearQuestionAnswerCache();
  return state;
}

/* 暗号文の中はFirestore Rulesから検査できない。送信前に共有してよい欄だけを
   positive allowlistで新しいオブジェクトへ移し、端末専用・未知欄を送らない。 */
const SHARED_CONFIG_KEYS = [
  'schema','title','childName','readingGrade','theme','startAt','endAt',
  'tasks','showDaily','poster','parentMessage','parentMessageMoved',
  'periodLabel','periodLabelKana','deadlineLabel','deadlineLabelKana'
];
const SHARED_STATE_KEYS = [
  'schema','resetAt','progress','logs','books','trash','gone','messages',
  'questionAnswers','childActivityAt'
];
function pickShared(source, keys){
  const out = {};
  keys.forEach(key=>{
    if(source && Object.prototype.hasOwnProperty.call(source, key)) out[key] = deepCopy(source[key]);
  });
  return out;
}
function sharedConfig(c){ return pickShared(c, SHARED_CONFIG_KEYS); }
function sharedState(s){ return pickShared(s, SHARED_STATE_KEYS); }
function stripLocal(s){ return sharedState(s); }

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
    /* グループの印が新しければ、受け渡し箱から取りに行く（画面は待たせない） */
    if(typeof checkPosterArrival === 'function') checkPosterArrival();
  }

  if(remote.state){
    const before = deepCopy(state.progress || {});
    const localState = normalizeState(state);
    const remoteState = normalizeState(remote.state);
    const merged = mergeState(localState,
                              remoteState,
                              ms(at.state) >= ms(remote.stateAt));
    if(ms(merged.resetAt) > ms(localState.resetAt)) clearQuestionAnswerCache();
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
  const activeHouse = syncApi && typeof syncApi.householdFingerprint === 'function'
    ? syncApi.householdFingerprint() : '';
  if(welcomeTheme && welcomeTheme.house === activeHouse && THEME_IDS.includes(welcomeTheme.theme)){
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
    if(joinPrefs.hasGrade && READING_GRADE_OPTIONS.includes(Number(joinPrefs.readingGrade))
       && Number(config.readingGrade) !== Number(joinPrefs.readingGrade)){
      config.readingGrade = Number(joinPrefs.readingGrade);
      welcomeChanged = true;
    }
  }
  if(welcomeChanged){ saveCfg(); changed = true; }

  if(changed) render({ keepScroll:true });
}

window.NatsuApp = {
  current: () => ({ config:sharedConfig(config), state:sharedState(state) }),
  onRemote: applyRemote,
  /* 墓標を受け取ったときは、端末に残った古い内容を消す。これを残すと
     新しい合言葉を作ったときに、削除済みの記録を別グループへ送ってしまう。 */
  onHouseholdRetired(){
    config = freshConfig();
    state = emptyState();
    clearHouseholdLocalCopies();
    try{
      [K_CFG, K_ST, K_ONBOARD, K_ROLE, K_NAME, K_READING, K_THEME,
       K_WELCOME_THEME, K_WELCOME_JOIN, K_CFG_HOUSE, K_AT, K_QUESTION_ANSWERS].forEach(k=>localStorage.removeItem(k));
    }catch(e){}
    rememberChosenCode('none');
    setLocal(K_RETIRED_NOTICE, '1');
    navigateTo('welcome');
  },
  onHouseholdJoinFailed(){
    clearHouseholdLocalCopies();
    rememberChosenCode('none');
  },
  onHouseholdRevoked(){
    clearHouseholdLocalCopies();
    rememberChosenCode('none');
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
function adultSectionHelpAttr(text){
  return text ? ` data-adult-section-help="${esc(text)}"` : '';
}
function clamp(n,a,b){ return Math.max(a, Math.min(b, n)); }
function dailyCountSelection(selected, raw){
  const text = String(raw == null ? '' : raw).trim();
  const more = /^\d+$/.test(text) ? Number(text) : 0;
  return more >= 6 ? clamp(more, 6, 99) : clamp(selected|0, 0, 99);
}
function dailyMorePrompt(task){
  const unit = unitAdult((task && task.targetUnit) || 'かい');
  if(grownUpWording()) return '6' + unit + '以上のときは、入力しよう';
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

function kinenbiForDate(d){
  const exact = KINENBI_BY_DATE[dayKey(d)];
  const md = pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
  return exact || KINENBI_BY_MONTH_DAY[md] || null;
}
function kinenbiViewed(){
  try{ const value = JSON.parse(getLocal(K_KINENBI_VIEWED) || '{}'); return value && typeof value === 'object' ? value : {}; }
  catch(e){ return {}; }
}
function markKinenbiViewed(key){
  const viewed = kinenbiViewed();
  viewed[key] = new Date().toISOString();
  setLocal(K_KINENBI_VIEWED, JSON.stringify(viewed));
}
function renderKinenbiButton(now){
  const btn = $('#todayLabel'), text = $('#todayLabelText');
  if(!btn || !text) return;
  const item = kinenbiForDate(now);
  const key = dayKey(now);
  kinenbiRenderedDay = key;
  text.textContent = fmtDate(now);
  btn.setAttribute('aria-label', item ? fmtDate(now) + '、今日はなんの日？をひらく' : fmtDate(now));
  btn.setAttribute('aria-disabled', item ? 'false' : 'true');
  const unread = !!item && !kinenbiViewed()[key];
  btn.classList.toggle('has-unread', unread);
  btn.classList.remove('is-nudging');
  if(unread && !kinenbiNudgeShown){
    kinenbiNudgeShown = true;
    requestAnimationFrame(()=>btn.classList.add('is-nudging'));
  }
}
function openKinenbi(now){
  const item = kinenbiForDate(now), dialog = $('#kinenbiDialog');
  if(!item || !dialog) return;
  $('#kinenbiDate').textContent = fmtDate(now);
  $('#kinenbiTitle').textContent = item.title;
  $('#kinenbiText').textContent = item.text;
  /* 記念日ダイアログは本文を後から入れるため、通常の画面描画時の
     かな表示だけでは対象にならない。子どもの漢字設定と同じ辞書・
     文脈補正をここにも使い、固有名詞や年号を個別の推測で補わない。 */
  applyReadingDisplay(dialog);
  markKinenbiViewed(dayKey(now));
  $('#todayLabel').classList.remove('has-unread', 'is-nudging');
  $('#todayLabel').setAttribute('aria-expanded', 'true');
  if(typeof dialog.showModal === 'function') dialog.showModal(); else dialog.setAttribute('open', '');
  $('#kinenbiClose').focus();
}
function syncKinenbiClosed(){
  const btn = $('#todayLabel');
  if(!btn) return;
  btn.setAttribute('aria-expanded', 'false');
  btn.focus();
}
function closeKinenbi(){
  const dialog = $('#kinenbiDialog');
  if(!dialog || !dialog.open) return;
  if(typeof dialog.close === 'function') dialog.close(); else dialog.removeAttribute('open');
  if(typeof dialog.close !== 'function') syncKinenbiClosed();
}
const kinenbiDialog = $('#kinenbiDialog');
if(kinenbiDialog) kinenbiDialog.addEventListener('close', syncKinenbiClosed);
function fmtTime(d){ return pad2(d.getHours())+':'+pad2(d.getMinutes()); }
function keyToDate(k){ const p = k.split('-'); return new Date(+p[0], +p[1]-1, +p[2]); }

/* 長い 知らせは 2.2秒では 読み切れない。字の 多さに 合わせて のばす
   （マイクの 許可のように、手だてを 2つ 出す ものが ある） */
function toast(msg){
  const t = $('#toast');
  t.textContent = msg; t.hidden = false;
  clearTimeout(toast._t);
  const wait = Math.max(2200, Math.min(7000, String(msg || '').length * 160));
  toast._t = setTimeout(()=>{ t.hidden = true; }, wait);
}
/* =========================================================
   はんこと 祝いの演出
   仕様は docs/completion-animation-design.md（4a 校了版）。

   段は4つ。出る回数が 減るほど 強くなる。
     毎回 … はんこだけ（0.9秒）
     A 項目完了 … 二重の輪の はんこ ＋ きらきら（1.6秒）
     B 分類完了 … 2行の はんこ ＋ 花丸 ＋ 光条を 強めた きらきら ＋ 弧の渦（4.3秒）
     C 完全制覇 … 暗転 ＋ スターマイン ＋ 弧の渦2本 ＋「完走！」（そのあと止まる）

   **暗転するのは C だけ。** A と B は 紙の上のまま。
   加算合成は「下にある色に 光を足す」ので、真っ白な紙には それ以上 足せない。
   だから 光そのものを 見せる C だけ 暗くする。
   ========================================================= */

/* 演出の対象。**毎日の項目は 外す。**
   必須・任意の isDone は「全部の 回数／段階／ページが 済んだか」で
   いちど 成立すると 期間の 終わりまで 成立したままだが、毎日の項目は
   「今日ぶんが 済んだか」なので **毎日 成立する**。入れると
   「ひと夏に 数回」の つもりの 演出が 毎日 出る。
   すすみぐあいの 計算（overall()）には 触れない。あちらは 表示の 割合で、
   こちらは 祝いの 判定。同じ 関数を 使い回すと 片方の 都合で 両方が 動く。 */
function celebrateTargets(group){
  return config.tasks.filter(t => t.group === group && t.type !== 'daily');
}
function celebrateGroupDone(group){
  const list = celebrateTargets(group);
  return list.length > 0 && list.every(t => prog(t).isDone);
}
/* 保存する **前** に 撮っておく。あとから「変わったか」を 見るため */
/* C は **必須も 任意も（読書の記録も ふくめて）ぜんぶ** 終わったとき。
   読書の記録は 必須か 任意の どちらかに 入る 課題なので、
   2つの 分類を 見れば おのずと 入る。
   **課題が 1つも 無い 分類は「済んだ」として 数える。** 任意を 1つも
   登録していない 家庭で、いつまでも 完走できなく なるのを 防ぐ
   （B は これと ちがい、空の 分類では 出さない）。 */
function celebrateAllDone(){
  const groups = ['must','option'].filter(g => celebrateTargets(g).length > 0);
  return groups.length > 0 && groups.every(celebrateGroupDone);
}
function celebrateBefore(task){
  return {
    task: !!(task && prog(task).isDone),
    must: celebrateGroupDone('must'),
    option: celebrateGroupDone('option'),
    all: celebrateAllDone()
  };
}
/* 「完走！」の しるし。課題の 顔ぶれが 変われば 別の 達成なので、
   出したときの 顔ぶれごと 覚える（同じ 達成状態では 出し直さない）。 */
function finaleSignature(){
  return ['must','option'].map(g => celebrateTargets(g).map(t => t.id).sort().join(',')).join('/')
    + '|' + (state && state.resetAt || '');
}
function finaleAlreadyShown(){ return getLocal(K_FINALE_DONE) === finaleSignature(); }

/* どの段を 出すか。C ＞ B ＞ A ＞ 毎回。同時に 成立したときは
   強いほうだけを 出す（C は 暗転するので、B を 重ねると
   紙と 夜空が 入れかわって 見える）。 */
function celebrateLevel(task, before){
  if(!task || !before) return null;
  if(task.type === 'daily') return null;
  const group = task.group === 'must' || task.group === 'option' ? task.group : '';
  if(!group) return null;
  /* 取り消し（チェックを 外した）でも、もともと 済んでいた ものでも 出さない。
     押しまちがいを 直しに 来た 人に、できたと 言わない */
  if(before.task || !prog(task).isDone) return null;
  if(!before.all && celebrateAllDone() && !finaleAlreadyShown()) return { level:'c', group };
  if(!before[group] && celebrateGroupDone(group)) return { level:'b', group };
  return { level:'a', group };
}

/* 分類の 呼び名。子ども画面と 保護者ページで 言葉が ちがう */
const CELEBRATE_GROUP_KANA = { must:'かならず やる', option:'つぎに やる' };

/* ---- 演出の 置き場と 片づけ ----
   かけらは この 入れ物の 中だけに 作る。片づけは stopCelebration() の
   **一箇所** に まとめる。種類を 増やすたびに 書き足す 形にすると
   必ず 消し忘れ、テーマを 切りかえたとき 古い色の 粒だけが 画面に 残る。 */
let fxLayer = null, fxCtx = null, fxRaf = 0, fxTimers = [];
let fxW = 0, fxH = 0, fxS = 0, fxParts = [], fxStages = [];
let fxEndAt = 0, fxT0 = 0, fxLast = 0, fxFade = .12, fxDark = false;
let fxProbe = null, fxPixel = null, fxPalette = null;
const fxSprites = new Map();

/* 判定は **再生のたびに** 読む。設定は途中で変わる */
function celebrateReduced(){
  try{ return window.matchMedia('(prefers-reduced-motion: reduce)').matches; }
  catch(e){ return false; }
}
/* 粒だけを 止める。はんこは 自分の 時計で 引きあげる（B は 4.3秒 出したいのに
   粒が 3.4秒で 終わる ―― ここを 一緒にすると はんこが 途中で 消える） */
function endFxCanvas(){
  if(fxRaf) cancelAnimationFrame(fxRaf);
  fxRaf = 0; fxParts = []; fxStages = []; fxCtx = null;
  if(fxLayer){ fxLayer.remove(); fxLayer = null; }
}
function stopCelebration(){
  fxTimers.forEach(clearTimeout); fxTimers = [];
  endFxCanvas();
  $$('.finale, .celebrate-still').forEach(el => el.remove());
  const box = $('#stamp');
  if(box){ box.hidden = true; box.classList.remove('is-out'); box.innerHTML = ''; }
}

/* canvas は CSS変数も oklch(from …) も 読めない。1×1 の canvas に 塗って
   読み返す。getComputedStyle().getPropertyValue() は oklch(0.48 0.16 150) の
   形で 返るので、そこから 数を3つ 拾って RGB として 扱うと
   **全部の色が 同じ 嘘の値に なる**（4a で 実際に 踏んだ）。 */
function fxRGB(value){
  if(!fxProbe){
    fxProbe = document.createElement('span');
    fxProbe.style.display = 'none';
    document.body.append(fxProbe);
    const c = document.createElement('canvas'); c.width = c.height = 1;
    fxPixel = c.getContext('2d', { willReadFrequently:true });
  }
  fxProbe.style.color = ''; fxProbe.style.color = value;
  fxPixel.fillStyle = '#000';
  fxPixel.fillStyle = getComputedStyle(fxProbe).color;
  fxPixel.fillRect(0, 0, 1, 1);
  const d = fxPixel.getImageData(0, 0, 1, 1).data;
  return [d[0], d[1], d[2]];
}
const FX_REAL = [[255,198,96],[255,198,96],[255,198,96],[255,146,54],[255,146,54],
                 [255,86,64],[255,240,208],[128,255,168],[116,190,255]];
const FX_EMBER = [255,246,226];
function fxMix(a, b, w){ return [0,1,2].map(i => Math.round(a[i]*(1-w) + b[i]*w)); }
/* 花火の色を 主に、テーマの色を 弱く。
   全色に テーマを 22% 混ぜる案は 失敗だった ―― **6テーマとも 同じ
   rgb(250,188,75) に なる。** 金に テーマの 黄を 混ぜていて、
   6テーマの 黄が ほぼ 同じだから。テーマらしさは 紫系（--v2）と
   緑系（--v3）に ある。そのまま 足すと UI の色が 飛んで 見えるので、
   白熱側へ 28% 寄せて「火の粉」に する。11色中 2色。 */
function fxBuildPalette(){
  return FX_REAL.concat(['--v2','--v3'].map(n => fxMix(fxRGB('var(' + n + ')'), FX_EMBER, .28)));
}
function fxColorAt(u){
  const p = fxPalette && fxPalette.length ? fxPalette : FX_REAL;
  return p[Math.floor(u * p.length * 2.5) % p.length];
}

/* 粒の絵。白熱した 芯 → 色の かさ → 透明。ただの丸では ない。
   芯を「円盤」に しないこと。白を 平らに 置くと 穴の 空いた ビーズに 見える。
   かさは 内側3割に 詰める。広げると 光条が かさに 埋もれ、
   「光条の 先より 光条の 間の ほうが 明るい」状態に なる。 */
function fxGlow(rgb, kind, power){
  const pw = power || 1;
  const key = kind + pw + rgb.join(',');
  if(fxSprites.has(key)) return fxSprites.get(key);
  const size = kind === 'bokeh' ? 256 : 128;
  const c = document.createElement('canvas'); c.width = c.height = size;
  const x = c.getContext('2d'); const r = size / 2; const R = rgb[0], G = rgb[1], B = rgb[2];
  const g = x.createRadialGradient(r, r, 0, r, r, r);
  if(kind === 'bokeh'){
    g.addColorStop(0, `rgba(${R},${G},${B},.36)`);  g.addColorStop(.62, `rgba(${R},${G},${B},.30)`);
    g.addColorStop(.80, `rgba(${R},${G},${B},.42)`); g.addColorStop(.93, `rgba(${R},${G},${B},.10)`);
    g.addColorStop(1, `rgba(${R},${G},${B},0)`);
  }else{
    g.addColorStop(0,   'rgba(255,255,255,.95)');
    g.addColorStop(.03, `rgba(255,${Math.round((255+G)/2)},${Math.round((255+B)/2)},.7)`);
    g.addColorStop(.10, `rgba(${R},${G},${B},.34)`);
    g.addColorStop(.22, `rgba(${R},${G},${B},.11)`);
    g.addColorStop(1,   `rgba(${R},${G},${B},0)`);
  }
  x.fillStyle = g; x.fillRect(0, 0, size, size);
  if(kind === 'star'){
    x.translate(r, r);
    /* 光条は「中心が 最も 太い 三角形」で 描いては いけない。4本が 重なって
       中央に 菱形が でき、その中に 芯が 乗ると「◯の 穴」に 見えて 毒々しくなる。
       細い 一定幅の 帯にして、強さは **長さと 明るさだけ** に 効かせる
       （幅にも 掛けると、強い段ほど 汚くなる）。 */
    const spike = (len, alpha) => {
      const wide = r * .018;
      const lg = x.createLinearGradient(0, 0, len, 0);
      lg.addColorStop(0,   `rgba(255,255,255,${alpha})`);
      lg.addColorStop(.10, `rgba(${R},${G},${B},${alpha * .8})`);
      lg.addColorStop(1,   `rgba(${R},${G},${B},0)`);
      x.fillStyle = lg; x.fillRect(0, -wide, len, wide * 2);
    };
    for(let i = 0; i < 4; i++){
      x.rotate(Math.PI / 2);
      spike(r * Math.min(.99, .62 * pw), Math.min(.95, .62 * pw));
      x.save(); x.rotate(Math.PI / 4);
      spike(r * Math.min(.5, .28 * pw), Math.min(.5, .3 * pw));
      x.restore();
    }
  }
  fxSprites.set(key, c);
  return c;
}

function fxOpen(darkMode){
  endFxCanvas();
  fxPalette = fxBuildPalette();
  fxDark = !!darkMode;
  fxLayer = document.createElement('div');
  fxLayer.className = 'fx';
  fxLayer.setAttribute('aria-hidden', 'true');
  document.body.append(fxLayer);
  const cv = document.createElement('canvas'); fxLayer.append(cv);
  const ratio = Math.min(window.devicePixelRatio || 1, 2);
  fxW = fxLayer.clientWidth; fxH = fxLayer.clientHeight; fxS = Math.min(fxW, fxH);
  cv.width = Math.round(fxW * ratio); cv.height = Math.round(fxH * ratio);
  fxCtx = cv.getContext('2d');
  fxCtx.setTransform(ratio, 0, 0, ratio, 0, 0);
}
const fxRand = (a, b) => a + Math.random() * (b - a);
function fxAdd(o){
  fxParts.push(Object.assign({
    x:0, y:0, vx:0, vy:0, g:0, drag:.1, life:1, age:0, wait:0,
    size:fxS * .01, rgb:[255,198,96], kind:'glow', power:1, rot:0, spin:0, fadeIn:.12
  }, o));
}
/* hold … 終わっても 自動で 消さない。C は 眺めていたいので 最後のコマを 残す */
function fxBegin(sec, fade, hold){
  fxFade = fade == null ? .13 : fade;
  fxT0 = performance.now(); fxLast = 0; fxEndAt = fxT0 + sec * 1000;
  fxRaf = requestAnimationFrame(fxFrame);
  if(!hold) fxTimers.push(setTimeout(endFxCanvas, sec * 1000 + 400));
}
/* いま 出ている 粒の 寿命を 縮めて 画面を 静める。**消すのでは なく
   早く 終わらせる** ので ぷつっと 切れない。完走が 押される 直前に 呼ぶ。
   まわりが 動いている 最中に 押すと、いちばん 見てほしい 0.7秒が 埋もれる。 */
function fxHush(sec){
  for(const p of fxParts){
    const left = p.life - p.age;
    if(left > sec) p.life = p.age + sec;
  }
}
function fxFrame(now){
  if(!fxCtx) return;
  const dt = Math.min((now - (fxLast || now)) / 1000, .05);
  fxLast = now;
  const el = (now - fxT0) / 1000;
  while(fxStages.length && el >= fxStages[0].at) fxStages.shift().run();

  fxCtx.globalCompositeOperation = 'source-over';
  if(fxDark){
    const rise = Math.min(1, el / .28);
    fxCtx.fillStyle = `rgba(9,7,16,${fxFade + (1 - rise) * .34})`;
    fxCtx.fillRect(0, 0, fxW, fxH);
  }else{
    fxCtx.globalCompositeOperation = 'destination-out';
    fxCtx.fillStyle = `rgba(0,0,0,${fxFade + .05})`;
    fxCtx.fillRect(0, 0, fxW, fxH);
  }
  fxCtx.globalCompositeOperation = fxDark ? 'lighter' : 'source-over';

  for(const p of fxParts){
    p.age += dt;
    /* wait … 生まれる 時刻を ずらす。渦は これだけで「描かれていく」ように 見える */
    if(p.age < p.wait) continue;
    const own = p.age - p.wait;
    if(own >= p.life) continue;
    p.vy += p.g * dt;
    const k = Math.pow(p.drag, dt);
    p.vx *= k; p.vy *= k;
    p.x += p.vx * dt; p.y += p.vy * dt;
    p.rot += p.spin * dt;
    const t = own / p.life;
    let a = t < p.fadeIn ? t / p.fadeIn : Math.pow(1 - (t - p.fadeIn) / (1 - p.fadeIn), 1.7);
    if(!fxDark) a *= .85;
    const img = fxGlow(p.rgb, p.kind, p.power);
    const d = p.size * (p.kind === 'bokeh' ? 1 : (.6 + (1 - t) * .7)) * 2;
    fxCtx.globalAlpha = Math.max(0, Math.min(1, a));
    if(p.rot){
      fxCtx.save(); fxCtx.translate(p.x, p.y); fxCtx.rotate(p.rot);
      fxCtx.drawImage(img, -d/2, -d/2, d, d); fxCtx.restore();
    }else{
      fxCtx.drawImage(img, p.x - d/2, p.y - d/2, d, d);
    }
  }
  fxParts = fxParts.filter(p => p.age - p.wait < p.life);
  fxCtx.globalAlpha = 1; fxCtx.globalCompositeOperation = 'source-over';
  if(now < fxEndAt || fxParts.length) fxRaf = requestAnimationFrame(fxFrame);
  else fxRaf = 0;   /* hold の ときは ここで 止まり、最後のコマが 残る */
}

/* 渦。経路の 上に 粒を 並べ、wait を 経路の 進みに 比例させる。
   これだけで「端から 端へ 描かれていく」ように 見える。 */
const FX_PATHS = {
  arc(u, cx, cy, R){
    const a = -2.5 + u * 4.7;
    return [cx + Math.cos(a) * R * 1.02, cy + Math.sin(a) * R * .92];
  }
};
function fxRibbon(kind, opt){
  const o = Object.assign({ count:190, travel:1.35, life:1.5, R:fxS * .46,
    cx:fxW / 2, cy:fxH * .46, power:1, hueShift:0, spread:.055, big:9 }, opt);
  const path = FX_PATHS[kind] || FX_PATHS.arc;
  for(let i = 0; i < o.count; i++){
    const u = i / o.count;
    const at = path(u, o.cx, o.cy, o.R);
    /* 帯に 厚みを 出す。中心が 濃く、外へ いくほど まばら */
    const j  = (Math.random() + Math.random() + Math.random() - 1.5) / 1.5;
    const j2 = (Math.random() + Math.random() + Math.random() - 1.5) / 1.5;
    const isBig = i % o.big === 0;
    fxAdd({
      x:at[0] + j * fxS * o.spread, y:at[1] + j2 * fxS * o.spread,
      vx:j * fxS * .05, vy:j2 * fxS * .05 - fxS * .02,
      drag:.5, life:o.life * fxRand(.75, 1.25),
      wait:u * o.travel + fxRand(0, .05),
      size:fxS * (isBig ? fxRand(.022, .04) : fxRand(.006, .016)),
      rgb:fxColorAt((u + o.hueShift) % 1),
      kind:isBig ? 'star' : (i % 4 === 0 ? 'bokeh' : 'glow'),
      power:o.power, fadeIn:.14,
      rot:fxRand(0, Math.PI), spin:fxRand(-.35, .35)
    });
  }
}
function fxSparkle(count, sec, power){
  for(let i = 0; i < count; i++){
    const big = i % 5 === 0;
    fxAdd({
      x:fxRand(.03,.97) * fxW, y:fxRand(.04,.96) * fxH,
      vx:fxRand(-.02,.02) * fxS, vy:fxRand(-.05,.01) * fxS,
      drag:.7, life:fxRand(sec * .45, sec * .85), wait:fxRand(0, sec * .45),
      size:fxS * (big ? fxRand(.045,.08) : fxRand(.011,.028)),
      rgb:fxColorAt(Math.random()), kind:big ? 'star' : 'glow',
      power:power || 1, fadeIn:.2, rot:fxRand(0, Math.PI), spin:fxRand(-.5,.5)
    });
  }
}
function fxBokeh(count, sec){
  for(let i = 0; i < count; i++){
    const near = i % 3 === 0;
    fxAdd({
      x:fxRand(-.1,1.1) * fxW, y:fxRand(-.05,1.05) * fxH,
      vx:fxRand(-.03,.03) * fxS, vy:fxRand(-.06,-.01) * fxS,
      drag:.9, life:fxRand(sec * .55, sec), wait:fxRand(0, sec * .3),
      size:fxS * (near ? fxRand(.07,.14) : fxRand(.025,.055)),
      rgb:fxColorAt(Math.random()), kind:'bokeh', fadeIn:.28
    });
  }
}
const FX_GOLD = [[255,198,96],[255,214,130],[255,146,54],[255,240,208]];
function fxShell(sx, sy, n, delay){
  for(let i = 0; i < 16; i++){
    fxAdd({ x:sx, y:fxH + i * (fxS * .01), vx:fxRand(-.01,.01) * fxS, vy:-(fxH - sy) / .5,
            g:fxS * .3, drag:.5, life:.52 - i * .012, wait:delay,
            size:fxS * fxRand(.009,.015), rgb:[255,224,150], fadeIn:.05 });
  }
  fxStages.push({ at:delay + .52, run:()=>{
    for(let i = 0; i < n; i++){
      const a = Math.PI * 2 * i / n + fxRand(-.05,.05);
      const s = fxRand(.55,.9) * fxS;
      fxAdd({ x:sx, y:sy, vx:Math.cos(a) * s, vy:Math.sin(a) * s * .82 - fxS * .06,
              g:fxS * .6, drag:.28, life:fxRand(1.7,2.5), size:fxS * fxRand(.010,.018),
              rgb:FX_GOLD[i % FX_GOLD.length], fadeIn:.03 });
    }
    fxAdd({ x:sx, y:sy, life:.34, size:fxS * .1, rgb:[255,246,222], fadeIn:.06 });
  }});
  fxStages.sort((a,b)=>a.at-b.at);
}

/* ---- 花丸（B）----
   2画。1画目＝外から 中心へ 向かう 渦。2画目＝もこもこ。
   もこもこは エピトロコイド x = C·cosψ + P·cos(Lψ)。**山の数は L−1** なので
   5つ 欲しければ L=6（L=5 だと 黙って 4つに なる）。
   極座標 r(θ) で 書いては いけない ―― 先の 切れこみが 尖った 花びらを 作り、
   **構造的に 桜に なる。** もこもこは 丸い 山。 */
const HM_R = 92;
const HM_START = Math.PI / 2;   /* 真下。ここから 角度が 増える 向きが 右回り */
const hmWob = a => 1 + .024 * Math.sin(a * 3.1 + .7) + .015 * Math.sin(a * 7.9 + 2.2);
function hanamaruCloudPts(){
  const C = .62, P = .115, L = 6, N = 420, pts = [];
  for(let i = 0; i <= N; i++){
    const t = (i / N) * Math.PI * 2;
    /* 揺らぎの 周波数は **整数**。3.1 のような 端数だと 一周して 戻ったとき
       半径が 合わず、始点と 終点に 段差が 出て「もうひとつの 端」に 見える */
    const wobble = 1 + .020 * Math.sin(3 * t + .7) + .012 * Math.sin(8 * t + 2.2);
    const asym = 1 + .10 * Math.sin(t + .8) + .06 * Math.sin(2 * t + 2.1);
    const w = wobble * asym;
    const psi = HM_START + t;
    pts.push([(C * Math.cos(psi) + P * Math.cos(psi * L)) * w * HM_R,
              (C * Math.sin(psi) + P * Math.sin(psi * L)) * w * HM_R * .78]);
  }
  pts.pop();                       /* 末尾は 先頭と 同じ点。回す前に 落とす */
  /* 描き始めを **跳ね返りの V字頂点**（半径の 極小）のうち、画面で
     いちばん 下の ものへ。形は 変えず、点列を 回すだけ。
     閉じた 曲線なので 端を またぐ 比較は **剰余で 回す。** pts[i+3] と
     素で 書くと 末尾で 範囲外に なり、例外で 点列生成ごと 止まる
     （症状は「花丸が 出ない」）。 */
  const rAt = k => {
    const q = pts[((k % pts.length) + pts.length) % pts.length];
    return Math.hypot(q[0], q[1]);
  };
  let vi = 0, best = -Infinity;
  for(let i = 0; i < pts.length; i++){
    const r = rAt(i);
    let low = true;
    for(let k = 1; k <= 3; k++) if(r > rAt(i - k) || r > rAt(i + k)) low = false;
    if(!low) continue;
    if(pts[i][1] > best){ best = pts[i][1]; vi = i; }   /* y が 大きい＝画面の下 */
  }
  const rot = pts.slice(vi).concat(pts.slice(0, vi));
  rot.push(rot[0]);
  return rot;
}
function hanamaruSpiralPts(){
  const N = 200, TURNS = 2.2, pts = [];
  for(let i = 0; i <= N; i++){
    const t = i / N;
    const psi = Math.PI * .1 + t * Math.PI * 2 * TURNS;
    const r = (.36 - .32 * t) * hmWob(psi) * HM_R;
    pts.push([Math.cos(psi) * r, Math.sin(psi) * r * .82]);
  }
  return pts;
}
const hanamaruD = (pts, n) => 'M' + pts.slice(0, Math.max(2, n))
  .map(q => q[0].toFixed(2) + ',' + q[1].toFixed(2)).join('L');
function hanamaruSVG(){
  return `<svg class="hanamaru" viewBox="-100 -100 200 200" aria-hidden="true">
      <path class="hm-spiral" d=""/><path class="hm-cloud" d=""/>
    </svg>`;
}
/* **stroke-dasharray / stroke-dashoffset は 使わない。**
   dash は「長い パターンを 窓で 切り出す」やり方で、線は 最初から 全部
   そこに あり 隠されているだけ。マスクの 計算が 少しでも ズレると 窓が
   複数箇所で 開き、**線が 複数の 起点から 生えたように 見える。**
   ここでは **d 属性そのものを、描いた 点までで 毎フレーム 作り直す。**
   その 瞬間に 画面に ある 線は いつでも「先頭から n 点目まで」だけなので、
   起点が 増えることが 原理的に 起こらない。 */
function hanamaruStroke(el, pts, dur, delay){
  if(!el) return;
  if(celebrateReduced()){ el.setAttribute('d', hanamaruD(pts, pts.length)); return; }
  el.setAttribute('d', hanamaruD(pts, 2));
  el.style.visibility = 'hidden';
  let t0 = null;
  const step = now => {
    if(!el.isConnected) return;
    if(t0 === null) t0 = now;
    const e = now - t0 - delay;
    if(e < 0){ requestAnimationFrame(step); return; }
    el.style.visibility = 'visible';
    const u = Math.min(1, e / dur);
    /* 書き出しだけ 少し ためて、あとは 一定の 速さで 運ぶ */
    const k = u < .18 ? (u / .18) * (u / .18) * .18 : u;
    el.setAttribute('d', hanamaruD(pts, Math.round(k * pts.length)));
    if(u < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}
function drawHanamaru(svg){
  if(!svg) return;
  /* はんこ着地（0.56秒）→ 1画目（0.7秒）→ 0.25秒あける → 2画目（1.7秒）。
     もこもこは 巻きが あるぶん、ゆっくり 運ばないと 一筆に 見えない */
  const START = 560, D1 = 700, PAUSE = 250, D2 = 1700;
  hanamaruStroke(svg.querySelector('.hm-spiral'), hanamaruSpiralPts(), D1, START);
  hanamaruStroke(svg.querySelector('.hm-cloud'), hanamaruCloudPts(), D2, START + D1 + PAUSE);
}

/* ---- 字面（インク）で 中央に そろえる ----
   text-align:center が そろえるのは **文字の 送り幅** であって、
   実際に 見えている インクでは ない。「完走！」の「！」は 全角の 枠を 取るのに
   インクが 左寄りで、73px の 字で 15.9px ずれる。canvas で 測って 差分だけ 寄せる。
   補正は **transform では なく left** で 入れる（transform だと 登場アニメと
   同じ 性質を 奪い合い、動きが 消える）。 */
let inkCanvas = null;
function inkCenter(el){
  if(!el) return;
  if(!inkCanvas) inkCanvas = document.createElement('canvas').getContext('2d');
  el.classList.remove('ink-centered');
  el.style.removeProperty('--ink-shift');
  const cs = getComputedStyle(el);
  inkCanvas.font = `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
  if('letterSpacing' in inkCanvas) inkCanvas.letterSpacing = cs.letterSpacing;
  const m = inkCanvas.measureText(el.textContent);
  if(!(m.actualBoundingBoxRight > 0)) return;
  const shift = m.width / 2 - (m.actualBoundingBoxRight - m.actualBoundingBoxLeft) / 2;
  /* 測れなかった・桁が 異常な ときは 何も しない（ずらさない ほうが 安全） */
  if(Math.abs(shift) < .3 || Math.abs(shift) > parseFloat(cs.fontSize)) return;
  el.style.setProperty('--ink-shift', shift.toFixed(2) + 'px');
  el.classList.add('ink-centered');
}

/* ---- はんこを 出す ----
   **表示時間は 出る回数の 逆に する。** 毎回の ものを のばすと 必ず 邪魔になり、
   ひと夏に 数回の ものは 短いと 読み終わる 前に 消える。
   入りと 出は 分ける（1つの キーフレームに ぜんぶ 入れると
   とどまる 長さを 段ごとに 変えられない）。 */
function raiseStamp(html, hold){
  const box = $('#stamp');
  if(!box) return null;
  box.classList.remove('is-out');
  box.innerHTML = '<div class="stamp-stack">' + html + '</div>';
  box.hidden = false;
  fxTimers.push(setTimeout(()=> box.classList.add('is-out'), hold));
  fxTimers.push(setTimeout(()=>{
    box.hidden = true; box.classList.remove('is-out'); box.innerHTML = '';
  }, hold + 400));
  return box;
}
/* 動きを 減らす 設定では、演出を **出さない** のでは なく 動かない 印に
   置きかえる。「できた」ことが 伝わらなく なるのは、動きが 苦手な 人にとっても 損。
   透過も 拡大縮小も しない。 */
function celebrateStill(full){
  const el = document.createElement('div');
  el.className = 'celebrate-still';
  el.setAttribute('role', 'status');
  el.innerHTML = '<span aria-hidden="true">✓</span>'
    + (full ? 'ぜんぶ できた！' : 'できた！');
  document.body.append(el);
  fxTimers.push(setTimeout(()=> el.remove(), 1400));
}

function celebrateItem(text){
  fxOpen(false);
  raiseStamp('<div class="stamp-mark is-all">' + esc(text) + '</div>', 1600);
  fxSparkle(34, 1.9, 1);
  fxBegin(2.2, .15);
}
/* B。A と 同じ はんこの まま 2行に して、その 右下に 花丸を 描く。
   **はんこを 差し替えないこと。** 分類の 最後の1課題を 終えた 瞬間は
   A と B が 同時に 成立する。別の はんこに すると そこで A の はんこが 消える。
   足すだけなら、いつもの はんこの まま「今回は 特別」が 伝わる。 */
function celebrateGroup(group){
  fxOpen(false);
  const name = wording(CELEBRATE_GROUP_KANA[group] || '', GROUP_LABEL[group] || '');
  const box = raiseStamp(
    '<div class="stamp-b">'
    + '<div class="stamp-mark is-all is-two"><span class="stamp-text">'
    + '<span class="stamp-line-a">「' + esc(name) + '」</span>'
    + '<span class="stamp-line-b">' + esc(wording('ぜんぶ おわったよ！', 'すべて完了')) + '</span>'
    + '</span></div>' + hanamaruSVG() + '</div>', 4300);
  if(box){
    /* はんこの 実寸を 測って 花丸の たてオフセットを 決め直す。
       **固定 px を 決め打ちしない。** はんこ幅が 160→331px へ 伸びたのに
       オフセットが 旧サイズ前提の 75px の ままで、実際に 食いこんだ。
       はんこは -11度 傾くので 外接する 高さは (S·sin11 + Sh·cos11)。 */
    const wrap = box.querySelector('.stamp-b');
    const mark = wrap && wrap.querySelector('.stamp-mark');
    if(wrap && mark){
      const rad = 11 * Math.PI / 180, ring = 11, gap = 8;
      const halfH = (mark.offsetWidth * Math.sin(rad) + mark.offsetHeight * Math.cos(rad)) / 2 + ring;
      wrap.style.setProperty('--hm-oy', (halfH + gap) + 'px');
    }
    drawHanamaru(box.querySelector('.hanamaru'));
  }
  /* 光条を 1.7倍。粒は A と 同じなので、強くなったのが 光条だと 分かる */
  fxSparkle(44, 2.4, 1.7);
  fxRibbon('arc', { count:170, travel:1.2, life:1.5, power:1.7 });
  fxBegin(3.0, .13);
}
/* C。「完走！」は はんこの 延長線上に 置くが、暗転した 夜空に 赤い はんこを
   置くと 警告に 見えるので 色だけ 金にする。自動では 消さない。 */
function celebrateFinale(){
  stopCelebration();
  /* しるしは **実際に 出したとき** に 残す（showFinale の 中）。
     押した 時点で 残すと、途中で 画面を 閉じられた ときに
     一度も 見ていないのに「見た」ことに なる */
  if(celebrateReduced()){ setLocal(K_FINALE_DONE, finaleSignature()); celebrateStill(true); return; }
  fxOpen(true);
  fxStages = [];
  [.2,.75,.45,.9,.14,.62,.34,.8].forEach((fx,i)=> fxShell(fxW*fx, fxH*fxRand(.15,.32), 68, i*.32));
  [.28,.5,.72].forEach((fx,i)=> fxShell(fxW*fx, fxH*fxRand(.13,.25), 92, 3.0 + i*.05));
  fxStages.push({ at:.1, run:()=> fxBokeh(20, 6.6) });
  fxStages.push({ at:1.1, run:()=> fxRibbon('arc', { count:200, travel:1.5, life:1.8, power:1.9 }) });
  fxStages.push({ at:2.9, run:()=> fxRibbon('arc', { count:200, travel:1.5, life:1.8, power:1.9,
                                                     cy:fxH * .56, R:fxS * .40 }) });
  fxStages.push({ at:3.4, run:()=> fxSparkle(52, 3.2, 1.9) });
  /* 完走は 花火の ピークを 過ぎてから。かぶせると 文字が 読めない。
     さらに **押される 直前に まわりを 静める。** */
  fxStages.push({ at:4.15, run:()=> fxHush(.45) });
  fxStages.push({ at:4.3, run:showFinale });
  fxStages.sort((a,b)=>a.at-b.at);
  fxBegin(7.4, .1, true);   /* hold。自動では 消さず「もういちど／とじる」に まかせる */
}
function showFinale(){
  $$('.finale').forEach(f => f.remove());
  setLocal(K_FINALE_DONE, finaleSignature());
  const el = document.createElement('div');
  el.className = 'finale';
  /* 期間の 呼び名は 設定で 変わる。**文字列を 直に 書かない。** */
  el.innerHTML =
    '<div class="finale-seal"><p class="finale-word">完走！</p></div>'
    + '<p class="finale-sub">' + esc(periodWord(true)) + '、ぜんぶ やりきったね！</p>'
    + '<div class="finale-acts"><button type="button" data-finale="again">'
    + '<svg viewBox="0 0 24 24" aria-hidden="true">'
    + '<path d="M19.6 7.4A8.6 8.6 0 1 0 20.6 13.4"/><path d="M20.9 2.6l-1.3 4.9-4.9-1.3"/>'
    + '</svg>もういちど</button></div>';
  const close = document.createElement('button');
  close.className = 'finale-close';
  close.type = 'button';
  close.setAttribute('aria-label', 'とじる');
  close.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>';
  close.addEventListener('click', stopCelebration);
  el.append(close);
  document.body.append(el);
  el.querySelector('[data-finale="again"]').addEventListener('click', celebrateFinale);
  /* 押しこみの 開始倍率は **画面から 逆算する。** ねらいは 開始時の 幅が
     画面幅の 約1.35倍（ふつうの「できた！」は 105〜141% で、そこは
     動きが 見えている）。固定の 3.2倍だと iPhone で 246〜355% になり、
     動きの 大半が 画面の 外で 起きていた。 */
  const seal = el.querySelector('.finale-seal');
  const sw = seal.offsetWidth || 1;
  seal.style.setProperty('--seal-in',
    Math.max(1.3, Math.min(1.9, window.innerWidth * 1.35 / sw)).toFixed(2));
  inkCenter(el.querySelector('.finale-word'));
  inkCenter(el.querySelector('.finale-sub'));
}

/* はんこ。celebration は celebrateLevel() の 返り値（無ければ 毎回の はんこ） */
function stamp(text, celebration){
  stopCelebration();
  const level = celebration && celebration.level || '';
  /* C は 動きを 減らす 設定でも celebrateFinale() を 通す。
     「出した」しるしを 残すのは あちらなので、ここで 分岐を 増やすと
     軽減表示の 人だけ 何度も 判定に 引っかかる */
  if(level === 'c'){ celebrateFinale(); return; }
  if(level && celebrateReduced()){ celebrateStill(false); return; }
  if(level === 'b'){ celebrateGroup(celebration.group); return; }
  if(level === 'a'){ celebrateItem(text || 'ぜんぶ できた！'); return; }
  raiseStamp('<div class="stamp-mark">' + esc(text || 'できた！') + '</div>', 900);
}

/* ---------------------------------------------------------
   すすみぐあいの けいさん
   --------------------------------------------------------- */
/* しあげの2段階（マルつけ・なおし）が つく課題か */
function hasWrap(t){ return !!(t && t.wrapUp && (t.type === 'count' || t.type === 'step')); }

/* まるつけをする人。古い課題は、これまでどおりおとながする設定として読む */
function wrapMarkerBy(t){ return t && t.wrapBy === 'child' ? 'child' : 'adult'; }

function wrapLabelsFull(t){
  return [wrapMarkerBy(t) === 'child' ? 'マルつけする' : 'マルつけして もらう', 'なおし'];
}

/* ほぞんされた wrap を かならず 真偽値の はいれつに する（無ければ 未着手） */
function wrapOf(p){
  const a = Array.isArray(p.wrap) ? p.wrap : [];
  return WRAP_LABELS.map((_,i)=> !!a[i]);
}

/* しあげの2段階は、宿題全体のノルマにも入れる。
   番号（段階）の表示はそのまま残し、allDone / allTotal / allPct で
   マルつけ・なおし込みの全体進捗を出す。 */
/* 記録の しつもん（観察の観点など）も、宿題の ノルマに 数える。

   答えは state.questionAnswers に あり、progress とは 別の 欄で 合流する。
   だから ここでは 数えるだけで、progPatch は 通さない（同期のしかたを 変えない）。

   数える 元は 共有ぶんと この端末の ひかえの 新しい方。**古い記録の 本文から
   拾い直す legacyQuestionAnswers は ここでは 使わない。** 描き直しの たびに
   全部の 記録を 読むことに なるうえ、旧い答えは シートを 開いて 保存すれば
   専用の 欄へ 移る。 */
let answerMapCache = null;
function localAnswerMap(){
  const raw = getLocal(K_QUESTION_ANSWERS) || '{}';
  if(answerMapCache && answerMapCache.raw === raw) return answerMapCache.map;
  let map = {};
  try{
    const saved = JSON.parse(raw) || {};
    if(saved.rows && typeof saved.rows === 'object' && !Array.isArray(saved.rows)){
      map = ms(saved.resetAt) === ms(state.resetAt) ? saved.rows : {};
    }else{
      /* 旧フラット形式は削除世代がまだ無い端末だけで読む。 */
      map = ms(state.resetAt) ? {} : saved;
    }
  }catch(e){ map = {}; }
  answerMapCache = { raw, map };
  return map;
}
function clearQuestionAnswerCache(){
  answerMapCache = null;
  try{ localStorage.removeItem(K_QUESTION_ANSWERS); }catch(e){}
}
function answeredQuestionCount(task){
  const qs = (task && task.questions || []).length;
  if(!qs) return 0;
  const shared = state.questionAnswers && state.questionAnswers[task.id];
  const local = localAnswerMap()[task.id];
  const pick = !shared || (local && ms(local.at) > ms(shared.at)) ? local : shared;
  const arr = pick && Array.isArray(pick.answers) ? pick.answers : [];
  let n = 0;
  for(let i = 0; i < qs; i++) if(String(arr[i] || '').trim()) n++;
  return n;
}
/* しつもんを ノルマに 入れるのは、番号・段階の 課題だけ。まいにちの 課題は
   その日ぶんの 回数が ノルマなので、日を またぐ 答えを 足すと 意味が 変わる */
function countsQuestions(task){
  return !!(task && (task.questions || []).length &&
            (task.type === 'count' || task.type === 'step'));
}

function withWrap(task, p, r){
  r.numDone  = r.isDone;        // 番号（段階）を ぜんぶ 終えたか
  r.wrap     = wrapOf(p);
  r.allDone  = r.done;
  r.allTotal = r.total;
  r.allPct   = r.pct;
  if(!hasWrap(task)) return r;
  const w = r.wrap.filter(Boolean).length;
  // allDone / allTotal は 2段階こみの かぞえかた（ほかから 使うので のこす）
  r.allDone  = r.done + w;
  r.allTotal = r.total + r.wrap.length;
  r.allPct   = r.allDone / r.allTotal * 100;
  r.isDone   = r.numDone && w >= r.wrap.length;
  return r;
}

/* しつもんは、番号・段階・しあげ と 同じ ならびで 数える。
   **done / total / text は さわらない。** ここを 足すと
   「つぎは ⑦」や 記録シートの えらび先が ずれる。 */
function withQuestions(task, r){
  r.qTotal = (task && task.questions || []).length;
  r.qDone  = 0;
  if(!countsQuestions(task)) return r;
  r.qDone    = answeredQuestionCount(task);
  r.allDone  = r.allDone + r.qDone;
  r.allTotal = r.allTotal + r.qTotal;
  r.allPct   = r.allTotal ? r.allDone / r.allTotal * 100 : 0;
  r.isDone   = r.isDone && r.qDone >= r.qTotal;
  return r;
}

function prog(task){
  const p = state.progress[task.id] || {};
  if(task.type === 'count'){
    const total = Math.max(1, task.total|0);
    const done  = clamp(p.done|0, 0, total);
    return withQuestions(task, withWrap(task, p,
           { done, total, pct: done/total*100, unit: task.unit || 'こ',
             text: done+'/'+total+(task.unit||''), isDone: done >= total }));
  }
  if(task.type === 'step'){
    const steps = task.steps || [];
    const arr = Array.isArray(p.steps) ? p.steps : [];
    const done = steps.reduce((a,_,i)=> a + (arr[i] ? 1 : 0), 0);
    const total = Math.max(1, steps.length);
    return withQuestions(task, withWrap(task, p,
           { done, total, pct: done/total*100, unit:'',
             text: done+'/'+steps.length, isDone: done >= steps.length, arr }));
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
    /* しあげも 終わっているのに ここへ 来るのは、しつもんが のこって
       いるとき。i は -1 に なるので、そのまま 使うと 空欄が 出る */
    if(i >= 0) return { lead:'つぎは', num:'', tail: wrapLabelsFull(task)[i] };
  }
  /* 番号（段階）も しあげも 終わって、しつもんだけ のこっている */
  if(p.numDone && (p.qDone || 0) < (p.qTotal || 0)){
    return { lead:'つぎは', num:'', tail: wording('しつもんに こたえる', '問いに答える') };
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

/* しゅくだい ぜんたいの すすみぐあい（かならずやる だけ／まいにちアプリは のぞく）。
   しあげを付けた課題は、マルつけ・なおしも2項目分として入れる。 */
function overall(group){
  let done = 0, total = 0;
  config.tasks.filter(t => t.group === group && t.type !== 'daily').forEach(t=>{
    const p = prog(t); done += p.allDone; total += p.allTotal;
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
    <p class="welcome-kicker">${TEST_MODE ? 'おためしモード' : '初めの準備'}</p>
    <h2 id="welcomeTitle">しゅくだいノート</h2>
    ${getLocal(K_RETIRED_NOTICE) ? `<div class="welcome-retired" role="status"><b>共有データを削除しています</b><p>この共有データは削除処理中のため、もう使えません。新しい合言葉で始めてください。</p></div>` : ''}
    <div class="paper welcome-step">
      <span class="welcome-num">1</span>
      <div><h3>ホーム画面に追加</h3>
      <p>${installed ? 'この端末はホーム画面から開いています。' : 'iPad / iPhone では、Safari の共有ボタン →「ホーム画面に追加」を押すと、いつも同じ場所から開けます。'}</p>
      <p class="set-note">後からホーム画面に追加したときも、合言葉を読み込めば、同じグループの複数の端末で同じ記録と設定を使えます。</p></div>
    </div>
    <div class="paper welcome-step">
      <span class="welcome-num">2</span>
      <div><h3>使い方を選ぶ</h3>
      <div class="welcome-roles">
        <button class="btn welcome-role" data-welcome-mode="solo" type="button" aria-pressed="false"><span class="welcome-role-copy"><b>子どもだけで使う</b><small>すぐに始められます</small></span></button>
        <button class="btn welcome-role welcome-role--share${DEBUG_WELCOME ? ' is-selected' : ''}" data-welcome-mode="share" type="button" aria-pressed="${DEBUG_WELCOME ? 'true' : 'false'}">${icon('users')}<span class="welcome-role-copy"><b>保護者も共有する</b><small>後からでも設定できます</small></span></button>
      </div>
       <aside class="welcome-parent-entry" data-no-reading><b>保護者の方へ</b><p>子ども画面へ進んだあと、画面上のタイトルを<b>5回タップ</b>するか、<b>2秒長押し</b>すると保護者ページを開けます。宿題の登録・変更や設定は、そこから行えます。</p></aside>
       ${TEST_MODE ? '<p class="set-note">おためしモードでは、現在使っているグループのデータ・合言葉・集計には触れません。</p>' : (hasSync ? '' : '<p class="set-note">同期の準備が未設定のため、この端末だけで使います。後から設定ページで同期を有効にできます。</p>')}</div>
    </div>
    <div class="welcome-form" id="welcomeForm"${DEBUG_WELCOME ? '' : ' hidden'}>${DEBUG_WELCOME
      ? (previewRole === 'parent' ? welcomeParentSharePickerHTML(3) : welcomeFormHTML('child', true, 3)) : ''}</div>
  </section>`;
}
/* 自前で 描いた アイコン。@codexteam/icons（MIT）とは べつに、
   このアプリの ために かいたもの なので Apache-2.0 側に なる。
   ゴミ箱は 線ではなく 塗りの ピクトグラム。20px でも つぶれず、
   丸みで やわらかく 見えるように している。
   色は currentColor なので、ボタン側の color が そのまま つかわれる。 */
const APP_ICONS = {
  trash:'<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none"><path fill="currentColor" d="M9.8 2.4h4.4A1.6 1.6 0 0 1 15.8 4v1.2H8.2V4a1.6 1.6 0 0 1 1.6-1.6Z"/><rect x="2.8" y="5.1" width="18.4" height="3" rx="1.5" fill="currentColor"/><path fill="currentColor" fill-rule="evenodd" d="M5.4 9.6h13.2l-.6 8.6a3.2 3.2 0 0 1-3.2 3H9.2a3.2 3.2 0 0 1-3.2-3L5.4 9.6Zm4.3 2.6a1.05 1.05 0 0 0-1.05 1.05v4.2a1.05 1.05 0 1 0 2.1 0v-4.2A1.05 1.05 0 0 0 9.7 12.2Zm4.6 0a1.05 1.05 0 0 0-1.05 1.05v4.2a1.05 1.05 0 1 0 2.1 0v-4.2a1.05 1.05 0 0 0-1.05-1.05Z"/></svg>',
  edit:'<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none"><path d="m5 15.8-1 4.2 4.2-1L19.1 8.1a2.3 2.3 0 0 0 0-3.2 2.3 2.3 0 0 0-3.2 0L5 15.8Z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="m14.2 6.6 3.2 3.2M5 15.8 8.2 19" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  offline:'<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none"><path d="M3.6 8.8A13.2 13.2 0 0 1 12 5.7c3.1 0 6 1.1 8.4 3.1M6.7 12a8.1 8.1 0 0 1 3-1.7M14.2 10.3c1.1.3 2.1.9 3 1.7M9.8 15.1c.7-.4 1.4-.6 2.2-.6.8 0 1.5.2 2.2.6M12 19h.01M4 4l16 16" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  refresh:'<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none"><path d="M20 11a8 8 0 0 0-14.4-4.8L4 8" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M4 4v4h4" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M4 13a8 8 0 0 0 14.4 4.8L20 16" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M20 20v-4h-4" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>'
};
/* 自前のものを 先に 見る。同じ名前が codex 側に あっても こちらが 勝つ */
function icon(name){
  const svg = APP_ICONS[name] || (window.CodeXIcons && window.CodeXIcons[name]);
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
/* メッセージを読んだかどうかは、この端末だけの表示状態。共有 state に入れると
   だれか1人が見ただけで子どもの端末の印まで消えてしまう。 */
const K_MESSAGES_SEEN = 'natsu.messages.seen.v1';
let shownNewMessageIds = new Set();
function seenMessageIds(){
  try{
    const value = JSON.parse(getLocal(K_MESSAGES_SEEN) || '[]');
    return Array.isArray(value) ? value.filter(id=> typeof id === 'string').slice(-50) : [];
  }catch(e){ return []; }
}
function rememberSeenMessages(rows){
  const ids = new Set(seenMessageIds());
  (rows || []).forEach(m=>{ if(m && m.id) ids.add(m.id); });
  setLocal(K_MESSAGES_SEEN, JSON.stringify(Array.from(ids).slice(-50)));
}
function messages(){
  const gone = new Set((state.gone || []).map(g=> g.id));
  return (state.messages || [])
    .filter(m => m && m.id && m.text && !gone.has(m.id))
    .sort((a,b)=> String(b.at||'').localeCompare(String(a.at||'')))
    .slice(0, MESSAGES_MAX);
}
function messageHeading(m){
  if(!m) return '';
  if(m.sender === '名前表示なし') return 'おうちの人より';
  const sender = m.sender === 'その他' ? (m.customSender || 'おうちの人') : parentSenderLabel(m.sender);
  return `${sender}より`;
}
/* 旧configはstateへ移した本文を二重に持たない。バックアップにも残さず、
   旧送信者の自由入力も不要になった時点で消す。 */
function clearLegacyParentMessage(){
  const old = config.parentMessage || {};
  const changed = !config.parentMessageMoved || !!old.enabled || !!old.text || !!old.customSender
    || old.sender !== 'おかあさん';
  config.parentMessage = { enabled:false, sender:'おかあさん', customSender:'', text:'' };
  config.parentMessageMoved = true;
  return changed;
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
  const legacy = !!(old && old.enabled && old.text);
  if(!Array.isArray(state.messages)) state.messages = [];
  const residue = !!(old && (old.enabled || old.text || old.customSender));
  if(!legacy && !residue && !config.parentMessageMoved && !state.messages.length) return;
  if(legacy && !config.parentMessageMoved && !state.messages.length){
    state.messages.push({
      id: 'm-legacy-' + Date.now(),
      sender: old.sender, customSender: old.customSender,
      text: old.text, at: new Date().toISOString(), by: logBy()
    });
    saveSt();
  }
  if(clearLegacyParentMessage()) saveCfg();
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
        <div class="set-actions qr-scan-entry"><button class="btn btn-sm btn-ghost" type="button" data-qr-invite-scan>QRコードを読み取る</button></div>
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
      <div class="set-actions qr-scan-entry"><button class="btn btn-sm btn-ghost" type="button" data-qr-invite-scan>QRコードを よみとる</button></div>
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
    <span class="credit-part"><a href="start/updates.html">変更履歴</a></span>
    <span class="credit-part">v${esc(RELEASE_VERSION)}</span>
    <span class="credit-part">配信 ${esc(APP_VER)}</span>
  </p>`;
}

function privacyNoteHTML(){
  return `<aside class="privacy-note">
    <span><b>注意事項</b><small>合言葉と共有データの取り扱い</small></span>
    <button class="btn btn-sm btn-ghost" type="button" data-share-safety>内容を確認</button>
  </aside>
  <p class="set-note retention-note">オンライン共有データは、どの端末からも更新が90日間ない場合に削除対象となり、管理者が確認して削除します。自動削除ではなく、予告メールもありません。見るだけでは期間は延びません。端末だけのデータと書き出したファイルは対象外です。</p>`;
}
function shareSafetyText(){
  return [
    '共有する前にご確認ください',
    '',
    '・合言葉には、普段使っているパスワードや秘密の言葉を使わないでください。このアプリが自動で作る合言葉の利用をおすすめします。',
    '・QRコードや招待リンクを受け取った人は、グループの共有データに接続できます。信頼できる相手だけに渡してください。',
    '・名前・宿題・記録は、端末間で共有するためクラウドに保存されます。保存の前にこの端末で暗号化するため、保管しているサーバー側では中身を読めません。',
    '・鍵は合言葉から作られ、どこにも送られません。**合言葉をすべての端末で忘れると、クラウド上の記録は誰にも復元できません。** 大切な記録は「データ管理」から書き出して保管してください。',
    '・オンライン共有データは、どの端末からも更新が90日間ない場合に削除対象となり、管理者が確認して削除します。自動削除ではなく、予告メールもありません。画面を開いて見るだけでは期間は延びません。端末だけのデータと書き出したファイルは対象外です。',
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

/* ---------------------------------------------------------
   宿題の 一覧の 写真

   1家庭に 1枚だけ。写真の 本体は **この端末の 中**（IndexedDB）に あり、
   config には ボタンの 名前と「いつのものか」しか 入れない。
   **config に 画像を 入れないこと。** 入れると 1文書 1MiB の 上限に あたり、
   家庭ぜんぶの 同期が 止まる。

   ほかの端末へは、一時の 受け渡し箱（sync.js の 5.7）で 渡す。
   届いていない ときは「まだ とどいていない」と 出す。壊れて 見せない。
   --------------------------------------------------------- */
/* 4枚まで。**枠は 0〜3 の 固定で、詰め直さない。** 2まいめを 消しても
   3まいめは 3まいめの まま。詰めると 枠ごとの 合図が すべて ずれ、
   関係の ない 端末が 全部を 取り直す。空き枠が 見えるほうが 安い。
   足すときは いちばん 小さい 空き枠に 入る。 */
const POSTER_MAX = 4;
/* **0まいめの キーは これまでと 同じ `poster`。** すでに 1枚 持っている
   家庭は、移行の 処理なしで そのまま 0まいめに なる */
function posterId(slot){ const n = Number(slot) || 0; return n > 0 ? 'poster-' + n : 'poster'; }
const POSTER_LABEL_DEFAULT = 'いちらん';
/* 旧い 1枚だけの 控え。**消さずに 残す。** 0まいめの 控えは 新旧 両方へ 書く。
   旧い 版へ もどった ときに、持っている 写真を 取り直さない ため */
const K_POSTER_AT = TEST_MODE ? 'natsu.preview.poster.at.v1' : 'natsu.poster.at.v1';
const K_POSTER_ATS = TEST_MODE ? 'natsu.preview.poster.ats.v1' : 'natsu.poster.ats.v1';
/* さいごに 渡せたか どうか。端末ごとの 控えで、共有には 入れない */
const K_POSTER_SENT = TEST_MODE ? 'natsu.preview.poster.sent.v1' : 'natsu.poster.sent.v1';
let posterURLs = [];       // 表示用。IndexedDB の Blob から 作る（枠ごと）
let posterFresh = false;   // 届いたばかりの 印
let posterRun = null;      // 取りに行っている 最中の 約束（二重に 走らせない）

function photos(){ return window.NatsuPhotos || null; }
/* 同期の入口。**素の `S` を書かないこと。** このコードベースの `S` は
   グローバルではなく、使う関数ごとに `const S = window.NatsuSync;` と
   宣言する 約束に なっている。うっかり 素で 書くと、その関数は
   ReferenceError で 丸ごと 止まる（bindConfig が 止まり、保護者ページの
   設定が すべて 効かなく なった）。写真まわりは この関数を 通す。 */
function sync(){ return window.NatsuSync || null; }
function posterCfg(){
  const p = config.poster && typeof config.poster === 'object' ? config.poster : {};
  return {
    label: String(p.label == null ? '' : p.label).trim().slice(0, 6),
    at: ms(p.at),
    ats: posterAtsFrom(p)
  };
}
/* 枠ごとの 合図。旧い 1枚だけの 設定（at だけ）は 0まいめと して 引きつぐ */
function posterAtsFrom(p){
  const raw = Array.isArray(p && p.ats) ? p.ats : [];
  const out = [];
  for(let i = 0; i < POSTER_MAX; i++) out.push(ms(raw[i]));
  if(!out[0]) out[0] = ms(p && p.at);
  return out;
}
/* 共有へ 出す 形。**at には max(ats) を 入れない。** 旧い 端末は at を 見て
   「これまでの ID（＝0まいめ）」を 取りに 行くので、at が ほかの 枠の 時刻だと
   0まいめを 新しい ものと 取りちがえる */
function posterCfgOut(label, ats){
  return { label: String(label || '').trim().slice(0, 6), at: ms(ats[0]), ats: ats.map(ms) };
}
function posterHeldAts(){
  let list = [];
  try{ list = JSON.parse(getLocal(K_POSTER_ATS) || '[]'); }catch(e){}
  if(!Array.isArray(list)) list = [];
  const out = [];
  for(let i = 0; i < POSTER_MAX; i++) out.push(ms(list[i]));
  if(!out[0]) out[0] = ms(getLocal(K_POSTER_AT));
  return out;
}
function setPosterHeldAt(slot, at){
  const list = posterHeldAts();
  list[Number(slot) || 0] = ms(at);
  setLocal(K_POSTER_ATS, JSON.stringify(list));
  /* 0まいめだけは 旧い キーにも 書く（旧い 版へ もどっても 取り直さない） */
  if(!slot) setLocal(K_POSTER_AT, String(ms(at)));
}
/* 名前を 入れて いない 家庭のための 言い方。**帯の ボタンには 使わない**
   （入れて いない のに 語が 出ると、設定した ように 見える）。
   読み上げと、開いた 画面の 見出しと、届いた ときの 知らせに だけ 使う */
function posterWord(){ return posterCfg().label || POSTER_LABEL_DEFAULT; }

/* 端末に ある ぶんを 出す。読めなくても アプリは そのまま 動く */
async function loadPoster(){
  const lib = photos();
  if(!lib) return;
  posterURLs.forEach(u=>{ if(u) URL.revokeObjectURL(u); });
  const next = [];
  for(let slot = 0; slot < POSTER_MAX; slot++){
    const blob = await lib.get(posterId(slot));
    next.push(blob ? URL.createObjectURL(blob) : '');
  }
  posterURLs = next;
}
/* この端末に ある 枠 / 空いている いちばん 小さい 枠 */
function posterHere(){ return posterURLs.filter(Boolean).length; }
function posterFreeSlot(){
  const cfg = posterCfg();
  for(let slot = 0; slot < POSTER_MAX; slot++){
    if(!posterURLs[slot] && !cfg.ats[slot]) return slot;
  }
  return -1;
}

/* グループの 印が この端末の ものより 新しければ、箱から 受け取る。
   受け取ったら 知らせる（黙って 差しかえない） */
const POSTER_RETRY_MS = 3 * 60 * 1000;
let posterTriedAt = 0;
/* opts.force … 人が「受け取る」を 押した とき。間引きを 飛ばし、
   結果を 返す（'got' / 'empty' / 'skip'）。ふだんの 自動の 呼び出しは
   黙って 帰る。**自動だけに 頼らないこと。** 届かなかった ときに
   何が 起きたのか 人に 分からないと、直しようが ない。 */
/* 消された 枠を、この端末からも 落とす。**これが 写真の 墓標にあたる。**
   合図（ats[slot]）が 0 に なったのに 端末の 中の 写真を そのままに すると、
   保護者が 消したのに 子どもの 画面には 出つづける。持っていない 端末では
   何も 起きないので、呼びっぱなしで よい。

   合図を 一度も 受け取って いない ときは 何も しない（控えが 0 の 枠は
   「消された」ではなく「まだ 知らない」） */
/* **「渡す」を 人に 押させない ための 仕組み。**

   これまでは、写真を 選んだ その 場でしか 預かり箱に 入らなかった。箱は 24時間で
   空に なるので、前に 登録した 写真や、あとから 増えた 端末には 自動では 届かず、
   「ほかの端末へ渡す」を 押す 必要が あった。**その 分かれ道を 無くす。**

   保護者ページを 開いた ときに 一度だけ、4つの 枠の 状態を 見て、
   この端末が 持っている ぶんで 箱に 無い ものを 入れ直す。こうすると
   箱は いつでも 埋まっているので、**どの 端末でも 開けば 届く。**

   引きかえに、共有している あいだ 写真は ほぼ いつも 箱に ある（暗号化ずみ）。
   使い方には「共有をやめるか写真を消せば24時間以内に消えます」と 書くこと。 */
async function refreshHandoff(){
  const S = sync(), lib = photos();
  if(!S || !lib || !sharingOn() || typeof S.handoffAts !== 'function') return;
  const cfg = posterCfg();
  const span = Number(S.HANDOFF_MS) || 24 * 60 * 60 * 1000;
  let boxes = [];
  try{ boxes = await S.handoffAts(); }catch(e){ return; }
  for(let slot = 0; slot < POSTER_MAX; slot++){
    const at = Number(boxes[slot]) || 0;
    const stale = at > 0 && Date.now() - at >= span;
    /* 共有から 外れた 枠の 箱は 片づける（持っていても 入れ直さない） */
    if(!cfg.ats[slot]){
      if(at > 0 && typeof S.clearHandoff === 'function') await S.clearHandoff(slot);
      continue;
    }
    if(!posterURLs[slot]){
      if(stale && typeof S.clearHandoff === 'function') await S.clearHandoff(slot);
      continue;
    }
    if(at > 0 && !stale) continue;         // まだ 生きている。書かない
    const blob = await lib.get(posterId(slot));
    if(!blob) continue;
    const dataURL = await lib.toDataURL(blob);
    if(dataURL) await S.putHandoff(dataURL, slot);
  }
}

/* 使い方ウインドウの「うまく届かないとき」から 呼ぶ。結果は 枚数で 言う */
async function posterHandAll(){
  if(!await handPoster()) return;
  const at = Date.now();
  const ats = posterCfg().ats;
  for(let slot = 0; slot < POSTER_MAX; slot++){
    if(!posterURLs[slot]) continue;
    ats[slot] = at;
    setPosterHeldAt(slot, at);
  }
  config.poster = posterCfgOut(posterCfg().label, ats);
  saveCfg();
  render({ keepScroll:true });
}

async function posterTakeAll(){
  toast('写真をさがしています…');
  const r = await checkPosterArrival({ force:true, quiet:true });
  if(r.got && !r.missing){ toast('写真を' + r.got + '枚 受け取りました'); return; }
  if(r.got){ toast('写真を' + r.got + '枚 受け取りました。あと' + r.missing + '枚は見つかりません'); return; }
  if(r.status === 'offline'){ toast('共有につながっていません。通信を確かめてください'); return; }
  if(r.status === 'skip'){ toast('受け取る写真はありません'); return; }
  toast('見つかりません。写真のある端末でこの画面を開いてから、もう一度お試しください');
}

async function dropRemovedPosters(){
  const lib = photos();
  if(!lib) return false;
  /* **共有していない 端末では 何も しない。** 手元の 設定は 自分で 書いた
     ものなので、食いちがう ことが そもそも 無い。ここを 開けておくと、
     設定が まだ 育っていない 場面（おためし・初期設定の 途中）で、
     端末に ある 写真を 消して しまう。実機の 確認で 実際に 消えた。 */
  const S = sync();
  if(!sharingOn() || !S) return false;
  /* **グループの 設定を 受け取る 前に 判断しない。** つないだ 直後の 1回は
     こちらの 設定より グループの ほうが 勝つ 決まりに なっている。その 前の
     初期値（写真の 印が 無い）を「消された」と 読むと、いま 撮った ばかりの
     写真が 消える（saveCfg の 順番で 起きた 事故と 同じ 筋） */
  if(typeof S.awaitingFirstSnapshot === 'function' && S.awaitingFirstSnapshot()) return false;
  const cfg = posterCfg();
  const held = posterHeldAts();
  let dropped = false;
  for(let slot = 0; slot < POSTER_MAX; slot++){
    if(cfg.ats[slot] || !held[slot]) continue;
    await lib.remove(posterId(slot));
    setPosterHeldAt(slot, 0);
    dropped = true;
  }
  if(dropped) await loadPoster();
  return dropped;
}

/* **人が 押した ときは、走っている ぶんを 待ってから やり直す。**
   以前は 走っている あいだ 'skip' を 返して いたので、押しても「共有の状態を
   確かめてください」しか 出なかった。枠が 4つに なって 1回が 4往復に なり、
   この 窓が 4倍 ひろがった（実機で「押しても 反応が ない」と なった）。 */
async function checkPosterArrival(opts){
  const force = !!(opts && opts.force);
  if(posterRun){
    if(!force) return { status:'skip', got:0, missing:0 };
    try{ await posterRun; }catch(e){}
  }
  posterRun = posterArrivalRun(opts);
  try{ return await posterRun; }
  finally{ posterRun = null; }
}

/* 返すのは **枚数つきの 結果**。「〇枚 受け取りました」と 言えないと、
   何が 起きたのか 利用者に 分からない（実機の 指摘） */
async function posterArrivalRun(opts){
  const force = !!(opts && opts.force);
  const quiet = !!(opts && opts.quiet);
  const lib = photos();
  if(!lib) return { status:'skip', got:0, missing:0 };
  if(await dropRemovedPosters()) render({ keepScroll:true });
  const want = posterCfg().ats;
  const held = posterHeldAts();
  /* くらべるのは 端末の 中の 値どうし。ここで 帰るときは 通信しない。
     人が 押した ときは、印が 同じでも いちおう 見にいく */
  const slots = [];
  for(let slot = 0; slot < POSTER_MAX; slot++){
    if(!want[slot]) continue;
    if(force || want[slot] > held[slot]) slots.push(slot);
  }
  if(!slots.length) return { status:'skip', got:0, missing:0 };
  const S = sync();
  if(!(S && typeof S.takeHandoff === 'function' && sharingOn())){
    return { status:'offline', got:0, missing:slots.length };
  }
  /* 箱が まだ 空の ことは ある（渡す 途中など）。空振りを くり返して
     読み取りを 使い切らないよう、3分に 一度までに する */
  if(!force && posterTriedAt && Date.now() - posterTriedAt < POSTER_RETRY_MS){
    return { status:'skip', got:0, missing:slots.length };
  }
  posterTriedAt = Date.now();
  let got = 0;
  for(const slot of slots){
    const dataURL = await S.takeHandoff(slot);
    if(!dataURL) continue;
    const blob = await lib.fromDataURL(dataURL);
    if(!blob) continue;
    await lib.put(posterId(slot), blob);
    setPosterHeldAt(slot, want[slot]);
    got++;
    /* **受け取っても 消さない。** 消すと、まだ 受け取って いない 端末が
       取り逃がす。期限（24時間）と、下の refreshHandoff() が 面倒を みる */
  }
  if(!got) return { status:'empty', got:0, missing:slots.length };
  await loadPoster();
  posterFresh = true;
  /* 子ども画面に 自動で 届いた ときの 知らせ。保護者ページで 押した ときは
     quiet で 止め、大人向けの 言い方で 呼んだ 側が 出す */
  if(!quiet) toast('あたらしい ' + posterWord() + 'が ' + got + 'まい とどいたよ');
  render({ keepScroll:true });
  return { status:'got', got, missing:slots.length - got };
}

/* 保護者の 端末で 選んだ ぶん。縮めてから 置き、印を 同期し、箱へ 入れる */
async function savePosterFile(file, slot){
  const lib = photos();
  if(!lib || !file) return;
  const at = Number(slot);
  const put = at >= 0 && at < POSTER_MAX ? at : posterFreeSlot();
  if(put < 0){ toast('写真は' + POSTER_MAX + '枚までです。どれかを消してから足してください'); return; }
  toast('写真を用意しています…');
  const shrunk = await lib.shrink(file);
  if(!shrunk){
    toast('この写真は大きすぎます。もう少し小さく写してください');
    return;
  }
  await lib.put(posterId(put), shrunk.blob);
  const now = Date.now();
  setPosterHeldAt(put, now);
  await loadPoster();
  posterFresh = false;
  /* **箱に 入れてから 合図を 出す。** 逆に すると、設定（合図）は すぐ 届くのに
     箱は まだ 空で、受け取り側が 空振りする。空振りの あとは 合図が 来ないので
     二度と 取りに 行かない、という 事故に なる */
  await handPoster(put, shrunk.blob);
  const ats = posterCfg().ats;
  ats[put] = now;
  config.poster = posterCfgOut(posterCfg().label, ats);
  saveCfg();
  render({ keepScroll:true });
}

/* 相手の 端末へ 渡す。受け取ったかどうかは 分からないので、
   「渡した」までしか 言わない（分からないことを 断定しない）。

   **写真が この端末に 無いときは、渡しようが ない。** 以前は そのまま
   FileReader へ 渡して 例外に なり、押しても 何も 起きなかった。
   結果は 端末に 控えて 保護者ページに 出す（失敗を 黙って 飲みこまない）。 */
async function handPoster(slot, blob){
  const lib = photos();
  const only = Number.isFinite(Number(slot)) && Number(slot) >= 0 ? Number(slot) : -1;
  const targets = [];
  for(let i = 0; i < POSTER_MAX; i++){
    if(only >= 0 && i !== only) continue;
    const photo = (only >= 0 && blob) ? blob : (lib ? await lib.get(posterId(i)) : null);
    if(photo) targets.push({ slot:i, photo });
  }
  if(!targets.length){
    toast('この端末には 写真が ありません');
    return false;
  }
  const S = sync();
  if(!lib || !sharingOn() || !S || typeof S.putHandoff !== 'function'){
    toast('この端末に 保存しました');
    return false;
  }
  let sent = 0;
  for(const t of targets){
    try{
      const dataURL = await lib.toDataURL(t.photo);
      if(dataURL && await S.putHandoff(dataURL, t.slot)) sent++;
    }catch(e){}
  }
  const ok = sent === targets.length;
  setLocal(K_POSTER_SENT, JSON.stringify({ at: Date.now(), ok, sent, of: targets.length }));
  /* 一部だけ 渡せた ときに「わたしました」と 言わない。何枚 届くのかが
     ちがうと、子どもの 画面と 食いちがった ままに なる */
  toast(ok ? 'わたしました（24時間 ゆうこう）'
    : sent ? sent + '枚だけ わたせました。もう一度お試しください'
    : 'わたせませんでした');
  render({ keepScroll:true });
  return sent > 0;
}

/* **枠は 詰めない。** 2まいめを 消しても 3まいめは 3まいめの まま。
   詰めると 枠ごとの 合図が すべて ずれ、関係の ない 端末が 全部を 取り直す */
async function removePoster(slot){
  const lib = photos();
  const n = Number(slot) || 0;
  if(lib) await lib.remove(posterId(n));
  setPosterHeldAt(n, 0);
  const ats = posterCfg().ats;
  ats[n] = 0;
  config.poster = posterCfgOut(posterCfg().label, ats);
  saveCfg();
  await loadPoster();
  render({ keepScroll:true });
}

/* 子ども画面の 入口は **帯（タイトル行）**に 置く。

   カウントダウンの 見出し行に 同居させて いたが、その 見出しと
   となりあって 読めて しまい、何の ボタンか 分からない という 指摘が あった。
   帯は どの 画面でも 出ている ところなので、置き場所としても 分かりやすい。
   タイトルは もともと はみ出すと 三点リーダで 切れるので、押し出しても 壊れない。

   **この端末に 写真が 無い あいだは 出さない。** まだ 届いて いないのに
   ボタンだけ あると、押しても「まだ です」しか 出ず、まぎらわしい。 */
function posterShown(){ return posterHere() > 0; }
function renderPosterButton(){
  const btn = $('#posterOpen'), text = $('#posterOpenText');
  if(!btn || !text) return;
  const cfg = posterCfg();
  const show = posterShown();
  btn.hidden = !show;
  if(!show) return;
  text.textContent = cfg.label;
  btn.classList.toggle('has-name', !!cfg.label);
  btn.setAttribute('aria-label', posterWord() + ' を 見る');
  btn.classList.toggle('has-unread', posterFresh);
}

/* 開いた 中は **縦に ならべる だけ**。◀▶ の 送りは 付けない ―― 見るだけの
   画面に 操作を 足さない。1枚の ときは これまでと 同じ 見え方に なる
   （「Nまいめ」の 見出しも 出さない） */
function openPoster(){
  const dialog = $('#posterDialog');
  const body = $('#posterBody');
  if(!dialog || !body) return;
  const here = posterURLs.map((url, slot)=>({ url, slot })).filter(one=> one.url);
  if(!here.length){ toast('まだ とどいていないよ'); return; }
  const many = here.length > 1;
  body.innerHTML = here.map((one, i)=> (many
      ? `<p class="poster-nth">${i + 1}まいめ</p>`
      : '')
    + `<img src="${esc(one.url)}" alt="しゅくだいの ${esc(posterWord())}${many ? ' ' + (i + 1) + 'まいめ' : ''}">`
  ).join('');
  $('#posterTitle').textContent = posterWord();
  posterFresh = false;
  if(typeof dialog.showModal === 'function') dialog.showModal(); else dialog.setAttribute('open', '');
}

/* 保護者ページ「宿題を決める」の 欄。大人向けの 言い方で 書く。

   **枠ごとに 1行。** 何枚あるか、どれが この端末に 来ていないかを、
   数えなくても 分かる ように する。空いた 枠は 出さない（3まいめだけが
   あるときは「3まいめ」だけが ならぶ ―― 枠は 詰めないので 番号は 動かない）。
   ボタンの ならびは、ほかの 欄と 同じ .set-actions に そろえる。 */
/* **写真は 一覧の 形で 見せる。** 行に すると 1枚 95px（320px 実測）で、
   4枚で 380px。設定の 欄 ひとつに その 縦は 使えない。iPhone では 2列、
   広い 画面では 4列。押す 先は 絵そのもの（選び直す）と、ゴミ箱（消す）の 2つだけ */
function posterTileHTML(slot, cfg){
  const url = posterURLs[slot];
  const known = !!cfg.ats[slot];
  if(!url && !known) return '';
  const n = slot + 1;
  /* 番号と ゴミ箱は **写真の 上に かさねる**。下に 並べると 1ますが
     158px に なり（375px 実測）、行で 出して いた ころより 縦を 食う。
     かさねれば ますの 丈は 写真の ぶんだけ（110px）で 済む */
  const nth = `<span class="poster-tile-nth">${n}枚目</span>`;
  const del = `<button class="icon-btn del poster-tile-del" data-poster-clear="${slot}" type="button"
      title="${n}枚目を消す" aria-label="${n}枚目を消す">${icon('trash')}</button>`;
  const pic = url
    ? `<button class="poster-tile-pic" data-poster-pick="${slot}" type="button"
        aria-label="${n}枚目を選び直す"><img src="${esc(url)}" alt="">${nth}</button>`
    /* まだ 来ていない 枠。**ボタンに しない。** 押せる ように 見せると、
       押した ときに 何も 起きない（届くのを 待つ しか ない） */
    : `<span class="poster-tile-pic poster-tile-wait">まもなく<br>とどきます${nth}</span>`;
  return `<figure class="poster-tile${url ? '' : ' is-away'}">${pic}${del}</figure>`;
}

function posterSectionHTML(){
  const cfg = posterCfg();
  const here = posterHere();
  const free = posterFreeSlot();
  const known = cfg.ats.filter(Boolean).length;
  const tiles = [];
  for(let slot = 0; slot < POSTER_MAX; slot++) tiles.push(posterTileHTML(slot, cfg));
  /* 足す 入口は **一覧の さいごの ます**。ボタンを 別に 並べない
     （実機の 指摘：ボタンが 多すぎる・縦を 使いすぎ） */
  const add = free >= 0
    ? `<button class="poster-tile poster-tile-add" id="posterPick" type="button">
        <span class="poster-tile-plus" aria-hidden="true">＋</span>
        <span>写真を${known || here ? '足す' : '選ぶ'}</span></button>`
    : '';
  return `
  <section class="sec config-sec"><div class="sec-head has-help"><h2>宿題の一覧の写真</h2>
    <button class="adult-section-head-help" id="posterHelp" type="button"
      title="写真の使い方" aria-label="宿題の一覧の写真の使い方" aria-haspopup="dialog"
      aria-controls="posterHelpDialog"><span class="adult-section-head-info" aria-hidden="true">i</span></button>
  </div><div class="paper">
    <div class="set-row"><label class="lab" for="posterLabel"><span class="poster-lab-ico" aria-hidden="true"></span>ボタンの名前</label>
      <input type="text" id="posterLabel" maxlength="6" placeholder="なくてもかまいません" value="${esc(cfg.label)}"></div>
    <div class="poster-tiles">${tiles.join('')}${add}</div>
    <input type="file" id="posterFile" accept="image/*" class="offscreen">
  </div></section>`;
}

function viewHome(){
  if(DEBUG_CONTENT) return contentDebugHTML();
  if(joinRoleNeeded()) return joinRolePickHTML();
  if(!config.tasks.length) return homeEmptyHTML();
  const must  = config.tasks.filter(t=>t.group==='must');
  const opt   = config.tasks.filter(t=>t.group==='option');
  const daily = config.showDaily ? config.tasks.filter(t=>t.group==='daily') : [];
  const o = overall('must');
  const mustLeft = must.filter(t=>!prog(t).isDone).length;
  const optLeft = opt.filter(t=>!prog(t).isDone).length;

  // 今日のぶんが終わっていれば、まいにちの欄は下へ下がって邪魔をしない
  const dailyAllDone = daily.length > 0 && daily.every(t => prog(t).isDone);
  const dailySec = daily.length
    ? sectionHTML('daily','まいにち すこしずつ',
        'きょうの ぶん', daily, { fold: dailyAllDone })
    : '';

  return `
  <section class="count">
    <p class="count-lead">${esc(deadlineWord(true))}まで</p>
    <div id="cdBox"></div>
    ${paceHTML(o)}
  </section>

  ${sampleChildNoticeHTML()}

  ${parentMessageHTML()}

  ${joinInstallTransferHTML()}

  ${funHTML()}

  ${dailySec}
  ${sectionHTML('must','かならず やる','のこり '+mustLeft+'しゅるい', must)}
  ${opt.length   ? sectionHTML('opt','つぎに やる','のこり '+optLeft+'しゅるい', opt) : ''}

  <section class="sec sec-today">
    <div class="sec-head"><h2>きょう やったこと</h2><span class="sec-note">${fmtDate(new Date())}</span></div>
    <div class="paper today-list">${todayHTML()}</div>
  </section>

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
        <p class="fun-q" data-no-reading>${rubyHTML(f.q)}</p>
        <p class="fun-a" data-no-reading>${rubyHTML(f.a)}</p>
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
  const seen = new Set(seenMessageIds());
  rows.filter(m=> !seen.has(m.id)).forEach(m=> shownNewMessageIds.add(m.id));
  rememberSeenMessages(rows);
  return `
  <section class="home-parent-message" aria-label="おうちの人からの メッセージ">
    <div class="paper parent-message-stack">
    ${rows.map(m=>`
    <div class="parent-message-note${shownNewMessageIds.has(m.id) ? ' is-new' : ''}">
      <strong>${shownNewMessageIds.has(m.id) ? '<span class="message-new-dot" aria-label="新しいメッセージ"></span>' : ''}${esc(messageHeading(m))}</strong>
      <p>${esc(m.text)}</p>
    </div>`).join('')}
    </div>
  </section>`;
}

/* 宿題の進捗率 − 期間の経過率 から、進み具合を判定する。
   「よゆう」は全体と必須の両方が十分に先行しているときだけにする。
   任意だけを先に進めても、必須の遅れを隠さないため。 */
const PACE_MESSAGES = {
  good: ['よゆうだね！このちょうし！', 'とっても いいペース！', 'すすみぐあい ばっちり！', 'このまま いこう！',
    'こつこつ すすんでいるね！', 'よく つづいているね！', 'しっかり すすんでいるね！', 'ここまで よく できたね！'],
  focus: ['まず「かならず やる」から！', 'だいじな宿題を さきに！',
    '「かならず やる」を ひとつ！', 'きょうは だいじな宿題から！',
    'まずは ひとつ すすめよう！', 'だいじな宿題に もどろう！',
    'さきに ひとつ かたづけよう！', 'まずは だいじなほうから！'],
  hurry: ['きょうは がんばりどき！', 'いまから ひとつずつ！', 'すこしずつ とりもどそう！', 'まずは できるところから！',
    'ひとつ えらんで はじめよう！', 'ちいさく すすめば へいき！', 'きょうの ひとつを やろう！', 'できるところから やろう！'],
  steady: ['いいペース！', 'このちょうしで すすめよう！', 'あわてず ひとつずつ！', '毎日すこしずつ すすもう！',
    'きょうも ひとつ すすめよう！', 'じぶんのペースで いこう！', 'つぎの ひとつへ いこう！', 'こつこつ つづけよう！']
};
/* 「読める漢字」に小4以上を選んだ子むけの、少し大人びた言い方。
   状態（good/focus/hurry/steady）・件数（各8）は PACE_MESSAGES とそろえる。

   低学年の文を漢字に置きかえただけだと、言い回しが幼いまま残る。
   体言止めの言い切り（「まず〇〇から！」）は 統制的な口調として
   読まれ、年齢が上がるほど反発を生むので、動詞で終える形にそろえた。
   遅れているときは 責めずに「着手そのもの」を目標にする。

   使う漢字は 小4までの配当に収める。収まらない語は {漢字|よみ} と
   書いてルビを振る（rubyHTML が組み立てる）。ひらがなに開くより
   語の形が保てるので、読める子には そのまま読ませる。 */
const PACE_MESSAGES_ADULT = {
  good: ['今のペースなら間に合う！', 'ここまでよく続いているね', '着実に進んでいるね', '早めに終わりそうだね',
    'よく積み上げてきたね', 'もっと学びたいことは見つかったかな？',
    '{余裕|よゆう}をたもっていこう', '全部終わったら何をしたい？'],
  focus: ['まようなら「必ずやる」から', '大事な宿題を一つ選ぼう',
    '先に一つ かたづけよう', 'まずは一つ進めよう',
    '一つ終えると気が楽になるよ', 'まよったら大事な方から手をつけよう',
    '今日はどれから始める？', 'やりやすいものから始めよう'],
  hurry: ['一つだけ手をつけよう', 'まずは5分だけと思って始めるのがコツ',
    '気が重いときは「ちょっとだけやる」と考えよう', 'できるところから始めよう',
    'どれが一番取りかかりやすいかな？', '今日は1つやればいいことにしよう',
    'どういうときにやる気が出るのか考えてみよう', '始められたら自分にごほうび という作戦もあります'],
  steady: ['この調子で少しずつ進もう', 'いまのペースを守れるといいね', 'いつまでに終わらせたい？',
    'こういうのは毎日やるのが大事なのです', '千里の道も一歩から。何歩くらい進んだかな？',
    '{油断|ゆだん}は{禁物|きんもつ}！', '「明日やろう」は「〇〇やろう」……',
    '思ったペースで進んでいるかな？']
};
function localDayNumber(now){
  const d = now instanceof Date ? now : new Date(now == null ? Date.now() : now);
  return Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 86400000;
}
function paceMessage(kind, overallGap, mustGap, now){
  /* grownUpWording はこのブロックの外（readingGrade の近く）で定義している。
     この関数だけを切り出して動かすテストでも壊れないよう、存在しないときは
     いままで通り 子ども向けの表を使う。 */
  const table = (typeof grownUpWording === 'function' && grownUpWording()) ? PACE_MESSAGES_ADULT : PACE_MESSAGES;
  const rows = table[kind];
  /* 同じ進捗でも毎日少し表情を変える。日付を足すだけなので、
     同じ日の再描画では文言がころころ変わらない。
     UTC の日付番号だと日本時間の朝9時に文言が変わるため、端末の暦日を使う。 */
  const day = localDayNumber(now);
  const n = Math.abs(Math.round(overallGap * 10) + Math.round(mustGap * 10) + day);
  return rows[n % rows.length];
}
/* ルビの指定 {漢字|よみ} は、画面では漢字の分の幅しか取らない。
   幅を見積もるときも、印をはずした見た目の文字だけを数える。 */
function paceDisplayText(msg){
  return String(msg || '').replace(/\{([^{}|]+)\|[^{}|]+\}/g, '$1');
}
function paceVisualWidth(msg){
  /* 日本語1文字を1、空白と括弧を少し細く見積もる。 */
  return Array.from(paceDisplayText(msg)).reduce((n, ch) =>
    n + (ch === ' ' ? .35 : '！「」'.includes(ch) ? .55 : 1), 0);
}
function paceVerdictSizeClass(msg){
  /* 短い一言の存在感は保ち、長い文だけを段階的に縮める。
     13.25 を超えると 320px では1行に収まらない。そこから先は
     縮め続けても隣の日づけ（13px）より小さくなるだけなので、
     字を保ったまま2行に折り返す。 */
  const width = paceVisualWidth(msg);
  if(width > 13.25) return ' pace-verdict--wrap';
  if(width > 12.5) return ' pace-verdict--long';
  if(width > 9.5) return ' pace-verdict--medium';
  return '';
}
function verdictOf(overallGap, mustGap){
  if(overallGap >= 8 && mustGap >= 8) return { cls:'v-good', msg:paceMessage('good', overallGap, mustGap) };
  if(overallGap >= 0 && mustGap < 0) return { cls:'v-hmm', msg:paceMessage('focus', overallGap, mustGap), focusMust:true };
  if(mustGap <= -18) return { cls:'v-hmm', msg:paceMessage('hurry', overallGap, mustGap) };
  if(mustGap <= -6)  return { cls:'v-hmm', msg:paceMessage('hurry', overallGap, mustGap) };
  return { cls:'v-ok', msg:paceMessage('steady', overallGap, mustGap) };
}

/* 設定した期間の経過率（％） */
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
/* 全部終わったのが いつだったかは 記録の いちばん新しい時刻で 分かる。
   終わった瞬間を あとから 見返せるように、日づけだけでなく 時刻まで 出す。
   記録が 1件も 無い（読み込み直後など）ときは null を返し、
   呼びだす側で いままで通りの 言い方に もどす。 */
function lastRecordLabel(logs){
  const rows = logs || (typeof state === 'object' && state ? state.logs : null);
  if(!rows || !rows.length) return null;
  let best = null;
  for(const r of rows){
    const at = new Date(r && r.at);
    if(at.getTime() === at.getTime() && (!best || at > best)) best = at;
  }
  if(!best) return null;
  return (best.getMonth() + 1) + '月' + best.getDate() + '日'
    + best.getHours() + '時' + pad2(best.getMinutes()) + '分';
}
function forecastText(forecast, child, doneLabel){
  /* wording はこのブロックの外で定義している。この関数だけを切り出して
     動かすテストでも壊れないよう、無いときは低学年側の言い方に落とす
     （paceMessage と同じ構え）。 */
  const say = (a, b) => (typeof wording === 'function' ? wording(a, b) : a);
  if(forecast.kind === 'date') return child
    ? say('かんりょうよそく：いまのペースだと', '完了よそく：今のペースだと') + forecast.label
    : '完了予測 ' + forecast.label;
  if(forecast.kind === 'done'){
    if(!child) return '完了予測　完了';
    return say('しゅくだい ぜんぶ できた！',
      doneLabel ? doneLabel + 'に完了！' : '全部終わった！');
  }
  if(forecast.kind === 'empty') return child ? '' : '宿題を登録すると予測できます';
  return child ? say('すすむと めやすが でるよ', '進めると{表示|ひょうじ}されます')
    : '進捗が増えると予測できます';
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
  const forecastCopy = forecastText(forecast, true, lastRecordLabel());
  const forecastHTML = forecast.kind === 'date'
    ? `<span>${wording('かんりょうよそく：', '完了よそく：')}</span><span>${
        wording('いまのペースだと', '今のペースだと')}${esc(forecast.label)}</span>`
    : rubyHTML(forecastCopy);
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
    msg = 'かならずは できた！あと' + optLeft + 'こ';
  }
  /* バーは 伸びているのに おくれている、という 分かりにくい 状態のときだけ、
     何が のこっているのかを はっきり 伝える */
  const warn = (!v.focusMust && mustGap < -6 && mustLeft > 0 && opt.done > 0)
    ? `<p class="pace-warn">「かならず やる」が あと ${mustLeft}しゅるい のこっているよ。さきに やろう！</p>`
    : '';

  return `
  <div class="pace">
    <div class="pace-row">
      <span class="pace-name">${esc(periodWord(true))}</span>
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
    ${/* 大人びた側だけ、かな化の対象から外す。配当外の語には自分でルビを
          振ってあり、機械のかな化に上書きされると読みが二重になる。
          低学年側は「宿題」などを小1・小2むけに開く必要があるので、
          いままで通り かな化に任せる。 */''}
    <p class="pace-verdict ${cls}${paceVerdictSizeClass(msg)}"${grownUpWording() ? ' data-no-reading' : ''}>${rubyHTML(msg)}</p>
    ${forecastCopy ? `<p class="pace-forecast"${grownUpWording() ? ' data-no-reading' : ''}>${forecastHTML}</p>` : ''}
    ${warn}
  </div>`;
}

/* opts.fold … 済んだら **その場で** 畳む（まいにち）。
   下へ 送ると 置き場所が 動く。毎日 同じ ところに ある ほうが たどりやすく、
   直しに 来た ときの 入口（見出し）も 動かない。 */
function sectionHTML(kind, title, note, tasks, opts){
  const allDone = (kind === 'must' || kind === 'opt')
    && tasks.length > 0 && tasks.every(t=>prog(t).isDone);
  const fold = !!(opts && opts.fold);
  /* スタンプと 但し書きは 同じことを 言う（「のこり 0しゅるい」「きょうは
     ぜんぶ できた！」）。済んだ 欄では 但し書きを 出さず、スタンプに まかせる */
  const done = allDone || fold;
  const mark = done
    ? `<span class="sec-complete-mark"><span class="sec-complete-ico" aria-hidden="true"></span>ぜんぶ できた！</span>`
    : '';
  const head = `<h2>${esc(title)}</h2>${done ? '' : `<span class="sec-note">${esc(note)}</span>`}${mark}`;
  const list = `<div class="task-list${kind==='daily' ? ' task-list--2up' : ''}">${tasks.map(taskHTML).join('')}</div>`;
  return `
  <section class="sec sec-${kind}${allDone || fold ? ' is-all-done' : ''}">
    ${fold
      ? `<details class="sec-fold" data-details-key="dailyDone">
      <summary class="sec-head">${head}<span class="sec-fold-mark" aria-hidden="true"></span></summary>
      ${list}
    </details>`
      : `<div class="sec-head">${head}</div>
    ${list}`}
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

/* しつもんも ノルマに 入るので、いくつ 答えたかを カードに 出す。
   出さないと、番号が 全部 終わっているのに 完了に ならない 理由が 分からない */
function questionMarkHTML(t, p){
  if(!countsQuestions(t)) return '';
  return `<span class="qmark${p.qDone >= p.qTotal ? ' is-on' : ''}">${
    esc(wording('しつもん', '問い'))} ${p.qDone}/${p.qTotal}</span>`;
}

function taskHTML(t){
  const p = prog(t);
  const nx = nextLabel(t);
  const streak = t.type === 'daily' ? streakLabel(p) : '';
  const stateLabel = p.isDone
    ? (t.group === 'must' || t.group === 'option' ? 'ぜんぶできた！' : 'できた！')
    : (p.numDone && hasWrap(t) ? 'あとすこし！' : '');

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
      for(let i=1;i<=n;i++) hearts += `<span class="heart${i<=p.done?' on':''}"></span>`;
      meter = `<div class="task-meter"><div class="hearts" role="img" aria-label="ハート ${p.done|0}/${n}">${hearts}</div></div>`;
    }else{
      meter = `<div class="task-meter task-meter--bar task-meter--daily">
        <div class="bar"><div class="bar-fill" style="width:${p.pct.toFixed(1)}%"></div></div>
        <span class="task-count">${esc(p.text)}</span>
      </div>`;
    }
  }else{
    // count と step は 同じ 見た目。ランプは 14/14 の すぐ よこに ならべる
    meter = `<div class="task-meter task-meter--bar">
        <div class="bar"><div class="bar-fill" style="width:${p.allPct.toFixed(1)}%"></div></div>
        <span class="task-count">${esc(p.text)}</span>${questionMarkHTML(t, p)}${wrapMarksHTML(t, p)}
      </div>`;
  }

  return `
  <article class="task${p.isDone?' is-done':''}${
    (!p.isDone && p.numDone && hasWrap(t))?' is-almost':''}${isFree(t)?' task-free':''}${
    t.group === 'must' || t.group === 'option' ? ' task-whole' : ''}">
    <h3 class="task-name"><span class="task-name-text">${esc(t.name)}</span>${stateLabel
      ? `<span class="task-state">${esc(stateLabel)}</span>` : ''}</h3>
    ${nx && !isFree(t) ? `<p class="task-next"><span class="next-lead">${esc(nx.lead)}</span>
        ${nx.num ? `<span class="next-num">${esc(nx.num)}</span>` : ''}<span class="next-tail">${esc(nx.tail)}</span></p>` : ''}
    ${meter}
    ${t.type === 'daily' ? `<div class="task-streak-row">${streak
      ? `<span class="streak">${esc(streak)}</span>` : ''}</div>` : ''}
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
  <section class="sec parent-today-logs"${adultSectionHelpAttr(
    '今日、子どもと保護者が記録した内容を新しい順に確認します。保護者が直した内容もここに残ります。')}>
    <div class="sec-head"><h2>今日の記録</h2><span class="sec-note">${fmtDate(new Date())}</span></div>
    <div class="paper today-list">${rows.length
      ? rows.slice().reverse().map(logRowHTML).join('')
      : '<p class="empty">本日の記録はまだありません。</p>'}</div>
    ${/* 読んだ ものは ここにだけ 両方 出す。カレンダーの 日別は 子ども画面
          という 前提なので、そちらへは 出さない（依頼者の 裁定） */''}
    ${readsHTML(k, true)}
    ${logDeleteAllowed() ? ''
      : '<div class="set-actions parent-log-help"><button type="button" class="linkish" id="logCareJump">1件ずつ消せるようにする</button></div>'}
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
  const adult = isAdultTab(tab);
  const by = adult ? logByLabel(l) : '';
  return `
  <div class="today-item">
    <span class="ti-time">${fmtTime(new Date(l.at))}</span>
    <div class="ti-body">
      <div class="ti-name">${esc(l.name)}</div>
      <div class="ti-what">${esc(logWhatDisplay(l, adult))}${
        by ? `<span class="ti-by">（${esc(by)}）</span>` : ''}</div>
      ${l.memo ? `<div class="ti-memo">${esc(l.memo)}</div>` : ''}
    </div>
    ${canDeleteLog() ? `<button class="icon-btn del ti-del" data-dellog="${esc(l.id)}"
            title="この記録を消す" aria-label="この記録を消す" type="button">${icon('trash')}</button>` : ''}
  </div>`;
}

/* 記録は入力時の文言も残すが、数える単位は今の課題設定を正として表示する。
   これなら「まい」から「枚」へ変えた後の記録も、子ども画面では読める漢字に合わせ、
   保護者ページでは常に漢字の単位でそろう。 */
function logWhatDisplay(l, adult){
  const task = config.tasks.find(t => t.id === l.taskId);
  const what = String(l.what || '');
  if(!task) return what;
  const unit = isBook(task) ? bookCountUnit(adult)
    : unitForLogDisplay(task.unit, adult);
  if(isBook(task)) return what.replace(/^(\d+)(?:冊|さつ)/, '$1' + unit);
  if(task.type === 'count' && !countUsesCircle(task)){
    return what.replace(/^(\d+(?:〜\d+)?)[^\s　]*/, '$1' + unit);
  }
  return what;
}

function unitForLogDisplay(unit, adult){
  const raw = String(unit || '');
  const kanji = unitAdult(raw);
  if(adult || readingGrade() === 9) return kanji;
  /* 設定が旧データの「枚」でも、子ども側は既存の単位表記（まい）に戻す。 */
  const child = Object.keys(ADULT_UNIT).find(key => ADULT_UNIT[key] === kanji);
  return child || raw;
}

/* 記録の1行けしを 出してよいか。
   設定で 入れたうえで、この端末が おうちの人の端末の ときだけ。
   子どもの端末では 出さない（誤って 消して しまわない ように） */
function canDeleteLog(){
  return logDeleteAllowed() && getLocal(K_ROLE) === 'parent';
}
function logDeleteAllowed(){ return getLocal(K_ALLOW_LOG_DELETE) === '1'; }
function setLogDeleteAllowed(enabled){
  if(enabled) setLocal(K_ALLOW_LOG_DELETE, '1');
  else try{ localStorage.removeItem(K_ALLOW_LOG_DELETE); }catch(e){}
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
   以前は 小3以上を えらべず、「漢字のまま」＝3年生いじょう の 代用だったが、
   いまは 実際の学年を えらべるので、その学年で そのまま 判定する。
   「漢字のまま」も 引きつづき ぜんぶ 出す。 */
function funAllowed(i){
  const f = FUN[i];
  if(!f) return false;
  const g = readingGrade();
  if(g === 9 || g >= 3) return true;
  return (Number(f.lv) || 2) <= 2;
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
  funPos = f.seen.length - 1;
  saveLocalState();
}

function didSomethingToday(){
  const key = dayKey(new Date());
  return (state.logs || []).some(l => dayKey(new Date(l.at)) === key);
}

function funLimit(){ return FUN_MAX + (didSomethingToday() ? 1 : 0); }

function funHTML(){
  const today = funToday();
  const seen = today.seen || [];
  /* たどっている 位置。範囲の 外なら さいごへ 寄せる */
  const pos = seen.length ? clamp(funPos < 0 ? seen.length - 1 : funPos, 0, seen.length - 1) : -1;
  const atEnd = pos < 0 || pos === seen.length - 1;
  const idx = pos >= 0 ? seen[pos] : funIdx;
  const f = FUN[idx % FUN.length];
  const seenCount = seen.length;
  const bonus = didSomethingToday();
  const left = Math.max(0, funLimit() - seenCount);
  const isQuiz = f.t === 'なぞなぞ' || f.t === '頭のたいそう';
  /* 前に 読んだ ものは もう 見た ものなので、答えまで 出す */
  const shown = funOpen || !atEnd;
  /* 新しく 引ける ぶんが 無い ときは 畳んで おく。**下へ 送らない**
     （置き場所が 動くと、毎日 おぼえた ところが 変わって しまう）。

     **ただし、いま 画面に 出ている ものが 開いて いれば 開いた まま。**
     「あと 何回 引けるか」で 開閉を 決めて しまうと、きょうの ぶんを 読み
     切った 瞬間に left が 0 に なり、次に 組み直した ときに 畳まれる。
     読み返しの ◀▶ は まさに その 場面で 押される（実機で「さいごの 話の
     答えを 見ようと すると 畳まれる」）。**開閉は 画面の 事実から 取る。**
     はじめて 描くとき（カードが まだ 無い）だけ left で 決める。 */
  const shownCard = typeof document !== 'undefined' ? document.querySelector('.fun') : null;
  const openAttr = (shownCard ? shownCard.open : left > 0) ? ' open' : '';
  const owari = left === 0
    ? (!bonus && seenCount >= FUN_MAX
        ? '「できた！」が ふえたら、もうひとつ 読めるよ。'
        : 'きょうは ここまで。また あした！')
    : '';
  return `
  <details class="paper fun fun-fold" data-details-key="funBox"${openAttr}>
    ${/* 見出しの行に 出すのは **ひとつだけ**。札と 説明を ならべると、
          せまい 画面で 札が 3行に 折り返し、説明も 切れた（320pxで実測）。
          読める ぶんが ある あいだは 札（何の はなしか）、
          読み切ったら おしまいの 一言に 入れかわる。 */''}
    <summary class="fun-sum">
      ${left > 0
        ? `<span class="fun-tag">${esc(f.t)}</span>`
        : `<span class="fun-sum-note">${esc(owari)}</span>`}
      <span class="fun-fold-mark" aria-hidden="true"></span>
    </summary>
    ${left > 0 ? '' : `<span class="fun-tag fun-tag--body">${esc(f.t)}</span>`}
    ${f.t === 'むかしのことば'
      ? '<p class="fun-note">つかってみよう。ひみつの あんごうに なるかもね！</p>'
      : ''}
    <p class="fun-q" data-no-reading>${rubyHTML(f.q)}</p>
    ${shown ? `<p class="fun-a" data-no-reading>${rubyHTML(f.a)}</p>${f.fig ? kanjiOriginHTML(f.fig) : ''}` : ''}
    <div class="fun-row">
      ${/* きょう 読んだ ぶんの 行き来。**四角い ボタンに 三角を のせない。**
            紙の カードの 上で 面が 2つ 並ぶと、何の ボタンか 分からないまま
            場所だけ とる（実機の 指摘）。面を 持たない 山形の 印に して、
            あいだに「いま 何番目か」を 出す。押せる 幅は 44px の まま */''}
      ${seenCount > 1 ? `<span class="fun-pager">
        <button class="icon-btn fun-nav" data-fun="prev" type="button"
          aria-label="まえに よんだ はなし"${pos <= 0 ? ' disabled' : ''}
          ><span class="fun-nav-mark" aria-hidden="true"></span></button
        ><span class="fun-pos">${(pos < 0 ? seenCount : pos + 1)}／${seenCount}</span
        ><button class="icon-btn fun-nav fun-nav--fwd" data-fun="fwd" type="button"
          aria-label="つぎに よんだ はなし"${atEnd ? ' disabled' : ''}
          ><span class="fun-nav-mark" aria-hidden="true"></span></button>
      </span>` : ''}
      ${shown ? '' : `<button class="btn btn-sm" data-fun="open" type="button">${
        isQuiz ? 'こたえを 見る' : (f.ask || 'つづきを 見る')}</button>`}
      ${shown && atEnd && left > 0
        ? `<button class="btn btn-sm" data-fun="next" type="button">つぎの はなし（あと ${left}かい）</button>`
        : ''}
      ${/* おしまいの 一言は 畳んだ 見出しに 出している。中にも 出すと
            同じことを 二度 言うことに なる */''}
    </div>
    ${/* きほんの 3つを 読みおえ、ごほうびの 1つが のこっている ときだけ 出す */
      shown && atEnd && bonus && seenCount >= FUN_MAX && left > 0
      ? '<p class="fun-bonus--on">「できた！」が ふえたので、きょうは もうひとつ 読めるよ。</p>'
      : ''}
  </details>`;
}

/* --- カウントダウン（1びょうごと） --- */
function renderCountdown(){
  const box = $('#cdBox');
  if(!box) return;
  const en = parseLocal(config.endAt);
  let ms = en - new Date();
  if(!(ms === ms)){ box.innerHTML = `<p class="count-over">おわりの日を せっていしてね</p>`; return; }
  if(ms <= 0){ box.innerHTML = `<p class="count-over">${esc(periodWord(true))}は おわりました 🎒</p>`; return; }

  const d = Math.floor(ms/86400000);
  const h = Math.floor(ms/3600000) % 24;
  const m = Math.floor(ms/60000) % 60;
  const s = Math.floor(ms/1000) % 60;

  const unit = (v, lab, big) =>
    `<div class="cd-unit${big?' cd-unit--big':''}">` +
    (big ? '<span class="cd-prefix">あと</span>' : '') +
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
        <span class="write-lab">かきうつす文（${learnedKanjiLabel()} かんじ）</span>
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
    $('#wrCheckNote').textContent = 'ぜんぶ ' + learnedKanjiLabel() + ' かんじだったよ。そのまま カードに うつせるね。';
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
        : 'ぜんぶ ' + learnedKanjiLabel() + ' かんじだったよ。';
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

/* 設定した期間の はじめ／おわり。日づけだけを見たいので 0:00 に そろえる。
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

function calChevronIcon(direction){
  const d = direction < 0 ? 'M14.5 5.5 8 12l6.5 6.5' : 'm9.5 5.5 6.5 6.5-6.5 6.5';
  return `<svg class="cal-nav-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="${d}"/></svg>`;
}

/* 端末ごとに姿の変わる絵文字ではなく、カレンダー内で統一した鉛筆の印 */
function calPencilIcon(){
  return `<svg class="cal-pencil-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="m5.2 16.9-.7 2.6 2.6-.7L18 7.9l-1.8-1.8L5.2 16.9Z"/><path d="m14.8 5 1.8-1.8 2.6 2.6-1.8 1.8M5.2 16.9l1.9 1.9"/></svg>`;
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

  // 設定期間の外の月へは いかせない（せっていが 空なら 自由に うごける）
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
        <span class="cal-dots">${dots}${calHasFree(logs) ? `<span class="cal-free">${calPencilIcon()}</span>` : ''}</span>
      </button>`;
  }

  return `
  <section class="sec">
    <div class="cal-nav paper">
      <button class="btn btn-sm btn-ghost" data-calmove="-1" type="button"
        aria-label="まえの月" ${canPrev ? '' : 'disabled'}>${calChevronIcon(-1)}</button>
      <h2 class="cal-title">${y}年 ${m+1}月</h2>
      <button class="btn btn-sm btn-ghost" data-calmove="1" type="button"
        aria-label="つぎの月" ${canNext ? '' : 'disabled'}>${calChevronIcon(1)}</button>
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
      ${freeEnabled ? `<span class="cal-leg"><span class="cal-free">${calPencilIcon()}</span>なんでも きろく</span>` : ''}
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
function childActivityText(){
  const stamp = ms(state && state.childActivityAt);
  if(!stamp) return '';
  const when = new Date(stamp);
  if(Number.isNaN(when.getTime())) return '';
  const now = new Date();
  const time = String(when.getHours()).padStart(2, '0') + ':' + String(when.getMinutes()).padStart(2, '0');
  const today = dayKey(when) === dayKey(now);
  return 'こども 最終記録 ' + (today ? time : (when.getMonth()+1) + '/' + when.getDate() + ' ' + time);
}
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
  const sync = window.NatsuSync;
  const canRefreshShared = !!(sync && sync.configured && sync.configured() && sync.getCode().length >= 8);
  const childActivity = childActivityText();

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
        <td class="pg-bar"><div class="bar"><div class="bar-fill" style="width:${p.allPct.toFixed(1)}%"></div></div></td>
        <td class="pg-num">${esc(adultText(t, p))}</td>
        <td class="pg-next">${esc(next)}</td>
      </tr>`;
  };

  const group = (kind, label)=>{
    const list = config.tasks.filter(t=>t.group===kind);
    if(!list.length) return '';
    return `
      <section class="sec"${adultSectionHelpAttr(kind === 'must'
        ? '子ども画面の「かならず やる」に出る宿題の進み具合です。'
        : '子ども画面の「つぎに やる」に出る任意の宿題の進み具合です。')}>
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
    </div>
  </div>
  ${adultSectionNavHTML()}

  ${sampleResetNoticeHTML()}

  ${syncPromptHTML()}

  ${parentChildGuideHTML()}

  ${homeInstallGuideHTML()}

  <div class="pstat-wrap">
  <section class="paper pstat">
    <div class="pstat-left">
      ${canRefreshShared ? `<button class="icon-btn pstat-refresh" id="parentSyncRefresh" type="button" title="共有データを更新" aria-label="共有データを更新">${icon('refresh')}</button>` : ''}
      <span class="pstat-lab">${esc(periodWord(false))}の残り</span>
      <span class="pstat-val">${ms > 0
        ? `<span class="pstat-num">${Math.floor(ms/86400000)}</span><small class="pstat-unit">日</small><span class="pstat-num">${Math.floor(ms/3600000)%24}</span><small class="pstat-unit">時間</small>`
        : '終了'}</span>
      <span class="pstat-forecast">${esc(forecastText(forecast, false))}</span>
    </div>
    <div class="pstat-bars">
      ${/* 経過とすぐ見くらべたいのは「全体」なので、経過の真下に置く。
            必須・つぎにやる は その内わけとして 下に つづける */''}
      ${pstatRow(periodWord(false) + 'の経過', nat, '', 'natsu')}
      ${pstatRow('全体の進捗', allTotal ? allDone/allTotal*100 : 0, `${allDone}/${allTotal}`, 'all', allTotal ? s.done/allTotal*100 : 0)}
      ${pstatRow('必須の宿題', s.pct, `${s.done}/${s.total}`, 'must')}
      ${so.total ? pstatRow('任意の宿題', so.pct, `${so.done}/${so.total}`, 'opt') : ''}
    </div>
  </section>
  ${childActivity ? `<span class="pstat-child-updated">${esc(childActivity)}</span>` : ''}
  </div>

  ${parentMessageEditorHTML()}

  ${parentTodayLogsHTML()}

  ${group('must','必須の宿題')}
  ${group('option','任意の宿題')}
  ${bookSectionHTML()}
  ${trashSectionHTML()}

  <section class="sec"${adultSectionHelpAttr(
    '進捗と記録を文章にまとめ、コピーまたはテキスト保存します。')}>
    <div class="sec-head"><h2>進捗サマリー</h2></div>
    <div class="paper">
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
function inviteURLForCode(code, sender){
  code = cleanCode(code || '');
  if(!code) return '';
  const label = String(sender && sender.label || '').replace(/[\u0000-\u001f]/g, '').trim().slice(0, 12);
  const role = sender && (sender.role === 'parent' || sender.role === 'child') ? sender.role : '';
  return location.origin + location.pathname +
         '?' + JOIN_PARAM + '=' + encodeURIComponent(code) +
         '&r=' + Date.now() +          // ためこんだ古い画面を 配らないための 印
         '&openExternalBrowser=1' +
         (label ? '&from=' + encodeURIComponent(label) : '') +
         (role ? '&fromRole=' + role : '');
}

/* QRで既存の共有へ入ったあとにホーム画面へ追加するときも、追加された
   アイコンはSafariと別の保存領域で開く。iOSの「ホーム画面に追加」は
   history.replaceState()だけで変えたURLを引き継がないことがあるため、
   招待URLへ実際に移動してから追加してもらう。最初の起動で既存の
   applyJoinCode() が接続してからURLを消してくれる。
   すでにホーム画面版で開いているときは、起動URLを書き換えられないため不要。 */
function keepScannedInviteForHomeInstall(code, sender){
  if(isStandalone()) return false;
  const invite = inviteURLForCode(code, sender);
  if(!invite) return false;
  try{
    location.replace(invite + (location.hash || '#home'));
    return true;
  }catch(e){ return false; }
}
function inviteURL(){
  const S = window.NatsuSync;
  const info = window.NatsuApp && typeof window.NatsuApp.deviceInfo === 'function'
    ? window.NatsuApp.deviceInfo() : {};
  return inviteURLForCode((S && S.getCode()) || '', info);
}

/* QRの中身は招待URLだけを受け取る。合言葉だけのQRや、別サイトのURLを
   そのまま接続に使うと、意図しない共有へ入る入口になるため受け付けない。 */
function inviteInfoFromQR(value){
  try{
    const url = new URL(String(value || ''));
    if(url.origin !== location.origin || url.pathname !== location.pathname) return { code:'', sender:null };
    const code = cleanCode(url.searchParams.get(JOIN_PARAM) || '');
    if(code.length < 8) return { code:'', sender:null };
    const label = String(url.searchParams.get('from') || '').replace(/[\u0000-\u001f]/g, '').trim().slice(0, 12);
    const role = url.searchParams.get('fromRole') === 'parent' ? 'parent'
      : url.searchParams.get('fromRole') === 'child' ? 'child' : '';
    return { code, sender:(label || role) ? { label, role } : null };
  }catch(e){ return { code:'', sender:null }; }
}
function inviteCodeFromQR(value){
  return inviteInfoFromQR(value).code;
}
function qrSenderLabel(sender){
  const role = sender && sender.role === 'parent' ? '保護者'
    : sender && sender.role === 'child' ? '子ども' : '';
  const label = String(sender && sender.label || '').trim();
  if(label && role) return label + '（' + role + '）';
  if(label) return label;
  if(role) return 'このQRを表示した端末（' + role + '）';
  return 'このQRを表示した端末';
}

let qrScanStream = null;
let qrScanFrame = 0;
let qrScanCode = '';
let qrScanSender = null;
let qrScanVerified = null;
let qrScanBusy = false;

function stopInviteScanner(){
  if(qrScanFrame) cancelAnimationFrame(qrScanFrame);
  qrScanFrame = 0;
  if(qrScanStream) qrScanStream.getTracks().forEach(track=>track.stop());
  qrScanStream = null;
  const video = $('#qrScanVideo');
  if(video) video.srcObject = null;
}

function closeInviteScanner(){
  stopInviteScanner();
  const dialog = $('#qrScanDialog');
  if(!dialog || !dialog.open) return;
  if(typeof dialog.close === 'function') dialog.close();
  else dialog.removeAttribute('open');
}

async function connectScannedInvite(){
  const S = window.NatsuSync;
  const status = $('#qrScanStatus');
  const connect = $('#qrScanConnect');
  const code = qrScanCode;
  if(!S || !S.configured() || !code) return;
  qrScanBusy = true;
  if(connect) connect.disabled = true;
  try{
    if(!qrScanVerified || qrScanVerified.code !== code){
      if(status) status.textContent = '接続先を確認しています…';
      const result = await S.verifyHousehold(code);
      if(!result || !result.found){
        if(status) status.textContent = 'この共有は見つかりませんでした。QRコードを出し直してもう一度読み取ってください。';
        return;
      }
      if(result.unreadable){
        if(status) status.textContent = unreadableJoinText();
        return;
      }
      qrScanVerified = { code };
      if(status) status.textContent = '確認OK：' + qrSenderLabel(qrScanSender) + 'と同じグループに接続します。';
      if(connect){ connect.textContent = '確定して続ける'; connect.hidden = false; connect.focus(); }
      return;
    }
    if(status) status.textContent = qrSenderLabel(qrScanSender) + 'と同じグループに接続しています…';
    if(typeof S.forgetRevokedCode === 'function') S.forgetRevokedCode();
    try{ localStorage.removeItem(K_WELCOME_THEME); }catch(e){}
    await forgetConfigStampForNewHousehold(code);
    await rememberChosenCode(code);
    setLocal(K_ONBOARD, 'done');
    S.reconnect(code, { joining:true });
    /* Safariでは、実URLのままホーム画面へ追加して初めて別の保存領域へ
       合言葉を渡せる。移動すると以下の描画は新しいページで行われる。 */
    if(keepScannedInviteForHomeInstall(code, qrScanSender)) return;
    closeInviteScanner();
    if(tab === 'welcome'){
      tab = 'home';
      navigateTo('home');
    }
    render({ keepScroll:true });
    toast('共有に接続しています…');
  }catch(e){
    if(status) status.textContent = '接続を確認できませんでした。通信を確認して、もう一度試してください。';
  }finally{
    qrScanBusy = false;
    if(connect) connect.disabled = false;
  }
}

async function openInviteScanner(){
  const dialog = $('#qrScanDialog');
  const video = $('#qrScanVideo');
  const canvas = $('#qrScanCanvas');
  const status = $('#qrScanStatus');
  const connect = $('#qrScanConnect');
  if(!dialog || !video || !canvas) return;
  qrScanCode = '';
  qrScanSender = null;
  qrScanVerified = null;
  if(connect){ connect.hidden = true; connect.disabled = false; connect.textContent = '接続先を確認する'; }
  if(status) status.textContent = '';
  if(typeof window.jsQR !== 'function'){
    if(status) status.textContent = 'QRコードを読み取る準備ができませんでした。ページを更新してください。';
    return;
  }
  if(!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia){
    if(status) status.textContent = 'このブラウザではカメラを使えません。招待リンクを開くか、合言葉を入力してください。';
    if(typeof dialog.showModal === 'function') dialog.showModal(); else dialog.setAttribute('open', '');
    return;
  }
  if(typeof dialog.showModal === 'function') dialog.showModal(); else dialog.setAttribute('open', '');
  if(status) status.textContent = 'カメラの使用を許可してください。';
  try{
    qrScanStream = await navigator.mediaDevices.getUserMedia({
      audio:false,
      video:{ facingMode:{ ideal:'environment' }, width:{ ideal:1280 }, height:{ ideal:720 } }
    });
    video.srcObject = qrScanStream;
    await video.play();
    if(status) status.textContent = 'QRコードを枠の中に入れてください。';
    const context = canvas.getContext('2d', { willReadFrequently:true });
    const scan = ()=>{
      if(!qrScanStream || qrScanCode || !context) return;
      if(video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA && video.videoWidth && video.videoHeight){
        const width = Math.min(video.videoWidth, 960);
        const height = Math.round(video.videoHeight * width / video.videoWidth);
        canvas.width = width; canvas.height = height;
        context.drawImage(video, 0, 0, width, height);
        const found = window.jsQR(context.getImageData(0, 0, width, height).data, width, height, { inversionAttempts:'dontInvert' });
        const invite = found ? inviteInfoFromQR(found.data) : null;
        if(invite && invite.code){
          qrScanCode = invite.code;
          qrScanSender = invite.sender;
          stopInviteScanner();
          if(status) status.textContent = '招待QRを読み取りました。次に、グループが実在し中身を読めることを確認します。';
          if(connect){ connect.textContent = '接続先を確認する'; connect.hidden = false; connect.focus(); }
          return;
        }
      }
      qrScanFrame = requestAnimationFrame(scan);
    };
    scan();
  }catch(e){
    stopInviteScanner();
    if(status) status.textContent = 'カメラを使えませんでした。許可を確認するか、合言葉を入力してください。';
  }
}

function bindInviteScanButtons(root){
  $$('[data-qr-invite-scan]', root || document).forEach(button=>{
    if(button.dataset.qrScanBound) return;
    button.dataset.qrScanBound = '1';
    button.addEventListener('click', openInviteScanner);
  });
}

const qrScanDialog = $('#qrScanDialog');
if(qrScanDialog) qrScanDialog.addEventListener('close', stopInviteScanner);
on('#qrScanClose', 'click', closeInviteScanner);
on('#qrScanCancel', 'click', closeInviteScanner);
on('#qrScanConnect', 'click', ()=>{ if(!qrScanBusy) connectScannedInvite(); });

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
    <p class="set-note">このリンクかQRコードを、もう一方の端末で読み取ります。合言葉の入力は要りません。</p>
    <div class="set-row">
      <input type="text" id="inviteUrl" value="${esc(url)}" readonly onfocus="this.select()">
    </div>
    <div class="set-actions">
      <button class="btn btn-sm" id="inviteCopy" type="button">リンクをコピー</button>
    </div>
    ${inviteQrHTML(url)}
    ${/* **この1行は 残す。** 憲章2節が 操作画面に 求めている 注意で、
          リンクを コピーする 指の 直前に ある。
          「受け取る側は ホーム画面に 追加」は 専用の 案内欄が 別に あるので 消した */''}
    <p class="set-note">このリンクは<b>合言葉そのもの</b>です。SNSなどに貼らないでください。</p>
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
  const seen = new Set(seenMessageIds());
  rows.filter(m=> !seen.has(m.id)).forEach(m=> shownNewMessageIds.add(m.id));
  rememberSeenMessages(rows);
  return `
  <div class="msg-list">
    ${rows.map(m=>`
      <div class="msg-row${shownNewMessageIds.has(m.id) ? ' is-new' : ''}">
        <div class="msg-main">
          <span class="msg-from">${shownNewMessageIds.has(m.id) ? '<span class="message-new-dot" aria-label="新しいメッセージ"></span>' : ''}${esc(messageHeading(m))}</span>
          <span class="msg-text">${esc(m.text)}</span>
        </div>
        <button class="icon-btn del" data-delmsg="${esc(m.id)}" type="button"
                title="このメッセージを消す" aria-label="${esc(messageHeading(m))}のメッセージを消す">${icon('trash')}</button>
      </div>`).join('')}
  </div>`;
}

function parentMessageEditorHTML(){
  const msg = config.parentMessage;
  return `
  <section class="sec parent-message-editor"${adultSectionHelpAttr(
    `子ども画面へ80文字までのメッセージを送ります。新しい順に最大${MESSAGES_MAX}件を表示し、同じ名前で送ると前の文を更新します。`)}>
    <div class="sec-head"><h2>子どもへのメッセージ</h2></div>
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
  return [mark, alone ? 'ほかの端末を待っています' : (text || def)].filter(Boolean).join(' ');
}

/* オフラインだけは OS ごとに形が変わる文字を使わず、自前の線画を出す。
   状態名は目に見える文字として残すため、色やピクトグラムだけに依存しない。 */
function syncStatusHTML(status, text){
  const label = syncStatusText(status, text);
  if(status !== 'offline') return esc(label);
  return `<span class="sync-state-icon" aria-hidden="true">${icon('offline')}</span><span>${esc(label)}</span>`;
}

const SYNC_LABEL = {
  off:        ['—',  'つないでいません'],
  connecting: ['…',  'つないでいます'],
  online:     ['✓',  'つながっています'],
  offline:    ['',   'オフライン'],
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
  if(!syncNeedsSetup() || getLocal(K_SYNC_PROMPT_DONE) === 'done') return '';
  return `
  <section class="sec sync-prompt">
    ${syncSectionHTML({ lead:'この端末の記録は、まだこの端末の中だけにあります。'
                           + 'あいことばを決めると、同じグループの複数の端末で使えます。',
                         dismissPrompt:true })}
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
function parentShareSummary(rows, mine, fallbackName, syncStatus){
  /* 端末一覧だけで決めていたので、同期が切れていても「接続待ち」と出ていた。
     子ども端末を待っているのか、こちらがつながっていないのかは、保護者に
     とって別のことなので分ける（実際に切れた日、この見分けが付かなかった） */
  if(syncStatus === 'error'){
    return { state:'error', full:'共有につながっていません', short:'：未接続' };
  }
  const other = (rows || []).filter(r => r && r.id !== mine);
  const children = other.filter(r => r.role === 'child');
  /* short は 狭い画面用。320px で 使えるのは 90px ほど しか なく、
     「子ども端末の接続待ち」は 20px はみ出していた。バッジの 左には
     すでに「共有」の印が 出ているので、続きは「：〈短い語〉」で 足りる
     （共有なしのときの「：設定」と 同じ形）。名前だけは 長さを
     約束できないので、入りきらなければ … に まかせる。 */
  if(children.length){
    const name = String(children[0].name || fallbackName || '').trim();
    return {
      state: 'child',
      full: name ? name + 'と共有中' : '子ども端末と共有中',
      short: name ? '：' + name : '：子ども'
    };
  }
  if(other.length) return { state:'other', full:'ほかの端末と共有中', short:'：ほかの端末' };
  return { state:'waiting', full:'共有設定済み・子ども端末の接続待ち', short:'：接続待ち' };
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
    getLocal(K_DEVICE_ID), config.childName || getLocal(K_NAME),
    typeof S.status === 'function' ? S.status() : ''
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
        : `<button class="btn btn-sm btn-ghost dev-off" data-devoff="${esc(r.id)}" type="button">一覧から外す</button>`}
    </li>`).join('')}</ul>
    ${/* 「一覧から外す」を 紛失した 端末の アクセス取り消しと 読ませない
          （憲章8節の 4）。**これは 消さない。** ただし 押す ボタンの すぐ下に
          1行だけ 置き、止めたい ときの 手順は i の 中へ 寄せる。
          以前は 説明が 2段落 続く たたみで、一覧そのものが 押し出されていた */''}
    <p class="set-note">一覧から外しても、合言葉を入れ直せば再参加できます。</p>
    ${/* 版ちがいの 注意は 実害の 警告なので たたまない */''}
    ${[...new Set(rows.map(r=> r.ver).filter(Boolean))].length > 1
      ? '<p class="set-note dev-warn">古いバージョンの端末があります。その端末で「アプリ情報」の<b>最新に更新する</b>を実行してください。古いままだと、修正や削除がその端末から元に戻されることがあります。</p>'
      : ''}`;
}

/* 見出しの「i」は、写真の説明（#posterHelpDialog）と同じ作り。
   data-adult-section-help は **平文1段落しか 入らない**（textContent で 入れる）ので、
   図と 番号を 出す ここでは 使わない。buildAdultSectionToc() は
   `.adult-section-head-help` が すでに ある 見出し帯には 足さないので、
   自前の ボタンを 置いても i は 1つの まま。目次には これまで どおり 載る。
   **id では なく data 属性で 拾う。** この欄は 保護者ページの 案内と
   設定ページの 2か所から 呼ばれ、id だと 重複する 危険が ある */
function syncHeadHTML(extra){
  return `<div class="sec-head has-help"><h2>ほかの端末と共有</h2>${extra || ''}
      <button class="adult-section-head-help" type="button" data-sync-help
        title="共有のしくみ" aria-label="ほかの端末と共有のしくみを見る" aria-haspopup="dialog"
        aria-controls="syncHelpDialog"><span class="adult-section-head-info" aria-hidden="true">i</span></button></div>`;
}

function syncSectionHTML(opts){
  const lead = opts && opts.lead;
  const S = window.NatsuSync;
  if(!S){
    return `
  <section class="sec" id="syncSection">
    ${syncHeadHTML()}
    <div class="paper">
      <p class="set-note">同期の読み込みに失敗しました。記録はこの端末に保存されています。</p>
    </div>
  </section>`;
  }

  if(!S.configured()){
    return `
  <section class="sec" id="syncSection">
    ${syncHeadHTML()}
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
    ${syncHeadHTML(`<span class="sec-note sync-status" id="syncStatus" role="status" aria-live="polite">${syncStatusHTML(S.status(), S.statusText())}</span>`)}
    <div class="paper">
      ${lead ? `<p class="set-note sync-lead">${esc(lead)}</p>` : ''}
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
      <div class="sync-code-row"><label class="lab" for="syncCodeShown">このグループの合言葉</label>
        <div class="sync-code-control"><input type="text" id="syncCodeShown" value="${esc(code)}" spellcheck="false"
               autocapitalize="off" autocorrect="off" placeholder="未設定" readonly>
          <button class="btn btn-sm" id="syncCopy" type="button">コピー</button></div></div>
      ${/* 共有ずみの 3つは **使う 順**に 並べる。増やす → 整える → やめる。
            以前は 1つの たたみに 招待・一覧・呼び名・役割・解除が 全部 入っていて、
            いちばん よく 使う 招待が いちばん 奥に あった。
            招待の QR は 合言葉そのものなので、たたんだ ままに して 常時は 出さない */''}
      <details class="set-advanced sync-detail" data-details-key="syncInvite"${opts && opts.openDetails ? ' open' : ''}>
        <summary>ほかの端末を増やす（QR・招待リンク）</summary>
        <div class="set-advanced-body">
          ${inviteHTML()}
        </div>
      </details>
      <details class="set-advanced sync-detail" data-details-key="syncDevices">
        <summary><span class="sync-device-count" id="syncDeviceCount">端末と表示の設定（設定済み：${S.deviceCount()}台）</span></summary>
        <div class="set-advanced-body">
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
            ${/* 役割を 権限と 読ませない（憲章8節の 3）。**この1行は 消さない。**
                  えらぶ 欄の すぐ下に 置く。呼び名の 決め方など 残りは i の 中 */''}
            <p class="set-note">「保護者の端末」「子どもの端末」は、開いたときの画面と記録者名の設定です。</p>
          </div>
        </div>
      </details>
      <details class="set-advanced sync-detail" data-details-key="syncLeave">
        <summary>共有をやめる・つなぎ直す</summary>
        <div class="set-advanced-body">
          <h3 class="sync-subhead">べつの合言葉につなぎ直す</h3>
          <p class="set-note">入力した合言葉のグループにつなぎ直します。<b>記録（やったこと・本）は消えません。</b>つないだ先の記録と合わさります。</p>
          <p class="set-note">名前・宿題・デザインは、<b>つないだ先のグループの内容に変わります</b>。この端末の設定は使われません。</p>
          <div class="set-row"><span class="lab">つなぎ直す合言葉</span>
            <input type="text" id="syncRejoinCode" value="" spellcheck="false"
                   autocapitalize="off" autocorrect="off" placeholder="受け取った合言葉"></div>
          <div class="set-actions qr-scan-entry"><button class="btn btn-sm btn-ghost" type="button" data-qr-invite-scan>QRコードを読み取る</button></div>
          <div class="set-actions">
            <button class="btn btn-sm" id="syncSave" type="button">入力した合言葉につなぎ直す</button>
          </div>
          <h3 class="sync-subhead">共有を解除する</h3>
          <p class="set-note">この端末だけを共有から外します。ほかの端末や記録はそのまま残ります。もう一度参加するには、合言葉を入力し直してください。</p>
          <div class="set-actions">
            <button class="btn btn-sm btn-danger" id="syncOff" type="button">共有を解除する</button>
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
        ${/* 何が 起きるかは 書く（押すと 共有が 始まる）。
              16文字・そのあと QR を 渡す、といった しくみの 話は i の 中へ */''}
        <p class="set-note">「おまかせ」を押すと、この端末が合言葉を作ります。押した時点で、この端末の宿題・設定・記録がグループの内容になります。</p>
        <div class="set-actions">
          <button class="btn btn-go" id="syncMake" type="button">合言葉をつくる（おまかせ）</button>
        </div>
        ${/* 最初の設定と同じく、ここでも 自分で 決められるように する。
              決め方が ちがっても、押した 時点で 共有が 始まるのは 同じ。
              **主の ボタンを 1つに する**ため、たたみの 中は btn-sm に 落とす */''}
        <details class="set-advanced" data-details-key="syncOwnCode">
          <summary>合言葉を自分でつくる</summary>
          <div class="set-advanced-body">
            <p class="set-note">8文字以上にしてください。ふだん使っているパスワードや、家族の名前・誕生日など推測できる言葉は使わないでください。おまかせで作るほうが安全です。</p>
            <div class="set-row"><span class="lab">決めた合言葉</span>
              <input type="text" id="syncOwnCode" value="" spellcheck="false"
                     autocapitalize="off" autocorrect="off" placeholder="8文字以上"></div>
            <div class="set-actions">
              <button class="btn btn-sm" id="syncMakeOwn" type="button">この合言葉でつくる</button>
            </div>
          </div>
        </details>
      </div>
      <div class="sync-start">
        <h3 class="sync-subhead">ほかの端末で作った合言葉に参加する</h3>
        ${/* 実際に 使うのは QR。以前は QR が いちばん 弱い ボタンで、
              合言葉の 手入力・確認・参加の 3つと 同じ 強さで 並んでいた */''}
        <div class="set-actions qr-scan-entry"><button class="btn btn-go" type="button" data-qr-invite-scan>QRコードを読み取る</button></div>
        <details class="set-advanced" data-details-key="syncJoinCode">
          <summary>合言葉を入力して参加する</summary>
          <div class="set-advanced-body">
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
          </div>
        </details>
      </div>`}
      ${/* いちばん 弱い 選択肢なので 最後に 置く。案内として 出した ときだけ */''}
      ${opts && opts.dismissPrompt ? `<div class="set-actions sync-dismiss"><button class="btn btn-sm btn-ghost" id="syncPromptDismiss" type="button">接続せず使う</button></div>` : ''}
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
  <section class="sec"${adultSectionHelpAttr(
    '削除した記録の控えを確認します。本の冊数などは削除時に戻っていますが、記録そのものは元に戻せません。')}>
    <div class="sec-head"><h2>消した記録</h2><span class="sec-note">${rows.length}件</span></div>
    <details class="paper set-advanced">
      <summary>消した中身を見る</summary>
      <div class="set-advanced-body">
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
function syncTroubleHTML(){
  const S = window.NatsuSync;
  const t = (S && typeof S.lastTrouble === 'function') ? S.lastTrouble() : null;
  if(!t) return '';
  const mode = (S && typeof S.storageMode === 'function' && S.storageMode() === 'memory')
    ? '　（この端末では、ためこみをやめて通信だけでつないでいます）' : '';
  /* 英語の例外は ここだけに 出す。ふだんの 画面には
     「つながりません。アプリを開き直すと直ることがあります」しか 出さない */
  return `<p class="set-note">最後につながらなかったとき：${esc(fmtTime(new Date(t.at)))}　${esc(t.where)}　${esc(t.detail)}${mode}</p>`;
}

function syncTraceHTML(){
  const rows = traceRead();
  const t = ms => ms ? fmtTime(new Date(ms)) + ':' + pad2(new Date(ms).getSeconds()) : '（なし）';
  return `
  <section class="sec config-sec config-sec--quiet">
    <details class="paper set-advanced" data-details-key="syncTrace">
      <summary>デバッグ用：同期の記録（${rows.length}件）</summary>
      <div class="set-advanced-body">
        ${syncTroubleHTML()}
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

function parentBookOrder(){ return getLocal(K_PARENT_BOOK_ORDER) === 'asc' ? 'asc' : 'desc'; }
function parentBookRows(rows){
  const order = parentBookOrder();
  const compare = (a,b)=> String(a.date || '').localeCompare(String(b.date || '')) || (a.nth|0) - (b.nth|0);
  return rows.slice().sort((a,b)=> order === 'asc' ? compare(a,b) : compare(b,a));
}
function parentBookRowHTML(b){
  const editName = `「${b.title || '書名未設定'}」を編集する`;
  return `<div class="book-row">
    <span class="book-no">${bookOrdinal(b.nth, true)}</span>
    <div class="book-main">
      <div class="book-title">${esc(b.title)}</div>
      <div class="book-sub">${[
        b.date, b.author, b.publisher,
        b.rating ? '★'.repeat(b.rating) : ''
      ].filter(Boolean).map(esc).join('　')}</div>
      ${b.memoOut || b.memo ? `<div class="book-memo">${esc(b.memoOut || b.memo)}</div>` : ''}
    </div>
    <div class="book-actions">
      <button class="icon-btn edit" data-open="${esc(b.taskId)}" data-book="${esc(b.id)}" type="button"
        title="${esc(editName)}" aria-label="${esc(editName)}">${icon('edit')}</button>
      <button class="icon-btn del" data-delbook="${esc(b.id)}" title="「${esc(b.title || '書名未設定')}」を削除する"
        aria-label="「${esc(b.title || '書名未設定')}」の記録を削除する" type="button">${icon('trash')}</button>
    </div>
  </div>`;
}

/* 保護者ページの本の記録一覧。直近3冊を見せ、残りは必要なときだけ開く */
function bookSectionHTML(){
  if(!config.tasks.some(isBook)) return '';
  const rows = parentBookRows(state.books || []);
  const shown = rows.slice(0, 3), rest = rows.slice(3);
  const order = parentBookOrder(), nextOrder = order === 'desc' ? 'asc' : 'desc';

  return `
  <section class="sec"${adultSectionHelpAttr(
    '記録した本を確認し、書名・読んだ日・感想を編集できます。削除すると冊数も1つ戻ります。')}>
    <div class="sec-head"><h2>本の記録</h2><span class="sec-note">${rows.length}冊</span></div>
    <div class="paper parent-book-list">
      ${rows.length > 1 ? `<div class="parent-book-toolbar">
        <button class="parent-book-order" data-parent-book-order="${nextOrder}" type="button"
          aria-label="現在は${order === 'desc' ? '新しい順。古い順' : '古い順。新しい順'}に切り替える">
          ${order === 'desc' ? '新しい順 ↓' : '古い順 ↑'}
        </button>
      </div>` : ''}
      ${shown.length ? `<div class="parent-book-head">${shown.map(parentBookRowHTML).join('')}</div>`
        : `<p class="empty">まだ記録がありません。</p>`}
      ${rest.length ? `<details class="parent-book-more" data-details-key="parentBooksMore">
        <summary><span class="parent-book-more-closed">残り${rest.length}冊を見る</span><span class="parent-book-more-open">閉じる</span></summary>
        <div class="parent-book-more-list">${rest.map(parentBookRowHTML).join('')}</div>
      </details>` : ''}
    </div>
  </section>`;
}

/* ---------------------------------------------------------
   きろくシート
   --------------------------------------------------------- */
let sheetTask = null, sheetSel = null, sheetSteps = null, sheetWrap = null;
let sheetRating = 0, sheetBookId = null;
/* シートを開いた入口。記録データではなく、保存時の案内だけを分ける。 */
let sheetAdultOrigin = false;
/* まいにち型を 開いた ときの「きょうの きろく」。減らしたかどうかの 判定に つかう */
let sheetDailyToday = 0;
/* 開いたときの 答えと、それが 専用欄に 入っているか。
   いまの 入力と くらべて「ほぞんずみ／まだ」を 出しわける */
let sheetQBase = null, sheetQStored = null;
/* このシートを 開いてから「この答えを保存」で 入れた ぶん。
   きろく の 本文に のせるのは この 回に 書きかえた 答えだけなので、
   先に 1問ずつ 保存した ぶんも ここで 覚えておかないと、
   「やったこと」に 何も のこらなく なる */
let sheetSavedAnswers = [];
/* 開いたときの 入力らんの ひかえと、シートのために 足した 履歴が あるか */
let sheetInputBase = null, sheetNavPushed = false;

/* シートの 入力らんを ぜんぶ 控える。本の 訂正のように 最初から
   文字が 入っている ものも あるので、「空かどうか」ではなく
   「開いたときから 変わったか」で 書きかけを 見わける。 */
function sheetInputSnapshot(){
  return $$('#sheetBody textarea, #sheetBody input[type="text"], #sheetBody input[type="number"]')
    .map(el=> String(el.value || '').trim());
}
function sheetInputsChanged(){
  if(!sheetInputBase) return false;
  const now = sheetInputSnapshot();
  return now.length !== sheetInputBase.length
    || now.some((v, i)=> v !== String(sheetInputBase[i] || ''));
}
function showSheet(){
  $('#sheetWrap').hidden = false;
  /* シートが開いている間は、背後の #scroll を動かさない。
     長い入力は .sheet-body だけでスクロールできる。 */
  document.body.classList.add('sheet-open');
  document.body.style.overflow = 'hidden';
  sheetInputBase = sheetInputSnapshot();
  /* iPad は 画面の 左右の はしから なぞると、Safari の 戻る/進むが 動く。
     これは ページの 中の スクロールでは ないので touch-action では 止まらず、
     beforeunload も iOS では あてに ならない。
     シートを 開くときに 履歴を 1つ 足しておくと、その なぞりは
     ページを 出るのではなく この 履歴を 戻すだけで すむ。
     popstate で 受けとめて、書きかけを 守る。 */
  if(!sheetNavPushed){
    sheetNavPushed = true;
    history.pushState({ natsuSheet:true }, '', location.href);
  }
}
/* v1.3.11 までは任意質問の答えを専用欄へ残さず、
   「・質問\n　→ 答え」という形で通常の記録本文へ混ぜていた。
   その時代に「きろくする」を押した回答は、最新の記録から読み直して
   入力欄へ出す。まだ専用欄へは書き戻さず、本人が確認して保存したときだけ
   新しい形式へ移すため、昔の記録本文を勝手に変えない。 */
function legacyQuestionAnswers(t){
  const questions = t.questions || [];
  const answers = new Array(questions.length).fill('');
  const logs = (state.logs || []).filter(l=>l && l.taskId === t.id && l.memo)
    .slice().sort((a,b)=>String(b.at || '').localeCompare(String(a.at || '')));
  let filled = 0;
  for(const log of logs){
    const memo = String(log.memo || '');
    questions.forEach((q, i)=>{
      if(answers[i]) return;
      const marker = '・' + q + '\n　→ ';
      const start = memo.indexOf(marker);
      if(start < 0) return;
      const from = start + marker.length;
      const next = memo.indexOf('\n・', from);
      /* つぎの 問が 続く なら、そこが 切れ目だと はっきり 分かるので
         改行ごと のこす。いちばん 後ろの 答えには つぎの 問が 無く、
         そのあとに 書いた ふつうの メモが つながって いる。
         答えと メモの あいだに 目じるしは 無く、答えにも 改行を
         ゆるして いるので、どこまでが 答えかは 決められない。
         後ろの ものだけ 1行に かぎる。まちがえた 文を そのまま
         専用欄へ 移して 固めて しまうより、足りない ぶんを 下の
         「これまでの きろく」で 見て 直す ほうが とりかえしが つく。 */
      const end = next < 0 ? memo.indexOf('\n', from) : next;
      const value = memo.slice(from, end < 0 ? memo.length : end).trim();
      if(value){ answers[i] = value; filled++; }
    });
    /* 埋めた数を 自分で 数える。歯とびの 配列では length が
       「最後に 入れた ばんごうの つぎ」に なるため、
       11問を 8〜11 だけ 埋めた 記録でも length は 11 に なり、
       1〜7 が のこる 古い 記録を 読まずに 止まってしまう。 */
    if(filled >= questions.length) break;
  }
  return answers;
}
/* しつもん・だんかいの 行を 編集した とき、古い ならびの どの 添字が
   新しい ならびの どこへ 行くかを 出す。-1 は 新しく ふえた 行。

   答え（answers[i]）も だんかいの チェック（progress.steps[i]）も、
   **添字だけ**で 行に ひもづいて いる。行の 編集は textarea を まるごと
   置きかえる ので、間の1行を 消すと 後ろが 前へ 詰まり、答えと チェックが
   1つ上へ ずれる。同じ 文の 行を さがして 取り直す。

   文ごと 書き直した 行は さがしても 見つからない。余った もの どうしを
   出てきた 順に 組み合わせて、書き直しただけの ときに 引きつぎを 落とさない。 */
function realignIndexes(before, after){
  const b = Array.isArray(before) ? before : [];
  const a = Array.isArray(after)  ? after  : [];
  const used = [];
  const out = a.map(q=>{
    const i = b.indexOf(q);
    if(i < 0 || used.indexOf(i) >= 0) return -1;
    used.push(i);
    return i;
  });
  const rest = b.map((q,i)=>i).filter(i => used.indexOf(i) < 0);
  let r = 0;
  return out.map(i => i >= 0 ? i : (r < rest.length ? rest[r++] : -1));
}

/* 行を 入れかえる **前に** 呼ぶこと（古い ならびが 要る）。
   何も 動かない ときは 書きこまない（同期に むだな 更新を 流さない） */
function realignQuestionAnswers(t, before, after){
  const map = realignIndexes(before, after);
  if(before.length === after.length && map.every((oldI, i)=> oldI === i)) return;
  const answers = questionAnswerRow(t).answers;
  if(!answers.some(Boolean)) return;
  saveQuestionAnswerRow(t, map.map(i => i < 0 ? '' : String(answers[i] || '')));
  saveSt();
}

function realignStepProgress(t, before, after){
  const map = realignIndexes(before, after);
  if(before.length === after.length && map.every((oldI, i)=> oldI === i)) return;
  const cur = state.progress[t.id];
  if(!cur || !Array.isArray(cur.steps) || !cur.steps.some(Boolean)) return;
  const steps = map.map(i => i < 0 ? false : !!cur.steps[i]);
  const at = Array.isArray(cur.stepsAt) ? map.map(i => i < 0 ? 0 : ms(cur.stepsAt[i])) : [];
  /* 動かした ぶんは「いま 決めた こと」なので、値が 変わった 行だけ 時刻を
     いまに する。そうしないと、まだ 直していない 端末の 古い ならびに
     合流で 負けて、ずれが もどって しまう */
  state.progress[t.id] = Object.assign({}, cur, {
    steps, stepsAt: stampArray(cur.steps, steps, at, Date.now())
  });
  saveSt();
}

function questionAnswerRow(t){
  const shared = state.questionAnswers && state.questionAnswers[t.id];
  const local = localAnswerMap()[t.id];
  const pick = !shared || (local && ms(local.at) > ms(shared.at)) ? local : shared;
  const stored = pick && Array.isArray(pick.answers) ? pick.answers : [];
  /* 専用欄が 空の 問だけ 旧記録で 補う。行が あるかどうかで
     まとめて 決めると、1問だけ 保存した 課題で のこりの 問を
     見失う。問ごとに 見て、保存ずみの 答えは そのまま のこす。 */
  const legacy = legacyQuestionAnswers(t);
  const questions = t.questions || [];
  const answers = questions.map((q, i)=> String(stored[i] || '') || String(legacy[i] || ''));
  return {
    answers,
    /* 旧記録から 出した 答えも「のこっている」。記録本文は 消えないので、
       専用欄に 無いことを 理由に「ほぞんして いない」と 言うのは まちがい。
       画面には 答えが あるかどうかで 出しわける。 */
    kept: answers.map(v=> !!v),
    /* 専用欄に 入っているか。同じ 内容を もう一度 押した ときに
       移しかえが 要るかどうかの 判断だけに つかう。 */
    stored: questions.map((q, i)=> !!String(stored[i] || '')),
    at: pick ? pick.at : 0
  };
}
function saveQuestionAnswerRow(t, answers){
  const row = { answers, at:Date.now() };
  if(!state.questionAnswers || typeof state.questionAnswers !== 'object') state.questionAnswers = {};
  state.questionAnswers[t.id] = row;
  const local = Object.assign({}, localAnswerMap());
  local[t.id] = row;
  setLocal(K_QUESTION_ANSWERS, JSON.stringify({ resetAt:ms(state.resetAt), rows:local }));
  answerMapCache = null;
}
function saveQuestionAnswer(index, ask){
  const t = sheetTask;
  const el = t && $('#sheetBody [data-q="' + index + '"]');
  if(!t || !el) return false;
  const before = questionAnswerRow(t);
  const answers = before.answers.slice();
  const next = String(el.value || '').trim().slice(0, 800);
  const old = String(answers[index] || '');
  if(!next && !old){ toast('答えを 書いてから ほぞんしてね'); return false; }
  /* 旧記録から 出しただけの 答えは、見た目が 同じでも まだ 専用欄に ない。
     ここで 止めると「この答えを保存」と 出ている ボタンが
     押しても 何も しない ことに なるので、移しかえを 通す。 */
  const already = !!(sheetQStored || [])[index];
  if(next === old && already){ toast('この答えは ほぞんずみだよ'); return true; }
  if(ask && already && next !== old && !confirm('まえの 答えを かきかえます。いいですか？')) return false;
  answers[index] = next;
  saveQuestionAnswerRow(t, answers);
  saveSt();
  markQuestionSaved(index, next);
  rememberSavedAnswer(index, next);
  toast(next ? '答えを ほぞんしたよ' : '答えを からに したよ');
  return true;
}
/* この保存で 実際に 書きかわる 答えだけを 取り出す。**必ず
   saveQuestionAnswers() より 先に 呼ぶこと**（あとでは 保存ずみに なり、
   何も 変わっていないように 見える）。

   記録本文には ここで 返した ぶんだけを のせる。以前は 欄に 入っている
   答えを 毎回 すべて 書き出していたので、1問 直しただけでも
   「やったこと」に 全問が もう一度 並んだ。 */
function rememberSavedAnswer(index, text){
  const keep = String(text || '');
  sheetSavedAnswers = sheetSavedAnswers.filter(c => c.i !== index);
  if(keep) sheetSavedAnswers.push({ i:index, text:keep });
}

/* 記録本文に のせる 答え。1問ずつ 保存した ぶんと、きろく を 押した
   時点で まだ 書きかわる ぶんを 合わせ、問の 順に そろえる。
   同じ問が 両方に あるときは、あとから 直した 今の 値を 採る。 */
function answerChangesForLog(){
  const pendingList = pendingAnswerChanges();
  const byIndex = new Map();
  sheetSavedAnswers.forEach(c => byIndex.set(c.i, c));
  pendingList.forEach(c => byIndex.set(c.i, c));
  return [...byIndex.values()].sort((a, b)=> a.i - b.i);
}

function pendingAnswerChanges(){
  const t = sheetTask;
  if(!t || !(t.questions || []).length) return [];
  const before = questionAnswerRow(t);
  return $$('#sheetBody [data-q]')
    .map((el, i)=> ({ i, text:String(el.value || '').trim().slice(0, 800) }))
    .filter(c => c.text && c.text !== String(before.answers[c.i] || ''));
}

function saveQuestionAnswers(ask){
  const t = sheetTask;
  if(!t || !(t.questions || []).length) return true;
  const before = questionAnswerRow(t);
  const answers = $$('#sheetBody [data-q]').map(el=>String(el.value || '').trim().slice(0, 800));
  const changed = answers.map((v, i)=> v !== String(before.answers[i] || ''));
  if(!changed.some(Boolean)) return true;
  /* 問ごとに 確認を 出すと、質問の 多い 課題では 同じ 窓が
     何回も 続く。読まずに 押す ようになって 確認の 意味が なくなるので、
     書きかわる 問の ばんごうを まとめて 1回だけ 聞く。 */
  const over = changed.map((c, i)=> c && String(before.answers[i] || '') ? i + 1 : 0).filter(Boolean);
  if(ask && over.length && !confirm('しつもん ' + over.join('・') + ' の 答えを かきかえます。いいですか？')) return false;
  saveQuestionAnswerRow(t, answers);
  saveSt();
  answers.forEach((v, i)=> markQuestionSaved(i, v));
  return true;
}
/* 答えの ようす は 3つ。
   saved … 開いた ときの まま。答えは のこっている
   dirty … 書きかえた。まだ のこっていない
   empty … なにも 書いていない */
function questionState(i){
  const el = $('#sheetBody [data-q="' + i + '"]');
  if(!el) return 'empty';
  const now = String(el.value || '').trim();
  const base = String((sheetQBase || [])[i] || '');
  if(now !== base) return 'dirty';
  return now ? 'saved' : 'empty';
}
function unsavedQuestions(){
  const t = sheetTask;
  if(!t || !(t.questions || []).length || !sheetQBase) return [];
  return t.questions.map((q, i)=> i).filter(i=> questionState(i) === 'dirty');
}
/* 押せる ボタンは「いま することが ある」ときだけ 出す。
   のこっている 答えの ところに ボタンが あると、
   何か しないと いけないように 見える。 */
function refreshQuestionSaveState(i){
  const btn = $('#sheetBody [data-save-q="' + i + '"]');
  if(!btn) return;
  const st = questionState(i);
  const box = btn.closest('.q-actions');
  const note = box && box.querySelector('.q-note');
  const done = box && box.querySelector('.q-done');
  btn.hidden = st !== 'dirty';
  if(note) note.hidden = st !== 'dirty';
  if(done) done.hidden = st !== 'saved';
}
function markQuestionSaved(i, value){
  if(!sheetQBase || !sheetQStored) return;
  sheetQBase[i] = value;
  sheetQStored[i] = !!value;
  refreshQuestionSaveState(i);
}
/* × や Esc で とじる ときだけ 聞く。「きろく」は 答えも まとめて
   保存するので、聞く 必要が ない。 */
function confirmLeaveSheet(){
  const rest = unsavedQuestions();
  if(rest.length){
    return confirm('ほぞんして いない 答え（しつもん ' + rest.map(i=> i + 1).join('・') + '）が あるよ。とじても いい？');
  }
  /* 答えの ほかにも、メモ・本の なまえ・きょうの きろくなど
     まだ のこして いない 書きかけが ある。まとめて 聞く。 */
  if(sheetInputsChanged()) return confirm('かきかけが あるよ。のこさずに とじても いい？');
  return true;
}

function openSheet(id, editBookId){
  const t = config.tasks.find(x=>x.id===id);
  if(!t) return;
  sheetTask = t;
  sheetAdultOrigin = isAdultTab(tab);
  const p = prog(t);

  if(isBook(t)){ openBookSheet(t, p, editBookId); return; }
  if(isFree(t)){ openFreeSheet(t); return; }

  let body = '';
  if(t.type === 'count'){
    sheetSel = p.done;
    body += `
    <div class="field">
      <span class="lab">${isSheetCount(t) ? '何' + esc(unitAdult(t.unit||'まい')) + '目までやった？'
        : wording('どこまで やった？', 'どこまで進んだ？')}</span>
      <p class="hint">${wording('やった ところを おしてね。そこまで ぜんぶ できたことに なるよ。',
        'やった所をおすと、そこまで全部できたことになるよ')}</p>
      <p class="sel-say" id="selSay">${selSayText(t, sheetSel)}</p>
      <div class="nums" id="nums">${numsHTML(t, sheetSel)}</div>
    </div>`;
  }
  else if(t.type === 'step'){
    sheetSteps = (t.steps||[]).map((_,i)=> !!(p.arr && p.arr[i]));
    body += `
    <div class="field">
      <span class="lab">${wording('できた ところを おしてね', 'できたらチェック')}</span>
      <div class="steps" id="steps">${stepsHTML(t, sheetSteps)}</div>
    </div>`;
  }
  else {
    sheetSel = p.done;
    sheetDailyToday = p.done;
    const max = 5;
    /* きょう まだ 1回も 記録が 無いなら、取り消す 対象が 無い。
       0 は「まちがえて 入れた のを 取り消す」ための ボタンなので、
       そのときは 出さず 1から 始める */
    const min = p.done > 0 ? 0 : 1;
    const more = p.done > max ? p.done : '';
    body += `
    <div class="field">
      <span class="lab">${wording('きょうは どのくらい できた？', '今日はどのくらい進んだ？')}</span>
      <p class="hint">${wording('1日の めあては', '1日の目当ては')} ${p.total}${esc(t.targetUnit||'')}だよ。</p>
      <div class="tally" id="tally">
        ${Array.from({length:max-min+1},(_,idx)=> min+idx).map(i=>
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
      <p class="hint">${wording('ぜんぶ おわったね！ できた ところを おしてね。',
        'できたらチェック')}</p>
      <div class="steps" id="wraps">${wrapsHTML(t, sheetWrap)}</div>
    </div>`;
  }

  // 観察の観点。count と step のどちらでも出す
  if((t.questions||[]).length){
    const row = questionAnswerRow(t);
    const savedAnswers = row.answers;
    sheetQBase = savedAnswers.slice();
    sheetQStored = row.stored.slice();
    sheetSavedAnswers = [];
    body += `<div class="field">
      <span class="lab">${wording('かんさつ してみよう', '観察してみよう')}</span>
      <p class="hint">${wording('わかるところだけで いいよ。答えごとに保存でき、次に開いたときも残るよ。',
        'わかるところから記録しよう')}</p>
      ${t.questions.map((q,i)=>`
        <div class="q">
          <p class="q-t"><span class="qn">${i+1}</span>${esc(q)}</p>
          <div class="mic-row">
            <textarea data-q="${i}" rows="2" placeholder="${wording('かいてみよう', '書いてみよう')}">${esc(savedAnswers[i] || '')}</textarea>
            ${micBtn('q'+i)}
          </div>
          <div class="q-actions">
            <span class="q-done"${row.kept[i] ? '' : ' hidden'}>✓ ほぞんずみ</span>
            <p class="q-note" hidden>ほぞんして いないよ</p>
            <button class="btn btn-sm q-save" data-save-q="${i}" type="button" hidden>この答えを ほぞん</button>
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
  body += recentLogsHTML(t);

  $('#sheetTitle').textContent = t.name;
  $('#sheetBody').innerHTML = body;
  $('#sheetBody').scrollTop = 0;
  showSheet();
  applyReadingDisplay($('#sheetWrap'));
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

  <div class="field book-entry-field book-title-entry">
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

  <div class="field book-entry-field">
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
      <span class="lab" style="margin-top:16px;display:block">かきうつす文（${learnedKanjiLabel()} かんじ）</span>
      <p class="hint">カードには この文を うつしてね。なおしても いいよ。</p>
      <textarea id="bkOut" rows="3">${esc(b ? (b.memoOut||'') : '')}</textarea>
      <p class="mic-note" id="bkOutNote"></p>
    </div>
  </div>`;

  $('#sheetTitle').textContent = t.name;
  $('#sheetBody').innerHTML = body;
  $('#sheetSave').textContent = 'できた！';
  $('#sheetBody').scrollTop = 0;
  showSheet();
  applyReadingDisplay($('#sheetWrap'));
}

/* ---------------------------------------------------------
   なんでもきろくシート（毎日の自由記述）
   --------------------------------------------------------- */
function openFreeSheet(t){
  $('#sheetTitle').textContent = t.name;
  /* 親が freeHint を決めているときは そのまま使う。既定を出すときだけ、
     選んだ学年にあわせて言い方を切りかえる（設定欄の例示は変えないので
     FREE_HINT_DEFAULT 自体はそのまま残す）。 */
  const freeHintDefault = t.freeHint || FREE_HINT_DEFAULT;
  const freeHint = t.freeHint ? freeHintDefault : wording(freeHintDefault, FREE_HINT_ADULT);
  $('#sheetBody').innerHTML = `
    <div class="field">
      <span class="lab">${esc(t.memoLabel || 'きょうは なにを した？')}</span>
      <p class="hint">${esc(freeHint)}</p>
      <div class="mic-row">
        <textarea id="freeMemo" rows="6" placeholder="${wording('かいてみよう', '書いてみよう')}"></textarea>
        ${micBtn('freeMemo')}
      </div>
      <p class="mic-note">${micNoteHTML()}</p>
    </div>
    ${recentLogsHTML(t)}`;
  $('#sheetSave').textContent = 'かけた！';
  $('#sheetBody').scrollTop = 0;
  showSheet();
  applyReadingDisplay($('#sheetWrap'));
}

/* メモ欄の直下に過去のメモを新しい順に並べる。上の質問欄（questionAnswerRow）は
   答えが1つだけ残るのに対し、ここは書くたびに積まれる。この形の違いを見せることで、
   ラベルの説明文を増やさずに2つの入力欄の性質の違いを伝える */
function recentLogsHTML(t){
  const logs = Array.isArray(state.logs) ? state.logs : [];
  /* 時刻が こわれている 記録も、メモは 出す。日付で ひくと NaN に なり、
     ならべかえ そのものが おかしく なるので、文字として くらべる。
     ISO の 文字列は 文字の じゅんばんが 時刻の じゅんばんと そろう。 */
  const rows = logs
    .filter(l => l && l.taskId === t.id && String(l.memo || '').trim())
    .slice()
    .sort((a,b)=> String(b.at || '').localeCompare(String(a.at || '')));
  if(!rows.length) return '';

  // 3000件までためられる記録を折りたたみの中まで全部レイアウトすると重いので、
  // 開かないと見えない側にも上限を設けて最悪ケースの負荷を抑える
  const FOLD_MAX = 50;
  const head = rows.slice(0, 3);
  const rest = rows.slice(3, FOLD_MAX);
  const over = rows.length > FOLD_MAX;

  const itemHTML = l => {
    const d = new Date(l.at);
    const valid = !isNaN(d.getTime());
    // 壊れた時刻でもメモそのものは隠さない。日時だけ出さずに残す
    return `
        <div class="today-item">
          ${valid ? `<span class="ti-time">${esc(fmtTime(d))}</span>` : ''}
          <div class="ti-body">
            ${valid ? `<div class="ti-date">${esc(fmtDate(d))}</div>` : ''}
            <div class="ti-memo"${valid ? '' : ' style="margin-top:0"'}>${esc(l.memo)}</div>
          </div>
        </div>`;
  };

  return `
    <div class="field">
      <span class="lab">これまでの きろく</span>
      <div class="paper today-list">${head.map(itemHTML).join('')}</div>
      ${rest.length ? `
      <details class="recent-more">
        <summary>もっと 見る</summary>
        <div class="paper today-list">${rest.map(itemHTML).join('')}</div>
        ${over ? `<p class="recent-over">ふるい きろくは『やったこと』で 見てね</p>` : ''}
      </details>` : ''}
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
  stamp(wording('かけたね！', 'できた'));
  setTimeout(()=> render({ keepScroll:true }), 60);
}

function starSay(n){
  return n === 3 ? wording('とても おすすめ', 'とてもおすすめ') : n === 2 ? 'おすすめ'
    : n === 1 ? 'ふつう' : wording('まだ えらんでいない', 'まだ選んでいない');
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

  /* 祝いの 判定に つかう「保存する 前の 姿」（saveSheet と 同じ 撮りかた） */
  const celebrateWas = celebrateBefore(t);
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
  const adultOrigin = sheetAdultOrigin;
  closeSheet();
  stamp(adultOrigin ? '修正が完了しました' : sheetBookId ? wording('なおしたよ', 'なおした')
    : (done ? wording('ぜんぶ よんだ！', '完了！') : wording('よめたね！', 'できた')),
    /* 訂正と 保護者からの 修正では 祝わない。冊数が 増えていないので
       celebrateLevel() も null を 返すが、意図を ここにも 残す */
    (adultOrigin || sheetBookId) ? null : celebrateLevel(t, celebrateWas));
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
    $('#bkCheckNote').textContent = 'ぜんぶ ' + learnedKanjiLabel() + ' かんじだったよ。そのまま カードに うつせるね。';
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
        : 'ぜんぶ ' + learnedKanjiLabel() + ' かんじだったよ。';
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
  if(!sel) return wording('まだ ひとつも やっていない', '記録なし');
  const label = countUsesCircle(t) ? maru(sel) : sel + (t.unit||'');
  return (sel >= (t.total|0))
    ? label + wording(' まで ぜんぶ できた！', ' まで全部できた')
    : label + wording(' まで できた', ' までできた');
}
function stepsHTML(t, arr){
  return (t.steps||[]).map((s,i)=>
    `<button class="step${arr[i]?' on':''}" data-i="${i}" type="button">
       <span class="box">✓</span><span>${esc(s)}</span>
     </button>`).join('');
}

/* しあげの2段階。段階式（step）と おなじ 見た目・おなじ そうさに する */
function wrapsHTML(t, arr){
  return wrapLabelsFull(t).map((s,i)=>
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

/* えらんだ 数が きょうの きろくより 減っている ときだけ、記録ボタンを
   「なおす」に する。0 に する ときは saveSheet 側で べつに 知らせるので、
   ここでは 文字を 変えるだけで よい */
function syncDailySaveLabel(){
  if(!sheetTask) return;
  const btn = $('#sheetSave');
  if(!btn) return;
  const more = $('#dailyMore');
  const n = dailyCountSelection(sheetSel, more && more.value);
  btn.textContent = n < sheetDailyToday ? 'なおす' : 'きろくする';
}

function closeSheet(){
  /* シートを隠す前に止める。iPad のキーボード音声入力は、入力欄が見えている
     うちに focus を外すことで確実に終了する。 */
  stopSR();
  $('#sheetWrap').hidden = true;
  document.body.classList.remove('sheet-open');
  document.body.style.overflow = '';
  sheetTask = null; sheetSel = null; sheetSteps = null; sheetWrap = null;
  sheetRating = 0; sheetBookId = null;
  sheetAdultOrigin = false;
  sheetQBase = null; sheetQStored = null;
  sheetSavedAnswers = [];
  sheetDailyToday = 0;
  sheetInputBase = null;
  $('#sheetSave').textContent = 'きろくする';
  /* シートのために 足した 履歴を かたづける。のこすと、あとで
     戻ったときに 何も 起きない 空ぶりの 1回が できてしまう。
     popstate から 閉じた ときは すでに 戻って いるので 何も しない。 */
  if(sheetNavPushed){ sheetNavPushed = false; history.back(); }
}

/* 何も 書きかわらなかった とき。ログを のこすと「きょう やったこと」に
   ならぶだけでなく、didSomethingToday() が 真に なって ミニコンテンツの
   解禁数まで 増える。何も していない 日に 増やさないため、記録は のこさず
   「そのまま」と 一言だけ 伝える。 */
function sheetUnchanged(progressChanged, answerChanges, memo){
  return !progressChanged && !answerChanges.length && !memo;
}

function saveSheet(){
  const t = sheetTask;
  if(!t) return;
  /* 保存を押したあとに iPad の認識結果が届くと、閉じたシートへ遅れて
     文字が入ったように見える。保存はその時点の文章を確定する操作なので、
     先にマイクを止める。 */
  stopSR();
  if(isBook(t)){ saveBookSheet(); return; }
  if(isFree(t)){ saveFreeSheet(); return; }
  /* 保存する前に 取る。順番を 入れかえないこと */
  /* 祝いの 判定に つかう「保存する 前の 姿」。しつもんの 答えも
     isDone に 効くので、saveQuestionAnswers() より 先に 撮る */
  const celebrateWas = celebrateBefore(t);
  const answerChanges = answerChangesForLog();
  if(!saveQuestionAnswers(true)) return;
  const p = prog(t);
  const memo = ($('#memo') && $('#memo').value.trim()) || '';
  const moreInput = $('#dailyMore');
  const dailySelection = dailyCountSelection(sheetSel, moreInput && moreInput.value);
  /* 「答えが 入っている」ではなく「この保存で 書きかわる」で 見る。
     直しに 来ただけで 何も 変えずに 押した ときに、空の記録を のこさない */
  const hasAnswer = answerChanges.length > 0;
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
  /* きょう まだ 記録が 無い まいにちの 課題では、0 の ボタンを 出していない。
     えらばずに メモだけ 書いて 押すと、えらんだ つもりの ない
     「やらなかった」が のこって しまうので、先に 数を えらんでもらう。 */
  if(t.type === 'daily' && !dailySelection && !sheetDailyToday){
    toast('どのくらい できたか えらんでね');
    return;
  }
  const now = new Date();
  let what = '';
  let ok = true;
  let dailyDecreased = false;
  /* 進みぐあいが 変わったか。変わっていないのに 答えだけ 直した ときは、
     「できた！」でも「そのまま」でもなく、答えを のこしたことを 伝える */
  let progressChanged = false;

  if(t.type === 'count'){
    const before = p.done;
    const after = clamp(sheetSel|0, 0, t.total|0);
    progPatch(t.id, { done: after });
    progressChanged = after !== before;
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
    /* だんかいが 前と 同じなら「なおした」ではない。答えだけを 直しに 来て
       きろく を 押すと、直していない だんかいまで「4/5 に なおした」と
       のこって いた（かず の 課題は もともと そのまま と 書いている） */
    const sameSteps = (t.steps||[]).every((s,i)=> !!sheetSteps[i] === !!before[i]);
    progPatch(t.id, { steps: sheetSteps.slice() });
    progressChanged = !sameSteps;
    what = added.length ? added.join('・') + ' が できた'
         : sameSteps ? 'すすみは そのまま'
         : (sheetSteps.filter(Boolean).length + '/' + (t.steps||[]).length + ' に なおした');
    ok = true;
  }
  else {
    const n = clamp(dailySelection, 0, 99);
    const days = Object.assign({}, (state.progress[t.id]||{}).days || {});
    progressChanged = n !== (Number(days[dayKey(now)]) || 0);
    days[dayKey(now)] = n;
    progPatch(t.id, { days });
    /* 0 は「できた」ではない。取り消したことが 記録に のこるようにする */
    what = n > 0 ? n + (t.targetUnit||'かい') + ' できた'
                 : 'きょうは やらなかったことに した';
    /* 0 まで もどす ときは 別の あんない（0 に もどしました）が 出るので、
       ここでは 0より 多く 残った まま 減らした ときだけ フラグを 立てる */
    dailyDecreased = n > 0 && n < p.done;
  }

  // さいごの しあげ。done / steps とは べつに のこす
  if(hasWrap(t) && sheetWrap){
    const added = WRAP_LABELS.filter((s,i)=> sheetWrap[i] && !p.wrap[i]);
    /* 外した ぶんも 保存される。変わっていないことに すると、記録に
       のこらないまま 印だけ 消えて しまう */
    const removed = WRAP_LABELS.some((s,i)=> !sheetWrap[i] && p.wrap[i]);
    progPatch(t.id, { wrap: sheetWrap.slice() });
    if(added.length){
      progressChanged = true;
      what = [what, added.join('・') + ' が できた'].filter(Boolean).join('　');
    }
    if(removed && !added.length){
      progressChanged = true;
      if(what === 'すすみは そのまま') what = wording('しあげを もどした', '仕上げを直した');
    }
  }

  /* かんさつの こたえは、**この保存で 書きかえた ぶんだけ** のせる。
     答えそのものは state.questionAnswers に のこって いて、シートを
     開けば いつでも 出る。記録は「その とき 何を したか」の 控えなので、
     直すたびに 全問を くり返すと、何を 直したのかが 分からなくなる。 */
  const ans = answerChanges
    .map(c => '・' + (t.questions[c.i] || '') + '\n　→ ' + c.text)
    .join('\n');

  /* 進みは 変えず、答えだけ のこした とき。「すすみは そのまま」だけでは、
     何を したのかが 記録から 読み取れない */
  const answersOnly = !progressChanged && answerChanges.length > 0;
  if(answersOnly) what = wording('しつもんの こたえを きろくした', '答えを記録した');

  const fullMemo = [ans, memo].filter(Boolean).join('\n');

  const unchanged = sheetUnchanged(progressChanged, answerChanges, memo);
  if(!unchanged){
    state.logs.push({
      id: 'l' + now.getTime() + Math.floor(Math.random()*1000),
      at: now.toISOString(), by: logBy(),
      taskId: t.id, name: t.name, what, memo: fullMemo
    });
    if(state.logs.length > 3000) state.logs = state.logs.slice(-3000);
  }
  saveSt();

  const after = prog(t);
  closeSheet();
  /* 取り消し（0 にもどした）ときに「できた！」の はんこは 出さない。
     押しまちがいを 直しに 来た人に、できたと 言わない。
     0までは 戻さず 数だけ 減らした ときも 同じ理由で はんこは 出さない */
  /* 何も 変わっていない ときは「できた！」でも「なおしました」でもない。
     ただし 黙って 閉じると 押せていないように 見えるので、一言だけ 出す */
  if(unchanged) toast(wording('そのままに しておいたよ', '変わりはありません'));
  else if((after.done | 0) === 0 && hadValue) toast('0 に もどしました');
  else if(dailyDecreased) toast('なおしました');
  /* 進みを 変えずに 答えだけ のこした ときに「できた！」と 出すと、
     宿題が 進んだと 読めてしまう。したことを そのまま 伝える */
  else if(answersOnly) stamp(wording('こたえを きろくしたよ', '答えを記録した'));
  else stamp(after.isDone ? wording('ぜんぶ できた！', '完了！') : wording('できた！', 'できた'),
             celebrateLevel(t, celebrateWas));
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
  return `<button class="mic" data-mic="${id}" type="button" aria-label="こえで 入れる" aria-pressed="false">🎤</button>`
    + `<span class="mic-status" data-mic-status="${id}" role="status" aria-live="polite" hidden></span>`;
}
function srStatusText(phase){
  const grade = typeof readingGrade === 'function' ? Number(readingGrade()) : 0;
  const adult = (typeof isAdultTab === 'function' && typeof tab !== 'undefined' && isAdultTab(tab)) || grade === 9;
  if(phase === 'listening'){
    if(adult) return '聞き取り中…';
    return grade >= 1 ? '聞きとり中…' : 'ききとり中…';
  }
  if(phase === 'checking'){
    if(adult) return '確認中…';
    return grade >= 1 ? 'かくにん中…' : 'かくにんちゅう…';
  }
  return '';
}
function setSRStatus(btn, phase){
  const status = btn && btn._srStatus;
  if(!status) return;
  const text = srStatusText(phase);
  status.textContent = text;
  status.hidden = !text;
}
function finishSR(session, btn){
  if(sr === session) sr = null;
  if(btn){
    btn.classList.remove('rec');
    btn.setAttribute('aria-pressed', 'false');
    setSRStatus(btn, '');
  }
}
function srErrorMessage(code){
  /* 許可を 押しそこねた のか、はじめから ことわった のかは、
     Web Speech API からは 区別できない（どちらも not-allowed）。
     分けずに、その場で できる 手だてを 両方 出す。
     開き直すのが いちばん はやいので 先に 書く */
  if(code === 'not-allowed' || code === 'service-not-allowed'){
    return 'マイクを使えません。アプリを開き直すか、SafariのWebサイト設定でマイクを「許可」にしてください。';
  }
  if(code === 'audio-capture') return 'マイクが見つかりません。端末のマイク設定を確認してください。';
  if(code === 'network') return '音声入力に接続できません。通信を確認して、もう一度おしてください。';
  if(code === 'no-speech') return 'こえが きこえなかったよ。マイクに近づいて、もう一度おしてね。';
  if(code === 'aborted') return '音声入力が中断されました。もう一度おすと再開できます。';
  return '音声入力を終えました。もう一度おすと再開できます。';
}
function startSR(btn, targetEl, selection){
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  stopSR();
  try{
    const session = new SR();
    let gotResult = false, hadError = false;
    session._manualStop = false;
    session._button = btn;
    const max = String(targetEl.value || '').length;
    const start = Math.max(0, Math.min(max, Number(selection && selection.start)));
    const end = Math.max(start, Math.min(max, Number(selection && selection.end)));
    session._insertAt = {
      start: Number.isFinite(start) ? start : max,
      end: Number.isFinite(end) ? end : max
    };
    session._handledResults = 0;
    sr = session;
    session.lang = 'ja-JP'; session.interimResults = false; session.continuous = false;
    session.onstart = ()=>{
      if(sr !== session) return;
      btn.classList.add('rec');
      btn.setAttribute('aria-pressed', 'true');
      setSRStatus(btn, 'listening');
    };
    session.onspeechend = ()=>{
      if(sr === session) setSRStatus(btn, 'checking');
    };
    session.onresult = e=>{
      if(sr !== session) return;
      setSRStatus(btn, 'checking');
      const first = Number.isInteger(e.resultIndex) ? e.resultIndex : session._handledResults;
      const txt = Array.from(e.results).slice(first).map(r=>r[0].transcript).join('');
      session._handledResults = Math.max(session._handledResults, e.results.length);
      gotResult = !!txt;
      if(txt){
        const at = session._insertAt || { start:targetEl.value.length, end:targetEl.value.length };
        const before = targetEl.value.slice(0, at.start);
        const after = targetEl.value.slice(at.end);
        const space = before && !/\s$/.test(before) ? ' ' : '';
        targetEl.value = before + space + txt + after;
        const caret = (before + space + txt).length;
        session._insertAt = { start:caret, end:caret };
        try{ targetEl.setSelectionRange(caret, caret); }catch(err){}
      }
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
    setSRStatus(btn, 'listening');
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
    /* stop() は結果の確定を待つ実装がある。見た目を黄色へ戻した時点で
       聞き取りも終えるため、stop の直後に abort も試す。iPad Safari は
       stop を先に呼ぶことで、abort だけでは残るマイク表示も消える。 */
    try{
      if(typeof active.stop === 'function') active.stop();
      if(typeof active.abort === 'function') active.abort();
    }catch(e){
      try{ if(typeof active.abort === 'function') active.abort(); }catch(err){}
    }
    finishSR(active, active._button);
  }
  $$('.mic.rec').forEach(b=>{ b.classList.remove('rec'); b.setAttribute('aria-pressed', 'false'); });
  /* iPadのキーボード側の音声入力は Web Speech API とは別物。
     入力欄のフォーカスを外すことで、保存・閉じる・画面移動でも終了させる。 */
  const editor = typeof document !== 'undefined' ? document.activeElement : null;
  if(editor && typeof editor.matches === 'function'
    && editor.matches('input, textarea, [contenteditable="true"]')
    && typeof editor.blur === 'function'){
    try{ editor.blur(); }catch(e){}
  }
}

/* ---------------------------------------------------------
   えがく
   --------------------------------------------------------- */
/* スクロールするのは #scroll の中だけ。ページ自体は 動かさない。
   古い作りの画面でも こわれないよう、見つからなければ ページに もどす */
function scrollBox(){ return $('#scroll') || document.scrollingElement || document.documentElement; }

/* 上帯の題名は おうちで 決められる（既定は「〈名前〉の夏休みの宿題」）。
   帯を 2行に すると 画面が せまく なるため 1行のままにするが、名前が
   4文字 入るだけで 320px では 切れていた。進み具合の一言（paceVerdictSizeClass）
   と 同じ手で、長い題名だけ 小さくして 出しきる。
   下限は 14px（style.css）。それより 小さいと 隣の 日づけ（13px）と 並んで
   見出しに 見えないので、そこから先は … で 切る。 */
function appTitleSizeClass(title, taken){
  const width = Array.from(String(title || '')).reduce((n, ch) =>
    n + (ch === ' ' ? .35 : '！「」（）'.includes(ch) ? .55 : 1), 0);
  /* 一覧の写真の ボタンが 出ている ぶんだけ 場所が せまい。同じ 題名でも
     切れやすく なるので、小さくする 目安を 2文字ぶん 早める */
  return width + (taken || 0) > 10 ? ' topband-title--long' : '';
}

/* keepScroll: 今の位置のまま描き直す。タブを変えたときだけ先頭に戻す */
function render(opts){
  /* 描き直しで入力欄が消える前に、アプリ側・キーボード側の音声入力を止める。 */
  stopSR();
  const keepScroll = !!(opts && opts.keepScroll);
  if(tab !== 'config') configBase = null;
  const y = scrollBox().scrollTop;
  /* 同期の到着などで画面を描き直しても、保護者が入力途中の内容を
     消さない。保存前のメッセージ、サマリー、チェックの状態も含めて
     同じ id の欄へ戻す。 */
  /* 「元に戻す」など、値をプログラムで確定して描き直すときは、直前の
     入力欄の表示を控えとして上書きしない。とくに select は古い選択が
     見た目だけ残り、戻せていないように見えてしまう。 */
  const formDraft = opts && opts.discardFormDraft ? {} : captureFormDraft();
  const openDetails = captureOpenDetails();

  const shownTitle = TEST_MODE && (!getLocal(K_ONBOARD) || DEBUG_PARENT) ? 'おためし用の設定' : config.title;
  $('#appTitle').textContent = shownTitle;
  $('#appTitle').className = 'topband-title' + appTitleSizeClass(shownTitle, posterShown() ? 2 : 0);
  renderKinenbiButton(new Date());
  renderPosterButton();
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
  if(isAdultTab(tab)) buildAdultSectionToc();
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
let pendingJumpFocus = false;
function jumpTo(sel, moveFocus=false){
  pendingJump = sel;
  pendingJumpFocus = moveFocus;
}
function jumpToSection(){
  if(!pendingJump) return;
  const sel = pendingJump;
  const moveFocus = pendingJumpFocus;
  pendingJump = '';
  pendingJumpFocus = false;
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
      if(++stable >= 2){
        if(moveFocus && typeof el.focus === 'function') el.focus({ preventScroll:true });
        return;
      }
    }else{
      stable = 0;
      box.scrollTop = Math.max(0, box.scrollTop + gap);
    }
    if(++tries < 10) setTimeout(settle, 60);
    else if(moveFocus && typeof el.focus === 'function') el.focus({ preventScroll:true });
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
  /* この課題に 基準（変える前の 控え）が あれば、欄ごとに 見くらべて
     「変更しました」と「元に戻す」を 出す。基準が 無い＝まだ 何も
     変えていない課題なら、何も 比べず 何も 出さない（平常時は 何も足さない） */
  const base = (configTaskBase && configTaskBase.id === t.id && configTaskNewId !== t.id)
    ? configTaskBase.snap : null;
  const mark = name => {
    if(!base) return '';
    const changed = TASK_FIELD_KEYS[name].some(k => JSON.stringify(base[k]) !== JSON.stringify(t[k]));
    /* 「変更しました」と 書かずに ✓ だけを 置く。記録シートの
       「✓ ほぞんずみ」と 同じ 意味の 記号なので、片方で 覚えたことが
       そのまま 通じる。文字を 減らしても 分かることは 減らない */
    return changed ? ` <em class="set-changed" aria-label="変更しました">✓</em><button class="set-revert" data-revert="${name}" type="button">元に戻す</button>` : '';
  };
  /* 値が 短い 欄は「見出し 左・操作 右」の 1行に する。見出しを 上に 置く
     作りだと、1列に なる 携帯で 1欄が 約80px を 使う。数字 1つの ために
     画面が 流れるので、短い 値だけ 横に 並べる。
     選択肢の 字が 長い 欄（進め方・記録方法・単位のプリセット）は そのまま */
  const rowField = (label, name, control) => `
    <label class="set-field set-field--row"><span class="set-field-lab">${label}${mark(name)}</span>${control}</label>`;
  /* 必須／任意は 2つしか 無いので、開いて 選ぶ 一覧より、
     いまどちらなのかが 見えている ほうが 早い。作りは テーマ選び
     （.theme-choice）と 同じ、見えない ラジオ ＋ :has(input:checked）。
     ボタンに しないのは、左右キーと 読み上げの「2つのうち1つめ」を 残すため */
  const segOpt = (v,label) => `<label class="set-seg-opt"><input type="radio" name="taskgroup-${esc(t.id)}" value="${v}" data-f="group"${t.group===v?' checked':''}><span>${label}</span></label>`;
  const groupField = kind === 'daily' ? '' : `
    <div class="set-field set-field--row">
      <span class="set-field-lab"><b id="taskgrouplab-${esc(t.id)}">表示する場所</b>${mark('group')}</span>
      <span class="set-seg" role="radiogroup" aria-labelledby="taskgrouplab-${esc(t.id)}">${segOpt('must','必須')}${segOpt('option','任意')}</span>
    </div>`;
  /* 「進め方」で 読書も 選べる。読書に しても type は 'count' の ままで、
     recordStyle が 'book' に なる（isBook の 見かた）。欄の 値としては
     3つ目の 選択肢に 見せる */
  const typeValue = kind === 'book' ? 'book' : t.type;
  const typeField = `
    <label class="set-field"><span>進め方${mark('type')}</span><select data-f="type">
      ${opt('count',typeValue,'回数・ページで進める')}${opt('step',typeValue,'段階をクリア')}${opt('book',typeValue,'読書（1冊ずつ記録）')}
    </select></label>`;

  let fields = '';
  if(kind === 'book'){
    fields = `${groupField}${typeField}
      ${rowField('目標の冊数','total',`<span class="set-num-row"><input class="set-num" type="number" data-f="total" min="1" max="200" value="${t.total|0}"><b>冊</b></span>`)}
      <fieldset class="set-field set-field--wide set-checks"><legend>本ごとに残す項目${mark('bookFields')}</legend>
        <label><input type="checkbox" data-bf="author"${bf.author?' checked':''}> 作者</label>
        <label><input type="checkbox" data-bf="publisher"${bf.publisher?' checked':''}> 出版社</label>
        <label><input type="checkbox" data-bf="rating"${bf.rating?' checked':''}> おすすめ度</label>
      </fieldset>
      <p class="set-help set-field--wide">本の名前・読んだ日・一言を1冊ずつ残します。</p>`;
  }else if(kind === 'daily'){
    fields = `
      <label class="set-field"><span>記録方法${mark('recordStyle')}</span><select data-f="recordStyle">
        ${opt('',t.recordStyle||'','数で記録')}${opt('free',t.recordStyle||'','文章で記録')}
      </select></label>
      ${!isFree(t) ? `
        ${rowField('1日の目標','target',`<input class="set-num" type="number" data-f="target" min="1" max="999" value="${t.target|0}">`)}
        <label class="set-field"><span>単位${mark('targetUnitPreset')}</span><select data-f="targetUnitPreset">
          ${DAILY_UNIT_PRESETS.map(u=>opt(u,unitMode,u)).join('')}${opt('custom',unitMode,'そのほか（自由）')}
        </select></label>
        ${unitMode==='custom' ? rowField('単位を入力','targetUnitCustom',`<input class="set-txt-s" type="text" data-f="targetUnitCustom" maxlength="8" value="${esc(t.targetUnit||'')}">`) : ''}
      ` : `
        <label class="set-field set-field--wide"><span>子どもへの呼びかけ${mark('freeHint')}</span>
          <input type="text" data-f="freeHint" value="${esc(t.freeHint||'')}" placeholder="${esc(FREE_HINT_DEFAULT)}"></label>`}
      <label class="set-field set-field--wide"><span>${isFree(t)?'見出し':'メモ欄の見出し'}${mark('memoLabel')}</span>
        <input type="text" data-f="memoLabel" value="${esc(t.memoLabel||'')}" placeholder="やったことを書く"></label>`;
  }else{
    fields = `${groupField}${typeField}
      ${t.type==='count' ? `
        ${rowField('合計','total',`<input class="set-num" type="number" data-f="total" min="1" max="200" value="${t.total|0}">`)}
        ${rowField('単位','unit',`<input class="set-txt-s" type="text" data-f="unit" maxlength="8" value="${esc(t.unit||'')}">`)}
        <label class="set-field set-check"><input type="checkbox" data-f="numbered"${t.numbered?' checked':''}> 次の番号を①②で表示${mark('numbered')}</label>` : `
        <label class="set-field set-field--wide"><span>段階（1行に1つ）${mark('steps')}</span>
          <textarea data-f="steps" rows="${Math.max(3,(t.steps||[]).length)}">${esc((t.steps||[]).join('\n'))}</textarea></label>`}
      <label class="set-field set-field--wide set-check"><input type="checkbox" data-f="wrapUp"${t.wrapUp?' checked':''}> 「マルつけ・なおし」の項目を表示${mark('wrapUp')}</label>
      ${t.wrapUp ? `<label class="set-field"><span>マルつけするのは${mark('wrapBy')}</span><select data-f="wrapBy">
        ${opt('adult',wrapMarkerBy(t),'おとな')}${opt('child',wrapMarkerBy(t),'こども')}
      </select></label>` : ''}
      <label class="set-field set-field--wide"><span>記録するときの質問（任意）${mark('questions')}</span>
        <textarea data-f="questions" rows="3" placeholder="葉っぱの形や色は？">${esc((t.questions||[]).join('\n'))}</textarea></label>
      <label class="set-field set-field--wide"><span>メモ欄の見出し${mark('memoLabel')}</span>
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
      <label class="set-field set-field--wide"><span>項目の名前${mark('name')}</span><input type="text" data-f="name" maxlength="60" value="${esc(t.name)}"></label>
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
   案内は見出しの i へ送り、紙の中は
   （毎日の項目だけ 表示チェック）→ 一覧 → 追加ボタン、の順。

   追加ボタンを 紙の中の いちばん下に 置くのは、押したとき どの欄に
   足されるのかを ボタンの 居場所そのもので 示すため。
   前は「必須の宿題」の 紙の外に 1つだけ 出ていて、しかも 押すと
   「任意の宿題」に 足されていた。見えている場所と 足される場所が
   ちがうと、どう直せばよいか 画面から 読みとれない。 */
function taskSectionHTML(o){
  return `
  <section class="sec config-sec"${adultSectionHelpAttr(o.note)}>
    <div class="sec-head"><h2>${esc(o.title)}</h2><span class="sec-note">${o.rows.length}件</span></div>
    <div class="paper task-settings">
      ${o.head || ''}
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

/* ---------------------------------------------------------
   サンプルの宿題が入ったままのときの案内

   新しい端末は freshConfig() から始まるので、宿題は必ず data.js の
   サンプル一式が入っている。初期設定にサンプルを消す手順は無い。
   そのため「知らない宿題が並んでいる」状態で使い始める人がいる。

   判定は **課題の id の集合が DEFAULT_CONFIG と同じか** で行う。
   名前で見ないのは、サンプルの名前を書きかえて使うのがふつうの
   使い方だから（書きかえた時点で「もう自分のもの」なので、
   id が同じでも案内は出しつづける。閉じるボタンで消せる）。
   --------------------------------------------------------- */
function usingSampleTasks(){
  const now = (config.tasks || []).map(t=>t.id).sort();
  const def = (DEFAULT_CONFIG.tasks || []).map(t=>t.id).sort();
  if(!now.length || now.length !== def.length) return false;
  return now.every((id,i)=> id === def[i]);
}
/* 保護者ページ。消すのは この端末だけの しるしでは なく 実データなので、
   confirm を 通してから 行う */
function sampleResetNoticeHTML(){
  if(!usingSampleTasks()) return '';
  if(getLocal(K_SAMPLE_PARENT) === 'done') return '';
  return `
  <aside class="paper sample-notice" role="status">
    <div class="sample-notice-body">
      <h2>サンプルの宿題が入っています</h2>
      <p>いま並んでいるのは、最初から入っているサンプルです。実際の宿題に入れかえるなら、リセットしてから「宿題」ページで登録してください。名前や数を書きかえて、そのまま使うこともできます。</p>
      <p class="sample-notice-warn">リセットすると、入力したデータ（進捗・記録・本の記録）もすべて削除されます。</p>
    </div>
    <div class="sample-notice-actions">
      <button class="btn btn-sm btn-danger" id="sampleResetBtn" type="button">リセット（消去）</button>
      <button class="btn btn-sm" id="sampleKeepBtn" type="button">このまま使う</button>
    </div>
  </aside>`;
}
/* 子ども画面。子どもは 消せない（消す入口は 保護者ページだけ）ので、
   OK で 閉じるだけ。文は かな変換の 対象に する（data-no-reading を 付けない）。
   読むのが 子ども本人だから */
function sampleChildNoticeHTML(){
  if(!usingSampleTasks()) return '';
  if(getLocal(K_SAMPLE_CHILD) === 'done') return '';
  return `
  <section class="sec sample-child-notice">
    <div class="paper sample-child-body">
      <h2>これは おためしの しゅくだいです</h2>
      <p>じぶんの しゅくだいに 入れかえるときは、おうちの人に 「ほごしゃ用ページ」から けしてもらってね。なまえを かきかえて、そのまま つかうことも できるよ。</p>
      <div class="sample-child-actions">
        <button class="btn btn-go btn-wide" id="sampleChildOk" type="button">OK</button>
      </div>
    </div>
  </section>`;
}
/* サンプルを 消す。課題（config）と 記録（state）の 両方を 消す。

   記録側は resetState() を 通すこと。中を 空にするだけだと、
   同じグループの ほかの端末が 持っている 古い記録が あとから 送り返されて
   復活する。resetState() は 世代番号（resetAt）を 押すので、
   すべての端末へ「この時刻より前は 無効」と つたわる。 */
function resetSampleTasks(){
  if(!confirm('サンプルの宿題をすべて消して、最初からやり直しますか？\n\n入力したデータ（進捗・記録・本の記録）も、共有しているすべての端末から削除されます。\nこの操作は取り消せません。')) return;
  config.tasks = [];
  config.showDaily = false;
  saveCfg();
  resetSharedState(Date.now());
  saveSt();
  setLocal(K_SAMPLE_PARENT, 'done');
  render();
  toast('消しました。「宿題」ページから登録してください');
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
function adultHeadHTML(current, lead, extra){
  const page = ADULT_PAGES.find(p=>p.tab === current) || ADULT_PAGES[0];
  return `
  ${adultNavHTML(current)}
  <div class="paper parent-head config-head"><div><div class="parent-head-title"><h2>${esc(page.title)}</h2>${extra || ''}</div>${lead ? `<p>${esc(lead)}</p>` : ''}</div>
    ${lead ? '<span class="autosave" aria-live="polite">自動保存</span>' : ''}</div>
  ${adultSectionNavHTML()}`;
}

/* 保護者向けの画面では、実際に描かれた節見出しだけを目次にする。
   条件で出たり消えたりする案内や共有欄を、別の一覧として保ち続けないため。 */
function adultSectionNavHTML(){
  return `<nav class="adult-section-toc" id="adultPageToc" aria-label="このページの目次" hidden></nav>`;
}
function openAdultSectionHelp(button){
  const dialog = $('#adultSectionHelpDialog');
  const title = $('#adultSectionHelpTitle');
  const body = $('#adultSectionHelpBody');
  if(!dialog || !title || !body || !button) return;
  title.textContent = button.dataset.sectionTitle || '項目の説明';
  body.textContent = button.dataset.sectionHelp || '';
  if(typeof dialog.showModal === 'function') dialog.showModal(); else dialog.setAttribute('open', '');
}
function closeAdultSectionHelp(){
  const dialog = $('#adultSectionHelpDialog');
  if(!dialog || !dialog.open) return;
  if(typeof dialog.close === 'function') dialog.close(); else dialog.removeAttribute('open');
}
function buildAdultSectionToc(){
  const toc = $('.adult-section-toc');
  if(!toc) return;
  const headings = $$('.sec-head > h2', $('#view'));
  headings.forEach((heading, i)=>{
    if(!heading.id) heading.id = 'adult-section-heading-' + (i + 1);
    heading.classList.add('adult-section-toc-target');
    const section = heading.closest('.sec');
    const head = heading.parentElement;
    const help = section && section.dataset.adultSectionHelp;
    if(help && head && !$('.adult-section-head-help', head)){
      head.classList.add('has-help');
      const button = document.createElement('button');
      button.className = 'adult-section-head-help';
      button.type = 'button';
      button.title = '説明を見る';
      button.setAttribute('aria-label', heading.textContent + 'の説明を見る');
      button.setAttribute('aria-haspopup', 'dialog');
      button.setAttribute('aria-controls', 'adultSectionHelpDialog');
      button.dataset.adultSectionHelpButton = '';
      button.dataset.sectionTitle = heading.textContent;
      button.dataset.sectionHelp = help;
      button.innerHTML = '<span class="adult-section-head-info" aria-hidden="true">i</span>';
      head.appendChild(button);
    }
  });
  if(headings.length < 2) return;
  toc.innerHTML = `<details class="adult-section-toc-disclosure" data-details-key="adultSectionToc:${esc(tab)}"><summary><span>このページの目次</span><small>全${headings.length}項目</small><i aria-hidden="true"></i></summary>
    <div class="adult-section-toc-links">${headings.map(heading =>
      `<button type="button" data-adult-section-target="${esc(heading.id)}">${esc(heading.textContent)}</button>`).join('')}</div></details>`;
  toc.hidden = false;
  const disclosure = $('.adult-section-toc-disclosure', toc);
  const summary = $('summary', toc);
  const returnToToc = e=>{
    e.preventDefault();
    disclosure.open = true;
    toc.scrollIntoView({ block:'start' });
    summary.focus({ preventScroll:true });
  };
  /* 戻り口は内容の紙の末尾に常に置く。目次から移動した時だけ出すと
     紙の高さが変わるため、44px の操作面を最初からレイアウトに含める。 */
  headings.forEach(heading=>{
    const head = heading.parentElement;
    const section = heading.closest('.sec');
    if(!head || head.tagName === 'SUMMARY' || !section) return;
    const surface = Array.from(section.children).find(el=>el.classList && el.classList.contains('paper'));
    if(!surface) return;
    surface.classList.add('adult-section-return-surface');
    let actions = $('.adult-section-tools', surface);
    if(!actions){
      const contentLast = surface.lastElementChild;
      if(contentLast) contentLast.classList.add('adult-section-content-last');
      actions = document.createElement('div');
      actions.className = 'adult-section-tools';
      surface.appendChild(actions);
    }
    const back = document.createElement('button');
    back.type = 'button';
    back.className = 'adult-section-tool adult-section-back';
    back.setAttribute('aria-label', 'このページの目次へ戻る');
    back.title = '目次へ戻る';
    back.innerHTML = '<span aria-hidden="true">▲</span>';
    back.addEventListener('click', returnToToc);
    actions.appendChild(back);
  });
  $$('.adult-section-toc-links button', toc).forEach(link=>link.addEventListener('click', e=>{
    const target = document.getElementById(link.dataset.adultSectionTarget);
    if(!target) return;
    /* URL の # は 画面の 切りかえに 使っている。見出しの id を そこへ
       入れると routeFromHash() が 知らない 名前として 子ども画面に
       落とすので、戻る・再読みこみ・ホーム画面から 開き直すと 保護者が
       子ども画面へ 飛ばされる。だから # は さわらず、動かすだけに する。 */
    e.preventDefault();
    $$('.adult-section-toc-links button', toc).forEach(a=>a.removeAttribute('aria-current'));
    link.setAttribute('aria-current', 'location');
    disclosure.open = false;
    const section = target.closest('.sec');
    const surface = section && Array.from(section.children).find(el=>el.classList && el.classList.contains('paper'));
    if(surface && surface.tagName === 'DETAILS') surface.open = true;
    target.scrollIntoView({ block:'start' });
    /* 既定の移動なら 見出しへ 移る 読み上げの 位置を、自分で 移す */
    target.setAttribute('tabindex', '-1');
    target.focus({ preventScroll:true });
  }));
}

/* 宿題そのものを決めるページ。
   「必須」「任意」は 独立した 欄では なく、課題ごとの group。
   ならべかえの まとまり（taskOrderBucket）も group 単位なので、
   画面も 分けた ほうが 実際の 動きと そろう。

   **読書の記録も 必須か 任意の どちらかに 入れる。** 子ども画面も
   進捗も お祝いも もともと group で 見ている（viewHome / overall /
   celebrateTargets）ので、読書だけ 別の 箱に 置くと、この 画面だけが
   実際の 動きと ちがう ことに なる。読書に するかどうかは、
   課題の 中の「進め方」で 選ぶ。 */
function viewTasks(){
  const rows = config.tasks.map((t,i)=>({t,i}));
  const must   = rows.filter(({t})=>taskKind(t)!=='daily' && t.group === 'must');
  const option = rows.filter(({t})=>taskKind(t)!=='daily' && t.group !== 'must');
  const daily  = rows.filter(({t})=>taskKind(t)==='daily');
  /* 「子ども画面に表示する」は 毎日の項目 だけの もの。
     ほかの3つには 対応する 切りかえが 無いので、この欄にだけ 足す */
  const dailySwitch = `<label class="daily-switch daily-switch--standalone"><input type="checkbox" id="cfgShowDaily"${config.showDaily?' checked':''}>
        <span><strong>子ども画面に表示する</strong></span></label>`;
  return `
  ${adultHeadHTML('tasks', '変更はすぐに保存されます。')}

  ${posterSectionHTML()}

  ${taskSectionHTML({
    title:'必須の宿題', rows:must, editorId:'mustTaskEditor',
    note:'子ども画面の「かならず やる」に出ます。「表示する場所」を変えると、下の「任意の宿題」へ移ります。読書の記録も、項目の中の「進め方」で選べます。',
    empty:'まだ項目はありません。', addId:'addMustTask', addLabel:'必須の宿題を追加' })}

  ${taskSectionHTML({
    title:'任意の宿題', rows:option, editorId:'optionTaskEditor',
    note:'子ども画面の「つぎに やる」に出ます。読書の記録も、項目の中の「進め方」で選べます。',
    empty:'まだ項目はありません。', addId:'addOptionTask', addLabel:'任意の宿題を追加' })}

  ${taskSectionHTML({
    title:'毎日の項目', rows:daily, editorId:'dailyTaskEditor', head:dailySwitch,
    note:'子ども画面の「まいにち」に表示する、日ごとの項目です。学習アプリ・音読・お手伝い・日記やメモなどに使えます。「子ども画面に表示する」のチェックで切り替えます。',
    empty:'毎日の項目はまだありません。', addId:'addDailyTask', addLabel:'毎日の項目を追加' })}

  ${creditHTML()}
  `;
}

/* 期間・目標日の呼び名。ふだんの家庭は さわらないので たたんで おく。
   `data-details-key` を 付けないと detailsKey() が 見出しの 文字を 鍵に して、
   同じ 文の 折りたたみが 巻きぞえで 開く */
function labelSettingsHTML(mark){
  const row = (id, key, label)=> `
      <div class="set-row"><label class="lab" for="${id}">${label}${mark(key)}</label>
        <input type="text" id="${id}" maxlength="${LABEL_MAX}" value="${esc(config[key] == null ? '' : config[key])}" placeholder="${esc(LABEL_DEFAULTS[key])}" aria-describedby="displayWordsNote">
      </div>`;
  return `
    <details class="set-advanced set-words" data-details-key="displayWords">
      <summary>「夏休み」以外の名称で使う</summary>
      <div class="set-advanced-body">
        <p class="set-note" id="displayWordsNote">冬休み・学期末・発表会・入試などにも使えます。保護者ページは漢字、子ども画面はよみを表示します。よみは自動で作らないので、手で入れてください。空にすると、呼び名は既定に戻り、よみは漢字のまま表示します。</p>
        ${row('cfgPeriodLabel', 'periodLabel', '期間の呼び名')}
        ${row('cfgPeriodLabelKana', 'periodLabelKana', '期間のよみ')}
        ${row('cfgDeadlineLabel', 'deadlineLabel', '目標日の呼び名')}
        ${row('cfgDeadlineLabelKana', 'deadlineLabelKana', '目標日のよみ')}
      </div>
    </details>`;
}

function viewConfig(){
  if(!configBase) configBase = deepCopy(config);
  const mark = name => {
    const changed = CONFIG_FIELD_KEYS[name].some(k =>
      JSON.stringify(configBase[k]) !== JSON.stringify(config[k])
    );
    return changed ? ` <em class="set-changed" aria-label="変更しました">✓</em><button class="set-revert" data-config-revert="${name}" type="button">元に戻す</button>` : '';
  };
  const openShareSettings = openSyncDetails;
  openSyncDetails = false;
  return `
  ${adultHeadHTML('config', '変更はすぐに保存されます。')}

  <section class="sec config-sec"${adultSectionHelpAttr(
    '子どもの名前・読める漢字・色とデザインを設定します。変更は共有中の子ども端末にも反映されます。')}><div class="sec-head"><h2>名前と画面の設定</h2></div><div class="paper">
    <div class="set-row"><label class="lab" for="cfgChildName">子どもの名前（任意・グループで共有）${mark('childName')}</label><input type="text" id="cfgChildName" maxlength="30" value="${esc(config.childName||getLocal(K_NAME)||'')}"></div>
    <div class="set-row"><label class="lab" for="cfgReadingGrade">読める漢字${mark('readingGrade')}</label><select id="cfgReadingGrade">${readingOptions(readingGrade())}</select></div>
    <fieldset class="theme-picker"><legend>色とデザイン（グループで共有）${mark('theme')}</legend><div class="theme-grid">${themeChoicesHTML()}</div></fieldset>
  </div></section>

  <section class="sec config-sec"${adultSectionHelpAttr(
    'アプリのタイトルと期間・目標日を設定します。日付は残り時間と完了予測の計算に使います。「夏休み」以外の名称で使う欄を開くと、冬休みや発表会などの呼び名に変えられます。')}><div class="sec-head"><h2>基本設定</h2></div><div class="paper">
    <div class="set-row"><label class="lab" for="cfgTitle">タイトル${mark('title')}</label><input type="text" id="cfgTitle" value="${esc(config.title)}"></div>
    <div class="set-row"><label class="lab" for="cfgStart">開始日${mark('startAt')}</label><input type="datetime-local" id="cfgStart" value="${esc(config.startAt)}"></div>
    <div class="set-row"><label class="lab" for="cfgEnd">終了日${mark('endAt')}</label><input type="datetime-local" id="cfgEnd" value="${esc(config.endAt)}"></div>
    ${labelSettingsHTML(mark)}
  </div></section>

  ${syncSectionHTML({ openDetails:openShareSettings })}

  <section class="sec config-sec"${adultSectionHelpAttr(
    '配信版を確認・更新します。共有する端末はすべて同じ版にそろえてください。iPadで古い表示が残るときも、ここから読み直せます。記録は消えません。')}><div class="sec-head"><h2>アプリ情報</h2>
    <span class="sec-note">v${esc(RELEASE_VERSION)}</span></div>
    <div class="paper">
      <p class="set-note app-version-line">この端末：<b>v${esc(RELEASE_VERSION)}</b>（配信 ${appVersionHTML(APP_VER)}）</p>
      ${newVersionAvailable ? `<p class="set-note" id="appUpdateNote">あたらしい版が あります</p>` : ''}
      ${/* 更新は 1つだけの 操作なので 全幅。読みものの 2つは 対なので 左右に ならべる。
            狭い 画面の 既定は 1列（style.css の @media max-width:560px）なので、
            そろえる 側に --pair を 足して 上書きする */''}
      <div class="set-actions app-info-actions set-actions--pair">
        <button class="btn btn-sm set-actions-full" id="appUpdate" type="button">最新に更新する</button>
        <a class="btn btn-sm btn-ghost" href="start/getting-started.html" target="_blank" rel="noopener"
          aria-label="使い方を新しいタブで開く">使い方</a>
        <a class="btn btn-sm btn-ghost" href="start/updates.html" target="_blank" rel="noopener"
          aria-label="更新履歴を新しいタブで開く">更新履歴</a>
      </div>
    </div>
  </section>

  <section class="sec config-sec" id="dataManagementSection"${adultSectionHelpAttr(
    '「やったこと」の1件削除をこの端末で有効にできます。バックアップの書き出し・読み込みと、宿題・記録の一括削除も行えます。')}><div class="sec-head"><h2>データ管理</h2></div>
    <div class="paper data-management-paper">
      <label class="data-management-toggle" for="allowLogDelete">
        <span><b>「やったこと」を1件ずつ削除</b><small>進捗の数字は変えず、記録だけを削除できるようにします。</small></span>
        <input type="checkbox" id="allowLogDelete"${logDeleteAllowed() ? ' checked' : ''}>
      </label>
      ${logDeleteAllowed() && getLocal(K_ROLE) !== 'parent'
        ? '<p class="set-note dev-warn"><b>この端末は「保護者の端末」に設定されていません。</b>「ほかの端末と共有」→「端末と表示の設定」→「この端末は」で選択してください。</p>'
        : ''}
      <div class="data-management-row">
        <div class="data-management-copy"><b>バックアップ</b><small>データをファイルへ書き出すか、保存したファイルを読み込みます。</small></div>
        <div class="set-actions set-actions--pair"><button class="btn btn-sm" id="expBtn" type="button">書き出す</button><button class="btn btn-sm" id="impBtn" type="button">読み込む</button><input type="file" id="impFile" accept="application/json,.json" hidden></div>
      </div>
      <div class="data-danger-zone">
        <div class="data-management-copy"><b>一括削除</b><small>必要なら先にバックアップを書き出してください。</small></div>
        <div class="set-actions"><button class="btn btn-sm btn-danger" id="resetCfg" type="button">宿題の項目をすべて消す</button><button class="btn btn-sm btn-danger" id="resetAll" type="button">記録をすべて削除</button></div>
      </div>
    </div>
  </section>

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
  if(isAdultTab(tab) || tab === 'stats' || tab === 'welcome') return;
  /* 漢字レベルは現在の config を正とする。K_READING は旧版との互換用なので、
     ここで存在を条件にすると共有設定で小1・小2へ変えた直後のダイアログだけ
     かな化されないことがある。 */
  if(grade === 9 || typeof convertForTranscription !== 'function') return;
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
   全ひらがな設定では曜日の括弧を「げつ」など、日付を「がつ」に先に確定する。
   小学1年生以上では「月」「日」が既習なので、日付の漢字をそのまま残す。 */
function readingContextText(body, grade){
  let text = String(body || '');
  if(Number(grade) === 0){
    text = text.replace(/（([日月火水木金土])）/g,
      (all, day)=>'（' + WD_READING[day] + '）');
    /* 「日」が つづかない ときも、数字の あとの 月は「がつ」。
       カレンダーの 見出し（2026年 8月）が「つき」に なっていた */
    text = text.replace(/(\d{1,2})月/g, '$1がつ');
  }
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
  bindInviteScanButtons(form);
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
        if(readingInput && READING_GRADE_OPTIONS.includes(remoteGrade)) readingInput.value = String(remoteGrade);
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
  start.addEventListener('click', async ()=>{
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
        setLocal(K_WELCOME_THEME, JSON.stringify({ house:await codeFingerprint(code), theme:chosenTheme }));
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
        hasGrade: READING_GRADE_OPTIONS.includes(grade) && grade !== baseGrade,
        readingGrade: grade
      };
      if(prefs.hasName || prefs.hasGrade) setLocal(K_WELCOME_JOIN, JSON.stringify(prefs));
      else try{ localStorage.removeItem(K_WELCOME_JOIN); }catch(e){}
    }else saveCfg();
    if(sharing && !TEST_MODE && S && S.configured()){
      if(typeof S.forgetRevokedCode === 'function') S.forgetRevokedCode();
      await forgetConfigStampForNewHousehold(code);
      await rememberChosenCode(code);
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
        navigateTo('settings');
        if(config.parentMessage.enabled) toast('保護者ページに メッセージ欄を 用意しました');
      }));
      form.scrollIntoView({ behavior:'smooth', block:'nearest' });
      return;
    }
    navigateTo(role === 'parent' ? 'settings' : 'home');
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
    navigateTo('config', { jump:'#syncSection' });
  };
}
/* 大人向け3ページに共通の帯。settings 以外でも 子ども画面へ 行けるように、
   render() から どのページでも 呼ぶ */
function bindAdultNav(){
  /* ホーム画面アプリは、追加した瞬間の #config などを起動URLに残すことがある。
     起動時は保護者の進捗ページを優先するため、URLだけ #config のままになる。
     その状態で通常のリンクを押しても hashchange は起きず設定へ移れないので、
     保護者用ナビも子ども用タブと同じく同一ハッシュをここで描き直す。 */
  $$('.pagenav-item').forEach(link=>link.addEventListener('click', e=>{
    const target = String(link.getAttribute('href') || '').replace(/^#/, '');
    if(!TABS.includes(target)) return;
    e.preventDefault();
    e.stopPropagation();
    navigateTo(target);
  }));
  const openChild = $('#openChildPage');
  if(openChild) openChild.addEventListener('click', e=>{
    e.preventDefault();
    e.stopPropagation();
    if(confirm('子ども画面へ移動します。\n保護者ページに戻るには、画面上部のタイトルを5回タップするか、2秒長押ししてください。')) navigateTo('home');
  });
  const guideOk = $('#parentGuideOk');
  if(guideOk) guideOk.addEventListener('click', ()=>{
    setLocal(K_GUIDE_DONE, 'done');
    render({ keepScroll:true });
  });
  const syncPromptDismiss = $('#syncPromptDismiss');
  if(syncPromptDismiss) syncPromptDismiss.addEventListener('click', ()=>{
    setLocal(K_SYNC_PROMPT_DONE, 'done');
    render({ keepScroll:true });
  });
  const homeInstallDismiss = $('#homeInstallDismiss');
  if(homeInstallDismiss) homeInstallDismiss.addEventListener('click', ()=>{
    setLocal(K_HOME_INSTALL_DONE, 'done');
    render({ keepScroll:true });
  });
  const sampleReset = $('#sampleResetBtn');
  if(sampleReset) sampleReset.addEventListener('click', resetSampleTasks);
  const sampleKeep = $('#sampleKeepBtn');
  if(sampleKeep) sampleKeep.addEventListener('click', ()=>{
    setLocal(K_SAMPLE_PARENT, 'done');
    render({ keepScroll:true });
  });
  const syncRefresh = $('#parentSyncRefresh');
  if(syncRefresh) syncRefresh.addEventListener('click', async ()=>{
    const S = window.NatsuSync;
    syncRefresh.disabled = true;
    const ok = !!(S && typeof S.refresh === 'function' && await S.refresh());
    syncRefresh.disabled = false;
    toast(ok ? '共有データを更新しました' : '更新できませんでした。少し待ってからもう一度お試しください');
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
  const bookOrder = $('[data-parent-book-order]');
  if(bookOrder) bookOrder.addEventListener('click', ()=>{
    const order = bookOrder.dataset.parentBookOrder;
    if(order !== 'asc' && order !== 'desc') return;
    setLocal(K_PARENT_BOOK_ORDER, order);
    render({ keepScroll:true });
  });
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
  bindInviteScanButtons(document);

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
    if(!confirm('「' + name + '」を 端末一覧から はずしますか？\n' +
                'その端末では あいことばが 消えますが、入れ直すと 再参加できます。\n' +
                'アクセス禁止には なりません。記録そのものは 消えません。')) return;
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
      el.innerHTML = syncStatusHTML(st, text);
    });
  }
  if(!bindSync._deviceWatching){
    bindSync._deviceWatching = true;
    S.onDeviceCount(count=>{
      /* 1台→2台で「待っています」から「つながっています」に変わる */
      const st = $('#syncStatus');
      if(st) st.innerHTML = syncStatusHTML(S.status(), S.statusText());
      const el = $('#syncDeviceCount');
      if(el) el.textContent = '端末と表示の設定（設定済み：' + count + '台）';
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

  if(save) save.addEventListener('click', async ()=>{
    const c = cleanCode(input.value);
    if(c.length < 8){ toast('合言葉を8文字以上入力してください'); return; }
    /* 確認の 段を 出している ときは、確認ずみの あいことばだけ 通す。
       すでに 共有ずみの 画面（確認の段が 無い）は これまで通り */
    if(verify && verified !== c){ toast('先に「接続を確認」を押してください'); return; }
    if(!confirmShareSafety()) return;
    if(typeof S.forgetRevokedCode === 'function') S.forgetRevokedCode();
    await forgetConfigStampForNewHousehold(c);
    await rememberChosenCode(c);
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
  const startSharing = async (code, auto)=>{
    if(!auto && !confirmShareSafety()) return;
    if(typeof S.forgetRevokedCode === 'function') S.forgetRevokedCode();
    await forgetConfigStampForNewHousehold(code);
    await rememberChosenCode(code);
    S.reconnect(code);
    S.registerHousehold(code).catch(()=>{});
    openSyncDetails = true;          // QR・招待リンクをすぐ開いて見せる
    toast('作成しました。ほかの端末から この合言葉で 読み取れます');
    render({ keepScroll:true });
  };
  on('#syncMake', 'click', ()=>{ startSharing(S.makeCode(), true); });
  on('#syncMakeOwn', 'click', async ()=>{
    const input = $('#syncOwnCode');
    const c = cleanCode(input ? input.value : '');
    if(c.length < 8){
      toast('合言葉は 8文字以上に してください');
      if(input) input.focus();
      return;
    }
    await startSharing(c);
  });

  const off = $('#syncOff');
  if(off) off.addEventListener('click', ()=>{
    if(!confirm('この端末を切り離しますか？\nこの端末の記録は残りますが、他の端末とはそろわなくなります。')) return;
    /* ホーム画面版は 起動URLに 合言葉が のこる。おぼえておかないと、
       次に 開いた 瞬間に 同じグループへ つなぎ直されて 解除が 効かない */
    rememberChosenCode('none');
    clearHouseholdLocalCopies();
    if(typeof S.forgetRevokedCode === 'function') S.forgetRevokedCode();
    S.setCode('');
    S.disconnect();
    render({ keepScroll:true });
    toast('切り離しました');
  });
}

/* 保護者ページ（設定）*/
function bindConfig(){
  /* 宿題の一覧の写真。画像は端末の中に置き、共有には印だけを流す。

     ページを開いたついでに、受け渡しの箱を整える（古いものを片づけ、
     この端末にある写真で欠けているぶんを入れ直す）。読み取りは開くたび4回、
     書き込みは欠けている枠のぶんだけ。子どもの画面では走らせない。 */
  if($('#posterFile')) refreshHandoff();
  /* iOS では、隠した 入力欄を <label for> で 押しても 一度目が 効かない
     ことが ある（実機で「2回 押さないと 出ない」）。ふつうの ボタンから
     input.click() を 呼ぶ。入力欄は display:none に せず、画面の 外へ 出す */
  /* どの 枠に 入れるかを 入力欄に 控えて おく。空なら いちばん 小さい 空き枠
     （savePosterFile が 決める）。描き直しの たびに 要素は 作り直されるので、
     ここで 直に つないで よい（#view へ つながない かぎり 積み重ならない） */
  on('#posterPick', 'click', ()=>{ const f = $('#posterFile'); if(f){ f.dataset.slot = ''; f.click(); } });
  $$('[data-poster-pick]').forEach(el=> el.addEventListener('click', ()=>{
    const f = $('#posterFile');
    if(f){ f.dataset.slot = el.dataset.posterPick; f.click(); }
  }));
  on('#posterFile', 'change', e=>{
    const file = e.target.files && e.target.files[0];
    const slot = e.target.dataset.slot === '' ? -1 : Number(e.target.dataset.slot);
    e.target.value = '';
    if(file) savePosterFile(file, slot);
  });
  $$('[data-poster-clear]').forEach(el=> el.addEventListener('click', ()=>{
    const slot = Number(el.dataset.posterClear) || 0;
    if(confirm((slot + 1) + '枚目の写真を消しますか？' + '\n'
      + '共有しているときは、ほかの端末からも消えます。')) removePoster(slot);
  }));
  on('#posterLabel', 'change', e=>{
    /* 空のままを 許す。**既定の 語で 埋め戻さないこと**（消しても 戻る） */
    const label = String(e.target.value || '').trim().slice(0, 6);
    config.poster = posterCfgOut(label, posterCfg().ats);
    saveCfg();
    render({ keepScroll:true });
  });

  const setConfigChildName = value=>{
    const name = String(value || '').trim();
    const oldName = config.childName;
    const titleWasGenerated = isGeneratedTitle(config.title, oldName);
    config.childName = name;
    if(titleWasGenerated) config.title = defaultTitleFor(name);
    setLocal(K_NAME, name);
    saveCfg();
  };
  on('#cfgChildName', 'change', e=>{
    setConfigChildName(e.target.value);
    render({ keepScroll:true, discardFormDraft:true });
  });
  on('#cfgTitle', 'change', e=>{
    config.title = e.target.value.trim() || defaultTitleFor(config.childName);
    saveCfg(); render({ keepScroll:true, discardFormDraft:true });
  });
  on('#cfgReadingGrade', 'change', e=>{
    const grade = Number(e.target.value);
    /* おうちの設定として 同期する。おうちの人の端末で 変えれば、
       子どもの端末の 表示も 数秒で 追いつく */
    config.readingGrade = grade;
    setLocal(K_READING, grade);          // 古い版の端末との つなぎ
    if(typeof setReadingGrade === 'function') setReadingGrade(grade);
    saveCfg();
    render({ keepScroll:true, discardFormDraft:true });
  });
  on('#cfgStart', 'change', e=>{ config.startAt = e.target.value; saveCfg(); render({ keepScroll:true, discardFormDraft:true }); });
  on('#cfgEnd', 'change',   e=>{ config.endAt   = e.target.value; saveCfg(); render({ keepScroll:true, discardFormDraft:true }); });
  /* 表示のことばは 長さと 空白を そろえてから 保存する。
     normalizeConfig() を 通すのは、空欄の 既定もどしを 1か所に まとめるため */
  LABEL_KEYS.forEach(key=>{
    const id = '#cfg' + key.charAt(0).toUpperCase() + key.slice(1);
    on(id, 'change', e=>{
      config[key] = e.target.value;
      normalizeConfig(config);
      saveCfg();
      render({ keepScroll:true, discardFormDraft:true });
    });
  });

  $$('.theme-choice input[name="theme"]').forEach(input=>input.addEventListener('change', e=>{
    if(!THEME_IDS.includes(e.target.value)) return;
    config.theme = e.target.value;
    saveCfg();
    render({ keepScroll:true, discardFormDraft:true });
  }));
  $$('[data-config-revert]').forEach(button=>button.addEventListener('click', ()=>{
    if(!configBase) return;
    const name = button.dataset.configRevert;
    if(!CONFIG_FIELD_KEYS[name]) return;
    const snap = configBase;
    if(name === 'childName') setConfigChildName(snap.childName);
    else if(name === 'readingGrade'){
      const grade = Number(snap.readingGrade);
      config.readingGrade = grade;
      setLocal(K_READING, grade);
      if(typeof setReadingGrade === 'function') setReadingGrade(grade);
      saveCfg();
    }else{
      CONFIG_FIELD_KEYS[name].forEach(k=>{ config[k] = deepCopy(snap[k]); });
      saveCfg();
    }
    render({ keepScroll:true, discardFormDraft:true });
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
    else{
      if(openConfigTaskId === t.id) openConfigTaskId = null;
      noticeTaskRowClosed(t);
    }
  }, true);

  ed.addEventListener('change', e=>{
    const row = e.target.closest('.set-task'); if(!row) return;
    const t = config.tasks[+row.dataset.i]; if(!t) return;

    /* この課題の 基準が まだ 無ければ、変える 直前の 姿を ここで 控える。
       open った 瞬間（toggle）に 控えると、render() が <details open> を
       属性で 復元しても toggle は 発火しない ぶん 取りこぼす。最初の
       変更の 直前に 控えるのが 確実で、利用者の 思う「元」とも 合う */
    if(!configTaskBase || configTaskBase.id !== t.id) configTaskBase = { id: t.id, snap: deepCopy(t) };

    const bf = e.target.dataset.bf;
    if(bf){
      t.bookFields = Object.assign(bookFields(t), { [bf]: e.target.checked });
      saveCfg(); refreshTaskRow(t); return;
    }

    const f = e.target.dataset.f; if(!f) return;

    if(f === 'targetUnitPreset'){
      t.targetUnit = e.target.value === 'custom' ? '' : e.target.value;
      openConfigTaskId = t.id;
      saveCfg(); render({ keepScroll:true }); return;
    }
    if(f === 'targetUnitCustom'){
      t.targetUnit = e.target.value.trim().slice(0,8);
      saveCfg(); refreshTaskRow(t); return;
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
    else if(f === 'wrapUp'){
      t.wrapUp = e.target.checked;
      openConfigTaskId = t.id;
      saveCfg(); render({ keepScroll:true }); return;
    }
    else if(f === 'wrapBy')     t.wrapBy = e.target.value;
    else if(f === 'total')      t.total = clamp(+e.target.value||1, 1, 200);
    else if(f === 'target')     t.target = clamp(+e.target.value||1, 1, 999);
    /* 行を 置きかえる 前に、答え・チェックを 新しい ならびへ 移す。
       先に t.steps / t.questions を 書きかえると、古い ならびが 分からなくなる */
    else if(f === 'steps'){
      const next = e.target.value.split('\n').map(s=>s.trim()).filter(Boolean);
      realignStepProgress(t, t.steps || [], next);
      t.steps = next;
    }
    else if(f === 'questions'){
      const next = e.target.value.split('\n').map(s=>s.trim()).filter(Boolean);
      realignQuestionAnswers(t, t.questions || [], next);
      t.questions = next;
    }
    else if(f === 'type'){
      /* 「読書」は type では なく recordStyle。読書の 本体は 冊数を 数える
         count なので、type は 'count' の まま 置く。
         **記録は 消さない。** 進め方を 戻せば これまでの 冊数も 回数も
         また 見える（wrapUp を 外しても 進捗を 消さないのと 同じ扱い）。
         bookFields も 残す ―― 選び直したときに 前の 設定が 戻る */
      if(e.target.value === 'book'){
        t.type = 'count';
        t.recordStyle = 'book';
        t.bookFields = bookFields(t);
        t.total = t.total || 10;
        /* 単位も 番号の 出しかたも、読書の あいだは 使われない
           （冊数は bookCountUnit、番号は countUsesCircle が 外す）。
           だからこそ **上書きしない。** 上書きすると、読書を やめて
           戻したときに「まい」が「さつ」に なっていた、が 起きる */
        t.unit = t.unit || 'さつ';
      }else{
        t.type = e.target.value;
        delete t.recordStyle;
      }
      if(t.type==='count'  && !t.total) { t.total = 10; t.unit = t.unit || 'ばん'; t.numbered = true; }
      if(t.type==='step'   && !(t.steps||[]).length) t.steps = ['はじめる','とちゅう','かんせい！'];
      if(t.type==='daily'  && !t.target){ t.target = 1; t.targetUnit = t.targetUnit || 'かい'; }
      if(t.type==='daily') t.group = 'daily';
      openConfigTaskId = t.id;
      saveCfg(); render({ keepScroll:true });
      refocusTaskField(t, '[data-f="type"]');
      return;
    }
    else if(f === 'group'){
      t.group = e.target.value;
      if(t.group==='daily' && t.type!=='daily'){ t.type='daily'; t.target = t.target||1; t.targetUnit = t.targetUnit||'かい'; }
      openConfigTaskId = t.id;
      saveCfg(); render({ keepScroll:true });
      /* 行は 別の 箱へ 動く。**選ばれている ほう**へ 焦点を 返す ――
         先頭（必須）へ 返すと、選んだ ものと 焦点が ずれる */
      refocusTaskField(t, '.set-seg-opt input:checked');
      return;
    }
    else t[f] = e.target.value;

    saveCfg();
    refreshTaskRow(t);
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
      return;
    }
    const rv = e.target.closest('[data-revert]');
    if(rv){
      const t = config.tasks[i];
      /* 基準が この課題の ものでなければ（すでに 閉じて 手放した あとなど）
         押しても 何も 起きない。ボタンは 基準が ある間しか 出ないので、
         ふつうは 必ず 一致する */
      if(configTaskBase && configTaskBase.id === t.id){
        const snap = configTaskBase.snap;
        TASK_FIELD_KEYS[rv.dataset.revert].forEach(k=>{
          if(Object.prototype.hasOwnProperty.call(snap, k)) t[k] = deepCopy(snap[k]);
          else delete t[k];
        });
        openConfigTaskId = t.id;
        saveCfg(); render({ keepScroll:true });
      }
      return;
    }
  });
  }

  /* 足した 直後は、名前を 入れる ところから 始まる。名前の欄へ
     カーソルを 置いて、最初の 操作が 名づけに なるようにする。
     まちがえて 押した ときも、名前が 選ばれた 状態なので すぐ 気づける */
  function startNewTask(added){
    config.tasks.push(added);
    openConfigTaskId = added.id;
    configTaskNewId = added.id;
    configTaskBase = null;
    saveCfg();
    render({ keepScroll:true });
    const name = $('.set-task[data-details-key="task:' + added.id + '"] [data-f="name"]');
    if(name){ name.focus(); name.select(); }
  }

  /* 押したボタンの 欄に 足す。group を まちがえると、足したものが
     別の欄に 現れて「追加できていない」ように 見える */
  function addNormalTask(group){
    const added = {
      id: 't' + Date.now(), group, type:'count',
      name:'あたらしい しゅくだい', total:10, unit:'かい', numbered:false,
      memoLabel:'やったことを かこう'
    };
    startNewTask(added);
  }
  /* 追加は 必須・任意の 2つだけ。読書は 足したあとの「進め方」で 選ぶ。
     欄ごとに 追加ボタンを 増やすと、押す前に どれを 押すか 決めさせる
     ことに なる ―― どんな 宿題かは、名前を 付けながら 決まる */
  on('#addMustTask',   'click', ()=>addNormalTask('must'));
  on('#addOptionTask', 'click', ()=>addNormalTask('option'));
  on('#addDailyTask', 'click', ()=>{
    const added = { id:'daily-'+Date.now(), group:'daily', type:'daily',
      name:'おてつだい', target:1, targetUnit:'かい', memoLabel:'やったこと' };
    config.showDaily = true;
    startNewTask(added);
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
    setLogDeleteAllowed(ald.checked);
    render({ keepScroll:true });
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
      resetSharedState(Date.now()); saveSt(); render(); toast('すべての端末へ削除を送信しました');
    }
  });
}

/* ---------------------------------------------------------
   進捗サマリー（保護者向けのテキスト出力）
   --------------------------------------------------------- */
/* 要約は 保護者だけが 読む。子ども画面の「かならず やる／つぎに やる／まいにち」
   とは わざと 別の 語に して、必須／任意／毎日 で そろえる。
   課題が 無い 区分は buildSummary() が 見出しごと 出さない */
const GROUP_LABEL = { must:'必須の宿題', option:'任意の宿題', daily:'毎日の項目' };

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
    L.push(deadlineWord(false) + 'まで  あと ' + Math.floor(ms/86400000) + '日'
         + (Math.floor(ms/3600000) % 24) + '時間');
  }else{
    L.push(periodWord(false) + 'は終了しました');
  }
  L.push(periodWord(false) + 'の経過  ' + Math.round(o) + '%');
  L.push('必須の宿題    ' + Math.round(s.pct) + '%  (' + s.done + '/' + s.total + ')');
  if(so.total) L.push('任意の宿題    ' + Math.round(so.pct) + '%  (' + so.done + '/' + so.total + ')');

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
  const blob = new Blob([JSON.stringify({
    exportVersion: 1,
    exportedAt: new Date().toISOString(),
    config,
    state
  }, null, 2)], {type:'application/json'});
  downloadBlob(blob, 'natsuyasumi-' + dayKey(new Date()) + '.json');
  toast('書き出しました');
}

function backupPreviewText(o){
  const when = o.exportedAt ? new Date(o.exportedAt) : null;
  const whenText = when && !Number.isNaN(when.getTime())
    ? when.toLocaleString('ja-JP')
    : '記録なし（旧形式）';
  const tasks = o.config && Array.isArray(o.config.tasks) ? o.config.tasks.length : 0;
  const logs = o.state && Array.isArray(o.state.logs) ? o.state.logs.length : 0;
  return '書き出し日時：' + whenText + '\n宿題：' + tasks + '件\n記録：' + logs + '件';
}

function validateImportedTaskIds(c){
  if(!c || !Array.isArray(c.tasks)) throw new Error('宿題IDを確認できません');
  const seen = new Set();
  c.tasks.forEach(task=>{
    if(!task || typeof task !== 'object' || typeof task.id !== 'string' || !task.id.trim()){
      throw new Error('宿題IDがない項目があります');
    }
    if(seen.has(task.id)) throw new Error('同じ宿題IDが重複しています');
    seen.add(task.id);
  });
  return true;
}

function importBackup(o){
  if(!o || !o.config || !o.state) throw new Error('ファイル形式が異なります');
  validateImportedTaskIds(o.config);
  const sharing = !!(window.NatsuSync && window.NatsuSync.getCode().length >= 8);
  const scope = sharing
    ? '\n\n共有中のため、つないだ家族のデータにも反映されます。'
    : '';
  if(!confirm(backupPreviewText(o) + scope + '\n\n現在のデータを、この内容で置き換えます。よろしいですか？')) return false;
  clearQuestionAnswerCache();
  config = normalizeConfig(o.config);
  state = normalizeState(o.state);
  migrateMessages();
  saveCfg(); saveSt(); render(); toast('読み込みました');
  return true;
}

function importData(e){
  const f = e.target.files && e.target.files[0];
  if(!f) return;
  const fr = new FileReader();
  fr.onload = ()=>{
    try{
      const o = JSON.parse(fr.result);
      importBackup(o);
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

document.addEventListener('pointerdown', e=>{
  const mic = e.target.closest && e.target.closest('[data-mic]');
  if(!mic) return;
  const id = mic.dataset.mic;
  const el = /^q\d+$/.test(id) ? $('#sheetBody [data-q="'+id.slice(1)+'"]') : $('#'+id);
  if(!el) return;
  /* iPadではマイクを押した瞬間に入力欄がblurすることがあるため、clickまで
     待たずに、まだ残っている選択範囲を記憶する。 */
  const length = String(el.value || '').length;
  const start = Number.isInteger(el.selectionStart) ? el.selectionStart : length;
  const end = Number.isInteger(el.selectionEnd) ? el.selectionEnd : start;
  mic._srSelection = { start, end };
  mic._srStatus = mic.parentElement && mic.parentElement.querySelector('[data-mic-status]');
}, true);

document.addEventListener('click', e=>{

  if(e.target.closest('#todayLabel')){ openKinenbi(new Date()); return; }
  if(e.target.closest('#kinenbiClose')){ closeKinenbi(); return; }
  const adultSectionHelp = e.target.closest('[data-adult-section-help-button]');
  if(adultSectionHelp){ openAdultSectionHelp(adultSectionHelp); return; }
  if(e.target.closest('#adultSectionHelpClose')){ closeAdultSectionHelp(); return; }
  if(e.target.closest('#posterOpen')){ openPoster(); render({ keepScroll:true }); return; }
  /* 「渡す」「受け取る」は **使い方ウインドウの「うまく届かないとき」の中**に 置く。
     ふだんは 自動で 届くので、平常の 画面には 出さない。
     **ここ（document）へ 一度だけ つなぐ。** bindConfig は 描き直しの たびに
     走るので、そこで つなぐと ダイアログの ボタンに 束ねが 積み重なる
     （1回の タップで 何度も 走る。並べかえの ▲▼ で 実際に 起きた事故と 同じ） */
  /* 「?」から 開く。**ここ（document）に 置く。** bindConfig に 置いても よいが、
     開く・閉じる・中の 2つの ボタンが 別々の 場所に 散ると、片方を 消した ときに
     気づけない（実際、欄の 整理で 開く 側だけ 消えて、押しても 開かなく なった） */
  if(e.target.closest('#posterHelp')){
    const dialog = $('#posterHelpDialog');
    if(typeof dialog.showModal === 'function') dialog.showModal(); else dialog.setAttribute('open', '');
    return;
  }
  /* 共有の「i」。写真の 説明と 同じ 作りで、開く・閉じるを ここに そろえる。
     **id では なく data 属性で 拾う**（この欄は 2か所から 描かれる） */
  if(e.target.closest('[data-sync-help]')){
    const dialog = $('#syncHelpDialog');
    if(typeof dialog.showModal === 'function') dialog.showModal(); else dialog.setAttribute('open', '');
    return;
  }
  if(e.target.closest('#syncHelpClose')){
    const dialog = $('#syncHelpDialog');
    if(typeof dialog.close === 'function') dialog.close(); else dialog.removeAttribute('open');
    return;
  }
  if(e.target.closest('#posterSend')){ posterHandAll(); return; }
  if(e.target.closest('#posterTake')){ posterTakeAll(); return; }
  if(e.target.closest('#posterHelpClose')){
    const dialog = $('#posterHelpDialog');
    if(typeof dialog.close === 'function') dialog.close(); else dialog.removeAttribute('open');
    return;
  }
  if(e.target.closest('#posterClose')){
    const dialog = $('#posterDialog');
    if(typeof dialog.close === 'function') dialog.close(); else dialog.removeAttribute('open');
    return;
  }
  if(e.target.id === 'kinenbiDialog'){
    const r = e.target.getBoundingClientRect();
    const outside = e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom;
    if(outside) closeKinenbi();
    return;
  }
  if(e.target.id === 'adultSectionHelpDialog'){
    const r = e.target.getBoundingClientRect();
    const outside = e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom;
    if(outside) closeAdultSectionHelp();
    return;
  }

  if(e.target.closest('[data-share-safety]')){
    alert(shareSafetyText());
    return;
  }

  const tabBtn = e.target.closest('.tab');
  if(tabBtn){
    const t = tabBtn.dataset.tab;
    navigateTo(t);
    return;
  }

  /* route用の通常リンクも同じ入口へ通す。Ctrl/Cmd/Shiftクリックや
     新しいタブ指定はブラウザ本来の動作を残す。ページ内目次はbuttonなので
     ここへ来ず、未知hashをURLへ入れない。 */
  const routeLink = e.target.closest('a[href^="#"]');
  if(routeLink && !e.defaultPrevented && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey
     && (!routeLink.target || routeLink.target === '_self')){
    const target = String(routeLink.getAttribute('href') || '').replace(/^#/, '');
    if(validRouteTarget(target)){
      e.preventDefault();
      navigateTo(target);
      return;
    }
  }

  /* 長い説明を 書くかわりに、その場から 飛ばす。
     設定ページは 長いので、着いた先まで 寄せないと 意味が ない */
  if(e.target.closest('#logCareJump')){
    navigateTo('config', { jump:'#allowLogDelete', focus:true });
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
    if(role === 'parent') navigateTo('settings');
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

  /* 子ども画面の「おためしの しゅくだいです」の OK。
     この端末に だけ しるしを のこす（config / state には 入れない）。 */
  if(e.target.closest('#sampleChildOk')){
    setLocal(K_SAMPLE_CHILD, 'done');
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
    const seenNow = (funToday().seen || []);
    if(fun.dataset.fun === 'open'){ funOpen = true; pushRead(funIdx); }
    else if(fun.dataset.fun === 'prev' || fun.dataset.fun === 'fwd'){
      /* きょう 読んだ ぶんの 行き来。新しくは 引かないので、
         上限にも ふれない（読み返しは いくらでも できる） */
      const at = funPos < 0 ? seenNow.length - 1 : funPos;
      funPos = clamp(fun.dataset.fun === 'prev' ? at - 1 : at + 1, 0, Math.max(0, seenNow.length - 1));
    }
    else{
      /* 説明を 読むまで 次へは 進めない。1日に 引ける かずも ここで かぎる。
         ボタンは 上限で 消えるが、
         連打や 古い画面から 押された ときのために ここでも 止める */
      if(!funOpen || funToday().seen.length >= funLimit()) return;
      funPick();
    }
    /* カードだけ差し替える。ページは動かない。

       **開いているかどうかを 引きつぐこと。** funHTML() の open は
       「新しく 引ける ぶんが あるか」だけで 決まるので、きょうの ぶんを
       読み切った あと（left === 0）に 差し替えると、開いて 見ていた カードが
       畳まれる。実機で「さいごの 話の 答えを 見ようとすると 畳まれる」と
       いう 形で 出た。開き直しの 記憶（detailsKey）は render() のときしか
       働かないので、ここでは 自分で 引きつぐ */
    const card = $('.fun');
    if(card){
      const wasOpen = card.open;
      card.outerHTML = funHTML();
      const next = $('.fun');
      if(next) next.open = wasOpen;
    }
    else render({ keepScroll:true });
    return;
  }

  // シート内
  if(e.target.id === 'sheetBack') return;
  if(e.target.closest('#sheetClose') || e.target.closest('#sheetCancel')){
    if(!confirmLeaveSheet()) return;
    closeSheet(); return;
  }
  if(e.target.closest('#sheetSave')){ saveSheet(); return; }

  const saveQuestion = e.target.closest('[data-save-q]');
  if(saveQuestion){ saveQuestionAnswer(Number(saveQuestion.dataset.saveQ), true); return; }

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
    $('#wraps').innerHTML = wrapsHTML(sheetTask, sheetWrap);
    return;
  }
  const ta = e.target.closest('#tally .tally-btn');
  if(ta){
    sheetSel = +ta.dataset.n;
    const more = $('#dailyMore');
    if(more) more.value = '';
    $$('#tally .tally-btn').forEach(b=> b.classList.toggle('sel', +b.dataset.n === sheetSel));
    syncDailySaveLabel();
    return;
  }
  const mic = e.target.closest('[data-mic]');
  if(mic){
    const id = mic.dataset.mic;
    // 観察の質問は data-q、それ以外は同じ id の入力欄
    const el = /^q\d+$/.test(id) ? $('#sheetBody [data-q="'+id.slice(1)+'"]') : $('#'+id);
    if(el){
      mic._srStatus = mic.parentElement && mic.parentElement.querySelector('[data-mic-status]');
      if(mic.classList.contains('rec')) stopSR();
      else startSR(mic, el, mic._srSelection);
    }
    return;
  }
});

document.addEventListener('keydown', e=>{
  if(e.key === 'Escape' && $('#kinenbiDialog').open){ closeKinenbi(); return; }
  if(e.key === 'Escape' && !$('#sheetWrap').hidden && confirmLeaveSheet()) closeSheet();
});

/* 画面の はしを なぞって 戻ろうとした ときは、シートを 開くときに
   足しておいた 履歴が 先に 戻る。書きかけが あれば ここで 引きとめる。 */
window.addEventListener('popstate', ()=>{
  const wrap = $('#sheetWrap');
  if(!wrap || wrap.hidden){ sheetNavPushed = false; return; }
  if(!confirmLeaveSheet()){
    /* とどまる。戻ったぶんの 履歴を 足し直して、つぎの なぞりも 受けとめる */
    history.pushState({ natsuSheet:true }, '', location.href);
    return;
  }
  sheetNavPushed = false;
  closeSheet();
});

/* 答えを 書きかえた とたんに、ボタンを「ほぞんずみ」から もどす */
document.addEventListener('input', e=>{
  const box = e.target.closest && e.target.closest('[data-q]');
  if(box) refreshQuestionSaveState(Number(box.dataset.q));
  /* 6以上の欄に 打ち込んだ ときも、その場で「なおす」に 切りかわるように */
  if(e.target && e.target.id === 'dailyMore') syncDailySaveLabel();
});

// タブを もどってきたら、どの画面でも上帯の日づけを更新する。
document.addEventListener('visibilitychange', ()=>{
  if(document.hidden){ stopSR(); return; }
  /* 裏から 戻った ときに 一度 見る。合図だけ 先に 届いて 空振りした ときの
     立ち直り（同期の resumeSync と 同じ 考え方） */
  checkPosterArrival();
  renderKinenbiButton(new Date());
  if(tab === 'home') render();
});
window.addEventListener('pagehide', stopSR);
/* 前景のまま日をまたいだ場合も、表示日と開く内容を食い違わせない。
   1分ごとに日付キーだけを比べ、日が変わったときだけDOMを更新する。 */
setInterval(()=>{
  const now = new Date();
  if(dayKey(now) !== kinenbiRenderedDay) renderKinenbiButton(now);
}, 60000);

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
function bindTopbandParentGesture(){
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
  function fromKinenbi(e){ return !!(e && e.target && e.target.closest('#todayLabel')); }

  el.addEventListener('click', e=>{
    if(fromKinenbi(e)) return;
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
    navigateTo('settings');
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
    if(fromKinenbi(e)) return;
    const t = e.touches[0]; if(t) start(t.clientX, t.clientY);
  }, { passive:true });
  el.addEventListener('touchmove', e=>{
    if(fromKinenbi(e)){ cancel(); return; }
    const t = e.touches[0]; if(t) moved(t.clientX, t.clientY);
  }, { passive:true });
  el.addEventListener('touchend',    cancel);
  el.addEventListener('touchcancel', cancel);

  /* パソコンで ためすとき用 */
  el.addEventListener('mousedown', e=>{ if(!fromKinenbi(e)) start(e.clientX, e.clientY); });
  el.addEventListener('mousemove', e=>{ if(fromKinenbi(e)){ cancel(); return; } if(timerId) moved(e.clientX, e.clientY); });
  el.addEventListener('mouseup',    cancel);
  el.addEventListener('mouseleave', cancel);

  /* 長押しは iOS だと 文字の 選択や 虫めがねに 取られて
     途中で 切れることが ある。とんとん と 5回 つづけて たたく方でも
     開けるようにして、どちらか 通れば よい ことにする */
  el.addEventListener('click', e=>{
    if(fromKinenbi(e)) return;
    const now = performance.now();
    taps = (now - lastTap > TAP_GAP) ? 1 : taps + 1;
    lastTap = now;
    if(taps >= TAPS) open();
  });

  /* 長押しで 文字が 選ばれたり、虫めがねが 出たり しないように */
  el.style.webkitUserSelect = 'none';
  el.style.userSelect = 'none';
  el.style.webkitTouchCallout = 'none';
}
bindTopbandParentGesture();

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
  if(name === 'writes' && (c < 0 || h.slice(c + 1))){
    writesTaskId = c < 0 ? writesTaskId : h.slice(c + 1);
    return 'writes';
  }
  const requested = TABS.indexOf(h) >= 0 ? h : 'home';
  /* すでにこのブラウザで使い始めている人は、導線変更で止めない。
     ただし起動直後のミニコンテンツ抽選も state に保存される。K_ST まで
     見ると、新しいブラウザでもその保存だけで「設定済み」になってしまう。
     設定を保存した印（K_CFG）があるときだけ、初期設定を通過済みとみなす。 */
  const hasExistingConfig = !!getLocal(K_CFG);
  /* おためしモードでは起動時の内部データを「設定済み」と数えない。 */
  if(requested !== 'welcome' && !getLocal(K_ONBOARD) && (TEST_MODE || !hasExistingConfig)) return 'welcome';
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

/* iOS / iPadOS は「ホーム画面に追加」した瞬間の URL（#config などを含む）を
   起動 URL として残す。これは画面内の移動には必要だが、次にアイコンから開く
   ときまで引き継ぐべきではない。起動時だけ端末の役割を優先し、以後の
   hashchange は routeFromHash() に任せることで、保護者の「子ども画面へ」など
   通常の画面移動はそのまま使える。 */
function launchRoute(){
  const requested = routeFromHash();
  if(requested === 'welcome' || requested === 'stats' || !isStandalone()) return requested;
  const role = getLocal(K_ROLE);
  if(role === 'parent') return 'settings';
  if(role === 'child') return 'home';
  return requested;
}

/* route名をURLに置く形へそろえる。writesは課題idをhashに持つので、
   すでに同じwritesを表示しているときは完全なhashを保つ。 */
function validRouteTarget(target){
  const raw = String(target || '').replace(/^#/, '');
  const c = raw.indexOf(':');
  if(c < 0) return TABS.includes(raw);
  return raw.slice(0, c) === 'writes' && !!raw.slice(c + 1);
}
function routeHash(target){
  const raw = String(target || '').replace(/^#/, '');
  if(!validRouteTarget(raw)) return '#home';
  const name = raw.split(':')[0];
  if(name === 'writes' && raw === 'writes' && /^#writes:/.test(location.hash || '')) return location.hash;
  return '#' + raw;
}

/* 起動時のrole優先で表示routeを変えたら、URLも同じrouteへ置きかえる。
   replaceStateなので戻る履歴を増やさず、query（招待など）も落とさない。 */
function normalizeLaunchHash(target){
  const next = routeHash(target);
  if(location.hash === next) return;
  history.replaceState(null, '', location.pathname + location.search + next);
}

/* 画面切替の共通入口。同じhashへの代入ではhashchangeが起きないため、
   URLが同じでも実tabが違えばここで直して描画する。 */
function navigateTo(target, opts){
  const raw = String(target || '').replace(/^#/, '');
  if(!validRouteTarget(raw)) return false;
  const jump = opts && opts.jump;
  if(jump) jumpTo(jump, !!opts.focus);
  const nextHash = routeHash(raw);
  if(location.hash !== nextHash){
    location.hash = raw;
    return true;
  }
  const next = routeFromHash();
  tab = next;
  render();
  return true;
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
  /* 解除・端末削除後は、起動URLに残る旧招待へ自動復帰しないため chosen が none。
     実際には接続できない案内も同じ印で隠す（合言葉の比較コピーは不要）。 */
  if(getLocal(K_CODE_CHOSEN) === 'none') return '';
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
async function applyJoinCode(){
  /* 招待URLをホーム画面版へ渡す唯一の経路。同期モジュールがまだ準備中・
     一時的な読み込み失敗などで接続できない段階に URL から消すと、PWA 側の
     別localStorageへ合言葉を渡す方法がなくなる。接続を始められることを
     確認してから、ホーム画面版だけURLから消す。 */
  const code = joinCodeFromURL();
  const S = window.NatsuSync;
  if(!code || !S || !S.configured() || code.length < 8) return;
  if(S.getCode() === code) return;          // すでに 同じ あいことば
  /* はずされた 端末が、リンクを 開き直す だけで 戻れては いけない。
     ホーム画面版は 起動URL に あいことばが 焼きついている ので、
     これが 無いと 起動する たびに 戻ってしまう。
     入れ直しは 人が 設定画面で 打つ（そこで 忘れる） */
  if(typeof S.isRevokedCode === 'function' && await S.isRevokedCode(code)) return;
  /* 人が 設定画面で えらんだ 合言葉が あるなら、そちらが 正しい。
     ホーム画面版の 起動URLに のこった 古い 招待で 引き戻さない */
  const chosen = getLocal(K_CODE_CHOSEN);
  if(chosen && !await chosenCodeMatches(code)) return;
  /* 手動参加で選んだ色が残っていても、招待URLのグループへ持ち込まない。
     招待では接続先のグループデザインが常に正となる。 */
  try{ localStorage.removeItem(K_WELCOME_THEME); }catch(e){}
  setLocal(K_ONBOARD, 'done');              // 招かれた側は 初期設定を とばす
  await forgetConfigStampForNewHousehold(code);
  /* 招待リンクは かならず「あるグループへ入る」。見つからないときに
     この端末の初期値でグループを作ると、招いた側の設定が消える */
  await rememberChosenCode(code);
  S.reconnect(code, { joining:true });
  if(isStandalone()) clearJoinCodeFromURL();
  toast('おうちの 共有に つながりました');
  /* K_ONBOARD を先に保存するので、ここで routeFromHash() を呼ぶと既に
     'home' を返す。その結果、画面変数 tab だけが welcome のまま残る。
     招待で初期設定を飛ばした直後は、画面も明示して home 側へ切り替える。
     役割が未選択なら viewHome() が既存の「保護者／子ども端末」選択を出す。 */
  if(tab === 'welcome'){
    tab = 'home';
    navigateTo('home');
  }
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
   新しい版を静かに取り込む

   version.json など専用のファイルは作らない。版の出どころを index.html
   1つに保つほうが、「どちらが正しい版番号か」で食い違う余地がない。
   利用者に更新を選ばせると、共有端末どうしで判断がずれてしまうため、
   問いかけずに自動で読み直す。読み直せない事情があるときだけ、
   保護者ページに事実を一言そえるにとどめる。 */
function parseVersionFromIndexHTML(html){
  /* " と ' は " と ' のこと。生の引用符を並べて書かないのは好みではなく、
     テスト側の「ソースを関数単位で切り出す」簡易ツールが、文字クラス中の引用符を
     文字列の区切りと取り違えて以降の解析を狂わせるのを避けるため。 */
  const Q = '[\\u0022\\u0027]', NOTQ = '[^\\u0022\\u0027]';
  const m = String(html || '').match(new RegExp('<meta\\s+name=' + Q + 'application-version' + Q +
    '\\s+content=' + Q + '(' + NOTQ + '*)' + Q, 'i'));
  return m ? m[1] : '';
}
function checkForNewVersion(){
  /* visibilitychange 側の30分の間隔は、この「最後に確認した時刻」を基準にする */
  setLocal(K_UPDATE_CHECKED, String(Date.now()));
  fetch(cacheBustURL('index.html', Date.now()), { cache:'no-store' })
    .then(res => res.text())
    .then(html => applyVersionCheck(parseVersionFromIndexHTML(html)))
    .catch(()=>{}); // 通信できないのは ふつうのこと。エラーは出さない
}
function applyVersionCheck(remote){
  if(!remote) return;
  if(remote === RELEASE_VERSION){
    /* もう追いついている。記録が残っていると、次に別の新しい版が出たときに
       「読み直しずみ」と誤解して読み直さなくなるので、ここで消す */
    try{ localStorage.removeItem(K_UPDATE_RELOADED_FOR); }catch(e){}
    return;
  }
  if(!newVersionAvailable){
    newVersionAvailable = true;
    if(tab === 'config') render({ keepScroll:true });
  }
  adoptNewVersionIfSafe(remote);
}
/* 起動からの 経過時間で 止めては いけない。確認は 起動した 直後に 走るので、
   時間で 縛ると いちばん 大事な 継ぎ目（開いた とき）で 一度も 取り込めず、
   毎日 開き直す 使い方では 永久に 古いままに なる。
   読み直しの 連鎖は、下の「同じ版へは 二度 読み直さない」記録で 止まる。 */
function adoptNewVersionIfSafe(remote){
  const wrap = $('#sheetWrap');
  if(wrap && !wrap.hidden) return; // 記録シートを開いている間は割り込まない
  if(tab === 'welcome') return; // 初期設定の最中は割り込まない
  if(getLocal(K_UPDATE_RELOADED_FOR) === remote) return; // 同じ版では二度読み直さない
  setLocal(K_UPDATE_RELOADED_FOR, remote); // 読み直す前に記録し、失敗が続いても永久ループにしない
  location.replace(cacheBustURL(location.href, Date.now()));
}
document.addEventListener('visibilitychange', ()=>{
  if(document.hidden) return;
  const last = Number(getLocal(K_UPDATE_CHECKED)) || 0;
  if(Date.now() - last >= 30 * 60 * 1000) checkForNewVersion();
});
/* 読み直す直前に この版を 書いてから 読み直している。もどってきた 画面で
   その印が いまの版と そろっていれば、たったいま 取り込んだ ということ。
   黙って 入れかわると 何が 起きたのか 分からないので、一言だけ 残す。
   問いかけでは なく 済んだ 事実なので、消える 知らせで よい。
   知らせたら 印を 消す。次に 開くたびに くり返さないため。 */
function noticeAdopted(){
  if(getLocal(K_UPDATE_RELOADED_FOR) !== RELEASE_VERSION) return;
  try{ localStorage.removeItem(K_UPDATE_RELOADED_FOR); }catch(e){}
  /* 子どもに 版の 番号は 要らない。大人の 画面にだけ 何版かを 書く */
  toast(isAdultTab(tab)
    ? 'アプリを最新版（v' + RELEASE_VERSION + '）に更新しました'
    : 'アプリが あたらしく なったよ');
}

/* ---------------------------------------------------------
   はじめる
   --------------------------------------------------------- */
loadAll();
migrateAppSecretFingerprints().catch(()=>{});
if(typeof setReadingGrade === 'function') setReadingGrade(readingGrade());
tab = launchRoute();
normalizeLaunchHash(tab);
if(typeof window.natsuBootProgress === 'function') window.natsuBootProgress(100, '表示します');
render();
noticeAdopted(); // 取り込みの直後なら、何が起きたのかを一言だけ残す
checkForNewVersion(); // 描画を待たせない。結果は次の描画で静かに反映する
/* 端末に ある 写真を 読んでから 描き直す。読めなくても 先に 画面は 出す */
loadPoster().then(()=>{
  if(posterHere()) render({ keepScroll:true });
  /* 起動の たびに 一度 見る。**取りに 行くのは、印が この端末の ものより
     新しい ときだけ**（比べるのは 端末の 中の 値なので、読み取りは 起きない） */
  checkPosterArrival();
});

})();
