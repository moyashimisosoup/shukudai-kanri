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
  'parentShareSummary', 'defaultTitleFor', 'isGeneratedTitle', 'logByLabel'
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

/* 暗号化の部品。sync.js の本物をそのまま持ちこむので、
   実装が変わればテストも一緒に動く。 */
const CRYPTO_PARTS = "let cryptoKey=null, cryptoKeyCode='';\nconst ENC_PREFIX='v1:'; const ENC_ITERATIONS=250000;\n"
  + ['normalizeCode','sha256Bytes','deriveKey','bytesToBase64','base64ToBytes','encryptField','isCiphertext']
      .map(n=>grab(SYNC, n)).join('\n');

test('接続前の保留送信は初回snapshot後に再開できる', async ()=>{
  const names = ['flushPendingSoon', 'flush'];
  const harness = new Function('crypto', 'TextEncoder', 'btoa', `
    let docRef=null, pushTimer=null, pending={config:false,state:true};
    let writes=0, last=null;
    const window={NatsuApp:{current:()=>({config:{},state:{logs:[]}})}};
    const Sync={_fs:{setDoc:async(_ref,payload)=>{ writes++; last=payload; }}};
    function getDeviceId(){ return 'device-1'; }
    function getCode(){ return 'abcdefghjkmnpqrs'; }
    function setStatus(){}
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
    const window={NatsuApp:{current:()=>({config:{},state:{logs:[]}})}};
    const Sync={_fs:{setDoc:async()=>{ throw new Error('offline'); }}};
    function getDeviceId(){ return 'device-1'; }
    function getCode(){ return 'abcdefghjkmnpqrs'; }
    function setStatus(){}
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
  const cacheReturn = watch.indexOf('if(snap.metadata.fromCache) return');
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
  assert.equal(calls.length, 4, 'reconnect の呼び出しは4か所（初期設定・招待URL・参加・作成）');
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
  assert.match(form, /aria-label="確認した合言葉でこの家庭に参加する"/,
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
  assert.equal(harness.config().theme, 'sunny', '別の家庭で残った一時デザインは採らない');
  assert.equal(saved, 1, '別家庭の一時値を家庭設定として保存しない');
});

test('参加画面で変えた名前と漢字設定は、家庭設定の受信後にだけ反映する', ()=>{
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
    config:{tasks:[],theme:'notebook',childName:'家庭の名前',readingGrade:2,title:'家庭の名前の夏休みの宿題'},
    configAt:200,
    first:true
  });
  assert.equal(harness.config().childName, 'はな');
  assert.equal(harness.config().readingGrade, 1);
  assert.equal(harness.config().title, 'はなの夏休みの宿題');
  assert.equal(saved, 1, '家庭設定を採ったあとに変更を1回だけ保存する');
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
});

test('招待URLでは端末に残ったデザインを持ち込まず、家庭のデザインを採る', ()=>{
  const join = grab(APP, 'applyJoinCode');
  const remote = grab(APP, 'applyRemote');
  assert.match(join, /localStorage\.removeItem\(K_WELCOME_THEME\)/,
    '招待接続前に手動参加の一時デザインを消す');
  assert.match(remote, /welcomeTheme\.code === activeCode/,
    '一時デザインは確認済みの同じ家庭だけに適用する');
  assert.match(remote, /remoteThemeMissing[\s\S]{0,180}!joinCodeFromURL\(\)/,
    '旧家庭のテーマ移行に招待直後の端末を使わない');
  const bind = grab(APP, 'bindWelcomeStart');
  assert.match(bind, /themeInput\.checked = true/,
    '手動参加でも確認後に家庭のデザインを選択状態へ反映する');
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
    ${grab(APP, 'welcomeJoinCheckHTML')}
    ${grab(APP, 'deviceLabelFieldHTML')}
    ${grab(APP, 'welcomeParentCreateChoiceHTML')}
    ${grab(APP, 'welcomeFormHTML')}
    return (role,sharing,mode)=>welcomeFormHTML(role,sharing,4,mode);
  `)();
  assert.match(make('parent', true, 'join'), /合言葉を確認すると、共有中のお子さんの名前と漢字設定を表示します/,
    '参加する保護者には、接続先の設定を表示すると示す');
  assert.doesNotMatch(make('parent', true, 'create'), /合言葉を確認すると/,
    '新しく作るときは名前が要る');
  assert.match(make('child', true), /あいことばを かくにんすると/, '共有へ入る子どもにも取得を示す');
  assert.doesNotMatch(make('child', false), /あいことばを かくにんすると/,
    'この端末だけで使うときは名前が要る');

  /* 空のまま進めても家庭の設定を壊さないこと */
  const start = APP.slice(APP.indexOf('start.addEventListener'), APP.indexOf('function bindStats'));
  assert.match(start, /const joining = sharing && \(role === 'child' \|\| !creating\)/);
  assert.match(start, /if\(!name && !joining\)\{ toast\('なまえを 入れてください'\)/,
    '参加する経路では、名前が空でも進める');
  assert.match(start, /if\(name && !joining\)\{\s*config\.childName = name;/,
    '参加時の変更は家庭設定の初回受信後まで保留する');
});

test('既存家庭への参加は読み取り確認後だけ許可し、接続先の設定を表示する', ()=>{
  const bind = grab(APP, 'bindWelcomeStart');
  const verify = grab(SYNC, 'verifyHousehold');
  assert.match(bind, /S\.verifyHousehold\(code\)/, '参加前に合言葉の接続先を確認する');
  assert.match(bind, /const result = TEST_MODE[\s\S]{0,120}found:true/,
    'おためし画面は実際のFirebaseを読まずに表示確認できる');
  assert.match(bind, /接続しています…/);
  assert.match(bind, /接続しました ✓/);
  assert.match(bind, /welcomeJoinVerified = \{ code, config:deepCopy\(remoteConfig\) \}/,
    '確認済みの合言葉と家庭設定を保持する');
  assert.match(bind, /nameInput\.value = remoteName/,
    '接続先のお子さんの名前をフォームへ表示する');
  assert.match(bind, /start\.hidden = false/,
    '確認できた場合だけ参加ボタンを表示する');
  assert.match(bind, /先に合言葉の接続を確認してください/,
    '画面操作を迂回しても未確認では参加できない');
  assert.match(verify, /getDocFromServer/, 'サーバー上の家庭を読み取り専用で確認する');
  assert.doesNotMatch(verify, /pushAll|registerDevice|setDoc/,
    '存在確認だけでは家庭を作成・変更しない');
});

test('曜日の月は「つき」ではなく曜日読みの「げつ」にする', ()=>{
  const reading = grab(APP, 'applyReadingDisplay');
  assert.match(APP, /const WD_READING = \{[^}]*月:'げつ'/);
  assert.match(reading, /body\.replace\(\/（\(\[日月火水木金土\]\)）\/g/,
    '括弧内の曜日だけを辞書変換前に確定する');
});

test('端末の呼び名には自明な変更範囲の説明を重ねない', ()=>{
  assert.doesNotMatch(APP, /ほかの端末の一覧にも表示されますが、変更できるのはこの端末だけです/);
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

test('ねこテーマの飾りは paw.svg のまま残す', ()=>{
  assert.match(STYLE, /\[data-theme="cat"\][\s\S]*mask:url\("paw\.svg"\)/);
  assert.equal(fs.existsSync(path.join(ROOT, 'assets', 'paw.svg')), true);
});

/* QR参加した端末の初期値が家庭ぜんたいへ配られ、まいにちの項目が
   参加端末でも招いた端末でも消えた。空のキャッシュ対策が
   `mayUseLegacy` のときだけ効いており、旧方式の家庭へ切りかえた
   あとの watcher（mayUseLegacy = false）が素通りしていた。 */
test('文書なしのキャッシュは、旧方式へ切りかえた後の watcher でも家庭を作らせない', ()=>{
  const watch = grab(SYNC, 'watchHousehold');
  assert.doesNotMatch(watch, /mayUseLegacy && snap\.metadata\.fromCache/,
    'キャッシュ判定に mayUseLegacy を混ぜないこと');
  const cacheReturn = watch.indexOf('if(snap.metadata.fromCache) return');
  /* コメント中の pushAll() を拾わないよう、呼び出しの形で探す */
  const push = watch.indexOf('pushAll();');
  assert.ok(cacheReturn >= 0 && push > cacheReturn,
    'オンラインで確認できるまで pushAll() へ進ませないこと');
});

test('ある家庭へ入る端末は、家庭が見つからなくても新しく作らない', ()=>{
  const watch = grab(SYNC, 'watchHousehold');
  const guard = watch.indexOf('if(joiningExisting)');
  const push = watch.indexOf('pushAll();');
  assert.ok(guard >= 0 && push > guard, 'pushAll() の手前で止めること');
  assert.match(watch, /joiningExisting\)\{[\s\S]{0,200}setStatus\('error'/,
    '静かに上書きせず、画面に出して気づけるようにすること');
  /* 招待リンクと初期設定の参加は、かならず joining を渡す */
  assert.match(grab(APP, 'applyJoinCode'), /reconnect\(code, \{ joining:true \}\)/);
  assert.match(grab(APP, 'bindWelcomeStart'), /reconnect\(code, \{ joining \}\)/);
  /* 家庭を1回でも受け取ったら、ふつうの端末に戻す */
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
  assert.match(make, /on\('#syncMake', 'click', \(\)=> startSharing\(S\.makeCode\(\)\)\)/);
  assert.match(make, /on\('#syncMakeOwn', 'click'/);
  assert.match(make, /if\(c\.length < 8\)/, '自分で決めた合言葉は8文字以上を求めること');

  const section = grab(APP, 'syncSectionHTML');
  assert.match(section, /合言葉を作成する/);
  assert.match(section, /ほかの端末から読み取れるようになります/,
    '作成で何が起きるかを書くこと');
  assert.match(section, /id="syncVerify"[^>]*>接続を確認/);
  /* 設定からも 自分で 決められる（最初の設定と そろえる） */
  assert.match(section, /id="syncOwnCode"/);
  assert.match(section, /id="syncMakeOwn"[^>]*>この合言葉で作成する/);
  assert.match(section, /id="syncSave"[^>]*hidden[^>]*>この家庭に参加する|id="syncSave" type="button" hidden/);

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
  ['#cfgShowDaily','#addNormalTask','#addBookTask','#addDailyTask'].forEach(sel=>{
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
  /* 選んだ役割はこの端末だけの設定。家庭の設定に混ぜない */
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

test('家庭の中身は暗号化して往復でき、平文が残らない', async ()=>{
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

/* この作りで くり返し 起きてきた事故。まだ家庭を受け取っていない端末が
   自分の初期値で家庭を上書きする。復号できないうちに gotSnapshot を
   立てると configHeldBack() が false になり、同じ道すじが再びひらく。 */
test('復号できないうちは、受信済みにも上書き可能にもしない', ()=>{
  const watch = grab(SYNC, 'watchHousehold');
  const failIdx = watch.indexOf('この端末では 中身を 読めません');
  const gotIdx  = watch.indexOf('gotSnapshot = true');
  assert.ok(failIdx > -1, '読めないことを画面に出すこと');
  assert.ok(gotIdx > failIdx,
    'gotSnapshot を立てるのは復号に成功したあとにすること');
  const fail = watch.slice(failIdx, gotIdx);
  assert.match(fail, /return;/, '読めないときはそこで戻ること');
  assert.doesNotMatch(fail, /pushAll\(\)|flushPendingSoon\(\)|joiningExisting = false/,
    '読めないまま家庭へ送り出さないこと');
  /* 平文のまま置かれた文書も「読めない」に倒す（黙って上書きしない） */
  assert.match(watch, /throw new Error\('not-encrypted'\)/);
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
   家庭を作った直後にQRを読むと、作成側の最初の送信が届く前に
   「文書はあるが config が無い」snapshot が1回来る。そこで初期設定の
   名前・デザインを saveCfg() すると、参加したばかりの端末の初期値
   （既定の宿題・まいにち無し・初期デザイン）が家庭へ配られる。 */
test('家庭の設定を受け取れていないうちは、初期設定を家庭へ送らない', ()=>{
  const f = grab(APP, 'applyRemote');
  const guardIdx = f.indexOf('if(!remote.config){');
  const consumeIdx = f.indexOf('localStorage.removeItem(K_WELCOME_THEME)');
  const saveIdx = f.indexOf('if(welcomeChanged){ saveCfg(); changed = true; }');
  assert.ok(guardIdx > -1, '家庭の設定が無いときの分岐を置くこと');
  assert.ok(consumeIdx > guardIdx,
    '受け取れていないうちに、取っておいた初期設定を使い切らないこと');
  assert.ok(saveIdx > guardIdx,
    '受け取れていないうちに saveCfg() で家庭へ送らないこと');
  /* 消さずに残す。次のsnapshotで家庭の設定が来たときに反映する */
  const guard = f.slice(guardIdx, consumeIdx);
  assert.match(guard, /return;/);
  assert.doesNotMatch(guard, /removeItem\(K_WELCOME_JOIN\)|saveCfg\(\)/);
});
