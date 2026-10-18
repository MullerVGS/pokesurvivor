/* ============ minimap.js — minimapa de la partida ============
 * Un recuadro arriba a la derecha con el entorno de tu Pokémon, en pixel art
 * como el resto del juego: se pinta en un lienzo pequeño (1 px = 2×2 tiles) y
 * se amplía ×2 sin suavizar, la misma escala que los sprites. El mundo no
 * tiene fin, así que sólo enseña lo que cabe a tu alrededor:
 *   fondo     el mapa de Mundo Misterioso: paredes en azul claro sobre el
 *             panel, agua/lava con el color del bioma. Cada chunk se pinta una
 *             vez (8×8) y se juntan en un lienzo que sólo se rehace al cambiar
 *             de chunk o de arena. En calidad baja, sólo los iconos.
 *   iconos    (mapas de caracteres con contorno, como icons.js) tú en el
 *             centro, compañeros, jefes, la grieta, altares (grises si ya se
 *             usaron), manantiales, cofres con candado, el recuadro de la
 *             cámara y los enemigos de alrededor como puntitos
 *   bordes    un jefe o la grieta lejos: su icono pegado al borde, con flecha
 *
 * Se enciende y se apaga en Ajustes > Gráficos o con la tecla M (G.Settings
 * 'minimap'). En móvil es más pequeño y se aparta de la pausa, los ataques y
 * el joystick fijo, estén donde estén (layout-ui.js).
 * Cooperativo: cada uno ve el suyo con lo que ya tiene su ordenador (la grieta
 * y los jefes llegan del anfitrión; los altares son de cada uno).
 */
G.Minimap = (() => {
  const CELL = G.World.TS * 2;           // mundo por píxel del minimapa (2 tiles)
  const PS = 2;                          // cada píxel del minimapa, en pantalla (como G.Sprites.PX)
  const B = 5;                           // grosor del marco
  const NEAR = 760;                      // enemigos comunes: sólo los de alrededor
  const BUDGET = 4;                      // chunks nuevos por fotograma, para no dar tirones
  const MAX_TILES = 300;
  const N = G.World.CW / G.World.TS;     // tiles por chunk (16)
  const CN = N / 2;                      // píxeles de minimapa por chunk (8)
  const MAX_RANGE = 70 * CELL / 2;       // el mayor alcance (PC)
  const SPAN = Math.ceil((MAX_RANGE + G.World.CW / 2) / G.World.CW);   // chunks a cada lado del tuyo
  const SIDE = (SPAN * 2 + 1) * CN;      // lado del fondo compuesto, en px
  const K = '#1b1528';                   // contorno (icons.js)

  let lastPl = null, revision = -1;
  const ready = new Set();               // chunks que ya existen en world.js ("cx,cy")
  const tiles = new Map();               // "cx,cy" -> lienzo de CN×CN
  let bg = null, bgAt = '', dirty = true;
  let lo = null;                         // el minimapa a su tamaño real, antes de ampliarlo
  let pois = [], poiAt = 0;

  const on = () => G.Settings.get('minimap') !== false;
  function toggle() { G.Settings.set('minimap', !on()); G.Audio.sfx('click'); }

  const rgb = hex => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));

  // ---------------- iconos (5×5; k = contorno, a = color, b = brillo) ----------------

  const ICON = {
    me: ['.kkk.', 'kaaak', 'kabak', 'kaaak', '.kkk.'],
    altar: ['..k..', '.kak.', 'kabak', '.kak.', '..k..'],
    spring: ['..k..', '.kak.', 'kabak', 'kaaak', '.kkk.'],
    chest: ['.kkk.', 'kbbbk', 'kkbkk', 'kaaak', 'kkkkk'],
    boss: ['k.k.k', 'kakak', 'kaaak', 'kabak', 'kkkkk'],
    rift: ['.kkk.', 'kabak', 'kbkbk', 'kabak', '.kkk.']
  };
  function icon(g, name, x, y, a, b) {
    const rows = ICON[name];
    x = Math.round(x) - 2; y = Math.round(y) - 2;
    for (let j = 0; j < 5; j++) for (let i = 0; i < 5; i++) {
      const c = rows[j][i];
      if (c === '.') continue;
      g.fillStyle = c === 'k' ? K : c === 'a' ? a : b;
      g.fillRect(x + i, y + j, 1, 1);
    }
  }

  /** Olvida todo al empezar otra partida, al reiniciarse el mundo o al abrirse/cerrarse una arena. */
  function sync(pl) {
    if (pl === lastPl && G.World.revision === revision) return;
    ready.clear();lastPl=pl;revision=G.World.revision;
    tiles.clear(); pois = []; poiAt = 0; bgAt = ''; dirty = true;
  }

  /**
   * Un chunk a 1 px por cada 2×2 tiles: pared si hay alguna, si no líquido si
   * hay alguno; el suelo usa el color de su región sobre el panel. Las paredes que dan
   * al suelo, más claras (el borde del pasillo, como en Mundo Misterioso), y
   * el agua o la lava, con la espuma del bioma en la orilla.
   */
  function paintChunk(cx, cy) {
    const TS = G.World.TS, palettes = new Map(), palette = new Array(CN*CN);
    const kind = new Array(CN * CN);
    for (let j = 0; j < CN; j++) for (let i = 0; i < CN; i++) {
      let k = 'floor', bi=G.World.biomeAt((cx*N+i*2)*TS,(cy*N+j*2)*TS);
      for (let v = 0; v < 2 && k !== 'wall'; v++) for (let u = 0; u < 2; u++) {
        const t = G.World.kindAt((cx * N + i * 2 + u) * TS + TS / 2, (cy * N + j * 2 + v) * TS + TS / 2);
        if (t === 'wall') { k='wall';bi=G.World.biomeAt((cx*N+i*2+u)*TS,(cy*N+j*2+v)*TS);break; }
        if (t !== 'floor') { k='liq';bi=G.World.biomeAt((cx*N+i*2+u)*TS,(cy*N+j*2+v)*TS); }
      }
      kind[j*CN+i]=k;palette[j*CN+i]=bi;
      if(!palettes.has(bi)){const b=G.Tiles.BIOMES[bi];palettes.set(bi,{floor:rgb(b.floor[0]),liq:rgb(b.liq),foam:rgb(b.foam),wall:rgb(b.wallTop[0]),light:rgb(b.wallLight)});}
    }
    const c = document.createElement('canvas');
    c.width = c.height = CN;
    const g = c.getContext('2d'), img = g.createImageData(CN, CN);
    const at = (i, j) => (i < 0 || j < 0 || i >= CN || j >= CN ? 'wall' : kind[j * CN + i]);
    for (let j = 0; j < CN; j++) for (let i = 0; i < CN; i++) {
      const k = kind[j * CN + i];
      const color=palettes.get(palette[j*CN+i]);
      const edge = [at(i - 1, j), at(i + 1, j), at(i, j - 1), at(i, j + 1)].includes('floor');
      const col=k==='floor'?color.floor:k==='liq'?(edge?color.foam:color.liq):edge?color.light:color.wall, o=(j*CN+i)*4;
      img.data[o] = col[0]; img.data[o + 1] = col[1]; img.data[o + 2] = col[2]; img.data[o + 3] = k === 'floor' ? 170 : k === 'liq' ? 235 : edge ? 255 : 180;
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
      g.drawImage(t, (cx - pcx + SPAN) * CN, (cy - pcy + SPAN) * CN);
    }
    return done;
  }

  // ---------------- dónde va ----------------

  /** Rectángulos (x, y, ancho, alto) de los botones táctiles, como los pone hud.js. */
  function padRects(w, h) {
    const out = [];
    const pause = G.BattlePanels.pauseLayout(w, h);
    if (pause) out.push([pause.x, pause.y, pause.w, pause.h]);
    const dock = G.BattlePanels.dockLayout(w, h);
    out.push([dock.x - 2, dock.y - 2, dock.w + 4, dock.h + 4]);
    const status = G.BattlePanels.healthLayout(w, h, G.Coop.active ? G.Coop.mates.filter(m => m.connected).length : 0);
    for (const r of [status.player, ...status.allies]) out.push([r.x, r.y, r.w + 15, r.h + 6]);
    if (G.Touch.active && G.Settings.get('stickMode') === 'fixed') {
      const b = G.Touch.stickBase(w, h), r = G.Touch.R();
      out.push([b.x - r, b.y - r, r * 2, r * 2]);
    }
    return out;
  }

  /** Esquina de arriba a la izquierda del minimapa. */
  function place(w, h, D, avoid) {
    const sa = G.Touch.safeArea(), right = w - D - 12 - Math.min(44, sa.right), top = 12 + Math.min(20, sa.top);
    // Debajo de la pausa; si ahí hay algo (el jugador lo ha movido), a media
    // altura o abajo a la derecha, o a la izquierda.
    const spots = [[right, G.Touch.active ? top + 50 : 48], [right, top],
                   ...avoid.map(r => [right, r.y + r.h + 8]), [right, (h - D) / 2], [right, h - D - 16 - Math.min(28, sa.bottom)],
                   [12 + Math.min(44, sa.left), (h - D) / 2]];
    const rects = [...padRects(w, h), ...avoid.map(r => [r.x, r.y, r.w, r.h])], M = 6;
    const free = ([x, y]) => y >= top && y + D <= h - 8 && rects.every(r => x + D + M < r[0] || x - M > r[0] + r[2] || y + D + M < r[1] || y - M > r[1] + r[3]);
    return spots.find(free);
  }

  // ---------------- dibujo ----------------

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function draw(ctx, w, h, pl, avoid = []) {
    if (!on() || !pl) return;
    sync(pl);
    // L: lado del mapa en píxeles de minimapa (par, para que tú quedes en el centro).
    const want = Math.min(G.Touch.active ? 104 : 150, Math.round(h * 0.3));
    let L = Math.floor((want - B * 2) / PS / 2) * 2, D = L * PS + B * 2;
    let spot = place(w, h, D, avoid);
    // Reduce only when the full map cannot fit between the HUD panels.
    while (!spot && L > 24) { L -= 8; D = L * PS + B * 2; spot = place(w, h, D, avoid); }
    if (!spot) return;
    const half = L / 2, range = half * CELL, [x0, y0] = spot;
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
      pois = G.World.specialsNear(pl.x, pl.y, MAX_RANGE).filter(p => p.type !== 'trap');
    }

    // El mapa se mueve a saltos de píxel entero (si no, las paredes tiemblan).
    const ox = Math.floor(pl.x / CELL), oy = Math.floor(pl.y / CELL);
    const X = wx => Math.floor(wx / CELL) - ox + half, Y = wy => Math.floor(wy / CELL) - oy + half;
    const inside = (x, y, m) => x >= m && y >= m && x < L - m && y < L - m;
    const t = now / 1000, blink = Math.sin(t * 6) > 0;

    if (!lo || lo.width !== L) lo = Object.assign(document.createElement('canvas'), { width: L, height: L });
    const g = lo.getContext('2d');
    g.clearRect(0, 0, L, L);
    // Lo que no es lo principal (el terreno, el recuadro de la cámara y el
    // panel), translúcido: se ve la partida por debajo. Los iconos, enteros.
    if (terrain && bg) {
      const bx = (pcx - SPAN) * CN - ox + half, by = (pcy - SPAN) * CN - oy + half;
      g.globalAlpha = 0.6;
      g.drawImage(bg, bx, by);
      g.globalAlpha = 1;
    }

    // Lo que ve la cámara (línea de 1 px).
    const cam = G.Camera;
    g.fillStyle = 'rgba(244,248,255,.3)';
    {
      const l = X(cam.left()), tp = Y(cam.top()), r = X(cam.left() + cam.w), b = Y(cam.top() + cam.h);
      g.fillRect(l, tp, r - l + 1, 1); g.fillRect(l, b, r - l + 1, 1);
      g.fillRect(l, tp, 1, b - tp + 1); g.fillRect(r, tp, 1, b - tp + 1);
    }

    // Enemigos de alrededor: un píxel rojo.
    g.fillStyle = '#ff5f6d';
    for (const e of G.EnemyMgr.queryCircle(pl.x, pl.y, NEAR)) if (!e.boss) g.fillRect(X(e.x), Y(e.y), 1, 1);

    // Altares, manantiales y cofres con candado.
    for (const p of pois) {
      const px = X(p.x), py = Y(p.y);
      if (!inside(px, py, 2)) continue;
      if (p.type === 'altar') icon(g, 'altar', px, py, p.used ? '#5d6678' : G.Interact.POWERS[p.kind].color, p.used ? '#8a93a5' : '#ffffff');
      else if (p.type === 'spring') icon(g, 'spring', px, py, p.charge < 0.15 ? '#3f6f62' : '#4fd1ff', p.charge < 0.15 ? '#5b8f80' : '#d6f6ff');
      else icon(g, 'chest', px, py, '#b8742c', '#ffd23f');
    }

    // Grieta y jefes: dentro, el icono parpadea; lejos, pegado al borde con flecha.
    const marks = G.Challenges.markers().map(p => ({ ...p, name: 'boss', a: p.id === 'ditto' ? '#da9ac8' : '#f2bd72', b: '#ffffff' }));
    const rift = G.Rift.rift;
    if (rift) marks.push({ x: rift.x, y: rift.y, name: 'rift', a: blink ? '#e2d0ff' : '#a06bff', b: blink ? '#a06bff' : '#e2d0ff' });
    for (const e of G.EnemyMgr.all()) if (e.boss && !e.dead) marks.push({ x: e.x, y: e.y, name: 'boss', a: '#ffcb3d', b: blink ? '#ff5f6d' : '#fff7d6' });
    for (const m of marks) {
      let px = X(m.x), py = Y(m.y);
      if (inside(px, py, 3)) { icon(g, m.name, px, py, m.a, m.b); continue; }
      const dx = px - half, dy = py - half, f = (half - 5) / Math.max(Math.abs(dx), Math.abs(dy));
      px = half + dx * f; py = half + dy * f;
      icon(g, m.name, px, py, m.a, m.b);
      // Flecha: dos píxeles hacia fuera.
      const ux = Math.sign(Math.round(dx * f / (half - 5))), uy = Math.sign(Math.round(dy * f / (half - 5)));
      g.fillStyle = m.a;
      g.fillRect(Math.round(px) + ux * 3, Math.round(py) + uy * 3, 1, 1);
      g.fillStyle = K;
      g.fillRect(Math.round(px) + ux * 4, Math.round(py) + uy * 4, 1, 1);
    }

    // Compañeros (con su color; caído, parpadea en rojo) y tú en el centro.
    if (G.Coop.active) for (const m of G.Coop.mates) {
      if (!m.connected) continue;
      const o = m.pl;
      let px = X(o.x), py = Y(o.y);
      if (!inside(px, py, 3)) {
        const dx = px - half, dy = py - half, f = (half - 3) / Math.max(Math.abs(dx), Math.abs(dy));
        px = half + dx * f; py = half + dy * f;
      }
      icon(g, 'me', px, py, o.dead ? (blink ? '#ff5f6d' : '#ffd0d5') : m.color, '#ffffff');
    }
    icon(g, 'me', half, half, pl.dead ? '#ff8a96' : '#ffd23f', '#fff7d6');

    // Marco: el panel de las cajas del juego (azul, borde claro y contorno oscuro).
    ctx.save();
    roundRect(ctx, x0, y0, D, D, 9);
    // (Más oscuro que las cajas del menú: si no, el agua azul se pierde en el fondo.)
    const grad = ctx.createLinearGradient(0, y0, 0, y0 + D);
    grad.addColorStop(0, 'rgba(22,40,90,.55)'); grad.addColorStop(1, 'rgba(12,24,62,.55)');
    ctx.fillStyle = grad; ctx.fill();
    ctx.lineWidth = 4; ctx.strokeStyle = 'rgba(11,24,56,.6)'; ctx.stroke();
    roundRect(ctx, x0 + 2, y0 + 2, D - 4, D - 4, 7);
    ctx.lineWidth = 2; ctx.strokeStyle = 'rgba(244,248,255,.6)'; ctx.stroke();
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(lo, x0 + B, y0 + B, L * PS, L * PS);
    ctx.restore();
  }

  return { draw, toggle };
})();
