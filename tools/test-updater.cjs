/* Browser regression checks for manual updates. Start the local server first.
 * UPDATE_TEST_URL=http://127.0.0.1:3098/dev.html node tools/test-updater.cjs
 * Requires Playwright; PLAYWRIGHT_CHROMIUM_EXECUTABLE can select a local browser.
 */
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const URL = process.env.UPDATE_TEST_URL || 'http://127.0.0.1:3098/dev.html';
const CURRENT = '0000000000', NEXT = '1111111111';

(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || undefined, args: ['--no-sandbox'] });
  const errors = [];
  async function fixture(lang = 'en') {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, serviceWorkers: 'block' });
    let manifest = { v: CURRENT }, status = 200, navigations = 0, requests = 0;
    page.on('pageerror', e => errors.push(e.message));
    page.on('framenavigated', frame => { if (frame === page.mainFrame()) navigations++; });
    await page.clock.install();
    await page.addInitScript(lang => { localStorage.setItem('ps.lang', lang); window.requestAnimationFrame = () => 0; }, lang);
    // The development page exposes G. An inert tag gives the real updater a
    // published version without loading the production bundle a second time.
    await page.route('**/dev.html', async route => {
      const response = await route.fetch();
      const html = (await response.text()).replace('<script defer src="js/core/updater.js">',
        `<script type="application/json" src="js/app.min.js?v=${CURRENT}"></script><script defer src="js/core/updater.js">`);
      await route.fulfill({ response, body: html });
    });
    await page.route(url => url.pathname.endsWith('/version.json'), route => { requests++; return route.fulfill({ status, json: manifest }); });
    await page.goto(URL);
    await page.waitForFunction(() => window.G?.Game && document.getElementById('boot').classList.contains('hidden'));
    await page.evaluate(() => {
      document.getElementById('tap-start').classList.add('hidden');
      G.DB.playAsGuest(); G.DB.save.partner = 25; G.Flow.goMenu();
    });
    return {
      page, button: page.locator('#btn-update'),
      manifest(value, code = 200) { manifest = value; status = code; },
      get navigations() { return navigations; }, get requests() { return requests; },
      check() { return page.evaluate(() => G.Updater.check()); }
    };
  }
  async function delayedSave(page) {
    await page.evaluate(() => {
      window.flushCalls = 0;
      Object.defineProperty(G.DB, 'syncState', { get: () => 'pending' });
      G.DB.flush = () => { flushCalls++; return new Promise(resolve => { window.finishSave = resolve; }); };
    });
  }
  try {
    const f = await fixture();
    await f.check(); assert(await f.button.isHidden(), JSON.stringify(await f.page.evaluate(() => ({version:G.Updater.version,pending:G.Updater.pending,button:document.getElementById("btn-update").outerHTML}))) + " requests=" + f.requests);
    f.manifest({}, 503); await f.check(); assert(await f.button.isHidden());
    f.manifest({ v: NEXT }); await f.page.clock.fastForward(5 * 60 * 1000);
    await f.page.waitForFunction(() => G.Updater.pending);
    assert(await f.button.isVisible()); assert.equal(await f.button.textContent(), 'Update game');
    await f.page.clock.runFor(15000); assert.equal(f.navigations, 1);
    await f.page.clock.fastForward(20 * 60 * 1000); assert.equal(f.navigations, 1);
    assert(f.requests >= 3);
    console.log('PASS same version, retry after HTTP failure, background discovery, no timed reload');
    for (const [width, height] of [[1280, 800], [390, 844], [844, 390]]) {
      await f.page.setViewportSize({ width, height });
      await f.button.scrollIntoViewIfNeeded();
      const b = await f.button.boundingBox();
      assert(b && b.x >= 0 && b.y >= 0 && b.x + b.width <= width && b.y + b.height <= height);
    }
    await f.page.setViewportSize({ width: 1280, height: 800 });
    await f.page.screenshot({ path: '/tmp/pokesurvivor-manual-update-menu.png' });
    console.log('PASS update button fits desktop, portrait mobile and landscape mobile');
    await f.page.evaluate(() => G.UI.show('scr-lobby'));
    assert(await f.button.isHidden());
    await f.page.evaluate(() => document.getElementById('btn-update').click());
    assert.equal(f.navigations, 1);
    await f.page.evaluate(() => G.Flow.goMenu());
    await delayedSave(f.page);
    await f.button.click(); assert(await f.button.isDisabled());
    await f.page.evaluate(() => document.getElementById('btn-update').click());
    assert.equal(await f.page.evaluate(() => flushCalls), 1); assert.equal(f.navigations, 1);
    const reload = f.page.waitForEvent('framenavigated', frame => frame === f.page.mainFrame());
    await f.page.evaluate(() => finishSave()); await reload;
    assert.equal(f.navigations, 2); await f.page.close();
    console.log('PASS lobby cannot update; explicit click waits for save and reloads once');

    const forced = await fixture('es');
    await forced.page.evaluate(() => G.Game.startRun());
    forced.manifest({ v: NEXT, force: true }); await forced.check();
    await forced.page.clock.runFor(20000);
    assert.equal(await forced.page.evaluate(() => G.Game.state), 'playing');
    assert(await forced.button.isHidden()); assert.equal(forced.navigations, 1);
    await forced.page.evaluate(() => G.Flow.goMenu());
    assert(await forced.button.isVisible()); assert.equal(await forced.button.textContent(), 'Actualizar juego');
    await forced.page.clock.runFor(15000); assert.equal(forced.navigations, 1);
    await delayedSave(forced.page); await forced.button.click();
    await forced.page.evaluate(() => { G.Game.startRun(); finishSave(); });
    await forced.page.waitForFunction(() => !document.getElementById('btn-update').disabled);
    assert.equal(forced.navigations, 1); assert.equal(await forced.page.evaluate(() => G.Game.state), 'playing');
    await forced.page.evaluate(() => G.Flow.goMenu()); assert(await forced.button.isVisible());
    await forced.page.close();
    console.log('PASS legacy force ignored during a run and in menu; leaving menu cancels pending reload');

    const offline = await fixture(); offline.manifest({ v: NEXT }); await offline.check();
    await delayedSave(offline.page); await offline.button.click();
    await offline.page.clock.runFor(5999); assert.equal(offline.navigations, 1);
    const reloadAfterTimeout = offline.page.waitForEvent('framenavigated', frame => frame === offline.page.mainFrame());
    await offline.page.clock.runFor(2); await reloadAfterTimeout;
    assert.equal(offline.navigations, 2); await offline.page.close();
    console.log('PASS explicit update has a bounded wait when cloud sync stalls');
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
