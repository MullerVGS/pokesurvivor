/* ============ view.js — campo de visión (Ajustes > Gráficos) ============
 * Cuánto mundo se ve: el ancho visible de la cámara (G.Camera.view) va de MIN
 * a MAX en pasos de STEP; el de siempre es VIEW_W (768). Se guarda en este
 * dispositivo (G.Settings 'view') y se aplica en el acto, también en mitad de
 * la partida. En el móvil el máximo baja a MAX_TOUCH: con la pantalla pequeña
 * y más vista, los Pokémon se verían diminutos.
 *
 * Los enemigos salen justo fuera de la vista (spawner.js), así que con más
 * vista nacen más lejos. Cooperativo: cada uno ve con la suya y la manda en su
 * estado (coop.js); el anfitrión mira la de cada jugador (reach / seen) para
 * que nadie vea nacer ni desaparecer a un enemigo.
 */
G.View = (() => {
  const MIN = 640, MAX = 1100, MAX_TOUCH = 960, STEP = 32;

  /** Valores del deslizador: de MIN de STEP en STEP, y el máximo al final. */
  function steps() {
    const top = G.Settings.touch ? MAX_TOUCH : MAX, out = [];
    for (let v = MIN; v < top; v += STEP) out.push(v);
    out.push(top);
    return out;
  }

  /** El ancho guardado, llevado al paso más cercano (y al tope del móvil). */
  function value() {
    const v = +G.Settings.get('view') || G.Camera.VIEW_W;
    return steps().reduce((a, b) => Math.abs(b - v) < Math.abs(a - v) ? b : a);
  }

  const pct = v => Math.round(v / G.Camera.VIEW_W * 100) + '%';

  /** Pasa el ancho a la cámara y la reajusta al tamaño actual del canvas. */
  function apply() {
    G.Camera.view = value();
    const cv = document.getElementById('game');
    if (cv && cv.clientWidth) G.Camera.resize(cv.clientWidth, cv.clientHeight, G.Camera.dpr);
  }

  // ---------------- quién ve qué ----------------

  /** Radio de la vista de un jugador: la tuya, o la que manda un compañero. */
  function reach(o) { return (o && o.remote && o.net && o.net.vr) || G.Camera.outerRadius(); }

  /** ¿Cae el punto dentro de la vista (radio + pad) de alguno de `list`? */
  function seen(list, x, y, pad = 0) {
    return list.some(o => { const r = reach(o) + pad; return G.U.dist2(o.x, o.y, x, y) < r * r; });
  }

  // ---------------- Ajustes ----------------

  /** Fila de Ajustes > Gráficos (la pinta settings-ui.js). */
  function row() {
    const vs = steps(), v = value();
    return `<div class="set-row"><div class="grow"><b>Campo de visión</b><small>Cuánto mapa se ve a tu alrededor. Con más, todo se ve más pequeño y los enemigos salen más lejos.</small></div>
      <span class="gold" id="set-view-pct">${pct(v)}</span></div>
      <input type="range" id="set-view" style="margin:8px 0 12px" min="0" max="${vs.length - 1}" step="1" value="${vs.indexOf(v)}">`;
  }

  function wire(box) {
    const r = box.querySelector('#set-view');
    if (!r) return;
    // Sin volver a pintar la pantalla (se perdería el arrastre): sólo el porcentaje.
    r.oninput = () => { const v = steps()[+r.value]; G.Settings.set('view', v); box.querySelector('#set-view-pct').textContent = pct(v); };
    r.onchange = () => G.Audio.sfx('click');
  }

  G.Settings.on(k => { if (k === 'view') apply(); });
  G.Camera.view = value();

  return { reach, seen, row, wire, apply, steps, MIN, MAX, MAX_TOUCH };
})();
