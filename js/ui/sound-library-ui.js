G.SoundLibraryUI = (() => {
  function mount(box) {
    const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const cues = Object.entries(G.SOUND_CUES).filter(([, cue]) => !cue.future);
    box.innerHTML = `<h3 class="set-h">Tu banda sonora</h3>
      <p class="sub">Asigna tus archivos de música y efectos a cada lugar. Se guardan sólo en este navegador.</p>
      <label for="sound-context">Lugar o acción</label>
      <select id="sound-context" class="field">${['music', 'sfx'].map(kind =>
        `<optgroup label="${G.T(kind === 'music' ? 'Música' : 'Efectos')}">${cues.filter(([, cue]) => cue.kind === kind)
          .map(([key, cue]) => `<option value="${key}">${esc(G.T(cue.label))}</option>`).join('')}</optgroup>`).join('')}</select>
      <p class="sound-file" translate="no"></p>
      <div class="row sound-actions">
        <button class="btn small" type="button" data-import>Elegir audio</button>
        <button class="btn small ghost" type="button" data-reset>Restaurar</button>
        <input type="file" accept="audio/*,.ogg,.wav,.mp3,.m4a" hidden>
      </div>
      <p class="note sound-status" role="status" aria-live="polite"></p>`;
    const select = box.querySelector('select'), input = box.querySelector('input');
    const importButton = box.querySelector('[data-import]'), reset = box.querySelector('[data-reset]');
    const status = box.querySelector('.sound-status');
    function refresh() {
      const record = G.SoundLibrary.get(select.value);
      const count = G.SoundLibrary.pool(select.value).length;
      box.querySelector('.sound-file').textContent = record ? record.name : count ? G.T('Pokémon: {x} temas en rotación').replace('{x}', count) : G.T('Sonido del juego');
      reset.disabled = !record;
    }
    function busy(on) { select.disabled = importButton.disabled = reset.disabled = on; }
    select.onchange = () => { status.textContent = ''; refresh(); };
    importButton.onclick = () => input.click();
    input.onchange = async () => {
      const file = input.files[0], key = select.value;
      if (!file) return;
      busy(true); status.textContent = G.T('Preparando audio…');
      try {
        await G.SoundLibrary.put(key, file);
        status.textContent = G.T('Audio guardado. Sonará en este lugar o acción.');
      } catch (error) {
        status.textContent = G.T(error.message === 'Invalid audio' ? 'No se pudo leer el audio. Prueba un archivo MP3, OGG o WAV.'
          : error.message === 'Audio too large' ? 'Usa música de hasta 32 MB o efectos de hasta 2 MB y 5 segundos.'
          : 'No se pudo guardar el audio en este navegador. El sonido anterior se conserva.');
      } finally { input.value = ''; busy(false); refresh(); }
    };
    reset.onclick = async () => {
      busy(true);
      try { await G.SoundLibrary.remove(select.value); status.textContent = G.T('Sonido del juego restaurado.'); }
      catch (_) { status.textContent = G.T('No se pudo guardar el audio en este navegador. El sonido anterior se conserva.'); }
      finally { busy(false); refresh(); }
    };
    busy(true);
    G.SoundLibrary.ready.then(() => { busy(false); refresh(); });
  }
  return { mount };
})();
