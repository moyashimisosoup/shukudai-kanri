/* SPDX-License-Identifier: Apache-2.0 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  RETENTION_MS,
  contentChanged,
  buildRetentionMetadata
} = require('../retention');

class FakeTimestamp {
  constructor(ms) { this.ms = ms; }
  toMillis() { return this.ms; }
  static fromMillis(ms) { return new FakeTimestamp(ms); }
}

test('config/state の意味のある変更だけを活動に数える', () => {
  const base = { config: 'v1:a', state: 'v1:b', devices: { x: true } };
  assert.equal(contentChanged(base, { ...base, devices: { y: true } }), false);
  assert.equal(contentChanged(base, { ...base, lastActivityAt: 1 }), false);
  assert.equal(contentChanged(base, { ...base, config: 'v1:c' }), true);
  assert.equal(contentChanged(base, { ...base, state: 'v1:d' }), true);
  assert.equal(contentChanged(null, { devices: { x: true } }), false);
  assert.equal(contentChanged(null, { config: 'v1:a' }), true);
});

test('期限はサーバー活動時刻の90日後になる', () => {
  const at = new FakeTimestamp(Date.UTC(2026, 7, 11));
  const fields = buildRetentionMetadata(at, {}, FakeTimestamp);
  assert.equal(fields.lastActivityAt, at);
  assert.equal(fields.expiresAt.toMillis(), at.toMillis() + RETENTION_MS);
  assert.equal(fields.retentionEligibleAt.toMillis(), at.toMillis() + RETENTION_MS);
  assert.equal(fields.retentionVersion, 1);
});

test('導入時の最短削除可能日は後の活動で動かさない', () => {
  const eligible = new FakeTimestamp(1000);
  const at = new FakeTimestamp(5000);
  const fields = buildRetentionMetadata(at, { retentionEligibleAt: eligible }, FakeTimestamp);
  assert.equal(fields.retentionEligibleAt, eligible);
  assert.equal(fields.expiresAt.toMillis(), 5000 + RETENTION_MS);
});
