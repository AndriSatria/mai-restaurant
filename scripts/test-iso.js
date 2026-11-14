'use strict';
// Geometry tests for the isometric view: projection-aware hit testing (front-most first), pathfinding around
// furniture, depth ordering of walkers, and real mouse hover/click through the canvas.
// Usage: node scripts/test-iso.js   (needs Playwright + chromium, same as the screenshot script)
const { spawn } = require('child_process');
const path = require('path');
const os = require('os');
const { chromium } = require('playwright');
const ROOT = path.join(__dirname, '..');
const PORT = 3132;
const DATA = path.join(os.tmpdir(), `mai-office-iso-${Date.now()}.json`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const assert = (c, m) => { if (!c) { console.error('FAIL:', m); process.exitCode = 1; } else console.log('ok  :', m); };

(async () => {
  const srv = spawn(process.execPath, ['server.js'], { cwd: ROOT, stdio: 'ignore', env: { ...process.env, PORT, HARNESS_MODE: 'mock', HARNESS_DATA: DATA } });
  await sleep(1000);
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
  page.on('pageerror', (e) => { console.error('PAGE ERROR', e); process.exitCode = 1; });
  try {
    await page.goto(`http://localhost:${PORT}/?wander=off`);
    await page.waitForSelector('#conn.on');
    assert(await page.evaluate(() => window.harness.view === 'iso' && window.Office === window.OfficeIso), 'iso is the default view');

    // ---- hit testing on the projection ----
    const r = await page.evaluate(() => {
      const O = window.Office, out = { empty: [], seated: [], front: null, chair: null, tool: null };
      const mk = (i, extra) => Object.assign({ id: 'a' + i, slot: i, away: false, x: 0, y: 0 }, extra);
      // empty office: every desk top is an empty-slot hit, nothing outside the room is
      for (let i = 0; i < O.MAX_SLOTS; i++) { const [x, y] = O.deskPoint(i); const h = O.hitTest(x, y, []); out.empty.push(h && h.slot === i); }
      out.outside = O.hitTest(5, 5, []);
      // every desk occupied: the person (head) and the desk top each resolve to that agent
      const N = O.MAX_SLOTS, M = O.MGR, all = Array.from({ length: N }, (_, i) => mk(i));
      for (let i = 0; i < N; i++) {
        const s = O.SLOTS[i], [px, py] = O.project(s.seat.x, s.seat.y, 8 + 14);
        const head = O.hitTest(px, py, all), [dx, dy] = O.deskPoint(i), desk = O.hitTest(dx, dy, all);
        out.seated.push(head && head.id === 'a' + i && desk && desk.id === 'a' + i);
      }
      // a walker standing right in front of desk 1 is drawn on top of it and must win the hit test
      const s1 = O.SLOTS[1], wx = s1.dx + 1.5, wy = s1.dy + 1.1;
      const walker = { id: 'w', slot: M - 1, away: true, x: wx, y: wy, face: 1 };
      const list = all.slice(0, M - 1).concat([walker, all[M]]);
      const [fx, fy] = O.project(wx, wy, 14);
      out.front = O.hitTest(fx, fy, list);
      // the same pixel with the walker standing far behind the desk must hit the desk instead
      const back = { id: 'w', slot: M - 1, away: true, x: s1.dx - 0.5 - 1, y: 5.5, face: 0 };
      out.behind = O.hitTest(fx, fy, all.slice(0, M - 1).concat([back, all[M]]));
      // a cook standing at their station is hittable at the standing mark
      const [cx, cy] = O.project(s1.dx - 0.5, s1.dy + 1.0, 4); out.chair = O.hitTest(cx, cy, all);
      out.n = N; return out;
    });
    assert(r.n === 7 && r.empty.every(Boolean), `empty desks are hittable at their projected desk tops (6 desks + the manager desk, ${r.empty.filter(Boolean).length}/${r.n})`);
    assert(r.outside === null, 'floor outside any object is not a hit');
    assert(r.seated.every(Boolean), `seated agents + their desks resolve to the right agent (${r.seated.filter(Boolean).length}/${r.n}, manager desk included)`);
    assert(r.front && r.front.id === 'w', 'a walker in front of a desk is picked before the desk (front-most first)');
    assert(r.behind && r.behind.id === 'a1', 'the desk is picked when the walker is behind it');
    assert(r.chair && r.chair.id === 'a1', 'a cook standing at their station is hittable');

    // ---- furniture footprints never overlap (pass, cafe counter, joined counter runs, standing pads, planning table, plants) ----
    const ov = await page.evaluate(() => {
      const O = window.Office, T = O.TABLE, R = 2.0, fp = [];
      for (const s of O.SLOTS) if (!s.mgr) {
        fp.push(['desk' + s.i, s.dx, s.dy, s.dx + 1, s.dy + 2]);
        fp.push(['stand' + s.i, s.dx - 1, s.dy, s.dx, s.dy + 2]);
      }
      for (const dx of [2, 5]) { fp.push(['join' + dx + 'a', dx, 3, dx + 1, 4]); fp.push(['join' + dx + 'b', dx, 6, dx + 1, 7]); }
      fp.push(['manager desk', O.MD.x0, O.MD.y0, O.MD.x1, O.MD.y1], ['manager stand', O.SLOTS[O.MGR].seat.x - 0.45, 1.1, O.SLOTS[O.MGR].seat.x + 0.45, 1.95]);
      fp.push(['cafe counter', O.COUNTER.x0, O.COUNTER.y0, O.COUNTER.x1, O.COUNTER.y1], ['round table', T.x - R, T.y - R, T.x + R, T.y + R]);
      for (const p of O.PLANTS) fp.push(['plant', p.x + 0.1, p.y + 0.1, p.x + 0.9, p.y + 0.9]);
      const hits = [];
      for (let i = 0; i < fp.length; i++) for (let j = i + 1; j < fp.length; j++) {
        const a = fp[i], b = fp[j];
        if (a[1] < b[3] && b[1] < a[3] && a[2] < b[4] && b[2] < a[4]) hits.push(a[0] + ' x ' + b[0]);
      }
      return { hits, gap: O.COUNTER.x0 - O.MD.x1 };
    });
    assert(ov.hits.length === 0, 'no two pieces of furniture overlap ' + JSON.stringify(ov.hits));
    assert(ov.gap >= 0.9, `a walkable tile separates the manager desk from the cafe counter (gap ${ov.gap} tiles)`);

    // ---- pathfinding avoids furniture; depth order of a walker ----
    const p = await page.evaluate(() => {
      const O = window.Office, bad = [], samples = [];
      let n = 0, axis = true;
      const spots = [...O.SPOTS.coffee, ...O.SPOTS.chat, ...O.SPOTS.pantry, ...O.SPOTS.bell, ...(O.SPOTS.heat || []), ...O.SPOTS.pass];
      for (const s of O.SLOTS) for (const spot of spots) {
        const pts = O.walkPath(s.i, spot); n++;
        const startTiles = new Set(s.start.map(([x, y]) => x + ',' + y));
        startTiles.add(Math.floor(s.seat.x) + ',' + Math.floor(s.seat.y));
        for (let i = 1; i < pts.length; i++) {
          const a = pts[i - 1], b = pts[i];
          const leaving = startTiles.has(Math.floor(a.x) + ',' + Math.floor(a.y));
          if (a.x !== b.x && a.y !== b.y && !leaving) axis = false;
          if (leaving) continue; // leaving the standing post, which is furniture by definition
          const len = Math.max(Math.abs(b.x - a.x), Math.abs(b.y - a.y)), N = Math.ceil(len * 8);
          for (let k = 0; k <= N; k++) {
            const x = a.x + ((b.x - a.x) * k) / N, y = a.y + ((b.y - a.y) * k) / N;
            // walkers occupy a +-0.2 tile radius
            for (const [ox, oy] of [[0, 0], [0.2, 0], [-0.2, 0], [0, 0.2], [0, -0.2]]) if (O.isBlocked(Math.floor(x + ox), Math.floor(y + oy))) bad.push([s.i, x.toFixed(2), y.toFixed(2)]);
            if (k % 8 === 0) samples.push([x, y]);
          }
        }
        const last = pts[pts.length - 1];
        if (Math.abs(last.x - spot.x) > 0.6 || Math.abs(last.y - spot.y) > 0.6) bad.push(['end', s.i]);
      }
      // depth: walking along every path (with the regular desks occupied) the hit at the walker's torso is the walker itself
      // unless a desk/plant that is genuinely in front covers that pixel
      const all = Array.from({ length: O.MGR - 1 }, (_, i) => ({ id: 'a' + i, slot: i, away: false, x: 0, y: 0 }));
      let own = 0, other = 0;
      for (const [x, y] of samples) {
        const [px, py] = O.project(x, y, 16);
        const h = O.hitTest(px, py, all.concat([{ id: 'w', slot: O.MGR - 1, away: true, x, y, face: 0 }]));
        if (h && h.id === "w") own++;
        else {
          const si = h && String(h.id || "").startsWith("a") ? +String(h.id).slice(1) : NaN;
          const seat = Number.isInteger(si) ? O.SLOTS[si].seat : null;
          // a cook genuinely in front of the walker (higher x+y in iso) may cover the torso pixel
          if (seat && seat.x + seat.y > x + y) own++;
          else { other++; (window.__miss = window.__miss || []).push([x.toFixed(2), y.toFixed(2), JSON.stringify(h)]); }
        }
      }
      return { n, slots: O.SLOTS.length, bad: bad.slice(0, 5), axis, own, other, miss: (window.__miss || []).slice(0, 12) };
    });
    assert(p.n === p.slots * 16 && p.bad.length === 0, `${p.n} paths (${p.slots} desks x coffee/chat/pantry/bell/heat/pass spots) never touch blocked tiles ${p.bad.length ? JSON.stringify(p.bad) : ''}`);
    if (p.miss.length) console.log('  misses:', JSON.stringify(p.miss));
    assert(p.axis, 'path segments follow the tile grid (axis aligned)');
    assert(p.own / (p.own + p.other) > 0.97, `walker torso is the front-most hit along paths (${p.own}/${p.own + p.other})`);

    // ---- real mouse through the canvas ----
    // ---- manager desk: hit-test + hire through the dialog; the first hire is the main agent ----
    const mbox0 = await page.locator('#office').boundingBox();
    const [mdx, mdy] = await page.evaluate(([box]) => { const O = window.Office; const [x, y] = O.deskPoint(O.MGR); return [box.x + (x / O.W) * box.width, box.y + (y / O.H) * box.height]; }, [mbox0]);
    await page.mouse.move(mdx, mdy); await sleep(150);
    const MGR = await page.evaluate(() => window.Office.MGR);
    assert((await page.evaluate(() => window.harness.hover.slot)) === MGR, `hovering the (empty) manager desk targets slot ${MGR}`);
    await page.mouse.click(mdx, mdy); await sleep(200);
    assert(await page.evaluate(() => document.getElementById('hireDlg').open && /main/i.test(document.getElementById('hireNote').textContent)), 'clicking the manager desk opens the hire dialog with the "main agent" note');
    await page.fill('#hireName', 'Ada'); await page.click('#hireOk'); await sleep(500);
    const ada0 = await page.evaluate(() => { const a = [...window.harness.agents.values()].find((x) => x.name === 'Ada'); return a && { slot: a.slot, main: a.main }; });
    assert(ada0 && ada0.slot === MGR && ada0.main === true, `hiring at the manager desk makes the first agent main (slot ${MGR})`);
    await page.evaluate(() => window.harness.send({ type: 'hire', name: 'Linus', cwd: '/tmp' })); await sleep(300);
    const lin = await page.evaluate(() => { const a = [...window.harness.agents.values()].find((x) => x.name === 'Linus'); return { slot: a.slot, main: a.main }; });
    assert(lin.slot === 0 && !lin.main, 'the next hire takes a regular desk (slot 0), not the manager desk');
    await sleep(500);
    // the manager at the pass resolves from head and desk hits
    const mh = await page.evaluate(() => {
      const O = window.Office, mgr = { id: 'm', slot: O.MGR, away: false, x: 0, y: 0, main: true }, out = {};
      const [hx, hy] = O.project(O.SLOTS[O.MGR].seat.x, O.SLOTS[O.MGR].seat.y, 8 + 14), [dx, dy] = O.deskPoint(O.MGR);
      out.head = O.hitTest(hx, hy, [mgr]); out.desk = O.hitTest(dx, dy, [mgr]);
      return { head: out.head && out.head.id, desk: out.desk && out.desk.id };
    });
    assert(mh.head === 'm' && mh.desk === 'm', 'manager: head and desk both resolve to the main agent');
    const box = await page.locator('#office').boundingBox();
    const toPage = async (fn) => page.evaluate(([fn, box]) => { const O = window.Office; const [x, y] = eval(fn); return [box.x + (x / O.W) * box.width, box.y + (y / O.H) * box.height]; }, [fn, box]);
    const [hx, hy] = await toPage('O.project(O.SLOTS[0].seat.x, O.SLOTS[0].seat.y, 20)');
    await page.mouse.move(hx, hy); await sleep(150);
    const hov = await page.evaluate(() => window.harness.hover);
    const cursor = await page.evaluate(() => document.getElementById('office').style.cursor);
    assert(hov.id && cursor === 'pointer', 'hovering a seated agent highlights them (pointer cursor)');
    await page.mouse.click(hx, hy); await sleep(150);
    const sel = await page.evaluate(() => window.harness.selected);
    assert(sel && sel === hov.id, 'clicking the person selects that agent');
    const [ex, ey] = await toPage('O.deskPoint(5)');
    await page.mouse.move(ex, ey); await sleep(150);
    assert((await page.evaluate(() => window.harness.hover.slot)) === 5, 'hovering an empty desk targets that slot');
    await page.mouse.click(ex, ey); await sleep(200);
    assert(await page.evaluate(() => document.getElementById('hireDlg').open), 'clicking an empty desk opens the hire dialog');
    await page.keyboard.press('Escape');
    await page.evaluate(() => { const d = document.getElementById('hireDlg'); if (d.open) d.close(); });

    // ---- desk-to-desk routes for the dotted lines / flying papers never cross furniture ----
    const rt = await page.evaluate(() => {
      const O = window.Office, bad = [], offs = [-0.2, -0.1, 0, 0.1, 0.2, 0.32]; let n = 0;
      for (let a = 0; a < O.MAX_SLOTS; a++) for (let b = 0; b < O.MAX_SLOTS; b++) if (a !== b) for (const off of offs) {
        const pts = O.deskRoute(a, b, off); n++;
        for (let i = 1; i < pts.length; i++) {
          const p = pts[i - 1], q = pts[i], N = Math.max(2, Math.ceil(Math.hypot(q[0] - p[0], q[1] - p[1]) * 8));
          for (let k = 0; k <= N; k++) { const x = p[0] + ((q[0] - p[0]) * k) / N, y = p[1] + ((q[1] - p[1]) * k) / N; if (O.isBlocked(Math.floor(x), Math.floor(y))) bad.push([a, b, off, x.toFixed(2), y.toFixed(2)]); }
        }
      }
      return { n, slots: O.MAX_SLOTS, bad: bad.slice(0, 3), nbad: bad.length };
    });
    assert(rt.nbad === 0, `all ${rt.n} desk-to-desk dotted routes (${rt.slots} desks, every pair, every lane) stay on free floor ${JSON.stringify(rt.bad)}`);

    // ---- live /code-review: helpers are kitchen hands: ticket from the lead, trips for their tools, dish back to the pass ----
    for (const n of ['Grace', 'Alan']) { await page.evaluate((n) => window.harness.send({ type: 'hire', name: n, cwd: '/tmp' }), n); await sleep(250); }
    await sleep(500);
    const adaId = await page.evaluate(() => [...window.harness.agents.values()].find((a) => a.name === 'Ada').id);
    await page.evaluate((id) => window.harness.select(id), adaId);
    assert(await page.evaluate(() => !document.getElementById('relayTo').hidden), 'chat shows the send-to-agent select');
    // record anybody who appears at the door
    await page.evaluate(() => { window.__first = {}; window.__n0 = window.harness.agents.size; window.__ids0 = new Set(window.harness.agents.keys()); setInterval(() => { for (const a of window.harness.agents.values()) { const h = window.harness.help(a.id); if (!window.__ids0.has(a.id) && !window.__first[a.name] && h) window.__first[a.name] = { x: h.x, y: h.y, mode: h.mode }; } }, 20); });
    await page.fill('#input', '/code-review'); await page.press('#input', 'Enter');
    await page.waitForFunction((id) => window.harness.states().filter((s) => s.helping === 'work').length >= 4, adaId, { timeout: 40000 });
    const live = await page.evaluate((id) => {
      const H = window.harness, ppl = [...H.agents.values()], helpers = ppl.filter((a) => H.help(a.id));
      const tiles = new Set(helpers.map((a) => a.slot));
      const ada = ppl.find((a) => a.id === id);
      return { n: helpers.length, tiles: tiles.size, roles: helpers.map((a) => H.help(a.id).role).sort(), people: ppl.length, n0: window.__n0, first: window.__first, notAda: !H.help(id),
        sub: document.querySelectorAll('#transcript details.msg.sub').length, open: document.querySelectorAll('#transcript details.msg.sub[open]').length,
        team: document.querySelectorAll('#teamLog .te').length, teamVisible: !document.getElementById('teamBox').hidden,
        tip: H.tooltip(helpers[0].id), names: helpers.map((a) => a.name), hired: ppl.filter((a) => a.transcript.some((m) => /Hired automatically/.test(m.text))).map((a) => a.name) };
    }, adaId);
    assert(live.n === 4 && live.tiles === 4 && live.notAda, `/code-review: 4 people (not the lead), each from a different desk (${live.names.join(',')})`);
    assert(JSON.stringify(live.roles) === JSON.stringify(['performance', 'security', 'style', 'tests']), `helpers carry the 4 derived roles (${live.roles.join(',')})`);
    assert(live.people === live.n0 + 1 && live.hired.length === 1, `office had 3 idle colleagues, so exactly 1 new regular agent was auto-hired (${live.hired.join(',')})`);
    const fp = live.first[live.hired[0]];
    assert(fp && fp.mode === 'walk' && Math.hypot(fp.x - 0.5, fp.y - 4.7) < 0.8, `the auto-hired person first appears walking at the door, not popping in at a desk (${fp ? fp.x.toFixed(2) + ',' + fp.y.toFixed(2) : 'never seen'})`);
    assert(/helping Ada/.test(live.tip), `hover tooltip says who they help ("${live.tip.split('\n')[0]}")`);
    assert(live.sub === 4 && live.open === 0, 'chat: 4 collapsed "↳ helper" lines under the /code-review message');
    assert(live.teamVisible && live.team >= 5, `Team activity feed lists the exchanges (${live.team} lines)`);
    const hid = await page.evaluate((id) => { const H = window.harness; return [...H.agents.values()].filter((a) => H.help(a.id)).map((a) => a.id); }, adaId);
    // a real message typed to a helper waits (queued pill) until the helper job ends
    await page.evaluate(([id]) => window.harness.send({ type: 'send', id, text: 'when you are free: ping me' }), [hid[0]]);
    await sleep(300);
    assert(await page.evaluate((id) => window.harness.agents.get(id).queued >= 1, hid[0]), 'a message to a helping person is queued, not run');
    await page.click('#transcript details.msg.sub summary'); await sleep(200);
    assert(await page.evaluate(() => document.querySelectorAll('#transcript details.msg.sub[open]').length === 1), 'expanding a helper line shows its activity log');
    const subTxt = await page.evaluate(() => document.querySelector('#transcript details.msg.sub summary').textContent);
    assert(/^●Agent\([^)]+\)⎿\w+ · \w+ · (running|done)/.test(subTxt), 'helper reads "● Agent(label)" then "⎿ colleague · role · status": ' + subTxt);
    // flights + inferred interactions during the run
    let kinds = new Set(), sawPeerTalk = false, sawHuddle = false, handTrips = new Set(), served = [], stacked = false;
    for (let i = 0; i < 900 && !(sawHuddle && kinds.has('out') && sawPeerTalk && served.length >= 4); i++) {
      const r = await page.evaluate((id) => ({ st: window.harness.states().filter((s) => s.helping), f: window.harness.flights().map((f) => f.kind), pe: [...window.harness.agents.values()].some((a) => (window.harness.help(a.id) || {}).peer), hu: window.harness.huddle(id) }), adaId);
      const atPass = r.st.filter((s) => s.mode === 'serve').map((s) => s.x.toFixed(1) + ',' + s.y.toFixed(1));
      if (new Set(atPass).size !== atPass.length) stacked = true;
      for (const s of r.st) {
        if (s.helping === 'work' && s.away && (s.dest === 'pantry' || s.dest === 'heat')) handTrips.add(s.dest);
        if (s.mode === 'serve' && s.carry && !served.some((x) => x.id === s.id)) served.push({ id: s.id, x: s.x, y: s.y });
      }
      r.f.forEach((k) => kinds.add(k)); sawPeerTalk = sawPeerTalk || r.pe; sawHuddle = sawHuddle || r.hu; await sleep(60);
    }
    assert(kinds.has('out'), 'the lead hands every helper a ticket (flies lead -> helper)');
    assert(handTrips.has('pantry'), 'kitchen hands walk to the pantry for their Read/Grep jobs: ' + [...handTrips].join(','));
    assert(served.length === 4 && served.every((p) => p.x > 6 && p.x < 10 && p.y < 3), 'every helper carries a dish to the pass when done: ' + JSON.stringify(served.map((p) => [p.x.toFixed(1), p.y.toFixed(1)])));
    assert(!stacked, 'kitchen hands at the pass at the same time stand on different spots');
    assert(sawPeerTalk, 'two helpers touching the same file compare notes via bubbles (inferred peer talk)');
    assert(sawHuddle, 'synchronized wrap-up (celebration at every desk + team wrap-up chip) shows when every helper has reported');
    const inf = await page.evaluate((id) => ({ team: window.harness.team(id), tags: [...document.querySelectorAll('#teamLog .te .inf')].map((e) => e.textContent) }), adaId);
    assert(inf.team.filter((e) => e.kind === 'peer').every((e) => e.inferred) && inf.team.some((e) => e.kind === 'peer') && inf.tags.length >= 1, 'peer entries are flagged inferred and tagged "inferred" in the feed');
    assert(inf.team.some((e) => e.kind === 'handoff' && e.ok === false) && inf.team.some((e) => e.kind === 'huddle'), 'one failing helper is reported in the handoffs; huddle entry exists');
    await page.waitForFunction((id) => window.harness.states().find((a) => a.id === id).state === 'done' || window.harness.states().find((a) => a.id === id).state === 'idle', adaId, { timeout: 60000 });
    await page.waitForFunction(() => window.harness.states().every((a) => !a.helping && (a.home || a.dest === 'pantry' || a.dest === 'bell' || a.dest === 'heat')) && window.harness.flights().length === 0, null, { timeout: 30000 });
    assert(true, 'everybody is released from helper state at their own desk, flights cleaned up');
    const post = await page.evaluate((ids) => ({ sys: ids.map((id) => window.harness.agents.get(id).transcript.some((m) => m.role === 'system' && /^helped Ada: /.test(m.text))),
      ran: window.harness.agents.get(ids[0]).transcript.some((m) => m.role === 'user' && m.text === 'when you are free: ping me'), sub: document.querySelectorAll('#transcript details.msg.sub.finished, #transcript details.msg.sub.failed').length }), hid);
    assert(post.sys.every(Boolean), "each helper's own transcript got a 'helped Ada: …' system line");
    assert(post.ran, 'the queued message ran after the helper job ended');
    assert(post.sub === 4, 'sub lines end as finished/failed');

    // ---- agent-to-agent message: letter flight + forwarded input ----
    await page.selectOption('#relayTo', { label: '→ Linus' });
    await page.fill('#input', 'please look at my diff'); await page.press('#input', 'Enter');
    let sawLetter = false;
    for (let i = 0; i < 20 && !sawLetter; i++) { sawLetter = (await page.evaluate(() => window.harness.flights().map((f) => f.kind))).includes('letter'); await sleep(50); }
    assert(sawLetter, 'sending to another agent flies a letter between the two characters');
    await page.waitForFunction(() => [...window.harness.agents.values()].find((a) => a.name === 'Linus').transcript.some((m) => m.role === 'user' && m.text === '[from Ada] please look at my diff'), null, { timeout: 5000 });
    assert(true, 'target agent receives "[from Ada] …" as input');
    assert(await page.evaluate(() => document.getElementById('relayTo').value === ''), 'send-to select resets to "this agent" after sending');

    // ---- plan mode: the plan owner walks to the round table, idle colleagues join, busy ones stay, then everybody walks home ----
    await page.waitForFunction(() => window.harness.states().every((a) => a.home && !a.helping && a.state !== 'working' && a.state !== 'thinking'), null, { timeout: 40000 });
    const geo = await page.evaluate(() => { const O = window.Office; return { seats: O.SEATS.length, tb: O.tablePoint ? 1 : 0 }; });
    assert(geo.seats >= 6 && geo.seats <= 8, `planning table has ${geo.seats} standing places`);
    const ids0 = await page.evaluate(() => Object.fromEntries([...window.harness.agents.values()].map((a) => [a.name, a.id])));
    const total = Object.keys(ids0).length;
    await page.evaluate((id) => window.harness.select(id), ids0.Grace);
    await page.evaluate((id) => window.harness.send({ type: 'send', id, text: 'refactor everything slowly' }), ids0.Linus);   // Linus is busy -> stays at his desk
    await sleep(500);
    await page.fill('#input', '/plan add a dark mode toggle'); await page.press('#input', 'Enter');
    await page.waitForFunction(() => window.harness.plan().state === 'planning', null, { timeout: 10000 });
    assert(true, 'mock "/plan <task>" puts the agent into plan mode (planning)');
    const want = Math.min(total - 1, geo.seats);
    let sawDrink = false, sawChat = false, linusSeated = false;
    const t0 = Date.now(); let pl;
    for (;;) {
      pl = await page.evaluate(() => ({ p: window.harness.plan(), st: window.harness.states() }));
      sawDrink = sawDrink || pl.st.some((a) => a.mode === 'drink'); sawChat = sawChat || pl.st.some((a) => a.mode === 'chat');
      linusSeated = linusSeated || pl.p.seated.includes(ids0.Linus);
      if (pl.p.seated.length >= want || Date.now() - t0 > 30000 || pl.p.state === null) break;
      await sleep(100);
    }
    const lstate = pl.st.find((a) => a.name === 'Linus');
    assert(pl.p.seated.includes(ids0.Grace) && pl.p.owner === ids0.Grace, 'the plan owner stands at the planning table');
    assert(pl.p.seated.length >= want, `idle colleagues gathered at the table (${pl.p.seated.length} seated of ${total} people, Linus busy)`);
    assert(!linusSeated && !pl.p.seated.includes(ids0.Linus), 'a working colleague stays off the planning table');
    assert(!sawDrink && !sawChat, 'no coffee / chat walks while the team is gathered');
    const seatSet = new Set(await page.evaluate(() => window.harness.states().filter((a) => a.meet).map((a) => a.slot)));
    assert(seatSet.size === pl.p.seated.length, 'every person at the table is in a different standing place');
    await page.waitForFunction(() => window.harness.plan().state === 'ready', null, { timeout: 40000 });
    const rdy = await page.evaluate(() => window.harness.plan());
    assert(rdy.summary && rdy.summary.length > 10 && rdy.seated.length >= want - 1, 'plan ready: summary shown over the table, the team is still seated: ' + rdy.summary);
    await page.waitForFunction(() => window.harness.plan().state === null && window.harness.states().every((a) => a.home), null, { timeout: 60000 });
    assert(true, 'after the plan is approved everybody walks back to their own desk');
    const back = await page.evaluate(() => window.harness.states().every((a) => a.home && a.seated));
    assert(back, 'all people are back at their stations');

    // ---- promote through the UI: swap desks with the current main ----
    await page.evaluate((id) => window.harness.select(id), ids0.Grace);
    assert(await page.evaluate(() => !document.getElementById('mainBtn').hidden), 'a non-main agent shows the "Make main" button');
    const gs = await page.evaluate((id) => window.harness.states().find((a) => a.id === id).slot, ids0.Grace);
    await page.click('#mainBtn'); await sleep(600);
    const sw = await page.evaluate((ids) => ({ g: window.harness.states().find((a) => a.id === ids.Grace), a: window.harness.states().find((a) => a.id === ids.Ada) }), ids0);
    assert(sw.g.main && sw.g.slot === MGR && !sw.a.main && sw.a.slot === gs && sw.g.home && sw.a.home, `Make main: Grace -> manager desk, Ada -> desk ${gs}`);
    assert(await page.evaluate(() => document.getElementById('mainBtn').hidden && !document.getElementById('mainBadge').hidden), 'the main agent shows the ★ main badge instead of the button');

    // ---- tool use becomes a kitchen trip ----
    const tm = await page.evaluate(() => {
      const T = window.harness.toolTrip;
      return {
        read: T('Read'), grep: T('Grep'), glob: T('Glob'), web: T('WebFetch'), search: T('WebSearch'),
        edit: T('Edit'), write: T('Write'), multi: T('MultiEdit'), nb: T('NotebookEdit'),
        bash: T('Bash', 'npm test'), shell: T('Shell', 'ls'),
        push: T('Bash', 'git push origin main'), deploy: T('Bash', 'wrangler deploy'),
        unk: T('TodoWrite'), empty: T(null),
      };
    });
    assert(tm.read === 'pantry' && tm.grep === 'pantry' && tm.glob === 'pantry' && tm.web === 'pantry' && tm.search === 'pantry', 'Read/Grep/Glob/search/web fetch map to the pantry');
    assert(tm.edit === 'chop' && tm.write === 'chop' && tm.multi === 'chop' && tm.nb === 'chop', 'Edit/Write map to chopping at the station');
    assert(tm.bash === 'stove' && tm.shell === 'stove', 'Bash/Shell map to the stove');
    assert(tm.push === 'bell' && tm.deploy === 'bell', 'a git push or deploy rings the bell at the pass');
    assert(tm.unk === null && tm.empty === null, 'unknown tools stay at the station');

    await page.evaluate(() => {
      window.harness.select(null);
      for (const a of window.harness.agents.values()) window.harness.send({ type: 'interrupt', id: a.id });
    });
    await sleep(400);
    const tripIds = await page.evaluate(() => {
      const by = (n) => [...window.harness.agents.values()].find((a) => a.name === n);
      const people = ['Linus', 'Alan', 'Ada'].map(by).filter(Boolean);
      window.harness.send({ type: 'send', id: people[0].id, text: 'browse the stock list' });
      window.harness.send({ type: 'send', id: people[1].id, text: 'chop the garnish' });
      window.harness.send({ type: 'send', id: people[2].id, text: 'stir the reduction' });
      return people.map((a) => ({ id: a.id, name: a.name }));
    });
    await page.waitForFunction((ids) => {
      const st = window.harness.states();
      const by = (id) => st.find((s) => s.id === id);
      const a = by(ids[0].id), b = by(ids[1].id), c = by(ids[2].id);
      return a && (a.dest === 'pantry' || a.mode === 'pantry') && b && b.cook === 'chop' && b.seated && c && c.cook === 'stove' && c.seated;
    }, tripIds, { timeout: 20000 });
    const trips = await page.evaluate((ids) => {
      const st = window.harness.states();
      const by = (id) => st.find((s) => s.id === id);
      const a = by(ids[0].id), b = by(ids[1].id), c = by(ids[2].id);
      const pantry = st.filter((s) => s.dest === 'pantry' || s.mode === 'pantry');
      const pos = pantry.map((s) => (s.x && s.y ? s.x.toFixed(2) + ',' + s.y.toFixed(2) : s.dest));
      return { a: { dest: a.dest, mode: a.mode, tool: a.tool, seated: a.seated }, b: { cook: b.cook, seated: b.seated, tool: b.tool }, c: { cook: c.cook, seated: c.seated, tool: c.tool }, pos, uniq: new Set(pos).size };
    }, tripIds);
    assert(trips.a.dest === 'pantry' || trips.a.mode === 'pantry', 'browse (Read) walks to the pantry: ' + JSON.stringify(trips.a));
    assert(trips.b.cook === 'chop' && trips.b.seated, 'chop (Edit) stays at the station chopping: ' + JSON.stringify(trips.b));
    assert(trips.c.cook === 'stove' && trips.c.seated, 'stir (Bash) stays at the stove: ' + JSON.stringify(trips.c));
    assert(trips.uniq === trips.pos.length, 'cooks at the pantry take different spots: ' + JSON.stringify(trips.pos));

    // Bash at a cold station (sink = slot 0, Linus) walks to a heat aisle
    await page.evaluate(() => {
      window.harness.select(null);
      for (const a of window.harness.agents.values()) window.harness.send({ type: 'interrupt', id: a.id });
    });
    await sleep(400);
    const sinkId = await page.evaluate(() => [...window.harness.agents.values()].find((a) => a.name === 'Linus').id);
    await page.evaluate((id) => window.harness.send({ type: 'send', id, text: 'stir the reduction' }), sinkId);
    await page.waitForFunction((id) => {
      const s = window.harness.states().find((a) => a.id === id);
      return s && (s.dest === 'heat' || s.mode === 'heat') && s.cook === 'stove';
    }, sinkId, { timeout: 20000 });
    const heatTrip = await page.evaluate((id) => {
      const s = window.harness.states().find((a) => a.id === id);
      return { dest: s.dest, mode: s.mode, cook: s.cook, x: s.x, y: s.y, seated: s.seated };
    }, sinkId);
    assert(heatTrip.dest === 'heat' || heatTrip.mode === 'heat', 'Bash at a sink station walks to a heat aisle: ' + JSON.stringify(heatTrip));

    // ---- order tickets on the pass ----
    await page.evaluate(() => {
      window.harness.select(null);
      for (const a of window.harness.agents.values()) window.harness.send({ type: 'interrupt', id: a.id });
    });
    await sleep(400);
    const tCooks = await page.evaluate(() => {
      const by = (n) => [...window.harness.agents.values()].find((a) => a.name === n);
      const linus = by('Linus'), ada = by('Ada') || by('Grace');
      window.harness.send({ type: 'send', id: linus.id, text: 'browse the stock list' });
      window.harness.send({ type: 'send', id: linus.id, text: 'and then check the dessert menu' });
      window.harness.send({ type: 'send', id: ada.id, text: 'ready the tasting plate' });
      return { linus: linus.id, ada: ada.id, linusName: linus.name, adaName: ada.name };
    });
    await page.waitForFunction((ids) => {
      const t = window.harness.tickets();
      const states = new Set(t.map((x) => x.state));
      return t.some((x) => x.id === ids.linus && x.state === 'progress') && t.some((x) => x.id === ids.linus && x.state === 'pending') && (states.has('done') || t.some((x) => x.id === ids.ada && x.state === 'progress'));
    }, tCooks, { timeout: 20000 });
    await page.waitForFunction((ids) => window.harness.tickets().some((x) => x.id === ids.ada && x.state === 'done') && window.harness.tickets().some((x) => x.state === 'progress') && window.harness.tickets().some((x) => x.state === 'pending'), tCooks, { timeout: 20000 });
    const tk = await page.evaluate(() => {
      const t = window.harness.tickets();
      return { n: t.length, states: t.map((x) => x.state), names: t.map((x) => x.name), texts: t.map((x) => x.text), hits: window.harness.ticketHits().length };
    });
    assert(tk.n >= 3 && tk.n <= 8, 'the rail shows the open tickets (at most 8): ' + tk.n);
    assert(tk.states.includes('pending') && tk.states.includes('progress') && tk.states.includes('done'), 'pending, in-progress and done tickets are all on the rail: ' + tk.states.join(','));
    assert(tk.texts.every((s) => s.length <= 29), 'ticket prompts are truncated: ' + JSON.stringify(tk.texts));
    assert(tk.hits >= 3, 'each visible ticket has a hit box');
    const clicked = await page.evaluate((ids) => {
      const h = window.harness.ticketHits().find((x) => x.id === ids.linus);
      return h;
    }, tCooks);
    assert(clicked, 'Linus has a clickable ticket');
    const tkSel = await page.evaluate((h) => {
      window.harness.select(null);
      const c = document.getElementById('office'), r = c.getBoundingClientRect(), O = window.Office;
      const ev = new MouseEvent('click', { bubbles: true, clientX: r.x + ((h.x + h.w / 2) / O.W) * r.width, clientY: r.y + ((h.y + h.h / 2) / O.H) * r.height });
      c.dispatchEvent(ev);
      return window.harness.selected;
    }, clicked);
    assert(tkSel === tCooks.linus, 'clicking a ticket selects that cook and opens their chat (got ' + tkSel + ')');
    await page.evaluate(() => window.harness.select(null));

    // ---- approvals at the pass: the cook walks up with the plate raised, "Yes, chef" in the side panel answers ----
    await page.evaluate(() => { for (const a of window.harness.agents.values()) window.harness.send({ type: 'interrupt', id: a.id }); });
    await sleep(400);
    const askId = await page.evaluate(() => { const a = [...window.harness.agents.values()].find((x) => x.name === 'Linus'); window.harness.send({ type: 'send', id: a.id, text: 'ask before cleaning' }); return a.id; });
    await page.waitForFunction((id) => { const s = window.harness.states().find((a) => a.id === id); return s && s.ask && s.mode === 'ask'; }, askId, { timeout: 20000 });
    const ap = await page.evaluate((id) => {
      const s = window.harness.states().find((a) => a.id === id), box = document.getElementById('asks');
      const btns = [...box.querySelectorAll('button')], r = box.getBoundingClientRect(), chat = document.getElementById('chat').getBoundingClientRect();
      return { x: s.x, y: s.y, shown: !box.hidden, text: box.textContent, labels: btns.map((b) => b.getAttribute('aria-label')), inside: r.left >= chat.left && r.right <= chat.right && box.scrollWidth <= box.clientWidth };
    }, askId);
    assert(ap.x > 6 && ap.x < 10 && ap.y < 3, 'an asking cook stands at the pass: ' + ap.x.toFixed(2) + ',' + ap.y.toFixed(2));
    assert(ap.shown && /Linus asks to run Bash rm -rf dist/.test(ap.text) && ap.labels.join() === 'Approve Bash for Linus,Reject Bash for Linus', 'the side panel lists the request with labelled Yes / No buttons: ' + ap.text);
    assert(ap.inside, 'the approvals box fits the side panel without overflow');
    await page.click('#asks button.green');
    await page.waitForFunction((id) => { const s = window.harness.states().find((a) => a.id === id); return s && !s.ask && document.getElementById('asks').hidden; }, askId, { timeout: 10000 });
    assert(true, '"Yes, chef" clears the request and the box hides');
    await page.waitForFunction((id) => [...window.harness.agents.get(id).transcript].some((m) => m.text === 'Approved: Bash'), askId, { timeout: 10000 });
    assert(true, 'the chat records "Approved: Bash"');

    // ---- plan limit: every cook rests at the staff table, the board shows when the kitchen opens again ----
    await page.evaluate((id) => window.harness.send({ type: 'send', id, text: 'limit reached?' }), askId);
    await page.waitForFunction(() => window.harness.states().every((s) => s.mode === 'rest'), null, { timeout: 30000 });
    const rest = await page.evaluate(() => {
      const O = window.Office, st = window.harness.states();
      return { closed: window.harness.closed(), note: document.getElementById('closedNote').textContent,
        atTable: st.every((s) => O.SEATS.some((q) => Math.hypot(q.x - s.x, q.y - s.y) < 0.01)), seats: new Set(st.map((s) => s.x.toFixed(2) + ',' + s.y.toFixed(2))).size, n: st.length };
    });
    assert(rest.atTable && rest.seats === rest.n, `limited cooks stand at their own staff-table spots (${rest.seats}/${rest.n})`);
    assert(/^Back (at|[A-Z][a-z]{2} \d+,) \d\d:\d\d$/.test(rest.closed) && rest.note.includes(rest.closed), 'the board and the status line give the reset time: ' + rest.closed);
    await page.evaluate((id) => window.harness.send({ type: 'send', id, text: 'ready the plate' }), askId);
    await page.waitForFunction(() => !window.harness.closed() && window.harness.states().every((s) => !s.away), null, { timeout: 30000 });
    assert(true, 'a run that goes through reopens the kitchen and the cooks walk back');

    // ---- chat panel: Claude Code style formatting stays safe (model text is never parsed as HTML) ----
    await page.evaluate((id) => window.harness.select(id), ids0.Grace);
    await page.waitForFunction(() => !document.getElementById('stopBtn').offsetParent, null, { timeout: 30000 }).catch(() => {});
    await page.fill('#input', '<img src=x onerror=window.__xss=1>'); await page.press('#input', 'Enter');
    await page.waitForFunction(() => [...document.querySelectorAll('#transcript .msg.assistant')].some((e) => e.textContent.includes('<img src=x')), null, { timeout: 30000 });
    const xs = await page.evaluate(() => {
      const t = document.getElementById('transcript'), box = document.createElement('div');
      const md = '# T\n<script>window.__xss=2</script>\n[click](javascript:window.__xss=3) [ok](https://example.com)\n\n```html\n<b onclick="x()">bold</b>\n```\n\n| a | b |\n|---|---|\n| ' + 'wide '.repeat(40) + ' | 2 |';
      box.appendChild(ChatFmt.renderMsg(document, { role: 'assistant', text: md }, {}));
      box.appendChild(ChatFmt.renderMsg(document, { role: 'tool', tool: 'Bash', input: { command: 'npm test' }, status: 'ok', out: 'l1\nl2\nl3\nl4\nl5\nl6' }, {}));
      box.id = 'xssBox'; t.appendChild(box);
      const links = [...box.querySelectorAll('a')];
      const r = { img: t.querySelectorAll('img').length, script: t.querySelectorAll('script').length, xss: window.__xss, hrefs: links.map((a) => a.getAttribute('href')), rel: links.every((a) => /noopener/.test(a.rel)),
        code: box.querySelector('.md-code code').textContent, bold: box.querySelectorAll('.md-code b').length, lang: box.querySelector('.md-lang').textContent, overflow: t.scrollWidth - t.clientWidth,
        user: [...t.querySelectorAll('.msg.user')].pop().textContent };
      window.__box = box;
      return r;
    });
    assert(xs.img === 0 && xs.script === 0 && xs.xss === undefined, 'HTML in prompts, replies and markdown renders as text: no <img>/<script> elements, nothing ran');
    assert(JSON.stringify(xs.hrefs) === '["https://example.com/"]' && xs.rel, 'javascript: link dropped, the https link kept with rel=noopener: ' + JSON.stringify(xs.hrefs));
    assert(xs.code === '<b onclick="x()">bold</b>' && xs.bold === 0 && xs.lang === 'html', 'HTML inside a fenced code block is shown as text under its language label');
    assert(xs.overflow <= 0, `a wide table scrolls inside its own box, the 380px chat panel has no horizontal overflow (${xs.overflow}px)`);
    assert(xs.user.startsWith('> ') && xs.user.includes('<img'), 'user prompt renders as "> message"');
    await page.focus('#xssBox .cc-more'); await page.keyboard.press('Enter');
    const exp = await page.evaluate(() => { const b = window.__box; const r = { lines: b.querySelectorAll('.cc-ol').length, more: b.querySelectorAll('.cc-more').length }; b.remove(); return r; });
    assert(exp.lines === 5 && exp.more === 0, `"… +N lines" expands from the keyboard (${exp.lines} output lines)`);

    // integer pixel scale
    const sc = await page.evaluate(() => { const c = document.getElementById('office'); return [c.width / window.Office.W, c.height / window.Office.H]; });
    assert(Number.isInteger(sc[0]) && sc[0] === sc[1], `canvas is scaled by an integer factor (x${sc[0]})`);
  } finally {
    await browser.close(); srv.kill('SIGTERM');
  }
})().catch((e) => { console.error(e); process.exit(1); });
