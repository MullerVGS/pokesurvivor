/* ============ tooltip.js — popup de información (como en Baldur's Gate 3) ============
 * Pasar el ratón sobre algo importante abre, a los 250 ms, un popup con lo que
 * hace: título, icono, tipo, números y descripción. En la esquina sale la tecla
 * T: con ella el popup se FIJA (no se va al quitar el ratón) y los términos
 * subrayados de dentro abren el suyo al lado, que también se fija con T, en
 * cadena. T otra vez suelta el último; Esc o un clic fuera, todos.
 * Fijar en una partida en solitario la pausa (G.Game mira holds()); en grupo no.
 * Móvil: un toque largo (400 ms) lo abre ya fijado, con una ×; tocar un término
 * abre el suyo.
 *
 * Qué tiene popup:
 *   DOM      cualquier elemento con data-tip="<fuente>" (cartas, Pokédex, gacha...)
 *   canvas   zonas que registra el HUD en cada fotograma: zone(x, y, w, h, fuente),
 *            y "sondas" para lo que no es HUD: probe(fn), fn(x, y, touch) en px de
 *            pantalla -> fuente | { src, x, y, w, h } | null (touch: es un toque
 *            largo, no el ratón). El mundo se mueve bajo el ratón quieto: quien
 *            tenga sondas llama a recheck() para que se vuelva a mirar ahí.
 *            Un clic con el ratón en el canvas durante la partida no suelta los
 *            fijados (hacer clic para apuntar no cierra nada; sólo T y Esc).
 *
 * Fuentes: 'tipo:arg' ('move:ember', 'slot:0', 'item:leftovers', 'term:burn'...).
 * Cada tipo tiene una función que monta el contenido (tooltip-sources.js):
 *   source('enemy', arg => ({ ... }))   añade un tipo
 * El contenido, con todo el texto YA traducido (G.T / G.I18n.f):
 *   { title, icon, color,
 *     chips: [{ text, color, tip }],          etiquetas (tip: fuente al pasar por ella)
 *     stats: [[etiqueta, valor, tip, vtip]],  valor: texto o { h: html }; tip/vtip: fuente de cada uno
 *     text:  ['párrafo', { p, plain }],       los términos del glosario se subrayan solos
 *     list:  ['línea', ...],
 *     parts: [contenido, ...],                bloques con su propio título (un vínculo)
 *     foot:  'nota al pie' }
 * Términos: data/glossary.js (G.Glossary.add para añadir más).
 *
 * Desde código:
 *   G.Tooltip.show('term:bond', x, y, { pin, touch, rect })   abre uno en un punto de la pantalla
 *   G.Tooltip.hide()        cierra todos
 *   G.Tooltip.content(src)  el contenido de una fuente (para pruebas)
 *   G.Tooltip.holds()       ¿hay uno fijado que pausa la partida?
 *   G.Tooltip.recheck()     vuelve a mirar lo que hay bajo el ratón quieto (sondas)
 */
G.Tooltip = (() => {
  const DELAY = 250, LONG = 400, GRACE = 90, M = 8, STALE = 1500;
  const sources = {};
  const stack = [];          // popups abiertos, de fuera a dentro: { el, src, key, anchor, pinned, touch, html }
  let wait = null, leaveT = null, tick = null;
  let zones = [], zonesAt = 0, canvasKey = null, ptr = null;   // ptr: último punto del ratón sobre el canvas
  const probes = [];

  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  /** Añade un tipo de fuente: fn(arg) -> contenido (o null si no hay nada que enseñar). */
  function source(kind, fn) { sources[kind] = fn; }

  function content(src) {
    const i = src.indexOf(':');
    const fn = sources[i < 0 ? src : src.slice(0, i)];
    try { return fn ? fn(i < 0 ? '' : src.slice(i + 1)) : null; }
    catch (e) { console.warn('[Tooltip] ' + src, e); return null; }
  }

  // ---------------- pintar ----------------

  /** Texto con los términos del glosario subrayados. */
  function link(text, self) {
    let out = '', at = 0;
    for (const [a, b, src] of G.Glossary.find(text, self)) {
      out += esc(text.slice(at, a)) + `<u class="tip-term" data-tip="${src}">${esc(text.slice(a, b))}</u>`;
      at = b;
    }
    return out + esc(text.slice(at));
  }

  const term = (txt, tip) => tip ? `<u class="tip-term" data-tip="${esc(tip)}">${esc(txt)}</u>` : esc(txt);

  function body(c, self) {
    let h = '';
    if (c.chips && c.chips.length) {
      h += '<div class="tip-chips">' + c.chips.map(ch =>
        `<span class="tip-chip${ch.tip ? ' tip-term' : ''}"${ch.tip ? ` data-tip="${esc(ch.tip)}"` : ''} style="background:${ch.color || '#9fb1c9'}">${esc(ch.text)}</span>`).join('') + '</div>';
    }
    if (c.stats && c.stats.length) {
      h += '<div class="tip-stats">' + c.stats.map(([k, v, tip, vtip]) =>
        `<span>${term(k, tip)}</span><b>${v && v.h != null ? v.h : term(v, vtip)}</b>`).join('') + '</div>';
    }
    for (const p of c.text || []) h += typeof p === 'string' ? `<p>${link(p, self)}</p>` : `<p>${p.plain ? esc(p.p) : link(p.p, self)}</p>`;
    if (c.list && c.list.length) h += '<ul>' + c.list.map(l => `<li>${link(l, self)}</li>`).join('') + '</ul>';
    for (const part of c.parts || []) h += `<div class="tip-part">${head(part)}${body(part, self)}</div>`;
    if (c.foot) h += `<p class="tip-foot">${link(c.foot, self)}</p>`;
    return h;
  }

  const head = c => `<div class="tip-hd">${c.icon ? G.Icons.html(c.icon, 28) : ''}<b style="color:${c.color || '#eaf2ff'}">${esc(c.title || '')}</b></div>`;

  function paint(p, c) {
    const h = head(c) + body(c, p.src) +
      (p.touch ? `<button class="tip-x" type="button" aria-label="${esc(G.T('Cerrar'))}">×</button>` : '<span class="tip-key">T</span>');
    if (h !== p.html) { p.html = h; p.el.innerHTML = h; }
    p.el.classList.toggle('pinned', p.pinned);
  }

  // ---------------- dónde va ----------------

  function rectOf(a) {
    if (a.el) { const r = a.el.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; }
    return a.r;
  }

  /**
   * Raíz: encima o debajo de lo que lo abre (hacia donde haya más sitio).
   * Anidado: al lado de su padre, a la altura del término; si no cabe, debajo.
   * Nunca se sale de la pantalla.
   */
  function place(p) {
    const el = p.el, r = rectOf(p.anchor), vw = innerWidth, vh = innerHeight;
    el.style.maxWidth = Math.min(320, vw - 2 * M) + 'px';
    el.style.maxHeight = (vh - 2 * M) + 'px';
    const w = el.offsetWidth, h = el.offsetHeight;
    const parent = p.level > 0 && stack[p.level - 1];
    let x, y;
    if (parent) {
      const pr = parent.el.getBoundingClientRect();
      x = pr.right + 6;
      y = r.y - 10;
      if (x + w > vw - M) x = pr.left - w - 6;
      if (x < M) { x = r.x + r.w / 2 - w / 2; y = r.y + r.h + 6 + h <= vh - M ? r.y + r.h + 6 : r.y - h - 6; }
    } else {
      const below = r.y + r.h + 8, above = r.y - h - 8;
      x = r.x + r.w / 2 - w / 2;
      y = r.y + r.h / 2 > vh / 2 ? (above >= M ? above : below) : (below + h <= vh - M ? below : above);
    }
    el.style.left = Math.round(clamp(x, M, vw - w - M)) + 'px';
    el.style.top = Math.round(clamp(y, M, vh - h - M)) + 'px';
  }

  // ---------------- abrir y cerrar ----------------

  /** Abre (o cambia, sin cerrarlo) el popup del nivel `level`; cierra los de dentro. */
  function open(level, src, anchor, o = {}) {
    if (level > stack.length) return null;
    const c = content(src);
    if (!c) return null;
    close(level + 1);
    let p = stack[level];
    if (!p) {
      p = { el: document.createElement('div'), html: '' };
      p.el.className = 'tip';
      p.el.setAttribute('translate', 'no');           // ya va traducido (i18n.js no lo toca)
      document.body.appendChild(p.el);
      stack[level] = p;
    }
    Object.assign(p, { level, src, anchor, key: o.key, pinned: !!o.pin, touch: !!o.touch });
    p.el.classList.toggle('touchy', p.touch);
    paint(p, c);
    place(p);
    if (!tick) tick = setInterval(refresh, 250);
    return p;
  }

  function close(level = 0) {
    if (wait && wait.level >= level) cancelWait();
    if (leaveT && leaveT.level >= level) { clearTimeout(leaveT.t); leaveT = null; }
    while (stack.length > level) stack.pop().el.remove();
    if (!stack.length && tick) { clearInterval(tick); tick = null; }
  }

  function pin(p) { p.pinned = true; p.el.classList.add('pinned'); G.Audio.sfx('click'); }

  function cancelWait() { if (wait) { clearTimeout(wait.t); wait = null; } }

  /** ¿Sigue ahí lo que lo abrió? (una carta elegida, el HUD de una partida que acabó...) */
  function alive(a) {
    if (a.el) return a.el.isConnected && a.el.getClientRects().length > 0;
    if (a.fixed) return true;
    if (performance.now() - zonesAt > STALE) return false;
    if (a.probe) return true;
    const z = zones.find(z => z.src === a.zone);
    if (z) a.r = z;
    return !!z;
  }

  /** Cada 250 ms: cierra los que perdieron su ancla y pone al día los no fijados (recargas, segundos...). */
  function refresh() {
    for (let i = 0; i < stack.length; i++) {
      const p = stack[i];
      if (!alive(p.anchor)) { close(i); return; }
      if (p.pinned) continue;
      const c = content(p.src);
      if (!c) { close(i); return; }
      paint(p, c);
      place(p);
    }
  }

  // ---------------- ratón ----------------

  /** El ratón entra en algo con popup (`key` lo identifica: el elemento o la zona). */
  function enter(level, src, anchor, key) {
    if (leaveT && leaveT.level === level) { clearTimeout(leaveT.t); leaveT = null; }
    const cur = stack[level];
    if (cur && cur.key === key) { cancelWait(); return; }
    if (level === 0 && stack.some(p => p.pinned)) return;       // con uno fijado, lo de fuera no abre
    cancelWait();
    // De un vecino a otro con el popup abierto: se cambia ya, sin parpadear.
    if (cur && !cur.pinned) { open(level, src, anchor, { key }); return; }
    wait = { level, key, t: setTimeout(() => { wait = null; open(level, src, anchor, { key }); }, DELAY) };
  }

  /** El ratón sale: se cierra él (y los de dentro) si no está fijado. */
  function leave(level, key) {
    if (wait && wait.key === key) cancelWait();
    const cur = stack[level];
    if (!cur || cur.pinned || cur.key !== key) return;
    if (leaveT) clearTimeout(leaveT.t);
    leaveT = { level, t: setTimeout(() => {
      leaveT = null;
      const c = stack[level];
      if (c && !c.pinned && c.key === key) close(level);
    }, GRACE) };
  }

  /** Nivel del popup que abriría un elemento: 0 fuera de los popups; -1 en uno que ya no está. */
  function levelOf(t) {
    const box = t.closest('.tip');
    if (!box) return 0;
    const i = stack.findIndex(p => p.el === box);
    return i < 0 ? -1 : i + 1;
  }

  /** Zonas del HUD: el HUD las vacía y las vuelve a apuntar en cada fotograma. */
  function clearZones() { zones = []; zonesAt = performance.now(); }
  function zone(x, y, w, h, src) { zones.push({ x, y, w, h, src }); }
  function probe(fn) { probes.push(fn); }

  function canvasHit(x, y, touch = false) {
    if (performance.now() - zonesAt > STALE) return null;
    for (let i = zones.length - 1; i >= 0; i--) {
      const z = zones[i];
      if (x >= z.x && x <= z.x + z.w && y >= z.y && y <= z.y + z.h) return { src: z.src, key: 'zone:' + z.src, anchor: { zone: z.src, r: z } };
    }
    for (const fn of probes) {
      const r = fn(x, y, touch);
      if (!r) continue;
      const o = typeof r === 'string' ? { src: r, x, y, w: 0, h: 0 } : r;
      return { src: o.src, key: 'probe:' + o.src, anchor: { probe: true, r: { x: o.x, y: o.y, w: o.w || 0, h: o.h || 0 } } };
    }
    return null;
  }

  document.addEventListener('pointerover', e => {
    if (e.pointerType === 'touch') return;
    const t = e.target.closest && e.target.closest('[data-tip]');
    const level = t ? levelOf(t) : -1;
    if (level >= 0) enter(level, t.dataset.tip, { el: t }, t);
  });
  document.addEventListener('pointerout', e => {
    if (e.pointerType === 'touch') return;
    if (!e.relatedTarget && ptr) { ptr = null; canvasHover(null); }      // el ratón sale de la ventana
    const t = e.target.closest && e.target.closest('[data-tip]');
    if (!t || (e.relatedTarget && t.contains(e.relatedTarget))) return;
    const level = levelOf(t);
    if (level >= 0) leave(level, t);
  });
  // El canvas del juego: zonas del HUD y sondas.
  function canvasHover(hit) {
    const key = hit ? hit.key : null;
    if (key === canvasKey) return;
    if (canvasKey) leave(0, canvasKey);
    canvasKey = key;
    if (hit) enter(0, hit.src, hit.anchor, key);
  }
  addEventListener('pointermove', e => {
    if (e.pointerType === 'touch') return;
    ptr = e.target && e.target.id === 'game' ? [e.clientX, e.clientY] : null;
    canvasHover(ptr ? canvasHit(ptr[0], ptr[1]) : null);
  });
  /** Lo que se mueve solo (enemigos, el mapa al andar) bajo el ratón quieto. */
  function recheck() { if (ptr) canvasHover(canvasHit(ptr[0], ptr[1])); }
  // Al hacer scroll en un menú, el popup se quedaría lejos de lo suyo.
  addEventListener('scroll', e => {
    if (!stack.length || (e.target.closest && e.target.closest('.tip'))) return;
    const i = stack.findIndex(p => !p.pinned);
    if (i >= 0) close(i);
  }, true);

  // ---------------- teclado ----------------

  addEventListener('keydown', e => {
    if (!stack.length || e.ctrlKey || e.metaKey || e.altKey) return;
    // Escribiendo un apodo, un amigo o eligiendo en una lista, la T es una letra.
    const f = document.activeElement;
    if (f && (f.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(f.tagName))) return;
    if (e.code === 'KeyT') {
      e.preventDefault(); e.stopPropagation();
      if (e.repeat) return;
      const top = stack[stack.length - 1];
      if (!top.pinned) pin(top); else close(stack.length - 1);
    } else if (e.code === 'Escape') {
      // Con uno fijado, Esc sólo lo suelta (no abre la pausa ni sale del menú).
      const pinned = stack.some(p => p.pinned);
      close(0);
      if (pinned) { e.preventDefault(); e.stopPropagation(); }
    }
  }, true);

  // ---------------- clics y toques ----------------

  let press = null, swallow = false;
  function cancelPress() { if (press) { clearTimeout(press.t); press = null; } }

  // Fuera de los popups: un clic (o un toque) suelta los fijados. En la
  // partida, el clic del ratón en el canvas no (es para jugar: apuntar...).
  document.addEventListener('pointerdown', e => {
    if (!stack.length || (e.target.closest && e.target.closest('.tip'))) return;
    if (e.pointerType !== 'touch' && e.target.id === 'game' && G.Game.state === 'playing') return;
    if (stack.some(p => p.pinned)) close(0);
  }, true);

  document.addEventListener('click', e => {
    // El toque largo que abrió un popup no pulsa además lo que había debajo (una carta...).
    if (swallow) { swallow = false; e.preventDefault(); e.stopPropagation(); return; }
    const box = e.target.closest && e.target.closest('.tip');
    const level = box ? stack.findIndex(p => p.el === box) : -1;
    if (level < 0) return;
    if (e.target.closest('.tip-x')) { close(level); return; }
    // Clic o toque en un término: su popup, ya fijado.
    const t = e.target.closest('[data-tip]');
    if (t) { cancelWait(); open(level + 1, t.dataset.tip, { el: t }, { key: t, pin: true, touch: stack[level].touch }); }
  }, true);

  // Toque largo: abre el popup de lo que hay debajo, ya fijado. Con dos dedos
  // (joystick y ataque a la vez) no hace nada.
  document.addEventListener('touchstart', e => {
    cancelPress();
    swallow = false;
    if (e.touches.length !== 1 || (e.target.closest && e.target.closest('.tip'))) return;
    const tc = e.changedTouches[0];
    const t = e.target.closest && e.target.closest('[data-tip]');
    const hit = t ? { src: t.dataset.tip, key: t, anchor: { el: t } }
      : e.target.id === 'game' ? canvasHit(tc.clientX, tc.clientY, true) : null;
    if (!hit) return;
    press = { x: tc.clientX, y: tc.clientY, t: setTimeout(() => {
      press = null;
      if (open(0, hit.src, hit.anchor, { key: hit.key, pin: true, touch: true })) swallow = true;
    }, LONG) };
  }, { capture: true, passive: true });
  document.addEventListener('touchmove', e => {
    const tc = e.changedTouches[0];
    if (press && tc && Math.hypot(tc.clientX - press.x, tc.clientY - press.y) > 12) cancelPress();
  }, { capture: true, passive: true });
  document.addEventListener('touchend', cancelPress, { capture: true, passive: true });
  document.addEventListener('touchcancel', cancelPress, { capture: true, passive: true });
  document.addEventListener('contextmenu', e => {
    if (press || (e.target.closest && e.target.closest('[data-tip], .tip'))) e.preventDefault();
  });

  // ---------------- desde código ----------------

  function show(src, x, y, o = {}) {
    close(0);
    return !!open(0, src, { fixed: true, r: o.rect || { x, y, w: 0, h: 0 } }, { key: 'show:' + src, pin: o.pin, touch: o.touch });
  }

  /** Fijado en una partida en solitario: el juego se para (game.js). */
  function holds() { return !G.Coop.active && G.Game.state === 'playing' && stack.some(p => p.pinned); }

  return { source, content, show, hide: () => close(0), holds, zone, clearZones, probe, recheck,
           get isOpen() { return stack.length > 0; } };
})();
