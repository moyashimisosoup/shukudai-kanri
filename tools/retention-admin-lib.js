/* SPDX-License-Identifier: Apache-2.0 */
'use strict';

const HOUSE_ID = /^[0-9a-f]{64}$/;
const NINETY_DAYS_MS = 90 * 24 * 60 * 60 * 1000;

function parseHouseIds(input){
  const ids = String(input || '').toLowerCase().match(/[0-9a-f]{64}/g) || [];
  return [...new Set(ids.filter(id => HOUSE_ID.test(id)))];
}

function millis(value){
  if(value && typeof value.toMillis === 'function') return value.toMillis();
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function latestActivityMs(data){
  const row = data || {};
  return Math.max(millis(row.lastActivityAt), millis(row.configAt), millis(row.stateAt));
}

function retirementStatus(data, now){
  const activityMs = latestActivityMs(data);
  if(!activityMs) return { activityMs:0, due:false, reason:'更新日時なし' };
  const remainingMs = activityMs + NINETY_DAYS_MS - now;
  return {
    activityMs,
    due: remainingMs <= 0,
    remainingDays: Math.ceil(remainingMs / 86400000),
    reason: remainingMs <= 0 ? '90日経過' : '期限前'
  };
}

module.exports = { HOUSE_ID, NINETY_DAYS_MS, parseHouseIds, latestActivityMs, retirementStatus };
