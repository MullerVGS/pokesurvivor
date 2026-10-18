/* Opt-in dev preview. Uses a fresh guest save; never grants to a real account. */
G.CollectionPreview = {
  start() {
    if (!/\/dev\.html$/.test(location.pathname) || new URLSearchParams(location.search).get('preview') !== 'collection') return false;
    G.DB.playAsGuest();
    const save = G.DB.save, at = Date.now();
    for (const mon of G.DEX) {
      save.owned[mon.dex] = { at, from: 'starter' };
      if (G.Sprites.hasShiny(mon.dex)) save.shiny[mon.dex] = { at, from: 'wild' };
    }
    save.partner = save.starter = 25;
    // Avoid queuing a notification for every collection milestone in this fixture.
    for (const achievement of G.AchDefs.LIST) {
      if (achievement.value(save) >= achievement.goal) save.ach[achievement.id] = at;
    }
    G.Flow.goMenu();
    return true;
  }
};
