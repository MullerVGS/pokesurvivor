/* ============ tooltip-world.js — popup de información de lo que hay en el mapa ============
 * Pasar el ratón por algo del mundo, en la partida, abre el popup de tooltip.js
 * con lo que hace y su estado (T lo fija, como en el HUD). Lo que hay debajo
 * del ratón se busca en este orden:
 *
 *   foe:<id>          enemigo o jefe: tipo, vida, comportamiento, estados y cómo
 *                     le van tus ataques activos (y los suyos a ti)
 *   mate:<uid>        compañero del cooperativo
 *   poi:<tx>,<ty>     altar, manantial, cofre con candado o trampa (interact.js)
 *   rift              la grieta (rift.js)
 *   pick:<id>         lo que hay en el suelo (pickup.js)
 *   hz:<x>,<y>,<k>    ataque con aviso de un enemigo (hazards.js)
 *   prop:<tipo>[:tx,ty]  árbol, roca, cofre, hierba alta (world.js)
 *   ter:wall | ter:liquid   pared y agua/lava/... del bioma
 *
 * Coste: la búsqueda sale como mucho cada EVERY ms (aunque el ratón mande cien
 * eventos por segundo) y mira sólo alrededor del ratón: la rejilla de enemigos,
 * los objetos visibles y lo del suelo. Como el mundo se mueve con el ratón
 * quieto, cada EVERY ms se vuelve a mirar (Tooltip.recheck); con el ratón
 * parado más de IDLE ms no se abre nada nuevo (el que hay sigue mientras su
 * cosa siga debajo), para no ir abriendo popups al andar con el teclado.
 * Encima de la franja de arriba del HUD (vida, reloj, barra del jefe) no se mira.
 *
 * Móvil: el joystick flotante nace donde pones el dedo, así que un toque largo
 * en el mundo es pararse, no preguntar: no abre nada. Con el joystick fijo
 * (Ajustes > Controles) el toque largo lejos de él abre el popup ya fijado.
 * Cooperativo: todo es local; quien no es anfitrión ve sus copias (vida y
 * estados de los enemigos llegan del anfitrión).
 */
(() => {
  const EVERY = 100, IDLE = 1500, PAD = 10, TOP = 64, TOP_BOSS = 88;
  const S = G.Tooltip.source;
  const T = s => G.T(s), F = (...a) => G.I18n.f(...a);
  const en = G.I18n.lang === 'en';
  const num = (n, d = 1) => (+n).toLocaleString(en ? 'en-US' : 'es-ES', { maximumFractionDigits: d });
  const pct = k => num(k * 100, 0) + '%';
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  const orList = a => a.length > 1 ? a.slice(0, -1).join(', ') + (en ? ' or ' : ' o ') + a[a.length - 1] : a[0];
  const typeChip = t => ({ text: T(G.U.TYPE_NAME[t]), color: G.U.TYPE_COLOR[t], tip: 'type:' + t });
  const typeList = ts => orList(ts.map(t => T(G.U.TYPE_NAME[t])));
  const playing = () => G.Game.state === 'playing' && !G.Judgment.cinematic && G.Game.player;
  const run = () => playing() ? G.Game.player : null;

  // ---------------- glosario ----------------

  G.Glossary.add(
    { id: 'spring', es: /manantial(?:es)?/i, en: /springs?/i, title: 'Manantial', icon: 'heart', color: '#7dffb0',
      desc: 'Charco que te cura mientras estás encima. Se va gastando y se recarga solo con el tiempo.' },
    { id: 'bigchest', es: /cofres? con candado/i, en: /locked chests?/i, title: 'Cofre con candado', icon: 'coin', color: '#ffd23f',
      desc: 'Quédate a su lado unos segundos, aunque te ataquen, y se abre: monedas, tickets, a veces un objeto y experiencia para subir un nivel.' },
    { id: 'trap', es: /trampas?/i, en: /traps?/i, title: 'Trampa', icon: 'bomb', color: '#ff7b3d',
      desc: 'Salta al pisarla, tú o un enemigo que camine, y alcanza a todo lo que tiene cerca. Las hay de veneno, pegajosas y explosivas.' },
    { id: 'boss', es: /jefes?/i, en: /boss(?:es)?/i, title: 'Jefe', icon: 'crown', color: '#ffcb3d',
      desc: 'Pokémon fuerte que llega cada pocos minutos, con su barra de vida arriba. Tiene cuatro ataques propios, todos con aviso en el suelo, y por debajo de la mitad de vida se enfurece. Al caer suelta un objeto, monedas y mucha experiencia.' },
    { id: 'shield', es: /escudos?/i, en: /shields?/i, title: 'Escudo', icon: 'shield', color: '#9fd8ff',
      desc: 'Burbuja azul que ponen los Pokémon de apoyo a sus compañeros: se come el daño hasta romperse. Ve primero a por quien los pone.' },
    { id: 'minimap', title: 'Minimapa', icon: 'ball', color: '#9fb1c9',
      desc: 'Lo que hay a tu alrededor, unas tres pantallas: tú en el centro, tus compañeros, los jefes y la grieta (con una flecha en el borde si están lejos), los altares (en gris si ya los has usado), los manantiales, los cofres con candado y los enemigos cercanos. El recuadro es lo que ves. Se quita con la tecla M o en Ajustes.' }
  );

  // ---------------- enemigos y compañeros ----------------

  const BEH = {
    chase: 'Va directo a por ti.',
    charger: 'Se para, apunta y embiste: apártate de su línea.',
    ranged: 'Se queda a distancia y dispara. Las paredes y los árboles te cubren.',
    tank: 'Lento, pero con mucha vida y golpes fuertes.',
    healer: 'Apoyo: cura a los de alrededor. Ve a por él primero.',
    shielder: 'Apoyo: pone escudos a sus compañeros. Ve a por él primero.',
    summoner: 'Apoyo: llama a su manada. Ve a por él primero.',
    bomber: 'Se acerca y explota a tu lado: aléjate en cuanto se pare.',
    beamer: 'Dispara un rayo que antes se ve en el suelo.',
    zoner: 'Pone bajo tus pies zonas que estallan al poco.',
    fan: 'Dispara en abanico.',
    jumper: 'Salta y cae sobre ti: la caída se ve antes en el suelo.',
    runner: 'Corredor: muy rápido y frágil. Va a donde vas a estar.'
  };

  /** "×1,6 muy eficaz" en verde/rojo. `good`: si subir es bueno para ti. */
  function multHtml(m, good, extra) {
    const lbl = G.Types.label(m);
    const cls = !lbl ? '' : (lbl === 'super') === good ? 'tip-up' : 'tip-down';
    const txt = '×' + num(m, 1) + (lbl ? ' ' + T(lbl === 'super' ? 'muy eficaz' : 'poco eficaz') : '');
    return { h: (cls ? `<i class="${cls}">${esc(txt)}</i>` : esc(txt)) + (extra ? ' <i class="tip-foot">' + esc(extra) + '</i>' : '') };
  }

  S('foe', id => {
    const e = G.EnemyMgr.get(+id), pl = run();
    if (!e || e.dead || !pl) return null;
    const st = e.net ? e.net.st : 0;
    // Dorado como lo pinta enemy.js (el duende del tesoro brilla igual, pero tiene su texto).
    const gold = e.behavior !== 'thief' && (e.golden || (e.remote && !e.boss && G.Events.golden));
    const c = { title: e.name, icon: 'type:' + e.types[0], color: e.boss ? '#ffcb3d' : G.U.TYPE_COLOR[e.types[0]],
                chips: e.types.map(typeChip), stats: [], text: [] };
    if (e.legend || e.judge) c.chips.push({ text: T('Legendario'), color: '#b48aff', tip: e.legend ? 'term:rift' : null });
    else if (e.boss) c.chips.push({ text: T('Jefe'), color: '#ffcb3d', tip: 'term:boss' });
    if (e.ai && e.ai.fury) c.chips.push({ text: T('Enfurecido'), color: '#ff5f6d' });
    if (e.shiny) c.chips.push({ text: T('Shiny'), color: '#9ae6ff' });
    if (gold) c.chips.push({ text: T('Dorado'), color: '#ffd23f' });
    if (e.burn > 0 || st & 1) c.chips.push({ text: T('Quemado'), color: '#ff9a4d', tip: 'term:burn' });
    if (e.poison > 0 || st & 2) c.chips.push({ text: T('Envenenado'), color: '#d47cf0', tip: 'term:poison' });
    if (e.slowT > 0) c.chips.push({ text: T('Frenado'), color: '#7fe0ff', tip: 'term:slow' });

    c.stats.push([T('Vida'), num(Math.ceil(e.hp), 0) + ' / ' + num(e.maxHp, 0)]);
    if (e.shield > 0) c.stats.push([T('Escudo'), num(Math.ceil(e.shield), 0), 'term:shield']);
    else if (st & 4) c.stats.push([T('Escudo'), T('Sí'), 'term:shield']);
    // Tus ataques activos contra él (con el clima) y los suyos contra ti.
    const seen = new Set();
    for (const m of pl.activeGroup()) {
      if (!m.dmg || m.kind === 'buff' || seen.has(m.type)) continue;
      seen.add(m.type);
      const wx = G.Weather.mult(m.type);
      c.stats.push([T(m.name), multHtml(G.Types.mult(m.type, e.types), true, wx !== 1 ? F('clima ×{x}', num(wx, 1)) : ''), 'inst:' + m.id]);
    }
    c.stats.push([T('Sus golpes a ti'), multHtml(G.Types.mult(e.atkType, pl.mon.types), false)]);

    if (e.behavior === 'thief') c.text.push(e.def.loot === 'ticket10'
      ? T('Duende del tesoro: huye de ti y se escapa a los 15 s. Lleva monedas y un ticket ×10.')
      : T('Duende del tesoro: huye de ti y se escapa a los 15 s. Va cargado de monedas.'));
    else if (e.judge) c.text.push(T('Llega con la Sentencia de Arceus. Sólo da experiencia.'));
    else if (e.legend) c.text.push(T('El legendario de la grieta: si lo vences, te llevas un vínculo, tickets y monedas.'));
    else if (e.boss) c.text.push(T('Cuatro ataques propios, todos con aviso en el suelo. Por debajo de la mitad de vida se enfurece. Al caer suelta un objeto, monedas y mucha experiencia.'));
    else if (BEH[e.behavior]) c.text.push(T(BEH[e.behavior]));
    if (e.flying && !e.boss) c.text.push(T('Flota: pasa por encima de paredes, agua y lava.'));
    if (e.shiny) c.text.push(T('Shiny: el doble de vida y cinco veces la experiencia. Si lo derrotas, es tuyo.'));
    else if (gold) c.text.push(T('Hora dorada: da el doble de experiencia y a veces suelta monedas.'));
    return c;
  });

  S('mate', uid => {
    const m = G.Coop.active && G.Coop.mate(uid), o = m && m.pl;
    if (!o || !m.connected) return null;
    const mon = o.mon || G.DEX_BY[o.dex], mv = o.moves[0];
    const c = { title: m.name, icon: 'user', color: m.color, chips: [{ text: mon.name, color: '#eaf2ff', tip: 'mon:' + mon.dex }].concat(mon.types.map(typeChip)),
                stats: [[T('Vida'), num(Math.ceil(o.hp), 0) + ' / ' + num(o.maxHp, 0)]], text: [] };
    if (mv) c.stats.push([T('Ataque'), T(mv.name), null, 'move:' + mv.id]);
    if (o.dead) { c.chips.push({ text: T('Caído'), color: '#ff5f6d' }); c.text.push(T('Quédate a su lado unos segundos para levantarlo.')); }
    return c;
  });

  // ---------------- altares, manantiales, cofres con candado, trampas y grieta ----------------

  const TS = G.World.TS;
  const propAt = (tx, ty, list) => list(tx * TS + TS / 2, ty * TS + TS - 4, 2).find(p => p.tx === tx && p.ty === ty) || null;
  const coopOwn = () => G.Coop.active ? T('En cooperativo cada uno tiene los suyos: lo que gastas tú no se lo gastas a los demás.') : null;
  const TRAP = [
    ['Trampa de veneno', '#c86bdc', 'Si estás dentro te quita un 10% de tu vida máxima. Los enemigos de alrededor quedan envenenados y reciben daño.'],
    ['Trampa pegajosa', '#8bd94a', 'Si estás dentro vas a media velocidad durante 3,5 s. Los enemigos de alrededor van mucho más lentos durante 4,5 s.'],
    ['Trampa explosiva', '#ff7b3d', 'Si estás dentro te quita un 20% de tu vida máxima. A los enemigos de alrededor les hace mucho daño y los empuja.']
  ];

  S('poi', arg => {
    const [tx, ty] = arg.split(',').map(Number);
    const p = propAt(tx, ty, G.World.specialsNear);
    if (!p || !run()) return null;
    if (p.type === 'altar') {
      const pw = G.Interact.POWERS[p.kind];
      // El título entero ('Altar de Rayo'): en inglés 'Rayo' a secas es el movimiento.
      return { title: T('Altar de ' + pw.name), icon: 'star', color: pw.color,
               chips: [{ text: T('Altar'), color: pw.color, tip: 'term:altar' }, p.used ? { text: T('Ya usado'), color: '#9fb1c9' } : { text: T('Sin usar'), color: '#5fe08a' }],
               stats: [[T('Efecto'), T(pw.desc)], [T('Duración'), G.Interact.POWER_TIME + ' s']],
               text: [p.used ? T('Ya lo has usado: cada altar sirve una sola vez.') : T('Písalo y el poder es tuyo. Sirve una sola vez.')], foot: coopOwn() };
    }
    if (p.type === 'spring') {
      return { title: T('Manantial'), icon: 'heart', color: '#7dffb0', chips: [{ text: T('Manantial'), color: '#7dffb0', tip: 'term:spring' }],
               stats: [[T('Carga'), pct(p.charge)], [T('Cura'), F('{x} de tu vida/s', '14%')]],
               text: [p.charge <= 0.02 ? T('Seco: espera a que se recargue.') : T('Ponte encima y cura mientras quede carga.'),
                      T('Se recarga solo: de vacío a lleno, unos 45 s.')], foot: coopOwn() };
    }
    if (p.type === 'bigchest') {
      const c = { title: T('Cofre con candado'), icon: 'coin', color: '#ffd23f', chips: [{ text: T('Cofre con candado'), color: '#ffd23f', tip: 'term:bigchest' }],
                  stats: [[T('Se abre en'), num(G.Interact.CHEST_TIME, 1) + ' s']],
                  text: [T('Quédate a su lado y se abre, aunque te ataquen. Si te vas, se vuelve a cerrar poco a poco.'),
                         T('Suelta monedas, de 1 a 3 tickets (a veces un ×10), la mitad de las veces un objeto y experiencia para subir un nivel.')] };
      if (p.open > 0) c.stats.push([T('Abriendo'), pct(p.open / G.Interact.CHEST_TIME)]);
      return c;
    }
    if (p.type === 'trap') {
      const [name, col, fx] = TRAP[p.kind] || TRAP[0];
      return { title: T(name), icon: 'bomb', color: col, chips: [{ text: T('Trampa'), color: col, tip: 'term:trap' }],
               text: [T('Salta al pisarla, tú o un enemigo que camine, y alcanza a todo lo que tiene cerca.'), T(fx)] };
    }
    return null;
  });

  S('rift', () => {
    const r = G.Rift.rift;
    if (!r || !run()) return null;
    return { title: T('Grieta'), icon: 'ball4', color: '#b48aff', chips: [{ text: T('Grieta'), color: '#b48aff', tip: 'term:rift' }],
             stats: [[T('Se cierra en'), Math.ceil(r.ttl) + ' s']],
             text: [T('Entra y os lleva, con todo el grupo, a la arena de un legendario. Tenéis 2 minutos.'),
                    T('Si lo vences: un vínculo, tickets y monedas. Si caes, vuelves sin premio y la partida sigue.')] };
  });

  // ---------------- lo que hay en el suelo ----------------

  const PICK = {
    xp:       ['Experiencia', 'up', '#7fe0ff', 'Te acerca al siguiente nivel. Vuela hacia ti al entrar en tu radio de recogida.'],
    xpBig:    ['Experiencia', 'up', '#ffd95e', 'Te acerca al siguiente nivel. Vuela hacia ti al entrar en tu radio de recogida.'],
    heal:     ['Baya', 'berry', '#5fe08a', 'Cura un 30% de tu vida máxima.'],
    magnet:   ['Imán', 'magnet', '#ff9ed8', 'Atrae hacia ti todo lo que hay en el suelo.'],
    bomb:     ['Bomba', 'bomb', '#ff7b3d', 'Golpea a todos los enemigos que se ven en la pantalla.'],
    coin:     ['Monedas', 'coin', '#ffd23f', 'Para la tienda de mejoras.'],
    ticket:   ['Ticket', 'ticket', '#ffd23f', 'Una tirada del gacha.'],
    ticket10: ['Ticket ×10', 'ticket10', '#c47bff', 'Diez tiradas del gacha de una vez.']
  };

  S('pick', id => {
    const p = G.Pickups.all().find(o => o.id === +id), pl = run();
    if (!p || !pl) return null;
    if (p.kind === 'item') {
      const c = G.Tooltip.content('item:' + p.value);
      if (c) c.foot = T('En el suelo: al cogerlo eliges si te lo quedas.');
      return c;
    }
    const d = PICK[p.kind];
    if (!d) return null;
    const c = { title: T(d[0]), icon: d[1], color: d[2], text: [T(d[3])] };
    if (p.kind === 'xp' || p.kind === 'xpBig') c.stats = [[T('Experiencia'), num(p.value, 0)]];
    else if (p.kind === 'coin') c.stats = [[T('Monedas'), '+' + num(p.value, 0)]];
    else if (p.kind === 'bomb') c.stats = [[T('Daño'), num(60 + pl.level * 14, 0)]];
    return c;
  });

  const hzKey = h => 'hz:' + Math.round(h.x) + ',' + Math.round(h.y) + ',' + h.kind;
  S('hz', arg => {
    const h = G.Hazards.all.find(o => !o.hit && hzKey(o) === 'hz:' + arg);
    if (!h || !run()) return null;
    const c = { title: T('Ataque con aviso'), icon: 'clock', color: h.color || '#ff5f6d', chips: h.type ? [typeChip(h.type)] : [],
                stats: [[T('Golpea en'), num(Math.max(0, h.delay - h.t), 1) + ' s']],
                text: [T('Se va llenando y, al llenarse, golpea a quien esté dentro. ¡Sal de ahí!')] };
    if (h.pct) c.text.push(F('Quita al menos un {x} de tu vida máxima, sin mirar tipos ni defensa.', pct(h.pct)));
    else if (h.dmg) c.stats.push([T('Daño'), num(h.dmg, 0)]);
    return c;
  });

  // ---------------- terreno y objetos del escenario ----------------

  const PROP = {
    tree:  ['Árbol', 'sprout', '#5fe08a', 'No se rompe. Bloquea el paso y para los disparos, los tuyos y los de los enemigos: sirve de cobertura.'],
    rock:  ['Roca', 'type:rock', '#c9b48a', 'Bloquea el paso y para los disparos. Se rompe a golpes y a veces suelta experiencia, monedas o una baya.'],
    chest: ['Cofre', 'coin', '#f2c443', 'Se rompe a golpes y suelta un buen botín: monedas, experiencia, una baya o un imán y, a veces, un objeto.'],
    grass: ['Hierba alta', 'type:grass', '#8bd94a', 'No bloquea nada. Se corta con cualquier ataque y a veces esconde una baya o unas monedas.']
  };

  S('prop', arg => {
    const [type, at] = arg.split(':'), d = PROP[type];
    if (!d || !run()) return null;
    const c = { title: T(d[0]), icon: d[1], color: d[2], text: [T(d[3])] };
    if (at) {
      const [tx, ty] = at.split(',').map(Number);
      const p = propAt(tx, ty, G.World.propsInCircle);
      if (!p) return null;
      c.stats = [[T('Aguante'), num(Math.ceil(p.hp), 0) + ' / ' + num(p.maxHp, 0)]];
    }
    return c;
  });

  // Líquidos de los biomas (world.js LIQ): nombre e icono.
  const LIQ_NAME = { water: ['Agua', 'type:water'], swamp: ['Pantano', 'type:ground'], lava: ['Lava', 'type:fire'],
                     poison: ['Charco tóxico', 'type:poison'], spark: ['Charco eléctrico', 'type:electric'], ice: ['Hielo', 'type:ice'] };

  S('ter', k => {
    const pl = run();
    if (!pl) return null;
    if (k === 'wall') {
      return { title: T('Pared'), icon: 'type:rock', color: '#c9b48a',
               text: [T('Nadie la cruza andando: sólo los enemigos que flotan y los jefes.'),
                      T('Para los disparos, los tuyos y los de los enemigos, y corta los rayos: ponte detrás para cubrirte.')] };
    }
    if (k !== 'liquid') return null;
    const kind = G.World.liquidKind(), e = G.World.liquidEffect(null), n = LIQ_NAME[kind] || LIQ_NAME.water;
    const c = { title: T(n[0]), icon: n[1], color: G.Tiles.BIOMES[G.World.biome].liq || '#4f8fd0', stats: [], text: [] };
    if (e.slow) {
      c.stats.push([T('Velocidad'), '-' + pct(1 - e.slow)]);
      c.text.push(T('Al cruzarlo vas más lento, y los enemigos que caminan, también.'));
    } else if (e.dmg) {
      c.stats.push([T('Te quita'), F('{x} de tu vida cada {x} s', pct(e.dmg / 2), num(e.every, 1))]);
      c.text.push(T('Mientras estás dentro te quita vida, y a los enemigos que caminan, también: por eso lo rodean.'));
    } else if (e.slide) c.text.push(T('Resbala: cuesta arrancar, frenar y girar. A los enemigos no les afecta.'));
    c.text.push(T('Los enemigos que flotan y los jefes pasan por encima.'));
    if (e.immune) {
      c.foot = F('A los de tipo {x} no les afecta.', typeList(e.immune));
      if (pl.mon.types.some(t => e.immune.includes(t))) c.foot += ' ' + T('Tampoco a ti.');
    }
    return c;
  });

  // ---------------- qué hay debajo del ratón ----------------

  const P = G.Sprites.PX;

  /** Caja de mundo a px de pantalla. */
  function screenRect(x0, y0, x1, y1) {
    const cam = G.Camera, k = cam.scale;
    return { x: (x0 - cam.left()) * k, y: (y0 - cam.top()) * k, w: (x1 - x0) * k, h: (y1 - y0) * k };
  }
  const inBox = (wx, wy, x0, y0, x1, y1, pad) => wx >= x0 - pad && wx <= x1 + pad && wy >= y0 - pad && wy <= y1 + pad;
  const hit = (src, b) => Object.assign({ src }, screenRect(b[0], b[1], b[2], b[3]));

  /** El cuerpo (de los pies a la cabeza) de un Pokémon. Los jugadores, por su sprite (vr), no por su colisión. */
  function body(o) {
    const lift = (o.jumpLift || 0) + (o.flying && !o.boss ? 2 : 0), r = o.vr || o.r;
    return [o.x - r, o.y - o.bodyH - lift, o.x + r, o.y + 4];
  }

  /** El más cercano al ratón (al centro de su caja) de los que lo tocan. */
  function nearest(list, boxOf, wx, wy, pad) {
    let best = null, bd = Infinity;
    for (const o of list) {
      const b = boxOf(o);
      if (!b || !inBox(wx, wy, b[0], b[1], b[2], b[3], pad)) continue;
      const d = (wx - (b[0] + b[2]) / 2) ** 2 + (wy - (b[1] + b[3]) / 2) ** 2;
      if (d < bd) { bd = d; best = { o, b }; }
    }
    return best;
  }

  /** Lo que se dibuja de un objeto del escenario (como world.drawProp). */
  function propBox(p) {
    const img = G.Tiles.propSprite(G.World.biome, p.type, 0), w = img.width * P, h = img.height * P;
    if (p.flat) return [p.x - w / 2, p.y - 8 - h / 2, p.x + w / 2, p.y - 8 + h / 2];
    const y = p.y - h + (p.type === 'grass' ? 4 : 2);
    return [p.x - w / 2, y, p.x + w / 2, y + h];
  }

  function find(x, y) {
    if (!playing() || y < (G.EnemyMgr.bossAlive() ? TOP_BOSS : TOP)) return null;
    const cam = G.Camera, wx = cam.left() + x / cam.scale, wy = cam.top() + y / cam.scale, pad = PAD / cam.scale;
    let n;
    // Enemigos (de la rejilla, sólo alrededor: los jefes miden hasta ~110 de alto).
    if ((n = nearest(G.EnemyMgr.queryCircle(wx, wy + 40, 90), body, wx, wy, pad))) return hit('foe:' + n.o.id, n.b);
    if (G.Coop.active && (n = nearest(G.Coop.mates.filter(m => m.connected), m => body(m.pl), wx, wy, pad))) return hit('mate:' + n.o.uid, n.b);
    // Objetos del escenario visibles: los interactivos primero y, si no, el de delante.
    const props = G.World.visibleProps(cam).filter(p => G.U.dist2(wx, wy, p.x, p.y) < 160 * 160);
    const SPECIAL = { altar: 1, spring: 1, bigchest: 1, trap: 1 };
    if ((n = nearest(props.filter(p => SPECIAL[p.type]), propBox, wx, wy, pad))) return hit('poi:' + n.o.tx + ',' + n.o.ty, n.b);
    const r = G.Rift.rift;
    if (r) {
      const img = G.Tiles.propSprite(0, 'rift', 0), w = img.width * P, h = img.height * P;
      const b = [r.x - w / 2, r.y - h + 4, r.x + w / 2, r.y + 4];
      if (inBox(wx, wy, b[0], b[1], b[2], b[3], pad)) return hit('rift', b);
    }
    if ((n = nearest(G.Pickups.all(), p => {
      if (Math.abs(p.x - wx) > 40 || Math.abs(p.y - wy) > 40) return null;
      const s = Math.max(9, G.Pickups.KIND[p.kind].r * 1.5);
      return [p.x - s, p.y - 6 - s, p.x + s, p.y - 6 + s];
    }, wx, wy, pad))) return hit('pick:' + n.o.id, n.b);
    for (const h of G.Hazards.all) {
      if (!h.hit && G.Hazards.inside(h, wx, wy, 0)) return Object.assign({ src: hzKey(h) }, screenRect(wx - 4, wy - 4, wx + 4, wy + 4));
    }
    let front = null;
    for (const p of props) {
      if (!PROP[p.type]) continue;
      const b = propBox(p);
      if (inBox(wx, wy, b[0], b[1], b[2], b[3], 0) && (!front || p.y > front.p.y)) front = { p, b };
    }
    if (front) {
      const p = front.p;
      return hit(p.destructible && p.type !== 'grass' ? 'prop:' + p.type + ':' + p.tx + ',' + p.ty : 'prop:' + p.type, front.b);
    }
    const k = G.World.kindAt(wx, wy);
    if (k === 'floor') return null;
    const tx = Math.floor(wx / TS) * TS, ty = Math.floor(wy / TS) * TS;
    return hit('ter:' + k, [tx, ty, tx + TS, ty + TS]);
  }

  // Ratón: como mucho una búsqueda cada EVERY ms; con el ratón quieto sólo se
  // queda el que ya había.
  let at = 0, last = null, movedAt = 0;
  addEventListener('pointermove', e => { if (e.pointerType !== 'touch') movedAt = performance.now(); }, { passive: true });

  /** Toque largo: sólo con el joystick fijo y lejos de él (ver la cabecera). */
  function touchOk(x, y) {
    if (G.Settings.get('stickMode') !== 'fixed') return false;
    const b = G.Touch.stickBase();
    return Math.hypot(x - b.x, y - b.y) > G.Touch.R() * 2.2;
  }

  G.Tooltip.probe((x, y, touch) => {
    if (touch) return touchOk(x, y) ? find(x, y) : null;
    const now = performance.now();
    if (now - at < EVERY - 10) return last;
    at = now;
    const h = find(x, y);
    last = h && (now - movedAt < IDLE || (last && last.src === h.src)) ? h : null;
    return last;
  });
  setInterval(() => { if (playing()) G.Tooltip.recheck(); }, EVERY);
})();
