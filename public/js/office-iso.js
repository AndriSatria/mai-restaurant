/* mAI-restaurant - ISOMETRIC (2:1 dimetric) procedural pixel-art kitchen. This is the default view
 * (add ?view=flat for the old top-down one in office-flat.js).
 *
 * No assets: everything is drawn with fillRect / scan-line polygons on a small logical canvas
 * (400x264) that is blitted to the visible canvas with integer scaling and smoothing disabled.
 * World = a 12x12 tile grid. Tile (x,y) -> screen: sx = OX + (x-y)*16, sy = OY + (x+y)*8 - z.
 *   +x runs down-right ("SE"), +y runs down-left ("SW"); the two back walls are the planes y=0 and x=0.
 * Facings (4): 0 = SE (+x), 1 = SW (+y), 2 = NW (-x), 3 = NE (-y). SW/NW are mirrors of SE/NE.
 * Depth sorting is a footprint-aware painter's algorithm (topological, not just x+y).
 * Text (names, badges, tool chips, speech bubbles) is drawn on the visible canvas at native res. */
(function () {
  'use strict';
  const F = window.OfficeFlat;
  const { R, shade, rnd, disc, line, stateIcon, drawTalk, pillText, measurePill, drawBubble, TYPE_BADGE, STATE_COL } = F.shared;

  const W = 400, H = 264, OX = 200, OY = 62, GX = 12, GY = 12, WH = 56;
  const SEAT = 8, DESKZ = 13, MAX_SLOTS = 7, MGR = 6, SPEED = 2.6; // SPEED in tiles/second; slot 6 = the pass (head chef)
  const AISLE = 3.55, FRONT1 = 6.55;      // desk-to-desk dotted lanes: the aisle between the rows / the strip in front of row 1
  const sx = (x, y) => OX + Math.round((x - y) * 16);
  const sy = (x, y, z) => OY + Math.round((x + y) * 8) - (z || 0);
  const A = (x, y, z) => [sx(x, y), sy(x, y, z)];
  const mk = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };

  // ---------- layout ----------
  // 6 cook stations: two rows (x) of three (y), counters joined through the y-gaps into two continuous runs.
  // Cooks stand on the -x side and face +x (SE) toward their own kitchen set. Slot 6 = the PASS: the chef stands facing NE.
  // Per slot: seat (standing mark), start (tiles they step onto when leaving), pad/gapY (dotted-lane anchors), ring, lab.
  const SLOTS = [];
  for (let i = 0; i < MGR; i++) {
    const row = Math.floor(i / 3), col = i % 3, dx = row ? 5 : 2, dy = 1 + 3 * col;
    SLOTS.push({ i, row, col, dx, dy, seat: { x: dx - 0.5, y: dy + 1 }, start: [[dx - 1, dy], [dx - 1, dy + 1]],
      px: row ? FRONT1 : AISLE, py: dy + 1, gapY: col < 2 ? dy + 2.5 : dy - 0.5,
      ring: { x0: Math.max(dx - 1.15, 0.15), y0: Math.max(dy - 0.2, 0.15), x1: Math.min(dx + 1.3, GX - 0.15), y1: Math.min(dy + 2.2, GY - 0.15) },
      lab: { x: dx - 0.45, y: dy + 1.75 }, desk: { x: dx + 0.5, y: dy + 1 } });
  }
  const MD = { x0: 6.1, x1: 9.0, y0: 0, y1: 1 };            // pass footprint (2.9 tiles wide, 1 deep), a free tile (x=9) before the fridge
  const MS = { x: 8.5, y: 1.5 };                            // the head chef's standing mark
  const MON_X = 7.9375;                                      // left edge of the ticket rail (hit-test region, same as the old monitor)
  SLOTS.push({ i: MGR, row: 1, col: 4, dx: MD.x0, dy: 0, mgr: true, seat: MS, start: [[7, 1], [8, 2]],
    px: FRONT1, py: 2.45, gapY: 3.5, ring: { x0: 5.9, y0: 0.15, x1: 9.1, y1: 2.35 }, lab: { x: 8.9, y: 2.25 }, desk: { x: 7.5, y: 0.5 } });
  const COUNTER = { x0: 10, y0: 0, x1: 12, y1: 1 };
  const PLANTS = [{ x: 0, y: 0 }, { x: 11, y: 5 }, { x: 11, y: 11 }, { x: 0, y: 11 }, { x: 7, y: 11 }];
  // planning table in the open area (plan mode: everybody gathers here)
  const TABLE = { x: 9, y: 7.5, r: 1.2, h: 15 };
  const SEATS = [   // standing places around the planning table, front-facing first; face looks toward the table
    [-1.31, -1.31, 0], [0, -1.85, 1], [-1.85, 0, 0], [1.31, -1.31, 1], [-1.31, 1.31, 0], [1.85, 0, 2], [0, 1.85, 3], [1.31, 1.31, 3],
  ].map(([ox, oy, face], i) => ({ i, x: TABLE.x + ox, y: TABLE.y + oy, face }));
  const RUG = { x0: 9.1, y0: 1.1, x1: 11.9, y1: 4 };
  // standing spots (tile centres) near the staff break / fridge + the direction they face
  const SETS = ['sink', 'fryer', 'oven', 'grill', 'stove', 'prep'];
  const HEAT = { fryer: 1, oven: 1, grill: 1, stove: 1 };
  const stationSet = (slot) => (slot >= 0 && slot < SETS.length ? SETS[slot] : null);
  const deskSpan = (s) => ({ x0: s.dx, x1: s.dx + 1, y0: s.col === 0 ? s.dy : s.dy - 0.5, y1: s.col === 2 ? s.dy + 2 : s.dy + 2.5 });
  const SPOTS = {
    coffee: [{ x: 10.5, y: 1.5, face: 1 }],
    chat: [{ x: 9.5, y: 3.5, face: 0 }, { x: 10.5, y: 3.5, face: 2 }],
    door: { x: 0.5, y: 4.7, face: 0 },
    // a couple of places at the fridge / shelf and at the pass, so cooks on the same trip don't stack
    pantry: [{ x: 11.5, y: 1.5, face: 3 }, { x: 10.5, y: 2.5, face: 3 }, { x: 11.5, y: 3.5, face: 3 }],
    bell: [{ x: 6.5, y: 1.5, face: 3 }, { x: 6.5, y: 2.5, face: 3 }],
    // in front of the pass, where kitchen hands bring dishes back to the head chef
    pass: [{ x: 7.5, y: 1.5, face: 3 }, { x: 6.5, y: 1.5, face: 3 }, { x: 7.5, y: 2.5, face: 3 }, { x: 6.5, y: 2.5, face: 3 }, { x: 9.5, y: 1.5, face: 2 }],
    // aisle spots beside the heat sets, used when Bash is at a cold station (sink / prep)
    heat: [{ x: 3.5, y: 3.5, face: 0 }, { x: 3.5, y: 6.5, face: 0 }, { x: 6.5, y: 3.5, face: 2 }],
  };

  // blocked[y][x]: furniture the pathfinder must avoid
  const blocked = Array.from({ length: GY }, () => Array(GX).fill(false));
  const block = (x0, y0, x1, y1) => { for (let y = Math.floor(y0); y < Math.ceil(y1); y++) for (let x = Math.floor(x0); x < Math.ceil(x1); x++) blocked[y][x] = true; };
  for (const s of SLOTS) { if (s.mgr) continue; block(s.dx, s.dy, s.dx + 1, s.dy + 2); block(s.dx - 1, s.dy, s.dx, s.dy + 2); }
  for (const dx of [2, 5]) { block(dx, 3, dx + 1, 4); block(dx, 6, dx + 1, 7); }   // join the counters through the y-gaps (aisles at x=dx-1 stay open)
  block(MD.x0, MD.y0, MD.x1, MD.y1); block(8, 1, 9, 2);        // pass + chef's standing tile
  block(8, 6, 10, 9);                                           // planning table
  for (const st of SEATS) block(st.x - 0.1, st.y - 0.1, st.x + 0.1, st.y + 0.1);   // standing marks (walkable only as a destination)
  block(COUNTER.x0, COUNTER.y0, COUNTER.x1, COUNTER.y1);
  for (const p of PLANTS) block(p.x, p.y, p.x + 1, p.y + 1);
  const isBlocked = (tx, ty) => tx < 0 || ty < 0 || tx >= GX || ty >= GY || blocked[ty][tx];

  /** Tile-grid path (4-neighbour BFS, so it never cuts through furniture) from a desk to a spot.
   *  Returns waypoints [{x,y}] in world (tile) coords: seat, ..., spot. Collinear points are merged. */
  function walkPath(slot, spot) {
    const s = SLOTS[slot];
    const key = (x, y) => y * GX + x;
    const prev = new Map(), q = [];
    for (const [x, y] of s.start) { prev.set(key(x, y), -1); q.push([x, y]); }
    const gx = Math.floor(spot.x), gy = Math.floor(spot.y);
    const D = [[1, 0], [0, 1], [-1, 0], [0, -1]];
    let found = false;
    while (q.length) {
      const [x, y] = q.shift();
      if (x === gx && y === gy) { found = true; break; }
      for (const [dx, dy] of D) {
        const nx = x + dx, ny = y + dy;
        if ((isBlocked(nx, ny) && !(nx === gx && ny === gy && nx >= 0 && ny >= 0 && nx < GX && ny < GY)) || prev.has(key(nx, ny))) continue;
        prev.set(key(nx, ny), key(x, y)); q.push([nx, ny]);
      }
    }
    const tiles = [];
    if (found) { for (let k = key(gx, gy); k !== -1; k = prev.get(k)) tiles.unshift([k % GX, Math.floor(k / GX)]); }
    const pts = [{ x: s.seat.x, y: s.seat.y }];
    for (const [x, y] of tiles) pts.push({ x: x + 0.5, y: y + 0.5 });
    pts[pts.length - 1] = { x: spot.x, y: spot.y };
    const out = [pts[0]];
    for (let i = 1; i < pts.length - 1; i++) { // drop collinear middles
      const a = out[out.length - 1], b = pts[i], c = pts[i + 1];
      if (Math.abs((b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x)) > 1e-6) out.push(b);
    }
    out.push(pts[pts.length - 1]);
    return out;
  }

  /** Path between two arbitrary world points over the tile grid (start tile may be furniture, e.g. a standing post). */
  function walkBetween(from, to) {
    const key = (x, y) => y * GX + x;
    const sx0 = Math.max(0, Math.min(GX - 1, Math.floor(from.x))), sy0 = Math.max(0, Math.min(GY - 1, Math.floor(from.y)));
    const gx = Math.floor(to.x), gy = Math.floor(to.y);
    const prev = new Map([[key(sx0, sy0), -1]]), q = [[sx0, sy0]];
    const D = [[1, 0], [0, 1], [-1, 0], [0, -1]];
    let found = false;
    while (q.length) {
      const [x, y] = q.shift();
      if (x === gx && y === gy) { found = true; break; }
      for (const [dx, dy] of D) {
        const nx = x + dx, ny = y + dy;
        if (isBlocked(nx, ny) || prev.has(key(nx, ny))) continue;
        prev.set(key(nx, ny), key(x, y)); q.push([nx, ny]);
      }
    }
    const tiles = [];
    if (found) { for (let k = key(gx, gy); k !== -1; k = prev.get(k)) tiles.unshift([k % GX, Math.floor(k / GX)]); }
    const pts = [{ x: from.x, y: from.y }];
    for (const [x, y] of tiles) pts.push({ x: x + 0.5, y: y + 0.5 });
    pts.push({ x: to.x, y: to.y });
    const out = [pts[0]];
    for (let i = 1; i < pts.length - 1; i++) {
      const a = out[out.length - 1], b = pts[i], c = pts[i + 1];
      if (Math.hypot(b.x - a.x, b.y - a.y) < 0.05) continue;
      if (Math.abs((b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x)) > 1e-6) out.push(b);
    }
    out.push(pts[pts.length - 1]);
    return out;
  }

  // ---------- raster helpers ----------
  /** Fill a polygon; a pixel is inside when its centre is, so neighbouring polygons never leave gaps. */
  function poly(c, pts, col) {
    c.fillStyle = col;
    let mn = Infinity, mx = -Infinity;
    for (const p of pts) { if (p[1] < mn) mn = p[1]; if (p[1] > mx) mx = p[1]; }
    const n = pts.length;
    for (let y = Math.ceil(mn - 0.5); y <= Math.floor(mx - 0.5); y++) {
      const yc = y + 0.5, xs = [];
      for (let i = 0; i < n; i++) {
        const a = pts[i], b = pts[(i + 1) % n];
        if ((a[1] <= yc && b[1] > yc) || (b[1] <= yc && a[1] > yc)) xs.push(a[0] + ((yc - a[1]) * (b[0] - a[0])) / (b[1] - a[1]));
      }
      xs.sort((p, q) => p - q);
      for (let i = 0; i + 1 < xs.length; i += 2) {
        const xa = Math.ceil(xs[i] - 0.5), xb = Math.ceil(xs[i + 1] - 0.5);
        if (xb > xa) c.fillRect(xa, y, xb - xa, 1);
      }
    }
  }
  const inPoly = (p, x, y) => { // point in convex/concave polygon (even-odd)
    let ins = false;
    for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
      if ((p[i][1] > y) !== (p[j][1] > y) && x < ((p[j][0] - p[i][0]) * (y - p[i][1])) / (p[j][1] - p[i][1]) + p[i][0]) ins = !ins;
    }
    return ins;
  };
  /** Axis-aligned iso box. cols: {top, se, sw, hi?, dk?}. se = face at x=x1, sw = face at y=y1. */
  function box(c, x0, y0, x1, y1, z0, z1, cols) {
    poly(c, [A(x0, y0, z1), A(x1, y0, z1), A(x1, y1, z1), A(x0, y1, z1)], cols.top);
    poly(c, [A(x1, y0, z1), A(x1, y1, z1), A(x1, y1, z0), A(x1, y0, z0)], cols.se);
    poly(c, [A(x0, y1, z1), A(x1, y1, z1), A(x1, y1, z0), A(x0, y1, z0)], cols.sw);
    if (cols.hi) { // highlight along the two front top edges
      const a = A(x0, y1, z1), b = A(x1, y1, z1), d = A(x1, y0, z1);
      line(c, a[0], a[1], b[0], b[1], cols.hi, 1); line(c, b[0], b[1], d[0], d[1], cols.hi, 1);
    }
    if (cols.dk) { const b = A(x1, y1, z1), e = A(x1, y1, z0); line(c, b[0], b[1], e[0], e[1] - 1, cols.dk, 1); }
  }
  const boxHex = (x0, y0, x1, y1, z0, z1) => [A(x0, y0, z1), A(x1, y0, z1), A(x1, y0, z0), A(x1, y1, z0), A(x0, y1, z0), A(x0, y1, z1)];
  /** Rect drawn on a vertical wall-like plane. (px0,py0) = screen position of the plane's floor-level start vertex,
   *  dir +1 for planes that run down-right (y = const), -1 for planes running down-left (x = const),
   *  a = pixels along the plane, v = height above the floor. */
  function pr(c, px0, py0, dir, a0, a1, v0, v1, col) {
    c.fillStyle = col;
    for (let k = a0; k < a1; k++) c.fillRect(dir > 0 ? px0 + k : px0 - 1 - k, py0 + ((k + 1) >> 1) - v1, 1, v1 - v0);
  }

  // ---------- static background ----------
  function window3(c, px0, py0, dir, a0, w, v0, h) {
    pr(c, px0, py0, dir, a0 - 2, a0 + w + 2, v0 - 1, v0 + h + 2, '#6a7078');
    pr(c, px0, py0, dir, a0 - 1, a0 + w + 1, v0 + h, v0 + h + 1, '#c8ccd4');
    pr(c, px0, py0, dir, a0, a0 + w, v0, v0 + h, '#8ec9ff');
    pr(c, px0, py0, dir, a0, a0 + w, v0, v0 + 7, '#b4e0ff');
    pr(c, px0, py0, dir, a0 + 3, a0 + 10, v0 + h - 7, v0 + h - 5, '#fff'); pr(c, px0, py0, dir, a0 + 5, a0 + 9, v0 + h - 5, v0 + h - 3, '#fff');
    pr(c, px0, py0, dir, a0 + w - 10, a0 + w - 3, v0 + 8, v0 + 10, '#fff');
    pr(c, px0, py0, dir, a0 + (w >> 1) - 1, a0 + (w >> 1) + 1, v0, v0 + h, '#dce8f4');
    pr(c, px0, py0, dir, a0, a0 + w, v0 + (h >> 1), v0 + (h >> 1) + 1, '#dce8f4');
    pr(c, px0, py0, dir, a0 - 3, a0 + w + 3, v0 - 3, v0 - 1, '#d8d4cc'); pr(c, px0, py0, dir, a0 - 3, a0 + w + 3, v0 - 4, v0 - 3, '#8a867e');
  }
  const GLYPH = {
    M: ['#.#', '###', '###', '#.#', '#.#'], N: ['##.', '#.#', '#.#', '#.#', '#.#'], G: ['###', '#..', '#.#', '#.#', '###'],
    R: ['###', '#.#', '###', '##.', '#.#'], C: ['###', '#..', '#..', '#..', '###'], A: ['###', '#.#', '###', '#.#', '#.#'],
    F: ['###', '#..', '##.', '#..', '#..'], E: ['###', '#..', '##.', '#..', '###'],
    P: ['###', '#.#', '###', '#..', '#..'], S: ['###', '#..', '###', '..#', '###'],
    H: ['#.#', '#.#', '###', '#.#', '#.#'], T: ['###', '.#.', '.#.', '.#.', '.#.'],
  };
  function plant(c, x, y) { // herb pot: same footprint, kitchen herbs instead of a leafy office plant
    const cx = sx(x + 0.5, y + 0.5), by = sy(x + 0.5, y + 0.5, 0);
    box(c, x + 0.28, y + 0.28, x + 0.72, y + 0.72, 0, 7, { top: '#c45a38', se: '#8a3a22', sw: '#a8482c', hi: '#e07850' });
    box(c, x + 0.24, y + 0.24, x + 0.76, y + 0.76, 7, 9, { top: '#3a2818', se: '#8a3a22', sw: '#a8482c' });
    for (const [dx, dy, r, col] of [[-3, -16, 3, '#2f8f4e'], [3, -15, 3, '#2f8f4e'], [0, -20, 4, '#3fae60'], [-5, -14, 3, '#3fae60'], [5, -14, 3, '#2f8f4e'], [1, -12, 3, '#2f8f4e']]) disc(c, cx + dx, by + dy, r, col);
    R(c, cx - 1, by - 11, 2, 4, '#1f6b3a');
    R(c, cx - 4, by - 18, 1, 5, '#1f6b3a'); R(c, cx + 3, by - 17, 1, 4, '#1f6b3a');
  }

  function buildBackground() {
    const bg = mk(W, H), c = bg.getContext('2d');
    // floor slab edges
    poly(c, [A(12, 0, 0), A(12, 12, 0), A(12, 12, -7), A(12, 0, -7)], '#7a3a28');
    poly(c, [A(0, 12, 0), A(12, 12, 0), A(12, 12, -7), A(0, 12, -7)], '#964832');
    // quarry-tile floor (warm kitchen clay, two shades)
    for (let j = 0; j < GY; j++) for (let i = 0; i < GX; i++) poly(c, [A(i, j), A(i + 1, j), A(i + 1, j + 1), A(i, j + 1)], (i + j) % 2 ? '#c86a42' : '#b85c38');
    for (let i = 0; i <= GX; i++) { const a = A(i, 0), b = A(i, GY); line(c, a[0], a[1], b[0], b[1], 'rgba(70,28,16,.28)', 1); }
    for (let j = 0; j <= GY; j++) { const a = A(0, j), b = A(GX, j); line(c, a[0], a[1], b[0], b[1], 'rgba(70,28,16,.28)', 1); }
    let a = A(0, 12), b = A(12, 12), d = A(12, 0);
    line(c, a[0], a[1], b[0], b[1], '#d4885c', 1); line(c, b[0], b[1], d[0], d[1], '#a85838', 1);

    // floor shadows under the two counter runs, plus a rubber mat at each standing post
    for (const dx of [2, 5]) poly(c, [A(dx, 1.05), A(dx + 1.35, 1.05), A(dx + 1.35, 9.15), A(dx, 9.15)], 'rgba(40,16,8,.2)');
    for (const s of SLOTS) {
      if (s.mgr) continue;
      poly(c, [A(s.dx - 0.95, s.dy + 0.55), A(s.dx - 0.12, s.dy + 0.55), A(s.dx - 0.12, s.dy + 1.5), A(s.dx - 0.95, s.dy + 1.5)], '#2a2e36');
      poly(c, [A(s.dx - 0.88, s.dy + 0.62), A(s.dx - 0.18, s.dy + 0.62), A(s.dx - 0.18, s.dy + 1.43), A(s.dx - 0.88, s.dy + 1.43)], '#3a4048');
    }
    poly(c, [A(8.12, 1.15), A(8.88, 1.15), A(8.88, 1.88), A(8.12, 1.88)], '#2a2e36');
    poly(c, [A(8.18, 1.22), A(8.82, 1.22), A(8.82, 1.82), A(8.18, 1.82)], '#3a4048');
    poly(c, [A(MD.x0 - 0.1, MD.y0), A(MD.x1 + 0.35, MD.y0), A(MD.x1 + 0.35, MD.y1 + 0.2), A(MD.x0 - 0.1, MD.y1 + 0.2)], 'rgba(40,16,8,.2)');
    const ring = (cx, cy, r, col, z) => poly(c, Array.from({ length: 56 }, (_, k) => A(cx + r * Math.cos((k / 56) * Math.PI * 2), cy + r * Math.sin((k / 56) * Math.PI * 2), z || 0)), col);
    // rubber mat under the planning table (dark kitchen mat, not an office rug)
    ring(TABLE.x, TABLE.y, 2.55, '#2a2e36'); ring(TABLE.x, TABLE.y, 2.43, '#3a4048'); ring(TABLE.x, TABLE.y, 2.12, '#32363e'); ring(TABLE.x, TABLE.y, 2.0, '#444a54');
    ring(TABLE.x + 0.18, TABLE.y + 0.18, 1.5, 'rgba(20,12,8,.2)');
    for (const st of SEATS) ring(st.x + 0.08, st.y + 0.08, 0.34, 'rgba(20,12,8,.22)');
    // anti-fatigue mat under the staff-break / fridge corner
    const rp = () => (x0, y0, x1, y1, col) => poly(c, [A(x0, y0), A(x1, y0), A(x1, y1), A(x0, y1)], col);
    const rug = rp();
    rug(RUG.x0, RUG.y0, RUG.x1, RUG.y1, '#2a2e36');
    rug(RUG.x0 + 0.12, RUG.y0 + 0.12, RUG.x1 - 0.12, RUG.y1 - 0.12, '#3e444e');
    rug(RUG.x0 + 0.38, RUG.y0 + 0.38, RUG.x1 - 0.38, RUG.y1 - 0.38, '#333840');
    for (let k = 0; k < 5; k++) rug(RUG.x0 + 0.5 + k * 0.4, RUG.y0 + 0.5, RUG.x0 + 0.62 + k * 0.4, RUG.y1 - 0.5, '#3e444e');
    rug(0.05, 4.1, 0.95, 5.3, '#3a322c'); rug(0.12, 4.18, 0.88, 5.22, '#5a4a40');

    // ----- back walls: white subway tiles -----
    const RW = [OX, OY, 1], LW = [OX, OY, -1];
    poly(c, [A(0, 0, WH), A(12, 0, WH), A(12, 0, 0), A(0, 0, 0)], '#e8e4dc');
    poly(c, [A(0, 0, WH), A(0, 12, WH), A(0, 12, 0), A(0, 0, 0)], '#d8d4cc');
    const tileWall = (P, grout, tileA, tileB, kick, kickSeam) => {
      for (let v = 4; v < WH - 4; v += 8) {
        const odd = ((v - 4) / 8) & 1;
        for (let k = odd ? -5 : 0; k < 192; k += 10) {
          const a0 = Math.max(0, k), a1 = Math.min(192, k + 9);
          if (a1 > a0) pr(c, P[0], P[1], P[2], a0, a1, v, v + 7, ((k / 10 + (v - 4) / 8) & 1) ? tileA : tileB);
        }
        pr(c, P[0], P[1], P[2], 0, 192, v + 7, v + 8, grout);
      }
      for (let k = 0; k < 192; k += 10) pr(c, P[0], P[1], P[2], k + 9, k + 10, 4, WH - 4, grout);
      pr(c, P[0], P[1], P[2], 0, 192, 0, 4, kick);
      pr(c, P[0], P[1], P[2], 0, 192, 3, 4, kickSeam);
    };
    tileWall(RW, '#b8b2a8', '#f4f0e8', '#ece8e0', '#9aa0a8', '#7a8088');
    tileWall(LW, '#a8a298', '#e4e0d8', '#dcd8d0', '#8a9098', '#6a7078');
    const trim = { top: '#d8dce4', se: '#6a7078', sw: '#b0b4bc' };
    box(c, 0, -0.25, 12, 0, WH - 3, WH, trim);
    box(c, -0.25, 0, 0, 12, WH - 3, WH, trim);
    box(c, -0.25, -0.25, 0, 0, WH - 3, WH, trim);
    // windows (smaller, tiled frames)
    window3(c, ...RW, 16, 26, 26, 20); window3(c, ...RW, 50, 26, 26, 20);
    window3(c, ...LW, 16, 26, 26, 20);
    // swinging kitchen door (left wall), same opening the hired cooks walk through
    pr(c, ...LW, 60, 88, 0, 47, '#3a4048'); pr(c, ...LW, 62, 86, 0, 45, '#c8ccd4'); pr(c, ...LW, 62, 74, 0, 45, '#b0b4bc');
    pr(c, ...LW, 68, 80, 22, 38, '#6a7078'); pr(c, ...LW, 69, 79, 23, 37, '#9ec8e8'); pr(c, ...LW, 72, 76, 28, 32, '#fff');
    pr(c, ...LW, 80, 83, 21, 24, '#f5c542');
    // hood vent over the pass (right wall, high enough that a tall toque stays clear)
    pr(c, ...RW, 96, 148, 40, 54, '#3a4048'); pr(c, ...RW, 98, 146, 42, 53, '#6a7078'); pr(c, ...RW, 100, 144, 50, 53, '#8a9098');
    for (let k = 104; k < 142; k += 4) pr(c, ...RW, k, k + 2, 44, 49, '#4a5058');
    pr(c, ...RW, 96, 148, 39, 40, '#2a2e36');
    // brass PASS sign above the pass, under the hood
    pr(c, ...RW, 108, 136, 32, 46, '#3a3220'); pr(c, ...RW, 109, 135, 33, 45, '#caa24a'); pr(c, ...RW, 109, 135, 44, 45, '#f0d98a'); pr(c, ...RW, 109, 135, 33, 34, '#8f6f22');
    'PASS'.split('').forEach((ch, n) => GLYPH[ch].forEach((row, j) => { for (let i = 0; i < 3; i++) if (row[i] === '#') pr(c, ...RW, 114 + n * 5 + i, 115 + n * 5 + i, 36 + (4 - j), 37 + (4 - j), '#3a2a0b'); }));
    // hanging pans on the left wall (where the office had a poster and a whiteboard)
    const pan = (P, ca, cv, rx, rv, col, hi, dk) => {
      for (const [r2x, r2v, cl] of [[rx + 1, rv + 1, dk], [rx, rv, col]]) {
        for (let da = -r2x; da <= r2x; da++) {
          const hh = Math.round(r2v * Math.sqrt(Math.max(0, 1 - (da * da) / (r2x * r2x))));
          pr(c, P[0], P[1], P[2], ca + da, ca + da + 1, cv - hh, cv + hh + 1, cl);
        }
      }
      pr(c, P[0], P[1], P[2], ca - 1, ca + 2, cv + rv, cv + rv + 3, dk);
      pr(c, P[0], P[1], P[2], ca - 2, ca + 1, cv - 2, cv, hi);
    };
    pr(c, ...LW, 124, 188, 34, 36, '#4a5058');
    pan(LW, 138, 28, 7, 6, '#c87838', '#f0b070', '#8a4a18');
    pan(LW, 156, 30, 6, 5, '#c8ccd4', '#eef1f5', '#6a7078');
    pan(LW, 172, 27, 8, 6, '#b84830', '#e07050', '#7a2818');
    // clock stays: kitchens watch the clock
    const clock = (P, ca, cv, rx, rv) => {
      for (const [r2x, r2v, col] of [[rx + 1, rv + 1, '#3a4048'], [rx, rv, '#f5f5f0']]) {
        for (let da = -r2x; da <= r2x; da++) {
          const hh = Math.round(r2v * Math.sqrt(Math.max(0, 1 - (da * da) / (r2x * r2x))));
          pr(c, P[0], P[1], P[2], ca + da, ca + da + 1, cv - hh, cv + hh + 1, col);
        }
      }
      pr(c, P[0], P[1], P[2], ca, ca + 1, cv, cv + 6, '#222'); pr(c, P[0], P[1], P[2], ca, ca + 5, cv, cv + 1, '#222'); pr(c, P[0], P[1], P[2], ca, ca + 1, cv, cv + 1, '#e5484d');
      for (const [da, dv] of [[0, 7], [0, -7], [6, 0], [-6, 0]]) pr(c, P[0], P[1], P[2], ca + da, ca + da + 1, cv + dv, cv + dv + 1, '#8a93b0');
    };
    clock(LW, 108, 36, 7, 8);
    // shelf + jars + STAFF sign above the fridge / break counter (right wall)
    pr(c, ...RW, 162, 190, 34, 37, '#6a7078'); pr(c, ...RW, 162, 190, 36, 37, '#c8ccd4');
    pr(c, ...RW, 164, 169, 37, 44, '#c84830'); pr(c, ...RW, 166, 168, 42, 44, '#e8e0c8');
    pr(c, ...RW, 172, 177, 37, 44, '#3e8a4a'); pr(c, ...RW, 174, 176, 42, 44, '#e8e0c8');
    pr(c, ...RW, 180, 185, 37, 44, '#c8a038'); pr(c, ...RW, 186, 189, 37, 42, '#d84840');
    pr(c, ...RW, 158, 192, 45, 55, '#3a3220'); pr(c, ...RW, 159, 191, 46, 54, '#f5c542');
    'STAFF'.split('').forEach((ch, n) => GLYPH[ch].forEach((row, j) => { for (let i = 0; i < 3; i++) if (row[i] === '#') pr(c, ...RW, 164 + n * 5 + i, 165 + n * 5 + i, 47 + (4 - j), 48 + (4 - j), '#7a5236'); }));

    // walk-in fridge (left half of the old cafe counter) + staff-break counter with a coffee urn (right half)
    box(c, 10, 0, 11.05, 1, 0, 36, { top: '#c8ccd4', se: '#5a6068', sw: '#7a8088', hi: '#e8ecf0', dk: '#3a4048' });
    const fp = [sx(10, 1), sy(10, 1, 0)];
    pr(c, fp[0], fp[1], 1, 2, 15, 4, 32, '#4a5058');
    pr(c, fp[0], fp[1], 1, 3, 14, 16, 28, '#8ec9ff'); pr(c, fp[0], fp[1], 1, 5, 9, 20, 22, '#fff');
    pr(c, fp[0], fp[1], 1, 13, 15, 16, 22, '#f5c542');
    pr(c, fp[0], fp[1], 1, 4, 6, 30, 32, '#5ff2a5');
    box(c, 11.05, 0, 12, 1, 0, 14, { top: '#d2d6dc', se: '#6e7480', sw: '#8a909a', hi: '#eef1f5', dk: '#4a5058' });
    const cp = [sx(11.05, 1), sy(11.05, 1, 0)];
    pr(c, cp[0], cp[1], 1, 0, 16, 0, 2, '#4a5058');
    pr(c, cp[0], cp[1], 1, 2, 14, 3, 11, '#6a7078');
    // coffee urn (staff still wander here for a cup)
    box(c, 11.15, 0.15, 11.7, 0.7, 14, 30, { top: '#555c70', se: '#2a2e3b', sw: '#3a3f4f', hi: '#6a7188' });
    const mp = [sx(11.15, 0.7), sy(11.15, 0.7, 0)];
    pr(c, mp[0], mp[1], 1, 1, 7, 24, 28, '#242833'); pr(c, mp[0], mp[1], 1, 2, 3, 25, 27, '#ff5a5a'); pr(c, mp[0], mp[1], 1, 5, 6, 25, 27, '#5ff2a5');
    pr(c, mp[0], mp[1], 1, 3, 5, 16, 20, '#f5f5f0'); pr(c, mp[0], mp[1], 1, 3, 5, 18, 20, '#5b3a1e');
    box(c, 11.75, 0.25, 11.95, 0.5, 14, 18, { top: '#ff8b8f', se: '#a8262c', sw: '#e5484d' });
    box(c, 11.75, 0.58, 11.95, 0.82, 14, 18, { top: '#8fb8ff', se: '#2a5fb8', sw: '#3e8ef7' });
    return bg;
  }

  // ---------- furniture ----------
  /** heat / flame colour for a station's state (null = cold, empty station) */
  function screenGlow(state, t, ph) {
    switch (state) {
      case 'working': { const k = Math.floor(t * 8 + ph * 5); return { col: k % 3 ? '#ff8a3a' : '#ffd84a', a: k % 2 ? 0.55 : 0.9 }; }
      case 'thinking': return { col: '#ffb04a', a: 0.4 + 0.22 * Math.sin(t * 3 + ph * 6) };
      case 'done': return { col: '#6be39b', a: 0.7 };
      case 'error': return { col: Math.floor(t * 4) % 2 ? '#ff5a5a' : '#b0303c', a: 0.8 };
      case 'off': return null;
      default: return { col: '#8a9098', a: 0.18 };
    }
  }

  const STEEL = { top: '#d2d6dc', se: '#6e7480', sw: '#8a909a', hi: '#eef1f5', dk: '#4a5058' };

  function steamAt(c, x, y, z, t, ph, n) {
    const p = A(x, y, z);
    for (let i = 0; i < n; i++) {
      const q = (t * 7 + i * 3 + ph * 4) % 10;
      c.globalAlpha = 0.55 * (1 - q / 10);
      R(c, p[0] - 1 + i + Math.sin(t * 2 + i) * 1, p[1] - 3 - q, 2, 2, '#fff');
    }
    c.globalAlpha = 1;
  }

  /** small stock pot on the counter; boil = seconds since the cook's run failed: the lid rattles and foam runs down the sides */
  function stockPot(c, x, y, boil, t) {
    const r = 0.14, hz = DESKZ + 7, up = boil != null && Math.floor(t * 9) % 2 ? 2 : 0;
    box(c, x - r, y - r, x + r, y + r, DESKZ, hz, { top: '#3a2a20', se: '#8a4a18', sw: '#c07028', hi: '#f0b060' });
    if (boil != null) {
      const p = A(x, y, hz), k = Math.min(7, Math.round(boil * 5));
      disc(c, p[0], p[1] - 1, 5, '#f4f1e8'); disc(c, p[0] - 1, p[1] - 3, 3, '#fff');
      R(c, p[0] + 2, p[1] + 1, 2, 2 + k, '#f4f1e8'); R(c, p[0] - 3, p[1] + 2, 2, k, '#f4f1e8'); R(c, p[0] - 6, p[1], 1, 1 + (k >> 1), '#f4f1e8');   // foam running down the near faces
      steamAt(c, x, y, hz + 4, t, 0, 3);
    }
    box(c, x - r + 0.02, y - r + 0.02, x + r - 0.02, y + r - 0.02, hz + 1 + up, hz + 2 + up, { top: '#c8ccd4', se: '#5a6068', sw: '#8a9098', hi: '#e8ecf0' });
  }
  /** flames licking up from a heat set: a shell command failed */
  function stoveFire(c, x, y, z, t) {
    const p = A(x, y, z), f = Math.floor(t * 12);
    for (let i = 0; i < 4; i++) {
      const h = 3 + ((f + i * 3) % 3) + (i === 1 || i === 2 ? 2 : 0), fx = p[0] - 4 + i * 2;
      R(c, fx, p[1] - h, 2, h, i % 2 ? '#ff8a3a' : '#e5484d'); R(c, fx, p[1] - Math.ceil(h / 2), 2, Math.ceil(h / 2), '#ffd84a');
    }
  }
  const FIRE_AT = { fryer: [0.57, 1.0, 7], oven: [0.7, 1.0, 18], grill: [0.56, 1.0, 4], stove: [0.68, 1.28, 6] };   // burner spot on each heat set: x, y, height over the counter

  function drawSink(c, s, st, t, ph) {
    const { dx, dy } = s;
    // basin set into the counter, chrome faucet at the far rim, plate stacks at either end
    box(c, dx + 0.14, dy + 0.42, dx + 0.86, dy + 1.58, DESKZ - 3, DESKZ, { top: '#8a9098', se: '#4a5058', sw: '#6a7078', hi: '#c8ccd4' });
    poly(c, [A(dx + 0.22, dy + 0.52, DESKZ - 2), A(dx + 0.78, dy + 0.52, DESKZ - 2), A(dx + 0.78, dy + 1.48, DESKZ - 2), A(dx + 0.22, dy + 1.48, DESKZ - 2)], st === 'working' ? '#4a7a8a' : '#3a5868');
    const rip = A(dx + 0.5, dy + 1.0, DESKZ - 2);
    R(c, rip[0] - 4, rip[1], 8, 1, 'rgba(220,240,255,.35)');
    box(c, dx + 0.68, dy + 0.9, dx + 0.86, dy + 1.1, DESKZ, DESKZ + 11, { top: '#c8ccd4', se: '#5a6068', sw: '#9aa0a8', hi: '#e8ecf0' });
    box(c, dx + 0.38, dy + 0.92, dx + 0.86, dy + 1.08, DESKZ + 11, DESKZ + 13, { top: '#d8dce2', se: '#5a6068', sw: '#a8acb4', hi: '#f0f2f6' });
    const sp = A(dx + 0.46, dy + 1.0, DESKZ + 11);
    R(c, sp[0], sp[1], 1, 6, '#c8ccd4');
    if (st === 'working') { R(c, sp[0], sp[1] + 6, 1, 3, '#8ab0c8'); R(c, sp[0] - 1, sp[1] + 8, 3, 1, 'rgba(180,210,230,.7)'); }
    // dirty stack (near -y), drying rack (+y)
    box(c, dx + 0.16, dy + 0.12, dx + 0.5, dy + 0.36, DESKZ, DESKZ + 2, { top: '#e8dcc8', se: '#a09078', sw: '#c8bca8' });
    box(c, dx + 0.18, dy + 0.14, dx + 0.48, dy + 0.34, DESKZ + 2, DESKZ + 3, { top: '#f0eee8', se: '#a09078', sw: '#d8d4cc' });
    box(c, dx + 0.2, dy + 0.16, dx + 0.46, dy + 0.32, DESKZ + 3, DESKZ + 4, { top: '#d8c8a8', se: '#907860', sw: '#c0b090' });
    box(c, dx + 0.18, dy + 1.64, dx + 0.72, dy + 1.88, DESKZ, DESKZ + 1, { top: '#8a9098', se: '#4a5058', sw: '#6a7078' });
    for (const oy of [1.68, 1.78]) {
      const a = A(dx + 0.22, dy + oy, DESKZ + 1), b = A(dx + 0.68, dy + oy, DESKZ + 1);
      line(c, a[0], a[1], b[0], b[1], '#c8ccd4', 1);
    }
    const clean = A(dx + 0.42, dy + 1.74, DESKZ + 2);
    disc(c, clean[0], clean[1], 3, '#f0eee8'); disc(c, clean[0], clean[1], 2, '#fff');
    if (st === 'working') {
      for (let i = 0; i < 5; i++) {
        const q = (t * 6 + i * 2.2 + ph * 3) % 9;
        const bp = A(dx + 0.3 + (i % 3) * 0.16, dy + 0.7 + (i % 2) * 0.28, DESKZ - 1 + q);
        c.globalAlpha = 0.75 * (1 - q / 9);
        disc(c, bp[0], bp[1], 1 + (i % 2), '#e8f4fc');
        c.globalAlpha = 0.5 * (1 - q / 9);
        disc(c, bp[0] - 1, bp[1] - 1, 1, '#fff');
      }
      c.globalAlpha = 1;
    }
  }

  function drawFryer(c, s, st, t, ph) {
    const { dx, dy } = s;
    box(c, dx + 0.18, dy + 0.38, dx + 0.96, dy + 1.62, DESKZ, DESKZ + 6, { top: '#3a3230', se: '#1a1614', sw: '#2a2422', hi: '#6a5a48' });
    box(c, dx + 0.26, dy + 0.5, dx + 0.88, dy + 1.5, DESKZ + 6, DESKZ + 7, { top: '#2a1e10', se: '#1a1208', sw: '#3a2a18' });
    poly(c, [A(dx + 0.3, dy + 0.56, DESKZ + 6), A(dx + 0.84, dy + 0.56, DESKZ + 6), A(dx + 0.84, dy + 1.44, DESKZ + 6), A(dx + 0.3, dy + 1.44, DESKZ + 6)], st === 'working' ? '#d48828' : '#b07020');
    const oil = A(dx + 0.57, dy + 1.0, DESKZ + 6);
    R(c, oil[0] - 3, oil[1], 7, 1, 'rgba(255,220,120,.4)');
    const dip = st === 'working' ? 0.55 + 0.45 * Math.sin(t * 2.2 + ph * 3) : 0.15;
    const bz = DESKZ + 6 + Math.round(dip * 8);
    box(c, dx + 0.34, dy + 0.62, dx + 0.8, dy + 1.38, DESKZ + 6, bz, { top: '#c8ccd4', se: '#4a5058', sw: '#8a9098' });
    // mesh
    for (let i = 0; i < 3; i++) {
      const a = A(dx + 0.38, dy + 0.72 + i * 0.2, bz), b = A(dx + 0.76, dy + 0.72 + i * 0.2, bz);
      line(c, a[0], a[1], b[0], b[1], '#6a7078', 1);
    }
    const hdl = A(dx + 0.22, dy + 1.0, bz);
    R(c, hdl[0] - 4, hdl[1], 5, 2, '#8a9098'); R(c, hdl[0] - 5, hdl[1] - 1, 2, 3, '#5b3a1e');
    if (st === 'working') {
      for (let i = 0; i < 6; i++) {
        const q = (t * 14 + i * 1.7 + ph * 5) % 6;
        c.globalAlpha = 0.7 * (1 - q / 6);
        const sp = A(dx + 0.36 + (i % 4) * 0.12, dy + 0.66 + ((i * 3) % 5) * 0.12, DESKZ + 6 + q);
        R(c, sp[0], sp[1], 1, 1, i % 2 ? '#fff4c8' : '#ffd84a');
      }
      c.globalAlpha = 1;
      steamAt(c, dx + 0.6, dy + 0.95, bz + 1, t, ph, 3);
    }
  }

  function drawOven(c, s, st, t, ph) {
    const { dx, dy } = s;
    box(c, dx + 0.42, dy + 0.28, dx + 0.98, dy + 1.72, 0, DESKZ + 18, { top: '#3a3e46', se: '#1a1e24', sw: '#2a2e36', hi: '#6a7078', dk: '#12141a' });
    // window
    const glow = st === 'working' ? (Math.floor(t * 8 + ph * 3) % 2 ? '#ff8a3a' : '#ffd84a') : (st === 'thinking' ? '#c06030' : '#2a2018');
    poly(c, [A(dx + 0.5, dy + 0.48, DESKZ + 4), A(dx + 0.9, dy + 0.48, DESKZ + 4), A(dx + 0.9, dy + 1.5, DESKZ + 4), A(dx + 0.5, dy + 1.5, DESKZ + 4)], glow);
    if (st === 'working') {
      c.globalAlpha = 0.4;
      poly(c, [A(dx + 0.48, dy + 0.44, DESKZ + 3), A(dx + 0.92, dy + 0.44, DESKZ + 3), A(dx + 0.92, dy + 1.54, DESKZ + 3), A(dx + 0.48, dy + 1.54, DESKZ + 3)], '#ffb04a');
      c.globalAlpha = 1;
    }
    // door handle
    box(c, dx + 0.46, dy + 0.34, dx + 0.54, dy + 1.66, DESKZ + 8, DESKZ + 10, { top: '#c8ccd4', se: '#4a5058', sw: '#8a9098' });
    const kn = A(dx + 0.5, dy + 1.0, DESKZ + 10);
    R(c, kn[0], kn[1] - 3, 2, 6, '#e8ecf0');
    // sheet tray, slides in and out when baking
    const slide = st === 'working' ? 0.08 + 0.28 * (0.5 + 0.5 * Math.sin(t * 1.8 + ph * 2)) : 0.06;
    box(c, dx + 0.08 + slide, dy + 0.62, dx + 0.52 + slide, dy + 1.38, DESKZ, DESKZ + 1, { top: '#8a9098', se: '#3a4048', sw: '#6a7078', hi: '#c8ccd4' });
    poly(c, [A(dx + 0.14 + slide, dy + 0.72, DESKZ + 1), A(dx + 0.46 + slide, dy + 0.72, DESKZ + 1), A(dx + 0.46 + slide, dy + 1.28, DESKZ + 1), A(dx + 0.14 + slide, dy + 1.28, DESKZ + 1)], st === 'working' ? '#e8c878' : '#d8c8a0');
    if (st === 'working') steamAt(c, dx + 0.32 + slide, dy + 0.95, DESKZ + 2, t, ph, 2);
  }

  function drawGrill(c, s, st, t, ph) {
    const { dx, dy } = s;
    box(c, dx + 0.16, dy + 0.32, dx + 0.96, dy + 1.68, DESKZ, DESKZ + 4, { top: '#2a2420', se: '#12100e', sw: '#3a322c', hi: '#5a5048' });
    poly(c, [A(dx + 0.22, dy + 0.4, DESKZ + 4), A(dx + 0.9, dy + 0.4, DESKZ + 4), A(dx + 0.9, dy + 1.6, DESKZ + 4), A(dx + 0.22, dy + 1.6, DESKZ + 4)], st === 'working' ? '#3a2a20' : '#2a221c');
    for (let i = 0; i < 5; i++) {
      const a = A(dx + 0.24, dy + 0.5 + i * 0.22, DESKZ + 4), b = A(dx + 0.88, dy + 0.5 + i * 0.22, DESKZ + 4);
      line(c, a[0], a[1], b[0], b[1], '#1a1410', 1);
    }
    const flip = st === 'working' && Math.sin(t * 3 + ph * 4) > 0.2;
    const fy = flip ? 0.85 : 0.7, fz = DESKZ + 4 + (flip ? 6 : 0);
    // two portions on the iron (one lifts when flipping)
    const p1 = A(dx + 0.48, dy + 0.7, DESKZ + 4);
    disc(c, p1[0], p1[1], 3, '#6a3020'); disc(c, p1[0], p1[1] - 1, 2, '#8a4030');
    const p2 = A(dx + 0.55, dy + fy + 0.4, fz);
    disc(c, p2[0], p2[1], 3, '#5a2818'); disc(c, p2[0], p2[1] - 1, 2, flip ? '#c06030' : '#7a3828');
    if (st === 'working') {
      for (let i = 0; i < 4; i++) {
        const q = (t * 11 + i * 2 + ph * 5) % 7;
        c.globalAlpha = 0.65 * (1 - q / 7);
        const fp = A(dx + 0.3 + (i % 3) * 0.2, dy + 0.55 + (i % 2) * 0.4, DESKZ + 4 + q);
        R(c, fp[0], fp[1], 1, 2 + (i % 2), i % 2 ? '#ff8a3a' : '#ffd84a');
      }
      c.globalAlpha = 1;
      steamAt(c, dx + 0.55, dy + 1.0, DESKZ + 5, t, ph, 2);
    }
  }

  function drawStove(c, s, state, t, ph) {
    const { dx, dy } = s, g = screenGlow(state, t, ph);
    box(c, dx + 0.48, dy + 0.38, dx + 0.98, dy + 1.62, DESKZ, DESKZ + 3, { top: '#2a2e36', se: '#1a1e24', sw: '#3a4048', hi: '#5a6068' });
    const b1 = A(dx + 0.68, dy + 0.7, DESKZ + 3), b2 = A(dx + 0.68, dy + 1.28, DESKZ + 3);
    disc(c, b1[0], b1[1], 3, '#1a1e24'); disc(c, b2[0], b2[1], 3, '#1a1e24');
    if (g && state === 'working') {
      const flick = Math.floor(t * 12 + ph * 5) % 2;
      disc(c, b1[0], b1[1], 2 + flick, g.col); disc(c, b2[0], b2[1], 1 + flick, '#ffd84a');
    } else if (g) {
      disc(c, b1[0], b1[1], 1, g.col);
    }
    const pot = { top: '#d4883a', se: '#8a4a18', sw: '#c07028', hi: '#f0b060' };
    const pot2 = { top: '#c8ccd4', se: '#5a6068', sw: '#8a9098', hi: '#e8ecf0' };
    box(c, dx + 0.56, dy + 0.56, dx + 0.86, dy + 0.88, DESKZ + 3, DESKZ + 8, pot);
    box(c, dx + 0.58, dy + 1.14, dx + 0.84, dy + 1.42, DESKZ + 3, DESKZ + 6, pot2);
    const lid = A(dx + 0.71, dy + 0.72, DESKZ + 8);
    R(c, lid[0] - 1, lid[1] - 2, 3, 2, pot.hi);
    if (g && (state === 'working' || state === 'thinking')) steamAt(c, dx + 0.71, dy + 0.72, DESKZ + 8, t, ph, 3);
  }

  function drawPrep(c, s, st, t, ph) {
    const { dx, dy } = s;
    poly(c, [A(dx + 0.1, dy + 0.45, DESKZ), A(dx + 0.72, dy + 0.45, DESKZ), A(dx + 0.72, dy + 1.55, DESKZ), A(dx + 0.1, dy + 1.55, DESKZ)], '#d2a06a');
    const k1 = A(dx + 0.72, dy + 0.45, DESKZ), k2 = A(dx + 0.72, dy + 1.55, DESKZ), k3 = A(dx + 0.1, dy + 1.55, DESKZ);
    line(c, k1[0], k1[1], k2[0], k2[1], '#a87840', 1); line(c, k2[0], k2[1], k3[0], k3[1], '#a87840', 1);
    // vegetables
    const v1 = A(dx + 0.32, dy + 0.7, DESKZ), v2 = A(dx + 0.48, dy + 1.05, DESKZ), v3 = A(dx + 0.28, dy + 1.28, DESKZ);
    disc(c, v1[0], v1[1], 2, '#3e8a38'); disc(c, v1[0] - 1, v1[1] - 1, 1, '#6aba50');
    disc(c, v2[0], v2[1], 2, '#c84830'); disc(c, v2[0] - 1, v2[1] - 1, 1, '#e07050');
    R(c, v3[0] - 2, v3[1], 4, 2, '#e8c878'); R(c, v3[0] - 1, v3[1], 2, 1, '#d4a04a');
    if (st !== 'working') {
      const kn = A(dx + 0.28, dy + 0.95, DESKZ);
      R(c, kn[0] - 1, kn[1], 6, 1, '#c8ccd4'); R(c, kn[0] - 3, kn[1], 2, 1, '#5b3a1e');
    } else {
      // flying bits
      for (let i = 0; i < 3; i++) {
        const q = (t * 9 + i * 2 + ph * 4) % 6;
        c.globalAlpha = 0.8 * (1 - q / 6);
        const bp = A(dx + 0.34 + i * 0.1, dy + 0.9, DESKZ + q);
        R(c, bp[0], bp[1], 1, 1, i % 2 ? '#3e8a38' : '#c84830');
      }
      c.globalAlpha = 1;
      const kn = A(dx + 0.36, dy + 1.0, DESKZ + Math.abs(Math.sin(t * 10 + ph * 3)) * 5);
      R(c, kn[0] - 1, kn[1], 1, 5, '#c8ccd4'); R(c, kn[0] - 1, kn[1] + 5, 2, 2, '#5b3a1e');
    }
    // bowl at the near corner
    box(c, dx + 0.2, dy + 1.64, dx + 0.48, dy + 1.86, DESKZ, DESKZ + 3, { top: '#f0eee8', se: '#9aa0b4', sw: '#d0d4dc' });
    const bw = A(dx + 0.34, dy + 1.75, DESKZ + 3);
    disc(c, bw[0], bw[1], 3, '#e8e0d0'); disc(c, bw[0], bw[1], 2, '#c84830');
  }

  const DRAW_SET = { sink: drawSink, fryer: drawFryer, oven: drawOven, grill: drawGrill, stove: drawStove, prep: drawPrep };

  function drawDesk(c, s, ag, t, fire) {
    if (s.mgr) return drawMgrDesk(c, s, ag, t);
    const { dx, dy } = s, span = deskSpan(s), x0 = span.x0, x1 = span.x1, y0 = span.y0, y1 = span.y1;
    const st = ag ? (ag.away ? 'idle' : ag.state) : 'off', ph = ag ? ag.phase : 0, g = screenGlow(st, t, ph);
    const set = SETS[s.i];
    box(c, x0, y0, x1, y1, 0, DESKZ, STEEL);
    if (s.col === 2) {
      const p = [sx(x0, y1), sy(x0, y1, 0)];
      pr(c, p[0], p[1], 1, 0, 16, 0, 2, '#3a4048'); pr(c, p[0], p[1], 1, 0, 16, 11, 13, '#b8bcc4');
      for (const [v0, v1] of [[2, 6], [6, 10]]) { pr(c, p[0], p[1], 1, 2, 14, v0, v1, '#6a7078'); pr(c, p[0], p[1], 1, 3, 13, v0 + 1, v1, '#8a9098'); pr(c, p[0], p[1], 1, 7, 9, v0 + 2, v0 + 3, '#c8ccd4'); }
    }
    if (s.col === 0) {
      const q = [sx(x1, y0), sy(x1, y0, 0)];
      pr(c, q[0], q[1], -1, 0, 32, 0, 2, '#3a4048'); pr(c, q[0], q[1], -1, 0, 32, 11, 13, '#a8acb4');
      pr(c, q[0], q[1], -1, 15, 17, 2, 10, '#5a6068');
      if (ag) { pr(c, q[0], q[1], -1, 21, 29, 5, 8, ag.look.shirt); pr(c, q[0], q[1], -1, 21, 29, 7, 8, shade(ag.look.shirt, 35)); }
    }
    if (g && HEAT[set]) { c.globalAlpha = Math.min(0.28, g.a * 0.24); poly(c, [A(dx + 0.05, dy + 0.4, DESKZ), A(dx + 0.95, dy + 0.4, DESKZ), A(dx + 0.95, dy + 1.6, DESKZ), A(dx + 0.05, dy + 1.6, DESKZ)], g.col); c.globalAlpha = 1; }
    (DRAW_SET[set] || drawPrep)(c, s, st, t, ph);
    stockPot(c, dx + 0.86, dy + 1.86, ag && ag.boil, t);
    if (fire) stoveFire(c, dx + FIRE_AT[set][0], dy + FIRE_AT[set][1], DESKZ + FIRE_AT[set][2], t);
  }

  /** the pass: stainless counter, ticket rail, service bell, plates and a heat lamp. Chef stands in front. */
  function drawMgrDesk(c, s, ag, t) {
    const st = ag ? (ag.away ? 'idle' : ag.state) : 'off', ph = ag ? ag.phase : 0, g = screenGlow(st, t, ph);
    box(c, MD.x0, MD.y0, MD.x1, MD.y1, 0, DESKZ, { top: '#d2d6dc', se: '#5a6068', sw: '#7a8088', hi: '#eef1f5', dk: '#3a4048' });
    const L = Math.round((MD.x1 - MD.x0) * 16), p = [sx(MD.x0, MD.y1), sy(MD.x0, MD.y1, 0)];
    pr(c, p[0], p[1], 1, 0, L, 0, 2, '#2a2e36'); pr(c, p[0], p[1], 1, 0, L, 11, 13, '#c8ccd4'); pr(c, p[0], p[1], 1, 0, L, 10, 11, '#4a5058');
    pr(c, p[0], p[1], 1, 15, L - 15, 2, 10, '#5a6068'); pr(c, p[0], p[1], 1, 17, L - 17, 3, 9, '#7a8088');
    for (const k0 of [1, L - 15]) for (const [v0, v1] of [[2, 6], [6, 10]]) { pr(c, p[0], p[1], 1, k0, k0 + 14, v0, v1, '#6a7078'); pr(c, p[0], p[1], 1, k0 + 1, k0 + 13, v0 + 1, v1, '#8a9098'); pr(c, p[0], p[1], 1, k0 + 6, k0 + 8, v0 + 2, v0 + 3, '#d2d6dc'); }
    const q = [sx(MD.x1, MD.y0), sy(MD.x1, MD.y0, 0)];
    pr(c, q[0], q[1], -1, 0, 16, 0, 2, '#2a2e36'); pr(c, q[0], q[1], -1, 0, 16, 11, 13, '#b0b4bc'); pr(c, q[0], q[1], -1, 3, 13, 3, 10, '#6a7078');
    const bl = (x0, y0, x1, y1, col) => poly(c, [A(x0, y0, DESKZ), A(x1, y0, DESKZ), A(x1, y1, DESKZ), A(x0, y1, DESKZ)], col);
    bl(7.9, 0.56, 8.96, 0.98, '#c8b080'); bl(7.92, 0.58, 8.94, 0.96, '#e8d8b0');
    if (g) { c.globalAlpha = Math.min(0.35, g.a * 0.3); bl(7.92, 0.58, 8.94, 0.96, g.col); c.globalAlpha = 1; }
    const pl = A(8.4, 0.77, DESKZ);
    disc(c, pl[0], pl[1], 4, '#f0eee8'); disc(c, pl[0], pl[1], 3, '#fff'); disc(c, pl[0], pl[1], 1, st === 'working' ? '#c84830' : '#d8d0c0');
    box(c, 7.4, 0.08, 8.95, 0.2, DESKZ, DESKZ + 2, { top: '#3a4048', se: '#1a1e24', sw: '#2a2e36' });
    box(c, 7.95, 0.48, 8.9, 0.58, DESKZ + 14, DESKZ + 16, { top: '#3a4048', se: '#1a1e24', sw: '#2a2e36' });
    const hl = A(8.4, 0.53, DESKZ + 14);
    R(c, hl[0] - 6, hl[1], 13, 1, g && st !== 'off' ? g.col : '#5a4030');
    if (g && st === 'working') { c.globalAlpha = 0.35 * g.a; bl(7.95, 0.5, 8.9, 0.98, g.col); c.globalAlpha = 1; }
    box(c, 6.2, 0.12, 6.55, 0.48, DESKZ, DESKZ + 2, { top: '#f0eee8', se: '#b0aca4', sw: '#d8d4cc' });
    box(c, 6.22, 0.14, 6.53, 0.46, DESKZ + 2, DESKZ + 3, { top: '#fff', se: '#b0aca4', sw: '#e8e4dc' });
    box(c, 6.23, 0.16, 6.52, 0.44, DESKZ + 3, DESKZ + 4, { top: '#f0eee8', se: '#b0aca4', sw: '#d8d4cc' });
    box(c, 6.65, 0.55, 6.95, 0.82, DESKZ, DESKZ + 1, { top: '#8a9098', se: '#4a5058', sw: '#6a7078' });
    const bell = A(6.8, 0.68, DESKZ + 1);
    disc(c, bell[0], bell[1] - 3, 4, '#e0c868'); disc(c, bell[0], bell[1] - 4, 3, '#f0d98a');
    R(c, bell[0] - 1, bell[1] - 8, 2, 2, '#caa24a'); R(c, bell[0], bell[1] - 9, 1, 2, '#f0d98a');
    box(c, 6.2, 0.58, 6.36, 0.74, DESKZ, DESKZ + 6, { top: '#3e6a38', se: '#1e3a1c', sw: '#2e5a28', hi: '#6a9a50' });
    const nk = A(6.28, 0.66, DESKZ + 6); R(c, nk[0], nk[1] - 2, 1, 2, '#c8ccd4');
    box(c, 7.15, 0.78, 7.4, 0.95, DESKZ, DESKZ + 3, { top: '#f0eee8', se: '#b0aca4', sw: '#d8d4cc' });
    stockPot(c, 7.62, 0.52, ag && ag.boil, t);
  }

  // ---------- characters ----------
  const spr = mk(80, 80), sc = spr.getContext('2d'), flp = mk(80, 80), fc = flp.getContext('2d'), sil = mk(80, 80), silc = sil.getContext('2d');
  const ORX = 40, ORY = 64;
  const armCol = (look) => '#d8d4c8';  // chef-coat sleeves; apron colour comes from look.shirt

  /** two-bone arm from shoulder to hand (elbow solved so it bends downwards / outwards) */
  function limb(c, s0x, s0y, hx, hy, look, side, far) {
    const L = 7.5; let dx = hx - s0x, dy = hy - s0y, d = Math.hypot(dx, dy) || 0.01;
    if (d > 2 * L - 0.6) { const k = (2 * L - 0.6) / d; hx = s0x + dx * k; hy = s0y + dy * k; dx = hx - s0x; dy = hy - s0y; d = Math.hypot(dx, dy); }
    const mx = (s0x + hx) / 2, my = (s0y + hy) / 2, h = Math.sqrt(Math.max(0, L * L - (d / 2) * (d / 2)));
    let best = null;
    for (const sg of [1, -1]) {
      const nx = (-dy / d) * sg, ny = (dx / d) * sg, score = ny + 0.7 * side * nx;
      if (!best || score > best.score) best = { nx, ny, score };
    }
    const ex = mx + best.nx * h, ey = my + best.ny * h, col = far ? '#b8b4a8' : armCol(look);
    line(c, s0x, s0y, ex, ey, col, 2); line(c, ex, ey, hx, hy, col, 2);
    R(c, Math.round(hx) - 1, Math.round(hy) - 1, 2, 2, look.skin);
  }

  function head(c, look, hy, front, o) {
    o = o || {};
    const skin = look.skin, dark = shade(skin, -38), hair = look.hair, hairD = shade(hair, -28), hairL = shade(hair, 34), st = look.hairStyle;
    const mood = o.mood || 'normal', lk = o.lk || 0;
    if (front) {
      if (st === 'long') R(c, -6, hy + 1, 7, 12, hairD);
      R(c, -4, hy, 9, 9, skin); R(c, 5, hy + 5, 1, 1, skin); R(c, -3, hy + 8, 7, 1, shade(skin, -14));
      const E = '#222';
      if (mood === 'yawn') { R(c, 0, hy + 5, 2, 1, E); R(c, 3, hy + 5, 2, 1, E); R(c, 1, hy + 6, 3, 3, '#5a1a1a'); R(c, 2, hy + 8, 1, 1, '#c0544a'); }
      else if (mood === 'read') { R(c, 0, hy + 5, 1, 1, E); R(c, 3, hy + 5, 1, 1, E); R(c, 0, hy + 4, 1, 1, dark); R(c, 3, hy + 4, 1, 1, dark); R(c, 1, hy + 7, 2, 1, '#8a4a3a'); }
      else if (mood === 'happy') { R(c, 0, hy + 4, 2, 1, E); R(c, 0, hy + 5, 1, 1, E); R(c, 3, hy + 4, 2, 1, E); R(c, 4, hy + 5, 1, 1, E); R(c, 1, hy + 7, 3, 1, '#7a2a2a'); R(c, 0, hy + 6, 1, 1, '#7a2a2a'); R(c, 4, hy + 6, 1, 1, '#7a2a2a'); }
      else if (mood === 'up') { R(c, 0, hy + 3, 1, 2, E); R(c, 3, hy + 3, 1, 2, E); R(c, 0, hy + 1, 2, 1, E); R(c, 3, hy + 1, 2, 1, E); R(c, 2, hy + 7, 1, 1, '#5a1a1a'); }
      else if (mood === 'worried') { R(c, 0, hy + 4, 1, 3, E); R(c, 3, hy + 4, 1, 3, E); R(c, 0, hy + 2, 2, 1, E); R(c, 3, hy + 2, 2, 1, E); R(c, 2, hy + 7, 2, 2, '#5a1a1a'); }
      else if (o.blink) { R(c, 0 + lk, hy + 5, 1, 1, E); R(c, 3 + lk, hy + 5, 1, 1, E); R(c, 1 + lk, hy + 7, 2, 1, '#8a4a3a'); }
      else { R(c, 0 + lk, hy + 4, 1, 2, E); R(c, 3 + lk, hy + 4, 1, 2, E); R(c, 1 + lk, hy + 7, 2, 1, '#8a4a3a'); }
      R(c, -1, hy + 6, 1, 1, '#e8907f');
      switch (st) {
        case 'long': R(c, -5, hy - 1, 11, 3, hair); R(c, -6, hy + 2, 3, 11, hair); R(c, 5, hy + 2, 1, 8, hair); R(c, -3, hy - 1, 4, 1, hairL); R(c, 1, hy + 2, 4, 1, hair); break;
        case 'spiky': R(c, -5, hy - 1, 11, 3, hair); R(c, -5, hy + 2, 3, 4, hair); R(c, -5, hy - 3, 2, 2, hair); R(c, -2, hy - 4, 2, 3, hair); R(c, 1, hy - 3, 2, 2, hair); R(c, 4, hy - 2, 2, 1, hair); R(c, -3, hy - 1, 3, 1, hairL); break;
        case 'bun': R(c, -5, hy - 1, 11, 3, hair); R(c, -5, hy + 2, 3, 5, hair); R(c, -5, hy - 4, 4, 3, hair); R(c, -4, hy - 4, 2, 1, hairL); R(c, 2, hy + 2, 3, 1, hair); break;
        case 'cap': R(c, -5, hy - 2, 11, 4, look.shirt); R(c, -4, hy - 2, 4, 1, shade(look.shirt, 40)); R(c, 3, hy + 1, 6, 2, shade(look.shirt, -35)); R(c, -5, hy + 2, 3, 5, hair); break;
        default: R(c, -5, hy - 1, 11, 3, hair); R(c, -5, hy + 2, 3, 6, hair); R(c, 4, hy + 2, 1, 2, hair); R(c, -3, hy - 1, 4, 1, hairL); R(c, 0, hy + 2, 4, 1, hair);
      }
      chefHat(c, hy, o.hat === 'toque');
    } else { // back of the head
      const bot = st === 'long' ? 13 : 9;
      R(c, -5, hy - 1, 11, bot + 1, hair); R(c, -3, hy, 3, 1, hairL); R(c, -5, hy + bot - 1, 11, 1, hairD);
      if (st === 'spiky') { R(c, -5, hy - 3, 2, 2, hair); R(c, -2, hy - 4, 2, 3, hair); R(c, 1, hy - 3, 2, 2, hair); R(c, 4, hy - 2, 2, 1, hair); }
      if (st === 'bun') { R(c, -2, hy - 4, 4, 3, hair); R(c, -1, hy - 4, 2, 1, hairL); }
      if (st === 'cap') { R(c, -5, hy - 2, 11, 5, look.shirt); R(c, -4, hy - 2, 4, 1, shade(look.shirt, 40)); R(c, -5, hy + 3, 11, 1, shade(look.shirt, -35)); }
      R(c, 5, hy + 4, 1, 2, skin);
      chefHat(c, hy, o.hat === 'toque');
    }
  }

  const shoes = '#222';
  function torso(c, look, top, h, front, pants) {
    const coat = '#f2efe6', coatD = '#d0ccc0', coatL = '#fffdf6';
    R(c, -4, top, 8, h, coat); R(c, 2, top, 2, h, coatD); R(c, -4, top + h - 1, 8, 1, coatD);
    R(c, -4, top, 8, 1, coatL);
    if (front) {
      R(c, -2, top + 2, 1, 1, '#c8c4b8'); R(c, -2, top + 5, 1, 1, '#c8c4b8');
      R(c, 1, top + 2, 1, 1, '#c8c4b8'); R(c, 1, top + 5, 1, 1, '#c8c4b8');
      R(c, -3, top + 4, 6, Math.max(2, h - 4), look.shirt);
      R(c, -3, top + 4, 6, 1, shade(look.shirt, 28));
      R(c, 0, top, 1, 4, look.shirt);
    } else {
      R(c, -2, top + 2, 4, 2, look.shirt);
    }
    if (front) R(c, -1, top - 1, 3, 2, look.skin); else R(c, -1, top - 1, 3, 1, shade(look.skin, -25));
  }
  function chefHat(c, hy, tall) {
    const hat = '#f4f1e8', hatD = '#c8c4b8', hatL = '#fffdf6';
    if (tall) {
      R(c, -6, hy - 2, 13, 4, hat); R(c, -6, hy - 2, 13, 1, hatL); R(c, -6, hy + 1, 13, 1, hatD);
      R(c, -7, hy - 13, 15, 11, hat); R(c, -6, hy - 14, 13, 2, hatL);
      R(c, -7, hy - 13, 1, 11, hatD); R(c, 7, hy - 13, 1, 11, hatD);
      for (let i = 0; i < 5; i++) R(c, -5 + i * 3, hy - 12, 1, 9, hatD);
    } else {
      R(c, -6, hy - 2, 13, 4, hat); R(c, -6, hy - 2, 13, 1, hatL);
      R(c, -5, hy - 6, 11, 4, hat); R(c, -4, hy - 7, 9, 2, hatL); R(c, 5, hy - 6, 1, 4, hatD);
    }
  }

  function drawSeated(c, ag, t, face) {
    const look = ag.look, st = ag.state, ph = ag.phase, act = ag.act, ap = ag.actP || 0, front = face < 2;
    let mood = st === 'error' ? 'worried' : st === 'done' ? 'happy' : 'normal', k = 0;
    if (act === 'stretch') { k = Math.min(ap / 0.5, 1) * (ap < 2.4 ? 1 : Math.max(0, (2.9 - ap) / 0.5)); if (k > 0.5) mood = 'yawn'; }
    if (act === 'read') mood = 'read';
    let by = 0;
    if (st === 'idle') by = Math.sin(t * 2.2 + ph * 6) >= 0 ? 1 : 0;
    else if (st === 'done') by = -Math.floor(Math.abs(Math.sin(t * 6)) * 2);
    else if (st === 'working') by = Math.floor(t * 6 + ph) % 4 === 0 ? 1 : 0;
    else if (st === 'thinking') by = Math.sin(t * 1.5 + ph * 6) >= 0.4 ? 1 : 0;
    if (act === 'stretch') by = -Math.round(k);
    if (act === 'read') by = 1;
    const blink = ((t * 1000 + ph * 3600) % 3600) < 140;
    // legs: thigh forward, shin down
    if (face === 0 || face === 1) { R(c, -3, -3, 10, 4, look.pants); R(c, 4, 0, 4, 9, look.pants); R(c, 4, 9, 6, 2, shoes); R(c, -3, -3, 10, 1, shade(look.pants, 18)); }
    else { R(c, -3, -4, 9, 3, look.pants); }
    torso(c, look, -11 + by, 11 - by, front, look.pants);
    if (ag.help) { // role lanyard + ID card (the person keeps their own look)
      const rc = roleCol(ag.help.role);
      if (front) { R(c, -2, -11 + by, 1, 4, rc); R(c, 2, -11 + by, 1, 4, rc); R(c, -1, -8 + by, 3, 1, rc); R(c, -1, -7 + by, 3, 3, '#fff'); R(c, -1, -7 + by, 3, 1, rc); }
      else R(c, -3, -11 + by, 7, 1, rc);
    }
    head(c, look, -22 + by, front, { blink, mood, lk: 0, hat: (ag.slot === MGR || ag.main) ? 'toque' : 'cap' });
    const S1 = [-4, -9 + by], S2 = [4, -9 + by];
    let N = [6, 1], Fh = [11, -1.5];                                  // hands on the cutting board
    if (ag.meet) { N = [5, -4]; Fh = [9, -5]; if (st === 'thinking') Fh = [3, -12 + by]; else if (st === 'working') { const f = Math.floor(t * 10 + ph * 3); Fh = [9 + (f % 3 === 1 ? 1 : 0), -5 - (f % 2)]; } }   // hands on the table
    else if (face === 3) {                                             // the head chef: back to us, hands forward on the pass
      N = [5, -4]; Fh = [9, -4.5];
      if (st === 'working') {
        const f = Math.floor(t * 8 + ph * 3), ring = ag.cook === 'bell' ? Math.floor(t * 3 + ph) % 3 === 0 : Math.floor(t * 0.7 + ph) % 6 === 0;
        N = ring ? [-8, -10] : [5 - (f % 3 === 0 ? 1 : 0), -4 - (f % 2)];
        Fh = [9 + (f % 3 === 1 ? 1 : 0), -4.5 - ((f + 1) % 2)];
      }
      else if (st === 'thinking') Fh = [3, -12 + by];
    }
    else if (face !== 0) { N = [-3, -1]; Fh = [5, -1]; }
    else if (st === 'working' && face === 0) {
      const a = t * 9 + ph * 4;
      if (ag.cook === 'stove') { N = [7, -1]; Fh = [11 + Math.cos(a) * 2, -2 + Math.sin(a) * 2]; }   // stirring at their own stove
      else { const chop = Math.abs(Math.sin(t * 10 + ph * 3)); N = [6, 1 - chop * 5]; Fh = [10 + Math.cos(a), -1 + Math.sin(a)]; }
    } else if (st === 'thinking') Fh = [3, -12 + by];
    else if (st === 'done') { const b = Math.floor(Math.abs(Math.sin(t * 6)) * 3); N = [-9, -27 - b]; Fh = [9, -27 - b]; }
    else if (st === 'error') { const j = Math.floor(t * 8) % 2; N = [-6 - j, -21]; Fh = [6 + j, -21]; }
    if ((ag.meet || face === 3) && st === 'done') { const b = Math.floor(Math.abs(Math.sin(t * 6)) * 3); N = [-9, -27 - b]; Fh = [9, -27 - b]; }
    else if ((ag.meet || face === 3) && st === 'error') { const j = Math.floor(t * 8) % 2; N = [-6 - j, -21]; Fh = [6 + j, -21]; }
    if (act === 'stretch') { N = [N[0] + (-10 - N[0]) * k, N[1] + (-31 - N[1]) * k]; Fh = [Fh[0] + (10 - Fh[0]) * k, Fh[1] + (-31 - Fh[1]) * k]; }
    else if (act === 'read') { N = [-3, -6]; Fh = [5, -7]; }
    limb(c, S2[0], S2[1], Fh[0], Fh[1], look, 1, true);
    limb(c, S1[0], S1[1], N[0], N[1], look, -1, false);
    if (act === 'read') { // open book held in front of the chest
      const cov = ['#8e4ec6', '#3e8ef7', '#e5484d', '#30a46c'][ag.slot % 4], by2 = by;
      R(c, -7, -12 + by2, 14, 9, cov); R(c, -6, -11 + by2, 6, 6, '#fffbe8'); R(c, 0, -11 + by2, 6, 6, '#fffbe8'); R(c, -1, -11 + by2, 2, 6, '#d9cfa8');
      const pg = Math.floor(ap / 2.2) % 3;
      for (let i = 0; i < 3; i++) { R(c, -5, -10 + by2 + i * 2, 3 + ((i + pg) % 2), 1, '#9a8f6a'); R(c, 1, -10 + by2 + i * 2, 4 - ((i + pg) % 2), 1, '#9a8f6a'); }
      R(c, -7, -3 + by2, 14, 1, shade(cov, -40));
      R(c, -5, -6 + by2, 2, 2, look.skin); R(c, 4, -6 + by2, 2, 2, look.skin);
    }
  }

  function drawStanding(c, ag, t, face, ret) {
    const look = ag.look, walking = ag.mode === 'walk', front = face < 2, hp = ag.help || null;
    const pose = hp && ag.mode === 'help' ? hp.pose : null;      // 'work' | 'cheer' | 'worry' | 'wait'
    const fr = walking ? Math.floor(t * 7 + ag.phase * 3) % 4 : 0;
    const hop = pose === 'cheer' ? Math.floor(Math.abs(Math.sin(t * 7 + ag.phase)) * 2) : 0;
    const bob = (walking && (fr & 1) ? 1 : 0) + hop;
    const la = fr === 1 ? 2 : 0, lb = fr === 3 ? 2 : 0;
    const mood = ag.lookUp && !walking ? 'up' : ag.state === 'error' || pose === 'worry' ? 'worried' : (ag.mode === 'drink' || ag.mode === 'chat' || pose === 'cheer') ? 'happy' : 'normal';
    const blink = ((t * 1000 + ag.phase * 3600) % 3600) < 140;
    R(c, -3, -10, 3, 8 - la, look.pants); R(c, 1, -10, 3, 8 - lb, look.pants);
    R(c, -4, -2 - la, 4, 2, shoes); R(c, 0, -2 - lb, 4, 2, shoes);
    torso(c, look, -20 - bob, 10 + bob, front, look.pants);
    if (hp) { // role lanyard + ID card (the person keeps their own look)
      const rc = roleCol(hp.role);
      if (front) { R(c, -2, -20 - bob, 1, 4, rc); R(c, 2, -20 - bob, 1, 4, rc); R(c, -1, -17 - bob, 3, 1, rc); R(c, -1, -16 - bob, 3, 3, '#fff'); R(c, -1, -16 - bob, 3, 1, rc); R(c, 0, -14 - bob, 1, 1, '#555'); }
      else R(c, -3, -20 - bob, 7, 1, rc);
    }
    const f = Math.floor(t * 8 + ag.phase * 5);
    if (pose === 'work' && front) { // little tablet with a live screen
      R(c, -5, -18, 10, 7, '#161827'); R(c, -4, -17, 8, 5, '#0e2a3a');
      for (let i = 0; i < 3; i++) R(c, -3, -16 + i * 2 - (i === 2 ? 1 : 0), 2 + ((f + i * 2) % 4), 1, i === 1 ? '#5ff2a5' : '#6cb6ff');
    }
    const nod = (ag.mode === 'chat' || pose === 'work') && ag.talk == null && Math.floor(t * 3) % 4 === 0 ? 1 : 0;
    head(c, look, -30 - bob + nod - (mood === 'up' ? 1 : 0), front, { blink, mood, hat: (ag.slot === MGR || ag.main) ? 'toque' : 'cap' });
    const sw = walking ? (fr === 1 ? 1 : fr === 3 ? -1 : 0) : 0;
    let N = [-5, -9 + sw * 2], Fh = [5, -9 - sw * 2];
    const asking = ag.ask && !walking;     // waiting for "Yes, chef": the plate goes up on the far side, clear of the hat
    if (asking) { N = [-9, -30]; Fh = [5, -9]; }
    else if (ag.carry) { N = [3, -14]; Fh = [8, -14]; }
    else if (ag.mode === 'drink') { const sip = Math.floor(t * 1.5) % 2; Fh = [4, -17 - (sip ? 3 : 0)]; N = [-5, -9]; ret.mug = [Fh[0], Fh[1] - 6]; }
    else if (ag.mode === 'pantry' && !walking) { const reach = Math.abs(Math.sin(t * 2.2 + ag.phase * 4)); N = [-3, -22 - reach * 5]; Fh = [6, -16 - (1 - reach) * 3]; }
    else if (ag.mode === 'bell' && !walking) { const ding = Math.floor(t * 3 + ag.phase) % 4 === 0; N = [-5, -9]; Fh = ding ? [8, -22] : [6, -14]; }
    else if (ag.mode === 'heat' && !walking) { const a = t * 9 + ag.phase * 4; N = [3, -12]; Fh = [7 + Math.cos(a) * 2, -12 + Math.sin(a) * 2]; }
    else if (ag.mode === 'chat') { if (ag.talk != null) { const g = Math.floor(t * 4) % 2; Fh = [ag.talkDir > 0 ? 8 : 6, -19 - g * 3]; } N = [-5, -9]; }
    else if (pose === 'cheer') { N = [-9, -32 - hop]; Fh = [9, -32 - hop]; }
    else if (pose === 'worry') { const j = Math.floor(t * 8) % 2; N = [-6, -10 - j]; Fh = [6, -10 + j]; }
    else if (!walking && (!ag.away || ag.meet)) {
      const st = ag.state, ph = ag.phase, act = ag.act, ap = ag.actP || 0;
      if (ag.meet) {
        if (st === 'working') { const ff = Math.floor(t * 10 + ph * 3); N = [4, -14]; Fh = [8 + (ff % 3 === 1 ? 1 : 0), -14 - (ff % 2)]; }
        else if (st === 'thinking') { N = [4, -14]; Fh = [3, -22]; }
        else if (st === 'done') { const b = Math.floor(Math.abs(Math.sin(t * 6)) * 3); N = [-9, -32 - b]; Fh = [9, -32 - b]; }
        else { N = [4, -14]; Fh = [8, -14]; }
      } else if (st === 'working') {
        const set = ag.slot === MGR ? 'pass' : (SETS[ag.slot] || 'prep');
        const a = t * 9 + ph * 4;
        if (set === 'sink') { N = [4 + Math.cos(a) * 2, -12 + Math.sin(a) * 2]; Fh = [8 + Math.cos(a + 1) * 2, -11 + Math.sin(a + 1) * 2]; }
        else if (set === 'fryer') { const dip = Math.abs(Math.sin(t * 2.2 + ph)); N = [3, -12]; Fh = [8, -22 + dip * 10]; }
        else if (set === 'oven') { const slide = Math.sin(t * 1.8 + ph); N = [3, -14]; Fh = [8 + slide * 3, -13]; }
        else if (set === 'grill') { const flip = Math.abs(Math.sin(t * 3 + ph)); N = [2, -12]; Fh = [7, -12 - flip * 12]; }
        else if (set === 'stove') { N = [3, -12]; Fh = [7 + Math.cos(a) * 2, -12 + Math.sin(a) * 2]; }
        else if (set === 'pass') {
          const ff = Math.floor(t * 8 + ph * 3), ring = ag.cook === 'bell' ? Math.floor(t * 3 + ph) % 3 === 0 : Math.floor(t * 0.7 + ph) % 6 === 0;
          N = ring ? [-8, -22] : [4, -14 - (ff % 2)]; Fh = [8, -14 - ((ff + 1) % 2)];
        } else { const chop = Math.abs(Math.sin(t * 10 + ph * 3)); N = [3, -12]; Fh = [7, -8 - chop * 8]; }
        if (ag.talk != null) { const g = Math.floor(t * 4) % 2; Fh = [ag.talkDir > 0 ? 8 : 6, -19 - g * 3]; }
      } else if (st === 'thinking') Fh = [3, -22];
      else if (st === 'done') { const b = Math.floor(Math.abs(Math.sin(t * 6)) * 3); N = [-9, -32 - b]; Fh = [9, -32 - b]; }
      else if (st === 'error') { const j = Math.floor(t * 8) % 2; N = [-6 - j, -24]; Fh = [6 + j, -24]; }
      else if (act === 'stretch') { const k = Math.min(ap / 0.5, 1) * (ap < 2.4 ? 1 : Math.max(0, (2.9 - ap) / 0.5)); N = [-9 * k, -32 * k]; Fh = [9 * k, -32 * k]; }
      else if (act === 'read') { N = [-3, -16]; Fh = [5, -16]; }
    } else if (pose === 'work') {
      if (front) { N = [-5, -12]; Fh = [5, -12]; } else { N = [-4, -12 + (f % 2)]; Fh = [4, -12 + ((f + 1) % 2)]; }
      if (ag.talk != null) { const g = Math.floor(t * 4) % 2; Fh = [ag.talkDir > 0 ? 8 : 6, -19 - g * 3]; }
    } else if (pose === 'wait' && ag.talk != null) { const g = Math.floor(t * 4) % 2; Fh = [ag.talkDir > 0 ? 8 : 6, -19 - g * 3]; }
    limb(c, 4, -18 - bob, Fh[0], Fh[1], look, 1, true);
    limb(c, -4, -18 - bob, N[0], N[1], look, -1, false);
    if (asking) { disc(c, -10, -33, 4, '#f0eee8'); disc(c, -10, -33, 3, '#fff'); disc(c, -10, -34, 2, '#c84830'); }
    else if (ag.carry) { disc(c, 6, -16, 4, '#f0eee8'); disc(c, 6, -16, 3, '#fff'); disc(c, 6, -17, 2, ag.carry === 'burnt' ? '#3a2a20' : '#c84830'); }
    else if (ag.mode === 'drink') { const hx = Fh[0], hy = Fh[1]; R(c, hx - 2, hy - 5, 5, 5, '#f5f5f0'); R(c, hx + 3, hy - 4, 1, 3, '#f5f5f0'); R(c, hx - 2, hy - 5, 5, 1, '#5b3a1e'); }
    else if (!walking && !ag.away && ag.act === 'read') {
      const cov = ['#8e4ec6', '#3e8ef7', '#e5484d', '#30a46c'][ag.slot % 4], by2 = -16;
      R(c, -7, by2, 14, 9, cov); R(c, -6, by2 + 1, 6, 6, '#fffbe8'); R(c, 0, by2 + 1, 6, 6, '#fffbe8'); R(c, -1, by2 + 1, 2, 6, '#d9cfa8');
      R(c, -5, by2 + 6, 2, 2, look.skin); R(c, 4, by2 + 6, 2, 2, look.skin);
    }
  }

  /** composite the sprite buffer with a 1px dark outline (and optional horizontal mirror) */
  function blit(c, ax, ay, flip) {
    let src = spr;
    if (flip) { fc.clearRect(0, 0, 80, 80); fc.save(); fc.translate(80, 0); fc.scale(-1, 1); fc.drawImage(spr, 0, 0); fc.restore(); src = flp; }
    silc.globalCompositeOperation = 'source-over'; silc.clearRect(0, 0, 80, 80); silc.drawImage(src, 0, 0);
    silc.globalCompositeOperation = 'source-in'; silc.fillStyle = '#161827'; silc.fillRect(0, 0, 80, 80);
    for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) c.drawImage(sil, ax - ORX + dx, ay - ORY + dy);
    c.drawImage(src, ax - ORX, ay - ORY);
  }
  const FLIP = [false, true, true, false];     // facings 1 (SW) and 2 (NW) are mirrored sprites
  const LOOK_SEQ = [0, 1, 1, 0, 3, 3];         // swivel sequence while "looking around" at the desk
  const MGR_LOOK = [3, 2, 2, 3, 0, 0];         // the manager swivels the other way (their default is back to the camera)
  const seatFace = (e) => (e.faceOv != null ? e.faceOv : e.act === 'look' ? (e.slot === MGR ? MGR_LOOK : LOOK_SEQ)[Math.floor((e.actP || 0) / 0.9) % 6] : e.slot === MGR ? 3 : 0);
  const faceOf = (e) => (e.meet ? e.face || 0 : e.away ? (e.face || 0) : seatFace(e));
  const sitting = (e) => !e.away || !!e.meet;          // at their station or at the planning table (standing)
  const seatAt = (e) => (e.meet ? { x: e.x, y: e.y } : SLOTS[e.slot].seat);

  function renderPerson(c, e, t, atPost) {
    const face = e.lookUp && e.mode !== 'walk' ? [0, 1, 1, 0][faceOf(e)] : faceOf(e), ret = {};   // clicked: turn toward the camera
    let ax, ay;
    if (atPost) { const s = seatAt(e); ax = sx(s.x, s.y); ay = sy(s.x, s.y, 0); }
    else { ax = sx(e.x, e.y); ay = sy(e.x, e.y, 0); }
    for (let dy = -3; dy <= 3; dy++) { const w = Math.round(9 * Math.sqrt(1 - (dy * dy) / 12.25)); R(c, ax - w, ay + dy, w * 2, 1, 'rgba(40,30,15,.28)'); }
    sc.setTransform(1, 0, 0, 1, 0, 0); sc.clearRect(0, 0, 80, 80); sc.setTransform(1, 0, 0, 1, ORX, ORY);
    drawStanding(sc, e, t, face, ret);
    sc.setTransform(1, 0, 0, 1, 0, 0);
    if (atPost && !e.meet && face === 0 && e.slot !== MGR && HEAT[SETS[e.slot]]) {
      const g = screenGlow(e.state, t, e.phase);
      if (g) { sc.globalCompositeOperation = 'source-atop'; sc.globalAlpha = Math.min(0.3, g.a * 0.3); sc.fillStyle = g.col; sc.fillRect(ORX - 2, ORY - 36, 10, 28); sc.globalAlpha = 1; sc.globalCompositeOperation = 'source-over'; }
    }
    blit(c, ax, ay, FLIP[face]);
    if (ret.mug) { const mx = ax + (FLIP[face] ? -ret.mug[0] : ret.mug[0]), s2 = Math.floor(t * 4) % 2; c.globalAlpha = 0.8; R(c, mx - 1 + s2, ay + ret.mug[1] - 3, 1, 2, '#fff'); R(c, mx + 1 - s2, ay + ret.mug[1] - 6, 1, 2, '#fff'); c.globalAlpha = 1; }
  }


  // ---------- team collaboration: roles, helper spots, handoff icons, dotted links ----------
  const ROLE_COL = { security: '#ff6b6b', performance: '#ffb02e', tests: '#5ff2a5', style: '#c49bff', docs: '#6cb6ff', architecture: '#ff8fa3', explore: '#4dd0e1', general: '#cfd6e6' };
  const ROLE_ICO = {
    security: ['..###..', '.#####.', '#######', '#######', '.#####.', '..###..', '...#...'],
    performance: ['....##.', '...##..', '..##...', '.#####.', '...##..', '..##...', '.##....'],
    tests: ['.......', '......#', '.....##', '#...##.', '##.##..', '.###...', '..#....'],
    style: ['...#...', '...#...', '.#####.', '..###..', '.#####.', '...#...', '...#...'],
    docs: ['.#####.', '.#...#.', '.#####.', '.#...#.', '.#####.', '.#...#.', '.#####.'],
    architecture: ['...#...', '..###..', '..#.#..', '.#####.', '.#...#.', '#######', '#.....#'],
    explore: ['.###...', '#...#..', '#...#..', '#...#..', '.###...', '....##.', '.....##'],
    general: ['..#.#..', '.#####.', '##...##', '.#...#.', '##...##', '.#####.', '..#.#..'],
  };
  const roleCol = (r) => ROLE_COL[r] || ROLE_COL.general;
  const kindCol = roleCol;
  function roleBadge(c, x, y, role) { // 9x9 role icon, top-left at x,y
    const col = roleCol(role), ico = ROLE_ICO[role] || ROLE_ICO.general;
    R(c, x, y, 9, 9, '#161827'); R(c, x + 1, y + 1, 7, 7, col); R(c, x + 1, y + 1, 7, 1, shade(col, 35));
    for (let r = 0; r < 7; r++) for (let q = 0; q < 7; q++) if (ico[r][q] === '#') R(c, x + 1 + q, y + 1 + r, 1, 1, '#161827');
  }
  function clipboardIcon(c, x, y, t) { // clipboard with ticking lines (the lead announcing the plan)
    x = Math.round(x); y = Math.round(y);
    R(c, x - 6, y - 8, 13, 17, '#161827'); R(c, x - 5, y - 7, 11, 15, '#c9a26b'); R(c, x - 4, y - 5, 9, 12, '#fffbe8'); R(c, x - 2, y - 9, 5, 3, '#8b90ad'); R(c, x - 1, y - 9, 3, 1, '#161827');
    const k = Math.floor(t * 2) % 4;
    for (let i = 0; i < 3; i++) { R(c, x - 3, y - 3 + i * 4, 1, 1, i < k ? '#30a46c' : '#9a8f6a'); R(c, x - 1, y - 3 + i * 4, 5, 1, '#9a8f6a'); }
  }
  const faceToward = (fx, fy, tx, ty) => { const dx = tx - fx, dy = ty - fy; return Math.abs(dx) >= Math.abs(dy) ? (dx > 0 ? 0 : 2) : (dy > 0 ? 1 : 3); };

  /** Floor route (tile coordinates) between two desks, along the aisles / gaps between the desks, so dotted lines and flying papers never cross
   *  furniture. `off` separates parallel lanes so several helpers' lines do not lie on top of each other. */
  function deskRoute(sa, sb, off) {
    const A0 = SLOTS[sa], B0 = SLOTS[sb], T = AISLE + off, F = (s) => s.px + off, y0 = (s) => s.py;
    const END = 9.45 + off;   // around the south end of the two joined runs (the old y-gaps are now counter)
    let pts;
    if (A0.row === B0.row) pts = [[F(A0), y0(A0)], [F(A0), y0(B0)], [F(B0), y0(B0)]];
    else if (A0.row) pts = [[F(A0), y0(A0)], [F(A0), END], [T, END], [T, y0(B0)]];
    else pts = [[T, y0(A0)], [T, END], [F(B0), END], [F(B0), y0(B0)]];
    return pts.filter((q, i) => !i || Math.abs(q[0] - pts[i - 1][0]) > 1e-6 || Math.abs(q[1] - pts[i - 1][1]) > 1e-6);
  }
  /** same route as screen points (z = floor height of the line) */
  const routeScreen = (sa, sb, off, z) => deskRoute(sa, sb, off).map(([x, y]) => A(x, y, z || 0));
  function pointAlong(pts, q) {
    let tot = 0; const L = [];
    for (let i = 1; i < pts.length; i++) { const d = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]); L.push(d); tot += d; }
    let d = Math.max(0, Math.min(1, q)) * tot;
    for (let i = 0; i < L.length; i++) { if (d <= L[i] || i === L.length - 1) { const f = L[i] ? d / L[i] : 0; return [pts[i][0] + (pts[i + 1][0] - pts[i][0]) * f, pts[i][1] + (pts[i + 1][1] - pts[i][1]) * f]; } d -= L[i]; }
    return pts[0];
  }
  function sparkles(c, cx, cy, t, ph) { // little celebration stars around a head
    for (let i = 0; i < 6; i++) {
      const a = t * 2.4 + i * 1.05 + ph, r = 13 + 3 * Math.sin(t * 5 + i), x = Math.round(cx + Math.cos(a) * r), y = Math.round(cy + Math.sin(a) * r * 0.6), k = Math.floor(t * 6 + i) % 2;
      R(c, x - 1 - k, y, 3 + k * 2, 1, '#ffd84a'); R(c, x, y - 1 - k, 1, 3 + k * 2, '#ffd84a');
    }
  }

  // pixel icons for the handoffs: the order ticket the lead hands out (same colour as an in-progress ticket on the rail)
  function ticketIcon(c, x, y, f) {
    x = Math.round(x); y = Math.round(y); const w = f % 2 ? 2 : 3;
    R(c, x - w - 1, y - 5, w * 2 + 2, 10, '#161827'); R(c, x - w, y - 4, w * 2, 8, '#ffc4b0'); R(c, x - w, y - 4, w * 2, 2, '#e5484d');
    R(c, x - w + 1, y - 1, Math.max(1, w * 2 - 2), 1, '#8a4a3a'); R(c, x - w + 1, y + 1, Math.max(1, w * 2 - 2), 1, '#8a4a3a');
  }
  function envelopeIcon(c, x, y, seal) {
    x = Math.round(x); y = Math.round(y);
    R(c, x - 6, y - 4, 12, 9, '#161827'); R(c, x - 5, y - 3, 10, 7, '#fffbe8');
    for (let i = 0; i < 4; i++) { R(c, x - 5 + i, y - 3 + i, 1, 1, '#b0a77c'); R(c, x + 4 - i, y - 3 + i, 1, 1, '#b0a77c'); }
    R(c, x - 1, y, 2, 2, seal);
  }
  function msgBubble(c, cx, cy, glyph) { // small speech bubble with an envelope ('env') or '!' ('err')
    cx = Math.round(cx); cy = Math.round(cy);
    R(c, cx - 8, cy - 6, 16, 12, '#161827'); R(c, cx - 7, cy - 7, 14, 14, '#161827'); R(c, cx - 7, cy - 6, 14, 12, '#fff'); R(c, cx - 6, cy - 7, 12, 14, '#fff');
    R(c, cx - 4, cy + 6, 4, 3, '#161827'); R(c, cx - 3, cy + 6, 2, 2, '#fff');
    if (glyph === 'err') { R(c, cx - 1, cy - 4, 2, 5, '#e5484d'); R(c, cx - 1, cy + 3, 2, 2, '#e5484d'); }
    else { R(c, cx - 5, cy - 3, 10, 7, '#3a3f52'); R(c, cx - 4, cy - 2, 8, 5, '#fffbe8'); for (let i = 0; i < 4; i++) { R(c, cx - 4 + i, cy - 2 + i, 1, 1, '#9a8f6a'); R(c, cx + 3 - i, cy - 2 + i, 1, 1, '#9a8f6a'); } R(c, cx - 1, cy, 2, 2, '#30a46c'); }
  }
  /** dotted line along a Bresenham path; dots march forward with `ph` */
  function dotLine(c, x0, y0, x1, y1, col, ph, on) {
    on = on || 1;
    const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0), stx = x0 < x1 ? 1 : -1, sty = y0 < y1 ? 1 : -1;
    let err = dx + dy, i = 0; c.fillStyle = col;
    for (;;) {
      if ((((i++ - ph) % (on === 1 ? 4 : on * 2)) + (on === 1 ? 4 : on * 2)) % (on === 1 ? 4 : on * 2) < on) c.fillRect(x0, y0, 1, 1);
      if (x0 === x1 && y0 === y1) break;
      const e2 = 2 * err;
      if (e2 >= dy) { err += dy; x0 += stx; }
      if (e2 <= dx) { err += dx; y0 += sty; }
    }
  }

  // ---------- scene: objects, depth sorting ----------
  function drawTable(c, t, plan) {
    const { x, y, r } = TABLE, N = 40, rim = (z, rr) => Array.from({ length: N }, (_, k) => A(x + rr * Math.cos((k / N) * Math.PI * 2), y + rr * Math.sin((k / N) * Math.PI * 2), z));
    box(c, x - 0.12, y - 0.12, x + 0.12, y + 0.12, 0, 11, { top: '#555a6a', se: '#2b2f3b', sw: '#3a3f4f' });
    poly(c, rim(1, 0.55), '#2b2f3b'); poly(c, rim(1.5, 0.45), '#3a3f4f');
    // stainless top, butcher-block inset
    for (let z = 12; z <= 14; z++) poly(c, rim(z, r), z === 12 ? '#5a6068' : '#7a8088');
    poly(c, rim(15, r), '#c8ccd4'); poly(c, rim(15, r - 0.07), '#e0e4ea'); poly(c, rim(15, r - 0.5), '#d2a06a');
    const hi = A(x - 0.35, y - 0.55, 15); R(c, hi[0] - 4, hi[1], 8, 1, 'rgba(255,255,255,.45)');
    // a few order tickets around the rim + a recipe book in the middle
    for (const st of SEATS) {
      const px = x + (st.x - x) * 0.58, py = y + (st.y - y) * 0.58, q = A(px, py, 15);
      const col = ['#f5c542', '#ff8b8f', '#8fb8ff', '#6be39b'][st.i % 4];
      R(c, q[0] - 2, q[1] - 1, 4, 3, col); R(c, q[0] - 1, q[1], 2, 1, shade(col, -40));
    }
    const sp = A(x, y, 15);
    R(c, sp[0] - 5, sp[1] - 3, 10, 7, '#5b3a1e'); R(c, sp[0] - 4, sp[1] - 2, 8, 5, '#fffbe8');
    R(c, sp[0] - 1, sp[1] - 3, 2, 6, '#5b3a1e');
    R(c, sp[0] - 3, sp[1] - 1, 2, 1, '#9a8f6a'); R(c, sp[0] + 1, sp[1] - 1, 2, 1, '#9a8f6a');
    R(c, sp[0] - 1, sp[1] + 2, 2, 1, plan ? (plan.state === 'ready' ? '#6be39b' : '#ffd84a') : '#c9a26b');
  }

  function buildObjects(entries, t, plan) {
    const bySlot = {}; entries.forEach((e) => { bySlot[e.slot] = e; });
    const fires = new Set(entries.filter((e) => e.fire).map((e) => (HEAT[SETS[e.slot]] ? e.slot : SETS.indexOf('stove'))));   // cold stations and the pass use the stove
    const objs = [];
    for (const s of SLOTS) {
      const ag = bySlot[s.i] || null, res = ag ? { id: ag.id } : { slot: s.i };
      if (s.mgr) {
        const m1 = [sx(MON_X, 0.5), sy(MON_X, 0.5, 30), 14];
        objs.push({ x0: MD.x0, y0: MD.y0, x1: MD.x1, y1: MD.y1, h: 32, pad: 2, ord: 2, tag: 'desk' + s.i, draw: (c) => drawDesk(c, s, ag, t),
          hit: (lx, ly) => inPoly(boxHex(MD.x0, MD.y0, MD.x1, MD.y1, 0, DESKZ), lx, ly) || (lx >= m1[0] && lx < m1[0] + m1[2] && ly >= m1[1] && ly < m1[1] + 15), res });
        continue;
      }
      const span = deskSpan(s), mon = [sx(s.dx + 0.74, s.dy + 1.45), sy(s.dx + 0.74, s.dy + 1.45, 29), 14];
      const setH = SETS[s.i] === 'oven' ? 36 : 29;
      objs.push({ x0: span.x0, y0: span.y0, x1: span.x1, y1: span.y1, h: setH, pad: 0, ord: 2, tag: 'desk' + s.i, draw: (c) => drawDesk(c, s, ag, t, fires.has(s.i)),
        hit: (lx, ly) => inPoly(boxHex(s.dx, s.dy, s.dx + 1, s.dy + 2, 0, DESKZ), lx, ly) || (lx >= mon[0] && lx < mon[0] + mon[2] && ly >= mon[1] && ly < mon[1] + 15), res });
    }
    for (const p of PLANTS) objs.push({ x0: p.x + 0.2, y0: p.y + 0.2, x1: p.x + 0.8, y1: p.y + 0.8, h: 34, pad: 8, ord: 0, draw: (c) => plant(c, p.x, p.y), hit: null });
    objs.push({ x0: TABLE.x - 1.0, y0: TABLE.y - 1.0, x1: TABLE.x + 1.0, y1: TABLE.y + 1.0, h: 20, pad: 10, ord: 0, tag: 'table', draw: (c) => drawTable(c, t, plan), hit: null });
    for (const e of entries) {
      let x, y; const atPost = sitting(e);
      if (atPost) { const q = seatAt(e); x = q.x; y = q.y; } else { x = e.x; y = e.y; }
      const ax = sx(x, y), ay = sy(x, y, 0), tall = e.slot === MGR || e.main, top = tall ? 46 : 38;
      objs.push({ x0: x - 0.22, y0: y - 0.22, x1: x + 0.22, y1: y + 0.22, h: top, pad: 10, ord: 1, tag: 'person:' + e.id, draw: (c) => renderPerson(c, e, t, atPost),
        hit: (lx, ly) => lx >= ax - 8 && lx <= ax + 8 && ly >= ay - top && ly <= ay + 3, res: { id: e.id }, person: true });
    }
    return objs;
  }
  /** Footprint-aware painter's algorithm: A is drawn before B if A lies entirely behind B along x or y. */
  function sortObjs(objs) {
    const n = objs.length, e = 1e-4;
    for (const o of objs) { o.bx0 = sx(o.x0, o.y1) - o.pad; o.bx1 = sx(o.x1, o.y0) + o.pad; o.by0 = sy(o.x0, o.y0, o.h); o.by1 = sy(o.x1, o.y1, 0) + 3; o.cs = (o.x0 + o.x1 + o.y0 + o.y1) / 2; }
    const behind = objs.map(() => []);
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
      const a = objs[i], b = objs[j];
      if (a.bx1 <= b.bx0 || b.bx1 <= a.bx0 || a.by1 <= b.by0 || b.by1 <= a.by0) continue;   // screen boxes don't overlap
      const aB = a.x1 <= b.x0 + e || a.y1 <= b.y0 + e, bA = b.x1 <= a.x0 + e || b.y1 <= a.y0 + e;
      let aFirst;
      if (aB && !bA) aFirst = true; else if (bA && !aB) aFirst = false;
      else aFirst = Math.abs(a.cs - b.cs) > 1e-3 ? a.cs < b.cs : a.ord <= b.ord;
      if (aFirst) behind[j].push(i); else behind[i].push(j);
    }
    const order = objs.map((_, i) => i).sort((p, q) => objs[p].cs - objs[q].cs);
    const seen = new Array(n).fill(false), out = [];
    const visit = (i) => { if (seen[i]) return; seen[i] = true; for (const j of behind[i]) visit(j); out.push(objs[i]); };
    order.forEach(visit);
    return out;
  }

  // ---------- selection / hover outlines (iso diamond for desks, ellipse for walkers) ----------
  function dline(c, x0, y0, x1, y1, col, off, thick) {
    const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0), stx = x0 < x1 ? 1 : -1, sty = y0 < y1 ? 1 : -1;
    let err = dx + dy, i = 0; c.fillStyle = col;
    for (;;) {
      if ((((i++ + off) >> 1) & 1) === 0) c.fillRect(x0, y0, 1, thick || 1);
      if (x0 === x1 && y0 === y1) break;
      const e2 = 2 * err;
      if (e2 >= dy) { err += dy; x0 += stx; }
      if (e2 <= dx) { err += dx; y0 += sty; }
    }
  }
  function podRing(c, s, col, t, thick) {
    const x0 = s.ring.x0, y0 = s.ring.y0, x1 = s.ring.x1, y1 = s.ring.y1;
    const P = [A(x0, y0), A(x1, y0), A(x1, y1), A(x0, y1)];
    const off = t ? Math.floor(t * 8) : 0;
    for (let i = 0; i < 4; i++) { const a = P[i], b = P[(i + 1) % 4]; dline(c, a[0], a[1], b[0], b[1], col, off + i * 3, thick); }
  }
  function ellipseRing(c, ax, ay, rx, ry, col, t, thick) {
    const off = t ? Math.floor(t * 8) : 0; c.fillStyle = col; const N = 96; const seen = new Set();
    for (let i = 0; i < N; i++) {
      const a = (i / N) * Math.PI * 2, x = ax + Math.round(rx * Math.cos(a)), y = ay + Math.round(ry * Math.sin(a));
      if (((i + off) >> 1) % 2 !== 0 || seen.has(x * 1000 + y)) continue; seen.add(x * 1000 + y);
      c.fillRect(x, y, 1, thick || 1);
    }
  }

  // ---------- the recipe / plan card floating over the planning table ----------
  const planDocPos = () => [sx(TABLE.x, TABLE.y), sy(TABLE.x, TABLE.y, 84)];   // high enough to clear a standing head at the back of the table
  function planDoc(c, plan, t) {
    const [cx0, cy0] = planDocPos(), bob = Math.round(Math.sin(t * 2.4)), ready = plan.state === 'ready', x = cx0, y = cy0 + bob;
    const ts = A(TABLE.x, TABLE.y, TABLE.h);                       // shadow on the table top
    c.globalAlpha = 0.25; R(c, ts[0] - 6, ts[1] - 1, 12, 3, '#000'); c.globalAlpha = 1;
    for (let yy = ts[1] - 3, i = 0; yy > y + 12; yy -= 4, i++) { c.globalAlpha = 0.35 + 0.35 * ((Math.floor(t * 6) + i) % 3 === 0 ? 1 : 0); R(c, x, yy, 1, 2, ready ? '#6be39b' : '#ffd84a'); }
    c.globalAlpha = 1;
    R(c, x - 8, y - 11, 17, 22, '#161827'); R(c, x - 7, y - 10, 15, 20, ready ? '#fffbe8' : '#f6efd2'); R(c, x - 7, y - 10, 15, 3, ready ? '#6be39b' : '#ffd84a');
    R(c, x + 4, y - 10, 4, 4, '#161827'); R(c, x + 5, y - 9, 2, 2, '#c9c2a8');
    const k = ready ? 5 : 1 + Math.floor(t * 2) % 5;
    for (let i = 0; i < 5; i++) if (i < k) { R(c, x - 5, y - 4 + i * 3, 2, 2, ready || i < k - 1 ? '#30a46c' : '#9a8f6a'); R(c, x - 2, y - 4 + i * 3, 7 - (i % 2) * 2, 1, '#9a8f6a'); }
    if (ready) { R(c, x + 4, y + 5, 8, 8, '#161827'); R(c, x + 5, y + 6, 6, 6, '#30a46c'); [[6, 9], [7, 10], [8, 9], [9, 8], [10, 7]].forEach(([a, b]) => R(c, x + a, y + b - 1, 1, 2, '#fff')); }
    else for (let i = 0; i < 3; i++) { const f = (t * 2 + i * 0.33) % 1; c.globalAlpha = 1 - f; R(c, x - 12 + i * 12, y - 15 - Math.round(f * 3), 2, 2, '#ffd84a'); c.globalAlpha = 1; }
  }


  /** Live order tickets hanging from the pass rail. Returns logical-space hit boxes. */
  function drawTickets(c, tickets, t) {
    const hits = [];
    if (!tickets || !tickets.length) return hits;
    const n = tickets.length, w = 0.17, gap = 0.03, total = n * w + (n - 1) * gap;
    const x0 = 7.46 + Math.max(0, (1.44 - total) / 2);
    tickets.forEach((tk, i) => {
      const x = x0 + i * (w + gap), y = 0.14;
      const drop = tk.state === 'progress' && Math.floor(t * 5 + i) % 4 === 0 ? 0.03 : 0;
      const z1 = DESKZ + 2, z2 = DESKZ + (tk.state === 'done' ? 12 : 10) - drop * 8;
      const col = tk.state === 'pending' ? '#f0d9a0' : tk.state === 'progress' ? '#ffc4b0' : '#b8e8c0';
      box(c, x, y, x + w, y + 0.1, z1, z2, { top: col, se: shade(col, -40), sw: shade(col, -18) });
      const pin = A(x + w / 2, y + 0.05, z2);
      R(c, pin[0] - 1, pin[1], 2, 1, '#3a4048');
      if (tk.state === 'done') {
        const pl = A(x + w / 2, y + 0.08, z1 + 4);
        disc(c, pl[0], pl[1], 3, '#f0eee8'); disc(c, pl[0], pl[1], 2, '#fff'); disc(c, pl[0], pl[1], 1, '#c84830');
      }
      const corners = [A(x, y, z2), A(x + w, y, z2), A(x, y + 0.1, z1), A(x + w, y + 0.1, z1)];
      const lx = Math.min(...corners.map((p) => p[0])) - 1, rx = Math.max(...corners.map((p) => p[0])) + 1;
      const ty = Math.min(...corners.map((p) => p[1])) - 1, by = Math.max(...corners.map((p) => p[1])) + 1;
      hits.push({ id: tk.id, name: tk.name, text: tk.text, state: tk.state, ax: (lx + rx) / 2, head: ty, x: lx, y: ty, w: rx - lx, h: by - ty });
    });
    return hits;
  }

  // ---------- main ----------
  let lastTicketHits = [];
  const bg = buildBackground();
  const logical = mk(W, H), lc = logical.getContext('2d');
  const labelPt = (e) => { const s = SLOTS[e.slot !== undefined ? e.slot : e.i]; return [sx(s.lab.x, s.lab.y), sy(s.lab.x, s.lab.y, 0) + 6]; };
  const personAnchor = (e) => { if (sitting(e)) { const s = seatAt(e); const tall = e.slot === MGR || e.main; return { ax: sx(s.x, s.y), ay: sy(s.x, s.y, 0), head: sy(s.x, s.y, 0) - (tall ? 44 : 36) }; } const tall = e.slot === MGR || e.main; return { ax: sx(e.x, e.y), ay: sy(e.x, e.y, 0), head: sy(e.x, e.y, 0) - (tall ? 44 : 36) }; };

  /** scene: {t, entries:[{id,name,type,slot,look,state,tool,phase,away,x,y,face,mode,bubble,act,actP,talk,talkDir,queued}], selectedId, hoverId, hoverSlot} */
  function render(canvas, S, U, scene) {
    const t = scene.t, entries = scene.entries;
    lc.clearRect(0, 0, W, H);
    lc.drawImage(bg, 0, 0);
    const bySlot = {}; entries.forEach((e) => { bySlot[e.slot] = e; });
    // meeting: a glowing ring on the floor around the planning table while a plan is being made
    const plan = scene.plan || null;
    if (plan) {
      const tx = sx(TABLE.x, TABLE.y), ty = sy(TABLE.x, TABLE.y, 0), col = plan.state === 'ready' ? '#6be39b' : '#ffd84a';
      lc.globalAlpha = 0.12 + 0.06 * Math.sin(t * 4); poly(lc, Array.from({ length: 48 }, (_, k) => A(TABLE.x + 2.35 * Math.cos(k / 48 * Math.PI * 2), TABLE.y + 2.35 * Math.sin(k / 48 * Math.PI * 2), 0)), col); lc.globalAlpha = 1;
      ellipseRing(lc, tx, ty, Math.round(22.6 * 2.4), Math.round(11.3 * 2.4), col, t, 1);
    }
    // floor-level outlines first so furniture and people cover them where they should
    for (const e of entries) {
      const s = SLOTS[e.slot];
      if (e.id === scene.selectedId) { podRing(lc, s, '#f5c542', t, 1); if (e.away || e.meet) { const p = personAnchor(e); ellipseRing(lc, p.ax, p.ay, 13, 6, '#f5c542', t, 1); } }
      else if (e.id === scene.hoverId) { podRing(lc, s, 'rgba(255,255,255,.8)', 0, 1); if (e.away) { const p = personAnchor(e); ellipseRing(lc, p.ax, p.ay, 13, 6, 'rgba(255,255,255,.8)', 0, 1); } }
    }
    if (scene.hoverSlot != null && !bySlot[scene.hoverSlot]) podRing(lc, SLOTS[scene.hoverSlot], 'rgba(95,242,165,.9)', 0, 1);
    // dotted isometric lines lead desk -> every helper desk (along the aisles), the glowing desk pads, the wrap-up rings, inferred peer lines
    const byId = {}; entries.forEach((e) => { byId[e.id] = e; });
    const ph8 = Math.floor(t * 8), lane = {}, byLead = {};
    for (const e of entries) if (e.help) (byLead[e.help.parentId] = byLead[e.help.parentId] || []).push(e);
    for (const k in byLead) byLead[k].sort((p, q) => p.slot - q.slot).forEach((e, i) => { lane[e.id] = (i - (byLead[k].length - 1) / 2) * 0.1; });
    const pad = (sl, col, al) => { const s = SLOTS[sl], x = s.px, y = s.py; lc.globalAlpha = al; poly(lc, [A(x - 0.4, y - 0.4, 0), A(x + 0.4, y - 0.4, 0), A(x + 0.4, y + 0.4, 0), A(x - 0.4, y + 0.4, 0)], col); lc.globalAlpha = 1; };
    const polyDots = (pts, col, ph) => { for (let i = 1; i < pts.length; i++) dotLine(lc, Math.round(pts[i - 1][0]), Math.round(pts[i - 1][1]), Math.round(pts[i][0]), Math.round(pts[i][1]), col, ph + i * 2, 2); };
    for (const e of entries) {
      if (e.huddle != null && !e.away) podRing(lc, SLOTS[e.slot], '#f5c542', t, 1);
      const h = e.help; if (!h || !h.desk) continue;
      const pe = byId[h.parentId]; if (!pe || pe.away) continue;
      const rc = roleCol(h.role), fade = h.pose === 'work' ? 1 : 0.5, lanes = lane[e.id] || 0;
      pad(e.slot, rc, (0.16 + 0.08 * Math.sin(t * 5 + e.phase * 6)) * fade); pad(pe.slot, rc, 0.1 * fade);
      lc.globalAlpha = fade; polyDots(routeScreen(pe.slot, e.slot, lanes), rc, ph8); lc.globalAlpha = 1;
      if (h.celebrate != null) podRing(lc, SLOTS[e.slot], '#f5c542', t, 1);
      if (h.peerWith && e.id < h.peerWith && byId[h.peerWith] && h.desk) { // inferred peer line between the two helper desks
        const o = byId[h.peerWith];
        lc.globalAlpha = 0.95; polyDots(routeScreen(e.slot, o.slot, 0.32), '#ffffff', ph8 + 1); lc.globalAlpha = 1;
      }
    }
    // steam over the staff coffee urn
    for (let i = 0; i < 3; i++) {
      const p = (t * 8 + i * 4) % 12, bx = sx(11.4, 0.42), by = sy(11.4, 0.42, 32);
      lc.globalAlpha = 0.6 * (1 - p / 12); R(lc, bx + Math.sin(t * 2 + i * 2) * 1.5 - 1 + i * 2, by - p, 2, 2, '#fff');
    }
    lc.globalAlpha = 1;
    for (const o of sortObjs(buildObjects(entries, t, plan))) o.draw(lc);
    // state icons, role badges, talk bubbles sit above everything
    for (const e of entries) {
      const p = personAnchor(e), h = e.help;
      if (h) {
        roleBadge(lc, p.ax - 17, p.ay - (e.away ? 31 : 28), h.role);
        if (h.desk && h.celebrate != null) sparkles(lc, p.ax, p.head + 4, t, e.phase * 6);
        const st = h.say ? null : h.desk ? (e.state === 'done' || e.state === 'error' ? e.state : null) : h.pose === 'cheer' ? 'done' : h.pose === 'worry' ? 'error' : null;
        if (st) stateIcon(lc, p.ax, h.desk ? p.head : p.head + 2, st, t);
        if (e.talk != null) drawTalk(lc, p.ax + e.talkDir * 6, p.head - 2, e.talk, e.talkDir);
        continue;
      }
      if (e.meet) {                                    // at the planning table: thinking bubbles in turn while the plan is being made
        if (plan && plan.state === 'planning' && e.id !== plan.ownerId) { const k = Math.floor(t * 0.7 + e.phase * 9 + e.slot) % 3; if (k < 2) drawTalk(lc, p.ax + 6, p.head - 2, k ? 2 : 0, 1); }
        else if (plan && plan.state === 'ready') { if (Math.floor(t * 0.8 + e.slot) % 2) drawTalk(lc, p.ax + 6, p.head - 2, 1, 1); }
        else stateIcon(lc, p.ax, p.head, e.state, t);
        continue;
      }
      if (!e.away) stateIcon(lc, p.ax, p.head, e.state, t);
      else { stateIcon(lc, p.ax, p.head + 2, e.state, t); if (e.mode === 'chat' && e.talk != null) drawTalk(lc, p.ax + e.talkDir * 6, p.head - 2, e.talk, e.talkDir); }
    }
    for (const e of entries) if (e.planAge != null && !e.away) { const p = personAnchor(e); clipboardIcon(lc, p.ax + 17, p.head + 1 + Math.round(Math.sin(t * 3)), t); }
    if (plan) planDoc(lc, plan, t);
    for (const f of scene.flights || []) {
      if (f.p < 0 || f.p > 1) continue;
      let sa, sb, off, kc = '#6cb6ff', draw;
      if (f.kind === 'letter') {
        const fe = byId[f.pid], te = byId[f.toId]; if (!fe || !te) continue;
        sa = fe.slot; sb = te.slot; off = 0.32; draw = (x, y) => envelopeIcon(lc, x, y, '#6cb6ff');
      } else {
        const pe = byId[f.pid], he = byId[f.hid]; if (!pe || !he) continue;
        kc = roleCol(he.help ? he.help.role : f.role); off = lane[he.id] || 0;
        if (f.kind === 'out') { sa = pe.slot; sb = he.slot; draw = (x, y) => ticketIcon(lc, x, y, Math.floor(t * 10)); }
        else { sa = he.slot; sb = pe.slot; draw = (x, y) => envelopeIcon(lc, x, y, f.ok === false ? '#e5484d' : '#30a46c'); }
      }
      // the paper / envelope glides along the dotted line, hovering a little above the floor, with a short trail
      const rt = routeScreen(sa, sb, off, 0);
      const pos = (q) => { const z = q < 0.5 ? 2 * q * q : 1 - Math.pow(-2 * q + 2, 2) / 2, pt = pointAlong(rt, z); return [pt[0], pt[1] - 13 - Math.sin(Math.PI * Math.min(1, Math.max(0, q))) * 4]; };
      for (let k = 3; k >= 1; k--) { const q = f.p - k * 0.05; if (q < 0) continue; const tp = pos(q); lc.globalAlpha = 0.7 / k; R(lc, Math.round(tp[0]), Math.round(tp[1]), 2, 2, kc); }
      lc.globalAlpha = 1;
      const pp = pos(f.p); draw(pp[0], pp[1]);
    }
    for (const e of entries) if (e.rcv && e.rcv.age >= 0 && e.rcv.age < 2.4 * (scene.slow || 1)) {
      const p = personAnchor(e), bob = Math.floor(Math.sin(e.rcv.age * 8) * 1.2), pop = e.rcv.age < 0.15 ? 0.5 : 1, life = 2.4 * (scene.slow || 1);
      lc.globalAlpha = e.rcv.age > life - 0.4 ? Math.max(0, 1 - (e.rcv.age - (life - 0.4)) / 0.4) : pop;
      msgBubble(lc, p.ax + 15, p.head - 5 + bob, e.rcv.ok === false ? 'err' : 'env');
      lc.globalAlpha = 1;
    }

    const ticketHits = drawTickets(lc, scene.tickets || [], t);

    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(logical, 0, 0, W * S, H * S);

    // text overlays
    for (const e of entries) {
      const s = SLOTS[e.slot], p = personAnchor(e), lp = labelPt(e);
      const sel = e.id === scene.selectedId, labY = lp[1] * S, labX = lp[0];
      const dotCol = STATE_COL[e.state] || '#999', tb = TYPE_BADGE[e.type];
      const nameTxt = '   ' + e.name;
      const nw = measurePill(ctx, nameTxt, U, sel), bw = tb ? measurePill(ctx, tb.text, U * 0.8, true) : 0, gap = tb ? Math.round(3 * U) : 0;
      const left = labX * S - (nw + gap + bw) / 2;
      pillText(ctx, nameTxt, left + nw / 2, labY, U, sel ? '#14151f' : '#fff', sel ? '#f5c542' : 'rgba(20,21,31,.85)', sel);
      ctx.fillStyle = dotCol; ctx.fillRect(Math.round(left + 5 * U), Math.round(labY - 3 * U), Math.round(5 * U), Math.round(5 * U));
      if (tb) pillText(ctx, tb.text, left + nw + gap + bw / 2, labY, U * 0.8, tb.fg, tb.bg, true);
      // tool chip floats just above the head (over the monitor it would cover the face)
      if (e.ask && (!e.away || e.mode === 'ask')) pillText(ctx, 'asks: ' + e.ask, p.ax * S, (p.head - 5) * S, U * 0.9, '#2a1f00', '#ffd23f', true);
      else if (!e.away && e.huddle != null) pillText(ctx, 'team wrap-up', p.ax * S, (p.head - 5) * S, U * 0.9, '#2a1f00', '#f5c542', true);
      else if (!e.away && e.waiting > 0) pillText(ctx, 'waiting on ' + e.waiting + ' helper' + (e.waiting > 1 ? 's' : '') + '.'.repeat(1 + Math.floor(t * 2) % 3), p.ax * S, (p.head - 5) * S, U * 0.9, '#2a1f00', '#f5c542', true);
      else if ((!e.away || e.meet || e.dest === 'pantry' || e.dest === 'bell' || e.dest === 'heat') && e.state === 'working') pillText(ctx, e.tool || 'cooking…', p.ax * S, (p.head - 5) * S, U * 0.9, '#0e1f1a', '#5ff2a5', true);
      if (e.help && !e.away && e.help.desk) {       // "helping <lead>" tag under the name pill
        pillText(ctx, 'helping ' + e.help.parentName + ' · ' + e.help.role, labX * S, (lp[1] + 11) * S, U * 0.72, '#14151f', roleCol(e.help.role), true);
      }
      if (e.help && e.away) {
        const hp = e.help;
        pillText(ctx, e.name + ' · ' + hp.role, p.ax * S, (p.ay + 10) * S, U * 0.72, '#14151f', roleCol(hp.role), true);
        
      }
      if (e.queued) pillText(ctx, '+' + e.queued + ' queued', labX * S, (lp[1] + (e.help && !e.away && e.help.desk ? 21 : 11)) * S, U * 0.85, '#14151f', '#f5c542', true);
      // (speech bubbles are drawn after the loop so overlapping ones can be stacked)
    }
    const bubs = [];
    for (const e of entries) { const bub = e.help && e.help.say ? e.help.say : e.bubble; if (bub) bubs.push({ e, bub, p: personAnchor(e), w: Math.min(Math.max(120 * U, 46 * S) + 12 * U, bub.length * 6.6 * U + 14 * U) }); }
    if (plan) {
      const dp = planDocPos(), pw = (plan.state === 'ready' ? 'PLAN READY' : 'planning…');
      pillText(ctx, plan.state === 'ready' ? '✓ PLAN READY' : pw, dp[0] * S, (dp[1] - 25) * S, U * 0.95, plan.state === 'ready' ? '#0e2a1a' : '#2a1f00', plan.state === 'ready' ? '#6be39b' : '#ffd84a', true);
      const psum = plan.summary && plan.summary.length > 72 ? plan.summary.slice(0, 69) + '…' : plan.summary;
      if (psum && plan.state === 'ready') bubs.push({ e: null, bub: psum, p: { ax: dp[0], head: dp[1] - 15 }, w: Math.min(Math.max(120 * U, 46 * S) + 12 * U, psum.length * 6.6 * U + 14 * U) });
    }
    let board = null;
    if (scene.closed) {   // chalkboard over the staff table, where the plan card floats: KITCHEN CLOSED / Back at HH:MM
      const [bx, by] = planDocPos(), l1 = 'KITCHEN CLOSED', fr = Math.round(3 * U), chalk = '#26332c';
      const w = Math.max(measurePill(ctx, l1, U, true), measurePill(ctx, scene.closed, U, true)), h = Math.round(32 * U);
      const x = Math.round(bx * S - w / 2), y = Math.round(by * S - h);
      ctx.fillStyle = '#5b3a1e'; ctx.fillRect(x - fr, y - fr, w + fr * 2, h + fr * 2);
      ctx.fillStyle = chalk; ctx.fillRect(x, y, w, h);
      pillText(ctx, l1, bx * S, y + Math.round(9 * U), U, '#ffd84a', chalk, true);
      pillText(ctx, scene.closed, bx * S, y + Math.round(23 * U), U, '#f4f1e8', chalk, true);
      board = { x: x - fr, y: y - fr, w: w + fr * 2, h: h + fr * 2 };
    }
    bubs.sort((a, b) => a.p.ax - b.p.ax);
    const placed = board ? [board] : [];   // speech bubbles step up past the board instead of covering it
    for (const b of bubs) {
      const cx = b.p.ax * S; let bottom = (b.p.head - 18) * S;
      for (let k = 0; k < 12; k++) {
        const r = drawBubble(ctx, b.bub, cx, bottom, S, U, canvas.width, true), m = 3 * U;
        if (!placed.some((q) => r.x < q.x + q.w + m && r.x + r.w + m > q.x && r.y < q.y + q.h + m && r.y + r.h + m > q.y)) { placed.push(r); break; }
        bottom -= 8 * U;
      }
      drawBubble(ctx, b.bub, cx, bottom, S, U, canvas.width);
    }
    for (const s of SLOTS) if (!bySlot[s.i] && scene.hoverSlot === s.i) { const lp = labelPt(s); pillText(ctx, '＋ hire', lp[0] * S, lp[1] * S, U, '#0e1f1a', '#5ff2a5', true); }
    // compact column of order tickets, anchored just right of the rail so it clears the PASS sign and the chef
    const tHits = [];
    if (ticketHits.length) {
      const u = U * 0.85, nh = Math.round(15 * u), gap = Math.round(2 * U);
      const lines = ticketHits.map((tk) => tk.name + ': ' + tk.text);
      const nw = Math.max(...lines.map((s) => measurePill(ctx, s, u, true)));
      const hook = A(10.55, 0.55, 24);
      const colRight = Math.min(canvas.width - 4, hook[0] * S + nw * 0.2);
      const cx = colRight - nw / 2;
      let cy = hook[1] * S + nh / 2 + 4 * U;
      for (let i = 0; i < ticketHits.length; i++) {
        const tk = ticketHits[i];
        const fg = tk.state === 'pending' ? '#2a1f00' : tk.state === 'progress' ? '#2a1008' : '#0e2a1a';
        const bg = tk.state === 'pending' ? '#f0d9a0' : tk.state === 'progress' ? '#ffc4b0' : '#b8e8c0';
        pillText(ctx, lines[i], cx, cy, u, fg, bg, true);
        if (tk.state === 'done') { // plated dish on a finished ticket
          const px = Math.round(cx - nw / 2 + 5 * u), py = Math.round(cy);
          ctx.fillStyle = '#f0eee8'; ctx.beginPath(); ctx.arc(px, py, Math.max(2, 3.2 * u), 0, Math.PI * 2); ctx.fill();
          ctx.fillStyle = '#c84830'; ctx.beginPath(); ctx.arc(px, py, Math.max(1, 1.5 * u), 0, Math.PI * 2); ctx.fill();
        }
        tHits.push({ id: tk.id, x: (cx - nw / 2) / S, y: (cy - nh / 2) / S, w: nw / S, h: nh / S, name: tk.name, state: tk.state });
        cy += nh + gap;
      }
    }
    lastTicketHits = tHits;
  }

  /** logical-pixel hit test: front-most object first (same order as drawing). -> {id} | {slot} | null */
  function hitTest(lx, ly, entries) {
    const list = sortObjs(buildObjects(entries, 0, null));
    for (let i = list.length - 1; i >= 0; i--) { const o = list[i]; if (o.hit && o.hit(lx, ly)) return o.res; }
    return null;
  }

  window.OfficeIso = {
    W, H, SLOTS, MAX_SLOTS, render, hitTest, ticketHits: () => lastTicketHits, walkPath, SPOTS, SPEED, STEP: 1,
    drawAvatar: F.drawAvatar, GX, GY, isBlocked, project: (x, y, z) => [sx(x, y), sy(x, y, z || 0)],
    deskPoint: (slot) => { const s = SLOTS[slot]; return [sx(s.desk.x, s.desk.y), sy(s.desk.x, s.desk.y, DESKZ)]; },
    TABLE, SEATS, MGR, MD, COUNTER, PLANTS, SETS, HEAT, stationSet, tablePoint: () => [sx(TABLE.x, TABLE.y), sy(TABLE.x, TABLE.y, TABLE.h)],
    labelPoint: labelPt,
    deskRoute, kindCol, roleCol, roleBadge, ROLE_COL, walkBetween,
    drawOrder: (entries) => sortObjs(buildObjects(entries, 0, null)).map((o) => o.tag || 'other'),   // for tests
  };
})();
