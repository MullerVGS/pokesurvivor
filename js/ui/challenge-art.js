/* Arte dos encontros: pixel art, avisos no chão e paletas corrompidas em cache. */
G.ChallengeArt = (() => {
  const negatives = new WeakMap(), anims = new Map();
  const TAU = Math.PI * 2;
  const colors = { fire: '#48e8f3', water: '#ef53bd', electric: '#b47aff', grass: '#cc77e9', ice: '#f58c55',
    ghost: '#b0f28f', dark: '#e87aff', psychic: '#82dfc4', normal: '#b68ae0' };
  function color(type) { return colors[type] || '#d185dc'; }
  function negative(img) {
    if (negatives.has(img)) return negatives.get(img);
    const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
    const ctx = c.getContext('2d', { willReadFrequently: true }); ctx.drawImage(img, 0, 0);
    const data = ctx.getImageData(0, 0, c.width, c.height), p = data.data;
    for (let i = 0; i < p.length; i += 4) {
      if (!p[i + 3]) continue;
      const light = Math.max(p[i], p[i + 1], p[i + 2]);
      if (light < 75) { p[i] = 28; p[i + 1] = 12; p[i + 2] = 47; }
      else { p[i] = (255 - p[i]) * 0.8 + 35; p[i + 1] = (255 - p[i + 1]) * 0.75 + 24; p[i + 2] = (255 - p[i + 2]) * 0.85 + 36; }
    }
    ctx.putImageData(data, 0, 0); negatives.set(img, c); return c;
  }
  function sprite(ctx, dex, x, y, name = 'Idle', t = 0, dir = 0, opts = {}) {
    const key = dex + ':' + name;
    let a = anims.get(key);
    if (!a) { a = new G.Sprites.Animator(dex); anims.set(key, a); if (anims.size > 24) anims.delete(anims.keys().next().value); }
    a.loop(name); a.dir = dir; a.update(Math.max(0, t - (a.drawT || 0))); a.drawT = t;
    a.draw(ctx, x, y, opts);
  }
  function label(ctx, text, x, y, col = '#fff2c8', size = 13) {
    ctx.save(); ctx.font = '700 ' + size + 'px system-ui, sans-serif'; ctx.textAlign = 'center';
    ctx.lineWidth = 4; ctx.strokeStyle = '#171322'; ctx.strokeText(text, x, y); ctx.fillStyle = col; ctx.fillText(text, x, y); ctx.restore();
  }
  function circle(ctx, x, y, r, col, alpha = 0.2) {
    ctx.save(); ctx.fillStyle = col; ctx.globalAlpha = alpha; ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill();
    ctx.globalAlpha = 0.85; ctx.strokeStyle = col; ctx.lineWidth = 2; ctx.stroke(); ctx.restore();
  }
  function generator(ctx, e) {
    const x = Math.round(e.x), y = Math.round(e.y), col = ['#c87de0', '#f18d65', '#6bb4e8'][e.eventIndex || 0];
    ctx.fillStyle = '#201b2c'; ctx.fillRect(x - 22, y - 44, 44, 44);
    ctx.fillStyle = '#5d5b72'; ctx.fillRect(x - 18, y - 40, 36, 36);
    ctx.fillStyle = '#252537'; ctx.fillRect(x - 13, y - 34, 26, 18);
    ctx.fillStyle = col; ctx.fillRect(x - 9, y - 30, Math.round(18 * e.hp / e.maxHp), 10);
    ctx.fillStyle = '#ec4a58'; ctx.fillRect(x - 8, y - 11, 5, 8); ctx.fillRect(x - 3, y - 11, 8, 3); ctx.fillRect(x + 3, y - 8, 4, 5);
    label(ctx, ['Gas', 'Barreras', 'Refuerzos'][e.eventIndex || 0], x, y - 53, col, 11);
  }
  function enemy(ctx, e) {
    if (!e.eventRole) return false;
    if (e.eventRole === 'generator') { if (!e.dead) generator(ctx, e); return true; }
    if (e.eventRole !== 'ditto') return false;
    const s = G.Challenges.state, transforming = s && s.id === 'ditto' && s.phase === 'transform';
    const t = s ? s.t : 0, now = performance.now() / 1000;
    if (e.dead && e.fade <= 0) return true;
    ctx.save(); if (e.dead) ctx.globalAlpha = Math.max(0, e.fade);
    circle(ctx, e.x, e.y, e.r + 12 + Math.sin(now * 5) * 3, '#ab51d0', 0.17);
    G.Sprites.drawShadow(ctx, e.dex, e.x, e.y, e.scale);
    if (transforming) {
      const phase = Math.floor(t * (3 + t * 3)) % 2;
      if (phase === 0) sprite(ctx, 132, e.x, e.y, 'Idle', now, 0, { flash: t > 2.5 });
      else e.anim.draw(ctx, e.x, e.y, { flash: true });
      for (let i = 0; i < 10; i++) {
        const a = i * TAU / 10 + t * 2, r = 40 - t * 7;
        ctx.fillStyle = i % 2 ? '#e8b7ff' : '#533070';
        ctx.fillRect(Math.round(e.x + Math.cos(a) * r), Math.round(e.y - e.bodyH / 2 + Math.sin(a) * r - t * 5), 3, 3);
      }
      label(ctx, '¡Ditto se está transformando!', e.x, e.y - e.bodyH - 25, '#eed1ff');
    } else {
      e.anim.draw(ctx, e.x, e.y, { corrupt: true, flash: e.flash > 0 });
      // Brillo de ojos sobre la cara frontal; no aparece en las direcciones de espalda.
      if (e.anim.dir <= 2 || e.anim.dir >= 6) {
        ctx.fillStyle = '#ff85bd'; const ey = Math.round(e.y - e.bodyH * 0.63);
        ctx.fillRect(Math.round(e.x - 6), ey, 3, 2); ctx.fillRect(Math.round(e.x + 3), ey, 3, 2);
      }
      label(ctx, 'Ditto impostor', e.x, e.y - e.bodyH - 20, '#dc9bf3');
      ctx.fillStyle = '#24162e'; ctx.fillRect(e.x - 35, e.y - e.bodyH - 12, 70, 4);
      ctx.fillStyle = '#dc79e2'; ctx.fillRect(e.x - 35, e.y - e.bodyH - 12, 70 * Math.max(0, e.hp / e.maxHp), 4);
    }
    ctx.restore(); return true;
  }
  function ground(ctx, s, effects, warning) {
    for (const f of effects) {
      circle(ctx, f.x, f.y, f.r, f.t < f.warn ? '#ffbd68' : f.kind === 'gas' ? '#b36ad2' : '#ec765f', f.t < f.warn ? 0.12 : 0.3);
      if (f.kind === 'block' && f.t >= f.warn) {
        ctx.fillStyle = '#a95e62'; ctx.fillRect(f.x - 20, f.y - 15, 40, 8); ctx.fillRect(f.x - 20, f.y + 7, 40, 8);
      }
    }
    if (!s) return;
    if (s.phase === 'offer' || s.phase === 'between') circle(ctx, s.x, s.y, 40, '#df98f1', 0.15);
    if (s.house) {
      circle(ctx, s.x, s.y + 195, 32, '#70e4b0', 0.25);
      label(ctx, 'Salir con el premio', s.x, s.y + 232, '#a1f1ca', 11);
    }
    if (warning) {
      const m = warning.move, x = warning.x, y = warning.y;
      ctx.save(); ctx.strokeStyle = '#ffb566'; ctx.fillStyle = '#ffb566'; ctx.lineWidth = 3; ctx.setLineDash([6, 5]);
      if (['aura', 'orbit', 'nova', 'mine', 'trail'].includes(m.kind)) circle(ctx, x, y, m.radius || 80, '#ffb566', 0.12);
      else if (m.kind === 'meteor' || m.kind === 'chain') circle(ctx, warning.tx, warning.ty, m.kind === 'chain' ? 55 : m.radius, '#ffb566', 0.15);
      else {
        ctx.translate(x, y); ctx.rotate(warning.aim);
        const len = G.Combat.reach(m), width = m.width || m.size * 2 || 24;
        ctx.globalAlpha = 0.16; ctx.fillRect(0, -width / 2, len, width); ctx.globalAlpha = 0.8; ctx.strokeRect(0, -width / 2, len, width);
      }
      ctx.restore();
      label(ctx, m.name || G.Moves.BY_ID[m.id].name, x, y - 70, '#ffcc93', 11);
    }
    if (s.id === 'stampede' && s.phase === 'fight') {
      for (const lane of [-72, 0, 72]) {
        const safe = lane === s.safeY;
        ctx.save(); ctx.globalAlpha = safe ? 0.14 : 0.19; ctx.fillStyle = safe ? '#70e4b0' : '#ffb566';
        ctx.fillRect(s.x - 180, s.y + lane - 29, 360, 58); ctx.restore();
        if (safe) { label(ctx, 'Paso seguro', s.x, s.y + lane + 4, '#a1f1ca', 11); continue; }
        if (s.waveT < 2) {
          label(ctx, s.direction > 0 ? '→ → →' : '← ← ←', s.x, s.y + lane + 5, '#ffd29e', 20);
        } else if (s.waveT <= 3.4) {
          const x = s.x + s.direction * (-180 + (s.waveT - 2) / 1.4 * 360);
          for (let i = 0; i < 2; i++) sprite(ctx, 128, x - i * s.direction * 28, s.y + lane + (i % 2) * 14, 'Walk', s.t, s.direction > 0 ? 2 : 6);
        }
      }
    }
  }
  function event(ctx, s, hold) {
    const now = performance.now() / 1000;
    if (s.phase === 'offer' || s.phase === 'between') {
      if (s.id === 'ditto') sprite(ctx, 132, s.x, s.y, 'Idle', now);
      else if (s.id === 'stampede') sprite(ctx, 128, s.x, s.y, 'Idle', now);
      else if (s.id === 'rocket') generator(ctx, { x: s.x, y: s.y, hp: 1, maxHp: 1, eventIndex: 2 });
      else {
        ctx.fillStyle = '#251a25'; ctx.fillRect(s.x - 23, s.y - 33, 46, 33);
        ctx.fillStyle = '#9d6539'; ctx.fillRect(s.x - 20, s.y - 30, 40, 27);
        ctx.fillStyle = '#ffcf65'; ctx.fillRect(s.x - 20, s.y - 22, 40, 4); ctx.fillRect(s.x - 4, s.y - 24, 8, 10);
      }
      label(ctx, s.phase === 'between' ? 'Abrir el siguiente cofre' : G.Challenges.names[s.id], s.x, s.y - 65);
      const detail = s.phase === 'between' ? 'Salir en ' + Math.max(0, Math.ceil(6 - s.t)) + ' s' : 'Quédate 1,2 s para empezar · ' + Math.max(0, Math.ceil(20 - s.t)) + ' s';
      label(ctx, detail, s.x, s.y + 57, '#e6d3ea', 10);
      if (hold > 0) { ctx.save(); ctx.strokeStyle = '#f5c9ff'; ctx.lineWidth = 4; ctx.beginPath(); ctx.arc(s.x, s.y, 40, -Math.PI / 2, -Math.PI / 2 + TAU * Math.min(1, hold / 1.2)); ctx.stroke(); ctx.restore(); }
    } else if (s.phase !== 'transform') {
      const limit = s.id === 'house' ? 20 : s.id === 'rocket' ? 60 : s.id === 'ditto' ? 45 : s.phase === 'alpha' ? 8 : 15;
      const title = s.id === 'house' ? 'Oleada ' + s.stage + '/3' : G.Challenges.names[s.id];
      label(ctx, title + ' · ' + Math.max(0, Math.ceil(limit - s.t)) + ' s', G.Camera.x, G.Camera.top() + 64);
    }
  }
  return { color, negative, enemy, ground, event };
})();
