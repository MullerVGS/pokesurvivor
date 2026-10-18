/* Presentación de los jefes errantes y sus ataques. */
G.ChallengeArt = (() => {
  const anims = new Map(), TAU = Math.PI * 2;
  function sprite(ctx, dex, x, y, name = 'Idle', t = 0, dir = 0, scale = 1) {
    const key = dex + ':' + name;
    let a = anims.get(key);
    if (!a) { a = new G.Sprites.Animator(dex); anims.set(key, a); }
    a.scale = scale; a.loop(name); a.dir = dir; a.update(Math.max(0, t - (a.drawT || 0))); a.drawT = t;
    a.draw(ctx, x, y);
  }
  function label(ctx, text, x, y, col = '#fff2c8', size = 13) {
    ctx.save(); ctx.font = '700 ' + size + 'px system-ui, sans-serif'; ctx.textAlign = 'center';
    ctx.lineWidth = 4; ctx.strokeStyle = '#171322'; ctx.strokeText(text, x, y); ctx.fillStyle = col; ctx.fillText(text, x, y); ctx.restore();
  }
  function enemy(ctx, e) {
    if (!['alpha', 'ditto'].includes(e.eventRole)) return false;
    const s = G.Challenges.state;
    if (!s) return false;
    const transforming = s.phase === 'transform', t = s.t;
    if (e.dead && e.fade <= 0) return true;
    ctx.save(); if (e.dead) ctx.globalAlpha = Math.min(1, Math.max(0, e.fade / 0.5));
    G.Sprites.drawShadow(ctx, e.dex, e.x, e.y, e.scale);
    if (transforming) {
      const phase = Math.floor(t * (3 + t * 3)) % 2;
      if (phase === 0) sprite(ctx, 132, e.x, e.y, 'Idle', t, e.anim.dir, 1.5);
      else e.anim.draw(ctx, e.x, e.y, { flash: true });
      for (let i = 0; i < 10; i++) {
        const a = i * TAU / 10 + t * 2, r = 40 - t * 7;
        ctx.fillStyle = '#fff4ce'; ctx.fillRect(Math.round(e.x + Math.cos(a) * r), Math.round(e.y - e.bodyH / 2 + Math.sin(a) * r - t * 5), 3, 3);
      }
      label(ctx, '¡Ditto se está transformando!', e.x, e.y - e.bodyH - 28);
    } else e.anim.draw(ctx, e.x, e.y, { ditto: e.eventRole === 'ditto' && !!s.model, flash: e.flash > 0 });
    if (!e.dead && !transforming) {
      const color = s.phase === 'roam' ? '#e9dcad' : '#ffcc73', width = Math.max(90, e.r * 2);
      label(ctx, G.Challenges.names[s.id], e.x, e.y - e.bodyH - 24, color);
      if (s.phase === 'roam') label(ctx, 'Ataca para desafiarlo', e.x, e.y + 24, '#e9dcad', 10);
      else {
        ctx.fillStyle = '#241c20'; ctx.fillRect(e.x - width / 2 - 2, e.y - e.bodyH - 15, width + 4, 9);
        ctx.fillStyle = color; ctx.fillRect(e.x - width / 2, e.y - e.bodyH - 13, width * Math.max(0, e.hp / e.maxHp), 5);
      }
    }
    ctx.restore(); return true;
  }
  function dittoWarning(ctx, warning) {
    const m = warning.move, x = warning.x, y = warning.y;
    const color = G.U.TYPE_COLOR[m.type] || '#ffb566';
    const progress = 1 - warning.t / warning.duration;
    for (const zone of G.Combat.warningZones(m, x, y, warning.aim, warning.tx, warning.ty)) {
      G.Hazards.drawWarning(ctx, zone, progress);
    }
    const e = G.EnemyMgr.get(warning.enemy);
    label(ctx, m.name || G.Moves.BY_ID[m.id].name, e ? e.x : x, (e ? e.y - e.bodyH : y - 50) - 46, color, 11);
  }
  function ground(ctx, s, warning) {
    if (!s) return;
    if (warning) dittoWarning(ctx, warning);
    const a = s.attack;
    if (!a) return;
    if (a.t < a.wind) {
      for (const z of a.zones) G.Hazards.drawWarning(ctx, z, a.t / a.wind);
      if (a.id === 'stampede') label(ctx, 'Paso seguro', a.x, a.y, '#b4edac', 11);
    } else if (a.id === 'stampede') {
      const k = G.U.clamp((a.t - a.wind) / a.duration, 0, 1), ca = Math.cos(a.angle), sa = Math.sin(a.angle);
      for (const z of a.zones) {
        const count = Math.ceil(z.w / 48);
        for (let lane = 0; lane < count; lane++) for (let tail = 0; tail < 2; tail++) {
          const across = -z.w / 2 + (lane + 0.5) * z.w / count, along = k * z.len - tail * 45;
          const x = z.x + ca * along - sa * across, y = z.y + sa * along + ca * across;
          if (G.Camera.sees(x, y, 120)) sprite(ctx, 128, x, y, 'Walk', a.t, G.Sprites.dirFromAngle(a.angle), 1.25);
        }
      }
    } else if (a.id === 'stomp') {
      const z = a.zones[0], k = (a.t - a.wind) / a.duration;
      ctx.save(); ctx.strokeStyle = z.color; ctx.lineWidth = 6; ctx.globalAlpha = Math.max(0, 1 - k);
      ctx.beginPath(); ctx.ellipse(z.x, z.y, z.r * k, z.r * 0.75 * k, 0, 0, TAU); ctx.stroke(); ctx.restore();
    }
  }
  return { enemy, ground };
})();
