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
  apiKey:            '',
  authDomain:        '',
  projectId:         '',
  storageBucket:     '',
  messagingSenderId: '',
  appId:             ''
};

const SDK = 'https://www.gstatic.com/firebasejs/12.17.1/';

/* あいことばは この端末の localStorage に のこす。
   Firestore の 1件の書類（households/<あいことば>）を 端末どうしで 見に行く */
const K_CODE = 'natsu.sync.code.v1';

/* 打ちまちがえない 文字だけ。0/O と 1/l/I は 入れない */
const ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';
const CODE_LEN = 20;

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

function setStatus(s, text){
  status = s;
  statusText = text || '';
  listeners.forEach(fn => { try{ fn(s, statusText); }catch(e){} });
}

/* ---------------------------------------------------------
   3. あいことば
   --------------------------------------------------------- */
function getCode(){
  try{ return localStorage.getItem(K_CODE) || ''; }catch(e){ return ''; }
}
function setCode(code){
  const c = String(code || '').trim().toLowerCase().replace(/[^a-z0-9]/g, '');
  try{
    if(c) localStorage.setItem(K_CODE, c);
    else  localStorage.removeItem(K_CODE);
  }catch(e){}
  return c;
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
async function connect(){
  const code = getCode();

  if(!configured()){ setStatus('off', 'Firebase が設定されていません'); return; }
  if(code.length < 16){ setStatus('off', 'あいことばが設定されていません'); return; }

  setStatus('connecting', 'つないでいます…');

  try{
    const [{ initializeApp }, { getAuth, signInAnonymously }, fs] = await Promise.all([
      import(SDK + 'firebase-app.js'),
      import(SDK + 'firebase-auth.js'),
      import(SDK + 'firebase-firestore.js')
    ]);

    const app = initializeApp(FIREBASE_CONFIG);

    /* 匿名ログイン。画面には 何も出ない。
       これが あることで、規則に request.auth != null を 書ける */
    await signInAnonymously(getAuth(app));

    /* 通信が 切れているあいだの 読み書きを ブラウザに ためる。
       子の端末が 電波の無い所で「やった！」を 押しても 消えない */
    db = fs.initializeFirestore(app, {
      localCache: fs.persistentLocalCache({ tabManager: fs.persistentMultipleTabManager() })
    });

    docRef = fs.doc(db, 'households', code);
    Sync._fs = fs;

    if(unsub){ unsub(); unsub = null; }

    unsub = fs.onSnapshot(docRef,
      snap => {
        /* 自分が いま書いたぶんが 返ってきただけなら 何もしない。
           これを 見ないと 自分の保存で 自分の画面が 描き直される */
        if(snap.metadata.hasPendingWrites) return;

        setStatus(snap.metadata.fromCache ? 'offline' : 'online',
                  snap.metadata.fromCache ? 'オフライン（この端末に ためています）' : 'つながっています');

        if(!snap.exists()){ pushAll(); return; }

        const d = snap.data() || {};
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

function disconnect(){
  if(unsub){ unsub(); unsub = null; }
  docRef = null;
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
   6. 外に見せるもの
   --------------------------------------------------------- */
const Sync = {
  _fs: null,
  configured,
  getCode, setCode, makeCode,
  status:     () => status,
  statusText: () => statusText,
  onStatus(fn){ listeners.push(fn); fn(status, statusText); },
  push,
  pushAll,
  connect,
  disconnect,
  /* あいことばを 入れ替えて つなぎ直す */
  async reconnect(code){
    setCode(code);
    disconnect();
    await connect();
  }
};

window.NatsuSync = Sync;

/* app.js は もう動いている（classic script は 先に走る）。
   ここで はじめて 通信を 始める。読み込みが 遅れても 画面は 止まらない */
connect();
