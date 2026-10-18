/* Equipo en el suelo: sólo el anfitrión confirma recogidas y cambios.
 * Una recompensa con varias opciones sigue siendo UN objeto: al elegir,
 * desaparecen sus alternativas. Las recompensas de evento son personales;
 * el equipo que se deja al cambiar es compartido.
 * El snapshot en cada envío reconcilia tanto el suelo como el equipo local.
 */
G.GroundItems = (() => {
  const RANGE = 72;
  let drops = [], nextId = 1, gear = {}, applied = 0, pending = null;
  const authority = () => !G.Coop.active || G.Coop.isHost;
  const uid = p => p.uid || 'solo';
  const space = () => G.World.arena ? 'arena:' + G.World.arena.tx + ':' + G.World.arena.ty : 'world';
  const options = ids => [...new Set((Array.isArray(ids) ? ids : [ids]).filter(id => G.Items.BY[id]))];

  function reset() { drops = []; nextId = 1; gear = {}; applied = 0; pending = null; }

  function drop(ids, x, y, owner = null) {
    if (!authority()) return null;
    const choices = options(ids);
    if (!choices.length) return null;
    const d = { id: nextId++, options: choices, x, y, owner, space: space() };
    drops.push(d);
    return d;
  }

  function offer(ids, pl = G.Game.player) {
    if (!pl || !authority()) return;
    return drop(ids, pl.x, pl.y, uid(pl));
  }

  function reward(ids) {
    if (authority()) for (const p of G.Game.everyone()) offer(ids, p);
  }

  function visible(d, pl) { return d.space === space() && (!d.owner || d.owner === uid(pl)); }
  function within(d, pl, radius = RANGE) { return G.U.dist2(d.x, d.y, pl.x, pl.y) <= radius * radius; }
  function all(pl = G.Game.player) { return pl ? drops.filter(d => visible(d, pl)) : []; }

  // Terminado un encuentro en otra arena, sus objetos vuelven con el grupo.
  function update() {
    if (authority() && space() === 'world') {
      const players = G.Game.everyone();
      for (const d of drops) if (d.space !== 'world') {
        const p = players.find(p => uid(p) === d.owner) || players[0];
        if (p) { d.x = p.x; d.y = p.y; d.space = 'world'; }
      }
    }
    if (pending && (performance.now() - pending.at > 2000 || !drops.some(d => d.id === pending.id))) pending = null;
  }

  function applyEquipment(record) {
    if (!record || record.rev <= applied) return;
    const pl = G.Game.player;
    if (!pl) return;
    applied = record.rev;
    if (pl.item !== record.item) pl.equip(record.item);
    pending = null;
    if (G.ItemUI) G.ItemUI.swapped(record.left);
    G.Audio.sfx('confirm');
    G.Progress.event('item', { id: record.item });
  }

  /** Atómico en el anfitrión: validar, quitar del suelo, dejar el anterior, equipar. */
  function take(pl, id, choice) {
    if (!authority() || !pl || G.Game.state !== 'playing' || G.Judgment.cinematic || pl.dead || pl.net?.dead || pl.net?.ch) return false;
    const d = drops.find(d => d.id === id);
    // La posición recibida es más reciente que la interpolación del compañero.
    const pos = pl.remote && pl.net ? pl.net : pl;
    if (!d || !visible(d, pl) || !within(d, pos) || !d.options.includes(choice)) return false;
    const key = uid(pl), previous = gear[key];
    const old = pl.remote ? previous?.item : pl.item;
    if (old === choice) return false;
    drops = drops.filter(o => o !== d);
    const left = old ? drop(old, d.x, d.y) : null;
    const record = gear[key] = { item: choice, rev: (previous?.rev || 0) + 1, left: left?.id || null };
    if (pl === G.Game.player) applyEquipment(record);
    else pl.item = choice;
    return true;
  }

  function request(id, choice) {
    const pl = G.Game.player;
    if (!pl || pending || pl.dead || G.Game.state !== 'playing' || G.UI.isOpen('scr-pause') || G.SettingsUI.isOpen) return false;
    if (authority()) return take(pl, id, choice);
    pending = { id, at: performance.now() };
    G.Coop.toHost(['ground-take', id, choice]);
    return true;
  }

  function snapshot() { return { drops, gear }; }
  function receive(s) {
    if (authority() || !s || !Array.isArray(s.drops) || !s.gear) return;
    drops = s.drops;
    gear = s.gear;
    applyEquipment(gear[uid(G.Game.player)]);
    update();
  }

  function draw(ctx) {
    const pl = G.Game.player;
    if (!pl || G.Game.state === 'ui') return;
    const time = performance.now() / 1000;
    for (const d of all(pl)) {
      if (!G.Camera.sees(d.x, d.y, 40)) continue;
      ctx.save();
      ctx.globalAlpha = 0.3; ctx.fillStyle = '#1b1528';
      ctx.fillRect(d.x - 12, d.y - 3, 24, 6);
      const y = d.y - 16 - Math.abs(Math.sin(time * 2 + d.id)) * 3;
      ctx.globalAlpha = G.Settings.get('calm') ? 0.28 : 0.26 + Math.sin(time * 3 + d.id) * 0.09;
      ctx.fillStyle = '#ffd23f'; ctx.fillRect(d.x - 17, y - 17, 34, 34);
      ctx.globalAlpha = 1;
      G.Icons.draw(ctx, d.options[0], d.x - 12, y - 12, 24);
      if (d.options.length > 1) G.Icons.draw(ctx, 'ball', d.x + 8, y + 6, 12);
      if (!G.Settings.get('calm')) G.Icons.twinkle(ctx, d.x + 16, y - 12, (time * 0.7 + d.id * 0.13) % 1, 2);
      if (within(d, pl)) {
        ctx.strokeStyle = '#fff2b0'; ctx.lineWidth = 2;
        ctx.strokeRect(d.x - 20, y - 20, 40, 40);
      }
      ctx.restore();
    }
  }

  return { RANGE, reset, drop, offer, reward, all, within, update, take, request, snapshot, receive, draw,
    get pending() { return !!pending; } };
})();
