/* SPDX-License-Identifier: Apache-2.0 */
'use strict';

const RETENTION_VERSION = 1;
const RETENTION_DAYS = 90;
const RETENTION_MS = RETENTION_DAYS * 24 * 60 * 60 * 1000;

/* devices の自動登録や metadata trigger 自身の書き戻しは活動に数えない。
   暗号化された config / state のどちらかが変わった時だけ true にする。 */
function contentChanged(before, after) {
  if (!after) return false;
  const oldData = before || {};
  return oldData.config !== after.config || oldData.state !== after.state;
}

function timestampMillis(value) {
  return value && typeof value.toMillis === 'function' ? value.toMillis() : NaN;
}

function buildRetentionMetadata(activityAt, current, Timestamp) {
  const activityMs = timestampMillis(activityAt);
  if (!Number.isFinite(activityMs)) throw new TypeError('activityAt must be a Timestamp');

  const existingEligible = current && current.retentionEligibleAt;
  const eligibleAt = Number.isFinite(timestampMillis(existingEligible))
    ? existingEligible
    : Timestamp.fromMillis(activityMs + RETENTION_MS);

  return {
    lastActivityAt: activityAt,
    expiresAt: Timestamp.fromMillis(activityMs + RETENTION_MS),
    retentionVersion: RETENTION_VERSION,
    retentionEligibleAt: eligibleAt
  };
}

module.exports = {
  RETENTION_VERSION,
  RETENTION_DAYS,
  RETENTION_MS,
  contentChanged,
  buildRetentionMetadata,
  timestampMillis
};
