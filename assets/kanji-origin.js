/* SPDX-License-Identifier: Apache-2.0 AND CC-BY-4.0
   コード部分は Apache-2.0、収録した文章・図は CC BY 4.0。
   詳細は LICENSE と LICENSE-CONTENT.md を参照 */
/* =========================================================
   漢字の なりたち 図
   外部の 画像は つかわず、その場で えがく インライン SVG。
   色は currentColor なので、テーマの 色に そのまま ついてくる。
   「もとの え → むかしの 字 → いまの 字」の 3コマで 見せる。
   ========================================================= */
const KANJI_ORIGIN = (function(){

  /* 中心を x=0、えがく たかさを y=12〜88 に そろえる */
  const sc = (dx, dy, s, body) =>
    `<g transform="translate(${dx} ${dy + 50 - 50 * s}) scale(${s})">${body}</g>`;

  const FILL = 'fill="currentColor" stroke="none"';
  const SOFT = 'fill="currentColor" stroke="none" opacity=".16"';

  /* --- くみあわせに つかう 部品 --- */

  const TREE_PIC = `
    <path d="M-21 40 C-25 22 -9 10 0 13 C11 10 25 22 21 40 C14 50 -14 50 -21 40 Z" ${SOFT}/>
    <path d="M-21 40 C-25 22 -9 10 0 13 C11 10 25 22 21 40 C14 50 -14 50 -21 40 Z"/>
    <path d="M0 36 V80"/>
    <path d="M0 80 C-6 82 -12 84 -16 88"/>
    <path d="M0 80 C6 82 12 84 16 88"/>`;

  const TREE_OLD = `
    <path d="M0 10 V90"/>
    <path d="M0 30 C-8 26 -16 22 -23 14"/>
    <path d="M0 30 C8 26 16 22 23 14"/>
    <path d="M0 70 C-8 74 -16 78 -23 86"/>
    <path d="M0 70 C8 74 16 78 23 86"/>`;

  const PERSON_PIC = `
    <circle cx="2" cy="22" r="9"/>
    <path d="M2 31 V56"/>
    <path d="M2 38 L-12 50"/>
    <path d="M2 38 L14 48"/>
    <path d="M2 56 L-10 84"/>
    <path d="M2 56 L12 84"/>`;

  const PERSON_OLD = `
    <path d="M11 14 C3 30 -1 48 -15 86"/>
    <path d="M4 36 C10 50 14 64 16 82"/>`;

  /* --- 一字ずつの え と むかしの 字 --- */
  const FIG = {
    '山': {
      pic: `
        <path d="M-34 76 L-15 34 L1 60 L14 42 L34 76 Z" ${SOFT}/>
        <path d="M-34 76 L-15 34 L1 60 L14 42 L34 76"/>
        <path d="M-36 76 H36"/>`,
      old: `
        <path d="M-34 74 L-22 40 L-10 74"/>
        <path d="M-12 74 L0 26 L12 74"/>
        <path d="M10 74 L22 40 L34 74"/>
        <path d="M-36 74 H36"/>`
    },
    '川': {
      pic: `
        <path d="M-30 12 C-22 40 -34 62 -26 88" opacity=".4"/>
        <path d="M30 12 C22 40 34 62 26 88" opacity=".4"/>
        <path d="M-9 14 C-15 40 -3 62 -9 86"/>
        <path d="M11 14 C5 40 17 62 11 86"/>`,
      old: `
        <path d="M-21 18 C-27 40 -15 62 -21 84"/>
        <path d="M0 12 C-6 40 6 62 0 88"/>
        <path d="M21 18 C15 40 27 62 21 84"/>`
    },
    '木': { pic: TREE_PIC, old: TREE_OLD },
    '林': {
      pic: sc(-18, 4, .68, TREE_PIC) + sc(18, -2, .78, TREE_PIC),
      old: sc(-18, 0, .66, TREE_OLD) + sc(18, 0, .66, TREE_OLD)
    },
    '森': {
      pic: sc(0, -22, .54, TREE_PIC) + sc(-20, 16, .54, TREE_PIC) + sc(20, 16, .54, TREE_PIC),
      old: sc(0, -22, .5, TREE_OLD) + sc(-20, 16, .5, TREE_OLD) + sc(20, 16, .5, TREE_OLD)
    },
    '日': {
      pic: `
        <circle cx="0" cy="50" r="20" ${SOFT}/>
        <circle cx="0" cy="50" r="20"/>
        <path d="M0 20 V12"/><path d="M0 88 V80"/>
        <path d="M-30 50 H-38"/><path d="M30 50 H38"/>
        <path d="M-21 29 L-27 23"/><path d="M21 29 L27 23"/>
        <path d="M-21 71 L-27 77"/><path d="M21 71 L27 77"/>`,
      old: `
        <circle cx="0" cy="50" r="26"/>
        <circle cx="0" cy="50" r="4.5" ${FILL}/>`
    },
    '月': {
      pic: `
        <path d="M12 18 A32 32 0 1 0 12 82 A25 25 0 1 1 12 18 Z" ${SOFT}/>
        <path d="M12 18 A32 32 0 1 0 12 82 A25 25 0 1 1 12 18 Z"/>
        <circle cx="31" cy="29" r="2.8" fill="currentColor" stroke="none"/>
        <circle cx="28" cy="65" r="2.2" fill="currentColor" stroke="none"/>`,
      old: `
        <path d="M10 16 A30 30 0 1 0 10 84 A23 23 0 1 1 10 16 Z"/>
        <path d="M-14 44 L-4 40"/>
        <path d="M-14 60 L-4 56"/>`
    },
    '人': { pic: PERSON_PIC, old: PERSON_OLD },
    '口': {
      pic: `
        <circle cx="0" cy="46" r="31"/>
        <circle cx="-12" cy="38" r="3.5" ${FILL}/>
        <circle cx="12" cy="38" r="3.5" ${FILL}/>
        <ellipse cx="0" cy="62" rx="12" ry="8" ${SOFT}/>
        <ellipse cx="0" cy="62" rx="12" ry="8"/>`,
      old: `
        <path d="M-30 44 C-16 32 16 32 30 44 C16 72 -16 72 -30 44 Z"/>`
    },
    '目': {
      pic: `
        <path d="M-30 52 C-16 32 16 32 30 52 C16 72 -16 72 -30 52 Z"/>
        <circle cx="0" cy="52" r="10"/>
        <circle cx="0" cy="52" r="4" ${FILL}/>
        <path d="M-25 34 L-30 26"/><path d="M0 30 V22"/><path d="M25 34 L30 26"/>`,
      old: `
        <path d="M-31 50 C-16 30 16 30 31 50 C16 70 -16 70 -31 50 Z"/>
        <circle cx="0" cy="50" r="9"/>
        <circle cx="0" cy="50" r="3.5" ${FILL}/>`
    },
    '耳': {
      pic: `
        <path d="M20 12 C27 40 27 60 20 88" opacity=".35"/>
        <path d="M10 16 C-18 20 -23 48 -14 68 C-9 80 3 86 10 80"/>
        <path d="M4 32 C-9 36 -11 58 -2 68"/>`,
      old: `
        <path d="M6 14 C-22 20 -26 50 -16 72 C-10 84 2 88 6 84"/>
        <path d="M0 32 C-13 36 -15 58 -6 68"/>
        <path d="M6 14 V86"/>`
    },
    '手': {
      pic: `
        <path d="M-16 86 C-21 68 -21 56 -18 48"/>
        <path d="M16 86 C21 68 21 56 18 48"/>
        <path d="M-18 48 C-18 40 18 40 18 48"/>
        <path d="M-13 44 V24"/><path d="M-4 42 V14"/>
        <path d="M5 42 V16"/><path d="M14 44 V28"/>
        <path d="M-18 54 L-31 44"/>`,
      old: `
        <path d="M0 86 V46"/>
        <path d="M0 46 C-12 38 -20 34 -28 32"/>
        <path d="M0 46 C-9 32 -13 24 -16 16"/>
        <path d="M0 46 V14"/>
        <path d="M0 46 C9 32 13 24 16 16"/>
        <path d="M0 46 C12 38 20 34 28 32"/>`
    },
    '雨': {
      pic: `
        <path d="M-26 46 C-33 31 -21 19 -10 24 C-5 11 13 11 17 24 C29 22 33 42 22 46 Z" ${SOFT}/>
        <path d="M-26 46 C-33 31 -21 19 -10 24 C-5 11 13 11 17 24 C29 22 33 42 22 46 Z"/>
        <path d="M-17 56 L-21 70"/><path d="M-5 56 L-9 72"/>
        <path d="M7 56 L3 70"/><path d="M19 58 L15 72"/>`,
      old: `
        <path d="M-30 24 H30"/>
        <path d="M0 24 V44"/>
        <path d="M-20 52 L-22 70"/><path d="M-7 52 L-9 72"/>
        <path d="M7 52 L5 72"/><path d="M20 52 L18 70"/>`
    },
    '火': {
      pic: `
        <path d="M0 12 C11 32 21 44 17 60 C14 76 -14 78 -17 60 C-19 50 -13 44 -9 36 C-8 47 -2 47 0 12 Z" ${SOFT}/>
        <path d="M0 12 C11 32 21 44 17 60 C14 76 -14 78 -17 60 C-19 50 -13 44 -9 36 C-8 47 -2 47 0 12 Z"/>
        <path d="M-27 40 L-33 34"/><path d="M27 40 L33 34"/>`,
      old: `
        <path d="M0 12 C-7 34 5 56 0 88"/>
        <path d="M-25 32 C-19 52 -17 68 -15 84"/>
        <path d="M25 32 C19 52 17 68 15 84"/>`
    },
    '休': {
      pic: sc(16, 0, .82, TREE_PIC) + sc(-17, 6, .72, PERSON_PIC),
      old: sc(-17, 0, .8, PERSON_OLD) + sc(17, 0, .8, TREE_OLD)
    },
    '本': {
      pic: TREE_PIC + `
        <circle cx="0" cy="74" r="12" ${SOFT}/>
        <path d="M-12 74 H12" stroke-width="5"/>`,
      old: TREE_OLD + `
        <path d="M-14 70 H14" stroke-width="6"/>`
    }
  };

  const ARROW = '<path d="M-13 50 H8"/><path d="M0 43 L9 50 L0 57"/>';
  const LABELS = [[52, 'もとの え'], [160, 'むかしの 字'], [268, 'いまの 字']];

  const build = (ch, f) => `
<svg class="kanji-origin" viewBox="0 0 320 128" role="img" aria-label="${ch}の なりたち。もとの え、むかしの 字、いまの 字。">
  <g fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
    <g transform="translate(52 0)">${f.pic}</g>
    <g transform="translate(160 0)">${f.old}</g>
    <g transform="translate(106 0)">${ARROW}</g>
    <g transform="translate(214 0)">${ARROW}</g>
  </g>
  <text x="268" y="50" text-anchor="middle" dominant-baseline="central"
        font-size="54" font-weight="900" fill="currentColor">${ch}</text>
  <g fill="currentColor" font-size="12" font-weight="700" text-anchor="middle" opacity=".75">
    ${LABELS.map(([x, s])=>`<text x="${x}" y="116">${s}</text>`).join('')}
  </g>
</svg>`;

  const out = {};
  Object.keys(FIG).forEach(ch => { out[ch] = build(ch, FIG[ch]); });
  return out;
})();
