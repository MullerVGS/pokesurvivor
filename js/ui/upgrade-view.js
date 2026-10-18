/* Read-only presentation of permanent bonuses, using the same perks as the player. */
G.UpgradeView = (() => {
  const EFFECTS = {
    hp: ['hp', '+{x} vida'], atk: ['atkMul', '+{x}% daño', 'gain'],
    spd: ['spdMul', '+{x}% velocidad', 'gain'], cd: ['cdMul', '-{x}% recarga', 'reduction'],
    def: ['dmgReduce', '+{x}% defensa', 'percent'], regen: ['regen', '+{x} vida/s'],
    magnet: ['magnetMul', '+{x}% recogida', 'gain'], xp: ['xpMul', '+{x}% experiencia', 'gain'],
    coins: ['coinMul', '+{x}% Pokémonedas', 'gain'], moves: ['startMoves', '{x} movimientos iniciales'],
    crit: ['crit', '+{x}% de críticos', 'percent'], reroll: ['rerolls', '{x} cambios extra por run'],
    ban: ['bans', 'Hasta {x} movimientos vetados']
  };
  function effect(id, levels) {
    const [key, text, format] = EFFECTS[id];
    let value = G.Upgrades.perks(levels)[key];
    if (format === 'gain') value = (value - 1) * 100;
    if (format === 'reduction') value = (1 - value) * 100;
    if (format === 'percent') value *= 100;
    return G.I18n.f(text, String(Math.round(value * 10) / 10));
  }
  function progress(upgrade, levels) {
    const level = levels[upgrade.id] || 0, maxed = level >= upgrade.max;
    const next = { ...levels, [upgrade.id]: level + 1 };
    return `<div class="upg-progress"><span><small>Actual</small><b>${effect(upgrade.id, levels)}</b></span>
      ${maxed ? '<span class="upg-max">Nivel máximo</span>' : `<span class="upg-arrow" aria-hidden="true">→</span><span><small>Siguiente</small><b>${effect(upgrade.id, next)}</b></span>`}</div>`;
  }
  return { progress };
})();
