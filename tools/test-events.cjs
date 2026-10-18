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
    await page.waitForFunction(() => G.Game && document.getElementById('boot').classList.contains('hidden'), null, { polling: 50 });
    await page.evaluate(() => {
      document.getElementById('tap-start').classList.add('hidden');
      G.DB.playAsGuest(); G.DB.save.partner = 25; G.Game.startRun();
      window.fresh = () => { G.Game.startRun(); return G.Game.player; };
      window.beginEvent = (id, time = 240) => {
        const p = G.Game.player;
        if (!G.Challenges.offer(id, time, G.Game.everyone(), { x: p.x, y: p.y })) throw Error('offer failed: ' + id);
        G.EnemyMgr.get(G.Challenges.state.units[0].id).hurt(1, '#fff', 0, 0, 0, null, p);
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
    await test('only two roaming bosses remain, and scheduled encounters keep their reservation', () => {
      fresh(); check(G.Challenges.ids.join(',') === 'stampede,ditto', 'removed House/Rocket');
      check(G.Challenges.available(240).length === 2, 'two eligible bosses');
      check(G.Challenges.available(1790).length === 0, 'judgment reserve');
      check(!G.Challenges.offer('house', 240, G.Game.everyone()), 'removed House cannot be offered');
      check(!G.Challenges.offer('rocket', 240, G.Game.everyone()), 'removed Rocket cannot be offered');
    });
    await test('boss roams, marker follows, proximity never starts combat, first player hit does', () => {
      const p = fresh(); G.Challenges.offer('stampede', 240, [p], {x:p.x, y:p.y});
      const e = G.EnemyMgr.get(G.Challenges.state.units[0].id), hp = p.hp;
      for(let i=0;i<100;i++) G.EnemyMgr.update(0.1,[p]);
      check(Math.hypot(e.x-p.x,e.y-p.y)>1,'boss moved');
      check(G.Challenges.markers()[0].x===e.x,'marker follows entity');
      p.x=e.x;p.y=e.y; G.EnemyMgr.rebuildGrid(); G.Combat.resolve(0.1,p,1); stepEvent(25);
      check(G.Challenges.state.phase==='roam' && p.hp===hp,'no proximity trigger or passive damage');
      const before=e.hp; e.hurt(1,'#fff',0,0,0,null,p);
      check(G.Challenges.state.phase==='fight' && e.hp===before-1,'real first attack starts fight');
      check(e.scale>1.5 && G.Challenges.fighting,'large active boss');
    });
    await test('Tauros remains present, alternates all three attacks, and pays only once on defeat', () => {
      fresh(); const p=beginEvent('stampede'), e=G.EnemyMgr.get(G.Challenges.state.units[0].id), seen=new Set();
      p.maxHp=p.hp=100000;
      for(let i=0;i<500;i++) { stepEvent(0.03); if(G.Challenges.state.attack) seen.add(G.Challenges.state.attack.id); }
      check(['charge','stomp','stampede'].every(id=>seen.has(id)),'full moveset');
      check(G.EnemyMgr.get(e.id)===e && !e.dead,'same boss throughout fight');
      e.hurt(1e8,'#fff',0,0,0,null,p);stepEvent(0.1);stepEvent(0.1);takeReward();
      check(p.coins===250&&p.item==='herdtrail'&&!G.Challenges.state,'single reward');
    });
    await test('Stampede spans the screen, leaves a safe corridor and hits at most once per pass', () => {
      fresh(); const p=beginEvent('stampede'), s=G.Challenges.state;
      s.moveIndex=2;s.castT=0;stepEvent(0.01);const a=s.attack,z=a.zones[0];
      check(a.id==='stampede'&&z.len>G.Camera.w*1.5&&z.w>200,'large lanes');
      check(!a.zones.some(z=>G.Hazards.inside(z,a.x,a.y,p.r)),'safe center corridor');
      p.x=z.x+Math.cos(z.angle)*z.len*0.5;p.y=z.y+Math.sin(z.angle)*z.len*0.5;
      p.maxHp=p.hp=1000;p.invuln=0;const hp=p.hp;
      for(let i=0;i<130;i++){p.invuln=0;stepEvent(0.03);}
      check(hp-p.hp>0&&hp-p.hp<=80,'one 8% hit');
    });
    await test('Ditto snapshots first hitter, transforms, copies natural colors and alternates faster', () => {
      const p=fresh();p.addMove('ember'); beginEvent('ditto');
      const s=G.Challenges.state, model=JSON.stringify(s.model.moves),e=G.EnemyMgr.get(s.units[0].id),hp=e.hp;
      e.hurt(1e8,'#fff',0,0,0,null,p);check(e.hp===hp&&e.invulnerable,'transformation invulnerability');
      p.moves[0].lvl=5;check(JSON.stringify(s.model.moves)===model,'immutable snapshot');
      stepEvent(3.01);check(s.phase==='fight'&&!e.invulnerable&&e.scale===2,'large transformed copy');
      stepEvent(0.51);const first=G.Challenges.warning;check(first&&first.duration<1,'short readable windup');
      const x=e.x;p.x=e.x+400;G.Challenges.updateEnemy(e,0.1,p);check(e.x!==x,'moves during warning');
      stepEvent(first.duration+0.01);
      const shot=G.Projectiles.all().find(o=>!o.friendly);check(shot&&!shot.corrupt,'normal hostile projectile');
      check(shot.color===G.U.TYPE_COLOR[shot.mtype],'natural move palette');
      stepEvent(0.33);check(G.Challenges.warning.index!==first.index,'next copied move with short recovery');
      e.hurt(1e8,'#fff',0,0,0,null,p);stepEvent(0.1);takeReward();
      check(p.coins===400&&p.item==='dittoecho','Ditto reward');
    });
    await test('Ditto approaches before short-range casts and can hit a stationary target', () => {
      const collide = G.World.collide;
      G.World.collide = () => false;
      try {
        for (const [id, level] of [['tackle', 1], ['fire-spin', 1], ['giga-drain', 1], ['leaf-storm', 4], ['leaf-storm', 5]]) for (const angle of [0, Math.PI / 2, Math.PI / 4]) {
          const p = fresh(), m = G.Moves.instance(id, level);
          if (level === 5) G.Moves.evolve(m);
          p.moves = [m]; p.slots = [[m]]; p.maxHp = p.hp = 10000;
          beginEvent('ditto');
          const e = G.EnemyMgr.get(G.Challenges.state.units[0].id);
          e.x = p.x - Math.cos(angle) * 240; e.y = p.y - Math.sin(angle) * 240; stepEvent(3.01);
          let casts = 0;
          for (let i = 0; i < 130; i++) {
            p.invuln = 0; G.Challenges.updateEnemy(e, 0.04, p); stepEvent(0.04);
            if (G.Challenges.warning) {
              const w = G.Challenges.warning;
              check(Math.hypot(w.x - p.x, w.y - p.y) <= m.radius + p.r, 'reachable ' + id);
              casts++;
            }
            G.Projectiles.update(0.04, p, G.EnemyMgr.all());
            e.dmg = 0; G.Combat.resolve(0.04, p, i * 0.04);
          }
          check(casts > 0 && p.hp < p.maxHp, id + ' actually hits, without contact damage');
        }
      } finally { G.World.collide = collide; }
    });
    await test('Ditto telegraphs cover melee arcs, full cone spread, and radial projectile reach', () => {
      fresh();
      const tackle = G.Moves.instance('tackle', 1), flame = G.Moves.instance('flamethrower', 1), nova = G.Moves.instance('heat-wave', 1);
      const arc = G.Combat.warningZones(tackle, 0, 0, 0, 0, 0)[0];
      check(arc.kind === 'sector' && arc.arc === tackle.arc && arc.r === tackle.radius, 'melee arc footprint');
      const cone = G.Combat.warningZones(flame, 0, 0, 0, 0, 0)[0];
      check(cone.kind === 'sector' && cone.arc >= flame.arc + 0.1 && cone.r >= flame.speed * flame.life * 1.155, 'full cone spread');
      const ring = G.Combat.warningZones(nova, 0, 0, 0, 0, 0)[0];
      check(ring.kind === 'zone' && ring.r >= nova.speed * nova.life + nova.size && ring.round, 'full radial reach');
      const ctx = document.createElement('canvas').getContext('2d');
      for (const zone of [arc, cone, ring]) for (const progress of [0, 0.5, 1]) G.Hazards.drawWarning(ctx, zone, progress);
    });
    await test('actual melee and projectile damage can engage a roaming boss', () => {
      for(const id of ['tackle','ember']) {
        const p=fresh();G.Challenges.offer('stampede',240,[p],{x:40,y:0});
        const e=G.EnemyMgr.get(G.Challenges.state.units[0].id);G.EnemyMgr.rebuildGrid();
        p.aim=0;p.aimed=true;p.aimAt={x:e.x,y:e.y};p.target=e;
        G.Combat.replay(p,G.Moves.instance(id,1));
        for(let i=0;i<15;i++){G.Projectiles.update(.02,p,G.EnemyMgr.all());G.Combat.resolve(.02,p,i*.02);}
        check(G.Challenges.state.phase==='fight','real '+id+' engages');
      }
    });
    await test('scheduled bosses wait during a fight, then resume after victory', () => {
      fresh();const p=beginEvent('stampede'),e=G.EnemyMgr.get(G.Challenges.state.units[0].id),time=G.Enemies.BOSSES[0].at;
      G.Spawner.update(.01,[p],time);check(!G.EnemyMgr.bossAlive(),'scheduled boss deferred');
      e.hurt(1e8,'#fff',0,0,0,null,p);stepEvent(.01);
      G.Spawner.update(.01,[p],time);check(G.EnemyMgr.bossAlive(),'scheduled boss resumes');
    });
    await test('Ditto expression preserves transparency and rear-facing frames, including shiny animation sheets', async () => {
      for(const dex of [1,4,7,25,133,813]) for(const shiny of [false,true]) for(const anim of ['Idle','Walk','Attack']) {
        const sheet=G.Sprites.sheet(dex,anim,shiny),meta=G.Sprites.animMeta(dex,anim,shiny);
        for(let i=0;i<200&&!sheet.ready;i++) await new Promise(r=>setTimeout(r,10));
        check(sheet.ready,'sprite loaded');
        const filtered=G.DittoFace.sheet(sheet.img,meta,dex),c=document.createElement('canvas');c.width=sheet.img.width;c.height=sheet.img.height;
        const ctx=c.getContext('2d',{willReadFrequently:true});ctx.drawImage(sheet.img,0,0);const before=ctx.getImageData(0,0,c.width,c.height).data;
        ctx.clearRect(0,0,c.width,c.height);ctx.drawImage(filtered,0,0);const after=ctx.getImageData(0,0,c.width,c.height).data;
        let changed=0;
        for(let i=0;i<before.length;i+=4){check(before[i+3]===after[i+3],'silhouette unchanged');
          const row=Math.floor(Math.floor(i/4/c.width)/meta.h),same=before[i]===after[i]&&before[i+1]===after[i+1]&&before[i+2]===after[i+2];
          if(row>=3&&row<=5)check(same,'no face on back');if(!same)changed++;
        }
        check(changed>0,'front expression applied');check(filtered===G.DittoFace.sheet(sheet.img,meta,dex),'sheet cached');
      }
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
        const m = G.Moves.instance(def.id, 1);
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
    await guest.evaluate(() => { G.Game.player.shiny = true; G.Game.player.addMove('tackle'); const e=G.EnemyMgr.get(G.Challenges.state.units[0].id); e.hurt(1, '#fff', 0, 0, 0, null, G.Game.player); });
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
    await host.evaluate(()=>G.Challenges.offer('stampede',240,G.Game.everyone(),{x:200,y:0}));await exchange();
    await guest.evaluate(() => { G.Game.player.x = 5000; }); await exchange();
    await host.evaluate(() => { const e = G.EnemyMgr.get(G.Challenges.state.units[0].id); e.x = 400; e.y = 300; stepEvent(0.3); });
    await exchange();
    await guest.evaluate(() => {
      const e = G.EnemyMgr.get(G.Challenges.state.units[0].id);
      check(e.x !== 400, 'enemy position intentionally outside replication range');
      stepEvent(0.01);
      const marker = G.Challenges.markers()[0];
      check(marker.x === 400 && marker.y === 300, 'distant minimap uses authoritative state');
      G.Game.player.x = 0;
    });
    console.log('PASS co-op distant roaming boss marker survives local stale enemy positions');
    await exchange();
    await guest.evaluate(()=>{const e=G.EnemyMgr.get(G.Challenges.state.units[0].id);e.hurt(1,'#fff',0,0,0,null,G.Game.player);});await exchange();
    for(const p of [host,guest]) assert.equal(await p.evaluate(()=>G.Challenges.state.phase),'fight');
    await host.evaluate(()=>{const s=G.Challenges.state;s.moveIndex=2;s.castT=0;stepEvent(0.01);});await exchange();
    const guestAttack = await guest.evaluate(() => G.Challenges.state.attack), hostAttack = await host.evaluate(() => G.Challenges.state.attack);
    const { t: guestTime, ...guestGeometry } = guestAttack, { t: hostTime, ...hostGeometry } = hostAttack;
    assert.deepEqual(guestGeometry, hostGeometry); assert.ok(Math.abs(guestTime - hostTime) <= 0.2, 'clock within broadcast interval');
    await host.evaluate(()=>{const e=G.EnemyMgr.get(G.Challenges.state.units[0].id);e.hurt(1e8,'#fff',0,0,0,null,G.Game.player);stepEvent(0.1);});await exchange();
    for(const p of [host,guest]) {await p.evaluate(()=>takeReward());assert.equal(await p.evaluate(()=>G.Game.player.coins),250);}
    console.log('PASS co-op first-hit engagement, shared stampede geometry and rewards');
    assert.deepEqual(errors, []);
    console.log('All event integration checks passed.');
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
