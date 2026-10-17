/* ============ aim.js — apuntar con el ratón ============
 * La mira es automática (player.js: lo que te toca, el jefe, el más cercano...).
 * Con el ratón se puede llevar a mano, según Ajustes > Controles (aimMode):
 *
 *   auto     como siempre; el clic no hace nada
 *   click    automática, pero mientras mantienes el botón izquierdo sobre el
 *            mapa los ataques van hacia el cursor. Al soltar sigue ahí HOLD s
 *            más, para que la mira no salte en mitad de una ráfaga.
 *   manual   siempre hacia el cursor
 *
 * Los ataques siguen saliendo solos con su recarga: el ratón decide hacia
 * dónde, no si se ataca. Con la mira en el cursor, el jugador lleva
 * `aimed = true` y combat.js lo tiene en cuenta:
 *   - los que esperan blanco salen igual hacia allí (para romper rocas y
 *     abrirte paso), menos la cadena, que sólo salta entre enemigos
 *   - el blanco (`target`) es el enemigo más cercano a la línea del cursor,
 *     dentro del alcance del ataque activo
 *   - los meteoros caen alrededor del cursor (`aimAt`)
 * Los vínculos usan la misma mira.
 *
 * Sólo cuenta el ratón sobre el canvas en la partida: los iconos de ataque del
 * HUD, los botones del DOM, los menús y los popups fijados no la mueven.
 * Táctil: nada cambia, sigue automática (un toque olvida el cursor).
 * Cooperativo: cada uno apunta su Pokémon. Su `aim` ya viaja en el estado y en
 * cada ataque (coop.js) y el anfitrión no lo recalcula: los demás lo ven ir
 * hacia tu cursor.
 */
G.Aim = (() => {
  const HOLD = 0.6;               // s que sigue en el cursor tras soltar (modo click)
  const NEAR = 6;                 // cursor encima del Pokémon: la mira se queda como estaba
  const LANE = 46;                // a cada lado de la línea, para elegir el blanco
  const METEOR = 340;             // como mucho tan lejos caen los meteoros (reach de combat.js)
  let ptr = null;                 // último punto del ratón sobre el canvas, px CSS
  let held = false, grace = 0, aim = 0, on = false;

  const mode = () => G.Settings.get('aimMode') || 'click';
  const playing = () => G.Game.state === 'playing' && !G.Judgment.cinematic;
  const onCanvas = e => e.target && e.target.id === 'game';
  function letGo() { if (held) { held = false; grace = HOLD; } }

  addEventListener('pointermove', e => {
    if (e.pointerType !== 'mouse') return;
    // Arrastrando, aunque pase por encima de algo del HUD, sigue al ratón.
    if (held || onCanvas(e)) ptr = [e.clientX, e.clientY];
  }, { passive: true });
  addEventListener('pointerdown', e => {
    if (e.pointerType !== 'mouse') { ptr = null; held = false; grace = 0; return; }
    if (e.button !== 0 || mode() === 'auto' || !onCanvas(e) || !playing() || G.Touch.hit(e.clientX, e.clientY)) return;
    ptr = [e.clientX, e.clientY];
    held = true;
  }, { passive: true });
  addEventListener('pointerup', e => { if (e.pointerType === 'mouse' && e.button === 0) letGo(); }, { passive: true });
  addEventListener('blur', letGo);
  // El ratón sale de la ventana: en manual, vuelve a la automática.
  document.addEventListener('pointerout', e => { if (e.pointerType === 'mouse' && !e.relatedTarget && !held) ptr = null; });

  /** El enemigo más cercano a la línea que sale de `pl` con ángulo `a`, hasta `len`. */
  function alongLine(pl, a, len) {
    const ca = Math.cos(a), sa = Math.sin(a);
    let best = null, bd = Infinity;
    for (const e of G.EnemyMgr.queryCircle(pl.x, pl.y, len)) {
      if (e.dead) continue;
      const px = e.x - pl.x, py = e.y - pl.y;
      const along = px * ca + py * sa;
      if (along <= 0) continue;
      const off = Math.abs(-px * sa + py * ca) - e.r;
      if (off <= LANE && off < bd) { bd = off; best = e; }
    }
    return best;
  }

  /**
   * Lo llama player.js después de la mira automática: si toca, la cambia por
   * la del cursor (y el blanco por el de esa línea).
   */
  function steer(pl, dt) {
    if (grace > 0) grace -= dt;
    const md = mode();
    const was = on;
    on = !!ptr && !pl.dead && (md === 'manual' || (md === 'click' && (held || grace > 0)));
    pl.aimed = on;
    if (!on) { pl.aimAt = null; return; }
    // El cursor señala algo a la altura de los disparos (G.LIFT por encima del suelo).
    const cam = G.Camera;
    const wx = cam.left() + ptr[0] / cam.scale, wy = cam.top() + ptr[1] / cam.scale + G.LIFT;
    const d = G.U.dist(pl.x, pl.y, wx, wy);
    if (d > NEAR) aim = Math.atan2(wy - pl.y, wx - pl.x);
    else if (!was) aim = pl.aim;
    pl.aim = aim;
    const k = Math.min(d, METEOR) / (d || 1);
    pl.aimAt = { x: pl.x + (wx - pl.x) * k, y: pl.y + (wy - pl.y) * k };
    const m = pl.activeMove();
    pl.target = alongLine(pl, aim, m ? G.Combat.reach(m) : 520);
  }

  /** Indicador discreto: una raya corta delante del Pokémon y un aro en el cursor (mundo). */
  // ---------------- indicador ----------------
  // Sólo una Poké Ball pequeña donde apuntas (se va apagando al soltar).
  function draw(ctx, pl) {
    if (!pl || !pl.aimed || pl.dead || !ptr) return;
    const cam = G.Camera;
    const cx = cam.left() + ptr[0] / cam.scale, cy = cam.top() + ptr[1] / cam.scale;
    ctx.save();
    ctx.globalAlpha = held || mode() === 'manual' ? 0.9 : 0.9 * G.U.clamp(grace / HOLD, 0, 1);
    G.Icons.draw(ctx, 'ball', Math.round(cx - 6), Math.round(cy - 6), 12);
    ctx.restore();
  }

  return { steer, draw, get held() { return held; }, get mode() { return mode(); } };
})();
