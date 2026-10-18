/* Jefes errantes: el anfitrión decide el encuentro; cada cliente recibe su propio daño. */
G.Challenges = (() => {
  const IDS = ['stampede', 'ditto'];
  const NAMES = { stampede: 'Tauros alfa', ditto: 'Ditto impostor' };
  const authority = () => !G.Coop.active || G.Coop.isHost;
  const copy = o => JSON.parse(JSON.stringify(o));
  const distance = (a, b) => G.U.dist(a.x, a.y, b.x, b.y);
  let state = null, serial = 0, recovery = 0, netT = 0, actor = null, warning = null, localHit = -1;
  const units = new Map(), used = new Set();
  function reset() {
    state = null; recovery = 0; netT = 0; actor = null; warning = null; localHit = -1;
    units.clear(); used.clear(); G.EventItems.reset();
  }
  function available(time) {
    if (state || recovery > 0 || G.Rift.rift || G.Rift.inArena || G.Judgment.active || G.EnemyMgr.bossAlive()) return [];
    const next = G.Enemies.BOSSES.find(b => b.at > time);
    if (Math.min(next ? next.at : Infinity, G.Judgment.AT) - time < 45) return [];
    if (IDS.every(id => used.has(id))) used.clear();
    return IDS.filter(id => !used.has(id));
  }
  function site(pl) {
    for (let i = 0; i < 100; i++) {
      const a = i * 2.4, d = 240 + (i % 8) * 45;
      const x = pl.x + Math.cos(a) * d, y = pl.y + Math.sin(a) * d;
      if (!G.World.isFree(x, y, 48)) continue;
      let reachable = true;
      for (let q = 0; q <= 1; q += 0.05) if (!G.World.isFree(pl.x + (x - pl.x) * q, pl.y + (y - pl.y) * q, 15)) { reachable = false; break; }
      if (reachable) return { x, y };
    }
    return null;
  }
  function stats(time, n) {
    const tier = [...G.Enemies.TIERS].reverse().find(t => time >= t.from) || G.Enemies.TIERS[0];
    return { hp: Math.round(tier.hp * (1 + time / 95) * 9 * (1 + (n - 1) * 0.3)),
      dmg: Math.min(30, 8 + time / 120), spd: 90, xp: Math.round(tier.xp * 7) };
  }
  function offer(id, time, players, at) {
    if (!authority() || !IDS.includes(id) || state) return false;
    const pl = players.find(p => !p.dead), p = pl && (at || site(pl));
    if (!p) return false;
    state = { id, seq: ++serial, phase: 'roam', t: 0, x: p.x, y: p.y, homeX: p.x, homeY: p.y,
      time, n: players.length, units: [], castT: 0.6, moveIndex: 0, attackSeq: 0, walkT: 0, walkAngle: 0 };
    used.add(id); localHit = -1;
    const dex = id === 'stampede' ? 128 : 132, b = stats(time, players.length);
    const e = new G.Enemy({ dex, ...b, dmg: 0, behavior: 'chase' }, p.x, p.y, { hp: 1, spd: 1, dmg: 1 });
    state.units.push({ id: e.id, role: id === 'stampede' ? 'alpha' : 'ditto', dex });
    G.EnemyMgr.add(e); bindUnits();
    G.Sprites.preload([128, 132, pl.dex]);
    sync(); G.Spawner.say(NAMES[id] + ' ronda la zona. Búscalo en el minimapa y atácalo para luchar.', 4);
    return true;
  }
  function sync() {
    const e = boss();
    if (e) { state.x = e.x; state.y = e.y; }
    if (G.Coop.isHost && state) G.Coop.broadcast(['challenge', 'state', copy(state)]);
  }
  function boss() { return state && units.get(state.units[0].id); }
  function snapshot(pl) { return { dex: pl.dex, shiny: !!pl.shiny, moves: pl.moves.map(m => ({ id: m.id, lvl: m.lvl, evolved: !!m.evolved })) }; }
  function roaming(e) { return !!state && state.phase === 'roam' && e.eventId === state.seq; }
  /** Se llama sólo desde el daño de un jugador, nunca por proximidad ni por un temporizador. */
  function onHit(e, pl, data) {
    if (!authority() || !roaming(e) || !pl || pl.dead || pl.hostile) return false;
    if (G.EnemyMgr.bossAlive() || G.Rift.inArena || G.Judgment.active) return true;
    state.phase = 'fight'; state.t = 0; state.castT = 0.6; G.Spawner.say('', 0);
    if (state.id === 'ditto') {
      const snap = data || snapshot(pl);
      state.model = { dex: pl.dex, shiny: !!pl.shiny, uid: pl.uid || 'solo', moves: [] };
      for (const m of (snap.moves || []).slice(0, 16)) {
        if (!G.Moves.BY_ID[m.id] || state.model.moves.some(o => o.id === m.id)) continue;
        state.model.moves.push({ id: m.id, lvl: G.U.clamp(m.lvl | 0, 1, 5), evolved: !!m.evolved });
      }
      if (!state.model.moves.length) state.model.moves.push({ id: G.startMoveOf(pl.dex), lvl: 1 });
      state.phase = 'transform'; state.units[0].dex = state.model.dex;
      G.Sprites.preload([state.model.dex], 8000, state.model.shiny); G.Audio.sfx('impostor');
    } else G.Audio.sfx('boss');
    bindUnits(); sync();
    return state.id === 'ditto'; // El primer golpe dispara la transformación invulnerable.
  }
  function bindUnits() {
    if (!state) return;
    for (const r of state.units) {
      const e = G.EnemyMgr.get(r.id) || units.get(r.id);
      if (!e) continue;
      e.eventId = state.seq; e.eventRole = r.role;
      const scale = r.role === 'alpha' ? 2.5 : state.model ? 2 : 1.5;
      const shiny = !!(state.model && state.model.shiny);
      const look = r.dex + ':' + scale + ':' + shiny;
      if (e.eventLook !== look) {
        e.eventLook = look; e.dex = r.dex; e.scale = scale;
        e.anim = new G.Sprites.Animator(e.dex, scale, shiny);
        e.r = Math.min(54, G.Sprites.bodyRadius(e.dex, scale)); e.bodyH = G.Sprites.bodyHeight(e.dex, scale);
        e.types = (G.DEX_BY[e.dex] || {}).types || ['normal'];
      }
      e.invulnerable = state.phase === 'transform';
      e.dmg = state.phase === 'fight' ? stats(state.time, state.n).dmg * 0.5 : 0;
      units.set(e.id, e);
    }
  }
  function move(e, x, y, speed, dt, collide = true) {
    const d = Math.hypot(x - e.x, y - e.y);
    if (d < 2) { e.anim.loop('Idle'); return; }
    const a = Math.atan2(y - e.y, x - e.x), step = Math.min(d, speed * dt);
    e.x += Math.cos(a) * step; e.y += Math.sin(a) * step;
    if (collide) G.World.collide(e);
    e.anim.dir = G.Sprites.dirFromAngle(a); e.anim.loop('Walk');
  }
  function updateEnemy(e, dt, pl) {
    if (!state || e.eventId !== state.seq || e.invulnerable) return;
    e.kx = e.ky = 0;
    if (state.phase === 'roam') {
      state.walkT -= dt;
      if (state.walkT <= 0) {
        state.walkT = G.U.rand(1.4, 3.2);
        state.walkAngle = distance(e, { x: state.homeX, y: state.homeY }) > 130
          ? Math.atan2(state.homeY - e.y, state.homeX - e.x) : Math.random() * Math.PI * 2;
      }
      move(e, e.x + Math.cos(state.walkAngle) * 80, e.y + Math.sin(state.walkAngle) * 80, 32, dt);
      return;
    }
    const a = state.attack;
    if (a && a.id !== 'stampede') { if (a.t < a.wind) e.anim.loop('Charge'); return; }
    const keep = state.id === 'ditto' ? 110 : e.r + pl.r + 10;
    if (distance(e, pl) > keep) move(e, pl.x, pl.y, (state.id === 'ditto' ? 105 : 78) * (warning ? 0.55 : 1) * (1 - e.slow), dt);
    else e.anim.loop(warning ? 'Charge' : 'Idle');
  }
  function startTauros(e, pl) {
    const id = ['charge', 'stomp', 'stampede'][state.moveIndex++ % 3];
    const angle = id === 'stampede' ? (state.moveIndex % 2 ? Math.PI / 4 : -Math.PI / 4) : Math.atan2(pl.y - e.y, pl.x - e.x);
    const a = state.attack = { id, seq: ++state.attackSeq, t: 0, angle, x: e.x, y: e.y,
      wind: id === 'stampede' ? 2 : id === 'charge' ? 0.9 : 0.8, duration: id === 'stampede' ? 1.8 : 0.45 };
    if (id === 'stomp') a.zones = [{ kind: 'zone', x: e.x, y: e.y, r: 145, color: '#e6bd8c' }];
    else if (id === 'charge') {
      a.len = Math.min(480, Math.max(200, distance(e, pl) + 100));
      a.zones = [{ kind: 'beam', x: e.x, y: e.y, angle, len: a.len, w: e.r * 2, color: '#eead63' }];
    } else {
      const reach = Math.max(600, ...G.Game.everyone().map(p => G.View.reach(p)));
      a.x = pl.x; a.y = pl.y; a.len = (reach + 200) * 2; a.gap = 110; a.width = reach * 0.75;
      const ca = Math.cos(angle), sa = Math.sin(angle);
      a.zones = [-1, 1].map(side => {
        const offset = side * (a.gap + a.width) / 2;
        return { kind: 'beam', x: a.x - ca * a.len / 2 - sa * offset, y: a.y - sa * a.len / 2 + ca * offset,
          angle, len: a.len, w: a.width, color: '#eead63' };
      });
    }
    e.anim.dir = G.Sprites.dirFromAngle(angle); e.anim.play('Charge'); sync();
  }
  function taurosTick(dt, e) {
    if (authority() && !state.attack) {
      state.castT -= dt;
      const target = G.EnemyMgr.nearestPlayer(G.Game.everyone(), e.x, e.y);
      if (target && state.castT <= 0) startTauros(e, target);
    }
    const a = state.attack;
    if (!a) return;
    const before = a.t; a.t += dt;
    if (a.t >= a.wind) {
      const progress = G.U.clamp((a.t - a.wind) / a.duration, 0, 1);
      if (authority() && a.id === 'charge') {
        e.x = a.x + Math.cos(a.angle) * a.len * progress; e.y = a.y + Math.sin(a.angle) * a.len * progress;
        e.anim.loop('Attack');
      }
      const hit = p => a.zones.some(z => {
        if (!G.Hazards.inside(z, p.x, p.y, p.r)) return false;
        if (a.id === 'stomp') return true;
        const along = (p.x - z.x) * Math.cos(a.angle) + (p.y - z.y) * Math.sin(a.angle);
        const from = G.U.clamp((before - a.wind) / a.duration, 0, 1) * z.len;
        return along >= from - p.r - 35 && along <= progress * z.len + p.r + 35;
      });
      const pl = G.Game.player;
      if (localHit !== a.seq && !pl.dead && hit(pl)) { localHit = a.seq; pl.hurt(pl.maxHp * (a.id === 'stomp' ? 0.1 : 0.08), 'normal'); }
      if (authority() && a.id === 'stampede') for (const other of G.EnemyMgr.all()) {
        const key = state.seq + ':' + a.seq;
        if (!other.dead && !other.boss && !other.eventId && other.stampedeWave !== key && hit(other)) {
          other.stampedeWave = key; other.hurt(other.maxHp * 0.7, '#e6bd8c');
        }
      }
      if (before < a.wind) { G.Audio.sfx('break'); G.Camera.kick(a.id === 'stampede' ? 0.45 : 0.25); }
    }
    if (authority() && a.t >= a.wind + a.duration) { state.attack = null; state.castT = 0.7; sync(); }
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
    if (!state || state.id !== 'ditto' || !state.model) return;
    const e = boss();
    if (!e || e.dead) return;
    const p = actorFor(e), m = { ...actor.moves[o.index] };
    p.x = o.x; p.y = o.y; p.aim = o.aim; p.target = G.Game.player; p.aimed = true; p.aimAt = { x: o.tx, y: o.ty };
    if (m.kind === 'chain' && G.U.dist(o.tx, o.ty, p.target.x, p.target.y) > 55) p.target = null;
    p.baseAtk = Math.min(25, 9 + state.time / 150) / Math.max(1, m.dmg || 1);
    G.Projectiles.clearOrbs(p); G.Combat.replay(p, m);
    if (authority() && m.kind === 'dash') { e.x = p.x; e.y = p.y; }
    e.anim.play('Attack', { speed: 1.6 });
    warning = null; G.Audio.sfx('shot', { kind: m.kind, type: m.type });
  }
  function dittoTick(dt, e) {
    if (actor) { actor.x = e.x; actor.y = e.y; }
    if (warning) warning.t = Math.max(0, warning.t - dt);
    if (!authority()) return;
    state.castT -= dt;
    if (warning) {
      if (warning.t <= 0) {
        // El aviso se fija en el suelo; el golpe sale del mismo punto aunque Ditto siga moviéndose.
        const o = { ...warning }; castImpostor(o);
        if (G.Coop.isHost) G.Coop.broadcast(['challenge', 'cast', o]);
        state.castT = 0.32;
      }
    } else if (state.castT <= 0) {
      const p = G.EnemyMgr.nearestPlayer(G.Game.everyone(), e.x, e.y);
      if (!p) return;
      const a = actorFor(e), index = state.moveIndex++ % a.moves.length, m = a.moves[index];
      const duration = ['beam', 'dash', 'meteor', 'nova'].includes(m.kind) ? 0.85 : 0.55;
      warning = { enemy: e.id, index, x: e.x, y: e.y, tx: p.x, ty: p.y, aim: Math.atan2(p.y - e.y, p.x - e.x),
        t: duration, duration, move: m };
      if (G.Coop.isHost) G.Coop.broadcast(['challenge', 'warning', copy(warning)]);
      e.anim.play('Charge');
    }
  }
  function clearActor() {
    if (actor) { actor.dead = true; G.Combat.clearFields(actor); G.Projectiles.clearOrbs(actor); }
    actor = null; warning = null;
  }
  function finish() {
    if (!state) return;
    clearActor();
    for (const [id, e] of units) {
      if (G.Coop.isHost && G.EnemyMgr.get(id)) G.Coop.enemyGone(e, false);
      G.EnemyMgr.removeRemote(id, false);
    }
    if (G.Coop.isHost) G.Coop.broadcast(['challenge', 'finish', state.seq]);
    state = null; units.clear(); recovery = 15; G.EnemyMgr.rebuildGrid();
  }
  function win() {
    const coins = state.id === 'ditto' ? 400 : 250, item = state.id === 'ditto' ? 'dittoecho' : 'herdtrail';
    G.Game.grantEventReward(coins, 0); G.GroundItems.reward(item);
    G.Audio.sfx('chest'); finish();
  }
  function update(dt, players, time) {
    recovery = Math.max(0, recovery - dt);
    if (!state) return;
    bindUnits(); state.t += dt;
    const e = boss();
    if (!e) return;
    state.x = e.x; state.y = e.y;
    if (authority()) {
      if (e.dead) { if (state.phase === 'roam') finish(); else win(); return; }
      if (G.Rift.inArena || G.Judgment.active || players.every(p => p.dead)) { finish(); return; }
      // Un encuentro ignorado no bloquea la siguiente aparición de jefe ni las grietas.
      if (state.phase === 'roam' && (G.EnemyMgr.bossAlive() || state.t > 120)) { finish(); return; }
      if (state.phase === 'fight' && players.every(p => p.dead || distance(p, e) > 1200)) { finish(); return; }
    }
    if (state.phase === 'transform') {
      if (authority() && state.t >= 3) { state.phase = 'fight'; state.t = 0; state.castT = 0.5; bindUnits(); sync(); }
    } else if (state.phase === 'fight') {
      if (state.id === 'stampede') taurosTick(dt, e); else dittoTick(dt, e);
    }
    if (state && authority() && (netT -= dt) <= 0) { netT = 0.2; sync(); }
  }
  function onNet(kind, payload) {
    if (kind === 'state') {
      if (!IDS.includes(payload.id)) return;
      const fresh = !state || state.seq !== payload.seq;
      if (fresh) { clearActor(); units.clear(); localHit = -1; }
      state = copy(payload); bindUnits();
    } else if (kind === 'finish') {
      if (state && state.seq === payload) { clearActor(); state = null; units.clear(); recovery = 15; }
    } else if (kind === 'warning') warning = copy(payload);
    else if (kind === 'cast') castImpostor(payload);
  }
  function drawables() { return [{ y: -Infinity, draw(ctx) { G.ChallengeArt.ground(ctx, state, warning); } }]; }
  return { ids: IDS, names: NAMES, available, offer, onHit, roaming, snapshot, reset, update, onNet, updateEnemy, drawables,
    markers() { const e = boss(); return state ? [{ x: e ? e.x : state.x, y: e ? e.y : state.y, id: state.id }] : []; },
    get state() { return state; }, get warning() { return warning; },
    get fighting() { return !!state && state.phase !== 'roam'; },
    get blocksEncounters() { return !!state || recovery > 0; },
    get spawnFactor() { return state && state.phase !== 'roam' ? 0.35 : 1; }
  };
})();
