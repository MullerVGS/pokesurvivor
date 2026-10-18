/* Browser regression checks for the flash when returning from a legendary arena.
 * RIFT_TEST_URL=http://127.0.0.1:3096/dev.html node tools/test-rift.cjs
 * Optional: PLAYWRIGHT_CHROMIUM_EXECUTABLE for an installed Chromium.
 */
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const URL = process.env.RIFT_TEST_URL || 'http://127.0.0.1:3096/dev.html';

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || undefined, args: ['--no-sandbox'] });
  const errors = [];
  async function pageFor(uid) {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, serviceWorkers: 'block' });
    page.on('pageerror', e => errors.push(e.message));
    page.on('console', m => { if (m.type() === 'error' && m.text().includes('[Game]')) errors.push(m.text()); });
    await page.addInitScript(() => {
      window.requestAnimationFrame = fn => { if (fn.name === 'loop') window.runFrame = fn; return 0; };
    });
    if (uid) await page.route('**/js/net/net.js', route => route.fulfill({ contentType: 'application/javascript', body: `
      window.packets = [];
      G.Net = { uid: ${JSON.stringify(uid)}, on(fn) { window.receivePacket = fn; }, onPeer() {}, slow() { return false; },
        send(to, msg) { packets.push({ from: this.uid, to, msg }); }, toHost(msg) { this.send('host', msg); },
        close() {}, peers() { return []; }, mode() { return 'direct'; } };
    ` }));
    await page.goto(URL);
    await page.waitForFunction(() => G.Game && document.querySelector('#boot.hidden'), null, { polling: 50 });
    await page.evaluate(() => {
      document.getElementById('tap-start').classList.add('hidden');
      G.DB.playAsGuest(); G.DB.save.partner = 25;
      let ts = performance.now();
      window.step = (count = 1, ms = 1000 / 60) => { for (let i = 0; i < count; i++) runFrame(ts += ms); };
      window.check = (v, msg) => { if (!v) throw Error(msg); };
      window.fresh = cfg => { G.Tooltip.hide(); G.Game.startRun(cfg); G.Game.player.addMove('ember'); step(); };
      window.pink = () => {
        const cv = document.getElementById('game'), ctx = cv.getContext('2d');
        return [[10, 10], [cv.width / 2, cv.height / 2], [cv.width - 10, cv.height - 10]]
          .every(([x, y]) => [...ctx.getImageData(x, y, 1, 1).data].join(',') === '201,166,255,255');
      };
      window.winRift = () => {
        G.EnemyMgr.get(G.Rift.arena.bossId).hurt(1e9, '#fff', 0, 0, 0, null, G.Game.player);
        G.Rift.update(0.01, G.Game.player, G.Game.st.time);
      };
      window.returnFromRift = () => G.Rift.update(5.1, G.Game.player, G.Game.st.time);
    });
    return page;
  }
  try {
    const page = await pageFor();
    await page.evaluate(() => {
      fresh(); G.Rift.debugArena('psychic'); winRift(); returnFromRift(); step();
      check(G.Game.state === 'choice' && G.UI.isOpen('scr-bond'), 'bond choice opens after victory');
      check(pink(), 'return starts with the rift flash');
      const time = G.Game.st.time;
      step(90);
      check(G.Game.st.time === time && G.Game.state === 'choice', 'gameplay stays paused for the choice');
      check(!pink(), 'rift flash must fade while choosing a bond');
    });
    await page.locator('#bond-cards .card').first().click();
    await page.locator('#bond-cards .card').first().click();
    await page.evaluate(() => {
      check(G.Game.state === 'playing' && !G.UI.isOpen('scr-bond'), 'selection resumes the run');
      check(G.Game.player.bonds === 0 && G.Game.player.slots.some(s => s.length === 2), 'one reward spent on the fusion');
    });
    console.log('PASS legendary victory: flash fades during bond choice, clicks fuse and resume');

    for (const mode of ['pause', 'levelup', 'tooltip', 'over']) {
      await page.evaluate(mode => {
        fresh(); G.Rift.debugArena('psychic');
        if (mode === 'pause') G.Game.togglePause();
        if (mode === 'levelup') G.Game.debugLevelUp();
        if (mode === 'tooltip') G.Tooltip.show('move:ember', 600, 200, { pin: true });
        if (mode === 'over') G.Game.quit();
        step(); check(pink(), 'entry flash visible before it fades');
        const time = G.Game.st.time, state = G.Game.state;
        step(90);
        check(G.Game.st.time === time && G.Game.state === state, 'gameplay must remain paused');
        check(!pink(), 'flash fades in ' + mode);
      }, mode);
      console.log('PASS flash expires while gameplay is stopped:', mode);
    }
    await page.evaluate(() => {
      fresh(); G.Rift.debugArena('psychic'); G.Game.togglePause(); step();
      check(pink(), 'visible flash before a slow frame'); step(1, 2000);
      check(!pink() && G.Game.state === 'paused', 'flash follows elapsed time even at low FPS');
      fresh(); G.Game.flash('#c9a6ff', 0.9); G.Game.startRun(); step();
      check(!pink(), 'new run does not inherit the previous flash');
    });
    console.log('PASS low FPS and new-run flash reset');

    const host = await pageFor('host'), guest = await pageFor('guest');
    const pages = { host, guest };
    const cfg = { seed: 42, host: 'host', members: [{ uid: 'host', name: 'Host', dex: 25 }, { uid: 'guest', name: 'Guest', dex: 25 }] };
    async function exchange() {
      for (let turn = 0; turn < 3; turn++) for (const p of Object.values(pages)) {
        const packets = await p.evaluate(() => { G.Coop.tick(0.1); return window.packets.splice(0); });
        for (const packet of packets) await pages[packet.to].evaluate(o => receivePacket(o.from, o.msg), packet);
      }
    }
    for (const p of Object.values(pages)) await p.evaluate(cfg => fresh(cfg), cfg);
    await exchange();
    await host.evaluate(() => { G.Rift.debugArena('psychic'); winRift(); });
    await exchange();
    // The guest returns first and starts a shared hold while the host is still in the arena.
    await guest.evaluate(() => { returnFromRift(); step(); check(pink(), 'guest return flash'); });
    await exchange();
    await host.evaluate(() => { check(G.Game.state === 'held', 'host waits for guest choice'); step(90); check(!pink(), 'held host flash fades'); });
    await guest.evaluate(() => { step(90); check(!pink(), 'guest choice flash fades'); });
    await guest.locator('#bond-cards .card').first().click();
    await guest.locator('#bond-cards .card').first().click();
    await exchange();
    await host.evaluate(() => { check(G.Game.state === 'playing', 'host resumes'); returnFromRift(); });
    await exchange();
    for (const p of Object.values(pages)) await p.evaluate(() => { step(90); check(!pink(), 'no persistent flash while team chooses'); });
    await host.locator('#bond-cards .card').first().click();
    await host.locator('#bond-cards .card').first().click();
    await exchange();
    for (const p of Object.values(pages)) await p.evaluate(() => {
      check(G.Game.state === 'playing' && !G.Rift.inArena, 'both players return and resume');
      check(G.Game.player.bonds === 0 && G.Game.player.slots.some(s => s.length === 2), 'both players keep their fusion');
    });
    console.log('PASS co-op staggered arena return, shared hold, both bond selections and resume');
    assert.deepEqual(errors, []);
    console.log('All rift regression checks passed.');
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
