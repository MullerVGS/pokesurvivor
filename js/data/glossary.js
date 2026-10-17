/* ============ glossary.js — términos del juego para el popup de información ============
 * Lo que sale subrayado dentro de un popup (ui/tooltip.js) y abre el suyo al
 * pasar el ratón con el popup fijado (tecla T) o al tocarlo en el móvil.
 *
 * Cada término:
 *   id      'term:<id>' es su fuente de contenido (data-tip="term:burn")
 *   es, en  expresión que lo encuentra en los textos de cada idioma (sólo
 *           palabras enteras; sin la bandera i distingue mayúsculas). Sin
 *           ellas, el término sólo se abre desde un data-tip.
 *   src     a dónde lleva si no es al propio término ('type:fire', 'item:leftovers'...)
 *   title, desc, icon, color   lo que enseña (en español; se traduce con lang-en.js)
 *   more()  párrafos extra, ya traducidos, sacados de los datos del juego
 *
 * Los tipos, los climas, los objetos y las mejoras de las cartas no se escriben
 * aquí: salen de sus datos y llevan a su propia ficha. Otros módulos pueden
 * añadir los suyos con G.Glossary.add({...}).
 */
G.Glossary = (() => {
  const T = s => G.T(s), F = (...a) => G.I18n.f(...a);
  const list = a => a.join(', ');

  const OWN = [
    { id: 'burn', es: /quema(?:n|r|d[oa]s?|duras?)?/i, en: /burn(?:s|ed|ing)?/i,
      title: 'Quemadura', icon: 'type:fire', color: '#ff9a4d',
      desc: 'El enemigo pierde vida cada medio segundo durante 3 s. Cada golpe que quema suma una acumulación más, hasta 8: cuantas más, más daño. Hace más daño cuanto más nivel tienes.' },
    // En inglés, sólo en minúscula: "Poison" con mayúscula es el tipo.
    { id: 'poison', es: /envenen(?:a|an|ar|ad[oa]s?|amiento)/i, en: /poison(?:s|ed|ing|ous)?/,
      title: 'Envenenamiento', icon: 'type:poison', color: '#d47cf0',
      desc: 'El enemigo pierde un trozo de su vida máxima cada 0,6 s durante 4 s. Cada golpe que envenena suma una acumulación más, hasta 8. Contra enemigos con mucha vida rinde más que la quemadura.' },
    { id: 'slow', es: /fren(?:a|an|ar|ad[oa]s?)/i, en: /slow(?:s|ed|ing)?/i,
      title: 'Frenado', icon: 'type:ice', color: '#7fe0ff',
      desc: 'El enemigo va más lento durante 1,2 s. Cuánto, depende del ataque.' },
    { id: 'bond', es: /v[ií]nculos?/i, en: /bonds?/i,
      title: 'Vínculo', icon: 'bond', color: '#ff8ad8',
      desc: 'Cada legendario que vences en una grieta te da uno. Con él juntas movimientos en un solo hueco (hasta 4) y se lanzan a la vez, cada uno con su recarga. Así te queda un hueco libre para aprender otro.' },
    { id: 'evo', es: /evoluci(?:ón|ones)|evoluciona(?:n|r|d[oa]s?)?/i, en: /evolv(?:e|es|ed|ing)|evolutions?/i,
      title: 'Evolución de movimiento', icon: 'up', color: '#ffd23f',
      desc: 'Un movimiento al nivel máximo evoluciona si en esa run has cogido alguna vez la mejora que pide. Sale una carta dorada: cambia de nombre y gana mucha potencia. Los potenciadores no evolucionan.' },
    { id: 'weather', es: /climas?/i, en: /weather/i,
      title: 'Clima', icon: 'wrain', color: '#7fb8ff',
      desc: 'De vez en cuando llega un clima que dura alrededor de un minuto. Cambia el daño según el tipo del ataque, para ti y para los enemigos.',
      more: () => [F('Puede ser: {x}.', list(Object.values(G.Weather.KINDS).map(k => T(k.name))))] },
    { id: 'item', es: /objetos?/i, en: /items?/i,
      title: 'Objeto', icon: 'leftovers', color: '#ffd23f',
      desc: 'Se encuentran en los cofres y los sueltan los jefes. Sólo puedes llevar uno: si encuentras otro, eliges con cuál quedarte. Dura lo que dura la run.',
      more: () => [F('Hay {x}: {x}.', G.Items.LIST.length, list(G.Items.LIST.map(i => T(i.name))))] },
    { id: 'cd', es: /recargas?/i, en: /cooldowns?/i,
      title: 'Recarga', icon: 'clock', color: '#ffd23f',
      desc: 'Tiempo entre un ataque y el siguiente. La bajan Reflejos, la Garra Rápida y el poder Prisa de los altares.' },
    { id: 'pierce', es: /perforaci(?:ón|ones)|perforantes?/i, en: /pierc(?:e|es|ing)/i,
      title: 'Perforación', icon: 'projectile', color: '#eaf2ff',
      desc: 'Cuántos enemigos más atraviesa un disparo antes de desaparecer.' },
    { id: 'crit', es: /cr[ií]tic(?:o|os|a|as)/i, en: /critical|crits?/i,
      title: 'Golpe crítico', icon: 'star', color: '#ffcb3d',
      desc: 'A veces un golpe hace ×1,5 de daño. La probabilidad sube con la mejora Golpe Crítico.' },
    { id: 'buff', es: /potenciador(?:es)?/i, en: /buffs?/i,
      title: 'Potenciador', icon: 'buff', color: '#5fe08a',
      desc: 'Movimiento que no hace daño: mientras sea tu ataque activo acumula una mejora (ataque, velocidad, defensa o vida) que caduca a los pocos segundos si cambias. Con dos potenciadores ya no te salen más.' },
    { id: 'altar', es: /altar(?:es)?/i, en: /altars?/i,
      title: 'Altar', icon: 'star', color: '#ff8ad8',
      desc: 'Al pisarlo te da un poder durante un rato. Cada altar sirve una sola vez.',
      more: () => G.Interact.POWERS.map(p => ({ plain: true, p: T(p.name) + ': ' + T(p.desc) })) },
    { id: 'rift', es: /grietas?/i, en: /rifts?/i,
      title: 'Grieta', color: '#b48aff',
      desc: 'Se abre de vez en cuando: sigue la flecha morada. Dentro te espera un legendario, y si lo vences ganas un vínculo.' },
    { id: 'pity', title: 'Tiradas sin legendaria', icon: 'ball4', color: '#ffcb3d',
      desc: 'Cada banner cuenta las tiradas seguidas sin sacar una Legendaria. Al llegar al tope, la siguiente es Legendaria seguro.',
      more: () => [F('Tope: {x} tiradas.', G.Gacha.PITY_5)] }
  ];

  const extra = [];
  let built = null;

  /** Añade términos (los mismos campos que arriba). */
  function add(...terms) { extra.push(...terms); built = null; }

  const BY = {};
  function byId(id) { if (!built) build(); return BY[id]; }

  const reEsc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // Nombre exacto (con sus mayúsculas) en los dos idiomas.
  const named = (name, src, ci) => ({ src, es: new RegExp(reEsc(name), ci ? 'i' : ''), en: new RegExp(reEsc(G.T(name)), ci ? 'i' : '') });

  /** Todos los términos con su expresión ya preparada para el idioma actual. */
  function build() {
    const all = OWN.concat(extra);
    for (const t of all) BY[t.id] = t;
    const gen = [];
    for (const t in G.U.TYPE_NAME) gen.push(named(G.U.TYPE_NAME[t], 'type:' + t));
    for (const k in G.Weather.KINDS) gen.push(named(G.Weather.KINDS[k].name, 'wx:' + k, true));
    for (const it of G.Items.LIST) gen.push(named(it.name, 'item:' + it.id));
    for (const s of G.LevelUp.STATS) gen.push(named(s.title, 'stat:' + s.id));
    // Los movimientos llevan a su ficha; los nombres de sus evoluciones sólo
    // "tapan" (sin enlace), para que "Bomba Imán" no sea la mejora Imán.
    for (const m of G.Moves.ALL) gen.push(named(m.name, 'move:' + m.id));
    for (const id in G.Moves.EVO) if (!G.Moves.ALL.some(m => m.name === G.Moves.EVO[id][0])) gen.push(named(G.Moves.EVO[id][0], null));
    const L = '\\p{L}\\p{N}';
    built = all.map(t => ({ src: t.src || 'term:' + t.id, re: t[G.I18n.lang] })).concat(gen.map(g => ({ src: g.src, re: g[G.I18n.lang] })))
      .filter(t => t.re)
      .map(t => ({ src: t.src, re: new RegExp(`(?<![${L}])(?:${t.re.source})(?![${L}])`, 'gu' + (t.re.flags.includes('i') ? 'i' : '')) }));
    return built;
  }

  /**
   * Encuentra los términos de un texto (ya traducido): [inicio, fin, src],
   * sin solaparse; si dos empiezan en el mismo sitio, gana el más largo.
   * `self` es la fuente del popup que se está pintando (no se enlaza a sí mismo,
   * pero sigue tapando lo de dentro).
   */
  function find(text, self) {
    const hits = [];
    for (const t of built || build()) {
      t.re.lastIndex = 0;
      let m;
      while ((m = t.re.exec(text))) hits.push([m.index, m.index + m[0].length, t.src === self ? null : t.src]);
    }
    hits.sort((a, b) => a[0] - b[0] || (b[1] - b[0]) - (a[1] - a[0]) || !a[2] - !b[2]);
    const out = [];
    let at = 0;
    for (const h of hits) if (h[0] >= at) { if (h[2]) out.push(h); at = h[1]; }
    return out;
  }

  return { add, byId, find, OWN };
})();
