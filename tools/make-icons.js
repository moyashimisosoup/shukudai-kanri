/* SPDX-License-Identifier: Apache-2.0 */
/*
   ホーム画面アイコンの PNG を作る。

   なぜ 手書きの ラスタライザなのか
   - iOS の apple-touch-icon は **不透明の PNG** でないと、透過部分が黒で
     うまる。SVG は読まれない
   - 画像ライブラリを入れたくない。依存を増やすと、そのライセンス表記も
     増える（NOTICE / LICENSE-CONTENT.md の網羅性を保つのが大変になる）
   - 図案は assets/icon.svg と同じ座標（180×180 の設計座標）で書いてある。
     図案を直すときは **両方**を同じ数字に そろえること

   使い方: node tools/make-icons.js
*/
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

const OUT = path.join(__dirname, '..', 'assets');

/* 図案（180×180 の設計座標）。assets/icon.svg と同じ値 */
const BG    = [0x14, 0x37, 0x5e];   // 濃い紺（manifest の theme_color）
const PAPER = [0xff, 0xf9, 0xef];   // 紙のクリーム色
const RULE  = [0xc6, 0xd6, 0xe4];   // うすい罫線
const CHECK = [0x3e, 0xa0, 0x5c];   // みどりの チェック

const PAGE  = { cx:90, cy:90, hw:56, hh:64, r:12 };
const RULES = [
  { x0:52, x1:128, y:56, w:7 },
  { x0:52, x1:110, y:78, w:7 }
];
const TICK  = { pts:[[58,112],[80,134],[126,84]], w:16 };

/* 角丸四角の 符号つき距離。0以下なら 中 */
function sdRoundRect(px, py, b){
  const dx = Math.abs(px - b.cx) - (b.hw - b.r);
  const dy = Math.abs(py - b.cy) - (b.hh - b.r);
  const ax = Math.max(dx, 0), ay = Math.max(dy, 0);
  return Math.hypot(ax, ay) + Math.min(Math.max(dx, dy), 0) - b.r;
}

/* 線分までの 距離。丸い端（round cap）にするため そのまま つかう */
function sdSegment(px, py, x0, y0, x1, y1){
  const vx = x1 - x0, vy = y1 - y0;
  const wx = px - x0, wy = py - y0;
  const len2 = vx * vx + vy * vy;
  const t = len2 ? Math.max(0, Math.min(1, (wx * vx + wy * vy) / len2)) : 0;
  return Math.hypot(wx - vx * t, wy - vy * t);
}

/* 設計座標の 1点が どの色かを 返す。手前の ものが 勝つ */
function colorAt(x, y){
  for(const [a, b] of [[TICK.pts[0], TICK.pts[1]], [TICK.pts[1], TICK.pts[2]]]){
    if(sdSegment(x, y, a[0], a[1], b[0], b[1]) <= TICK.w / 2) return CHECK;
  }
  for(const r of RULES){
    if(sdSegment(x, y, r.x0, r.y, r.x1, r.y) <= r.w / 2) return RULE;
  }
  if(sdRoundRect(x, y, PAGE) <= 0) return PAPER;
  return BG;
}

/* size×size の 不透明 RGB を つくる。
   scale は 中身の 大きさ（maskable 用に 小さくする） */
function render(size, scale){
  const SS = 4;                       // 1辺 4本の 重ねとり（なめらかにする）
  const rgb = Buffer.alloc(size * size * 3);
  for(let y = 0; y < size; y++){
    for(let x = 0; x < size; x++){
      let r = 0, g = 0, b = 0;
      for(let sy = 0; sy < SS; sy++){
        for(let sx = 0; sx < SS; sx++){
          const ux = ((x + (sx + 0.5) / SS) / size) * 180;
          const uy = ((y + (sy + 0.5) / SS) / size) * 180;
          const c = colorAt((ux - 90) / scale + 90, (uy - 90) / scale + 90);
          r += c[0]; g += c[1]; b += c[2];
        }
      }
      const n = SS * SS, i = (y * size + x) * 3;
      rgb[i]     = Math.round(r / n);
      rgb[i + 1] = Math.round(g / n);
      rgb[i + 2] = Math.round(b / n);
    }
  }
  return rgb;
}

/* --- PNG（8bit RGB・フィルタなし）を 組み立てる --- */
const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for(let n = 0; n < 256; n++){
    let c = n;
    for(let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c;
  }
  return t;
})();
function crc32(buf){
  let c = -1;
  for(let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}
function chunk(type, data){
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, 'ascii');
  const tail = Buffer.alloc(4);
  tail.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0);
  return Buffer.concat([head, data, tail]);
}
function png(size, rgb){
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;      // 8bit
  ihdr[9] = 2;      // truecolor（アルファ無し＝不透明）
  const raw = Buffer.alloc(size * (size * 3 + 1));
  for(let y = 0; y < size; y++){
    raw[y * (size * 3 + 1)] = 0;   // フィルタ none
    rgb.copy(raw, y * (size * 3 + 1) + 1, y * size * 3, (y + 1) * size * 3);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

const JOBS = [
  { file:'icon-180.png', size:180, scale:1    },  // iOS の apple-touch-icon
  { file:'icon-192.png', size:192, scale:1    },
  { file:'icon-512.png', size:512, scale:1    },
  /* maskable は 外周が 切られる。安全な まるの 中に 収める */
  { file:'icon-maskable-512.png', size:512, scale:0.76 }
];

for(const j of JOBS){
  const file = path.join(OUT, j.file);
  fs.writeFileSync(file, png(j.size, render(j.size, j.scale)));
  console.log(j.file, fs.statSync(file).size + ' bytes');
}
