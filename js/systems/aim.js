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
  // Al estilo Pokémon: una Poké Ball de mira en el cursor con esquinas del color
  // del tipo del ataque activo, una estela de puntos que va hacia allí y, sobre
  // el blanco, esquinas de "fijado" como al ir a capturarlo.
  const K = '#1b1528';            // contorno (icons.js)

  /** Un cuadradito de lado n con contorno de 1, en el color c. */
  function px(ctx, x, y, n, c) {
    x = Math.round(x - n / 2); y = Math.round(y - n / 2);
    ctx.fillStyle = K; ctx.fillRect(x - 1, y - 1, n + 2, n + 2);
    ctx.fillStyle = c; ctx.fillRect(x, y, n, n);
  }

  /** Cuatro esquinas en L alrededor de (x, y) a distancia d. */
  function corners(ctx, x, y, d, c) {
    const L = 5, T = 2;
    for (const [sx, sy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      const ox = Math.round(x + sx * d), oy = Math.round(y + sy * d);
      for (const [col, pad] of [[K, 1], [c, 0]]) {
        ctx.fillStyle = col;
        ctx.fillRect(sx < 0 ? ox - pad : ox - L - pad, sy < 0 ? oy - pad : oy - T - pad, L + pad * 2, T + pad * 2);
        ctx.fillRect(sx < 0 ? ox - pad : ox - T - pad, sy < 0 ? oy - pad : oy - L - pad, T + pad * 2, L + pad * 2);
      }
    }
  }

  function draw(ctx, pl) {
    if (!pl || !pl.aimed || pl.dead || !ptr) return;
    const m = pl.activeMove && pl.activeMove();
    const col = (m && G.U.TYPE_COLOR[m.type]) || '#ffd23f';
    const ca = Math.cos(pl.aim), sa = Math.sin(pl.aim);
    const x = pl.x, y = pl.y - G.LIFT;
    const cam = G.Camera;
    const cx = cam.left() + ptr[0] / cam.scale, cy = cam.top() + ptr[1] / cam.scale;
    const t = performance.now() / 1000;
    ctx.save();
    ctx.imageSmoothingEnabled = false;
    // Al soltar (modo click) se va apagando mientras dura la espera.
    const fade = held || mode() === 'manual' ? 1 : G.U.clamp(grace / HOLD, 0, 1);

    // Estela: puntos que avanzan del Pokémon hacia el cursor.
    const from = pl.vr + 8, to = Math.min(Math.hypot(cx - x, cy - y) - 12, from + 150), STEP = 14;
    for (let d = from + ((t * 40) % STEP); d < to; d += STEP) {
      ctx.globalAlpha = fade * (1 - (d - from) / (to - from + 1) * 0.45);
      px(ctx, x + ca * d, y + sa * d, 3, col);
    }

    // Fijado: esquinas alrededor del blanco.
    const tg = pl.target;
    if (tg && !tg.dead && tg.hurt) {
      ctx.globalAlpha = fade;
      corners(ctx, tg.x, tg.y - (tg.bodyH || 20) * 0.5, (tg.r || 12) + 8 + Math.sin(t * 8) * 1.5, col);
    }

    // Mira: Poké Ball con esquinas que laten.
    ctx.globalAlpha = fade * 0.95;
    corners(ctx, cx, cy, 11 + Math.sin(t * 6) * 1.5, col);
    G.Icons.draw(ctx, 'ball', Math.round(cx - 6), Math.round(cy - 6), 12);
    ctx.restore();
  }

  return { steer, draw, get held() { return held; }, get mode() { return mode(); } };
})();
