/* FRLG battle panels. One dock geometry for drawing, touch, minimap and editor. */
G.BattlePanels = (() => {
  const ink = '#384838', paper = '#f8f8d8', edge = '#586848';
  const healthScale = 1.15;
  const counts = new Intl.NumberFormat(G.I18n.lang), compactCounts = new Intl.NumberFormat(G.I18n.lang, { notation: 'compact', maximumFractionDigits: 1 });
  const font = size => `400 ${size}px PokemonGen3,"Segoe UI",sans-serif`;
  const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
  function text(ctx, value, x, y, width, size = 20, color = ink) {
    ctx.font = font(size); ctx.textAlign = 'left'; ctx.fillStyle = color;
    let label = String(value);
    if (ctx.measureText(label).width > width) {
      while (label.length && ctx.measureText(label + '…').width > width) label = label.slice(0, -1);
      label += '…';
    }
    ctx.fillText(label, x, y);
  }
  function outline(ctx, x, y, w, h, color) {
    ctx.fillStyle = color;
    ctx.beginPath(); ctx.moveTo(x + 8, y); ctx.lineTo(x + w - 4, y);
    ctx.lineTo(x + w, y + 4); ctx.lineTo(x + w, y + h - 8);
    ctx.lineTo(x + w - 8, y + h); ctx.lineTo(x + 4, y + h);
    ctx.lineTo(x, y + h - 4); ctx.lineTo(x, y + 8); ctx.closePath(); ctx.fill();
  }
  function healthLayout(w, h, count = 0) {
    const compact = h < 520, left = 12 + (G.Touch.active ? Math.min(44, G.Touch.safeArea().left) : 0);
    const width = Math.min(compact ? 224 : 252, w - 160);
    const player = { x: left, y: 12, w: Math.max(174, width) * healthScale, h: (compact ? 56 : 66) * healthScale };
    const allyH = (compact ? 38 : 50) * healthScale;
    const allies = Array.from({ length: count }, (_, i) => ({ x: left + 8, y: player.y + player.h + (compact ? 18 : 20) + i * (allyH + (compact ? 1 : 4)), w: player.w - 8 * healthScale, h: allyH }));
    return { player, allies, buffsY: player.y + player.h + 3 };
  }
  function health(ctx, rect, pl, mate) {
    const x = 0, y = 0, w = rect.w / healthScale, h = rect.h / healthScale;
    ctx.save(); ctx.textBaseline = 'alphabetic';
    ctx.translate(rect.x, rect.y); ctx.scale(healthScale, healthScale);
    outline(ctx, x + 5, y + 5, w + 8, h, '#28484099');
    outline(ctx, x, y, w, h, edge);
    outline(ctx, x + 2, y + 2, w - 4, h - 4, '#b8c080');
    outline(ctx, x + 4, y + 4, w - 8, h - 8, paper);
    const hp = pl.dead ? 0 : clamp(pl.hp / pl.maxHp, 0, 1);
    const color = hp > 0.5 ? ['#38b878', '#70e8a0'] : hp > 0.2 ? ['#d8a030', '#f8d858'] : ['#d85040', '#f88068'];
    text(ctx, pl.mon.name.toUpperCase(), x + 12, y + 20, w - 82, 20);
    ctx.font = font(18); ctx.textAlign = 'right'; ctx.fillStyle = pl.dead ? '#b83830' : ink;
    ctx.fillText(pl.dead ? G.T('CAÍDO') : G.T('Nv.') + pl.level, x + w - 10, y + 20);
    const by = y + (mate ? h - 17 : 28), bx = x + (mate ? 96 : 40), bw = w - (mate ? 108 : 52);
    if (mate) {
      ctx.fillStyle = mate.color; ctx.fillRect(x + 10, by + 1, 3, 10);
      text(ctx, mate.name, x + 17, by + 10, 52, 14);
    }
    text(ctx, 'HP', bx - 24, by + 10, 24, 16, '#d87840');
    outline(ctx, bx, by, bw, 12, edge);
    ctx.fillStyle = '#f8f8f0'; ctx.fillRect(bx + 3, by + 2, bw - 6, 8);
    ctx.fillStyle = '#586858'; ctx.fillRect(bx + 4, by + 3, bw - 8, 6);
    const fill = Math.round((bw - 8) * hp);
    ctx.fillStyle = color[0]; ctx.fillRect(bx + 4, by + 3, fill, 6);
    ctx.fillStyle = color[1]; ctx.fillRect(bx + 4, by + 3, fill, 2);
    if (!mate) {
      const ey = y + h - 12;
      text(ctx, 'EXP', x + 12, ey + 5, 26, 12, '#587880');
      ctx.fillStyle = '#b0c0b0'; ctx.fillRect(x + 40, ey, w - 140, 5);
      ctx.fillStyle = '#5098d0'; ctx.fillRect(x + 40, ey, Math.round((w - 140) * clamp(pl.xp / pl.xpNext, 0, 1)), 5);
      ctx.font = font(16); ctx.textAlign = 'right'; ctx.fillStyle = ink;
      ctx.fillText(Math.max(0, Math.ceil(pl.hp)) + '/' + Math.round(pl.maxHp), x + w - 10, ey + 5);
    } else if (pl.dead && pl.reviveT > 0) {
      ctx.fillStyle = '#5098d0'; ctx.fillRect(x + 8, y + h - 4, Math.round((w - 16) * clamp(pl.reviveT / G.Player.REVIVE_TIME, 0, 1)), 2);
    }
    ctx.restore();
  }
  function pauseLayout(w, h) {
    if (!G.Touch.active) return null;
    const safe = G.Touch.safeArea(), p = G.Touch.spot('pause');
    return { x: p ? clamp(p[0] * w - 20, 4, w - 44) : w - 52 - Math.min(44, safe.right), y: p ? clamp(p[1] * h - 20, 10, h - 44) : 12 + Math.min(20, safe.top), w: 40, h: 40 };
  }
  function topLayout(w, h, status, weather, boss) {
    const safe = G.Touch.active ? G.Touch.safeArea() : { top: 0, right: 0 };
    const left = status.player.x + status.player.w + 16, right = w - 12 - Math.min(44, safe.right);
    const width = Math.min(260, right - left), narrow = width < 220, pause = pauseLayout(w, h);
    const clearPause = r => {
      if (pause && r.x < pause.x + pause.w + 6 && r.x + r.w + 6 > pause.x && r.y < pause.y + pause.h + 6 && r.y + r.h + 6 > pause.y) r.y = pause.y + pause.h + 10;
      return r;
    };
    const summary = clearPause({ x: Math.round(clamp(w / 2 - width / 2, left, right - width)), y: 12 + Math.min(20, safe.top), w: Math.floor(width), h: narrow ? 118 : 76, narrow });
    const climate = weather ? clearPause({ x: summary.x, y: summary.y + summary.h + 8, w: summary.w, h: narrow ? 44 : 28, narrow }) : null;
    let bossBar = null;
    if (boss) {
      const last = climate || summary, team = status.allies.at(-1) || status.player;
      const besideTeam = right - left >= 220, bw = Math.min(420, besideTeam ? right - left : right - status.player.x);
      bossBar = clearPause({ x: Math.round(clamp((w - bw) / 2, besideTeam ? left : status.player.x, right - bw)), y: Math.max(last.y + last.h, besideTeam ? 0 : team.y + team.h + 6) + 10, w: Math.floor(bw), h: 22 });
    }
    return { summary, weather: climate, boss: bossBar, pause };
  }
  function biomeLines(ctx, value, width) {
    ctx.font = font(16);
    const words = value.split(' '), lines = [''];
    for (const word of words) {
      const i = lines.length - 1, next = lines[i] ? lines[i] + ' ' + word : word;
      if (ctx.measureText(next).width > width && i === 0 && lines[i]) lines.push(word);
      else lines[i] = next;
    }
    return lines;
  }
  function summary(ctx, r, pl, st) {
    ctx.save(); ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = 'rgb(248 248 216 / .85)'; ctx.fillRect(r.x, r.y, r.w, r.h);
    ctx.strokeStyle = edge; ctx.lineWidth = 2; ctx.strokeRect(r.x + 1, r.y + 1, r.w - 2, r.h - 2);
    ctx.strokeStyle = '#b8c080'; ctx.strokeRect(r.x + 3, r.y + 3, r.w - 6, r.h - 6);
    const biome = G.T(G.World.biomeName()).toUpperCase(), time = G.U.mmss(st.time);
    const lines = biomeLines(ctx, biome, r.narrow ? r.w - 12 : r.w - 120);
    if (r.narrow) {
      ctx.font = font(30); ctx.fillStyle = ink; ctx.textAlign = 'center'; ctx.fillText(time, r.x + r.w / 2, r.y + 29, r.w - 12);
      lines.forEach((line, i) => text(ctx, line, r.x + 6, r.y + 49 + i * 16, r.w - 12, 16));
    } else {
      text(ctx, time, r.x + 12, r.y + 33, 96, 34);
      lines.forEach((line, i) => text(ctx, line, r.x + 110, r.y + 26 + i * 16, r.w - 122, 16));
    }
    const values = [['fist', pl.kills], ['coin', pl.coins]];
    values.forEach(([icon, value], i) => {
      const x = r.x + (r.narrow ? 8 : 12 + i * r.w / 2), y = r.y + (r.narrow ? 74 + i * 20 : 50), size = r.narrow ? 16 : 20;
      G.Icons.draw(ctx, icon, x, y, size);
      const width = r.narrow ? r.w - 37 : r.w / 2 - 42, number = Math.max(0, Math.floor(value));
      ctx.font = font(r.narrow ? 18 : 20); ctx.textAlign = 'left'; ctx.fillStyle = ink;
      let label = counts.format(number);
      if (ctx.measureText(label).width > width) label = compactCounts.format(number);
      ctx.fillText(label, x + size + 5, y + size - 2, width);
    });
    ctx.restore();
  }
  function dockLayout(w, h, options = {}) {
    const touch = options.touch ?? G.Touch.active, safe = touch ? G.Touch.safeArea() : { left: 0, right: 0, bottom: 0 };
    const position = options.position === undefined ? touch && G.Touch.spot('bar') : options.position;
    const compact = w < 760 || h < 480, size = Math.min(52, Math.floor((w - 48 - safe.left - safe.right) / 5));
    const width = compact ? size * 5 + 24 : Math.min(500, w - (touch && w >= 600 ? 180 : 24) - safe.left - safe.right);
    const rowH = h < 520 ? 56 : 62, height = compact ? size + 30 : rowH * 2 + 18, offset = compact ? size + 6 : 58;
    const left = 8 + Math.min(44, safe.left), right = w - 8 - Math.min(44, safe.right) - width;
    const bottom = h - height - (h < 520 ? 8 : 18) - Math.min(28, safe.bottom);
    const y = Math.round(position ? clamp(position[1] * h - height / 2, 12, Math.min(bottom + 10, h - height - 4 - Math.min(28, safe.bottom))) : bottom);
    let defaultLeft = left;
    if (touch && G.Settings.get('stickMode') === 'fixed') {
      const stick = G.Touch.stickBase(w, h), r = G.Touch.R();
      if (stick.x < w / 2 && y < stick.y + r && y + height > stick.y - r) defaultLeft = Math.min(right, Math.max(left, stick.x + r + 12));
    }
    // Center the move grid; keep saved touch positions and room for a fixed stick.
    const x = Math.round(position ? clamp(position[0] * w - width / 2, left, right) : clamp((w - width - offset) / 2, defaultLeft, right));
    if (compact) {
      const rowY = y + 30;
      return { compact, x, y, w: width, h: height, panel: { x: x + offset, y: rowY, w: width - offset, h: size }, item: { x, y: rowY, w: size, h: size }, bond: { x: x + (size - 24) / 2, y, w: 32, h: 28 }, slots: Array.from({ length: 4 }, (_, i) => ({ x: x + (i + 1) * offset, y: rowY, w: size, h: size })) };
    }
    const panel = { x: x + 58, y, w: width - 58, h: height };
    const cellW = (panel.w - 18) / 2;
    const slots = Array.from({ length: 4 }, (_, i) => ({ x: panel.x + 6 + i % 2 * (cellW + 6), y: y + 6 + Math.floor(i / 2) * (rowH + 6), w: cellW, h: rowH }));
    return { x, y, w: width, h: height, panel, slots, item: { x, y: y + height - 50, w: 50, h: 50 }, bond: { x: x + 8, y: y + height - 86, w: 32, h: 28 } };
  }
  function moveCard(ctx, rect, group, active, index, pl) {
    const { x, y, w, h } = rect, move = group?.[0], fused = group?.length > 1;
    ctx.save();
    ctx.save(); ctx.globalAlpha *= active && move ? 0.85 : 0.8;
    ctx.fillStyle = active && move ? '#fff8dc' : '#f0f8f0'; ctx.fillRect(x, y, w, h);
    ctx.restore();
    ctx.strokeStyle = active && move ? '#d85038' : '#98b8a0'; ctx.lineWidth = active && move ? 2 : 1; ctx.strokeRect(x + 1, y + 1, w - 2, h - 2);
    if (!move) { text(ctx, '—', x + 12, y + 36, w - 24); ctx.restore(); return; }
    G.TypeIcons.drawBadge(ctx, move.type, x + 5, y + 5);
    ctx.font = font(16); ctx.textAlign = 'right'; ctx.fillStyle = active ? '#b83830' : '#687868';
    ctx.fillText(String(index + 1), x + w - 7, y + 17);
    G.Icons.draw(ctx, 'move:' + move.id, x + 7, y + 21, 18);
    text(ctx, G.T(move.name).toUpperCase() + (fused ? ' +' + (group.length - 1) : ''), x + 30, y + 36, w - 37, w < 170 ? 18 : 20);
    const remaining = m => m.kind === 'orbit' ? 0 : Math.max(0, m.t || 0);
    if (fused) {
      group.forEach((m, i) => {
        const ix = x + 8 + i * 18, iy = y + h - 17;
        G.Icons.draw(ctx, 'move:' + m.id, ix, iy, 12);
        ctx.fillStyle = '#30483888'; ctx.fillRect(ix, iy, 12, 12 * clamp(remaining(m) / Math.max(0.12, m.cd * pl.cdMul), 0, 1));
      });
      text(ctx, G.T('Vínculo') + ' ×' + group.length, x + 86, y + h - 8, w - 92, 14, '#985078');
    } else {
      text(ctx, G.T('Nv.') + move.lvl + (move.evolved ? ' ★' : ''), x + 8, y + h - 9, 55, 14, move.evolved ? '#986820' : '#586858');
      ctx.font = font(16); ctx.textAlign = 'right'; ctx.fillStyle = ink;
      ctx.fillText(remaining(move) > 0 ? 'CD ' + remaining(move).toFixed(1) + 's' : G.T('Listo'), x + w - 8, y + h - 9);
    }
    const fraction = Math.max(...group.map(m => clamp(remaining(m) / Math.max(0.12, m.cd * pl.cdMul), 0, 1)));
    ctx.fillStyle = '#b0d0c0'; ctx.fillRect(x + 5, y + h - 4, w - 10, 2);
    ctx.fillStyle = fused ? '#b07098' : '#5098a8'; ctx.fillRect(x + 5, y + h - 4, (w - 10) * (1 - fraction), 2);
    ctx.restore();
  }
  function moveIcon(ctx, r, group, active, index, pl) {
    ctx.save(); ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = active && group?.length ? 'rgb(255 248 220 / .85)' : 'rgb(240 248 240 / .8)'; ctx.fillRect(r.x, r.y, r.w, r.h);
    ctx.strokeStyle = active && group?.length ? '#d85038' : '#98b8a0'; ctx.lineWidth = 2; ctx.strokeRect(r.x + 1, r.y + 1, r.w - 2, r.h - 2);
    const remaining = m => m.kind === 'orbit' ? 0 : Math.max(0, m.t || 0);
    if (group?.length) {
      const fused = group.length > 1;
      group.forEach((move, i) => {
        const size = fused ? 16 : 28, x = r.x + (fused ? 6 + i % 2 * 20 : (r.w - size) / 2), y = r.y + (fused ? 4 + Math.floor(i / 2) * 18 : 6);
        G.Icons.draw(ctx, 'move:' + move.id, x, y, size);
        if (fused) { ctx.fillStyle = '#30483888'; ctx.fillRect(x, y, size, size * clamp(remaining(move) / Math.max(.12, move.cd * pl.cdMul), 0, 1)); }
      });
      const seconds = Math.max(...group.map(remaining)), fraction = Math.max(...group.map(m => clamp(remaining(m) / Math.max(.12, m.cd * pl.cdMul), 0, 1)));
      if (fused) text(ctx, '×' + group.length, r.x + 5, r.y + r.h - 7, 16, 14, '#985078');
      ctx.font = font(14); ctx.textAlign = 'right'; ctx.fillStyle = ink;
      ctx.fillText(seconds > 0 ? seconds.toFixed(1) + 's' : fused ? G.T('Listo') : G.T('Nv.') + group[0].lvl + (group[0].evolved ? '★' : ''), r.x + r.w - 5, r.y + r.h - 7);
      ctx.fillStyle = '#b0d0c0'; ctx.fillRect(r.x + 4, r.y + r.h - 4, r.w - 8, 2);
      ctx.fillStyle = fused ? '#b07098' : '#5098a8'; ctx.fillRect(r.x + 4, r.y + r.h - 4, (r.w - 8) * (1 - fraction), 2);
    } else text(ctx, '—', r.x + 18, r.y + 33, r.w - 22);
    ctx.font = font(14); ctx.textAlign = 'right'; ctx.fillStyle = active ? '#b83830' : '#687868'; ctx.fillText(String(index + 1), r.x + r.w - 4, r.y + 12);
    ctx.restore();
  }
  function dock(ctx, layout, pl, interactive = true) {
    const p = layout.panel;
    ctx.save();
    // Leave holes under the cards so translucent fills do not stack.
    if (!layout.compact) {
      ctx.save(); ctx.globalAlpha *= 0.8;
      ctx.strokeStyle = edge; ctx.lineWidth = 2; ctx.strokeRect(p.x - 1, p.y - 1, p.w + 2, p.h + 2);
      ctx.beginPath(); ctx.rect(p.x, p.y, p.w, p.h);
      layout.slots.forEach(r => ctx.rect(r.x, r.y, r.w, r.h));
      ctx.fillStyle = '#b8e8d0'; ctx.fill('evenodd');
      ctx.restore();
    }
    layout.slots.forEach((r, i) => {
      const group = pl.slots[i];
      (layout.compact ? moveIcon : moveCard)(ctx, r, group, i === pl.active, i, pl);
      if (interactive && group?.length) {
        G.Touch.addButton(r.x, r.y, r.w, r.h, () => { if (G.Game.state === 'playing') pl.setActive(i); }, 2);
        G.Tooltip.zone(r.x, r.y, r.w, r.h, 'slot:' + i);
      }
    });
    const item = layout.item;
    ctx.save(); ctx.globalAlpha *= 0.85;
    outline(ctx, item.x + 1, item.y + 1, item.w - 2, item.h - 2, paper);
    ctx.restore();
    ctx.strokeStyle = edge; ctx.lineWidth = 2; ctx.stroke();
    if (pl.item) {
      G.Icons.draw(ctx, pl.item, item.x + (item.w - 32) / 2, item.y + (item.h - 32) / 2, 32);
      if (interactive) G.Tooltip.zone(item.x, item.y, item.w, item.h, 'item:' + pl.item);
    } else text(ctx, '—', item.x + 16, item.y + 31, 30);
    if (pl.bonds > 0) {
      const b = layout.bond;
      G.Icons.draw(ctx, 'bond', b.x, b.y, 24);
      if (pl.bonds > 1) text(ctx, String(pl.bonds), b.x + 23, b.y + 23, 20, 16, '#ffb0e0');
      if (interactive) G.Tooltip.zone(b.x, b.y, b.w, b.h, 'term:bond');
    }
    ctx.restore();
  }
  return { healthLayout, health, pauseLayout, topLayout, summary, dockLayout, dock };
})();
