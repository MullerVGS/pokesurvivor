/* Shared, bounded FRLG readout. Navigation stays inside its original panel. */
G.InfoPanel = (() => {
  const panes = new WeakMap();
  let screen = null, peekScreen = null, returnFocus = null;
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  function moveLayout(data, preview, state) {
    const base = data.parts?.[0] || data;
    const type = base.chips?.find(c => c.tip?.startsWith('type:'))?.tip.slice(5);
    const mon = G.DEX_BY[preview.dex];
    const owner = mon ? `<div class="skill-owner"><canvas width="48" height="40"></canvas><div><b>${esc(mon.name)}</b><div>${mon.types.map(G.TypeIcons.badge).join('')}</div></div></div>` : '';
    const facts = G.Tooltip.markup({ stats: base.stats, text: base.text?.slice(0, 1) });
    const more = state.compact ? '' : G.Tooltip.markup({ text: base.text?.slice(1), list: base.list, foot: base.foot, parts: data.parts?.slice(1) });
    const chips = (base.chips || []).filter(c => !c.tip?.startsWith('type:'));
    return `<div class="skill-sheet"><div class="skill-facts">${owner}<div class="skill-values">${facts}</div></div><div class="skill-demo">
      <div class="skill-move-row">${type ? G.TypeIcons.badge(type) : ''}<b>${esc(base.title)}</b>${G.Tooltip.markup({ chips })}</div>
      ${G.MovePreview.markup(preview)}${more ? `<div class="skill-growth">${more}</div>` : ''}</div></div>`;
  }
  function paint(host, state) {
    const data = G.Tooltip.content(state.path.at(-1));
    if (!data) return false;
    G.MovePreview.release(host);
    const preview = data.preview && { ...data.preview, ...(state.dex ? { dex: state.dex } : {}) };
    host.classList.add('readout'); host.setAttribute('translate', 'no');
    host.innerHTML = `<div class="readout-nav"><button type="button" class="readout-back" ${state.path.length < 2 ? 'hidden' : ''}>← ${G.T('Volver')}</button></div>
      <div class="readout-body">${preview ? moveLayout(data, preview, state) : G.Tooltip.markup(data)}</div>`;
    if (preview) {
      G.MovePreview.attach(host, preview);
      const owner = host.querySelector('.skill-owner canvas');
      if (owner) G.UI.sprite(owner, preview.dex, { lively: true, scale: 1 });
    }
    host.querySelector('.readout-back').onclick = () => {
      state.path.pop(); paint(host, state);
      host.querySelector('.readout-body').focus({ preventScroll: true });
    };
    host.querySelector('.readout-body').tabIndex = 0;
    host.querySelectorAll('[data-info-source]').forEach(link => {
      // Older content chips are spans; give them native keyboard semantics.
      if (link.tagName !== 'BUTTON') { link.tabIndex = 0; link.setAttribute('role', 'button'); }
      const open = () => {
        if (!G.Tooltip.content(link.dataset.infoSource)) return;
        state.path.push(link.dataset.infoSource); paint(host, state);
        host.querySelector('.readout-back').focus({ preventScroll: true });
      };
      link.onclick = open;
      if (link.tagName !== 'BUTTON') link.onkeydown = e => { if (['Enter', ' '].includes(e.key)) { e.preventDefault(); open(); } };
    });
    return true;
  }
  function render(host, source, options = {}) {
    const state = { path: [source], dex: options.dex, compact: !!options.compact };
    panes.set(host, state); return paint(host, state);
  }
  function release(host) { if (!host) return; G.MovePreview.release(host); panes.delete(host); }
  function close() {
    if (!screen || screen.hidden) return;
    release(screen.querySelector('.inspection-content'));
    screen.hidden = true;
    if (returnFocus?.isConnected && returnFocus.getClientRects().length) returnFocus.focus({ preventScroll: true });
    returnFocus = null;
  }
  function open(source, options = {}) {
    hidePeek();
    if (!G.Tooltip.content(source)) return false;
    if (!screen) {
      screen = document.createElement('section');
      screen.className = 'inspection-screen'; screen.hidden = true;
      screen.setAttribute('role', 'dialog'); screen.setAttribute('aria-modal', 'true'); screen.setAttribute('aria-labelledby', 'inspection-title');
      screen.innerHTML = `<div class="box inspection-box"><div class="inspection-head"><h2 id="inspection-title">Consulta</h2><button type="button" class="btn small" data-inspection-close>Cerrar</button></div><p class="inspection-note"></p><div class="inspection-content"></div></div>`;
      document.body.appendChild(screen);
      screen.querySelector('[data-inspection-close]').onclick = close;
      screen.addEventListener('keydown', e => {
        e.stopPropagation(); // native controls must not become combat shortcuts
        if (e.key !== 'Tab') return;
        const buttons = [...screen.querySelectorAll('button:not(:disabled), [tabindex="0"], select')].filter(b => b.getClientRects().length);
        const first = buttons[0], last = buttons.at(-1);
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last?.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus(); }
      });
    }
    if (screen.hidden) returnFocus = document.activeElement;
    screen.hidden = false;
    screen.querySelector('.inspection-note').textContent = G.Game.state === 'playing'
      ? G.Coop.active ? 'La partida en grupo continúa.' : 'Partida en pausa durante la consulta.' : '';
    render(screen.querySelector('.inspection-content'), source, options);
    screen.querySelector('[data-inspection-close]').focus();
    return true;
  }
  function hidePeek() {
    if (!peekScreen || peekScreen.hidden) return;
    release(peekScreen.querySelector('.peek-content')); peekScreen.hidden = true;
  }
  function peek(source, anchor, options = {}) {
    if (screen && !screen.hidden || !G.Tooltip.content(source)?.preview) return false;
    if (!peekScreen) {
      peekScreen = document.createElement('aside'); peekScreen.className = 'skill-peek'; peekScreen.hidden = true;
      peekScreen.inert = true; peekScreen.setAttribute('role', 'tooltip'); peekScreen.setAttribute('aria-hidden', 'true');
      peekScreen.innerHTML = `<div class="peek-head"><span>${G.T('Movimientos')}</span><span>${G.T('T · Explorar')}</span></div><div class="peek-content"></div>`;
      document.body.appendChild(peekScreen);
    }
    peekScreen.hidden = false;
    render(peekScreen.querySelector('.peek-content'), source, { ...options, compact: true });
    const { width: w, height: h } = peekScreen.getBoundingClientRect(), gap = 10;
    const clamp = (n, max) => Math.max(8, Math.min(n, max - 8));
    const points = [[anchor.right + gap, anchor.top], [anchor.left - w - gap, anchor.top], [anchor.left, anchor.top - h - gap], [anchor.left, anchor.bottom + gap]];
    const avoid = [anchor, ...(options.avoid || [])];
    const overlap = (x, y) => avoid.reduce((sum, r) => sum + Math.max(0, Math.min(x + w, r.right) - Math.max(x, r.left)) * Math.max(0, Math.min(y + h, r.bottom) - Math.max(y, r.top)), 0);
    const candidates = points.map(([x, y], i) => { x = clamp(x, innerWidth - w); y = clamp(y, innerHeight - h); return { x, y, score: overlap(x, y) + i }; });
    candidates.sort((a, b) => a.score - b.score);
    peekScreen.style.left = candidates[0].x + 'px'; peekScreen.style.top = candidates[0].y + 'px';
    return true;
  }
  return { render, release, open, close, peek, hidePeek, get peekOpen() { return !!peekScreen && !peekScreen.hidden; }, get isOpen() { return !!screen && !screen.hidden; } };
})();
