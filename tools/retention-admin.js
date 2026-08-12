/* SPDX-License-Identifier: Apache-2.0 */
'use strict';

/*
  ローカル専用の保持データ管理画面。
  ブラウザへFirebase管理者権限を渡さず、127.0.0.1 のこのプロセスだけが Admin SDK を使う。
  実行方法・必要な権限は tools/RETENTION_ADMIN.md を参照。
*/
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { parseHouseIds, retirementStatus } = require('./retention-admin-lib');
/* firebase-admin は functions 配下にだけインストールする。SDK 14 では
   パッケージのサブパスが exports 管理になり、相対パスの `.../firebase-admin/app`
   は解決できないため、実体の lib エントリを読む。 */
const { initializeApp, applicationDefault, cert, getApps } = require('../functions/node_modules/firebase-admin/lib/app');
const { getFirestore, FieldValue, Timestamp } = require('../functions/node_modules/firebase-admin/lib/firestore');

const HOST = '127.0.0.1';
const PORT = Number(process.env.RETENTION_ADMIN_PORT || 8787);
const ROOT = __dirname;

function credential(){
  const raw = process.env.RETENTION_ADMIN_SERVICE_ACCOUNT;
  if(raw) return cert(JSON.parse(raw));
  return applicationDefault();
}
if(!getApps().length) initializeApp({ credential:credential() });
const db = getFirestore();

function json(res, status, body){
  res.writeHead(status, { 'Content-Type':'application/json; charset=utf-8', 'Cache-Control':'no-store' });
  res.end(JSON.stringify(body));
}
function readJson(req){
  return new Promise((resolve, reject)=>{
    let text = '';
    req.on('data', chunk=>{
      text += chunk;
      if(text.length > 100000) reject(new Error('入力が大きすぎます'));
    });
    req.on('end', ()=>{
      try{ resolve(JSON.parse(text || '{}')); }catch(e){ reject(new Error('JSONを読み取れません')) }
    });
    req.on('error', reject);
  });
}
function iso(ms){ return ms ? new Date(ms).toISOString() : ''; }

async function inspect(ids){
  const refs = ids.map(id=>({ id, house:db.doc('households/' + id), tomb:db.doc('household_tombstones/' + id) }));
  const snaps = await Promise.all(refs.map(async row=>{
    const [house, tomb] = await db.getAll(row.house, row.tomb);
    const data = house.exists ? house.data() || {} : {};
    const status = retirementStatus(data, Date.now());
    return {
      id:row.id,
      exists:house.exists,
      deleting:tomb.exists,
      activityAt:iso(status.activityMs),
      due:status.due,
      reason:status.reason,
      remainingDays:status.remainingDays
    };
  }));
  return snaps;
}

async function retire(ids, allowEarly){
  const rows = await inspect(ids);
  const targets = rows.filter(row=>row.exists && !row.deleting && (row.due || allowEarly));
  const skipped = rows.filter(row=>!targets.includes(row));
  for(let start = 0; start < targets.length; start += 400){
    const batch = db.batch();
    targets.slice(start, start + 400).forEach(row=>{
      const activityAt = row.activityAt ? Timestamp.fromDate(new Date(row.activityAt)) : null;
      batch.set(db.doc('household_tombstones/' + row.id), {
        status:'deleting', reason:'manual-retention-v1', startedAt:FieldValue.serverTimestamp(),
        deletedAt:FieldValue.serverTimestamp(), policyVersion:1, lastActivityAt:activityAt
      });
      batch.delete(db.doc('households/' + row.id));
    });
    await batch.commit();
  }
  return { deleted:targets.map(row=>row.id), skipped };
}

const server = http.createServer(async (req, res)=>{
  if(req.headers.host && !req.headers.host.startsWith(HOST + ':')) return json(res, 403, { error:'localhostから開いてください' });
  try{
    if(req.method === 'GET' && req.url === '/'){
      const html = fs.readFileSync(path.join(ROOT, 'retention-admin.html'));
      res.writeHead(200, { 'Content-Type':'text/html; charset=utf-8', 'Cache-Control':'no-store' });
      return res.end(html);
    }
    if(req.method === 'POST' && req.url === '/api/inspect'){
      const body = await readJson(req); const ids = parseHouseIds(body.ids);
      if(!ids.length) return json(res, 400, { error:'64桁の共有IDを1件以上入力してください' });
      return json(res, 200, { rows:await inspect(ids) });
    }
    if(req.method === 'POST' && req.url === '/api/retire'){
      const body = await readJson(req); const ids = parseHouseIds(body.ids);
      if(!ids.length) return json(res, 400, { error:'64桁の共有IDを1件以上入力してください' });
      if(body.confirm !== '削除 ' + ids.length + ' 件') return json(res, 400, { error:'確認文が一致しません' });
      return json(res, 200, await retire(ids, body.allowEarly === true));
    }
    return json(res, 404, { error:'見つかりません' });
  }catch(error){
    return json(res, 500, { error:String(error && error.message || error) });
  }
});
server.listen(PORT, HOST, ()=>{
  console.log('保持データ管理画面: http://' + HOST + ':' + PORT + '/');
});
