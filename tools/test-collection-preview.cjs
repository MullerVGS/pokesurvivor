/* Collection preview is a fresh guest fixture, only enabled on dev.html. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { chromium } = require('playwright');
const url = process.env.UI_TEST_URL || 'http://127.0.0.1:3095/dev.html';
const out = process.env.PREVIEW_ARTIFACTS || '/tmp/pokesurvivor-advanced-types';
(async () => {
  fs.mkdirSync(out, { recursive: true });
  const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || undefined, args: ['--no-sandbox'] });
  const errors = [], passed = [];
  try {
    for (const lang of ['es', 'en']) {
      const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, serviceWorkers: 'block' });
      const requests = [];
      page.on('pageerror', e => errors.push(e.message));
      page.on('request', r => requests.push(r.url()));
      await page.addInitScript(lang => localStorage.setItem('ps.lang', lang), lang);
      await page.goto(url + '?preview=collection');
      await page.waitForFunction(() => window.G?.Game && document.querySelector('#boot.hidden'));
      await page.waitForFunction(() => !document.getElementById('tap-start').classList.contains('hidden') || !document.getElementById('scr-menu').classList.contains('hidden'));
      if (await page.locator('#tap-start').isVisible()) await page.locator('#tap-start').click();
      const state = await page.evaluate(() => ({ owned: Object.keys(G.DB.save.owned).length, total: G.DEX.length,
        guest: G.DB.guest, commit: G.DB.commit(), portraits: !!G.Portraits,
        storedSaves: Object.keys(localStorage).filter(k => k.startsWith('ps.save.') || k.startsWith('ps.cloud.')) }));
      assert.equal(state.owned, 966); assert.equal(state.total, 966); assert(state.guest);
      assert.equal(state.commit, false); assert.equal(state.portraits, false); assert.deepEqual(state.storedSaves, []);
      await page.waitForFunction(() => document.getElementById('menu-partner').getContext('2d').getImageData(0, 0, 100, 100).data.some(v => v));
      assert(requests.some(u => u.includes('/assets/pokemon/25/')));
      assert(!requests.some(u => u.includes('/assets/pokemon-ui/')));
      assert.equal(new Set(requests.filter(u => u.includes('/assets/ui/types/'))).size, 18);
      await page.screenshot({ path: `${out}/menu-${lang}.png` });
      await page.locator('[data-go=dex]').click();
      assert.equal(await page.locator('#dex-grid .cell.locked').count(), 0);
      await page.locator('#dex-type-toggle').click();
      await page.locator('[data-type=water]').click();
      assert(await page.locator('[data-type=dragon]').isDisabled());
      await page.locator('#dex-gens button').nth(1).click();
      await page.locator('[data-type=dragon]').click();
      assert.deepEqual(await page.locator('#dex-grid .cell').evaluateAll(cs => cs.map(c => +c.dataset.dex)), [230]);
      assert.equal(await page.locator('#dex-type-options button:disabled').count(), 16);
      assert.equal(await page.evaluate(() => G.DB.save.partner), 25);
      await page.mouse.move(5, 5); await page.evaluate(() => G.Tooltip.hide());
      await page.waitForTimeout(300);
      await page.screenshot({ path: `${out}/water-dragon-${lang}.png` });
      for (const [width, height] of [[844, 390], [667, 375], [390, 844]]) {
        await page.setViewportSize({ width, height }); await page.waitForTimeout(250);
        const layout = await page.evaluate(() => ({
          overflow: document.documentElement.scrollWidth > innerWidth,
          iconsVisible: [...document.querySelectorAll('.dex-type-option')].every(b => { const r = b.getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight; }),
          gridHeight: document.getElementById('dex-grid').clientHeight
        }));
        assert(!layout.overflow); assert(layout.iconsVisible); assert(layout.gridHeight > 60);
        await page.screenshot({ path: `${out}/water-dragon-${lang}-${width}.png` });
      }
      await page.setViewportSize({ width: 844, height: 390 });
      await page.locator('#dex-pick').click();
      assert.equal(await page.evaluate(() => G.DB.save.partner), 230);
      await page.locator('#scr-dex [data-back]').click();
      await page.evaluate(() => { G.UI.hideAll(); G.Game.startRun(); G.Game.debugSpeed(0); });
      await page.waitForTimeout(500); await page.screenshot({ path: `${out}/hud-${lang}.png` });
      assert.deepEqual(await page.evaluate(() => Object.keys(localStorage).filter(k => k.startsWith('ps.save.') || k.startsWith('ps.cloud.'))), []);
      passed.push(`${lang}: 966 Pokémon unlocked in guest memory, original sprites, 18 official symbols, AND filters, max-two, full icon row and selectable result on desktop/mobile, HUD`);
      await page.close();
    }
    const normal = await browser.newPage({ serviceWorkers: 'block' });
    await normal.goto(url); await normal.waitForFunction(() => window.G?.Game && document.querySelector('#boot.hidden'));
    assert.equal(await normal.evaluate(() => G.CollectionPreview.start()), false);
    assert.equal(await normal.evaluate(() => G.DB.guest), false);
    await normal.close();
    assert.deepEqual(errors, []);
    fs.writeFileSync(`${out}/validation.json`, JSON.stringify({ passed, errors }, null, 2));
    console.log(JSON.stringify({ passed, errors, artifacts: out }, null, 2));
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
