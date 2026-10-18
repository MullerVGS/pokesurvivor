/* One-second skill hover, cancellation, compact geometry and explicit navigation. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { chromium } = require('playwright');
const url = process.env.UI_TEST_URL || 'http://127.0.0.1:3095/dev.html';
const out = process.env.INSPECTION_ARTIFACTS || '/tmp/pokesurvivor-frlg-hover';
(async () => {
  const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || undefined, args: ['--no-sandbox'] });
  const errors = [], passed = [];
  fs.mkdirSync(out, { recursive: true });
  async function open(lang, touch = false) {
    const page = await browser.newPage({ viewport: { width: touch ? 667 : 1280, height: touch ? 375 : 800 }, hasTouch: touch, serviceWorkers: 'block' });
    page.on('pageerror', e => errors.push(e.message));
    await page.addInitScript(lang => localStorage.setItem('ps.lang', lang), lang);
    await page.goto(url + '?preview=collection');
    await page.waitForFunction(() => window.G?.Game && document.querySelector('#boot.hidden'));
    await page.waitForFunction(() => !document.getElementById('tap-start').classList.contains('hidden') || !document.getElementById('scr-menu').classList.contains('hidden'));
    if (await page.locator('#tap-start').isVisible()) await page.locator('#tap-start').click();
    return page;
  }
  try {
    for (const lang of ['es', 'en']) {
      const page = await open(lang);
      await page.locator('[data-go=upgrades]').click();
      await page.locator('[data-upgrade=hp]').hover(); await page.waitForTimeout(750);
      assert.equal(await page.evaluate(() => G.Tooltip.isOpen), false);
      assert.equal(await page.locator('.tip').count(), 0);
      await page.keyboard.press('KeyT');
      assert(await page.locator('.inspection-screen').isVisible());
      await page.keyboard.press('Escape');
      assert(await page.locator('.inspection-screen').isHidden());
      await page.locator('#upg-mon').focus(); await page.keyboard.press('KeyT');
      assert.equal(await page.evaluate(() => G.Tooltip.isOpen), false, 'T remains a native select key');
      await page.evaluate(() => { G.UI.hideAll(); G.Game.startRun(); G.Game.debugSpeed(0); G.Game.player.addMove('ember'); G.Game.player.setActive(0); });
      await page.waitForTimeout(150);
      const point = await page.evaluate(() => { const r = G.BattlePanels.dockLayout(innerWidth, innerHeight).slots[0]; return { x: r.x + r.w / 2, y: r.y + r.h / 2 }; });
      await page.mouse.move(point.x, point.y); await page.waitForTimeout(750);
      assert.equal(await page.evaluate(() => G.Tooltip.isOpen), false);
      assert.equal(await page.evaluate(() => G.InfoPanel.peekOpen), false, 'hover waits the full second');
      await page.waitForTimeout(350);
      assert.equal(await page.evaluate(() => G.InfoPanel.peekOpen), true);
      assert.equal(await page.evaluate(() => G.Tooltip.holds()), false, 'passive hover does not pause combat');
      assert.equal(await page.locator('.skill-peek').evaluate(e => getComputedStyle(e).pointerEvents), 'none');
      assert.equal(await page.locator('.skill-peek .skill-move-row .type-badge').count(), 1);
      await page.screenshot({path: `${out}/hover-${lang}-1280.png`});
      await page.mouse.move(2, 2);
      assert.equal(await page.evaluate(() => G.InfoPanel.peekOpen), false);
      await page.mouse.move(point.x, point.y); await page.waitForTimeout(650);
      const second = await page.evaluate(() => { const r = G.BattlePanels.dockLayout(innerWidth, innerHeight).slots[1]; return { x: r.x + r.w / 2, y: r.y + r.h / 2 }; });
      await page.mouse.move(second.x, second.y); await page.waitForTimeout(600);
      assert.equal(await page.evaluate(() => G.InfoPanel.peekOpen), false, 'switching skills restarts the delay');
      await page.waitForTimeout(500);
      assert.match(await page.locator('.skill-peek .skill-move-row b').innerText(), lang === 'en' ? /Ember/ : /Ascuas/);
      for (const [width, height] of [[667, 375], [390, 844]]) {
        await page.setViewportSize({ width, height });
        const q = await page.evaluate(() => {const r=G.BattlePanels.dockLayout(innerWidth,innerHeight).slots[0];return {x:r.x+r.w/2,y:r.y+r.h/2};});
        await page.mouse.move(q.x,q.y); await page.waitForTimeout(1100);
        assert(await page.locator('.skill-peek').isVisible());
        assert(await page.locator('.skill-peek').evaluate(e=>{const r=e.getBoundingClientRect();return r.left>=0&&r.top>=0&&r.right<=innerWidth&&r.bottom<=innerHeight;}));
        await page.screenshot({path: `${out}/hover-${lang}-${width}.png`});
      }
      await page.setViewportSize({width:1280,height:800});
      await page.mouse.move(point.x, point.y);

      await page.keyboard.press('KeyT');
      assert(await page.locator('.inspection-screen').isVisible());
      assert.equal(await page.evaluate(() => G.Tooltip.holds()), true);
      await page.keyboard.press('Digit2'); await page.waitForTimeout(80);
      assert.equal(await page.evaluate(() => G.Game.player.active), 0, 'inspection keys do not switch attacks');
      await page.keyboard.press('Escape');
      assert.equal(await page.evaluate(() => G.Tooltip.holds()), false);
      await page.waitForTimeout(80);
      assert.equal(await page.evaluate(() => G.Game.player.active), 0, 'inspection keys do not carry over after close');
      await page.evaluate(() => G.Tooltip.show('move:ember'));
      const before = await page.evaluate(() => JSON.stringify(G.Game.player.moves));
      const link = page.locator('.inspection-content [data-info-source="movelevel:ember:3"]');
      await link.hover(); await page.waitForTimeout(600);
      assert.match(await page.locator('.inspection-content .preview-caption').innerText(), /1/);
      await link.click();
      assert.match(await page.locator('.inspection-content .preview-caption').innerText(), /3/);
      assert.equal(await page.locator('.inspection-screen:not([hidden])').count(), 1);
      assert.equal(await page.locator('.tip').count(), 0);
      assert.equal(await page.evaluate(() => G.MovePreview.count), 1);
      assert.equal(await page.evaluate(() => JSON.stringify(G.Game.player.moves)), before);
      await page.locator('.inspection-content .readout-back').click();
      assert.match(await page.locator('.inspection-content .preview-caption').innerText(), /1/);
      for (const [width, height] of [[1280, 800], [667, 375], [390, 844]]) {
        await page.setViewportSize({ width, height });
        assert(await page.evaluate(() => {
          const b = document.querySelector('[data-inspection-close]'); const r = b.getBoundingClientRect();
          document.querySelector('.inspection-content .readout-body').scrollTop = 10000;
          const after = b.getBoundingClientRect();
          return after.top === r.top && r.top >= 0 && r.bottom <= innerHeight && r.right <= innerWidth;
        }));
        await page.evaluate(() => document.querySelector('.inspection-content .readout-body').scrollTop = 0);
        await page.screenshot({ path: `${out}/inspection-${lang}-${width}.png` });
      }
      await page.locator('[data-inspection-close]').click();
      assert.equal(await page.evaluate(() => G.MovePreview.count), 0);
      await page.evaluate(() => { G.Game.player.fuse([...G.Game.player.moves]); G.Tooltip.show('slot:0'); });
      await page.locator('.preview-moves').focus(); await page.keyboard.press('KeyT');
      assert.equal(await page.evaluate(() => G.Tooltip.isOpen), true, 'T inside the preview selector stays native');
      await page.keyboard.press('Escape');
      assert.equal(await page.evaluate(() => G.Tooltip.isOpen), false);
      await page.evaluate(() => { window.coopActive = Object.getOwnPropertyDescriptor(G.Coop, 'active'); Object.defineProperty(G.Coop, 'active', { configurable: true, get: () => true }); G.Tooltip.show('move:ember'); });
      assert.equal(await page.evaluate(() => G.Tooltip.holds()), false, 'co-op inspection does not pause simulation');
      assert.match(await page.locator('.inspection-note').innerText(), lang === 'en' ? /continues/ : /continúa/);
      await page.evaluate(() => { Object.defineProperty(G.Coop, 'active', coopActive); G.UI.show('scr-menu'); });
      assert.equal(await page.evaluate(() => G.Tooltip.isOpen), false, 'screen transitions close inspection');
      passed.push(`${lang}: skills wait one second, moving away cancels, switching resets delay, nonblocking compact popup, explicit T, native fields, game shortcuts blocked while inspecting, one panel with history, preview isolation/release, visible close desktop/mobile, solo pause and co-op continues`);
      await page.close();
    }
    const page = await open('es', true);
    await page.locator('[data-go=upgrades]').tap();
    const rect = await page.locator('[data-upgrade=hp] .upg-title').boundingBox();
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: rect.x + 20, y: rect.y + 10 }] });
    await page.waitForTimeout(650);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    assert(await page.locator('.inspection-screen').isVisible());
    assert.equal(await page.evaluate(() => G.DB.save.coins), 500);
    await page.locator('[data-inspection-close]').tap();
    assert.equal(await page.evaluate(() => G.Tooltip.isOpen), false);
    await page.close(); passed.push('Touch: deliberate long press opens one inspection screen, no purchase, visible close');
    assert.deepEqual(errors, []);
    fs.writeFileSync(`${out}/inspection-validation.json`, JSON.stringify({ passed, errors }, null, 2));
    console.log(JSON.stringify({ passed, errors }, null, 2));
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
