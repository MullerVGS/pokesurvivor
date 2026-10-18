/* Jefes del mapa: aparición, paseo y tiempo continuo lejos de los jugadores. */
G.RoamingBosses = (() => {
  const SPAWN_DISTANCE = 100 * 32, DESPAWN_DISTANCE = 250 * 32, DESPAWN_TIME = 120;

  function site(pl, players, radius = 54) {
    const start = Math.random() * Math.PI * 2;
    const alive = players.filter(p => !p.dead);
    for (let i = 0; i < 100; i++) {
      const a = start + i * 2.399963229728653;
      const x = pl.x + Math.cos(a) * SPAWN_DISTANCE, y = pl.y + Math.sin(a) * SPAWN_DISTANCE;
      if (G.View.seen(alive, x, y, radius) || !G.World.isFree(x, y, radius)) continue;
      return { x, y };
    }
    return null;
  }

  function attach(e) {
    if (e.roam) return;
    e.roam = { engaged: false, damage: e.dmg, away: 0, walkT: 0, angle: 0 };
    e.dmg = 0;
  }
  const roaming = e => !!e.roam && !e.roam.engaged;

  function engage(e, attacker) {
    if (!roaming(e) || !attacker || attacker.dead || attacker.hostile) return;
    e.roam.engaged = true;
    e.dmg = e.roam.damage;
  }

  // El anfitrión mide la distancia a CUALQUIER jugador vivo; acercarse reinicia
  // los dos minutos completos, incluso si el jefe ya está luchando.
  function expired(e, dt, players) {
    if (!e.roam || e.remote || e.dead) return false;
    // La red redondea las coordenadas a unidades enteras (1/32 de metro).
    const near = players.some(p => !p.dead && G.U.dist2(p.x, p.y, e.x, e.y) <= (DESPAWN_DISTANCE + 1) ** 2);
    e.roam.away = near ? 0 : e.roam.away + dt;
    return e.roam.away >= DESPAWN_TIME;
  }

  function wander(e, dt) {
    const r = e.roam;
    e.kx = e.ky = 0;
    r.walkT -= dt;
    if (r.walkT <= 0) { r.walkT = G.U.rand(1.4, 3.2); r.angle = Math.random() * Math.PI * 2; }
    const step = 32 * (1 - e.slow) * dt, x = e.x, y = e.y;
    e.x += Math.cos(r.angle) * step; e.y += Math.sin(r.angle) * step;
    G.World.collide(e);
    if (G.U.dist2(x, y, e.x, e.y) < (step * 0.25) ** 2) r.walkT = 0;
    e.anim.dir = G.Sprites.dirFromAngle(r.angle); e.anim.loop('Walk');
  }

  return { SPAWN_DISTANCE, DESPAWN_DISTANCE, DESPAWN_TIME, site, attach, roaming, engage, expired, wander };
})();
