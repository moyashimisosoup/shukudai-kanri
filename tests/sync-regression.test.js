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
const PHOTOS = fs.readFileSync(path.join(ROOT, 'assets', 'photos.js'), 'utf8');
const DOCS_INDEX = fs.readFileSync(path.join(ROOT, 'start', 'index.html'), 'utf8');
const GUIDE = fs.readFileSync(path.join(ROOT, 'start', 'getting-started.html'), 'utf8');
const UPDATES = fs.readFileSync(path.join(ROOT, 'start', 'updates.html'), 'utf8');
const PRODUCT_POLICY = fs.readFileSync(path.join(ROOT, 'docs', 'PRODUCT_POLICY.md'), 'utf8');
const DOCS_STYLE = fs.readFileSync(path.join(ROOT, 'start', 'site.css'), 'utf8');
const PACKAGE = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const PACKAGE_LOCK = JSON.parse(fs.readFileSync(path.join(ROOT, 'package-lock.json'), 'utf8'));
const MANIFEST = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.webmanifest'), 'utf8'));

/* 2026-08-22 第2監査の回帰。起動時だけ role を優先して表示を変える場合も、
   実画面と URL の route は必ず一致させる。同じ hash の再代入は
   hashchange を起こさないため、共通遷移関数が実 tab まで直す。 */
test('PWA起動時は表示routeとURL hashを履歴追加なしでそろえる', ()=>{
  const location = { pathname:'/app/', search:'?join=masked', hash:'#config' };
  const calls = [];
  const history = { replaceState(...args){ calls.push(args); location.hash = '#settings'; } };
  const normalize = new Function('location', 'history', 'TABS', `
    ${grab(APP, 'validRouteTarget')}
    ${grab(APP, 'routeHash')}
    ${grab(APP, 'normalizeLaunchHash')}
    return normalizeLaunchHash;
  `)(location, history, ['welcome','home','log','calendar','books','writes','settings','tasks','config','stats']);

  normalize('settings');
  assert.equal(calls.length, 1);
  assert.equal(calls[0][2], '/app/?join=masked#settings', 'queryを落とさずreplaceすること');
  normalize('settings');
  assert.equal(calls.length, 1, '既に一致するrouteは書き直さないこと');
  assert.doesNotMatch(grab(APP, 'normalizeLaunchHash'), /pushState/,
    '起動だけで戻る履歴を1件増やさないこと');
  assert.match(APP, /tab = launchRoute\(\);\s*\n\s*normalizeLaunchHash\(tab\);\s*\n/,
    '最初のrenderより前に表示routeとURLをそろえること');
});

test('共通navigateToはhashが同じでも実tabを更新して描画する', ()=>{
  function harness(hash, shown){
    const location = { hash };
    let tab = shown, renders = 0, jump = null;
    const routeFromHash = ()=> String(location.hash || '').replace(/^#/, '').split(':')[0] || 'home';
    const fn = new Function('location', 'TABS', 'routeFromHash', 'jumpTo', 'render', 'getTab', 'setTab', `
      let tab = getTab();
      ${grab(APP, 'validRouteTarget')}
      ${grab(APP, 'routeHash')}
      ${grab(APP, 'navigateTo')}
      return (target, opts)=>{ navigateTo(target, opts); setTab(tab); };
    `)(location, ['welcome','home','log','calendar','books','writes','settings','tasks','config','stats'],
       routeFromHash, (sel, focus)=>{ jump = { sel, focus }; }, ()=>{ renders++; },
       ()=>tab, value=>{ tab = value; });
    return { go:fn, location, tab:()=>tab, renders:()=>renders, jump:()=>jump };
  }

  const config = harness('#config', 'settings');
  config.go('config', { jump:'#allowLogDelete', focus:true });
  assert.equal(config.tab(), 'config');
  assert.equal(config.renders(), 1);
  assert.deepEqual(config.jump(), { sel:'#allowLogDelete', focus:true });

  const child = harness('#settings', 'home');
  child.go('settings');
  assert.equal(child.tab(), 'settings', '5回タップ／長押しでも保護者画面へ移れること');
  assert.equal(child.renders(), 1);

  for(const target of ['home','log','calendar']){
    const h = harness('#' + target, target === 'home' ? 'settings' : 'home');
    h.go(target);
    assert.equal(h.tab(), target);
    assert.equal(h.renders(), 1);
  }

  const normal = harness('#home', 'home');
  normal.go('calendar');
  assert.equal(normal.location.hash, 'calendar');
  assert.equal(normal.renders(), 0, '異なるhashは通常のhashchangeに描画を任せること');
  assert.equal(normal.go('home:garbage'), undefined);
  assert.equal(normal.location.hash, 'calendar', 'writes以外のcolon付き未知routeを作らないこと');

  const writes = harness('#writes:first', 'writes');
  writes.go('writes:second');
  assert.equal(writes.location.hash, 'writes:second', '課題ID付きwritesだけは有効routeとして保つ');
});

test('通常再読込・PWA再起動・stats・未知hash・writesを正規化する', ()=>{
  function route(hash, { standalone=false, role='', stats=false }={}){
    const location = { hash };
    let writesTaskId = '';
    const api = new Function('location', 'TABS', 'isStatsURL', 'getLocal', 'K_CFG', 'K_ONBOARD',
      'TEST_MODE', 'getWrites', 'setWrites', 'isStandalone', 'K_ROLE', `
      let writesTaskId = getWrites();
      ${grab(APP, 'routeFromHash')}
      ${grab(APP, 'launchRoute')}
      return ()=>{ const shown = launchRoute(); setWrites(writesTaskId); return shown; };
    `)(location, ['welcome','home','log','calendar','books','writes','settings','tasks','config','stats'],
      ()=>stats, key=> key === 'role' ? role : 'set', 'cfg', 'onboard', false,
      ()=>writesTaskId, value=>{ writesTaskId = value; }, ()=>standalone, 'role');
    return { shown:api(), writes:()=>writesTaskId };
  }
  assert.equal(route('#calendar').shown, 'calendar', '通常ブラウザの再読込は明示routeを保つ');
  assert.equal(route('#config', { standalone:true, role:'parent' }).shown, 'settings',
    '親PWA再起動は親開始画面へ戻す');
  assert.equal(route('#log', { standalone:true, role:'child' }).shown, 'home',
    '子PWA再起動は子開始画面へ戻す');
  assert.equal(route('#anything').shown, 'home', '未知hashを子画面routeへ正規化できる値にする');
  const writes = route('#writes:task-id');
  assert.equal(writes.shown, 'writes');
  assert.equal(writes.writes(), 'task-id', '戻る・再読込で課題IDを復元する');
  assert.equal(route('#config', { standalone:true, role:'parent', stats:true }).shown, 'stats',
    'stats queryはPWAのrole開始画面で上書きしない');
});

test('起動時に壊れた主要導線は共通navigateToへ集約する', ()=>{
  assert.match(grab(APP, 'bindAdultNav'), /navigateTo\(target\)/);
  assert.match(grab(APP, 'bindParentShareBadge'), /navigateTo\('config',\s*\{\s*jump:'#syncSection'/);
  assert.match(grab(APP, 'bindTopbandParentGesture'), /navigateTo\('settings'\)/);
  assert.match(APP, /closest\('#logCareJump'\)[\s\S]{0,180}navigateTo\('config',\s*\{\s*jump:'#allowLogDelete',\s*focus:true/);
  assert.match(APP, /openChildPage[\s\S]{0,420}navigateTo\('home'\)/);
  assert.match(APP, /const tabBtn[\s\S]{0,220}navigateTo\(t\)/);
  assert.match(APP, /closest\('a\[href\^="#"\]'\)[\s\S]{0,420}validRouteTarget\(target\)[\s\S]{0,120}navigateTo\(target\)/,
    '通常の「設定ページを開く」routeリンクも共通入口へ通すこと');
});

test('1件削除設定は端末内だけに保存し旧共有値を安全OFFへ移す', ()=>{
  const normalize = grab(APP, 'normalizeConfig');
  assert.match(APP, /const K_ALLOW_LOG_DELETE = TEST_MODE \?/);
  assert.match(normalize, /delete c\.allowLogDelete/,
    '旧共有trueを別端末のONへ移行しないこと');
  assert.doesNotMatch(grab(APP, 'sharedConfig'), /allowLogDelete/,
    '送信前allowlistにも端末内設定を入れないこと');
  assert.match(grab(APP, 'canDeleteLog'), /logDeleteAllowed\(\)[\s\S]*K_ROLE[\s\S]*parent/,
    '子ども端末は常に削除不可にすること');
  const bind = grab(APP, 'bindConfig');
  const at = bind.indexOf("const ald = $('#allowLogDelete')");
  const block = bind.slice(at, at + 420);
  assert.match(block, /setLogDeleteAllowed\(ald\.checked\)/);
  assert.doesNotMatch(block, /saveCfg|saveSt|markSaved|syncPush/,
    '変更時にconfig同期・state同期・保持期限活動を起こさないこと');
  function device(role){
    const store = { role };
    return new Function('getLocal', 'setLocal', 'localStorage', 'K_ALLOW_LOG_DELETE', 'K_ROLE', `
      ${grab(APP, 'logDeleteAllowed')}
      ${grab(APP, 'setLogDeleteAllowed')}
      ${grab(APP, 'canDeleteLog')}
      return { logDeleteAllowed, setLogDeleteAllowed, canDeleteLog };
    `)(key=>store[key] || '', (key,value)=>{ store[key] = value; },
      { removeItem:key=>{ delete store[key]; } }, 'allow', 'role');
  }
  const parentA = device('parent'), parentB = device('parent'), child = device('child');
  parentA.setLogDeleteAllowed(true);
  child.setLogDeleteAllowed(true);
  assert.equal(parentA.logDeleteAllowed(), true);
  assert.equal(parentB.logDeleteAllowed(), false, '親端末AのONを親端末Bへ伝播しない');
  assert.equal(child.canDeleteLog(), false, '子端末は端末内設定があっても常に削除不可');
});

test('任意質問の端末内控えは削除世代とデータ置換を越えない', ()=>{
  const read = grab(APP, 'localAnswerMap');
  const save = grab(APP, 'saveQuestionAnswerRow');
  assert.match(read, /resetAt/,
    '控えは現在の共有stateと同じ削除世代だけを使うこと');
  assert.match(save, /resetAt/,
    '再保存した回答には現在の削除世代を付けること');
  assert.match(APP, /function clearQuestionAnswerCache\(/);
  assert.match(grab(APP, 'resetSharedState'), /clearQuestionAnswerCache\(\)/,
    '一括削除は回答控えも同時に消すこと');
  assert.match(grab(APP, 'applyRemote'), /merged\.resetAt[\s\S]{0,180}clearQuestionAnswerCache\(\)/,
    '共有端末から新しい削除世代を受けたときも消すこと');
  assert.match(grab(APP, 'importBackup'), /clearQuestionAnswerCache\(\)/,
    'バックアップ置換前に古い控えを消すこと');
  assert.match(APP, /onHouseholdRetired\(\)[\s\S]{0,900}K_QUESTION_ANSWERS/,
    '墓標処理で端末控えを残さないこと');
  assert.match(grab(APP, 'forgetConfigStampForNewHousehold'), /clearQuestionAnswerCache\(\)/,
    '別の共有へ端末控えを持ち込まないこと');
  const store = { answers:JSON.stringify({ resetAt:1, rows:{ task:{ answers:['旧回答'], at:10 } } }) };
  const st = { resetAt:2, questionAnswers:{} };
  const api = new Function('state', 'getLocal', 'setLocal', 'localStorage', 'K_QUESTION_ANSWERS', 'ms', `
    let answerMapCache = null;
    ${grab(APP, 'localAnswerMap')}
    ${grab(APP, 'clearQuestionAnswerCache')}
    ${grab(APP, 'saveQuestionAnswerRow')}
    return { localAnswerMap, clearQuestionAnswerCache, saveQuestionAnswerRow };
  `)(st, key=>store[key] || '', (key,value)=>{ store[key] = value; },
    { removeItem:key=>{ delete store[key]; } }, 'answers', value=>Number(value) || 0);
  assert.deepEqual(api.localAnswerMap(), {}, '削除前世代の端末控えを再表示しない');
  api.saveQuestionAnswerRow({ id:'task' }, ['新回答']);
  const saved = JSON.parse(store.answers);
  assert.equal(saved.resetAt, 2, '再保存した回答を新しい削除世代へ置く');
  assert.deepEqual(saved.rows.task.answers, ['新回答']);
  api.clearQuestionAnswerCache();
  assert.equal(store.answers, undefined, 'データ置換・共有終了と同じ消去関数で控えを除く');
});

test('funと閲覧履歴は端末内保存だけで共有暗号文を更新しない', ()=>{
  assert.match(grab(APP, 'funPick'), /saveLocalState\(\)/);
  assert.doesNotMatch(grab(APP, 'funPick'), /saveSt\(|syncPush|markSaved/);
  assert.match(grab(APP, 'pushRead'), /saveLocalState\(\)/);
  assert.doesNotMatch(grab(APP, 'pushRead'), /saveSt\(|syncPush|markSaved/);
  const allowed = grabConst(APP, 'SHARED_STATE_KEYS');
  assert.doesNotMatch(allowed, /['"]fun['"]/);
  assert.doesNotMatch(allowed, /['"]reads['"]/);
  assert.match(grab(APP, 'saveLocalState'), /localStorage\.setItem\(K_ST/);
  assert.doesNotMatch(grab(APP, 'saveLocalState'), /childActivityAt|markSaved|syncPush/,
    '日付変更後に開くだけではchildActivityAtも保持期限も動かさないこと');
  assert.match(APP, /見るだけでは期間は延びません/,
    '利用者向け説明を端末内保存の実装と一致させること');
  const st = { reads:[], childActivityAt:123 };
  let localWrites = 0;
  const pushRead = new Function('state', 'FUN', 'logBy', 'saveLocalState', `
    const READS_MAX=400;
    ${grab(APP, 'pushRead')}
    return pushRead;
  `)(st, [{ t:'題', q:'問' }], ()=>'child', ()=>{ localWrites++; });
  pushRead(0);
  assert.equal(localWrites, 1);
  assert.equal(st.childActivityAt, 123, '閲覧だけではchildActivityAtを変えない');

  let funWrites = 0;
  const today = { seen:[], history:[] };
  const funPick = new Function('FUN', 'funToday', 'funAllowed', 'saveLocalState', `
    let funIdx=-1, funOpen=true, funPos=-1;
    ${grab(APP, 'funPick')}
    return funPick;
  `)([{ t:'題', q:'問' }], ()=>today, ()=>true, ()=>{ funWrites++; });
  funPick();
  assert.equal(funWrites, 1, '日付変更後の初回抽選も端末内保存だけにする');
});

test('共有送信はconfig/stateともpositive allowlistを通す', ()=>{
  const current = APP.match(/current:\s*\(\)\s*=>\s*\(\{[\s\S]{0,160}\}\)/);
  assert.ok(current, 'NatsuApp.currentの共有境界が見つからない');
  assert.match(current[0], /sharedConfig\(config\)/);
  assert.match(current[0], /sharedState\(state\)/);
  assert.match(grab(APP, 'sharedConfig'), /SHARED_CONFIG_KEYS/);
  assert.match(grab(APP, 'sharedState'), /SHARED_STATE_KEYS/);
  const localConfig = { schema:6, title:'家族', tasks:[], allowLogDelete:true, unknown:'local' };
  const localState = state({ fun:{ seen:[1] }, reads:[{ id:'local' }], unknown:'local' });
  const beforeConfig = JSON.parse(JSON.stringify(localConfig));
  const beforeState = JSON.parse(JSON.stringify(localState));
  assert.deepEqual(appFns.sharedConfig(localConfig), { schema:6, title:'家族', tasks:[] });
  assert.equal('fun' in appFns.sharedState(localState), false);
  assert.equal('reads' in appFns.sharedState(localState), false);
  assert.equal('unknown' in appFns.sharedState(localState), false);
  assert.deepEqual(localConfig, beforeConfig, 'allowlist作成で端末内configを壊さない');
  assert.deepEqual(localState, beforeState, 'allowlist作成で端末内stateを壊さない');
});

test('保護者ページ内目次と戻り口は未知hashを作らないbuttonにする', ()=>{
  const toc = grab(APP, 'buildAdultSectionToc');
  assert.doesNotMatch(toc, /<a href="#\$\{esc\(heading\.id\)\}"/,
    '中クリックや新しいタブで未知hashを開けるリンクを生成しないこと');
  assert.match(toc, /<button type="button" data-adult-section-target=/);
  assert.match(toc, /document\.createElement\('button'\)/,
    '▲もJS操作専用buttonにすること');
  assert.doesNotMatch(toc, /back\.href\s*=/);
  assert.match(toc, /target\.scrollIntoView\(\{ block:'start' \}\)/);
  assert.match(toc, /target\.focus\(\{ preventScroll:true \}\)/,
    '通常クリック時のスクロールと読み上げ位置を維持すること');
  assert.match(STYLE, /\.adult-section-toc-links button\{[\s\S]{0,140}min-height:44px/);
});

test('目次detailsは生成後に固定キーで開状態を復元する', ()=>{
  const render = grab(APP, 'render');
  assert.ok(render.indexOf('buildAdultSectionToc()') < render.indexOf('restoreOpenDetails(openDetails)'),
    '目次DOMを作ってから開状態を戻すこと');
  assert.match(grab(APP, 'buildAdultSectionToc'), /data-details-key="adultSectionToc:\$\{esc\(tab\)\}"/);
});

test('件数が変わるdetailsは固定キーで開状態を保つ', ()=>{
  assert.match(grab(APP, 'syncSectionHTML'), /data-details-key="syncDevices"/,
    '共有端末数が変わっても同じdetailsとして扱うこと');
  assert.match(grab(APP, 'syncTraceHTML'), /data-details-key="syncTrace"/,
    '同期記録件数が変わっても同じdetailsとして扱うこと');
  let nodes = [
    { dataset:{ detailsKey:'syncDevices' }, id:'', open:true, querySelector:()=>({ textContent:'設定済み：1台' }) },
    { dataset:{ detailsKey:'syncTrace' }, id:'', open:true, querySelector:()=>({ textContent:'同期の記録（1件）' }) }
  ];
  const api = new Function('selectAll', `
    const $$ = selectAll;
    ${grab(APP, 'detailsKey')}
    ${grab(APP, 'captureOpenDetails')}
    ${grab(APP, 'restoreOpenDetails')}
    return { captureOpenDetails, restoreOpenDetails };
  `)(()=>nodes);
  const open = api.captureOpenDetails();
  nodes = [
    { dataset:{ detailsKey:'syncDevices' }, id:'', open:false, querySelector:()=>({ textContent:'設定済み：2台' }) },
    { dataset:{ detailsKey:'syncTrace' }, id:'', open:false, querySelector:()=>({ textContent:'同期の記録（2件）' }) }
  ];
  api.restoreOpenDetails(open);
  assert.deepEqual(nodes.map(node=>node.open), [true, true],
    'summaryの件数が変わった再描画後も同じdetailsを開く');
});

test('旧メッセージ移行後はconfigから本文と旧送信者情報を消す', ()=>{
  const migrate = grab(APP, 'migrateMessages');
  const clear = grab(APP, 'clearLegacyParentMessage');
  assert.match(clear, /text:\s*''/);
  assert.match(clear, /customSender:\s*''/);
  assert.match(clear, /parentMessageMoved\s*=\s*true/);
  assert.match(migrate, /clearLegacyParentMessage\(\)/,
    '移行成功・既存messagesのどちらでも旧configを掃除すること');
  assert.match(migrate, /state\.messages\.length/);
  assert.match(migrate, /if\(clearLegacyParentMessage\(\)\) saveCfg\(\)/,
    '既に共有stateへ移っている場合も掃除を保存すること');

  function run(parentMessage, parentMessageMoved, messages){
    const cfg = { parentMessage, parentMessageMoved };
    const st = { messages:[...messages] };
    let configSaves = 0, stateSaves = 0, exported = '';
    const api = new Function('cfg', 'st', 'saveCfg', 'saveSt', 'logBy', 'downloadBlob',
      'dayKey', 'toast', 'Blob', `
      let config = cfg, state = st;
      ${clear}
      ${migrate}
      ${grab(APP, 'exportData')}
      return { migrateMessages, exportData };
    `)(cfg, st, ()=>{ configSaves++; }, ()=>{ stateSaves++; }, ()=>'parent',
      blob=>{ exported = blob.parts.join(''); }, ()=>'day', ()=>{},
      class { constructor(parts){ this.parts = parts; } });
    api.migrateMessages();
    api.exportData();
    return { cfg, st, configSaves, stateSaves, api, exported:()=>exported };
  }
  const moved = run({ enabled:true, sender:'その他', customSender:'旧送信者', text:'旧本文' }, false, []);
  assert.equal(moved.st.messages.length, 1, '旧形式本文を共有stateへ一度だけ移す');
  assert.equal(moved.cfg.parentMessage.text, '');
  assert.equal(moved.cfg.parentMessage.customSender, '');
  assert.deepEqual([moved.stateSaves, moved.configSaves], [1, 1]);
  moved.st.messages = [];
  moved.api.exportData();
  assert.doesNotMatch(moved.exported(), /旧本文|旧送信者/,
    '共有stateから削除した後に旧configコピーがバックアップへ本文を復活させない');

  const residue = run({ enabled:false, sender:'その他', customSender:'残存送信者', text:'残存本文' }, false,
    [{ id:'new', text:'state本文' }]);
  assert.equal(residue.st.messages.length, 1, '既存stateメッセージを重複させない');
  assert.doesNotMatch(residue.exported(), /残存本文|残存送信者/,
    '無効化済みでも残った旧config本文を掃除する');
});

test('バックアップ課題IDは同名・並び替えを許し欠落・重複を拒否する', ()=>{
  const validate = new Function(`${grab(APP, 'validateImportedTaskIds')} return validateImportedTaskIds;`)();
  assert.doesNotThrow(()=> validate({ tasks:[
    { id:'second', name:'同じ名前' }, { id:'first', name:'同じ名前' }
  ]}), '名前や順番ではなくIDの非空・一意性だけを見ること');
  assert.throws(()=> validate({ tasks:[{ id:'same' }, { id:'same' }] }), /ID/);
  assert.throws(()=> validate({ tasks:[{ name:'欠落' }] }), /ID/);
  assert.throws(()=> validate({ tasks:[{ id:'   ' }] }), /ID/);
  assert.match(grab(APP, 'importBackup'), /validateImportedTaskIds\(o\.config\)/,
    '現在データを置き換える前に検査すること');
  assert.doesNotMatch(grab(APP, 'validateImportedTaskIds'), /Date\.now|random|index|map\(.*id/,
    '進捗対応を壊す自動再採番をしないこと');
  const originalConfig = { tasks:[{ id:'current' }] };
  const originalState = { progress:{ current:{} } };
  let confirms = 0, saves = 0, clears = 0;
  const importer = new Function('initialConfig', 'initialState', 'window', 'confirm', 'backupPreviewText',
    'clearQuestionAnswerCache', 'normalizeConfig', 'normalizeState', 'migrateMessages',
    'saveCfg', 'saveSt', 'render', 'toast', `
    let config = initialConfig, state = initialState;
    ${grab(APP, 'validateImportedTaskIds')}
    ${grab(APP, 'importBackup')}
    return { run:importBackup, current:()=>({ config, state }) };
  `)(originalConfig, originalState, {}, ()=>{ confirms++; return true; }, ()=>'preview',
    ()=>{ clears++; }, value=>value, value=>value, ()=>{},
    ()=>{ saves++; }, ()=>{ saves++; }, ()=>{}, ()=>{});
  assert.throws(()=>importer.run({ config:{ tasks:[{ id:'dup' }, { id:'dup' }] }, state:{} }), /ID/);
  assert.throws(()=>importer.run({ config:{ tasks:[{}] }, state:{} }), /ID/);
  assert.equal(confirms, 0, '不正IDは確認ダイアログ前に拒否する');
  assert.equal(saves, 0, '不正IDを端末・共有へ保存しない');
  assert.equal(clears, 0, '不正IDで既存の質問控えを消さない');
  assert.deepEqual(importer.current(), { config:originalConfig, state:originalState },
    '不正IDでは現在データを置き換えない');
});

test('合言葉の比較用コピーはfingerprintだけにして終了時に掃除する', async ()=>{
  assert.match(grab(SYNC, 'persistPending'), /config:[\s\S]*state:/);
  assert.doesNotMatch(grab(SYNC, 'persistPending'), /code\s*:/,
    '送信予約に活動中の合言葉を重複保存しないこと');
  assert.match(grab(SYNC, 'readPending'), /hasOwnProperty\.call\(saved, 'code'\)/,
    '旧送信予約に残った平文コピーは読込時に除去すること');
  assert.match(grab(SYNC, 'readPending'), /saved\.code !== currentCode[\s\S]{0,100}removeItem\(K_PENDING\)/,
    '旧予約が別の共有先宛てなら現接続へ持ち越さないこと');
  assert.match(grab(SYNC, 'deriveKey'), /codeFingerprint\(/,
    '暗号鍵キャッシュの比較に平文コピーを持たないこと');
  assert.doesNotMatch(SYNC, /cryptoKeyCode/);
  assert.match(grab(APP, 'forgetConfigStampForNewHousehold'), /codeFingerprint\(/,
    '共有世代の比較用キーはfingerprintで保存すること');
  assert.match(grab(APP, 'clearHouseholdLocalCopies'), /K_CFG_HOUSE/);
  assert.match(grab(APP, 'clearHouseholdLocalCopies'), /clearQuestionAnswerCache\(\)/);
  assert.match(grab(APP, 'bindSync'), /syncOff[\s\S]{0,700}clearHouseholdLocalCopies\(\)/,
    '通常の共有解除でも不要コピーを消すこと');
  assert.match(APP, /onHouseholdJoinFailed\(\)\{[\s\S]{0,180}clearHouseholdLocalCopies\(\)/,
    '参加失敗時の掃除経路をアプリ側にも持つこと');
  assert.match(grab(SYNC, 'failExistingJoin'), /setCode\(''\)[\s\S]*disconnect\(\)[\s\S]*onHouseholdJoinFailed/,
    '確定した参加失敗は接続・鍵・アプリ側コピーを共通経路で掃除すること');
  assert.equal((grab(SYNC, 'watchHousehold').match(/failExistingJoin\(/g) || []).length, 3,
    '文書なし・旧平文形式・復号失敗の参加経路をすべて掃除すること');
  assert.match(grab(SYNC, 'watchHousehold'), /onHouseholdRevoked/,
    '端末を外されたときもアプリ側の不要コピーを掃除すること');
  assert.match(grab(SYNC, 'rememberRevokedCode'), /`fp:\$\{await codeFingerprint\(code\)\}`/,
    '再参加防止には平文でなくfingerprintを保存すること');
  assert.match(grab(APP, 'joinInstallTransferHTML'), /getLocal\(K_CODE_CHOSEN\) === 'none'/,
    '解除・端末削除後は接続できない引き継ぎ案内を出さないこと');

  const revokedStore = {};
  const storage = {
    getItem:key=> revokedStore[key] || null,
    setItem:(key,value)=>{ revokedStore[key] = value; },
    removeItem:key=>{ delete revokedStore[key]; }
  };
  const revoked = new Function('localStorage', 'K_JOIN_REVOKED', 'codeFingerprint', `
    ${grab(SYNC, 'revokedFingerprint')}
    ${grab(SYNC, 'rememberRevokedCode')}
    ${grab(SYNC, 'isRevokedCode')}
    ${grab(SYNC, 'migrateRevokedFingerprint')}
    return { rememberRevokedCode, isRevokedCode, migrateRevokedFingerprint };
  `)(storage, 'revoked', async value=>'hash-' + String(value));
  await revoked.rememberRevokedCode('group-a');
  const remembered = revokedStore.revoked;
  assert.equal(await revoked.isRevokedCode('group-b'), false);
  assert.equal(revokedStore.revoked, remembered, '別の招待を見ても元の解除fingerprintを壊さない');
  assert.equal(await revoked.isRevokedCode('group-a'), true, '元の解除済み共有は引き続き拒否する');
  revokedStore.revoked = 'legacy-group';
  await revoked.migrateRevokedFingerprint();
  assert.equal(revokedStore.revoked, 'fp:hash-legacy-group', '旧平文解除印を起動時に移行する');

  let currentCode = '';
  revokedStore.pending = JSON.stringify({ code:'legacy-group', config:true, state:false });
  const readPending = new Function('localStorage', 'K_PENDING', 'getCode', `
    ${grab(SYNC, 'readPending')}
    return readPending;
  `)(storage, 'pending', ()=>currentCode);
  assert.deepEqual(readPending(), { config:false, state:false });
  assert.equal(revokedStore.pending, undefined, '活動中の合言葉が無ければ旧送信予約も削除する');

  const appStore = { chosen:'legacy-chosen', house:'legacy-house' };
  const migrateApp = new Function('getLocal', 'setLocal', 'K_CODE_CHOSEN', 'K_CFG_HOUSE',
    'codeFingerprint', `
    ${grab(APP, 'migrateAppSecretFingerprints')}
    return migrateAppSecretFingerprints;
  `)(key=>appStore[key] || '', (key,value)=>{ appStore[key] = value; }, 'chosen', 'house',
    async value=>'hash-' + String(value));
  await migrateApp();
  assert.equal(appStore.chosen, 'fp:hash-legacy-chosen');
  assert.equal(appStore.house, 'fp:hash-legacy-house', '通常起動だけでも旧平文比較印を移行する');
});

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
  assert.match(nav, /navigateTo\(target\)/,
    '起動時の #config が残り hashchange しない場合も表示を切り替えること');
});

test('保護者の3ページだけ、描画済みの節見出しからページ内目次を作る', ()=>{
  const head = grab(APP, 'adultHeadHTML');
  const toc = grab(APP, 'buildAdultSectionToc');
  const nav = grab(APP, 'adultSectionNavHTML');
  assert.match(head, /adultSectionNavHTML\(\)/,
    '見出しの紙の直後に、読み上げで用途が分かるナビを置くこと');
  assert.match(nav, /<nav class="adult-section-toc" id="adultPageToc" aria-label="このページの目次"/);
  assert.match(grab(APP, 'viewParent'), /adultSectionNavHTML\(\)/);
  assert.match(grab(APP, 'viewTasks'), /adultHeadHTML\('tasks',/);
  assert.match(grab(APP, 'viewConfig'), /adultHeadHTML\('config',/);
  assert.match(toc, /\$\$\('\.sec-head > h2', \$\('#view'\)\)/,
    '別に列挙せず、実際に描画された節見出しを拾うこと');
  assert.match(toc, /if\(headings\.length < 2\) return;/,
    '節が1つだけなら目次を出さないこと');
  assert.match(toc, /heading\.textContent/,
    '目次の項目名は見出し本文を使うこと');
  assert.match(toc, /section\.dataset\.adultSectionHelp/,
    '各項目の説明は実際に描画した節から取得すること');
  assert.match(toc, /button\.setAttribute\('aria-label', heading\.textContent \+ 'の説明を見る'\)/);
  assert.match(toc, /button\.setAttribute\('aria-haspopup', 'dialog'\)/);
  assert.match(toc, /button\.setAttribute\('aria-controls', 'adultSectionHelpDialog'\)/);
  assert.match(INDEX, /id="adultSectionHelpDialog"[\s\S]{0,180}aria-labelledby="adultSectionHelpTitle" aria-describedby="adultSectionHelpBody"/,
    '共通ダイアログは見出しと本文による名前を持つこと');
  const openHelp = grab(APP, 'openAdultSectionHelp');
  assert.match(openHelp, /title\.textContent = button\.dataset\.sectionTitle/);
  assert.match(openHelp, /body\.textContent = button\.dataset\.sectionHelp/);
  assert.match(openHelp, /dialog\.showModal\(\)/,
    '説明は別ウィンドウとして開くこと');
  assert.match(toc, /<small>全\$\{headings\.length\}項目<\/small>/,
    '閉じたままでも節の総数が分かること');
  assert.match(toc, /target\.scrollIntoView\(\{ block:'start' \}\)/,
    'キーボードで選んだリンクも節へ移動できること');
  assert.match(toc, /<details class="adult-section-toc-disclosure" data-details-key="adultSectionToc:/,
    '目次は既定で閉じ、必要なときだけ開くこと');
  assert.match(STYLE, /\.adult-section-toc-disclosure > summary\{[\s\S]{0,80}min-height:48px/,
    '閉じた目次は1行で収まり、行全体を操作面にすること');
  assert.match(STYLE, /\.adult-section-toc-links button\{[\s\S]{0,140}min-height:44px/,
    '開いた目次の各リンクは44pxの操作面を持つこと');
  assert.match(STYLE, /\.adult-section-toc-target\{ scroll-margin-top:var\(--space-md\); \}/,
    '飛び先の見出しを上帯の下に出すこと');
  assert.match(toc, /back\.setAttribute\('aria-label', 'このページの目次へ戻る'\)/,
    '各節には意味の分かる名前を持つ目次への戻り口を用意すること');
  assert.match(STYLE, /\.adult-section-tool\{[\s\S]{0,160}width:44px; height:44px/,
    '戻りの印は小さく見せても44pxの操作面を保つこと');
  assert.match(toc, /surface\.classList\.add\('adult-section-return-surface'\)/,
    '紙のpaddingに依存しない共通の戻り領域を使うこと');
  assert.match(STYLE, /\.paper\.adult-section-return-surface\{[\s\S]{0,120}padding-block-end:52px/,
    '入力内容と重ならない52pxの予約領域を持つこと');
  assert.match(STYLE, /\.adult-section-tools\{[\s\S]{0,220}inset-inline-end:calc\(4px - var\(--line\)\); inset-block-end:calc\(4px - var\(--line\)\)/,
    '紙の外枠から上下左右4pxを基準に戻り口を置くこと');
  assert.match(toc, /if\(!head \|\| head\.tagName === 'SUMMARY' \|\| !section\) return;/,
    '開閉見出しの中に別の操作を入れ子にしないこと');
  assert.match(toc, /classList\.contains\('paper'\)/,
    '目次への戻り口は見出し帯ではなく内容の紙に置くこと');
  assert.doesNotMatch(toc, /back\.hidden|actions\.hidden|hideSectionBacks/,
    '戻り口は常時表示し、移動のたびに紙の高さを変えないこと');
  assert.match(STYLE, /\.adult-section-tools\{[\s\S]{0,320}border:0; background:transparent/,
    '戻り口の行に背景や区切り線を付けず、紙の角丸を乱さないこと');
  assert.doesNotMatch(toc, /head\.classList\.add\('has-toc-back'\)/,
    '長い見出しの可読幅を戻り口で削らないこと');
  assert.match(toc, /const returnToToc = e=>\{[\s\S]{0,180}disclosure\.open = true;[\s\S]{0,100}summary\.focus\(\{ preventScroll:true \}\)/,
    '戻り口は目次を開き、開閉行へ読み上げ位置を戻すこと');
  assert.doesNotMatch(grab(APP, 'viewHome'), /adult-section-toc/,
    '子ども画面には目次を置かないこと');
  /* URL の # は画面の切りかえに使う。見出しの id をそこへ入れると
     routeFromHash() が知らない名前として 'home' に落とし、戻る・再読みこみ・
     ホーム画面から開き直したときに保護者が子ども画面へ飛ばされる。 */
  assert.doesNotMatch(toc, /history\.(replaceState|pushState)/,
    '目次の移動でURLの#を書きかえないこと');
  assert.doesNotMatch(toc, /location\.hash/,
    '目次の移動でURLの#を書きかえないこと');
  assert.match(toc, /target\.focus\(\{ preventScroll:true \}\)/,
    '#を使わずに移動するぶん、読み上げの位置は自分で見出しへ移すこと');
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
  assert.match(grab(APP, 'questionAnswerRow'), /localAnswerMap\(\)/,
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

/* 旧記録は「・質問\n　→ 答え」を並べたあと、ふつうのメモを \n でつないでいる。
   いちばん後ろの答えには「次の ・」が無いため、放っておくとメモ本文まで
   答えとして取り込み、それが専用欄へ移ると誤った答えとして固定される。 */
test('記録のいちばん後ろの答えが、あとに書いたメモを飲み込まない', ()=>{
  const legacy = new Function('state', `${grab(APP, 'legacyQuestionAnswers')} return legacyQuestionAnswers;`)({
    logs:[{ taskId:'kyuri', at:'2026-08-16T10:00:00.000Z',
            memo:'・色は？\n　→ あかかった\n・形は？\n　→ まるかった\nきょうは あつかった\nまた 見る' }]
  });
  assert.deepEqual(legacy({ id:'kyuri', questions:['色は？', '形は？'] }),
    ['あかかった', 'まるかった'],
    '後ろの答えはメモ本文を取り込まないこと');
});

test('途中の問の答えは、複数行のままのこす', ()=>{
  const legacy = new Function('state', `${grab(APP, 'legacyQuestionAnswers')} return legacyQuestionAnswers;`)({
    logs:[{ taskId:'kyuri', at:'2026-08-16T10:00:00.000Z',
            memo:'・色は？\n　→ あかかった\nすこし きいろも\n・形は？\n　→ まるかった' }]
  });
  assert.deepEqual(legacy({ id:'kyuri', questions:['色は？', '形は？'] }),
    ['あかかった\nすこし きいろも', 'まるかった'],
    '次の問が続く答えは、区切りが分かるので改行ごと残すこと');
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
    `let answerMapCache=null; ${grab(APP, 'localAnswerMap')} ${grab(APP, 'legacyQuestionAnswers')} ${grab(APP, 'questionAnswerRow')} return questionAnswerRow;`
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

/* grab は function 用。トップレベルの const 宣言（オブジェクト・配列・文字列）を
   そのまま切り出すのに使う。手で値を写すと 本物の設定（TASK_FIELD_KEYS など）と
   ずれた ままテストが 通ってしまうため、必ず ソースから 取ること */
function grabConst(src, name){
  const re = new RegExp('const\\s+' + name + '\\s*=\\s*');
  const m = re.exec(src);
  if(!m) throw new Error('定数が見つかりません: ' + name);
  const start = m.index;
  let i = m.index + m[0].length, depth = 0, quote = '', escape = false;
  for(; i<src.length; i++){
    const ch = src[i];
    if(quote){
      if(escape){ escape = false; continue; }
      if(ch === '\\'){ escape = true; continue; }
      if(ch === quote) quote = '';
      continue;
    }
    if(ch === "'" || ch === '"' || ch === '`'){ quote = ch; continue; }
    if(ch === '{' || ch === '[') depth++;
    if(ch === '}' || ch === ']') depth--;
    if(ch === ';' && depth === 0){ i++; break; }
  }
  return src.slice(start, i);
}

const APP_NAMES = [
  'emptyState', 'normalizeState', 'ms', 'deepCopy', 'mergeById',
  'pickStamped', 'mergeProgress', 'mergeState', 'resetState',
  'canon', 'sameState', 'pickShared', 'sharedConfig', 'sharedState', 'stripLocal', 'cacheBustURL', 'homeInstallPlatform', 'clamp', 'dailyCountSelection',
  'parentShareSummary', 'defaultTitleFor', 'isGeneratedTitle', 'logByLabel',
  'isBook', 'isSheetCount', 'countUsesCircle', 'bookCountUnit', 'bookOrdinal'
];
const appFns = new Function('location', `
  const SCHEMA=6, TRASH_MAX=50, GONE_MAX=300, MESSAGES_MAX=3, READS_MAX=400;
  ${grabConst(APP, 'SHARED_CONFIG_KEYS')}
  ${grabConst(APP, 'SHARED_STATE_KEYS')}
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
  assert.match(tasks, /note:'子ども画面の「まいにち」[\s\S]{0,120}学習アプリ・音読・お手伝い・日記やメモなどに使えます。/,
    '毎日の項目の用途は見出しの i から開く説明に置く');
  assert.match(tasks, /daily-switch daily-switch--standalone[\s\S]{0,180}<strong>子ども画面に表示する<\/strong>/);
  assert.doesNotMatch(tasks, /daily-switch daily-switch--standalone[\s\S]{0,240}<small>/,
    '毎日の操作行にはチェックボックスとラベル以外を置かない');
  assert.match(tasks, /title:'任意の宿題'[\s\S]{0,180}note:'子ども画面の「つぎに やる」に出ます。/,
    '任意の宿題は子ども画面のどこに出るかを案内する');
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
    state:'child', full:'はなと共有中', short:'：はな'
  });
  assert.equal(appFns.parentShareSummary([{id:'parent-1', role:'parent'}], 'parent-1', '').state, 'waiting');
});

/* 短い方の表示に使えるのは 320px で 90px ほど（実測）。
   「子ども端末の接続待ち」は 20px、「ほかの端末と共有中」は 9px はみ出していた。
   バッジの左には すでに「共有」の印が 出ているので、短い方は 印に続く
   「：〈短い語〉」で 足りる（共有なしのときの「：設定」と 同じ形）。
   名前が入る形だけは 長さを 約束できないので … に まかせる。 */
test('共有バッジの短い表示は、狭い画面の幅に収まる形にそろえる', ()=>{
  const short = rows => appFns.parentShareSummary(rows, 'me', '').short;
  assert.equal(short([{ id:'c1', role:'child', name:'はな' }]), '：はな',
    '子どもの名前が分かるときは名前だけ出すこと');
  assert.equal(short([{ id:'c1', role:'child', name:'' }]), '：子ども',
    '名前が無いときも短く言うこと');
  assert.equal(short([{ id:'p2', role:'parent' }]), '：ほかの端末');
  assert.equal(short([{ id:'me', role:'parent' }]), '：接続待ち');
  assert.match(APP, /<span class="parent-share-short">：設定<\/span>/,
    '共有なしのときも同じ形であること');
  /* 320pxで収まったのは「：」＋7文字まで（実測）。名前入りは利用者の文字数なので除く */
  ['：ほかの端末', '：接続待ち', '：子ども', '：設定'].forEach(s=>
    assert.ok(Array.from(s).length <= 8, '320pxで収まる長さにすること: ' + s));
});

/* 自由記述の「きょう かいたこと」の1行目。カードは grid の 1fr で、
   1fr の 最小幅は min-content。nowrap の 中身が そのまま トラックを
   押し広げるので、箱が カードの外へ 出て しまい、要素自身は あふれて
   いないため … が 出ない（320px で 箱が 475px に なっていた）。
   min-width:0 を 足して はじめて カードの中で 省略記号が 働く。 */
test('自由記述のメモ1行目は、カードからはみ出さず … で示す', ()=>{
  assert.match(STYLE, /\.free-body\{[^}]*min-width:0/,
    'grid の 1fr が min-content で広がらないようにすること');
  assert.match(STYLE, /\.free-said\{[\s\S]*?text-overflow:ellipsis/,
    '入りきらないメモは … で気づけるようにすること');
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
const CRYPTO_PARTS = "let cryptoKey=null, cryptoKeyFingerprint='';\nconst ENC_PREFIX='v1:'; const ENC_ITERATIONS=250000;\n"
  + ['normalizeCode','sha256Bytes','houseIdFor','codeFingerprint','deriveKey','bytesToBase64','base64ToBytes','encryptField','isCiphertext']
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
    function noteTrouble(){}
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
    function noteTrouble(){}
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
  assert.match(APP, /id="dataManagementSection"[\s\S]{0,420}class="paper data-management-paper"/,
    '記録の手入れはデータ管理の紙へ統合すること');
});

/* 長い手順を書くかわりに、その場から飛ばす。飛び先が長いページなので、
   着いた先までスクロールしないと意味がない。飛び先の id が消えたら気づけること。 */
test('注記からの案内は、設定ページの該当箇所まで寄せる', ()=>{
  const jumps = [
    { name:'記録の注記',   anchor:"closest('#logCareJump')", call:"navigateTo('config', { jump:'#allowLogDelete', focus:true })", target:'#allowLogDelete' },
    { name:'共有バッジ',   anchor:'badge.onclick',            call:"navigateTo('config', { jump:'#syncSection' })", target:'#syncSection' }
  ];
  for(const { name, anchor, call, target } of jumps){
    const at = APP.indexOf(anchor);
    assert.notEqual(at, -1, name + ' の処理が見つからない（' + anchor + '）');
    assert.ok(APP.slice(at, at + 400).includes(call),
      name + ' は ' + target + ' へ jumpTo すること');
    assert.match(APP, new RegExp('id="' + target.slice(1) + '"'),
      target + ' の id が実在すること');
  }

  /* #scroll だけが動く作りなので、scrollIntoView に戻さないこと */
  const jump = grab(APP, 'jumpToSection');
  assert.match(jump, /scrollBox\(\)/, '#scroll を動かすこと');
  assert.equal(/scrollIntoView/.test(jump), false, 'scrollIntoView を使わないこと');
  assert.match(APP, /const moveFocus = pendingJumpFocus[\s\S]{0,900}el\.focus\(\{ preventScroll:true \}\)/,
    '1件削除の案内では対象チェックボックスへフォーカスも移すこと');

  /* 飛び先は1回きり。次の描き直しで勝手に戻らないこと */
  assert.match(jump, /pendingJump = ''/, '飛んだら予約を消すこと');

  /* すでに有効なら、その案内は出さない */
  const note = grab(APP, 'parentTodayLogsHTML');
  assert.match(note, /logDeleteAllowed\(\) \? ''/, '有効なときは案内を出さないこと');
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
test('はずされた端末は、招待URLを開き直しても勝手に戻らない', async ()=>{
  const CODE = 'abcdefghjkmnpqrs';
  async function harness(revokedFrom, chosenMatches){
    let reconnected = '';
    const applyJoinCode = new Function(
      'location', 'history', 'cleanCode', 'isStandalone',
      'setLocal', 'K_ONBOARD', 'window', 'toast', 'render', 'routeFromHash',
      'forgetConfigStampForNewHousehold', 'getLocal', 'K_CODE_CHOSEN',
      'rememberChosenCode', 'chosenCodeMatches', 'localStorage', 'navigateTo', `
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
                    isRevokedCode:async code=>revokedFrom === code,
                    reconnect:c => { reconnected = c; } } },
      ()=>{}, ()=>{}, ()=>'home', ()=>{},
      k => (k === 'natsu.sync.chosen.v1' ? 'fp:saved' : ''),
      'natsu.sync.chosen.v1', async()=>{}, async()=>chosenMatches, { removeItem(){} }, ()=>{}
    );
    await applyJoinCode();
    return reconnected;
  }
  assert.equal(await harness('', true), CODE, 'ふつうの招待は これまで通り つながる');
  assert.equal(await harness(CODE, true), '', 'はずされた あいことばでは 自動で つなぎ直さない');
  assert.equal(await harness('betsunoaikotoba', true), CODE, 'べつのグループの はずし記録は じゃまをしない');
  assert.equal(await harness('', false), '', '人が選んだ別の共有を起動URLで上書きしない');
  const apply = grab(APP, 'applyJoinCode');
  assert.match(apply, /const code = joinCodeFromURL\(\);/,
    '同期の準備が終わる前に招待URLのコードを消さないこと');
  assert.match(apply, /S\.reconnect\(code, \{ joining:true \}\);\s*if\(isStandalone\(\)\) clearJoinCodeFromURL\(\);/,
    'ホーム画面版では接続開始後にだけ招待コードをURLから消すこと');
  assert.match(apply, /if\(tab === 'welcome'\)\{\s*tab = 'home';[\s\S]{0,100}navigateTo\('home'\);/,
    '招待接続後は初期設定画面から、既存の端末役割選択を持つhome側へ切り替えること');
  assert.match(apply, /await S\.isRevokedCode\(code\)/,
    '解除済み比較は平文コピーではなくfingerprint APIを使うこと');
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
test('ちがうあいことばにつなぐとき、設定の保存時刻を0に戻す', async ()=>{
  async function harness(rememberedHouse, joining){
    const store = { 'natsu.savedAt.v1': JSON.stringify({ config:9999, state:8888 }) };
    if(rememberedHouse) store['natsu.config.house.v1'] = rememberedHouse;
    const st = { resetAt: 777 };
    const api = new Function('getLocal', 'setLocal', 'savedAt', 'localStorage',
                             'K_AT', 'K_CFG_HOUSE', 'K_ST', 'state', 'ms',
                             'codeFingerprint', 'clearQuestionAnswerCache', `
      ${grab(APP, 'forgetConfigStampForNewHousehold')}
      return forgetConfigStampForNewHousehold;
    `)(
      k => store[k] || '', (k, v) => { store[k] = v; },
      () => JSON.parse(store['natsu.savedAt.v1'] || '{}'),
      { setItem:(k,v)=>{ store[k]=v; } },
      'natsu.savedAt.v1', 'natsu.config.house.v1', 'natsu.state.v2', st,
      v => Number(v) || 0,
      async value => 'hash:' + String(value || '').trim().normalize('NFKC').replace(/\s+/g, '').toLowerCase(),
      ()=>{ store.cacheCleared = (store.cacheCleared || 0) + 1; }
    );
    await api(joining);
    return { at: JSON.parse(store['natsu.savedAt.v1']), resetAt: st.resetAt,
             house:store['natsu.config.house.v1'], cacheCleared:store.cacheCleared || 0 };
  }

  assert.deepEqual((await harness('', 'aaaaaaaaaaaaaaaa')).at, { state:8888 },
    'はじめて つなぐ ときは 設定の時刻を 落とす');
  assert.deepEqual((await harness('bbbbbbbbbbbbbbbb', 'aaaaaaaaaaaaaaaa')).at, { state:8888 },
    'べつの おうちに 移る ときも 落とす');
  assert.deepEqual((await harness('fp:hash:aaaaaaaaaaaaaaaa', 'aaaaaaaaaaaaaaaa')).at,
    { config:9999, state:8888 }, '同じ おうちなら そのまま');
  const legacySame = await harness('ＡＡＡＡＡＡＡＡＡＡＡＡＡＡＡＡ', 'aaaaaaaaaaaaaaaa');
  assert.deepEqual(legacySame.at, { config:9999, state:8888 },
    '旧平文形式でも正規化後に同じおうちなら時刻を保つ');
  assert.equal(legacySame.resetAt, 777, '同じおうちの削除世代を失わない');
  assert.equal(legacySame.house, 'fp:hash:aaaaaaaaaaaaaaaa', '旧平文だけfingerprintへ置き換える');
  assert.equal(legacySame.cacheCleared, 0, '同じおうちの質問控えを消さない');

  /* 「記録をすべて削除」の世代番号は、前のおうちあての印。
     のこしたまま入ると、入った先のおうちの記録がまるごと捨てられる */
  assert.equal((await harness('bbbbbbbbbbbbbbbb', 'aaaaaaaaaaaaaaaa')).resetAt, 0,
    'べつのおうちに移るとき、消した世代番号は手放すこと');
  assert.equal((await harness('fp:hash:aaaaaaaaaaaaaaaa', 'aaaaaaaaaaaaaaaa')).resetAt, 777,
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
    ['natsu.welcome.theme.v1', JSON.stringify({house:'house-a',theme:'berry'})]
  ]);
  let saved = 0;
  const harness = new Function('localStorage', 'onSave', `
    const window={NatsuSync:{householdFingerprint:()=> 'house-a'}};
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

  storage.set('natsu.welcome.theme.v1', JSON.stringify({house:'other-house',theme:'cat'}));
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
    ${grabConst(APP, 'READING_GRADE_OPTIONS')}
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

test('読書記録の基本入力は、狭い画面でも本の名前の入力幅を守り、戻る前に音声入力を止める', ()=>{
  const book = grab(APP, 'openBookSheet');
  assert.match(book, /class="field book-entry-field book-title-entry"[\s\S]{0,500}mic-row/,
    '本の名前だけを狭い画面で縦並びに切り替えられること');
  assert.match(STYLE, /@media \(max-width:560px\)\{\s*\.book-title-entry\{\s*grid-template-columns:minmax\(0,1fr\);[\s\S]{0,180}\.book-title-entry > \.need-msg\{ grid-column:auto; \}/,
    'iPhone幅では本の名前の札を含む見出しで入力欄を狭めず、必須メッセージも下に置くこと');
  assert.match(book, /class="field book-entry-field"[\s\S]{0,220}id="bkDate"/,
    '読んだ日は見出しと入力欄を同じ行に置くこと');
  assert.match(STYLE, /\.mic-row > input\[type=text\][\s\S]{0,120}flex:1 1 0/,
    '入力欄がマイクの横幅を譲ること');
  const close = grab(APP, 'closeSheet');
  assert.ok(close.indexOf('stopSR();') < close.indexOf("$('#sheetWrap').hidden = true"),
    '戻る操作ではシートを隠す前にマイクを止めること');
});

test('保護者ページから開いた読書記録だけ、大人向けの完了表示にする', ()=>{
  const open = grab(APP, 'openSheet');
  const save = grab(APP, 'saveBookSheet');
  assert.match(grab(APP, 'isAdultTab'), /t === 'settings' \|\| t === 'tasks' \|\| t === 'config'/,
    '#settings・#tasks・#config だけを保護者ページとして扱うこと');
  assert.match(open, /sheetAdultOrigin = isAdultTab\(tab\);/,
    'シートを開いたページで保護者向けかを決め、記録データでは判定しないこと');
  assert.match(save, /const adultOrigin = sheetAdultOrigin;[\s\S]{0,160}stamp\(adultOrigin \? '修正が完了しました'/,
    '保護者ページから開いた読書記録には、漢字のまま大人向けの完了表示を出すこと');
  assert.match(save, /adultOrigin \? '修正が完了しました' : sheetBookId \? wording\('なおしたよ'/,
    '子ども画面から開いたときは従来の完了表示を使うこと');
});

test('保護者の本の記録は最新3冊を見せ、残りと並び順を控えめに切り替える', ()=>{
  const makeOrder = stored => new Function('getLocal', `
    const K_PARENT_BOOK_ORDER = 'book-order';
    ${grab(APP, 'parentBookOrder')}
    ${grab(APP, 'parentBookRows')}
    return { parentBookOrder, parentBookRows };
  `)(()=>stored);
  const source = [{date:'2026-08-20',nth:1},{date:'2026-08-22',nth:2}];
  assert.deepEqual(makeOrder('').parentBookRows(source).map(row=>row.nth), [2,1],
    '既定は新しい本が上の降順にすること');
  assert.deepEqual(makeOrder('asc').parentBookRows(source).map(row=>row.nth), [1,2],
    '端末に古い順を保存したときは昇順にすること');
  const section = grab(APP, 'bookSectionHTML');
  assert.match(section, /const shown = rows\.slice\(0, 3\), rest = rows\.slice\(3\);/,
    '常時表示はスマホで長くなりすぎない3冊にすること');
  assert.match(section, /data-details-key="parentBooksMore"[\s\S]{0,120}残り\$\{rest\.length\}冊を見る/,
    '4冊目以降は残り冊数が分かる折りたたみに入れること');
  assert.equal((section.match(/data-parent-book-order=/g) || []).length, 1,
    '並び順は大きな2ボタンでなく、単一の小さな切り替えにすること');
  assert.match(grab(APP, 'bindParent'), /setLocal\(K_PARENT_BOOK_ORDER, order\)/,
    '並び順は共有せず端末内に覚えること');
  assert.match(STYLE, /\.parent-book-order\{[\s\S]{0,180}min-height:44px[\s\S]{0,180}font-size:13px/,
    '見た目は控えめでもタップ領域は44pxを保つこと');
});

test('本の編集は書名つきの鉛筆アイコンにし、狭幅でも操作を重ねない', ()=>{
  const row = grab(APP, 'parentBookRowHTML');
  assert.match(APP, /edit:'<svg[^']*stroke="currentColor"[^']*stroke-width="2"/,
    'ゴミ箱と同じ自作ピクトグラム体系の鉛筆を使うこと');
  assert.match(row, /const editName = `「\$\{b\.title \|\| '書名未設定'\}」を編集する`/);
  assert.match(row, /class="icon-btn edit"[\s\S]{0,180}title="\$\{esc\(editName\)\}" aria-label="\$\{esc\(editName\)\}"/,
    'titleとaria-labelの両方で対象の本を伝えること');
  assert.match(row, /<div class="book-actions">[\s\S]{0,500}icon\('edit'\)[\s\S]{0,500}icon\('trash'\)/,
    '編集と削除を同じ操作グループにまとめること');
  assert.match(STYLE, /\.book-actions\{[^}]*display:flex/);
  assert.match(STYLE, /@media \(max-width:480px\)\{[\s\S]{0,1500}\.book-row > \.book-actions\{ grid-column:3; grid-row:1; \}/,
    '狭幅でも2つの操作を書名と同じ段の右へ置くこと');
  assert.match(STYLE, /@media \(max-width:480px\)\{[\s\S]{0,1600}\.book-title\{ font-size:16px; \}/,
    '狭幅だけ書名を16pxにすること');
  /* 詰めたのは 余白と 副題の 字だけ。書名は 16px より 下げない。 */
  assert.match(STYLE, /@media \(max-width:480px\)\{[\s\S]{0,1700}\.book-sub\{ font-size:13px;/,
    '日付・著者・出版社の副題だけを13pxへ落とすこと');
});

test('宿題設定に本の記録を混ぜず、子どもの本一覧の並びも変えない', ()=>{
  const tasks = grab(APP, 'viewTasks');
  assert.doesNotMatch(tasks, /state\.books|bookTaskOrder|bookTaskRecords|folded:true|parentBook/,
    '#tasks の宿題欄へ記録一覧や専用の折りたたみを置かないこと');
  assert.doesNotMatch(grab(APP, 'taskSectionHTML'), /o\.folded|task-settings-fold/,
    '必須・任意・毎日の設定欄は同じ骨組みを保つこと');
  assert.match(grab(APP, 'viewBooks'), /state\.books\.slice\(\)\.sort\(\(a,b\)=> a\.nth - b\.nth\)/,
    '子ども画面の本一覧は従来の冊数順を保つこと');
});

/* ---------------------------------------------------------
   読書の記録に 必須／任意を 持たせる

   子ども画面（viewHome）・進捗（overall）・お祝い（celebrateTargets）は
   もともと group だけを 見ている。読書を 別の 箱に 置いていたのは
   「宿題を決める」画面だけ だったので、そこを そろえる。
   --------------------------------------------------------- */
test('読書の記録は必須か任意の箱に並び、ならべかえも同じまとまりで動く', ()=>{
  const tasks = grab(APP, 'viewTasks');
  assert.match(tasks, /const must\s+= rows\.filter\(\(\{t\}\)=>taskKind\(t\)!=='daily' && t\.group === 'must'\);/,
    '必須の箱は 毎日以外の group==='+"'must'"+' を すべて 拾うこと（読書も 入る）');
  assert.match(tasks, /const option = rows\.filter\(\(\{t\}\)=>taskKind\(t\)!=='daily' && t\.group !== 'must'\);/,
    '任意の箱も 読書を 除かないこと');
  assert.doesNotMatch(tasks, /const books\s*=/,
    '読書だけの箱を作らないこと（どちらの分類なのかが画面から読めなくなる）');

  assert.match(grab(APP, 'taskOrderBucket'), /return t && t\.group;/,
    'ならべかえのまとまりは group だけで決めること（読書を端に固定しない）');

  /* お祝いの 前提を 崩さない。読書は もともと group で 数えられている */
  assert.match(grab(APP, 'celebrateTargets'), /t\.group === group && t\.type !== 'daily'/,
    'お祝いの対象は group で拾い、毎日の項目だけを外すこと');
  assert.match(grab(APP, 'celebrateGroupDone'), /list\.length > 0 && list\.every/,
    'B は 課題が1つも無い分類では出さないこと');
  assert.match(grab(APP, 'celebrateAllDone'), /\['must','option'\]\.filter\(g => celebrateTargets\(g\)\.length > 0\)/,
    'C は 課題が1つも無い分類を「済んだ」として数えること');
});

test('進め方で読書を選べ、選び直しても記録は消さない', ()=>{
  const taskFieldKeys = new Function(`${grabConst(APP, 'TASK_FIELD_KEYS')} return TASK_FIELD_KEYS;`)();
  assert.deepEqual(taskFieldKeys.type, ['type', 'recordStyle'],
    '「進め方」欄は type と recordStyle の両方を見ること（読書にしても type は count のまま）');
  assert.ok(!taskFieldKeys.type.includes('bookFields'),
    '「本ごとに残す項目」を1つ押しただけで「進め方」まで変えたことにしないこと');

  const bind = grab(APP, 'bindConfig');
  const typeBranch = bind.slice(bind.indexOf("else if(f === 'type')"), bind.indexOf("else if(f === 'group')"));
  assert.match(typeBranch, /if\(e\.target\.value === 'book'\)\{[\s\S]{0,200}t\.type = 'count';[\s\S]{0,200}t\.recordStyle = 'book';/,
    '読書を選んだら type は count のままで recordStyle を book にすること');
  assert.doesNotMatch(typeBranch, /state\.|splice|delete t\.total|delete t\.bookFields/,
    '進め方を変えても、これまでの記録・冊数・本ごとの設定は消さないこと');
  /* 読書の あいだ 使われない 値を 上書きすると、戻したときに
     「まい」が「さつ」に なっている、が 起きる */
  const bookBranch = typeBranch.slice(typeBranch.indexOf("if(e.target.value === 'book')"), typeBranch.indexOf('}else{'));
  assert.match(bookBranch, /t\.unit = t\.unit \|\| 'さつ';/,
    '読書にするとき、すでにある単位を上書きしないこと');
  assert.doesNotMatch(bookBranch, /t\.numbered/,
    '読書では使わない「①②で表示」を勝手に立てないこと');

  /* 追加ボタンは 必須・任意の 2つだけ。読書は 足したあとに 選ぶ */
  assert.doesNotMatch(bind, /addBookTask/,
    '読書だけの追加ボタンを増やさないこと');

  /* 押したとたんに 行が 動く・欄の 顔ぶれが 変わる 2つは、
     押した 欄が いちど 消える。キーボードの 居場所を 返す */
  assert.match(typeBranch, /refocusTaskField\(t, '\[data-f="type"\]'\);/);
  const groupBranch = bind.slice(bind.indexOf("else if(f === 'group')"), bind.indexOf("else t[f] = e.target.value;"));
  assert.match(groupBranch, /refocusTaskField\(t, '\.set-seg-opt input:checked'\);/,
    'ラジオは先頭ではなく、選ばれているほうへ焦点を返すこと');
  assert.match(grab(APP, 'refocusTaskField'), /'\.set-task\[data-details-key="task:' \+ t\.id \+ '"\] ' \+ inner/);
});

test('必須／任意はボタン形の選択にし、値が短い欄は見出しの右へ置く', ()=>{
  const row = makeTaskEditorRowHarness()(null, null);
  const book = row({ id:'b1', group:'must', type:'count', recordStyle:'book',
    name:'読書のきろく', total:20, unit:'さつ', numbered:true,
    bookFields:{ author:true, publisher:false, rating:true } }, 0);

  assert.doesNotMatch(book, /<select data-f="group">/,
    '必須／任意は開いて選ぶ一覧にしないこと');
  assert.match(book, /<span class="set-seg" role="radiogroup" aria-labelledby="taskgrouplab-b1">/,
    '2つの選択はラジオのまとまりとして読み上げへ渡すこと');
  assert.match(book, /<input type="radio" name="taskgroup-b1" value="must" data-f="group" checked><span>必須<\/span>/,
    'いまの分類のピルを選択済みにすること');
  assert.match(book, /<option value="book" selected>読書（1冊ずつ記録）<\/option>/,
    '読書の項目にも「進め方」を出し、読書を選択済みにすること');
  assert.match(book, /class="set-field set-field--row"><span class="set-field-lab">目標の冊数[\s\S]{0,120}input class="set-num"/,
    '目標の冊数は見出しの右へ置き、入力幅を中身に合わせること');

  const count = row({ id:'t1', group:'option', type:'count', name:'プリント',
    total:10, unit:'まい', numbered:true, wrapUp:false, memoLabel:'', questions:[] }, 0);
  assert.match(count, /<option value="book">読書（1冊ずつ記録）<\/option>/,
    'ふつうの宿題からも読書へ変えられること');
  assert.match(count, /set-field--row"><span class="set-field-lab">合計[\s\S]{0,120}input class="set-num"/);
  assert.match(count, /set-field--row"><span class="set-field-lab">単位[\s\S]{0,120}input class="set-txt-s"/);
  /* 選択肢の 字が 長い 欄は 敷いたまま。横に 並べると 折り返す */
  assert.doesNotMatch(count, /set-field--row[^>]*>[^<]*<span class="set-field-lab">進め方/,
    '進め方のように選択肢の字が長い欄は、見出しを上に敷いたままにすること');

  assert.match(STYLE, /\.set-field--row\{ grid-template-columns:minmax\(0,1fr\) auto; align-items:center;/);
  assert.match(STYLE, /\.set-field--row input\.set-num\{ width:4\.5em; \}/);
  assert.match(STYLE, /\.set-seg-opt\{[\s\S]{0,200}min-height:44px;/,
    'ピルの的は44pxを保つこと');
  assert.match(STYLE, /\.set-seg-opt:has\(input:checked\)\{/);
  assert.match(STYLE, /\.set-seg-opt:has\(input:focus-visible\)\{[\s\S]{0,80}outline:3px solid var\(--focus\)/,
    'キーボードで選んでいる位置を見せること');
  /* 旧設定CSSが あとに 来て 全幅へ 戻す。同じ 強さで 決め直しておく */
  assert.match(STYLE, /\.set-task-body \.set-grid \.set-field--row\{ grid-template-columns:minmax\(0,1fr\) auto;/,
    'あとに来る旧設定CSSの全幅指定を、同じ強さで決め直すこと');
});

/* group を 持たない 課題は、子ども画面の どの欄でも 拾われない
   （viewHome は group で 絞る）。設定の 一覧からも 消えると
   手元から 無くなったように 見えるので、任意へ 寄せる。 */
test('分類を持たない課題は任意へ寄せ、必須の分母を黙って増やさない', ()=>{
  const out = normalizeConfigHarness({ tasks:[
    { id:'a', type:'count', recordStyle:'book', total:5 },
    { id:'b', group:'', type:'count', total:3 },
    { id:'c', group:'daily', type:'daily', target:1 },
    { id:'d', type:'daily', target:1 },
    { id:'e', group:'must', type:'count', total:2 }
  ], theme:'notebook', title:'x', childName:'' });
  const groupOf = id => out.tasks.find(t=>t.id === id).group;
  assert.equal(groupOf('a'), 'option', '分類を持たない読書は任意へ寄せること');
  assert.equal(groupOf('b'), 'option', '空の分類も任意へ寄せること');
  assert.equal(groupOf('c'), 'daily', 'まいにちはそのまま');
  assert.equal(groupOf('d'), 'daily', '型がまいにちなら、まいにちの欄へ入れること');
  assert.equal(groupOf('e'), 'must', 'すでに必須のものは動かさないこと');
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
  assert.match(remote, /welcomeTheme\.house === activeHouse/,
    '一時デザインは平文コピーでなく確認済みの同じグループfingerprintだけに適用する');
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
  /* 「日」がつづかない月も「がつ」。カレンダーの見出し（2026年 8月）が
     辞書の既定で「つき」と読まれていた（実機で再発） */
  assert.equal(context('2026年 8月', 0), '2026年 8がつ');
  assert.equal(context('2026年 8月', 1), '2026年 8月');
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
  assert.match(grab(APP, 'viewConfig'), /adultSectionHelpAttr\([\s\S]{0,180}変更は共有中の子ども端末にも反映されます/,
    '子ども画面への反映範囲は見出しの i で案内する');
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
  assert.match(watch, /joiningExisting\)\{[\s\S]{0,200}failExistingJoin\(/,
    '静かに上書きせず、画面に出して気づけるようにすること');
  assert.match(grab(SYNC, 'failExistingJoin'), /setStatus\('error'/,
    '共通の参加失敗処理がエラーを画面へ出すこと');
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
  assert.match(make, /on\('#syncMake', 'click', \(\)=>\{?\s*startSharing\(S\.makeCode\(\), true\);?\s*\}?\)/);
  /* おまかせの合言葉に「短い合言葉を使わないで」の注意はあてはまらない。
     押すたびに出すだけ邪魔なので、自分で決めたときだけ出す */
  assert.match(make, /if\(!auto && !confirmShareSafety\(\)\) return;/);
  assert.match(make, /on\('#syncMakeOwn', 'click'/);
  assert.match(make, /if\(c\.length < 8\)/, '自分で決めた合言葉は8文字以上を求めること');

  const section = grab(APP, 'syncSectionHTML');
  assert.match(section, /合言葉をつくる（おまかせ）/);
  /* 押すと何が起きるかは画面に書く。ただし「16文字」「そのあとQRを渡す」は
     しくみの話なので i の中へ移した（画面の説明は他の節と同じ密度にそろえる）。
     どちらも消したわけではないので、移した先も見る。 */
  assert.match(section, /押した時点で、この端末の宿題・設定・記録がグループの内容になります/,
    '作成で何が起きるかを画面に書くこと');
  assert.match(INDEX, /id="syncHelpDialog"/, '共有の i は専用ダイアログにすること');
  /* i には「押すと何が起きるか」を書く。16文字という中身は画面側
     （はじめて共有する の説明）にあり、そちらは上で見ている */
  assert.match(INDEX, /合言葉を作成するとグループが作成され、データ共有が始まります/,
    '作成した時点で共有が始まることを i にも書くこと');
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
  ['#cfgShowDaily','#addMustTask','#addOptionTask','#addDailyTask'].forEach(sel=>{
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
  assert.match(APP, /if\(role === 'parent'\) navigateTo\('settings'\)/);
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
  assert.match(apply, /const chosen = getLocal\(K_CODE_CHOSEN\);[\s\S]{0,140}chosenCodeMatches\(code\)/,
    'えらんだ合言葉と違う招待では、つなぎ直さないこと');
  /* えらんだ場面すべてでおぼえること。1か所でも抜けると引き戻される */
  assert.equal((APP.match(/rememberChosenCode\(/g) || []).length, 10,
    '定義1つと、作成・参加・招待・QR・初期設定・解除・削除・参加失敗・解除通知の9か所');
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
    /id="syncStatus" role="status" aria-live="polite">\$\{syncStatusHTML\(S\.status\(\), S\.statusText\(\)\)\}/);
  const bind = grab(APP, 'bindSync');
  assert.match(bind, /el\.innerHTML = syncStatusHTML\(st, text\)/,
    '通知の側も同じ関数を通すこと');
  assert.match(bind, /onDeviceCount\([\s\S]{0,200}syncStatusHTML\(S\.status\(\), S\.statusText\(\)\)/,
    '1台から2台になったら文言を出しなおすこと');
  assert.equal((APP.match(/ほかの端末を待っています/g) || []).length, 1,
    '文言は1か所にだけ書くこと');
});

/* 共有ずみの画面に出ている合言葉は「すでに使っているもの」。
   「この合言葉で接続」だと、作った本人がまだ繋がっていないと読む。 */
test('共有ずみの合言葉は見せるだけ。つなぎ直しはたたむ', ()=>{
  const f = grab(APP, 'syncSectionHTML');
  assert.match(f, /<label class="lab" for="syncCodeShown">このグループの合言葉<\/label>/);
  assert.match(f, /id="syncCodeShown"[\s\S]{0,200}readonly/, '見せるだけの欄にすること');
  assert.match(f, /class="sync-code-control"[\s\S]{0,260}id="syncCodeShown"[\s\S]{0,260}id="syncCopy"/,
    '合言葉欄とコピーを同じ行の操作グループにすること');
  assert.match(STYLE, /\.sync-code-control\{[^}]*grid-template-columns:minmax\(0,1fr\) auto/,
    '合言葉欄を縮めてもコピーの44px操作領域を守ること');
  /* 参加の欄と id を分けること。同じ id だと captureFormDraft が拾った
     古い値が描き直しのあとで書きもどされ、解除しても前の合言葉がのこり、
     おまかせを押しても新しい合言葉が出ない（実機でそうなった） */
  assert.equal((f.match(/id="syncCode"/g) || []).length, 1,
    'syncCode は参加の欄だけにすること');
  /* 注釈の中でこの語に触れるのは構わない。ボタンとして出ないことを見る */
  assert.doesNotMatch(f, /<button[^>]*>この合言葉で接続<\/button>/);
  /* つなぎ直しは「共有をやめる・つなぎ直す」のたたみへ移した。
     たたむ（ふだんは見せない）という意図は変えていないので、
     たたみの中にあることを見る。 */
  assert.match(f, /<summary>共有をやめる・つなぎ直す<\/summary>[\s\S]{0,900}id="syncRejoinCode"/,
    'つなぎ直しはたたんだ中に置くこと');
  assert.match(f, /id="syncRejoinCode"/, 'つなぎ直しは専用の欄から読むこと');
  const bind = grab(APP, 'bindSync');
  assert.match(bind, /\$\('#syncRejoinCode'\) \|\| \$\('#syncCode'\)/);
  assert.match(bind, /const shown = \$\('#syncCodeShown'\);/, 'コピーは表示中の合言葉から取ること');
});

/* 継ぎ足しで育った共有欄を、全体から組み直したときの決めごと。
   ここが崩れると「どれから押すのか分からない」状態へ戻る。 */
test('共有欄は、作る・参加する・増やす・整える・やめるの順で主を1つにする', ()=>{
  const f = grab(APP, 'syncSectionHTML');

  /* 未接続。入口は2つ、それぞれ主のボタンは1つだけ。
     参加側の実際の道すじはQRなので、いちばん強いボタンをQRにする */
  assert.match(f, /btn btn-go" id="syncMake"[^>]*>合言葉をつくる（おまかせ）/);
  assert.match(f, /btn btn-go" type="button" data-qr-invite-scan>QRコードを読み取る/,
    '参加はQRを主にすること');
  assert.match(f, /<summary>合言葉を入力して参加する<\/summary>[\s\S]{0,600}id="syncVerify"/,
    '合言葉の手入力と確認はたたみの中へ入れること');
  assert.match(f, /btn btn-sm" id="syncMakeOwn"/,
    'たたみの中のボタンを主のボタンと同じ強さにしないこと');

  /* 共有ずみ。使う順に3つ。招待がいちばん奥にあった状態へ戻さない */
  const folds = (f.match(/<summary>(?:<span[^>]*>)?([^<]+)/g) || []).join('|');
  const order = ['ほかの端末を増やす', '端末と表示の設定', '共有をやめる・つなぎ直す'];
  let at = -1;
  for(const name of order){
    const next = folds.indexOf(name);
    assert.ok(next > at, name + ' の順序が入れかわっている');
    at = next;
  }
  assert.match(f, /data-details-key="syncInvite"\$\{opts && opts\.openDetails \? ' open' : ''\}/,
    '作成直後はQR・招待リンクのたたみを開くこと');

  /* 安全に関わる1行は、操作のすぐそばに残す（憲章2節・8節）。
     くわしい手順や背景は i の中だが、この3つは画面から動かさない */
  assert.match(grab(APP, 'deviceListHTML'), /一覧から外しても、合言葉を入れ直せば再参加できます。/,
    '「外す」をアクセスの取り消しと読ませないこと');
  assert.match(f, /「保護者の端末」「子どもの端末」は、開いたときの画面と記録者名の設定です。/,
    '役割を権限と読ませないこと');
  /* 合言葉が入っていることは、URL を見るより先に言う（利用者の裁定で
     末尾の1行から先頭の案内へ移した）。憲章2節が操作画面に求める注意 */
  const invite = grab(APP, 'inviteHTML');
  assert.match(invite, /リンクには<b>合言葉が含まれています<\/b>/,
    '招待リンクに合言葉が入ることを、リンクを渡す前に書くこと');
  assert.match(invite, /class="sync-code-control"[\s\S]{0,300}id="inviteUrl"[\s\S]{0,200}id="inviteCopy"/,
    'URL の欄とコピーを同じ行の操作グループにすること');

  /* i は写真の説明と同じ作り。平文1段落の共通ダイアログは使わない。
     buildAdultSectionToc() は既にボタンがある見出し帯には足さないので、
     自前のボタンを置いても i は1つのまま */
  assert.doesNotMatch(f, /adultSectionHelpAttr\(/,
    '図と番号を出す説明を、平文1段落のダイアログへ入れないこと');
  assert.match(grab(APP, 'syncHeadHTML'), /data-sync-help[\s\S]{0,200}aria-controls="syncHelpDialog"/);
  assert.match(grab(APP, 'buildAdultSectionToc'), /!\$\('\.adult-section-head-help', head\)/,
    '自前のiがある見出しに、もう1つiを足さないこと');
  assert.match(INDEX, /id="syncHelpDialog"[\s\S]{0,4000}<ul class="poster-facts">/,
    '注意はiの中に箇条書きで置くこと');
  /* 90日・管理者確認はここでは言わない。保護者ページ最下部の注意事項と
     紹介ページが持っている。重ねると警告が読み流される */
  const dialog = INDEX.slice(INDEX.indexOf('id="syncHelpDialog"'), INDEX.indexOf('id="posterHelpDialog"'));
  /* 「管理者側では読み取れません」は暗号化の説明として正しく出る。
     禁じたいのは保持期限（90日で削除対象）の話を重ねること */
  assert.doesNotMatch(dialog, /90日|管理者確認|削除対象/, 'iに保持期限の話まで重ねないこと');
  assert.match(dialog, /すべての端末で合言葉を忘れると/, '戻せなくなる条件はiに残すこと');
  /* 図の 語は 1つだけ。手順と 注意で 言っていることを キャプションで 重ねない */
  assert.doesNotMatch(dialog, /<small>合言葉をつくる<\/small>|<small>合言葉そのもの<\/small>/,
    '図のキャプションで手順と同じことを繰り返さないこと');
  /* 図は 2コマだけ。しくみの 図解は 置かない（利用者の 裁定）。
     QR で 渡すことは すでに 広く 知られた 前提 */
  assert.match(dialog, /<b>この端末<\/b>[\s\S]{0,600}<b>共有<\/b>[\s\S]{0,600}<b>ほかの端末<\/b>/);
  assert.equal((dialog.match(/class="poster-flow-step"/g) || []).length, 2,
    '図のコマは2つまで（3つならべると狭い画面で語が折れる）');
  assert.match(STYLE, /#syncHelpDialog \.poster-facts li\{/,
    '注意は1つずつ囲んで、どこで切れるかを読めるようにすること');
});

/* 実機（375px）で出た収まりの指摘。どれも「枠にくっつく」「変な位置で折れる」
   「縦に長い」のどれかで、要素を足して直すのではなく置き方で直す。 */
test('狭い画面の収まり：点線を枠から離し、対のボタンは左右にならべる', ()=>{
  /* 紙の枠と区切りの点線が同じ太さで接すると、囲みの線と見分けがつかない */
  assert.match(STYLE, /\.sync-code-row\{ margin-inline:16px;/);
  /* たたみの中の区切りは中の見出しが持つ。body の上端に引くと、中身が
     囲みの箱のとき背景に隠れ、角の丸みのぶん両端だけがのぞく */
  assert.match(STYLE, /#syncSection \.set-advanced-body\{ border-top:0; \}/);
  assert.match(STYLE, /#syncSection \.set-advanced-body > \.sync-subhead:first-child\{ border-top:2px dashed/);
  assert.doesNotMatch(STYLE, /#syncSection \.set-advanced-body::before/,
    '囲みの箱に隠れる線を引かないこと');
  assert.match(STYLE, /\.sync-subhead\{\s*margin-inline:16px;/);
  assert.match(STYLE, /#syncSection > \.paper > \.sync-start:first-child > \.sync-subhead\{ border-top:0; \}/,
    '欄のいちばん上に区切りを引かないこと');

  /* 狭い画面の既定は1列（.set-actions）。対になる2つだけ上書きする */
  const narrow = STYLE.slice(STYLE.indexOf('.set-actions{ display:grid; grid-template-columns:minmax(0,1fr); }'));
  /* display:grid では効かない。あとに来る `.set-actions{ display:flex }` が
     順序で勝つため、幅を決めている `.set-actions .btn{ width:100% }` を外す形で書く */
  assert.match(narrow.slice(0, 900), /\.set-actions--pair > \.btn\{ width:auto; flex:1 1 0; min-width:0; \}/,
    '1列の既定のすぐ後ろ（狭い画面の段の中）で上書きすること');
  assert.match(narrow.slice(0, 900), /\.set-actions--pair > \.set-actions-full\{ flex:1 1 100%; \}/);
  const cfg = grab(APP, 'viewConfig');
  assert.match(cfg, /class="set-actions app-info-actions set-actions--pair"[\s\S]{0,400}使い方[\s\S]{0,200}更新履歴/);
  assert.match(cfg, /set-actions-full" id="appUpdate"/, '更新は1つだけの操作なので全幅にすること');
  assert.match(cfg, /class="set-actions set-actions--pair"><button[^>]*id="expBtn"[\s\S]{0,120}id="impBtn"/);
  /* **消すボタンは隣どうしにしない。** 押し間違えると戻せない */
  const danger = cfg.slice(cfg.indexOf('data-danger-zone'));
  assert.doesNotMatch(danger.slice(0, 600), /set-actions--pair/,
    '一括削除のボタンを左右にならべないこと');
});

/* 「i」の中身は1画面に収まらない。実機（iPhone）で下端が切れ、末尾まで
   たどれなかった。原因は2つで、どちらもダイアログの箱の側にあった。 */
test('説明のダイアログは、中身が長くても末尾まで読める', ()=>{
  const box = STYLE.slice(STYLE.indexOf('.poster-dialog{'), STYLE.indexOf('.poster-dialog::backdrop'));
  assert.match(box, /overflow-y:auto/,
    '<dialog> は既定であふれを切るだけなので、ここでスクロールさせること');
  /* vh は iOS でアドレスバーをふくむ大きいほうの高さになる。
     dvh を後ろに置いて上書きする（読めないブラウザは vh のまま） */
  assert.match(box, /max-height:92vh; max-height:92dvh;/,
    'iOS で画面からはみ出さないよう dvh で上書きすること');
  assert.match(STYLE, /\.poster-body\{ overflow:auto; max-height:80vh; max-height:80dvh; \}/);
  /* とじるは、末尾まで送っても押せる位置にある（前から） */
  assert.match(STYLE, /\.poster-help \.poster-head\{\s*position:sticky/);
});

/* 使い方・変更履歴はアプリから別のタブで開く。新しいタブには戻る操作が無く、
   狭い画面では上帯の入口もメニューの中にたたまれていた（実機の指摘）。 */
test('別のタブで開いた案内ページから、アプリへ戻れる', ()=>{
  for(const [name, page] of [['使い方', GUIDE], ['変更履歴', UPDATES]]){
    assert.match(page, /<div class="shell back-to-app"><a class="button" href="\.\.\/">← しゅくだいノートへ戻る<\/a><\/div>/,
      name + 'のページに戻る入口を置くこと');
  }
  assert.match(DOCS_STYLE, /@media \(min-width: 40rem\) \{\s*\.back-to-app \{\s*display: none;/,
    '広い画面では上帯に出ているので重ねないこと');
});

test('アプリ情報から使い方と更新履歴を状態を保ったまま開ける', ()=>{
  const cfg = grab(APP, 'viewConfig');
  assert.match(cfg, /href="start\/getting-started\.html" target="_blank" rel="noopener"[\s\S]{0,100}aria-label="使い方を新しいタブで開く"/);
  assert.match(cfg, /href="start\/updates\.html" target="_blank" rel="noopener"[\s\S]{0,100}aria-label="更新履歴を新しいタブで開く"/);
  assert.doesNotMatch(cfg, /href="#(?:getting-started|updates)/,
    '画面切替に使うURLの#を案内リンクで汚さないこと');
});

test('記録の手入れはデータ管理へ順序どおり統合し、一括削除だけを危険表示にする', ()=>{
  const cfg = grab(APP, 'viewConfig');
  assert.doesNotMatch(cfg, /<h2>記録の手入れ<\/h2>/);
  assert.equal((cfg.match(/<h2>データ管理<\/h2>/g) || []).length, 1,
    '目次へ拾われる見出しはデータ管理1つだけにすること');
  const start = cfg.indexOf('id="dataManagementSection"');
  const data = cfg.slice(start, cfg.indexOf('${syncTraceHTML()}', start));
  const one = data.indexOf('id="allowLogDelete"');
  const backup = data.indexOf('id="expBtn"');
  const danger = data.indexOf('id="resetCfg"');
  assert.ok(start >= 0 && one >= 0 && backup > one && danger > backup,
    '1件削除設定→バックアップ→一括削除の順にすること');
  assert.match(data, /class="data-management-toggle"/,
    'チェックボックスを独立した色カードでなく通常の設定行にすること');
  assert.match(data, /class="data-danger-zone"[\s\S]{0,500}id="resetCfg"[\s\S]{0,300}id="resetAll"/,
    '危険な見た目は一括削除の2操作だけを囲むこと');
  assert.doesNotMatch(data.slice(0, data.indexOf('class="data-danger-zone"')), /btn-danger/,
    '1件削除設定とバックアップを危険操作として見せないこと');
  assert.match(cfg, /adultSectionHelpAttr\([\s\S]{0,260}1件削除[\s\S]{0,160}バックアップ[\s\S]{0,160}一括削除/,
    'iダイアログの説明も3つの役割へ統合すること');
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

/* 追加すれば二度と出ない一時的な案内なので、i マーク（常設項目の補足）と
   目次には載せない。どちらも buildAdultSectionToc() が `.sec-head > h2` から
   作るため、枠だけの aside にすれば両方まとめて外れる。 */
test('ホーム画面追加の案内は、常設項目と同じ形にしない', ()=>{
  const f = grab(APP, 'homeInstallGuideHTML');
  /* 本文は利用者の裁定（2026-08-24）で「追加をおすすめします。ホーム画面から
     アプリのように使用できるようになります。」へ差し替えた。追加後にどちらの
     画面が開くかの説明はこの判断で落としている。文言そのものは縛らず、
     本文が1文だけであること（案内を伸ばさないこと）を見る */
  assert.match(f, /追加をおすすめします/);
  assert.doesNotMatch(f, /保護者の端末に設定していれば/,
    '説明を足し戻すときは利用者へ確認すること');
  assert.doesNotMatch(f, /adultSectionHelpAttr\(/,
    '一時的な案内を i マークの説明ダイアログへ入れないこと');
  assert.doesNotMatch(f, /<div class="sec-head"/,
    '常設項目のような見出し帯を付けないこと');
  assert.match(f, /<aside class="paper home-install-notice">/,
    '「保護者の方へ」と同じ枠だけの案内にすること');
  assert.match(STYLE, /@media \(min-width:561px\)\{\s*\.home-install-actions\{[^}]*margin-inline-start:auto/,
    '幅広の画面ではボタンを右へそろえること');
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
test('宿題の3つの欄は、同じ骨組みで組む', ()=>{
  const view = grab(APP, 'viewTasks');
  const sec = grab(APP, 'taskSectionHTML');

  /* 欄ごとに手で組むと、また片方だけ揃わなくなる。型は1つ */
  assert.equal((view.match(/taskSectionHTML\(\{/g) || []).length, 3,
    '3つの欄はすべて taskSectionHTML で組むこと');
  assert.doesNotMatch(view, /class="paper task-editor"/,
    '欄ごとに紙を手で組まないこと');

  /* 追加ボタンは 紙の中の 末尾。どの欄に足されるかを 居場所で示す */
  const order = ['adultSectionHelpAttr(o.note)', 'o.head', 'task-editor', 'set-actions'];
  let at = -1;
  for(const part of order){
    const next = sec.indexOf(part);
    assert.ok(next > at, part + ' の位置が違う');
    at = next;
  }
  /* 件数の出しかたも3つで揃える */
  assert.match(sec, /o\.rows\.length\}件/);
  assert.match(view, /note:'子ども画面の「つぎに やる」に出ます。読書の記録も、項目の中の「進め方」で選べます。'/,
    '任意の宿題の説明は表示先と、読書もここで足せることだけを伝えること');
  assert.doesNotMatch(view, /必須の宿題が終わったあとに取り組み/,
    '任意の宿題の説明に削除指定された補足を戻さないこと');
});

test('保護者画面の丸角と選択枠は、狭い画面でも外へはみ出さない', ()=>{
  assert.match(STYLE, /\.parent-book-list\{ overflow:hidden; \}/,
    '本の一覧の背景と区切り線を紙の丸角内に収めること');
  assert.match(STYLE, /\.parent-book-more > summary:focus-visible\{[\s\S]{0,90}outline-offset:-3px/,
    '丸角で切っても本一覧の開閉行のフォーカス枠を見える位置に残すこと');
  assert.match(STYLE, /@media \(max-width:480px\)\{[\s\S]{0,1400}\.book-row\{[\s\S]{0,140}grid-template-columns:auto minmax\(0,1fr\) auto/,
    '狭幅でも番号・書名・操作の3列を保つこと');
  /* 操作を 下段へ 落とすと、44px の 帯と 段の すきまで 1件あたり 52px
     使う。iPhone に 3件しか 入らなかった 原因なので、同じ段へ 戻す。 */
  assert.match(STYLE, /\.book-row > \.book-main\{ grid-column:2; grid-row:1; \}/,
    '書名は番号と操作のあいだの1列に収めること');
  assert.match(STYLE, /\.book-row > \.book-actions\{ grid-column:3; grid-row:1; \}/,
    '狭幅でも操作を書名と同じ段の右へ置き、専用の段を作らないこと');
  /* 詰めてよいのは 余白と 副題の 字だけ。的の 大きさは 触らせない。 */
  const bookNarrow = STYLE.slice(STYLE.indexOf('@media (max-width:480px)', STYLE.indexOf('.book-row{')));
  assert.doesNotMatch(bookNarrow.slice(0, 700), /icon-btn/,
    '本の記録を詰めるときも編集・ごみ箱の的（.icon-btn の44px）に手を入れないこと');
  assert.match(STYLE, /\.icon-btn\{\s*flex:none; width:44px; height:44px;/,
    '編集・ごみ箱の的を44px四方に保つこと');
  assert.match(STYLE, /\.adult-section-toc-disclosure > summary:focus-visible\{[\s\S]{0,100}outline:0; box-shadow:inset 0 0 0 3px var\(--focus\)/,
    '目次の選択枠を外側へ広げないこと');
  assert.match(STYLE, /\.adult-section-help-dialog \.poster-close:focus-visible\{[\s\S]{0,100}outline:0; box-shadow:inset 0 0 0 3px var\(--focus\)/,
    '説明ダイアログの閉じるボタンの選択枠を内側に収めること');
});

test('今日の最後の記録は戻り口を追加しても点線を残さず、予約領域と重ならない', ()=>{
  const toc = grab(APP, 'buildAdultSectionToc');
  assert.match(toc, /const contentLast = surface\.lastElementChild;[\s\S]{0,100}classList\.add\('adult-section-content-last'\)/,
    '戻り口を追加する前の最後の内容を印づけること');
  assert.match(STYLE, /\.today-item:last-child,\.today-item\.adult-section-content-last\{ border-bottom:none; \}/,
    '構造上の最後の記録から点線を消すこと');
  assert.match(STYLE, /\.parent-today-logs \.today-item\.adult-section-content-last\{ padding-bottom:8px; \}/,
    '最後の記録下だけ安全な範囲で余白を縮めること');
  assert.match(STYLE, /\.paper\.adult-section-return-surface\{[\s\S]{0,120}padding-block-end:52px/,
    '複数行の記録でも▲と重ならない予約領域を保つこと');
});

test('共有のオフライン表示は見出し内で簡潔に示す', ()=>{
  const labels = APP.slice(APP.indexOf('const SYNC_LABEL'), APP.indexOf('function syncNeedsSetup'));
  assert.match(labels, /offline:\s*\['',\s+'オフライン'\]/);
  assert.doesNotMatch(APP, /⌛/, 'OS依存の砂時計文字を残さないこと');
  assert.match(APP, /offline:'<svg[^']*stroke="currentColor"[^']*stroke-width="2"/,
    '既存の自作線画と同じ色・線幅のオフラインアイコンを持つこと');
  const html = grab(APP, 'syncStatusHTML');
  assert.match(html, /status !== 'offline'/);
  assert.match(html, /icon\('offline'\)/);
  assert.match(html, /<span>\$\{esc\(label\)\}<\/span>/,
    'ピクトグラムだけでなく読み上げられる状態文字を残すこと');
  assert.doesNotMatch(labels, /この端末にためています/);
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
  const end = APP.indexOf('/* 設定した期間の経過率', start);
  const pace = new Function(APP.slice(start, end) + '; return { verdictOf, paceMessage, paceVerdictSizeClass, paceVisualWidth, PACE_MESSAGES, PACE_MESSAGES_ADULT };')();

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

  /* 大人びた側は、1行に収まらない文を2行で出す（pace-verdict--wrap）。
     3行目が出ると帯の丈が崩れるので、2行ぶんの 26.5 を上限にする。
     ここを見ていなかったため、引継ぎが縛りと書いていた 13.25 が
     大人側では効いていなかった。 */
  Object.values(pace.PACE_MESSAGES_ADULT).flat().forEach(msg=>{
    const width = pace.paceVisualWidth(msg);
    assert.ok(width <= 26.5, '320pxで2行に収まる長さにする: ' + msg);
    const cls = pace.paceVerdictSizeClass(msg);
    if(width > 13.25) assert.equal(cls, ' pace-verdict--wrap',
      '1行に収まらない文は折り返す指定にする: ' + msg);
    else assert.notEqual(cls, ' pace-verdict--wrap',
      '1行で足りる文を折り返しにしない: ' + msg);
  });

  /* ルビの指定は画面では漢字の幅しか取らない。読みの分まで数えると
     短い文が不要に縮む。 */
  assert.equal(pace.paceVisualWidth('{余裕|よゆう}をたもっていこう'), 10,
    'ルビの読みは幅に数えないこと');

  /* UTCの日替わり（日本時間9時）ではなく、端末の0時まで同じ文言を保つ。 */
  const morning = pace.paceMessage('steady', 2, 1, new Date(2026, 7, 11, 0, 1));
  const night = pace.paceMessage('steady', 2, 1, new Date(2026, 7, 11, 23, 59));
  assert.equal(morning, night, '同じ暦日の途中で励まし文を変えない');

  /* 長い案だけ縮め、短い案の大きさは保つ。1行に入りきらない長さからは、
     縮め続けずに折り返す（下限14pxより小さくすると、隣の日づけ13pxや
     下の完了予測12pxより小さくなり、いちばん大事な一言が最も読みにくくなる）。 */
  assert.equal(pace.paceVerdictSizeClass('いいペース！'), '');
  assert.equal(pace.paceVerdictSizeClass('つぎの ひとつへ いこう！'), ' pace-verdict--medium');
  assert.equal(pace.paceVerdictSizeClass('さきに ひとつ かたづけよう！'), ' pace-verdict--long');
  assert.equal(pace.paceVerdictSizeClass('ちいさく すすめば だいじょうぶ！'), ' pace-verdict--wrap');
});

/* 上帯の題名は config.title を そのまま出す。既定は「〈名前〉の夏休みの宿題」
   なので、名前が4文字（「さくらこ」）に なるだけで 320px では 入りきらず、
   無言で 切れていた（実測 17px 超過）。帯を2行に すると 画面が せまく なるので
   （style.css の 帯の項を 参照）、一言と 同じ型で 長い題名だけ 小さくする。 */
test('長い題名は、帯を1行に保ったまま 小さくして 出しきる', ()=>{
  const sizeClass = new Function(`${grab(APP, 'appTitleSizeClass')} return appTitleSizeClass;`)();
  assert.equal(sizeClass('しゅくだいノート'), '', '短い題名の大きさは変えないこと');
  assert.equal(sizeClass('たろうの夏休みの宿題'), '',
    '名前3文字までの既定の題名は、そのままの大きさで入ること');
  assert.equal(sizeClass('さくらこの夏休みの宿題'), ' topband-title--long',
    '名前4文字からは縮めて出しきること');
  assert.equal(sizeClass('はるとくんの夏休みの宿題'), ' topband-title--long');
  /* 下限は14px。日づけ（狭い画面で13px）より小さくなると、見出しに見えない。
     これより長い題名は … で切る（帯を2行にしないための、承知のうえの割り切り） */
  assert.match(STYLE, /\.topband-title--long\{ font-size:clamp\(14px, 4\.4vw, 19px\); \}/);
  /* 一覧の写真のボタンが出ている端末では、帯がその分せまい。
     同じ題名でも切れやすくなるので、2文字ぶん早く小さくする */
  assert.equal(sizeClass('たろうの夏休みの宿題', 2), ' topband-title--long',
    'ボタンが出ているときは、早めに縮めること');
  assert.match(APP, /appTitleSizeClass\(shownTitle, posterShown\(\) \? 2 : 0\)/,
    '関数があるだけでなく、実際に題名へ付けること');
});

/* 設定の宿題名は、種類の印・並べかえ・開閉の印に 場所を とられ、
   欄が 108px（6文字ほど）しか なかった。実際の名前
   （「きゅうりの かんさつカード」など）は ほぼ すべて 途中で 切れていた。
   印を 減らさずに 名前へ 場所を まわすには、名前に 1行 まるごと 使わせるしかない。 */
test('設定の宿題名は、狭い画面では1行まるごと使って切らない', ()=>{
  const at = STYLE.indexOf('@media (max-width:639px){');
  assert.ok(at > 0, '狭い画面の指定があること');
  const block = /@media \(max-width:639px\)\{([\s\S]*?)\n\}/.exec(STYLE)[1];
  assert.match(block, /\.set-task-summary strong\{[^}]*grid-column:1 \/ -1/,
    '名前が横いっぱいを使うこと');
  assert.match(block, /\.set-task-summary strong\{[^}]*white-space:normal/,
    '入りきらないときは切らずに折り返すこと');
  ['\\.set-kind', '\\.set-task-meta', '\\.set-task-move', '\\.set-task-summary::after'].forEach(sel=>{
    assert.match(block, new RegExp(sel + '\\{[^}]*grid-row:2'),
      sel + ' を下の段に送ること（消さずに残す）');
  });
  /* 規則が「在る」ことと「勝つ」ことは別。実際、同じ指定を先に書いたときは
     この @media より あとの 規則に 負けて、テストは通ったまま 実機だけ
     元の並びの ままだった。あとから 1段目へ 戻す 指定が 増えていないか見る。 */
  const after = STYLE.slice(at + block.length);
  ['\\.set-kind', '\\.set-task-move', '\\.set-task-summary::after'].forEach(sel=>{
    assert.doesNotMatch(after, new RegExp(sel + '\\{[^}]*grid-row:1'),
      sel + ' を1段目へ戻す指定が、この指定より あとに 無いこと');
  });
});

test('励まし文と「あと」は狭い画面でも一続きに読める', ()=>{
  assert.match(APP, /<p class="count-lead">\$\{esc\(deadlineWord\(true\)\)\}まで<\/p>/,
    'カウントダウン見出しは表示語の組み立て層を通すこと');
  assert.match(APP, /big \? '<span class="cd-prefix">あと<\/span>' : ''/,
    '「あと」は日数の数字盤に結びつける');
  assert.match(STYLE, /\.cd-unit--big\{ position:relative; \}/);
  assert.match(STYLE, /\.cd\{[\s\S]{0,180}transform:translateX\(6px\)/,
    '「あと」を足した見た目の重心を右へ戻す');
  assert.match(STYLE, /\.cd-prefix\{[\s\S]*inset-inline-end:calc\(100% \+ 6px\)[\s\S]*white-space:nowrap/);
  assert.match(STYLE, /\.pace-verdict\{[\s\S]*white-space:nowrap[\s\S]*padding:12px 6px/);
  assert.match(STYLE, /\.pace-verdict--medium\{ font-size:clamp\(16px, 4\.4vw, 19px\); \}/);
  assert.match(STYLE, /\.pace-verdict--long\{ font-size:clamp\(14px, 3\.9vw, 17px\); \}/);
});

/* 漢字は同じ幅でも画数が多く詰まって見えるので、行間・内側余白・字間で
   息を入れる。文字サイズは下げない（大人側の文は低学年より短く、はみ出しは
   起きていない）。white-space:nowrap と overflow:hidden の組み合わせは、
   幅の見積もりが外れると文を無言で切り落とすので、省略記号で気づけるようにする。 */
test('進み具合の一言は、行間と余白で読みやすくし、切れたときは省略記号で示す', ()=>{
  const block = /\.pace-verdict\{([\s\S]*?)\}/.exec(STYLE)[1];
  assert.match(block, /line-height:1\.45/, '画数の多い漢字が詰まらないよう行間を広げること');
  assert.match(block, /padding:12px 6px/, '窮屈さをやわらげる余白にすること');
  assert.match(block, /letter-spacing:\.01em/, '字間をわずかに空けること');
  assert.match(block, /text-overflow:ellipsis/, '切り落とされた一言に気づけるようにすること');
  assert.doesNotMatch(block, /font-size:(?!21px)/, '文字サイズそのものは下げないこと');
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

/* 全部終わったあと、子ども画面は「いつ終わったか」を出す。日づけだけだと
   その日のうちに何度見ても同じなので、時刻まで添えて記録として読ませる。
   記録がまだ1件も無いときは時刻を作れないので、言い切りに落とす。 */
test('全部終わったときは、最後の記録の日時をそのまま完了時刻として出す', ()=>{
  const mod = new Function('pad2', 'wording', `
    ${grab(APP, 'lastRecordLabel')}
    ${grab(APP, 'forecastText')}
    return { lastRecordLabel, forecastText };
  `)(n=>String(n).padStart(2,'0'), (child, adult)=>adult);

  const label = mod.lastRecordLabel([
    { at: new Date(2026, 7, 3, 9, 5).toISOString() },
    { at: new Date(2026, 7, 17, 14, 30).toISOString() },
    { at: new Date(2026, 7, 12, 20, 0).toISOString() }
  ]);
  assert.equal(label, '8月17日14時30分', 'いちばん新しい記録の日時を採ること');

  const done = { kind:'done' };
  assert.equal(mod.forecastText(done, true, label), '8月17日14時30分に完了！');
  assert.equal(mod.forecastText(done, true, null), '全部終わった！',
    '記録が無いときも文が欠けないこと');
  assert.equal(mod.forecastText(done, false, label), '完了予測　完了',
    '保護者ページの言い方は変えないこと');

  assert.equal(mod.lastRecordLabel([]), null);
  assert.equal(mod.lastRecordLabel([{ at:'こわれた値' }]), null,
    '日時として読めない記録で落ちないこと');
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
  assert.match(messageEditor, /adultSectionHelpAttr\([\s\S]{0,220}同じ名前で送ると前の文を更新します。/);
  assert.doesNotMatch(messageEditor, /parent-message-help/,
    'メッセージ欄の説明を紙の中に重ねない');
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
  /* 見出しと本体を別の span に分け、折り返し位置をコロンの後に限る。
     日付（「9月7日」）は本体側の span に入れて途中で割らせない。
     学年で言い方を切りかえても、この2分割は保つこと。 */
  assert.match(APP, /<span>\$\{wording\('かんりょうよそく：', '完了よそく：'\)\}<\/span><span>\$\{\s*\n?\s*wording\('いまのペースだと', '今のペースだと'\)\}\$\{esc\(forecast\.label\)\}<\/span>/,
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
    'assets/style.css': '20260824i',
    'tokens.css': '20260813a',
    'assets/kanji.js': '20260813a',
    'assets/data.js': '20260817f',
    'assets/app.js': '20260824g',
    'assets/sync.js': '20260822a',
    'assets/photos.js': '20260821a'
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

test('公開版番号v1.12.0をアプリ・HTML・package・変更履歴でそろえる', ()=>{
  assert.match(APP, /const RELEASE_VERSION = '1\.12\.0';/);
  assert.match(INDEX, /<meta name="application-version" content="1\.12\.0">/);
  assert.equal(PACKAGE.version, '1.12.0');
  assert.equal(PACKAGE_LOCK.version, '1.12.0');
  assert.equal(PACKAGE_LOCK.packages[''].version, '1.12.0');
  /* 「バージョン番号の見方」は最小限にとどめ、版ごとに書きかえる例は置かない。
     置くと、公開のたびに直す場所が1つ増えるわりに、読む人の役には立たない。 */
  assert.doesNotMatch(UPDATES, /<b>v1\.\d+\.\d+<\/b> の3つの数字は/,
    '凡例に今の版の番号を書かないこと');
  /* 各版の中身は項目名だけを公開する（詳細は手元の控えに残す）。
     ここでは「その版の行があること」だけを確かめ、本文の言い回しは縛らない。 */
  ['1.12.0', '1.11.0', '1.10.0', '1.9.0', '1.8.0', '1.7.0', '1.6.7', '1.6.6', '1.6.5', '1.6.4', '1.6.3', '1.6.2', '1.6.1', '1.6.0', '1.5.4', '1.5.3', '1.5.2', '1.5.1', '1.5.0', '1.4.5', '1.4.4', '1.4.3', '1.4.2', '1.4.1', '1.4.0', '1.3.33', '1.3.32', '1.3.31', '1.3.30', '1.3.29', '1.3.28', '1.3.27', '1.3.26', '1.3.24', '1.3.23', '1.3.22', '1.3.21', '1.3.20', '1.3.19', '1.3.18', '1.3.0', '1.2.0', '1.1.0', '1.0.0']
    .forEach(v=>{
      assert.match(UPDATES, new RegExp('v' + v.replace(/\./g, '\.') + '：'),
        'v' + v + ' の行を履歴から落とさないこと');
    });
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

/* 公開履歴に載せるのは項目名だけ。理由や経緯まで公開ページへ書くと、読む量が
   増えるうえ、あとから訂正が必要な記述も増える。詳細は local/changelog-detail.md
   （.gitignore 済み）に残す。 */
/* 公開履歴はアプリの変更だけを載せる。使い方・紹介ページの手直しは、アプリの
   動きが変わったわけではないので、利用者の一覧には出さない（版の行ごと出さない
   ことも、行の中のその部分だけ落とすこともある）。 */
test('公開履歴に案内ページだけの手直しを書かない', ()=>{
  const list = /<h2 id="release-title">[\s\S]*?<dl class="history-list">([\s\S]*?)<\/dl>/.exec(UPDATES);
  assert.ok(list, '公開履歴の一覧が読み取れること');
  [...list[1].matchAll(/<dt>(.*?)<\/dt><dd>(.*?)<\/dd>/g)].forEach(([, dt, dd])=>{
    assert.doesNotMatch(dd, /使い方ページ|紹介ページ|案内ページ/,
      dt + ' … ページの手直しは公開履歴に載せないこと');
  });
});

test('公開履歴の各項目は、項目名だけで詳細を公開しない', ()=>{
  const list = /<h2 id="release-title">[\s\S]*?<dl class="history-list">([\s\S]*?)<\/dl>/.exec(UPDATES);
  assert.ok(list, '公開履歴の一覧が読み取れること');
  const rows = [...list[1].matchAll(/<dt>(.*?)<\/dt><dd>(.*?)<\/dd>/g)];
  assert.ok(rows.length >= 20, '公開済みの版をすべて並べること');
  rows.forEach(([, dt, dd])=>{
    assert.ok(dd.length <= 40, dt + ' は「〇〇を修正」の形にすること（' + dd.length + '字）');
    assert.doesNotMatch(dd, /。/, dt + ' に説明文を書かないこと。複数あるときは ／ で並べる');
  });
  /* 公開以前の一覧も同じ書き方でそろえる */
  [...UPDATES.matchAll(/<dl class="history-list history-list--internal">([\s\S]*?)<\/dl>/g)]
    .flatMap(m => [...m[1].matchAll(/<dt>(.*?)<\/dt><dd>(.*?)<\/dd>/g)])
    .forEach(([, dt, dd])=>{
      assert.ok(dd.length <= 40, dt + ' も短くそろえること（' + dd.length + '字）');
      assert.doesNotMatch(dd, /。/, dt + ' に句点を置かないこと');
    });
});

test('変更履歴は公開版と内部配信版の事実だけを短く並べる', ()=>{
  assert.match(UPDATES, /2026年8月14日　v1\.3\.1/);
  assert.match(UPDATES, /2026年8月14日　v1\.3\.0/);
  assert.match(UPDATES, /2026年8月13日　v1\.1\.0/);
  assert.match(UPDATES, /2026年8月13日　v1\.0\.0/);
  assert.match(UPDATES, /「大きな互換変更」「機能追加」「修正」/,
    '3桁のバージョン番号の意味は、1文だけ公開ページに残す');
  assert.doesNotMatch(UPDATES, /配信 20\d{6}[a-z]/,
    '凡例に実在の配信番号を書かないこと（配信のたびに古くなる）');
  const legend = /<section aria-labelledby="version-rule-title"[\s\S]*?<\/section>/.exec(UPDATES);
  assert.ok(legend && legend[0].length < 500,
    '凡例は最小限にとどめること（' + (legend ? legend[0].length : 0) + '字）');
  assert.match(UPDATES, /20260812a–l/);
  assert.match(UPDATES, /20260811a–af/);
  assert.match(UPDATES, /20260810a–aw/);
  assert.doesNotMatch(UPDATES, /最優先｜|高｜|大切な訂正|確認してください|今回の対処項目/);
});

test('バックアップは版・日時を持ち、共有中の反映範囲を確認する', ()=>{
  const exported = grab(APP, 'exportData');
  const imported = grab(APP, 'importBackup');
  assert.match(grab(APP, 'importData'), /importBackup\(o\)/);
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
  assert.match(SYNC, /addEventListener\('online', resumeSync\)/);
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
  assert.match(reset, /resetSharedState\(Date\.now\(\)\);/,
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
  /* 「0にもどした」→「減らした」→「答えだけ」→ はんこ の順に見ること。
     順番が入れかわると、0にもどしたのに「できた！」が出るなど、
     したことと言葉が食いちがう。 */
  const order = [
    /\(after\.done \| 0\) === 0 && hadValue\) toast\('0 に もどしました'\)/,
    /else if\(dailyDecreased\) toast\('なおしました'\)/,
    /else if\(answersOnly\) stamp\(/,
    /else stamp\(after\.isDone/
  ].map(re => save.search(re));
  assert.ok(order.every(i => i >= 0), '4つの知らせ方がすべてあること');
  assert.deepEqual(order.slice().sort((a, b)=> a - b), order,
    '0にもどした案内を先に、はんこを最後に置くこと');
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

/* ---------------------------------------------------------
   新しい版を静かに取り込む
   --------------------------------------------------------- */

function makeAdoptHarness(overrides){
  const state = Object.assign({
    hrefReplace: null,
    locals: {},
    sheetWrapHidden: true,
    hasSheetWrap: true,
    tab: 'home'
  }, overrides || {});
  const fn = new Function('location', 'getLocal', 'setLocal', '$', 'tab', 'cacheBustURL',
    'K_UPDATE_RELOADED_FOR', `
    ${grab(APP, 'adoptNewVersionIfSafe')}
    return adoptNewVersionIfSafe;
  `)(
    {
      href: 'https://example.test/app/index.html',
      replace: (url)=>{ state.hrefReplace = url; }
    },
    (k)=> state.locals[k] || '',
    (k, v)=> { state.locals[k] = v; },
    (sel)=> (sel === '#sheetWrap' && state.hasSheetWrap) ? { hidden: state.sheetWrapHidden } : null,
    state.tab,
    appFns.cacheBustURL,
    'natsu.update.reloaded.v1'
  );
  return { adopt: fn, state };
}

test('取得した本文から application-version の値を読み取れる', ()=>{
  const parse = new Function(`${grab(APP, 'parseVersionFromIndexHTML')} return parseVersionFromIndexHTML;`)();
  const html = '<!doctype html><html><head><meta charset="utf-8">\n' +
    '<meta name="application-version" content="9.9.9"></head><body></body></html>';
  assert.equal(parse(html), '9.9.9');
  assert.equal(parse('<html><head></head></html>'), '',
    'タグが無ければ空を返すこと（見つからないのに古い版のまま読み直すと事故になる）');
});

test('記録シートを開いている間は、新しい版が見つかっても読み直さない', ()=>{
  const { adopt, state } = makeAdoptHarness({ sheetWrapHidden: false });
  adopt('9.9.9');
  assert.equal(state.hrefReplace, null, 'シートを開いている間は割り込まないこと');
  assert.equal(state.locals['natsu.update.reloaded.v1'], undefined,
    '読み直さなかった版を「読み直しずみ」として記録しないこと');
});

test('初期設定（welcome）を出している間は読み直さない', ()=>{
  const { adopt, state } = makeAdoptHarness({ tab: 'welcome', sheetWrapHidden: true });
  adopt('9.9.9');
  assert.equal(state.hrefReplace, null);
});

/* 確認は起動した直後に走る。経過時間で止めると、いちばん大事な継ぎ目
   （アプリを開いたとき）で一度も取り込めず、毎日開き直す使い方では
   永久に古いままになる。連鎖は「同じ版へは二度読み直さない」記録で止める。 */
test('起動した直後でも、安全なら新しい版を取り込む', ()=>{
  const { adopt, state } = makeAdoptHarness();
  adopt('9.9.9');
  assert.match(String(state.hrefReplace), /r=\d+/,
    '開いた直後の継ぎ目でこそ静かに読み直すこと');
  assert.doesNotMatch(grab(APP, 'adoptNewVersionIfSafe'), /APP_BOOT_AT/,
    '起動からの経過時間で取り込みを止めないこと');
});

test('同じ版へは二度読み直さない歯止めがある', ()=>{
  const { adopt, state } = makeAdoptHarness({
    locals: { 'natsu.update.reloaded.v1': '9.9.9' }
  });
  adopt('9.9.9');
  assert.equal(state.hrefReplace, null, '同じ版で二度読み直さないこと');
});

test('条件がそろえば静かに読み直し、読み直す前に版を記録する', ()=>{
  const { adopt, state } = makeAdoptHarness({});
  adopt('9.9.9');
  assert.equal(state.locals['natsu.update.reloaded.v1'], '9.9.9',
    '読み直す前に記録しておくこと（さもないと同じ版への読み直しが続く）');
  assert.match(state.hrefReplace, /[?&]r=\d+/,
    'cacheBustURLで印を付け直したURLへ読み直すこと');
});

test('取得した版が追いついていたら、読み直しずみの記録を消す', ()=>{
  const removed = [];
  let renderCalled = false;
  const apply = new Function('RELEASE_VERSION', 'newVersionAvailable', 'tab', 'render',
    'adoptNewVersionIfSafe', 'K_UPDATE_RELOADED_FOR', 'localStorage', `
    ${grab(APP, 'applyVersionCheck')}
    return applyVersionCheck;
  `)(
    '1.3.17', false, 'config',
    ()=>{ renderCalled = true; },
    ()=>{ throw new Error('追いついているので取り込み処理を呼んではいけない'); },
    'natsu.update.reloaded.v1',
    { removeItem: (k)=> removed.push(k) }
  );
  apply('1.3.17');
  assert.deepEqual(removed, ['natsu.update.reloaded.v1'],
    '次に別の新しい版が出たとき「読み直しずみ」と誤解しないよう、ここで消すこと');
  assert.equal(renderCalled, false,
    '追いついているだけなら保護者ページを描き直す理由がないこと');
});

test('新しい版の取り込みは、問いかけや確認ダイアログを足さない', ()=>{
  const block = [
    grab(APP, 'parseVersionFromIndexHTML'),
    grab(APP, 'checkForNewVersion'),
    grab(APP, 'applyVersionCheck'),
    grab(APP, 'adoptNewVersionIfSafe')
  ].join('\n');
  assert.doesNotMatch(block, /confirm\(/,
    '取り込むかどうかを利用者に選ばせないこと');
  assert.doesNotMatch(block, /更新しますか|よろしいですか|あとで|キャンセル/,
    '問いかけの言葉を足さないこと');
});

test('版の出どころは index.html だけで、専用の別ファイルを取りに行かない', ()=>{
  const check = grab(APP, 'checkForNewVersion');
  assert.doesNotMatch(check, /version\.json|manifest\.webmanifest|fetch\((?!cacheBustURL\('index\.html')/,
    'index.html 以外を確認先にしないこと');
  assert.match(check, /fetch\(cacheBustURL\('index\.html'/,
    '確認先は index.html であること');
});

test('通信できないときは何もしない（オフラインはふつうのこと）', ()=>{
  assert.match(grab(APP, 'checkForNewVersion'), /\.catch\(\(\)=>\{\}\)/,
    'fetch が失敗してもエラーを出さないこと');
  assert.match(grab(APP, 'checkForNewVersion'),
    /fetch\(cacheBustURL\('index\.html', Date\.now\(\)\), \{ cache:'no-store' \}\)/,
    '既存の cacheBustURL を使い、no-store で本物の index.html を取りに行くこと');
});

test('起動時は描画を妨げずに版を確認し、タブ復帰時は30分に一度だけ確認する', ()=>{
  /* あいだに noticeAdopted()（取り込み直後の知らせ）が入る。どちらも
     描画のあとで、確認そのものは待たせない、という意図は変わらない。 */
  assert.match(APP, /render\(\);\s*\n(?:noticeAdopted\(\);[^\n]*\n)?checkForNewVersion\(\);/,
    '起動直後の render() を待たせずに確認を走らせること');
  assert.match(APP,
    /document\.addEventListener\('visibilitychange', \(\)=>\{[\s\S]{0,120}if\(document\.hidden\) return;[\s\S]{0,160}30 \* 60 \* 1000\) checkForNewVersion\(\);/,
    '前面に戻ったときは、前回の確認から30分以上あいているときだけ確認すること');
});

test('保護者ページの「アプリの情報」にだけ、見つけた新しい版を事実として伝える', ()=>{
  const cfg = grab(APP, 'viewConfig');
  assert.match(cfg, /newVersionAvailable \? `<p class="set-note" id="appUpdateNote">あたらしい版が あります<\/p>` : ''/,
    '見つかっているときだけ更新の事実を一言そえること');
  assert.doesNotMatch(grab(APP, 'viewParent'), /newVersionAvailable/,
    '保護者トップには出さないこと（アプリ情報の中だけに置く）');
  assert.doesNotMatch(grab(APP, 'viewTasks'), /newVersionAvailable/);
});

test('子ども画面には、新しい版の知らせを一切出さない', ()=>{
  for(const name of ['viewWelcome', 'viewHome', 'viewLog', 'viewCalendar', 'viewBooks', 'viewWrites', 'viewStats']){
    const src = grab(APP, name);
    assert.doesNotMatch(src, /newVersionAvailable/, name + ' に更新の知らせを混ぜないこと');
    assert.doesNotMatch(src, /あたらしい版/, name + ' に更新の知らせを混ぜないこと');
  }
});

/* ---------------------------------------------------------
   「宿題を決める」編集画面の 変更の手ごたえ・取り消し

   .set-task の 各欄を 変えたときだけ「変更しました」と「元に戻す」を
   出す。平常時（何も変えていない）画面には 何も足さない。
   --------------------------------------------------------- */
function makeTaskEditorRowHarness(){
  // esc() は正規表現リテラル /'/g の中に クォートを1つだけ持つため、
  // grab() の 素朴な 引用符あつかいでは 閉じ位置を 見失う。中身は
  // ただの HTML エスケープなので、ここだけ 手で 同じものを 用意する
  const esc = `function esc(s){
    return String(s == null ? '' : s)
      .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
      .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
  }`;
  return new Function('configTaskBase', 'openConfigTaskId', 'configTaskNewId', `
    ${grabConst(APP, 'APP_ICONS')}
    ${grab(APP, 'icon')}
    ${esc}
    ${grabConst(APP, 'ADULT_UNIT')}
    ${grab(APP, 'unitAdult')}
    ${grab(APP, 'isBook')}
    ${grab(APP, 'isFree')}
    ${grabConst(APP, 'FREE_HINT_DEFAULT')}
    ${grab(APP, 'bookFields')}
    ${grab(APP, 'taskKind')}
    ${grabConst(APP, 'DAILY_UNIT_PRESETS')}
    ${grab(APP, 'dailyUnitPreset')}
    ${grabConst(APP, 'TASK_FIELD_KEYS')}
    ${grab(APP, 'wrapMarkerBy')}
    ${grab(APP, 'taskSummary')}
    ${grab(APP, 'taskEditorRow')}
    return taskEditorRow;
  `);
}

test('変更していない欄には「元に戻す」を出さず、変更した欄にだけ出す', ()=>{
  const base = {
    id:'t1', group:'must', type:'count', name:'かん字れんしゅう',
    total:10, unit:'ばん', numbered:true, wrapUp:false, memoLabel:'', questions:[]
  };
  const changed = Object.assign({}, base, { total:20 });
  const taskEditorRow = makeTaskEditorRowHarness()({ id:'t1', snap:base }, 't1');
  const html = taskEditorRow(changed, 0);

  assert.match(html, /合計\s*<em class="set-changed" aria-label="変更しました">✓<\/em><button class="set-revert" data-revert="total" type="button">元に戻す<\/button>/,
    '変えた「合計」欄には、文字ではなく✓と「元に戻す」を出すこと');
  assert.equal((html.match(/data-revert="/g) || []).length, 1,
    '変えていない欄には出さないので、ボタンは1つだけのこと');
  assert.doesNotMatch(html, /data-revert="name"/, '変えていない「項目の名前」には出さないこと');
  assert.doesNotMatch(html, /data-revert="unit"/, '変えていない「単位」には出さないこと');
  assert.doesNotMatch(html, /data-revert="numbered"/, '変えていない「番号」には出さないこと');
});

test('基準（configTaskBase）が無い課題には、何も変えていなくても印を出さない', ()=>{
  const t = { id:'t1', group:'must', type:'count', name:'かん字れんしゅう', total:10, unit:'ばん' };
  const taskEditorRow = makeTaskEditorRowHarness()(null, null);
  const html = taskEditorRow(t, 0);
  assert.doesNotMatch(html, /set-changed/, '基準が無ければ 比べようが無いので 何も出さないこと');
  assert.doesNotMatch(html, /data-revert=/);
});

test('本の課題では、著者などのチェックが変わると凡例に1つだけ印を出す', ()=>{
  const base = { id:'b1', group:'must', type:'count', recordStyle:'book', name:'どくしょ', total:5, bookFields:{ author:false, publisher:false, rating:true } };
  const changed = Object.assign({}, base, { bookFields:{ author:true, publisher:false, rating:true } });
  const taskEditorRow = makeTaskEditorRowHarness()({ id:'b1', snap:base }, 'b1');
  const html = taskEditorRow(changed, 0);
  assert.match(html, /本ごとに残す項目\s*<em class="set-changed" aria-label="変更しました">✓<\/em>/, '凡例に1つ出すこと');
  assert.equal((html.match(/data-revert="bookFields"/g) || []).length, 1,
    'チェックは3つあっても、まとめて1つの印にすること');
});

/* recordStyle を変えると bookFields も連動して決まる欄なので、戻すときも
   まとめて戻す。中途半端な状態（片方だけ戻る）を 残さないため。
   click 委譲の中の 生の処理を そのまま 取り出して 動かし、本物のコードで
   確かめる（書き写すと 実装とずれたまま テストが 通ってしまうため） */
test('recordStyleを元に戻すとbookFieldsもまとめて元に戻る', ()=>{
  const bind = grab(APP, 'bindConfig');
  const startMarker = 'TASK_FIELD_KEYS[rv.dataset.revert].forEach(k=>{';
  const start = bind.indexOf(startMarker);
  assert.ok(start >= 0, '取り消しの復元処理が見つかること');
  const end = bind.indexOf('});', start) + 3;
  const restoreSnippet = bind.slice(start, end);

  const taskFieldKeysFn = new Function(`${grabConst(APP, 'TASK_FIELD_KEYS')} return TASK_FIELD_KEYS;`);
  const TASK_FIELD_KEYS = taskFieldKeysFn();
  assert.deepEqual(TASK_FIELD_KEYS.recordStyle, ['recordStyle', 'bookFields'],
    'recordStyle 欄は recordStyle と bookFields の両方を持つこと');

  const deepCopyFn = new Function(`${grab(APP, 'deepCopy')} return deepCopy;`)();
  const restore = new Function('TASK_FIELD_KEYS', 'rv', 't', 'snap', 'deepCopy', restoreSnippet);

  // 「文章で記録」に変えたあと（recordStyle・bookFields とも 元と ちがう）に、元に戻す
  const snap = { id:'d1', target:1, targetUnit:'かい', memoLabel:'' }; // recordStyle も bookFields も 持たない
  const t = { id:'d1', recordStyle:'free', target:1, targetUnit:'かい', memoLabel:'きょうは なにを した？', bookFields:{ author:true, publisher:false, rating:true } };
  restore(TASK_FIELD_KEYS, { dataset:{ revert:'recordStyle' } }, t, snap, deepCopyFn);

  assert.equal('recordStyle' in t, false, 'recordStyle を 持たない状態に 戻ること');
  assert.equal('bookFields' in t, false, '連動していた bookFields も まとめて 戻ること');
});

test('基準は最初の変更の直前に控え、行を開いた（toggle）ときには控えない', ()=>{
  const bind = grab(APP, 'bindConfig');
  const toggleHandler = bind.slice(bind.indexOf("addEventListener('toggle'"), bind.indexOf("}, true);") + 9);
  assert.doesNotMatch(toggleHandler, /configTaskBase\s*=/,
    'toggle では 基準を 控えないこと（render() の open 復元では 発火しないため 取りこぼす）');

  const changeHandler = bind.slice(bind.indexOf("addEventListener('change'"), bind.indexOf("ed.addEventListener('click'"));
  assert.match(changeHandler, /if\(!configTaskBase \|\| configTaskBase\.id !== t\.id\) configTaskBase = \{ id: t\.id, snap: deepCopy\(t\) \};/,
    'change の中で 基準を 控えること（deepCopy を使うこと）');
  // 控える行が、値を書きかえる どの分岐よりも 先に あること
  const captureIdx = changeHandler.indexOf('configTaskBase = { id: t.id, snap: deepCopy(t) }');
  const firstWriteIdx = changeHandler.indexOf('t.bookFields = Object.assign');
  assert.ok(captureIdx >= 0 && firstWriteIdx > captureIdx,
    '変更を適用する前に 控えること（あとに 控えると 変えたあとの姿を 控えてしまう）');
});

test('行を閉じたときに変えた箇所の数を知らせ、変更が無ければ何も出さない', ()=>{
  function makeNoticeHarness(onToast){
    return new Function('toast', 'configTaskNewId', `
      let configTaskBase = null;
      ${grab(APP, 'isBook')}
      ${grab(APP, 'isFree')}
      ${grab(APP, 'taskKind')}
      ${grabConst(APP, 'DAILY_UNIT_PRESETS')}
      ${grab(APP, 'dailyUnitPreset')}
      ${grabConst(APP, 'TASK_FIELD_KEYS')}
      ${grab(APP, 'taskEditorFieldNames')}
      ${grab(APP, 'changedTaskFieldNames')}
      ${grab(APP, 'noticeTaskRowClosed')}
      return function(base, t){
        configTaskBase = base;
        noticeTaskRowClosed(t);
        return configTaskBase;
      };
    `)(onToast, null);
  }

  // 1) 合計だけ 変えて 閉じる → 1か所
  {
    const calls = [];
    const run = makeNoticeHarness(msg=>calls.push(msg));
    const base = { id:'t1', group:'must', type:'count', total:10, unit:'ばん', wrapUp:false, name:'x', memoLabel:'', questions:[] };
    const t = Object.assign({}, base, { total:20 });
    const remain = run({ id:'t1', snap:base }, t);
    assert.deepEqual(calls, ['1か所 変更しました']);
    assert.equal(remain, null, '知らせたあとは 基準を 手放すこと');
  }

  // 2) recordStyle と bookFields が 両方ちがっても 1か所
  {
    const calls = [];
    const run = makeNoticeHarness(msg=>calls.push(msg));
    const base = { id:'d1', group:'daily', type:'daily', recordStyle:'', target:1, targetUnit:'かい', memoLabel:'' };
    const t = Object.assign({}, base, { recordStyle:'free', bookFields:{ author:true } });
    const remain = run({ id:'d1', snap:base }, t);
    assert.deepEqual(calls, ['1か所 変更しました'],
      'recordStyle と bookFields が両方ちがっても、画面の欄としては1か所と数えること');
    assert.equal(remain, null);
  }

  // 3) 何も変えずに 閉じる → 何も出さない、基準もそのまま
  {
    const calls = [];
    const run = makeNoticeHarness(msg=>calls.push(msg));
    const base = { id:'t1', group:'must', type:'count', total:10, unit:'ばん', wrapUp:false, name:'x', memoLabel:'', questions:[] };
    const t = Object.assign({}, base);
    const remain = run({ id:'t1', snap:base }, t);
    assert.deepEqual(calls, [], '変更が無ければ 知らせないこと');
    assert.notEqual(remain, null, '変更が無ければ 基準は 手放さなくてよいこと');
  }
});

test('取り消しの仕組みは確認ダイアログを足さない', ()=>{
  assert.doesNotMatch(grab(APP, 'taskEditorRow'), /confirm\(/);
  assert.doesNotMatch(grab(APP, 'noticeTaskRowClosed'), /confirm\(/);
  const bind = grab(APP, 'bindConfig');
  const revertBlock = bind.slice(bind.indexOf('[data-revert]'), bind.indexOf('function addNormalTask'));
  assert.doesNotMatch(revertBlock, /confirm\(/,
    '取り消しは事実を言い切るだけにし、確認は挟まないこと');
});

test('「元に戻す」ボタンは44pxのタップ領域を持つ', ()=>{
  assert.match(STYLE, /\.set-revert\{[\s\S]{0,220}min-height:44px/,
    'ほかの押せるボタンと同じ44pxの当たり判定を確保すること');
});

test('アプリの設定でも、開いた時点から変えた値の欄だけを元に戻せる', ()=>{
  const cfg = grab(APP, 'viewConfig');
  const bind = grab(APP, 'bindConfig');

  assert.match(APP, /const CONFIG_FIELD_KEYS = \{[\s\S]*childName:\['childName'\][\s\S]*readingGrade:\['readingGrade'\][\s\S]*theme:\['theme'\][\s\S]*title:\['title'\][\s\S]*startAt:\['startAt'\][\s\S]*endAt:\['endAt'\]/,
    '対象となる値を持つ設定欄を、比較対象としてひとまとめにすること');
  assert.match(cfg, /if\(!configBase\) configBase = deepCopy\(config\);/,
    'ページを開いた時点の設定を、描き直しをまたいで控えること');
  for(const name of ['childName', 'readingGrade', 'theme', 'title', 'startAt', 'endAt']){
    assert.match(cfg, new RegExp("mark\\('" + name + "'\\)"), name + ' の見出しにだけ変更印を置けること');
  }
  assert.match(cfg, /class="set-changed" aria-label="変更しました">✓<\/em><button class="set-revert" data-config-revert=/,
    '宿題ページと同じ✓・元に戻すの部品を使うこと');
  assert.match(bind, /\$\$\('\[data-config-revert\]'\)[\s\S]{0,900}saveCfg\(\);[\s\S]{0,120}render\(\{ keepScroll:true, discardFormDraft:true \}\);/,
    '元に戻すも通常の保存経路を通し、古い入力欄の表示で復元値を上書きしないこと');
  assert.match(grab(APP, 'render'), /opts && opts\.discardFormDraft \? \{\} : captureFormDraft\(\)/,
    '復元時だけ入力途中の控えを使わず、設定値から表示し直すこと');
  assert.match(grab(APP, 'render'), /if\(tab !== 'config'\) configBase = null;/,
    '別ページへ出た後は次に開いた時点を新しい戻り先にすること');
});

/* 作ったばかりの課題では、名前を入れるのは「変更」ではなく初めて書くこと。
   戻り先が既定の名前（あたらしい しゅくだい）では意味がないので印を出さない。 */
test('作ったばかりの宿題には、まだ✓と「元に戻す」を出さない', ()=>{
  const base = { id:'t1', group:'must', type:'count', name:'あたらしい しゅくだい',
    total:10, unit:'かい', numbered:false, wrapUp:false, memoLabel:'', questions:[] };
  const named = Object.assign({}, base, { name:'かん字ドリル' });
  const asNew = makeTaskEditorRowHarness()({ id:'t1', snap:base }, 't1', 't1');
  assert.doesNotMatch(asNew(named, 0), /data-revert=/,
    '作った直後の入力は「変更」ではないので印を出さないこと');
  const settled = makeTaskEditorRowHarness()({ id:'t1', snap:base }, 't1', null);
  assert.match(settled(named, 0), /data-revert="name"/,
    '一度閉じて区切りがついたあとは、ふつうに戻せること');
});

test('宿題を足したときは、名前の欄から始められるようにする', ()=>{
  const add = grab(APP, 'startNewTask');
  assert.match(add, /configTaskNewId = added\.id;/,
    '足した課題を「作ったばかり」として覚えること');
  assert.match(add, /\[data-f="name"\][\s\S]{0,80}focus\(\)/,
    '名前の欄へカーソルを置き、最初の操作が名づけになること');
  assert.match(grab(APP, 'noticeTaskRowClosed'), /toast\('宿題を追加しました'\)/,
    '閉じたときは数ではなく、足したという事実を知らせること');
  assert.match(APP, /on\('#addDailyTask'[\s\S]{0,220}startNewTask\(added\)/,
    '毎日の項目も同じ入り口を通ること');
});

/* --- 読める漢字：小6までの拡張 ---------------------------------------------
   以前は 0（すべてひらがな）・1・2・9（漢字のまま）だけしか選べなかった。
   kanji.js 側は もともと 小1〜小6を 判定できるので、app.js の
   選択肢・許可リスト・出し分けを 実際の学年に そろえる。 */

test('「読める漢字」は すべてひらがな・小1〜小6・漢字のまま を この順で選べる', ()=>{
  const harness = new Function(`
    ${grabConst(APP, 'READING_GRADE_OPTIONS')}
    ${grab(APP, 'readingOptions')}
    return { READING_GRADE_OPTIONS, readingOptions };
  `)();
  assert.deepEqual(harness.READING_GRADE_OPTIONS, [0,1,2,3,4,5,6,9],
    '0→1→2→3→4→5→6→9 の順で並ぶこと');
  const html = harness.readingOptions(4);
  [
    ['0', 'すべてひらがな'], ['1', '小学1年生まで'], ['2', '小学2年生まで'],
    ['3', '小学3年生まで'], ['4', '小学4年生まで'], ['5', '小学5年生まで'],
    ['6', '小学6年生まで'], ['9', '漢字のまま']
  ].forEach(([value, label])=>{
    assert.match(html, new RegExp('<option value="' + value + '"[^>]*>' + label + '</option>'),
      value + ' の選択肢が「' + label + '」で出ること');
  });
  assert.match(html, /<option value="4" selected>/, '選んでいる学年に selected を付けること');
});

test('app.js が選べる学年は、kanji.js が実際に受け入れる学年と食い違わない', ()=>{
  const k = loadKanji();
  const options = new Function(`${grabConst(APP, 'READING_GRADE_OPTIONS')} return READING_GRADE_OPTIONS;`)();
  /* 許可リストの どの値も、kanji.js 側でも そのまま通ること */
  options.forEach(g=>{
    k.setReadingGrade(g);
    assert.equal(k.getReadingGrade(), g, g + ' が kanji.js 側でも そのまま通ること');
  });
  /* 許可リストに無い値は、kanji.js 側でも 通らない（=範囲がそろっている） */
  [7, 8].forEach(g=>{
    k.setReadingGrade(g);
    assert.equal(k.getReadingGrade(), 2, g + ' は どちらでも 通らないこと');
  });
});

test('読める漢字の許可リストは1か所にまとまり、[0,1,2,9] の直書きが残っていない', ()=>{
  assert.doesNotMatch(APP, /\[0,1,2,9\]/,
    '直書きの許可リストを、共通の READING_GRADE_OPTIONS に一本化すること');
});

/* 選択肢そのものを見るテストは上にあるが、案内ページの説明を見るテストが
   無かった。小6までの拡張では、選択肢だけ増えて start/ の説明が
   「1年生まで／2年生まで」のまま取り残された。実装と文章の両方を
   別々に見ていても、突き合わせが無ければ ズレは見つからない。
   説明は選択肢を1つずつ数え上げず「端から端」で語っているので、
   テストも端の3つ（先頭・学年の上端・最後）を実装から取り出して照合する。 */
function readingOptionLabels(){
  const html = new Function(`
    ${grabConst(APP, 'READING_GRADE_OPTIONS')}
    ${grab(APP, 'readingOptions')}
    return readingOptions(-1);
  `)();
  return [...html.matchAll(/<option value="\d+"[^>]*>([^<]+)<\/option>/g)].map(m=>m[1]);
}

test('案内ページの「読める漢字」の説明は、実際に選べる範囲と食い違わない', ()=>{
  const labels = readingOptionLabels();
  assert.ok(labels.length >= 3,
    '端から端で語るには、少なくとも3つの選択肢が取り出せること');
  const first = labels[0];                      // すべてひらがな
  const topGrade = labels[labels.length - 2];   // 学年の上端（いまは小学6年生まで）
  const last = labels[labels.length - 1];       // 漢字のまま
  const sentence = new RegExp('「' + first + '」から「' + topGrade + '」、それに「' + last + '」');
  [
    ['start/index.html（FAQ「何年生向けですか？」）', DOCS_INDEX],
    ['start/getting-started.html（「名前と、読める漢字」）', GUIDE]
  ].forEach(([where, html])=>{
    assert.match(html, sentence,
      where + ' が、いま選べる範囲を app.js の表示名どおりに語ること');
  });
});

/* 上のテストは端の3つしか見ないので、途中が欠ける変更（例：小3だけ消す）は
   通ってしまう。だが案内文の「〈先頭〉から〈上端〉まで」という言い方は、
   その間が飛んでいないことを暗に約束している。文章を増やして確かめるのではなく、
   文章が成り立つ前提のほうを実装側で押さえる。 */
test('「読める漢字」の学年は、端から端まで飛ばさずに並ぶ', ()=>{
  const options = new Function(`${grabConst(APP, 'READING_GRADE_OPTIONS')} return READING_GRADE_OPTIONS;`)();
  const grades = options.slice(1, -1);  // 先頭（すべてひらがな）と最後（漢字のまま）を除いた学年
  assert.ok(grades.length >= 2, '学年が2つ以上あること');
  grades.forEach((g, i)=>{
    assert.equal(g, grades[0] + i,
      '学年が1つずつ続くこと（' + grades.join('・') + ' は ' + (grades[0] + i) + ' の位置で飛んでいる）。'
      + '途中を消すなら、案内ページの「…から…まで」という言い方も直すこと');
  });
});

function readingGradeHarness(configGrade, legacyGrade){
  return new Function(`
    let config = ${configGrade === undefined ? 'null' : JSON.stringify({ readingGrade: configGrade })};
    const K_READING = 'K_READING';
    function getLocal(){ return ${JSON.stringify(legacyGrade === undefined ? '' : String(legacyGrade))}; }
    ${grabConst(APP, 'READING_GRADE_OPTIONS')}
    ${grab(APP, 'readingGrade')}
    return readingGrade();
  `)();
}

test('保存済みの 0・1・2・9 と、新しく選べる 3〜6 のどちらも、そのまま通る', ()=>{
  [0, 1, 2, 3, 4, 5, 6, 9].forEach(g=>{
    assert.equal(readingGradeHarness(g), g, 'config.readingGrade=' + g);
  });
});

test('config にまだ値が無いグループは、端末に残る値（3〜6を含む）を引きつぎ、知らない値は小2に落とす', ()=>{
  [0, 1, 2, 3, 4, 5, 6, 9].forEach(g=>{
    assert.equal(readingGradeHarness(undefined, g), g, '端末の値=' + g);
  });
  assert.equal(readingGradeHarness(undefined, 8), 2, '知らない値は小2に落とすこと');
});

function normalizeConfigHarness(input, legacyTheme, legacyGrade){
  return new Function(`
    function deepCopy(v){ return JSON.parse(JSON.stringify(v)); }
    const DEFAULT_CONFIG = { tasks:[], theme:'notebook', readingGrade:2 };
    const THEME_IDS = ['notebook','sunny','soda','berry','block','cat'];
    const PARENT_SENDERS = ['おかあさん','おとうさん','その他','名前表示なし'];
    const K_THEME = 'K_THEME', K_READING = 'K_READING';
    function getLocal(k){ return k === K_THEME ? ${JSON.stringify(legacyTheme || '')} : ${JSON.stringify(legacyGrade === undefined ? '' : String(legacyGrade))}; }
    function isGeneratedTitle(){ return false; }
    function defaultTitleFor(name){ return name ? name + 'の夏休みの宿題' : 'しゅくだいノート'; }
    ${grabConst(APP, 'READING_GRADE_OPTIONS')}
    ${grabConst(APP, 'POSTER_MAX')}
    ${grabConst(APP, 'LABEL_DEFAULTS')}
    ${grabConst(APP, 'LABEL_KEYS')}
    ${grabConst(APP, 'LABEL_MAX')}
    ${grab(APP, 'normalizeLabel')}
    ${grab(APP, 'normalizeLabelConfig')}
    ${grab(APP, 'normalizeConfig')}
    return normalizeConfig(${JSON.stringify(input)});
  `)();
}

test('normalizeConfig は 保存済みの 0・1・2・9 と 新しい 3〜6 を どちらも そのまま通す', ()=>{
  [0, 1, 2, 3, 4, 5, 6, 9].forEach(g=>{
    const c = normalizeConfigHarness({ tasks:[], theme:'notebook', readingGrade:g, title:'x', childName:'' });
    assert.equal(c.readingGrade, g, 'readingGrade=' + g);
  });
});

test('normalizeConfig は 未知の値のとき、端末に残る値（3〜6を含む）を引きつぐ', ()=>{
  [3, 4, 5, 6].forEach(g=>{
    const c = normalizeConfigHarness({ tasks:[], theme:'notebook', title:'x', childName:'' }, '', g);
    assert.equal(c.readingGrade, g, '端末の値=' + g);
  });
  const fallback = normalizeConfigHarness({ tasks:[], theme:'notebook', title:'x', childName:'' }, '', 8);
  assert.equal(fallback.readingGrade, 2, '知らない値は小2に落とすこと');
});

const FUN_TEST = new Function(`${grabConst(DATA, 'FUN_ASK_BY_TYPE')} ${grabConst(DATA, 'FUN')} return FUN;`)();

function funAllowedHarness(grade){
  return new Function(`
    let config = { readingGrade: ${grade} };
    const K_READING = 'K_READING';
    function getLocal(){ return ''; }
    ${grabConst(APP, 'READING_GRADE_OPTIONS')}
    ${grab(APP, 'readingGrade')}
    ${grabConst(DATA, 'FUN_ASK_BY_TYPE')}
    ${grabConst(DATA, 'FUN')}
    ${grab(APP, 'funAllowed')}
    return funAllowed;
  `)();
}

test('小3以上を選ぶと lv:3 の読みものも出て、小2以下では出ず、漢字のままでは出る', ()=>{
  const lv3 = FUN_TEST.findIndex(f=> f.lv === 3);
  const lv2 = FUN_TEST.findIndex(f=> f.lv === 2);
  assert.ok(lv3 >= 0 && lv2 >= 0, 'テストの前提として lv:2・lv:3 の項目が両方あること');
  [0, 1, 2].forEach(g=>{
    assert.equal(funAllowedHarness(g)(lv3), false, '小' + g + 'では lv:3 を出さないこと');
    assert.equal(funAllowedHarness(g)(lv2), true, '小' + g + 'でも lv:2 は出すこと');
  });
  [3, 4, 5, 6].forEach(g=>{
    assert.equal(funAllowedHarness(g)(lv3), true, '小' + g + 'では lv:3 も出すこと（以前は9でしか出なかった）');
  });
  assert.equal(funAllowedHarness(9)(lv3), true, '漢字のままでは 引きつづき lv:3 も出すこと');
});

test('参加画面で選んだ小3〜小6の漢字設定も、グループ設定の受信後に反映する', ()=>{
  const storage = new Map([
    ['natsu.savedAt.v1', JSON.stringify({config:100})],
    ['natsu.welcome.join.v1', JSON.stringify({
      hasName:false, childName:'', hasGrade:true, readingGrade:5
    })]
  ]);
  let saved = 0;
  const harness = new Function('localStorage', 'onSave', `
    let config={ tasks:[], theme:'notebook', childName:'', readingGrade:2, title:'しゅくだいノート' }, state={};
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
    ${grabConst(APP, 'READING_GRADE_OPTIONS')}
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
    config:{tasks:[],theme:'notebook',childName:'',readingGrade:2,title:'しゅくだいノート'},
    configAt:200,
    first:true
  });
  assert.equal(harness.config().readingGrade, 5, '小5までの設定も、受信後に反映すること');
  assert.equal(saved, 1, 'グループ設定を採ったあとに変更を1回だけ保存する');
  assert.equal(storage.has('natsu.welcome.join.v1'), false, '反映後は一時値を消す');
});

test('招待の接続確認・参加時の一時保存も、直書きでなく共通の許可リストで学年を確かめる', ()=>{
  const bind = grab(APP, 'bindWelcomeStart');
  assert.match(bind, /READING_GRADE_OPTIONS\.includes\(remoteGrade\)/,
    '接続確認で受け取った学年（3〜6を含む）を、共通の許可リストで確かめること');
  assert.match(bind, /hasGrade: READING_GRADE_OPTIONS\.includes\(grade\) && grade !== baseGrade/,
    '参加時に選んだ学年の一時保存も、同じ許可リストで確かめること');
  assert.doesNotMatch(bind, /\[0,1,2,9\]/,
    'bindWelcomeStart 内に許可リストの直書きが残っていないこと');
});

test('「かんじを しらべる」カードの案内は、固定の「2年生まで」でなく選んだ学年に合わせる', ()=>{
  function label(grade){
    return new Function(`
      let config = { readingGrade: ${grade} };
      const K_READING = 'K_READING';
      function getLocal(){ return ''; }
      ${grabConst(APP, 'READING_GRADE_OPTIONS')}
      ${grab(APP, 'readingGrade')}
      ${grab(APP, 'learnedKanjiLabel')}
      return learnedKanjiLabel();
    `)();
  }
  assert.equal(label(2), '2年生までの', '既定の小2は、これまでと同じ言い方のままにすること');
  assert.equal(label(5), '5年生までの', '小5を選んだときは「5年生までの」と出ること');
  assert.equal(label(9), 'つかえる', '漢字のままは 学年の数で言わないこと');
  assert.equal(label(0), 'ならった', 'すべてひらがなも 学年の数で言わないこと');
  assert.doesNotMatch(APP, /かきうつす文（2年生までの かんじ）/,
    '見出しを 固定の「2年生までの」から、選んだ学年に合わせた言い方に変えること');
});

/* 静かに取り込むと、何が起きたのか分からないまま画面が入れかわる。
   済んだ事実なので問いかけずに、消える知らせで一言だけ残す。 */
test('新しい版を取り込んだ直後は、そのことを一言だけ知らせる', ()=>{
  const fn = grab(APP, 'noticeAdopted');
  assert.match(fn, /getLocal\(K_UPDATE_RELOADED_FOR\) !== RELEASE_VERSION\) return;/,
    '読み直した版といまの版がそろったときだけ知らせること');
  assert.match(fn, /removeItem\(K_UPDATE_RELOADED_FOR\)/,
    '知らせたら印を消し、次に開くたびにくり返さないこと');
  assert.match(fn, /isAdultTab\(tab\)/,
    '子どもの画面と大人の画面で言い方を分けること');
  assert.match(fn, /アプリを最新版（v' \+ RELEASE_VERSION \+ '）に更新しました/,
    '大人の画面には何版になったかを書くこと');
  assert.match(fn, /アプリが あたらしく なったよ/,
    '子どもの画面はかなで、版の番号を出さないこと');
  assert.doesNotMatch(fn, /confirm\(/, '済んだことなので問いかけないこと');
  assert.match(APP, /render\(\);\s*\nnoticeAdopted\(\);/,
    '描画したあとに知らせること');
});

/* 小4以上を選んだ子むけの言い方に、その子がまだ習っていない漢字を混ぜては
   本末転倒になる。語を足すたびに人が確かめるのは続かないので、配当表と
   機械的に突き合わせる。ここが落ちたら、使った語のほうを直すこと。

   ただしスタンプ（「完了！」など）だけは例外を認める。操作に必要な情報
   ではなく、達成の瞬間に一度出る飾りなので、配当外の字でも通す。
   ここに載っていない配当外の字は、これまでどおり検出して落とす。 */
const STAMP_KANJI_EXCEPTIONS = { '了': 'スタンプ「完了！」。中学以上の配当' };

/* {漢字|よみ} と書いた語は、画面ではルビつきで出る（rubyHTML）。読みを
   そえてあるので配当外の字でも読めるため、この検査からは外す。外すのは
   ルビの中だけで、地の文に裸で置かれた配当外の字はこれまでどおり落とす。 */
const RUBY_RE = /\{([^{}|]+)\|([^{}|]+)\}/g;
function stripRuby(s){ return String(s).replace(RUBY_RE, ''); }
function overGradeChars(strings, upTo4){
  const over = [];
  for(const s of strings){
    for(const ch of stripRuby(s)){
      if(/[\u3400-\u9FFF]/.test(ch) && !upTo4.has(ch) && !(ch in STAMP_KANJI_EXCEPTIONS)){
        over.push(ch + '（' + s + '）');
      }
    }
  }
  return over;
}

test('大人びた言い方の漢字は、すべて小4までの配当か理由つきの例外に収まる', ()=>{
  const upTo4 = new Set([].concat(gradeChars(1), gradeChars(2), gradeChars(3), gradeChars(4)));
  const strings = [];
  const table = /const PACE_MESSAGES_ADULT = \{([\s\S]*?)\n\};/.exec(APP);
  assert.ok(table, '大人びた側のペース文の表があること');
  for(const m of table[1].matchAll(/'([^']*)'/g)) strings.push(m[1]);
  const hint = /const FREE_HINT_ADULT = '([^']*)'/.exec(APP);
  assert.ok(hint, '文章で記録の呼びかけにも大人びた側があること');
  strings.push(hint[1]);
  for(const m of APP.matchAll(/wording\('([^']*)',\s*'([^']*)'\)/g)) strings.push(m[2]);

  assert.ok(strings.length >= 40, '切り替える文を集められていること');
  assert.deepEqual(overGradeChars(strings, upTo4), [],
    '小4までに無く、例外にも無い漢字を使わないこと');
});

/* 配当外の字をルビで通せるようにした以上、ルビ自体が正しく組めているかを
   見ておかないと「読めない字にでたらめな読みが付いている」状態を通してしまう。
   ルビは rubyHTML が {漢字|よみ} を組み替えるので、書き方も一緒に縛る。 */
test('大人びた言い方のルビは、かなの読みつきで、配当外の語にだけ振る', ()=>{
  const upTo4 = new Set([].concat(gradeChars(1), gradeChars(2), gradeChars(3), gradeChars(4)));
  const table = /const PACE_MESSAGES_ADULT = \{([\s\S]*?)\n\};/.exec(APP)[1];
  const strings = [...table.matchAll(/'([^']*)'/g)].map(m => m[1]);
  for(const m of APP.matchAll(/wording\('([^']*)',\s*'([^']*)'\)/g)) strings.push(m[2]);

  let found = 0;
  for(const s of strings){
    for(const m of s.matchAll(/\{([^{}|]+)\|([^{}|]+)\}/g)){
      found++;
      const [, base, yomi] = m;
      assert.match(yomi, /^[ぁ-ん]+$/, 'ルビの読みはひらがなだけにする: ' + s);
      assert.ok([...base].some(ch => /[㐀-鿿]/.test(ch) && !upTo4.has(ch)),
        '小4までで読める語にルビを振らない（うるさくなる）: ' + base + '（' + s + '）');
    }
  }
  assert.ok(found >= 3, 'ルビの実例が集められていること');

  /* 組み立て側が {} を残したまま画面に出さないこと。data-no-reading は
     「その要素に」付いていないと意味がないので、要素ごとに見る
     ―― 片方だけ消しても もう片方で正規表現が当たってしまい、
     最初この検査は 消しても通ってしまった。 */
  const paceHTML = grab(APP, 'paceHTML');
  assert.match(paceHTML,
    /class="pace-verdict \$\{cls\}\$\{paceVerdictSizeClass\(msg\)\}"\$\{grownUpWording\(\) \? ' data-no-reading' : ''\}>\$\{rubyHTML\(msg\)\}/,
    '進み具合の一言は、ルビに通し、大人びた側だけ機械のかな化から外すこと');
  assert.match(paceHTML,
    /class="pace-forecast"\$\{grownUpWording\(\) \? ' data-no-reading' : ''\}>/,
    '完了予測も、大人びた側だけ機械のかな化から外すこと');
});

test('例外に無い配当外の字を大人びた言い方に混ぜると、今までどおり検出できる', ()=>{
  const upTo4 = new Set([].concat(gradeChars(1), gradeChars(2), gradeChars(3), gradeChars(4)));
  /* 小5・小6の配当から、例外にも無い字を1つ拾って混入させる。今後この
     字が配当表から消えても、条件を満たす別の字を自動で拾い直す。 */
  const bogus = gradeChars(5).concat(gradeChars(6))
    .find(ch => !upTo4.has(ch) && !(ch in STAMP_KANJI_EXCEPTIONS));
  assert.ok(bogus, 'テストの前提となる、配当外かつ例外外の字が見つかること');
  const over = overGradeChars(['お' + bogus + 'をだす'], upTo4);
  assert.notDeepEqual(over, [], '例外の仕組みが効いていて、それ以外の配当外の字は検出されること');
});

test('小4以上と「漢字のまま」でだけ、言い方を切りかえる', ()=>{
  const f = grab(APP, 'grownUpWording');
  assert.match(f, /g >= 4 \|\| g === 9/, '小4以上と漢字のままを対象にすること');
  assert.match(grab(APP, 'wording'), /grownUpWording\(\) \? adult : child/);
  assert.match(grab(APP, 'paceMessage'), /grownUpWording\(\)\) \? PACE_MESSAGES_ADULT : PACE_MESSAGES/,
    '励まし文も同じ判定で選ぶこと');
  const body = /const PACE_MESSAGES_ADULT = \{([\s\S]*?)\n\};/.exec(APP)[1];
  for(const kind of ['good','focus','hurry','steady']){
    const from = body.indexOf(kind + ':');
    assert.ok(from >= 0, kind + ' の文がそろっていること');
    const rows = body.slice(from, body.indexOf(']', from));
    assert.equal((rows.match(/'/g) || []).length / 2, 8,
      kind + ' も8文そろえ、同じ日に文言が変わらない仕組みを保つこと');
  }
});

/* 行為ごとの言い当ては、年齢が上がるほど幼く働く。大人側は「できた」
   「完了！」に集約し、訂正だけは達成の合図と混ざらないよう別の語にする。
   低学年側は今までどおり行為ごとに分けたまま変えない。 */
test('大人びた言い方のスタンプは行為をまたいで集約し、訂正だけ別の語にする', ()=>{
  /* 2引数めは 祝いの段（celebrateLevel の 返り値）。言い方の 表は 触らない */
  assert.match(APP, /stamp\(after\.isDone \? wording\('ぜんぶ できた！', '完了！'\) : wording\('できた！', 'できた'\),/,
    '毎日の記録と全部終わったときのスタンプを「できた」「完了！」に集約すること');
  assert.match(APP, /stamp\(wording\('かけたね！', 'できた'\)\)/,
    '作文のスタンプも「できた」に集約すること');
  assert.match(APP,
    /stamp\(adultOrigin \? '修正が完了しました' : sheetBookId \? wording\('なおしたよ', 'なおした'\)\s*\n\s*: \(done \? wording\('ぜんぶ よんだ！', '完了！'\) : wording\('よめたね！', 'できた'\)\),/,
    '読書は記録・完読を「できた」「完了！」に集約しつつ、訂正だけ「なおした」に分けること');
});

/* 「いいリズムだね」は何のリズムかを指すものが無く、意味が空回りしていた。
   低学年・大人のどちらの表からも消してあること。 */
test('「リズム」を指すものが無い文言は、低学年・大人のどちらの表にも残さない', ()=>{
  const child = grabConst(APP, 'PACE_MESSAGES');
  const adult = grabConst(APP, 'PACE_MESSAGES_ADULT');
  assert.doesNotMatch(child, /リズム/);
  assert.doesNotMatch(adult, /リズム/);
});

test('切りかえるのは呼びかけだけで、画面の骨組みは変えない', ()=>{
  assert.match(APP, /TABS = \[[^\]]*'home'[^\]]*\]/, 'タブの並びを変えないこと');
  const tabLabels = /const TAB_LABELS[\s\S]{0,400}?\};/.exec(APP);
  if(tabLabels) assert.doesNotMatch(tabLabels[0], /wording\(/, 'タブ名は切りかえないこと');
  assert.doesNotMatch(grab(APP, 'viewConfig'), /wording\(/, '設定画面は切りかえないこと');
  assert.doesNotMatch(grab(APP, 'viewTasks'), /wording\(/, '宿題を決める画面は切りかえないこと');
});

/* 使い方ページの最初の画面は目次にする。概要を先頭へ戻すと紹介ページと同じ話を
   二度読ませることになり、探している手順まで指1本ぶんスクロールが増える。 */
test('使い方ページは最初に目次を出し、各項目へ飛べる', ()=>{
  const head = GUIDE.slice(GUIDE.indexOf('id="guide-main"'), GUIDE.indexOf('<h2 id="open"'));
  assert.match(head, /<nav class="guide-menu"/, '本文の最初の要素を目次にすること');
  assert.doesNotMatch(head, /class="lede"/,
    '目次より前にアプリの概要を置かないこと（紹介ページと重複する）');
  assert.match(head, /href="\.\/"[^>]*>紹介ページ<\/a>/,
    'アプリの説明は紹介ページにあると案内すること');

  const links = [...GUIDE.matchAll(/<li><a href="#([\w-]+)">/g)].map(m=>m[1]);
  assert.equal(links.length, 11, '目次は本文の11項目ぶんを並べること');
  links.forEach(id=>{
    assert.match(GUIDE, new RegExp('<h2 id="' + id + '">'),
      '目次の ' + id + ' に対応する見出しがあること');
  });
  const headings = [...GUIDE.matchAll(/<h2 id="([\w-]+)">/g)].map(m=>m[1])
    .filter(id=> id !== 'guide-menu-title');
  assert.deepEqual(headings, links, '見出しの並び順と目次の並び順をそろえること');

  assert.match(DOCS_STYLE, /html:has\(body\.guide-legacy\)\s*\{[^}]*scroll-padding-top: calc\(var\(--nav-bar-height\) \+ var\(--space-lg\)\)/,
    '告知帯の無い案内ページでは、飛んだ見出しの上に1画面ぶん空けないこと');
});

/* 目次は 11項目に なった。平らに ならべると 縦に 伸びて、
   どこに 何が あるか 一目で 取れない。枝ごとに まとめ、1項目は 1行に 詰める。
   **枝の 見出しは h3。** h2 を 名乗ると 本文の 見出しと 見分けが つかなくなる
   （上の テストが h2 id= で 本文の 並びを 取っている）。 */
test('使い方ページの目次は、枝ごとにまとめて出す', ()=>{
  const nav = GUIDE.slice(GUIDE.indexOf('<nav class="guide-menu"'), GUIDE.indexOf('<h2 id="open">'));
  const groups = [...nav.matchAll(/<h3 class="guide-menu__branch">([^<]+)<\/h3>/g)].map(m=>m[1]);
  assert.deepEqual(groups, ['はじめる', '宿題を用意する', '毎日つかう', '家族とデータ'],
    '目次を4つの枝に分けること');
  assert.equal((nav.match(/class="guide-menu__group"/g) || []).length, 4,
    '枝ごとに guide-menu__group でまとめること');
  assert.doesNotMatch(nav.slice(nav.indexOf('guide-menu__branch')), /<h2[ >]/,
    '枝の見出しに h2 をつかわないこと');

  const perGroup = nav.split('class="guide-menu__group"').slice(1)
    .map(part => (part.match(/<li><a href="#/g) || []).length);
  assert.deepEqual(perGroup, [3, 2, 3, 3], '枝ごとの項目数を保つこと');

  assert.match(DOCS_STYLE, /\.guide-menu__group \.guide-menu__list \{[^}]*border-inline-start/,
    '枝の縦罫を出すこと');
  assert.match(DOCS_STYLE, /\.guide-menu__list li::before \{/,
    '各項目へ枝の横罫を出すこと');
  assert.match(DOCS_STYLE, /\.guide-menu__list a \{[^}]*flex-wrap: wrap/,
    '題名と手がかりを1行に詰め、狭いときだけ折り返すこと');

  /* 狭い画面では 手がかり文が どうしても 2行目へ 回り、11項目ぶんで
     元の カードと ほぼ 同じ 高さに なる（実測 1309px / 元 1286px）。
     題名だけに すると 861px。枝の 名前が 手がかりの 代わりを する。 */
  assert.match(DOCS_STYLE, /\.guide-menu__list span \{[^}]*display: none/,
    '狭い画面では題名だけを並べること');
  assert.match(DOCS_STYLE,
    /@media \(min-width: 48rem\) \{[\s\S]*?\.guide-menu__list span \{[^}]*display: block/,
    '広い画面でだけ手がかりを添えること');
});

/* 写真の 説明は アプリ内の 使い方ウインドウが 持っている。
   ページ側は 「何が できるか」まで。**操作の 細部を 二重に 持たない。** */
test('使い方ページは、宿題の一覧の写真を宿題の登録のすぐ後に置く', ()=>{
  assert.ok(GUIDE.indexOf('<h2 id="add-tasks">') < GUIDE.indexOf('<h2 id="photo">'),
    '宿題の登録の後に置くこと');
  assert.ok(GUIDE.indexOf('<h2 id="photo">') < GUIDE.indexOf('<h2 id="daily">'),
    '毎日することの前に置くこと');

  const sec = GUIDE.slice(GUIDE.indexOf('<h2 id="photo">'), GUIDE.indexOf('<h2 id="daily">'));
  assert.match(sec, /4枚まで/, '置ける枚数を書くこと');
  assert.match(sec, /暗号/, '見られないかへの答えを書くこと');
  assert.match(sec, /写真アプリとは別/, '元の写真とは別だと書くこと');
  assert.match(sec, /24時間以内/, '消したあとの扱いを書くこと');
  assert.match(sec, /「\?」/, 'アプリ内の案内への導線を置くこと');

  assert.doesNotMatch(sec, /ほかの端末へ渡す|写真を受け取る|写真を足す/,
    '届かないときの操作はアプリ内の案内が持つ（二重に書かない）');
});

test('案内・変更履歴ページの上帯のボタンを、紺地に紺字で消さない', ()=>{
  assert.match(DOCS_STYLE, /\.guide-legacy a\.button\s*\{[^}]*color: var\(--color-navy-ink\)/,
    '本文リンクの色が .button より強いので、ボタンの文字色を戻すこと');
});

/* めずらしい生きものは、既読の キー が 配列の 添字 なので末尾へ足す。
   とちゅうへ入れると、既存の端末で読んだ／まだの対応が1つずつずれる。 */
test('めずらしい名前・めずらしい暮らしの生きものを、既読の添字をずらさずに増やす', ()=>{
  const names = ['スベスベマンジュウガニ', 'オジサン', 'ウッカリカサゴ', 'モクズショイ',
    'ハシビロコウ', 'ダンゴウオ', 'アメフラシ', 'コウモリダコ', 'ウデフリツノザヤウミウシ',
    'テッポウエビ', 'テヅルモヅル',
    /* 名前だけでなく暮らしぶりも変わったもの */
    'カイロウドウケツ', 'ホネクイハナムシ', 'コウガイビル', 'ハリガネムシ', 'デメニギス',
    'ミツクリザメ', 'サカサクラゲ', 'カツオノエボシ', 'アリジゴク'];
  ['チンアナゴ', 'オオグチボヤ'].forEach(name=>{
    assert.equal(FUN_TEST.findIndex(f=> f.q === name), -1,
      name + ' は「めずらしさが足りない」として外した。戻さないこと');
  });
  const lastOld = FUN_TEST.map(f=>f.t).lastIndexOf('よくわからないけれどかっこいい長い言葉');
  names.forEach(name=>{
    const i = FUN_TEST.findIndex(f=> f.q === name);
    assert.ok(i > lastOld, name + ' は配列の末尾へ足すこと（添字がずれる）');
    assert.equal(FUN_TEST[i].t, 'めずらしい生きもの');
    assert.equal(FUN_TEST[i].lv, 2, '小2でも読めるように lv:2 にすること');
    assert.equal(FUN_TEST[i].ask, 'どんな いきもの かな？', '分野ごとの問いかけを解決させること');
    assert.ok(FUN_TEST[i].a.length > 40, name + ' の説明を1文で終わらせないこと');
  });
});

/* iOS Safari は、アプリを裏へ回すと IndexedDB の接続を閉じることがある
   （WebKit の既知の不具合）。実際に保護者端末で起き、アプリを開き直すまで
   共有が止まった。こちらで防げない以上、起きたあとに立ち直れることを縛る。 */
test('つながらなくなったら、画面に戻ったとき・時間をおいて、つなぎ直す', ()=>{
  const resume = grab(SYNC, 'resumeSync');
  assert.match(resume, /status === 'error'/, '切れたままのときだけ つなぎ直すこと');
  assert.match(resume, /recoverConnection\(\)/);
  assert.match(SYNC, /addEventListener\('online', resumeSync\)/,
    '通信が戻ったときも つなぎ直すこと');
  assert.match(SYNC, /visibilityState === 'visible'\) resumeSync\(\)/,
    '画面に戻ったときも つなぎ直すこと');

  const schedule = grab(SYNC, 'scheduleRecovery');
  assert.match(schedule, /retryWait \* 2/, '失敗が続くときは間隔を空けること');
  assert.match(schedule, /RETRY_MAX/, '間隔に上限を置くこと');

  const recover = grab(SYNC, 'recoverConnection');
  assert.match(recover, /if\(recovering\) return false/,
    'つなぎ直しを何本も同時に走らせないこと');
  assert.match(recover, /storageBroken/);
});

test('保存庫が壊れたときは、ためこみをやめて通信だけでつなぎ直す', ()=>{
  const restart = grab(SYNC, 'restartWithoutStorage');
  assert.match(restart, /fs\.terminate\(db\)/, '古いFirestoreを畳んでから作り直すこと');
  assert.match(restart, /memoryLocalCache\(\)/);
  assert.match(restart, /getFirestore\(firebaseApp\)/,
    'terminate 後に同じ設定で作れない場合の逃げ道を残すこと');
  assert.match(restart, /if\(!fs \|\| !firebaseApp \|\| memoryOnly\) return false/,
    '一度きりにすること');
  /* 記録が消えないことの根拠：未送信は localStorage の控えが持っている */
  assert.match(SYNC, /K_PENDING/);
});

test('つながらないときに、英語の例外を保護者の画面へ出さない', ()=>{
  assert.match(SYNC, /const TROUBLE_TEXT = 'つながりません。アプリを開き直すと直ることがあります'/);
  assert.doesNotMatch(SYNC, /'つながりません：' \+/,
    '例外の文言をそのまま画面へ出さないこと');
  assert.doesNotMatch(SYNC, /setStatus\('error', '[^']*' \+ \(err/,
    'エラー本文の連結を画面の文言に使わないこと');
  const note = grab(SYNC, 'noteTrouble');
  assert.match(note, /lastTrouble = \{/, '調べもの用に内容は控えておくこと');
  assert.match(note, /STORAGE_TROUBLE\.test/);
  assert.match(note, /setStatus\('error', TROUBLE_TEXT\)/);
  /* 内部の文言は、大人の設定ページのデバッグ欄からだけ見える */
  assert.match(grab(APP, 'syncTroubleHTML'), /S\.lastTrouble\(\)/);
  assert.match(grab(APP, 'syncTraceHTML'), /syncTroubleHTML\(\)/);
});

test('切れているときの更新ボタンは、まずつなぎ直してから読む', ()=>{
  const refresh = grab(SYNC, 'refreshFromServer');
  assert.match(refresh, /status === 'error' && !recovering/);
  assert.match(refresh, /await recoverConnection\(\)/);
  assert.match(APP, /更新できませんでした。少し待ってからもう一度お試しください/,
    '通信のせいと決めつけないこと');
  assert.doesNotMatch(APP, /更新できませんでした。通信を確認してください/);
});

test('同期が切れているあいだ、保護者ページのバッジで「接続待ち」と言わない', ()=>{
  const summary = grab(APP, 'parentShareSummary');
  assert.match(summary, /syncStatus === 'error'/);
  assert.match(summary, /共有につながっていません/);
  assert.match(summary, /'：未接続'/);
  assert.match(grab(APP, 'parentShareBadgeHTML'), /S\.status\(\)/,
    'バッジに同期の状態を渡すこと');
  assert.match(STYLE, /\.parent-share-badge\.is-error\{/);
});

/* 上の3件はソースの形を見るだけなので、ここでは実際に動かして確かめる。
   立ち直りは「切れているときだけ」「1本だけ」「保存庫が原因のときは
   ためこみをやめてから」の3つが同時に成り立たないと、つなぎ直しが
   暴走したり、逆にいつまでも戻らなかったりする。 */
function recoveryHarness(){
  return new Function(`
    let status = 'off';
    let code = 'abcdefghjkmnpqrs';
    let storageBroken = false, memoryOnly = false, recovering = false;
    let retryTimer = null, retryWait = 0, lastTrouble = null;
    let connects = 0, restarts = 0;
    const timers = [];
    const setTimeout = (fn, ms) => { timers.push({ fn, ms }); return timers.length; };
    const clearTimeout = () => {};
    function getCode(){ return code; }
    function setStatus(s, text){ status = s; }
    async function connect(){ connects++; status = 'online'; }
    async function restartWithoutStorage(){ restarts++; memoryOnly = true; return true; }
    ${['TROUBLE_TEXT','STORAGE_TROUBLE','RETRY_MIN','RETRY_MAX'].map(n=>{
      const m = new RegExp('const ' + n + ' = .*?;\n').exec(SYNC);
      return m ? m[0] : '';
    }).join('')}
    ${grab(SYNC, 'troubleDetail')}
    ${grab(SYNC, 'noteTrouble')}
    ${grab(SYNC, 'scheduleRecovery')}
    ${grab(SYNC, 'clearTrouble')}
    ${grab(SYNC, 'recoverConnection')}
    return {
      noteTrouble, recoverConnection, clearTrouble,
      /* 予約した時刻が来たことにして、その1本を走らせる */
      async runTimer(){
        const t = timers[timers.length - 1];
        if(!t) return false;
        await t.fn();
        return true;
      },
      read: ()=> ({ status, storageBroken, memoryOnly, connects, restarts, retryWait,
                    waits: timers.map(t=>t.ms), trouble: lastTrouble }),
      set: (s)=> { status = s; },
      clearCode: ()=> { code = ''; }
    };
  `)();
}

test('保存庫の失敗と分かったときだけ、ためこみをやめてつなぎ直す', async ()=>{
  const h = recoveryHarness();
  h.noteTrouble('受信', new Error('Database is closing'));
  assert.equal(h.read().status, 'error', '画面には切れていることを出すこと');
  assert.equal(h.read().storageBroken, true, '保存庫が原因だと見分けること');
  assert.match(h.read().trouble.detail, /Database is closing/,
    '調べもの用には元の文言を残すこと');

  await h.recoverConnection();
  const after = h.read();
  assert.equal(after.restarts, 1, 'ためこみをやめてから つなぎ直すこと');
  assert.equal(after.connects, 1);
  assert.equal(after.status, 'online');
});

test('保存庫と関係ない失敗では、ためこみを続けたままつなぎ直す', async ()=>{
  const h = recoveryHarness();
  h.noteTrouble('受信', { code:'unavailable', message:'network' });
  assert.equal(h.read().storageBroken, false);
  await h.recoverConnection();
  assert.equal(h.read().restarts, 0, '通信が理由なら、ためこみは そのままにすること');
  assert.equal(h.read().connects, 1);
});

test('つながっているとき・合言葉が無いときは、つなぎ直さない', async ()=>{
  const h = recoveryHarness();
  h.set('online');
  assert.equal(await h.recoverConnection(), false);
  assert.equal(h.read().connects, 0, 'つながっているのに つなぎ直さないこと');

  const h2 = recoveryHarness();
  h2.noteTrouble('受信', new Error('x'));
  h2.clearCode();
  assert.equal(await h2.recoverConnection(), false);
  assert.equal(h2.read().connects, 0, '合言葉が無ければ何もしないこと');
});

test('失敗が続くほど、つなぎ直しの間隔を空ける（上限あり）', async ()=>{
  const h = recoveryHarness();
  for(let i=0;i<8;i++){
    h.noteTrouble('受信', new Error('x'));   // 切れた
    await h.runTimer();                      // 予約の時刻が来た → つなぎ直す
  }
  const waits = h.read().waits;
  assert.equal(waits[0], 15000, '最初は15秒で試すこと');
  assert.ok(waits[1] > waits[0], '続けて失敗したら間隔を空けること');
  assert.ok(Math.max(...waits) <= 300000, '5分を超えて空けないこと');
  assert.equal(waits.length, 8, '失敗のたびに1本だけ予約すること');

  /* 失敗の最中に もう一度 切れても、予約は1本のまま */
  h.noteTrouble('受信', new Error('x'));
  h.noteTrouble('送信', new Error('x'));
  assert.equal(h.read().waits.length, 9, '予約を積み増さないこと');

  h.clearTrouble();
  assert.equal(h.read().retryWait, 0, 'つながったら待ち時間を戻すこと');
});

/* 観察・自由研究の 任意質問。1問 直して きろく を 押すと、
   「やったこと」に 全問が もう一度 並んでいた（実機からの指摘）。
   記録は「その とき 何を したか」の 控えなので、書きかわった 答えだけを
   のせる。答えそのものは state.questionAnswers に のこる。 */
function answerLogHarness(saved, fields, stored){
  return new Function('savedJSON', 'fieldsJSON', 'storedJSON', `
    const saved = JSON.parse(savedJSON), fields = JSON.parse(fieldsJSON);
    let sheetSavedAnswers = JSON.parse(storedJSON);
    const sheetTask = { id:'t1', questions:['なにを 見た？','どう 思った？','つぎは？'] };
    function questionAnswerRow(){ return { answers: saved }; }
    /* 画面の 入力欄の 代わり */
    const $$ = () => fields.map(v => ({ value: v }));
    ${grab(APP, 'rememberSavedAnswer')}
    ${grab(APP, 'answerChangesForLog')}
    ${grab(APP, 'pendingAnswerChanges')}
    return { answerChangesForLog, pendingAnswerChanges, remember:(i,t)=>{ rememberSavedAnswer(i,t); return sheetSavedAnswers; } };
  `)(JSON.stringify(saved), JSON.stringify(fields), JSON.stringify(stored || []));
}

test('答えを1つ直して記録すると、その1問だけが記録に残る', ()=>{
  const h = answerLogHarness(
    ['あさがお', 'きれいだった', 'みずやり'],        // 保存ずみ
    ['あさがお', 'とても きれいだった', 'みずやり']  // 2問目だけ直した
  );
  const changes = h.answerChangesForLog();
  assert.deepEqual(changes, [{ i:1, text:'とても きれいだった' }],
    '直した問だけを記録にのせること（全問を並べ直さない）');
});

test('何も直さずに記録を押しても、答えは記録に出ない', ()=>{
  const h = answerLogHarness(['あさがお', 'きれい'], ['あさがお', 'きれい']);
  assert.deepEqual(h.answerChangesForLog(), [],
    '同じ内容をもう一度書き出さないこと');
});

test('はじめて書いた答えは、書いた問だけが記録に残る', ()=>{
  const h = answerLogHarness(['', '', ''], ['あさがお', '', 'みずやり']);
  assert.deepEqual(h.answerChangesForLog(),
    [{ i:0, text:'あさがお' }, { i:2, text:'みずやり' }],
    '空のままの問は記録にのせないこと');
});

test('1問ずつ保存したぶんも、そのシートの記録には残る', ()=>{
  /* 「この答えを保存」を押すと保存ずみになるので、きろく の時点では
     差分が無い。覚えていないと「やったこと」に何も残らない */
  const h = answerLogHarness(
    ['あさがお', 'きれい'],
    ['あさがお', 'きれい'],
    [{ i:1, text:'きれい' }]
  );
  assert.deepEqual(h.answerChangesForLog(), [{ i:1, text:'きれい' }]);
});

test('1問ずつ保存したあとに直したら、あとから直した方を記録に残す', ()=>{
  const h = answerLogHarness(
    ['あさがお', 'きれい'],
    ['あさがお', 'やっぱり すごい'],
    [{ i:1, text:'きれい' }]
  );
  assert.deepEqual(h.answerChangesForLog(), [{ i:1, text:'やっぱり すごい' }],
    '同じ問が2つ並ばないこと');
});

test('空にした答えは、そのシートの控えからも外す', ()=>{
  const h = answerLogHarness(['あさがお'], ['あさがお'], [{ i:0, text:'あさがお' }]);
  assert.deepEqual(h.remember(0, ''), [], '空にしたぶんを記録にのせないこと');
});

test('記録本文とシートの空入力ガードは、書きかわった答えだけで決める', ()=>{
  const save = grab(APP, 'saveSheet');
  assert.match(save, /const answerChanges = answerChangesForLog\(\);/);
  assert.match(save, /const hasAnswer = answerChanges\.length > 0;/,
    '欄に答えが入っているだけで「入力あり」と見なさないこと');
  assert.match(save, /answerChanges\s*\n?\s*\.map\(c => '・' \+ \(t\.questions\[c\.i\] \|\| ''\)/,
    '記録本文も書きかわったぶんだけで組み立てること');
  assert.doesNotMatch(save, /const qs = \$\$\('#sheetBody \[data-q\]'\)/,
    '欄を丸ごと読み直して全問を書き出す作りに戻さないこと');
  /* 取る順番を まちがえると、保存ずみに なった あとで 差分を 見ることに なる */
  assert.ok(save.indexOf('answerChangesForLog()') < save.indexOf('saveQuestionAnswers(true)'),
    '差分は saveQuestionAnswers() より先に取ること');
});

test('だんかいを変えずに記録したときは「なおした」と書かない', ()=>{
  const save = grab(APP, 'saveSheet');
  assert.match(save, /const sameSteps = \(t\.steps\|\|\[\]\)\.every/);
  assert.match(save, /sameSteps \? 'すすみは そのまま'/,
    '答えだけ直しに来たとき、だんかいまで「なおした」と残さないこと');
});

test('進みを変えずに答えだけ記録したときは、その旨を知らせる', ()=>{
  const save = grab(APP, 'saveSheet');
  assert.match(save, /const answersOnly = !progressChanged && answerChanges\.length > 0;/);
  assert.match(save, /if\(answersOnly\) what = wording\('しつもんの こたえを きろくした'/,
    '記録本文も「すすみは そのまま」で終わらせないこと');
  assert.match(save, /else if\(answersOnly\) stamp\(wording\('こたえを きろくしたよ'/,
    '「できた！」ではなく、答えを残したことを伝えること');
  /* 進みが変わったかは、かず・だんかい・まいにち・しあげのすべてで見る */
  assert.match(save, /progressChanged = after !== before;/);
  assert.match(save, /progressChanged = !sameSteps;/);
  assert.match(save, /progressChanged = n !== \(Number\(days\[dayKey\(now\)\]\) \|\| 0\);/);
  assert.match(save, /progressChanged = true;[\s\S]{0,120}が できた/,
    'しあげ（まるつけ・なおし）を足したときも進みが変わったと見ること');
});


/* 何も 直さずに きろく を 押した とき。ログを 1件 のこすと「きょう やったこと」に
   出るだけでなく、didSomethingToday() が 真に なって ミニコンテンツの 解禁数まで
   増える。何も していない 日に 増えるのは おかしい。ログは のこさず、
   押したことが 伝わる ように 一言だけ 出す。 */
function unchangedHarness(){
  return new Function(`
    ${grab(APP, 'sheetUnchanged')}
    return { sheetUnchanged };
  `)();
}

test('何も書きかわらなかったときは、記録を増やさない', ()=>{
  const h = unchangedHarness();
  assert.equal(h.sheetUnchanged(false, [], ''), true,
    '進み・答え・メモの どれも 変わっていなければ 記録を のこさないこと');
});

test('進み・答え・メモのどれかが書きかわったら、記録を残す', ()=>{
  const h = unchangedHarness();
  assert.equal(h.sheetUnchanged(true, [], ''), false, '進みが変わったら残すこと');
  assert.equal(h.sheetUnchanged(false, [{ i:0, text:'あさがお' }], ''), false,
    '答えが変わったら残すこと');
  assert.equal(h.sheetUnchanged(false, [], 'きょうは しずかに できた'), false,
    'メモを書いたら残すこと');
});

test('何も書きかわらなくても、押したことは伝える', ()=>{
  const save = grab(APP, 'saveSheet');
  assert.match(save, /const unchanged = sheetUnchanged\(progressChanged, answerChanges, memo\);/);
  assert.match(save, /if\(!unchanged\)\{[\s\S]{0,400}state\.logs\.push\(/,
    'ログは 書きかわった ときだけ のこすこと');
  assert.match(save, /if\(unchanged\) toast\(wording\('そのままに しておいたよ'/,
    '押しても 何も 起きないように 見せないこと');
  assert.ok(save.indexOf('if(unchanged) toast(') < save.indexOf('else stamp('),
    '何も 変わっていない ときに「できた！」の はんこを 出さないこと');
});

/* ---------------------------------------------------------
   完了アニメーション（docs/completion-animation-design.md）
   --------------------------------------------------------- */
/* 判定だけを 取り出して 動かす。isDone は done で 差しかえる */
function celebrationHarness(tasks, done, shownKey){
  const config = { tasks };
  const state = { resetAt:'' };
  const prog = t => ({ isDone: !!done[t.id] });
  const getLocal = () => shownKey || '';
  return new Function('config','state','prog','getLocal','K_FINALE_DONE', `
    ${grab(APP, 'celebrateTargets')}
    ${grab(APP, 'celebrateGroupDone')}
    ${grab(APP, 'celebrateAllDone')}
    ${grab(APP, 'celebrateBefore')}
    ${grab(APP, 'finaleSignature')}
    ${grab(APP, 'finaleAlreadyShown')}
    ${grab(APP, 'celebrateLevel')}
    return { celebrateBefore, celebrateLevel, celebrateGroupDone, celebrateAllDone, finaleSignature };
  `)(config, state, prog, getLocal, 'natsu.finale.shown.v1');
}
const CELEB_TASKS = [
  { id:'m1', group:'must',   type:'count' },
  { id:'m2', group:'must',   type:'count' },
  { id:'md', group:'must',   type:'daily' },
  { id:'o1', group:'option', type:'count' },
  { id:'d1', group:'daily',  type:'daily' }
];

test('祝いの段は、出る回数の少ないものほど強くする', ()=>{
  const done = {};
  const h = celebrationHarness(CELEB_TASKS, done);
  const finish = id => {
    const task = CELEB_TASKS.find(t => t.id === id);
    const before = h.celebrateBefore(task);
    done[id] = true;
    return h.celebrateLevel(task, before);
  };
  assert.equal(finish('m1').level, 'a', '課題を1つ終えたら A');
  assert.equal(finish('o1').level, 'b',
    '任意が ぜんぶ 終わったら B（必須は のこっているので C では ない）');
  assert.equal(finish('m2').level, 'c',
    '必須も 任意も ぜんぶ 終わったら C。A・B と 同時に 成立するので 強いほうだけ 出す');
});

test('必須をぜんぶ終えても、任意が残っていれば花丸どまり', ()=>{
  const done = {};
  const h = celebrationHarness(CELEB_TASKS, done);
  const finish = id => {
    const task = CELEB_TASKS.find(t => t.id === id);
    const before = h.celebrateBefore(task);
    done[id] = true;
    return h.celebrateLevel(task, before);
  };
  finish('m1');
  assert.equal(finish('m2').level, 'b',
    'C は 必須・任意（読書の記録も ふくむ）が ぜんぶ 済んでから');
  assert.equal(finish('o1').level, 'c', '最後の 1つで 完走');
});

test('任意の課題が1つも無ければ、必須をぜんぶ終えた時点で完走', ()=>{
  const tasks = CELEB_TASKS.filter(t => t.group !== 'option');
  const done = { m1:true };
  const h = celebrationHarness(tasks, done);
  const task = tasks.find(t => t.id === 'm2');
  const before = h.celebrateBefore(task);
  done.m2 = true;
  assert.equal(h.celebrateLevel(task, before).level, 'c',
    '空の 分類は「済んだ」として 数える。でないと 完走できない 家庭が 出る');
});

test('毎日の項目では祝いを出さない', ()=>{
  const done = {};
  const h = celebrationHarness(CELEB_TASKS, done);
  const daily = CELEB_TASKS.find(t => t.id === 'd1');
  const before = h.celebrateBefore(daily);
  done.d1 = true;
  assert.equal(h.celebrateLevel(daily, before), null,
    'まいにちの isDone は 今日ぶんなので 毎日 成立する。入れると 毎日 出る');

  /* 必須の中に まぎれた 毎日の項目も、分類の 達成を さまたげない */
  const done2 = { m1:true, m2:true, md:false, o1:true };
  const h2 = celebrationHarness(CELEB_TASKS, done2);
  assert.equal(h2.celebrateGroupDone('must'), true,
    '毎日の項目は 分類の かぞえから 外すこと');
});

test('取り消しでは祝いを出さない', ()=>{
  const done = { m1:true, m2:true, o1:true };
  const h = celebrationHarness(CELEB_TASKS, done);
  const task = CELEB_TASKS.find(t => t.id === 'm1');

  /* チェックを 外した（できた → まだ） */
  const before = h.celebrateBefore(task);
  done.m1 = false;
  assert.equal(h.celebrateLevel(task, before), null, '取り消しで 祝わないこと');

  /* もともと できていた ものを 開いて 直しただけ */
  done.m1 = true;
  const before2 = h.celebrateBefore(task);
  assert.equal(h.celebrateLevel(task, before2), null,
    'すでに できていた ものを 保存し直しても 祝わないこと');
});

test('「完走！」は同じ達成状態では出し直さない', ()=>{
  const done = { m1:true, o1:true };
  const sig = celebrationHarness(CELEB_TASKS, { m1:true, m2:true }).finaleSignature();
  const h = celebrationHarness(CELEB_TASKS, done, sig);
  const task = CELEB_TASKS.find(t => t.id === 'm2');
  const before = h.celebrateBefore(task);
  done.m2 = true;
  assert.equal(h.celebrateLevel(task, before).level, 'b',
    '出したしるしが あれば C ではなく B へ落とす');
  assert.match(grab(APP, 'showFinale'), /setLocal\(K_FINALE_DONE, finaleSignature\(\)\)/,
    'しるしは **実際に 出したとき** に 端末内キーへ 残すこと。押した 時点で 残すと、'
    + '途中で 画面を 閉じられた ときに 一度も 見ていないのに「見た」ことに なる');
});

test('「完走！」のしるしは端末の中だけに置く', ()=>{
  const cfgKeys = JSON.parse(grabConst(APP, 'SHARED_CONFIG_KEYS')
    .replace(/^const\s+SHARED_CONFIG_KEYS\s*=\s*/, '').replace(/;\s*$/, '').replace(/'/g, '"'));
  const stKeys = JSON.parse(grabConst(APP, 'SHARED_STATE_KEYS')
    .replace(/^const\s+SHARED_STATE_KEYS\s*=\s*/, '').replace(/;\s*$/, '').replace(/'/g, '"'));
  for(const key of cfgKeys.concat(stKeys)){
    assert.doesNotMatch(key, /finale/i,
      '祝いを 見たかどうかは 家族で 合わせる 記録では ない。allowlist に 足さないこと');
  }
  assert.match(APP, /const K_FINALE_DONE = TEST_MODE \?/, '端末内キーとして 持つこと');
  assert.doesNotMatch(APP, /state\.finale|config\.finale/,
    'state / config に のせると 同期に 乗ってしまう');
});

test('演出の色はテーマのトークンから作る', ()=>{
  assert.match(STYLE, /:root\{\s*--v1:var\(--himawari\);/,
    'oklch(from …) を 読めない 環境では 素の トークンへ 落とすこと');
  assert.match(STYLE, /@supports \(color: oklch\(from white l c h\)\)/);
  assert.match(STYLE, /--v1:oklch\(from var\(--himawari\) clamp\(\.42,l,\.74\)/,
    '黄だけは 明度の 上限を 下げること（紙の上で ほぼ 見えないため）');
  assert.match(APP, /\['--v2','--v3'\]\.map\(n => fxMix\(fxRGB\('var\(' \+ n \+ '\)'\)/,
    'テーマらしさは 紫系と 緑系。全色に 混ぜると 6テーマとも 同じ色に なる');
  /* canvas は CSS変数も oklch(from …) も 読めない。1×1 に 塗って 読み返す。
     getPropertyValue は oklch(…) のまま 返るので、そこから 数を 3つ 拾うと
     **全部の色が 同じ 嘘の値に なる** */
  assert.match(grab(APP, 'fxRGB'), /getImageData\(0, 0, 1, 1\)/);
  assert.doesNotMatch(APP, /getPropertyValue\('--v[1-5]'\)/,
    'CSS変数を 文字列の まま 色として 使わないこと');
});

test('動きを減らす設定では、静止の印に置きかえる', ()=>{
  assert.match(grab(APP, 'celebrateReduced'),
    /matchMedia\('\(prefers-reduced-motion: reduce\)'\)\.matches/,
    '判定は 再生の たびに 読むこと（設定は 途中で 変わる）');
  assert.match(grab(APP, 'stamp'), /if\(level && celebrateReduced\(\)\)\{ celebrateStill\(false\); return; \}/);
  assert.match(grab(APP, 'celebrateFinale'), /if\(celebrateReduced\(\)\)\{[^}]*celebrateStill\(true\); return; \}/,
    '完全制覇も 静止の 印に 置きかえること（文字だけ「ぜんぶ できた！」）');
  assert.match(grab(APP, 'celebrateStill'), /ぜんぶ できた！/);
  assert.match(STYLE, /@media \(prefers-reduced-motion:reduce\)\{[^}]*\.stamp\{ transition:none/);
});

test('はんこは狭い画面でも収まる', ()=>{
  assert.match(STYLE, /\.stamp-mark\{[\s\S]{0,200}font-size:clamp\(24px,6\.4vw,44px\)/,
    '固定の 44px だと「ぜんぶ できた！」の 8文字で iPhone の 幅に ぎりぎり');
  assert.match(STYLE, /\.stamp-mark\{[\s\S]{0,300}padding:clamp\(12px,3\.4vw,22px\) clamp\(18px,5\.6vw,40px\)/);
  assert.match(STYLE, /\.stamp-line-a, \.stamp-line-b\{ white-space:nowrap/,
    '2行は 先に 決めて 各行を nowrap にすること（語の 途中で 割れる）');
  assert.match(STYLE, /\[data-theme="cat"\] \.stamp-mark::before\{[\s\S]{0,160}width:clamp\(42px,11vw,72px\)/,
    '肉球は 実寸。em だと 2行はんこで いちばん 小さくなる');
});

test('花丸は線を隠して切り出す方式で描かない', ()=>{
  const stroke = grab(APP, 'hanamaruStroke');
  assert.doesNotMatch(stroke, /dasharray|dashoffset/,
    'dash は 窓が 複数箇所で 開き、線が 複数の 起点から 生えたように 見える');
  assert.match(stroke, /el\.setAttribute\('d', hanamaruD\(pts, Math\.round\(k \* pts\.length\)\)\)/,
    'd 属性を 描いた 点までで 作り直すこと');
  /* 途中経過は 完成形の 文字列としての 接頭辞に なる */
  const pts = [[0,0],[1,1],[2,2],[3,3],[4,4],[5,5]];
  const d = new Function(`${grabConst(APP, 'hanamaruD')} return hanamaruD;`)();
  for(const n of [2,3,4,5]) assert.ok(d(pts, 6).startsWith(d(pts, n)), n + '点目までが 接頭辞であること');
});

test('花丸のV字頂点さがしは端をまたいでも落ちない', ()=>{
  const cloud = new Function(`
    const HM_R = 92;
    const HM_START = Math.PI / 2;
    ${grab(APP, 'hanamaruCloudPts')}
    return hanamaruCloudPts;
  `)();
  const pts = cloud();
  assert.ok(pts.length > 400);
  /* 素で pts[i+3] と 書くと 末尾で 範囲外に なり、例外で 花丸が 出なくなる */
  assert.ok(pts.every(p => Number.isFinite(p[0]) && Number.isFinite(p[1])));
  assert.deepEqual(pts[0], pts[pts.length - 1], '閉じた 曲線に すること');
});

test('演出の片づけは一箇所にまとめる', ()=>{
  const stop = grab(APP, 'stopCelebration');
  assert.match(stop, /\$\$\('\.finale, \.celebrate-still'\)\.forEach/);
  assert.match(stop, /endFxCanvas\(\)/);
  assert.match(stop, /box\.innerHTML = ''/, 'はんこの 中身も ここで 片づけること');
  assert.match(grab(APP, 'applyTheme'), /stopCelebration\(\)/,
    'テーマを 切りかえたら 古い色の 粒を 残さないこと');
});

test('祝いの判定は進捗サマリーの計算に触れない', ()=>{
  assert.match(grab(APP, 'overall'),
    /config\.tasks\.filter\(t => t\.group === group && t\.type !== 'daily'\)\.forEach/,
    'overall() は これまでどおり');
  assert.doesNotMatch(grab(APP, 'celebrateLevel'), /overall\(/,
    '判定は 必須だけを 数える 別の 関数で 行うこと');
  assert.match(grab(APP, 'showFinale'), /periodWord\(true\)/,
    '期間の 呼び名は 変数。文字列を 直に 書かないこと');
  assert.doesNotMatch(grab(APP, 'showFinale'), /location\.hash/,
    'URL の # を 汚さないこと');
});

test('しあげの印を外したときも、書きかわったものとして残す', ()=>{
  const save = grab(APP, 'saveSheet');
  assert.match(save, /const removed = WRAP_LABELS\.some\(\(s,i\)=> !sheetWrap\[i\] && p\.wrap\[i\]\);/);
  assert.match(save, /if\(removed && !added\.length\)\{[\s\S]{0,200}progressChanged = true;/,
    '外した ぶんは 保存されるので、記録にも のこすこと');
});

/* マイクの 許可を 押しそこねた ときの 案内。押しそこねたのか、そもそも
   ことわったのかは Web Speech API からは 区別できない（どちらも not-allowed）。
   分けずに、その場で できる 手だてを 両方 出す。 */
test('マイクを使えないときは、開き直す方法と設定の両方を案内する', ()=>{
  const msg = new Function(`${grab(APP, 'srErrorMessage')} return srErrorMessage('not-allowed');`)();
  assert.match(msg, /開き直/, 'アプリを開き直せば直ることを伝えること');
  assert.match(msg, /許可/, 'Safariの設定で許可する道も残すこと');
  /* 2.2秒では 読み切れない 長さなので、長い 知らせは 表示を のばす */
  assert.match(grab(APP, 'toast'), /Math\.max\(2200/, '長い知らせを2.2秒で消さないこと');
});

/* 保護者画面で しつもん（や だんかい）の行を 消すと、答え・チェックが
   1つ上へ ずれていた。答えは `answers[i]`、だんかいは `progress.steps[i]` と
   **添字だけ**で 問に ひもづいて いるのに、行の 編集は textarea を
   まるごと 置きかえる ため、消した ぶん 後ろが 前へ 詰まる。
   行の 文で 対応を 取り直してから 入れかえること。 */
test('しつもん・だんかいの行を消しても、答えとチェックはその行に付いたまま', ()=>{
  const map = new Function(`${grab(APP, 'realignIndexes')} return realignIndexes;`)();
  assert.deepEqual(map(['A','B','C'], ['A','C']), [0, 2], '消した行の ぶんを 詰めること');
  assert.deepEqual(map(['A','B'], ['B','A']), [1, 0], '並べかえにも ついていくこと');
  assert.deepEqual(map(['A','B'], ['A','D','B']), [0, -1, 1], '足した行には 何も 引きつがないこと');
  assert.deepEqual(map(['A','B'], ['A','B2']), [0, 1], '書き直しただけの行は 引きつぐこと');
  const ed = grab(APP, "bindConfig");
  assert.match(ed, /realignQuestionAnswers\(t, t\.questions \|\| \[\], next\)/,
    'しつもんを 入れかえる 前に 答えを そろえること');
  assert.match(ed, /realignStepProgress\(t, t\.steps \|\| \[\], next\)/,
    'だんかいも 同じように そろえること');
});

/* 「まいにち」は 済んだら 下へ 送っていた。位置が 動くと、毎日 おぼえた
   「自分のあれは ここ」が くずれる。畳んで その場に のこす。
   直しに 来た ときの 入口（見出し）も 同じ場所に あるほうが たどりやすい。 */
test('まいにちは、済んでも下へ送らずその場で畳む', ()=>{
  const home = grab(APP, 'viewHome');
  assert.doesNotMatch(home, /\$\{dailyAllDone \? '' : dailySec\}/,
    '済んだかどうかで 置き場所を 変えないこと');
  assert.doesNotMatch(home, /\$\{dailyAllDone \? dailySec : ''\}/,
    '下の 置き場所を のこさないこと');
  assert.equal((home.match(/\$\{dailySec\}/g) || []).length, 1,
    'まいにちの 欄は 1か所だけに 出すこと');
  const sec = grab(APP, 'sectionHTML');
  assert.match(sec, /data-details-key="dailyDone"/,
    '開いたままかどうかを 再描画のあとも 覚えること');
  assert.match(sec, /<summary class="sec-head"/,
    '見出しを そのまま 開閉の 取っ手に すること');
});

/* 「のこり 0しゅるい」「きょうは ぜんぶ できた！」と スタンプが ならぶと、
   同じことを 二度 言うことに なる。済んだ 欄では 但し書きを 出さない。 */
test('欄が全部済んだら、但し書きは出さずスタンプだけにする', ()=>{
  const sec = grab(APP, 'sectionHTML');
  assert.match(sec, /const done = allDone \|\| fold;/);
  assert.match(sec, /\$\{done \? '' : `<span class="sec-note">/,
    '済んだ欄で のこり件数や「ぜんぶ できた」を かさねて 出さないこと');
  assert.doesNotMatch(sec, /aria-hidden="true">✓<\/span>/,
    'スタンプの中に チェック印を かさねないこと');
});

/* 宿題の一覧の写真。画像の本体は端末の中（IndexedDB）に置き、共有には
   「いつのものか」の印だけを流す。1家庭＝Firestoreの1文書（1MiB）なので、
   ここに画像が混ざると、記録がたまるほど上限に近づき、いつか家庭ぜんぶの
   同期が止まる。 */
test('共有する設定には、写真の印だけを入れて画像は入れない', ()=>{
  const out = normalizeConfigHarness({
    poster: { label:'いちらん', at: 1755000000000, photo:'data:image/jpeg;base64,AAAA' }
  });
  assert.deepEqual(Object.keys(out.poster).sort(), ['at','ats','label'],
    '画像そのものを config に持ちこまないこと');
  assert.equal(out.poster.at, 1755000000000);
  /* 旧い 1枚だけの 設定は 0まいめとして 引きつぐ（移行の処理を増やさない） */
  assert.deepEqual(out.poster.ats, [1755000000000, 0, 0, 0]);
  const app = grab(APP, 'savePosterFile');
  assert.match(app, /config\.poster = posterCfgOut\(posterCfg\(\)\.label, ats\);/,
    '保存するのは印だけにすること');
  assert.doesNotMatch(app, /config\.poster[^\n]*dataURL/, '設定に画像を入れないこと');
});

/* 枠は 0〜3 の固定で、消しても詰めない。詰めると枠ごとの合図がすべてずれ、
   関係のない端末が全部の写真を取り直す。空き枠が見えるほうが安い。 */
test('写真の枠は4つで、消しても詰めない', ()=>{
  assert.match(grabConst(APP, 'POSTER_MAX'), /= 4;/, '4枠にすること');
  const remove = grab(APP, 'removePoster');
  assert.match(remove, /ats\[n\] = 0;/, '消した枠は空にするだけにすること');
  assert.doesNotMatch(remove, /splice|filter|shift/, '枠を詰め直さないこと');
  /* 0まいめのIDとキーは、これまでと同じ。版が混ざっても1枚めは通る */
  assert.match(grab(APP, 'posterId'), /n > 0 \? 'poster-' \+ n : 'poster'/);
  assert.match(grab(SYNC, 'handoffBoxId'), /n > 0 \? houseId \+ '-' \+ n : houseId/);
  assert.match(RULES, /\[0-9a-f\]\{64\}\(-\[1-3\]\)\?/, 'ルールのIDの形も枝番を許すこと');
  /* at に max(ats) を入れると、旧い端末が0まいめを新しいものと取りちがえる */
  assert.match(grab(APP, 'posterCfgOut'), /at: ms\(ats\[0\]\)/,
    'at は 0まいめの時刻にすること（max にしないこと）');
  const out = normalizeConfigHarness({ poster: { ats: [0, 0, 30, 0] } });
  assert.deepEqual(out.poster.ats, [0, 0, 30, 0], '前が空でも3まいめは3まいめのまま');
  assert.equal(out.poster.at, 0);
});

/* 文字列を見るだけの検査は、**呼び出し経路の欠落を見つけられない**。
   ここは実際に組み立てて、出てくる HTML を見る。 */
function posterPanelHarness(urls, ats, sharing){
  return new Function(`
    let config = { poster: { label:'', at: ${JSON.stringify(ats[0] || 0)}, ats: ${JSON.stringify(ats)} } };
    let posterURLs = ${JSON.stringify(urls)};
    function ms(v){ const n = Number(v); return Number.isFinite(n) && n > 0 ? n : 0; }
    function esc(s){ return String(s == null ? '' : s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;'); }
    function sharingOn(){ return ${sharing ? 'true' : 'false'}; }
    function getLocal(){ return ''; }
    function fmtDate(){ return ''; }
    function fmtTime(){ return ''; }
    const K_POSTER_SENT = 'x';
    ${grabConst(APP, 'POSTER_MAX')}
    ${grabConst(APP, 'POSTER_LABEL_DEFAULT')}
    ${grab(APP, 'posterCfg')}
    ${grab(APP, 'posterAtsFrom')}
    ${grab(APP, 'posterHere')}
    ${grab(APP, 'posterFreeSlot')}
    function icon(){ return '<svg></svg>'; }
    ${grab(APP, 'posterTileHTML')}
    ${grab(APP, 'posterSectionHTML')}
    return posterSectionHTML();
  `)();
}

test('保護者ページの写真は、ます目で見せて縦を使いすぎない', ()=>{
  /* 行にすると1枚95px（320px 実測）で、4枚で380px。設定の欄ひとつに
     その縦は使えない。ます目にして、押す先は絵とゴミ箱の2つだけにする。 */
  const tiles = html => (html.match(/<figure class="poster-tile/g) || []).length;

  const none = posterPanelHarness(['', '', '', ''], [0, 0, 0, 0], true);
  assert.equal(tiles(none), 0, '1枚も無いときは、ます目を出さないこと');
  /* 番号とゴミ箱は写真の上にかさねる。下に並べると1ますが158pxになり
     （375px 実測）、行で出していたころより縦を食う。 */
  assert.match(STYLE, /\.poster-tile-nth\{[\s\S]{0,120}position:absolute/);
  assert.match(STYLE, /\.poster-tile-del\{[\s\S]{0,160}position:absolute/);
  assert.match(none, /id="posterPick"[\s\S]{0,160}写真を選ぶ/, 'はじめの1枚は「選ぶ」にすること');

  /* 3枚目だけが残っている＝2枚目を消したあと。**番号は動かない** */
  const gap = posterPanelHarness(['', '', 'blob:c', ''], [0, 0, 30, 0], true);
  assert.equal(tiles(gap), 1, '空いた枠は出さないこと');
  assert.match(gap, /class="poster-tile-nth">3枚目</, '前が空いても3枚目は3枚目のままにすること');
  assert.doesNotMatch(gap, /まいめ/, '保護者ページに子ども画面のかな表記を持ちこまないこと');
  assert.match(gap, /写真を足す/, '2枚めからは「足す」にすること');

  /* 満杯。押した先で断るしかない入口は出さない */
  const full = posterPanelHarness(['a', 'b', 'c', 'd'], [1, 2, 3, 4], true);
  assert.equal(tiles(full), 4);
  assert.doesNotMatch(full, /id="posterPick"/, '空き枠が無いときは足す入口を出さないこと');

  /* まだ来ていない枠は、押せるように見せない（押しても待つしかない） */
  const away = posterPanelHarness(['a', '', '', ''], [1, 2, 0, 0], true);
  assert.match(away, /is-away[\s\S]{0,200}poster-tile-wait/, '来ていない枠は待ちの印にすること');
  assert.doesNotMatch(away, /data-poster-pick="1"/, '来ていない枠を押せるように見せないこと');

  /* **平常の画面に、渡す・受け取るを出さない。** ふだんは自動で届く。
     立て直しの操作は使い方ウインドウの「うまく届かないとき」にある。 */
  for(const html of [none, gap, full, away]){
    assert.doesNotMatch(html, /id="posterSend"|id="posterTake"/,
      '平常の画面に、うまくいかないとき用のボタンを出さないこと');
    assert.doesNotMatch(html, /預かり箱/, '利用者が知らなくてよい仕組みの名前を出さないこと');
  }

  /* 共有の説明も平常画面から外し、写真専用の i に集める */
  assert.doesNotMatch(away, /共有しているほかの端末へ自動で届きます/);
  const solo = posterPanelHarness(['a', '', '', ''], [1, 0, 0, 0], false);
  assert.doesNotMatch(solo, /共有を使っていないため、この端末の中だけで使います/);
  const photoHelp = INDEX.slice(INDEX.indexOf('id="posterHelpDialog"'), INDEX.indexOf('id="posterDialog"'));
  assert.match(photoHelp, /共有していれば、ほかの端末へ自動で渡ります/,
    '共有中の動きは写真の説明ダイアログで案内する');

  /* 写真だけの補足は見出し行の白い i から開く。戻り口とは役割を分ける */
  assert.match(full, /<div class="sec-head has-help"><h2>宿題の一覧の写真<\/h2>[\s\S]{0,260}id="posterHelp"[\s\S]{0,320}<\/div><div class="paper">/);
  assert.doesNotMatch(full, /<div class="adult-section-tools">[\s\S]{0,240}id="posterHelp"/,
    'ヘルプを紙の末尾の戻り口と混在させないこと');
});

/* 子ども画面の見え方も、実際に組み立てて見る。1枚のときに「1まいめ」が
   出てしまうと、これまで1枚で使ってきた家庭の画面が勝手に変わる。 */
function posterViewHarness(urls){
  return new Function(`
    let config = { poster: { label:'', at:0, ats:[0,0,0,0] } };
    let posterURLs = ${JSON.stringify(urls)};
    let posterFresh = true;
    const body = { innerHTML:'' };
    const title = { textContent:'' };
    const dialog = { open:false, showModal(){ this.open = true; }, setAttribute(){} };
    const toasts = [];
    function $(sel){ return sel === '#posterDialog' ? dialog : sel === '#posterBody' ? body : title; }
    function toast(t){ toasts.push(t); }
    function ms(v){ const n = Number(v); return Number.isFinite(n) && n > 0 ? n : 0; }
    function esc(s){ return String(s == null ? '' : s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;'); }
    ${grabConst(APP, 'POSTER_MAX')}
    ${grabConst(APP, 'POSTER_LABEL_DEFAULT')}
    ${grab(APP, 'posterCfg')}
    ${grab(APP, 'posterAtsFrom')}
    ${grab(APP, 'posterWord')}
    ${grab(APP, 'openPoster')}
    openPoster();
    return { html: body.innerHTML, opened: dialog.open, toasts, fresh: posterFresh };
  `)();
}

test('子ども画面の写真は縦にならべ、1枚のときは見出しを出さない', ()=>{
  const one = posterViewHarness(['blob:a', '', '', '']);
  assert.equal((one.html.match(/<img /g) || []).length, 1);
  assert.doesNotMatch(one.html, /まいめ/, '1枚のときは「1まいめ」を出さないこと');
  assert.equal(one.opened, true);
  assert.equal(one.fresh, false, '開いたら未読の印を落とすこと');

  /* 2まいめが空でも、出るのは「1まいめ」「2まいめ」＝**見えている順**。
     枠の番号ではなく、並んでいる順で数えないと、子どもが数えて食いちがう */
  const gap = posterViewHarness(['blob:a', '', 'blob:c', '']);
  assert.equal((gap.html.match(/<img /g) || []).length, 2);
  assert.match(gap.html, /1まいめ[\s\S]*2まいめ/);
  assert.doesNotMatch(gap.html, /3まいめ/);

  const none = posterViewHarness(['', '', '', '']);
  assert.equal(none.opened, false, '1枚も無いときは開かないこと');
  assert.deepEqual(none.toasts, ['まだ とどいていないよ']);
});

/* 合図が 0 に戻ったのに端末の中の写真を残すと、保護者が消したのに
   子どもの画面には出つづける。ここが写真の墓標にあたる。 */
test('消された写真は、受け取り側の端末からも落とす', ()=>{
  const drop = grab(APP, 'dropRemovedPosters');
  assert.match(drop, /if\(cfg\.ats\[slot\] \|\| !held\[slot\]\) continue;/,
    '控えが 0 の枠は「消された」ではなく「まだ知らない」として扱うこと');
  /* 共有していない端末では、食いちがいがそもそも起きない。ここを開けておくと
     設定がまだ育っていない場面で、端末にある写真を消す（実機で実際に消えた）。 */
  assert.match(drop, /if\(!sharingOn\(\) \|\| !S\) return false;/,
    '共有していない端末では何もしないこと');
  /* つないだ直後の1回はグループの設定が勝つ決まり。その前の初期値（印が無い）を
     「消された」と読むと、いま撮ったばかりの写真が消える。 */
  assert.match(drop, /S\.awaitingFirstSnapshot\(\)\) return false;/,
    'グループの設定を受け取る前に判断しないこと');
  assert.match(drop, /const S = sync\(\);/,
    '素の S を書かないこと（ReferenceError で関数が丸ごと止まる）');
  assert.match(drop, /await lib\.remove\(posterId\(slot\)\)/);
  assert.match(grab(APP, 'posterArrivalRun'), /await dropRemovedPosters\(\)/,
    '受け取りの前に、消されたぶんを落とすこと');
});

test('受け渡し箱へ書くのは暗号文で、期限を必ず付ける', ()=>{
  const put = grab(SYNC, 'putHandoff');
  assert.match(put, /photo: await encryptField\('photo', getCode\(\)/,
    '写真も合言葉の鍵で包むこと');
  assert.match(put, /expiresAt: new Date\(now \+ HANDOFF_MS\)/,
    '消し忘れが残らないよう、期限を必ず付けること');
  assert.match(grab(SYNC, 'putHandoff'), /async function putHandoff\(dataURL, slot\)/,
    '枠を受け取ること');
  assert.match(RULES, /match \/photo_handoff\/\{boxId\}/, 'ルールに受け渡し箱を足すこと');
  assert.match(RULES, /allow delete:\s+if request\.auth != null && validHandoffId\(boxId\);/,
    '受け取った側が片づけられるよう、この箱だけ delete を許すこと');
  assert.match(RULES, /notRetired\(handoffHouse\(boxId\)\)/,
    '枝番から グループIDを取り出して、墓標を見ること');
});

/* run() は「書けた」を true で返すので、req.result が undefined のときも
   true になる。put / remove では正しいが、get では「キーが無い」まで true に
   なる。1枚だけのころは当たらなかったが、4つの枠を順に見にいったとたん
   createObjectURL(true) で表に出た。 */
test('端末の中に無い写真は、あるふりをせず null で返す', ()=>{
  assert.match(grab(PHOTOS, 'get'),
    /\.then\(v=> \(typeof Blob !== 'undefined' && v instanceof Blob\) \? v : null\)/,
    'Blob でないものは null にすること（run の true をそのまま通さない）');
});

test('縮めても収まらない写真は、荒くして通さずに断る', ()=>{
  assert.match(PHOTOS, /const MAX_BYTES = 500 \* 1024;/);
  assert.match(PHOTOS, /if\(blob && blob\.size <= MAX_BYTES\) return \{ blob/,
    '上限に収まったものだけ通すこと');
  assert.match(grab(PHOTOS, 'shrink'), /return null;\s*\}$/,
    'どうしても収まらないときは null を返して、呼ぶ側に断らせること');
  assert.doesNotMatch(INDEX, /accept="image\/\*,image\/heic"/,
    'accept に image/heic を書かないこと（Safari 17以降、逆にHEICへ変換される）');
});

/* 配信するスクリプトを まるごと 読ませて、構文を 確かめる。
   ほかのテストは grab() で関数を切り出して見るので、**ファイル全体の
   構文エラーは通り抜ける**。実際、文字列の中に生の改行が入って
   app.js が丸ごと動かなくなったのに、テストは全部通った。
   壊れたら画面が真っ白になるところなので、ここで止める。 */
test('配信するスクリプトは、まるごと構文が通る', ()=>{
  const files = { 'app.js':APP, 'photos.js':PHOTOS, 'sync.js':SYNC, 'data.js':DATA };
  for(const [name, src] of Object.entries(files)){
    assert.doesNotThrow(()=> new vm.Script(src, { filename:name }), name + ' の構文が通ること');
  }
});

/* 受け渡し箱は TTL（コンソール側の設定）にも守られるが、**TTL が無くても
   溜まらない**ようにする。権限などでTTLを作れない家庭でも運用できること。 */
test('古い受け渡し箱は、アプリ側でも片づける', ()=>{
  const sweep = grab(SYNC, 'sweepHandoffSlot');
  assert.match(sweep, /if\(at && Date\.now\(\) - at < HANDOFF_MS\) return false;/,
    '期限より新しい箱は消さないこと');
  assert.match(sweep, /return await clearHandoff\(slot\);/);
  assert.match(grab(SYNC, 'sweepHandoff'),
    /for\(let slot = 0; slot < HANDOFF_SLOTS; slot\+\+\)/, '枠ぜんぶを見ること');
  /* **「渡す」を人に押させないための仕組み。** 保護者ページを開いたときに、
     この端末が持っていて箱に無いぶんを入れ直す。これで箱はいつでも埋まり、
     どの端末でも開けば届く（＝即時と要操作の分かれ道が消える）。 */
  const refresh = grab(APP, 'refreshHandoff');
  assert.match(refresh, /boxes = await S\.handoffAts\(\)/, '4つの枠の状態を1度に見ること');
  assert.match(refresh, /if\(at > 0 && !stale\) continue;/, 'まだ生きている箱に書かないこと');
  assert.match(refresh, /if\(dataURL\) await S\.putHandoff\(dataURL, slot\);/);
  assert.match(refresh, /if\(!cfg\.ats\[slot\]\)\{[\s\S]{0,180}clearHandoff\(slot\)/,
    '共有から外れた枠の箱は片づけること');
  assert.match(grab(APP, 'bindConfig'), /if\(\$\('#posterFile'\)\) refreshHandoff\(\);/,
    '保護者ページを開いたときだけ走らせること');
  /* 受け取っても消さない。消すと、まだ受け取っていない端末が取り逃がす。 */
  assert.doesNotMatch(grab(APP, 'posterArrivalRun'), /clearHandoff/,
    '受け取った側が箱を消さないこと（期限と入れ直しに任せる）');
  assert.match(grab(SYNC, 'handoffAts'), /at = Number\(\(snap\.data\(\) \|\| \{\}\)\.at\) \|\| 0;/,
    '中身は読まず、いつ入れたかだけを見ること');
});

/* このコードベースの `S` はグローバルではなく、使う関数ごとに
   `const S = window.NatsuSync;` と宣言する約束。素で書くと ReferenceError で
   **その関数が丸ごと止まる**。実際、bindConfig の先頭で書いてしまい、
   保護者ページの設定（名前・タイトル・日付・デザイン・共有）が
   すべて効かなくなった。写真まわりは sync() を通す。 */
test('同期を使う関数は、必ず S を宣言してから使う', ()=>{
  for(const name of ['checkPosterArrival','handPoster','savePosterFile','bindConfig','removePoster']){
    const fn = grab(APP, name);
    if(!/[^.\w]S\./.test(fn)) continue;
    assert.match(fn, /const S = (sync\(\)|window\.NatsuSync);/,
      name + ' は S を宣言してから使うこと（素の S は ReferenceError になる）');
  }
  assert.match(grab(APP, 'sync'), /return window\.NatsuSync \|\| null;/);
});

/* 渡すたびに 印の時刻を 更新しないと、相手から見て「新しいものがある」ことに
   ならず、自動では取りに行かない。実機で「渡せているのに子端末が受け取らない」
   という形で出た。手で押す「写真を受け取る」も用意し、結果をそのまま伝える。 */
test('渡し直したら合図も更新し、手で受け取る道も残す', ()=>{
  const bind = grab(APP, 'bindConfig');
  const hand = grab(APP, 'posterHandAll');
  assert.match(hand, /if\(!await handPoster\(\)\) return;[\s\S]{0,460}config\.poster = posterCfgOut\(posterCfg\(\)\.label, ats\);[\s\S]{0,40}saveCfg\(\);/,
    '渡せたときは印の時刻も更新すること');
  /* 持っていない枠の合図を進めると、ほかの端末が空の箱を取りに行く */
  assert.match(hand, /if\(!posterURLs\[slot\]\) continue;/,
    '進めるのは、この端末にある枠だけにすること');
  const take = grab(APP, 'posterTakeAll');
  assert.match(take, /checkPosterArrival\(\{ force:true, quiet:true \}\)/,
    '手で押したときは間引きを飛ばし、知らせは大人向けの言い方で呼んだ側が出すこと');
  assert.match(take, /写真を' \+ r\.got \+ '枚 受け取りました/, '結果は枚数で言うこと');
  assert.match(take, /写真のある端末でこの画面を開いてから/,
    '見つからないときは、次にすることをその場で言うこと');
  assert.doesNotMatch(take, /預かり箱/, '利用者が知らなくてよい仕組みの名前を出さないこと');
  /* **bindConfig で つながないこと。** ダイアログは描き直しで作り直されないので、
     束ねが積み重なり、1回のタップで何度も走る。document へ一度だけ。 */
  assert.doesNotMatch(bind, /#posterSend|#posterTake/,
    'ダイアログのボタンを、描き直しのたびに走る場所でつながないこと');
  assert.match(APP, /if\(e\.target\.closest\('#posterSend'\)\)\{ posterHandAll\(\); return; \}/);
  assert.match(APP, /if\(e\.target\.closest\('#posterTake'\)\)\{ posterTakeAll\(\); return; \}/);
  assert.doesNotMatch(APP, /もう一度わたす/, '画面に無いボタンの名前で案内しないこと');
  const check = grab(APP, 'posterArrivalRun');
  assert.match(check, /if\(force \|\| want\[slot\] > held\[slot\]\) slots\.push\(slot\);/);
  assert.match(check, /return \{ status:'empty', got:0, missing:slots\.length \};/,
    '箱が空のときは、そう分かる形で返すこと');
  /* 走っている あいだ 'skip' を返すと、押しても何も起きないように見える。
     枠が4つになって1回が4往復になり、この窓が4倍ひろがった。 */
  assert.match(grab(APP, 'checkPosterArrival'), /try\{ await posterRun; \}catch\(e\)\{\}/,
    '人が押したときは、走っているぶんを待ってからやり直すこと');
});

/* ミニコンテンツは カウントダウンの下（まいにちの上）に置き、きょうのぶんを
   引き切ったら **その場で畳む**。下へ送らない（置き場所が動くと、毎日おぼえた
   ところが変わる）。きょう読んだぶんは ◀▶ でたどれるので、「読み終わったか」を
   当てる必要が無い。新しく引ける数は これまでどおり上限でしばる。 */
/* 実機で2度 報告された道を、そのまま組み立てて確かめる。

   きょうのぶんを読み切った状態（left === 0）で「どんないきものかな？」を押すと、
   カードが差し替わる。このとき open を left で決めていたため、**開いて見ていた
   カードが畳まれた**。◀▶ も同じ場面でしか押されないので、同じように畳まれる。
   文字列を見るだけの検査では、この「組み立て直したら閉じている」は捕まらない。 */
function funOpenStateHarness(left, cardOpen){
  return new Function(`
    const FUN = [{t:'めずらしい生きもの', q:'とい', a:'こたえ', ask:'どんないきものかな？'},
                 {t:'まめちしき', q:'とい2', a:'こたえ2'},
                 {t:'ことば', q:'とい3', a:'こたえ3'}];
    const FUN_MAX = 3;
    let funIdx = 0, funOpen = true, funPos = -1;
    const seen = [0, 1, 2];
    function funToday(){ return { seen, history:seen }; }
    function funLimit(){ return seen.length + ${Number(left)}; }
    function didSomethingToday(){ return false; }
    function clamp(n,a,b){ return Math.max(a, Math.min(b, n)); }
    function esc(x){ return String(x); }
    function rubyHTML(x){ return String(x); }
    function kanjiOriginHTML(){ return ''; }
    const document = { querySelector(){ return ${cardOpen === null ? 'null' : '{ open: ' + (cardOpen ? 'true' : 'false') + ' }'}; } };
    ${grab(APP, 'funHTML')}
    return funHTML();
  `)();
}

/* `state.fun`（あと何回引けるか）は stripLocal で同期から外して端末ごとに数えて
   いるのに、`reads` は共有される。この非対称のせいで、保護者が自分の端末で読んだ
   ぶんまで子どものカレンダーに並んでいた（実機の指摘）。記録（logs）の by と
   同じ決めかたにそろえ、子ども画面は子どものぶんだけにする。 */
function readsHarness(rows, key, adult){
  return new Function(`
    let state = { reads: ${JSON.stringify(rows)} };
    function dayKey(d){ return d.toISOString().slice(0, 10); }
    function esc(x){ return String(x); }
    function rubyHTML(x){ return String(x); }
    ${grab(APP, 'readsOf')}
    ${grab(APP, 'readsHTML')}
    return readsHTML(${JSON.stringify(key)}, ${adult ? 'true' : 'false'});
  `)();
}

test('読んだものは、子ども画面には子どものぶんだけ出す', ()=>{
  const day = '2026-08-22';
  const rows = [
    { id:'a', at: day + 'T01:00:00.000Z', t:'まめちしき', q:'こどもが読んだ', by:'child' },
    { id:'b', at: day + 'T02:00:00.000Z', t:'ことば',     q:'おやが読んだ',   by:'parent' },
    { id:'c', at: day + 'T03:00:00.000Z', t:'なぞなぞ',   q:'むかしの記録' },
    { id:'d', at: '2026-08-21T01:00:00.000Z', t:'ことば', q:'べつの日',      by:'child' }
  ];

  const child = readsHarness(rows, day, false);
  assert.match(child, /こどもが読んだ/);
  assert.doesNotMatch(child, /おやが読んだ/, '保護者が読んだぶんを子ども画面に混ぜないこと');
  assert.match(child, /むかしの記録/, '古いひかえ（by が無い）は子どもあつかいにすること');
  assert.doesNotMatch(child, /べつの日/, 'その日のぶんだけ出すこと');
  assert.match(child, /<span class="reads-cnt">2こ<\/span>/);
  /* 出す相手を決めるのは readsOf、印の付けかたを決めるのは readsHTML。
     決めごとを2か所に持たないので、子ども画面には保護者の行そのものが来ない。 */
  assert.doesNotMatch(child, /reads-by/, '子ども画面に「だれが」の印を出さないこと');

  const adult = readsHarness(rows, day, true);
  assert.match(adult, /こどもが読んだ/);
  assert.match(adult, /おやが読んだ/, '保護者ページには両方出すこと');
  assert.match(adult, /<span class="reads-cnt">3こ<\/span>/);
  /* 子どものぶんが "ふつう" なので、印を付けるのは保護者のぶんだけ
     （全行に印がならぶと、かえって読みにくい。logs の logByLabel と同じ規則） */
  assert.equal((adult.match(/reads-by/g) || []).length, 1, '印は保護者のぶんだけにすること');
  assert.match(adult, /おやが読んだ[\s\S]{0,80}<span class="reads-by">（親）<\/span>/);

  /* 記録するときに、その端末の役割を残す */
  assert.match(grab(APP, 'pushRead'), /by: logBy\(\)/, '記録と同じ決めかたで by を残すこと');
  /* 子ども画面の2か所は、どちらも子どものぶんだけ。カレンダーの日別詳細は
     子ども画面という前提なので、保護者のぶんは出さない（依頼者の裁定）。 */
  assert.match(grab(APP, 'viewLog'), /\$\{readsHTML\(k\)\}/);
  assert.match(grab(APP, 'calDetailHTML'), /const reads = readsHTML\(key\);/);
  assert.match(grab(APP, 'parentTodayLogsHTML'), /\$\{readsHTML\(k, true\)\}/,
    '保護者ページの「今日の記録」にだけ、両方を出すこと');
});

/* 送りだけのときは行の右に117px（320px 実測）が空き、印が左に取り残されて見える。 */
test('送りの印は、ひとつだけのときは中央に置く', ()=>{
  assert.match(STYLE, /\.fun-row > \.fun-pager:only-child\{ margin-inline:auto; \}/,
    '送りだけのときは中央にすること');
  assert.match(STYLE, /\.fun-row\{[\s\S]{0,200}justify-content:space-between/,
    '「つぎの はなし」もあるときは、送りを左・すすむ先を右に振り分けること');
});

test('読み切ったあとに答えを見ても、箱は畳まれない', ()=>{
  const hasOpen = html => /^\s*<details class="paper fun fun-fold" data-details-key="funBox" open>/.test(html);

  /* 実機の道：きょうのぶんを読み切って（left = 0）、開いたまま見ている */
  assert.equal(hasOpen(funOpenStateHarness(0, true)), true,
    '開いて見ているなら、引けるぶんが無くても開いたままにすること');
  /* 人が畳んだのなら畳んだまま */
  assert.equal(hasOpen(funOpenStateHarness(0, false)), false,
    '人が畳んだものを、勝手に開かないこと');
  /* はじめて描くとき（カードがまだ無い）だけ、引けるぶんで決める */
  assert.equal(hasOpen(funOpenStateHarness(1, null)), true,
    'まだ引けるぶんがあれば、はじめから開いておくこと');
  assert.equal(hasOpen(funOpenStateHarness(0, null)), false,
    '引けるぶんが無ければ、はじめは畳んでおくこと');
});

test('ミニコンテンツは上に置き、引き切ったらその場で畳む', ()=>{
  const home = grab(APP, 'viewHome');
  const funAt = home.indexOf('${funHTML()}');
  assert.ok(funAt > 0 && funAt < home.indexOf('${dailySec}'), 'まいにちより上に置くこと');
  const fun = grab(APP, 'funHTML');
  /* **開閉は画面の事実から取る。** 「あと何回引けるか」で決めると、きょうのぶんを
     読み切った瞬間に left が 0 になり、次に組み直したときに畳まれる。読み返しの
     ◀▶ はまさにその場面で押される。はじめて描くときだけ left で決める。 */
  assert.match(fun, /const openAttr = \(shownCard \? shownCard\.open : left > 0\) \? ' open' : '';/,
    '出ているカードが開いていれば、開いたままにすること');
  assert.match(fun, /const shownCard = typeof document !== 'undefined' \? document\.querySelector\('\.fun'\) : null;/);
  assert.match(fun, /data-details-key="funBox"/, '人が開いたら、描き直しても開いたままにすること');
  assert.match(fun, /data-fun="prev"/, 'きょう読んだぶんをたどれること');
  /* **開いているかどうかを引きつぐこと。** funHTML() の open は「新しく引ける
     ぶんがあるか」だけで決まるので、きょうのぶんを読み切ったあと（left === 0）に
     差し替えると、開いて見ていたカードが畳まれる。実機で「さいごの話の答えを
     見ようとすると畳まれる」という形で出た。detailsKey の記憶は render() の
     ときしか働かないので、ここでは自分で引きつぐ。 */
  assert.match(APP, /const wasOpen = card\.open;\s*\n\s*card\.outerHTML = funHTML\(\);\s*\n\s*const next = \$\('\.fun'\);\s*\n\s*if\(next\) next\.open = wasOpen;/,
    'カードを差し替えるときに、開いた状態を引きつぐこと');
  /* 四角いボタンに三角をのせない。紙のカードの上で面が2つ並ぶと、
     何のボタンか分からないまま場所をとる（実機の指摘）。 */
  assert.doesNotMatch(fun, /fun-nav[^>]*>◀|fun-nav[^>]*>▶/, '三角の字をボタンに置かないこと');
  assert.match(fun, /<span class="fun-nav-mark" aria-hidden="true"><\/span>/);
  assert.match(fun, /<span class="fun-pos">/, 'いま何番目かを出すこと');
  assert.match(STYLE, /\.fun-nav\{[\s\S]{0,200}background:transparent;[\s\S]{0,60}border-color:transparent/,
    '送りの印は面を持たないこと');
  assert.match(STYLE, /\.fun-nav-mark\{[\s\S]{0,200}chevron\.svg/,
    '畳みの印と同じ山形を回して使うこと（形を増やさない）');
  assert.match(fun, /const shown = funOpen \|\| !atEnd;/,
    '前に読んだものは、答えまで出すこと');
  assert.match(fun, /\$\{shown && atEnd && left > 0/, '新しく引くのは、さいごの1件を見ているときだけ');
});

/* ボタンは 文字色を 自分で 持つこと。受け継ぐ ままだと、濃い帯の 中に
   置いた ときに 白地へ 白文字が のって 消える（保護者ページの「使い方」で
   実際に 起きた）。背景を 決めている 以上、文字色も 対で 決める。 */
test('ボタンは背景と文字色を対で持つ', ()=>{
  assert.match(STYLE, /\.btn\{[^}]*background:var\(--kami\);[\s\S]{0,200}color:var\(--ai\);/,
    '.btn は文字色も指定すること');
  /* .icon-btn も 同じ 落とし穴を 持っていた（背景だけ 決めて 文字色は 親から）。
     見出しの 帯へ「?」を 置いた ことで、実際に 当たる 位置に なった */
  assert.match(STYLE, /\.icon-btn\{[^}]*background:var\(--kami\);[\s\S]{0,240}color:var\(--ai\);/,
    '.icon-btn も文字色を指定すること');
});

/* 一覧の写真の ボタンの 名前は **任意**。入れて いない 家庭では 帯に 印だけを
   出す。既定の 語で 埋め戻すと、消した つもりの 名前が 戻って くる。 */
test('一覧の写真のボタンの名前は、空のままにできる', ()=>{
  const out = normalizeConfigHarness({ poster: { at: 1755000000000 } });
  assert.equal(out.poster.label, '', '入れていない名前を既定の語で埋めないこと');
  assert.equal(normalizeConfigHarness({ poster: { label:'ぷりんと', at: 1 } }).poster.label, 'ぷりんと');
  assert.doesNotMatch(grab(APP, 'posterCfg'), /POSTER_LABEL_DEFAULT/,
    'posterCfg は 入っている値だけを返すこと');
  assert.match(grab(APP, 'posterWord'), /posterCfg\(\)\.label \|\| POSTER_LABEL_DEFAULT/,
    '読み上げ・見出し・知らせにだけ、既定の語を使うこと');
  const render = grab(APP, 'renderPosterButton');
  assert.match(render, /text\.textContent = cfg\.label;/, '帯には既定の語を出さないこと');
  const open = grab(APP, 'openPoster');
  assert.match(open, /const many = here\.length > 1;/, '1枚のときは、これまでと同じ見え方にすること');
  assert.match(open, /まいめ/, '2枚以上のときだけ、何まいめかを出すこと');
  assert.match(render, /classList\.toggle\('has-name', !!cfg\.label\)/);
  assert.match(STYLE, /\.topband-poster-txt:empty\{ display:none; \}/,
    '名前が空のときは、言葉の欄ごと出さないこと');
  const bind = grab(APP, 'bindConfig');
  assert.match(bind, /const label = String\(e\.target\.value \|\| ''\)\.trim\(\)\.slice\(0, 6\);/,
    '空欄のまま保存できること（既定の語で埋め戻さない）');
  assert.match(bind, /config\.poster = posterCfgOut\(label, posterCfg\(\)\.ats\);/,
    '名前だけ変えたときに、枠ごとの合図を落とさないこと');
});

/* 差しかえた 写真を 手で 受け取れるように する。以前は「この端末に 写真が
   無い」ときにしか ボタンを 出して いなかったので、**すでに 1枚 持っている
   端末は 差しかえを 手で 取りに 行けなかった**（自動でしか 届かない）。 */
test('受け取りは、足りないぶんを一度にまとめて扱う', ()=>{
  /* 何回押せばいいのかを数えさせない（実機の指摘）。以前は「この端末に写真が
     無いとき」しか道が無く、差しかえを手で取りに行けなかった。 */
  const check = grab(APP, 'posterArrivalRun');
  assert.match(check, /for\(const slot of slots\)\{/, '足りない枠をまとめて見にいくこと');
  assert.doesNotMatch(grab(APP, 'posterSectionHTML'), /!here && cfg\.at && sharingOn\(\)/,
    '持っていない端末に限らないこと');
  assert.match(grab(APP, 'posterSectionHTML'), /const add = free >= 0/,
    '空き枠があるときだけ、足す入口を出すこと');
});

/* 使い方は円内の i の印から開く。中身は 丸数字の 3手順と、3コマの 図と、
   **写真が どこに あるのか**の 一段。画面には 操作だけを 置き、説明は
   ここへ 寄せる（欄の 縦を 短く 保つため）。 */
test('一覧の写真の使い方は、丸数字と図と保存場所で伝える', ()=>{
  assert.match(grab(APP, 'posterSectionHTML'),
    /<button class="adult-section-head-help" id="posterHelp"[\s\S]{0,280}aria-label="宿題の一覧の写真の使い方"[\s\S]{0,180}<span class="adult-section-head-info" aria-hidden="true">i<\/span>/,
    'ヘルプはタイトル行の白い円内の i で示すこと');
  assert.match(STYLE, /\.adult-section-head-info\{[\s\S]{0,180}color:var\(--ai\); background:var\(--kami\)/,
    'i は濃い帯の上で白い塗りつぶし円として見せること');
  /* **押したら 開くこと。** 欄を 整理したときに 開く側の束ねだけが消え、
     形は正しいのに 押しても開かない、という状態を実機で踏んだ。
     「関数が正しい」と「関数が呼ばれる」は別。開閉と中身は同じ場所にまとめる。 */
  assert.match(APP, /if\(e\.target\.closest\('#posterHelp'\)\)\{[\s\S]{0,200}showModal/,
    '「i」から開く道を、開閉と同じ場所に置くこと');
  assert.match(APP, /if\(e\.target\.closest\('#posterHelpClose'\)\)\{/);
  const help = INDEX.slice(INDEX.indexOf('id="posterHelpDialog"'), INDEX.indexOf('id="posterDialog"'));
  const nums = help.match(/class="poster-step-num" aria-hidden="true">(\d)</g) || [];
  assert.deepEqual(nums.length, 3, '手順は3つにすること');
  /* 図の 中の 言葉は **HTML の まま** 置く。SVG の <text> に 入れると、
     図を 画面幅に 合わせて 縮めた ぶん 字も 縮み、320px では 6px ほどに なって
     読めなかった（実測 224px ／ 縮尺 0.49）。 */
  const fig = help.slice(help.indexOf('<figure class="poster-figure">'), help.indexOf('</figure>'));
  assert.ok(fig.length > 0, '3コマの図を置くこと');
  assert.doesNotMatch(fig, /<text[\s>]/, '図の中の言葉を SVG の <text> に入れないこと（字まで縮む）');
  assert.equal((fig.match(/<b>/g) || []).length, 3, '3つの場所の名前を HTML の文字で置くこと');
  assert.equal((fig.match(/<svg /g) || []).length, 5, '絵（3つ）と矢印（2つ）だけを SVG にすること');
  for(const one of fig.match(/<svg [\s\S]*?<\/svg>/g) || []){
    assert.match(one, /aria-hidden="true"/, '絵は読み上げの対象にしないこと');
  }
  /* 絵は aria-hidden だが、**3つの場所の名前は HTML の文字**なので
     読み上げでも中身は伝わる。図の下に同じ話を重ねて置かない。 */
  assert.doesNotMatch(fig, /<figcaption>/, '図の下に、絵と同じ話を重ねて書かないこと');
  assert.match(fig, /<b>保護者の端末<\/b>[\s\S]*<b>クラウド<\/b>[\s\S]*<b>子どもの端末<\/b>/,
    '経路の3つの場所を、文字で置くこと');
  /* 利用者は「箱に入れる」という実質の動作を関知しない。図でも仕組みの名前を
     出さず、要点の一覧と同じ「クラウド」で通す（依頼者の指示）。 */
  assert.doesNotMatch(help, /あずかり箱|預かり箱/, '仕組みの名前を画面に出さないこと');
  assert.match(fig, /stroke="currentColor"/, '図の色は currentColor だけで描くこと（6テーマに追従する）');
  assert.doesNotMatch(help, /<image|xlink:href/, '外部の画像を読み込まないこと');
  /* うしろに ある .poster-dialog と 詳細度が 同じ だと、幅の 指定が 負けて
     効かない（768px で 実測 724px に なっていた） */
  assert.match(STYLE, /\.poster-dialog\.poster-help\{ width:min\(94vw, 560px\); \}/,
    '使い方の幅は .poster-dialog を名指しして勝たせること');
  assert.match(STYLE, /\.poster-help \.poster-head\{[\s\S]{0,160}position:sticky/,
    '1画面に収まらないので、とじるは上に留めること');
  assert.match(help, /写真アプリとは別/, '写真がどこにあるのかを書くこと');
  /* 預かり箱の中身は合言葉から作った鍵で包む（sync.js の encryptField）。
     鍵も合言葉もサーバへ送らないので、管理者にも読めない。**言い切れる根拠が
     コードにあることを、ここで結びつけておく。** 実装を弱めたら落ちる。 */
  assert.match(grab(SYNC, 'putHandoff'), /photo: await encryptField\('photo', getCode\(\)/,
    '預かり箱へは暗号文だけを置くこと');
  assert.match(grab(SYNC, 'deriveKey'), /name:'PBKDF2'[\s\S]{0,120}name:'AES-GCM', length:256/,
    '鍵は合言葉から作ること（サーバへ送らない）');
  assert.doesNotMatch(grab(SYNC, 'putHandoff'), /code:|passphrase|getCode\(\),\s*\n\s*at:/,
    '合言葉そのものを預かり箱へ送らないこと');
  /* **「ほかの人に見られないか」への答えは、いちばん先に、一行で。**
     読み進めないと分からないところに置かない（依頼者の指示）。長い説明にしない。 */
  const seal = /<p class="poster-seal"><b>写真は暗号化して送ります。管理側からも中身は見えません。<\/b><\/p>/;
  assert.match(help, seal, '冒頭にひとことで出すこと');
  assert.ok(help.indexOf('poster-seal') < help.indexOf('poster-steps'),
    '手順より先に置くこと');
  const folded = help.slice(help.indexOf('<details class="poster-more">'));
  assert.doesNotMatch(folded, /暗号化/, 'たたんだ中へ入れないこと');
  /* 要点だけ。段落で長く書かない */
  assert.match(help, /<h3 class="poster-sub">写真はどこにあるのか<\/h3>/);
  const facts = help.slice(help.indexOf('<ul class="poster-facts">'), help.indexOf('</ul>'));
  assert.equal((facts.match(/<li>/g) || []).length, 3, '要点は3つに収めること');
  for(const one of facts.split('<li>').slice(1)){
    assert.ok(one.replace(/<[^>]+>/g, '').trim().length <= 60, '1行は短く保つこと: ' + one);
  }
  assert.match(facts, /共有をやめるか写真を消せば、<b>24時間以内に消えます<\/b>/,
    'いつ消えるかを書くこと');
  /* **同じ話を、赤枠・図・箇条書きの3か所に置かない。** 要点だけに絞る */
  assert.doesNotMatch(help, /暗号化ずみ/, '「ずみ」まで書かない');
  assert.doesNotMatch(help, /合言葉は人に見えるところへ書かないでください/,
    '合言葉の注意は共有の設定の側が持つ話なので、ここには置かない');
  assert.doesNotMatch(help, /長い辺を小さくして保存するので/, '仕組みの説明は書かない');
  /* 子どもがどこから見るのかを、保護者ページにも一言。**どのアイコンかを
     字だけで言わない。**帯の入口と同じ印を文の中に置く */
  assert.doesNotMatch(grab(APP, 'posterSectionHTML'),
    /子ども画面の帯の<span class="poster-lab-ico" aria-hidden="true"><\/span>アイコンから見られます/,
    '子ども画面から見る方法も平常画面に重ねない');
  /* 「ボタンの名前」だけでは、どのボタンのことか字から分からない。
     帯の入口と同じ印を、名前の欄の前に出す。 */
  assert.match(grab(APP, 'posterSectionHTML'),
    /<span class="poster-lab-ico" aria-hidden="true"><\/span>ボタンの名前/);
  assert.match(STYLE, /\.poster-lab-ico\{[\s\S]{0,220}sheet\.svg/,
    '帯の入口と同じ抜き型を使うこと');
  assert.match(help, /子ども画面の帯の<span class="poster-lab-ico" aria-hidden="true"><\/span>アイコンから見られます/);
  /* 赤枠と、下の図の枠がくっついていた（実測 0px） */
  assert.match(STYLE, /\.poster-seal\{\s*\n\s*margin:12px 0 14px;/, '赤枠の下に一段あけること');
  /* ふだん使わない立て直しの操作は、たたんだ中へ */
  assert.equal((help.match(/<details class="poster-more">/g) || []).length, 1);
  assert.match(help, /<summary>うまく届かないとき<\/summary>/);
  assert.match(folded, /id="posterSend"[\s\S]{0,200}id="posterTake"/,
    '立て直しのボタンは、たたんだ中に置くこと');
  assert.match(STYLE, /\.poster-step-num\{[\s\S]{0,200}background:var\(--suika\)/,
    '番号は初期設定（.welcome-num）と同じ白抜きの丸にそろえること');
});

/* CSSでは「規則が 在る」と「規則が 勝つ」は 別。同じ 詳細度なら 後ろが 勝つので、
   狭い幅の 指定を 広い幅の 指定より 前に 置くと **まるごと 効かない**。
   実際、360px の .topband-poster は 480px の ブロックに 負けて 死んでいた。 */
test('帯のボタンの幅ごとの指定は、狭いほうを後ろに置く', ()=>{
  const spots = [...STYLE.matchAll(/\.topband-poster\{/g)].map(m => m.index);
  assert.equal(spots.length, 3,
    '基本・480px・360px の3か所だけにすること（散らすと勝ち負けが読めなくなる）');
  const [base, wide, narrow] = spots;
  assert.equal(STYLE.lastIndexOf('@media', base) < STYLE.lastIndexOf('}\n', base), true,
    '基本の指定は @media の外に置くこと');
  assert.ok(STYLE.slice(0, wide).lastIndexOf('@media (max-width:480px)') >
            STYLE.slice(0, wide).lastIndexOf('@media (max-width:360px)'),
    '2つめは 480px のブロックに置くこと');
  assert.ok(STYLE.slice(0, narrow).lastIndexOf('@media (max-width:360px)') >
            STYLE.slice(0, narrow).lastIndexOf('@media (max-width:480px)'),
    '狭い 360px の指定は、480px より後ろのブロックに置くこと');
});

/* 帯の 中の 主従は 題名 ＞ 日づけ＝写真。写真の ボタンを 白の 枠つきに すると、
   題名と 同じ いちばん 強い 見え方に なり、日づけ だけが 一段 引く。 */
test('帯の写真ボタンは、日づけと同じ強さに落とす', ()=>{
  const rule = STYLE.slice(STYLE.indexOf('.topband-poster{'));
  const block = rule.slice(0, rule.indexOf('}') + 1);
  assert.match(block, /color:var\(--on-band-muted\)/, '日づけと同じ色にすること');
  assert.match(block, /border:0/, '題名より強く見える枠を持たせないこと');
  assert.doesNotMatch(block, /border:2px solid var\(--kami\)/);
});

/* しつもん（観察の観点）も宿題のノルマに数える。答えは state.questionAnswers に
   あり progress とは別の欄で合流するので、数えるだけで同期のしかたは変えない。 */
function progHarness(){
  return new Function(`
    let state = { progress:{}, questionAnswers:{} };
    let config = { readingGrade: 2 };
    function getLocal(){ return '{}'; }
    function clamp(n, a, b){ return Math.max(a, Math.min(b, n)); }
    function ms(n){ return Number(n) > 0 ? Number(n) : 0; }
    function dayKey(){ return '2026-08-18'; }
    function streakOf(){ return 0; }
    function wrapOf(p){ return Array.isArray(p.wrap) ? p.wrap.slice(0,2) : [false,false]; }
    const K_QUESTION_ANSWERS = 'k';
    ${grab(APP, 'hasWrap')}
    ${grab(APP, 'localAnswerMap')}
    let answerMapCache = null;
    ${grab(APP, 'answeredQuestionCount')}
    ${grab(APP, 'countsQuestions')}
    ${grab(APP, 'withWrap')}
    ${grab(APP, 'withQuestions')}
    ${grab(APP, 'prog')}
    return {
      prog,
      setAnswers(id, answers){ state.questionAnswers[id] = { answers, at: 1 }; },
      setProgress(id, v){ state.progress[id] = v; }
    };
  `)();
}

test('しつもんは宿題のノルマに数え、番号・段階の表示はそのまま', ()=>{
  const h = progHarness();
  const task = { id:'kansatsu', type:'step', steps:['見る','はかる','かく','まとめる','だす'],
                 questions:['たかさは？','はっぱは？','花は？'] };
  h.setProgress('kansatsu', { steps:[true,true,true,true,false] });
  h.setAnswers('kansatsu', ['ひざ', '', '']);
  const p = h.prog(task);
  assert.equal(p.done, 4, 'だんかいの数はそのまま');
  assert.equal(p.text, '4/5', '「4/5」の表示を変えないこと');
  assert.equal(p.qDone, 1);
  assert.equal(p.qTotal, 3);
  assert.equal(p.allDone, 5, 'ノルマの分子にしつもんを足すこと');
  assert.equal(p.allTotal, 8, 'ノルマの分母にしつもんを足すこと');
  assert.equal(p.isDone, false, 'しつもんが残っていれば完了にしないこと');
});

test('だんかいが全部終わっても、しつもんが残れば完了にしない', ()=>{
  const h = progHarness();
  const task = { id:'k', type:'step', steps:['a','b'], questions:['q1','q2'] };
  h.setProgress('k', { steps:[true,true] });
  h.setAnswers('k', ['こたえ', '']);
  assert.equal(h.prog(task).isDone, false);
  h.setAnswers('k', ['こたえ', 'こたえ2']);
  const done = h.prog(task);
  assert.equal(done.isDone, true, 'すべて答えたら完了にすること');
  assert.equal(done.allDone, 4);
  assert.equal(done.allTotal, 4);
});

test('番号の課題でも、しつもんはノルマに入るが「つぎは」の番号は動かさない', ()=>{
  const h = progHarness();
  const task = { id:'d', type:'count', total:14, unit:'', questions:['q1','q2'] };
  h.setProgress('d', { done:7 });
  h.setAnswers('d', ['あ', 'い']);
  const p = h.prog(task);
  assert.equal(p.done, 7, '「つぎは ⑧」の元になる数を変えないこと');
  assert.equal(p.text, '7/14');
  assert.equal(p.allDone, 9);
  assert.equal(p.allTotal, 16);
  assert.equal(p.isDone, false, '番号が残っていれば完了ではない');
});

test('まいにちの課題には、しつもんをノルマに入れない', ()=>{
  const h = progHarness();
  const task = { id:'m', type:'daily', target:3, targetUnit:'かい', questions:['q1'] };
  h.setProgress('m', { days:{ '2026-08-18': 3 } });
  h.setAnswers('m', ['こたえ']);
  const p = h.prog(task);
  assert.equal(p.allTotal, 3, 'その日ぶんのノルマに、日をまたぐ答えを足さないこと');
  assert.equal(p.isDone, true);
});

test('しつもんの無い課題は、これまでどおりの数え方', ()=>{
  const h = progHarness();
  const task = { id:'p', type:'count', total:6, unit:'まい' };
  h.setProgress('p', { done:6 });
  const p = h.prog(task);
  assert.equal(p.allDone, 6);
  assert.equal(p.allTotal, 6);
  assert.equal(p.isDone, true);
  assert.equal(p.qTotal, 0);
});

test('しつもんの残りは、カードと「つぎは」に出す', ()=>{
  assert.match(grab(APP, 'questionMarkHTML'), /countsQuestions\(t\)/);
  assert.match(grab(APP, 'questionMarkHTML'), /p\.qDone \}\/\$\{p\.qTotal\}|qDone\}\/\$\{p\.qTotal/,
    '答えた数と全部の数を出すこと');
  assert.match(grab(APP, 'taskHTML'), /questionMarkHTML\(t, p\)/);
  const next = grab(APP, 'nextLabel');
  assert.match(next, /if\(i >= 0\) return \{ lead:'つぎは'/,
    'しあげが済んでいるときに空の行き先を返さないこと');
  assert.match(next, /p\.numDone && \(p\.qDone \|\| 0\) < \(p\.qTotal \|\| 0\)/);
  assert.match(next, /wording\('しつもんに こたえる', '問いに答える'\)/);
});

/* 2026-08-22 期間・目標日の呼び名（第一段階）。
   既定値は「今までと1文字も変わらない」ことが最優先の要件なので、
   組み立てた結果の文字列そのものを固定する。 */
const LABEL_WORD_DEFAULTS = {
  periodLabel:       '夏休み',
  periodLabelKana:   'なつやすみ',
  deadlineLabel:     '夏休み終了',
  deadlineLabelKana: 'なつやすみ おわり'
};
function labelWords(config){
  return new Function('config', 'LABEL_DEFAULTS', `
    ${grab(APP, 'periodWord')}
    ${grab(APP, 'deadlineWord')}
    return { periodWord, deadlineWord };
  `)(config, LABEL_WORD_DEFAULTS);
}
function labelNormalizer(){
  return new Function('LABEL_KEYS', 'LABEL_DEFAULTS', 'LABEL_MAX', `
    ${grab(APP, 'normalizeLabel')}
    ${grab(APP, 'normalizeLabelConfig')}
    return normalizeLabelConfig;
  `)(Object.keys(LABEL_WORD_DEFAULTS), LABEL_WORD_DEFAULTS, 12);
}

test('表示のことばの既定は今までの画面と同じ語を組み立てる', ()=>{
  assert.match(APP, /periodLabel:\s+'夏休み',/);
  assert.match(APP, /periodLabelKana:\s+'なつやすみ',/);
  assert.match(APP, /deadlineLabel:\s+'夏休み終了',/);
  assert.match(APP, /deadlineLabelKana:\s+'なつやすみ おわり'/);

  const w = labelWords(Object.assign({}, LABEL_WORD_DEFAULTS));
  assert.equal(w.deadlineWord(true) + 'まで', 'なつやすみ おわりまで', '子どものカウントダウン見出し');
  assert.equal(w.periodWord(true), 'なつやすみ', '子どものペース行');
  assert.equal(w.periodWord(true) + 'は おわりました 🎒', 'なつやすみは おわりました 🎒', '子どもの終了後表示');
  assert.equal(w.periodWord(false) + 'の残り', '夏休みの残り', '保護者ページの残り時間');
  assert.equal(w.periodWord(false) + 'の経過', '夏休みの経過', '保護者ページの経過率');
  assert.equal(w.deadlineWord(false) + 'まで', '夏休み終了まで', '要約のカウントダウン');
  assert.equal(w.periodWord(false) + 'は終了しました', '夏休みは終了しました', '要約の終了後表示');
});

test('呼び名の設定は子ども画面のよみと保護者ページの漢字を分ける', ()=>{
  const w = labelWords({
    periodLabel:'受験勉強', periodLabelKana:'じゅけんべんきょう',
    deadlineLabel:'入試当日', deadlineLabelKana:'にゅうしとうじつ'
  });
  assert.equal(w.deadlineWord(true) + 'まで', 'にゅうしとうじつまで');
  assert.equal(w.periodWord(true), 'じゅけんべんきょう');
  assert.equal(w.deadlineWord(false) + 'まで', '入試当日まで');
  assert.equal(w.periodWord(false) + 'の経過', '受験勉強の経過');

  /* よみを空にしても保存できる。読みを機械で作らない代わりに、
     そのときだけ漢字表記をそのまま出す（画面が空欄にならないこと） */
  const noKana = labelWords({ periodLabel:'受験勉強', periodLabelKana:'', deadlineLabel:'入試当日', deadlineLabelKana:'' });
  assert.equal(noKana.periodWord(true), '受験勉強');
  assert.equal(noKana.deadlineWord(true), '入試当日');
});

test('呼び名を持たない旧データには既定を補い、空欄だけを既定へ戻す', ()=>{
  const normalize = labelNormalizer();

  /* 欄そのものが無い旧設定。ここで既定を補わないと、
     よみが空になって子ども画面だけ漢字へ変わる */
  assert.deepEqual(normalize({}), LABEL_WORD_DEFAULTS, '旧データは今までと同じ表示のままにすること');

  /* 利用者が消した場合。漢字は既定へ戻し、よみは空を許す */
  const cleared = normalize({ periodLabel:'', periodLabelKana:'', deadlineLabel:'', deadlineLabelKana:'' });
  assert.equal(cleared.periodLabel, '夏休み');
  assert.equal(cleared.deadlineLabel, '夏休み終了');
  assert.equal(cleared.periodLabelKana, '');
  assert.equal(cleared.deadlineLabelKana, '');

  /* 前後の空白・改行・全角空白は1つの空白へ寄せる。
     せまい画面ではみ出さないよう長さも切る */
  const messy = normalize({ periodLabel:'  受験\n勉強　まっさかり  ', periodLabelKana:'あ'.repeat(40) });
  assert.equal(messy.periodLabel, '受験 勉強 まっさかり');
  assert.equal(messy.periodLabelKana.length, 12, '長すぎる表示語は12文字で切ること');

  /* 既存の設定は触らない。表示語の追加でスキーマ番号は上げない */
  assert.match(DATA, /const SCHEMA = 6;/, '欄の追加だけでスキーマ番号を上げないこと');
  assert.match(grab(APP, 'normalizeConfig'), /normalizeLabelConfig\(c\);/);
  assert.doesNotMatch(grab(APP, 'normalizeLabelConfig'), /saveCfg|push\(/,
    '読み込んだだけで保存・同期をしないこと');
});

test('期間・目標日の表示は組み立て層だけを通す', ()=>{
  assert.match(APP, /<p class="count-lead">\$\{esc\(deadlineWord\(true\)\)\}まで<\/p>/);
  assert.match(APP, /<span class="pace-name">\$\{esc\(periodWord\(true\)\)\}<\/span>/);
  assert.match(APP, /class="count-over">\$\{esc\(periodWord\(true\)\)\}は おわりました/);
  assert.match(APP, /<span class="pstat-lab">\$\{esc\(periodWord\(false\)\)\}の残り<\/span>/);
  assert.match(APP, /pstatRow\(periodWord\(false\) \+ 'の経過', nat/);
  assert.match(APP, /L\.push\(deadlineWord\(false\) \+ 'まで {2}あと '/);
  assert.match(APP, /L\.push\(periodWord\(false\) \+ 'は終了しました'\);/);
  assert.match(APP, /L\.push\(periodWord\(false\) \+ 'の経過 {2}'/);

  /* 画面へ出る「夏休み」の直書きを残さない。
     `defaultTitleFor()` と `isGeneratedTitle()` の文字列は、既存タイトルを
     見分けるための移行判定なので**わざと残す** */
  assert.doesNotMatch(APP, /class="count-lead">なつやすみ/);
  assert.doesNotMatch(APP, /class="pace-name">なつやすみ</);
  assert.doesNotMatch(APP, /'夏休みの経過'/);
  assert.doesNotMatch(APP, /'夏休み終了まで/);
  assert.doesNotMatch(APP, /'夏休みは終了しました'/);
  assert.match(APP, /return name \? name \+ 'の夏休みの宿題' : 'しゅくだいノート';/,
    '既存タイトルの移行判定に使う文字列は残すこと');
  assert.match(grab(APP, 'isGeneratedTitle'), /'はじめ夏休みの宿題'/);

  /* ミニコンテンツの引用解説は利用者設定と連動させない */
  assert.match(DATA, /みじかい 夏休みの 一日も/);
});

test('表示のことばは共有・トレース・元に戻すの一覧へそろえて足す', ()=>{
  const shared = APP.slice(APP.indexOf('const SHARED_CONFIG_KEYS'), APP.indexOf('const SHARED_STATE_KEYS'));
  ['periodLabel', 'periodLabelKana', 'deadlineLabel', 'deadlineLabelKana'].forEach(key=>{
    assert.match(shared, new RegExp("'" + key + "'"), key + ' を共有allowlistへ入れること');
    assert.match(APP, new RegExp('const TRACE_CONFIG_FIELDS[\\s\\S]{0,200}' + key));
    assert.match(APP, new RegExp(key + ":\\['" + key + "'\\]"), key + ' を「元に戻す」の対応表へ入れること');
  });
});

test('表示のことばは基本設定の折りたたみに置き、URLのhashを汚さない', ()=>{
  assert.match(APP, /<input type="datetime-local" id="cfgEnd"[^\n]*\n\s*\$\{labelSettingsHTML\(mark\)\}/,
    '終了日のすぐ下、基本設定の中に置くこと');
  const fold = grab(APP, 'labelSettingsHTML');
  assert.match(fold, /data-details-key="displayWords"/,
    '見出しの文字を鍵にすると同じ文の折りたたみが巻きぞえで開く');
  assert.match(fold, /<summary>「夏休み」以外の名称で使う<\/summary>/);
  assert.match(fold, /maxlength="\$\{LABEL_MAX\}"/);
  assert.doesNotMatch(fold, /href="#|pushState|replaceState/, 'URLの#を書きかえないこと');
  ['cfgPeriodLabel', 'cfgPeriodLabelKana', 'cfgDeadlineLabel', 'cfgDeadlineLabelKana'].forEach(id=>{
    assert.match(fold, new RegExp("'" + id + "'"), id + ' の欄を出すこと');
  });
  /* 入力は正規化してから保存する。四つとも同じ作法で束ねる */
  assert.match(APP, /const id = '#cfg' \+ key\.charAt\(0\)\.toUpperCase\(\) \+ key\.slice\(1\);/);
  assert.match(APP, /config\[key\] = e\.target\.value;\s*\n\s*normalizeConfig\(config\);\s*\n\s*saveCfg\(\);/);
  /* せまい端末で横へあふれさせない */
  assert.match(STYLE, /\.pace-name\{[^}]*overflow-wrap:anywhere/);
  assert.match(STYLE, /\.pstat-lab\{[^}]*overflow-wrap:anywhere/);
});

test('進捗サマリーは必須・任意・毎日で区分名をそろえる', ()=>{
  assert.match(APP, /const GROUP_LABEL = \{ must:'必須の宿題', option:'任意の宿題', daily:'毎日の項目' \};/);
  assert.match(APP, /pstatRow\('必須の宿題', s\.pct/);
  assert.match(APP, /pstatRow\('任意の宿題', so\.pct/);
  assert.match(APP, /\$\{group\('must','必須の宿題'\)\}/);
  assert.match(APP, /\$\{group\('option','任意の宿題'\)\}/);
  assert.doesNotMatch(APP, /pstatRow\('つぎに やる'/, '保護者ページの区分名に子ども向けの語を残さないこと');

  const summary = grab(APP, 'buildSummary');
  assert.match(summary, /L\.push\('必須の宿題 {4}'/);
  assert.match(summary, /L\.push\('任意の宿題 {4}'/);
  assert.doesNotMatch(summary, /'つぎに やる/);
  /* 存在しない区分を出さない。任意は0件なら行ごと、各区分は課題が無ければ見出しごと落とす */
  assert.match(summary, /if\(so\.total\) L\.push\('任意の宿題/);
  assert.match(summary, /\['must','option','daily'\]\.forEach\(g=>\{[\s\S]{0,160}if\(!list\.length\) return;/);
  /* 表示語を変えても件数の計算はそのまま */
  assert.match(summary, /const s = overall\('must'\);/);
  assert.match(summary, /const so = overall\('option'\);/);

  /* 子ども画面の語は変えない */
  assert.match(APP, /sectionHTML\('must','かならず やる'/);
  assert.match(APP, /sectionHTML\('opt','つぎに やる'/);
  assert.match(APP, /sectionHTML\('daily','まいにち すこしずつ'/);
  assert.match(APP, /<span class="pace-key pace-key--opt"><\/span>つぎに やる/);
});
