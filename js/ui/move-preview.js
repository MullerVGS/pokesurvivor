/* Escena de demostración aislada. Usa las MISMAS fábricas Combat/Projectiles/FX
 * que la partida, con blancos, reloj y efectos propios, sin red ni recompensas.
 * Añadir un movimiento al catálogo le da preview automáticamente. Un kind nuevo
 * se implementa en Combat, como siempre; aquí no hay una segunda animación.
 */
G.MovePreview = (() => {
  const W = 288, H = 160, mounts = new Map();
  const noop = () => {};
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // Encuadra la acción de ESTE nivel. El recorrido vacío de un proyectil y
  // el alcance de una evolución futura no deben alejar al Pokémon de la cámara.
  function layout(m) {
    const radial = ['aura', 'orbit', 'nova', 'mine', 'trail', 'buff'].includes(m.kind);
    const radius = m.radius || 90;
    let bounds, points;
    if (m.kind === 'buff') return { bounds: [-64, -86, 64, 30], points: [] };
    if (radial) {
      const r = m.kind === 'nova' ? 105 : m.kind === 'mine' ? radius + 40 : m.kind === 'trail' ? 70 + radius : radius + (m.size || 10);
      bounds = [-r - 16, -r - 34, r + 16, r + 16];
      points = Array.from({ length: 5 }, (_, i) => {
        const a = i * Math.PI * 2 / 5;
        const reach = m.kind === 'orbit' ? radius : Math.min(r * 0.7, 90);
        return [Math.cos(a) * reach, Math.sin(a) * reach];
      });
    } else if (m.kind === 'melee') {
      bounds = [-Math.max(32, radius * 0.5), -radius - 30, radius + 22, radius + 12];
      points = [0, -0.5, 0.5].map(a => [Math.cos(a) * radius * 0.7, Math.sin(a) * radius * 0.7]);
    } else {
      const length = ['beam', 'dash', 'boomerang'].includes(m.kind) ? radius : m.kind === 'cone' ? m.speed * m.life : 180;
      const halfSpread = m.kind === 'boomerang' ? (m.spread || 0.5) * Math.min(m.count, 3) / 2 : m.kind === 'cone' ? (m.spread || 0.5) / 2 : 0;
      const halfHeight = Math.max(40, length * Math.sin(halfSpread), (m.width || 0) / 2);
      bounds = [-42, -halfHeight - 38, length + 28, halfHeight + 16];
      points = [[length * 0.6, 0], [length * 0.8, -28], [length * 0.8, 28], [length, 0], [length * 0.4, 30]];
      if (m.kind === 'meteor') {
        points = [[90, 0], [130, -30], [150, 25], [185, 0], [110, 32]];
        bounds = [-36, -radius - 105, 185 + radius + 16, radius + 48];
      }
    }
    // Incluye las cabezas de los blancos y del actor, no sólo sus pies.
    for (const [x, y] of points) {
      bounds[0] = Math.min(bounds[0], x - 24); bounds[2] = Math.max(bounds[2], x + 24);
      bounds[1] = Math.min(bounds[1], y - 42); bounds[3] = Math.max(bounds[3], y + 16);
    }
    return { bounds, points };
  }

  function createScene(config, level, evolved = false) {
    const move = G.Moves.instance(config.id, level);
    if (evolved) G.Moves.evolve(move);
    const { bounds: [left, top, right, bottom], points } = layout(move);
    const zoom = Math.min(1.3, (W - 16) / (right - left), (H - 16) / (bottom - top));
    const originX = W / 2 - (left + right) / 2 * zoom, originY = H / 2 - (top + bottom) / 2 * zoom;
    const dex = config.dex || 25;
    const anim = new G.Sprites.Animator(dex, Math.min(1, 42 / G.Sprites.bodyHeight(dex)));
    anim.dir = 2;
    let time = 0;
    const stage = {
      U: G.U, VFX: G.VFX, Sprites: G.Sprites, Icons: G.Icons, Moves: G.Moves, Types: G.Types, LIFT: G.LIFT,
      Settings: { fx: Math.min(1, G.Settings.fx), get: key => key === 'dmgNumbers' ? false : G.Settings.get(key) },
      Camera: { sees: (x, y) => Math.abs(x) < 900 && Math.abs(y) < 600, kick: noop },
      Audio: { sfx: noop }, Coop: { active: false }, EventItems: { tick: noop, onCast: noop },
      Weather: { mult: () => 1 },
      World: { isWall: () => false, isFree: () => true, collide: noop, projectileBlock: () => null,
        propsInCircle: () => [], damageProp: noop }
    };
    const actor = {
      x: 0, y: 0, r: 14, vr: 14, bodyH: 42, dex, aim: 0, aimed: false, dead: false,
      atk: config.atk || 1, cdMul: config.cdMul || 1, critChance: 0, dmgDealt: 0, moves: [move],
      activeGroup: () => [move], hasItem: () => false, onDealt: noop, addBuff: noop, heal: noop,
      cast(m) { anim.play(G.Moves.castAnimation(m.kind)); }
    };
    stage.Game = { player: actor };
    const enemies = points.map(([x, y], i) => {
      return {
        id: i + 1, x, y,
        r: 12, bodyH: 28, types: ['normal'], dead: false, dmg: 0, hp: 10000, flash: 0,
        cy() { return this.y; }, hurt() { this.flash = 0.18; },
        applyBurn: noop, applyPoison: noop, applySlow: noop
      };
    });
    stage.EnemyMgr = { all: () => enemies,
      queryCircle: (x, y, r) => enemies.filter(e => G.U.dist2(x, y, e.x, e.y) <= (r + e.r) ** 2) };
    actor.target = enemies[0];
    stage.FX = G.FX.create(stage);
    stage.Projectiles = G.Projectiles.create(stage);
    stage.Combat = G.Combat.create(stage);
    move.t = 0.35;
    const cycle = Math.max(4, move.cd * actor.cdMul * 2 + 0.5, move.kind === 'mine' ? 5 : 0);

    function step(dt) {
      time += dt;
      if (time > cycle) {
        time = 0; actor.x = actor.y = 0; actor.lastPatch = null; move.t = 0.35;
        stage.Projectiles.clear(); stage.Combat.clearFields(); stage.FX.clear();
      }
      if (move.kind === 'trail') { actor.x = Math.sin(time * 1.4) * 70; actor.y = Math.cos(time * 1.4) * 25; }
      if (move.kind === 'mine') { enemies[0].x = Math.max(0, 100 - time * 75); enemies[0].y = 0; }
      if (move.kind === 'dash' && move.t <= dt) actor.x = actor.y = 0;
      actor.aim = actor.target ? Math.atan2(actor.target.y - actor.y, actor.target.x - actor.x) : 0;
      stage.Combat.tick(dt, actor, time);
      stage.Projectiles.update(dt, actor, enemies);
      stage.Combat.updateFields(dt);
      stage.Combat.resolve(dt, actor, time);
      stage.FX.update(dt); anim.update(dt);
      for (const e of enemies) e.flash = Math.max(0, e.flash - dt);
    }

    function draw(ctx) {
      ctx.save(); ctx.clearRect(0, 0, W, H); ctx.imageSmoothingEnabled = false;
      ctx.fillStyle = '#182e25'; ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = '#223a2d';
      for (let y = 0; y < H; y += 16) for (let x = 0; x < W; x += 16) if ((x / 16 + y / 16) % 2) ctx.fillRect(x, y, 16, 16);
      ctx.translate(originX, originY); ctx.scale(zoom, zoom);
      stage.Combat.drawGroundFields(ctx);
      for (const e of enemies) {
        // Muñecos de entrenamiento con la silueta de Sustituto, en pixel art.
        ctx.fillStyle = '#102017'; ctx.fillRect(e.x - 10, e.y - 2, 22, 5);
        ctx.fillStyle = e.flash ? '#fff2b0' : '#99b974';
        ctx.fillRect(e.x - 10, e.y - 23, 20, 22); ctx.fillRect(e.x - 8, e.y - 29, 5, 7); ctx.fillRect(e.x + 4, e.y - 29, 5, 7);
        ctx.fillStyle = '#1b1528'; ctx.fillRect(e.x - 5, e.y - 20, 3, 3); ctx.fillRect(e.x + 3, e.y - 20, 3, 3);
      }
      G.Sprites.drawShadow(ctx, dex, actor.x, actor.y, anim.scale);
      anim.draw(ctx, actor.x, actor.y);
      stage.Projectiles.draw(ctx); stage.Combat.drawAirFields(ctx); stage.FX.draw(ctx);
      ctx.restore();
    }
    return { step, draw, move, stage };
  }

  function markup(c) {
    return `<div class="move-preview" data-preview-id="${esc(c.id)}">${c.choices ? `<select class="preview-moves" aria-label="${esc(G.T('Movimiento de la demostración'))}">${c.choices.map(m => `<option value="${esc(m.id)}">${esc(G.T(G.Moves.BY_ID[m.id].name))}</option>`).join('')}</select>` : ''}<canvas width="${W}" height="${H}" aria-label="${esc(G.T('Demostración del movimiento'))}"></canvas><p class="preview-caption"></p></div>`;
  }

  function attach(root, config) {
    const container = root.querySelector('.move-preview');
    if (!container) { mounts.delete(root); return; }
    const entry = { root, container, config, level: config.level || 1,
      evolved: !!config.evolved, scene: null, acc: 0 };
    mounts.set(root, entry);
    const moves = container.querySelector('.preview-moves');
    if (moves) moves.onchange = () => {
      entry.config = config.choices.find(c => c.id === moves.value);
      entry.level = entry.config.level; entry.evolved = entry.config.evolved;
      select(entry);
    };
    select(entry);
  }

  function select(e) {
    const def = G.Moves.BY_ID[e.config.id];
    e.scene = createScene(e.config, e.level, e.evolved);
    e.container.querySelector('.preview-caption').textContent = e.evolved ? G.T(e.scene.move.name) : G.I18n.f('Nv. {x}: {x}', e.level, e.level === 1 ? G.T('Movimiento inicial') : G.T(def.ups[e.level - 2].t));
    e.scene.draw(e.container.querySelector('canvas').getContext('2d'));
  }

  function tick(dt) {
    let active = null;
    for (const [root, e] of mounts) {
      if (!root.isConnected) { mounts.delete(root); continue; }
      const r = e.container.getBoundingClientRect(), box = root.getBoundingClientRect();
      if (r.bottom > box.top && r.top < box.bottom && root.getClientRects().length) active = e;
    }
    if (!active || document.hidden) return;
    active.acc += dt;
    if (active.acc < 1 / 30) return;
    const step = Math.min(0.05, active.acc); active.acc = 0;
    active.scene.step(step);
    active.scene.draw(active.container.querySelector('canvas').getContext('2d'));
  }
  return { createScene, markup, attach, tick, release(root) { mounts.delete(root); }, get count() { return mounts.size; } };
})();
