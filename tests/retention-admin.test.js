/* SPDX-License-Identifier: Apache-2.0 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { parseHouseIds, retirementStatus, NINETY_DAYS_MS } = require('../tools/retention-admin-lib');

test('管理ツールは64桁の共有IDだけを重複なく受け取る', ()=>{
  const id = 'a'.repeat(64);
  assert.deepEqual(parseHouseIds('x ' + id + '\n' + id + ' z'), [id]);
  assert.deepEqual(parseHouseIds('a'.repeat(63)), []);
});

test('管理ツールは保持メタデータを優先し、無ければ既存の更新時刻を参考にする', ()=>{
  const now = Date.UTC(2026, 7, 11);
  const old = now - NINETY_DAYS_MS - 1;
  assert.equal(retirementStatus({ configAt:old }, now).due, true);
  assert.equal(retirementStatus({ configAt:old, lastActivityAt:{ toMillis:()=>now } }, now).due, false);
});
