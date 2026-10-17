/* ============ minimap.js — minimapa de la partida ============
 * Un círculo arriba a la derecha con el entorno de tu Pokémon. El mundo no
 * tiene fin, así que sólo enseña RANGE de mundo a tu alrededor:
 *   fondo     paredes y agua/lava con los colores del bioma, 1 px por tile.
 *             Cada chunk se pinta una vez (16×16) y se juntan en un lienzo
 *             que sólo se rehace al cambiar de chunk, de bioma o de arena.
 *             En calidad baja no hay fondo: sólo los iconos.
 *   iconos    tú (centro), compañeros, jefes, la grieta, altares (apagados en
 *             gris), manantiales, cofres con candado, el recuadro de la cámara
 *             y los enemigos de alrededor como puntitos
 *   bordes    un jefe o la grieta fuera del círculo: flecha en el borde
 *
 * Se enciende y se apaga en Ajustes > Gráficos o con la tecla M (G.Settings
 * 'minimap'). En móvil es más pequeño y se aparta de la pausa, los ataques y
 * el joystick fijo, estén donde estén (layout-ui.js).
 * Cooperativo: cada uno ve el suyo con lo que ya tiene su ordenador (la grieta
 * y los jefes llegan del anfitrión; los altares son de cada uno).
 */
G.Minimap = (() => {
  const RANGE = 3 * G.Camera.VIEW_W;     // radio de mundo que se ve (unas 3 vistas)
  const NEAR = 760;                      // enemigos comunes: sólo los de alrededor
  const BUDGET = 4;                      // chunks nuevos por fotograma, para no dar tirones
  const MAX_TILES = 300;
  const N = G.World.CW / G.World.TS;     // tiles por chunk (16)
  const SPAN = Math.ceil((RANGE + G.World.CW / 2) / G.World.CW);   // chunks a cada lado del tuyo
  const SIDE = (SPAN * 2 + 1) * N;       // lado del fondo compuesto, en px (= tiles)
  const S = 54, GAP = 9, BAR_W = S + 18 + 4 * S + 3 * GAP;           // como en hud.js

  let lastPl = null, biome = -1, arena = null;
  const ready = new Set();               // chunks que ya existen en world.js ("cx,cy")
  const tiles = new Map();               // "cx,cy" -> lienzo de N×N
  let bg = null, bgAt = '', dirty = true;
  let pois = [], poiAt = 0;

  const on = () => G.Settings.get('minimap') !== false;
  function toggle() { G.Settings.set('minimap', !on()); G.Audio.sfx('click'); }

  const rgb = hex => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));

  /** Olvida todo al empezar otra partida, al cambiar de bioma o al abrirse/cerrarse una arena. */
  function sync(pl) {
    if (pl === lastPl && G.World.biome === biome && G.World.arena === arena) return;
    if (pl !== lastPl || G.World.arena !== arena) ready.clear();
    lastPl = pl; biome = G.World.biome; arena = G.World.arena;
    tiles.clear(); pois = []; poiAt = 0; bgAt = ''; dirty = true;
  }

  /** Paredes y líquido de un chunk, 1 px por tile (el suelo, transparente). */
  function paintChunk(cx, cy) {
    const B = G.Tiles.BIOMES[biome];
    const wall = rgb(B.wallLight), liq = rgb(B.liq);
    const c = document.createElement('canvas');
    c.width = c.height = N;
    const g = c.getContext('2d'), img = g.createImageData(N, N), TS = G.World.TS;
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const k = G.World.kindAt((cx * N + i) * TS + TS / 2, (cy * N + j) * TS + TS / 2);
      if (k === 'floor') continue;
      const col = k === 'wall' ? wall : liq, o = (j * N + i) * 4;
      img.data[o] = col[0]; img.data[o + 1] = col[1]; img.data[o + 2] = col[2]; img.data[o + 3] = 230;
    }
    g.putImageData(img, 0, 0);
    if (tiles.size >= MAX_TILES) tiles.delete(tiles.keys().next().value);
    tiles.set(cx + ',' + cy, c);
    return c;
  }

  /**
   * Prepara los chunks alrededor del tuyo (como mucho BUDGET por fotograma) y,
   * con fondo, los junta en un lienzo. Devuelve true cuando ya están todos.
   */
  function build(pcx, pcy, terrain) {
    let budget = BUDGET, done = true;
    const g = terrain ? (bg = bg || Object.assign(document.createElement('canvas'), { width: SIDE, height: SIDE })).getContext('2d') : null;
    if (g) g.clearRect(0, 0, SIDE, SIDE);
    for (let cy = pcy - SPAN; cy <= pcy + SPAN; cy++) for (let cx = pcx - SPAN; cx <= pcx + SPAN; cx++) {
      const k = cx + ',' + cy;
      if (!ready.has(k)) {
        if (budget-- <= 0) { done = false; continue; }
        G.World.kindAt(cx * G.World.CW, cy * G.World.CW);      // crea el chunk (y sus objetos)
        ready.add(k);
      }
      if (!g) continue;
      let t = tiles.get(k);
      if (!t) {
        if (budget-- <= 0) { done = false; continue; }
        t = paintChunk(cx, cy);
      }
      g.drawImage(t, (cx - pcx + SPAN) * N, (cy - pcy + SPAN) * N);
    }
    return done;
  }

  // ---------------- dónde va ----------------

  /** Rectángulos (x, y, ancho, alto) de los botones táctiles, como los pone hud.js. */
  function padRects(w, h) {
    const sa = G.Touch.safeArea(), out = [];
    const pp = G.Touch.spot('pause');
    out.push([pp ? G.U.clamp(pp[0] * w - 20, 4, w - 44) : w - 52 - Math.min(44, sa.right),
              pp ? G.U.clamp(pp[1] * h - 20, 10, h - 44) : 12 + Math.min(20, sa.top), 40, 40]);
    const pb = G.Touch.spot('bar');
    const by = pb ? G.U.clamp(pb[1] * h - S / 2, 24, h - S - 6) : h - S - 18 - Math.min(28, sa.bottom);
    const bx = pb ? G.U.clamp(pb[0] * w - BAR_W / 2, 6, Math.max(6, w - BAR_W - 6)) : (w - 4 * S - 3 * GAP) / 2 - S - 18;
    out.push([bx, by - 22, BAR_W, S + 22]);                 // con el nombre del ataque encima
    if (G.Settings.get('stickMode') === 'fixed') {
      const b = G.Touch.stickBase(w, h), r = G.Touch.R();
      out.push([b.x - r, b.y - r, r * 2, r * 2]);
    }
    return out;
  }

  /** Esquina de arriba a la izquierda del minimapa. */
  function place(w, h, D) {
    if (!G.Touch.active) return [w - D - 16, 48];          // debajo del clima
    const sa = G.Touch.safeArea(), right = w - D - 12 - Math.min(44, sa.right), top = 12 + Math.min(20, sa.top);
    // Debajo de la pausa; si ahí hay algo (el jugador lo ha movido), a media
    // altura o abajo a la derecha, o a la izquierda.
    const spots = [[right, top + 50], [right, top], [right, (h - D) / 2], [right, h - D - 16 - Math.min(28, sa.bottom)],
                   [12 + Math.min(44, sa.left), (h - D) / 2]];
    const rects = padRects(w, h), M = 6;
    const free = ([x, y]) => rects.every(r => x + D + M < r[0] || x - M > r[0] + r[2] || y + D + M < r[1] || y - M > r[1] + r[3]);
    return spots.find(free) || spots[0];
  }

  // ---------------- dibujo ----------------

  function draw(ctx, w, h, pl) {
    if (!on() || !pl) return;
    sync(pl);
    const D = Math.min(G.Touch.active ? 104 : 140, Math.round(h * 0.3)), R = D / 2;
    const [x0, y0] = place(w, h, D);
    const cx = x0 + R, cy = y0 + R, k = R / RANGE;
    G.Tooltip.zone(x0, y0, D, D, 'term:minimap');     // popup con la leyenda (y tapa el mundo de debajo)
    const CW = G.World.CW, pcx = Math.floor(pl.x / CW), pcy = Math.floor(pl.y / CW);
    const terrain = G.Settings.fx > 0;
    const at = pcx + ',' + pcy + (terrain ? '' : ',-');
    if (at !== bgAt) { bgAt = at; dirty = true; }
    if (dirty) dirty = !build(pcx, pcy, terrain);
    // Objetos: se buscan cada medio segundo (un cofre abierto desaparece, un altar se apaga).
    const now = performance.now();
    if (!dirty && now - poiAt > 500) {
      poiAt = now;
      pois = G.World.specialsNear(pl.x, pl.y, RANGE).filter(p => p.type !== 'trap');
    }
    const X = wx => cx + (wx - pl.x) * k, Y = wy => cy + (wy - pl.y) * k;
    const t = now / 1000, beat = 0.5 + Math.sin(t * 6) * 0.5;

    ctx.save();
    ctx.beginPath(); ctx.arc(cx, cy, R, 0, 6.2832);
    ctx.fillStyle = 'rgba(10,16,28,.72)'; ctx.fill();
    ctx.save();
    ctx.clip();
    if (terrain && bg) {
      // Suelo con el color del bioma, oscurecido para que se lean los iconos.
      ctx.fillStyle = G.Tiles.BIOMES[biome].floor[0];
      ctx.globalAlpha = 0.45; ctx.fillRect(x0, y0, D, D); ctx.globalAlpha = 1;
      ctx.imageSmoothingEnabled = true;
      const s = G.World.TS * k;
      ctx.drawImage(bg, X((pcx - SPAN) * CW), Y((pcy - SPAN) * CW), SIDE * s, SIDE * s);
      ctx.imageSmoothingEnabled = false;
      ctx.fillStyle = 'rgba(8,12,22,.35)'; ctx.fillRect(x0, y0, D, D);
    }

    // Lo que ve la cámara.
    const cam = G.Camera;
    ctx.lineWidth = 1; ctx.strokeStyle = 'rgba(234,242,255,.45)';
    ctx.strokeRect(Math.round(X(cam.left())) + 0.5, Math.round(Y(cam.top())) + 0.5, Math.round(cam.w * k), Math.round(cam.h * k));

    // Enemigos de alrededor: puntitos.
    ctx.fillStyle = 'rgba(255,110,120,.75)';
    const dot = D > 120 ? 2 : 1.6;
    for (const e of G.EnemyMgr.queryCircle(pl.x, pl.y, NEAR)) if (!e.boss) ctx.fillRect(X(e.x) - dot / 2, Y(e.y) - dot / 2, dot, dot);

    // Altares, manantiales y cofres con candado.
    for (const p of pois) {
      const px = X(p.x), py = Y(p.y);
      if ((px - cx) ** 2 + (py - cy) ** 2 > R * R) continue;
      ctx.beginPath();
      if (p.type === 'altar') {
        ctx.moveTo(px, py - 4); ctx.lineTo(px + 3.5, py); ctx.lineTo(px, py + 4); ctx.lineTo(px - 3.5, py);
        ctx.closePath();
        ctx.fillStyle = p.used ? '#5d6678' : G.Interact.POWERS[p.kind].color;
      } else if (p.type === 'spring') {
        ctx.arc(px, py, 3, 0, 6.2832);
        ctx.fillStyle = p.charge < 0.15 ? '#4a7a66' : '#7dffb0';
      } else {
        ctx.rect(px - 3, py - 2.5, 6, 5);
        ctx.fillStyle = '#ffd23f';
      }
      ctx.lineWidth = 1.5; ctx.strokeStyle = 'rgba(0,0,0,.8)';
      ctx.stroke(); ctx.fill();
    }

    // Grieta y jefes: dentro del círculo, icono que late; fuera, flecha en el borde.
    const marks = [];
    const rift = G.Rift.rift;
    if (rift) marks.push({ x: rift.x, y: rift.y, col: beat > 0.5 ? '#e2d0ff' : '#a06bff', rift: true });
    for (const e of G.EnemyMgr.all()) if (e.boss && !e.dead) marks.push({ x: e.x, y: e.y, col: '#ffcb3d' });
    for (const m of marks) {
      const dx = (m.x - pl.x) * k, dy = (m.y - pl.y) * k, d = Math.hypot(dx, dy);
      if (d < R - 7) {
        ctx.beginPath(); ctx.arc(cx + dx, cy + dy, 4.5 + beat * 1.5, 0, 6.2832);
        ctx.fillStyle = m.col; ctx.fill();
        ctx.lineWidth = 1.5; ctx.strokeStyle = m.rift ? '#1a0b33' : '#20160a'; ctx.stroke();
        continue;
      }
      const a = Math.atan2(dy, dx), ex = cx + Math.cos(a) * (R - 8), ey = cy + Math.sin(a) * (R - 8);
      ctx.beginPath();
      ctx.moveTo(ex + Math.cos(a) * 7, ey + Math.sin(a) * 7);
      ctx.lineTo(ex + Math.cos(a + 2.4) * 6, ey + Math.sin(a + 2.4) * 6);
      ctx.lineTo(ex + Math.cos(a - 2.4) * 6, ey + Math.sin(a - 2.4) * 6);
      ctx.closePath();
      ctx.fillStyle = m.col; ctx.fill();
      ctx.lineWidth = 1.5; ctx.strokeStyle = 'rgba(0,0,0,.85)'; ctx.stroke();
    }

    // Compañeros (con su color; caído, parpadea en rojo) y tú en el centro.
    if (G.Coop.active) for (const m of G.Coop.mates) {
      if (!m.connected) continue;
      const o = m.pl, dx = (o.x - pl.x) * k, dy = (o.y - pl.y) * k, d = Math.hypot(dx, dy), f = Math.min(1, (R - 5) / (d || 1));
      ctx.beginPath(); ctx.arc(cx + dx * f, cy + dy * f, 3.5, 0, 6.2832);
      ctx.fillStyle = o.dead ? (Math.sin(t * 8) > 0 ? '#ff5f6d' : '#ffd0d5') : m.color; ctx.fill();
      ctx.lineWidth = 1.5; ctx.strokeStyle = 'rgba(0,0,0,.8)'; ctx.stroke();
    }
    ctx.beginPath(); ctx.arc(cx, cy, 3.5, 0, 6.2832);
    ctx.fillStyle = pl.dead ? '#ff8a96' : '#ffffff'; ctx.fill();
    ctx.lineWidth = 1.5; ctx.strokeStyle = '#0a101c'; ctx.stroke();
    ctx.restore();

    // Borde.
    ctx.beginPath(); ctx.arc(cx, cy, R, 0, 6.2832);
    ctx.lineWidth = 2; ctx.strokeStyle = 'rgba(140,170,210,.45)'; ctx.stroke();
    ctx.restore();
  }

  return { draw, toggle };
})();
