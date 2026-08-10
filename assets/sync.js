/* SPDX-License-Identifier: Apache-2.0 */
/* =========================================================
   sync.js — 端末のあいだで データを 共有する（Firebase Firestore）

   この層は「足すだけ」に してある。
   ・app.js は これまで通り localStorage から すぐ起動する
   ・通信できなくても、Firebase の設定が 空でも、アプリは そのまま動く
   ・つながったら あとから 追いつく

   ふたつの端末を つなぐ鍵は「あいことば（houseId）」ひとつだけ。
   保護者ページで 作って、子の端末に 同じものを 入れる。
   ========================================================= */

/* ---------------------------------------------------------
   1. Firebase の設定（Firebase コンソールで 作ったものを ここに貼る）
   README の「端末間で共有する」を 見てください。
   空のままなら 同期は 動かず、これまで通り 端末内だけに 保存されます。
   --------------------------------------------------------- */
const FIREBASE_CONFIG = {
  apiKey:            'AIzaSyD6ZSA2T-0fei0VSZk5BpsCwTgnJ_UImBY',
  authDomain:        'shukudai-kanri.firebaseapp.com',
  projectId:         'shukudai-kanri',
  storageBucket:     'shukudai-kanri.firebasestorage.app',
  messagingSenderId: '902260266546',
  appId:             '1:902260266546:web:dc8d35bb252b4bf6f54e2b'
};

const SDK = 'https://www.gstatic.com/firebasejs/12.17.1/';

/* あいことばは この端末の localStorage に のこす。
   Firestore では SHA-256 で変換したIDの1件を端末どうしで見に行く。
   旧版が作った書類も、読み取り時だけ従来IDを試して引き継ぐ。 */
/* ?new=1 のおためしモードは、普段使っている家庭のあいことばを読まない。 */
const K_CODE = new URLSearchParams(location.search).get('new') === '1'
  ? 'natsu.preview.sync.code.v1'
  : 'natsu.sync.code.v1';
const K_DEVICE = new URLSearchParams(location.search).get('new') === '1'
  ? 'natsu.preview.sync.device.v1'
  : 'natsu.sync.device.v1';

/* 打ちまちがえない 文字だけ。0/O と 1/l/I は 入れない */
const ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';
const CODE_LEN = 16;

/* ---------------------------------------------------------
   2. 状態
   --------------------------------------------------------- */
let db = null;
let docRef = null;
let activeHouseId = '';
let unsub = null;
let status = 'off';          // off | connecting | online | offline | error
let statusText = '';
let pushTimer = null;
let pending = { config:false, state:false };

const listeners = [];
const deviceListeners = [];
const mapListeners = [];
let deviceCount = 0;
let deviceMap = {};

function setDeviceMap(m){
  const next = (m && typeof m === 'object') ? m : {};
  if(JSON.stringify(next) === JSON.stringify(deviceMap)) return;
  deviceMap = next;
  mapListeners.forEach(fn => { try{ fn(deviceMap); }catch(e){} });
}

function setStatus(s, text){
  status = s;
  statusText = text || '';
  listeners.forEach(fn => { try{ fn(s, statusText); }catch(e){} });
}
function setDeviceCount(count){
  const next = Math.max(0, Number(count) || 0);
  if(next === deviceCount) return;
  deviceCount = next;
  deviceListeners.forEach(fn => { try{ fn(displayedDeviceCount()); }catch(e){} });
}
function displayedDeviceCount(){
  /* 同期がオフラインでも、この端末は共有設定済みであることが確定している。
     Firestoreの確認待ちだけで 0 台と見せない。 */
  return getCode().length >= 8 ? Math.max(1, deviceCount) : 0;
}

/* ---------------------------------------------------------
   3. あいことば
   --------------------------------------------------------- */
function getCode(){
  try{ return localStorage.getItem(K_CODE) || ''; }catch(e){ return ''; }
}
function setCode(code){
  const c = String(code || '').trim().normalize('NFKC').replace(/\s+/g,'').replace(/[\/\u0000-\u001f]/g, '');
  try{
    if(c) localStorage.setItem(K_CODE, c);
    else  localStorage.removeItem(K_CODE);
  }catch(e){}
  return c;
}
/* 名前・端末名・アクセス元を使わない、このブラウザだけのランダムな番号。
   「設定済み台数」は、いま接続中かどうかでなく、一度共有を設定した端末を数える。 */
function getDeviceId(){
  try{
    let id = localStorage.getItem(K_DEVICE) || '';
    if(!/^[a-f0-9]{24}$/.test(id)){
      const buf = new Uint32Array(3);
      crypto.getRandomValues(buf);
      id = Array.from(buf, n=>n.toString(16).padStart(8, '0')).join('');
      localStorage.setItem(K_DEVICE, id);
    }
    return id;
  }catch(e){
    return 'memory-' + Math.random().toString(16).slice(2, 26).padEnd(24, '0');
  }
}
/* 旧版のFirestore用ID。既存の家庭に接続し続けるため、読み取り時だけ使う。 */
function hashPart(text, seed){
  let n = seed >>> 0;
  for(let i=0; i<text.length; i++) n = Math.imul(n ^ text.charCodeAt(i), 0x01000193) >>> 0;
  return n.toString(16).padStart(8, '0');
}
function legacyHouseIdFor(code){
  const c = String(code || '');
  if(/^[a-z0-9]+$/i.test(c) && c.length >= 16) return c.toLowerCase();
  return 'phrase-' + hashPart(c, 0x811c9dc5) + hashPart(c, 0x9e3779b9);
}
/* 新しい家庭では、共有コードをFirestoreの文書IDへそのまま置かない。
   これはIDの推測を難しくするためで、記録内容を暗号化するものではない。 */
async function houseIdFor(code){
  const normalized = String(code || '').trim().normalize('NFKC').replace(/\s+/g, '').toLowerCase();
  const data = new TextEncoder().encode(normalized);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest), n=>n.toString(16).padStart(2, '0')).join('');
}
function makeCode(){
  const buf = new Uint32Array(CODE_LEN);
  crypto.getRandomValues(buf);
  return Array.from(buf, n => ALPHABET[n % ALPHABET.length]).join('');
}
function configured(){
  return !!(FIREBASE_CONFIG.apiKey && FIREBASE_CONFIG.projectId);
}

/* ---------------------------------------------------------
   4. つなぐ
   --------------------------------------------------------- */
/* ページを 開いた ときの 自動つなぎと、設定画面での「つなぎ直す」が
   ほぼ同時に 起きることが ある（起動直後に あいことばを 打ち直した場合など）。
   initializeApp・initializeFirestore は アプリの中で 1回しか 呼べないので、
   同時に 2回 初期化しないよう ここで ひとまとめにする */
let initPromise = null;

/* snapshot を先に張る。接続前に getDoc を待つと、オフライン時に
   ブラウザ内へためておく仕組みまで始められなくなるため。
   新方式の書類がオンラインで「ない」と確認できた時だけ、旧方式の
   書類を一度試す。これで既存家庭を引き継ぎつつ、通信待ちで記録を失わない。 */
function watchHousehold(fs, ref, code, mayUseLegacy){
  if(unsub){ unsub(); unsub = null; }
  docRef = ref;
  activeHouseId = ref.id;
  unsub = fs.onSnapshot(ref,
    async snap => {
      if(docRef !== ref || snap.metadata.hasPendingWrites) return;

      setStatus(snap.metadata.fromCache ? 'offline' : 'online',
                snap.metadata.fromCache ? 'オフライン（この端末に ためています）' : 'つながっています');

      if(!snap.exists()){
        /* キャッシュだけでは新旧を決めない。ここで新規文書を作ると、
           オフラインの既存端末が別の家庭を作ってしまうため、オンラインの
           確認が来るまで保留する。保存操作の pending はそのまま残る。 */
        if(mayUseLegacy && snap.metadata.fromCache) return;
        if(mayUseLegacy){
          const legacyId = legacyHouseIdFor(code);
          if(legacyId !== ref.id){
            try{
              const legacyRef = fs.doc(db, 'households', legacyId);
              const legacySnap = await fs.getDoc(legacyRef);
              if(docRef !== ref) return;
              if(legacySnap.exists()){
                watchHousehold(fs, legacyRef, code, false);
                return;
              }
            }catch(e){
              /* 次のsnapshotで再試行する。安全確認なしに新規作成はしない。 */
              return;
            }
          }
        }
        registerDevice();
        pushAll();
        return;
      }

      const d = snap.data() || {};
      if(revokedForMe(d.devices)){
        setCode('');
        disconnect();
        setStatus('off', 'この端末は はずされました。あいことばを 入れ直してください');
        return;
      }

      const devs = d.devices || {};
      setDeviceCount(Object.keys(devs).filter(k => !(devs[k] && devs[k].revoked)).length);
      setDeviceMap(devs);
      registerDevice();
      const app_ = window.NatsuApp;
      if(app_ && typeof app_.onRemote === 'function'){
        app_.onRemote({
          config:   d.config   || null,
          state:    d.state    || null,
          configAt: d.configAt || 0,
          stateAt:  d.stateAt  || 0
        });
      }
      /* 接続前に端末内へ保存されていた変更を、まず相手と合流してから送る。 */
      flushPendingSoon();
    },
    err => setStatus('error', 'つながりません：' + (err && err.code || err))
  );
}

async function connect(){
  const code = getCode();

  if(!configured()){ setStatus('off', 'Firebase が設定されていません'); return; }
  if(code.length < 8){ setStatus('off', 'あいことばが設定されていません'); return; }

  setStatus('connecting', 'つないでいます…');

  try{
    /* initializeApp と initializeFirestore は アプリの中で 1回しか 呼べない。
       あいことばを 入れ替えて つなぎ直すたびに ここへ 戻ってくるので、
       2回目からは 作った db を そのまま つかい、docRef だけ 差し替える */
    if(!db){
      if(!initPromise) initPromise = initFirebase();
      await initPromise;
    }

    const fs = Sync._fs;
    /* 新しい方式を先に読む。旧版で作った家庭かどうかは、snapshot が
       オンラインで空だった時だけ watchHousehold() が確認する。 */
    const secureId = await houseIdFor(code);
    const secureRef = fs.doc(db, 'households', secureId);
    watchHousehold(fs, secureRef, code, true);

  }catch(err){
    setStatus('error', 'つながりません：' + (err && err.message || err));
  }
}

async function initFirebase(){
  const [{ initializeApp }, { getAuth, signInAnonymously }, fs] = await Promise.all([
    import(SDK + 'firebase-app.js'),
    import(SDK + 'firebase-auth.js'),
    import(SDK + 'firebase-firestore.js')
  ]);
  Sync._fs = fs;

  const app = initializeApp(FIREBASE_CONFIG);

  /* 匿名ログイン。画面には 何も出ない。
     これが あることで、規則に request.auth != null を 書ける */
  await signInAnonymously(getAuth(app));

  /* 通信が 切れているあいだの 読み書きを ブラウザに ためる。
     子の端末が 電波の無い所で「やった！」を 押しても 消えない */
  db = fs.initializeFirestore(app, {
    localCache: fs.persistentLocalCache({ tabManager: fs.persistentMultipleTabManager() })
  });
}

/* 文書内の devices は { ランダム番号: { 役割・呼び名・版・いつ } }。
   merge 更新なので、宿題・名前・記録の同期データへ影響を与えない。
   古い版は { ランダム番号: true } で書いているので、読む側で どちらも 通す。

   名前は「こどもの呼び名」だけで、端末名・機種・場所は 送らない。
   版を のせるのは、1台だけ 古いままの端末が 記録を もどしてしまう ことが
   あり、それを 人が 気づける ようにするため。 */
function deviceInfo(){
  const app_ = window.NatsuApp;
  const i = (app_ && typeof app_.deviceInfo === 'function') ? app_.deviceInfo() : {};
  return {
    role:  String(i.role  || ''),
    name:  String(i.name  || ''),
    label: String(i.label || ''),
    ver:   String(i.ver   || ''),
    /* 「はずす」で付いた印は、合言葉を明示的に入れ直した再登録で解除する。
       これが無いと最初のsnapshotだけ見逃したあと、メッセージ送信などで
       次のsnapshotが来た時に再び「はずされました」と判定される。 */
    revoked: false,
    at:    Date.now()
  };
}
/* 中身が かわった ときだけ 書く。開くたびに 書くと むだに 通信する */
let lastDeviceWrite = '';
async function registerDevice(){
  if(!docRef || !Sync._fs) return;
  const info = deviceInfo();
  const key = [activeHouseId || legacyHouseIdFor(getCode()), info.role, info.name, info.label, info.ver].join('|');
  if(lastDeviceWrite === key) return;
  lastDeviceWrite = key;
  try{
    const id = getDeviceId();
    await Sync._fs.setDoc(docRef, { devices:{ [id]: info } }, { merge:true });
    /* 自分が 書いたぶんは onSnapshot が 読み飛ばす（hasPendingWrites）。
       そのため 一覧の 自分の行だけが 古いままに なり、
       呼び名を つけても 出ない、最新なのに「古い」と 出る、が 起きる。
       書けた時点で 手元の 一覧にも 反映する */
    setDeviceMap(Object.assign({}, deviceMap, { [id]: info }));
  }catch(err){
    lastDeviceWrite = '';
    setStatus('error', '端末の記録を保存できません：' + (err && err.code || err));
  }
}
/* 役割を えらび直した ときなど、書き直させる */
function refreshDevice(){ lastDeviceWrite = ''; registerDevice(); }

/* ほかの端末を 一覧から はずす。
   LINE などの 一時的な ブラウザで つないでしまうと、閉じたあとは
   その端末から 何も できず、一覧に のこりつづける。
   どの端末からでも 消せるように しておく。

   なお これは「一覧の 掃除」であって、締め出しでは ない。
   はずした端末が また 開けば、自分で 登録し直す。
   ほんとうに つながりを 断つには、あいことばを 変える（下の note を 見ること）。 */
async function removeDevice(id){
  if(!docRef || !Sync._fs) return false;
  if(!/^[a-z0-9-]{1,64}$/i.test(String(id || ''))) return false;
  try{
    /* 消すのでは なく「はずした」印を つける。
       消すだけだと、その端末に あいことばが のこっている かぎり、
       つぎに 開いた ときに 自分で 登録し直して 戻ってきてしまう。
       印を のこせば、はずされた端末が それを 見て、自分の あいことばを
       消す（＝つぎは 入れ直しが 要る）。

       新しい 欄を 作らず devices の 中に 置くのは、規則の
       hasOnly([...]) から 外れると 書けなくなるため。 */
    await Sync._fs.updateDoc(docRef, {
      ['devices.' + id]: { revoked: true, at: Date.now() }
    });
    const next = Object.assign({}, deviceMap);
    next[id] = { revoked: true, at: Date.now() };
    setDeviceMap(next);                    // 自分の書きこみは 読み飛ばされるので ここで 反映
    setDeviceCount(Object.keys(next).filter(k => !(next[k] && next[k].revoked)).length);
    return true;
  }catch(err){
    setStatus('error', '端末をはずせません：' + (err && err.code || err));
    return false;
  }
}

/* 自分が はずされて いないかを 見る。はずされていたら、
   この端末の あいことばを 消して つながりを 切る。
   もう一度 つなぐには あいことばの 入れ直しが 要る。

   あいことばを 入れ直した 直後の 1回だけは 見のがす。
   でないと、入れ直した とたんに また 切られて 堂々めぐりに なる。 */
let skipRevokeOnce = false;
function revokedForMe(devices){
  if(skipRevokeOnce){ skipRevokeOnce = false; return false; }
  const mine = (devices || {})[getDeviceId()];
  return !!(mine && typeof mine === 'object' && mine.revoked);
}

function disconnect(){
  if(unsub){ unsub(); unsub = null; }
  docRef = null;
  activeHouseId = '';
  lastDeviceWrite = '';
  setDeviceMap({});
  setDeviceCount(0);
  setStatus('off', '');
}

/* ---------------------------------------------------------
   5. 送る
   保存のたびに すぐ送ると、記録の入力中に 何度も 書きに行ってしまう。
   1.2秒 まとめてから 1回だけ 送る。
   config と state は べつの欄に 分けて 書くので、
   親が 設定を いじっている あいだに 子が 記録しても つぶし合わない。
   --------------------------------------------------------- */
function push(kind){
  if(kind === 'config') pending.config = true;
  if(kind === 'state')  pending.state  = true;
  clearTimeout(pushTimer);
  pushTimer = setTimeout(flush, 1200);
}
function pushAll(){ push('config'); push('state'); }
function flushPendingSoon(){
  if(!pending.config && !pending.state) return;
  clearTimeout(pushTimer);
  pushTimer = setTimeout(flush, 0);
}

async function flush(){
  if(!docRef || !Sync._fs) return;
  const app_ = window.NatsuApp;
  if(!app_ || typeof app_.current !== 'function') return;

  const cur = app_.current();
  const now = Date.now();
  const payload = {};

  if(pending.config){ payload.config = cur.config; payload.configAt = now; }
  if(pending.state) {
    payload.state   = cur.state;
    payload.stateAt = now;
    /* どの端末が 送ったかを のこす。合わなかった ときに、どちらの端末の
       値だったのかを 名前で 見られる ようにする。
       新しい 欄を 作ると 規則の 許可から 外れて 書けなくなるので、
       すでに ある devices の 中に しまう。stateAt と 同じ値なので、
       受け取った側は 時刻を 突き合わせて 送り主を 見わけられる */
    payload.devices = { [getDeviceId()]: { lastAt: now } };
  }
  pending = { config:false, state:false };

  if(!Object.keys(payload).length) return;

  try{
    /* merge:true にして、送っていない側の欄を 消さないようにする。
       通信が 切れていても ここは 成功する（ブラウザに たまり、あとで 送られる） */
    await Sync._fs.setDoc(docRef, payload, { merge:true });
  }catch(err){
    /* 一時的な失敗で送信予約まで失わない。次の再接続・保存で再送する。 */
    if(payload.config) pending.config = true;
    if(payload.state)  pending.state  = true;
    setStatus('error', '保存できません：' + (err && err.code || err));
  }
}

/* ---------------------------------------------------------
   6. 匿名の登録家庭数

   あいことばそのものは保存せず、SHA-256 の値だけで同じ家庭を見分ける。
   初期設定の親端末から一度だけ呼ばれる。

   以前は metrics/registrations の中に
   { households: { <あいことばのSHA-256>: 登録日時 } } を持っていた。
   数を数えるには その一覧を 読む必要が あるため、規則で 読みを 止められず、
   誰でも 全家庭ぶんの ハッシュを 取り出せる状態に なっていた。
   旧版の短いあいことばでは、一覧が出ると総当たりで割られ、
   その家庭の 記録まで 読まれてしまう。

   そこで 2つに 分けた。
   ・metrics/registrations      … 数（count）だけ。増やす向きにしか 書けない
   ・metrics_households/<SHA-256> … 中身のない 目印。IDが ハッシュそのもの

   目印は「IDを 知っている人＝あいことばを 知っている人」しか たどり着けないので、
   一覧を 禁止する 規則に できる。詳しくは firestore.rules を 見てください。
   競合時は Firestore の transaction が再試行する。 */
async function codeHash(code){
  const normalized = String(code || '').trim().normalize('NFKC').replace(/\s+/g, '').toLowerCase();
  const bytes = new TextEncoder().encode(normalized);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), b=>b.toString(16).padStart(2,'0')).join('');
}
async function registerHousehold(code){
  if(!configured() || String(code || '').length < 8) return;
  if(!db){
    if(!initPromise) initPromise = initFirebase();
    await initPromise;
  }
  const hash = await codeHash(code);
  const fs = Sync._fs;
  const marker  = fs.doc(db, 'metrics_households', hash);
  const counter = fs.doc(db, 'metrics', 'registrations');
  await fs.runTransaction(db, async tx=>{
    /* transaction は 読みを ぜんぶ 先に すませてから 書く */
    const mine = await tx.get(marker);
    if(mine.exists()) return;                 // この家庭は すでに 数えてある
    const now = await tx.get(counter);
    const next = (now.exists() ? Number((now.data() || {}).count || 0) : 0) + 1;
    tx.set(marker, { at: Date.now() });
    /* merge を つけない。古い形式の households（ハッシュ一覧）が
       のこっていても、ここで count だけの 文書に 置きかわる */
    tx.set(counter, { count: next });
  });
}
async function getRegistrationCount(){
  if(!configured()) throw new Error('Firebase が設定されていません');
  if(!db){
    if(!initPromise) initPromise = initFirebase();
    await initPromise;
  }
  const snap = await Sync._fs.getDoc(Sync._fs.doc(db, 'metrics', 'registrations'));
  return snap.exists() ? Number((snap.data() || {}).count || 0) : 0;
}

/* ---------------------------------------------------------
   7. 外に見せるもの
   --------------------------------------------------------- */
const Sync = {
  _fs: null,
  configured,
  getCode, setCode, makeCode,
  status:     () => status,
  statusText: () => statusText,
  onStatus(fn){ listeners.push(fn); fn(status, statusText); },
  deviceCount: displayedDeviceCount,
  onDeviceCount(fn){ deviceListeners.push(fn); fn(displayedDeviceCount()); },
  devices: () => deviceMap,
  removeDevice,
  onDevices(fn){ mapListeners.push(fn); fn(deviceMap); },
  refreshDevice,
  push,
  pushAll,
  connect,
  disconnect,
  registerHousehold,
  getRegistrationCount,
  /* あいことばを 入れ替えて つなぎ直す */
  async reconnect(code){
    /* 入れ直した 直後の 1回は「はずされた」印を 見のがす。
       でないと 入れたとたんに また 切られる */
    skipRevokeOnce = true;
    setCode(code);
    disconnect();
    await connect();
  }
};

window.NatsuSync = Sync;

/* module は 仕様上、classic script（app.js）より あとに 動きだす。
   だから ページを 開いて 最初の render() は かならず sync.js が
   まだ 何も していない状態で 終わっている。
   ここで イベントを 出し、app.js 側で 「せってい」タブを 見ていたら
   もう1回 描き直してもらう（onStatus は #syncStatus の文字だけしか
   書きかえられず、欄そのものが まだ 無い状態は 直せないため） */
window.dispatchEvent(new CustomEvent('natsu:sync-ready'));

/* app.js は もう動いている（classic script は 先に走る）。
   ここで はじめて 通信を 始める。読み込みが 遅れても 画面は 止まらない */
connect();
