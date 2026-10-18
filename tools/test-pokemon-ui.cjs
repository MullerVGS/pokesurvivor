/* UI_TEST_URL=http://127.0.0.1:3095/dev.html node tools/test-pokemon-ui.cjs
 * Guest fixtures only; validates collection navigation and the fixed FRLG profile.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { chromium } = require('playwright');
const url = process.env.UI_TEST_URL || 'http://127.0.0.1:3095/dev.html';
const artifacts = process.env.UI_ARTIFACTS || '/tmp/pokesurvivor-pokemon-ui';
async function checkMovePopup(page, label) {
  const move = page.locator('.summary-move').last();
  await move.scrollIntoViewIfNeeded(); await move.focus();
  const state = () => page.evaluate(() => ({
    scroll: [...document.querySelectorAll('#scr-dex .dialog-body, #dex-grid, .summary-body')].map(el => el.scrollTop),
    move: document.activeElement.dataset.summaryMove, partner: G.DB.save.partner,
    filters: [...document.querySelectorAll('#scr-dex [aria-pressed="true"]')].map(el => el.outerHTML)
  }));
  const before = await state();
  await page.keyboard.press('Enter');
  const popup = page.locator('.inspection-screen');
  assert(await popup.isVisible()); assert(await page.locator('#dex-grid').isVisible());
  assert.equal(await page.locator('#dex-detail .readout, .summary-move-view').count(), 0);
  assert.equal(await page.evaluate(() => G.MovePreview.count), 1);
  await page.mouse.move(2, 2); await page.waitForTimeout(100);
  assert(await popup.isVisible(), 'click pins the popup after leaving the move');
  const content = await popup.locator('.readout-body').innerText();
  assert.equal(await popup.locator('.skill-owner b').innerText(), await page.locator('#dex-detail h3').innerText());
  await popup.locator('[data-info-source]').first().click();
  await popup.locator('.readout-back').click();
  assert(await popup.locator('.move-preview canvas').isVisible());
  const close = await popup.locator('[data-inspection-close]').boundingBox();
  assert(close && close.y >= 0 && close.y + close.height <= page.viewportSize().height);
  await page.screenshot({ path: `${artifacts}/move-popup-${label}.png` });
  await popup.locator('[data-inspection-close]').click();
  assert.deepEqual(await state(), before, `${label}: closing preserves collection scroll, focus and filters`);
  assert.equal(await page.evaluate(() => G.MovePreview.count), 0);
  // The click/Enter route must be exactly the same interactive content as T.
  await page.keyboard.press('KeyT');
  assert(await popup.isVisible());
  assert.equal(await popup.locator('.readout-body').innerText(), content);
  await page.keyboard.press('KeyT');
  assert(await popup.isHidden());
  await page.keyboard.press('Enter'); await page.keyboard.press('Escape');
  assert(await popup.isHidden()); assert.deepEqual(await state(), before);
}
(async () => {
  fs.mkdirSync(artifacts, { recursive: true });
  const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || undefined, args: ['--no-sandbox'] });
  const errors = [], passed = [];
  try {
    for (const lang of ['es', 'en']) {
      const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, serviceWorkers: 'block' });
      page.on('pageerror', e => errors.push(e.message));
      await page.addInitScript(lang => localStorage.setItem('ps.lang', lang), lang);
      await page.goto(url);
      await page.waitForFunction(() => window.G?.Game && document.querySelector('#boot.hidden'));
      await page.waitForFunction(() => !document.getElementById('tap-start').classList.contains('hidden') || !document.getElementById('scr-login').classList.contains('hidden'));
      if (await page.locator('#tap-start').isVisible()) await page.locator('#tap-start').click();
      await page.evaluate(() => {
        document.getElementById('tap-start').classList.add('hidden');
        G.DB.playAsGuest(); G.DB.save.partner = 25;
        for (const dex of [4, 25]) G.DB.save.owned[dex] = { at: Date.now(), from: 'starter' };
        G.DB.save.shiny[25] = { at: Date.now(), from: 'wild' };
        G.Flow.goMenu();
      });
      const profile = await page.evaluate(() => {
        const families = new Set();
        for (let i = 0; i < 6; i++) { G.SoundLibrary.enter(i % 2 ? 'forest' : 'cave'); families.add(G.SoundLibrary.era); }
        return { font: [...document.fonts].some(f => f.family === 'PokemonGen3' && f.status === 'loaded'), family: getComputedStyle(document.body).fontFamily,
          theme: document.documentElement.dataset.ui, families: [...families].sort(), trial: !!G.FrlgPrototype };
      });
      assert(profile.font); assert.match(profile.family, /PokemonGen3/); assert.equal(profile.theme, 'frlg'); assert(!profile.trial);
      assert.deepEqual(profile.families, ['ds', 'gb', 'gba']);
      await page.waitForTimeout(3000); // let the fixture's first-partner achievement finish
      assert.equal(await page.evaluate(() => !!G.Portraits), false);
      await page.screenshot({ path: `${artifacts}/menu-${lang}.png` });
      await page.locator('[data-go=dex]').click();
      await page.locator('[data-dex="1"]').click();
      assert.equal(await page.locator('#dex-detail h3').textContent(), '???');
      assert.equal(await page.locator('#dex-detail .stat, #dex-detail [data-summary-move], #dex-detail .type').count(), 0);
      assert.equal(await page.locator('#dex-pick').count(), 0);
      await page.locator('[data-dex="4"]').focus();
      await page.keyboard.press('Enter');
      assert.equal(await page.evaluate(() => G.DB.save.partner), 25);
      assert.equal(await page.locator('#dex-detail h3').textContent(), 'Charmander');
      await page.keyboard.press('ArrowRight');
      assert.equal(await page.locator('#dex-grid :focus').getAttribute('data-dex'), '5');
      assert.equal(await page.evaluate(() => G.DB.save.partner), 25);
      await page.locator('[data-dex="25"]').click();
      await page.locator('#dex-detail [data-v="1"]').click();
      assert.equal(await page.evaluate(() => !!G.DB.save.partnerShiny), false);
      await page.locator('#dex-pick').click();
      assert.equal(await page.evaluate(() => G.DB.save.partnerShiny), true);
      await page.locator('[data-dex="4"]').click();
      await page.locator('#dex-pick').click();
      assert.equal(await page.evaluate(() => G.DB.save.partner), 4);
      assert.equal(await page.evaluate(() => G.DB.save.partnerShiny), false);
      await page.locator('.summary-move').first().click();
      assert(await page.locator('.inspection-screen .move-preview canvas').isVisible());
      assert.equal(await page.locator('.tip').count(), 0);
      assert.equal(await page.evaluate(() => G.Tooltip.isOpen), true);
      assert.equal(await page.evaluate(() => G.DB.save.partner), 4);
      await page.evaluate(() => G.Tooltip.hide());
      await checkMovePopup(page, `${lang}-1280`);
      await page.locator('[data-filter="own"]').click();
      assert.equal(await page.locator('#dex-grid .cell').count(), 2);
      assert.equal(await page.locator(':focus').getAttribute('data-filter'), 'own');
      await page.locator('#scr-dex [data-back]').click();
      await page.locator('[data-go=dex]').click();
      assert.equal(await page.locator('[data-filter="own"]').getAttribute('aria-pressed'), 'true');
      assert.equal(await page.locator('#dex-detail h3').textContent(), 'Charmander');
      await page.locator('[data-filter="all"]').click();
      const gridDex = () => page.locator('#dex-grid .cell').evaluateAll(cells => cells.map(c => +c.dataset.dex));
      assert.equal(await page.locator('#dex-type-toggle').getAttribute('aria-expanded'), 'false');
      await page.locator('#dex-type-toggle').focus(); await page.keyboard.press('Enter');
      assert.equal(await page.locator('#dex-type-toggle').getAttribute('aria-expanded'), 'true');
      assert.equal(await page.locator('#dex-type-options button').count(), 18);
      await page.locator('[data-type="electric"]').focus(); await page.keyboard.press('Space');
      assert.deepEqual(await gridDex(), [25, 26, 81, 82, 100, 101, 125, 135, 145]);
      assert.equal(await page.locator(':focus').getAttribute('data-type'), 'electric');
      assert.equal(await page.locator('#dex-matches').textContent(), '9');
      await page.locator('[data-filter="own"]').click(); assert.deepEqual(await gridDex(), [25]);
      await page.locator('[data-filter="shiny"]').click(); assert.deepEqual(await gridDex(), [25]);
      await page.locator('[data-filter="5"]').click(); assert.deepEqual(await gridDex(), [145]);
      assert.equal(await page.locator('#dex-detail h3').textContent(), '???');
      assert.equal(await page.locator('#dex-pick, #dex-detail .stat').count(), 0);
      await page.locator('[data-filter="all"]').click();
      await page.locator('#dex-gens button').nth(1).click();
      assert.equal(await page.locator('[data-type="electric"]').getAttribute('aria-pressed'), 'true');
      assert((await gridDex()).includes(170));
      await page.locator('#dex-gens button').first().click();
      await page.locator('#dex-type-clear').click();
      await page.locator('[data-type="water"]').click();
      assert(await page.locator('[data-type="dragon"]').isDisabled()); // no Water/Dragon in Kanto
      await page.locator('[data-type="dragon"]').evaluate(button => button.click());
      assert.equal(await page.locator('#dex-type-options [aria-pressed="true"]').count(), 1);
      await page.locator('#dex-gens button').nth(1).click();
      assert(await page.locator('[data-type="dragon"]').isEnabled());
      await page.locator('[data-type="dragon"]').click();
      assert.deepEqual(await gridDex(), [230]); // Water AND Dragon, not the union
      assert.equal(await page.locator('#dex-type-options button:disabled').count(), 16);
      assert(await page.locator('[data-type="water"]').isEnabled());
      assert(await page.locator('#dex-gens button').first().isDisabled());
      assert(await page.locator('[data-filter="own"]').isDisabled());
      await page.locator('#scr-dex [data-back]').click(); await page.locator('[data-go=dex]').click();
      assert.deepEqual(await gridDex(), [230]);
      assert.equal(await page.locator('#dex-type-options [aria-pressed="true"]').count(), 2);
      await page.locator('[data-type="dragon"]').click();
      assert(await page.locator('[data-type="electric"]').isEnabled());
      await page.locator('#dex-type-clear').click();
      await page.locator('#dex-gens button').first().click();
      await page.locator('[data-type="grass"]').click(); await page.locator('[data-type="poison"]').click();
      assert.deepEqual(await gridDex(), [1, 2, 3, 43, 44, 45, 69, 70, 71]);
      await page.locator('#dex-type-clear').click();
      await page.locator('[data-type="fire"]').click(); await page.locator('[data-filter="own"]').click();
      assert.deepEqual(await gridDex(), [4]);
      assert(await page.locator('[data-type="ice"]').isDisabled());
      assert(await page.locator('[data-type="flying"]').isDisabled());
      assert.equal(await page.evaluate(() => G.DB.save.partner), 4);
      await page.locator('#dex-type-clear').click(); await page.locator('[data-filter="all"]').click();
      assert.equal((await gridDex()).length, 151);
      await page.locator('#dex-type-toggle').click();
      assert.equal(await page.locator('#dex-type-toggle').getAttribute('aria-expanded'), 'false');
      await page.locator('[data-dex="4"]').click();
      await page.waitForTimeout(2300);
      await page.screenshot({ path: `${artifacts}/summary-${lang}.png` });
      for (const [width, height] of [[844, 390], [667, 375], [390, 844]]) {
        await page.setViewportSize({ width, height }); await page.waitForTimeout(200);
        const bounds = await page.evaluate(() => {
          const footer = document.querySelector('.summary-footer');
          const body = document.querySelector('.summary-body');
          const before = footer.getBoundingClientRect().top; body.scrollTop = body.scrollHeight;
          return { before, after: footer.getBoundingClientRect().top, overflow: document.documentElement.scrollWidth > innerWidth };
        });
        assert.equal(bounds.before, bounds.after); assert.equal(bounds.overflow, false);
        await page.locator('#dex-pick').scrollIntoViewIfNeeded();
        const pick = await page.locator('#dex-pick').boundingBox();
        assert(pick && pick.y >= 0 && pick.y + pick.height <= height);
        await page.screenshot({ path: `${artifacts}/summary-${lang}-${width}.png` });
        await checkMovePopup(page, `${lang}-${width}`);
      }
      await page.setViewportSize({ width: 844, height: 390 });
      await page.evaluate(() => { G.UI.hideAll(); G.Game.startRun(); G.Game.debugSpeed(0); G.RunUI.showPause(); });
      assert.match(await page.locator('#pause-partner').innerText(), /Charmander/);
      const resume = await page.locator('#btn-resume').boundingBox();
      assert(resume && resume.y >= 0 && resume.y + resume.height <= 390);
      await page.waitForTimeout(250);
      await page.screenshot({ path: `${artifacts}/pause-${lang}.png` });
      await page.evaluate(() => G.RunUI.showOver({dead:true,time:312,level:12,kills:120,bosses:2,coins:340,breakdown:'120 + 220',moves:G.Game.player.moves,caught:[],record:false},()=>{}));
      const back = await page.locator('#btn-again').boundingBox();
      assert(back && back.y >= 0 && back.y + back.height <= 390);
      await page.waitForTimeout(250);
      await page.screenshot({ path: `${artifacts}/result-${lang}.png` });
      passed.push(`${lang}: fixed profile, font, original animated sprites, official type symbols, AND filters, keyboard, explicit partner selection, click/Enter opens the T popup, glossary navigation, close/Escape/T, preserved collection scroll/focus/filters, desktop/landscape/portrait, pause and result`);
      await page.close();
    }
    const touch = await browser.newPage({ viewport: { width: 667, height: 375 }, hasTouch: true, serviceWorkers: 'block' });
    touch.on('pageerror', e => errors.push(e.message));
    await touch.goto(url); await touch.waitForFunction(() => window.G?.Game && document.querySelector('#boot.hidden'));
    await touch.waitForFunction(() => !document.getElementById('tap-start').classList.contains('hidden') || !document.getElementById('scr-login').classList.contains('hidden'));
    if (await touch.locator('#tap-start').isVisible()) await touch.locator('#tap-start').tap();
    await touch.evaluate(() => { document.getElementById('tap-start').classList.add('hidden'); G.DB.playAsGuest(); G.DB.save.partner = 25; G.DB.save.owned[25] = {at:Date.now(),from:'starter'}; G.Flow.goMenu(); });
    await touch.locator('[data-go=dex]').tap();
    await touch.locator('#dex-type-toggle').tap();
    await touch.locator('[data-type="electric"]').tap();
    await touch.locator('[data-filter="own"]').tap();
    assert.equal(await touch.locator('#dex-grid .cell').count(), 1);
    assert.equal(await touch.locator('#dex-grid .cell').getAttribute('data-dex'), '25');
    await touch.locator('#dex-type-toggle').tap();
    await touch.locator('.summary-move').first().scrollIntoViewIfNeeded();
    await touch.locator('.summary-move').first().tap(); assert(await touch.locator('.inspection-screen').isVisible());
    assert.equal(await touch.locator('.tip').count(),0);
    assert.equal(await touch.evaluate(() => G.Tooltip.isOpen), true);
    assert(await touch.locator('#dex-grid').isVisible());
    await touch.locator('[data-inspection-close]').tap();
    assert.equal(await touch.locator(':focus').getAttribute('data-summary-move'), await touch.locator('.summary-move').first().getAttribute('data-summary-move'));
    assert(await touch.locator('#dex-grid').isVisible());
    assert.equal(await touch.locator('#dex-type-options [aria-pressed="true"]').getAttribute('data-type'), 'electric');
    await touch.locator('.summary-move').first().tap();
    await touch.evaluate(() => G.Flow.goMenu());
    await touch.locator('[data-go=dex]').tap();
    assert(await touch.locator('#dex-grid').isVisible());
    assert(await touch.locator('.inspection-screen').isHidden());
    passed.push('667×375 touch: tap opens interactive popup, collection stays visible, close restores focus and filters, leaving the screen closes the popup');
    assert.deepEqual(errors, []);
    fs.writeFileSync(`${artifacts}/validation.json`, JSON.stringify({ passed, errors }, null, 2));
    console.log(JSON.stringify({ passed, errors, artifacts }, null, 2));
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
