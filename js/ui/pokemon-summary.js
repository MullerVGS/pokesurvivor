/* Collection summary: the existing survivor stats and move pool, in FRLG sections.
 * Unknown entries expose no name, type, stats or moves. Browsing never picks a partner.
 */
G.PokemonSummary = (() => {
  function render(box, { mon, owned, shiny, hasShiny, usingThis, region, onShiny, onChoose }) {
    const initial = G.startMoveOf(mon.dex);
    const moves = [initial, ...G.Moves.poolFor(mon).filter(id => id !== initial)];
    const stat = (label, value, max, text) => `<div class="stat"><span>${label}</span><div class="bar"><i style="width:${Math.min(100, value / max * 100)}%"></i></div><span>${text}</span></div>`;
    const move = id => {
      const m = G.Moves.BY_ID[id];
      return `<button type="button" class="summary-move" data-summary-move="${id}" data-tip="move:${id}" data-tip-dex="${mon.dex}">
        <span class="summary-move-type">${G.UI.typeChips([m.type])}</span>${G.Icons.html('move:' + id, 20)}<span>${m.name}</span>
        ${id === initial ? '<small>Al empezar</small>' : ''}</button>`;
    };
    box.innerHTML = `<div class="summary-heading"><span>Datos del Pokémon</span><span>Nº ${String(mon.dex).padStart(3, '0')}</span></div>
      <div class="summary-body">
        <div class="summary-identity"><canvas id="dex-big" class="stage" width="180" height="140"></canvas>
          <div class="summary-name"><small>${region}</small><h3>${owned ? mon.name : '???'}</h3>
            ${owned ? G.UI.typeChips(mon.types) : ''}
            <p class="summary-rarity">${G.UI.stars(mon.rarity, 24)} ${G.Gacha.RARITY_NAME[mon.rarity]}</p>
          </div></div>
        ${hasShiny ? `<div class="seg" aria-label="${G.T('Apariencia')}"><button type="button" class="${shiny ? '' : 'on'}" data-v="0" aria-pressed="${!shiny}">Normal</button><button type="button" class="${shiny ? 'on' : ''}" data-v="1" aria-pressed="${shiny}">${G.Icons.html('shiny', 12)} Shiny</button></div>` : ''}
        ${owned ? `<h4 class="summary-section">Características</h4>
          ${stat('Vida', mon.hp, 183, mon.hp)}${stat('Ataque', mon.atk, 1.55, '×' + mon.atk.toFixed(2))}${stat('Velocidad', mon.spd, 137, mon.spd)}
          <h4 class="summary-section">Movimientos disponibles</h4>
          <p class="summary-help">Selecciona un movimiento para ver su efecto.</p>
          <div class="summary-moves">${moves.map(move).join('')}</div>`
          : `<p class="summary-unknown">Aún no lo tienes.<br>Consíguelo en el banner de <b class="gold">${region}</b> o derrotándolo cuando salga shiny.</p>`}
      </div>
      ${owned ? `<div class="summary-footer"><button id="dex-pick" type="button" class="btn ${usingThis ? '' : 'gold'}" data-sfx="confirm" ${usingThis ? 'disabled' : ''}>${usingThis ? 'Es tu compañero' : 'Elegir de compañero' + (shiny ? ' (shiny)' : '')}</button></div>` : ''}`;
    const canvas = box.querySelector('#dex-big');
    canvas.style.setProperty('--stage-c', !owned ? '#90a898' : shiny ? '#6898a8' : G.U.TYPE_COLOR[mon.types[0]]);
    canvas.classList.toggle('shiny', owned && shiny);
    G.UI.sprite(canvas, mon.dex, { lively: owned, spin: owned, silhouette: !owned, scale: 3, hero: true, shiny: owned && shiny });
    box.querySelectorAll('.seg button').forEach(button => { button.onclick = () => onShiny(button.dataset.v === '1'); });
    box.querySelectorAll('[data-summary-move]').forEach(button => {
      button.onclick = () => {
        button.focus({ preventScroll: true });
        G.Tooltip.show('move:' + button.dataset.summaryMove, { dex: mon.dex });
      };
    });
    const pick = box.querySelector('#dex-pick');
    if (pick && !usingThis) pick.onclick = onChoose;
  }
  return { render };
})();
