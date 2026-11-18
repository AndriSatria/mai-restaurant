'use strict';
// HD kitchen screenshots: 1920x1080 viewport, deviceScaleFactor 2 -> 3840x2160 PNGs.
//   kitchen-01-idle.png      cooks idle (stretch / read / look / coffee)
//   kitchen-02-working.png   all six line cooks busy at their own sets
//   kitchen-03-headchef.png  close-up of the pass (head chef)
//   kitchen-04-trips.png     cooks at pantry, own station and stove/heat at once
//   kitchen-05-tickets.png   pass rail with pending, in-progress and done tickets
//   kitchen-06-line.png      close view of the two joined counter runs and their six sets
//   kitchen-07-hands.png     the head chef's /code-review: kitchen hands at the pantry, a dish coming back to the pass
//   kitchen-08-approvals.png a line cook and the head chef hold plates up at the pass, "Yes, chef" / "No, chef" in the side panel
//   kitchen-09-resting.png   every plan ran out: the cooks rest at the staff table under the "Back at HH:MM" board
//   kitchen-10-reactions.png a failed run boils a pot over, failed shell commands set the grill and stove on fire, a clicked cook looks up
//   kitchen-11-dining.png    dining room: a diner per project eats at their table while the runner carries the next plate from the pass
//   kitchen-12-flat-dining.png  the same dining room in the flat (?view=flat) view
//   kitchen-13-seven-tables.png seven projects: the seventh table wraps into a fourth row
//   kitchen-14-hands-to-lead.png kitchen hands' dishes go to the lead's table while the lead is still working
//   kitchen-15-bill.png      each finished run leaves a receipt on its table
//   kitchen-16-bill-details.png  hovering a receipt: time, pantry trips, edits, commands, tokens and cost (Claude reports them)
//   kitchen-17-flat-bill.png the flat view with a receipt clicked open
//   kitchen-18-morning.png   ?hour=8: soft morning light (every other shot pins ?hour=12, the lunch rush)
//   kitchen-19-evening.png   ?hour=19: warm evening light, a busy queue steaming on the pass
//   kitchen-20-after-hours.png ?hour=23: the dim after-hours kitchen
//   kitchen-21-staff-board.png  the staff board on the wall: each cook, Claude Code or Cursor, and what they are doing
//   kitchen-22-flat-staff-board.png the same board in the flat view
//   kitchen-23-board-chat.png   a name clicked on the board opens that cook's chat
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'screenshots', 'hd');
const PORT = process.env.SHOT_PORT || 3113;
const DATA = path.join(os.tmpdir(), `mai-restaurant-kitchen-${Date.now()}.json`);
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const teamShots = require('./team-shots');
const { makeFakeClaudeDir } = require('./fake-claude-dir');
const FAKE = makeFakeClaudeDir();
// two more projects so the dining room has three tables
const PROJ = Object.fromEntries(['bistro-api', 'menu-site'].map((n) => { const d = path.join(os.tmpdir(), 'mai-restaurant-shots', n); fs.mkdirSync(d, { recursive: true }); return [n, d]; }));

(async () => {
  const srv = spawn(process.execPath, ['server.js'], { cwd: ROOT, stdio: 'ignore', env: { ...process.env, PORT, HARNESS_MODE: 'mock', HARNESS_DATA: DATA, HARNESS_DEFAULT_CWD: ROOT,
    HARNESS_CLAUDE_DIR: FAKE.dir, HARNESS_CURSOR_DIR: FAKE.cursorDir, HARNESS_CLAUDE_BIN: path.join(__dirname, 'fake-claude.js'), HARNESS_CURSOR_BIN: path.join(__dirname, 'fake-cursor-agent.js'), FAKE_CLAUDE_BG_MS: '2500' } });
  await sleep(1200);
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.error('PAGE ERROR', e));
  page.on('console', (m) => { if (m.type() === 'error') console.error('CONSOLE', m.text()); });
  const shot = async (name) => { await page.screenshot({ path: path.join(OUT, name) }); console.log('saved', name); };
  const id = (n) => page.evaluate((n) => [...window.harness.agents.values()].find((x) => x.name === n).id, n);
  const waitState = (name, want, ms = 25000) => page.waitForFunction(([n, w]) => window.harness.states().some((a) => a.name === n && a.state === w), [name, want], { timeout: ms });
  const sendTo = async (name, text) => {
    await page.evaluate((n) => { const a = [...window.harness.agents.values()].find((x) => x.name === n); window.harness.select(a.id); }, name);
    await page.fill('#input', text); await page.press('#input', 'Enter');
  };
  const slipPoint = (table) => page.evaluate((n) => {
    const d = window.harness.dining().tables.find((t) => t.name === n), h = window.Office.billHits().find((x) => x.cwd === d.cwd), r = document.getElementById('office').getBoundingClientRect();
    return [r.left + (h.x + h.w / 2) / window.Office.W * r.width, r.top + (h.y + h.h / 2) / window.Office.H * r.height];
  }, table);
  const idle = (ms = 30000) => page.waitForFunction(() => window.harness.states().every((a) => !a.away && !a.act && (a.state === 'idle' || a.state === 'done')), null, { timeout: ms });

  try {
    await page.goto(`http://localhost:${PORT}/?wander=off&hour=12`);
    await page.waitForSelector('#conn.on');
    for (const [name, type, cwd] of [['Ada', 'mock', ROOT], ['Linus', 'cursor', ROOT], ['Grace', 'claude', ROOT], ['Ken', 'mock', PROJ['bistro-api']], ['Alan', 'mock', PROJ['bistro-api']], ['Margaret', 'mock', PROJ['menu-site']], ['Barbara', 'mock', PROJ['menu-site']]]) {
      await page.evaluate(([n, t, cwd]) => window.harness.send({ type: 'hire', name: n, cwd, agentType: t }), [name, type, cwd]);
      await page.waitForFunction((n) => window.harness.states().some((a) => a.name === n), name);
      await sleep(150);
    }
    await page.evaluate(() => window.harness.select(null));
    await idle();
    await sleep(400);

    const info = await page.evaluate(() => {
      const c = document.getElementById('office'), r = c.getBoundingClientRect(), O = window.Office;
      return { dpr: devicePixelRatio, backing: [c.width, c.height], css: [r.width, r.height], scale: c.width / O.W, scaleY: c.height / O.H,
        cssMatchesBacking: Math.abs(r.width * devicePixelRatio - c.width) < 0.5 && Math.abs(r.height * devicePixelRatio - c.height) < 0.5 };
    });
    console.log('canvas', JSON.stringify(info));
    if (!(info.dpr === 2 && Number.isInteger(info.scale) && info.scale === info.scaleY && info.cssMatchesBacking)) throw new Error('canvas is not pixel-exact at DPR 2: ' + JSON.stringify(info));

    // 01: idle variety
    await page.evaluate(() => {
      const by = (n) => [...window.harness.agents.values()].find((x) => x.name === n).id;
      window.harness.forceActivity(by('Ada'), 'stretch'); window.harness.forceActivity(by('Linus'), 'read');
      window.harness.forceActivity(by('Grace'), 'look'); window.harness.forceActivity(by('Ken'), 'coffee');
    });
    await sleep(1600);
    await shot('kitchen-01-idle.png');

    // 06: close view of the two joined runs (taken while all six sets are on the counters)
    const lineClip = await page.evaluate(() => {
      const O = window.Office, b = document.getElementById('office').getBoundingClientRect(), k = b.width / O.W;
      const pts = [];
      for (const [x, y, z] of [[1.0, 0.8, 36], [6.2, 0.8, 36], [1.0, 9.3, 0], [6.4, 9.3, 0], [2, 1, 20], [5, 8, 36], [5, 7, 36], [2, 7, 36]]) pts.push(O.project(x, y, z));
      const left = Math.min(...pts.map((p) => p[0])) - 6, right = Math.max(...pts.map((p) => p[0])) + 8;
      const top = Math.min(...pts.map((p) => p[1])) - 4, bot = Math.max(...pts.map((p) => p[1])) + 10;
      return { x: b.x + left * k, y: b.y + top * k, width: (right - left) * k, height: (bot - top) * k };
    });
    console.log('line clip', lineClip);
    await page.screenshot({ path: path.join(OUT, 'kitchen-06-line.png'), clip: lineClip });
    console.log('saved kitchen-06-line.png');

    await page.waitForFunction(() => window.harness.states().every((a) => !a.away && !a.act), null, { timeout: 40000 });

    // 02: all six station sets active
    await page.evaluate(() => {
      for (const a of window.harness.agents.values()) if (a.slot < 6) window.harness.send({ type: 'send', id: a.id, text: 'chop the garnish' });
    });
    await page.waitForFunction(() => {
      const line = window.harness.states().filter((a) => a.slot < 6);
      return line.length === 6 && line.every((a) => a.seated && (a.helping === 'work' || a.state === 'working' || a.cook === 'chop'));
    }, null, { timeout: 20000 });
    await page.evaluate(() => window.harness.select(null));
    await sleep(800);
    await shot('kitchen-02-working.png');


    await waitState('Grace', 'done', 60000);
    await idle();

    // 03: close-up of the head chef / pass
    await page.evaluate(() => window.harness.select(null));
    // wait for leftover speech bubbles to expire, then crop the pass (hood, PASS sign, tickets, bell, chef)
    await sleep(15000);
    const clip = await page.evaluate(() => {
      const O = window.Office, b = document.getElementById('office').getBoundingClientRect(), k = b.width / O.W;
      const pts = [];
      for (const [x, y, z] of [[6.0, -0.15, 56], [9.4, -0.15, 56], [12.0, 0, 56], [5.8, 2.5, 0], [9.5, 2.6, 0], [11.9, 2.2, 0], [8.5, 1.5, 0], [8.9, 2.25, 0], [14.6, 1.9, 0]]) pts.push(O.project(x, y, z));
      const left = Math.min(...pts.map((p) => p[0])) - 4, right = Math.max(...pts.map((p) => p[0])) + 6;
      const top = Math.min(...pts.map((p) => p[1])) - 2, bot = Math.max(...pts.map((p) => p[1])) + 22;
      return { x: b.x + left * k, y: b.y + top * k, width: (right - left) * k, height: (bot - top) * k };
    });
    console.log('headchef clip', clip);
    await page.screenshot({ path: path.join(OUT, 'kitchen-03-headchef.png'), clip });
    console.log('saved kitchen-03-headchef.png');

    // 04: cooks at the pantry (Read), at their station chopping (Edit), and at the stove stirring (Bash)
    await page.evaluate(() => {
      window.harness.select(null);
      for (const a of window.harness.agents.values()) window.harness.send({ type: 'interrupt', id: a.id });
    });
    await idle(20000).catch(() => {});
    await page.evaluate(() => window.harness.select(null));
    await sendTo('Ken', 'browse the stock list');
    await sendTo('Linus', 'browse the pantry shelf');
    await sendTo('Grace', 'chop the garnish');
    await sendTo('Margaret', 'stir the reduction');
    await page.evaluate(() => window.harness.select(null));
    await page.waitForFunction(() => {
      const st = window.harness.states();
      const pantry = st.filter((a) => a.mode === 'pantry');
      const spots = new Set(pantry.map((a) => (a.x || 0).toFixed(1) + ',' + (a.y || 0).toFixed(1)));
      const chop = st.some((a) => a.cook === 'chop' && a.seated);
      const stove = st.some((a) => a.cook === 'stove' && a.seated);
      return pantry.length >= 1 && spots.size === pantry.length && chop && stove;
    }, null, { timeout: 25000 });
    await sleep(800);
    await shot('kitchen-04-trips.png');

    // 05: order tickets on the pass: pending, in progress, and done (plated)
    await page.evaluate(() => {
      window.harness.select(null);
      for (const a of window.harness.agents.values()) window.harness.send({ type: 'interrupt', id: a.id });
    });
    await sleep(6000);
    await sendTo('Linus', 'browse the stock list');
    await sendTo('Linus', 'and then check the dessert menu');
    await sendTo('Linus', 'please also taste the consomme');
    await sendTo('Grace', 'chop the garnish');
    await sendTo('Alan', 'stir the reduction');
    await page.evaluate(() => window.harness.select(null));
    await page.waitForFunction(() => {
      const t = window.harness.tickets();
      return t.some((x) => x.state === 'progress') && t.some((x) => x.state === 'pending');
    }, null, { timeout: 20000 });
    await sendTo('Ada', 'ready the tasting plate');
    await sendTo('Ken', 'ready the soup');
    await page.evaluate(() => window.harness.select(null));
    await page.waitForFunction(() => {
      const t = window.harness.tickets(), s = new Set(t.map((x) => x.state));
      return s.has('pending') && s.has('progress') && t.filter((x) => x.state === 'done').length >= 2;
    }, null, { timeout: 15000 });
    await page.evaluate(() => { for (const a of window.harness.agents.values()) a.bubble = null; });
    await sleep(400);
    await shot('kitchen-05-tickets.png');

    // 07: kitchen hands: the head chef hands out tickets, helpers work where their tool is, finished dishes come back to the pass
    await page.evaluate(() => {
      window.harness.select(null);
      for (const a of window.harness.agents.values()) window.harness.send({ type: 'interrupt', id: a.id });
    });
    await idle(30000).catch(() => {});
    await sleep(6000);
    await sendTo('Ada', '/code-review');
    await page.evaluate(() => window.harness.select(null));
    await page.waitForFunction(() => {
      const st = window.harness.states();
      return st.some((s) => s.carry && s.mode === 'serve') && st.some((s) => s.helping === 'work' && s.away);
    }, null, { timeout: 60000 });
    await sleep(300);
    await shot('kitchen-07-hands.png');
    await page.waitForFunction(() => { const r = window.harness.dining().runner, ada = [...window.harness.agents.values()].find((a) => a.name === 'Ada'); return r && r.carry && r.x > 11.5 && (ada.state !== 'done' || window.harness.states().some((x) => x.helping)); }, null, { timeout: 60000 });
    await shot('kitchen-14-hands-to-lead.png');

    // 08: approvals at the pass
    await page.evaluate(() => { for (const a of window.harness.agents.values()) window.harness.send({ type: 'interrupt', id: a.id }); });
    await idle(30000).catch(() => {});
    await page.waitForFunction(() => window.harness.states().every((s) => !s.helping), null, { timeout: 60000 });
    await sleep(3000);   // helpers keep new messages for a moment after their job
    await sendTo('Grace', 'ask before cleaning');   // Grace runs the fake Claude CLI: the stdio permission prompt
    await sendTo('Ada', 'ask before cleaning');
    await page.evaluate(() => window.harness.select(null));
    await page.waitForFunction(() => {
      const st = window.harness.states();
      return st.filter((s) => s.ask).length === 2 && st.some((s) => s.ask && s.mode === 'ask');
    }, null, { timeout: 60000 });
    await sleep(600);
    await shot('kitchen-08-approvals.png');

    // 09: the plan limit ran out for all three CLIs (mock, Claude, Cursor): the kitchen closes
    await page.evaluate(() => { for (const a of window.harness.agents.values()) window.harness.send({ type: 'interrupt', id: a.id }); });
    await idle(30000).catch(() => {});
    await sleep(2000);
    for (const n of ['Ada', 'Grace', 'Linus']) await sendTo(n, 'limit reached?');
    await page.evaluate(() => window.harness.select(null));
    await page.waitForFunction(() => window.harness.states().every((s) => s.mode === 'rest'), null, { timeout: 60000 });
    await page.evaluate(() => { for (const a of window.harness.agents.values()) a.bubble = null; });
    await sleep(600);
    await shot('kitchen-09-resting.png');

    // 10: small reactions (a run that goes through reopens the kitchen first)
    await sendTo('Ada', 'ready the plate'); await sendTo('Grace', 'hello'); await sendTo('Linus', 'hello');
    await page.evaluate(() => window.harness.select(null));
    await page.waitForFunction(() => !window.harness.closed(), null, { timeout: 30000 });
    await idle(30000);
    await sleep(1500);
    const reacted = (name, key) => page.waitForFunction(([n, k]) => [...window.harness.agents.values()].some((a) => a.name === n && performance.now() - (a[k] || -1e9) < 1500), [name, key], { timeout: 30000 });
    await sendTo('Ken', 'please fail');
    await page.evaluate(() => window.harness.select(null));
    await reacted('Ken', 'errAt');
    await sendTo('Alan', 'burn the steak'); await sendTo('Barbara', 'burn the sauce');
    await page.evaluate(() => window.harness.select(null));
    await reacted('Alan', 'fireAt'); await reacted('Barbara', 'fireAt');
    await page.evaluate(() => { const a = [...window.harness.agents.values()].find((x) => x.name === 'Linus'); window.harness.select(a.id); });
    await page.evaluate(() => { for (const a of window.harness.agents.values()) a.bubble = null; });
    await sleep(300);
    await shot('kitchen-10-reactions.png');

    // 11: dining room: Margaret's dish is on the menu-site table, the runner carries Ken's to bistro-api
    await page.evaluate(() => window.harness.select(null));
    await idle(40000).catch(() => {});
    await page.waitForFunction(() => !window.harness.dining().runner, null, { timeout: 60000 });
    await sendTo('Margaret', 'hello');
    await page.evaluate(() => window.harness.select(null));
    await page.waitForFunction(() => window.harness.dining().tables.some((t) => t.name === 'menu-site' && t.served != null && t.served < 3), null, { timeout: 60000 });
    await sendTo('Ken', 'hello');
    await page.evaluate(() => window.harness.select(null));
    await page.waitForFunction(() => { const r = window.harness.dining().runner; return r && r.carry && r.x > 13.2; }, null, { timeout: 60000 });
    await page.evaluate(() => { for (const a of window.harness.agents.values()) a.bubble = null; });
    await shot('kitchen-11-dining.png');

    // 15 + 16: Grace's Claude run lands on the mai-office table with its receipt; hovering it shows the bill
    await sendTo('Grace', 'fix the flaky retry');
    await page.evaluate(() => window.harness.select(null));
    await page.waitForFunction(() => window.harness.dining().tables.some((t) => t.name === 'mai-office' && t.bill && t.bill.cost != null && t.served != null && t.served < 4), null, { timeout: 90000 });
    await page.evaluate(() => { for (const a of window.harness.agents.values()) a.bubble = null; });
    await shot('kitchen-15-bill.png');
    const [bx, by] = await slipPoint('mai-office');
    await page.mouse.move(bx, by); await sleep(300);
    await shot('kitchen-16-bill-details.png');
    await page.mouse.move(5, 5);

    // 12: flat view: Margaret's plate is on the menu-site table, the runner carries Ken's
    await page.goto(`http://localhost:${PORT}/?wander=off&view=flat&hour=12`);
    await page.waitForSelector('#conn.on');
    await idle(40000).catch(() => {});
    await sendTo('Margaret', 'stir the reduction');
    await page.evaluate(() => window.harness.select(null));
    await page.waitForFunction(() => window.harness.dining().tables.some((t) => t.name === 'menu-site' && t.served != null && t.served < 3), null, { timeout: 60000 });
    await sendTo('Ken', 'browse the stock list');
    await page.evaluate(() => window.harness.select(null));
    await page.waitForFunction(() => { const r = window.harness.dining().runner; return r && r.carry && r.y < 150; }, null, { timeout: 60000 });
    await page.evaluate(() => { for (const a of window.harness.agents.values()) a.bubble = null; });
    await shot('kitchen-12-flat-dining.png');
    // 17: Margaret's receipt clicked open stays open after the mouse leaves
    await page.waitForFunction(() => !window.harness.dining().runner, null, { timeout: 60000 });
    const [fx, fy] = await slipPoint('menu-site');
    await page.mouse.click(fx, fy); await page.mouse.move(5, 5); await sleep(300);
    await shot('kitchen-17-flat-bill.png');

    // 13: seven cooks on seven projects: the seventh table goes into a fourth row
    await page.goto(`http://localhost:${PORT}/?wander=off&hour=12`);
    await page.waitForSelector('#conn.on');
    await page.evaluate(() => { for (const a of window.harness.agents.values()) window.harness.send({ type: 'fire', id: a.id }); });
    await page.waitForFunction(() => window.harness.agents.size === 0);
    const seven = [['Ada', ROOT], ['Linus', PROJ['bistro-api']], ['Grace', PROJ['menu-site']], ...['pos-terminal', 'booking-app', 'pantry-sync', 'loyalty-cards'].map((n, i) => [['Ken', 'Alan', 'Margaret', 'Barbara'][i], path.join(os.tmpdir(), 'mai-restaurant-shots', n)])];
    for (const [name, cwd] of seven) {
      fs.mkdirSync(cwd, { recursive: true });
      await page.evaluate(([n, c]) => window.harness.send({ type: 'hire', name: n, cwd: c, agentType: 'mock' }), [name, cwd]);
      await page.waitForFunction((n) => window.harness.states().some((a) => a.name === n), name);
      await sleep(150);
    }
    await page.evaluate(() => window.harness.select(null));
    for (const id of await page.evaluate(() => [...window.harness.agents.values()].sort((p, q) => p.slot - q.slot).map((a) => a.id))) {   // table order, so the fourth-row plate goes out last
      await page.evaluate((i) => window.harness.send({ type: 'send', id: i, text: 'hello' }), id);
      await sleep(1500);
    }
    await page.waitForFunction(() => { const d = window.harness.dining(); return d.tables.length === 7 && d.tables.filter((t) => t.served != null).length >= 4 && d.runner && d.runner.carry && d.runner.x > 12.2 && d.runner.y > 9; }, null, { timeout: 120000 });
    await page.evaluate(() => { for (const a of window.harness.agents.values()) a.bubble = null; });
    await shot('kitchen-13-seven-tables.png');

    // 18-20: lighting by the clock; for the evening every cook gets two orders so the rail is busy
    for (const [hour, name] of [[8, 'kitchen-18-morning.png'], [19, 'kitchen-19-evening.png'], [23, 'kitchen-20-after-hours.png']]) {
      await page.goto(`http://localhost:${PORT}/?wander=off&hour=${hour}`);
      await page.waitForSelector('#conn.on');
      await idle(60000).catch(() => {});
      if (hour === 19) {
        await page.evaluate(() => { for (const a of window.harness.agents.values()) { window.harness.send({ type: 'send', id: a.id, text: 'fire the mains' }); window.harness.send({ type: 'send', id: a.id, text: 'plate the dessert' }); } });
        await page.waitForFunction(() => window.Office.steam() >= 4, null, { timeout: 20000 });
        await sleep(600);
      } else await sleep(800);
      await page.evaluate(() => { window.harness.select(null); for (const a of window.harness.agents.values()) a.bubble = null; });
      await shot(name);
    }

    // 21-23: staff board with Claude Code and Cursor cooks at work, in both views; then a click on a board name
    await page.evaluate(() => { for (const a of window.harness.agents.values()) window.harness.send({ type: 'fire', id: a.id }); });
    await page.waitForFunction(() => window.harness.agents.size === 0);
    for (const [name, type, cwd] of [['Ada', 'claude', ROOT], ['Linus', 'cursor', ROOT], ['Grace', 'claude', ROOT], ['Ken', 'cursor', PROJ['bistro-api']], ['Margaret', 'claude', PROJ['menu-site']], ['Alan', 'cursor', PROJ['bistro-api']]]) {
      await page.evaluate(([n, t, c]) => window.harness.send({ type: 'hire', name: n, cwd: c, agentType: t }), [name, type, cwd]);
      await page.waitForFunction((n) => window.harness.states().some((a) => a.name === n), name);
      await sleep(150);
    }
    const busyBoard = async () => {
      await idle(60000).catch(() => {});
      await page.evaluate(() => { for (const a of window.harness.agents.values()) if (a.name !== 'Margaret') window.harness.send({ type: 'send', id: a.id, text: 'read the menu and fix the specials page' }); });
      await page.waitForFunction(() => window.harness.staff().filter((r) => r.state === 'working').length >= 3, null, { timeout: 30000 });
      await page.evaluate(() => { window.harness.select(null); for (const a of window.harness.agents.values()) a.bubble = null; });
    };
    await page.goto(`http://localhost:${PORT}/?wander=off&hour=12`);
    await page.waitForSelector('#conn.on');
    await busyBoard();
    await shot('kitchen-21-staff-board.png');
    await page.goto(`http://localhost:${PORT}/?wander=off&view=flat&hour=12`);
    await page.waitForSelector('#conn.on');
    await busyBoard();
    await shot('kitchen-22-flat-staff-board.png');
    await page.goto(`http://localhost:${PORT}/?wander=off&hour=12`);
    await page.waitForSelector('#conn.on');
    await idle(60000).catch(() => {});
    const row = await page.evaluate(() => { const b = document.querySelectorAll('#staffBoard button')[0].getBoundingClientRect(); return [b.left + 30, b.top + b.height / 2]; });
    await page.mouse.click(row[0], row[1]); await sleep(600);
    await shot('kitchen-23-board-chat.png');
  } finally {
    await browser.close(); srv.kill();
  }
})().catch((e) => { console.error(e); process.exit(1); });
