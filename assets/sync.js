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
   中身は この端末で 鍵を かけてから 送る（下の「1.5 中身の 暗号化」）。 */
/* ?new=1 のおためしモードは、普段使っているグループのあいことばを読まない。 */
const K_CODE = new URLSearchParams(location.search).get('new') === '1'
  ? 'natsu.preview.sync.code.v1'
  : 'natsu.sync.code.v1';
const K_DEVICE = new URLSearchParams(location.search).get('new') === '1'
  ? 'natsu.preview.sync.device.v1'
  : 'natsu.sync.device.v1';
/* 「はずされた」ときの あいことば。
   招待リンクは ホーム画面に 追加させるため URL に のこすように なった。
   ホーム画面版では 起動URL そのものに 焼きつく。
   これを おぼえて おかないと、はずした 端末が 開き直す だけで 戻ってきて
   しまい、「はずす」が 効かない。人が 打ち直した ときだけ 忘れる */
const K_JOIN_REVOKED = new URLSearchParams(location.search).get('new') === '1'
  ? 'natsu.preview.sync.revoked.code.v1'
  : 'natsu.sync.revoked.code.v1';
/* Firestoreへ渡す前にページを閉じても、次回起動で送信を再開するための目印。
   中身はすでに app.js の localStorage にあるため、未送信の種類だけを持つ。 */
const K_PENDING = new URLSearchParams(location.search).get('new') === '1'
  ? 'natsu.preview.sync.pending.v1'
  : 'natsu.sync.pending.v1';

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
let receiveHouseholdSnapshot = null;
let tombstoneUnsub = null;
let retiredFingerprint = '';
/* つなぎ直してから、おうちの中身を 1回でも 受け取ったか。
   受け取る 前の 端末は、手元の 設定が おうちの 設定より 新しいのか
   古いのか わからない。その あいだに 設定を 送ると、まだ 何も
   受け取っていない 初期値が おうち全体に 配られる（実際に 起きた） */
let gotSnapshot = false;
/* すでに ある グループへ 入る つもりで つないだか（招待リンク・確認ずみの参加）。
   true の あいだは、グループの文書が 無くても 新しく 作らない。
   グループを 1回 受け取れたら 用ずみなので おろす */
let joiningExisting = false;
let status = 'off';          // off | connecting | online | offline | error
let statusText = '';
/* つながらなくなった あとの 立ち直り用（5.5 を 見ること） */
let firebaseApp = null;
let memoryOnly = false;      // 保存庫（IndexedDB）を あきらめたか
let storageBroken = false;   // 保存庫が 原因で 失敗したと 分かったか
let lastTrouble = null;      // { at, where, detail } 設定ページの デバッグ欄用
let retryTimer = null;
let retryWait = 0;
let pushTimer = null;
let pending = readPending();
let pendingVersion = {
  config: pending.config ? 1 : 0,
  state: pending.state ? 1 : 0
};

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
function readPending(){
  try{
    const raw = localStorage.getItem(K_PENDING) || '';
    if(!raw) return { config:false, state:false };
    const saved = JSON.parse(raw);
    const currentCode = getCode();
    if(!saved || !currentCode){
      localStorage.removeItem(K_PENDING);
      return { config:false, state:false };
    }
    /* 旧形式の予約が別の共有先宛てなら、現接続へ持ち越さず捨てる。 */
    if(Object.prototype.hasOwnProperty.call(saved, 'code') && saved.code !== currentCode){
      localStorage.removeItem(K_PENDING);
      return { config:false, state:false };
    }
    const clean = { config:!!saved.config, state:!!saved.state };
    /* 旧版はここへ合言葉も複製していた。読めた時点で種類だけへ縮める。 */
    if(Object.prototype.hasOwnProperty.call(saved, 'code')){
      if(clean.config || clean.state) localStorage.setItem(K_PENDING, JSON.stringify(clean));
      else localStorage.removeItem(K_PENDING);
    }
    return clean;
  }catch(e){
    try{ localStorage.removeItem(K_PENDING); }catch(ignore){}
    return { config:false, state:false };
  }
}
function persistPending(){
  try{
    if(pending.config || pending.state){
      localStorage.setItem(K_PENDING, JSON.stringify({
        config:!!pending.config,
        state:!!pending.state
      }));
    }else{
      localStorage.removeItem(K_PENDING);
    }
  }catch(e){}
}
function clearPending(){
  pending = { config:false, state:false };
  pendingVersion.config += 1;
  pendingVersion.state += 1;
  persistPending();
}
function setCode(code){
  const before = getCode();
  const c = String(code || '').trim().normalize('NFKC').replace(/\s+/g,'').replace(/[\/\u0000-\u001f]/g, '');
  try{
    if(c) localStorage.setItem(K_CODE, c);
    else  localStorage.removeItem(K_CODE);
  }catch(e){}
  /* 別の家族へ、前の家族宛ての送信予約を持ち越さない。 */
  if(before !== c){ clearPending(); clearCryptoKey(); }
  return c;
}
/* はずされた あいことば。招待リンクからの 自動つなぎだけを ことわる。
   人が 手で 打ち直した ときは forgetRevokedCode() で 忘れるので、
   「はずす → あいことばを 入れ直す」は これまで通り できる */
function revokedFingerprint(){
  try{ return localStorage.getItem(K_JOIN_REVOKED) || ''; }catch(e){ return ''; }
}
async function rememberRevokedCode(code){
  try{
    if(code) localStorage.setItem(K_JOIN_REVOKED, `fp:${await codeFingerprint(code)}`);
  }catch(e){}
}
async function isRevokedCode(code){
  const saved = revokedFingerprint();
  if(!saved || !code) return false;
  const fingerprint = await codeFingerprint(code);
  if(saved.slice(0, 3) === 'fp:') return saved === `fp:${fingerprint}`;
  /* 旧版の平文コピーは比較に一度だけ使い、直ちにfingerprintへ置き換える。 */
  const legacyFingerprint = await codeFingerprint(saved);
  try{ localStorage.setItem(K_JOIN_REVOKED, `fp:${legacyFingerprint}`); }catch(e){}
  return legacyFingerprint === fingerprint;
}
async function migrateRevokedFingerprint(){
  const saved = revokedFingerprint();
  if(saved && saved.slice(0, 3) !== 'fp:'){
    try{ localStorage.setItem(K_JOIN_REVOKED, `fp:${await codeFingerprint(saved)}`); }catch(e){}
  }
}
function forgetRevokedCode(){
  try{ localStorage.removeItem(K_JOIN_REVOKED); }catch(e){}
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
/* 旧方式（合言葉をそのまま文書IDにする版）は 廃止した。
   中身に 鍵を かける ようにした ので、鍵の ない 旧文書は そもそも
   読めない。読み取りだけ 残しても「見つかったのに 読めない」に なる。
   旧方式で ためた 記録は、書き出し／読み込み（設定の「データ管理」）で
   移すこと。 */
/* 共有コードを Firestore の文書IDへ そのまま 置かない。IDの 推測を
   難しくする ための もので、中身を 守るのは 下の 暗号化のほう。
   **この値を 鍵の 塩に つかわないこと**（保存された 値と 鍵の 材料が
   同じに なる）。 */
async function houseIdFor(code){
  const digest = await sha256Bytes(normalizeCode(code));
  return Array.from(digest, n=>n.toString(16).padStart(2, '0')).join('');
}
async function codeFingerprint(code){ return houseIdFor(code); }
/* ---------------------------------------------------------
   1.5 中身の 暗号化（エンドツーエンド）

   名前・宿題・記録は、この端末で 鍵を かけてから Firestore へ 送る。
   鍵は 合言葉から 作り、どこにも 送らない。だから Firebase の
   管理者でも 中身は 読めない。

   **塩に 合言葉そのものや 文書ID を つかわないこと。**
   文書IDは すでに SHA-256(合言葉) で、これを 塩に すると
   「保存されている 値」と「鍵の 材料」が 同じに なってしまう。
   用途を 分ける ため、別の 文字を 混ぜてから もう一度 ハッシュする。

   塩は 決まった 値に する（乱数を 文書に 置かない）。あとから 参加する
   端末は 合言葉しか 持っておらず、文書を 読む 前に 鍵が 要るため。
   --------------------------------------------------------- */
const ENC_PREFIX = 'v1:';
const ENC_ITERATIONS = 250000;
let cryptoKey = null;
let cryptoKeyFingerprint = '';

function normalizeCode(code){
  return String(code || '').trim().normalize('NFKC').replace(/\s+/g, '').toLowerCase();
}
async function sha256Bytes(text){
  return new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)));
}
async function deriveKey(code){
  const normalized = normalizeCode(code);
  const fingerprint = await codeFingerprint(normalized);
  if(cryptoKey && cryptoKeyFingerprint === fingerprint) return cryptoKey;
  const salt = await sha256Bytes('natsu.e2ee.salt.v1|' + normalized);
  const material = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(normalized), 'PBKDF2', false, ['deriveKey']);
  cryptoKey = await crypto.subtle.deriveKey(
    { name:'PBKDF2', salt, iterations:ENC_ITERATIONS, hash:'SHA-256' },
    material, { name:'AES-GCM', length:256 }, false, ['encrypt','decrypt']);
  cryptoKeyFingerprint = fingerprint;
  return cryptoKey;
}
function clearCryptoKey(){
  cryptoKey = null;
  cryptoKeyFingerprint = '';
}
function bytesToBase64(bytes){
  let s = '';
  bytes.forEach(b=>{ s += String.fromCharCode(b); });
  return btoa(s);
}
function base64ToBytes(text){
  const bin = atob(text);
  const out = new Uint8Array(bin.length);
  for(let i=0;i<bin.length;i++) out[i] = bin.charCodeAt(i);
  return out;
}
/* 欄の名前を 追加の 認証データに 入れる。こうすると、管理者が
   config の 中身を state の 欄へ 移しかえても 復号に 失敗する */
async function encryptField(name, code, value){
  const key = await deriveKey(code);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = new TextEncoder().encode(JSON.stringify(value === undefined ? null : value));
  const buf = await crypto.subtle.encrypt(
    { name:'AES-GCM', iv, additionalData:new TextEncoder().encode(name) }, key, data);
  const body = new Uint8Array(buf);
  const all = new Uint8Array(iv.length + body.length);
  all.set(iv, 0);
  all.set(body, iv.length);
  return ENC_PREFIX + bytesToBase64(all);
}
function isCiphertext(v){ return typeof v === 'string' && v.slice(0, ENC_PREFIX.length) === ENC_PREFIX; }
/* 一覧の 呼び名だけを あけ直す。1台 読めなくても 一覧ぜんたいは 出す
   （役割・版は 平文なので、名前が 空でも 見分けは つく） */
async function decryptDevices(devs, code){
  const out = {};
  for(const id of Object.keys(devs || {})){
    const v = devs[id] || {};
    if(!isCiphertext(v.enc)){ out[id] = v; continue; }
    try{
      const open = await decryptField('device', code, v.enc);
      out[id] = Object.assign({}, v, { name:String(open.name||''), label:String(open.label||'') });
    }catch(e){ out[id] = v; }
  }
  return out;
}
async function decryptField(name, code, text){
  const key = await deriveKey(code);
  const all = base64ToBytes(text.slice(ENC_PREFIX.length));
  const buf = await crypto.subtle.decrypt(
    { name:'AES-GCM', iv:all.slice(0, 12), additionalData:new TextEncoder().encode(name) },
    key, all.slice(12));
  return JSON.parse(new TextDecoder().decode(buf));
}

function makeCode(){
  const buf = new Uint32Array(CODE_LEN);
  crypto.getRandomValues(buf);
  return Array.from(buf, n => ALPHABET[n % ALPHABET.length]).join('');
}
function configured(){
  return !!(FIREBASE_CONFIG.apiKey && FIREBASE_CONFIG.projectId);
}

/* 初期設定で「今あるグループに参加」する前の読み取り専用確認。
   connect() を使うと、存在しない合言葉でも新しいグループを作ってしまうため、
   ここでは文書を読むだけにして devices や設定を一切書き込まない。 */
async function verifyHousehold(code){
  const c = String(code || '').trim().normalize('NFKC').replace(/\s+/g,'').replace(/[\/\u0000-\u001f]/g, '');
  if(c.length < 8) return { found:false };
  if(!configured()) throw new Error('Firebase が設定されていません');
  if(!db){
    if(!initPromise) initPromise = initFirebase();
    await initPromise;
  }
  const fs = Sync._fs;
  const read = typeof fs.getDocFromServer === 'function' ? fs.getDocFromServer : fs.getDoc;
  const secureId = await houseIdFor(c);
  const tombstone = await readTombstone(fs, secureId, read);
  if(tombstone) return { found:false, retired:true };
  const secureRef = fs.doc(db, 'households', secureId);
  const secureSnap = await read(secureRef);
  if(!secureSnap.exists()) return { found:false };
  /* 見つかっても、鍵が あわなければ 中身は 見せない。
     参加の 前に 名前・漢字設定を 出すのは この復号が できた ときだけ */
  const raw = (secureSnap.data() || {}).config;
  if(!isCiphertext(raw)) return { found:true, config:null, unreadable:true };
  try{
    return { found:true, config: await decryptField('config', c, raw) };
  }catch(e){
    return { found:true, config:null, unreadable:true };
  }
}

/* 墓標は削除対象の共有IDだけを知る端末が1件ずつ読む。内容は持たず、
   古いオフライン端末が消したグループを作り直すのを止める印である。 */
async function readTombstone(fs, houseId, read){
  const ref = fs.doc(db, 'household_tombstones', houseId);
  try{
    const snap = await (read || fs.getDoc)(ref);
    return snap.exists() ? (snap.data() || {}) : null;
  }catch(e){
    /* 旧ルールがまだ公開中・オフラインなどでは、墓標確認の失敗だけで
       既存の同期を止めない。ルール公開後は watchTombstone() でも検知する。 */
    return null;
  }
}

const RETIRED_TEXT = 'この共有データは削除処理中のため、もう使えません。新しい合言葉で始めてください。';
function retireHousehold(code){
  const fingerprint = activeHouseId;
  if(fingerprint && retiredFingerprint === fingerprint) return;
  retiredFingerprint = fingerprint || 'retired';
  if(unsub){ unsub(); unsub = null; }
  if(tombstoneUnsub){ tombstoneUnsub(); tombstoneUnsub = null; }
  clearTimeout(pushTimer);
  pending = { config:false, state:false };
  docRef = null;
  activeHouseId = '';
  gotSnapshot = false;
  setDeviceMap({});
  setDeviceCount(0);
  if(getCode() === code) setCode('');
  setStatus('retired', RETIRED_TEXT);
  const app = window.NatsuApp;
  if(app && typeof app.onHouseholdRetired === 'function'){
    try{ app.onHouseholdRetired(); }catch(e){}
  }
}

function watchTombstone(fs, houseId, code){
  if(tombstoneUnsub){ tombstoneUnsub(); tombstoneUnsub = null; }
  const ref = fs.doc(db, 'household_tombstones', houseId);
  tombstoneUnsub = fs.onSnapshot(ref, snap=>{
    if(snap.exists()) retireHousehold(code);
  }, ()=>{
    /* 旧ルールの permission-denied は通常同期の失敗ではない。 */
  });
}

/* ---------------------------------------------------------
   4. つなぐ
   --------------------------------------------------------- */
/* ページを 開いた ときの 自動つなぎと、設定画面での「つなぎ直す」が
   ほぼ同時に 起きることが ある（起動直後に あいことばを 打ち直した場合など）。
   initializeApp・initializeFirestore は アプリの中で 1回しか 呼べないので、
   同時に 2回 初期化しないよう ここで ひとまとめにする */
let initPromise = null;

function failExistingJoin(message){
  if(!joiningExisting) return false;
  setCode('');
  disconnect();
  joiningExisting = false;
  const app0 = window.NatsuApp;
  if(app0 && typeof app0.onHouseholdJoinFailed === 'function'){
    try{ app0.onHouseholdJoinFailed(); }catch(e){}
  }
  setStatus('error', message);
  return true;
}

/* snapshot を先に張る。接続前に getDoc を待つと、オフライン時に
   ブラウザ内へためておく仕組みまで始められなくなるため。
   新方式の書類がオンラインで「ない」と確認できた時だけ、旧方式の
   書類を一度試す。これで既存グループを引き継ぎつつ、通信待ちで記録を失わない。 */
function watchHousehold(fs, ref, code){
  if(unsub){ unsub(); unsub = null; }
  docRef = ref;
  activeHouseId = ref.id;
  watchTombstone(fs, ref.id, code);
  const receiveSnapshot = async snap => {
      if(docRef !== ref || snap.metadata.hasPendingWrites) return;
      setStatus(snap.metadata.fromCache ? 'offline' : 'online',
                snap.metadata.fromCache ? 'オフライン（この端末に ためています）' : 'つながっています');
      if(!snap.metadata.fromCache) clearTrouble();

      if(!snap.exists()){
        /* キャッシュだけでは新旧を決めない。ここで新規文書を作ると、
           オフラインの既存端末が別のグループを作ってしまうため、オンラインの
           確認が来るまで保留する。保存操作の pending はそのまま残る。

           **ここに 例外を 作らないこと。** 以前は 旧方式へ 切りかえた
           あとの watcher だけ 素通りしていた。招待リンクで 入ったばかりの
           端末は その参照を まだ ためていないので、「文書なし（キャッシュ）」が
           1回 来る。そこで pushAll() すると、**まだ グループの 設定を
           受け取っていない 端末の 初期値が グループぜんたいへ 配られる**。 */
        if(snap.metadata.fromCache) return;
        /* 招待リンクなどで「あるグループへ入る」つもりの端末は、ここで
           グループを作らない。この端末の初期値がグループの中身になってしまう。
           あいことばの取りちがえ・旧方式IDの取りこぼしを、静かに
           上書きせず 画面に 出して 気づけるようにする */
        if(joiningExisting){
          failExistingJoin('この合言葉のグループが見つかりません。合言葉を確認してください');
          return;
        }
        /* グループを 新しく 作る、ただ1つの 道。あとから 事故を 追えるように
           「作った」ことを 記録に のこす（#config の 同期の記録） */
        const app0 = window.NatsuApp;
        if(app0 && typeof app0.onHouseholdCreate === 'function'){
          try{ app0.onHouseholdCreate(ref.id); }catch(e){}
        }
        registerDevice();
        pushAll();
        return;
      }

      const d = snap.data() || {};
      /* はずされた 判定は 平文の まま 先に。鍵が 合わなくても
         「もう このグループの 端末では ない」ことは 分かる */
      if(revokedForMe(d.devices)){
        await rememberRevokedCode(getCode());
        setCode('');
        disconnect();
        const app0 = window.NatsuApp;
        if(app0 && typeof app0.onHouseholdRevoked === 'function'){
          try{ app0.onHouseholdRevoked(); }catch(e){}
        }
        setStatus('off', 'この端末は はずされました。あいことばを 入れ直してください');
        return;
      }

      /* **鍵を あけられない うちは、受信済みに しないこと。**
         gotSnapshot を 先に 立てると configHeldBack() が false に なり、
         次の saveCfg() が この端末の 初期値を グループぜんたいへ 配る。
         「まだ グループを 受け取っていない 端末が グループを 上書きする」という、
         この作りで くり返し 起きてきた 事故と 同じ 道すじ。
         読めない ときは 何も 受け取らなかった ことに して、画面に 出す */
      let plainConfig = null;
      let plainState = null;
      /* 読めない 理由は 2つ あり、直し方が ちがう。取りちがえると
         「合言葉を 確かめて」と 言われた 人が、正しい 合言葉を
         何度も 入れ直す ことに なる。分けて 出す */
      const sealed = v => v === undefined || v === null || isCiphertext(v);
      if(!sealed(d.config) || !sealed(d.state)){
        /* 鍵を かける 前の 版が 作った グループ。鍵が 無いのでは なく、
           そもそも かかっていない。合言葉を 入れ直しても 直らない */
        const message = 'このグループは 古い方式で 保存されています。'
          + '保護者の端末を 最新に 更新し、合言葉を 作り直してください';
        if(!failExistingJoin(message)) setStatus('error', message);
        return;
      }
      try{
        if(isCiphertext(d.config)) plainConfig = await decryptField('config', code, d.config);
        if(isCiphertext(d.state))  plainState  = await decryptField('state',  code, d.state);
      }catch(e){
        const message = '合言葉が ちがうため、中身を 読めません';
        if(!failExistingJoin(message)) setStatus('error', message);
        return;
      }
      if(docRef !== ref) return;    // 読んでいる あいだに つなぎ直された

      /* 中身があるキャッシュ、またはオンラインで確認できた文書だけを
         「グループの設定を受信済み」とする。空のキャッシュを受信済みにすると、
         QR参加直後の初期設定をグループへ送れる状態になってしまう。 */
      const firstSnapshot = !gotSnapshot;
      gotSnapshot = true;
      joiningExisting = false;      // グループを受け取れた。以後はふつうの端末

      const devs = d.devices || {};
      setDeviceCount(Object.keys(devs).filter(k => !(devs[k] && devs[k].revoked)).length);
      setDeviceMap(await decryptDevices(devs, code));
      registerDevice();
      const app_ = window.NatsuApp;
      if(app_ && typeof app_.onRemote === 'function'){
        app_.onRemote({
          config:   plainConfig,
          state:    plainState,
          configAt: d.configAt || 0,
          stateAt:  d.stateAt  || 0,
          /* つなぎ直してから 最初に 受け取った グループの中身かどうか。
             この 1回だけは、手元の 設定が どれだけ 新しく 見えても
             グループの 設定を 採る（下の app.js 側の 説明を 見ること） */
          first:    firstSnapshot
        });
      }
      /* 接続前に端末内へ保存されていた変更を、まず相手と合流してから送る。 */
      flushPendingSoon();
  };
  receiveHouseholdSnapshot = receiveSnapshot;
  unsub = fs.onSnapshot(ref, receiveSnapshot,
    err => noteTrouble('受信', err));
  /* 起動直後の listener は、端末に残った Firestore キャッシュを先に返す。
     子ども端末が通信できる場合はサーバーを一度直接読み、親端末がその後オフラインに
     なっても、すでにクラウドへ届いた最新 state を必ず取り込む。完全にオフラインなら
     失敗を黙って無視し、従来どおり端末内キャッシュで起動する。 */
  refreshFromServer();
}

/* キャッシュから先に起動しても、通信できるときはサーバーの確定データを読む。
   保護者ページの更新ボタンも同じ入口を使うので、listener の再接続待ちに
   ならず、その場で最新の共有 state を取り込める。 */
async function refreshFromServer(){
  /* 切れている あいだは docRef が 無く、読むものが ない。
     「更新できません」と 突き返す 前に、まず つなぎ直しを 試す */
  if(status === 'error' && !recovering){ clearTrouble(); await recoverConnection(); }
  const fs = Sync._fs;
  const ref = docRef;
  const receive = receiveHouseholdSnapshot;
  if(!fs || !ref || !receive || typeof fs.getDocFromServer !== 'function') return false;
  try{
    const snap = await fs.getDocFromServer(ref);
    if(docRef !== ref || receiveHouseholdSnapshot !== receive) return false;
    await receive(snap);
    return true;
  }catch(e){ return false; }
}

async function connect(){
  const code = getCode();

  if(!configured()){ setStatus('off', 'Firebase が設定されていません'); return; }
  if(code.length < 8){ setStatus('off', 'あいことばが設定されていません'); return; }

  setStatus('connecting', 'つないでいます…');
  gotSnapshot = false;

  try{
    /* initializeApp と initializeFirestore は アプリの中で 1回しか 呼べない。
       あいことばを 入れ替えて つなぎ直すたびに ここへ 戻ってくるので、
       2回目からは 作った db を そのまま つかい、docRef だけ 差し替える */
    if(!db){
      if(!initPromise) initPromise = initFirebase();
      await initPromise;
    }

    const fs = Sync._fs;
    /* 新しい方式を先に読む。旧版で作ったグループかどうかは、snapshot が
       オンラインで空だった時だけ watchHousehold() が確認する。 */
    const secureId = await houseIdFor(code);
    const secureRef = fs.doc(db, 'households', secureId);
    if(await readTombstone(fs, secureId)){
      retireHousehold(code);
      return;
    }
    watchHousehold(fs, secureRef, code);

  }catch(err){
    noteTrouble('接続', err);
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
  firebaseApp = app;

  /* 匿名ログイン。画面には 何も出ない。
     これが あることで、規則に request.auth != null を 書ける */
  await signInAnonymously(getAuth(app));

  /* 通信が 切れているあいだの 読み書きを ブラウザに ためる。
     子の端末が 電波の無い所で「やった！」を 押しても 消えない */
  db = fs.initializeFirestore(app, {
    localCache: fs.persistentLocalCache({ tabManager: fs.persistentMultipleTabManager() })
  });
}

/* ---------------------------------------------------------
   5.5 つながらなくなった あとの 立ち直り

   iOS の Safari には、アプリを 何度か 裏へ 回すと ブラウザ内の 保存庫
   （IndexedDB）が 閉じられ、以後の 読み書きが すべて 失敗する 不具合が ある。
   WebKit 側の 問題なので こちらからは 防げない。実際に 保護者の端末で
   「Database is closing」が 出て、アプリを 開き直すまで 共有が 止まった。

   そこで 起きた あとに 自力で 立ち直る。
   1. 画面に 戻ったとき・通信が 戻ったときに つなぎ直す（それでも だめなら 時間を あけて 再挑戦）
   2. 保存庫が 壊れている ときは、保存庫を あきらめて 通信だけで つなぎ直す

   2 で オフラインの ためこみは 減るが、**記録は 消えない**。
   送れていない 変更は もともと この端末の localStorage（未送信キュー）が
   持っていて、つながった ときに 送り直すため。
   --------------------------------------------------------- */
const TROUBLE_TEXT = 'つながりません。アプリを開き直すと直ることがあります';
/* 保存庫まわりの 失敗かどうか。文言は ブラウザごとに ちがうので 広めに 見る */
const STORAGE_TROUBLE = /indexeddb|database is clos|is closing|persistence|storage|quota/i;
const RETRY_MIN = 15000, RETRY_MAX = 300000;

function troubleDetail(err){
  const e = err || {};
  return String(e.code ? e.code + '：' + (e.message || '') : (e.message || e));
}

/* 画面に 出すのは やさしい 一文だけ。内部の 文言は 大人の 設定ページの
   デバッグ欄からだけ 見られるようにする（保護者に 英語の 例外を 読ませない） */
function noteTrouble(where, err){
  lastTrouble = { at: Date.now(), where, detail: troubleDetail(err) };
  if(STORAGE_TROUBLE.test(lastTrouble.detail)) storageBroken = true;
  setStatus('error', TROUBLE_TEXT);
  scheduleRecovery();
}

function scheduleRecovery(){
  if(retryTimer || getCode().length < 8) return;
  retryWait = retryWait ? Math.min(retryWait * 2, RETRY_MAX) : RETRY_MIN;
  retryTimer = setTimeout(()=>{ retryTimer = null; recoverConnection(); }, retryWait);
}

/* 保存庫を あきらめて つなぎ直す。terminate() の あとは 同じ設定で
   initializeFirestore() を 呼べないことが あるので、その ときは
   既定（メモリだけ）の getFirestore() に 落とす */
async function restartWithoutStorage(){
  const fs = Sync._fs;
  if(!fs || !firebaseApp || memoryOnly) return false;
  memoryOnly = true;
  if(unsub){ try{ unsub(); }catch(e){} unsub = null; }
  if(tombstoneUnsub){ try{ tombstoneUnsub(); }catch(e){} tombstoneUnsub = null; }
  docRef = null;
  receiveHouseholdSnapshot = null;
  gotSnapshot = false;
  try{ if(db) await fs.terminate(db); }catch(e){}
  db = null;
  try{ db = fs.initializeFirestore(firebaseApp, { localCache: fs.memoryLocalCache() }); }
  catch(e){ try{ db = fs.getFirestore(firebaseApp); }catch(e2){ db = null; } }
  return !!db;
}

/* つなぎ直しは 1本だけ 走らせる。画面復帰・通信復帰・時間切れが
   重なっても、connect() を 何本も 走らせない */
let recovering = false;
async function recoverConnection(){
  if(recovering) return false;
  if(getCode().length < 8) return false;
  if(status !== 'error') return false;
  recovering = true;
  try{
    if(storageBroken) await restartWithoutStorage();
    await connect();
    return true;
  }catch(err){
    noteTrouble('つなぎ直し', err);
    return false;
  }finally{
    recovering = false;
  }
}

/* うまく つながったら、次に 失敗した ときのために 待ち時間を 戻す */
function clearTrouble(){
  retryWait = 0;
  if(retryTimer){ clearTimeout(retryTimer); retryTimer = null; }
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
  const key = [activeHouseId, info.role, info.name, info.label, info.ver].join('|');
  if(lastDeviceWrite === key) return;
  lastDeviceWrite = key;
  try{
    const id = getDeviceId();
    /* 一覧に 出る 呼び名と 子どもの 名前も 中身と 同じで、外から
       読めては いけない。役割・版・はずした印・時刻は 平文の まま。
       これらは 復号する 前に 使う（はずされた 端末の 判定、台数、
       版ちがいの 注意）ので、鍵を かけると 見られなくなる */
    const stored = Object.assign({}, info, {
      name:'', label:'',
      enc: await encryptField('device', getCode(), { name:info.name, label:info.label })
    });
    await Sync._fs.setDoc(docRef, { devices:{ [id]: stored } }, { merge:true });
    /* 自分が 書いたぶんは onSnapshot が 読み飛ばす（hasPendingWrites）。
       そのため 一覧の 自分の行だけが 古いままに なり、
       呼び名を つけても 出ない、最新なのに「古い」と 出る、が 起きる。
       書けた時点で 手元の 一覧にも 反映する */
    setDeviceMap(Object.assign({}, deviceMap, { [id]: info }));
  }catch(err){
    lastDeviceWrite = '';
    noteTrouble('端末の記録', err);
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
    noteTrouble('端末をはずす', err);
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
  receiveHouseholdSnapshot = null;
  if(tombstoneUnsub){ tombstoneUnsub(); tombstoneUnsub = null; }
  retiredFingerprint = '';
  gotSnapshot = false;
  docRef = null;
  activeHouseId = '';
  clearCryptoKey();
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
  if(kind === 'config'){
    pending.config = true;
    pendingVersion.config += 1;
  }
  if(kind === 'state'){
    pending.state = true;
    pendingVersion.state += 1;
  }
  persistPending();
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

  const sending = { config:pending.config, state:pending.state };
  const sentVersion = { config:pendingVersion.config, state:pendingVersion.state };
  if(!sending.config && !sending.state) return;
  try{
    const cur = app_.current();
    const now = Date.now();
    const payload = {};

    /* 中身は 鍵を かけてから 出す。時刻は 平文の まま。
       時刻まで 隠すと、どちらが 新しいかを 決めるのに 復号が 要り、
       鍵の ない 端末が「文書は あるのに 何も 分からない」状態に なる */
    const code = getCode();
    if(sending.config){ payload.config = await encryptField('config', code, cur.config); payload.configAt = now; }
    if(sending.state) {
      payload.state   = await encryptField('state', code, cur.state);
      payload.stateAt = now;
      /* どの端末が 送ったかを のこす。合わなかった ときに、どちらの端末の
         値だったのかを 名前で 見られる ようにする。 */
      payload.devices = { [getDeviceId()]: { lastAt: now } };
    }

    /* merge:true にして、送っていない側の欄を 消さないようにする。
       通信が 切れていても ここは 成功する（ブラウザに たまり、あとで 送られる） */
    await Sync._fs.setDoc(docRef, payload, { merge:true });
    /* 送信中に同じ種類がもう一度変更された場合、その新しい予約は残す。 */
    if(sending.config && pendingVersion.config === sentVersion.config) pending.config = false;
    if(sending.state && pendingVersion.state === sentVersion.state) pending.state = false;
    persistPending();
  }catch(err){
    /* 一時的な失敗では送信予約を消さない。再接続・再起動後に再送する。 */
    persistPending();
    noteTrouble('送信', err);
  }
}

/* 通信が 戻ったとき・画面に 戻ったときは、ためた ぶんを 送るだけでなく、
   切れたままなら つなぎ直す。iOS の 保存庫の 不具合は 裏へ 回した ときに
   起きるので、戻ってきた この 瞬間が いちばん 立ち直りやすい */
function resumeSync(){
  flushPendingSoon();
  if(status === 'error'){ clearTrouble(); recoverConnection(); }
}
addEventListener('online', resumeSync);
document.addEventListener('visibilitychange', ()=>{
  if(document.visibilityState === 'visible') resumeSync();
});

/* ---------------------------------------------------------
   6. 匿名の登録グループ数

   あいことばそのものは保存せず、SHA-256 の値だけで同じグループを見分ける。
   初期設定の親端末から一度だけ呼ばれる。

   以前は metrics/registrations の中に
   { households: { <あいことばのSHA-256>: 登録日時 } } を持っていた。
   数を数えるには その一覧を 読む必要が あるため、規則で 読みを 止められず、
   誰でも 全グループぶんの ハッシュを 取り出せる状態に なっていた。
   旧版の短いあいことばでは、一覧が出ると総当たりで割られ、
   そのグループの 記録まで 読まれてしまう。

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
    if(mine.exists()) return;                 // このグループは すでに 数えてある
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
/* ---------------------------------------------------------
   5.7 写真の 受け渡し箱（一時）

   宿題の 一覧の 写真は、各端末の 中（IndexedDB）に 置く。
   ここは **運ぶだけの 箱**で、置き場では ない。

   ・グループの 文書（households）には 入れない。1文書 1MiB に 写真が
     乗ると、記録が たまるほど 上限に 近づき、いつか 家庭ぜんぶの 同期が
     止まる。だから 別の 文書に 分ける。
   ・**読んだら 消す、では なく 期限で 消える。** 読み取りと 削除の あいだで
     通信が 切れると「読めていないのに 消えた」が 起きる。TTL に まかせ、
     削除は 補助に する。子端末が 何台 あっても 早い者勝ちに ならない。
   ・中身は これまでと 同じ 合言葉の 鍵で 包む。AAD に 'photo' を 使うので、
     config / state の 暗号文と 取りちがえない。

   **expiresAt の TTL は Firebase コンソールで 設定ずみ。** */
const HANDOFF_PATH = 'photo_handoff';
const HANDOFF_MS = 24 * 60 * 60 * 1000;
/* 1家庭あたり 4つまで（0〜3まいめ）。**0まいめの 箱の ID は、これまでと
   同じ houseId そのもの。** 版が 混ざっている あいだ、旧い 端末は
   この ID しか 見ないので、1枚めだけは 受け取れる（減るが 壊れない）。
   ここを `-0` に すると、旧い 端末に 何も 届かなく なる。 */
const HANDOFF_SLOTS = 4;

function handoffBoxId(houseId, slot){
  const n = Number(slot) || 0;
  return n > 0 ? houseId + '-' + n : houseId;
}

async function handoffRef(slot){
  const code = getCode();
  if(code.length < 8 || !configured()) return null;
  if(!db){
    if(!initPromise) initPromise = initFirebase();
    await initPromise;
  }
  if(!db || !Sync._fs) return null;
  return Sync._fs.doc(db, HANDOFF_PATH, handoffBoxId(await houseIdFor(code), slot));
}

/* 写真を 箱に 入れる。渡せたかどうかだけを 返す */
/* 写真の やりとりの 失敗を 控える。**setStatus('error') を 呼ばないこと。**
   noteTrouble() を つかうと、写真が 渡せなかっただけで 同期ぜんたいが
   「つながりません」に なり、つなぎ直しまで 走ってしまう。
   写真は 宿題の 記録とは 別の 話なので、控えるだけに する。 */
function notePhotoTrouble(where, err){
  lastTrouble = { at: Date.now(), where, detail: troubleDetail(err) };
}

async function putHandoff(dataURL, slot){
  try{
    const ref = await handoffRef(slot);
    if(!ref) return false;
    const now = Date.now();
    await Sync._fs.setDoc(ref, {
      photo: await encryptField('photo', getCode(), String(dataURL || '')),
      at: now,
      from: getDeviceId(),
      expiresAt: new Date(now + HANDOFF_MS)
    });
    return true;
  }catch(err){
    notePhotoTrouble('写真の受け渡し', err);
    return false;
  }
}

/* 枠ごとの「箱に いつ 入れたか」。**中身は 読まない**（復号もしない）ので、
   片づけと 入れ直しの 判断だけに 使う。無い 枠は 0。
   読み取りは 4回で、保護者ページを 開いた ときの 1回だけ 走らせる。 */
async function handoffAts(){
  const out = [];
  for(let slot = 0; slot < HANDOFF_SLOTS; slot++){
    let at = 0;
    try{
      const ref = await handoffRef(slot);
      if(ref){
        const snap = await Sync._fs.getDoc(ref);
        if(snap.exists()) at = Number((snap.data() || {}).at) || 0;
      }
    }catch(e){ notePhotoTrouble('写真の状態の確認', e); }
    out.push(at);
  }
  return out;
}

/* 箱を のぞく。空・読めない・切れている ときは null。
   呼ぶ側は「まだ とどいていない」と 出すこと（例外の 文言を 画面に 出さない） */
async function takeHandoff(slot){
  try{
    const ref = await handoffRef(slot);
    if(!ref) return null;
    const fs = Sync._fs;
    const read = typeof fs.getDocFromServer === 'function' ? fs.getDocFromServer : fs.getDoc;
    const snap = await read(ref);
    if(!snap.exists()) return null;
    const raw = (snap.data() || {}).photo;
    if(!isCiphertext(raw)) return null;
    return await decryptField('photo', getCode(), raw);
  }catch(err){
    notePhotoTrouble('写真の受け取り', err);
    return null;
  }
}

/* 古い 箱を 片づける。**TTL が 無くても 溜まらない ようにする ため。**
   TTL（Firebase コンソール側の 設定）は 安全網で、こちらが 本筋。
   期限より 古ければ 消し、消したかどうかを 返す。
   読めない・切れている ときは 何も しない（画面に 出す ことも しない） */
/* **枠ぜんぶを 見る。** 見にいくのは 保護者ページを 開いた ときの 1回だけなので、
   読み取りは 開くたび 4回。持っていない 枠の 箱は そもそも 無いので、
   ほとんどは 空振りで 終わる。1つでも 消したら true */
async function sweepHandoff(){
  let swept = false;
  for(let slot = 0; slot < HANDOFF_SLOTS; slot++){
    if(await sweepHandoffSlot(slot)) swept = true;
  }
  return swept;
}

async function sweepHandoffSlot(slot){
  try{
    const ref = await handoffRef(slot);
    if(!ref) return false;
    const fs = Sync._fs;
    const snap = await fs.getDoc(ref);
    if(!snap.exists()) return false;
    const at = Number((snap.data() || {}).at) || 0;
    if(at && Date.now() - at < HANDOFF_MS) return false;
    return await clearHandoff(slot);
  }catch(e){ return false; }
}

/* 受け取った あとの 後始末。失敗しても 害は ない（古ければ sweepHandoff が 消す） */
async function clearHandoff(slot){
  try{
    const ref = await handoffRef(slot);
    if(!ref || typeof Sync._fs.deleteDoc !== 'function') return false;
    await Sync._fs.deleteDoc(ref);
    return true;
  }catch(e){ return false; }
}

const Sync = {
  _fs: null,
  configured,
  getCode, setCode, makeCode,
  isRevokedCode, forgetRevokedCode,
  codeFingerprint,
  householdFingerprint: () => activeHouseId,
  /* おうちの中身を まだ 1回も 受け取っていない あいだは true。
     この あいだ、app.js は 設定を 送らない */
  awaitingFirstSnapshot: () => getCode().length >= 8 && !gotSnapshot,
  status:     () => status,
  statusText: () => statusText,
  /* 画面には やさしい 一文しか 出さない。英語の 例外は ここから 取り出し、
     大人の 設定ページの デバッグ欄にだけ 出す */
  lastTrouble: () => lastTrouble,
  storageMode: () => (memoryOnly ? 'memory' : 'persistent'),
  onStatus(fn){ listeners.push(fn); fn(status, statusText); },
  deviceCount: displayedDeviceCount,
  onDeviceCount(fn){ deviceListeners.push(fn); fn(displayedDeviceCount()); },
  devices: () => deviceMap,
  removeDevice,
  onDevices(fn){ mapListeners.push(fn); fn(deviceMap); },
  refreshDevice,
  push,
  pushAll,
  refresh: refreshFromServer,
  connect,
  disconnect,
  verifyHousehold,
  registerHousehold,
  putHandoff, takeHandoff, clearHandoff, sweepHandoff, handoffAts, HANDOFF_SLOTS, HANDOFF_MS,
  getRegistrationCount,
  /* あいことばを 入れ替えて つなぎ直す */
  /* opts.joining … すでに ある グループへ 入るとき true。
     招待リンク・確認ずみの 手入力参加が これ。**その端末は グループを
     作ってはいけない。** 作れてしまうと、まだ グループの 設定を 受け取って
     いない 端末の 初期値が グループの 中身に なる */
  async reconnect(code, opts){
    /* 入れ直した 直後の 1回は「はずされた」印を 見のがす。
       でないと 入れたとたんに また 切られる */
    skipRevokeOnce = true;
    setCode(code);
    disconnect();
    joiningExisting = !!(opts && opts.joining);
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
migrateRevokedFingerprint().finally(connect);
