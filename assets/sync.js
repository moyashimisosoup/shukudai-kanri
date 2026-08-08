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
   Firestore の 1件の書類（households/<あいことば>）を 端末どうしで 見に行く */
/* ?new=1 のおためしモードは、普段使っている家庭のあいことばを読まない。 */
const K_CODE = new URLSearchParams(location.search).get('new') === '1'
  ? 'natsu.preview.sync.code.v1'
  : 'natsu.sync.code.v1';
const K_DEVICE = new URLSearchParams(location.search).get('new') === '1'
  ? 'natsu.preview.sync.device.v1'
  : 'natsu.sync.device.v1';

/* 打ちまちがえない 文字だけ。0/O と 1/l/I は 入れない */
const ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';
const CODE_LEN = 8;

/* ---------------------------------------------------------
   2. 状態
   --------------------------------------------------------- */
let db = null;
let docRef = null;
let unsub = null;
let status = 'off';          // off | connecting | online | offline | error
let statusText = '';
let pushTimer = null;
let pending = { config:false, state:false };

const listeners = [];
const deviceListeners = [];
let deviceCount = 0;
let registeredDeviceHouseId = '';

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
/* 短い・日本語の合言葉も使えるよう、Firestore用のIDだけを十分な長さへ変換する。
   以前の20文字英数字の合言葉は、既存データに接続できるようそのまま使う。 */
function hashPart(text, seed){
  let n = seed >>> 0;
  for(let i=0; i<text.length; i++) n = Math.imul(n ^ text.charCodeAt(i), 0x01000193) >>> 0;
  return n.toString(16).padStart(8, '0');
}
function houseIdFor(code){
  const c = String(code || '');
  if(/^[a-z0-9]+$/i.test(c) && c.length >= 16) return c.toLowerCase();
  return 'phrase-' + hashPart(c, 0x811c9dc5) + hashPart(c, 0x9e3779b9);
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
    docRef = fs.doc(db, 'households', houseIdFor(code));

    if(unsub){ unsub(); unsub = null; }

    unsub = fs.onSnapshot(docRef,
      snap => {
        /* 自分が いま書いたぶんが 返ってきただけなら 何もしない。
           これを 見ないと 自分の保存で 自分の画面が 描き直される */
        if(snap.metadata.hasPendingWrites) return;

        setStatus(snap.metadata.fromCache ? 'offline' : 'online',
                  snap.metadata.fromCache ? 'オフライン（この端末に ためています）' : 'つながっています');

        if(!snap.exists()){
          registerDevice();
          pushAll();
          return;
        }

        const d = snap.data() || {};
        setDeviceCount(Object.keys(d.devices || {}).length);
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
      },
      err => setStatus('error', 'つながりません：' + (err && err.code || err))
    );

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

/* 文書内の devices は { ランダム番号: true } だけ。merge 更新なので、
   宿題・名前・記録の同期データへ影響を与えない。 */
async function registerDevice(){
  if(!docRef || !Sync._fs) return;
  const houseId = houseIdFor(getCode());
  if(registeredDeviceHouseId === houseId) return;
  registeredDeviceHouseId = houseId;
  try{
    const id = getDeviceId();
    await Sync._fs.setDoc(docRef, { devices:{ [id]:true } }, { merge:true });
  }catch(err){
    registeredDeviceHouseId = '';
    setStatus('error', '端末数を保存できません：' + (err && err.code || err));
  }
}

function disconnect(){
  if(unsub){ unsub(); unsub = null; }
  docRef = null;
  registeredDeviceHouseId = '';
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

async function flush(){
  if(!docRef || !Sync._fs) return;
  const app_ = window.NatsuApp;
  if(!app_ || typeof app_.current !== 'function') return;

  const cur = app_.current();
  const now = Date.now();
  const payload = {};

  if(pending.config){ payload.config = cur.config; payload.configAt = now; }
  if(pending.state) { payload.state  = cur.state;  payload.stateAt  = now; }
  pending = { config:false, state:false };

  if(!Object.keys(payload).length) return;

  try{
    /* merge:true にして、送っていない側の欄を 消さないようにする。
       通信が 切れていても ここは 成功する（ブラウザに たまり、あとで 送られる） */
    await Sync._fs.setDoc(docRef, payload, { merge:true });
  }catch(err){
    setStatus('error', '保存できません：' + (err && err.code || err));
  }
}

/* ---------------------------------------------------------
   6. 匿名の登録家庭数
   あいことばそのものは保存せず、SHA-256 の値だけで同じ家庭を見分ける。
   初期設定の親端末から一度だけ呼ばれる。100家庭程度なら1文書の集計で十分で、
   競合時は Firestore の transaction が再試行する。 */
async function codeHash(code){
  const bytes = new TextEncoder().encode(String(code || '').trim().toLowerCase());
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
  const ref = Sync._fs.doc(db, 'metrics', 'registrations');
  await Sync._fs.runTransaction(db, async tx=>{
    const snap = await tx.get(ref);
    const data = snap.exists() ? (snap.data() || {}) : {};
    const households = data.households || {};
    if(households[hash]) return;
    households[hash] = Date.now();
    tx.set(ref, { count:Object.keys(households).length, households }, { merge:true });
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
  push,
  pushAll,
  connect,
  disconnect,
  registerHousehold,
  getRegistrationCount,
  /* あいことばを 入れ替えて つなぎ直す */
  async reconnect(code){
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
