/* UI integration: real upgrade prices/perks and reward callbacks, fresh guest fixtures. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { chromium } = require('playwright');
const url = process.env.UI_TEST_URL || 'http://127.0.0.1:3095/dev.html';
const out = process.env.PROGRESSION_ARTIFACTS || '/tmp/pokesurvivor-frlg-hover';
(async () => {
  fs.mkdirSync(out, { recursive: true });
  const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || undefined, args: ['--no-sandbox'] });
  const errors = [], passed = [];
  async function open(lang, touch = false) {
    const page = await browser.newPage({ viewport: { width: touch ? 667 : 1280, height: touch ? 375 : 800 }, hasTouch: touch, serviceWorkers: 'block' });
    page.on('pageerror', e => errors.push(e.message));
    await page.addInitScript(lang => localStorage.setItem('ps.lang', lang), lang);
    await page.goto(url + '?preview=collection');
    await page.waitForFunction(() => window.G?.Game && document.querySelector('#boot.hidden'));
    await page.waitForFunction(() => !document.getElementById('tap-start').classList.contains('hidden') || !document.getElementById('scr-menu').classList.contains('hidden'));
    if (await page.locator('#tap-start').isVisible()) await page.locator('#tap-start').click();
    await page.evaluate(() => {
      window.choices = () => {
        const p = G.Game.player; if (!p.hasMove('ember')) p.addMove('ember');
        const pool = new Map();
        for (let i = 0; i < 80; i++) for (const c of G.LevelUp.offer(p)) pool.set(c.key, c);
        window.cardsFixture = [pool.get('up:ember'), pool.get('stat:hp'), [...pool.values()].find(c => c.type === 'new')];
        if (cardsFixture.some(c => !c)) throw Error('Cannot produce real reward fixtures');
        window.picks = [];
        window.showChoices = coop => G.RunUI.showLevelUp(2, cardsFixture, c => { picks.push(c.key); c.apply(p); }, coop);
        showChoices(false);
      };
      window.beginRun = () => { G.Tooltip.hide(); G.UI.hideAll(); G.Game.startRun(); G.Game.debugSpeed(0); };
    });
    return page;
  }
  async function screenshot(page, name) {
    await page.mouse.move(2, 2); await page.evaluate(() => G.Tooltip.hide());
    await page.locator('.toast').waitFor({ state: 'hidden' });
    await page.waitForTimeout(150); await page.screenshot({ path: `${out}/${name}.png` });
  }
  async function layout(page, selector) {
    assert(await page.evaluate(selector => {
      const r = document.querySelector(selector).getBoundingClientRect();
      return r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight && document.documentElement.scrollWidth <= innerWidth;
    }, selector), 'visible in viewport: ' + selector);
  }
  try {
    for (const lang of ['es', 'en']) {
      const page = await open(lang);
      await page.locator('[data-go=upgrades]').click();
      assert.equal(await page.locator('#upg-name').textContent(), 'Pikachu');
      assert.equal(await page.locator('#upg-types .type-badge').count(), 1);
      assert.equal(await page.locator('[data-upgrade]').count(), 13);
      assert.match(await page.locator('[data-upgrade=hp] .upg-progress').innerText(), /\+0.*\+8/s);
      assert.match(await page.locator('[data-upgrade=moves] .upg-progress').innerText(), /1.*2/s);
      await screenshot(page, `upgrades-${lang}`);
      await page.locator('[data-upgrade=hp] [data-buy]').focus(); await page.keyboard.press('Enter');
      assert.deepEqual(await page.evaluate(() => ({ coins: G.DB.save.coins, hp: G.DB.save.pupg[25].hp, partner: G.DB.save.partner })), { coins: 440, hp: 1, partner: 25 });
      assert(await page.locator('[data-upgrade=hp] [data-buy]').evaluate(b => b === document.activeElement));
      assert.match(await page.locator('[data-upgrade=hp] .upg-progress').innerText(), /\+8.*\+16/s);
      await page.locator('#upg-mon').selectOption('6');
      await page.locator('[data-upgrade=atk] [data-buy]').click();
      assert.deepEqual(await page.evaluate(() => ({ coins: G.DB.save.coins, atk: G.DB.save.pupg[6].atk, hp25: G.DB.save.pupg[25].hp, partner: G.DB.save.partner })), { coins: 360, atk: 1, hp25: 1, partner: 25 });
      await page.evaluate(() => { G.DB.save.coins = 0; document.getElementById('upg-mon').dispatchEvent(new Event('change')); });
      assert.equal(await page.locator('[data-buy]:disabled').count(), 13);
      assert.match(await page.locator('[data-upgrade=atk] .upg-status').innerText(), lang === 'en' ? /Need .*more Pokécoins/ : /Faltan .*Pokémonedas/);
      await page.evaluate(() => { G.DB.save.coins = 10000; G.DB.save.pupg[6].hp = 9; document.getElementById('upg-mon').dispatchEvent(new Event('change')); });
      await page.locator('[data-upgrade=hp] [data-buy]').focus(); await page.keyboard.press('Space');
      assert.equal(await page.evaluate(() => G.DB.save.pupg[6].hp), 10);
      assert(await page.locator('[data-upgrade=hp] [data-buy]').isDisabled());
      assert(await page.locator('[data-upgrade=hp]').evaluate(el => el === document.activeElement));
      assert.equal(await page.locator('[data-upgrade=hp] .upg-progress b').count(), 1);
      const lastCoins = await page.evaluate(() => G.DB.save.coins);
      await page.locator('[data-upgrade=hp] [data-buy]').evaluate(b => b.click());
      assert.equal(await page.evaluate(() => G.DB.save.coins), lastCoins);
      await page.locator('[data-upgrade=ban] [data-buy]').click();
      await page.locator('[data-ban]').click();
      const banFirst = page.locator('.ban-moves [data-id]').first();
      const banId = await banFirst.getAttribute('data-id');
      assert.notEqual(banId, await page.evaluate(() => G.startMoveOf(6)));
      await banFirst.click();
      assert.deepEqual(await page.evaluate(() => G.DB.save.pban[6]), [banId]);
      assert(await page.locator(`.ban-moves [data-id=${banId}]`).evaluate(el => el === document.activeElement));
      await page.locator('.ban-moves [data-id]').nth(1).click();
      assert.deepEqual(await page.evaluate(() => G.DB.save.pban[6]), [banId]);
      await page.locator(`.ban-moves [data-id=${banId}]`).click();
      assert.deepEqual(await page.evaluate(() => G.DB.save.pban[6]), []);
      const move = await page.locator('[data-slot="0"] option').nth(1).getAttribute('value');
      await page.locator('[data-slot="0"]').focus();
      await page.locator('[data-slot="0"]').selectOption(move);
      await page.locator('[data-slot="1"]').focus();
      await page.locator('[data-slot="1"]').selectOption(move);
      assert.deepEqual(await page.evaluate(() => G.DB.save.pbind[6]), [null, move, null, null]);
      assert(await page.locator('[data-slot="1"]').evaluate(el => el === document.activeElement));
      for (const [width, height] of [[844, 390], [667, 375], [390, 844]]) {
        await page.setViewportSize({ width, height });
        await page.evaluate(() => document.querySelector('#scr-upgrades .dialog-body').scrollTop = 0);
        await layout(page, '#scr-upgrades [data-back]');
        await screenshot(page, `upgrades-${lang}-${width}`);
      }
      await page.setViewportSize({ width: 1280, height: 800 });
      await page.evaluate(() => { G.DB.save.partner = 25; beginRun(); choices(); });
      assert.equal(await page.locator('#cards .choice-pick').count(), 3);
      assert.equal(await page.locator('.choice-info, #lvl-confirm, #lvl-info').count(), 0);
      assert(await page.locator('#cards .choice-pick').first().evaluate(el => el === document.activeElement));
      assert.equal(await page.locator('#cards .type-badge').count(), 2);
      await page.keyboard.press('ArrowDown');
      assert(await page.locator('#cards .choice-pick').nth(1).evaluate(el => el === document.activeElement));
      assert.deepEqual(await page.evaluate(() => picks), []);
      await page.keyboard.press('Home');
      await screenshot(page, `levelup-${lang}`);
      await page.locator('#cards .choice-pick').first().hover();
      await page.waitForTimeout(1100);
      assert.equal(await page.evaluate(() => G.InfoPanel.peekOpen), true);
      assert.deepEqual(await page.evaluate(() => picks), []);
      await page.screenshot({path: `${out}/reward-hover-${lang}.png`});
      await page.mouse.move(2, 2);
      assert.equal(await page.evaluate(() => G.InfoPanel.peekOpen), false);
      for (const [width, height] of [[844, 390], [667, 375], [390, 844]]) {
        await page.setViewportSize({ width, height });
        await layout(page, '#lvl-reroll');
        await page.locator('#cards .choice-pick').last().scrollIntoViewIfNeeded();
        await layout(page, '#cards .choice-card:last-child .choice-pick');
        await page.evaluate(() => document.getElementById('cards').scrollTop = 0);
        await screenshot(page, `levelup-${lang}-${width}`);
      }
      await page.setViewportSize({ width: 1280, height: 800 });
      await page.locator('#cards .choice-pick').first().focus(); await page.keyboard.press('Enter');
      assert.deepEqual(await page.evaluate(() => picks), ['up:ember']);
      assert.equal(await page.evaluate(() => G.Game.player.moves.find(m => m.id === 'ember').lvl), 2);
      await page.evaluate(() => { showChoices(true); G.RunUI.setWaiting(['Misty']); });
      await page.locator('#cards .choice-pick').nth(1).click();
      await page.evaluate(() => G.RunUI.pick(1));
      assert.deepEqual(await page.evaluate(() => picks), ['up:ember', 'stat:hp']);
      assert.equal(await page.locator('#cards button:disabled').count(), 3);
      assert.equal(await page.locator('#cards .picked').count(), 1);
      assert.match(await page.locator('#lvl-wait').innerText(), /Misty/);
      await screenshot(page, `waiting-${lang}`);
      await page.evaluate(() => { G.RunUI.closeLevelUp(); beginRun(); choices(); });
      await page.locator('#lvl-reroll').click();
      assert.equal(await page.evaluate(() => G.Game.player.rerolls), 1);
      assert(await page.locator('#lvl-reroll').isHidden());
      assert(await page.locator('#cards .choice-pick').first().evaluate(el => el === document.activeElement));
      assert.deepEqual(await page.evaluate(() => picks), []);
      // The real game input loop still consumes number shortcuts.
      await page.evaluate(() => { G.RunUI.closeLevelUp(); beginRun(); G.Game.debugLevelUp(); });
      await page.waitForFunction(() => G.Game.state === 'levelup');
      await page.keyboard.press('Digit1');
      await page.waitForFunction(() => !G.UI.isOpen('scr-levelup'));
      // Bond's two-step selection must not fuse on inspection, navigation or Back.
      await page.evaluate(() => {
        beginRun(); const p = G.Game.player; p.addMove('ember'); p.addMove('water-gun'); p.bonds = 1;
        window.bondPicks = 0;
        G.RunUI.showBond(p.bondOptions(), moves => { bondPicks++; p.fuse(moves); });
      });
      assert(!/undefined/.test(await page.locator('#bond-cards').innerText()));
      assert.equal(await page.locator('.choice-info').count(), 0);
      assert.equal(await page.evaluate(() => bondPicks), 0);
      await page.locator('#bond-cards .choice-pick').first().click();
      assert.equal(await page.evaluate(() => bondPicks), 0);
      assert(await page.locator('#bond-back').isVisible());
      await page.locator('#bond-back').click();
      assert.equal(await page.evaluate(() => G.Game.player.slots.length), 3);
      await page.locator('#bond-cards .choice-pick').first().click();
      assert.equal(await page.evaluate(() => bondPicks), 0);
      for (const [width, height] of [[1280, 800], [667, 375], [390, 844]]) {
        await page.setViewportSize({ width, height }); await layout(page, '#bond-back');
        await screenshot(page, `bond-${lang}-${width}`);
      }
      await page.locator('#bond-cards .choice-pick').first().focus(); await page.keyboard.press('Enter');
      assert.deepEqual(await page.evaluate(() => ({ picks: bondPicks, slots: G.Game.player.slots.length, bonds: G.Game.player.bonds })), { picks: 1, slots: 2, bonds: 0 });
      passed.push(`${lang}: prices, per-Pokémon upgrades, max/insufficient funds, focus, bans/bindings, reward preview/choice/keyboard/reroll, co-op lock, two-step bond and responsive layouts`);
      await page.close();
    }
    const touch = await open('es', true);
    await touch.locator('[data-go=upgrades]').tap();
    await touch.locator('[data-upgrade=hp] [data-buy]').tap();
    assert.equal(await touch.evaluate(() => G.DB.save.pupg[25].hp), 1);
    await touch.evaluate(() => { beginRun(); choices(); });
    const rect = await touch.locator('#cards .choice-pick').first().boundingBox();
    const cdp = await touch.context().newCDPSession(touch);
    await cdp.send('Input.dispatchTouchEvent', {type:'touchStart', touchPoints:[{x:rect.x+40,y:rect.y+20}]});
    await touch.waitForTimeout(650);
    await cdp.send('Input.dispatchTouchEvent', {type:'touchEnd',touchPoints:[]});
    assert.equal(await touch.evaluate(() => G.Tooltip.isOpen), true);
    assert.deepEqual(await touch.evaluate(() => picks), []);
    await touch.locator('[data-inspection-close]').tap();
    await touch.locator('#cards .choice-pick').first().tap();
    assert.equal(await touch.evaluate(() => G.Tooltip.isOpen), false);
    assert.deepEqual(await touch.evaluate(() => picks), ['up:ember']);
    passed.push('Touch: buy, long press inspects without choosing, direct tap chooses exactly once');
    await touch.close();
    assert.deepEqual(errors, []);
    fs.writeFileSync(`${out}/validation.json`, JSON.stringify({ passed, errors }, null, 2));
    console.log(JSON.stringify({ passed, errors, artifacts: out }, null, 2));
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
