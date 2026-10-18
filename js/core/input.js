/* ============ input.js — teclado y ratón (el táctil está en touch.js) ============ */
G.Input = (() => {
  const down = new Set();
  const pressed = new Set();   // se limpia cada frame
  let mx = 0, my = 0, mdown = false;

  const MOVE_KEYS = {
    up: ['keyw', 'arrowup'], down: ['keys', 'arrowdown'],
    left: ['keya', 'arrowleft'], right: ['keyd', 'arrowright']
  };

  let wheel = 0, wheelDir = 0, wheelAt = 0, wheelSum = 0;
  addEventListener('wheel', e => {
    if (e.target.id !== 'game' || e.ctrlKey || e.metaKey || !G.Game || G.Game.state !== 'playing' ||
        G.SettingsUI.isOpen || G.UI.isOpen('scr-pause') || G.Judgment.cinematic || G.Tooltip.holds()) return;
    if (!e.deltaY) return;
    e.preventDefault();
    const now = performance.now(), dir = Math.sign(e.deltaY);
    if (now - wheelAt > 180 || dir !== wheelDir) wheelSum = 0;
    wheelAt = now; wheelDir = dir;
    wheelSum += Math.abs(e.deltaY) * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? innerHeight : 1);
    if (wheelSum >= 40) { wheel = dir; wheelSum = 0; }
  }, { passive: false });

  function code(e) { return (e.code || e.key).toLowerCase(); }

  addEventListener('keydown', e => {
    const c = code(e);
    if (!down.has(c)) pressed.add(c);
    down.add(c);
    // Evita que el navegador haga scroll con flechas/espacio durante el juego.
    if (['arrowup', 'arrowdown', 'arrowleft', 'arrowright', 'space', 'tab'].includes(c)) e.preventDefault();
  });
  addEventListener('keyup', e => down.delete(code(e)));
  addEventListener('blur', () => { down.clear(); });
  addEventListener('mousemove', e => { mx = e.clientX; my = e.clientY; });
  addEventListener('mousedown', () => mdown = true);
  addEventListener('mouseup', () => mdown = false);

  return {
    /** Vector de movimiento del jugador (teclado o joystick táctil). */
    axis() {
      const t = G.Touch && G.Touch.vector();
      if (t && (t[0] || t[1])) return t;
      let x = 0, y = 0;
      if (MOVE_KEYS.left.some(k => down.has(k))) x -= 1;
      if (MOVE_KEYS.right.some(k => down.has(k))) x += 1;
      if (MOVE_KEYS.up.some(k => down.has(k))) y -= 1;
      if (MOVE_KEYS.down.some(k => down.has(k))) y += 1;
      return G.U.norm(x, y);
    },
    held(c) { return down.has(c); },
    /** true sólo en el frame en que se pulsó. */
    tap(c) { return pressed.has(c); },
    mouse() { return { x: mx, y: my, down: mdown }; },
    wheel() { return wheel; },
    endFrame() { pressed.clear(); wheel = 0; }
  };
})();
