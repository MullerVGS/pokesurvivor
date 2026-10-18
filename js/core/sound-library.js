/* Personal audio stays on this device, outside saves and multiplayer sync. */
G.SoundLibrary = (() => {
  const records = new Map(), listeners = new Set(), positions = new Map();
  const eras = ['gba', 'ds', 'gb'];
  let eraIndex = -1, area = null;
  try {
    const saved = localStorage.getItem('ps.sound-era') ?? localStorage.getItem('ps.presentation');
    const index = Number(saved);
    if (saved !== null && Number.isInteger(index) && index >= 0 && index < eras.length) eraIndex = index;
  } catch (_) { /* Rotation also works without persistent storage. */ }
  const era = () => eras[Math.max(0, eraIndex)];
  function enter(name) {
    if (!['village', 'forest', 'cave', 'volcano', 'city', 'gym', 'pokestop'].includes(name) || name === area) return;
    area = name; eraIndex = (eraIndex + 1) % eras.length;
    try { localStorage.setItem('ps.sound-era', eraIndex); } catch (_) { /* ephemeral rotation */ }
  }
  let db = null;
  const ready = new Promise(resolve => {
    try {
      const req = indexedDB.open('ps.sound-library', 1);
      req.onupgradeneeded = () => req.result.createObjectStore('sounds', { keyPath: 'key' });
      req.onerror = req.onblocked = () => resolve();
      req.onsuccess = () => {
        db = req.result;
        db.onversionchange = () => { db.close(); db = null; };
        const tx = db.transaction('sounds'), read = tx.objectStore('sounds').getAll();
        read.onsuccess = () => {
          for (const record of read.result) if (G.SOUND_CUES[record.key]) records.set(record.key, record);
        };
        tx.oncomplete = tx.onabort = tx.onerror = () => resolve();
      };
    } catch (_) { resolve(); }
  });

  async function write(key, record) {
    await ready;
    if (!G.SOUND_CUES[key]) throw new Error('Unknown sound context');
    if (!db) throw new Error('Audio storage unavailable');
    await new Promise((resolve, reject) => {
      const tx = db.transaction('sounds', 'readwrite');
      const store = tx.objectStore('sounds');
      if (record) store.put(record); else store.delete(key);
      tx.oncomplete = resolve;
      tx.onabort = tx.onerror = () => reject(tx.error || new Error('Audio storage failed'));
    });
    if (record) records.set(key, record); else records.delete(key);
    listeners.forEach(fn => fn(key));
  }

  function pool(key) {
    const personal = records.get(key);
    return personal ? [personal] : (G.SOUND_PACK?.[key] || []);
  }
  function candidates(key) {
    const all = pool(key), themed = all.filter(record => record.era === era());
    return themed.length ? themed : all;
  }
  function pick(key) {
    const tracks = candidates(key), group = key + ':' + era();
    const position = positions.get(group) || 0;
    positions.set(group, position + 1);
    return tracks[position % tracks.length];
  }
  return {
    ready,
    enter, get era() { return era(); },
    get: key => records.get(key),
    pool, pick,
    effect: key => candidates(key)[0],
    onChange(fn) { listeners.add(fn); },
    async put(key, file) {
      await G.Audio.validateFile(key, file);
      await write(key, { key, file, name: file.name });
    },
    remove: key => write(key, null)
  };
})();
