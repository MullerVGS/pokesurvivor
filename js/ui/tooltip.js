/* Skill hover waits one second; T / long press opens an interactive readout.
 * Only one readout at a time. Passive previews do not pause or capture input. */
G.Tooltip = (() => {
  const sources = {};
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

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
      out += esc(text.slice(at, a)) + `<button type="button" class="readout-link" data-info-source="${src}">${esc(text.slice(a, b))}</button>`;
      at = b;
    }
    return out + esc(text.slice(at));
  }

  const term = (txt, tip) => tip ? `<button type="button" class="readout-link" data-info-source="${esc(tip)}">${esc(txt)}</button>` : esc(txt);

  function body(c, self) {
    let h = '';
    if (c.chips && c.chips.length) {
      h += '<div class="tip-chips">' + c.chips.map(ch =>
        `<span class="tip-chip${ch.tip ? ' tip-term' : ''}"${ch.tip ? ` data-info-source="${esc(ch.tip)}"` : ''} style="background:${ch.color || '#9fb1c9'}">${esc(ch.text)}</span>`).join('') + '</div>';
    }
    if (c.stats && c.stats.length) {
      h += '<div class="tip-stats">' + c.stats.map(([k, v, tip, vtip]) =>
        `<span>${term(k, tip)}</span><b>${v && v.h != null ? v.h : term(v, vtip)}</b>`).join('') + '</div>';
    }
    for (const p of c.text || []) h += typeof p === 'string' ? `<p>${link(p, self)}</p>` : `<p>${p.plain ? esc(p.p) : link(p.p, self)}</p>`;
    if (c.list && c.list.length) h += '<ul>' + c.list.map(l => `<li>${typeof l === 'string' ? link(l, self) : term(l.text, l.tip)}</li>`).join('') + '</ul>';
    for (const part of c.parts || []) h += `<div class="tip-part">${head(part)}${body(part, self)}</div>`;
    if (c.foot) h += `<p class="tip-foot">${link(c.foot, self)}</p>`;
    return h;
  }

  const head = c => `<div class="tip-hd">${c.icon ? G.Icons.html(c.icon, 28) : ''}<b>${esc(c.title || '')}</b></div>`;


  let zones = [], zonesAt = 0, pointer = null, hover = null, press = null, swallow = false, hoverTimer = null, cursor = null;
  const probes = [], STALE = 1500, LONG = 500, HOVER = 1000;
  function canvasHit(x, y, touch = false) {
    if (performance.now() - zonesAt > STALE) return null;
    for (const z of [...zones].reverse()) if (x >= z.x && x <= z.x + z.w && y >= z.y && y <= z.y + z.h) return { src: z.src, rect: { left: z.x, top: z.y, right: z.x + z.w, bottom: z.y + z.h } };
    for (const probe of probes) { const hit = probe(x, y, touch); if (hit) return { src: typeof hit === 'string' ? hit : hit.src, rect: { left: x, right: x + 1, top: y, bottom: y + 1 } }; }
    return null;
  }
  function domHit(target) {
    const el = target.closest?.('[data-tip]');
    return el ? { src: el.dataset.tip, el, dex: +el.dataset.tipDex || undefined, rect: el.getBoundingClientRect() } : null;
  }
  function clearHover() { clearTimeout(hoverTimer); hoverTimer = null; G.InfoPanel?.hidePeek(); }
  function track(hit) {
    if (G.InfoPanel?.isOpen) return;
    if (hit?.src === hover?.src && hit?.el === hover?.el) { if (hit) hover = hit; return; }
    clearHover(); hover = hit;
    if (!hit || !/^(move:|inst:|slot:|card:(new|up|evo):)/.test(hit.src)) return;
    hoverTimer = setTimeout(() => {
      hoverTimer = null;
      if (hover?.src !== hit.src || (hit.el && !hit.el.getClientRects().length)) return;
      G.InfoPanel.peek(hit.src, hover.rect, { dex: hit.dex, avoid: hit.el ? [] : zones.map(z => ({left:z.x, top:z.y, right:z.x+z.w, bottom:z.y+z.h})) });
    }, HOVER);
  }
  function recheck() { if (pointer) track(canvasHit(...pointer)); }
  function show(src, options = {}) { clearHover(); return G.InfoPanel.open(src, options); }
  function hide() { clearHover(); G.InfoPanel?.close(); hover = null; pointer = null; cursor = null; }
  document.addEventListener('pointermove', e => {
    if (e.pointerType === 'touch') return;
    cursor = [e.clientX, e.clientY];
    pointer = e.target.id === 'game' ? cursor : null;
    track(pointer ? canvasHit(...pointer) : domHit(e.target));
  });
  document.addEventListener('pointerout', e => { if (!e.relatedTarget) { clearHover(); pointer = null; hover = null; } });
  function refreshTarget() {
    clearHover(); hover = null; pointer = null;
    if (cursor) requestAnimationFrame(() => {
      if (!cursor) return;
      const target = document.elementFromPoint(...cursor);
      pointer = target?.id === 'game' ? cursor : null;
      track(pointer ? canvasHit(...pointer) : target && domHit(target));
    });
  }
  document.addEventListener('scroll', refreshTarget, true);
  addEventListener('blur', hide);
  addEventListener('resize', refreshTarget);
  addEventListener('keydown', e => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const field = e.target.closest?.('input, textarea, select, [contenteditable]');
    if (G.InfoPanel?.isOpen) {
      if (e.code === 'Escape' || (e.code === 'KeyT' && !field)) { e.preventDefault(); e.stopImmediatePropagation(); if (!e.repeat) hide(); }
      return;
    }
    if (e.code === 'Escape' && G.InfoPanel?.peekOpen) { e.preventDefault(); e.stopImmediatePropagation(); hide(); return; }
    if (field || e.code !== 'KeyT' || e.repeat) return;
    const target = cursor && document.elementFromPoint(...cursor);
    const hit = hover || (target && (target.id === 'game' ? canvasHit(...cursor) : domHit(target))) || domHit(document.activeElement);
    if (hit && show(hit.src, { dex: hit.dex })) { e.preventDefault(); e.stopImmediatePropagation(); }
  }, true);
  function cancelPress() { if (press) clearTimeout(press.timer); press = null; }
  document.addEventListener('touchstart', e => {
    cancelPress(); swallow = false;
    if (e.touches.length !== 1 || G.InfoPanel?.isOpen) return;
    const touch = e.changedTouches[0];
    const hit = domHit(e.target) || (e.target.id === 'game' ? canvasHit(touch.clientX, touch.clientY, true) : null);
    if (!hit) return;
    press = { x: touch.clientX, y: touch.clientY, timer: setTimeout(() => { press = null; swallow = show(hit.src, { dex: hit.dex }); }, LONG) };
  }, { capture: true, passive: true });
  document.addEventListener('touchmove', e => { const t = e.changedTouches[0]; if (press && Math.hypot(t.clientX - press.x, t.clientY - press.y) > 12) cancelPress(); }, { capture: true, passive: true });
  for (const event of ['touchend', 'touchcancel']) document.addEventListener(event, cancelPress, { capture: true, passive: true });
  document.addEventListener('click', e => { clearHover(); hover = null; cursor = null; if (swallow) { swallow = false; e.preventDefault(); e.stopImmediatePropagation(); } }, true);
  document.addEventListener('contextmenu', e => { if (press || e.target.closest?.('[data-tip], .inspection-screen')) e.preventDefault(); });
  return { source, content, show, hide, recheck,
    markup: c => (c.title ? head(c) : '') + body(c, ''),
    zone(x, y, w, h, src) { zones.push({ x, y, w, h, src }); },
    clearZones() { zones = []; zonesAt = performance.now(); }, probe(fn) { probes.push(fn); },
    holds() { return !G.Coop.active && G.Game.state === 'playing' && !!G.InfoPanel?.isOpen; },
    get isOpen() { return !!G.InfoPanel?.isOpen; }
  };
})();
