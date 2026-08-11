/* SPDX-License-Identifier: Apache-2.0 */
'use strict';

const { onDocumentWritten } = require('firebase-functions/v2/firestore');
const { initializeApp } = require('firebase-admin/app');
const { getFirestore, Timestamp } = require('firebase-admin/firestore');
const {
  contentChanged,
  buildRetentionMetadata,
  timestampMillis
} = require('./retention');

initializeApp();

/* 第1段階は活動メタデータの記録だけ。削除・墓標・警告は行わない。
   Cloud Firestore のイベント時刻はサーバーが付けるため、端末時計で期限を
   未来へ延ばせない。config/state の暗号文が変わった時だけ活動とみなす。 */
exports.recordHouseholdActivity = onDocumentWritten(
  { document: 'households/{houseId}', region: 'asia-northeast1' },
  async event => {
    const change = event.data;
    if (!change || !change.after || !change.after.exists) return;

    const before = change.before && change.before.exists ? change.before.data() : null;
    const after = change.after.data() || {};
    if (!contentChanged(before, after)) return;

    const parsedEventTime = Date.parse(event.time || '');
    const activityAt = Number.isFinite(parsedEventTime)
      ? Timestamp.fromMillis(parsedEventTime)
      : Timestamp.now();
    const ref = change.after.ref;

    await getFirestore().runTransaction(async transaction => {
      const currentSnapshot = await transaction.get(ref);
      if (!currentSnapshot.exists) return;
      const current = currentSnapshot.data() || {};

      /* このイベントより後の config/state が既に保存されていれば、その変更の
         trigger に任せる。古いイベントが新しい活動時刻を巻き戻すのも防ぐ。 */
      if (current.config !== after.config || current.state !== after.state) return;
      if (timestampMillis(current.lastActivityAt) >= activityAt.toMillis()) return;

      transaction.update(ref, buildRetentionMetadata(activityAt, current, Timestamp));
    });
  }
);
