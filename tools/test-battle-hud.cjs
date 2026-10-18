/* Real canvas HUD/input regression; guest fixtures, no network players or saves. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { chromium } = require('playwright');
const out = process.env.HUD_ARTIFACTS || '/tmp/pokesurvivor-battle-hud';
const url = process.env.UI_TEST_URL || 'http://127.0.0.1:3095/dev.html';
(async () => {
  fs.mkdirSync(out, { recursive: true });
  const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE, args: ['--no-sandbox'] });
  const errors = [], passed = [], performance = [];
  async function fixture(lang, touch = false) {
    const page = await browser.newPage({ viewport: { width: touch ? 667 : 1280, height: touch ? 375 : 800 }, hasTouch: touch, serviceWorkers: 'block' });
    page.on('pageerror', e => errors.push(e.message));
    await page.addInitScript(lang => localStorage.setItem('ps.lang', lang), lang);
    await page.goto(url + '?preview=collection');
    await page.waitForFunction(() => window.G?.Game && document.querySelector('#boot.hidden'));
    await page.waitForFunction(() => !document.querySelector('#tap-start.hidden') || !document.querySelector('#scr-menu.hidden'));
    if (await page.locator('#tap-start').isVisible()) await page.locator('#tap-start').click();
    await page.evaluate(() => {
      G.UI.hideAll(); G.Game.startRun(); G.Game.debugSpeed(0);
      const pl = G.Game.player; pl.slots = []; pl.moves = [];
      for (const id of ['thunder-shock', 'tackle', 'quick-attack', 'agility']) pl.addMove(id);
      pl.setActive(0); pl.level = 12; pl.hp = pl.maxHp * .65; pl.xp = pl.xpNext * .6; pl.item = 'quickclaw';
      pl.moves[0].t = .4; pl.kills = 247; pl.coins = 1234; G.Game.debugTime(582);
      window.hudWeather = null; window.hudBoss = null;
      const topLayout = G.BattlePanels.topLayout;
      G.BattlePanels.topLayout = (...args) => (window.hudTop = topLayout(...args));
      window.hudMates = [270, 273, 4].map((dex, i) => {
        const pl = new G.Player(G.DEX_BY[dex]); pl.level = 6 + i; pl.hp = pl.maxHp * [.9, .4, .15][i];
        return { pl, name: ['Rajin', 'Meems', 'Arthur'][i], color: ['#60c8f0', '#f8a858', '#d880d0'][i], connected: true };
      });
      window.hudZones = []; window.hudText = [];
      const zone = G.Tooltip.zone, draw = G.HUD.draw;
      G.Tooltip.zone = (x, y, w, h, source) => { hudZones.push({ x, y, w, h, source }); zone(x, y, w, h, source); };
      G.HUD.draw = (ctx, ...args) => {
        hudZones = []; hudText = [];
        const text = ctx.fillText, active = Object.getOwnPropertyDescriptor(G.Coop, 'active'), mates = Object.getOwnPropertyDescriptor(G.Coop, 'mates');
        const weather = Object.getOwnPropertyDescriptor(G.Weather, 'current'), enemies = G.EnemyMgr.all;
        ctx.fillText = function (value, x, y, ...rest) { hudText.push(String(value)); return text.call(this, value, x, y, ...rest); };
        Object.defineProperty(G.Coop, 'active', { configurable: true, get: () => true });
        Object.defineProperty(G.Coop, 'mates', { configurable: true, get: () => hudMates });
        Object.defineProperty(G.Weather, 'current', { configurable: true, get: () => hudWeather });
        G.EnemyMgr.all = () => hudBoss ? [hudBoss] : [];
        try { draw(ctx, ...args); } finally { ctx.fillText = text; Object.defineProperty(G.Coop, 'active', active); Object.defineProperty(G.Coop, 'mates', mates); Object.defineProperty(G.Weather, 'current', weather); G.EnemyMgr.all = enemies; }
      };
    });
    await page.waitForFunction(() => hudZones.filter(z => z.source.startsWith('slot:')).length === 4);
    return page;
  }
  const point = (page, source) => page.evaluate(source => { const r = hudZones.find(z => z.source === source); return { x: r.x + r.w / 2, y: r.y + r.h / 2 }; }, source);
  const intersects = (a, b) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
  async function checkTop(page, width, height) {
    const { top, zones } = await page.evaluate(() => ({ top: hudTop, zones: hudZones }));
    const panels = Object.entries(top).filter(([, r]) => r);
    for (const [name, r] of panels) {
      assert(r.x >= 0 && r.y >= 0 && r.x + r.w <= width && r.y + r.h <= height, `${width} ${name} stays on screen`);
      for (const z of zones.filter(z => /^(mon:|slot:|term:minimap)/.test(z.source))) assert(!intersects(r, z), `${width}: ${name} clears ${z.source}`);
    }
    panels.forEach(([name, r], i) => panels.slice(i + 1).forEach(([other, s]) => assert(!intersects(r, s), `${width}: ${name} clears ${other}`)));
  }
  try {
    for (const lang of ['es', 'en']) {
      const page = await fixture(lang);
      for (const [width, height] of [[1280, 800], [844, 390], [667, 375], [390, 844]]) {
        await page.setViewportSize({ width, height }); await page.waitForTimeout(150);
        const zones = await page.evaluate(() => hudZones);
        assert.equal(zones.filter(z => z.source.startsWith('mon:')).length, 4);
        const slots = zones.filter(z => z.source.startsWith('slot:'));
        assert.equal(slots.length, 4);
        for (const r of zones.filter(z => /^(slot|mon):/.test(z.source))) assert(r.x >= 0 && r.y >= 0 && r.x + r.w <= width && r.y + r.h <= height, `${lang} ${width}: ${r.source} stays on screen`);
        const map = zones.find(z => z.source === 'term:minimap');
        assert(slots.every(r => r.y > height / 2 && !intersects(map, r)), 'move cards stay at the bottom, clear of the minimap');
        assert(zones.filter(z => z.source.startsWith('mon:')).every(r => !intersects(map, r)), 'minimap clears health panels');
        const text = await page.evaluate(() => hudText.join('\n'));
        assert.match(text, /PIKACHU/); assert.match(text, /LOTAD/); assert.match(text, /SEEDOT/); assert.match(text, /Rajin/); assert.match(text, /Meems/);
        if (width === 1280) assert.match(text, lang === 'en' ? /QUICK ATTACK/ : /ATAQUE RÁPIDO/);
        else { assert(!/QUICK ATTACK|ATAQUE RÁPIDO/.test(text), 'small HUD uses icons'); assert.equal(new Set(slots.map(r => r.y)).size, 1, 'compact moves share one row'); assert(slots.every(r => r.w >= 44 && r.h >= 44), 'compact moves keep usable touch targets'); }
        assert.match(text, /0.4s/); assert(!/PP\s*\d/.test(text));
        assert.match(text, /9:42/); assert.match(text, /247/); assert.match(text, lang === 'en' ? /1,234/ : /1234/);
        await checkTop(page, width, height);
        await page.evaluate(() => G.Spawner.say('', 0, true));
        await page.screenshot({ path: `${out}/hud-${lang}-${width}.png` });
      }
      await page.evaluate(() => { hudWeather = { ...G.Weather.KINDS.sand, kind: 'sand', left: 36 }; hudBoss = { boss: true, dead: false, name: 'Tauros Alfa', hp: 600, maxHp: 1000 }; G.Game.debugTime(905); G.Game.player.kills = 12345; G.Game.player.coins = 12345678; });
      for (const [width, height] of [[1280, 800], [667, 375], [568, 320], [390, 844], [320, 568]]) {
        await page.setViewportSize({ width, height }); await page.waitForTimeout(150);
        await checkTop(page, width, height);
        assert.match(await page.evaluate(() => hudText.join('\n')), /15:05/);
        if (width <= 390) assert.match(await page.evaluate(() => hudText.join('\n')), /12[.,]3\s*M/, 'large counters remain readable in compact notation');
        await page.evaluate(() => G.Spawner.say('', 0, true));
        await page.screenshot({ path: `${out}/hud-${lang}-${width}-boss-weather.png` });
      }
      await page.evaluate(() => { hudWeather = null; hudBoss = null; });
      await page.setViewportSize({ width: 1280, height: 800 }); await page.waitForTimeout(100);
      const second = await point(page, 'slot:1'); await page.mouse.click(second.x, second.y);
      assert.equal(await page.evaluate(() => G.Game.player.active), 1);
      await page.keyboard.press('Digit3'); await page.waitForTimeout(100);
      assert.equal(await page.evaluate(() => G.Game.player.active), 2);
      await page.mouse.move(500, 400); await page.mouse.wheel(0, 120); await page.waitForTimeout(100);
      assert.equal(await page.evaluate(() => G.Game.player.active), 3);
      await page.evaluate(() => { G.Game.player.item = 'choiceband'; });
      await page.mouse.click(second.x, second.y);
      assert.equal(await page.evaluate(() => G.Game.player.active), 3, 'Choice Band still locks the move');
      await page.evaluate(() => { G.Game.player.item = 'quickclaw'; });
      const first = await point(page, 'slot:0'); await page.mouse.move(first.x, first.y); await page.waitForTimeout(1100);
      assert(await page.locator('.skill-peek').isVisible());
      await page.keyboard.press('KeyT'); assert(await page.locator('.inspection-screen').isVisible());
      await page.keyboard.press('Escape');
      await page.evaluate(() => {
        const pl = G.Game.player; pl.bonds = 1; pl.fuse(pl.moves.slice(0, 2));
        hudMates[2].pl.dead = true; hudMates[2].pl.hp = 0; hudMates[2].pl.reviveT = 1.5;
        hudMates[0].connected = false;
      });
      await page.waitForTimeout(100);
      assert.equal(await page.evaluate(() => hudZones.filter(z => z.source.startsWith('mon:')).length), 3);
      assert.match(await page.evaluate(() => hudText.join('\n')), lang === 'en' ? /DOWN/ : /CAÍDO/);
      await page.evaluate(() => G.Tooltip.show('slot:0'));
      assert.equal(await page.locator('.preview-moves option').count(), 2, 'fused slot still exposes both real attacks');
      await page.keyboard.press('Escape'); await page.screenshot({ path: `${out}/hud-${lang}-bond-down.png` });
      await page.setViewportSize({ width: 667, height: 375 }); await page.waitForTimeout(150);
      await page.evaluate(() => { const pl = G.Game.player; pl.bonds = 1; pl.fuse(pl.slots.slice(1).flat(), pl.slots[0]); });
      const fused = await point(page, 'slot:0'); await page.mouse.move(fused.x, fused.y); await page.waitForTimeout(1100);
      await page.keyboard.press('KeyT');
      assert.equal(await page.locator('.inspection-screen .preview-moves option').count(), 4, 'compact bonded icon retains all four moves');
      await page.keyboard.press('Escape'); await page.screenshot({ path: `${out}/hud-${lang}-compact-bond.png` });
      performance.push(await page.evaluate(() => {
        const canvas = document.createElement('canvas'); canvas.width = 1280; canvas.height = 800; const ctx = canvas.getContext('2d');
        const d = G.BattlePanels.dockLayout(1280, 800), status = G.BattlePanels.healthLayout(1280, 800, 3), durations = [];
        for (let i = 0; i < 240; i++) {
          const start = performance.now(); G.BattlePanels.health(ctx, status.player, G.Game.player);
          hudMates.forEach((m, i) => G.BattlePanels.health(ctx, status.allies[i], m.pl, m));
          G.BattlePanels.dock(ctx, d, G.Game.player, false); durations.push(performance.now() - start);
        }
        durations.sort((a, b) => a - b); return { medianMs: durations[120], p95Ms: durations[228], frames: durations.length };
      }));
      passed.push(`${lang}: live summary, compact icons / desktop names, HP/EXP and allies; no overlap with weather/boss/minimap in five sizes; click/number/wheel, Choice Band, hover/T, four-move bond, downed/revive/disconnected`);
      await page.close();
    }
    const page = await fixture('en', true);
    await page.evaluate(() => { hudWeather = { ...G.Weather.KINDS.sand, kind: 'sand', left: 36 }; hudBoss = { boss: true, dead: false, name: 'Tauros Alfa', hp: 600, maxHp: 1000 }; });
    for (const [width, height] of [[667, 375], [390, 844], [320, 568]]) {
      await page.setViewportSize({ width, height }); await page.waitForTimeout(150); await checkTop(page, width, height);
      await page.screenshot({ path: `${out}/hud-touch-${width}-boss-weather.png` });
    }
    await page.setViewportSize({ width: 667, height: 375 }); await page.waitForTimeout(150);
    await page.evaluate(() => G.UI.toast('Control check', 2000));
    await page.waitForTimeout(250);
    const notice = await page.locator('.toast').boundingBox();
    const controls = await page.evaluate(() => hudZones.filter(z => /^(slot:|item:)/.test(z.source)));
    assert(controls.every(r => !intersects({ x: notice.x, y: notice.y, w: notice.width, h: notice.height }, r)), 'notice clears attack and item controls');
    assert.equal(await page.locator('.toast').evaluate(el => getComputedStyle(el).pointerEvents), 'none', 'passive notices do not capture the pointer');
    await page.evaluate(() => G.Settings.set('pad', { pause: [.5, .08] }));
    await page.waitForTimeout(150); await checkTop(page, 667, 375);
    const pause = await page.evaluate(() => { const p = hudTop.pause; return { x: p.x + p.w / 2, y: p.y + p.h / 2 }; });
    await page.touchscreen.tap(pause.x, pause.y);
    await page.locator('#scr-pause').waitFor({ state: 'visible' });
    await page.locator('#btn-resume').click();
    await page.evaluate(() => G.Settings.set('pad', null));
    await page.evaluate(() => { G.Settings.set('stickMode', 'fixed'); });
    const second = await point(page, 'slot:1'); await page.touchscreen.tap(second.x, second.y);
    assert.equal(await page.evaluate(() => G.Game.player.active), 1);
    assert.equal(await page.evaluate(() => G.Touch.stick), null, 'tapping a move does not start the joystick');
    await page.evaluate(() => G.LayoutUI.open()); await page.waitForTimeout(150);
    await page.screenshot({ path: `${out}/editor-667.png` });
    const editor = await page.locator('.lay-bar').boundingBox();
    const dock = await page.evaluate(() => G.BattlePanels.dockLayout(innerWidth, innerHeight));
    assert.equal(editor.width, dock.w); assert.equal(editor.height, dock.h);
    await page.mouse.move(editor.x + editor.width - 24, editor.y + 30); await page.mouse.down();
    await page.mouse.move(editor.x + editor.width - 64, editor.y + 16, { steps: 5 }); await page.mouse.up();
    await page.locator('#lay-save').click();
    assert(await page.evaluate(() => G.Settings.get('pad')?.bar?.length === 2), 'dragged dock position is saved');
    await page.waitForTimeout(100);
    const moved = await point(page, 'slot:2'); await page.touchscreen.tap(moved.x, moved.y);
    assert.equal(await page.evaluate(() => G.Game.player.active), 2);
    await page.screenshot({ path: `${out}/hud-touch-custom-667.png` });
    const saved = await page.evaluate(() => G.Settings.get('pad'));
    await page.setViewportSize({ width: 1280, height: 800 }); await page.waitForTimeout(150);
    const expanded = await point(page, 'slot:1'); await page.touchscreen.tap(expanded.x, expanded.y);
    assert.equal(await page.evaluate(() => G.Game.player.active), 1, 'saved position still switches attacks after expanding to names');
    assert.match(await page.evaluate(() => hudText.join('\n')), /QUICK ATTACK/);
    assert.deepEqual(await page.evaluate(() => G.Settings.get('pad')), saved, 'responsive mode does not overwrite saved positions');
    passed.push('Touch 667/390/320: summary, weather, boss and pause stay apart; compact icons switch attacks without joystick capture; editor drag/save preserves hit targets');
    await page.close();
    assert.deepEqual(errors, []);
    fs.writeFileSync(`${out}/validation.json`, JSON.stringify({ passed, errors, performance }, null, 2));
    console.log(JSON.stringify({ passed, errors, performance, out }, null, 2));
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
