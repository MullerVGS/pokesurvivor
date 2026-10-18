/* Local, opt-in exploration fixture. Fresh guest only; normal combat rules. */
G.BiomePreview = {
  start() {
    if (!/\/dev\.html$/.test(location.pathname) || new URLSearchParams(location.search).get('preview') !== 'biomes') return false;
    G.DB.playAsGuest();
    G.DB.save.partner = G.DB.save.starter = 25;
    const en = G.I18n.lang === 'en', label = (es, english) => en ? english : es;
    const panel = document.createElement('details');
    panel.id = 'biome-preview'; panel.open = true;
    panel.style.cssText = 'position:fixed;z-index:250;left:8px;top:26%;width:min(260px,calc(100vw - 16px));padding:10px;background:#fffbe8;color:#303840;border:3px solid #586870;border-radius:6px;font:18px PokemonGen3,monospace;box-shadow:2px 3px #18283080';
    panel.innerHTML = `<summary style="cursor:pointer">${label('Vista previa de biomas','Biome preview')}</summary>
      <form style="display:grid;gap:7px;margin-top:10px">
        <label style="color:#303840">Seed <input name="seed" type="number" min="0" max="2147483647" step="1" value="4242" style="width:120px"></label>
        <label style="color:#303840">${label('Bioma','Biome')} <select name="biome" style="width:100%"></select></label>
        <button class="btn" type="submit">${label('Visitar en una nueva partida','Visit in a new run')}</button>
        <output aria-live="polite"></output>
        <small>${label('Invitado · combate normal. Pliega este panel para explorar.','Guest · normal combat. Collapse this panel to explore.')}</small>
      </form>`;
    const form = panel.querySelector('form'), select = form.elements.biome, output = panel.querySelector('output');
    for (const biome of G.Biomes.all) select.add(new Option(en ? biome.english : biome.name, biome.id));
    form.addEventListener('submit', async event => {
      event.preventDefault();
      if (!form.reportValidity()) return;
      const button = form.querySelector('button');button.disabled = true;
      output.textContent = label('Buscando una zona despejada…','Finding a clear area…');
      try {
        const seed = Number(form.elements.seed.value), id = select.value;
        const sampler = G.Regions.create(seed), index = G.Biomes.byId[id].index;
        let site = id === 'grassland' ? {x: 0, y: 0} : null;
        G.Game.startRun();G.World.reset(seed);
        // Search progressively, keeping input responsive even for distant regions.
        for (let radius = 12; radius <= 720*G.Regions.SCALE && !site; radius += 12) {
          for (let y = -radius; y <= radius && !site; y += 12) for (let x = -radius; x <= radius; x += 12) {
            if (Math.abs(x) !== radius && Math.abs(y) !== radius) continue;
            if (sampler.sample(x,y).biome !== index || sampler.sample(x,y).terrain !== 0) continue;
            if (![[8,0],[-8,0],[0,8],[0,-8]].every(([dx,dy]) => sampler.sample(x+dx,y+dy).biome === index)) continue;
            const px = x*G.World.TS+16, py = y*G.World.TS+16;
            if (G.World.isFree(px,py,14)) { site = {x:px,y:py};break; }
          }
          if (!site) await new Promise(resolve => setTimeout(resolve,0));
        }
        if (!site) { output.textContent = label('No se encontró una zona despejada. Prueba otra seed.','No clear area found. Try another seed.');return; }
        G.EnemyMgr.clear();G.Game.player.x = site.x;G.Game.player.y = site.y;
        G.Camera.x = site.x;G.Camera.y = site.y;G.World.focus(site.x,site.y,0,true);
        output.textContent = `${seed} · ${Math.floor(site.x/G.World.TS)}, ${Math.floor(site.y/G.World.TS)}`;
      } finally { button.disabled = false; }
    });
    // Keep panel clicks and keys out of the combat shortcuts underneath it.
    for (const event of ['keydown','keyup','pointerdown','pointerup']) panel.addEventListener(event,e => e.stopPropagation());
    document.body.appendChild(panel);
    form.requestSubmit();
    return true;
  }
};
