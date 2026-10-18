/* Comparación breve mientras se juega. No captura movimiento ni apunta al mapa.
 * F confirma la opción marcada; en móvil se toca el mismo botón.
 */
G.ItemUI = (() => {
  let panel = null, selected = null, choice = null, lastHTML = '';
  const dismissed = new Set();
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const T = s => esc(G.T(s));

  function init() {
    panel = document.createElement('aside');
    panel.id = 'item-compare'; panel.className = 'hidden'; panel.setAttribute('translate', 'no');
    panel.setAttribute('aria-label', G.T('Objeto en el suelo'));
    panel.addEventListener('click', e => {
      if (e.target.closest('[data-dismiss-item]')) { dismiss(); return; }
      const option = e.target.closest('[data-item-option]');
      if (option) { choice = option.dataset.itemOption; lastHTML = ''; update(); }
      if (e.target.closest('[data-take-item]')) take();
    });
    document.body.appendChild(panel);
  }

  function reset() { selected = choice = null; dismissed.clear(); lastHTML = ''; if (panel) panel.classList.add('hidden'); }
  function swapped(left) { if (left) dismissed.add(left); selected = choice = null; lastHTML = ''; }
  function dismiss() { if (selected) dismissed.add(selected.id); selected = choice = null; if (panel) panel.classList.add('hidden'); }
  function take() { if (selected && choice) G.GroundItems.request(selected.id, choice); }

  function card(id, label) {
    const it = G.Items.BY[id];
    return `<div class="item-summary"><small>${T(label)}</small><div class="item-name">${G.Icons.html(id || 'ball', 24)}<b>${T(it ? it.name : 'Sin objeto')}</b></div><p>${T(it ? it.brief || it.desc : 'Puedes llevar un objeto.')}</p></div>`;
  }

  function update() {
    if (!panel) init();
    const pl = G.Game.player;
    if (!pl || G.Game.state !== 'playing' || pl.dead || G.Judgment.cinematic || G.SettingsUI.isOpen || G.UI.isOpen('scr-pause')) {
      panel.classList.add('hidden'); return;
    }
    const drops = G.GroundItems.all(pl);
    for (const id of dismissed) {
      const d = drops.find(d => d.id === id);
      if (!d || !G.GroundItems.within(d, pl, G.GroundItems.RANGE + 20)) dismissed.delete(id);
    }
    const available = drops.filter(d => !dismissed.has(d.id) && G.GroundItems.within(d, pl) && d.options.some(id => id !== pl.item));
    const previous = selected && available.find(d => d.id === selected.id);
    selected = previous || available.sort((a, b) => G.U.dist2(a.x, a.y, pl.x, pl.y) - G.U.dist2(b.x, b.y, pl.x, pl.y))[0] || null;
    if (!selected) { panel.classList.add('hidden'); return; }
    if (!previous || !selected.options.includes(choice) || choice === pl.item) choice = selected.options.find(id => id !== pl.item);
    const opts = selected.options.filter(id => id !== pl.item);
    const html = `<div class="item-heading"><span>${G.Icons.html('ball', 16)} ${T('Objeto en el suelo')}</span><button type="button" data-dismiss-item aria-label="${T('Cerrar')}">×</button></div>
      <div class="item-comparison">${card(pl.item, 'Equipado')}${card(choice, 'En el suelo')}</div>
      ${opts.length > 1 ? `<div class="item-options" role="group" aria-label="${T('Elige un objeto')}">${opts.map(id => `<button type="button" data-item-option="${id}" aria-pressed="${id === choice}">${G.Icons.html(id, 16)} ${T(G.Items.BY[id].name)}</button>`).join('')}</div>` : ''}
      <div class="item-actions"><small>${T(pl.item ? 'Tu objeto quedará en el suelo.' : 'Sólo se recoge al confirmar.')}</small><button class="btn small gold" type="button" data-take-item ${G.GroundItems.pending ? 'disabled' : ''}><kbd>F</kbd> ${T(G.GroundItems.pending ? 'Recogiendo…' : pl.item ? 'Cambiar objeto' : 'Recoger objeto')}</button></div>`;
    if (html !== lastHTML) { lastHTML = html; panel.innerHTML = html; }
    panel.classList.remove('hidden');
  }
  return { update, reset, swapped, dismiss, take, get open() { return !!panel && !panel.classList.contains('hidden'); } };
})();
