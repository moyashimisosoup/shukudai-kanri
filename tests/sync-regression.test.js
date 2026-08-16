const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { webcrypto } = require('node:crypto');

const ROOT = path.join(__dirname, '..');
const APP = fs.readFileSync(path.join(ROOT, 'assets', 'app.js'), 'utf8');
const STYLE = fs.readFileSync(path.join(ROOT, 'assets', 'style.css'), 'utf8');
const SYNC = fs.readFileSync(path.join(ROOT, 'assets', 'sync.js'), 'utf8');
const RULES = fs.readFileSync(path.join(ROOT, 'firestore.rules'), 'utf8');
const DATA = fs.readFileSync(path.join(ROOT, 'assets', 'data.js'), 'utf8');
const INDEX = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const DOCS_INDEX = fs.readFileSync(path.join(ROOT, 'start', 'index.html'), 'utf8');
const GUIDE = fs.readFileSync(path.join(ROOT, 'start', 'getting-started.html'), 'utf8');
const UPDATES = fs.readFileSync(path.join(ROOT, 'start', 'updates.html'), 'utf8');
const PRODUCT_POLICY = fs.readFileSync(path.join(ROOT, 'docs', 'PRODUCT_POLICY.md'), 'utf8');
const DOCS_STYLE = fs.readFileSync(path.join(ROOT, 'start', 'site.css'), 'utf8');
const PACKAGE = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const PACKAGE_LOCK = JSON.parse(fs.readFileSync(path.join(ROOT, 'package-lock.json'), 'utf8'));
const MANIFEST = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.webmanifest'), 'utf8'));

test('メッセージは両画面で新しい順に表示し、初回表示では新着印を付ける', ()=>{
  const messagesSource = grab(APP, 'messages');
  assert.match(messagesSource, /String\(b\.at\|\|''\)\.localeCompare\(String\(a\.at\|\|''\)\)/,
    '新しい時刻から並べること');
  assert.match(messagesSource, /\.slice\(0, MESSAGES_MAX\)/,
    '新しい3件を残すこと');
  assert.match(grab(APP, 'messageListHTML'), /message-new-dot/,
    '保護者画面にも新着印を出すこと');
  assert.match(grab(APP, 'parentMessageHTML'), /message-new-dot/,
    '子ども画面にも新着印を出すこと');
});

test('共有の起動時はキャッシュだけで止まらずサーバーも確認する', ()=>{
  const watch = grab(SYNC, 'watchHousehold');
  assert.match(watch, /refreshFromServer\(\)/,
    '起動時にサーバーの最新 state を読むこと');
  const refresh = grab(SYNC, 'refreshFromServer');
  assert.match(refresh, /getDocFromServer\(ref\)/,
    '通信できる端末はサーバーの確定データを読むこと');
  assert.match(refresh, /catch\(e\)\{ return false; \}/,
    '完全オフライン時はキャッシュ起動を妨げないこと');
});

test('保護者トップから共有データを手動で更新できる', ()=>{
  assert.match(grab(APP, 'viewParent'), /id="parentSyncRefresh"/);
  assert.match(grab(APP, 'bindAdultNav'), /S\.refresh\(\)/);
  assert.match(SYNC, /refresh: refreshFromServer/);
});

test('保護者ナビは起動URLが残っていても設定ページへ移動できる', ()=>{
  const nav = grab(APP, 'bindAdultNav');
  assert.match(nav, /\$\$\('\.pagenav-item'\)/,
    '保護者用の各ページリンクを明示して扱うこと');
  assert.match(nav, /if\(routeFromHash\(\) === target\)\{[\s\S]{0,80}tab = target;[\s\S]{0,80}render\(\)/,
    '起動時の #config が残り hashchange しない場合も表示を切り替えること');
});

test('子どもの最終記録時刻は親の同期確認と混ざらず、新しい値を残す', ()=>{
  const merged = appFns.mergeState(
    state({ childActivityAt:1718436000000 }),
    state({ childActivityAt:1718522400000 }),
    true
  );
  assert.equal(merged.childActivityAt, 1718522400000);
  assert.match(grab(APP, 'saveSt'), /getLocal\(K_ROLE\) === 'child'/,
    '子ども端末の保存だけを最終記録時刻にすること');
  assert.match(grab(APP, 'childActivityText'), /こども 最終記録/);
  assert.match(grab(APP, 'viewParent'), /pstat-child-updated/);
  assert.match(STYLE, /\.icon-btn\.pstat-refresh\{[\s\S]{0,180}width:44px; height:44px[\s\S]{0,160}background:transparent; border:0/,
    '更新ボタンは44pxのタップ領域を保ち、背景と枠を出さないこと');
  assert.match(STYLE, /\.icon-btn\.pstat-refresh \.codex-icon\{ width:12px; height:12px; \}/,
    '更新の印だけは小さくすること');
  assert.match(grab(APP, 'viewParent'), /<div class="pstat-wrap">[\s\S]*<section class="paper pstat">[\s\S]*<\/section>[\s\S]*pstat-child-updated[\s\S]*<\/div>[\s\S]*\$\{parentMessageEditorHTML\(\)\}/,
    '子どもの最終記録は進捗枠の外側、メッセージ見出しの直前に置くこと');
  assert.match(STYLE, /\.pstat-child-updated\{[\s\S]{0,100}position:absolute; right:8px; bottom:-13px[\s\S]{0,100}font-size:8px/);
});

test('任意質問は回答ごとに保存・再表示し、シート外では閉じない', ()=>{
  const open = grab(APP, 'openSheet');
  const one = grab(APP, 'saveQuestionAnswer');
  const all = grab(APP, 'saveQuestionAnswers');
  assert.match(open, /const row = questionAnswerRow\(t\);\s*\n\s*const savedAnswers = row\.answers;/,
    '保存済み回答を入力欄へ出すこと');
  assert.match(open, /data-save-q="\$\{i\}"[\s\S]*この答えを ほぞん/,
    '質問ごとに保存ボタンを出すこと');
  assert.match(one, /まえの 答えを かきかえます。いいですか？/,
    '既存回答の上書きは確認すること');
  assert.match(grab(APP, 'saveQuestionAnswerRow'), /state\.questionAnswers\[t\.id\] = row/,
    '保存した回答を課題ごとに残すこと');
  assert.match(one, /if\(!next && !old\)\{ toast\('答えを 書いてから ほぞんしてね'\); return false; \}/,
    '空欄は保存済みとせず、入力を促すこと');
  assert.match(grab(APP, 'questionAnswerRow'), /K_QUESTION_ANSWERS/,
    '端末内の控えからも保存済み回答を再表示できること');
  assert.match(grab(APP, 'mergeState'), /out\.questionAnswers = \{\}/,
    '共有時にも質問回答を統合すること');
  assert.match(APP, /if\(e\.target\.id === 'sheetBack'\) return;/,
    'シート外のタップで入力を消さないこと');
  assert.match(STYLE, /\.sheet-open \.scroll\{ overflow:hidden; overscroll-behavior:none; touch-action:none; \}/,
    '記録シート中は背景をスクロールしないこと');
  assert.match(STYLE, /\.sheet-body\{[^}]*overflow-y:auto/,
    '長い記録はシート内でスクロールできること');
});

test('旧版で記録した任意質問の答えを記録本文から再表示する', ()=>{
  const legacy = new Function('state', `${grab(APP, 'legacyQuestionAnswers')} return legacyQuestionAnswers;`)({
    logs:[{ taskId:'observe', at:'2026-08-16T10:00:00.000Z', memo:'・色はどうだった？\n　→ あかかった\n・形は？\n　→ まるかった' }]
  });
  assert.deepEqual(legacy({ id:'observe', questions:['色はどうだった？', '形は？'] }), ['あかかった', 'まるかった']);
  assert.match(grab(APP, 'questionAnswerRow'), /legacyQuestionAnswers\(t\)/,
    '専用保存前の記録も入力欄へ出すこと');
});

/* 疎配列の length は「最後に埋めた添字＋1」なので、歯抜けのまま
   質問数に達する。新しい記録で後半だけ埋まると、古い記録の前半を
   読まずに打ち切ってしまう不具合を防ぐ。 */
test('何回かに分けて記録した任意質問の答えを、ぜんぶ入力欄へ出す', ()=>{
  const questions = Array.from({length:11}, (_,i)=> 'しつもん' + (i+1));
  const block = (from, to)=> questions.slice(from, to)
    .map((q,i)=> '・' + q + '\n　→ こたえ' + (from + i + 1)).join('\n');
  const legacy = new Function('state', `${grab(APP, 'legacyQuestionAnswers')} return legacyQuestionAnswers;`)({
    logs:[
      { taskId:'jiyu', at:'2026-08-14T01:00:00.000Z', memo:block(0, 7) },
      { taskId:'jiyu', at:'2026-08-15T01:00:00.000Z', memo:block(7, 11) }
    ]
  });
  assert.deepEqual(legacy({ id:'jiyu', questions }),
    questions.map((q,i)=> 'こたえ' + (i+1)),
    '新しい記録で後半が埋まっても、古い記録の前半まで読むこと');
});

test('専用欄に一部だけ保存していても、残りの問は旧記録から補う', ()=>{
  const row = questionAnswerRowFn({
    logs:[{ taskId:'jiyu', at:'2026-08-14T01:00:00.000Z',
            memo:'・しつもん1\n　→ ふるい1\n・しつもん2\n　→ ふるい2' }],
    questionAnswers:{ jiyu:{ answers:['', 'あたらしい2'], at:200 } }
  });
  const out = row({ id:'jiyu', questions:['しつもん1', 'しつもん2'] });
  assert.deepEqual(out.answers, ['ふるい1', 'あたらしい2'],
    '空の欄だけ旧記録で補い、保存済みの答えは残すこと');
  assert.deepEqual(out.kept, [true, true],
    '旧記録から出した答えも「のこっている」として画面に出すこと');
  assert.deepEqual(out.stored, [false, true],
    '専用欄に入っているかは、移しかえの判断のためだけに持つこと');
});

test('のこっている答えは印で示し、書きかえた問だけボタンを出す', ()=>{
  const open = grab(APP, 'openSheet');
  assert.match(open, /<span class="q-done"\$\{row\.kept\[i\] \? '' : ' hidden'\}>✓ ほぞんずみ<\/span>/,
    'のこっている答えはボタンでなく印で示すこと');
  assert.match(open, /<button class="btn btn-sm q-save" data-save-q="\$\{i\}" type="button" hidden>/,
    'することが無いうちはボタンを出さないこと');
  const refresh = grab(APP, 'refreshQuestionSaveState');
  assert.match(refresh, /btn\.hidden = st !== 'dirty';/,
    '書きかえた問だけボタンを出すこと');
  assert.match(refresh, /if\(done\) done\.hidden = st !== 'saved';/,
    'のこっている問だけ印を出すこと');
  const st = grab(APP, 'questionState');
  assert.match(st, /if\(now !== base\) return 'dirty';/);
  assert.match(st, /return now \? 'saved' : 'empty';/,
    '旧記録から出した答えも「のこっている」として扱うこと');
  assert.match(APP, /document\.addEventListener\('input'[\s\S]{0,160}refreshQuestionSaveState/,
    '入力のたびに表示を更新すること');
  assert.match(grab(APP, 'saveQuestionAnswer'), /markQuestionSaved\(index, next\);/,
    '保存できたらその場で表示を切り替えること');
  assert.match(grab(APP, 'saveQuestionAnswer'), /if\(next === old && already\)\{ toast\('この答えは ほぞんずみだよ'\); return true; \}/,
    '旧記録から出しただけの答えは、同じ内容でも専用欄へ移せること');
  assert.match(STYLE, /\.q-actions\{[^}]*align-items:center[^}]*gap:8px/,
    'そえ書きとボタンをとなりどうしに置くこと');
  assert.match(STYLE, /\.q-done\{/);
});

test('答えの上書き確認は1回にまとめ、とじる前に未保存を知らせる', ()=>{
  const all = grab(APP, 'saveQuestionAnswers');
  assert.doesNotMatch(all, /\.some\(\(v,i\)=>[\s\S]*confirm\(/,
    '問ごとに確認を出さないこと');
  assert.match(all, /const over = changed\.map\(\(c, i\)=> c && String\(before\.answers\[i\] \|\| ''\) \? i \+ 1 : 0\)\.filter\(Boolean\);/,
    '書きかわる問の番号をまとめること');
  assert.match(all, /confirm\('しつもん ' \+ over\.join\('・'\) \+ ' の 答えを かきかえます。いいですか？'\)/,
    '1回の確認で対象の問を示すこと');
  const leave = grab(APP, 'confirmLeaveSheet');
  assert.match(leave, /ほぞんして いない 答え（しつもん/,
    'とじる前に未保存の問を知らせること');
  assert.match(APP, /if\(!confirmLeaveSheet\(\)\) return;\s*\n\s*closeSheet\(\); return;/,
    '×では未保存を確認してから閉じること');
  assert.match(APP, /e\.key === 'Escape' && !\$\('#sheetWrap'\)\.hidden && confirmLeaveSheet\(\)/,
    'Escでも未保存を確認すること');
  assert.match(grab(APP, 'saveSheet'), /if\(!saveQuestionAnswers\(true\)\) return;/,
    '「きろく」は答えもまとめて保存するので、別の確認を足さないこと');
});

function questionAnswerRowFn(st){
  return new Function('state', 'getLocal', 'K_QUESTION_ANSWERS', 'ms',
    `${grab(APP, 'legacyQuestionAnswers')} ${grab(APP, 'questionAnswerRow')} return questionAnswerRow;`
  )(st, ()=> '{}', 'k', v=> Number(v) || 0);
}

function grab(src, name){
  const re = new RegExp('(?:async\\s+)?function\\s+' + name + '\\s*\\(');
  const match = re.exec(src);
  if(!match) throw new Error('関数が見つかりません: ' + name);
  const head = match.index;
  const open = src.indexOf('{', head);
  let depth = 0, quote = '', lineComment = false, blockComment = false, escape = false;
  for(let i=open; i<src.length; i++){
    const ch = src[i], next = src[i+1];
    if(lineComment){ if(ch === '\n') lineComment = false; continue; }
    if(blockComment){ if(ch === '*' && next === '/'){ blockComment = false; i++; } continue; }
    if(quote){
      if(escape){ escape = false; continue; }
      if(ch === '\\'){ escape = true; continue; }
      if(ch === quote) quote = '';
      continue;
    }
    if(ch === '/' && next === '/'){ lineComment = true; i++; continue; }
    if(ch === '/' && next === '*'){ blockComment = true; i++; continue; }
    if(ch === "'" || ch === '"' || ch === '`'){ quote = ch; continue; }
    if(ch === '{') depth++;
    if(ch === '}' && --depth === 0) return src.slice(head, i + 1);
  }
  throw new Error('閉じ括弧が見つかりません: ' + name);
}

const APP_NAMES = [
  'emptyState', 'normalizeState', 'ms', 'deepCopy', 'mergeById',
  'pickStamped', 'mergeProgress', 'mergeState', 'resetState',
  'canon', 'sameState', 'stripLocal', 'cacheBustURL', 'homeInstallPlatform', 'clamp', 'dailyCountSelection',
  'parentShareSummary', 'defaultTitleFor', 'isGeneratedTitle', 'logByLabel',
  'isBook', 'isSheetCount', 'countUsesCircle', 'bookCountUnit', 'bookOrdinal'
];
const appFns = new Function('location', `
  const SCHEMA=6, TRASH_MAX=50, GONE_MAX=300, MESSAGES_MAX=3, READS_MAX=400;
  ${APP_NAMES.map(n=>grab(APP, n)).join('\n')}
  return { ${APP_NAMES.join(',')} };
`)({ href:'https://example.test/app/index.html' });

function state(patch){
  return Object.assign(appFns.emptyState(), patch || {});
}

test('旧版の負タイムスタンプでも読書ゆうびんのチェックを救い、壊れた時刻を除く', ()=>{
  const good = 1786312076482;
  const bad = good | 0;
  const child = { 'dokusho-yubin': { steps:[true,false], stepsAt:[bad,0] } };
  const merged = appFns.mergeProgress({}, child, false);
  assert.deepEqual(merged['dokusho-yubin'].steps, [true,false]);
  assert.equal(merged['dokusho-yubin'].stepsAt, undefined);
});

test('正常な新時刻の訂正は従来どおり勝つ', ()=>{
  const good = 1786312076482;
  const child = { t:{ steps:[true], stepsAt:[good] } };
  const parent = { t:{ steps:[false], stepsAt:[good + 1000] } };
  assert.deepEqual(appFns.mergeProgress(parent, child, false).t.steps, [false]);
});

test('時刻なし同士は進んだ値を残し、done・days・wrapにも適用する', ()=>{
  const a = { t:{ done:0, days:{'2026-08-10':0}, wrap:[false] } };
  const b = { t:{ done:2, days:{'2026-08-10':1}, wrap:[true] } };
  const p = appFns.mergeProgress(a, b, false).t;
  assert.equal(p.done, 2);
  assert.equal(p.days['2026-08-10'], 1);
  assert.deepEqual(p.wrap, [true]);
});

test('受信した設定は送信時刻で記録し、遅れて届く新しい毎日の項目を取りこぼさない', ()=>{
  const storage = new Map([['natsu.savedAt.v1', JSON.stringify({config:100})]]);
  const harness = new Function('localStorage', `
    let config={ tasks:[], theme:'notebook' }, state={};
    const K_AT='natsu.savedAt.v1', K_CFG='natsu.config.v2', K_WELCOME_THEME='natsu.welcome.theme.v1', K_WELCOME_JOIN='natsu.welcome.join.v1';
    const THEME_IDS=['notebook','sunny','soda','berry','block','cat'];
    function getLocal(k){ return localStorage.getItem(k) || ''; }
    function saveCfg(){}
    function traceConfig(){}
    function markSaved(){}
    function syncPush(){}
    function ms(v){ const n=Number(v); return Number.isFinite(n) && n>0 ? n : 0; }
    function normalizeConfig(v){ return v; }
    function applyTheme(){}
    function render(){}
    ${grab(APP, 'savedAt')}
    ${grab(APP, 'markReceivedAt')}
    ${grab(APP, 'applyRemote')}
    return { applyRemote, config:()=>config, stamp:()=>savedAt().config };
  `)({
    getItem:key => storage.get(key) || null,
    setItem:(key,value) => storage.set(key, String(value))
  });
  harness.applyRemote({ config:{tasks:[],theme:'notebook'}, configAt:200 });
  assert.equal(harness.stamp(), 200);
  harness.applyRemote({ config:{tasks:[{id:'daily-1',group:'daily'}],theme:'notebook'}, configAt:250 });
  assert.equal(harness.config().tasks[0].id, 'daily-1');
});

test('1件削除の墓標はどちら向きの合流でも古い履歴を復活させない', ()=>{
  const log = { id:'l1', at:'2026-08-10T01:00:00.000Z', what:'done' };
  const deleted = state({ gone:[{id:'l1', at:1000}] });
  const stale = state({ logs:[log] });
  const forward = appFns.mergeState(deleted, stale, true);
  const reverse = appFns.mergeState(stale, deleted, false);
  assert.deepEqual(forward.logs, []);
  assert.deepEqual(reverse.logs, []);
  assert.equal(forward.gone[0].id, 'l1');
  assert.equal(appFns.sameState(forward, deleted), true);
  assert.equal(appFns.sameState(appFns.stripLocal(forward), appFns.stripLocal(stale)), false);
});

test('全削除の世代は古い端末の履歴と進捗を破棄し、同期後の新記録は残す', ()=>{
  const old = state({
    logs:[{id:'l-old', at:'2026-08-10T01:00:00.000Z'}],
    books:[{id:'b-old', date:'2026-08-10'}],
    progress:{t:{done:3, doneAt:100}}
  });
  const wiped = appFns.resetState(2000);
  for(const merged of [
    appFns.mergeState(wiped, old, true),
    appFns.mergeState(old, wiped, false)
  ]){
    assert.equal(merged.resetAt, 2000);
    assert.deepEqual(merged.logs, []);
    assert.deepEqual(merged.books, []);
    assert.deepEqual(merged.progress, {});
  }

  const after = state({ resetAt:2000, logs:[{id:'l-new', at:'2026-08-10T02:00:00.000Z'}] });
  assert.deepEqual(appFns.mergeState(wiped, after, false).logs.map(x=>x.id), ['l-new']);
});

test('更新URLは既存引数とhashを保ち、rを1個の新しい値へ置き換える', ()=>{
  const out = appFns.cacheBustURL(
    'https://example.test/app/?join=abc&r=old&r=older&openExternalBrowser=1#config', 12345
  );
  const url = new URL(out, 'https://example.test');
  assert.equal(url.pathname, '/app/');
  assert.equal(url.searchParams.get('join'), 'abc');
  assert.deepEqual(url.searchParams.getAll('r'), ['12345']);
  assert.equal(url.searchParams.get('openExternalBrowser'), '1');
  assert.equal(url.hash, '#config');
});

test('ホーム画面への追加案内はOSごとに安全な手順へ切り替わる', ()=>{
  assert.equal(appFns.homeInstallPlatform('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)', 0), 'ios');
  assert.equal(appFns.homeInstallPlatform('Mozilla/5.0 (Linux; Android 15; Pixel)', 0), 'android');
  assert.equal(appFns.homeInstallPlatform('Mozilla/5.0 (Macintosh; Intel Mac OS X)', 5), 'ios');
  assert.equal(appFns.homeInstallPlatform('Mozilla/5.0 (Windows NT 10.0; Win64; x64)', 0), 'desktop');
});

test('毎日の項目は6回以上を任意入力でき、0〜5の選択もそのまま使える', ()=>{
  assert.equal(appFns.dailyCountSelection(5, '6'), 6);
  assert.equal(appFns.dailyCountSelection(5, '12'), 12);
  assert.equal(appFns.dailyCountSelection(4, ''), 4);
  assert.equal(appFns.dailyCountSelection(4, '5'), 4);
  assert.equal(appFns.dailyCountSelection(4, '150'), 99);
  assert.match(STYLE, /grid-template-columns:repeat\(6,minmax\(0,1fr\)\)/,
    '0〜5の回数を同じ幅の6列に並べること');
  assert.match(APP, /6回以上のときは、何回できたか 入れてね。/,
    '6回以上では具体的な回数入力を促すこと');
  assert.match(APP, /applyReadingDisplay\(\$\('#sheetWrap'\)\)/,
    '記録シートを開いた後も学年別のかな表示を適用すること');
  assert.match(STYLE, /\.daily-more input\{[\s\S]*min-height:76px[\s\S]*font-size:30px/,
    '6回以上の入力欄と例の数字は1〜5ボタンと同じ大きさにすること');
  assert.match(APP, /DEBUG_WELCOME_ROLE === 'welcome-parent'/,
    '初期設定の確認用URLを保護者用・子ども用に分けること');
  const tasks = grab(APP, 'viewTasks');
  assert.match(tasks, /学習アプリ・音読・おてつだい・日記やメモなどに使えます。/,
    '毎日の項目の説明は表示切替の下で、用途を具体的に案内する');
  assert.doesNotMatch(tasks, /毎日くりかえす項目です。上へ・下へで順番を変更できます。/,
    '毎日の項目では下段の重複した説明を出さない');
});

test('読書と枚数の記録は丸数字を使わず、数える単位を質問に含める', ()=>{
  assert.equal(appFns.countUsesCircle({type:'count', numbered:true, unit:'ばん'}), true);
  assert.equal(appFns.countUsesCircle({type:'count', numbered:true, unit:'まい'}), false);
  assert.equal(appFns.countUsesCircle({type:'count', numbered:true, unit:'枚'}), false);
  assert.equal(appFns.countUsesCircle({type:'count', recordStyle:'book', numbered:true, unit:'さつ'}), false);
  assert.match(APP, /何.*unitAdult.*目までやった？/,
    '枚で数える記録では何枚目までかを尋ねること');
  assert.equal(appFns.bookCountUnit(false, 0), 'さつ');
  assert.equal(appFns.bookCountUnit(false, 2), 'さつ');
  assert.equal(appFns.bookCountUnit(false, 9), '冊');
  assert.equal(appFns.bookCountUnit(true, 0), '冊');
  assert.equal(appFns.bookOrdinal(10, false, 0), '10さつ目');
  assert.equal(appFns.bookOrdinal(10, false, 9), '10冊目');
  assert.equal(appFns.bookOrdinal(10, true, 0), '10冊目');
  assert.doesNotMatch(APP, /何冊目の本？/,
    '読書シートで何冊目かを重ねて尋ねないこと');
  assert.match(APP, /book-nth"><strong>\$\{bookOrdinal\(nth\)\}の本/,
    '子どもの読書シートは「10冊目の本」の形で示すこと');
  assert.match(APP, /book-no">\$\{bookOrdinal\(b\.nth, true\)\}/,
    '保護者の読書一覧は1冊目、2冊目と表示すること');
  assert.match(APP, /book-no">\$\{bookOrdinal\(b\.nth\)\}/,
    '子どもの読書一覧は漢字設定に応じて冊目・さつ目を出すこと');
});

test('初期タイトルは子どもの名前に合わせ、未入力ならしゅくだいノートにする', ()=>{
  assert.equal(appFns.defaultTitleFor('はな'), 'はなの夏休みの宿題');
  assert.equal(appFns.defaultTitleFor(''), 'しゅくだいノート');
  assert.equal(appFns.isGeneratedTitle('はな の なつやすみの しゅくだい'.replace('はな ', 'はな'), 'はな'), true);
  assert.equal(appFns.isGeneratedTitle('わが家の予定', 'はな'), false);
});

test('保護者ページの共有表示は子ども端末を最優先し、総台数を出さない', ()=>{
  const rows = [
    {id:'parent-1', role:'parent'},
    {id:'child-1', role:'child', name:'はな'}
  ];
  assert.deepEqual(appFns.parentShareSummary(rows, 'parent-1', ''), {
    state:'child', full:'はなと共有中', short:'はなと共有中'
  });
  assert.equal(appFns.parentShareSummary([{id:'parent-1', role:'parent'}], 'parent-1', '').state, 'waiting');
});

test('同梱QRライブラリが招待URLをSVG化できる', ()=>{
  const sandbox = {};
  vm.runInNewContext(fs.readFileSync(path.join(ROOT, 'assets', 'vendor', 'qrcode.js'), 'utf8'), sandbox);
  const qr = sandbox.qrcode(0, 'M');
  qr.addData('https://example.test/?join=abcdefgh&r=123&openExternalBrowser=1');
  qr.make();
  const svg = qr.createSvgTag({cellSize:4, margin:16, scalable:true, title:'QR'});
  assert.match(svg, /<svg/);
  assert.match(svg, /viewBox=/);
  assert.match(svg, /role="img"/);
});

/* 暗号化の部品。sync.js の本物をそのまま持ちこむので、
   実装が変わればテストも一緒に動く。 */
const CRYPTO_PARTS = "let cryptoKey=null, cryptoKeyCode='';\nconst ENC_PREFIX='v1:'; const ENC_ITERATIONS=250000;\n"
  + ['normalizeCode','sha256Bytes','deriveKey','bytesToBase64','base64ToBytes','encryptField','isCiphertext']
      .map(n=>grab(SYNC, n)).join('\n');

test('接続前の保留送信は初回snapshot後に再開できる', async ()=>{
  const names = ['flushPendingSoon', 'flush'];
  const harness = new Function('crypto', 'TextEncoder', 'btoa', `
    let docRef=null, pushTimer=null, pending={config:false,state:true};
    let pendingVersion={config:0,state:1};
    let writes=0, last=null;
    const window={NatsuApp:{current:()=>({config:{},state:{logs:[]}})}};
    const Sync={_fs:{setDoc:async(_ref,payload)=>{ writes++; last=payload; }}};
    function getDeviceId(){ return 'device-1'; }
    function getCode(){ return 'abcdefghjkmnpqrs'; }
    function setStatus(){}
    function persistPending(){}
    ${CRYPTO_PARTS}
    ${names.map(n=>grab(SYNC, n)).join('\n')}
    return {
      flush, flushPendingSoon,
      connect:()=>{ docRef={}; },
      writes:()=>writes,
      last:()=>last,
      pending:()=>Object.assign({},pending)
    };
  `)(webcrypto, TextEncoder, btoa);

  await harness.flush();
  assert.equal(harness.writes(), 0);
  assert.equal(harness.pending().state, true);
  harness.connect();
  harness.flushPendingSoon();
  /* 送信は 鍵を 作ってから。PBKDF2 は わざと 遅いので、
     決め打ちの 待ち時間では なく 書けるまで 待つ */
  for(let i=0; i<200 && harness.writes() === 0; i++){
    await new Promise(resolve=>setTimeout(resolve, 10));
  }
  assert.equal(harness.writes(), 1);
  assert.equal(harness.pending().state, false);

  /* 記録は 鍵を かけて 出す。時刻は そのまま（新旧の 判定に つかう） */
  const sent = harness.last();
  assert.match(sent.state, /^v1:/, '中身は暗号文で送ること');
  assert.equal(typeof sent.stateAt, 'number', '時刻は平文のままにすること');
  assert.doesNotMatch(sent.state, /logs/, '平文が混ざらないこと');
});

test('Firestore書き込み失敗時は送信予約を失わない', async ()=>{
  const harness = new Function('crypto', 'TextEncoder', 'btoa', `
    let docRef={}, pushTimer=null, pending={config:false,state:true};
    let pendingVersion={config:0,state:1};
    const window={NatsuApp:{current:()=>({config:{},state:{logs:[]}})}};
    const Sync={_fs:{setDoc:async()=>{ throw new Error('offline'); }}};
    function getDeviceId(){ return 'device-1'; }
    function getCode(){ return 'abcdefghjkmnpqrs'; }
    function setStatus(){}
    function persistPending(){}
    ${CRYPTO_PARTS}
    ${grab(SYNC, 'flush')}
    return { flush, pending:()=>Object.assign({},pending) };
  `)(webcrypto, TextEncoder, btoa);
  await harness.flush();
  assert.equal(harness.pending().state, true);
});

test('合言葉を入れ直した端末の再登録は「はずす」印を解除する', ()=>{
  const harness = new Function(`
    const window={NatsuApp:{deviceInfo:()=>({role:'parent',name:'子',label:'母',ver:'test'})}};
    ${grab(SYNC, 'deviceInfo')}
    return deviceInfo;
  `)();
  assert.equal(harness().revoked, false);
});

test('共有コードはFirestoreの文書IDに平文で置かない', async ()=>{
  const house = new Function('crypto', 'TextEncoder', `
    ${grab(SYNC, 'normalizeCode')}
    ${grab(SYNC, 'sha256Bytes')}
    ${grab(SYNC, 'houseIdFor')}
    return { houseIdFor };
  `)(webcrypto, TextEncoder);
  const code = 'abcdefghjkmnpqrs';
  const secure = await house.houseIdFor(code);
  assert.match(secure, /^[0-9a-f]{64}$/);
  assert.notEqual(secure, code);
  assert.equal(await house.houseIdFor(code.toUpperCase()), secure);
  assert.match(SYNC, /if\(snap\.metadata\.fromCache\) return/);
  /* 旧方式（合言葉をそのまま文書IDにする版）は廃止した。
     鍵のない旧文書は読めないので、読み取りだけ残しても
     「見つかったのに読めない」になる。 */
  assert.doesNotMatch(SYNC, /legacyHouseIdFor|hashPart|mayUseLegacy/,
    '旧方式の探索を残さないこと');
});

test('保護者画面の案内は実際の保存方式と操作先を明示する', ()=>{
  /* 中身を暗号化したので、案内も実態に合わせる。
     鍵は合言葉からしか作れない＝全端末で忘れたら復元できないことも書く。 */
  assert.match(APP, /保存の前にこの端末で暗号化するため、保管しているサーバー側では中身を読めません/);
  assert.match(APP, /合言葉をすべての端末で忘れると、クラウド上の記録は誰にも復元できません/);
  assert.doesNotMatch(APP, /エンドツーエンド暗号化されません/);
  assert.match(APP, /普段使っているパスワードや秘密の言葉を使わない/);
  assert.match(APP, /function parentTodayLogsHTML\(/);
  assert.match(APP, /if\(confirm\('子ども画面へ移動します/);
});

test('メッセージと注意事項のUIは狭幅・横幅の役割を分ける', ()=>{
  assert.match(APP, /class="paper parent-message-stack"/,
    '子ども画面の複数メッセージを1つの枠にまとめること');
  assert.match(APP, /parent-message-text[\s\S]{0,300}parent-message-send/,
    '送信ボタンをテキスト欄と同じgrid行へ置くこと');
  assert.match(APP, /送信後、ここに表示されます。/,
    '未送信時の文を短くすること');
  assert.match(APP, /data-share-safety/, '注意事項をクリックして確認できること');
  assert.match(APP, /confirmShareSafety\(\)/, '接続前にも注意事項を確認すること');
  assert.match(APP, /id="welcomeCode"[\s\S]{0,900}privacyNoteHTML\(\)/,
    '初期設定では合言葉欄の直後に注意事項を置くこと');
  assert.match(APP, /どの端末からも更新が90日間ない場合に削除対象となり、管理者が確認して削除します/,
    '共有データの手動削除条件を登録時に明記すること');
  assert.match(APP, /見るだけでは期間は延びません。端末だけのデータと書き出したファイルは対象外です/,
    '閲覧と端末内利用を90日の対象から区別すること');
  assert.match(STYLE, /\.set-note\.retention-note\{[\s\S]{0,100}font-size:12px/,
    '登録画面を圧迫しない小さな注記にすること');
  assert.match(APP, /id="logCareSection"[\s\S]{0,160}class="paper log-care-paper"/,
    '記録の手入れの内側だけに、ほかの設定枠と同じ余白を設けること');
});

/* 長い手順を書くかわりに、その場から飛ばす。飛び先が長いページなので、
   着いた先までスクロールしないと意味がない。飛び先の id が消えたら気づけること。 */
test('注記からの案内は、設定ページの該当箇所まで寄せる', ()=>{
  const jumps = [
    { name:'記録の注記',   anchor:"closest('#logCareJump')", target:'#logCareSection' },
    { name:'共有バッジ',   anchor:'badge.onclick',           target:'#syncSection' }
  ];
  for(const { name, anchor, target } of jumps){
    const at = APP.indexOf(anchor);
    assert.notEqual(at, -1, name + ' の処理が見つからない（' + anchor + '）');
    assert.match(APP.slice(at, at + 400), new RegExp('jumpTo\\(\'' + target + '\'\\)'),
      name + ' は ' + target + ' へ jumpTo すること');
    assert.match(APP, new RegExp('id="' + target.slice(1) + '"'),
      target + ' の id が実在すること');
  }

  /* #scroll だけが動く作りなので、scrollIntoView に戻さないこと */
  const jump = grab(APP, 'jumpToSection');
  assert.match(jump, /scrollBox\(\)/, '#scroll を動かすこと');
  assert.equal(/scrollIntoView/.test(jump), false, 'scrollIntoView を使わないこと');

  /* 飛び先は1回きり。次の描き直しで勝手に戻らないこと */
  assert.match(jump, /pendingJump = ''/, '飛んだら予約を消すこと');

  /* すでに有効なら、その案内は出さない */
  const note = APP.slice(APP.indexOf('parent-log-help'), APP.indexOf('parent-log-help') + 300);
  assert.match(note, /config\.allowLogDelete \? ''/, '有効なときは案内を出さないこと');
});

test('QR招待の共有コードはホーム画面版へ渡し、ホーム画面版でだけURLから消す', ()=>{
  function harness(standalone){
    const location = { search:'?join=abcdefghjkmnpqrs&r=9', pathname:'/app/', hash:'#home' };
    const history = { current:'', replaceState:(_,__,url)=>{ history.current = url; } };
    const api = new Function('location', 'history', 'cleanCode', 'isStandalone', `
      const JOIN_PARAM='join';
      ${grab(APP, 'joinCodeFromURL')}
      ${grab(APP, 'clearJoinCodeFromURL')}
      ${grab(APP, 'takeJoinCode')}
      return { takeJoinCode, replaced:()=>history.current };
    `)(location, history, value=>String(value || ''), ()=>standalone);
    return { code:api.takeJoinCode(), replaced:api.replaced() };
  }
  assert.deepEqual(harness(false), { code:'abcdefghjkmnpqrs', replaced:'' });
  assert.deepEqual(harness(true), { code:'abcdefghjkmnpqrs', replaced:'/app/?r=9#home' });
  assert.equal(Object.hasOwn(MANIFEST, 'start_url'), false);
  assert.match(INDEX, /manifest\.webmanifest\?v=20260812d/,
    '古い起動URL設定を持つマニフェストを再利用しないこと');
});

/* URLに join を残すようにしたぶん、「はずした端末」がリロードだけで
   勝手に戻れてしまわないかを固定する。
   ホーム画面版では起動URLそのものに join が焼きつくため、
   これが無いと はずしても 起動のたびに 復帰する。 */
test('はずされた端末は、招待URLを開き直しても勝手に戻らない', ()=>{
  const CODE = 'abcdefghjkmnpqrs';
  function harness(revokedFrom, chosen){
    let reconnected = '';
    const applyJoinCode = new Function(
      'location', 'history', 'cleanCode', 'isStandalone',
      'setLocal', 'K_ONBOARD', 'window', 'toast', 'render', 'routeFromHash',
      'forgetConfigStampForNewHousehold', 'getLocal', 'K_CODE_CHOSEN',
      'rememberChosenCode', 'chosen', `
      const JOIN_PARAM='join';
      ${grab(APP, 'joinCodeFromURL')}
      ${grab(APP, 'clearJoinCodeFromURL')}
      ${grab(APP, 'takeJoinCode')}
      let tab='welcome';
      ${grab(APP, 'applyJoinCode')}
      return applyJoinCode;
    `)(
      { search:'?join=' + CODE, pathname:'/app/', hash:'#home' },
      { replaceState:()=>{} },
      v => String(v || ''),
      () => false,
      ()=>{},
      'natsu.onboarding.v1',
      { NatsuSync:{ configured:()=>true, getCode:()=>'',
                    revokedCode:()=>revokedFrom,
                    reconnect:c => { reconnected = c; } } },
      ()=>{}, ()=>{}, ()=>'home', ()=>{},
      k => (k === 'natsu.sync.chosen.v1' ? chosen : ''),
      'natsu.sync.chosen.v1', ()=>{}, chosen
    );
    applyJoinCode();
    return reconnected;
  }
  assert.equal(harness(''), CODE, 'ふつうの招待は これまで通り つながる');
  assert.equal(harness(CODE), '', 'はずされた あいことばでは 自動で つなぎ直さない');
  assert.equal(harness('betsunoaikotoba'), CODE, 'べつのグループの はずし記録は じゃまをしない');
  const apply = grab(APP, 'applyJoinCode');
  assert.match(apply, /const code = joinCodeFromURL\(\);/,
    '同期の準備が終わる前に招待URLのコードを消さないこと');
  assert.match(apply, /S\.reconnect\(code, \{ joining:true \}\);\s*if\(isStandalone\(\)\) clearJoinCodeFromURL\(\);/,
    'ホーム画面版では接続開始後にだけ招待コードをURLから消すこと');
  assert.match(apply, /if\(tab === 'welcome'\)\{\s*tab = 'home';[\s\S]{0,100}location\.hash = 'home';/,
    '招待接続後は初期設定画面から、既存の端末役割選択を持つhome側へ切り替えること');

  /* はずされた あいことばのままでは、ホーム画面追加の案内も出さない
     （「引き継げる準備ができています」は この状態では うそになる） */
  const banner = new Function('location', 'cleanCode', 'isStandalone', 'window', `
    const JOIN_PARAM='join';
    ${grab(APP, 'joinCodeFromURL')}
    ${grab(APP, 'joinInstallTransferHTML')}
    return joinInstallTransferHTML;
  `)({ search:'?join=' + CODE }, v => String(v || ''), () => false,
     { NatsuSync:{ revokedCode:()=>CODE } });
  assert.equal(banner(), '', 'はずされた端末には 引き継ぎ案内を出さない');
});

/* 人が 手で 打ち直したら、はずし記録は 忘れること。
   忘れないと「はずす」が 永久追放になり、入れ直しができない */
test('あいことばを手で入れ直すと、はずし記録を忘れる', ()=>{
  const bind = grab(APP, 'bindSync');
  /* 参加・作成のどちらの入口でも、人が操作した時点で忘れること */
  const handlers = [...bind.matchAll(/S\.reconnect\(/g)];
  assert.ok(handlers.length >= 2, '設定画面には作成と参加の2つの入口があること');
  for(const m of handlers){
    assert.match(bind.slice(Math.max(0, m.index - 400), m.index), /forgetRevokedCode\(\)/,
      '設定画面から つなぐ ときは forgetRevokedCode() を呼ぶこと');
  }
  assert.match(SYNC, /forgetRevokedCode/, 'sync.js が forgetRevokedCode を出すこと');
  assert.match(SYNC, /rememberRevokedCode\(getCode\(\)\)/,
    'はずされた時点の あいことばを おぼえること');
});

/* 版は 20260810w → …z → aa → ab … と回る。文字としてならべると
   'w' > 'a' なので、1文字の古い版が2文字の新しい版に勝ってしまう。
   実機で「はじめiPad ver …w」が最新と判定され、実際に最新の
   「父PC ver …ai」に（古い）が付いていた。 */
test('版の新旧は、zをこえてaaに回ったあとも正しくならぶ', ()=>{
  const api = new Function(`
    ${grab(APP, 'verKey')}
    ${grab(APP, 'newestVer')}
    return newestVer;
  `)();

  assert.equal(api(['20260810w', '20260810ac', '20260810ai']), '20260810ai',
    '2文字の通しは1文字より新しい');
  assert.equal(api(['20260810z', '20260810aa']), '20260810aa', 'z の次は aa');
  assert.equal(api(['20260810a', '20260810b']), '20260810b', '同じ長さなら文字順');
  assert.equal(api(['20260809zz', '20260810a']), '20260810a', '日づけが先');
  assert.equal(api(['20260810ai']), '20260810ai', '1台だけならそれが最新');
  assert.equal(api([]), '', '版が無ければ空');

  /* 形のちがう版が混ざったら、まちがった（古い）を付けるより黙る */
  assert.equal(api(['20260810ai', '（不明）']), '', '形が合わなければ判定しない');

  /* newest が空のときに全台へ（古い）が付かないこと */
  const list = grab(APP, 'deviceListHTML');
  assert.match(list, /newest && r\.ver !== newest/,
    'newest が空のときは（古い）を付けないこと');
});

/* 初期設定は 名前を入れて saveCfg() を呼び、そのあとで つなぎにいく。
   受け取る前の初期値に「いま」の時刻が付くので、それがグループ全体に配られ、
   デザインも題名も消えていた。受け取るまでは時刻を押さないこと。 */
test('おうちの中身を受け取るまで、手元の設定を送らない', ()=>{
  const store = {};
  function harness(awaiting){
    let pushed = 0, stamped = 0;
    const api = new Function(
      'window', 'normalizeConfig', 'applyTheme', 'localStorage', 'K_CFG',
      'markSaved', 'syncPush', `
      let config = { theme:'notebook' };
      ${grab(APP, 'configHeldBack')}
      ${grab(APP, 'saveCfg')}
      return { saveCfg, saved:()=>localStorage.getItem(K_CFG) };
    `)(
      { NatsuSync:{ awaitingFirstSnapshot:()=>awaiting } },
      c => c, ()=>{},
      { getItem:k=>store[k], setItem:(k,v)=>{ store[k]=v; } },
      'natsu.config.v2',
      ()=>{ stamped++; }, ()=>{ pushed++; }
    );
    api.saveCfg();
    return { pushed, stamped, savedLocally: !!api.saved() };
  }

  assert.deepEqual(harness(true),  { pushed:0, stamped:0, savedLocally:true },
    '受け取る前は 手元にだけ 書き、時刻も押さず 送りもしない');
  assert.deepEqual(harness(false), { pushed:1, stamped:1, savedLocally:true },
    '受け取ったあとは これまで通り 保存して送る');
});

test('空のキャッシュはグループ設定を受信済みと数えない', ()=>{
  const watch = grab(SYNC, 'watchHousehold');
  const missing = watch.indexOf('if(!snap.exists())');
  const cacheReturn = watch.indexOf('if(snap.metadata.fromCache) return');
  const received = watch.indexOf('gotSnapshot = true');
  assert.ok(missing >= 0 && cacheReturn > missing && received > cacheReturn,
    '空のキャッシュを抜けた後だけ受信済みにすること');
});

/* よそで保存した時刻は、これから入るおうちの時刻とくらべても意味がない。
   0 に戻さないと、古い設定が「新しい」と判定されてグループ全体に配られる。 */
test('ちがうあいことばにつなぐとき、設定の保存時刻を0に戻す', ()=>{
  function harness(rememberedHouse, joining){
    const store = { 'natsu.savedAt.v1': JSON.stringify({ config:9999, state:8888 }) };
    if(rememberedHouse) store['natsu.config.house.v1'] = rememberedHouse;
    const st = { resetAt: 777 };
    const api = new Function('getLocal', 'setLocal', 'savedAt', 'localStorage',
                             'K_AT', 'K_CFG_HOUSE', 'K_ST', 'state', 'ms', `
      ${grab(APP, 'forgetConfigStampForNewHousehold')}
      return forgetConfigStampForNewHousehold;
    `)(
      k => store[k] || '', (k, v) => { store[k] = v; },
      () => JSON.parse(store['natsu.savedAt.v1'] || '{}'),
      { setItem:(k,v)=>{ store[k]=v; } },
      'natsu.savedAt.v1', 'natsu.config.house.v1', 'natsu.state.v2', st,
      v => Number(v) || 0
    );
    api(joining);
    return { at: JSON.parse(store['natsu.savedAt.v1']), resetAt: st.resetAt };
  }

  assert.deepEqual(harness('', 'aaaaaaaaaaaaaaaa').at, { state:8888 },
    'はじめて つなぐ ときは 設定の時刻を 落とす');
  assert.deepEqual(harness('bbbbbbbbbbbbbbbb', 'aaaaaaaaaaaaaaaa').at, { state:8888 },
    'べつの おうちに 移る ときも 落とす');
  assert.deepEqual(harness('aaaaaaaaaaaaaaaa', 'aaaaaaaaaaaaaaaa').at,
    { config:9999, state:8888 }, '同じ おうちなら そのまま');

  /* 「記録をすべて削除」の世代番号は、前のおうちあての印。
     のこしたまま入ると、入った先のおうちの記録がまるごと捨てられる */
  assert.equal(harness('bbbbbbbbbbbbbbbb', 'aaaaaaaaaaaaaaaa').resetAt, 0,
    'べつのおうちに移るとき、消した世代番号は手放すこと');
  assert.equal(harness('aaaaaaaaaaaaaaaa', 'aaaaaaaaaaaaaaaa').resetAt, 777,
    '同じおうちなら、消したことは伝えつづけること');

  /* 記録（state）の時刻は落とさない。値ごとに時刻を持って合流するので、
     落とすと せっかくの 進みぐあいが 安全側に 倒れてしまう */
  const src = grab(APP, 'forgetConfigStampForNewHousehold');
  assert.equal(/delete a\.state/.test(src), false, 'state の時刻は落とさないこと');
});

/* つなぎ直しの入口すべてで、時刻を戻してから reconnect すること */
test('つなぎ直しの入口すべてで、設定の保存時刻を戻してから接続する', ()=>{
  const calls = [...APP.matchAll(/S\.reconnect\(/g)];
  assert.equal(calls.length, 5, 'reconnect の呼び出しは5か所（初期設定・招待URL・QR・参加・作成）');
  for(const m of calls){
    const before = APP.slice(Math.max(0, m.index - 400), m.index);
    assert.match(before, /forgetConfigStampForNewHousehold\(/,
      'reconnect の直前で forgetConfigStampForNewHousehold を呼ぶこと');
  }
  assert.match(SYNC, /awaitingFirstSnapshot/, 'sync.js が受信済みかを出すこと');
  assert.match(SYNC, /gotSnapshot = true/, '最初のsnapshotで受信済みにすること');
});

test('初期設定の選択肢は、選んだものだけ色とチェックが残る', ()=>{
  const view = grab(APP, 'viewWelcome');
  const picker = grab(APP, 'welcomeRolePickerHTML');
  const bind = grab(APP, 'bindWelcome');
  assert.doesNotMatch(view, /btn btn-go welcome-role[^-]/,
    '使い方を選ぶ前から片方だけ緑にしない');
  assert.doesNotMatch(picker, /btn btn-go welcome-role/,
    '端末の役割を選ぶ前から片方だけ緑にしない');
  assert.match(view, /aria-pressed="false"/, '未選択状態を読み上げにも伝える');
  assert.match(picker, /aria-pressed="false"/, '役割の未選択状態も伝える');
  assert.match(bind, /classList\.toggle\('is-selected', selected\)/,
    '押した選択肢に選択中クラスを付ける');
  assert.match(bind, /setAttribute\('aria-pressed', String\(selected\)\)/,
    '押した選択肢を読み上げにも選択中と伝える');
  assert.match(STYLE, /\.welcome-role\[aria-pressed="true"\][\s\S]*background:var\(--wakaba\)/,
    '選択中は既存の緑で塗る');
  assert.match(STYLE, /content:"✓"/, '色だけでなくチェックでも選択を示す');
  assert.match(view, /class="welcome-parent-entry"[^>]*data-no-reading/,
    '初期設定の段階で大人向けの入口案内を表示すること');
  assert.match(view, /タイトルを<b>5回タップ<\/b>するか、<b>2秒長押し<\/b>/,
    '子ども画面から保護者ページを開く操作を明示すること');
  assert.match(view, /初めの準備[\s\S]*ホーム画面に追加[\s\S]*使い方を選ぶ/,
    '初期設定の入口は保護者にも読める通常の漢字表記にすること');
});

test('QRでつなぎ直した共有も、ホーム画面追加へ招待コードを渡す', ()=>{
  const code = 'abcdefghjkmnpqrs';
  const location = { origin:'https://example.test', pathname:'/app/', hash:'#home', moved:'', replace:url=>{ location.moved = url; } };
  const api = new Function('location', 'cleanCode', 'isStandalone', `
    const JOIN_PARAM='join';
    ${grab(APP, 'inviteURLForCode')}
    ${grab(APP, 'keepScannedInviteForHomeInstall')}
    return keepScannedInviteForHomeInstall;
  `)(location, value=>String(value || '').trim(), ()=>false);
  assert.equal(api(code), true);
  assert.match(location.moved, /^https:\/\/example\.test\/app\/\?join=abcdefghjkmnpqrs&r=\d+&openExternalBrowser=1#home$/,
    'Safariでホーム画面に追加する前に、実際の招待URLへ移動すること');

  const app = grab(APP, 'connectScannedInvite');
  assert.match(app, /S\.reconnect\(code, \{ joining:true \}\);[\s\S]{0,180}if\(keepScannedInviteForHomeInstall\(code, qrScanSender\)\) return;/,
    'QR接続を始めてから、ホーム画面追加用の招待URLへ移動すること');
});

test('まるつけ・なおしは担当を選べ、宿題全体のノルマにも入る', ()=>{
  const wrapFns = new Function('WRAP_LABELS', `
    ${grab(APP, 'hasWrap')}
    ${grab(APP, 'wrapOf')}
    ${grab(APP, 'withWrap')}
    return { withWrap };
  `)(['マルつけ', 'なおし']);
  const progress = wrapFns.withWrap(
    {type:'count', wrapUp:true}, {wrap:[true, false]},
    {done:5, total:5, pct:100, isDone:true}
  );
  assert.equal(progress.allDone, 6);
  assert.equal(progress.allTotal, 7);
  assert.equal(progress.allPct, 6 / 7 * 100);
  assert.match(APP, /function wrapMarkerBy\(t\)\{ return t && t\.wrapBy === 'child' \? 'child' : 'adult'; \}/);
  assert.match(APP, /function wrapLabelsFull\(t\)\{[\s\S]*マルつけする[\s\S]*マルつけして もらう/);
  assert.match(APP, /data-f="wrapBy"[\s\S]*おとな[\s\S]*こども/);
  assert.match(APP, /「マルつけ・なおし」の項目を表示/);
  assert.match(grab(APP, 'withWrap'), /r\.allTotal\s*=\s*r\.total \+ r\.wrap\.length/);
  assert.match(grab(APP, 'withWrap'), /r\.allPct\s*=\s*r\.allDone \/ r\.allTotal \* 100/);
  assert.match(grab(APP, 'overall'), /done \+= p\.allDone; total \+= p\.allTotal/);
  assert.match(grab(APP, 'taskHTML'), /p\.allPct\.toFixed\(1\)/);
  assert.match(grab(APP, 'viewParent'), /p\.allPct\.toFixed\(1\)/);
});

test('月の日数クイズは30日までの月を正しくたずねる', ()=>{
  assert.match(DATA, /q:'1年の中で、30日までの月は いくつ？'/);
  assert.match(DATA, /a:'4つ。4月、6月、9月、11月だよ。2月は28日か29日、のこりは31日。'/);
  assert.doesNotMatch(DATA, /30日 ある月は いくつ？/);
});

test('共有する初期設定は、端末とグループの状態に合わせて分岐する', ()=>{
  const form = grab(APP, 'welcomeFormHTML');
  const setup = grab(APP, 'welcomeShareSetupHTML');
  const picker = grab(APP, 'welcomeParentSharePickerHTML');
  const plan = grab(APP, 'welcomeParentConnectionPlanHTML');
  assert.match(picker, /data-parent-share="create"/, '保護者は新しいグループを作れる');
  assert.match(picker, /data-parent-share="join"/, '保護者は今あるグループにも参加できる');
  assert.match(setup, /inviteQrHTML\(url\)/, '保護者側にQRを表示する');
  assert.match(setup, /welcomeInviteUrl/, '離れた端末向けの招待リンクも表示する');
  assert.match(setup, /QRコードや招待リンクを受け取った場合/,
    '子ども側にもQR・招待リンクで参加できることを説明する');
  assert.match(plan, /welcomeShareSetupHTML\('parent', code\)/,
    '「今つなぐ」を選んだ場合だけQR付きの接続手順を組み立てる');
  assert.equal((setup.match(/<ol>/g) || []).length, 2,
    '子ども用と保護者用に、それぞれ1つの接続手順を持つ');
  assert.doesNotMatch(plan, /<ol>/,
    '「今つなぐ」の外枠で同じ接続手順を重ねない');
  assert.match(setup, /タイトルを5回タップ/,
    'すでに使っている子ども端末から保護者ページへ戻る方法を示す');
  assert.match(form, /readonly autocapitalize=/,
    '新しく作った合言葉は初期設定中に書き換えさせない');
  assert.match(form, /data-creating="no"/,
    '今あるグループへ参加する保護者を、合言葉の作成者と区別する');
  assert.match(form, /aria-label="確認した合言葉でこのグループに参加する"/,
    '子どもの最終操作も読み上げで接続先を明示する');
  assert.match(form, /id="welcomeStart"[\s\S]{0,180}hidden/,
    '接続確認前は参加ボタンを隠す');
});

test('子ども端末は合言葉を受け取るだけで、作成者向け注意事項を表示しない', ()=>{
  const make = new Function(`
    const window={NatsuSync:{configured:()=>true,makeCode:()=> 'abcdefghjkmnpqrs'}};
    const DEBUG_WELCOME=false, TEST_MODE=false, K_NAME='name', K_DEVICE_LABEL='label';
    function getLocal(){ return ''; }
    function esc(v){ return String(v == null ? '' : v); }
    function readingGrade(){ return 9; }
    function readingOptions(){ return '<option value="9">すべてひらがな</option>'; }
    function welcomeStepHTML(n,t,b){ return '<section data-step="'+n+'"><h3>'+t+'</h3>'+b+'</section>'; }
    function welcomeThemeHTML(n){ return welcomeStepHTML(n,'どの色が すき？',''); }
    function privacyNoteHTML(){ return '<aside data-share-safety>注意事項</aside>'; }
    function inAppBrowserNoteHTML(){ return ''; }
    function welcomeShareSetupHTML(role){ return '<div data-share-role="'+role+'"></div>'; }
    const navigator = { userAgent:'iPhone', maxTouchPoints:5 };
    ${grab(APP, 'deviceKindLabel')}
    ${grab(APP, 'alreadySetNoteHTML')}
    ${grab(APP, 'welcomeJoinCheckHTML')}
    ${grab(APP, 'deviceLabelFieldHTML')}
    ${grab(APP, 'welcomeParentCreateChoiceHTML')}
    ${grab(APP, 'welcomeFormHTML')}
    return (role,mode)=>welcomeFormHTML(role,true,4,mode);
  `)();
  const child = make('child', '');
  const create = make('parent', 'create');
  const join = make('parent', 'join');
  assert.doesNotMatch(child, /data-share-safety/, '子ども側に作成者向け注意事項を出さない');
  assert.doesNotMatch(child, /新しく合言葉を作る|自動作成/, '子ども側から合言葉を作らせない');
  assert.match(child, /例：子ども用iPad/, '子ども端末に父・母の例を出さない');
  assert.match(create, /data-share-safety/, '新しく作る保護者には注意事項を出す');
  assert.match(create, /readonly/, '新しく作る合言葉は自動作成する');
  assert.doesNotMatch(join, /data-share-safety/, '既存グループへ参加する保護者にも作成者向け注意を重ねない');
  assert.match(join, /placeholder="合言葉を入力"/, '既存グループへ参加するときは合言葉を入力する');
});

test('初期設定は選択したルートに応じて③以降を連番で示す', ()=>{
  const view = grab(APP, 'viewWelcome');
  const role = grab(APP, 'welcomeRolePickerHTML');
  const form = grab(APP, 'welcomeFormHTML');
  assert.match(view, /welcome-num">1/);
  assert.match(view, /welcome-num">2/);
  assert.match(role, /welcomeStepHTML\(3/,
    '共有ルートは③で端末の役割を選ぶ');
  assert.match(form, /const start = Number\(firstStep\) \|\| \(sharing \? 4 : 3\)/,
    '共有時は④、単独利用時は③から続きを始める');
  assert.match(form, /welcomeThemeHTML\(start\)/,
    '子どもルートでは最初の追加手順をデザイン選択にする');
  assert.match(form, /welcomeStepHTML\(start \+ 2, 'じゅんび できたよ'/,
    '単独利用も開始ボタンまで番号付きで案内する');
  assert.match(form, /welcomeStepHTML\(start \+ 2, 'おうちの きろくに つなごう'/,
    '共有する子ども端末も接続まで番号付きで案内する');
});

test('子どもが選んだデザインは、グループ設定の受信後に1度だけ反映する', ()=>{
  const storage = new Map([
    ['natsu.savedAt.v1', JSON.stringify({config:100})],
    ['natsu.welcome.theme.v1', JSON.stringify({code:'abcdefgh',theme:'berry'})]
  ]);
  let saved = 0;
  const harness = new Function('localStorage', 'onSave', `
    const window={NatsuSync:{getCode:()=> 'abcdefgh'}};
    let config={ tasks:[], theme:'notebook' }, state={};
    const K_AT='natsu.savedAt.v1', K_CFG='natsu.config.v2', K_WELCOME_THEME='natsu.welcome.theme.v1', K_WELCOME_JOIN='natsu.welcome.join.v1';
    const THEME_IDS=['notebook','sunny','soda','berry','block','cat'];
    function ms(v){ const n=Number(v); return Number.isFinite(n) && n>0 ? n : 0; }
    function normalizeConfig(v){ return v; }
    function isGeneratedTitle(){ return true; }
    function defaultTitleFor(name){ return name ? name + 'の夏休みの宿題' : 'しゅくだいノート'; }
    function applyTheme(){}
    function render(){}
    function getLocal(k){ return localStorage.getItem(k) || ''; }
    function saveCfg(){ onSave(); }
    function traceConfig(){}
    function markSaved(){}
    function syncPush(){}
    ${grab(APP, 'savedAt')}
    ${grab(APP, 'markReceivedAt')}
    ${grab(APP, 'applyRemote')}
    return { applyRemote, config:()=>config };
  `)({
    getItem:key => storage.get(key) || null,
    setItem:(key,value) => storage.set(key, String(value)),
    removeItem:key => storage.delete(key)
  }, ()=>{ saved++; });
  harness.applyRemote({ config:{tasks:[],theme:'notebook'}, configAt:200 });
  assert.equal(harness.config().theme, 'berry');
  assert.equal(saved, 1, '受信後にデザインだけを保存する');
  assert.equal(storage.has('natsu.welcome.theme.v1'), false, '反映後は一時値を消す');

  storage.set('natsu.welcome.theme.v1', JSON.stringify({code:'other-house',theme:'cat'}));
  harness.applyRemote({ config:{tasks:[],theme:'sunny'}, configAt:300 });
  assert.equal(harness.config().theme, 'sunny', '別のグループで残った一時デザインは採らない');
  assert.equal(saved, 1, '別グループの一時値をグループ設定として保存しない');
});

test('参加画面で変えた名前と漢字設定は、グループ設定の受信後にだけ反映する', ()=>{
  const storage = new Map([
    ['natsu.savedAt.v1', JSON.stringify({config:100})],
    ['natsu.welcome.join.v1', JSON.stringify({
      hasName:true, childName:'はな', hasGrade:true, readingGrade:1
    })]
  ]);
  let saved = 0;
  const harness = new Function('localStorage', 'onSave', `
    let config={ tasks:[], theme:'notebook', childName:'前の名前', readingGrade:2, title:'前の名前の夏休みの宿題' }, state={};
    const K_AT='natsu.savedAt.v1', K_CFG='natsu.config.v2', K_WELCOME_THEME='natsu.welcome.theme.v1', K_WELCOME_JOIN='natsu.welcome.join.v1';
    const THEME_IDS=['notebook','sunny','soda','berry','block','cat'];
    function ms(v){ const n=Number(v); return Number.isFinite(n) && n>0 ? n : 0; }
    function normalizeConfig(v){ return v; }
    function applyTheme(){}
    function render(){}
    function getLocal(k){ return localStorage.getItem(k) || ''; }
    function saveCfg(){ onSave(); }
    function traceConfig(){}
    function markSaved(){}
    function syncPush(){}
    function isGeneratedTitle(){ return true; }
    function defaultTitleFor(name){ return name ? name + 'の夏休みの宿題' : 'しゅくだいノート'; }
    ${grab(APP, 'savedAt')}
    ${grab(APP, 'markReceivedAt')}
    ${grab(APP, 'applyRemote')}
    return { applyRemote, config:()=>config };
  `)({
    getItem:key => storage.get(key) || null,
    setItem:(key,value) => storage.set(key, String(value)),
    removeItem:key => storage.delete(key)
  }, ()=>{ saved++; });
  harness.applyRemote({
    config:{tasks:[],theme:'notebook',childName:'グループの名前',readingGrade:2,title:'グループの名前の夏休みの宿題'},
    configAt:200,
    first:true
  });
  assert.equal(harness.config().childName, 'はな');
  assert.equal(harness.config().readingGrade, 1);
  assert.equal(harness.config().title, 'はなの夏休みの宿題');
  assert.equal(saved, 1, 'グループ設定を採ったあとに変更を1回だけ保存する');
  assert.equal(storage.has('natsu.welcome.join.v1'), false, '反映後は一時値を消す');
});

test('初期設定用の招待URLも、通常の招待URLと同じ引き継ぎ情報を持つ', ()=>{
  const make = new Function('location', 'cleanCode', `
    const JOIN_PARAM='join';
    ${grab(APP, 'inviteURLForCode')}
    return inviteURLForCode;
  `)({ origin:'https://example.test', pathname:'/app/' }, v=>String(v || '').trim());
  const url = new URL(make('abcdefghjkmnpqrs'));
  assert.equal(url.searchParams.get('join'), 'abcdefghjkmnpqrs');
  assert.equal(url.searchParams.get('openExternalBrowser'), '1');
  assert.ok(Number(url.searchParams.get('r')) > 0, '古い画面を避ける更新印を付ける');
});

test('音声入力は古い終了イベントに新しい認識を消されず、エラー後も再開できる', ()=>{
  assert.match(grab(APP, 'saveSheet'), /stopSR\(\);/, '記録する操作で音声入力を先に止める');
  assert.match(grab(APP, 'closeSheet'), /stopSR\(\);/, 'シートを閉じる操作でも音声入力を止める');
  assert.match(grab(APP, 'render'), /stopSR\(\);/, '別画面へ移る前にも音声入力を止める');
  assert.match(grab(APP, 'stopSR'), /active\.stop\(\)/, 'iPad Safariではstopを優先してマイクを終了する');
  assert.match(grab(APP, 'stopSR'), /active\.abort\(\)/, '表示を戻した時点で聞き取りも中断する');
  assert.match(grab(APP, 'stopSR'), /document\.activeElement[\s\S]*editor\.blur\(\)/,
    'iPadのキーボード音声入力は入力欄のフォーカスを外して終了する');
  assert.match(APP, /visibilitychange[\s\S]{0,100}document\.hidden\)\{ stopSR\(\); return; \}/,
    'アプリを閉じたり別画面へ移ったときにも音声入力を止める');
  assert.match(APP, /pagehide', stopSR/);
  assert.match(APP, /onspeechend[\s\S]{0,100}setSRStatus\(btn, 'checking'\)/, '聞き取り後は確認中の表示へ切り替える');
  assert.match(APP, /data-mic-status/, '音声入力の状態を各入力欄の近くに表示する');
  const sessions = [];
  class MockRecognition{
    constructor(){ sessions.push(this); }
    start(){ if(this.onstart) this.onstart(); }
    stop(){ this.stopped = true; }
    abort(){ this.aborted = true; }
  }
  const messages = [];
  const makeButton = ()=>{
    const names = new Set();
    return {
      classList:{ add:n=>names.add(n), remove:n=>names.delete(n), contains:n=>names.has(n) },
      attrs:{}, setAttribute(k,v){ this.attrs[k]=v; }
    };
  };
  const harness = new Function('MockRecognition', 'messages', `
    const window={SpeechRecognition:MockRecognition};
    function $$(s){ return []; }
    function toast(s){ messages.push(s); }
    let sr=null;
    ${grab(APP, 'srStatusText')}
    ${grab(APP, 'setSRStatus')}
    ${grab(APP, 'finishSR')}
    ${grab(APP, 'srErrorMessage')}
    ${grab(APP, 'stopSR')}
    ${grab(APP, 'startSR')}
    return { startSR, stopSR, current:()=>sr };
  `)(MockRecognition, messages);
  const target={ value:'まえ うしろ', selectionStart:3, selectionEnd:3, dispatchEvent(){}, setSelectionRange(a,b){ this.selectionStart=a; this.selectionEnd=b; } };
  const firstBtn=makeButton(), secondBtn=makeButton(), thirdBtn=makeButton(), fourthBtn=makeButton();
  harness.startSR(firstBtn, target, { start:3, end:3 });
  const first=sessions[0];
  harness.startSR(secondBtn, target, { start:3, end:3 });
  const second=sessions[1];
  first.onend();
  assert.equal(harness.current(), second, '古いonendが新しいセッションを消さない');
  second.onerror({error:'not-allowed'});
  assert.equal(harness.current(), null, '権限エラー時も認識中の参照を解放する');
  assert.match(messages.at(-1), /マイク.*許可/, '権限エラーには設定方法を示す');
  harness.startSR(thirdBtn, target, { start:3, end:3 });
  assert.equal(harness.current(), sessions[2], 'エラー直後でも新しい認識を開始できる');
  sessions[2].onresult({results:[[{transcript:'できた'}]]});
  sessions[2].onend();
  assert.equal(target.value, 'まえ できたうしろ', '音声結果は読み取り開始時のカーソル位置へ入れる');
  assert.equal(harness.current(), null);
  harness.startSR(fourthBtn, target, { start:target.value.length, end:target.value.length });
  harness.stopSR();
  assert.equal(sessions[3].stopped, true, '手動終了はstopを呼び、iPadのマイクを終了する');
  assert.equal(sessions[3].aborted, true, '手動終了はabortも呼び、聞き取りを即時中断する');
  assert.equal(harness.current(), null);
});

test('読書記録の基本入力はマイクを折り返さず、戻る前に音声入力を止める', ()=>{
  const book = grab(APP, 'openBookSheet');
  assert.match(book, /class="field book-entry-field"[\s\S]{0,500}mic-row/,
    '本の名前は見出し・入力欄・マイクを同じ行に置くこと');
  assert.match(book, /class="field book-entry-field"[\s\S]{0,220}id="bkDate"/,
    '読んだ日は見出しと入力欄を同じ行に置くこと');
  assert.match(STYLE, /\.mic-row > input\[type=text\][\s\S]{0,120}flex:1 1 0/,
    '入力欄がマイクの横幅を譲ること');
  const close = grab(APP, 'closeSheet');
  assert.ok(close.indexOf('stopSR();') < close.indexOf("$('#sheetWrap').hidden = true"),
    '戻る操作ではシートを隠す前にマイクを止めること');
});

/* QRで入った端末だけ デザインが 初期値の まま だった。
   設定は「あとに保存した方がまるごと勝つ」ので、まだ一度もグループを
   受け取っていない端末が 新しい（または壊れた）時刻印を持っていると、
   グループの設定が いつまでも 採られない。 */
test('つないだ直後の1回は、時刻を問わずグループの設定を採る', ()=>{
  function harness(localAt, remoteAt, first){
    const store = { 'natsu.savedAt.v1': JSON.stringify({ config:localAt }) };
    let pushedConfig = 0;
    const api = new Function(
      'savedAt', 'ms', 'normalizeConfig', 'applyTheme', 'localStorage', 'K_CFG',
      'markReceivedAt', 'markSaved', 'syncPush', 'traceConfig', 'render',
      'getLocal', 'K_WELCOME_THEME', 'THEME_IDS', 'saveCfg', `
      let config = { theme:'notebook' };
      ${grab(APP, 'applyRemote')}
      return { applyRemote, theme:()=>config.theme };
    `)(
      () => JSON.parse(store['natsu.savedAt.v1'] || '{}'),
      appFns.ms, c => Object.assign({}, c), ()=>{},
      { setItem:(k,v)=>{ store[k]=v; }, getItem:k=>store[k] }, 'natsu.config.v2',
      (kind, at)=>{ const a = JSON.parse(store['natsu.savedAt.v1']); if(at) a[kind] = at;
                    store['natsu.savedAt.v1'] = JSON.stringify(a); },
      ()=>{}, kind=>{ if(kind === 'config') pushedConfig++; }, ()=>{}, ()=>{},
      ()=>'', 'natsu.welcome.theme.v1', ['notebook','cat'], ()=>{}
    );
    api.applyRemote({ config:{ theme:'cat' }, configAt:remoteAt, first });
    return { theme: api.theme(), pushedConfig };
  }

  const older = 1786312076482, newer = older + 5000;
  assert.equal(harness(newer, older, true).theme, 'cat',
    'つないだ直後は、手元の時刻が新しく見えてもグループの設定を採る');
  assert.equal(harness(newer, older, false).theme, 'notebook',
    '受け取ったあとは、これまで通り新しい方が勝つ');
  assert.equal(harness(older, newer, false).theme, 'cat',
    'グループの方が新しければ採る');

  /* 旧版が `時刻 | 0` で保存した負の値は、`負 > 0` が成り立たないため
     グループの設定が永久に採られなくなる。0（時刻なし）に倒して救う */
  const broken = harness(older, older | 0, true);
  assert.equal(broken.theme, 'cat', '壊れた時刻でもグループの設定を採る');
  assert.equal(broken.pushedConfig, 1, '壊れた時刻は、正しい時刻で送り返して直す');
  assert.equal(harness(older, newer, false).theme, 'cat');
  assert.match(grab(APP, 'applyRemote'), /ms\(at\.state\) >= ms\(remote\.stateAt\)/,
    '記録側の時刻も ms() を通すこと');
});

test('設定がグループ側に置きかわったら、同期の記録に理由をのこす', ()=>{
  const trace = new Function('getLocal', 'traceAdd', 'K_DEVICE_ID', `
    ${/const TRACE_CONFIG_FIELDS = \[[^\]]*\];/.exec(APP)[0]}
    ${grab(APP, 'taskCensus')}
    ${grab(APP, 'traceConfig')}
    return traceConfig;
  `);
  const rows = [];
  trace(()=> 'dev-1', r=> rows.push(...r), 'k')(
    { theme:'notebook', title:'A' }, { theme:'cat', title:'A' }, 111, 222, true);
  assert.equal(rows.length, 1, '変わった欄だけ書きだす');
  assert.equal(rows[0].f, 'theme');
  assert.equal(rows[0].mine, 'notebook');
  assert.equal(rows[0].theirs, 'cat');
  assert.match(rows[0].id, /つないだ直後/);
});

test('端末一覧は呼び名とは別に親子の別を出し、呼び名なしは端末の種類で出す', ()=>{
  const rows = new Function('ms', `${grab(APP, 'deviceRows')}; return deviceRows;`)(appFns.ms)({
    a: { role:'parent', label:'父',      ver:'20260810at', at:1 },
    b: { role:'child',  label:'iPad',    ver:'20260810at', at:2 },
    c: { role:'',       label:'iPhone',  ver:'20260810at', at:3 },
    d: { role:'parent', label:'親',      ver:'20260810at', at:4 },
    e: { role:'child',  name:'はな',                       at:5 }
  });
  const by = id => rows.find(r=> r.id === id);
  assert.equal(by('a').label, '父');
  assert.equal(by('a').roleLabel, '親');
  assert.equal(by('a').roleShown, true, '呼び名だけでは親か子か分からない');
  assert.equal(by('b').roleLabel, '子');
  assert.equal(by('c').roleLabel, '未設定', '役割を選んでいない端末はそれと分かること');
  assert.equal(by('d').roleShown, false, '呼び名がすでに役割そのものなら重ねない');
  assert.equal(by('e').label, '子(はな)');
  assert.equal(by('e').roleShown, false, '呼び名なしの表示にはすでに役割が入っている');

  /* ブラウザは機種名までは通知しない。分かる範囲の大きなくくりだけを既定にする */
  const kind = new Function(`${grab(APP, 'deviceKindLabel')}; return deviceKindLabel;`)();
  assert.equal(kind('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)', 1), 'iPhone');
  assert.equal(kind('Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X)', 5), 'iPad');
  assert.equal(kind('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', 5), 'iPad',
    'iPadOSがMacを名乗る場合はタッチの数で見分ける');
  assert.equal(kind('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', 0), 'Mac');
  assert.equal(kind('Mozilla/5.0 (Linux; Android 14; Pixel 8) Mobile', 5), 'Android');
  assert.match(APP, /label: \(String\(getLocal\(K_DEVICE_LABEL\)[\s\S]{0,120}deviceKindLabel/,
    '呼び名が空のときだけ端末の種類を送ること');
});

test('QR招待の案内は大人向けのまま出し、ボタンを枠に収める', ()=>{
  const html = grab(APP, 'joinInstallTransferHTML');
  assert.match(html, /data-no-reading/, '子ども画面でもかな変換の対象から外すこと');
  assert.match(html, /おうちの方に読んでもらってね/, '誰が読む文かを示すこと');
  assert.match(html, /<ol class="join-install-steps">/, '手順は番号付きで示すこと');
  assert.match(html, />追加しない<\/button>/, 'ボタンは操作名だけにすること');
  assert.doesNotMatch(html, /URLの合言葉|URLから合言葉|自動で消えます/,
    '合言葉削除の内部動作を案内へ重ねないこと');
  assert.match(grab(APP, 'applyReadingDisplay'), /data-no-reading/,
    'かな変換に data-no-reading の除外があること');
  assert.match(grab(APP, 'applyReadingDisplay'), /tab === 'welcome'/,
    '初期設定は子どもの漢字設定を選ぶ前でも、保護者向けの漢字表記を保つこと');
});

test('招待URLでは端末に残ったデザインを持ち込まず、グループのデザインを採る', ()=>{
  const join = grab(APP, 'applyJoinCode');
  const remote = grab(APP, 'applyRemote');
  assert.match(join, /localStorage\.removeItem\(K_WELCOME_THEME\)/,
    '招待接続前に手動参加の一時デザインを消す');
  assert.match(remote, /welcomeTheme\.code === activeCode/,
    '一時デザインは確認済みの同じグループだけに適用する');
  assert.match(remote, /remoteThemeMissing[\s\S]{0,180}!joinCodeFromURL\(\)/,
    '旧グループのテーマ移行に招待直後の端末を使わない');
  const bind = grab(APP, 'bindWelcomeStart');
  assert.match(bind, /themeInput\.checked = true/,
    '手動参加でも確認後にグループのデザインを選択状態へ反映する');
});

test('既存のグループに入るときは、名前と漢字の設定を任意にする', ()=>{
  const make = new Function(`
    const window={NatsuSync:{configured:()=>true,makeCode:()=> 'abcdefghjkmnpqrs'}};
    const DEBUG_WELCOME=false, TEST_MODE=false, K_NAME='name', K_DEVICE_LABEL='label';
    const navigator={ userAgent:'iPhone', maxTouchPoints:5 };
    function getLocal(){ return ''; }
    function esc(v){ return String(v == null ? '' : v); }
    function readingGrade(){ return 9; }
    function readingOptions(){ return '<option value="9">x</option>'; }
    function welcomeStepHTML(n,t,b){ return '<section><h3>'+t+'</h3>'+b+'</section>'; }
    function welcomeThemeHTML(n){ return ''; }
    function privacyNoteHTML(){ return ''; }
    function inAppBrowserNoteHTML(){ return ''; }
    function welcomeShareSetupHTML(){ return ''; }
    ${grab(APP, 'deviceKindLabel')}
    ${grab(APP, 'alreadySetNoteHTML')}
    ${grab(APP, 'welcomeJoinCheckHTML')}
    ${grab(APP, 'deviceLabelFieldHTML')}
    ${grab(APP, 'welcomeParentCreateChoiceHTML')}
    ${grab(APP, 'welcomeFormHTML')}
    return (role,sharing,mode)=>welcomeFormHTML(role,sharing,4,mode);
  `)();
  assert.match(make('parent', true, 'join'), /合言葉を確認すると、共有中のお子さんの名前と漢字設定を表示します/,
    '参加する保護者には、接続先の設定を表示すると示す');
  assert.doesNotMatch(make('parent', true, 'create'), /合言葉を確認すると/,
    '新しく作る経路には既存グループの確認案内を出さない');
  assert.match(make('child', true), /あいことばを かくにんすると/, '共有へ入る子どもにも取得を示す');
  assert.doesNotMatch(make('child', false), /あいことばを かくにんすると/,
    'この端末だけで使う経路には合言葉の確認案内を出さない');
  assert.match(make('parent', true, 'create'), /子どもの名前（任意）/);
  assert.match(make('parent', true, 'join'), /子どもの名前（任意）/);
  assert.match(make('child', false), /なまえ（入れなくても いいよ）/);
  assert.match(make('child', true), /なまえ（入れなくても いいよ）/);

  /* どの経路でも名前は任意。新規作成では空欄を実際の設定にも保存する */
  const start = APP.slice(APP.indexOf('start.addEventListener'), APP.indexOf('function bindStats'));
  assert.match(start, /const joining = sharing && \(role === 'child' \|\| !creating\)/);
  assert.doesNotMatch(start, /なまえを 入れてください/,
    '新規作成・端末だけで使う場合も名前を必須にしない');
  assert.match(start, /if\(!joining\)\{\s*config\.childName = name;/,
    '新規作成時は空欄も設定へ反映する');
  assert.match(start, /localStorage\.removeItem\(K_NAME\)/,
    '空欄へ戻したとき端末に古い名前を残さない');
});

test('既存グループへの参加は読み取り確認後だけ許可し、接続先の設定を表示する', ()=>{
  const bind = grab(APP, 'bindWelcomeStart');
  const verify = grab(SYNC, 'verifyHousehold');
  assert.match(bind, /S\.verifyHousehold\(code\)/, '参加前に合言葉の接続先を確認する');
  assert.match(bind, /const result = TEST_MODE[\s\S]{0,120}found:true/,
    'おためし画面は実際のFirebaseを読まずに表示確認できる');
  assert.match(bind, /接続しています…/);
  assert.match(bind, /接続しました ✓/);
  assert.match(bind, /welcomeJoinVerified = \{ code, config:deepCopy\(remoteConfig\) \}/,
    '確認済みの合言葉とグループ設定を保持する');
  assert.match(bind, /nameInput\.value = remoteName/,
    '接続先のお子さんの名前をフォームへ表示する');
  assert.match(bind, /start\.hidden = false/,
    '確認できた場合だけ参加ボタンを表示する');
  assert.match(bind, /先に合言葉の接続を確認してください/,
    '画面操作を迂回しても未確認では参加できない');
  assert.match(verify, /getDocFromServer/, 'サーバー上のグループを読み取り専用で確認する');
  assert.doesNotMatch(verify, /pushAll|registerDevice|setDoc/,
    '存在確認だけではグループを作成・変更しない');
});

test('曜日と日付の月を文脈に合う読みへ直す', ()=>{
  const reading = grab(APP, 'applyReadingDisplay');
  const context = new Function('WD_READING', `
    ${grab(APP, 'readingContextText')}
    return readingContextText;
  `)({ 日:'にち', 月:'げつ', 火:'か', 水:'すい', 木:'もく', 金:'きん', 土:'ど' });
  assert.match(APP, /const WD_READING = \{[^}]*月:'げつ'/);
  assert.match(reading, /readingContextText\(body, grade\)/);
  assert.equal(context('8月11日（火）', 0), '8がつ11日（か）');
  assert.equal(context('8月11日（月）', 0), '8がつ11日（げつ）');
  assert.equal(context('8月11日（月）', 1), '8月11日（月）',
    '小学1年生以上では既習の月日と曜日を漢字のまま残す');
  assert.equal(context('8月11日（水）', 2), '8月11日（水）',
    '小学2年生まで読める設定では曜日の漢字をひらがなへ先置換しない');
});

test('端末の呼び名には自明な変更範囲の説明を重ねない', ()=>{
  assert.doesNotMatch(APP, /ほかの端末の一覧にも表示されますが、変更できるのはこの端末だけです/);
});

test('新しく作る合言葉は、押した人だけ手入力に切りかえられる', ()=>{
  const create = grab(APP, 'welcomeFormHTML');
  assert.match(create, /id="welcomeCode"[^>]*readonly/, '既定は自動作成のまま読み取り専用');
  assert.match(create, /id="welcomeCodeCustom"[^>]*>自分で決めた合言葉を使う/);
  const bind = grab(APP, 'bindWelcomeStart');
  assert.match(bind, /customBtn[\s\S]{0,200}setCodeMode\(true\)/,
    'ボタンを押したときだけ手入力にすること');
  assert.match(bind, /input\.readOnly = !custom/);
  assert.match(bind, /warn\.hidden = !custom/,
    '手入力に切りかえたら注意を出すこと');
  /* 手入力にしたあと、おまかせへ戻れること。
     戻り道が無いと、考え直した人は初期設定をやり直すしかない */
  assert.match(create, /id="welcomeCodeAuto"[^>]*hidden[^>]*>おまかせに戻す/);
  assert.match(bind, /autoBtn[\s\S]{0,200}setCodeMode\(false\)/);
  assert.match(bind, /S\.makeCode\(\) : input\.value/,
    'おまかせに戻すときは作り直すこと');
  /* 自動で作られたと分かる言い方にそろえる */
  assert.match(create, /16文字・おまかせで作成/);
  assert.doesNotMatch(APP, /16文字・自動作成/);
});

test('保護者ページは未共有の入口と子ども画面の修正方法を示す', ()=>{
  const badge = new Function('window', `
    ${grab(APP, 'parentShareBadgeHTML')}
    return parentShareBadgeHTML;
  `)({NatsuSync:{configured:()=>true,getCode:()=>''}})();
  assert.match(badge, /共有なし/);
  assert.match(badge, /共有の設定はこちら/);
  assert.match(APP, /<h2>保護者の方へ<\/h2>[\s\S]*子ども画面で該当する項目を開いて行います/);
  assert.match(APP, /このページで変更すると、共有中の子ども端末のデザインも変更/);
});

test('今日の記録は保護者が入れたぶんだけ印を付け、子どもの記録には付けない', ()=>{
  assert.equal(appFns.logByLabel({ by:'parent' }), '親');
  assert.equal(appFns.logByLabel({ by:'child' }), '');
  assert.equal(appFns.logByLabel({}), '');            // 古い記録（by なし）
  assert.equal(appFns.logByLabel(null), '');
  /* 子どもの名前を 記録の 行に 出さない（全件に 名前が ならんでいた） */
  const label = grab(APP, 'logByLabel');
  assert.doesNotMatch(label, /childName/);
});

test('消した記録の控えも、印が空なら欄ごと出さない', ()=>{
  assert.match(APP, /\$\{logByLabel\(r\) \? `<span class="trash-by">/,
    'by の有無ではなく、出す文字があるかで判定すること');
});

test('ホーム画面アイコンは不透明PNGを持ち、ねこテーマの肉球を流用しない', ()=>{
  const srcs = MANIFEST.icons.map(i => i.src);
  assert.equal(srcs.some(s => /paw\.svg/.test(s)), false,
    'paw.svg は ねこテーマの飾り。アイコンには使わない');
  assert.equal(srcs.some(s => /icon-192\.png/.test(s)), true);
  assert.equal(MANIFEST.icons.some(i => i.purpose === 'maskable'), true);
  for(const src of srcs){
    const file = path.join(ROOT, src.split('?')[0]);
    assert.equal(fs.existsSync(file), true, '実体があること: ' + src);
  }
  /* iOS は apple-touch-icon を 優先する。透過だと 黒で うめられる */
  const index = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const link = /<link rel="apple-touch-icon" href="([^"?]+)/.exec(index);
  assert.ok(link, 'apple-touch-icon を置くこと');
  const png = fs.readFileSync(path.join(ROOT, link[1]));
  assert.equal(png.readUInt32BE(16), 180, '180×180 であること');
  assert.equal(png.readUInt32BE(20), 180);
  assert.equal(png[25], 2, 'アルファ無し（不透明）の truecolor であること');
});

test('起動時は白画面の代わりに段階式の読み込み表示を出す', ()=>{
  const index = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  assert.match(index, /id="bootProgress"[\s\S]{0,300}読み込み中…[\s\S]{0,300}role="progressbar"/,
    'JavaScriptを待つ間もHTMLだけで読み込み表示が見えること');
  assert.match(index, /window\.natsuBootProgress\(88, 'この端末の記録を読み込んでいます'\)/,
    '実際に終わった読込段階に合わせて表示を進めること');
  assert.match(APP, /natsuBootProgress\(100, '表示します'\)/,
    '通常画面へ切り替える直前に完了を通知すること');
  assert.match(index, /fonts\.googleapis\.com[^>]+media="print"[^>]+onload="this\.media='all'"/,
    'Webフォントの通信で初期描画を止めないこと');
  assert.match(STYLE, /\.boot-track i::after[\s\S]{0,180}animation:boot-shimmer/,
    '待機中だと分かる軽量なCSSアニメーションを使うこと');
});

test('ねこテーマの飾りは paw.svg のまま残す', ()=>{
  assert.match(STYLE, /\[data-theme="cat"\][\s\S]*mask:url\("paw\.svg\?v=[0-9a-z]+"\)/);
  assert.equal(fs.existsSync(path.join(ROOT, 'assets', 'paw.svg')), true);
});

/* QR参加した端末の初期値がグループぜんたいへ配られ、まいにちの項目が
   参加端末でも招いた端末でも消えた。空のキャッシュ対策が
   `mayUseLegacy` のときだけ効いており、旧方式のグループへ切りかえた
   あとの watcher（mayUseLegacy = false）が素通りしていた。 */
test('文書なしのキャッシュは、旧方式へ切りかえた後の watcher でもグループを作らせない', ()=>{
  const watch = grab(SYNC, 'watchHousehold');
  assert.doesNotMatch(watch, /mayUseLegacy && snap\.metadata\.fromCache/,
    'キャッシュ判定に mayUseLegacy を混ぜないこと');
  const cacheReturn = watch.indexOf('if(snap.metadata.fromCache) return');
  /* コメント中の pushAll() を拾わないよう、呼び出しの形で探す */
  const push = watch.indexOf('pushAll();');
  assert.ok(cacheReturn >= 0 && push > cacheReturn,
    'オンラインで確認できるまで pushAll() へ進ませないこと');
});

test('あるグループへ入る端末は、グループが見つからなくても新しく作らない', ()=>{
  const watch = grab(SYNC, 'watchHousehold');
  const guard = watch.indexOf('if(joiningExisting)');
  const push = watch.indexOf('pushAll();');
  assert.ok(guard >= 0 && push > guard, 'pushAll() の手前で止めること');
  assert.match(watch, /joiningExisting\)\{[\s\S]{0,200}setStatus\('error'/,
    '静かに上書きせず、画面に出して気づけるようにすること');
  /* 招待リンクと初期設定の参加は、かならず joining を渡す */
  assert.match(grab(APP, 'applyJoinCode'), /reconnect\(code, \{ joining:true \}\)/);
  assert.match(grab(APP, 'bindWelcomeStart'), /reconnect\(code, \{ joining \}\)/);
  /* グループを1回でも受け取ったら、ふつうの端末に戻す */
  assert.match(watch, /gotSnapshot = true;\s*\n\s*joiningExisting = false/);
});

test('同期の記録は、まいにちの項目が増減したことも残す', ()=>{
  const trace = new Function('getLocal', 'traceAdd', 'K_DEVICE_ID', `
    ${/const TRACE_CONFIG_FIELDS = \[[^\]]*\];/.exec(APP)[0]}
    ${grab(APP, 'taskCensus')}
    ${grab(APP, 'traceConfig')}
    return traceConfig;
  `);
  const rows = [];
  const mine   = { theme:'cat', showDaily:true,
                   tasks:[{id:'a',group:'must'},{id:'d1',group:'daily'},{id:'d2',group:'daily'}] };
  const theirs = { theme:'cat', showDaily:false, tasks:[{id:'a',group:'must'}] };
  trace(()=> 'dev-1', r=> rows.push(...r), 'k')(mine, theirs, 111, 222, true);
  const by = Object.fromEntries(rows.map(r=>[r.f, r]));
  assert.equal(by['showDaily'].mine, 'true');
  assert.equal(by['showDaily'].theirs, 'false');
  assert.equal(by['まいにち（数）'].mine, '2');
  assert.equal(by['まいにち（数）'].theirs, '0');
  assert.equal(by['tasks（数）'].mine, '3');
  /* 名前や課題名そのものは残さない（保護者ページに出るため） */
  assert.equal(rows.some(r => String(r.mine).includes('d1')), false);
});

/* 「作成する」と「接続する」が別操作で、どちらを押した時点で
   ほかの端末から読めるのかが読み取れなかった。作成＝共有開始にそろえる。 */
test('設定画面の共有は、作成でそのままつながり、参加は確認後だけ進む', ()=>{
  const bind = grab(APP, 'bindSync');
  const make = bind.slice(bind.indexOf("const startSharing"));
  assert.match(make, /S\.reconnect\(code\)/, '作成した時点でつなぐこと');
  assert.match(make, /openSyncDetails = true/, '作成後にQR・招待リンクを開くこと');
  assert.doesNotMatch(make, /この合言葉で接続/, '作成後にもう1操作を求めないこと');
  /* おまかせでも 自分で決めても、押した時点で共有が始まるのは同じ */
  assert.match(make, /on\('#syncMake', 'click', \(\)=> startSharing\(S\.makeCode\(\), true\)\)/);
  /* おまかせの合言葉に「短い合言葉を使わないで」の注意はあてはまらない。
     押すたびに出すだけ邪魔なので、自分で決めたときだけ出す */
  assert.match(make, /if\(!auto && !confirmShareSafety\(\)\) return;/);
  assert.match(make, /on\('#syncMakeOwn', 'click'/);
  assert.match(make, /if\(c\.length < 8\)/, '自分で決めた合言葉は8文字以上を求めること');

  const section = grab(APP, 'syncSectionHTML');
  assert.match(section, /合言葉をつくる（おまかせ）/);
  assert.match(section, /当てられにくい16文字の合言葉をこの端末が作ります/,
    '作成で何が起きるかを書くこと');
  assert.match(section, /id="syncVerify"[^>]*>接続を確認/);
  /* 設定からも 自分で 決められる（最初の設定と そろえる） */
  assert.match(section, /id="syncOwnCode"/);
  assert.match(section, /id="syncMakeOwn"[^>]*>この合言葉でつくる/);
  assert.match(section, /id="syncSave"[^>]*hidden[^>]*>このグループに参加する|id="syncSave" type="button" hidden/);

  /* 参加は確認ずみのあいことばだけ。未確認では reconnect まで進ませない */
  assert.match(bind, /if\(verify && verified !== c\)\{[\s\S]{0,120}return;/);
  assert.match(bind, /S\.reconnect\(c, \{ joining: !!verify \}\)/);
});

test('宿題の項目を消したら、サンプルを復活させず登録をうながす', ()=>{
  const bind = grab(APP, 'bindConfig');
  const reset = bind.slice(bind.indexOf("on('#resetCfg'"));
  assert.doesNotMatch(reset.slice(0, 400), /freshConfig\(\)/,
    'サンプルの宿題一式を復活させないこと');
  assert.match(reset, /config\.tasks = \[\]/);
  assert.match(reset, /config\.showDaily = false/);

  const home = grab(APP, 'viewHome');
  assert.match(home, /if\(!config\.tasks\.length\) return homeEmptyHTML\(\)/,
    '空のときは「ぜんぶ できた！」を出さないこと');
  const empty = grab(APP, 'homeEmptyHTML');
  assert.match(empty, /宿題を登録してください/);
  assert.match(empty, /data-no-reading/, '大人あての案内はかな変換から外すこと');
  assert.match(STYLE, /\.empty-home\{/);
});

/* 実機で、まいにちの項目を 1回 押してしまうと 0 に もどせなかった。
   「空の保存を止める」ガードが、取り消しまで巻きこんでいた。 */
test('記録があるものは0にもどせる。無いものは空保存のまま止める', ()=>{
  const save = grab(APP, 'saveSheet');
  assert.match(save, /const hadValue = \(p\.done \| 0\) > 0/);
  /* 記録が無いときだけ、これまで通りの案内で止める */
  assert.match(save, /if\(!hadValue\)\{[\s\S]{0,120}やったところを えらんでね[\s\S]{0,40}return;/);
  /* 記録があるときは、消してよいか聞いてから通す */
  assert.match(save, /やらなかったことに しますか？[\s\S]{0,120}return;/);
  /* 0 は「できた」ではない */
  assert.match(save, /n > 0 \? n \+ \(t\.targetUnit\|\|'かい'\) \+ ' できた'/);
  assert.match(save, /'きょうは やらなかったことに した'/);
  assert.match(save, /\(after\.done \| 0\) === 0 && hadValue\) toast/,
    '取り消しに「できた！」のはんこを出さないこと');
});

/* 折りたたみの開閉は、描き直しの前後で見出しの文字を鍵にしていた。
   毎日の項目は既定名が同じなので、1つ開くと同名の行がすべて開いた。 */
test('折りたたみの復元は、見出しの文字ではなく項目のidで見分ける', ()=>{
  const key = grab(APP, 'detailsKey');
  assert.match(key, /d\.dataset\.detailsKey/, '明示した鍵を最優先にすること');
  const row = grab(APP, 'taskEditorRow');
  assert.match(row, /data-details-key="task:\$\{esc\(t\.id\)\}"/,
    '課題の行は id を鍵にすること');
  /* 人が手で開いた行も覚える（覚えないと、前にいじった別の行が開く） */
  const bind = grab(APP, 'bindConfig');
  assert.match(bind, /addEventListener\('toggle'[\s\S]{0,320}\}, true\)/,
    'toggle はバブルしないので capture でとること');
  assert.match(bind, /if\(row\.open\) openConfigTaskId = t\.id/);
});

/* 設定を2ページに分けたとき、片方にしか無い欄を直に束ねていたため
   #cfgShowDaily が null になり、そこから下（削除・書き出し・保存）が
   すべて未接続になった。保存されないまま再読込すると freshConfig() が
   走り、消したはずのサンプル宿題が戻る。 */
test('設定ページの束ねは、欄が無いページでも止まらない', ()=>{
  const bind = grab(APP, 'bindConfig');
  assert.doesNotMatch(bind, /\$\('#[A-Za-z][\w-]*'\)\.addEventListener/,
    '片方のページにしか無い欄を直に束ねないこと（null で以降が全部止まる）');
  /* 宿題ページ側の欄 */
  ['#cfgShowDaily','#addMustTask','#addOptionTask','#addBookTask','#addDailyTask'].forEach(sel=>{
    assert.match(bind, new RegExp("on\\('" + sel + "'"), sel + ' は on() で束ねること');
  });
  /* 設定ページ側の欄 */
  ['#resetCfg','#resetAll','#expBtn','#cfgTitle'].forEach(sel=>{
    assert.match(bind, new RegExp("on\\('" + sel + "'"), sel + ' は on() で束ねること');
  });
  const on = grab(APP, 'on');
  assert.match(on, /if\(el\) el\.addEventListener\(ev, fn\)/);
});

/* 大人向けページを足したら、かな変換・クレジット・入力元の印の
   判定にも足す必要がある。足し忘れると設定画面が子ども向けに変換される。 */
test('大人向けページの判定は1か所にまとめる', ()=>{
  const f = grab(APP, 'isAdultTab');
  assert.match(f, /'settings'/);
  assert.match(f, /'tasks'/);
  assert.match(f, /'config'/);
  assert.match(APP, /TABS = \[[^\]]*'tasks'[^\]]*\]/, '新しいページを TABS に足すこと');
  assert.match(APP, /else if\(tab === 'tasks'\)\s+v\.innerHTML = viewTasks\(\);/);
  assert.match(APP, /if\(tab === 'tasks' \|\| tab === 'config'\) bindConfig\(\);/);
});

/* 招待・QRで入った端末は初期設定を通らないため役割が未設定。
   そのまま子ども画面に出ると、保護者が自分の端末をつないでも
   子ども向けの「ホーム画面に追加」しか案内されない。 */
test('招待で入った端末には、先に保護者か子どもかを聞く', ()=>{
  const need = grab(APP, 'joinRoleNeeded');
  assert.match(need, /sharingOn\(\) && !getLocal\(K_ROLE\)/);
  const home = grab(APP, 'viewHome');
  assert.match(home, /if\(joinRoleNeeded\(\)\) return joinRolePickHTML\(\)/);
  const pick = grab(APP, 'joinRolePickHTML');
  assert.match(pick, /data-join-role="parent"/);
  assert.match(pick, /data-join-role="child"/);
  assert.match(STYLE, /\.join-role\{ width:100%; max-width:560px; margin:24px auto 0; \}/,
    '端末役割の選択画面は広い画面で横に伸びすぎないこと');
  assert.match(STYLE, /\.join-role-body\{ display:flex; flex-direction:column; gap:14px; padding:22px 20px 24px; \}/,
    '見出し・説明・ボタンをカード端から離してそろえること');
  assert.match(STYLE, /\.join-role-actions \.btn\{ min-height:58px; \}/,
    '余白を足しても選択ボタンの押しやすさを保つこと');
  /* 選んだ役割はこの端末だけの設定。グループの設定に混ぜない */
  assert.match(APP, /setLocal\(K_ROLE, role\)/);
  assert.match(APP, /if\(role === 'parent'\) location\.hash = 'settings'/);
});

/* 中身のエンドツーエンド暗号化。Firebase の管理者に名前・宿題・記録を
   読ませないための層。合言葉から鍵を作り、鍵はどこへも送らない。 */
function cryptoHarness(){
  return new Function('crypto', 'TextEncoder', 'TextDecoder', 'btoa', 'atob', `
    ${CRYPTO_PARTS}
    ${grab(SYNC, 'decryptField')}
    ${grab(SYNC, 'houseIdFor')}
    return { encryptField, decryptField, isCiphertext, houseIdFor,
             salt:(code)=>sha256Bytes('natsu.e2ee.salt.v1|' + normalizeCode(code)) };
  `)(webcrypto, TextEncoder, TextDecoder, btoa, atob);
}

test('グループの中身は暗号化して往復でき、平文が残らない', async ()=>{
  const c = cryptoHarness();
  const code = 'abcdefghjkmnpqrs';
  const config = { childName:'テスト児童', tasks:[{ id:'t1', name:'かん字ドリル' }] };
  const sealed = await c.encryptField('config', code, config);

  assert.ok(c.isCiphertext(sealed));
  assert.deepEqual(await c.decryptField('config', code, sealed), config);
  /* 個人情報が そのまま 出ていないこと */
  assert.doesNotMatch(sealed, /テスト児童|かん字ドリル|childName/);
});

test('同じ値でも書くたびに違う暗号文になる（IVを使い回さない）', async ()=>{
  const c = cryptoHarness();
  const code = 'abcdefghjkmnpqrs';
  const a = await c.encryptField('state', code, { logs:[1,2,3] });
  const b = await c.encryptField('state', code, { logs:[1,2,3] });
  assert.notEqual(a, b);
});

test('ちがう合言葉・ちがう欄では復号できない', async ()=>{
  const c = cryptoHarness();
  const sealed = await c.encryptField('config', 'abcdefghjkmnpqrs', { childName:'あ' });
  await assert.rejects(()=> c.decryptField('config', 'zyxwvutsrqponmkj', sealed),
    'ちがう合言葉では開かないこと');
  /* 欄の名前を認証データに入れているので、config を state へ移されても開かない */
  await assert.rejects(()=> c.decryptField('state', 'abcdefghjkmnpqrs', sealed),
    '欄を入れかえたら開かないこと');
});

test('鍵の塩は、保存される文書IDと別物にする', async ()=>{
  const c = cryptoHarness();
  const code = 'abcdefghjkmnpqrs';
  const salt = Array.from(await c.salt(code), n=>n.toString(16).padStart(2,'0')).join('');
  assert.notEqual(salt, await c.houseIdFor(code),
    '文書IDを塩にすると、保存された値がそのまま鍵の材料になる');
});

/* この作りで くり返し 起きてきた事故。まだグループを受け取っていない端末が
   自分の初期値でグループを上書きする。復号できないうちに gotSnapshot を
   立てると configHeldBack() が false になり、同じ道すじが再びひらく。 */
test('復号できないうちは、受信済みにも上書き可能にもしない', ()=>{
  const watch = grab(SYNC, 'watchHousehold');
  const failIdx = watch.indexOf('このグループは 古い方式で');
  const gotIdx  = watch.indexOf('gotSnapshot = true');
  assert.ok(failIdx > -1, '読めないことを画面に出すこと');
  assert.ok(gotIdx > failIdx,
    'gotSnapshot を立てるのは復号に成功したあとにすること');
  const fail = watch.slice(failIdx, gotIdx);
  assert.match(fail, /return;/, '読めないときはそこで戻ること');
  assert.doesNotMatch(fail, /pushAll\(\)|flushPendingSoon\(\)|joiningExisting = false/,
    '読めないままグループへ送り出さないこと');
  /* 平文のまま置かれた文書も「読めない」に倒す（黙って上書きしない）。
     ただし理由は分ける。古い方式のグループに「合言葉を確かめて」と言うと、
     正しい合言葉を何度も入れ直すことになる */
  assert.match(watch, /const sealed = v => v === undefined \|\| v === null \|\| isCiphertext\(v\)/);
  assert.match(watch, /このグループは 古い方式で 保存されています/);
  assert.match(watch, /合言葉が ちがうため、中身を 読めません/);
  const oldWayIdx = watch.indexOf('このグループは 古い方式で');
  assert.ok(oldWayIdx > -1 && oldWayIdx < gotIdx,
    '古い方式の判定も gotSnapshot より前で止めること');
});

test('はずされた判定と台数は、鍵が合わなくても動く', ()=>{
  const watch = grab(SYNC, 'watchHousehold');
  const revokeIdx = watch.indexOf('revokedForMe(d.devices)');
  const decryptIdx = watch.indexOf("decryptField('config'");
  assert.ok(revokeIdx > -1 && decryptIdx > revokeIdx,
    'はずされた判定は復号より先に行うこと（鍵がなくても外れられる）');
  /* 呼び名だけは暗号文。役割・版・はずした印は平文のまま */
  const reg = grab(SYNC, 'registerDevice');
  assert.match(reg, /name:'', label:''/, '一覧の名前を平文で置かないこと');
  assert.match(reg, /enc: await encryptField\('device'/);
});

test('参加前の確認は、鍵が合ったときだけ中身を見せる', ()=>{
  const v = grab(SYNC, 'verifyHousehold');
  assert.match(v, /if\(!isCiphertext\(raw\)\) return \{ found:true, config:null, unreadable:true \}/);
  assert.match(v, /catch\(e\)\{\s*return \{ found:true, config:null, unreadable:true \};/);
});

/* 実機で「QR参加すると、まいにちの項目が消える」「デザインが移らない」。
   グループを作った直後にQRを読むと、作成側の最初の送信が届く前に
   「文書はあるが config が無い」snapshot が1回来る。そこで初期設定の
   名前・デザインを saveCfg() すると、参加したばかりの端末の初期値
   （既定の宿題・まいにち無し・初期デザイン）がグループへ配られる。 */
test('グループの設定を受け取れていないうちは、初期設定をグループへ送らない', ()=>{
  const f = grab(APP, 'applyRemote');
  const guardIdx = f.indexOf('if(!remote.config){');
  const consumeIdx = f.indexOf('localStorage.removeItem(K_WELCOME_THEME)');
  const saveIdx = f.indexOf('if(welcomeChanged){ saveCfg(); changed = true; }');
  assert.ok(guardIdx > -1, 'グループの設定が無いときの分岐を置くこと');
  assert.ok(consumeIdx > guardIdx,
    '受け取れていないうちに、取っておいた初期設定を使い切らないこと');
  assert.ok(saveIdx > guardIdx,
    '受け取れていないうちに saveCfg() でグループへ送らないこと');
  /* 消さずに残す。次のsnapshotでグループの設定が来たときに反映する */
  const guard = f.slice(guardIdx, consumeIdx);
  assert.match(guard, /return;/);
  assert.doesNotMatch(guard, /removeItem\(K_WELCOME_JOIN\)|saveCfg\(\)/);
});

/* 既定の「まいにち」は家庭用の旧内容にそろえる。
   子ども画面には出さない（showDaily は false のまま）。 */
test('既定のまいにちは4項目で、初期状態では子ども画面に出さない', ()=>{
  const daily = DATA.match(/\{[^{}]*group:'daily'[\s\S]*?\}(?=,?\s*(\{|\]))/g) || [];
  const names = (DATA.match(/group:'daily'[\s\S]*?name:'([^']+)'/g) || [])
    .map(s=>s.match(/name:'([^']+)'/)[1]);
  assert.deepEqual(names, ['シンクシンク','トドさんすう','なんでもきろく','おてつだい']);
  assert.match(DATA, /showDaily: false/, '初期状態では子ども画面に出さないこと');
  /* 文章で記録する項目には、書くことの例をそえる */
  assert.match(DATA, /id:'nandemo'[\s\S]{0,240}recordStyle:'free'/);
  assert.match(DATA, /今日のはっけん、今おもっていること/);
});

test('文章で記録の呼びかけは、決めていなければ例文を出す', ()=>{
  assert.match(APP, /const FREE_HINT_DEFAULT = '今日のはっけん、/);
  assert.match(APP, /t\.freeHint \|\| FREE_HINT_DEFAULT/,
    '記録シートの既定に使うこと');
  assert.match(APP, /placeholder="\$\{esc\(FREE_HINT_DEFAULT\)\}"/,
    '設定欄の例示も同じ文にそろえること');
});

/* verifyHousehold は「見つかったが中身をあけられない」を返すようになった。
   呼び出し側がこれを見落とすと、「接続しました ✓」と出たあとで
   参加できない行き止まりになる（実機でそうなった）。 */
test('あけられないグループは、参加の確認で止めて理由を出す', ()=>{
  const text = grab(APP, 'unreadableJoinText');
  assert.match(text, /暗号化に対応する前の方式/);
  assert.match(text, /合言葉を作り直してください/);
  /* 初期設定の確認と、設定ページの確認の両方で見ること */
  const occurrences = (APP.match(/if\(result\.unreadable\)|if\(result\.unreadable\)\{/g) || []).length;
  assert.ok(occurrences >= 2,
    '初期設定と設定ページの両方で unreadable を見ること。実際は ' + occurrences + ' か所');
  /* 通してはいけない。参加ボタンを出さず、確認済みにもしない */
  const bind = grab(APP, 'bindSync');
  const idx = bind.indexOf('if(result.unreadable)');
  assert.ok(idx > -1);
  /* 分岐の中だけを見る。ここを抜けた先に「確認済み」があるのは正しい */
  const branch = bind.slice(idx, bind.indexOf('}', bind.indexOf('return;', idx)));
  assert.match(branch, /unreadableJoinText\(\)/);
  assert.match(branch, /return;/);
  assert.doesNotMatch(branch, /verified = c|save\.hidden = false/);
});

/* ホーム画面に追加したアプリは、起動URLに招待の合言葉が焼きついている。
   共有を解除しても作り直しても、次に開いた瞬間にURLの合言葉でつなぎ直され、
   前のグループに戻ってしまう（実機で「解除しても同じ合言葉のまま」と出た）。
   起動URLは書きかえられないので、人がえらんだほうを優先する。 */
test('起動URLの古い招待より、人がえらんだ合言葉を優先する', ()=>{
  const apply = grab(APP, 'applyJoinCode');
  assert.match(apply, /const chosen = getLocal\(K_CODE_CHOSEN\);[\s\S]{0,80}if\(chosen && chosen !== code\) return;/,
    'えらんだ合言葉と違う招待では、つなぎ直さないこと');
  /* えらんだ場面すべてでおぼえること。1か所でも抜けると引き戻される */
  assert.equal((APP.match(/rememberChosenCode\(/g) || []).length, 8,
    '定義1つと、作成・参加・招待・QR・初期設定・解除・削除処理中の7か所');
  const bind = grab(APP, 'bindSync');
  assert.match(bind, /rememberChosenCode\('none'\)[\s\S]{0,120}S\.setCode\(''\)/,
    '解除したら「どこにもつながらない」をおぼえること');
});

test('削除処理中の共有は墓標で止め、新しい合言葉の登録を案内する', ()=>{
  const verify = grab(SYNC, 'verifyHousehold');
  assert.match(verify, /readTombstone\(fs, secureId, read\)/);
  assert.match(verify, /retired:true/);
  assert.match(grab(SYNC, 'connect'), /readTombstone\(fs, secureId\)/);
  assert.match(grab(SYNC, 'retireHousehold'), /pending = \{ config:false, state:false \}/,
    '削除済みの端末内容を再送しないこと');
  assert.match(APP, /共有データは削除処理中のため、もう使えません。新しい合言葉で始めてください。/);
  assert.match(APP, /onHouseholdRetired\(\)/);
  assert.match(RULES, /match \/household_tombstones\/\{houseId\}/);
  assert.match(RULES, /function notRetired\(houseId\)/);
});

/* 1台しかない状態で「つながっています」と出すと、もう相手がいるように読める */
test('この端末だけのときは、待っていると書く', ()=>{
  const f = grab(APP, 'syncStatusText');
  assert.match(f, /status === 'online'[\s\S]{0,120}deviceCount\(\) <= 1/);
  assert.match(f, /ほかの端末を待っています/);
  /* 文言は1か所だけ。以前は sync.js からの通知が #syncStatus を直接
     書きかえていたので、描き直しで直してもすぐ元に戻った */
  assert.match(grab(APP, 'syncSectionHTML'),
    /id="syncStatus">\$\{esc\(syncStatusText\(S\.status\(\), S\.statusText\(\)\)\)\}/);
  const bind = grab(APP, 'bindSync');
  assert.match(bind, /el\.textContent = syncStatusText\(st, text\)/,
    '通知の側も同じ関数を通すこと');
  assert.match(bind, /onDeviceCount\([\s\S]{0,200}syncStatusText\(S\.status\(\), S\.statusText\(\)\)/,
    '1台から2台になったら文言を出しなおすこと');
  assert.equal((APP.match(/ほかの端末を待っています/g) || []).length, 1,
    '文言は1か所にだけ書くこと');
});

/* 共有ずみの画面に出ている合言葉は「すでに使っているもの」。
   「この合言葉で接続」だと、作った本人がまだ繋がっていないと読む。 */
test('共有ずみの合言葉は見せるだけ。つなぎ直しはたたむ', ()=>{
  const f = grab(APP, 'syncSectionHTML');
  assert.match(f, /<span class="lab">このグループの合言葉<\/span>/);
  assert.match(f, /id="syncCodeShown"[\s\S]{0,200}readonly/, '見せるだけの欄にすること');
  /* 参加の欄と id を分けること。同じ id だと captureFormDraft が拾った
     古い値が描き直しのあとで書きもどされ、解除しても前の合言葉がのこり、
     おまかせを押しても新しい合言葉が出ない（実機でそうなった） */
  assert.equal((f.match(/id="syncCode"/g) || []).length, 1,
    'syncCode は参加の欄だけにすること');
  /* 注釈の中でこの語に触れるのは構わない。ボタンとして出ないことを見る */
  assert.doesNotMatch(f, /<button[^>]*>この合言葉で接続<\/button>/);
  assert.match(f, /<summary>べつの合言葉につなぎ直す<\/summary>/);
  assert.match(f, /id="syncRejoinCode"/, 'つなぎ直しは専用の欄から読むこと');
  const bind = grab(APP, 'bindSync');
  assert.match(bind, /\$\('#syncRejoinCode'\) \|\| \$\('#syncCode'\)/);
  assert.match(bind, /const shown = \$\('#syncCodeShown'\);/, 'コピーは表示中の合言葉から取ること');
});

/* 表を積みなおすとき tbody を入れわすれると、そこだけ table-row-group で
   のこり、行が中身の幅に縮む。保護者ページのバーの右に大きなすき間が出た。 */
test('狭い幅で表を積みなおすとき、tbody も block にする', ()=>{
  assert.match(STYLE, /\.pgtable, \.pgtable thead, \.pgtable tbody,\s*\n\s*\.pgtable tr, \.pgtable th, \.pgtable td\{ display:block; \}/);
});

/* おまかせの合言葉は、この端末が当てられにくい16文字を作る。
   「短い合言葉を使わないで」の注意はあてはまらないので出さない。
   自分で決めたときだけ出す（そこが弱くなるところ）。 */
test('おまかせで作るときは、確認のアラートを出さない', ()=>{
  const bind = grab(APP, 'bindWelcomeStart');
  assert.match(bind, /const autoCode = !!\(codeEl && codeEl\.readOnly\);/,
    '読み取り専用のままなら、おまかせと見なすこと');
  assert.match(bind, /if\(creating && !autoCode &&[\s\S]{0,60}!confirmShareSafety\(\)\) return;/);
  /* 注意事項そのものは画面に出したままにする */
  assert.match(APP, /privacyNoteHTML\(\)/);
});

/* 読み取り専用の欄に出ているのは、人が打ったものではなくアプリが入れた値。
   描き直しでもどすと、たった今入れ直した値をひとつ前の値で上書きする。
   実機では「解除しても古い合言葉が残る」「おまかせを押しても
   新しい合言葉が出ない」として現れた。 */
test('入力とちゅうの保護は、読み取り専用の欄には及ばない', ()=>{
  const cap = grab(APP, 'captureFormDraft');
  const res = grab(APP, 'restoreFormDraft');
  assert.match(cap, /el\.type === 'file' \|\| el\.readOnly \|\| el\.disabled/);
  assert.match(res, /el\.type === 'file' \|\| el\.readOnly \|\| el\.disabled/);
});

test('保護者ページのタブは「進捗」と呼ぶ', ()=>{
  assert.match(APP, /tab:'settings'[^}]*short:'進捗'/);
  assert.doesNotMatch(APP, /short:'ようす'/);
});

/* iPhone の幅では日づけが場所をとりすぎ、子どもの名前が3文字入るだけで
   タイトルが「〇〇〇の夏…」と切れた。帯の中をつめて場所をまわす。 */
test('せまい画面では、帯をつめてタイトルの場所を作る', ()=>{
  assert.match(STYLE, /@media \(max-width:430px\)\{[\s\S]{0,200}\.topband-title\{ font-size:18px; \}/);
  assert.match(STYLE, /@media \(max-width:430px\)\{[\s\S]{0,200}\.topband-date\{ font-size:13px; \}/);
});

/* iOS の「ホーム画面に追加」がおぼえるのは追加時のURL。そこに # が残るかは
   こちらから決められない。残らないと子ども画面が開くため、保護者が
   「親端末」を選んで追加しても子ども画面になり、開き直すたびに戻った。 */
test('ホーム画面から開いたとき、端末の役割に合う開始画面を出す', ()=>{
  const f = grab(APP, 'routeFromHash');
  assert.match(f, /if\(!location\.hash && isStandalone\(\) && getLocal\(K_ROLE\) === 'parent'\) return 'settings';/);
  /* 初期設定より後に置くこと。順番を逆にすると、まっさらな端末が
     初期設定をとばして保護者ページに出る */
  const onboardIdx = f.indexOf("return 'welcome';");
  const roleIdx = f.indexOf("=== 'parent') return 'settings';");
  assert.ok(onboardIdx > -1 && roleIdx > onboardIdx,
    '初期設定の判定を先に通すこと');
  /* 画面内の移動では # を尊重する。「子ども画面へ」は #home を付ける */
  assert.match(f, /!location\.hash &&/);
  /* 子どもの端末では立たない値なので、5回タップ・長押しは唯一の道のまま */
  assert.match(APP, /setLocal\(K_ROLE, role\)/);

  /* 実際に動かして確かめる */
  const route = (hash, standalone, role, onboarded)=> new Function(
    'location', 'isStandalone', 'getLocal', 'isStatsURL', 'TABS',
    'K_CFG', 'K_ST', 'K_ONBOARD', 'K_ROLE', 'TEST_MODE', 'writesTaskId', `
    ${grab(APP, 'routeFromHash')}
    ${grab(APP, 'launchRoute')}
    return launchRoute();
  `)(
    { hash }, ()=> standalone,
    k => ({ role, onboard: onboarded ? 'done' : '', cfg:'' })[
      { 'natsu.device.role.v1':'role', 'natsu.onboarding.v1':'onboard', 'natsu.config.v2':'cfg' }[k]
    ] || '',
    ()=> false,
    ['welcome','stats','home','log','calendar','books','writes','settings','tasks','config'],
    'natsu.config.v2', 'natsu.state.v2', 'natsu.onboarding.v1', 'natsu.device.role.v1',
    false, ''
  );

  assert.equal(route('', true, 'parent', true), 'settings',
    'ホーム画面の保護者端末は、# が無くても保護者ページ');
  assert.equal(route('', true, 'child', true), 'home',
    '子どもの端末は子ども画面のまま');
  assert.equal(route('', true, '', true), 'home',
    '役割が未選択なら子ども画面のまま');
  assert.equal(route('', false, 'parent', true), 'home',
    'ふつうのブラウザのタブでは子ども画面（アドレスを開いた人が親とは限らない）');
  assert.equal(route('#config', true, 'parent', true), 'settings',
    '保護者端末は #config から追加しても、次回のアイコン起動では保護者ページ');
  assert.equal(route('#config', true, 'child', true), 'home',
    '子ども端末は #config から追加しても、次回のアイコン起動では子ども画面');
  assert.equal(route('#home', true, 'parent', true), 'settings',
    '保護者端末はどのページから追加しても、アイコン起動では保護者ページ');
  assert.equal(route('', true, 'parent', false), 'welcome',
    'まっさらな端末は、まず初期設定');
  assert.match(f, /const hasExistingConfig = !!getLocal\(K_CFG\);/,
    '初期設定を通過済みかは保存された設定で判定すること');
});

test('ミニコンテンツは低学年設定でも漢字とルビを保つ', ()=>{
  const fun = grab(APP, 'funHTML');
  const reads = grab(APP, 'readsHTML');
  assert.match(fun, /class="fun-q" data-no-reading>\$\{rubyHTML\(f\.q\)\}/);
  assert.match(fun, /class="fun-a" data-no-reading>\$\{rubyHTML\(f\.a\)\}/);
  assert.match(reads, /class="reads-q" data-no-reading>\$\{rubyHTML\(r\.q\)\}/);
});

test('ホーム画面追加の案内は、どちらの画面が開くかを書く', ()=>{
  const f = grab(APP, 'homeInstallGuideHTML');
  assert.match(f, /保護者の端末<\/b>」を選んでいれば/);
  assert.match(f, /この保護者ページが開きます/);
  assert.match(f, /選んでいないときは子ども画面が開きます/);
});

/* 保護者ページと子ども画面で、同じものが違う色で出ていた。
   子ども画面のバーは「1色の濃淡で範囲を表す」（うすい緑＝ぜんぶ、
   こい緑＝かならず やる）。保護者ページだけ「つぎに やる」が黄色だった。 */
test('進みぐあいのバーは、保護者ページも子ども画面と同じ濃淡でそろえる', ()=>{
  /* 子ども画面の決めかた */
  assert.match(STYLE, /\.bar-fill--todo\{ background:var\(--wakaba\); opacity:\.42; \}/);
  assert.match(STYLE, /\.bar-fill--must\{[\s\S]{0,80}background:var\(--wakaba\);/);
  /* 保護者ページも同じ色・同じ濃さにする */
  assert.match(STYLE, /\.pstat-fill--must\{ background:var\(--wakaba\); \}/);
  assert.match(STYLE, /\.pstat-fill--all\{ background:var\(--wakaba\); opacity:\.42; \}/);
  assert.match(STYLE, /\.pstat-fill--opt\{ background:var\(--wakaba\); opacity:\.42; \}/);
  /* 黄色は見出しの色として残す。見出しと進みぐあいは役割がちがう */
  assert.match(STYLE, /\.sec-opt\s+\.sec-head\{ background:var\(--himawari\); \}/);
  assert.doesNotMatch(STYLE, /\.pstat-fill--opt\{ background:var\(--himawari\)/);
});

/* ネコの帯が見出しのブロックと同じこげ茶で、やわらかさが出ていなかった。
   帯だけテーマで色を変えられるようにし、白い字が読める明るさに収める。 */
test('帯の色はテーマごとに変えられ、ネコは見出しと別の色にする', ()=>{
  assert.match(STYLE, /background:var\(--band, var\(--ai\)\);/,
    '既定は見出しと同じ --ai にたおすこと');
  const tokens = fs.readFileSync(path.join(ROOT, 'tokens.css'), 'utf8');
  assert.match(tokens, /--band:oklch\(46% \.075 48\);/);
  assert.match(tokens, /--cat-band-mark:/);
  /* 肉球は帯の上に置くので、帯用の色を使うこと */
  assert.match(STYLE, /\[data-theme="cat"\] \.topband-mark\{[\s\S]{0,120}background:var\(--cat-band-mark\);/);
});

/* 3本を色の濃さだけで分けると「全体」と「つぎに やる」が同じうすい緑に
   なる。全体に別の濃さをあてると子ども画面のうすい層とずれる。
   そこで色ではなく、かたちで分ける。 */
test('全体の行は、子ども画面と同じ2枚がさねで見分ける', ()=>{
  const f = grab(APP, 'pstatRow');
  assert.match(f, /function pstatRow\(label, pct, count, kind, inner\)/);
  assert.match(f, /inner === undefined \? '' :/,
    '内わけを渡した行だけ、かさねること');
  assert.match(f, /pstat-fill--inner/);
  const parent = grab(APP, 'viewParent');
  assert.match(parent, /pstatRow\('全体の進捗'[^)]*'all', allTotal \? s\.done\/allTotal\*100 : 0\)/,
    '全体の行にだけ必須のぶんをかさねること');
  assert.doesNotMatch(parent, /pstatRow\('必須の宿題'[^)]*,[^)]*,[^)]*,[^)]*,[^)]*\)/,
    'ほかの行にはかさねないこと');
  /* かさねかたは子ども画面と同じ */
  assert.match(STYLE, /\.pstat-fill--inner\{ position:absolute; left:0; top:0; background:var\(--wakaba\); \}/);
});

/* テーマごとのしるし。形は1色の抜き型なので、色は background で決まる。 */
test('名前のあるテーマには、そのテーマのしるしをあてる', ()=>{
  for(const [theme, file] of [['cat','paw.svg'], ['sunny','sun.svg'], ['soda','soda.svg'],
                              ['berry','berry.svg'], ['block','block.svg']]){
    /* 抜き型の URL には版をつけること。つけないと、図案を直しても
       端末が前のものを取り出しつづける（実機でベリーが出なかった） */
    const re = new RegExp('\\[data-theme="' + theme + '"\\] \\.topband-mark\\{[\\s\\S]{0,240}mask:url\\("'
      + file.replace('.', '\\.') + '\\?v=[0-9a-z]+"\\)');
    assert.match(STYLE, re, theme + ' に ' + file + ' をあてること');
    assert.ok(fs.existsSync(path.join(ROOT, 'assets', file)), file + ' が無い');
  }
  /* ノートは4色の帯のまま（見出しシールに見立てている） */
  assert.doesNotMatch(STYLE, /\[data-theme="notebook"\] \.topband-mark/);
});

/* 帯だけあたためても、見出しが使いまわしの赤・紫のままでは
   「よその色をかりた」ように見える。意味のわけかたは変えずに色みをずらす。 */
test('ネコは見出しの色みもテーマに合わせる', ()=>{
  const tokens = fs.readFileSync(path.join(ROOT, 'tokens.css'), 'utf8');
  const cat = tokens.slice(tokens.indexOf('[data-theme="cat"]'), tokens.indexOf('[data-theme="cat"] body'));
  assert.match(cat, /--suika:oklch\(53% \.125 25\)/);
  assert.match(cat, /--asagao:oklch\(53% \.095 318\)/);
  assert.match(cat, /--wakaba:oklch\(50% \.085 152\)/);
  /* 意味のわけかたは、ほかのテーマと同じ4色のままにすること */
  ['--suika','--himawari','--asagao','--wakaba'].forEach(n=>{
    assert.ok(cat.includes(n + ':'), n + ' を残すこと');
  });
});

/* iPad の2つ並びカードで「きのう できたね」がバーを押しつぶした。
   バーとは別の固定行へ置き、カード間でも位置をそろえる。 */
test('まいにちのそえ書きは、バーと分けた固定行へ置く', ()=>{
  assert.match(STYLE, /\.task-meter--daily \.bar\{ flex:1 1 200px; min-width:150px; \}/);
  assert.match(STYLE, /\.task-streak-row\{[\s\S]{0,140}justify-content:flex-end/);
  assert.match(STYLE, /\.task-streak-row \.streak\{[^}]*min-width:150px/);
});

/* 1本の長い文だと、せまい画面で「© 2026」と名前のあいだなど、
   意味の切れないところで折り返す。 */
test('最下部のクレジットは、意味のかたまりで折り返す', ()=>{
  const f = grab(APP, 'creditHTML');
  assert.equal((f.match(/class="credit-part"/g) || []).length, 5,
    '作品名と著作権表示・ライセンス・変更履歴・公開版・内部配信番号を意味単位に分けること');
  assert.match(STYLE, /\.credit-part\{ display:inline-block; white-space:nowrap; \}/);
  assert.match(f, /<br><span class="credit-part"><a /,
    '著作権表示の後でライセンスを改行すること');
  assert.doesNotMatch(STYLE, /\.credit-part \+ \.credit-part::before/,
    'ライセンスとの間に中黒を表示しないこと');
  /* 表示義務のある中身は落とさないこと */
  assert.match(f, /CREDIT\.title/);
  assert.match(f, /CREDIT\.year/);
  assert.match(f, /CREDIT\.author/);
  assert.match(f, /CREDIT\.url/);
});

/* 「かなにする」単体ページ。しゅくだいノートとは別の読みもので、
   共有も記録もしない。使うのは kanji.js だけ。 */
test('かなにするページは、記録も共有もしない', ()=>{
  const html = fs.readFileSync(path.join(ROOT, 'kana.html'), 'utf8');
  const js = fs.readFileSync(path.join(ROOT, 'assets', 'kana.js'), 'utf8');
  /* 同期・保存の仕組みを持ちこまないこと */
  assert.doesNotMatch(html, /sync\.js|app\.js|data\.js/, '本体のスクリプトを読まないこと');
  assert.doesNotMatch(js, /localStorage|NatsuSync|firebase/i, '端末にもクラウドにも残さないこと');
  assert.match(html, /assets\/kanji\.js/);
  assert.match(html, /assets\/kana\.js/);
  /* 入れた文をどこにも送らないと書いてあること */
  assert.match(html, /どこにも送りません/);
  /* 辞書は18MB。はじめの1回だけであることを先に伝える */
  assert.match(html, /約18MB/);
  /* 独自のクレジット。別の主体として名のる */
  assert.match(html, /「かなにする」/);
  assert.match(html, /Apache-2\.0/);
  assert.match(html, /CC BY 4\.0/);
});

test('かなにするページは、辞書が無くても印だけは出す', ()=>{
  const js = fs.readFileSync(path.join(ROOT, 'assets', 'kana.js'), 'utf8');
  /* 印は辞書なしで出せる。学年を変えたらすぐ反映する */
  assert.match(js, /gradeSel\.addEventListener\('change', applyGrade\)/);
  assert.match(js, /src\.addEventListener\('input', renderMarks\)/);
  assert.match(js, /markUnlearnedHTML\(text\)/);
  /* 変換に失敗しても、元の文と印は残して手直しできるようにする */
  assert.match(js, /if\(!r\.ok\)\{[\s\S]{0,260}手で直してください/);
  /* 18MB の進み具合を出す。出さないと止まったのか待てばよいのか分からない */
  assert.match(js, /setDictProgress/);
});

/* --- 学年別漢字配当表 -----------------------------------------------------
   表そのものは docs/kanji-grades.md のとおり原典と突き合わせて入れた。
   ここで見るのは「あとから壊れていないか」。字数は原典が括弧書きしている
   数字そのものなので、1文字でも増減すれば必ずどこかが合わなくなる。
   -------------------------------------------------------------------------- */

const KANJI_SRC = fs.readFileSync(path.join(ROOT, 'assets', 'kanji.js'), 'utf8');

/* kanji.js は素の script。ワーカーも辞書も触らせずに、判定の部分だけ動かす */
function loadKanji(){
  const ctx = vm.createContext({
    URL,
    location: { href: 'https://example.test/assets/kanji.js' },
    setTimeout, clearTimeout,
  });
  vm.runInContext(KANJI_SRC, ctx);
  return ctx;
}

function gradeChars(n){
  const i = KANJI_SRC.indexOf('const KANJI_G' + n);
  const j = KANJI_SRC.indexOf(';', i);
  return [...KANJI_SRC.slice(i, j).replace(/[^\u3400-\u9FFF]/g, '')];
}

test('配当表の字数は、原典の括弧書きと同じ', ()=>{
  const want = { 1:80, 2:160, 3:200, 4:202, 5:193, 6:191 };
  let total = 0;
  for(const n of [1,2,3,4,5,6]){
    const chars = gradeChars(n);
    assert.equal(chars.length, want[n], '小' + n + '年の字数');
    total += chars.length;
  }
  /* 1,026字。改訂前の版は1,006字なので、取り違えるとここで落ちる */
  assert.equal(total, 1026);
});

test('配当表に、同じ字は二度出てこない', ()=>{
  const seen = new Map();
  for(const n of [1,2,3,4,5,6]){
    for(const ch of gradeChars(n)){
      const before = seen.get(ch);
      assert.equal(before, undefined,
        ch + ' が 小' + before + '年 と 小' + n + '年 の両方にある');
      seen.set(ch, n);
    }
  }
  assert.equal(seen.size, 1026);
});

/* ソースの1行が配当表の1行。PDF と並べて行ごとに照合できるようにしてある。
   折り返しを変えると、その照合ができなくなる */
test('配当表は、原典と同じ1行20字で折り返す', ()=>{
  for(const n of [1,2,3,4,5,6]){
    const i = KANJI_SRC.indexOf('const KANJI_G' + n);
    const rows = KANJI_SRC.slice(i, KANJI_SRC.indexOf(';', i))
      .split('\n').slice(1).map(l => [...l.replace(/[^\u3400-\u9FFF]/g, '')])
      .filter(r => r.length);
    rows.slice(0, -1).forEach((r, k)=>{
      assert.equal(r.length, 20, '小' + n + '年 ' + (k + 1) + '行目');
    });
    assert.ok(rows.at(-1).length <= 20);
  }
});

test('学年を選ぶと、その学年までが習った字になる', ()=>{
  const k = loadKanji();
  /* vm の中で作った配列は外の Array と別物なので、文字列にして比べる */
  const unlearned = text => k.unlearnedKanji(text).join('');

  /* 0 は「まだ何も習っていない」。漢字はすべて未習 */
  k.setReadingGrade(0);
  assert.equal(unlearned('一'), '一');

  /* 各学年で、その学年の字は既習・次の学年の字は未習になる */
  for(const n of [1,2,3,4,5]){
    k.setReadingGrade(n);
    const mine = gradeChars(n).at(-1), next = gradeChars(n + 1)[0];
    assert.equal(unlearned(mine), '', '小' + n + '年: ' + mine + ' は既習');
    assert.equal(unlearned(next), next, '小' + n + '年: ' + next + ' は未習');
  }

  /* 小6まで選べば、配当表の1,026字はすべて既習 */
  k.setReadingGrade(6);
  assert.equal(unlearned([1,2,3,4,5,6].flatMap(gradeChars).join('')), '');

  /* 配当表の外（中学以降）の字は、小6を選んでも未習のまま */
  assert.equal(unlearned('斬'), '斬');

  /* 9 は「直さない」。印も出さない */
  k.setReadingGrade(9);
  assert.equal(unlearned('斬'), '');

  /* 知らない値は、これまで通り小2に落とす */
  k.setReadingGrade(7);
  assert.equal(k.getReadingGrade(), 2);
  k.setReadingGrade('ねこ');
  assert.equal(k.getReadingGrade(), 2);
});

test('かなにするページは、小1から小6まで選べる', ()=>{
  const html = fs.readFileSync(path.join(ROOT, 'kana.html'), 'utf8');
  for(const n of [0,1,2,3,4,5,6,9]){
    assert.match(html, new RegExp('<option value="' + n + '"'), '学年 ' + n);
  }
  /* 初期値は小2のまま。本体の想定読者と揃えておく */
  assert.match(html, /<option value="2" selected>/);
});

/* 「宿題を追加」が 必ず行う宿題の下に 1つだけ 出ていて、押すと
   次に行う宿題に 足されていた。見えている場所と 足される場所が
   ちがうと、画面から 直しかたが 読みとれない。 */
test('宿題の4つの欄は、同じ骨組みで組む', ()=>{
  const view = grab(APP, 'viewTasks');
  const sec = grab(APP, 'taskSectionHTML');

  /* 欄ごとに手で組むと、また片方だけ揃わなくなる。型は1つ */
  assert.equal((view.match(/taskSectionHTML\(\{/g) || []).length, 4,
    '4つの欄はすべて taskSectionHTML で組むこと');
  assert.doesNotMatch(view, /class="paper task-editor"/,
    '欄ごとに紙を手で組まないこと');

  /* 追加ボタンは 紙の中の 末尾。どの欄に足されるかを 居場所で示す */
  const order = ['o.head', 'config-section-note', 'task-editor', 'set-actions'];
  let at = -1;
  for(const part of order){
    const next = sec.indexOf(part);
    assert.ok(next > at, part + ' の位置が違う');
    at = next;
  }
  /* 件数の出しかたも4つで揃える */
  assert.match(sec, /o\.rows\.length\}件/);
});

test('宿題を足すと、押したボタンの欄に入る', ()=>{
  const bind = grab(APP, 'bindConfig');
  /* group を決め打ちせず、押したボタンから受けとること */
  assert.match(bind, /function addNormalTask\(group\)\{[\s\S]{0,200}id: 't' \+ Date\.now\(\), group,/);
  assert.match(bind, /on\('#addMustTask',\s*'click',\s*\(\)=>addNormalTask\('must'\)\)/);
  assert.match(bind, /on\('#addOptionTask',\s*'click',\s*\(\)=>addNormalTask\('option'\)\)/);
});

test('「よゆう」は全体と必須の両方が夏休みより大幅に進んだときだけ出す', ()=>{
  const start = APP.indexOf('const PACE_MESSAGES');
  const end = APP.indexOf('/* 夏休みの経過率', start);
  const pace = new Function(APP.slice(start, end) + '; return { verdictOf, paceMessage, paceVerdictSizeClass, PACE_MESSAGES };')();

  const roomy = pace.verdictOf(12, 10);
  assert.equal(roomy.cls, 'v-good');
  assert.ok(pace.PACE_MESSAGES.good.includes(roomy.msg));

  /* 任意を進めて全体が先行しても、必須が夏休み経過に足りなければ必須優先。 */
  const focus = pace.verdictOf(12, -1);
  assert.equal(focus.cls, 'v-hmm');
  assert.equal(focus.focusMust, true);
  assert.ok(pace.PACE_MESSAGES.focus.includes(focus.msg));

  /* 必須が少し先行しているだけでは「よゆう」とは言わない。 */
  assert.notEqual(pace.verdictOf(18, 1).cls, 'v-good');
  Object.values(pace.PACE_MESSAGES).forEach(rows=>assert.ok(rows.length >= 8,
    '進捗メッセージは各状態に8案以上用意する'));
  const visualWidth = msg => Array.from(msg).reduce((n, ch) =>
    n + (ch === ' ' ? .35 : '！「」'.includes(ch) ? .55 : 1), 0);
  Object.values(pace.PACE_MESSAGES).flat().forEach(msg=>assert.ok(visualWidth(msg) <= 13.25,
    '320pxで14pxの1行に収まる長さにする: ' + msg));

  /* UTCの日替わり（日本時間9時）ではなく、端末の0時まで同じ文言を保つ。 */
  const morning = pace.paceMessage('steady', 2, 1, new Date(2026, 7, 11, 0, 1));
  const night = pace.paceMessage('steady', 2, 1, new Date(2026, 7, 11, 23, 59));
  assert.equal(morning, night, '同じ暦日の途中で励まし文を変えない');

  /* 長い案だけ縮め、短い案の大きさは保つ。 */
  assert.equal(pace.paceVerdictSizeClass('いいペース！'), '');
  assert.equal(pace.paceVerdictSizeClass('つぎの ひとつへ いこう！'), ' pace-verdict--medium');
  assert.equal(pace.paceVerdictSizeClass('ちいさく すすめば だいじょうぶ！'), ' pace-verdict--long');
});

test('励まし文と「あと」は狭い画面でも一続きに読める', ()=>{
  assert.match(APP, /<p class="count-lead">なつやすみ おわりまで<\/p>/);
  assert.match(APP, /big \? '<span class="cd-prefix">あと<\/span>' : ''/,
    '「あと」は日数の数字盤に結びつける');
  assert.match(STYLE, /\.cd-unit--big\{ position:relative; \}/);
  assert.match(STYLE, /\.cd\{[\s\S]{0,180}transform:translateX\(6px\)/,
    '「あと」を足した見た目の重心を右へ戻す');
  assert.match(STYLE, /\.cd-prefix\{[\s\S]*inset-inline-end:calc\(100% \+ 6px\)[\s\S]*white-space:nowrap/);
  assert.match(STYLE, /\.pace-verdict\{[\s\S]*white-space:nowrap[\s\S]*padding:10px 6px/);
  assert.match(STYLE, /\.pace-verdict--medium\{ font-size:clamp\(16px, 4\.4vw, 19px\); \}/);
  assert.match(STYLE, /\.pace-verdict--long\{ font-size:clamp\(14px, 3\.9vw, 17px\); \}/);
});

test('完了予測は全体進捗から求め、実績が少ないときは行動を示す', ()=>{
  const forecast = new Function('clamp', 'parseLocal', `
    ${grab(APP, 'completionForecast')}
    ${grab(APP, 'forecastText')}
    return { completionForecast, forecastText };
  `)((n,a,b)=>Math.max(a,Math.min(b,n)), s=>new Date(s));

  const start = new Date(2026, 6, 1);
  const now = new Date(2026, 6, 11);
  const dated = forecast.completionForecast(25, 100, start, now);
  assert.equal(dated.kind, 'date');
  assert.equal(dated.label, '8月10日');
  assert.equal(forecast.forecastText(dated, false), '完了予測 8月10日');
  assert.equal(forecast.forecastText(dated, true), 'かんりょうよそく：いまのペースだと8月10日');

  /* 夏休み終了日を越えても、利用者が日付を見て判断できるよう隠さない。 */
  const afterVacation = forecast.completionForecast(50, 100, start, new Date(2026, 7, 10));
  assert.equal(afterVacation.kind, 'date');
  assert.equal(afterVacation.label, '9月19日');
  assert.equal(forecast.forecastText(afterVacation, true), 'かんりょうよそく：いまのペースだと9月19日');

  const little = forecast.completionForecast(1, 100, start, now);
  assert.equal(little.kind, 'more');
  assert.equal(forecast.forecastText(little, false), '進捗が増えると予測できます');
  assert.doesNotMatch(forecast.forecastText(little, false), /計算中/);
  assert.equal(forecast.completionForecast(100, 100, start, now).kind, 'done');
  assert.equal(forecast.completionForecast(0, 0, start, now).kind, 'empty');
});

test('保護者ページは縦の余白を節約する表示になっている', ()=>{
  const settings = grab(APP, 'viewParent');
  const messageEditor = grab(APP, 'parentMessageEditorHTML');
  const credit = grab(APP, 'creditHTML');

  assert.match(settings, /parent-head-title"><h2>保護者用ページ<\/h2>\$\{parentShareBadgeHTML\(\)\}/,
    '共有中バッジは保護者用ページと同じ行に置く');
  assert.doesNotMatch(settings, /\$\{esc\(config\.title\)\}/,
    '上部帯と同じタイトルを保護者見出しの下へ重ねて表示しない');
  assert.doesNotMatch(messageEditor, /その名前のメッセージ/,
    'メッセージ欄の説明を簡潔にする');
  assert.match(messageEditor, /同じ名前で送ると、メッセージを上書きします。/);
  assert.ok(settings.indexOf('<section class="paper pstat">') < settings.indexOf('${parentMessageEditorHTML()}'),
    '夏休みの残りを子どもへのメッセージより先に置く');
  assert.match(credit, /<br><span class="credit-part"><a /,
    '著作権表示の後でライセンスを改行する');
  assert.doesNotMatch(STYLE, /\.credit-part \+ \.credit-part::before/,
    'クレジットの中黒を表示しない');
  assert.match(STYLE, /\.set-task-summary strong\{[\s\S]*font-size:17px/);
  assert.match(STYLE, /\.book-title\{ font-size:17px/);
  assert.match(STYLE, /\.toast\{[\s\S]*font-size:16px/);
  assert.match(STYLE, /\.parent-message-text textarea\{[\s\S]*height:48px[\s\S]*box-sizing:border-box[\s\S]*font-size:17px/);
  assert.match(STYLE, /\.parent-sender-fields select,\.parent-sender-fields input\{[\s\S]*height:48px[\s\S]*font-size:17px/,
    '差出人欄もメッセージ欄と同じ高さ・文字サイズにする');
  assert.match(STYLE, /\.parent-today-logs \.ti-name\{ font-size:17px; \}/,
    '保護者ページの記録名は宿題一覧と同じ17pxにする');
  assert.match(APP, /<span class="parent-share-short">：設定<\/span>/,
    '狭い画面では共有設定の案内を短くする');
  assert.match(STYLE, /\.parent-head-title\{[^}]*width:100%/,
    '保護者ページの見出し行はカード幅を使う');
  assert.match(STYLE, /\.parent-share-badge\{[\s\S]*?margin:5px 0 0 auto/,
    '共有表示は見出し行の右端に寄せる');
  assert.match(STYLE, /\.pagenav\{[\s\S]*?grid-template-columns:repeat\(3,minmax\(0,1fr\)\) auto/,
    '子ども画面への導線は3つの保護者タブと同じ段に置く');
  assert.doesNotMatch(STYLE, /\.pagenav-child\{[^}]*grid-column:1 \/ -1/,
    '子ども画面への導線だけを別段に落とさない');
  assert.match(STYLE, /\.pace-forecast\{[\s\S]*font-size:12px/);
  assert.match(APP, /<span>かんりょうよそく：<\/span><span>いまのペースだと\$\{esc\(forecast\.label\)\}<\/span>/,
    '狭幅では日付の途中でなくコロンの後を折り返し位置にする');
  assert.match(STYLE, /\.pace-forecast span\{ white-space:nowrap; \}/,
    '「9がつ7にち」の途中では折り返さない');
  assert.doesNotMatch(STYLE, /\.pace-forecast\{[^}]*border:/,
    '子どもの完了予測は吹き出し風にしない');
  assert.match(STYLE, /\.pstat-forecast\{[\s\S]*font-size:12px/);
  assert.match(APP, /class="next-lead"[\s\S]{0,180}class="next-num"[\s\S]{0,180}class="next-tail"/,
    '次の番号は案内・大きい数字・単位を同じ構造で組む');
  assert.match(STYLE, /\.task-next\{[\s\S]{0,120}align-items:baseline/,
    '大きい数字と単位は文字の下端が自然にそろうベースライン配置にする');
  assert.match(STYLE, /\.task-state\{[\s\S]{0,180}background:var\(--ai\)/,
    '完了状態の印は丸つけ・なおしの緑と区別してテーマ色にする');
  assert.match(STYLE, /\.wrapmark\.is-on\{[\s\S]{0,160}background:var\(--wakaba\)/,
    '丸つけ・なおしの完了色はこれまでどおり緑を保つ');
  assert.match(STYLE, /@media \(min-width:561px\)\{[\s\S]{0,180}\.task-list:not\(\.task-list--2up\) > \.task\{[\s\S]{0,100}184px/,
    'iPadでは操作文言に左右されない固定幅の列を確保する');
  assert.match(STYLE, /\.task-list:not\(\.task-list--2up\) > \.task \.task-act > \.btn\{[\s\S]{0,80}width:100%/,
    'iPadの操作ボタンは固定列いっぱいにそろえる');
});

test('今日はなんの日は確認済みの8月21日分だけを持ち、処暑を年別にする', ()=>{
  const box = {};
  vm.runInNewContext(DATA + ';this.fixed=KINENBI_BY_MONTH_DAY;this.dated=KINENBI_BY_DATE;', box);
  assert.equal(Object.keys(box.fixed).length, 20);
  assert.equal(Object.keys(box.dated).length, 1);
  assert.equal(box.fixed['08-23'], undefined, '処暑を月日固定にしないこと');
  assert.equal(box.dated['2026-08-23'].title, '処暑');
  assert.match(box.fixed['08-17'].title, /夜の試合/);
  assert.match(box.fixed['08-18'].title, /女性の投票権/);
  assert.doesNotMatch(box.fixed['08-18'].text, /米の日|高校野球/);
});

test('記念日の閲覧足跡は専用localStorageだけに保存する', ()=>{
  assert.match(APP, /K_KINENBI_VIEWED = TEST_MODE \? 'natsu\.preview\.kinenbi\.viewed\.v1' : 'natsu\.kinenbi\.viewed\.v1'/);
  const mark = grab(APP, 'markKinenbiViewed');
  assert.match(mark, /setLocal\(K_KINENBI_VIEWED, JSON\.stringify\(viewed\)\)/);
  assert.doesNotMatch(mark, /pushRead|saveSt|syncPush|state\./,
    '共有stateや90日の活動時刻を変更しないこと');
});

test('日付ボタンは44px以上で、独自ダイアログと未読・低モーション表示を持つ', ()=>{
  assert.match(INDEX, /<button class="topband-date" id="todayLabel"[^>]*aria-haspopup="dialog"/);
  assert.match(INDEX, /<dialog class="kinenbi-dialog" id="kinenbiDialog"/);
  assert.match(STYLE, /\.topband-date\{[\s\S]{0,160}min-width:44px; min-height:44px/);
  assert.match(STYLE, /\.topband-date:focus-visible\{ outline:3px solid var\(--kami\); outline-offset:2px; \}/,
    '濃色の帯では紙色の高コントラストリングを使うこと');
  assert.match(STYLE, /\.topband-date\.has-unread \.topband-date-dot\{ display:block; \}/);
  assert.match(STYLE, /@media \(prefers-reduced-motion:reduce\)\{[\s\S]{0,180}\.topband-date\.is-nudging\{ animation:none; \}/);
  assert.match(STYLE, /\.kinenbi-close\{[^}]*white-space:nowrap/);
  assert.match(STYLE, /\.kinenbi-dialog\{[^}]*width:min\(calc\(100% - 32px\), 520px\)/);
  assert.doesNotMatch(grab(APP, 'renderKinenbiButton'), /\.hidden\s*=/,
    '題材がない日も右上の日付そのものは消さないこと');
});

test('日付ボタンは上帯の先頭戻り・長押し・5回タップから除外する', ()=>{
  assert.match(APP, /function fromKinenbi\(e\)\{[^}]*closest\('#todayLabel'\)/);
  const tail = APP.slice(APP.indexOf('function fromKinenbi'));
  assert.ok((tail.match(/fromKinenbi\(e\)/g) || []).length >= 6,
    'click・touch・mouseの各親ハンドラで日付ボタンを判定すること');
  assert.match(tail, /addEventListener\('touchend',\s+cancel\)/);
  assert.match(tail, /addEventListener\('mouseup',\s+cancel\)/,
    '帯の別位置から日付上へ移動して離しても長押しタイマーを必ず止めること');
  assert.match(APP, /if\(e\.target\.closest\('#todayLabel'\)\)\{ openKinenbi\(new Date\(\)\); return; \}/);
});

test('画面を開いたまま日付が変わっても上帯と内容を当日にそろえる', ()=>{
  assert.match(APP, /visibilitychange[\s\S]{0,180}renderKinenbiButton\(new Date\(\)\)/,
    '保護者ページなどhome以外から復帰しても日付を更新すること');
  assert.match(APP, /if\(dayKey\(now\) !== kinenbiRenderedDay\) renderKinenbiButton\(now\);/,
    '前景のまま0時を越えた場合も日付を更新すること');
});

test('native dialogの閉じ方が変わっても状態を同期し、背景だけで閉じる', ()=>{
  assert.match(APP, /kinenbiDialog\.addEventListener\('close', syncKinenbiClosed\)/,
    '端末の戻る操作などnative closeでもariaとfocusを戻すこと');
  const sync = grab(APP, 'syncKinenbiClosed');
  assert.match(sync, /setAttribute\('aria-expanded', 'false'\)/);
  assert.match(sync, /btn\.focus\(\)/);
  assert.match(APP, /const outside = e\.clientX < r\.left[\s\S]{0,140}if\(outside\) closeKinenbi\(\)/,
    'dialog内の余白でなく矩形外の背景クリックだけを閉じること');
});

test('記念日の本文も子どもの漢字設定に合わせて既存のかな表示を使う', ()=>{
  const open = grab(APP, 'openKinenbi');
  assert.match(open, /applyReadingDisplay\(dialog\)/,
    '後から差し込む題名・本文・日付にも、画面本体と同じ変換を適用すること');
  const reading = grab(APP, 'applyReadingDisplay');
  assert.doesNotMatch(reading, /!getLocal\(K_READING\)/,
    '現在の共有設定で小1・小2を選んだ場合も、旧端末キーの有無で変換を止めないこと');
  assert.doesNotMatch(open, /ruby|furigana|readingOverride/,
    '固有名詞・年号に未確認の個別読みを埋め込まないこと');
});

test('子どもの記録は現在の単位と漢字レベルで冊・枚を表示し直す', ()=>{
  const row = grab(APP, 'logRowHTML');
  const display = grab(APP, 'logWhatDisplay');
  assert.match(row, /logWhatDisplay\(l, adult\)/,
    '保存時の文言をそのまま出さず、表示用の単位を使うこと');
  assert.match(display, /isBook\(task\) \? bookCountUnit\(adult\)/,
    '本は子どもの漢字設定に応じて冊・さつを切り替えること');
  assert.match(display, /unitForLogDisplay\(task\.unit, adult\)/,
    '枚数なども表示先に合わせた単位を使うこと');
  const unit = grab(APP, 'unitForLogDisplay');
  assert.match(unit, /adult \|\| readingGrade\(\) === 9\) return kanji/,
    '保護者と「漢字のまま」の子どもには冊・枚を出すこと');
  assert.match(unit, /Object\.keys\(ADULT_UNIT\)/,
    '低学年の子どもには既存のひらがな単位へ戻すこと');
});

test('記念日ダイアログは本文とずれる背景罫線を使わない', ()=>{
  const dialog = STYLE.slice(STYLE.indexOf('.kinenbi-dialog{'), STYLE.indexOf('.kinenbi-dialog::backdrop'));
  assert.doesNotMatch(dialog, /background-image|background-size/,
    'iPhone・iPadで文字の行送りとずれる罫線を引かないこと');
  assert.match(STYLE, /\.kinenbi-head\{[^}]*border-bottom:2px dashed var\(--hougan\)/,
    '無地でも見出しと本文の区切りは残すこと');
});

test('子どもの「きょう やったこと」は保護者の記録見出しと同じ白抜き帯にする', ()=>{
  assert.match(APP, /<section class="sec sec-today">\s*<div class="sec-head"><h2>きょう やったこと<\/h2>/);
  assert.match(STYLE, /\.sec-today \.sec-head\{ background:var\(--ai\); color:var\(--kami\); \}/);
  assert.match(STYLE, /\.sec-today \.sec-head \.sec-note\{ color:var\(--on-band-muted\); \}/);
});

test('子ども画面のタブと月移動は端末依存の絵文字でなく線画アイコンを使う', ()=>{
  assert.match(INDEX, /data-tab="home"[\s\S]{0,420}<svg viewBox="0 0 24 24">/);
  assert.match(INDEX, /data-tab="log"[\s\S]{0,500}<svg viewBox="0 0 24 24">/);
  assert.match(INDEX, /data-tab="calendar"[\s\S]{0,500}<svg viewBox="0 0 24 24">/);
  assert.doesNotMatch(INDEX, /🏠|📖|🗓️/,
    'OSごとに見え方が変わる絵文字を下部タブに残さないこと');
  const calendar = grab(APP, 'viewCalendar');
  assert.match(calendar, /aria-label="まえの月"[\s\S]{0,100}\$\{calChevronIcon\(-1\)\}/);
  assert.match(calendar, /aria-label="つぎの月"[\s\S]{0,100}\$\{calChevronIcon\(1\)\}/);
  assert.match(calendar, /\$\{calPencilIcon\(\)\}/,
    'なんでも記録の日も端末依存の絵文字ではなく鉛筆ピクトグラムで示すこと');
  assert.doesNotMatch(calendar, /📝/);
  assert.match(APP, /function calPencilIcon\(\)\{/);
  assert.match(STYLE, /\.cal-pencil-icon\{[^}]*stroke:currentColor/);
  assert.match(STYLE, /\.cal-nav \.btn\{[\s\S]{0,160}flex:0 0 44px/,
    '月移動はアイコンのみでも44pxの押しやすさを保つこと');
});

test('必須・任意・読書の完了カードは「ぜんぶできた！」と表示する', ()=>{
  const card = grab(APP, 'taskHTML');
  assert.match(card, /t\.group === 'must' \|\| t\.group === 'option' \? ' task-whole' : ''/,
    '必須・任意と、そのどちらかに属する読書だけへ完了用クラスを付けること');
  assert.match(card, /t\.group === 'must' \|\| t\.group === 'option' \? 'ぜんぶできた！' : 'できた！'/);
  assert.match(card, /class="task-state">\$\{esc\(stateLabel\)\}/,
    '完了印はタイトル本文とは別の固定枠へ置くこと');
  assert.match(STYLE, /\.task-name\{[\s\S]{0,180}grid-template-columns:minmax\(0,1fr\) auto/,
    'タイトルの長さにかかわらず完了印を右端へ置くこと');
  assert.match(card, /: 'できた！'\)/,
    '毎日の項目は従来の「できた！」を保つこと');
});

test('残り種類・区分完了・毎日の連続表示を共通の位置にそろえる', ()=>{
  const home = grab(APP, 'viewHome');
  const section = grab(APP, 'sectionHTML');
  const card = grab(APP, 'taskHTML');

  assert.match(home, /const optLeft = opt\.filter\(t=>!prog\(t\)\.isDone\)\.length/);
  assert.match(home, /sectionHTML\('opt','つぎに やる','のこり '\+optLeft\+'しゅるい'/,
    'つぎにやるにも残り種類数を表示すること');
  assert.match(section, /tasks\.length > 0 && tasks\.every\(t=>prog\(t\)\.isDone\)/);
  assert.match(section, /class="sec-complete-mark"/,
    '必須・任意の全項目完了時は区分全体の完了スタンプを出すこと');
  assert.match(card, /const streak = t\.type === 'daily' \? streakLabel\(p\) : ''/);
  assert.match(card, /class="task-streak-row"/,
    'なんでもきろくを含む全ての毎日項目で共通の連続表示枠を使うこと');
  assert.doesNotMatch(card, /task-meter[^`]*streakLabel\(p\)/,
    'バーの幅やタイトルの行数で連続表示の位置を決めないこと');
  assert.match(STYLE, /\.task-streak-row\{[\s\S]{0,140}justify-content:flex-end/);
  assert.match(STYLE, /\.task-streak-row \.streak\{[^}]*min-width:150px/);
});

test('公開アセットのキャッシュ版を一式そろえる', ()=>{
  const versions = {
    'assets/style.css': '20260816k',
    'tokens.css': '20260813a',
    'assets/kanji.js': '20260813a',
    'assets/data.js': '20260814b',
    'assets/app.js': '20260816k',
    'assets/sync.js': '20260816b'
  };
  for(const [file, version] of Object.entries(versions)){
    assert.match(INDEX, new RegExp(file.replace(/[.]/g, '\\.') + '\\?v=' + version));
  }
});

test('招待QRは端末内で読み取り、既存の共有参加だけへ渡す', ()=>{
  assert.match(INDEX, /assets\/vendor\/jsqr\.js\?v=1\.4\.0/);
  assert.match(APP, /function inviteCodeFromQR\(value\)/);
  assert.match(APP, /url\.origin !== location\.origin \|\| url\.pathname !== location\.pathname/);
  assert.match(APP, /const code = cleanCode\(url\.searchParams\.get\(JOIN_PARAM\) \|\| ''\)/);
  assert.match(APP, /url\.searchParams\.get\('fromRole'\) === 'parent'[\s\S]{0,120}url\.searchParams\.get\('fromRole'\) === 'child'/, 'QRには表示元の端末名・役割を必要な範囲で入れる');
  assert.match(APP, /S\.verifyHousehold\(code\)/);
  assert.match(APP, /グループが実在し中身を読めることを確認します/, '読み取り後に確認内容を説明する');
  assert.match(APP, /確認OK：.*と同じグループに接続します/, '確認できた共有先を明示する');
  assert.match(APP, /確定して続ける/, '確認後の確定操作を明確にする');
  assert.match(APP, /data-qr-invite-scan/);
  assert.match(STYLE, /\.qr-scan-dialog\{/);
  assert.match(STYLE, /@media \(max-width:360px\)/);
});

test('公開版番号v1.3.15をアプリ・HTML・package・変更履歴でそろえる', ()=>{
  assert.match(APP, /const RELEASE_VERSION = '1\.3\.15';/);
  assert.match(INDEX, /<meta name="application-version" content="1\.3\.15">/);
  assert.equal(PACKAGE.version, '1.3.15');
  assert.equal(PACKAGE_LOCK.version, '1.3.15');
  assert.equal(PACKAGE_LOCK.packages[''].version, '1.3.15');
  assert.match(UPDATES, /2026年8月16日　v1\.3\.15：[\s\S]*何回かに分けて記録.*入力欄へ出ない/);
  assert.match(UPDATES, /v1\.0\.0/);
  assert.match(APP, /v\$\{esc\(RELEASE_VERSION\)\}<\/b>（配信 \$\{appVersionHTML\(APP_VER\)\}）/,
    'アプリ情報では公開版と内部配信番号の意味を分ける');
});

test('公開説明はPV解析と宿題データを分け、学校との関係を断定しない', ()=>{
  for(const html of [DOCS_INDEX, GUIDE]){
    assert.match(html, /Cloudflare Web Analytics/);
    assert.match(html, /名前・宿題・記録/);
    assert.doesNotMatch(html, /学校とは関係|学校とは無関係|学校のアプリですか|学校や企業が提供するサービスではありません|教育委員会/);
  }
  assert.match(INDEX, /static\.cloudflareinsights\.com\/beacon\.min\.js/,
    '管理に必要なPV解析タグを公開版から外さないこと');
});

test('90日保持を自動削除と誤記せず、予告と対象範囲も説明する', ()=>{
  for(const text of [APP, DOCS_INDEX, GUIDE]){
    assert.match(text, /90日/);
    assert.match(text, /自動削除ではなく/);
  }
  assert.match(GUIDE, /予告メールはありません/);
  assert.match(GUIDE, /書き出したファイルは対象外/);
});

test('変更履歴は公開版と内部配信版の事実だけを短く並べる', ()=>{
  assert.match(UPDATES, /2026年8月14日　v1\.3\.1/);
  assert.match(UPDATES, /2026年8月14日　v1\.3\.0/);
  assert.match(UPDATES, /2026年8月13日　v1\.1\.0/);
  assert.match(UPDATES, /2026年8月13日　v1\.0\.0/);
  assert.match(UPDATES, /大きな互換変更[\s\S]*機能追加[\s\S]*修正/,
    '3桁のバージョン番号の意味を公開ページで説明する');
  assert.match(UPDATES, /20260812a–l/);
  assert.match(UPDATES, /20260811a–af/);
  assert.match(UPDATES, /20260810a–aw/);
  assert.doesNotMatch(UPDATES, /最優先｜|高｜|大切な訂正|確認してください|今回の対処項目/);
});

test('バックアップは版・日時を持ち、共有中の反映範囲を確認する', ()=>{
  const exported = grab(APP, 'exportData');
  const imported = grab(APP, 'importData');
  assert.match(exported, /exportVersion:\s*1/);
  assert.match(exported, /exportedAt:\s*new Date\(\)\.toISOString\(\)/);
  assert.match(imported, /backupPreviewText\(o\)/);
  assert.match(imported, /つないだ家族のデータにも反映されます/);
  assert.match(grab(APP, 'backupPreviewText'), /o\.config\.tasks\.length/);
  assert.match(GUIDE, /共有中にファイルを読み込むと、つないだ家族のデータにも反映されます/);
});

test('未送信の種類は端末に残し、再起動後も同じ合言葉で再送する', ()=>{
  assert.match(SYNC, /natsu\.sync\.pending\.v1/);
  assert.match(SYNC, /let pending = readPending\(\)/);
  assert.match(grab(SYNC, 'push'), /persistPending\(\)/);
  assert.match(grab(SYNC, 'flush'), /pendingVersion\.config === sentVersion\.config/);
  assert.match(SYNC, /addEventListener\('online', flushPendingSoon\)/);
});

test('紹介ページの実画面画像を装飾目的で傾けない', ()=>{
  assert.doesNotMatch(DOCS_STYLE, /workflow-step:nth-child\(2\)[^{]*\{[^}]*rotate/);
  assert.doesNotMatch(DOCS_STYLE, /extra-layout \.quiet-figure img\s*\{[^}]*rotate/);
  assert.match(DOCS_INDEX, /mini-contents-cat-v2\.png/);
});

test('変更履歴と制作・説明方針へ主要ページから到達できる', ()=>{
  assert.match(APP, /start\/updates\.html/);
  assert.match(DOCS_INDEX, /href="updates\.html"/);
  assert.match(GUIDE, /href="updates\.html"/);
  assert.match(PRODUCT_POLICY, /大きな仕様変更は、実装前に裁定を挟む/);
});

test('紹介ページは意味のまとまりで見出しを組み、開発者本人の説明を載せる', ()=>{
  assert.match(DOCS_INDEX, /個人で作っているWebアプリですが、便利だと思うので公開しています/);
  assert.match(DOCS_INDEX, /<title>しゅくだいノート｜あとどれくらい？が自分でわかる<\/title>/);
  assert.match(DOCS_INDEX, /<span class="title-line">宿題の残りを、<\/span><span class="title-line">子どもが自分で<\/span><span class="title-line">確かめられる。<\/span>/);
  assert.match(DOCS_INDEX, /Claude CodeおよびCodex/);
  assert.match(DOCS_INDEX, /小２息子の夏休みの宿題管理に疲れた/);
  assert.doesNotMatch(DOCS_INDEX, /宿題管理に疲れた等/);
  assert.match(DOCS_INDEX, /一般の使用にも資する面があるのではないか思い/,
    '開発者本人の文言は校正せず、そのまま載せること');
  assert.match(DOCS_INDEX, /<span class="maker-title-line">はじめに<\/span><span class="maker-title-line">―このアプリについて<\/span>/);
  assert.match(DOCS_STYLE, /#maker-title \.maker-title-line \+ \.maker-title-line[\s\S]*font-size: 0\.78em/);
  assert.match(DOCS_INDEX, /<span class="title-line trust-title__tail">知っておいてほしいこと。<\/span>/);
  assert.match(DOCS_INDEX, /不具合、誤謬や使いづらい点/);
  assert.match(DOCS_INDEX, /なお、この欄の文章はAI校正なしで開発者（人間）が書いています。/);
  assert.doesNotMatch(DOCS_INDEX, /もしお試しいただいた/);
  assert.doesNotMatch(DOCS_INDEX, /開発者本人からの説明です/);
  assert.doesNotMatch(DOCS_INDEX, /こんにちは。|公開版/);
  assert.match(DOCS_STYLE, /word-break: auto-phrase/);
  assert.match(PRODUCT_POLICY, /無関係な全機能テストを毎回実行/);
});

test('紹介ページの指摘箇所は実画面に沿う表現と配置にする', ()=>{
  assert.equal((DOCS_INDEX.match(/>保護者機能の紹介<\/a>/g) || []).length, 2);
  assert.doesNotMatch(DOCS_INDEX, />保護者向け<\/a>/);
  assert.match(DOCS_INDEX, /「あとどのくらい？」を、<\/span><span class="title-line">毎日見られるように。/);
  assert.match(DOCS_STYLE, /#made-for-title \.title-line:nth-child\(2\)[\s\S]*padding-inline-start: 1em/);
  assert.match(DOCS_INDEX, /進み具合を見て、<\/span><span class="title-line">ひとこと送れます。/);
  assert.match(DOCS_STYLE, /figure,[\s\S]*blockquote\s*\{\s*margin: 0;/);
  assert.match(DOCS_STYLE, /\.extra-layout \.quiet-figure::before/);
  assert.match(DOCS_STYLE, /\.extra-layout \.quiet-figure::after/);
  assert.match(DOCS_INDEX, /<h2 id="daily-title">「やった！」を押して記録<\/h2>/);
  assert.match(DOCS_STYLE, /\.stage-number\s*\{[^}]*background: var\(--color-navy\)[^}]*color: var\(--color-navy-ink\)[^}]*font-size: var\(--text-md\)/s);
  assert.match(DOCS_INDEX, /pace-fill--natsu/);
  assert.match(DOCS_INDEX, /pace-fill--todo/);
  assert.match(DOCS_INDEX, /pace-fill--must/);
  assert.match(DOCS_INDEX, /いまのペースで間に合う？/);
  assert.match(DOCS_INDEX, /かんりょうよそく：[\s\S]*いまのペースだと8月22日/);
  assert.doesNotMatch(DOCS_INDEX, /完了予測日を出しません/);
  assert.match(DOCS_STYLE, /repeating-linear-gradient/);
  assert.match(DOCS_STYLE, /height: 2rem;/);
  assert.match(DOCS_STYLE, /background: var\(--color-progress-track\)/);
  assert.match(DOCS_STYLE, /var\(--color-progress-summer\)/);
  assert.doesNotMatch(DOCS_STYLE, /\.hero-aside::after/);
  assert.match(DOCS_INDEX, /アプリ取得なし[\s\S]*登録不要/);
  assert.match(DOCS_STYLE, /\.hero-aside\s*\{[\s\S]*width: 8rem;[\s\S]*font-size: var\(--text-sm\);/);
  assert.match(DOCS_INDEX, /<h2 id="parents-title"><span class="title-line">進み具合を見て、<\/span><span class="title-line">ひとこと送れます。<\/span><\/h2>/);
  assert.match(DOCS_INDEX, /<div class="message-arrival">[\s\S]*images\/child-home\.png[\s\S]*保護者から送った短いメッセージは、宿題の進み具合の下に表示されます。/);
  assert.doesNotMatch(DOCS_INDEX, /子どもの画面では、ここに出ます。/);
  assert.match(DOCS_STYLE, /\.message-arrival__figure img[\s\S]*object-position: center 52%/);
  assert.match(DOCS_INDEX, /<span class="title-line">宿題のあとに、<\/span>/);
  assert.doesNotMatch(DOCS_INDEX, /ねこのデザインを選んだ画面。この日のことば/);
  assert.match(DOCS_INDEX, /細かい設定やデータの扱いは、画面写真つきの使い方のページをご覧ください/);
  assert.equal((DOCS_INDEX.match(/<summary>[^<]+？<\/summary>/g) || []).length, 5);
  assert.match(DOCS_INDEX, /ご意見・ご感想をいただけると嬉しいです/);
  assert.doesNotMatch(DOCS_INDEX, /しゅくだいノート · 個人制作 · 無料・広告なし/);
});

test('サンプルの宿題が入ったままなら、保護者と子どもの両方に案内を出す', ()=>{
  /* 判定は課題の id 集合。名前で見ると、サンプルを書きかえて使う
     ふつうの流れで案内が消えてしまう */
  const using = grab(APP, 'usingSampleTasks');
  assert.match(using, /DEFAULT_CONFIG\.tasks/, '既定の課題と比べること');
  assert.match(using, /\.map\(t=>t\.id\)\.sort\(\)/, 'id の集合で比べること');

  const parent = grab(APP, 'sampleResetNoticeHTML');
  assert.match(parent, /if\(!usingSampleTasks\(\)\) return '';/);
  assert.match(parent, /getLocal\(K_SAMPLE_PARENT\) === 'done'/, '閉じたら二度と出さないこと');
  assert.match(parent, /id="sampleResetBtn"/);
  assert.match(parent, /入力したデータ（進捗・記録・本の記録）もすべて削除されます/,
    '消えるものを案内の中に書くこと');

  const child = grab(APP, 'sampleChildNoticeHTML');
  assert.match(child, /getLocal\(K_SAMPLE_CHILD\) === 'done'/);
  assert.match(child, /id="sampleChildOk"/);
  assert.doesNotMatch(child, /data-no-reading/,
    '子どもが読む案内なので、かな変換から外さないこと');
  assert.doesNotMatch(child, /sampleResetBtn|リセット（消去）/,
    '子ども画面に消す入口を置かないこと');

  assert.match(grab(APP, 'viewParent'), /\$\{sampleResetNoticeHTML\(\)\}/);
  assert.match(grab(APP, 'viewHome'), /\$\{sampleChildNoticeHTML\(\)\}/);
});

test('サンプルのリセットは課題と記録の両方を、墓標の世代番号ごと消す', ()=>{
  const reset = grab(APP, 'resetSampleTasks');
  assert.match(reset, /confirm\(/, '取り消せないので確認を通すこと');
  assert.match(reset, /config\.tasks = \[\];/);
  assert.match(reset, /config\.showDaily = false;/);
  assert.match(reset, /state = resetState\(Date\.now\(\)\);/,
    '空にするだけでは他端末から復活するので、世代番号を押すこと');
  assert.match(reset, /saveCfg\(\)[\s\S]*saveSt\(\)/);
});

test('案内を閉じたしるしは端末内だけに持ち、共有する config / state へ入れない', ()=>{
  assert.match(APP, /const K_SAMPLE_PARENT = TEST_MODE \? 'natsu\.preview\.sample\.parent\.v1' : 'natsu\.sample\.parent\.v1';/);
  assert.match(APP, /const K_SAMPLE_CHILD  = TEST_MODE \? 'natsu\.preview\.sample\.child\.v1'  : 'natsu\.sample\.child\.v1';/);
  assert.match(APP, /K_SAMPLE_PARENT, K_SAMPLE_CHILD(?:, [A-Z_]+)*\]\.forEach\(k=>localStorage\.removeItem\(k\)\)/,
    'おためしURLでは preview 用のしるしも消すこと');
  for(const key of ['K_SAMPLE_PARENT', 'K_SAMPLE_CHILD']){
    assert.doesNotMatch(APP, new RegExp('config\\.[A-Za-z]+\\s*=\\s*' + key),
      key + ' を config へ書かないこと');
    assert.doesNotMatch(APP, new RegExp('state\\.[A-Za-z]+\\s*=\\s*' + key),
      key + ' を state へ書かないこと');
  }
});

test('Cloudflare Web Analyticsの計測タグを公開HTMLへ一度だけ置く', ()=>{
  assert.equal((INDEX.match(/static\.cloudflareinsights\.com\/beacon\.min\.js/g) || []).length, 1);
  assert.match(INDEX, /data-cf-beacon='\{"token": "4844611a6258456f866196574e92a9e3"\}'/);
  assert.match(INDEX, /<script type="module" src="https:\/\/static\.cloudflareinsights\.com\/beacon\.min\.js"[^>]*><\/script>\s*<\/body>/);
  for(const html of [DOCS_INDEX, GUIDE, UPDATES]){
    assert.equal((html.match(/static\.cloudflareinsights\.com\/beacon\.min\.js/g) || []).length, 1);
  }
});

test('保護者ページの共有・ホーム画面追加の案内は、この端末だけで閉じられる', ()=>{
  assert.match(APP, /const K_SYNC_PROMPT_DONE = TEST_MODE \? 'natsu\.preview\.prompt\.sync\.v1' : 'natsu\.prompt\.sync\.v1';/);
  assert.match(APP, /const K_HOME_INSTALL_DONE = TEST_MODE \? 'natsu\.preview\.prompt\.install\.v1' : 'natsu\.prompt\.install\.v1';/);
  assert.match(grab(APP, 'syncPromptHTML'), /getLocal\(K_SYNC_PROMPT_DONE\) === 'done'/,
    '共有しない選択をした端末では接続案内を再表示しないこと');
  assert.match(grab(APP, 'syncSectionHTML'), /id="syncPromptDismiss"[\s\S]*接続せず使う/,
    '1台だけで使う人が接続案内を閉じられること');
  assert.match(grab(APP, 'homeInstallGuideHTML'), /getLocal\(K_HOME_INSTALL_DONE\) === 'done'/,
    '追加しない選択をした端末ではホーム画面案内を再表示しないこと');
  assert.match(grab(APP, 'homeInstallGuideHTML'), /id="homeInstallDismiss"[\s\S]*今は追加しない/,
    'ホーム画面へ今は追加しない選択を置くこと');
  const nav = grab(APP, 'bindAdultNav');
  assert.match(nav, /setLocal\(K_SYNC_PROMPT_DONE, 'done'\)/);
  assert.match(nav, /setLocal\(K_HOME_INSTALL_DONE, 'done'\)/);
  assert.match(APP, /K_SAMPLE_PARENT, K_SAMPLE_CHILD, K_SYNC_PROMPT_DONE, K_HOME_INSTALL_DONE\]\.forEach/,
    'おためしURLでは新しい端末内のしるしも初期化すること');
  for(const key of ['K_SYNC_PROMPT_DONE', 'K_HOME_INSTALL_DONE']){
    assert.doesNotMatch(APP, new RegExp('config\\.[A-Za-z]+\\s*=\\s*' + key),
      key + ' を config へ書かないこと');
    assert.doesNotMatch(APP, new RegExp('state\\.[A-Za-z]+\\s*=\\s*' + key),
      key + ' を state へ書かないこと');
  }
});

test('消すボタンは枠なしの自前ゴミ箱アイコンにそろえる', ()=>{
  assert.doesNotMatch(APP, /🗑/, '端末で見え方が変わる絵文字を残さないこと');
  assert.match(APP, /const APP_ICONS = \{/, '自前アイコンは codex とは別に持つこと');
  assert.match(APP, /trash:'<svg[^']*fill="currentColor"/,
    '線ではなく塗りのピクトグラムにし、色はボタン側に従わせること');
  assert.match(grab(APP, 'icon'), /APP_ICONS\[name\] \|\| \(window\.CodeXIcons/,
    '同じ名前なら自前を優先すること');
  const codex = fs.readFileSync(path.join(ROOT, 'assets', 'codex-icons.js'), 'utf8');
  assert.doesNotMatch(codex, /trash:/, '差しかえた図案の元データを残さないこと');

  for(const attr of ['data-dellog', 'data-delmsg', 'data-delbook']){
    assert.match(APP, new RegExp(attr + '=[\\s\\S]{0,240}\\$\\{icon\\(\'trash\'\\)\\}'),
      attr + ' のボタンをゴミ箱アイコンにすること');
  }
  assert.match(STYLE, /\.icon-btn\.del\{ background:transparent; color:var\(--suika\); border-color:transparent;/,
    '枠と面を消すこと');
  assert.match(STYLE, /\.icon-btn\{[\s\S]{0,120}width:44px; height:44px/,
    '枠を消しても44pxの当たり判定は残すこと');
  assert.match(STYLE, /\.icon-btn\.del:focus-visible\{ outline:/,
    '枠が無いぶん、キーボードの位置は必ず見せること');
});

/* recentLogsHTML は state.logs を直接参照するクロージャなので、
   fmtDate / fmtTime とともに切り出し、呼び出しのたびに state を差し替えられるようにする。
   esc() は grab() で切り出せない（内部の正規表現リテラルに '/" を含み、
   grab() の引用符トラッキングが誤作動して以降の関数まで巻き込む）ため、
   実装と同じ内容をここに書き写す */
function buildRecentLogsHTML(){
  return new Function(`
    function esc(s){
      return String(s == null ? '' : s)
        .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
        .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
    }
    ${grab(APP, 'pad2')}
    const WD = ['日','月','火','水','木','金','土'];
    ${grab(APP, 'fmtDate')}
    ${grab(APP, 'fmtTime')}
    let state;
    ${grab(APP, 'recentLogsHTML')}
    return function(s, t){ state = s; return recentLogsHTML(t); };
  `)();
}

test('メモ欄の直下は直近3件を常時表示し、4件目以降を折りたたみに入れる', ()=>{
  // buildRecentLogsHTML に手書きした esc() が本体とずれていないことを見張る
  assert.match(APP, /function esc\(s\)\{\s*return String\(s == null \? '' : s\)\s*\.replace\(\/&\/g,'&amp;'\)\.replace\(\/<\/g,'&lt;'\)\.replace\(\/>\/g,'&gt;'\)\s*\.replace\(\/"\/g,'&quot;'\)\.replace\(\/'\/g,'&#39;'\);\s*\}/,
    'esc() の実装が変わったら buildRecentLogsHTML の手書き版も合わせて直すこと');

  const recentLogsHTML = buildRecentLogsHTML();
  const base = Date.parse('2026-08-10T09:00:00');
  const logs = [0,1,2,3,4].map(i=> ({
    taskId:'t1', memo:'メモ' + i, at: new Date(base - i*60000).toISOString()
  }));
  const html = recentLogsHTML({ logs }, { id:'t1' });

  assert.match(html, /これまでの きろく/, '見出しを出すこと');
  const foldIdx = html.indexOf('<details');
  assert.ok(foldIdx > 0, '折りたたみを持つこと');
  for(const i of [0,1,2]){
    const idx = html.indexOf('メモ' + i);
    assert.ok(idx > -1 && idx < foldIdx, '直近3件（メモ' + i + '）は折りたたみの外に常時出ること');
  }
  for(const i of [3,4]){
    const idx = html.indexOf('メモ' + i);
    assert.ok(idx > foldIdx, '4件目以降（メモ' + i + '）は折りたたみの中に入ること');
  }
  assert.match(html, /もっと 見る/, '折りたたみを開くラベルを出すこと');
});

test('メモが空の記録は「これまでの きろく」の一覧に出ない', ()=>{
  const recentLogsHTML = buildRecentLogsHTML();
  const logs = [
    { taskId:'t1', memo:'', at:'2026-08-10T09:00:00.000Z' },
    { taskId:'t1', memo:'   ', at:'2026-08-10T09:01:00.000Z' },
    { taskId:'t1', memo:'かいたよ', at:'2026-08-10T09:02:00.000Z' }
  ];
  const html = recentLogsHTML({ logs }, { id:'t1' });

  assert.match(html, /かいたよ/, 'メモがある記録は出すこと');
  assert.equal((html.match(/class="today-item"/g) || []).length, 1,
    '進捗だけの空メモの記録は一覧に含めないこと');
});

test('該当する記録が1件も無ければ「これまでの きろく」のブロックごと出さない', ()=>{
  const recentLogsHTML = buildRecentLogsHTML();
  assert.equal(recentLogsHTML({ logs: [] }, { id:'t1' }), '',
    '記録が1件も無いときは空文字を返すこと');
  assert.equal(recentLogsHTML({ logs: undefined }, { id:'t1' }), '',
    'state.logs が未定義でも空として扱うこと');
  assert.equal(recentLogsHTML({ logs: 'not-array' }, { id:'t1' }), '',
    'state.logs が配列でなくても空として扱うこと');
  const otherTask = recentLogsHTML(
    { logs: [{ taskId:'other', memo:'よそのきろく', at:'2026-08-10T09:00:00.000Z' }] },
    { id:'t1' });
  assert.equal(otherTask, '', 'ほかの課題の記録しか無いときも出さないこと');
});

test('折りたたみの中は最大50件で打ち切り、はみ出た分は案内文に置きかえる', ()=>{
  const recentLogsHTML = buildRecentLogsHTML();
  const base = Date.parse('2026-08-10T09:00:00');
  const logs = Array.from({length:60}, (_,i)=> ({
    taskId:'t1', memo:'メモ' + i, at: new Date(base - i*60000).toISOString()
  }));
  const html = recentLogsHTML({ logs }, { id:'t1' });

  assert.equal((html.match(/class="today-item"/g) || []).length, 50,
    '常時表示3件＋折りたたみ47件の合計50件までしかレイアウトしないこと');
  assert.match(html, /メモ49/, '50件目（先頭から数えて）までは出すこと');
  assert.doesNotMatch(html, /メモ50/, '51件目以降は出さないこと');
  assert.match(html, /ふるい きろくは『やったこと』で 見てね/,
    '打ち切った分は「やったこと」への案内文で置きかえること');
});

test('不正な日付の記録は日時を出さずメモ本文だけを出す', ()=>{
  const recentLogsHTML = buildRecentLogsHTML();
  const logs = [{ taskId:'t1', memo:'こわれた日づけ', at:'not-a-date' }];
  const html = recentLogsHTML({ logs }, { id:'t1' });

  assert.match(html, /こわれた日づけ/, 'メモ本文そのものは隠さないこと');
  assert.doesNotMatch(html, /class="ti-time"/, '不正な日時は時刻を出さないこと');
  assert.doesNotMatch(html, /class="ti-date"/, '不正な日時は日付も出さないこと');
});

test('自由記録シートも通常シートと同じ「これまでの きろく」部品を使う', ()=>{
  assert.doesNotMatch(APP, /freeTodayHTML/,
    '自由記録専用だった今日だけの一覧は残さないこと');
  assert.match(grab(APP, 'openFreeSheet'), /\$\{recentLogsHTML\(t\)\}/,
    '自由記録シートも recentLogsHTML を使うこと');
  assert.match(grab(APP, 'openSheet'), /body \+= recentLogsHTML\(t\);/,
    '通常シートはメモ欄の直後で recentLogsHTML を差し込むこと');
});

test('こわれた記録が混じっても、これまでのきろくは順番を保って出る', ()=>{
  const recentLogsHTML = buildRecentLogsHTML();
  const logs = [
    null,
    { taskId:'t1', memo:'ふるい', at:'2026-08-10T01:00:00.000Z' },
    { taskId:'t1', memo:'こわれた', at:'not-a-date' },
    { taskId:'t1', memo:'あたらしい', at:'2026-08-15T01:00:00.000Z' }
  ];
  const html = recentLogsHTML({ logs }, { id:'t1' });

  assert.match(html, /あたらしい/);
  assert.ok(html.indexOf('あたらしい') < html.indexOf('ふるい'),
    '日付がこわれた記録が混じっても、新しい順のならびを崩さないこと');
  assert.match(grab(APP, 'recentLogsHTML'), /\.filter\(l => l && l\.taskId === t\.id/,
    '中身のない記録で止まらないこと');
  assert.match(grab(APP, 'recentLogsHTML'), /localeCompare/,
    '日付にできない値でもならべかえが壊れないよう文字として比べること');
});

test('もっと見るは押せると分かる大きさとしるしを持つ', ()=>{
  assert.match(STYLE, /\.recent-more > summary\{[^}]*min-height:44px/,
    'ほかの押すところと同じ44pxを確保すること');
  assert.doesNotMatch(STYLE, /\.recent-more > summary::-webkit-details-marker\{ display:none; \}/,
    'iPadで開閉のしるしを消さないこと');
  assert.doesNotMatch(STYLE, /\.recent-more > summary\{[^}]*display:flex/,
    'summaryのdisplayを変えると開閉のしるしごと消えるので変えないこと');
});

/* まいにち型は「きょうは どのくらい できた？」に 0〜5 のボタンを出す。
   0 は「押しまちがいの取り消し」専用で、きょう まだ 何も 記録が無いときに
   出すと、取り消す 対象が 無いのに 選べてしまい まぎらわしい。
   openSheet 内の min 計算だけを 実際に 動かして確かめる（p.done 以外に
   依存しない、切り出しやすい 1行なので、そのまま拾って実行する）。 */
function dailyTallyMin(done){
  const open = grab(APP, 'openSheet');
  const m = open.match(/const min = p\.done > 0 \? 0 : 1;/);
  assert.ok(m, 'まいにち型の 開始番号を 決める行が 見つかりません');
  return new Function('p', m[0] + ' return min;')({ done });
}

test('まいにち型のタリーは、きょう記録が無いときだけ0を隠す', ()=>{
  assert.equal(dailyTallyMin(0), 1, 'きょうの記録が0のときは1から始まり、0が選べないこと');
  assert.equal(dailyTallyMin(1), 0, 'きょうの記録が1以上のときは0から始まり、0が選べること');
  assert.equal(dailyTallyMin(5), 0, 'きょうの記録が多いときも0が選べること');
  const open = grab(APP, 'openSheet');
  assert.match(open, /Array\.from\(\{length:max-min\+1\},\(_,idx\)=> min\+idx\)/,
    'ボタンの並びはminから作ること');
});

/* 選んだ数が きょうの きろくより 減っているときだけ、記録ボタンの文字を
   「なおす」に する。0〜5のボタンだけでなく、6以上を入れる#dailyMoreの
   入力でも 同じ判定に なることを、実際に syncDailySaveLabel を動かして確かめる。
   判定には 既存の dailyCountSelection が返す実際の選択値を使う想定なので、
   その関数もそのまま持ちこむ。 */
function dailySaveLabelHarness(){
  return new Function(`
    let sheetTask = null, sheetSel = null, sheetDailyToday = 0;
    const els = {};
    function $(sel){ return els[sel] || null; }
    ${grab(APP, 'clamp')}
    ${grab(APP, 'dailyCountSelection')}
    ${grab(APP, 'syncDailySaveLabel')}
    return {
      run(today, sel, moreValue){
        sheetTask = { id:'daily-1', type:'daily' };
        sheetDailyToday = today;
        sheetSel = sel;
        els['#sheetSave'] = { textContent:'きろくする' };
        els['#dailyMore'] = { value: moreValue == null ? '' : moreValue };
        syncDailySaveLabel();
        return els['#sheetSave'].textContent;
      }
    };
  `)();
}

test('選んだ数がきょうの記録より少ないとき、記録ボタンが「なおす」になる', ()=>{
  const h = dailySaveLabelHarness();
  assert.equal(h.run(3, 2, ''), 'なおす', 'タリーで選んだ数が記録より少ないとき「なおす」になること');
  assert.equal(h.run(3, 3, ''), 'きろくする', '同じ数なら「きろくする」のままであること');
  assert.equal(h.run(3, 5, ''), 'きろくする', '多い数なら「きろくする」のままであること');
  assert.equal(h.run(8, 8, '6'), 'なおす',
    '6以上の欄に きょうの記録より少ない数を入れたときも、その場で「なおす」になること');
  assert.equal(h.run(8, 8, '10'), 'きろくする',
    '6以上の欄に きょうの記録より多い数を入れたときは「きろくする」のままであること');
});

/* saveSheet は 0 に もどした ときの あんない（0 に もどしました）を
   すでに持つ。数を減らしたが 0 までは戻さないときも、はんこ（できた！）は
   出さず、別の言い方で知らせる。0にもどす扱いを崩さないよう、
   0の判定を 先に、減らした判定を あとに 置くことを ソースで確かめる。 */
test('数を減らしたときは、はんこを出さずに「なおしました」で知らせる', ()=>{
  const save = grab(APP, 'saveSheet');
  assert.match(save, /let dailyDecreased = false;/);
  assert.match(save, /dailyDecreased = n > 0 && n < p\.done;/,
    '0までもどす場合は 別のあんない（0にもどしました）に ゆずること');
  assert.match(save,
    /\(after\.done \| 0\) === 0 && hadValue\) toast\('0 に もどしました'\);\s*\n\s*else if\(dailyDecreased\) toast\('なおしました'\);\s*\n\s*else stamp\(/,
    '0にもどした案内を優先しつつ、減らしたときははんこの代わりにtoastを出すこと');
});

/* クリックとタイプの どちらでも 表示が その場で 切りかわることを、
   実装の呼び出しで確かめる（コメント欄には 触れていないことも あわせて確認）。 */
test('タリーのクリックと6以上の欄への入力の両方でボタン表示を更新する', ()=>{
  assert.match(APP, /sheetSel = \+ta\.dataset\.n;[\s\S]{0,220}syncDailySaveLabel\(\);/,
    'タリーを押した直後に表示を更新すること');
  assert.match(APP, /e\.target && e\.target\.id === 'dailyMore'\) syncDailySaveLabel\(\);/,
    '6以上の欄への入力でも表示を更新すること');
  assert.doesNotMatch(grab(APP, 'syncDailySaveLabel'), /memo|#memo/,
    'コメント欄（メモ欄）には手を触れないこと');
  assert.match(grab(APP, 'closeSheet'), /sheetDailyToday = 0;[\s\S]{0,80}textContent = 'きろくする';/,
    'シートを閉じるときはボタンの文字を「きろくする」へ戻すこと');
});

test('画面のはしをなぞって戻るときも、書きかけを守る', ()=>{
  const show = grab(APP, 'showSheet');
  assert.match(show, /history\.pushState\(\{ natsuSheet:true \}/,
    'シートを開くときに履歴を1つ足しておくこと');
  assert.match(show, /sheetInputBase = sheetInputSnapshot\(\);/,
    '開いたときの入力を控えること');
  assert.match(APP, /window\.addEventListener\('popstate'[\s\S]{0,420}confirmLeaveSheet\(\)/,
    '戻る操作を受けとめて確認すること');
  assert.match(APP, /window\.addEventListener\('popstate'[\s\S]{0,420}history\.pushState\(\{ natsuSheet:true \}/,
    'とどまるときは履歴を足し直すこと');
  assert.match(grab(APP, 'closeSheet'), /if\(sheetNavPushed\)\{ sheetNavPushed = false; history\.back\(\); \}/,
    '閉じたら足した履歴をかたづけること');
});

test('メモや本のなまえの書きかけも、とじる前に知らせる', ()=>{
  const leave = grab(APP, 'confirmLeaveSheet');
  assert.match(leave, /if\(sheetInputsChanged\(\)\) return confirm\('かきかけが あるよ。のこさずに とじても いい？'\)/,
    '答え以外の書きかけもまとめて聞くこと');
  const changed = new Function('sheetInputBase', 'sheetInputSnapshot',
    `${grab(APP, 'sheetInputsChanged')} return sheetInputsChanged;`);

  assert.equal(changed(null, ()=> ['あ'])(), false,
    '控えが無いうちは書きかけとしないこと');
  assert.equal(changed(['ほん', ''], ()=> ['ほん', ''])(), false,
    '開いたときのままなら書きかけとしないこと');
  assert.equal(changed(['ほん', ''], ()=> ['ほん', 'かんそう'])(), true,
    '足した文字は書きかけとすること');
  assert.equal(changed(['ほん'], ()=> ['べつの本'])(), true,
    'もとから入っていた文字を直したのも書きかけとすること');
  assert.match(grab(APP, 'sheetInputSnapshot'), /input\[type="text"\][\s\S]{0,60}input\[type="number"\]/,
    'テキストと数の欄も控えの対象にすること');
});

test('きょうの記録が無いまいにちの課題は、数をえらばせてから記録する', ()=>{
  assert.match(grab(APP, 'saveSheet'),
    /if\(t\.type === 'daily' && !dailySelection && !sheetDailyToday\)\{\s*\n\s*toast\('どのくらい できたか えらんでね'\);/,
    '0のボタンを出していないので、えらばずに「やらなかった」を残さないこと');
});
