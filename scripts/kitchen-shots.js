'use strict';
// HD kitchen screenshots: 1920x1080 viewport, deviceScaleFactor 2 -> 3840x2160 PNGs.
//   kitchen-01-idle.png      cooks idle (stretch / read / look / coffee)
//   kitchen-02-working.png   several cooks busy, including a /code-review with helpers
//   kitchen-03-headchef.png  close-up of the pass (head chef)
//   kitchen-04-trips.png     cooks at pantry, own station and stove/heat at once
//   kitchen-05-tickets.png   pass rail with pending, in-progress and done tickets
//   kitchen-06-line.png      close view of the two joined counter runs and their six sets
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
  const idle = (ms = 30000) => page.waitForFunction(() => window.harness.states().every((a) => !a.away && !a.act && (a.state === 'idle' || a.state === 'done')), null, { timeout: ms });

  try {
    await page.goto(`http://localhost:${PORT}/?wander=off`);
    await page.waitForSelector('#conn.on');
    for (const [name, type] of [['Ada', 'mock'], ['Linus', 'cursor'], ['Grace', 'claude'], ['Ken', 'mock'], ['Alan', 'mock'], ['Margaret', 'mock'], ['Barbara', 'mock']]) {
      await page.evaluate(([n, t, cwd]) => window.harness.send({ type: 'hire', name: n, cwd, agentType: t }), [name, type, ROOT]);
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

    // 02: all six station sets active, including a /code-review with helpers at their own sets
    await sendTo('Grace', '/code-review');
    await page.waitForFunction(() => {
      const H = window.harness;
      const helpers = [...H.agents.values()].filter((a) => { const h = H.help(a.id); return h && h.phase === 'work' && h.seated; });
      return helpers.length >= 4;
    }, null, { timeout: 40000 });
    await page.evaluate(() => {
      const H = window.harness;
      const rest = [...H.agents.values()].filter((a) => a.slot < 6 && a.name !== 'Grace' && !H.help(a.id));
      for (const a of rest) H.send({ type: 'send', id: a.id, text: 'chop the garnish' });
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
      for (const [x, y, z] of [[6.0, -0.15, 56], [9.4, -0.15, 56], [12.0, 0, 56], [5.8, 2.5, 0], [9.5, 2.6, 0], [11.9, 2.2, 0], [8.5, 1.5, 0], [8.9, 2.25, 0]]) pts.push(O.project(x, y, z));
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
  } finally {
    await browser.close(); srv.kill();
  }
})().catch((e) => { console.error(e); process.exit(1); });
