/* ============ menu.js — menú principal, colección y mejoras ============ */
G.MenuUI = (() => {
  const $ = G.UI.$;
  const GEN_NAMES = ['Kanto', 'Johto', 'Hoenn', 'Sinnoh', 'Teselia', 'Kalos', 'Alola', 'Galar', 'Paldea'];
  let dexFilter = 'all', dexTypes = [], dexAdvanced = false, dexGen = 1, dexSel = null;
  const MAX_TYPES = Math.max(...G.DEX.map(mon => mon.types.length));

  function init() {
    const ICON = { play: 'ball', dex: 'book', upgrades: 'up', gacha: 'ball4', goals: 'medal3', friends: 'friends', rank: 'trophy', settings: 'gear' };
    document.querySelectorAll('#scr-menu [data-go]').forEach(b => {
      b.insertAdjacentHTML('afterbegin', `<span class="mi-ico">${G.Icons.html(ICON[b.dataset.go], 26)}</span>`);
      b.dataset.sfx = b.dataset.go === 'play' ? 'confirm' : 'click';
      b.onclick = () => {
        const go = b.dataset.go;
        if (go === 'play') { if (G.Social.room) G.LobbyUI.open(); else G.Flow.play(); }
        else if (go === 'dex') openDex();
        else if (go === 'upgrades') openUpgrades();
        else if (go === 'gacha') G.GachaUI.open();
        else if (go === 'goals') G.GoalsUI.open();
        else if (go === 'friends') G.FriendsUI.open();
        else if (go === 'rank') G.RankingUI.open();
        else if (go === 'settings') G.SettingsUI.open();
      };
    });
    document.querySelectorAll('[data-back]').forEach(b => { b.onclick = open; });
    G.Social.on(() => { if (G.UI.isOpen('scr-menu')) socialLine(); });
    $('btn-logout').onclick = () => {
      if (G.DB.guest && !confirm('Eres invitado: se perderá todo el progreso. ¿Salir?')) return;
      G.Audio.music(null);
      G.DB.logout().then(r => { if (r.ok) G.Flow.toLogin(); else G.UI.toast(r.error); });
    };
  }

  // ---------------- menú principal ----------------

  function open() {
    const s = G.DB.save;
    const mon = G.DEX_BY[s.partner];
    const shiny = !!s.partnerShiny && G.DB.ownsShiny(mon.dex);
    G.UI.chrome(true);
    G.UI.show('scr-menu');
    G.UI.sprite($('menu-partner'), mon.dex, { lively: true, scale: 4, hero: true, shiny });
    $('menu-partner').style.setProperty('--stage-c', shiny ? '#9ae6ff' : G.U.TYPE_COLOR[mon.types[0]]);
    $('menu-partner').classList.toggle('shiny', shiny);
    $('menu-partner-name').innerHTML = mon.name + (shiny ? ' ' + G.Icons.html('shiny', 24) : '');
    $('menu-partner-info').innerHTML = G.UI.typeChips(mon.types) + ' ' + G.UI.stars(mon.rarity);
    // Normal / shiny a mano, aquí mismo (en el móvil no se encontraba en la ficha).
    const seg = $('menu-shiny');
    seg.classList.toggle('hidden', !G.DB.ownsShiny(mon.dex));
    seg.lastChild.innerHTML = G.Icons.html('shiny', 12) + ' Shiny';
    seg.querySelectorAll('button').forEach(b => {
      b.classList.toggle('on', (b.dataset.v === '1') === shiny);
      b.onclick = () => {
        if ((b.dataset.v === '1') === shiny) return;
        s.partnerShiny = b.dataset.v === '1';
        G.DB.commit();
        G.Audio.sfx('confirm');
        open();
      };
    });

    const owned = Object.keys(s.owned).filter(d => G.DEX_BY[d]).length;
    const shinies = Object.keys(s.shiny || {}).length;
    $('menu-dex-count').textContent = `${owned} / ${G.DEX.length}` + (shinies ? ` · ${shinies} shiny` : '');

    const st = s.stats;
    $('menu-stats').innerHTML =
      `Runs <b style="color:var(--ink)">${st.runs}</b> · Mejor tiempo <b style="color:var(--ink)">${G.U.mmss(st.bestTime)}</b><br>` +
      `Mejor nivel <b style="color:var(--ink)">${st.bestLevel}</b> · Derrotados <b style="color:var(--ink)">${st.totalKills.toLocaleString('es')}</b>` +
      (G.DB.guest ? '<br><span style="color:var(--red)">Modo invitado: no se guarda</span>' : '');

    socialLine();
    // Premios de misiones por recoger.
    G.Progress.checkAch();
    const pend = G.Progress.pending();
    $('menu-goals-sub').textContent = pend ? pend + (pend === 1 ? ' premio por recoger' : ' premios por recoger') : 'Misiones, logros y perfil';
    $('menu-goals-sub').classList.toggle('gold', pend > 0);
    // Con cuenta en la nube: amigos en línea, invitaciones y (una vez) el apodo.
    if (G.DB.online && !G.Social.started) {
      G.Social.start().then(r => {
        if (r === 'need-nick' && !G.NickUI.skipped && G.UI.isOpen('scr-menu')) G.NickUI.open();
        socialLine();
      });
    }
    G.InvitePop.refresh();
  }

  /** Texto bajo "Amigos" y "Jugar": quién está en línea, solicitudes, sala. */
  function socialLine() {
    const room = G.Social.room;
    const play = document.querySelector('#scr-menu [data-go=play] small');
    if (play) play.textContent = room ? 'Volver a tu sala (' + room.members.length + '/' + G.Social.MAX_PLAYERS + ')' : 'Entra en la mazmorra';
    const fr = G.Social.friends;
    const on = fr.filter(f => f.status === 'ok' && f.online).length;
    const req = fr.filter(f => f.status === 'in').length;
    const parts = [];
    if (on) parts.push(on + ' en línea');
    if (req) parts.push(req + (req === 1 ? ' solicitud' : ' solicitudes'));
    $('menu-friends-sub').textContent = parts.length ? parts.join(' · ') : 'Juega en grupo, hasta 4';
    $('menu-friends-sub').classList.toggle('gold', req > 0);
  }

  // ---------------- colección ----------------

  function collection({ gen = dexGen, filter = dexFilter, types = dexTypes } = {}) {
    const save = G.DB.save;
    return G.DEX.filter(mon => mon.gen === gen && types.every(type => mon.types.includes(type))
      && (filter !== 'own' || save.owned[mon.dex])
      && (filter !== 'miss' || !save.owned[mon.dex])
      && (filter !== 'shiny' || save.shiny?.[mon.dex])
      && (!/^\d$/.test(filter) || mon.rarity === +filter));
  }

  function renderTypes() {
    const toggle = $('dex-type-toggle'), options = $('dex-type-options');
    toggle.setAttribute('aria-expanded', dexAdvanced);
    toggle.onclick = () => { dexAdvanced = !dexAdvanced; renderTypes(); };
    options.hidden = !dexAdvanced;
    $('dex-type-selection').textContent = dexTypes.map(type => G.T(G.U.TYPE_NAME[type])).join(' + ')
      + (dexTypes.length ? ` (${dexTypes.length}/${MAX_TYPES})` : '');
    const clear = $('dex-type-clear');
    clear.hidden = !dexTypes.length;
    clear.onclick = () => { dexTypes = []; openDex(); toggle.focus({ preventScroll: true }); };
    const candidates = collection();
    options.innerHTML = '';
    for (const [type, name] of Object.entries(G.U.TYPE_NAME)) {
      const selected = dexTypes.includes(type);
      const atLimit = dexTypes.length >= MAX_TYPES;
      const available = candidates.some(mon => mon.types.includes(type));
      const button = document.createElement('button');
      button.type = 'button'; button.className = 'dex-type-option' + (selected ? ' on' : '');
      button.dataset.type = type; button.dataset.sfx = 'select';
      button.setAttribute('aria-label', G.T(name)); button.setAttribute('aria-pressed', selected);
      button.disabled = !selected && (atLimit || !available);
      button.title = G.T(name) + (button.disabled ? ' · ' + G.T(atLimit ? 'Máximo dos tipos' : 'Sin coincidencias') : '');
      button.innerHTML = G.TypeIcons.html(type, 28);
      button.onclick = () => {
        if (button.disabled) return;
        dexTypes = selected ? dexTypes.filter(t => t !== type) : [...dexTypes, type];
        openDex(); options.querySelector(`[data-type="${type}"]`).focus({ preventScroll: true });
      };
      options.appendChild(button);
    }
  }

  function openDex() {
    G.UI.show('scr-dex', true);
    const s = G.DB.save;
    if (dexSel == null && !$('dex-grid').dataset.view) { dexSel = s.partner; dexGen = G.DEX_BY[s.partner].gen; }
    const owned = Object.keys(s.owned).filter(d => G.DEX_BY[d]).length;
    $('dex-total').textContent = `${owned} / ${G.DEX.length}`;

    // Pestañas de generación, con cuántos tienes de cada una.
    const tabs = $('dex-gens');
    tabs.innerHTML = '';
    GEN_NAMES.forEach((name, i) => {
      const g = i + 1;
      const total = G.DEX.filter(p => p.gen === g).length;
      const have = G.DEX.filter(p => p.gen === g && s.owned[p.dex]).length;
      const b = document.createElement('button');
      b.className = 'gen-tab' + (g === dexGen ? ' on' : '');
      b.innerHTML = `<b>${name}</b><small>${have}/${total}</small>`;
      b.setAttribute('aria-pressed', g === dexGen);
      b.disabled = dexTypes.length > 0 && !collection({ gen: g }).length;
      b.onclick = () => { dexGen = g; openDex(); $('dex-gens').children[i].focus({ preventScroll: true }); };
      tabs.appendChild(b);
    });

    const F = [['all', 'Todos'], ['own', 'Tengo'], ['miss', 'Me faltan'], ['shiny', 'Shiny'],
               ['5', 5], ['4', 4], ['3', 3], ['2', 2], ['1', 1]];
    const fb = $('dex-filters');
    fb.innerHTML = '';
    for (const [k, label] of F) {
      const c = document.createElement('button');
      c.className = 'chip' + (k === dexFilter ? ' on' : '');
      c.dataset.filter = k; c.setAttribute('aria-pressed', k === dexFilter);
      c.disabled = dexTypes.length > 0 && !collection({ filter: k }).length;
      c.innerHTML = k === 'shiny' ? G.Icons.html('shiny', 12) + ' Shiny'
                  : typeof label === 'number' ? G.Icons.rarity(label, 12) + ' ' + G.Gacha.RARITY_NAME[label] : label;
      c.onclick = () => { dexFilter = k; openDex(); $('dex-filters').querySelector('.on').focus({ preventScroll: true }); };
      fb.appendChild(c);
    }
    renderTypes();
    renderGrid();
    if (dexSel != null) showDetail(dexSel);
    else {
      $('dex-detail').innerHTML = '<div class="summary-heading">Datos del Pokémon</div><div class="summary-body"><p class="summary-unknown">Ninguno con estos filtros.</p><button type="button" class="btn small" id="dex-clear">Limpiar filtros</button></div>';
      $('dex-clear').onclick = () => { dexFilter = 'all'; dexTypes = []; openDex(); $('dex-type-toggle').focus(); };
    }
  }

  function renderGrid() {
    const s = G.DB.save;
    const grid = $('dex-grid');
    const view = dexGen + ':' + dexFilter + ':' + [...dexTypes].sort().join(','), scrollTop = grid.dataset.view === view ? grid.scrollTop : 0;
    grid.dataset.view = view;
    grid.innerHTML = '';
    for (const p of collection()) {
      const own = !!s.owned[p.dex], sh = !!s.shiny?.[p.dex];

      const cell = document.createElement('button');
      cell.type = 'button'; cell.dataset.dex = p.dex;
      cell.tabIndex = p.dex === dexSel ? 0 : -1;
      cell.setAttribute('aria-pressed', p.dex === dexSel);
      cell.setAttribute('aria-label', (own ? p.name : '???') + ', Nº ' + p.dex);
      cell.className = 'cell' + (own ? '' : ' locked') + (p.dex === dexSel ? ' on' : '');
      cell.insertAdjacentHTML('beforeend', `<span class="no">${String(p.dex).padStart(3, '0')}</span>`);
      if (p.dex === s.partner) cell.insertAdjacentHTML('beforeend', `<span class="badge-r" title="Compañero">${G.Icons.html('crown', 14)}</span>`);
      else if (sh) cell.insertAdjacentHTML('beforeend', `<span class="badge-r" title="Tienes su shiny">${G.Icons.html('shiny', 12)}</span>`);
      const useShiny = sh && p.dex === s.partner && s.partnerShiny;
      cell.appendChild(G.UI.spriteCanvas(p.dex, 92, 80, { scale: 2, silhouette: !own, shadow: own, shiny: useShiny }));
      cell.insertAdjacentHTML('beforeend', `<b>${own ? p.name : '???'}</b>${G.UI.stars(p.rarity, 9)}`);
      if (own) cell.dataset.tip = 'mon:' + p.dex;
      cell.onclick = () => {
        dexSel = p.dex;
        grid.querySelectorAll('.cell').forEach(c => { c.classList.remove('on'); c.tabIndex = -1; c.setAttribute('aria-pressed', 'false'); });
        cell.classList.add('on'); cell.tabIndex = 0; cell.setAttribute('aria-pressed', 'true');
        showDetail(p.dex);
      };
      grid.appendChild(cell);
    }
    grid.scrollTop = scrollTop;
    const cells = [...grid.querySelectorAll('.cell')];
    if (!cells.some(c => +c.dataset.dex === dexSel)) dexSel = cells.length ? +cells[0].dataset.dex : null;
    const selected = cells.find(c => +c.dataset.dex === dexSel);
    if (selected) { selected.tabIndex = 0; selected.classList.add('on'); selected.setAttribute('aria-pressed', 'true'); }
    $('dex-matches').textContent = String(cells.length);
    $('dex-results-label').textContent = cells.length === 1 ? 'resultado' : 'resultados';
    grid.onkeydown = e => {
      if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(e.key)) return;
      const cells = [...grid.querySelectorAll('.cell')], index = cells.indexOf(document.activeElement);
      if (index < 0) return;
      const columns = getComputedStyle(grid).gridTemplateColumns.split(' ').length;
      const offset = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -columns, ArrowDown: columns }[e.key];
      const next = e.key === 'Home' ? 0 : e.key === 'End' ? cells.length - 1 : Math.max(0, Math.min(cells.length - 1, index + offset));
      e.preventDefault(); cells[next].focus(); cells[next].click();
    };
    if (!grid.children.length) grid.innerHTML = '<p class="sub" style="grid-column:1/-1">Ninguno con estos filtros.</p>';
  }

  // Variante que se está viendo en la ficha (normal o shiny).
  let viewShiny = false;

  function showDetail(dex) {
    const s = G.DB.save;
    const p = G.DEX_BY[dex];
    const own = !!s.owned[dex];
    const hasSh = G.DB.ownsShiny(dex);
    const isPartner = dex === s.partner;
    if (!hasSh) viewShiny = false;
    else if (isPartner && dex !== showDetail.last) viewShiny = !!s.partnerShiny;
    showDetail.last = dex;

    G.PokemonSummary.render($('dex-detail'), {
      mon: p, owned: own, shiny: viewShiny, hasShiny: hasSh,
      usingThis: isPartner && (!hasSh || !!s.partnerShiny === viewShiny), region: GEN_NAMES[p.gen - 1],
      onShiny(value) {
        viewShiny = value; showDetail(dex);
        $('dex-detail').querySelector('.seg .on').focus({ preventScroll: true });
      },
      onChoose() {
        s.partner = dex;
        s.partnerShiny = hasSh && viewShiny;
        G.DB.commit();
        G.UI.toast(p.name + (s.partnerShiny ? ' shiny' : '') + ' es ahora tu compañero');
        renderGrid(); showDetail(dex);
        $('dex-grid').querySelector('.cell.on')?.focus({ preventScroll: true });
      }
    });
  }

  // ---------------- mejoras ----------------

  let upgDex = null;

  function openUpgrades() {
    G.UI.show('scr-upgrades', true);
    const s = G.DB.save;
    if (!upgDex || !s.owned[upgDex]) upgDex = s.partner;
    // Selector con tus Pokémon: el compañero primero, luego los que ya tienen mejoras.
    const sel = $('upg-mon');
    const lv = d => Object.values(s.pupg[d] || {}).reduce((a, b) => a + b, 0);
    const mons = Object.keys(s.owned).map(Number).filter(d => G.DEX_BY[d])
      .sort((a, b) => (b === s.partner) - (a === s.partner) || lv(b) - lv(a) || a - b);
    sel.innerHTML = mons.map(d => `<option value="${d}">${G.DEX_BY[d].name}${d === s.partner ? ' (compañero)' : ''}${lv(d) ? ' · ' + lv(d) + ' niveles' : ''}</option>`).join('');
    sel.value = upgDex;
    sel.onchange = () => { upgDex = +sel.value; G.Audio.sfx('select'); renderUpgrades(); };
    renderUpgrades();
  }

  function renderUpgrades() {
    const active = document.activeElement, oldList = $('upg-list');
    const oldRow = active?.closest('[data-upgrade]');
    const focus = oldList.contains(active) ? {
      upgrade: oldRow?.dataset.upgrade,
      action: active.hasAttribute('data-buy') ? '[data-buy]' : active.hasAttribute('data-ban') ? '[data-ban]' :
        active.hasAttribute('data-slot') ? `[data-slot="${active.dataset.slot}"]` : active.hasAttribute('data-id') ? `[data-id="${active.dataset.id}"]` : null
    } : null;
    const body = $('scr-upgrades').querySelector('.dialog-body'), scroll = body.scrollTop;
    const s = G.DB.save;
    const levels = G.DB.upgradesOf(upgDex);
    const mon = G.DEX_BY[upgDex];
    const shiny = upgDex === s.partner && !!s.partnerShiny && G.DB.ownsShiny(upgDex);
    G.UI.sprite($('upg-stage'), upgDex, { lively: true, scale: 2, hero: true, shiny });
    $('upg-stage').style.setProperty('--stage-c', shiny ? '#9ae6ff' : G.U.TYPE_COLOR[mon.types[0]]);
    $('upg-name').textContent = mon.name;
    $('upg-types').innerHTML = G.UI.typeChips(mon.types);
    $('upg-balance').textContent = String(s.coins);
    const box = $('upg-list');
    box.innerHTML = '';
    for (const u of G.Upgrades.LIST) {
      const lvl = levels[u.id] || 0;
      const maxed = lvl >= u.max;
      const cost = maxed ? 0 : G.Upgrades.cost(u.id, lvl);
      const el = document.createElement('div');
      el.className = 'panel upg-item';
      el.dataset.upgrade = u.id; el.tabIndex = -1;
      el.dataset.tip = 'upg:' + u.id + ':' + upgDex;
      const reason = maxed ? 'Nivel máximo' : s.coins < cost ? G.I18n.f('Faltan {x} Pokémonedas', cost - s.coins) : 'Disponible';
      el.innerHTML = `
        <div class="upg-title"><span class="ic">${G.Icons.html(u.icon, 24)}</span>
          <h4>${u.name}</h4><span class="upg-level">Nv. ${lvl}/${u.max}</span></div>
        ${G.UpgradeView.progress(u, levels)}
        <div class="pips" aria-hidden="true">${Array.from({ length: u.max }, (_, i) => `<i class="${i < lvl ? 'on' : ''}"></i>`).join('')}</div>
        <div class="upg-actions"><small class="upg-status" id="upg-status-${u.id}">${reason}</small>
          <div class="upg-btns">
            ${u.id === 'ban' && lvl > 0 ? `<button type="button" class="btn small" data-ban>Elegir (${banList().length}/${lvl})</button>` : ''}
            <button type="button" class="btn small ${maxed ? '' : 'gold'}" data-buy data-sfx="none" aria-describedby="upg-status-${u.id}" ${maxed || s.coins < cost ? 'disabled' : ''}>
            ${maxed ? 'Máx.' : `Mejorar · <span class="coin"></span> ${cost}`}</button>
          </div></div>`;
      el.querySelector('[data-buy]').setAttribute('aria-label', maxed ? G.T(u.name) + ' · ' + G.T('Nivel máximo')
        : G.I18n.f('Mejorar {x} a nivel {x} por {x} Pokémonedas', G.T(u.name), lvl + 1, cost));
      if (u.id === 'ban' && lvl > 0) el.querySelector('[data-ban]').onclick = () => { banOpen = !banOpen; renderUpgrades(); };
      el.querySelector('[data-buy]').onclick = () => {
        // Se vuelve a leer todo al pulsar (la partida puede haber cambiado desde que se dibujó).
        const sv = G.DB.save, lv = G.DB.upgradesOf(upgDex), now = lv[u.id] || 0;
        if (now >= u.max) { renderUpgrades(); return; }
        const price = G.Upgrades.cost(u.id, now);
        if (sv.coins < price) { renderUpgrades(); return; }
        sv.coins -= price;
        lv[u.id] = now + 1;
        G.DB.commit(true);
        G.Audio.sfx('buy');
        G.UI.refreshCoins();
        G.UI.toast(`${mon.name} · ${u.name}: nivel ${now + 1}`);
        renderUpgrades();
      };
      box.appendChild(el);
      if (u.id === 'ban' && lvl > 0 && banOpen) box.appendChild(banPicker(lvl));
    }
    box.appendChild(bindPanel());
    if (focus?.action) {
      const row = focus.upgrade ? box.querySelector(`[data-upgrade="${focus.upgrade}"]`) : box;
      const target = row?.querySelector(focus.action);
      (target && !target.disabled ? target : row)?.focus({ preventScroll: true });
    }
    body.scrollTop = scroll;
  }

  // ---------------- atajos: hueco fijo para cada movimiento ----------------
  // save.pbind[dex] = [movimiento del hueco 1, del 2, del 3, del 4] (o null).
  function bindPanel() {
    const s = G.DB.save;
    s.pbind = s.pbind || {};
    const list = s.pbind[upgDex] || [null, null, null, null];
    const mon = G.DEX_BY[upgDex];
    const ids = G.Moves.poolFor(mon).concat([G.startMoveOf(upgDex)]).filter((v, i, a) => a.indexOf(v) === i)
      .sort((a, b) => G.Moves.BY_ID[a].name.localeCompare(G.Moves.BY_ID[b].name, 'es'));
    const el = document.createElement('div');
    el.className = 'panel bind-panel';
    el.innerHTML = `<h3>Atajos de movimientos</h3>
      <p class="sub" style="margin:2px 0 8px">Elige qué movimiento va siempre en cada hueco (teclas 1-4 o los iconos de abajo), para la memoria muscular. Si aún no tienes tantos movimientos, va al hueco más cercano.</p>
      <div class="bind-slots">${[0, 1, 2, 3].map(i => `<label class="bind-slot"><span>${i + 1}</span>
        <select class="field" data-slot="${i}"><option value="">Libre</option>${ids.map(id =>
          `<option value="${id}" ${list[i] === id ? 'selected' : ''}>${G.Moves.BY_ID[id].name}</option>`).join('')}</select></label>`).join('')}</div>`;
    el.querySelectorAll('select[data-slot]').forEach(sel => {
      sel.onchange = () => {
        const l = (s.pbind[upgDex] || [null, null, null, null]).slice(0, 4);
        while (l.length < 4) l.push(null);
        const i = +sel.dataset.slot, id = sel.value || null;
        // Un movimiento sólo puede estar en un hueco.
        for (let j = 0; j < 4; j++) if (id && l[j] === id) l[j] = null;
        l[i] = id;
        s.pbind[upgDex] = l;
        G.DB.commit();
        G.Audio.sfx('select');
        renderUpgrades();
      };
    });
    return el;
  }

  // ---------------- veto: movimientos bloqueados ----------------
  // Lista por Pokémon en save.pban[dex]; con N niveles de Veto, N movimientos.
  let banOpen = false;
  function banList() {
    const s = G.DB.save;
    s.pban = s.pban || {};
    return s.pban[upgDex] || (s.pban[upgDex] = []);
  }
  function banPicker(max) {
    const mon = G.DEX_BY[upgDex];
    const start = G.startMoveOf(upgDex);
    const ids = G.Moves.poolFor(mon).filter(id => id !== start)
      .sort((a, b) => G.Moves.BY_ID[a].name.localeCompare(G.Moves.BY_ID[b].name, 'es'));
    const list = banList();
    const el = document.createElement('div');
    el.className = 'panel ban-picker';
    el.innerHTML = `<p class="sub" style="margin:0 0 8px">Toca los movimientos que no quieres que te salgan en las cartas (${list.length}/${max}). El movimiento de inicio no se puede vetar.</p>
      <div class="ban-moves">${ids.map(id => { const d = G.Moves.BY_ID[id]; const on = list.includes(id);
        return `<button class="chip ${on ? 'on ban' : ''}" data-id="${id}" data-tip="move:${id}">${G.Icons.html('move:' + id, 16)} ${d.name}${on ? ' ' + G.Icons.html('ban', 14) : ''}</button>`; }).join('')}</div>`;
    el.querySelectorAll('[data-id]').forEach(b => {
      b.onclick = () => {
        const l = banList(), id = b.dataset.id, i = l.indexOf(id);
        if (i >= 0) l.splice(i, 1);
        else if (l.length >= max) { G.UI.toast('Ya tienes ' + max + ' vetados: quita uno primero'); return; }
        else l.push(id);
        G.DB.commit();
        G.Audio.sfx('select');
        renderUpgrades();
      };
    });
    return el;
  }

  return { init, open, GEN_NAMES };
})();
