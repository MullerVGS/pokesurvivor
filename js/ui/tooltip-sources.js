/* ============ tooltip-sources.js — qué cuenta el popup de cada cosa ============
 * Una función por tipo de fuente (ver tooltip.js). Todo sale de los datos del
 * juego (moves.js, items.js, upgrades.js, levelup.js, types.js, weather.js,
 * achievements.js, pokedex.js); aquí sólo se ordena y se traduce.
 *
 *   move:<id>        movimiento del catálogo (números base y su escalera de mejoras)
 *   inst:<id>        tu movimiento en la partida (con su nivel y tus mejoras)
 *   slot:<i>         hueco del HUD (un movimiento o todos los de un vínculo)
 *   card:<clave>     carta de subir de nivel ('new:ember', 'up:ember', 'evo:ember', 'stat:hp'):
 *                    las de mejora enseñan cómo quedan los números
 *   stat:<id>        mejora de la run (cartas de LevelUp.STATS)
 *   item:<id>        objeto
 *   upg:<id>:<dex>   mejora permanente de la tienda, para ese Pokémon
 *   buff:<stat>      acumulaciones de un potenciador (HUD)
 *   power            poder de altar activo (HUD)
 *   wx:<clima>       clima
 *   type:<tipo>      tipo y su tabla
 *   ach:<id>[:x]     logro (con :x, sin tu progreso: el perfil de otro)
 *   mon:<dex>        Pokémon
 *   term:<id>        término del glosario (data/glossary.js)
 */
(() => {
  const S = G.Tooltip.source;
  const T = s => G.T(s), F = (...a) => G.I18n.f(...a);
  const en = G.I18n.lang === 'en';
  const num = (n, d = 1) => (+n).toLocaleString(en ? 'en-US' : 'es-ES', { maximumFractionDigits: d });
  const pct = k => num(k * 100, 0) + '%';
  const metres = px => num(px / 32, 1) + ' m';
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  const cap = s => s.charAt(0).toUpperCase() + s.slice(1);
  const orList = a => a.length > 1 ? a.slice(0, -1).join(', ') + (en ? ' or ' : ' o ') + a[a.length - 1] : a[0];
  /** Tu Pokémon, si hay partida. */
  const run = () => G.Game.state !== 'ui' ? G.Game.player : null;
  const typeChip = t => ({ text: T(G.U.TYPE_NAME[t]), color: G.U.TYPE_COLOR[t], tip: 'type:' + t });

  G.Glossary.add(
    { id: 'minimap', title: 'Minimapa', icon: 'ball', color: '#9fb1c9',
      desc: 'Lo que hay a tu alrededor, unas tres pantallas: tú en el centro, tus compañeros, los jefes y la grieta (con una flecha en el borde si están lejos), los altares (en gris si ya los has usado), los manantiales, los cofres con candado y los enemigos cercanos. El recuadro es lo que ves. Se quita con la tecla M o en Ajustes.' }
  );

  // ---------------- movimientos ----------------

  // Qué cuenta `count` y qué es `radius` en cada forma de ataque (moves.js).
  const COUNT = { projectile: 'Proyectiles', nova: 'Proyectiles', cone: 'Disparos', orbit: 'Orbes', boomerang: 'Bumeranes',
                  chain: 'Saltos', mine: 'Minas', meteor: 'Meteoros', turret: 'A la vez' };
  const RADIUS = { melee: 'Alcance', beam: 'Alcance', boomerang: 'Alcance', dash: 'Distancia', chain: 'Salto',
                   orbit: 'Radio', aura: 'Radio', mine: 'Radio', meteor: 'Radio', trail: 'Radio' };
  // Potenciadores: [signo, qué sube] por acumulación.
  const BUFF_FX = { atk: ['+', 'daño'], spd: ['+', 'velocidad'], def: ['-', 'daño recibido'] };
  const buffText = (stat, k) => stat === 'regen' ? '+' + num(k, 1) + ' ' + T('vida/s') : BUFF_FX[stat][0] + pct(k) + ' ' + T(BUFF_FX[stat][1]);

  /**
   * Números de un movimiento: [etiqueta, valor, término de la etiqueta, término del valor].
   * Con `pl`, los de verdad en la run (con tu ataque y tu recarga).
   */
  function moveStats(m, pl) {
    const out = [];
    const cd = num(m.cd * (pl ? pl.cdMul : 1), 2) + ' s';
    if (m.dmg) out.push([T('Daño'), num(m.dmg * (pl ? pl.atk : 1), 0)]);
    if (m.kind === 'aura') out.push([T('Golpea cada'), cd]);
    else if (m.kind !== 'orbit') out.push([T('Recarga'), cd, 'term:cd']);
    if (COUNT[m.kind] && m.count) out.push([T(COUNT[m.kind]), num(m.count, 0)]);
    if (m.pierce) out.push([T('Perforación'), '+' + num(m.pierce, 0), 'term:pierce']);
    if (RADIUS[m.kind] && m.radius) out.push([T(RADIUS[m.kind]), metres(m.radius)]);
    if (m.kind === 'cone') out.push([T('Alcance'), metres(m.speed * m.life)]);
    if (m.dur) out.push([T('Duración'), num(m.dur, 1) + ' s']);
    if (m.kind === 'buff') {
      out.push([T('Por acumulación'), buffText(m.stat, m.amount)]);
      out.push([T('Acumulaciones'), num(m.stacks, 0)]);
    }
    if (m.burn) out.push([T('Quema'), F('{x} por golpe', num(m.burn, 0)), 'term:burn']);
    if (m.poison) out.push([T('Envenena'), F('{x} por golpe', num(m.poison, 0)), 'term:poison']);
    if (m.slow) out.push([T('Frena'), pct(m.slow), 'term:slow']);
    return out;
  }

  /** Dos listas de números: "antes → después" en lo que cambia. */
  function compare(a, b) {
    const next = new Map(b.map(r => [r[0], r]));
    const rows = a.map(r => {
      const n = next.get(r[0]);
      next.delete(r[0]);
      return n && n[1] !== r[1] ? [r[0], { h: esc(r[1]) + ' <i class="tip-up">→ ' + esc(n[1]) + '</i>' }, r[2]] : r;
    });
    for (const r of next.values()) rows.push([r[0], { h: '<i class="tip-up">' + esc(r[1]) + '</i>' }, r[2]]);
    return rows;
  }

  /** @param m  movimiento del catálogo o instancia de la run · o: { pl, stats, short } (short: sin la evolución, dentro de un vínculo) */
  function move(m, o = {}) {
    const d = m.def || G.Moves.BY_ID[m.id] || m, pl = o.pl;
    const c = { title: T(m.name), icon: 'move:' + d.id, color: G.U.TYPE_COLOR[m.type], chips: [typeChip(m.type)] };
    if (m.lvl) c.chips.push({ text: F('Nv. {x} / {x}', m.lvl, d.maxLvl), color: '#eaf2ff' });
    if (m.evolved) c.chips.push({ text: T('Evolucionado'), color: '#ffd23f', tip: 'term:evo' });
    if (d.kind === 'buff') c.chips.push({ text: T('Potenciador'), color: '#5fe08a', tip: 'term:buff' });
    c.preview = { id: d.id, level: m.lvl || 1, evolved: !!m.evolved, dex: pl ? pl.dex : (G.DB.save?.partner || 25), atk: pl ? pl.atk : 1, cdMul: pl ? pl.cdMul : 1 };
    c.stats = o.stats || moveStats(m, pl);
    c.text = [T(d.desc)];
    if (m.evolved && m.baseName) c.text.push(F('Evolución de {x}.', T(m.baseName)));
    const e = G.Moves.EVO[d.id];
    const ev = e && !m.evolved && !o.short && G.Moves.evoInfo(Object.assign({}, d, { def: d, lvl: d.maxLvl }), null);
    const known = G.Progress.knowsEvolution(d.id);
    if (ev && known) {
      c.text.push(F('Evoluciona en {x} al nivel máximo si has cogido {x} en la run: {x}.', T(ev.name), T(ev.needName), T(ev.text)));
      if (pl && pl.statsTaken[ev.needs]) c.text.push(T('Ya has cogido la mejora que pide.'));
    }
    if (ev && !known) c.text.push(F('Para evolucionar: nivel máximo y {x} en la run.', T(ev.needName)));
    const next = m.lvl && G.Moves.nextUpText(m);
    if (next) c.foot = F('Siguiente nivel: {x}', T(next));
    if (!m.evolved) {
      c.list = d.ups.map((u, i) => i + 2 > (m.lvl || 1) ? {
        text: F('Nv. {x}: {x}', i + 2, T(u.t)), tip: 'movelevel:' + d.id + ':' + (i + 2)
      } : null).filter(Boolean);
      if (ev) c.list.push({ text: T('Evolución') + ': ' + (known ? T(ev.name) : '???'), tip: known ? 'movelevel:' + d.id + ':evo' : null });
    }
    return c;
  }

  const unknownEvolution = id => ({ title: T('Evolución') + ': ???', icon: 'move:' + id, color: '#ffd23f',
    text: [T('Evoluciona este movimiento para descubrirlo.')] });

  S('move', id => G.Moves.BY_ID[id] ? move(G.Moves.BY_ID[id]) : null);

  // Cada nivel abre otra tooltip: nunca modifica el movimiento de la partida.
  S('movelevel', arg => {
    const [id, value] = arg.split(':'), def = G.Moves.BY_ID[id];
    if (!def) return null;
    if (value === 'evo' && !G.Progress.knowsEvolution(id)) return unknownEvolution(id);
    const level = value === 'evo' ? def.maxLvl : +value;
    if (!Number.isInteger(level) || level < 1 || level > def.maxLvl) return null;
    const m = G.Moves.instance(id, level);
    if (value === 'evo' && !G.Moves.evolve(m)) return null;
    return move(m, { pl: run() });
  });

  S('inst', id => {
    const pl = run(), m = pl && pl.moves.find(x => x.id === id);
    return m ? move(m, { pl }) : null;
  });

  S('slot', i => {
    const pl = run(), g = pl && pl.slots[+i];
    if (!g || !g.length) return null;
    if (g.length === 1) return move(g[0], { pl });
    return { title: T('Vínculo'), icon: 'bond', color: '#ff8ad8',
             text: [F('{x} movimientos en un solo hueco: se lanzan a la vez, cada uno con su recarga.', g.length)],
             preview: { ...move(g[0], { pl }).preview, choices: g.map(m => move(m, { pl }).preview) },
             parts: g.map(m => move(m, { pl, short: true })) };
  });

  S('card', key => {
    const pl = run();
    const i = key.indexOf(':'), type = key.slice(0, i), id = key.slice(i + 1);
    if (!pl || i < 0) return null;
    if (type === 'stat') return stat(id);
    if (type === 'new') {
      if (!G.Moves.BY_ID[id]) return null;
      const c = move(G.Moves.BY_ID[id], { pl });
      c.chips.unshift({ text: T('Nuevo'), color: '#5fe08a' });
      return c;
    }
    const m = pl.moves.find(x => x.id === id);
    if (!m) return null;
    if (type === 'evo' && !G.Progress.knowsEvolution(id)) return unknownEvolution(id);
    let b;
    if (type === 'up') b = G.Moves.instance(id, m.lvl + 1);
    else if (type === 'evo') { b = Object.assign({}, m); G.Moves.evolve(b); }
    else return null;
    const c = move(m, { pl, stats: compare(moveStats(m, pl), moveStats(b, pl)) });
    c.preview.level = b.lvl; c.preview.evolved = !!b.evolved;
    c.chips.push({ text: type === 'evo' ? '→ ' + T(b.name) : F('Nv. {x} → {x}', m.lvl, m.lvl + 1), color: '#5fe08a' });
    return c;
  });

  // ---------------- mejoras, objetos y poderes ----------------

  function stat(id) {
    const s = G.LevelUp.STATS.find(x => x.id === id);
    if (!s) return null;
    const c = { title: T(s.title), icon: s.icon, color: '#eaf2ff', chips: [{ text: T('Mejora de la run'), color: '#9fb1c9' }], text: [T(s.desc)] };
    const pl = run();
    if (pl) {
      const n = (pl.statsTaken && pl.statsTaken[id]) || 0;
      c.stats = [[T('Veces'), s.max ? n + ' / ' + s.max : String(n)]];
      const waits = pl.moves.filter(m => { const e = G.Moves.EVO[m.id]; return e && e[1] === id && !m.evolved; });
      if (waits.length) c.text.push(F('La piden para evolucionar: {x}.', waits.map(m => T(m.name)).join(', ')));
    }
    return c;
  }
  S('stat', stat);

  S('item', id => {
    const it = G.Items.BY[id];
    if (!it) return null;
    const pl = run();
    const c = { title: T(it.name), icon: id, color: '#ffd23f', chips: [{ text: T('Objeto'), color: '#ffd23f', tip: 'term:item' }], text: [T(it.desc)] };
    if (pl && pl.item === id) c.chips.push({ text: T('Equipado'), color: '#5fe08a' });
    return c;
  });

  S('upg', arg => {
    const [id, dex] = arg.split(':');
    const u = G.Upgrades.BY[id], s = G.DB.save;
    if (!u) return null;
    // Sin G.DB.upgradesOf: aquí sólo se mira, no se crea nada en la partida guardada.
    const lv = (s && s.pupg && s.pupg[dex] && s.pupg[dex][id]) || 0;
    const c = { title: T(u.name), icon: u.icon, color: '#ffd23f', chips: [{ text: T('Mejora permanente'), color: '#ffd23f' }],
                text: [F('Cada nivel: {x}', T(u.unit))], stats: [[T('Nivel'), lv + ' / ' + u.max]] };
    if (lv < u.max) c.stats.push([T('Siguiente'), { h: '<span class="coin"></span> ' + G.Upgrades.cost(id, lv) }]);
    if (G.DEX_BY[+dex]) c.text.push(F('Sólo cuenta para {x}: cada Pokémon tiene sus mejoras.', G.DEX_BY[+dex].name));
    return c;
  });

  const BUFF = { atk: ['Ataque', 'fist', '#ff6b4d'], spd: ['Velocidad', 'boot', '#7fe0ff'],
                 def: ['Defensa', 'shield', '#b0b8c8'], regen: ['Regeneración', 'sprout', '#5fe08a'] };   // colores como en hud.js
  S('buff', k => {
    const pl = run(), b = pl && pl.buffs[k];
    if (!b || b.n <= 0 || !BUFF[k]) return null;
    const from = pl.moves.find(m => m.kind === 'buff' && m.stat === k);
    return { title: T(BUFF[k][0]), icon: BUFF[k][1], color: BUFF[k][2],
             chips: [{ text: T('Potenciador'), color: '#5fe08a', tip: 'term:buff' }],
             stats: [[T('Acumulaciones'), String(b.n)], [T('Total'), buffText(k, b.n * b.amount)], [T('Quedan'), num(b.t, 1) + ' s']],
             text: from ? [F('Lo acumula {x} mientras sea tu ataque activo.', T(from.name))] : [] };
  });

  S('power', () => {
    const pl = run(), pw = pl && pl.power;
    if (!pw) return null;
    return { title: T(pw.def.name), icon: 'star', color: pw.def.color,
             chips: [{ text: T('Poder de altar'), color: pw.def.color, tip: 'term:altar' }],
             stats: [[T('Efecto'), T(pw.def.desc)], [T('Quedan'), Math.ceil(pw.t) + ' s']] };
  });

  // ---------------- clima y tipos ----------------

  S('wx', k => {
    const d = G.Weather.KINDS[k];
    if (!d) return null;
    const c = { title: T(d.name), icon: d.icon, color: d.color, chips: [{ text: T('Clima'), color: d.color, tip: 'term:weather' }],
                stats: Object.entries(d.mult).map(([t, v]) => [T(G.U.TYPE_NAME[t]), '×' + num(v, 1), 'type:' + t]),
                text: [cap(T(d.hint)) + '.', T('Cuenta para tus ataques y para los de los enemigos.')] };
    if (d.safe) c.text.push(F('Los Pokémon que no son de tipo {x} pierden un poco de vida.', orList(d.safe.map(t => T(G.U.TYPE_NAME[t])))));
    if (d.slow) c.text.push(T('Los que no son de tipo Hielo van un 10% más lentos.'));
    const cur = G.Weather.current;
    if (cur && cur.kind === k) c.foot = F('Quedan {x} s', Math.ceil(cur.left));
    return c;
  });

  S('type', t => {
    if (!G.U.TYPE_NAME[t]) return null;
    const CH = G.Types.CHART, all = Object.keys(G.U.TYPE_NAME);
    const names = ts => ts.map(x => T(G.U.TYPE_NAME[x])).join(', ');
    const hits = v => all.filter(d => CH[t] && CH[t][d] === v);         // atacando
    const takes = v => all.filter(a => CH[a] && CH[a][t] === v);        // defendiendo
    const list = [];
    for (const [txt, ts] of [['Golpea fuerte (×1,6) a: {x}', hits(2)], ['Golpea poco (×0,6) a: {x}', hits(0.5)],
                             ['Casi no hace daño (×0,3) a: {x}', hits(0)], ['Le golpean fuerte: {x}', takes(2)],
                             ['Le golpean poco: {x}', takes(0.5)], ['Casi no le hacen daño: {x}', takes(0)]]) {
      if (ts.length) list.push(F(txt, names(ts)));
    }
    const wx = Object.values(G.Weather.KINDS).filter(d => d.mult[t]).map(d => T(d.name) + ' ×' + num(d.mult[t], 1));
    if (wx.length) list.push(F('Clima: {x}', wx.join(', ')));
    return { title: T(G.U.TYPE_NAME[t]), icon: 'type:' + t, color: G.U.TYPE_COLOR[t], list,
             foot: T('Con dos tipos se multiplican, como mucho ×2,4. Cuenta para tus ataques y para los de los enemigos.') };
  });

  // ---------------- menús ----------------

  const MEDAL = ['', 'Bronce', 'Plata', 'Oro'], MEDAL_COL = ['', '#e0a070', '#c9d6ff', '#ffd23f'];
  S('ach', arg => {
    const [id, other] = arg.split(':');
    const a = G.AchDefs.BY[id], s = !other && G.DB.save;
    if (!a) return null;
    const ok = !!(s && s.ach && s.ach[a.id]);
    const c = { title: T(a.name), icon: 'medal' + a.tier, color: MEDAL_COL[a.tier],
                chips: [{ text: T(MEDAL[a.tier]), color: MEDAL_COL[a.tier] }], text: [T(a.desc)], stats: [] };
    if (s) c.stats.push([T('Progreso'), ok ? T('¡Conseguido!') : num(Math.min(a.goal, a.value(s)), 0) + ' / ' + num(a.goal, 0)]);
    c.stats.push([T('Premio'), { h: G.Progress.rewardText(a.reward) }]);
    if (a.title) c.stats.push([T('Título'), T(a.title)]);
    return c;
  });

  S('mon', dex => {
    const p = G.DEX_BY[+dex];
    if (!p) return null;
    const s = G.DB.save, start = G.startMoveOf(p.dex);
    const c = { title: p.name, icon: 'type:' + p.types[0], color: G.U.TYPE_COLOR[p.types[0]],
                chips: p.types.map(typeChip).concat([{ text: T(G.Gacha.RARITY_NAME[p.rarity]), color: G.Gacha.RARITY_COLOR[p.rarity] }]),
                stats: [[T('Vida'), num(p.hp, 0)], [T('Ataque'), '×' + num(p.atk, 2)], [T('Velocidad'), num(p.spd, 0)],
                        [T('Empieza con'), T(G.Moves.BY_ID[start].name), null, 'move:' + start]],
                text: [F('Puede aprender {x} movimientos.', G.Moves.poolFor(p).length)] };
    if (s && !s.owned[p.dex]) c.text.push(T('Aún no lo tienes.'));
    else if (s && s.shiny && s.shiny[p.dex]) c.chips.push({ text: T('Shiny'), color: '#9ae6ff' });
    return c;
  });

  S('term', id => {
    const t = G.Glossary.byId(id);
    if (!t) return null;
    return { title: T(t.title), icon: t.icon, color: t.color, text: [T(t.desc)].concat(t.more ? t.more() : []) };
  });
})();
