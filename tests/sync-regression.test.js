const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { webcrypto } = require('node:crypto');

const ROOT = path.join(__dirname, '..');
const APP = fs.readFileSync(path.join(ROOT, 'assets', 'app.js'), 'utf8');
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
    const K_AT='natsu.savedAt.v1', K_CFG='natsu.config.v2';
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
  assert.match(APP, /エンドツーエンド暗号化ではありません/);
  assert.match(APP, /普段使うパスワードや秘密の言葉は使わず/);
  assert.match(APP, /function parentTodayLogsHTML\(/);
  assert.match(APP, /設定ページの「記録の手入れ」で「やったこと」の削除を有効にしてください/);
  assert.match(APP, /if\(confirm\('子ども画面へ移動します/);
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
      'setLocal', 'K_ONBOARD', 'window', 'toast', 'render', 'routeFromHash', `
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
      ()=>{}, ()=>{}, ()=>'home'
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
