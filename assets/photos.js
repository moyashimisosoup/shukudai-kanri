/* =========================================================
   写真の 置き場（端末ごと）

   宿題の 一覧を 写した 1枚を、この端末の 中に 置く。
   **同期しない。** state / config には 入れない。

   入れて しまうと、1家庭＝Firestore の 1文書（1MiB）に 写真が 乗り、
   記録が たまるほど 上限に 近づいて、いつか 家庭ぜんぶの 同期が
   止まる。写真は 端末に 置き、渡すときだけ 別の 一時ドキュメントを 使う。

   読めなくても アプリは そのまま 動くこと。IndexedDB は iOS Safari が
   裏で 閉じることが ある（sync.js の「5.5 立ち直り」と 同じ 根）。
   ここでは 失敗を すべて null で 返し、呼ぶ側は「まだ とどいていない」
   として 出す。記録そのものは 失われない。
   ========================================================= */
(function(){
  const DB_NAME = 'natsu.photos';
  const STORE   = 'photos';
  /* Firestore の 1文書は 1MiB。encryptField() が JSON化と base64 で
     二重に つつむので、元が 約580KB を こえると 渡せなく なる。
     余裕を 見て ここで 止める */
  const MAX_BYTES = 500 * 1024;
  const MAX_EDGE  = 1280;

  let dbPromise = null;

  function openDB(){
    if(dbPromise) return dbPromise;
    dbPromise = new Promise(resolve=>{
      let req;
      try{ req = indexedDB.open(DB_NAME, 1); }catch(e){ resolve(null); return; }
      req.onupgradeneeded = ()=>{
        const db = req.result;
        if(!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
      };
      req.onsuccess = ()=>{
        const db = req.result;
        /* 裏で 閉じられた あとは、次に 呼ばれた ときに 開き直す */
        db.onclose = ()=>{ dbPromise = null; };
        resolve(db);
      };
      req.onerror = ()=> resolve(null);
      req.onblocked = ()=> resolve(null);
    });
    return dbPromise;
  }

  function run(mode, fn){
    return openDB().then(db=>{
      if(!db) return null;
      return new Promise(resolve=>{
        let tx;
        try{ tx = db.transaction(STORE, mode); }catch(e){ dbPromise = null; resolve(null); return; }
        const req = fn(tx.objectStore(STORE));
        tx.onabort = ()=>{ dbPromise = null; resolve(null); };
        if(!req){ tx.oncomplete = ()=> resolve(true); return; }
        req.onsuccess = ()=> resolve(req.result === undefined ? true : req.result);
        req.onerror = ()=> resolve(null);
      });
    }).catch(()=> null);
  }

  function put(id, blob){ return run('readwrite', store=> store.put(blob, String(id))); }
  function get(id){ return run('readonly',  store=> store.get(String(id))); }
  function remove(id){ return run('readwrite', store=> store.delete(String(id))); }

  /* --- 形を そろえる ---------------------------------------
     iPhone の 写真は そのままだと 数MB ある。長辺を つめて JPEG に
     しなおす。品質を 下げても 収まらない ときは、辺も つめる。

     `accept="image/*"` だけで 選べば、iOS は HEIC を JPEG に して
     渡してくる。**accept に image/heic と 書かないこと**
     （Safari 17 いこう、書くと 逆に JPEG が HEIC に なる）。 */
  async function draw(file, edge){
    let bmp = null;
    try{
      bmp = await createImageBitmap(file);
    }catch(e){
      return null;
    }
    const scale = Math.min(1, edge / Math.max(bmp.width, bmp.height));
    const w = Math.max(1, Math.round(bmp.width * scale));
    const h = Math.max(1, Math.round(bmp.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext('2d');
    if(!ctx){ bmp.close && bmp.close(); return null; }
    ctx.drawImage(bmp, 0, 0, w, h);
    bmp.close && bmp.close();
    return { canvas, w, h };
  }

  function toBlob(canvas, quality){
    return new Promise(resolve=>{
      if(typeof canvas.toBlob !== 'function'){ resolve(null); return; }
      canvas.toBlob(b=> resolve(b), 'image/jpeg', quality);
    });
  }

  /* 収まらなければ null を 返す。呼ぶ側は「もっと 小さく 写して」と 出す。
     勝手に 荒い ままで 通さない（読めない 一覧に 意味は ない） */
  async function shrink(file){
    for(const edge of [MAX_EDGE, 1024, 800]){
      const drawn = await draw(file, edge);
      if(!drawn) return null;
      for(const q of [0.72, 0.6, 0.45]){
        const blob = await toBlob(drawn.canvas, q);
        if(blob && blob.size <= MAX_BYTES) return { blob, w:drawn.w, h:drawn.h };
      }
    }
    return null;
  }

  function toDataURL(blob){
    return new Promise(resolve=>{
      const fr = new FileReader();
      fr.onload = ()=> resolve(String(fr.result || ''));
      fr.onerror = ()=> resolve('');
      fr.readAsDataURL(blob);
    });
  }

  async function fromDataURL(text){
    try{
      const res = await fetch(String(text || ''));
      const blob = await res.blob();
      return blob && blob.size ? blob : null;
    }catch(e){ return null; }
  }

  window.NatsuPhotos = { put, get, remove, shrink, toDataURL, fromDataURL, MAX_BYTES, MAX_EDGE };
})();
