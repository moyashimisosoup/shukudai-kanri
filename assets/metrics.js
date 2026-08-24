/* =========================================================
   どの機能が どれだけ 使われているか（段階3：数えて 貯めて 送る）

   設計は docs/click-metrics-design.md（公開しない）。ここは 9節の 1 と 3。

   芯は「文字を 一切 読まない」こと。名前の 材料は 3つだけ に する。

     1. id 属性            2. data 属性の **名前**   3. class の 1語

   どれも コードに 書いてある 英字なので、利用者の 入力は 入りようがない。
   属性の **値** は 許可制で、下の VALUE_OK に 挙げた 9つ だけ を 見る。
   この 9つは 2026-08-24 に、値が コードの 固定文字列で あることを
   1つずつ 確かめた（表は CLAUDE_HANDOFF.md に ある）。

   ボタンの 見た目の 文字・説明文・下書きの 文字・入力欄の 中身は、
   **読む 経路そのものを 作らない。** 棚卸しで、それらを 読むと 必ず
   子どもの 名前・宿題名・本の 題名・メモ・合言葉に 当たることが
   分かっている。だから 属性は el.attributes からしか 見ない。

   仕上げに [a-z0-9_] へ 正規化するので、**日本語は 原理的に 通らない。**

   既存の 動きを 1つも 変えないこと。捕捉（capture）に 耳を 1つ 置くだけで、
   クリックの 既定の 動きも 伝わりも 止めない。全体を try/catch で 包み、
   失敗しても クリックは そのまま 通す。

   外へ 出すのは 終わった 日ぶんの 「名前と 回数」だけ。欄は d・ev・sh・v・
   expiresAt の 5つ に 固定して あり、宛先は 2つの googleapis だけ に 限る。
   どちらも tests/sync-regression.test.js の 「クリック統計」の 見張りが 保つ。

   **送れなくても 画面には 何も 出さない。** 同期の つながり具合の 表示にも
   一切 触らない。統計が 届かない だけで「つながりません」を 出すのは 事故。
   ========================================================= */
(function(){
  const KEY  = 'natsu.metrics.v1';   /* 端末だけの 値。共有の 鍵の表へ 足さないこと */
  /* 共有の 有無だけを 見る。**中身は 見ない。** 長さ だけを 真偽に して 捨てる */
  const CODE_KEY = 'natsu.sync.code.v1';

  const MAX_DEPTH = 5;        /* 押された ところから 親を たどる 上限 */
  const MAX_NAMES = 120;      /* 1日あたりの 名前の 種類 */
  const MAX_COUNT = 100000;   /* 1つの 名前の 1日あたりの 回数 */
  const MAX_DAYS  = 14;       /* 送れないまま 溜め続けない */
  const NAME_MAX  = 32;
  const SAVE_WAIT = 4000;     /* クリックの たびに は 書かない */
  const SEND_WAIT = 10000;    /* 起動 直後には 送らない。画面が 落ち着いてから */
  const KEEP_DAYS = 400;      /* 期限。TTL が 消す（設計 11節-2） */

  /* 送り先。**この 2つ 以外へは 出さない。** 鍵は Firebase の 公開鍵で、
     assets/sync.js と tools/analytics-admin.js に 入って いるのと 同じもの。
     共有して いない 家庭は sync.js を 一度も 読みこまないので、ここに 持つ */
  const API_KEY  = 'AIzaSyD6ZSA2T-0fei0VSZk5BpsCwTgnJ_UImBY';
  const AUTH_URL = 'https://identitytoolkit.googleapis.com/v1/accounts:';
  const DOCS_URL = 'https://firestore.googleapis.com/v1/projects/shukudai-kanri'
                 + '/databases/(default)/documents/metrics_days';

  /* 値を 見てよい 属性。値が コードの 固定文字列だと 確かめた ものだけ。
     ここに 無い 属性の 値へは 触れない。規則で 弾くより 触れない ほうが 強い。
     data-theme は <html> にしか 付かず 押せないので、確認のうえ 落とした */
  const VALUE_OK = ['tab','f','bf','role','welcome-role','welcome-mode','join-role','fun','sharing'];

  /* data- を 持つが 操作では ない 目印。名前の 材料に しない */
  const SKIP_DATA = ['no-reading','details-key','adult-section-help','cf-beacon','mic-status'];

  /* 同じ 属性名を 別の 機能が 使い回している。class を 1語 足して 分ける */
  const SPLIT_BY_CLASS = ['n','i'];

  /* 押せるもの。**入れ物は 入れない。** section や main に 落ちると、
     押していない 背景の クリックが その 区画の 名前で 数えられてしまう。
     棚卸しで、操作を 持つ data- は 1つ 残らず 下の タグの 上に あった */
  const CONTROL_TAGS  = ['BUTTON','SUMMARY','A','INPUT','SELECT','TEXTAREA','OPTION'];
  const CONTROL_ROLES = ['button','tab','link','checkbox','radio','switch','menuitem','option'];

  /* ?new=1 は 初期設定の おためし。natsu.preview.* を 使う 別物なので 数えない */
  const TEST_MODE = new URLSearchParams(location.search).get('new') === '1';

  let store = null;
  let dirty = false;
  let waiting = false;
  let sending = false;   /* 送るのは 1回の 起動に つき 1度だけ */

  /* --- 属性の 読み口。ここ 以外から 要素に 触らない ------------------ */

  function metricsAttrs(el){
    const out = [];
    const raw = el && el.attributes;
    if(!raw) return out;
    for(let i=0; i<raw.length; i++){
      const a = raw[i];
      if(a && a.name) out.push({ name:String(a.name).toLowerCase(), value:String(a.value == null ? '' : a.value) });
    }
    return out;
  }

  function metricsAttr(list, name){
    for(let i=0; i<list.length; i++) if(list[i].name === name) return list[i].value;
    return '';
  }

  function metricsDataNames(list){
    const out = [];
    for(let i=0; i<list.length; i++){
      const name = list[i].name;
      if(name.indexOf('data-') !== 0) continue;
      const key = name.slice(5);
      if(SKIP_DATA.indexOf(key) < 0) out.push(key);
    }
    return out;
  }

  /* --- 名前の 作り方 ------------------------------------------------- */

  /* 材料を 1つ 受けとって、名前に 使える 形に する。使えなければ 空を 返す */
  function metricsClean(text){
    const flat = String(text == null ? '' : text)
      .normalize('NFKC').toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '');
    if(!flat) return '';
    if(/[0-9]{4}/.test(flat)) return '';    /* t1724387000 のような 生成 id を 弾く */
    if(/^[0-9_]+$/.test(flat)) return '';   /* 数字だけの 材料は 捨てる */
    return flat.slice(0, NAME_MAX);
  }

  function metricsIsControl(el){
    if(!el || !el.tagName) return false;
    const tag = String(el.tagName).toUpperCase();
    if(tag === 'BODY' || tag === 'HTML') return false;
    if(CONTROL_TAGS.indexOf(tag) >= 0) return true;
    return CONTROL_ROLES.indexOf(String(metricsAttr(metricsAttrs(el), 'role')).toLowerCase()) >= 0;
  }

  /* 押された ところから 5階層まで さかのぼり、最初の 押せるものを 返す。
     見つからなければ null。**other のような 受け皿は 作らない** */
  function metricsTargetFor(node){
    let el = node;
    for(let depth = 0; el && depth < MAX_DEPTH; depth++){
      const tag = String(el.tagName || '').toUpperCase();
      if(tag === 'BODY' || tag === 'HTML') return null;
      if(metricsIsControl(el)) return el;
      el = el.parentElement;
    }
    return null;
  }

  function metricsNameFor(el){
    if(!el) return '';
    const list = metricsAttrs(el);
    const names = metricsDataNames(list);
    const classes = String(metricsAttr(list, 'class')).split(/\s+/).filter(Boolean);
    /* 状態の class（sel・on・is-selected）は うしろに 足されるので、
       1語目は 押しても 変わらない。ここを 使うと 系列が 途切れない */
    const firstClass = classes.length ? metricsClean(classes[0]) : '';

    let main = metricsClean(metricsAttr(list, 'id'));
    let from = 'id';
    if(!main && names.length){ main = metricsClean(names[0]); from = 'data'; }
    if(!main){ main = firstClass; from = 'class'; }
    if(!main) return '';

    /* うしろに 足すのは 多くとも 1つ。名前は 最大でも 2語に する */
    let tail = '';
    for(let i=0; i<list.length && !tail; i++){
      const a = list[i];
      if(a.name.indexOf('data-') !== 0) continue;
      if(VALUE_OK.indexOf(a.name.slice(5)) < 0) continue;
      tail = metricsClean(a.value);
    }
    if(!tail && from === 'data' && names.length > 1) tail = metricsClean(names[1]);
    if(!tail && from === 'data' && SPLIT_BY_CLASS.indexOf(names[0]) >= 0) tail = firstClass;

    return (tail && tail !== main ? main + '_' + tail : main).slice(0, NAME_MAX);
  }

  /* --- 端末の 中の 貯め ---------------------------------------------- */

  /* 共有を 設定して いるか だけ。合言葉の 文字は 1字も 残さない */
  function metricsShared(){
    try{ return String(localStorage.getItem(CODE_KEY) || '').length >= 8; }
    catch(e){ return false; }
  }

  /* 端末の 暦日。**時刻は 持たない**（生活の 時間帯が 読めてしまう） */
  function metricsDayKey(at){
    /* instanceof は 使わない。別の 窓（iframe・テスト）で 作られた Date は
       こちらの Date の 子では ないので、黙って 今日に 落ちる（実際に 踏んだ） */
    const stamp = at && typeof at.getTime === 'function' ? at.getTime() : NaN;
    const d = isNaN(stamp) ? new Date() : at;
    const pad = n => (n < 10 ? '0' : '') + n;
    return String(d.getFullYear()) + pad(d.getMonth() + 1) + pad(d.getDate());
  }

  /* 送るときの 文書の 名前。Firestore の 規則の [a-z0-9]{20} に そろえる。
     その日ぶんを 最初に 貯めた ときに 1つ 決め、再送しても 二重に ならない */
  function metricsDayId(){
    const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
    const bytes = new Uint8Array(20);
    try{ crypto.getRandomValues(bytes); }
    catch(e){ for(let i=0; i<20; i++) bytes[i] = (i * 7 + 3) % 256; }
    let out = '';
    for(let i=0; i<20; i++) out += chars[bytes[i] % chars.length];
    return out;
  }

  function metricsLoad(){
    if(store) return store;
    store = { v:1, days:{} };
    try{
      const raw = JSON.parse(localStorage.getItem(KEY) || 'null');
      if(raw && raw.v === 1 && raw.days && typeof raw.days === 'object') store.days = raw.days;
    }catch(e){}
    return store;
  }

  function metricsSave(){
    dirty = false;
    if(TEST_MODE) return;
    try{ localStorage.setItem(KEY, JSON.stringify(metricsLoad())); }catch(e){}
  }

  function metricsSaveSoon(){
    dirty = true;
    if(waiting) return;
    waiting = true;
    setTimeout(()=>{ waiting = false; if(dirty) metricsSave(); }, SAVE_WAIT);
  }

  function metricsTrim(){
    const days = metricsLoad().days;
    const keys = Object.keys(days).sort();
    while(keys.length > MAX_DAYS) delete days[keys.shift()];
  }

  function metricsBucket(day){
    const days = metricsLoad().days;
    if(!days[day]){
      days[day] = { id:metricsDayId(), sh:metricsShared(), ev:{} };
      metricsTrim();
      if(!days[day]) return null;   /* 14日より 古い日は 貯めない */
    }
    return days[day];
  }

  function metricsNote(name, at){
    if(TEST_MODE) return;
    const key = String(name || '');
    if(!key) return;
    try{
      const bucket = metricsBucket(metricsDayKey(at));
      if(!bucket) return;
      bucket.sh = metricsShared();
      const ev = bucket.ev;
      if(!(key in ev)){
        if(Object.keys(ev).length >= MAX_NAMES) return;   /* 新しい 名前だけ 捨てる */
        ev[key] = 0;
      }
      /* 端末に 残っていた 値が 壊れて いても、そのまま 数え続けない。
         段階3で 送るのは この 数なので、ここで 整数に 戻しておく */
      if(typeof ev[key] !== 'number' || !isFinite(ev[key]) || ev[key] < 0) ev[key] = 0;
      if(ev[key] < MAX_COUNT) ev[key]++;
      metricsSaveSoon();
    }catch(e){}
  }

  /* その日に アプリが 開かれた ことを 端末ごと 1日 1回だけ。
     ふつうの 名前として ev に 入れる（共有の 有無は sh が 持つ） */
  function metricsNoteDayOpen(at){
    if(TEST_MODE) return;
    try{
      const bucket = metricsBucket(metricsDayKey(at));
      if(!bucket || bucket.ev.day_open) return;
      metricsNote('day_open', at);
    }catch(e){}
  }

  /* --- 送り出し ------------------------------------------------------- */

  /* 期限は **送る日 d から** 決める。送った ときの 時計から 数えると、
     400日 先の 値の 中に 送信の 時間帯が そのまま 残ってしまう。
     d の UTC 0時から 数えれば、d より 細かい ことは 1つも 増えない */
  function metricsExpiry(day){
    const at = Date.UTC(Number(day.slice(0, 4)), Number(day.slice(4, 6)) - 1, Number(day.slice(6, 8)));
    return new Date(at + KEEP_DAYS * 86400000).toISOString();
  }

  /* Firestore の REST は 型を 明示する。作る 欄は **この 5つ だけ**。
     firestore.rules の hasOnly(['d','ev','sh','v','expiresAt']) と そろえる。
     端末を 追える 値も、時刻も、ここに 入れる 場所が 無い */
  function metricsFields(day, bucket){
    const ev = {};
    const names = Object.keys(bucket.ev || {});
    for(let i=0; i<names.length && i<MAX_NAMES; i++){
      const n = Number(bucket.ev[names[i]]);
      if(!isFinite(n) || n < 1) continue;
      ev[names[i]] = { integerValue:String(Math.floor(Math.min(n, MAX_COUNT))) };
    }
    return {
      d:         { stringValue:day },
      ev:        { mapValue:{ fields:ev } },
      sh:        { booleanValue:!!bucket.sh },
      v:         { integerValue:'1' },
      expiresAt: { timestampValue:metricsExpiry(day) }
    };
  }

  function metricsPost(url, body, token){
    const head = { 'Content-Type':'application/json' };
    if(token) head.Authorization = 'Bearer ' + token;
    return fetch(url, { method:'POST', headers:head, body:JSON.stringify(body) });
  }

  /* 終わった 日ぶんだけ。**今日ぶんは 送らない**（まだ 増えるので、
     送ると 統計と 使用実態が ずれる。数え漏れも 二重も 起きなくなる） */
  function metricsDueDays(){
    const today = metricsDayKey();
    return Object.keys(metricsLoad().days).filter(day=> day < today).sort();
  }

  /* tools/analytics-admin.js の registrationCount() と 同じ 3往復。
     匿名で 入り、置いて、その 匿名アカウントを 消す。**鍵は 端末に 残さない**
     （記憶の 中だけ。localStorage へは 1字も 書かない）。

     失敗しても 何も しない。画面にも 出さず、貯めも 消さず、次の 起動で やり直す */
  async function metricsSend(){
    if(TEST_MODE || sending) return false;
    if(typeof fetch !== 'function') return false;
    const due = metricsDueDays();
    if(!due.length) return false;
    sending = true;
    let token = '';
    try{
      const auth = await metricsPost(AUTH_URL + 'signUp?key=' + API_KEY, { returnSecureToken:true });
      if(!auth || !auth.ok) return false;
      const info = await auth.json();
      token = String((info && info.idToken) || '');
      if(!token) return false;

      const days = metricsLoad().days;
      let done = false;
      for(let i=0; i<due.length; i++){
        const day = due[i];
        const bucket = days[day];
        /* 名前が 規則の [a-z0-9]{20} に 合わない 日は、送っても 断られる。
           溜め続けても 直らないので、ここで 捨てる */
        if(!bucket || typeof bucket.id !== 'string' || !/^[a-z0-9]{20}$/.test(bucket.id)){
          delete days[day];
          done = true;
          continue;
        }
        const res = await metricsPost(
          DOCS_URL + '?documentId=' + bucket.id,
          { fields:metricsFields(day, bucket) },
          token
        );
        /* 409（すでに ある）は **届いて いる** と 読む。規則が 作るだけを
           許すので、同じ 名前の 文書は 2つ 作れない。二重に 数えない 仕掛けは
           これで 足りる（サーバ側に 何も 置かない） */
        if(!res || (!res.ok && res.status !== 409)) break;
        delete days[day];
        done = true;
      }
      if(done) metricsSave();
      return done;
    }catch(e){ return false; }
    finally{
      /* 匿名アカウントを 毎回 消す。Firebase 側にも 端末を 追える 値を 残さない */
      if(token){
        try{ metricsPost(AUTH_URL + 'delete?key=' + API_KEY, { idToken:token }).catch(function(){}); }catch(e){}
        token = '';
      }
    }
  }

  /* --- 耳は 1つだけ --------------------------------------------------- */

  document.addEventListener('click', function(e){
    try{
      const name = metricsNameFor(metricsTargetFor(e && e.target));
      if(name) metricsNote(name);
    }catch(err){}
  }, true);

  /* 画面を 離れる ときに 取りこぼさない。裏へ 回した ままの 端末が 多い */
  document.addEventListener('visibilitychange', function(){
    try{ if(dirty) metricsSave(); }catch(err){}
  });

  metricsNoteDayOpen();

  /* 起動 直後には 走らせない。最初の 描画と 同期の 立ち上がりが 済んだ
     継ぎ目で 1度だけ。送るものが 無ければ 通信は 1回も 起きない */
  setTimeout(function(){ try{ metricsSend(); }catch(e){} }, SEND_WAIT);

  window.NatsuMetrics = {
    nameFor: metricsNameFor,
    targetFor: metricsTargetFor,
    note: metricsNote,
    noteDayOpen: metricsNoteDayOpen,
    dayKey: metricsDayKey,
    snapshot: metricsLoad,
    flush: metricsSave,
    send: metricsSend,
    dueDays: metricsDueDays,
    VALUE_OK: VALUE_OK.slice()
  };
})();
