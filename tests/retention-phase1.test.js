/* SPDX-License-Identifier: Apache-2.0 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');

test('保持メタデータはクライアント作成欄に含めず、更新でも変更不可', () => {
  const rules = fs.readFileSync(path.join(root, 'firestore.rules'), 'utf8');
  assert.match(rules, /onlyClientCreateFields/);
  assert.match(rules, /retentionMetadataUntouched/);
  for (const field of ['lastActivityAt', 'expiresAt', 'retentionVersion', 'retentionEligibleAt']) {
    assert.match(rules, new RegExp(field));
  }
  assert.match(rules, /diff\(resource\.data\)\.affectedKeys\(\)\.hasAny/);
});

test('activity trigger は config/state 変更だけを記録し削除処理を持たない', () => {
  const source = fs.readFileSync(path.join(root, 'functions', 'index.js'), 'utf8');
  assert.match(source, /contentChanged\(before, after\)/);
  assert.match(source, /recordHouseholdActivity/);
  assert.doesNotMatch(source, /\.delete\s*\(/);
  assert.doesNotMatch(source, /tombstone/i);
});
