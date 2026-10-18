/* Browser checks for map boss spawning, roaming and proximity-based despawn.
 * BOSS_TEST_URL=http://127.0.0.1:3093/dev.html node tools/test-roaming-bosses.cjs
 * Optional: PLAYWRIGHT_CHROMIUM_EXECUTABLE for an installed Chromium.
 */
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const URL = process.env.BOSS_TEST_URL || 'http://127.0.0.1:3093/dev.html';

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || undefined, args: ['--no-sandbox'] });
  const errors = [];
  async function pageFor(uid) {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, serviceWorkers: 'block' });
    page.on('pageerror', e => errors.push(e.message));
    await page.addInitScript(() => { window.requestAnimationFrame = () => 0; });
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
      // Geometry/lifecycle checks use the actual sprite metadata, without loading
      // thousands of unrelated images every time a fresh run rolls its cast.
      G.Sprites.preload = () => Promise.resolve();
      window.fresh = cfg => { G.Game.startRun(cfg); return G.Game.player; };
      window.check = (ok, msg) => { if (!ok) throw Error(msg); };
      window.spawn = (kind = 'normal') => {
        const p = G.Game.player;
        if (kind === 'normal') { G.Spawner.update(0.01, G.Game.everyone(), 180); return G.EnemyMgr.all().find(e => e.boss); }
        check(G.Challenges.offer(kind, 240, G.Game.everyone()), 'encounter has a free spawn');
        return G.EnemyMgr.get(G.Challenges.state.units[0].id);
      };
      window.freeze = e => { e.slow = 1; e.slowT = 1e6; };
      window.labels = () => {
        const cv = document.createElement('canvas'); cv.width = innerWidth; cv.height = innerHeight;
        const ctx = cv.getContext('2d'), original = ctx.fillText.bind(ctx), out = [];
        ctx.fillText = (text, ...args) => { if (/ · \d+ m$/.test(text)) out.push(text); original(text, ...args); };
        G.HUD.draw(ctx, innerWidth, innerHeight, G.Game.player, G.Game.st); return out;
      };
    });
    return page;
  }
  try {
    const page = await pageFor();
    async function test(name, fn) { await page.evaluate(fn); console.log('PASS', name); }
    await test('all map boss types spawn at 100m on clear ground and show an indicator', () => {
      for (const kind of ['normal', 'stampede', 'ditto']) for (let i = 0; i < 4; i++) {
        const p = fresh(), e = spawn(kind);
        check(e && Math.abs(G.U.dist(p.x, p.y, e.x, e.y) - 3200) < 0.01, '100m spawn: ' + kind);
        check(G.World.isFree(e.x, e.y, 54), 'clear spawn: ' + kind);
        check(labels().some(l => l.endsWith('100 m')), '100m indicator: ' + kind);
      }
    });
    await test('map bosses wander without aggression, survive nearby indefinitely and engage on attack', () => {
      for (const kind of ['normal', 'stampede', 'ditto']) {
        const p = fresh(), e = spawn(kind), x = e.x, y = e.y;
        for (let i = 0; i < 100; i++) G.EnemyMgr.update(0.1, [p]);
        check(G.U.dist(x, y, e.x, e.y) > 1, 'wandering: ' + kind);
        check(!G.EnemyMgr.bossFighting() && !G.Challenges.fighting && e.dmg === 0, 'passive: ' + kind);
        const hp = p.hp; p.x = e.x; p.y = e.y; G.EnemyMgr.rebuildGrid(); G.Combat.resolve(0.01, p, 0);
        check(p.hp === hp, 'no passive contact damage: ' + kind);
        freeze(e); G.EnemyMgr.update(300, [p]); G.Challenges.update(300, [p], 240);
        check(G.EnemyMgr.get(e.id) === e, 'no lifetime expiry near a player: ' + kind);
        e.hurt(1, '#fff', 0, 0, 0, null, p);
        check(G.EnemyMgr.bossFighting() || G.Challenges.fighting, 'first hit engages: ' + kind);
      }
    });
    await test('250m is inclusive; only 120 continuous seconds away despawns, with no rewards', () => {
      for (const kind of ['normal', 'stampede', 'ditto']) for (const engaged of [false, true]) {
        const p = fresh(), e = spawn(kind); freeze(e);
        if (engaged) e.hurt(1, '#fff', 0, 0, 0, null, p);
        p.x = e.x + 8002; p.y = e.y; G.EnemyMgr.update(119, [p]);
        check(G.EnemyMgr.get(e.id) === e, 'not early: ' + kind);
        p.x = e.x + 8000; G.EnemyMgr.update(0.1, [p]);
        p.x = e.x + 8002; G.EnemyMgr.update(119, [p]);
        check(G.EnemyMgr.get(e.id) === e, 'proximity resets the whole countdown: ' + kind);
        G.EnemyMgr.update(1, [p]);
        check(!G.EnemyMgr.get(e.id) && !e.dead, 'despawn without death: ' + kind);
        check(p.kills === 0 && p.bosses === 0 && p.coins === 0 && p.xp === 0, 'no rewards: ' + kind);
        if (kind !== 'normal') check(!G.Challenges.state, 'encounter cleanup: ' + kind);
      }
    });
    await test('a nearby living teammate resets the timer; a fallen teammate does not', () => {
      const p = fresh(), e = spawn(); freeze(e); p.x = e.x + 9000; p.y = e.y;
      const ally = new G.Player(G.DEX_BY[4]); ally.x = e.x; ally.y = e.y;
      G.EnemyMgr.update(300, [p, ally]); check(G.EnemyMgr.get(e.id), 'living ally keeps boss');
      ally.dead = true; G.EnemyMgr.update(119, [p, ally]); check(G.EnemyMgr.get(e.id), 'not early with fallen ally');
      ally.dead = false; G.EnemyMgr.update(0.1, [p, ally]);
      ally.dead = true; G.EnemyMgr.update(119, [p, ally]); check(G.EnemyMgr.get(e.id), 'revived ally reset timer');
      G.EnemyMgr.update(1, [p, ally]); check(!G.EnemyMgr.get(e.id), 'fallen ally cannot prevent despawn');
    });
    await test('roaming bosses do not block later bosses, normal events or rifts', () => {
      const p = fresh(), special = spawn('stampede');
      check(!G.Challenges.blocksEncounters, 'passive encounter does not block rifts/events');
      const first = spawn(); G.Challenges.update(0.1, [p], 180);
      check(G.EnemyMgr.get(special.id) && G.Challenges.state, 'scheduled boss does not delete roaming encounter');
      G.Spawner.update(0.01, [p], 360);
      check(G.EnemyMgr.all().filter(e => e.boss).length === 2, 'two map bosses can persist');
      check(!G.EnemyMgr.bossFighting(), 'roaming bosses do not count as combat');
      const count = G.EnemyMgr.count; G.Spawner.update(5, [p], 361);
      check(G.EnemyMgr.count > count, 'normal waves continue');
      G.Rift.debugOpen(); check(G.Rift.rift, 'rift can open');
      G.Rift.update(1, p, 361); check(G.Rift.rift.t === 1, 'rift continues updating');
      check(G.EnemyMgr.get(first.id), 'first boss remains');
    });
    await test('stored map bosses expire during a rift and cannot reappear on return', () => {
      const p = fresh(), normal = spawn(), special = spawn('ditto');
      G.EnemyMgr.stash(); p.x = 100000; p.y = 100000;
      G.EnemyMgr.update(120, [p]); G.EnemyMgr.restore();
      check(!G.EnemyMgr.get(normal.id) && !G.EnemyMgr.get(special.id) && !G.Challenges.state, 'expired stored bosses stay gone');
      fresh(); const live = spawn(); G.EnemyMgr.stash(); G.EnemyMgr.update(119, [G.Game.player]); G.EnemyMgr.restore();
      check(G.EnemyMgr.get(live.id), 'stored boss within range remains');
      G.Rift.debugArena('psychic'); const legend = G.EnemyMgr.get(G.Rift.arena.bossId);
      G.Game.player.x += 20000; G.EnemyMgr.update(121, [G.Game.player]);
      check(G.EnemyMgr.get(legend.id), 'legendary arena boss is not subject to map despawn');
      fresh(); const waiting = spawn('ditto'); G.Rift.debugArena('psychic');
      G.EnemyMgr.update(120, [G.Game.player]);
      check(!G.Challenges.state, 'stored encounter expires in the arena');
      const left = G.Rift.timeLeft; G.Rift.update(0.5, G.Game.player, 240);
      check(G.Rift.timeLeft < left, 'encounter recovery cannot pause the arena countdown');
    });

    const host = await pageFor('host'), guest = await pageFor('guest'), pages = { host, guest };
    const cfg = { seed: 42, host: 'host', members: [{ uid: 'host', name: 'Host', dex: 25 }, { uid: 'guest', name: 'Guest', dex: 4 }] };
    async function exchange() {
      for (let turn = 0; turn < 3; turn++) for (const p of [host, guest]) {
        const packets = await p.evaluate(() => { G.Coop.tick(0.1); return window.packets.splice(0); });
        for (const packet of packets) await pages[packet.to].evaluate(o => receivePacket(o.from, o.msg), packet);
      }
      for (const p of [host, guest]) await p.evaluate(() => { for (const m of G.Coop.puppets()) m.netUpdate(1); });
    }
    for (const kind of ['normal', 'stampede', 'ditto']) {
      for (const p of [host, guest]) await p.evaluate(cfg => { fresh(cfg); G.Game.player.x = G.Game.player.y = 0; }, cfg);
      await exchange();
      const id = await host.evaluate(kind => { const e = spawn(kind); freeze(e); return e.id; }, kind); await exchange();
      const distant = await guest.evaluate(() => ({ labels: labels(), player: [G.Game.player.x, G.Game.player.y], enemies: G.EnemyMgr.all().map(e => ({id:e.id, x:e.x, y:e.y, boss:e.boss, distance:G.U.dist(e.x,e.y,G.Game.player.x,G.Game.player.y)})) }));
      assert(distant.labels.some(l => l.endsWith('100 m')), 'guest sees distant boss: '+JSON.stringify(distant));
      assert.equal(await guest.evaluate(id => G.EnemyMgr.get(id).dmg, id), 0);
      await guest.evaluate(id => G.EnemyMgr.get(id).hurt(1, '#fff', 0, 0, 0, null, G.Game.player), id); await exchange();
      if (kind === 'normal') for (const p of [host, guest]) assert.equal(await p.evaluate(() => G.EnemyMgr.bossFighting()), true);
      else for (const p of [host, guest]) assert.equal(await p.evaluate(() => G.Challenges.fighting), true);
      const pos = await host.evaluate(id => { const e = G.EnemyMgr.get(id); return { x: e.x, y: e.y }; }, id);
      await host.evaluate(pos => { G.Game.player.x = pos.x + 9000; G.Game.player.y = pos.y; }, pos);
      await guest.evaluate(pos => { G.Game.player.x = pos.x; G.Game.player.y = pos.y; }, pos); await exchange();
      await host.evaluate(() => G.EnemyMgr.update(300, G.Game.everyone())); await exchange();
      assert(await guest.evaluate(id => !!G.EnemyMgr.get(id), id), 'nearby guest keeps boss');
      await guest.evaluate(pos => { G.Game.player.x = pos.x + 9000; G.Game.player.y = pos.y; }, pos); await exchange();
      await guest.evaluate(() => G.EnemyMgr.update(121, G.Game.everyone()));
      assert(await guest.evaluate(id => !!G.EnemyMgr.get(id), id), 'guest cannot decide despawn');
      await host.evaluate(() => G.EnemyMgr.update(119, G.Game.everyone())); await exchange();
      assert(await guest.evaluate(id => !!G.EnemyMgr.get(id), id), 'guest sees boss until expiry');
      await host.evaluate(() => G.EnemyMgr.update(1, G.Game.everyone())); await exchange();
      for (const p of [host, guest]) assert.equal(await p.evaluate(id => !!G.EnemyMgr.get(id), id), false);
      console.log('PASS co-op distant indicator, first hit, teammate proximity and authoritative despawn', kind);
    }
    assert.deepEqual(errors, []);
    console.log('All roaming boss checks passed.');
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
