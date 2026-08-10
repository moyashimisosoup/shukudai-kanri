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
const MANIFEST = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.webmanifest'), 'utf8'));

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
  'parentShareSummary', 'defaultTitleFor', 'isGeneratedTitle'
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
    const K_AT='natsu.savedAt.v1', K_CFG='natsu.config.v2', K_WELCOME_THEME='natsu.welcome.theme.v1';
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
  assert.match(STYLE, /daily-more-unit\{ grid-column:span 2/,
    '「以上」を含む単位は2列を使い、狭幅でも切らないこと');
  assert.match(APP, /readingGrade\(\) === 9 \? '以上' : 'いじょう'/,
    '小学2年生までの「以上」はひらがなで表示すること');
  assert.match(APP, /DEBUG_WELCOME_ROLE === 'welcome-parent'/,
    '初期設定の確認用URLを保護者用・子ども用に分けること');
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

test('接続前の保留送信は初回snapshot後に再開できる', async ()=>{
  const names = ['flushPendingSoon', 'flush'];
  const harness = new Function(`
    let docRef=null, pushTimer=null, pending={config:false,state:true};
    let writes=0;
    const window={NatsuApp:{current:()=>({config:{},state:{logs:[]}})}};
    const Sync={_fs:{setDoc:async()=>{ writes++; }}};
    function getDeviceId(){ return 'device-1'; }
    function setStatus(){}
    ${names.map(n=>grab(SYNC, n)).join('\n')}
    return {
      flush, flushPendingSoon,
      connect:()=>{ docRef={}; },
      writes:()=>writes,
      pending:()=>Object.assign({},pending)
    };
  `)();

  await harness.flush();
  assert.equal(harness.writes(), 0);
  assert.equal(harness.pending().state, true);
  harness.connect();
  harness.flushPendingSoon();
  await new Promise(resolve=>setTimeout(resolve, 10));
  assert.equal(harness.writes(), 1);
  assert.equal(harness.pending().state, false);
});

test('Firestore書き込み失敗時は送信予約を失わない', async ()=>{
  const harness = new Function(`
    let docRef={}, pushTimer=null, pending={config:false,state:true};
    const window={NatsuApp:{current:()=>({config:{},state:{logs:[]}})}};
    const Sync={_fs:{setDoc:async()=>{ throw new Error('offline'); }}};
    function getDeviceId(){ return 'device-1'; }
    function setStatus(){}
    ${grab(SYNC, 'flush')}
    return { flush, pending:()=>Object.assign({},pending) };
  `)();
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

test('新しい共有コードはFirestoreの文書IDに平文で置かず、旧方式の家庭も判別できる', async ()=>{
  const house = new Function('crypto', 'TextEncoder', `
    ${grab(SYNC, 'hashPart')}
    ${grab(SYNC, 'legacyHouseIdFor')}
    ${grab(SYNC, 'houseIdFor')}
    return { legacyHouseIdFor, houseIdFor };
  `)(webcrypto, TextEncoder);
  const code = 'abcdefghjkmnpqrs';
  const secure = await house.houseIdFor(code);
  assert.match(secure, /^[0-9a-f]{64}$/);
  assert.notEqual(secure, code);
  assert.equal(await house.houseIdFor(code.toUpperCase()), secure);
  assert.equal(house.legacyHouseIdFor(code), code);
  assert.match(house.legacyHouseIdFor('なつやすみ'), /^phrase-[0-9a-f]{16}$/);
  assert.match(SYNC, /if\(mayUseLegacy && snap\.metadata\.fromCache\) return/);
});

test('保護者画面の案内は実際の保存方式と操作先を明示する', ()=>{
  assert.match(APP, /記録そのものはエンドツーエンド暗号化されません/);
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
});

/* URLに join を残すようにしたぶん、「はずした端末」がリロードだけで
   勝手に戻れてしまわないかを固定する。
   ホーム画面版では起動URLそのものに join が焼きつくため、
   これが無いと はずしても 起動のたびに 復帰する。 */
test('はずされた端末は、招待URLを開き直しても勝手に戻らない', ()=>{
  const CODE = 'abcdefghjkmnpqrs';
  function harness(revokedFrom){
    let reconnected = '';
    const applyJoinCode = new Function(
      'location', 'history', 'cleanCode', 'isStandalone',
      'setLocal', 'K_ONBOARD', 'window', 'toast', 'render', 'routeFromHash',
      'forgetConfigStampForNewHousehold', `
      const JOIN_PARAM='join';
      ${grab(APP, 'joinCodeFromURL')}
      ${grab(APP, 'clearJoinCodeFromURL')}
      ${grab(APP, 'takeJoinCode')}
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
      ()=>{}, ()=>{}, ()=>'home', ()=>{}
    );
    applyJoinCode();
    return reconnected;
  }
  assert.equal(harness(''), CODE, 'ふつうの招待は これまで通り つながる');
  assert.equal(harness(CODE), '', 'はずされた あいことばでは 自動で つなぎ直さない');
  assert.equal(harness('betsunoaikotoba'), CODE, 'べつの家庭の はずし記録は じゃまをしない');

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
  const src = APP;
  const setup = src.slice(src.indexOf("$('#syncSave')"), src.indexOf("$('#syncSave')") + 400);
  assert.match(setup, /forgetRevokedCode\(\)/,
    '設定画面の「保存」で forgetRevokedCode() を呼ぶこと');
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
   受け取る前の初期値に「いま」の時刻が付くので、それが家庭全体に配られ、
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

test('空のキャッシュは家庭設定を受信済みと数えない', ()=>{
  const watch = grab(SYNC, 'watchHousehold');
  const missing = watch.indexOf('if(!snap.exists())');
  const cacheReturn = watch.indexOf('if(mayUseLegacy && snap.metadata.fromCache) return');
  const received = watch.indexOf('gotSnapshot = true');
  assert.ok(missing >= 0 && cacheReturn > missing && received > cacheReturn,
    '空のキャッシュを抜けた後だけ受信済みにすること');
});

/* よそで保存した時刻は、これから入るおうちの時刻とくらべても意味がない。
   0 に戻さないと、古い設定が「新しい」と判定されて家庭全体に配られる。 */
test('ちがうあいことばにつなぐとき、設定の保存時刻を0に戻す', ()=>{
  function harness(rememberedHouse, joining){
    const store = { 'natsu.savedAt.v1': JSON.stringify({ config:9999, state:8888 }) };
    if(rememberedHouse) store['natsu.config.house.v1'] = rememberedHouse;
    const api = new Function('getLocal', 'setLocal', 'savedAt', 'localStorage',
                             'K_AT', 'K_CFG_HOUSE', `
      ${grab(APP, 'forgetConfigStampForNewHousehold')}
      return forgetConfigStampForNewHousehold;
    `)(
      k => store[k] || '', (k, v) => { store[k] = v; },
      () => JSON.parse(store['natsu.savedAt.v1'] || '{}'),
      { setItem:(k,v)=>{ store[k]=v; } },
      'natsu.savedAt.v1', 'natsu.config.house.v1'
    );
    api(joining);
    return JSON.parse(store['natsu.savedAt.v1']);
  }

  assert.deepEqual(harness('', 'aaaaaaaaaaaaaaaa'), { state:8888 },
    'はじめて つなぐ ときは 設定の時刻を 落とす');
  assert.deepEqual(harness('bbbbbbbbbbbbbbbb', 'aaaaaaaaaaaaaaaa'), { state:8888 },
    'べつの おうちに 移る ときも 落とす');
  assert.deepEqual(harness('aaaaaaaaaaaaaaaa', 'aaaaaaaaaaaaaaaa'),
    { config:9999, state:8888 }, '同じ おうちなら そのまま');

  /* 記録（state）の時刻は落とさない。値ごとに時刻を持って合流するので、
     落とすと せっかくの 進みぐあいが 安全側に 倒れてしまう */
  const src = grab(APP, 'forgetConfigStampForNewHousehold');
  assert.equal(/delete a\.state/.test(src), false, 'state の時刻は落とさないこと');
});

/* つなぎ直しの入口すべてで、時刻を戻してから reconnect すること */
test('つなぎ直しの入口すべてで、設定の保存時刻を戻してから接続する', ()=>{
  const calls = [...APP.matchAll(/S\.reconnect\(/g)];
  assert.equal(calls.length, 3, 'reconnect の呼び出しは3か所');
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
});

test('共有する初期設定は、端末と家庭の状態に合わせて分岐する', ()=>{
  const form = grab(APP, 'welcomeFormHTML');
  const setup = grab(APP, 'welcomeShareSetupHTML');
  const picker = grab(APP, 'welcomeParentSharePickerHTML');
  const plan = grab(APP, 'welcomeParentConnectionPlanHTML');
  assert.match(picker, /data-parent-share="create"/, '保護者は新しい家庭を作れる');
  assert.match(picker, /data-parent-share="join"/, '保護者は今ある家庭にも参加できる');
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
    '今ある家庭へ参加する保護者を、合言葉の作成者と区別する');
  assert.match(form, /aria-label="この合言葉で接続してこども画面を開く"/,
    '子どもの最終操作も読み上げで接続先を明示する');
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
  assert.doesNotMatch(join, /data-share-safety/, '既存家庭へ参加する保護者にも作成者向け注意を重ねない');
  assert.match(join, /placeholder="合言葉を入力"/, '既存家庭へ参加するときは合言葉を入力する');
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

test('子どもが選んだデザインは、家庭設定の受信後に1度だけ反映する', ()=>{
  const storage = new Map([
    ['natsu.savedAt.v1', JSON.stringify({config:100})],
    ['natsu.welcome.theme.v1', 'berry']
  ]);
  let saved = 0;
  const harness = new Function('localStorage', 'onSave', `
    let config={ tasks:[], theme:'notebook' }, state={};
    const K_AT='natsu.savedAt.v1', K_CFG='natsu.config.v2', K_WELCOME_THEME='natsu.welcome.theme.v1';
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
  const sessions = [];
  class MockRecognition{
    constructor(){ sessions.push(this); }
    start(){ if(this.onstart) this.onstart(); }
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
    ${grab(APP, 'finishSR')}
    ${grab(APP, 'srErrorMessage')}
    ${grab(APP, 'stopSR')}
    ${grab(APP, 'startSR')}
    return { startSR, stopSR, current:()=>sr };
  `)(MockRecognition, messages);
  const target={ value:'', dispatchEvent(){} };
  const firstBtn=makeButton(), secondBtn=makeButton(), thirdBtn=makeButton();
  harness.startSR(firstBtn, target);
  const first=sessions[0];
  harness.startSR(secondBtn, target);
  const second=sessions[1];
  first.onend();
  assert.equal(harness.current(), second, '古いonendが新しいセッションを消さない');
  second.onerror({error:'not-allowed'});
  assert.equal(harness.current(), null, '権限エラー時も認識中の参照を解放する');
  assert.match(messages.at(-1), /マイク.*許可/, '権限エラーには設定方法を示す');
  harness.startSR(thirdBtn, target);
  assert.equal(harness.current(), sessions[2], 'エラー直後でも新しい認識を開始できる');
  sessions[2].onresult({results:[[{transcript:'できた'}]]});
  sessions[2].onend();
  assert.equal(target.value, 'できた');
  assert.equal(harness.current(), null);
});

/* QRで入った端末だけ デザインが 初期値の まま だった。
   設定は「あとに保存した方がまるごと勝つ」ので、まだ一度も家庭を
   受け取っていない端末が 新しい（または壊れた）時刻印を持っていると、
   家庭の設定が いつまでも 採られない。 */
test('つないだ直後の1回は、時刻を問わず家庭の設定を採る', ()=>{
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
    'つないだ直後は、手元の時刻が新しく見えても家庭の設定を採る');
  assert.equal(harness(newer, older, false).theme, 'notebook',
    '受け取ったあとは、これまで通り新しい方が勝つ');
  assert.equal(harness(older, newer, false).theme, 'cat',
    '家庭の方が新しければ採る');

  /* 旧版が `時刻 | 0` で保存した負の値は、`負 > 0` が成り立たないため
     家庭の設定が永久に採られなくなる。0（時刻なし）に倒して救う */
  const broken = harness(older, older | 0, true);
  assert.equal(broken.theme, 'cat', '壊れた時刻でも家庭の設定を採る');
  assert.equal(broken.pushedConfig, 1, '壊れた時刻は、正しい時刻で送り返して直す');
  assert.equal(harness(older, newer, false).theme, 'cat');
  assert.match(grab(APP, 'applyRemote'), /ms\(at\.state\) >= ms\(remote\.stateAt\)/,
    '記録側の時刻も ms() を通すこと');
});

test('設定が家庭側に置きかわったら、同期の記録に理由をのこす', ()=>{
  const trace = new Function('getLocal', 'traceAdd', 'K_DEVICE_ID', `
    ${/const TRACE_CONFIG_FIELDS = \[[^\]]*\];/.exec(APP)[0]}
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
  assert.match(html, /追加しない（URLから合言葉を消す）/, 'ボタンの文を短くすること');
  assert.match(STYLE, /\.join-install-transfer \.set-actions \.btn\{[^}]*white-space:normal/,
    '長いボタンは折り返して枠に収めること');
  assert.match(grab(APP, 'applyReadingDisplay'), /data-no-reading/,
    'かな変換に data-no-reading の除外があること');
});

test('既存の家庭に入るときは、名前と漢字の設定を任意にする', ()=>{
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
    ${grab(APP, 'deviceLabelFieldHTML')}
    ${grab(APP, 'welcomeParentCreateChoiceHTML')}
    ${grab(APP, 'welcomeFormHTML')}
    return (role,sharing,mode)=>welcomeFormHTML(role,sharing,4,mode);
  `)();
  assert.match(make('parent', true, 'join'), /空のままでかまいません/,
    '参加する保護者には、名前が任意だと示す');
  assert.doesNotMatch(make('parent', true, 'create'), /空のままでかまいません/,
    '新しく作るときは名前が要る');
  assert.match(make('child', true), /そのままで いいよ/, '共有へ入る子どもにも任意だと示す');
  assert.doesNotMatch(make('child', false), /そのままで いいよ/,
    'この端末だけで使うときは名前が要る');

  /* 空のまま進めても家庭の設定を壊さないこと */
  const start = APP.slice(APP.indexOf('start.addEventListener'), APP.indexOf('function bindStats'));
  assert.match(start, /const joining = sharing && \(role === 'child' \|\| !creating\)/);
  assert.match(start, /if\(!name && !joining\)\{ toast\('なまえを 入れてください'\)/,
    '参加する経路では、名前が空でも進める');
  assert.match(start, /if\(name\)\{\s*config\.childName = name;/,
    '名前を入れたときだけ家庭の名前を書きかえる');
});

test('新しく作る合言葉は、押した人だけ手入力に切りかえられる', ()=>{
  const create = grab(APP, 'welcomeFormHTML');
  assert.match(create, /id="welcomeCode"[^>]*readonly/, '既定は自動作成のまま読み取り専用');
  assert.match(create, /id="welcomeCodeCustom"[^>]*>自分で決めた合言葉を使う/);
  const bind = grab(APP, 'bindWelcomeStart');
  assert.match(bind, /customBtn[\s\S]{0,400}input\.readOnly = false/,
    'ボタンを押したときだけ手入力にすること');
  assert.match(bind, /welcomeCodeWarn[\s\S]{0,80}hidden = false/,
    '手入力に切りかえたら注意を出すこと');
});

test('保護者ページは未共有の入口と子ども画面の修正方法を示す', ()=>{
  const badge = new Function('window', `
    ${grab(APP, 'parentShareBadgeHTML')}
    return parentShareBadgeHTML;
  `)({NatsuSync:{configured:()=>true,getCode:()=>''}})();
  assert.match(badge, /共有なし/);
  assert.match(badge, /接続設定はこちら/);
  assert.match(APP, /<h2>保護者の方へ<\/h2>[\s\S]*子ども画面から該当する項目を開いて変更/);
  assert.match(APP, /このページで変更すると、共有中の子ども端末のデザインも変更/);
});
