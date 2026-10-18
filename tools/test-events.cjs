/* Browser integration checks. Start the local server, then run with Playwright installed.
 * EVENT_TEST_URL=http://127.0.0.1:3087/dev.html node tools/test-events.cjs
 * Optional: PLAYWRIGHT_CHROMIUM_EXECUTABLE for an existing Chromium installation.
 */
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const URL = process.env.EVENT_TEST_URL || 'http://127.0.0.1:3087/dev.html';

(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || undefined, args: ['--no-sandbox'] });
  const errors = [];
  async function pageFor(uid) {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    page.on('pageerror', e => errors.push(e.message));
    await page.addInitScript(() => { window.requestAnimationFrame = () => 0; });
    if (uid) await page.route('**/js/net/net.js', route => route.fulfill({ contentType: 'application/javascript', body: `
      window.packets = [];
      G.Net = { uid: ${JSON.stringify(uid)}, on(fn) { window.receivePacket = fn; }, onPeer() {}, slow() { return false; },
        send(to, msg) { packets.push({ from: this.uid, to, msg }); }, toHost(msg) { this.send('host', msg); },
        close() {}, peers() { return []; }, mode() { return 'direct'; } };
    ` }));
    await page.goto(URL);
    await page.waitForFunction(() => G.Game && document.getElementById('boot').classList.contains('hidden'));
    await page.evaluate(() => {
      document.getElementById('tap-start').classList.add('hidden');
      G.DB.playAsGuest(); G.DB.save.partner = 25; G.Game.startRun();
      window.fresh = () => { G.Game.startRun(); return G.Game.player; };
      window.beginEvent = (id, time = 240) => {
        const p = G.Game.player;
        if (!G.Challenges.offer(id, time, G.Game.everyone(), { x: p.x, y: p.y })) throw Error('offer failed: ' + id);
        G.Challenges.request(p, G.Challenges.state.seq, G.Challenges.snapshot(p));
        return p;
      };
      window.stepEvent = dt => G.Challenges.update(dt, G.Game.everyone(), 240);
      window.takeReward = () => { G.GroundItems.update(); G.ItemUI.update(); G.ItemUI.take(); };
      window.check = (condition, message) => { if (!condition) throw Error(message); };
    });
    return page;
  }
  const page = await pageFor();
  async function test(name, fn) {
    await page.evaluate(fn); console.log('PASS', name);
  }
  try {
    await test('scheduler leaves room for the next boss and avoids rifts', () => {
      fresh(); check(G.Challenges.available(240).length === 4, 'four eligible events');
      check(!G.Challenges.available(300).includes('house'), 'house cannot overlap next boss');
      check(G.Challenges.available(1790).length === 0, 'judgment reserve');
      beginEvent('ditto'); check(G.Challenges.available(240).length === 0, 'only one event');
      check(G.Challenges.blocksEncounters && G.Challenges.spawnFactor === 0.5, 'pressure control');
    });
    await test('house waves, partial rewards, final reward and return to the world', () => {
      const p = fresh(); const origin = [p.x, p.y]; beginEvent('house');
      for (let i = 0; i < 3; i++) {
        check(G.EnemyMgr.all().length === [6, 8, 10][i], 'wave size');
        stepEvent(20.01);
        check(p.coins === [150, 350, 600][i], 'cumulative reward');
        if (i < 2) { const s = G.Challenges.state; p.x = s.x; p.y = s.y; G.Challenges.request(p, s.seq); }
      }
      check(!G.Challenges.state && !G.World.arena, 'house exited');
      check(p.x === origin[0] && p.y === origin[1], 'return position');
      check(!p.item, 'item waits for confirmation'); takeReward();
      check(p.t1 === 1 && p.item, 'ticket and confirmed item');
      check(G.EnemyMgr.count === 0 && G.Pickups.count === 0, 'timed survivors have no loot');
    });
    await test('house emergency exit preserves completed rewards', () => {
      const p = fresh(); beginEvent('house'); stepEvent(20.01);
      const s = G.Challenges.state; p.x = s.x; p.y = s.y + 195; stepEvent(0.1);
      check(!G.Challenges.state && p.coins === 150 && !p.t1, 'leave with stage one');
    });
    await test('Rocket pays each generator once and expires without extra penalty', () => {
      const p = fresh(); beginEvent('rocket');
      G.EnemyMgr.all().find(e => e.eventRole === 'generator').hurt(1e8);
      stepEvent(0.1); stepEvent(0.1); check(p.coins === 150, 'one generator, one payment');
      stepEvent(60); check(!G.Challenges.state && p.coins === 150 && p.t1 === 0, 'partial reward survives timeout');
    });
    await test('Rocket completion offers two distinct existing items', () => {
      const p = fresh(); beginEvent('rocket');
      for (const e of G.EnemyMgr.all().slice()) if (e.eventRole === 'generator') e.hurt(1e8);
      stepEvent(0.1); check(p.coins === 450 && p.t1 === 1, 'Rocket reward');
      G.ItemUI.update();
      const cards = [...document.querySelectorAll('#item-compare [data-item-option]')];
      check(cards.length === 2 && cards[0].dataset.itemOption !== cards[1].dataset.itemOption, 'two choices');
      cards[1].click(); check(!p.item, 'selection does not equip'); takeReward();
      check(p.item === cards[1].dataset.itemOption && !G.GroundItems.all().length, 'one chosen reward equipped');
    });
    await test('Tauros hits at most once per pass and awards the trail item', () => {
      const p = fresh(); beginEvent('stampede'); const s = G.Challenges.state;
      const lane = [-72, 0, 72].find(y => y !== s.safeY);
      p.x = s.x - 175; p.y = s.y + lane; p.invuln = 0;
      const hp = p.hp; stepEvent(2.02); const after = p.hp;
      check(after < hp && hp - after <= p.maxHp * 0.081, '8% hit');
      p.invuln = 0; stepEvent(0.01); check(p.hp === after, 'no repeated hit');
      p.x = s.x; p.y = s.y; stepEvent(3); stepEvent(5.01); stepEvent(5.01);
      check(s.phase === 'alpha', 'three passes then alpha');
      G.EnemyMgr.get(s.alpha).hurt(1e8); stepEvent(0.1);
      takeReward(); check(p.coins === 250 && p.item === 'herdtrail', 'alpha reward');
      check(Math.abs(p.spdMul - 1.1) < 0.001, 'speed bonus'); p.equip(null);
      check(Math.abs(p.spdMul - 1) < 0.001, 'speed bonus removed');
    });
    await test('Ditto snapshots its initiator, transforms invulnerably and awards Echo', () => {
      const p = fresh(); p.addMove('ember');
      beginEvent('ditto'); const s = G.Challenges.state, snapshot = JSON.stringify(s.model.moves);
      const e = G.EnemyMgr.get(s.units[0].id), hp = e.hp;
      e.hurt(1e8); check(e.hp === hp && e.invulnerable, 'cannot damage transforming Ditto');
      p.moves[0].lvl = 5; check(JSON.stringify(s.model.moves) === snapshot, 'immutable snapshot');
      stepEvent(3.01); check(s.phase === 'fight' && !e.invulnerable, 'three second transformation');
      stepEvent(0.8); check(G.Challenges.warning, 'telegraph before attack');
      stepEvent(1.01); check(G.Projectiles.all().some(o => !o.friendly && o.corrupt), 'hostile copied projectile');
      e.hurt(1e8); stepEvent(0.1);
      takeReward(); check(p.coins === 400 && p.item === 'dittoecho', 'Ditto reward');
    });
    await test('Echo counts casts, deals 60%, and never recursively creates echoes', () => {
      const p = fresh(); p.equip('dittoecho'); G.EventItems.tick(0, p); p.aimed = true;
      const m = p.moves[0]; m.count = 3;
      for (let i = 0; i < 3; i++) { G.Combat.replay(p, m); G.EventItems.onCast(p, m); }
      check(G.Projectiles.count === 9, 'three casts, nine projectiles');
      G.EventItems.tick(0.3, p);
      check(G.Projectiles.count === 12, 'one echo with same projectile count');
      const ps = G.Projectiles.all(); check(Math.abs(ps[11].dmg / ps[0].dmg - 0.6) < 0.001, 'echo damage');
      for (let i = 0; i < 20; i++) G.EventItems.tick(1, p);
      check(G.Projectiles.count === 12, 'no recursive echoes');
    });
    await test('overlapping trail sections damage each enemy only once per tick', () => {
      const p = fresh(); p.equip('herdtrail'); p.walking = true; p.baseAtk = 100;
      const e = new G.Enemy({ dex: 19, hp: 10000, dmg: 0, spd: 0, xp: 0, behavior: 'chase' }, 9, 0, { hp: 1, spd: 1, dmg: 1 });
      G.EnemyMgr.add(e); G.EnemyMgr.rebuildGrid();
      G.EventItems.tick(0.01, p); p.x = 18; G.EventItems.tick(0.01, p);
      const hp = e.hp; G.EventItems.tick(0.25, p);
      check(hp - e.hp === Math.round(p.activeMove().dmg * 100 * 0.2 * 0.25), 'one tick for overlapping sections');
      p.walking = false; G.EventItems.tick(2.1, p); const expired = e.hp; G.EventItems.tick(1, p);
      check(e.hp === expired, 'trails expire');
    });
    await test('Echo preserves normal turrets, patches and accumulated buffs', () => {
      const p = fresh(); p.equip('dittoecho'); G.EventItems.tick(0, p);
      const turret = G.Moves.instance('will-o-wisp', 1);
      for (let i = 0; i < 3; i++) { G.Combat.replay(p, turret); G.EventItems.onCast(p, turret); }
      G.Combat.updateFields(0); check(G.Combat.fieldCount === 1, 'normal turret limit');
      G.EventItems.tick(0.3, p); G.Combat.updateFields(0);
      check(G.Combat.fieldCount === 2, 'echo keeps the original turret');
      G.Combat.replay(p, turret); G.Combat.updateFields(0);
      check(G.Combat.fieldCount === 2, 'new normal turret keeps the echo');
      G.Combat.clearFields();
      const patch = G.Moves.instance(Object.values(G.Moves.BY_ID).find(m => m.kind === 'trail').id, 1);
      for (let i = 0; i < 3; i++) { G.Combat.replay(p, patch); G.EventItems.onCast(p, patch); }
      check(G.Combat.fieldCount === 1, 'normal patch overlap limit');
      G.EventItems.tick(0.3, p); check(G.Combat.fieldCount === 2, 'echo patch is not suppressed');
      const buff = G.Moves.instance('swords-dance', 1);
      for (let i = 0; i < 3; i++) { G.Combat.replay(p, buff); G.EventItems.onCast(p, buff); }
      const atk = p.atk; G.EventItems.tick(0.3, p);
      check(p.atk >= atk && p.buffs.atk.amount === buff.amount, 'echo never weakens stacked buffs');
    });
    await test('every copied move family executes without damaging allied enemies', () => {
      const p = fresh(); p.maxHp = p.hp = 100000;
      const fake = new G.Player(G.DEX_BY[25]); fake.hostile = true; fake.x = p.x - 60; fake.y = p.y;
      fake.target = p; fake.aim = 0; fake.aimed = true; fake.aimAt = { x: p.x, y: p.y };
      const ally = new G.Enemy({ dex: 19, hp: 10000, dmg: 0, spd: 0, xp: 0, behavior: 'chase' }, 0, 0, { hp: 1, spd: 1, dmg: 1 });
      G.EnemyMgr.add(ally); G.EnemyMgr.rebuildGrid();
      const kinds = new Set();
      for (const def of Object.values(G.Moves.BY_ID)) {
        if (kinds.has(def.kind)) continue; kinds.add(def.kind);
        const m = G.Moves.instance(def.id, 1); m.corrupt = true;
        G.Combat.replay(fake, m); G.Combat.updateFields(0.6); G.Projectiles.update(0.1, p, G.EnemyMgr.all()); G.Combat.resolve(0.1, p, 1);
        G.Combat.clearFields(); G.Projectiles.clear();
      }
      check(kinds.size === 15, 'all move families'); check(ally.hp === ally.maxHp, 'impostor cannot attack enemies');
    });

    const host = await pageFor('host'), guest = await pageFor('guest');
    const pages = { host, guest };
    const cfg = { seed: 42, host: 'host', members: [{ uid: 'host', name: 'Host', dex: 25 }, { uid: 'guest', name: 'Guest', dex: 4, shiny: true }] };
    async function exchange() {
      for (let turn = 0; turn < 3; turn++) for (const [uid, p] of Object.entries(pages)) {
        const packets = await p.evaluate(() => { G.Coop.tick(0.1); return packets.splice(0); });
        for (const packet of packets) await pages[packet.to].evaluate(o => receivePacket(o.from, o.msg), packet);
      }
    }
    for (const [uid, p] of Object.entries(pages)) await p.evaluate(({ cfg, uid }) => { G.DB.save.partner = uid === 'host' ? 25 : 4; G.Game.startRun(cfg); }, { cfg, uid });
    await exchange();
    await host.evaluate(() => { const p = G.Coop.mate('guest').pl; G.Challenges.offer('ditto', 240, G.Game.everyone(), { x: p.x, y: p.y }); });
    await exchange();
    await guest.evaluate(() => { G.Game.player.shiny = true; G.Game.player.addMove('tackle'); stepEvent(1.3); });
    await exchange();
    const model = await host.evaluate(() => G.Challenges.state.model);
    assert.equal(model.dex, 4); assert.equal(model.uid, 'guest'); assert.equal(model.moves.length, 2); assert.equal(model.shiny, true);
    assert.deepEqual(await guest.evaluate(() => G.Challenges.state.model), model);
    for (const p of [host, guest]) {
      assert.deepEqual(await p.evaluate(() => { const e = G.EnemyMgr.get(G.Challenges.state.units[0].id); return { shiny: e.anim.shiny, damage: e.dmg }; }), { shiny: true, damage: 0 });
    }
    await host.evaluate(() => stepEvent(3.01)); await exchange();
    for (const p of [host, guest]) {
      assert.equal(await p.evaluate(() => G.EnemyMgr.get(G.Challenges.state.units[0].id).dmg), 5);
    }
    await host.evaluate(() => { const s = G.Challenges.state; G.EnemyMgr.get(s.units[0].id).hurt(1e8); stepEvent(0.1); });
    await exchange();
    for (const p of [host, guest]) await p.evaluate(() => takeReward());
    await exchange();
    for (const p of [host, guest]) {
      const reward = await p.evaluate(() => ({ coins: G.Game.player.coins, item: G.Game.player.item, state: G.Challenges.state }));
      assert.deepEqual(reward, { coins: 400, item: 'dittoecho', state: null });
    }
    console.log('PASS co-op guest initiator snapshot and synchronized rewards through the real co-op protocol');
    for (const [uid, p] of Object.entries(pages)) await p.evaluate(({ cfg, uid }) => { G.DB.save.partner = uid === 'host' ? 25 : 4; G.Game.startRun(cfg); }, { cfg, uid });
    await exchange();
    await host.evaluate(() => beginEvent('house'));
    await exchange();
    assert.equal(await guest.evaluate(() => G.Challenges.inHouse), true);
    assert.equal(await guest.evaluate(() => G.EnemyMgr.count), 8);
    await host.evaluate(() => { stepEvent(20.01); const s = G.Challenges.state; const p = G.Game.player; p.x = s.x; p.y = s.y + 195; stepEvent(0.1); });
    await exchange();
    for (const p of [host, guest]) {
      assert.deepEqual(await p.evaluate(() => ({ house: G.Challenges.inHouse, coins: G.Game.player.coins, arena: G.World.arena })), { house: false, coins: 150, arena: null });
    }
    console.log('PASS co-op house travel, scaled wave, partial rewards and exit');
    assert.deepEqual(errors, []);
    console.log('All event integration checks passed.');
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
