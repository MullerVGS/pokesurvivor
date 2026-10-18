/* Encuentros opcionales: estado y recompensas del anfitrión; daño local como el combate normal. */
G.Challenges = (() => {
  const IDS = ['house', 'rocket', 'stampede', 'ditto'];
  const NAMES = { house: 'Casa Monstruo', rocket: 'Operación Rocket', stampede: 'Estampida de Tauros', ditto: 'Ditto impostor' };
  const RESERVE = { house: 110, rocket: 95, stampede: 65, ditto: 85 };
  const authority = () => !G.Coop.active || G.Coop.isHost;
  let state = null, serial = 0, recovery = 0, netT = 0, hold = 0, requested = false;
  let back = null, actor = null, warning = null, waveHit = -1, effects = [], used = new Set();
  const units = new Map();
  const copy = o => JSON.parse(JSON.stringify(o));
  const distance = (a, b) => G.U.dist(a.x, a.y, b.x, b.y);
  function reset() {
    state = null; recovery = 0; hold = 0; requested = false; back = null; actor = null;
    warning = null; effects = []; waveHit = -1; used.clear(); units.clear(); G.EventItems.reset();
  }
  function available(time) {
    if (state || recovery > 0 || G.Rift.rift || G.Rift.inArena || G.Judgment.active || G.EnemyMgr.bossAlive()) return [];
    const next = G.Enemies.BOSSES.find(b => b.at > time);
    const until = Math.min(next ? next.at : Infinity, G.Judgment.AT) - time;
    const choices = IDS.filter(id => until > RESERVE[id]);
    if (choices.length && choices.every(id => used.has(id))) used.clear();
    return choices.filter(id => !used.has(id));
  }
  function freeRect(x, y, rx, ry) {
    for (let dx = -rx; dx <= rx; dx += 24) for (let dy = -ry; dy <= ry; dy += 24) {
      if (!G.World.isFree(x + dx, y + dy, 18)) return false;
    }
    return true;
  }
  function site(id, pl) {
    for (let i = 0; i < 100; i++) {
      const a = i * 2.4, d = 180 + (i % 8) * 45;
      const x = pl.x + Math.cos(a) * d, y = pl.y + Math.sin(a) * d;
      const rx = id === 'stampede' ? 180 : id === 'rocket' ? 125 : 30;
      const ry = id === 'stampede' ? 115 : id === 'rocket' ? 100 : 30;
      if (!freeRect(x, y, rx, ry)) continue;
      let reachable = true;
      for (let q = 0; q <= 1; q += 0.05) if (!G.World.isFree(pl.x + (x - pl.x) * q, pl.y + (y - pl.y) * q, 15)) { reachable = false; break; }
      if (reachable) return { x, y };
    }
    return null;
  }
  function offer(id, time, players, at) {
    if (!authority() || !IDS.includes(id) || state) return false;
    const pl = players.find(p => !p.dead);
    if (!pl) return false;
    const p = at || site(id, pl);
    if (!p) return false;
    state = { id, seq: ++serial, phase: 'offer', t: 0, x: p.x, y: p.y, time, units: [], stage: 0, n: players.length };
    hold = 0; requested = false; waveHit = -1; used.add(id);
    G.Sprites.preload([132, 128, 109, 23, pl.dex]);
    sync(); G.Spawner.say(NAMES[id] + ' — acércate y quédate en el círculo para empezar', 4);
    return true;
  }
  function sync() { if (G.Coop.isHost && state) G.Coop.broadcast(['challenge', 'state', copy(state)]); }
  function snapshot(pl) { return { dex: pl.dex, shiny: !!pl.shiny, moves: pl.moves.map(m => ({ id: m.id, lvl: m.lvl, evolved: !!m.evolved })) }; }
  function request(pl, seq, data) {
    if (!authority() || !state || state.seq !== seq || pl.dead || distance(pl, state) > 65) return false;
    if (state.phase !== 'offer' && state.phase !== 'between') return false;
    if (state.phase === 'between') { beginWave(); return true; }
    if (state.id === 'ditto') {
      const snap = data || snapshot(pl);
      state.model = { dex: pl.dex, shiny: !!pl.shiny, uid: pl.uid || 'solo', moves: [] };
      for (const m of (snap.moves || []).slice(0, 16)) {
        if (!G.Moves.BY_ID[m.id] || state.model.moves.some(o => o.id === m.id)) continue;
        state.model.moves.push({ id: m.id, lvl: G.U.clamp(m.lvl | 0, 1, 5), evolved: !!m.evolved });
      }
      if (!state.model.moves.length) state.model.moves.push({ id: G.startMoveOf(pl.dex), lvl: 1 });
    }
    state.phase = 'fight'; state.t = 0; G.Spawner.say('', 0);
    if (state.id === 'house') {
      state.house = { tx: 10000 + serial * 30, ty: 10000, r: 8, type: 'normal', clear: true };
      enterHouse(); sync(); beginWave();
    } else if (state.id === 'rocket') {
      for (let i = 0; i < 3; i++) spawn('generator', 81, state.x + [-85, 0, 85][i], state.y + [-25, 60, -25][i], 0.5, i);
      state.spawnT = 0; state.gasT = 2; state.blockT = 4; sync();
    } else if (state.id === 'stampede') { state.wave = -1; prepareWave(); }
    else {
      state.phase = 'transform';
      const e = spawn('ditto', state.model.dex, state.x, state.y, 3.5);
      e.invulnerable = true; e.dmg = 0; sync();
      G.Sprites.preload([state.model.dex], 8000, state.model.shiny);
      G.Audio.sfx('impostor');
    }
    requested = false; hold = 0;
    return true;
  }
  function baseStats(time, n = 1) {
    const tier = [...G.Enemies.TIERS].reverse().find(t => time >= t.from) || G.Enemies.TIERS[0];
    return { hp: tier.hp * (1 + time / 95) * (3.3 + Math.min(1.7, time / 210)) * (1 + (n - 1) * 0.3),
      dmg: Math.min(30, 8 + time / 120), spd: Math.min(100, 60 + time / 60), xp: Math.round(tier.xp * 5.6) };
  }
  function spawn(role, dex, x, y, hpK = 1, index = 0) {
    const b = baseStats(state.time, state.n);
    G.Sprites.preload([dex]);
    const e = new G.Enemy({ dex, hp: b.hp * hpK, spd: b.spd, dmg: role === 'generator' ? 0 : b.dmg,
      xp: role === 'generator' ? 0 : b.xp, behavior: 'chase' }, x, y, { hp: 1, spd: 1, dmg: 1 });
    e.eventId = state.seq; e.eventRole = role; e.eventIndex = index;
    if (role === 'generator') { e.types = []; e.r = 20; e.bodyH = 44; }
    if (role === 'ditto') configureDitto(e);
    const record = { id: e.id, role, index, dex, x, y, hp: e.hp, maxHp: e.maxHp };
    state.units.push(record); units.set(e.id, e); G.EnemyMgr.add(e);
    return e;
  }
  function configureDitto(e) {
    e.invulnerable = state.phase === 'transform';
    e.dmg = e.invulnerable ? 0 : baseStats(state.time).dmg * 0.5;
    const shiny = !!state.model.shiny;
    if (e.eventShiny !== shiny) {
      e.eventShiny = shiny; e.anim = new G.Sprites.Animator(e.dex, e.scale, shiny);
      G.Sprites.preload([e.dex], 8000, shiny);
    }
  }
  function bindUnits() {
    if (!state) return;
    for (const r of state.units) {
      const e = G.EnemyMgr.get(r.id);
      if (!e) continue;
      e.eventId = state.seq; e.eventRole = r.role; e.eventIndex = r.index;
      if (r.role === 'generator') { e.types = []; e.r = 20; e.bodyH = 44; }
      if (r.role === 'ditto') configureDitto(e);
      units.set(e.id, e);
    }
  }
  function despawn(role) {
    for (const [id, e] of units) {
      if (role && e.eventRole !== role) continue;
      if (G.Coop.isHost && G.EnemyMgr.get(id)) G.Coop.enemyGone(e, false);
      G.EnemyMgr.removeRemote(id, false); units.delete(id);
    }
    if (state) state.units = state.units.filter(r => role && r.role !== role);
    G.EnemyMgr.rebuildGrid();
  }
  function reward(coins, ticket = 0, items = null, heal = 0) {
    // Monedas/tickets forman parte del total compartido que replica coop.js.
    const pl = G.Game.player;
    G.Game.grantEventReward(coins, ticket);
    applyReward({ items, heal });
    if (G.Coop.isHost) G.Coop.broadcast(['challenge', 'reward', { items, heal }]);
    G.FX.dmgText(pl.x, pl.y - pl.bodyH - 10, '+' + coins, '#ffd23f', true);
    G.Audio.sfx('chest');
  }
  function applyReward(o) {
    const pl = G.Game.player;
    if (!pl) return;
    if (o.heal && !pl.dead) pl.heal(pl.maxHp * o.heal);
    if (o.items) G.Game.offerItem(o.items);
  }
  function enterHouse() {
    if (back) return;
    back = G.Game.everyone().map(p => ({ p, x: p.x, y: p.y }));
    if (authority()) G.EnemyMgr.stash(); else G.EnemyMgr.clearRemote();
    G.Projectiles.clear(); G.Combat.clearFields(); G.Hazards.clear();
    G.World.setArena(state.house);
    state.x = state.house.tx * G.World.TS + G.World.TS / 2;
    state.y = state.house.ty * G.World.TS + G.World.TS / 2;
    G.Game.everyone().forEach((p, i) => { p.x = state.x + (i - (state.n - 1) / 2) * 34; p.y = state.y + 100; });
    G.Camera.x = G.Game.player.x; G.Camera.y = G.Game.player.y;
  }
  function leaveHouse() {
    if (!back) return;
    if (authority()) G.Game.claimEventLoot(state.x, state.y, 300);
    G.World.setArena(null);
    G.Projectiles.clear(); G.Combat.clearFields(); G.Hazards.clear();
    for (const o of back) { o.p.x = o.x; o.p.y = o.y; o.p.invuln = Math.max(o.p.invuln, 1.5); }
    back = null;
    if (authority()) G.EnemyMgr.restore();
    G.Camera.x = G.Game.player.x; G.Camera.y = G.Game.player.y;
  }
  function beginWave() {
    state.stage++; state.phase = 'fight'; state.t = 0; hold = 0; requested = false;
    const n = Math.round([6, 8, 10][state.stage - 1] * (1 + (state.n - 1) * 0.25));
    const pool = G.Enemies.bagAt(state.time).filter(e => ['chase', 'tank', 'charger'].includes(e.behavior));
    for (let i = 0; i < n; i++) {
      const a = Math.PI + i * Math.PI / Math.max(1, n - 1);
      const def = pool.length ? G.U.pick(pool) : { dex: 19 };
      spawn('house', def.dex, state.x + Math.cos(a) * 175, state.y + Math.sin(a) * 150 - 10, 0.65);
    }
    sync();
  }
  function prepareWave() {
    state.wave++; state.waveT = 0;
    const p = G.Game.everyone().filter(p => !p.dead && Math.abs(p.x - state.x) < 200).sort((a, b) => a.spd - b.spd)[0];
    const candidates = [-72, 0, 72].filter(y => !p || Math.abs(p.y - state.y - y) < Math.max(60, p.spd * 1.6));
    state.safeY = G.U.pick(candidates.length ? candidates : [0]);
    state.direction = state.wave % 2 ? -1 : 1;
    sync();
  }
  function stampedeTick(dt) {
    if (state.phase === 'alpha') {
      if (!authority()) return;
      const e = units.get(state.alpha);
      if (e && e.dead) { reward(250, 0, 'herdtrail'); finish(); }
      else if (state.t >= 8) finish();
      return;
    }
    state.waveT += dt;
    const t = state.waveT;
    if (t >= 2 && t <= 3.4) {
      const x = state.x + state.direction * (-180 + (t - 2) / 1.4 * 360);
      const pl = G.Game.player;
      const hit = p => Math.abs(p.x - x) < 45 && [-72, 0, 72].some(y => y !== state.safeY && Math.abs(p.y - state.y - y) < 30 + p.r);
      if (waveHit !== state.wave && !pl.dead && hit(pl)) { waveHit = state.wave; pl.hurt(pl.maxHp * 0.08); }
      if (authority()) for (const e of G.EnemyMgr.all()) {
        if (!e.dead && !e.boss && !e.eventId && e.stampedeWave !== state.seq + ':' + state.wave && hit(e)) {
          e.stampedeWave = state.seq + ':' + state.wave; e.hurt(e.maxHp * 0.7, '#e6bd8c');
        }
      }
    }
    if (authority() && t >= 5) {
      if (state.wave < 2) prepareWave();
      else { state.phase = 'alpha'; state.t = 0; state.alpha = spawn('alpha', 128, state.x, state.y, 0.65).id; sync(); }
    }
  }
  function rocketTick(dt) {
    if (!authority()) return;
    for (const r of state.units.filter(r => r.role === 'generator')) {
      const e = units.get(r.id);
      if (e && e.dead && !r.paid) { r.paid = true; reward(150); sync(); }
    }
    const live = i => state.units.some(r => r.role === 'generator' && r.index === i && !r.paid);
    effects = effects.filter(f => f.kind === 'gas' ? live(0) : live(1));
    if (![0, 1, 2].some(live)) {
      const a = G.Items.roll(); reward(0, 1, [a, G.Items.roll(a)]); finish(); return;
    }
    state.spawnT -= dt; state.gasT -= dt; state.blockT -= dt;
    if (live(2) && state.spawnT <= 0 && [...units.values()].filter(e => e.eventRole === 'guard' && !e.dead).length < 5 + state.n) {
      state.spawnT = 4;
      const a = Math.random() * Math.PI * 2;
      spawn('guard', Math.random() < 0.5 ? 109 : 23, state.x + Math.cos(a) * 120, state.y + Math.sin(a) * 95, 0.45);
    }
    if (live(0) && state.gasT <= 0) {
      state.gasT = 5;
      const p = G.U.pick(G.Game.everyone().filter(p => !p.dead));
      if (p && distance(p, state) < 260) addEffect({ kind: 'gas', x: p.x, y: p.y, r: 42, warn: 1.5, life: 4, t: 0 });
    }
    if (live(1) && state.blockT <= 0) {
      state.blockT = 6;
      addEffect({ kind: 'block', x: state.x + (Math.random() < 0.5 ? -45 : 45), y: state.y, r: 27, warn: 1.5, life: 4, t: 0 });
    }
    if (state.t >= 60 || G.Game.everyone().every(p => p.dead || distance(p, state) > 420)) finish();
  }
  function addEffect(o) { effects.push(o); if (G.Coop.isHost) G.Coop.broadcast(['challenge', 'effect', o]); }
  function effectsTick(dt) {
    const p = G.Game.player;
    for (const f of effects) {
      f.t += dt;
      if (f.t < f.warn || p.dead || distance(p, f) > f.r + p.r) continue;
      if (f.kind === 'gas') { f.hitT = (f.hitT || 0) - dt; if (f.hitT <= 0) { f.hitT = 1; p.hurt(p.maxHp * 0.035, 'poison'); } }
      else { const [dx, dy] = G.U.norm(p.x - f.x || 1, p.y - f.y); p.x = f.x + dx * (f.r + p.r); p.y = f.y + dy * (f.r + p.r); G.World.collide(p); }
    }
    effects = effects.filter(f => f.t < f.warn + f.life);
  }
  function actorFor(e) {
    if (!actor) {
      actor = new G.Player(G.DEX_BY[state.model.dex], {}, state.model.shiny); actor.hostile = true;
      actor.moves = state.model.moves.map(o => { const m = G.Moves.instance(o.id, o.lvl); if (o.evolved) G.Moves.evolve(m); return m; });
      actor.slots = actor.moves.map(m => [m]);
    }
    actor.x = e.x; actor.y = e.y; actor.dead = e.dead;
    return actor;
  }
  function castImpostor(o) {
    if (!state || state.id !== 'ditto') return;
    const e = units.get(o.enemy);
    if (!e || e.dead) return;
    const p = actorFor(e), m = { ...actor.moves[o.index], corrupt: true };
    p.x = o.x; p.y = o.y; p.aim = o.aim; p.target = G.Game.player; p.aimed = true; p.aimAt = { x: o.tx, y: o.ty };
    if (m.kind === 'chain' && G.U.dist(o.tx, o.ty, p.target.x, p.target.y) > 55) p.target = null;
    p.baseAtk = Math.min(25, 9 + state.time / 150) / Math.max(1, m.dmg || 1);
    G.Projectiles.clearOrbs(p);
    G.Combat.replay(p, m);
    if (authority() && m.kind === 'dash') { e.x = p.x; e.y = p.y; }
    warning = null; G.Audio.sfx('shot', { kind: m.kind, type: m.type });
  }
  function dittoTick(dt) {
    const e = [...units.values()].find(e => e.eventRole === 'ditto');
    if (!e) return;
    if (actor) { actor.x = e.x; actor.y = e.y; }
    if (!authority()) return;
    if (state.phase === 'transform') {
      if (state.t < 3) return;
      state.phase = 'fight'; state.t = 0; state.castT = 0.7; state.moveIndex = 0; e.invulnerable = false;
      e.dmg = baseStats(state.time).dmg * 0.5;
      G.FX.ring(e.x, e.y, 5, 100, '#dc8cff', 0.6, 4); sync();
    }
    if (e.dead) { reward(400, 0, 'dittoecho'); finish(); return; }
    if (state.t >= 45 || G.Game.everyone().every(p => p.dead || distance(p, e) > 800)) { finish(); return; }
    state.castT -= dt;
    if (warning) {
      warning.t -= dt;
      if (warning.t <= 0) { const o = { ...warning }; castImpostor(o); if (G.Coop.isHost) G.Coop.broadcast(['challenge', 'cast', o]); state.castT = 1.7; }
    } else if (state.castT <= 0) {
      const p = G.EnemyMgr.nearestPlayer(G.Game.everyone(), e.x, e.y);
      if (!p) return;
      const a = actorFor(e), index = state.moveIndex++ % a.moves.length;
      warning = { enemy: e.id, index, x: e.x, y: e.y, tx: p.x, ty: p.y, aim: Math.atan2(p.y - e.y, p.x - e.x), t: 1, move: a.moves[index] };
      if (G.Coop.isHost) G.Coop.broadcast(['challenge', 'warning', copy(warning)]);
      e.anim.play('Charge');
    }
  }
  function updateEnemy(e, dt, pl) {
    if (e.eventRole === 'generator' || e.invulnerable || (e.eventRole === 'ditto' && warning)) return;
    const d = distance(e, pl);
    const keep = e.eventRole === 'ditto' ? 80 : 0;
    if (d > keep) {
      const [dx, dy] = G.U.norm(pl.x - e.x, pl.y - e.y);
      const spd = Math.min(e.spd, e.eventRole === 'alpha' ? 55 : 95) * (1 - e.slow);
      e.x += dx * spd * dt; e.y += dy * spd * dt;
      G.World.collide(e); e.anim.dir = G.Sprites.dirFromAngle(Math.atan2(dy, dx)); e.anim.loop('Walk');
    } else e.anim.loop('Idle');
  }
  function finish() {
    if (!state) return;
    if (actor) { actor.dead = true; G.Combat.clearFields(actor); G.Projectiles.clearOrbs(actor); }
    despawn();
    if (G.Coop.isHost) G.Coop.broadcast(['challenge', 'finish', state.seq]);
    leaveHouse(); state = null; actor = null; warning = null; effects = []; hold = 0; requested = false; recovery = 15;
  }
  function update(dt, players, time) {
    recovery = Math.max(0, recovery - dt);
    if (!state) return;
    if (G.Rift.inArena || G.Judgment.active) { if (authority()) finish(); return; }
    state.t += dt; bindUnits(); effectsTick(dt);
    const pl = G.Game.player;
    if (state.phase === 'offer' || state.phase === 'between') {
      const near = !pl.dead && !pl.frozen && distance(pl, state) < 40;
      hold = near ? hold + dt : 0;
      if (!near) requested = false;
      if (hold >= 1.2 && !requested) {
        requested = true;
        if (authority()) request(pl, state.seq, snapshot(pl));
        else G.Coop.toHost(['challenge', state.seq, snapshot(pl)]);
      }
      if (authority() && state && ((state.phase === 'offer' && state.t >= 20) || (state.phase === 'between' && state.t >= 6))) finish();
    }
    if (!state || state.phase === 'offer') return;
    if (state.id === 'house') {
      // Salida al sur disponible incluso durante una oleada.
      if (authority() && players.some(p => !p.dead && G.U.dist(p.x, p.y, state.x, state.y + 195) < 35)) { finish(); return; }
      if (authority() && state.phase === 'fight' && (state.t >= 20 || [...units.values()].every(e => e.dead))) {
        despawn('house'); const stage = state.stage;
        reward([150, 200, 250][stage - 1], stage === 3 ? 1 : 0, stage === 3 ? G.Items.roll() : null, stage < 3 ? 0.1 : 0);
        if (stage === 3) { finish(); return; }
        state.phase = 'between'; state.t = 0; hold = 0; requested = false; sync();
      }
    } else if (state.id === 'rocket') rocketTick(dt);
    else if (state.id === 'stampede') stampedeTick(dt);
    else dittoTick(dt);
    if (state && authority() && (netT -= dt) <= 0) { netT = 0.2; sync(); }
  }
  function onNet(kind, payload) {
    if (kind === 'state') {
      const fresh = !state || state.seq !== payload.seq;
      state = copy(payload);
      if (fresh) { hold = 0; requested = false; waveHit = -1; units.clear(); actor = null; warning = null; }
      if (state.house && !back) enterHouse();
      if (state.id === 'rocket') effects = effects.filter(f => state.units.some(r => r.role === 'generator' && !r.paid && r.index === (f.kind === 'gas' ? 0 : 1)));
      bindUnits();
    } else if (kind === 'finish') {
      if (state && state.seq === payload) { if (actor) actor.dead = true; leaveHouse(); state = null; actor = null; warning = null; effects = []; units.clear(); recovery = 15; }
    } else if (kind === 'reward') applyReward(payload);
    else if (kind === 'effect') effects.push({ ...payload });
    else if (kind === 'warning') warning = copy(payload);
    else if (kind === 'cast') castImpostor(payload);
  }
  function drawables() {
    return [{ y: -Infinity, draw(ctx) { G.ChallengeArt.ground(ctx, state, effects, warning); } },
      ...(state ? [{ y: state.y, draw(ctx) { G.ChallengeArt.event(ctx, state, hold); } }] : [])];
  }
  return { ids: IDS, names: NAMES, available, offer, request, snapshot, reset, update, onNet, updateEnemy, drawables,
    markers() { return state ? [{ x: state.x, y: state.y }] : []; },
    get state() { return state; }, get warning() { return warning; },
    get inHouse() { return !!back; }, get blocksEncounters() { return !!state || recovery > 0; },
    get spawnFactor() { return back ? 0 : state && state.phase !== 'offer' ? 0.5 : 1; }
  };
})();
