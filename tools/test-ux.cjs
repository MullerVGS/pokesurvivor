/* Browser integration checks. Start the local server, then:
 * UX_TEST_URL=http://127.0.0.1:3089/dev.html node tools/test-ux.cjs
 * Optional: PLAYWRIGHT_CHROMIUM_EXECUTABLE for an installed Chromium.
 */
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const URL = process.env.UX_TEST_URL || 'http://127.0.0.1:3089/dev.html';

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || undefined, args: ['--no-sandbox'] });
  const errors = [];
  async function pageFor(uid) {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
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
    await page.waitForFunction(() => G.Game && document.querySelector('#boot.hidden'), null, { polling: 50, timeout: 10000 });
    await page.evaluate(() => {
      document.getElementById('tap-start').classList.add('hidden');
      G.DB.playAsGuest(); G.DB.save.partner = 25; G.Game.startRun();
      window.check = (v, msg) => { if (!v) throw Error(msg); };
      window.fresh = () => { G.Tooltip.hide(); G.Game.startRun(); return G.Game.player; };
      window.frame = () => runFrame(performance.now());
      window.press = code => {
        dispatchEvent(new KeyboardEvent('keydown', { code })); frame();
        dispatchEvent(new KeyboardEvent('keyup', { code }));
      };
      window.wheel = (deltaY, target = document.getElementById('game')) => {
        target.dispatchEvent(new WheelEvent('wheel', { deltaY, bubbles: true, cancelable: true })); frame();
      };
    });
    return page;
  }
  try {
    const page = await pageFor();
    async function test(name, fn) { await page.evaluate(fn); console.log('PASS', name); }
    await test('inactive cooldowns progress, switching preserves timers, wheel respects Choice Band and dialogs', () => {
      const p = fresh(); p.addMove('ember'); p.setActive(0);
      p.moves.forEach(m => m.t = 2);
      G.Combat.tick(0.5, p, 1);
      check(p.moves.every(m => m.t === 1.5), 'both active and pocket cooldowns tick');
      p.setActive(1); check(p.moves[1].t === 1.5, 'no switching discount');
      wheel(-100); check(p.active === 0, 'wheel backward');
      wheel(100); check(p.active === 1, 'wheel forward');
      p.equip('choiceband'); wheel(-100); check(p.active === 1, 'Choice Band locks wheel'); p.equip(null);
      G.Tooltip.show('move:ember', 600, 200, { pin: true });
      wheel(-100, document.querySelector('.inspection-content .readout-body')); check(p.active === 1, 'tooltip scroll is not a switch');
      G.Tooltip.hide();
      press('Escape'); wheel(-100); check(p.active === 1, 'pause blocks wheel'); press('Escape');
      check(G.Tooltip.content('term:minimap') && !G.Tooltip.content('enemy:1'), 'minimap help remains without world probes');
    });
    await test('ground items wait for F, swaps drop the old item, dismissal lasts until leaving range', () => {
      const p = fresh();
      G.Pickups.drop('item', p.x, p.y, 'quickclaw');
      G.Pickups.update(1, p); G.ItemUI.update();
      check(!p.item && G.ItemUI.open && G.Game.state === 'playing', 'empty slot compares without auto-pick or pause');
      press('KeyF'); check(p.item === 'quickclaw' && Math.abs(p.cdMul - 0.8) < 0.001, 'F equips once');
      G.GroundItems.drop('herdtrail', p.x, p.y); G.ItemUI.update(); press('KeyF');
      check(p.item === 'herdtrail' && Math.abs(p.cdMul - 1) < 0.001, 'swap removes old effect');
      const old = G.GroundItems.all()[0];
      check(old.options[0] === 'quickclaw' && !old.owner && !G.ItemUI.open, 'old item shared, no immediate swap loop');
      p.x += 200; G.ItemUI.update(); p.x -= 200; G.ItemUI.update();
      check(G.ItemUI.open, 'return to item permits comparison');
      document.querySelector('[data-dismiss-item]').click(); G.ItemUI.update(); check(!G.ItemUI.open, 'close stays closed nearby');
      p.x += 200; G.ItemUI.update(); p.x -= 200; G.ItemUI.update();
      document.querySelector('[data-take-item]').click(); G.ItemUI.update();
      check(p.item === 'quickclaw' && Math.abs(p.spdMul - 1) < 0.001, 'touch button swaps and removes bonus');
      check(!G.GroundItems.take(p, 9999, 'leftovers'), 'invalid drop rejected');
      const far = G.GroundItems.drop('leftovers', p.x + 500, p.y);
      check(!G.GroundItems.take(p, far.id, 'leftovers'), 'out of range rejected');
    });
    await test('all move previews execute in isolation at base, maximum and evolution levels', () => {
      const p = fresh();
      const before = JSON.stringify({ hp: p.hp, moves: p.moves, projectiles: G.Projectiles.count, fields: G.Combat.fieldCount, xp: p.xp, coins: p.coins });
      const canvas = document.createElement('canvas'); canvas.width = 288; canvas.height = 160;
      let n = 0;
      for (const d of G.Moves.ALL) for (const [level, evolved] of [[1, false], [d.maxLvl, false], ...(G.Moves.EVO[d.id] ? [[d.maxLvl, true]] : [])]) {
        const scene = G.MovePreview.createScene({ id: d.id }, level, evolved);
        for (let i = 0; i < 100; i++) scene.step(0.05);
        scene.draw(canvas.getContext('2d')); n++;
      }
      check(n === 187, 'all catalog variants');
      check(before === JSON.stringify({ hp: p.hp, moves: p.moves, projectiles: G.Projectiles.count, fields: G.Combat.fieldCount, xp: p.xp, coins: p.coins }), 'live gameplay unchanged');
      const c = G.Tooltip.content('movelevel:ember:3');
      check(c.preview.level === 3 && c.list.some(l => l.tip === 'movelevel:ember:4'), 'future tooltip level and following upgrades');
      p.addMove('ember'); check(G.Tooltip.content('card:up:ember').preview.level === 2, 'upgrade card previews the upgrade');
    });
    await test('undiscovered evolutions stay hidden until earned, including direct and card tooltips', () => {
      const p = fresh(); p.addMove('ember'); delete G.DB.save.evoMoves.ember;
      const base = G.Tooltip.content('move:ember');
      check(base.list.at(-1).text.endsWith('???') && !base.list.at(-1).tip, 'locked evolution label without preview link');
      check(!JSON.stringify(base).includes(G.T(G.Moves.EVO.ember[0])), 'no evolved name in description');
      for (const src of ['movelevel:ember:evo', 'card:evo:ember']) {
        const c = G.Tooltip.content(src);
        check(c.title.endsWith('???') && !c.preview && !c.stats, 'no preview or evolved stats through ' + src);
      }
      const m = p.moves.find(m => m.id === 'ember');
      while (m.lvl < m.def.maxLvl) G.Moves.levelUp(m);
      p.statsTaken[G.Moves.EVO.ember[1]] = 1;
      const card = G.LevelUp.offer(p).find(c => c.key === 'evo:ember');
      check(card && card.title.endsWith('???') && !card.desc.includes(G.Moves.EVO.ember[0]), 'first evolution reward is a mystery');
      card.apply(p);
      check(G.Tooltip.content('movelevel:ember:evo').preview.evolved, 'earned evolution preview unlocked');
      check(G.Tooltip.content('move:ember').list.at(-1).tip === 'movelevel:ember:evo', 'earned evolution entry unlocked');
      G.Game.startRun();
      check(G.Progress.knowsEvolution('ember'), 'discovery persists between runs');
      G.DB.playAsGuest(); G.DB.save.partner = 25; G.Game.startRun();
      check(!G.Progress.knowsEvolution('ember'), 'discovery does not leak into another save');
    });
    await page.evaluate(() => G.Tooltip.show('move:swords-dance', 700, 150, { pin: true }));
    await page.locator('.inspection-content [data-info-source="movelevel:swords-dance:2"]').click();
    assert.equal(await page.locator('.inspection-content .preview-caption').textContent(), 'Lv. 2: +1 max stack');
    assert.equal(await page.locator('.inspection-screen:not([hidden])').count(), 1);
    assert.equal(await page.locator('.tip').count(), 0);
    await page.evaluate(() => {
      const cv = document.querySelector('.inspection-content .move-preview canvas');
      let draws = 0; const ctx = cv.getContext('2d'), clear = ctx.clearRect.bind(ctx);
      ctx.clearRect = (...args) => { draws++; clear(...args); };
      G.MovePreview.tick(0.05);
      check(draws === 1 && G.MovePreview.count === 1, 'one mounted preview in the same panel');
    });
    await page.locator('.inspection-content .readout-back').click();
    assert.equal(await page.locator('.inspection-content .preview-caption').textContent(), 'Lv. 1: Base move');
    await page.evaluate(() => { G.Tooltip.hide(); check(G.MovePreview.count === 0, 'closed preview released'); });
    console.log('PASS future-level navigation replaces the same panel and releases previews on close');

    // Force overflow in every closable screen: header/footer must not move with it.
    for (const viewport of [{ width: 1280, height: 800 }, { width: 844, height: 390 }]) {
      await page.setViewportSize(viewport);
      await test(`all dialog close/back controls stay visible at ${viewport.width}x${viewport.height}`, () => {
        G.UI.hideAll();
        for (const box of document.querySelectorAll('.box.dialog-frame')) {
          const screen = box.closest('.scr'); screen.classList.remove('hidden');
          const body = box.querySelector('.dialog-body'), filler = document.createElement('div'); filler.style.height = '2000px'; filler.style.flexShrink = '0'; body.appendChild(filler);
          const buttons = box.querySelectorAll('.dialog-head button, .dialog-foot');
          const initial = [...buttons].map(b => b.getBoundingClientRect().top);
          body.scrollTop = body.scrollHeight;
          [...buttons].forEach((b, i) => {
            if (!b.getClientRects().length) return;
            const r = b.getBoundingClientRect();
            check(r.top >= 0 && r.bottom <= innerHeight && Math.abs(r.top - initial[i]) < 1, screen.id + ': control stays visible');
          });
          filler.remove(); screen.classList.add('hidden');
        }
        G.Tooltip.show('move:ember', 500, 150, { pin: true, touch: true });
        const x = document.querySelector('[data-inspection-close]'), top = x.getBoundingClientRect().top;
        document.querySelector('.inspection-content .readout-body').scrollTop = 2000;
        check(x.getBoundingClientRect().top === top && top >= 0, 'touch close outside tooltip scroll');
        x.click(); check(!G.Tooltip.isOpen, 'explicit close still works');
      });
    }
    await test('landscape item comparison keeps the player and attack bar visible', () => {
      const p = fresh(); p.equip('leftovers'); G.GroundItems.drop('herdtrail', p.x, p.y); G.ItemUI.update();
      const r = document.getElementById('item-compare').getBoundingClientRect();
      check(r.top >= 0 && r.bottom < innerHeight / 2 - 30, 'compact comparison stays above the player');
      check(r.right <= innerWidth && r.left >= 0, 'comparison fits horizontally');
      G.ItemUI.dismiss();
    });
    await page.evaluate(() => {
      G.GachaUI.open();
      G.Slots.play = async () => {};
      G.Gacha.pull = () => Array.from({ length: 10 }, (_, i) => ({ dex: i === 0 ? 25 : 150, rarity: i === 0 ? 1 : 5, isNew: i === 0, shiny: false, refund: 400 }));
      document.getElementById('pull-10').disabled = false; document.getElementById('pull-10').click();
    });
    await page.waitForSelector('#pull-close:not(.hidden)');
    await test('new common Pokémon stand out while duplicate legendaries do not; Continue stays visible', () => {
      check(document.querySelectorAll('.pcard.discovery').length === 1 && document.querySelectorAll('.pcard.duplicate').length === 9, 'novelty independent of rarity');
      check(!getComputedStyle(document.querySelector('.pcard.duplicate')).animationName.includes('legend'), 'no duplicate legendary pulse');
      const button = document.getElementById('pull-close'), before = button.getBoundingClientRect().top;
      const out = document.getElementById('pull-results'); out.scrollTop = out.scrollHeight;
      const r = button.getBoundingClientRect();
      check(r.top === before && r.top >= 0 && r.bottom <= innerHeight, 'Continue fixed outside results');
    });

    const host = await pageFor('host'), guest = await pageFor('guest'), pages = { host, guest };
    const cfg = { seed: 42, host: 'host', members: [{ uid: 'host', name: 'Host', dex: 25 }, { uid: 'guest', name: 'Guest', dex: 4 }] };
    for (const p of Object.values(pages)) await p.evaluate(cfg => G.Game.startRun(cfg), cfg);
    async function exchange() {
      for (let i = 0; i < 3; i++) for (const p of Object.values(pages)) {
        const packets = await p.evaluate(() => { G.Coop.tick(0.1); return packets.splice(0); });
        for (const packet of packets) await pages[packet.to].evaluate(o => receivePacket(o.from, o.msg), packet);
      }
    }
    await exchange();
    await host.evaluate(() => {
      const p = G.Coop.mate('guest').pl;
      G.GroundItems.drop('quickclaw', p.net.x, p.net.y);
    });
    await exchange();
    await guest.evaluate(() => {
      G.ItemUI.update(); check(G.ItemUI.open && !G.Tooltip.holds(), 'guest compares without pausing');
      G.ItemUI.take(); check(!G.Game.player.item && G.GroundItems.pending, 'wait for host confirmation');
    });
    await exchange();
    await guest.evaluate(() => check(G.Game.player.item === 'quickclaw' && Math.abs(G.Game.player.cdMul - 0.8) < 0.001, 'confirmed guest bonus'));
    await exchange();
    await guest.evaluate(() => check(Math.abs(G.Game.player.cdMul - 0.8) < 0.001, 'repeated snapshot does not multiply bonus'));
    await host.evaluate(() => { const p = G.Coop.mate('guest').pl; G.GroundItems.drop('herdtrail', p.net.x, p.net.y); });
    await exchange(); await guest.evaluate(() => { G.ItemUI.update(); G.ItemUI.take(); }); await exchange();
    await guest.evaluate(() => check(G.Game.player.item === 'herdtrail' && Math.abs(G.Game.player.cdMul - 1) < 0.001, 'guest swap restores cooldown'));
    await host.evaluate(() => {
      const p = G.Game.player, d = G.GroundItems.all().find(d => d.options.includes('quickclaw'));
      check(d && !d.owner, 'guest dropped old equipment for teammate'); p.x = d.x; p.y = d.y;
      check(G.GroundItems.take(p, d.id, 'quickclaw'), 'host can pick up guest old item');
      check(!G.GroundItems.take(G.Coop.mate('guest').pl, d.id, 'quickclaw'), 'same drop cannot be claimed twice');
    });
    await exchange();
    for (const p of Object.values(pages)) assert.equal(await p.evaluate(() => G.GroundItems.all().length), 0);
    console.log('PASS co-op host validation, guest confirmation, idempotent snapshots and shared equipment swap');
    assert.deepEqual(errors, []);
    console.log('All UX integration checks passed.');
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
