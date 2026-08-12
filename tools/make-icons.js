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
const BG    = [0xff, 0xe2, 0xc2];   // あんず色の 地
const CHEEK = [0xef, 0x91, 0x86];   // ほっぺ
const INK   = [0x2f, 0x5c, 0x48];   // 目・口・バーの わく（ふかみどり）
const TRACK = [0xff, 0xf7, 0xea];   // バーの まだの ところ
const GREEN = [0x3e, 0xa0, 0x5c];   // すすんだ ところ（アプリと 同じ）
const SPARK = [0xe0, 0x7a, 0x2a];   // 3本の 光

const CHEEKS = [
  { cx:63, cy:67, rx:10, ry:6.5 },
  { cx:117, cy:67, rx:10, ry:6.5 }
];
const EYES = [
  { cx:73, cy:52, r:7 },
  { cx:107, cy:52, r:7 }
];
/* 口。SVG の `M76 65 c4.5 8 23.5 8 28 0` と同じ3次ベジエ */
const SMILE = { p0:[76,65], p1:[80.5,73], p2:[99.5,73], p3:[104,65], w:6 };
/* バー。stroke は 線の 中心が わくの 上に のるので、太さの 半分ずつ 内外へ ひろがる */
const BAR   = { cx:90, cy:125, hw:68, hh:13, r:13, stroke:3.5 };
const FILL  = { cx:62.5, cy:125, hw:35, hh:7.5, r:7.5 };
/* 3本の光。**開き角を せまくすると 1枚の 扇に 見える。**
   assets/icon.svg では translate(97,111) rotate(24) の中で ±42度 回している。
   ここでは 設計座標へ 変換ずみの 4点として 持つ */
const RAY_ORIGIN = [97, 111];
const RAY_BASE   = 24;
const RAYS = [[-42, 22], [0, 24], [42, 22]].map(([spread, tip])=>{
  const a = (RAY_BASE + spread) * Math.PI / 180;
  const cos = Math.cos(a), sin = Math.sin(a);
  return [[-1.7,-9], [1.7,-9], [3.6,-tip], [-3.6,-tip]].map(([x,y])=>[
    RAY_ORIGIN[0] + x * cos - y * sin,
    RAY_ORIGIN[1] + x * sin + y * cos
  ]);
});

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

/* 3次ベジエは 折れ線に ほぐしてから 線分の 距離を とる。
   24分割あれば 180pxの 設計座標では 目に見える 差が 出ない */
const SMILE_PTS = (()=>{
  const pts = [];
  for(let i = 0; i <= 24; i++){
    const t = i / 24, u = 1 - t;
    pts.push([
      u*u*u*SMILE.p0[0] + 3*u*u*t*SMILE.p1[0] + 3*u*t*t*SMILE.p2[0] + t*t*t*SMILE.p3[0],
      u*u*u*SMILE.p0[1] + 3*u*u*t*SMILE.p1[1] + 3*u*t*t*SMILE.p2[1] + t*t*t*SMILE.p3[1]
    ]);
  }
  return pts;
})();

/* だ円の 中か。ほっぺは 線を 持たないので 中か外かだけ 分かればよい */
function inEllipse(px, py, e){
  const dx = (px - e.cx) / e.rx, dy = (py - e.cy) / e.ry;
  return dx * dx + dy * dy <= 1;
}

/* 凸四角形の 中か（光の 1本）。全部の 辺で 同じ側なら 中 */
function inQuad(px, py, q){
  let sign = 0;
  for(let i = 0; i < q.length; i++){
    const [ax, ay] = q[i], [bx, by] = q[(i + 1) % q.length];
    const cross = (bx - ax) * (py - ay) - (by - ay) * (px - ax);
    if(cross === 0) continue;
    const s = cross > 0 ? 1 : -1;
    if(sign === 0) sign = s;
    else if(sign !== s) return false;
  }
  return true;
}

/* 設計座標の 1点が どの色かを 返す。手前の ものが 勝つ */
function colorAt(x, y){
  for(const q of RAYS){ if(inQuad(x, y, q)) return SPARK; }

  for(const e of EYES){ if(Math.hypot(x - e.cx, y - e.cy) <= e.r) return INK; }
  for(let i = 1; i < SMILE_PTS.length; i++){
    const a = SMILE_PTS[i - 1], b = SMILE_PTS[i];
    if(sdSegment(x, y, a[0], a[1], b[0], b[1]) <= SMILE.w / 2) return INK;
  }
  for(const c of CHEEKS){ if(inEllipse(x, y, c)) return CHEEK; }

  if(sdRoundRect(x, y, FILL) <= 0) return GREEN;
  const bar = sdRoundRect(x, y, BAR);
  if(Math.abs(bar) <= BAR.stroke / 2) return INK;
  if(bar < 0) return TRACK;

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
