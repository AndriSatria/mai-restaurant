/* mAI-restaurant - FLAT (top-down) procedural pixel-art kitchen, used with ?view=flat.
 * (The default view is the isometric renderer in office-iso.js.)
 * Everything is drawn with fillRect on a small logical canvas (480x240: kitchen x 0..384, dining room x 384..480) and then
 * blitted to the visible canvas with integer scaling and smoothing disabled.
 * Text (names, tool chips, speech bubbles) is drawn on the visible canvas at native res. */
(function () {
  'use strict';
  const W = 480, H = 240, DX = 384;
  const COLS = [60, 150, 240];
  const ROWS = [94, 178];
  const SLOTS = [];
  for (let r = 0; r < 2; r++) for (let c = 0; c < 3; c++) SLOTS.push({ cx: COLS[c], cy: ROWS[r], row: r, col: c });
  SLOTS.push({ cx: 350, cy: 178, row: 1, col: 3, mgr: true });   // slot 6: the pass (head chef), bottom-right corner
  const AISLE = [132, 214];
  const COFFEE = { x: 350, y: 100 };
  const MAX_SLOTS = SLOTS.length;

  // ---------- tiny helpers ----------
  const R = (c, x, y, w, h, col) => { c.fillStyle = col; c.fillRect(Math.round(x), Math.round(y), w, h); };
  function shade(hex, amt) {
    const n = parseInt(hex.slice(1), 16);
    const f = (v) => Math.max(0, Math.min(255, v + amt));
    return '#' + [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => f(v).toString(16).padStart(2, '0')).join('');
  }
  const rnd = (n) => { const x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };
  function disc(c, cx, cy, r, col) {
    c.fillStyle = col;
    for (let y = -r; y <= r; y++) { const w = Math.floor(Math.sqrt(r * r - y * y + 0.5)); c.fillRect(cx - w, cy + y, w * 2 + 1, 1); }
  }
  function line(c, x0, y0, x1, y1, col, size = 2) {
    x0 = Math.round(x0); y0 = Math.round(y0); x1 = Math.round(x1); y1 = Math.round(y1);
    const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0), sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
    let err = dx + dy;
    c.fillStyle = col;
    for (;;) {
      c.fillRect(x0, y0, size, size);
      if (x0 === x1 && y0 === y1) break;
      const e2 = 2 * err;
      if (e2 >= dy) { err += dy; x0 += sx; }
      if (e2 <= dx) { err += dx; y0 += sy; }
    }
  }

  // ---------- static background ----------
  function plant(c, x, y) {
    R(c, x + 1, y + 10, 10, 8, '#b5651d'); R(c, x, y + 9, 12, 2, '#d28a3a'); R(c, x + 1, y + 16, 10, 2, '#8a4a14');
    R(c, x + 4, y, 4, 10, '#2f8f4e'); R(c, x, y + 3, 5, 6, '#3fae60'); R(c, x + 7, y + 2, 5, 7, '#3fae60');
    R(c, x + 5, y + 1, 1, 7, '#64d98a'); R(c, x + 1, y + 4, 1, 3, '#64d98a'); R(c, x + 9, y + 3, 1, 4, '#64d98a');
  }

  function buildBackground() {
    const bg = document.createElement('canvas'); bg.width = W; bg.height = H;
    const c = bg.getContext('2d');
    // quarry-tile floor
    for (let ty = 0; ty < 13; ty++) for (let tx = 0; tx < DX / 16; tx++) {
      const y = 40 + ty * 16;
      R(c, tx * 16, y, 16, 16, (tx + ty) % 2 ? '#c86a42' : '#b85c38');
      R(c, tx * 16, y, 16, 1, '#8a3a22'); R(c, tx * 16, y, 1, 16, '#8a3a22');
    }
    R(c, 0, 40, W, 4, 'rgba(0,0,0,.18)'); R(c, 0, 44, W, 2, 'rgba(0,0,0,.08)');
    // subway-tile wall
    R(c, 0, 0, W, 40, '#e8e4dc'); R(c, 0, 0, W, 4, '#b8b2a8');
    for (let x = 0; x < W; x += 10) R(c, x, 4, 1, 24, '#c8c2b8');
    for (let y = 12; y < 28; y += 8) R(c, 0, y, W, 1, '#c8c2b8');
    R(c, 0, 28, W, 1, '#a8a298'); R(c, 0, 29, W, 9, '#9aa0a8'); R(c, 0, 38, W, 2, '#6a7078');
    for (let x = 0; x < W; x += 16) R(c, x, 29, 1, 9, '#7a8088');
    // windows
    for (const x of [20, 108, 196]) {
      R(c, x - 1, 7, 42, 26, '#2b3149'); R(c, x, 8, 40, 24, '#eef1f8');
      R(c, x + 2, 10, 17, 20, '#8ec9ff'); R(c, x + 21, 10, 17, 20, '#8ec9ff');
      R(c, x + 2, 24, 17, 6, '#a9dcff'); R(c, x + 21, 24, 17, 6, '#a9dcff');
      R(c, x + 4, 14, 7, 2, '#fff'); R(c, x + 6, 12, 5, 2, '#fff'); R(c, x + 25, 17, 8, 2, '#fff'); R(c, x + 27, 15, 5, 2, '#fff');
      R(c, x - 2, 33, 44, 3, '#cdd3e6'); R(c, x - 2, 36, 44, 1, '#8a93b0');
    }
    // clock
    disc(c, 278, 16, 8, '#2b3149'); disc(c, 278, 16, 7, '#f5f5f0');
    R(c, 278, 11, 1, 6, '#222'); R(c, 278, 16, 4, 1, '#222'); R(c, 278, 16, 1, 1, '#e5484d');
    // hanging pans
    disc(c, 304, 18, 7, '#8a4a18'); disc(c, 304, 18, 6, '#c87838'); disc(c, 304, 16, 3, '#f0b070');
    disc(c, 320, 20, 6, '#5a6068'); disc(c, 320, 20, 5, '#c8ccd4');
    R(c, 303, 8, 2, 4, '#4a5058'); R(c, 319, 10, 2, 4, '#4a5058');
    // shelf + jars above the fridge
    R(c, 326, 24, 54, 3, '#6a7078'); R(c, 326, 27, 54, 1, '#3a4048');
    R(c, 330, 17, 6, 7, '#c84830'); R(c, 332, 16, 2, 2, '#e8e0c8');
    R(c, 340, 17, 6, 7, '#3e8a4a'); R(c, 342, 16, 2, 2, '#e8e0c8');
    R(c, 362, 17, 6, 7, '#c8a038'); R(c, 370, 19, 5, 5, '#d84840');
    // rubber mat under the break corner
    R(c, 318, 76, 66, 36, '#2a2e36'); R(c, 320, 78, 62, 32, '#3e444e'); R(c, 324, 82, 54, 24, '#333840');
    for (let x = 326; x < 376; x += 6) R(c, x, 84, 3, 20, '#3e444e');
    // walk-in fridge (left) + staff-break counter (right)
    R(c, 324, 30, 28, 42, '#c8ccd4'); R(c, 324, 30, 28, 1, '#e8ecf0'); R(c, 324, 70, 28, 2, '#4a5058');
    R(c, 328, 36, 16, 22, '#4a5058'); R(c, 330, 40, 12, 14, '#8ec9ff'); R(c, 342, 44, 4, 8, '#f5c542');
    R(c, 352, 46, 30, 6, '#d2d6dc'); R(c, 352, 46, 30, 1, '#eef1f5'); R(c, 352, 52, 30, 19, '#6e7480'); R(c, 352, 70, 30, 2, '#4a5058');
    // coffee urn
    R(c, 356, 32, 14, 15, '#3a3f4f'); R(c, 356, 32, 14, 1, '#555c70');
    R(c, 359, 35, 3, 3, '#ff5a5a'); R(c, 365, 35, 3, 3, '#5ff2a5');
    R(c, 360, 43, 6, 5, '#f5f5f0');
    R(c, 374, 42, 5, 4, '#e5484d');
    // plants
    plant(c, 6, 50); plant(c, 6, 220); plant(c, 368, 218); plant(c, 306, 48);
    // STAFF sign (block letters, same footprint as the old CAFE plaque)
    R(c, 342, 6, 30, 11, '#3a3220'); R(c, 343, 7, 28, 9, '#f5c542');
    R(c, 345, 9, 3, 5, '#7a5236'); R(c, 349, 9, 3, 1, '#7a5236'); R(c, 349, 11, 3, 1, '#7a5236'); R(c, 349, 13, 3, 1, '#7a5236');
    R(c, 354, 9, 3, 5, '#7a5236'); R(c, 358, 9, 1, 5, '#7a5236'); R(c, 354, 9, 5, 1, '#7a5236');
    R(c, 361, 9, 3, 1, '#7a5236'); R(c, 361, 9, 1, 5, '#7a5236'); R(c, 361, 11, 3, 1, '#7a5236'); R(c, 361, 13, 3, 1, '#7a5236'); R(c, 363, 9, 1, 5, '#7a5236');
    R(c, 366, 9, 3, 5, '#7a5236'); R(c, 366, 9, 3, 1, '#7a5236'); R(c, 366, 13, 3, 1, '#7a5236');
    // dining room: oak boards, cream plaster over a wood wainscot, one window, a brass strip at the kitchen threshold
    for (let y = 40, j = 0; y < H; y += 8, j++) { R(c, DX, y, W - DX, 8, j % 2 ? '#a8703e' : '#9a6436'); R(c, DX + ((j * 37) % (W - DX)), y, 1, 8, 'rgba(60,30,12,.35)'); }
    R(c, DX, 40, W - DX, 3, 'rgba(0,0,0,.18)');
    R(c, DX, 0, W - DX, 40, '#e9dcc0'); R(c, DX, 0, W - DX, 4, '#b8a888');
    R(c, DX, 22, W - DX, 18, '#6b4226'); R(c, DX, 22, W - DX, 2, '#8a5a34'); R(c, DX, 38, W - DX, 2, '#3a2414');
    for (let x = DX + 6; x < W - 10; x += 16) R(c, x, 26, 10, 9, '#5a3620');
    R(c, 419, 3, 42, 18, '#5a3a22'); R(c, 420, 4, 40, 16, '#8ec9ff'); R(c, 420, 14, 40, 6, '#a9dcff'); R(c, 439, 4, 2, 16, '#5a3a22'); R(c, 424, 7, 7, 2, '#fff');
    R(c, DX - 2, 0, 4, 40, '#8a5a34'); R(c, DX, 40, 1, H - 40, '#caa24a');
    return bg;
  }

  // ---------- characters ----------
  function drawHead(c, cx, top, look, face) {
    face = face || {};
    const skin = look.skin, dark = shade(skin, -40);
    const hair = look.hair, hairD = shade(hair, -25);
    const style = look.hairStyle;
    if (style === 'long') R(c, cx - 8, top + 1, 16, 12, hairD); // back hair
    R(c, cx - 6, top, 12, 11, skin);
    R(c, cx - 7, top + 4, 1, 3, dark); R(c, cx + 6, top + 4, 1, 3, dark);
    const m = face.mood || 'normal';
    const lk = face.look || 0;
    if (m === 'yawn') { R(c, cx - 3, top + 6, 2, 1, '#222'); R(c, cx + 1, top + 6, 2, 1, '#222'); R(c, cx - 4, top + 5, 1, 1, '#222'); R(c, cx + 3, top + 5, 1, 1, '#222'); }
    else if (m === 'read') { R(c, cx - 3, top + 7, 2, 1, '#222'); R(c, cx + 1, top + 7, 2, 1, '#222'); R(c, cx - 3, top + 6, 2, 1, shade(skin, -30)); R(c, cx + 1, top + 6, 2, 1, shade(skin, -30)); }
    else if (face.blink && m === 'normal') { R(c, cx - 3 + lk, top + 6, 2, 1, '#222'); R(c, cx + 1 + lk, top + 6, 2, 1, '#222'); }
    else if (m === 'happy') { R(c, cx - 3, top + 5, 2, 1, '#222'); R(c, cx - 4, top + 6, 1, 1, '#222'); R(c, cx - 2, top + 6, 1, 1, '#222');
      R(c, cx + 1, top + 5, 2, 1, '#222'); R(c, cx, top + 6, 1, 1, '#222'); R(c, cx + 3, top + 6, 1, 1, '#222'); }
    else if (m === 'worried') { R(c, cx - 3, top + 5, 2, 3, '#222'); R(c, cx + 1, top + 5, 2, 3, '#222'); R(c, cx - 3, top + 3, 3, 1, '#222'); R(c, cx + 1, top + 3, 3, 1, '#222'); }
    else { R(c, cx - 3 + lk, top + 5, 2, 2, '#222'); R(c, cx + 1 + lk, top + 5, 2, 2, '#222'); R(c, cx - 3 + lk, top + 5, 1, 1, '#fff'); R(c, cx + 1 + lk, top + 5, 1, 1, '#fff'); }
    R(c, cx - 5, top + 8, 2, 1, shade('#e07a6a', 0)); R(c, cx + 3, top + 8, 2, 1, '#e07a6a'); // blush
    if (m === 'happy') { R(c, cx - 2, top + 9, 4, 1, '#7a2a2a'); R(c, cx - 3, top + 8, 1, 1, '#7a2a2a'); R(c, cx + 2, top + 8, 1, 1, '#7a2a2a'); }
    else if (m === 'worried') { R(c, cx - 1, top + 8, 2, 2, '#5a1a1a'); }
    else if (m === 'yawn') { R(c, cx - 2, top + 8, 4, 3, '#5a1a1a'); R(c, cx - 1, top + 10, 2, 1, '#c0544a'); }
    else if (m === 'read') R(c, cx - 1, top + 9, 2, 1, '#8a4a3a');
    else R(c, cx - 1 + lk, top + 9, 2, 1, '#8a4a3a');
    // hair on top
    switch (style) {
      case 'long':
        R(c, cx - 7, top - 2, 14, 5, hair); R(c, cx - 7, top + 3, 2, 12, hair); R(c, cx + 5, top + 3, 2, 12, hair);
        R(c, cx - 6, top + 2, 6, 2, hair); R(c, cx - 5, top - 2, 4, 1, shade(hair, 35)); break;
      case 'spiky':
        R(c, cx - 7, top - 1, 14, 4, hair); R(c, cx - 7, top + 3, 1, 3, hair); R(c, cx + 6, top + 3, 1, 3, hair);
        for (const sx of [-7, -3, 1, 5]) R(c, cx + sx, top - 4, 2, 3, hair); R(c, cx - 2, top - 5, 2, 1, hair); R(c, cx - 3, top - 1, 3, 1, shade(hair, 35)); break;
      case 'bun':
        R(c, cx - 7, top - 2, 14, 5, hair); R(c, cx - 7, top + 3, 2, 3, hair); R(c, cx + 5, top + 3, 2, 3, hair);
        R(c, cx - 3, top - 6, 6, 4, hair); R(c, cx - 2, top - 5, 2, 1, shade(hair, 35)); R(c, cx - 6, top + 2, 5, 1, hair); break;
      case 'cap':
        R(c, cx - 7, top - 3, 14, 6, look.shirt); R(c, cx - 5, top - 3, 5, 1, shade(look.shirt, 40));
        R(c, cx - 9, top + 2, 18, 2, shade(look.shirt, -35)); R(c, cx - 7, top + 3, 1, 4, hair); R(c, cx + 6, top + 3, 1, 4, hair); break;
      default: // short
        R(c, cx - 7, top - 2, 14, 5, hair); R(c, cx - 7, top + 3, 2, 3, hair); R(c, cx + 5, top + 3, 2, 3, hair);
        R(c, cx - 6, top + 2, 5, 1, hair); R(c, cx - 5, top - 2, 5, 1, shade(hair, 35));
    }
    if (face.hat === 'none') return;
    // chef hat sits on top of whatever hair was drawn
    const tall = face.hat === 'toque', hat = '#f4f1e8', hatD = '#c8c4b8', hatL = '#fffdf6';
    if (tall) {
      R(c, cx - 8, top - 3, 16, 5, hat); R(c, cx - 8, top - 3, 16, 1, hatL);
      R(c, cx - 9, top - 16, 18, 13, hat); R(c, cx - 8, top - 17, 16, 2, hatL);
      R(c, cx - 9, top - 16, 1, 13, hatD); R(c, cx + 8, top - 16, 1, 13, hatD);
      for (let i = 0; i < 5; i++) R(c, cx - 6 + i * 3, top - 15, 1, 11, hatD);
    } else {
      R(c, cx - 8, top - 3, 16, 5, hat); R(c, cx - 8, top - 3, 16, 1, hatL);
      R(c, cx - 6, top - 8, 12, 5, hat); R(c, cx - 5, top - 9, 10, 2, hatL); R(c, cx + 5, top - 8, 1, 5, hatD);
    }
  }

  // arm: shoulder -> elbow -> hand; the last bit is skin
  function arm(c, sx, sy, hx, hy, look, side) {
    const ex = sx + side * 2, ey = (sy + hy) / 2 + 2;
    const ac = '#d8d4c8';
    line(c, sx, sy, ex, ey, ac, 2);
    line(c, ex, ey, hx, hy - 1, ac, 2);
    R(c, hx - 1, hy - 1, 3, 3, look.skin);
  }

  function bmp(c, x, y, rows, col) {
    c.fillStyle = col;
    rows.forEach((r, j) => { for (let i = 0; i < r.length; i++) if (r[i] === '#') c.fillRect(x + i, y + j, 1, 1); });
  }
  const SYMS = [
    null, // dots (drawn with rects)
    { rows: ['..#..', '..#..', '..#..', '..#..', '.....', '..#..'], col: '#e5484d' },
    { rows: ['.###.', '#...#', '...#.', '..#..', '.....', '..#..'], col: '#3e8ef7' },
    { rows: ['.#.#.', '#####', '#####', '.###.', '..#..'], col: '#e93d82' },
    { rows: ['...##', '...#.', '...#.', '##.#.', '##...'], col: '#8e4ec6' },
  ];
  /** Small speech-bubble icon (used while two idle agents chat). */
  function drawTalk(c, x, y, sym, dir) {
    const o = '#2b2f3b';
    R(c, x - 7, y - 11, 14, 11, o); R(c, x - 8, y - 10, 16, 9, o); R(c, x - 6, y - 10, 12, 9, '#fff'); R(c, x - 7, y - 9, 14, 7, '#fff');
    R(c, x - 2 + dir * 2, y, 3, 2, o); R(c, x - 1 + dir * 2, y - 1, 1, 2, '#fff');
    if (sym === 0) { for (let i = 0; i < 3; i++) R(c, x - 5 + i * 4, y - 6, 2, 2, o); }
    else { const d = SYMS[sym]; bmp(c, x - 2, y - 9 + (d.rows.length < 6 ? 1 : 0), d.rows, d.col); }
  }

  function stateIcon(c, cx, top, state, t) {
    if (state === 'thinking') {
      R(c, cx - 11, top - 14, 22, 11, '#2b2f3b'); R(c, cx - 12, top - 13, 24, 9, '#2b2f3b');
      R(c, cx - 10, top - 13, 20, 9, '#fff'); R(c, cx - 11, top - 12, 22, 7, '#fff');
      R(c, cx - 3, top - 4, 4, 3, '#2b2f3b'); R(c, cx - 2, top - 4, 2, 2, '#fff'); R(c, cx - 1, top - 2, 2, 2, '#2b2f3b');
      const k = Math.floor(t * 3) % 4;
      for (let i = 0; i < 3; i++) R(c, cx - 6 + i * 5, top - 10, 3, 3, i < k ? '#5b4bc4' : '#c3bde8');
    } else if (state === 'done') {
      const b = Math.floor(Math.abs(Math.sin(t * 6)) * 3);
      const y = top - 9 - b;
      disc(c, cx, y, 6, '#1f5a3d'); disc(c, cx, y, 5, '#30a46c');
      const ck = [[-3, 0], [-2, 1], [-1, 2], [0, 1], [1, 0], [2, -1], [3, -2], [4, -3]];
      for (const [dx, dy] of ck) R(c, cx + dx - 1, y + dy - 0, 2, 2, '#fff');
      const ph = Math.floor(t * 5) % 2;
      for (const [dx, dy] of [[-14, -2], [14, -4], [-12, 8], [13, 9]]) {
        const s = ph ? 1 : 0; const x = cx + dx, yy = top + dy;
        R(c, x - 1 - s, yy, 3 + s * 2, 1, '#ffd84a'); R(c, x, yy - 1 - s, 1, 3 + s * 2, '#ffd84a');
      }
    } else if (state === 'error') {
      const j = Math.floor(t * 6) % 2;
      R(c, cx - 6, top - 16 - j, 12, 14, '#7a1a20'); R(c, cx - 5, top - 15 - j, 10, 12, '#fff');
      R(c, cx - 1, top - 13 - j, 3, 6, '#e5484d'); R(c, cx - 1, top - 6 - j, 3, 2, '#e5484d');
      R(c, cx - 1, top - 3 - j, 2, 2, '#7a1a20');
    }
  }

  function drawMonitor(c, cx, cy, state, t, ph, color) {
    // stove + pot (kept the name so call sites and hit boxes stay put)
    const x0 = cx + 12, y0 = cy - 16;
    R(c, cx + 10, cy - 10, 20, 8, '#2a2e36'); R(c, cx + 10, cy - 10, 20, 1, '#5a6068');
    disc(c, cx + 16, cy - 6, 3, '#1a1e24'); disc(c, cx + 24, cy - 6, 3, '#1a1e24');
    if (state === 'working') {
      const flick = Math.floor(t * 12 + ph * 5) % 2;
      disc(c, cx + 16, cy - 6, 2 + flick, '#ff8a3a'); disc(c, cx + 24, cy - 6, 1 + flick, '#ffd84a');
      c.globalAlpha = 0.2; R(c, cx + 8, cy - 7, 22, 10, '#ff8a3a'); c.globalAlpha = 1;
    } else if (state === 'thinking') {
      disc(c, cx + 16, cy - 6, 1, '#ffb04a');
    } else if (state === 'done') {
      disc(c, cx + 16, cy - 6, 1, '#6be39b');
    } else if (state === 'error') {
      disc(c, cx + 16, cy - 6, 2, Math.floor(t * 4) % 2 ? '#ff5a5a' : '#b0303c');
    }
    R(c, cx + 13, cy - 18, 10, 8, '#d4883a'); R(c, cx + 13, cy - 18, 10, 1, '#f0b060'); R(c, cx + 16, cy - 20, 4, 2, '#f0b060');
    if (state === 'working' || state === 'thinking') {
      const s = Math.floor(t * 5) % 3;
      c.globalAlpha = 0.7; R(c, cx + 16 + s, cy - 24, 2, 2, '#fff'); R(c, cx + 20 - s, cy - 26, 2, 2, '#fff'); c.globalAlpha = 1;
    }
    R(c, cx + 28, cy - 8, 1, 1, color || '#ff8a3a');
  }

  function drawSeat(c, slot, ag, t) {
    const { cx, cy } = slot;
    R(c, cx - 9, cy - 22, 18, 12, '#5a4030'); R(c, cx - 8, cy - 22, 16, 2, '#7a5840'); R(c, cx - 9, cy - 10, 18, 3, '#3a281c');
    R(c, cx - 9, cy - 28, 3, 10, '#5a4030'); R(c, cx + 6, cy - 28, 3, 10, '#5a4030');
    const here = ag && !ag.away;
    const st = ag ? ag.state : 'off';
    const ph = ag ? ag.phase : 0;
    let mood = st === 'error' ? 'worried' : st === 'done' ? 'happy' : 'normal';
    const act = here && st === 'idle' && ag.act ? ag.act : null;
    const ap = ag && ag.actP || 0;
    let lk = 0, k = 0;
    if (act === 'look') lk = [0, -1, -1, 0, 1, 1][Math.floor(ap / 0.9) % 6];
    if (act === 'stretch') { k = Math.min(ap / 0.5, 1) * (ap < 2.4 ? 1 : Math.max(0, (2.9 - ap) / 0.5)); if (k > 0.5) mood = 'yawn'; }
    if (act === 'read') mood = 'read';
    let by = 0;
    if (here) {
      if (st === 'idle') by = Math.sin(t * 2.2 + ph * 6) >= 0 ? 1 : 0;
      else if (st === 'done') by = -Math.floor(Math.abs(Math.sin(t * 6)) * 2);
      else if (st === 'working') by = Math.floor(t * 6 + ph) % 4 === 0 ? 1 : 0;
      else if (st === 'thinking') by = Math.sin(t * 1.5 + ph * 6) >= 0.4 ? 1 : 0;
      if (act === 'stretch') by = -Math.round(k);
      if (act === 'read') by = 1;
      const blink = ((t * 1000 + ph * 3600) % 3600) < 140;
      const look = ag.look;
      R(c, cx - 7, cy - 24 + by, 14, 20, '#f2efe6'); R(c, cx - 7, cy - 14 + by, 14, 1, '#d0ccc0');
      R(c, cx - 6, cy - 18 + by, 12, 12, look.shirt); R(c, cx - 1, cy - 24 + by, 2, 6, look.shirt);
      R(c, cx - 2, cy - 25 + by, 4, 2, shade(look.skin, -25));
      drawHead(c, cx + lk, cy - 35 + by, look, { blink, mood, look: lk, hat: (ag.slot === 6 || ag.main) ? 'toque' : 'cap' });
    }
    // stainless station
    R(c, cx - 28, cy - 7, 56, 14, '#d2d6dc'); R(c, cx - 28, cy - 7, 56, 1, '#eef1f5'); R(c, cx - 28, cy + 6, 56, 1, '#6e7480');
    R(c, cx - 28, cy + 7, 56, 12, '#8a909a'); R(c, cx - 28, cy + 7, 56, 1, '#4a5058');
    R(c, cx - 28, cy + 19, 3, 3, '#4a5058'); R(c, cx + 25, cy + 19, 3, 3, '#4a5058');
    R(c, cx - 6, cy + 9, 12, 8, '#6a7078'); R(c, cx - 5, cy + 10, 10, 6, '#8a9098'); R(c, cx - 1, cy + 12, 2, 1, '#c8ccd4');
    R(c, cx - 28, cy + 22, 56, 2, 'rgba(0,0,0,.14)');
    if (ag) R(c, cx - 24, cy + 10, 9, 3, ag.look.shirt);
    // cutting board + salt
    R(c, cx - 8, cy - 1, 16, 5, '#d2a06a'); R(c, cx - 8, cy + 3, 16, 1, '#a87840');
    R(c, cx - 6, cy, 8, 1, '#c8ccd4'); R(c, cx - 8, cy, 2, 1, '#5b3a1e');
    R(c, cx - 24, cy - 4, 5, 5, '#f5f5f0'); R(c, cx - 19, cy - 3, 1, 3, '#f5f5f0'); R(c, cx - 24, cy - 4, 5, 1, '#5b3a1e');
    if (here && (st === 'working' || st === 'thinking') && ag.slot % 2 === 0) { /* steam */
      const s = Math.floor(t * 3) % 2; R(c, cx - 22 + s, cy - 7, 1, 2, 'rgba(255,255,255,.7)'); }
    if (!ag) R(c, cx - 25, cy - 3, 8, 1, 'rgba(0,0,0,.0)');
    if (here) {
      const look = ag.look;
      const kb = { lx: cx - 4, rx: cx + 4, y: cy + 2 };
      let L = [kb.lx, kb.y], Rr = [kb.rx, kb.y];
      if (st === 'working') {
        const a = t * 9 + ph * 4, chop = Math.abs(Math.sin(t * 10 + ph * 3));
        L = [kb.lx, kb.y - chop * 6]; Rr = [kb.rx + Math.cos(a), kb.y + Math.sin(a)];
      } else if (st === 'thinking') { Rr = [cx + 3, cy - 21 + by]; }
      else if (st === 'done') { const b = Math.floor(Math.abs(Math.sin(t * 6)) * 3); L = [cx - 12, cy - 32 - b]; Rr = [cx + 12, cy - 32 - b]; }
      else if (st === 'error') { const j = Math.floor(t * 8) % 2; L = [cx - 8 - j, cy - 30]; Rr = [cx + 8 + j, cy - 30]; }
      if (act === 'stretch') {
        L = [kb.lx + (cx - 13 - kb.lx) * k, kb.y + (cy - 39 - kb.y) * k]; Rr = [kb.rx + (cx + 13 - kb.rx) * k, kb.y + (cy - 39 - kb.y) * k];
      } else if (act === 'read') { L = [cx - 9, cy - 11]; Rr = [cx + 9, cy - 11]; }
      arm(c, cx - 7, cy - 21 + by, L[0], L[1], look, -1);
      arm(c, cx + 6, cy - 21 + by, Rr[0], Rr[1], look, 1);
      if (act === 'read') {
        const cov = ['#8e4ec6', '#3e8ef7', '#e5484d', '#30a46c'][ag.slot % 4], by2 = by;
        R(c, cx - 8, cy - 20 + by2, 16, 11, cov); R(c, cx - 7, cy - 19 + by2, 7, 8, '#fffbe8'); R(c, cx, cy - 19 + by2, 7, 8, '#fffbe8');
        R(c, cx - 1, cy - 19 + by2, 2, 8, '#d9cfa8');
        const pg = Math.floor(ap / 2.2) % 3;
        for (let i = 0; i < 3; i++) { R(c, cx - 6, cy - 18 + by2 + i * 2 + 1, 4 + ((i + pg) % 2), 1, '#9a8f6a'); R(c, cx + 2, cy - 18 + by2 + i * 2 + 1, 4 - ((i + pg) % 2), 1, '#9a8f6a'); }
        if ((ap % 2.2) < 0.25) { R(c, cx + 1, cy - 19 + by2, 3, 8, '#e9e0bd'); R(c, cx + 3, cy - 20 + by2, 1, 9, '#cfc59a'); }
        R(c, cx - 8, cy - 10 + by2, 16, 1, shade(cov, -40));
      }
    }
    drawMonitor(c, cx, cy, ag ? (ag.away ? 'idle' : st) : 'off', t, ph, ag && ag.look.shirt);
    if (here) stateIcon(c, cx, cy - 35 + by, st, t);
  }

  function drawStanding(c, ag, t) {
    const x = Math.round(ag.x), fy = Math.round(ag.y), look = ag.look;
    const walking = ag.mode === 'walk';
    const ph = walking ? Math.floor(t * 6) % 2 : 0;
    R(c, x - 7, fy - 1, 14, 2, 'rgba(0,0,0,.18)');
    R(c, x - 5, fy - 10, 4, 9 - (ph ? 1 : 0), look.pants); R(c, x + 1, fy - 10, 4, 9 - (ph ? 0 : 1), look.pants);
    R(c, x - 5, fy - 2 - (ph ? 1 : 0), 5, 2, '#222'); R(c, x + 1, fy - 2 - (ph ? 0 : 1), 5, 2, '#222');
    R(c, x - 7, fy - 24, 14, 15, '#f2efe6'); R(c, x - 7, fy - 11, 14, 1, '#d0ccc0');
    R(c, x - 6, fy - 18, 12, 8, look.shirt); R(c, x - 1, fy - 24, 2, 6, look.shirt);
    R(c, x - 2, fy - 25, 4, 2, shade(look.skin, -25));
    const blink = ((t * 1000 + ag.phase * 3600) % 3600) < 140;
    const mood = ag.state === 'error' ? 'worried' : (ag.mode === 'drink' || ag.mode === 'chat') ? 'happy' : 'normal';
    const nod = ag.mode === 'chat' && ag.talk == null && Math.floor(t * 3) % 4 === 0 ? 1 : 0;
    drawHead(c, x, fy - 36 + nod, look, { blink, mood, hat: (ag.slot === 6 || ag.main) ? 'toque' : 'cap' });
    const sw = walking ? (ph ? 1 : -1) : 0;
    if (ag.mode === 'drink') {
      const sip = Math.floor(t * 1.5) % 2;
      arm(c, x - 7, fy - 22, x - 9, fy - 12, look, -1);
      const hx = x + 6, hy = fy - 22 - (sip ? 3 : 0);
      arm(c, x + 6, fy - 22, hx, hy, look, 1);
      R(c, hx - 2, hy - 5, 5, 5, '#f5f5f0'); R(c, hx + 3, hy - 4, 1, 3, '#f5f5f0'); R(c, hx - 2, hy - 5, 5, 1, '#5b3a1e');
      const s = Math.floor(t * 4) % 2; R(c, hx - 1 + s, hy - 8, 1, 2, 'rgba(255,255,255,.8)');
    } else if (ag.mode === 'chat' && ag.talk != null) {
      const g = Math.floor(t * 4) % 2;
      arm(c, x - 7, fy - 22, x - 9, fy - 12, look, -1);
      arm(c, x + 6, fy - 22, x + 9 + (ag.talkDir > 0 ? 1 : -3), fy - 28 - g * 2, look, 1);
    } else {
      arm(c, x - 7, fy - 22, x - 9, fy - 12 + sw, look, -1);
      arm(c, x + 6, fy - 22, x + 8, fy - 12 - sw, look, 1);
    }
    stateIcon(c, x, fy - 36, ag.state, t);
    if (ag.mode === 'chat' && ag.talk != null) drawTalk(c, x + ag.talkDir * 6, fy - 40, ag.talk, ag.talkDir);
  }

  function dashedRect(c, x, y, w, h, col, t) {
    const off = Math.floor(t * 8);
    c.fillStyle = col;
    for (let i = 0; i < w; i++) if (((i + off) >> 1) % 2 === 0) { c.fillRect(x + i, y, 1, 1); c.fillRect(x + w - 1 - i, y + h - 1, 1, 1); }
    for (let i = 0; i < h; i++) if (((i + off) >> 1) % 2 === 0) { c.fillRect(x, y + h - 1 - i, 1, 1); c.fillRect(x + w - 1, y + i, 1, 1); }
  }

  // ---------- overlay text ----------
  const FONT = 'ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace';
  function wrap(ctx, text, maxW) {
    const out = []; let cur = '';
    for (const word of text.split(/\s+/)) {
      if (!word) continue;
      const test = cur ? cur + ' ' + word : word;
      if (ctx.measureText(test).width <= maxW) { cur = test; continue; }
      if (cur) out.push(cur);
      let w = word;
      while (ctx.measureText(w).width > maxW) { let i = w.length; while (i > 1 && ctx.measureText(w.slice(0, i)).width > maxW) i--; out.push(w.slice(0, i)); w = w.slice(i); }
      cur = w;
    }
    if (cur) out.push(cur);
    return out;
  }

  function pillText(ctx, text, x, y, U, fg, bg, bold) {
    ctx.font = `${bold ? 'bold ' : ''}${Math.round(11 * U)}px ${FONT}`;
    ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
    const w = Math.ceil(ctx.measureText(text).width);
    const h = Math.round(15 * U), pad = Math.round(5 * U);
    ctx.fillStyle = bg; ctx.fillRect(Math.round(x - w / 2 - pad), Math.round(y - h / 2), w + pad * 2, h);
    ctx.fillStyle = fg; ctx.fillText(text, Math.round(x - w / 2), Math.round(y + U * 0.5));
    return w + pad * 2;
  }

  function measurePill(ctx, text, U, bold) {
    ctx.font = `${bold ? 'bold ' : ''}${Math.round(11 * U)}px ${FONT}`;
    return Math.ceil(ctx.measureText(text).width) + Math.round(5 * U) * 2;
  }
  const TYPE_BADGE = {
    claude: { text: 'Claude', bg: '#d97757', fg: '#2a1208' },
    cursor: { text: 'Cursor', bg: '#e6e8f5', fg: '#14151f' },
    mock: { text: 'Mock', bg: '#5a5f7a', fg: '#fff' },
  };

  function drawBubble(ctx, text, cx, bottom, S, U, W2, dry) {
    ctx.font = `${Math.round(11 * U)}px ${FONT}`;
    ctx.textBaseline = 'top'; ctx.textAlign = 'left';
    const maxW = Math.max(120 * U, 46 * S);
    let lines = wrap(ctx, text, maxW);
    const maxLines = 4;
    if (lines.length > maxLines) { lines = lines.slice(-maxLines); lines[0] = '…' + lines[0]; }
    const lh = Math.round(14 * U), pad = Math.round(6 * U), bw2 = Math.round(2 * U);
    const w = Math.ceil(Math.max(...lines.map((l) => ctx.measureText(l).width))) + pad * 2;
    const h = lines.length * lh + pad * 2;
    let x = Math.round(cx - w / 2); x = Math.max(4, Math.min(W2 - w - 4, x));
    const y = Math.round(bottom - h);
    if (dry) return { x, y, w, h: h + 8 * U };   // measuring only (used to stack overlapping bubbles)
    ctx.fillStyle = '#2b2f3b'; ctx.fillRect(x - bw2, y - bw2, w + bw2 * 2, h + bw2 * 2);
    ctx.fillStyle = '#fffbe8'; ctx.fillRect(x, y, w, h);
    // blocky tail
    const tx = Math.round(Math.max(x + 8 * U, Math.min(x + w - 12 * U, cx)));
    for (let i = 0; i < 3; i++) {
      const tw = Math.round((6 - i * 2) * U);
      ctx.fillStyle = '#2b2f3b'; ctx.fillRect(tx - tw / 2 - bw2, y + h + i * bw2 * 1.5, tw + bw2 * 2, bw2 * 1.5 + 1);
      ctx.fillStyle = '#fffbe8'; ctx.fillRect(tx - tw / 2, y + h + i * bw2 * 1.5 - (i === 0 ? bw2 : 0), tw, bw2 * 1.5 + (i === 0 ? bw2 : 0));
    }
    ctx.fillStyle = '#2b2f3b';
    lines.forEach((l, i) => ctx.fillText(l, x + pad, y + pad + i * lh));
  }

  // ---------- dining room ----------
  const faceToward = (fx, fy, tx, ty) => { const dx = tx - fx, dy = ty - fy; return Math.abs(dx) >= Math.abs(dy) ? (dx > 0 ? 0 : 2) : (dy > 0 ? 1 : 3); };
  /** where a walker is e seconds along legs [{pts, hold, face}] (home -> pass -> table -> home); null once back home */
  function legAt(legs, e, speed) {
    for (let i = 0; i < legs.length; i++) {
      const { pts, hold, face } = legs[i];
      for (let j = 1; j < pts.length; j++) {
        const p = pts[j - 1], q = pts[j], d = Math.hypot(q.x - p.x, q.y - p.y) / speed;
        if (e < d) { const f = e / d; return { x: p.x + (q.x - p.x) * f, y: p.y + (q.y - p.y) * f, face: faceToward(p.x, p.y, q.x, q.y), walk: true, carry: i === 1, served: i === 2 }; }
        e -= d;
      }
      const end = pts[pts.length - 1];
      if (e < hold) return { x: end.x, y: end.y, face, walk: false, carry: false, served: i === 1 };
      e -= hold;
    }
    return null;
  }
  // rows of two tables; the runner walks the x = LANE aisle and serves from the table's left side
  const LANE = 396, PICKUP = { x: LANE, y: 192 }, RHOME = { x: LANE, y: 56 };
  const TABLES = Array.from({ length: 8 }, (_, i) => {
    const x = 420 + 42 * (i % 2), y = 78 + 44 * (i >> 1), spot = { x: i % 2 ? 440 : LANE, y: y + 4 };
    const via = spot.x === LANE ? [spot] : [{ x: LANE, y: y + 24 }, { x: spot.x, y: y + 24 }, spot];
    return { x, y, legs: [{ pts: [RHOME, PICKUP], hold: 0.6 }, { pts: [PICKUP, ...via], hold: 1.5 }, { pts: [...via].reverse().concat(RHOME), hold: 0 }] };
  });
  const runnerAt = (k, e) => legAt(TABLES[k].legs, e, 40);
  const DINER = { skin: ['#f1c9a0', '#e0a97a', '#c68b5c', '#8d5a3b', '#f6d6b8'], hair: ['#2b1d14', '#6b3f1d', '#d9a441', '#1c1c24', '#a23b2a', '#8a8f98'],
    shirt: ['#3e8ef7', '#e93d82', '#12a594', '#f5a524', '#8e4ec6', '#e5484d'], style: ['short', 'long', 'spiky', 'bun', 'cap'] };
  const RUNNER = { shirt: '#2a2e36', pants: '#1c1c24', skin: '#e0a97a', hair: '#2b1d14', hairStyle: 'short' };
  const EAT = 20;   // seconds a served plate stays on the table
  function dinerLook(name) {   // same project, same diner
    let h = 0; for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    const p = (arr, k) => arr[Math.floor(rnd(h % 9973 + k) * arr.length)];
    return { skin: p(DINER.skin, 1), hair: p(DINER.hair, 2), shirt: p(DINER.shirt, 3), hairStyle: p(DINER.style, 4), pants: '#2f3b52' };
  }
  function drawDinTable(c, tb, d, t, k) {
    const { x, y } = tb, look = dinerLook(d.name), eating = d.served != null && d.served < EAT;
    const bite = eating && Math.floor(t * 2.5 + k * 1.85) % 3 === 0;
    R(c, x - 5, y - 30, 10, 6, '#6b4226'); R(c, x - 5, y - 30, 10, 1, '#8a5a34');   // chair back
    R(c, x - 6, y - 16, 12, 12, look.shirt); R(c, x - 2, y - 17, 4, 2, shade(look.skin, -25));
    drawHead(c, x, y - 28, look, { hat: 'none', mood: eating ? 'happy' : 'normal', blink: ((t * 1000 + k * 1300) % 3600) < 140 });
    R(c, x - 13, y - 5, 26, 6, '#3e7a56'); R(c, x - 13, y - 5, 26, 1, '#6aa882'); R(c, x - 13, y + 1, 26, 3, '#2f6444');
    R(c, x - 11, y + 4, 2, 5, '#4a2c18'); R(c, x + 9, y + 4, 2, 5, '#4a2c18');
    R(c, x + 8, y - 8, 2, 4, '#cfe8f4');
    if (d.bill) slip(c, x - 12, y - 7);
    if (eating) { disc(c, x, y - 3, 3, '#f0eee8'); disc(c, x, y - 3, 2, '#fff'); if (d.served < EAT * 0.7) disc(c, x, y - 3, 1, '#c84830'); }
    if (bite) { R(c, x + 5, y - 15, 2, 6, look.shirt); R(c, x + 5, y - 17, 2, 2, look.skin); R(c, x + 6, y - 20, 1, 3, '#c8ccd4'); R(c, x - 8, y - 9, 3, 3, look.skin); }
    else { R(c, x - 8, y - 9, 3, 3, look.skin); R(c, x + 5, y - 9, 3, 3, look.skin); }
  }
  function drawDining(c, dining, t) {
    const r = dining.runner || RHOME;
    const items = dining.tables.map((d, k) => ({ y: TABLES[k].y + 6, draw: () => drawDinTable(c, TABLES[k], d, t, k) }));
    items.push({ y: r.y, draw: () => {
      drawStanding(c, { look: RUNNER, x: r.x, y: r.y, mode: r.walk ? 'walk' : 'stand', state: 'idle', phase: 0.5, slot: -1 }, t);
      if (r.carry) { const px = Math.round(r.x) + 9, py = Math.round(r.y) - 15; disc(c, px, py, 3, '#f0eee8'); disc(c, px, py, 2, '#fff'); disc(c, px, py - 1, 1, '#c84830'); }
    } });
    for (const it of items.sort((a, b) => a.y - b.y)) it.draw();
  }

  const dur = (ms) => ms == null ? '?' : ms < 60000 ? (ms / 1000).toFixed(1) + 's' : Math.floor(ms / 60000) + 'm ' + String(Math.round(ms / 1000) % 60).padStart(2, '0') + 's';
  const tok = (n) => n == null ? '?' : n >= 1000 ? (n / 1000).toFixed(1) + 'k' : String(n);
  /** the bill card: project, who cooked it and how long, then one row per count, on receipt paper kept inside the canvas */
  function drawBill(ctx, name, b, cx, bottom, U, W2) {
    const rows = [[name, ''], [b.who, dur(b.ms)], ['pantry trips', b.pantry], ['edits', b.edits], ['commands', b.commands]];
    if (b.tokensIn != null || b.tokensOut != null) rows.push(['tokens in', tok(b.tokensIn)], ['tokens out', tok(b.tokensOut)]);
    if (b.cost != null) rows.push(['cost', '$' + b.cost.toFixed(4)]);
    ctx.font = `${Math.round(11 * U)}px ${FONT}`; ctx.textBaseline = 'top';
    const lh = Math.round(14 * U), pad = Math.round(6 * U), bw2 = Math.round(2 * U), rule = Math.round(5 * U);
    const w = Math.ceil(Math.max(...rows.map((r) => ctx.measureText(r[0] + r[1]).width)) + 16 * U) + pad * 2, h = rows.length * lh + rule + pad * 2;
    const x = Math.round(Math.max(4, Math.min(W2 - w - 4, cx - w / 2))), y = Math.round(Math.max(4, bottom - h));
    ctx.fillStyle = '#2b2f3b'; ctx.fillRect(x - bw2, y - bw2, w + bw2 * 2, h + bw2 * 2);
    ctx.fillStyle = '#fffbe8'; ctx.fillRect(x, y, w, h);
    ctx.fillStyle = '#9a8f6a'; for (let i = x + pad; i < x + w - pad; i += 4 * U) ctx.fillRect(Math.round(i), y + pad + lh * 2 + Math.round(rule / 2) - 1, Math.round(2 * U), Math.max(1, Math.round(U)));
    rows.forEach((r, i) => {
      const ty = y + pad + i * lh + (i >= 2 ? rule : 0);
      ctx.font = `${i ? '' : 'bold '}${Math.round(11 * U)}px ${FONT}`; ctx.fillStyle = '#2b2f3b';
      ctx.textAlign = 'left'; ctx.fillText(String(r[0]), x + pad, ty);
      ctx.textAlign = 'right'; ctx.fillText(String(r[1]), x + w - pad, ty);
    });
    ctx.textAlign = 'left';
  }
  const slip = (c, x, y) => { R(c, x, y, 5, 6, '#7a7058'); R(c, x, y, 4, 5, '#fffbe8'); R(c, x + 1, y + 1, 2, 1, '#9a8f6a'); R(c, x + 1, y + 3, 2, 1, '#9a8f6a'); };

  const STATE_COL = { idle: '#8b90ad', thinking: '#b7a8ff', working: '#7fd6ff', done: '#6be39b', error: '#ff6b70' };

  // ---------- main ----------
  let lastBillHits = [];
  const bg = buildBackground();
  const logical = document.createElement('canvas'); logical.width = W; logical.height = H;
  const lc = logical.getContext('2d');

  /** scene: {t, entries:[{id,name,slot,look,state,tool,phase,away,x,y,mode,bubble}], selectedId, hoverId, hoverSlot} */
  function render(canvas, S, U, scene) {
    const t = scene.t;
    lc.drawImage(bg, 0, 0);
    // steam over the staff coffee urn
    for (let i = 0; i < 3; i++) {
      const p = ((t * 8 + i * 4) % 12);
      lc.globalAlpha = 0.6 * (1 - p / 12); R(lc, 360 + Math.sin(t * 2 + i * 2) * 1.5, 30 - p, 2, 2, '#fff');
    }
    lc.globalAlpha = 1;
    const bySlot = {}; scene.entries.forEach((e) => { bySlot[e.slot] = e; });
    for (let i = 0; i < MAX_SLOTS; i++) drawSeat(lc, SLOTS[i], bySlot[i] || null, t);
    const away = scene.entries.filter((e) => e.away).sort((a, b) => a.y - b.y);
    for (const e of away) drawStanding(lc, e, t);
    if (scene.dining) drawDining(lc, scene.dining, t);
    // selection / hover outlines
    for (const e of scene.entries) {
      const s = SLOTS[e.slot];
      if (e.id === scene.selectedId) dashedRect(lc, s.cx - 33, s.cy - 42, 66, 70, '#f5c542', t);
      else if (e.id === scene.hoverId) dashedRect(lc, s.cx - 33, s.cy - 42, 66, 70, 'rgba(255,255,255,.7)', 0);
    }
    if (scene.hoverSlot != null && !bySlot[scene.hoverSlot]) { const s = SLOTS[scene.hoverSlot]; dashedRect(lc, s.cx - 33, s.cy - 42, 66, 70, 'rgba(95,242,165,.85)', 0); }

    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(logical, 0, 0, W * S, H * S);

    // overlays
    for (const e of scene.entries) {
      const s = SLOTS[e.slot];
      const px = e.away ? e.x : s.cx, headTop = e.away ? e.y - 36 : s.cy - 35;
      const sel = e.id === scene.selectedId;
      const labY = (s.cy + 28) * S;
      const dotCol = STATE_COL[e.state] || '#999';
      const tb = TYPE_BADGE[e.type];
      const nameTxt = '   ' + (e.main ? '★ ' : '') + e.name;
      const nw = measurePill(ctx, nameTxt, U, sel);
      const bw = tb ? measurePill(ctx, tb.text, U * 0.8, true) : 0;
      const gap = tb ? Math.round(3 * U) : 0;
      const left = s.cx * S - (nw + gap + bw) / 2;
      const w = pillText(ctx, nameTxt, left + nw / 2, labY, U, sel ? '#14151f' : '#fff', sel ? '#f5c542' : 'rgba(20,21,31,.85)', sel);
      ctx.fillStyle = dotCol; ctx.fillRect(Math.round(left + 5 * U), Math.round(labY - 3 * U), Math.round(5 * U), Math.round(5 * U));
      if (tb) pillText(ctx, tb.text, left + nw + gap + bw / 2, labY, U * 0.8, tb.fg, tb.bg, true);
      if (e.state === 'working' && e.tool) pillText(ctx, e.tool, (s.cx + 20) * S, (s.cy - 29) * S, U * 0.9, '#0e1f1a', '#5ff2a5', true);
      else if (e.state === 'working') pillText(ctx, 'typing…', (s.cx + 20) * S, (s.cy - 29) * S, U * 0.9, '#0e1f1a', '#5ff2a5', true);
      if (e.queued) pillText(ctx, '+' + e.queued + ' queued', s.cx * S, (s.cy + 38) * S, U * 0.85, '#14151f', '#f5c542', true);
      if (e.bubble) drawBubble(ctx, e.bubble, px * S, (headTop - 18) * S, S, U, canvas.width);
    }
    if (scene.dining) scene.dining.tables.forEach((d, k) => pillText(ctx, d.name, TABLES[k].x * S, (TABLES[k].y + 5) * S, U * 0.8, '#f4f1e8', 'rgba(58,36,20,.9)', true));
    lastBillHits = [];
    if (scene.dining) scene.dining.tables.forEach((d, k) => {
      if (!d.bill) return;
      const { x, y } = TABLES[k];
      lastBillHits.push({ cwd: d.cwd, x: x - 14, y: y - 9, w: 9, h: 10 });
      if (d.open) drawBill(ctx, d.name, d.bill, (x - 10) * S, (y - 10) * S, U, canvas.width);
    });
    for (let i = 0; i < MAX_SLOTS; i++) if (!bySlot[i] && scene.hoverSlot === i) pillText(ctx, '＋ hire', SLOTS[i].cx * S, (SLOTS[i].cy + 28) * S, U, '#0e1f1a', '#5ff2a5', true);
  }

  function hitTest(lx, ly, entries) {
    const away = entries.filter((e) => e.away).sort((a, b) => b.y - a.y);
    for (const e of away) if (lx >= e.x - 10 && lx <= e.x + 10 && ly >= e.y - 38 && ly <= e.y + 2) return { id: e.id };
    for (let i = 0; i < MAX_SLOTS; i++) {
      const s = SLOTS[i];
      if (lx >= s.cx - 30 && lx <= s.cx + 30 && ly >= s.cy - 40 && ly <= s.cy + 24) {
        const e = entries.find((x) => x.slot === i);
        return e ? { id: e.id } : { slot: i };
      }
    }
    return null;
  }

  // Standing spots near the coffee machine: one sipper, or two chatters side by side.
  const SPOTS = { coffee: [{ x: COFFEE.x, y: COFFEE.y }], chat: [{ x: 336, y: 108 }, { x: 362, y: 108 }], pantry: [{ x: 330, y: 100 }, { x: 350, y: 100 }, { x: 370, y: 100 }], bell: [{ x: 320, y: 170 }, { x: 380, y: 170 }], door: { x: 24, y: 140, face: 0 } };
  /** Path from a desk to a spot: out the side gap, along the aisle, then up to the spot. */
  function walkPath(slot, spot) {
    const s = SLOTS[slot], ay = AISLE[s.row];
    return [{ x: s.cx + 33, y: s.cy + 2 }, { x: s.cx + 38, y: ay }, { x: spot.x, y: ay }, { x: spot.x, y: spot.y }];
  }

  function drawAvatar(canvas, look, main) {
    const c = canvas.getContext('2d'); c.clearRect(0, 0, canvas.width, canvas.height);
    R(c, 3, 20, 14, 8, '#f2efe6'); R(c, 4, 22, 12, 6, look.shirt);
    R(c, 8, 19, 4, 2, shade(look.skin, -25));
    drawHead(c, 10, 8, look, { mood: 'happy', hat: main ? 'toque' : 'cap' });
  }

  window.OfficeFlat = { W, H, SLOTS, MAX_SLOTS, MGR: SLOTS.length - 1, render, hitTest, walkPath, SPOTS, drawAvatar, COFFEE, AISLE, TABLES, runnerAt, billHits: () => lastBillHits,
    SPEED: 40, STEP: 0.5, // walking speed in world units/s (px here) and canvas scale step
    // helpers re-used by the isometric renderer
    shared: { R, shade, rnd, disc, line, bmp, stateIcon, drawTalk, pillText, measurePill, drawBubble, TYPE_BADGE, STATE_COL, dashedRect, legAt, dinerLook, RUNNER, EAT, drawBill, slip } };
})();
