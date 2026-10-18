/* ============ updater.js — actualización manual desde el menú ============
 * Consulta version.json cada 5 min y al volver a la pestaña. Una versión
 * nueva sólo muestra el botón del menú principal; nunca recarga ni termina
 * partidas por su cuenta, tampoco si un manifiesto antiguo trae force:true.
 * Al pulsar, intenta subir lo pendiente antes de recargar. Si el jugador
 * sale del menú mientras espera, cancela la recarga y deja el botón disponible.
 * Sólo funciona en la web publicada (app.min.js?v=...), no en dev.html/file://.
 */
G.Updater = (() => {
  const EVERY = 5 * 60 * 1000;
  const tag = document.querySelector('script[src*="app.min.js?v="]');
  const mine = tag ? (tag.getAttribute('src').match(/v=([0-9a-f]+)/) || [])[1] : null;
  let pending = false, checking = false, updating = false, lastCheck = 0;
  let timer = 0, firstCheck = 0, button = null;

  async function check() {
    if (!mine || pending || checking) return;
    checking = true;
    lastCheck = Date.now();
    try {
      const r = await fetch('version.json?t=' + Date.now(), { cache: 'no-store' });
      if (!r.ok) return;
      const j = await r.json();
      if (j && typeof j.v === 'string' && j.v && j.v !== mine) {
        pending = true;
        if (button) button.classList.remove('hidden');
      }
    } catch (e) { /* sin red: se vuelve a consultar más tarde */ }
    finally { checking = false; }
  }

  function inMenu() {
    return G.Game && G.Game.state === 'ui' && G.UI.isOpen('scr-menu') &&
      !document.querySelector('.scr:not(.hidden):not(#scr-menu)');
  }

  async function apply() {
    if (!pending || updating || !inMenu()) return;
    updating = true;
    button.disabled = true;
    button.textContent = G.T('Actualizando…');
    button.setAttribute('aria-busy', 'true');
    let timeout;
    try {
      // El progreso ya está guardado en el navegador; si no hay conexión,
      // conserva esa copia y vuelve a intentar subirla al entrar.
      const dirty = G.DB.syncState && G.DB.syncState !== 'ok' && G.DB.syncState !== 'local';
      if (dirty) {
        try { await Promise.race([G.DB.flush(), new Promise(r => { timeout = setTimeout(r, 6000); })]); }
        catch (e) { /* queda la copia local */ }
      }
      if (inMenu()) location.reload();
    } finally {
      clearTimeout(timeout);
      updating = false;
      button.disabled = false;
      button.textContent = G.T('Actualizar juego');
      button.removeAttribute('aria-busy');
    }
  }

  function onVisibility() {
    if (document.visibilityState === 'visible' && Date.now() - lastCheck > 60000) check();
  }

  function init() {
    button = document.getElementById('btn-update');
    if (!button || !mine || !location.protocol.startsWith('http')) return;
    button.onclick = apply;
    button.classList.toggle('hidden', !pending);
    clearInterval(timer);
    clearTimeout(firstCheck);
    timer = setInterval(check, EVERY);
    document.removeEventListener('visibilitychange', onVisibility);
    document.addEventListener('visibilitychange', onVisibility);
    firstCheck = setTimeout(check, 30000);
  }

  return { init, check, get pending() { return pending; }, get version() { return mine; } };
})();
