/* Recompensas de eventos. Cada cliente simula el daño de sus propios objetos. */
G.EventItems = (() => {
  let owner = null, casts = 0, echoes = [], trails = [], trailAt = null, tickT = 0;
  function reset() { owner = null; casts = 0; echoes = []; trails = []; trailAt = null; tickT = 0; }
  function send(payload) {
    if (!G.Coop.active) return;
    if (G.Coop.isHost) G.Coop.broadcast(['event-item', G.Coop.local.uid, payload]);
    else G.Coop.toHost(['event-item', payload]);
  }
  function onCast(pl, m) {
    if (m.echo || !pl.hasItem('dittoecho') || pl.hostile || pl.remote) return;
    if (++casts % 3) return;
    const copy = { ...m, dmg: (m.dmg || 0) * 0.6, echo: true };
    if (copy.kind === 'orbit') copy.id += ':echo';
    echoes.push({ t: 0.25, pl, move: copy });
  }
  function tick(dt, pl) {
    if (owner !== pl) { reset(); owner = pl; }
    if (!pl.hasItem('dittoecho')) { casts = 0; echoes = []; }
    for (const e of echoes) {
      e.t -= dt;
      if (e.t > 0 || e.done || pl.dead) continue;
      e.done = true;
      G.Combat.replay(pl, e.move);
      G.FX.ring(pl.x, pl.y, 8, 32, '#dc8cff', 0.25, 2);
      send({ kind: 'echo', move: e.move, aim: pl.aim });
    }
    echoes = echoes.filter(e => !e.done);
    for (const t of trails) t.life -= dt;
    trails = trails.filter(t => t.life > 0);
    if (pl.hasItem('herdtrail') && pl.walking && !pl.dead &&
        (!trailAt || G.U.dist2(pl.x, pl.y, trailAt.x, trailAt.y) >= 18 * 18)) {
      const damage = Math.max(1, ...pl.activeGroup().map(m => m.dmg || 0)) * pl.atk * 0.2;
      const t = { x: pl.x, y: pl.y, life: 2, damage, owner: pl };
      trails.push(t); trailAt = t;
      send({ kind: 'trail', x: t.x, y: t.y });
    }
    if (!pl.hasItem('herdtrail')) trailAt = null;
    tickT -= dt;
    if (tickT <= 0) {
      tickT = 0.25;
      const hits = new Set();
      for (const t of trails) {
        if (t.owner !== pl) continue;
        for (const e of G.EnemyMgr.queryCircle(t.x, t.y, 24)) {
          if (hits.has(e.id)) continue;
          hits.add(e.id); e.hurt(t.damage * 0.25, '#e6bd8c', 0, 0, 0, null, pl);
        }
      }
    }
  }
  function onNet(ev, pl) {
    const o = ev[1];
    if (!o || !pl) return;
    if (o.kind === 'trail' && Number.isFinite(o.x) && Number.isFinite(o.y)) {
      trails.push({ x: o.x, y: o.y, life: 2, owner: pl });
      if (trails.length > 160) trails.shift();
    } else if (o.kind === 'echo' && o.move && G.Moves.BY_ID[o.move.id.replace(':echo', '')]) {
      pl.aim = o.aim; G.Combat.replay(pl, o.move, true);
    }
  }
  function draw(ctx) {
    ctx.save();
    for (const t of trails) {
      if (!G.Camera.sees(t.x, t.y, 40)) continue;
      ctx.globalAlpha = Math.min(0.42, t.life * 0.5);
      ctx.fillStyle = '#b28c66';
      ctx.beginPath(); ctx.ellipse(t.x, t.y, 24, 16, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#ffe1ae';
      ctx.fillRect(Math.round(t.x - 8), Math.round(t.y - 3), 4, 6);
      ctx.fillRect(Math.round(t.x + 5), Math.round(t.y + 2), 4, 6);
    }
    ctx.restore();
  }
  return { reset, tick, onCast, onNet, draw };
})();
