/* Saves and synchronization. Authentication belongs exclusively to G.Auth.
 * Offline copies use ps.cloud.<uid>; guest progress remains in memory.
 */
G.DB = (() => {
  const K_CLOUD = 'ps.cloud.';
  const VERSION = 3;
  const START_COINS = 500;
  const SDK = '/js/fb/';
  const VALID = /^[A-Za-z0-9_ñÑáéíóúÁÉÍÓÚ]{3,16}$/;

  let mode = 'local';       // 'cloud' | 'local'
  let localReason = '';     // por qué no hay nube: 'file' | 'config' | 'host' | 'error'
  let user = null;          // nombre visible
  let key = null;           // clave local (minúsculas) o uid de Firebase
  let guest = false;
  let accountVersion = 0, leaving = Promise.resolve();
  let save = null;
  let storageOk = true;

  // ---------------- almacenamiento local seguro ----------------

  function read(k) {
    try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : null; }
    catch (e) { storageOk = false; return null; }
  }
  function write(k, v) {
    const s = JSON.stringify(v);
    try { localStorage.setItem(k, s); return true; }
    catch (e) {
      // Navegador lleno (sobre todo por lo que guarda el ranking): se libera lo
      // prescindible y se reintenta. Antes la copia de la partida dejaba de
      // guardarse sin avisar y, al recargar, se volvía a la de la nube.
      try {
        for (let i = localStorage.length - 1; i >= 0; i--) {
          const key = localStorage.key(i);
          if (key && /^ps\.rk\.c\./.test(key)) localStorage.removeItem(key);
        }
        localStorage.setItem(k, s); return true;
      } catch (e2) { storageOk = false; return false; }
    }
  }
  function remove(k) { try { localStorage.removeItem(k); } catch (e) { /* nada */ } }

  // ---------------- partida ----------------

  function newSave(name) {
    return {
      v: VERSION,
      name,
      created: Date.now(),
      updated: Date.now(),    // última modificación (para fusionar)
      coins: START_COINS,
      owned: {},              // dex -> { at, from: 'starter'|'gacha'|'wild' }
      shiny: {},              // dex -> { at, from } — variantes shiny conseguidas
      partner: null,          // dex del Pokémon con el que juegas
      partnerShiny: false,    // jugar con su versión shiny (si la tienes)
      starter: null,          // dex que te tocó en el test
      personality: null,      // { trait, scores }
      upgrades: {},           // (antiguo) mejoras de la cuenta; ahora van por Pokémon
      pupg: {},               // dex -> { id -> nivel }: mejoras de cada Pokémon
      tickets: { t1: 0, t10: 0 },   // tickets del gacha (x1 y x10)
      pity: {},               // generación del banner -> tiradas sin ★5
      legends: {},            // dex -> fecha: legendarios vencidos en grietas
      arenas: {},             // tipo -> fecha: arenas de grieta ganadas
      itemsFound: {},         // id -> fecha: objetos equipables encontrados
      evoMoves: {},           // id -> fecha: movimientos evolucionados alguna vez
      ach: {},                // id -> fecha: logros conseguidos
      missions: {},           // misiones del día / semana (systems/progress.js)
      profile: { favs: [], title: '' },   // perfil público: 3 favoritos y título
      stats: { runs: 0, bestTime: 0, bestLevel: 0, totalKills: 0, pulls: 0, coinsEarned: 0, shinies: 0,
               bossesTotal: 0, riftWins: 0, evolutions: 0, missionsDone: 0, groupRuns: 0, bestGroupTime: 0 }
    };
  }

  /** Rellena campos que falten en partidas de versiones anteriores. */
  function migrate(s, name) {
    const base = newSave(name || s.name);
    for (const k in base) if (s[k] == null) s[k] = base[k];
    for (const k in base.stats) if (s.stats[k] == null) s.stats[k] = base.stats[k];
    // v1 -> v2: había un único banner (Kanto) con el pity como número.
    if (typeof s.pity === 'number') s.pity = { 1: s.pity };
    // v2 -> v3: las mejoras eran de la cuenta; pasan al compañero de entonces.
    if (!s.pupgDone) {
      if (s.partner && Object.values(s.upgrades || {}).some(v => v > 0)) {
        s.pupg[s.partner] = Object.assign({}, s.upgrades);
      }
      s.pupgDone = true;
    }
    s.tickets = Object.assign({ t1: 0, t10: 0 }, s.tickets);
    sanitize(s);
    s.v = VERSION;
    return s;
  }

  /**
   * Quita lo imposible de una partida editada a mano (la copia del navegador
   * se puede tocar): números negativos o raros, mejoras por encima del
   * máximo y Pokémon que no existen. Lo que sí sea posible lo frena el
   * servidor (firestore.rules, saves).
   */
  function sanitize(s) {
    const n = v => (Number.isFinite(+v) && +v > 0 ? Math.floor(+v) : 0);
    s.coins = n(s.coins);
    s.tickets.t1 = n(s.tickets.t1);
    s.tickets.t10 = n(s.tickets.t10);
    if (isObj(s.led)) {
      for (const dev of Object.keys(s.led)) {
        const e = s.led[dev];
        if (!isObj(e)) { delete s.led[dev]; continue; }
        for (const k of Object.keys(e)) {
          if (!CUR[k] || !Array.isArray(e[k])) { delete e[k]; continue; }
          e[k] = [n(e[k][0]), n(e[k][1])];
        }
      }
    } else delete s.led;
    if (G.DEX_BY) for (const coll of ['owned', 'shiny']) {
      for (const d of Object.keys(s[coll] || {})) if (!G.DEX_BY[d]) delete s[coll][d];
    }
    // Atajos: 4 huecos con un movimiento que exista (o null), sin repetir.
    if (s.pbind && typeof s.pbind === 'object') {
      for (const d of Object.keys(s.pbind)) {
        const l = Array.isArray(s.pbind[d]) ? s.pbind[d].slice(0, 4) : [];
        const seen = new Set();
        s.pbind[d] = [0, 1, 2, 3].map(i => {
          const id = l[i];
          if (typeof id !== 'string' || (G.Moves && !G.Moves.BY_ID[id]) || seen.has(id)) return null;
          seen.add(id); return id;
        });
      }
    } else s.pbind = {};
    // Veto: listas de movimientos que existen, sin repetir, como mucho 3.
    if (s.pban && typeof s.pban === 'object') {
      for (const d of Object.keys(s.pban)) {
        const l = Array.isArray(s.pban[d]) ? s.pban[d] : [];
        s.pban[d] = [...new Set(l.filter(id => typeof id === 'string' && (!G.Moves || G.Moves.BY_ID[id])))].slice(0, 3);
      }
    } else s.pban = {};
    if (G.Upgrades) for (const d of Object.keys(s.pupg || {})) {
      const u = s.pupg[d];
      if (!u || typeof u !== 'object') { delete s.pupg[d]; continue; }
      for (const id of Object.keys(u)) {
        if (!G.Upgrades.BY[id]) delete u[id];
        else u[id] = Math.min(G.Upgrades.BY[id].max, n(u[id]));
      }
    }
  }

  /**
   * Fusiona dos versiones de la misma partida (p. ej. una jugada sin
   * conexión y la de la nube). Nunca se pierde nada conseguido:
   *   - colecciones (owned, shiny): unión
   *   - mejoras y estadísticas: el máximo de cada una
   *   - monedas, compañero, pity...: los de la versión más reciente
   * Es idempotente: fusionar dos veces da lo mismo.
   */
  /*
   * LIBRETA de monedas y tickets (14-10-2026). Antes las monedas y los tickets
   * eran "los de la versión más reciente": si un aparato con datos viejos (el
   * móvil con la pestaña abierta de ayer) guardaba algo, su número ganaba y se
   * perdía lo conseguido en el otro (un jugador pasó de 36 tickets a 3).
   * Ahora cada aparato apunta en save.led[aparato] lo que ha ganado y gastado
   * de cada cosa ([ganado, gastado], sólo crecen) y el saldo es la suma de
   * todos: al fusionar se toma el mayor de cada apunte y no se pierde nada.
   *   led.base: el saldo que había antes de la libreta (o al empezar).
   *   led.old:  cambios de una versión anterior del juego (pestañas sin actualizar).
   */
  const CUR = {
    c: [s => s.coins, (s, v) => { s.coins = v; }],
    t1: [s => s.tickets.t1, (s, v) => { s.tickets.t1 = v; }],
    t10: [s => s.tickets.t10, (s, v) => { s.tickets.t10 = v; }]
  };
  // Este aparato (navegador): un nombre al azar que se queda guardado.
  const DEV = (() => {
    let d = read('ps.dev');
    if (typeof d !== 'string' || !/^[a-z0-9]{6,12}$/.test(d)) { d = 'd' + Math.random().toString(36).slice(2, 10); write('ps.dev', d); }
    return d;
  })();
  const num = v => (Number.isFinite(+v) && +v > 0 ? Math.floor(+v) : 0);
  const balOf = s => { const o = {}; for (const k in CUR) o[k] = num(CUR[k][0](s)); return o; };
  function ledSum(led, k) {
    let t = 0;
    for (const dev in led) { const e = led[dev] && led[dev][k]; if (e) t += num(e[0]) - num(e[1]); }
    return t;
  }
  function addTo(led, dev, k, d) {
    if (!d) return;
    const e = led[dev] = led[dev] || {};
    const p = e[k] = e[k] || [0, 0];
    if (d > 0) p[0] = num(p[0]) + d; else p[1] = num(p[1]) - d;
  }
  /** La libreta de una partida (sin tocarla); lo que no cuadre, a `dev`. */
  function ledOf(s, dev) {
    if (!isObj(s.led)) {
      const b = balOf(s), base = {};
      for (const k in CUR) base[k] = [b[k], 0];
      return { base };
    }
    const led = JSON.parse(JSON.stringify(s.led)), b = balOf(s);
    // Un saldo en negativo (lo mismo gastado en dos aparatos sin conexión) se ve como 0.
    for (const k in CUR) addTo(led, dev, k, b[k] - Math.max(0, ledSum(led, k)));
    return led;
  }
  /** Apunta en la libreta de ESTE aparato lo que ha cambiado desde la última vez. */
  function fold(s) {
    if (!s) return s;
    s.led = ledOf(s, DEV);
    return s;
  }

  function merge(a, b) {
    if (!a) return b;
    if (!b) return a;
    const newer = (a.updated || 0) >= (b.updated || 0) ? a : b;
    const older = newer === a ? b : a;
    const r = JSON.parse(JSON.stringify(newer));
    // Monedas y tickets: el mayor de cada apunte de cada aparato, y el saldo es la suma.
    const la = ledOf(a, 'old'), lb = ledOf(b, 'old'), led = {};
    for (const src of [la, lb]) for (const dev in src) for (const k in src[dev]) {
      const p = ((led[dev] = led[dev] || {})[k] = led[dev][k] || [0, 0]), q = src[dev][k];
      p[0] = Math.max(p[0], num(q[0])); p[1] = Math.max(p[1], num(q[1]));
    }
    r.led = led;
    r.tickets = r.tickets || { t1: 0, t10: 0 };
    for (const k in CUR) CUR[k][1](r, Math.max(0, ledSum(led, k)));
    for (const coll of ['owned', 'shiny']) {
      r[coll] = r[coll] || {};
      for (const k in older[coll] || {}) {
        if (!r[coll][k] || (older[coll][k].at || 0) < (r[coll][k].at || 0)) r[coll][k] = older[coll][k];
      }
    }
    for (const k in older.upgrades || {}) r.upgrades[k] = Math.max(r.upgrades[k] || 0, older.upgrades[k]);
    r.pupg = r.pupg || {};
    for (const d in older.pupg || {}) {
      const mine = r.pupg[d] = r.pupg[d] || {};
      for (const k in older.pupg[d]) mine[k] = Math.max(mine[k] || 0, older.pupg[d][k]);
    }
    r.pupgDone = r.pupgDone || older.pupgDone;
    // Lo conseguido nunca se pierde: unión de legendarios, arenas, objetos, logros...
    for (const coll of ['legends', 'arenas', 'itemsFound', 'evoMoves', 'ach']) {
      r[coll] = r[coll] || {};
      for (const k in older[coll] || {}) if (!r[coll][k]) r[coll][k] = older[coll][k];
    }
    // Misiones del mismo día/semana: el mayor progreso y lo ya recogido.
    const mo = older.missions || {}, mr = r.missions = r.missions || {};
    for (const [per, list] of [['day', 'daily'], ['week', 'weekly']]) {
      if (mr[per] !== mo[per] || !mr[list] || !mo[list]) continue;
      mr[list].forEach((m, i) => {
        const o = mo[list][i];
        if (!o || o.id !== m.id) return;
        m.prog = Math.max(m.prog || 0, o.prog || 0);
        m.claimed = m.claimed || o.claimed;
        m.told = m.told || o.told;
      });
    }
    for (const k in older.stats || {}) r.stats[k] = Math.max(r.stats[k] || 0, older.stats[k] || 0);
    if (r.starter == null) r.starter = older.starter;
    if (r.personality == null) r.personality = older.personality;
    if (r.partner == null || !r.owned[r.partner]) { r.partner = older.partner; r.partnerShiny = older.partnerShiny; }
    r.created = Math.min(a.created || Date.now(), b.created || Date.now());
    r.updated = Math.max(a.updated || 0, b.updated || 0);
    return r;
  }

  /** Sustituye el contenido de `save` sin cambiar el objeto (otros módulos lo tienen). */
  // Copia `s` sobre la partida SIN cambiar los objetos de dentro (mejoras,
  // Pokémon...): las pantallas abiertas guardan referencias a ellos. Antes se
  // sustituían y una compra hecha justo después de subir la partida se
  // apuntaba en la copia vieja: se cobraban las monedas y la mejora se perdía.
  const isObj = v => v && typeof v === 'object' && !Array.isArray(v);
  function assignDeep(dst, src) {
    for (const k of Object.keys(dst)) if (!(k in src)) delete dst[k];
    for (const k in src) {
      if (isObj(src[k]) && isObj(dst[k])) assignDeep(dst[k], src[k]);
      else dst[k] = src[k];
    }
  }
  function applyInPlace(s) { assignDeep(save, s); }

  let fs = null, rtdb = null, uid = null, unlisten = null;
  let pushT = 0, retryT = 0, pending = false, pushing = null, lastPush = 0;
  // Como mucho una subida cada 30 min (con miles de jugadores, cada 5 min
  // eran decenas de miles de escrituras por hora); lo que cuesta algo
  // (gacha, mejoras), a los 30 s. La copia local se guarda siempre al momento (y se fusiona con la
  // nube al volver a entrar), y al ocultar o cerrar la pestaña se sube lo pendiente.
  // Tras tiradas y compras se sube a los 3 min (era 30 s: quien hacía muchas tiradas
  // guardaba 2 veces por minuto y eran millones de escrituras al día). Lo hecho sigue
  // en la copia del navegador al momento, y se sube al salir de la pestaña.
  // Desde el 13-10-2026, lo normal cada 2 h (era 30 min: 216.000 jugadores al día
  // guardaban unas 12 millones de veces); al cerrar la pestaña, siempre; al
  // cambiar de pestaña, si hace más de 30 min.
  // Lo que vale algo (tiradas, compras, Pokémon nuevos, shinies, premios,
  // récords que entran en un top) se sube enseguida, y al acabar cada partida
  // como mucho cada 30 min:
  // con 2 h, quien abría el juego en otro aparato (o en el navegador de otra
  // app) veía la copia vieja de la nube y creía que lo había perdido.
  const PUSH_GAP = 2 * 3600 * 1000, PUSH_GAP_URGENT = 15 * 1000, PUSH_GAP_RUN = 30 * 60 * 1000, HIDE_GAP = 30 * 60 * 1000;
  let syncState = 'local';           // 'ok' | 'syncing' | 'pending' | 'offline' | 'local'
  const listeners = new Set();

  function setSync(s) { syncState = s; listeners.forEach(fn => { try { fn(s); } catch (e) { /* nada */ } }); }

  function loadScript(src) {
    return new Promise((res, rej) => {
      const el = document.createElement('script');
      el.src = src; el.async = true;
      el.onload = res; el.onerror = () => rej(new Error('No se pudo cargar ' + src));
      document.head.appendChild(el);
    });
  }

  async function initCloud() {
    if (!/^https?:$/.test(location.protocol)) { localReason = 'file'; return false; }
    await loadScript(SDK + 'firebase-app-compat.js');
    firebase.initializeApp({ apiBase: '/api', getUser: () => G.Auth.user, onUnauthorized: () => G.Auth.expire() });
    fs = firebase.firestore();
    rtdb = firebase.database();
    G.Auth.onChange(next => {
      if (!uid || next?.id === uid) return;
      accountVersion++;
      if (save && !guest) write(K_CLOUD + uid, save);
      stopListening(); clearTimeout(pushT); clearTimeout(retryT);
      firebase.sessionChanged();
      leaving = Promise.all(leaveHooks.map(fn => Promise.resolve(fn('session')).catch(() => {})));
      setSync('offline');
    });
    addEventListener('online', () => { if (pending) pushNow(); });
    // Al salir de la pestaña o cerrarla se sube lo pendiente, pero no más de una
    // vez cada 10 min: la gente cambia de pestaña a menudo y cada partida se
    // subía cada ~9 min en vez de cada 30 (12-10-2026, el mayor gasto de
    // Firebase). Lo que no se sube sigue en la copia de este navegador y se
    // sube al volver a entrar.
    const hideFlush = () => { if (pending && Date.now() - lastPush > HIDE_GAP) pushNow(); };
    let hiddenAt = 0;
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') { hiddenAt = Date.now(); hideFlush(); }
      else if (hiddenAt && Date.now() - hiddenAt > PULL_GAP) pullSoon();
    });
    // Al cerrar o recargar la página, lo pendiente se sube siempre.
    addEventListener('pagehide', () => { if (pending) pushNow(); });
    return true;
  }

  /*
   * Al volver al juego tras más de 30 min fuera (el móvil con la pestaña
   * abierta de ayer), se baja la partida de la nube y se junta con la de aquí
   * (1 lectura): así se ve lo conseguido en el otro aparato. En plena partida
   * se espera a volver al menú.
   */
  const PULL_GAP = 30 * 60 * 1000;
  let lastPull = 0, pullT = 0;
  function pullSoon() {
    clearTimeout(pullT);
    if (mode !== 'cloud' || guest || !save || !uid || Date.now() - lastPull < PULL_GAP) return;
    if (pushing || (G.Game && G.Game.state && G.Game.state !== 'ui')) { pullT = setTimeout(pullSoon, 20000); return; }
    lastPull = Date.now();
    const u = uid;
    docRef().get().then(snap => {
      if (!snap.exists || !save || uid !== u) return;
      applyInPlace(merge(plain(fold(save)), migrate(snap.data().save)));
      write(K_CLOUD + uid, save);
      if (G.UI && G.UI.refreshCoins) G.UI.refreshCoins();
    }).catch(e => console.warn('[DB] no se pudo bajar la partida:', e.code || e.message));
  }

  const docRef = () => fs.collection('saves').doc(uid);
  const plain = s => JSON.parse(JSON.stringify(s));      // Firestore no admite undefined

  /** Abre la partida de la nube de un usuario recién autenticado. */
  async function openCloud(u, opts = {}) {
    const version = ++accountVersion;
    uid = u.id;
    const cached = read(K_CLOUD + uid);
    let remote = null, online = true;
    try {
      const snap = await docRef().get();
      remote = snap.exists ? snap.data().save : null;
    } catch (e) {
      if (!cached) throw e;                // sin conexión y sin copia: no hay nada que abrir
      online = false;
    }
    if (version !== accountVersion || G.Auth.user?.id !== u.id) throw new Error('Session changed while opening save');
    let s = merge(cached && fold(migrate(cached)), remote && migrate(remote));
    if (!s) s = newSave(opts.name || u.name || 'Entrenador');
    const imported = takeImport();
    if (imported) s = applyImport(s, imported);
    save = fold(migrate(s, s.name));
    key = uid; user = save.name; guest = false;
    write(K_CLOUD + uid, save);
    lastPull = Date.now();
    // Sólo se sube si hay algo que la nube no tenga (cuenta nueva, progreso de
    // este ordenador sin subir...), y SIN esperar: antes el menú no salía hasta
    // terminar la subida, y con Firebase lento se tardaba hasta 9 s en entrar.
    // (Comparar el texto entero daba "distinto" casi siempre y se subía en cada
    // entrada: ahora sólo si esta copia es más nueva que la de la nube.)
    const same = remote && !imported && (!cached || (cached.updated || 0) <= (remote.updated || 0));
    lastPush = Date.now();       // la primera compra o ticket no sube al momento: espera como las demás
    if (!online) { pending = true; setSync('offline'); scheduleRetry(); }
    else if (same) setSync('ok');
    else pushNow();
  }

  /*
   * IMPORTAR una partida de pokesurvivor.com (importar/index.html la deja en
   * ps.import). Se aplica a la cuenta que entre a continuación en este
   * navegador: si la cuenta está recién creada (sin compañero), la partida
   * importada la sustituye entera; si ya tiene progreso, se fusionan como dos
   * aparatos de la misma cuenta, con lo importado como lo más reciente.
   */
  const K_IMPORT = 'ps.import';
  function takeImport() {
    const imp = read(K_IMPORT);
    remove(K_IMPORT);
    return imp && imp.save && typeof imp.save === 'object' ? imp : null;
  }
  function applyImport(s, imp) {
    const inc = migrate(JSON.parse(JSON.stringify(imp.save)), s.name);
    inc.updated = Date.now();
    const out = s.partner ? merge(s, inc) : Object.assign(inc, { created: s.created || inc.created });
    // Cuenta nueva: se queda con el apodo de pokesurvivor.com (Social lo reserva al entrar).
    // Con progreso, el apodo ya está reservado y no cambia.
    out.name = s.partner || !VALID.test(inc.name || '') ? s.name : inc.name;
    setTimeout(() => G.UI && G.UI.toast && G.UI.toast('Partida importada de pokesurvivor.com: ' +
      Object.keys(out.owned || {}).length + ' Pokémon, ' + (out.coins | 0) + ' monedas.', 5000), 1500);
    return out;
  }

  /*
   * Ya no se escucha el documento en vivo (cada cambio costaba una lectura).
   * Si juegas en dos ordenadores, las partidas se fusionan al entrar y en
   * cada subida (transacción con merge()).
   */
  function stopListening() { if (unlisten) { unlisten(); unlisten = null; } }

  /*
   * Si el admin ha baneado la cuenta del ranking (ban = true en la nube, ver
   * firestore.rules), cada guardado tiene que conservarlo: se copia de la nube.
   * Nunca se sube dos veces en menos de 65 s; mientras, todo está en el navegador.
   */
  const K_OK = 'ps.cloudok.', MIN_GAP = 65000;
  const sinceOk = () => Date.now() - (+read(K_OK + uid) || 0);

  /** Sube la partida fusionándola con lo que haya en la nube (transacción). */
  function pushNow() {
    if (mode !== 'cloud' || guest || !save || !uid || G.Auth.user?.id !== uid) return Promise.resolve();
    // Si ya hay una subida en marcha, se hace otra justo después (para lo que haya cambiado mientras).
    if (pushing) { pending = true; return pushing.then(() => (pending ? pushNow() : undefined)); }
    clearTimeout(pushT); pushT = 0; pushDue = 0;
    if (navigator.onLine === false) {
      pending = true; setSync('offline'); scheduleRetry();
      return Promise.resolve();
    }
    if (sinceOk() < MIN_GAP) {
      pending = true; setSync('pending');
      schedulePush(MIN_GAP - sinceOk() + 500);
      return Promise.resolve();
    }
    const version = accountVersion, saveUid = uid;
    pending = false;
    lastPush = Date.now();
    setSync('syncing');
    let merged = null;
    const tr = fs.runTransaction(async tx => {
      const ref = fs.collection('saves').doc(saveUid);
      const snap = await tx.get(ref);
      if (version !== accountVersion || uid !== saveUid || G.Auth.user?.id !== saveUid) throw new Error('Session changed while saving');
      const remote = snap.exists ? migrate(snap.data().save) : null;
      merged = remote ? merge(plain(fold(save)), remote) : plain(fold(save));
      const doc = { save: merged, updatedAt: firebase.firestore.FieldValue.serverTimestamp(), v: VERSION };
      if (snap.exists && snap.data().ban === true) doc.ban = true;
      tx.set(ref, doc);
    });
    // Si la red se cae a medias, Firestore puede quedarse esperando: tope de 12 s.
    const timeout = new Promise((_, rej) => setTimeout(() => rej({ code: 'unavailable' }), 12000));
    let failed = false;
    pushing = Promise.race([tr, timeout]).then(() => {
      if (version !== accountVersion) return;
      fails = 0;
      write(K_OK + uid, Date.now());
      // Se FUSIONA con lo de ahora (no se sobrescribe): si has cambiado algo
      // mientras se subía (elegir compañero, una compra...), no se pierde.
      if (merged && save) { applyInPlace(merge(plain(fold(save)), merged)); write(K_CLOUD + uid, save); }
      setSync(pending ? 'pending' : 'ok');
      if (G.UI && G.UI.refreshCoins) G.UI.refreshCoins();
    }).catch(e => {
      if (version !== accountVersion) return;
      console.warn('[DB] no se pudo sincronizar:', e.code || e.message);
      pending = true; failed = true;
      setSync(navigator.onLine === false || e.code === 'unavailable' ? 'offline' : 'pending');
      scheduleRetry();
    }).finally(() => {
      pushing = null;
      // (Si ha fallado, el reintento ya está programado con su espera creciente.)
      if (version === accountVersion && !failed && pending && syncState === 'pending') schedulePush(Math.max(1500, PUSH_GAP - (Date.now() - lastPush)));
    });
    return pushing;
  }

  // Si ya había una subida programada antes, se respeta (una compra no espera a la siguiente partida).
  let pushDue = 0;
  function schedulePush(ms) {
    const due = Date.now() + ms;
    if (pushT && pushDue && pushDue <= due) return;
    clearTimeout(pushT); pushDue = due;
    pushT = setTimeout(() => { pushT = 0; pushDue = 0; pushNow(); }, ms);
  }
  /**
   * Reintento con espera creciente: 15 s, 30 s, 1 min, 2 min... hasta 10 min.
   * Con muchos jugadores, reintentar siempre a los 15 s cuando Firebase falla
   * (cupo agotado, caída) multiplicaba las lecturas (pasó el 10-10-2026).
   */
  let fails = 0;
  function scheduleRetry() {
    const ms = Math.min(10 * 60e3, 15e3 * Math.pow(2, fails)) * (0.8 + Math.random() * 0.4);
    fails = Math.min(fails + 1, 8);
    clearTimeout(retryT);
    retryT = setTimeout(() => { if (pending) pushNow(); }, ms);
  }

  let readyP = null;
  function ready({ restore = true } = {}) {
    if (readyP) return readyP;
    readyP = (async () => {
      try { if (await initCloud()) mode = 'cloud'; }
      catch { localReason = 'error'; mode = 'local'; }
      const account = await G.Auth.ready();
      if (!restore || !account || mode !== 'cloud') return false;
      try { await openAccount(account); return true; }
      catch { setSync('offline'); return false; }
    })();
    return readyP;
  }
  async function openAccount(account) {
    if (!account || G.Auth.user?.id !== account.id) throw new Error('No authenticated account');
    await leaving;
    if (pushing) await pushing;
    mode = 'cloud';
    await openCloud(account);
    return { ok: true, isNew: !save.partner };
  }
  function playOffline() {
    const account = G.Auth.cached();
    const local = account && read(K_CLOUD + account.id);
    if (!local) return false;
    mode = 'local'; localReason = 'offline';
    uid = key = account.id; user = local.name; guest = false;
    save = fold(migrate(local)); setSync('local');
    return true;
  }

  /** Cambia el nombre que se ve en la partida (al elegir apodo). */
  function setName(n) {
    if (!save || guest) return;
    save.name = n; user = n;
    commit();
  }

  function playAsGuest() {
    user = 'Invitado'; key = null; guest = true; uid = null;
    save = newSave('Invitado');
    return { ok: true, isNew: true };
  }

  /**
   * Guarda la partida actual (no hace nada en modo invitado). En el navegador,
   * al momento; en la nube:
   * @param urgent  true: lo que vale algo (tiradas, compras, Pokémon, premios): enseguida
   *                'run': al acabar una partida (como mucho cada 30 min) · false: cada 2 h
   */
  function commit(urgent = false) {
    if (guest || !key || !save) return false;
    save.updated = Date.now();
    fold(save);
    if (mode === 'local' || G.Auth.user?.id !== uid) return write(K_CLOUD + key, save);
    write(K_CLOUD + uid, save);
    pending = true;
    setSync('pending');
    const gap = urgent === 'run' ? PUSH_GAP_RUN : urgent ? PUSH_GAP_URGENT : PUSH_GAP;
    schedulePush(Math.max(1200, gap - (Date.now() - lastPush)));
    return true;
  }

  /** Funciones que se ejecutan al cerrar sesión o borrar la cuenta (amigos, salas...). */
  const leaveHooks = [];

  async function logout() {
    if (!guest) {
      commit();
      if (mode === 'cloud' && G.Auth.user?.id === uid && pending) {
        try { await pushNow(); } catch { /* local copy preserved */ }
      }
    }
    for (const fn of leaveHooks) { try { await fn('logout'); } catch { /* disconnected */ } }
    if (!guest && mode === 'cloud') {
      try { await G.Auth.signOut(); }
      catch (error) { return { ok: false, error: G.Auth.errorMessage(error) }; }
    }
    accountVersion++;
    stopListening(); if (window.firebase) firebase.sessionChanged();
    clearTimeout(pushT); clearTimeout(retryT);
    user = key = save = uid = null; guest = false; pending = false;
    setSync('local');
    return { ok: true };
  }

  async function deleteAccount() {
    try {
      await G.Auth.deleteAccount();
      return { ok: true, pending: true };
    } catch (error) { return { ok: false, error: G.Auth.errorMessage(error) }; }
  }

  // ---------------- helpers de partida ----------------

  function owns(dex) { return !!(save && save.owned[dex]); }

  function grant(dex, from) {
    if (!save.owned[dex]) save.owned[dex] = { at: Date.now(), from };
  }

  function ownsShiny(dex) { return !!(save && save.shiny && save.shiny[dex]); }

  /** Mejoras compradas para un Pokémon: { id -> nivel }. */
  function upgradesOf(dex) {
    if (!save) return {};
    save.pupg = save.pupg || {};
    return save.pupg[dex] || (save.pupg[dex] = {});
  }

  /** Da la versión shiny (y la normal, si no la tenía). Devuelve true si es nueva. */
  function grantShiny(dex, from) {
    grant(dex, from);
    if (save.shiny[dex]) return false;
    save.shiny[dex] = { at: Date.now(), from };
    return true;
  }

  return {
    ready, openAccount, playOffline, playAsGuest, logout, commit, deleteAccount, flush: pushNow,
    owns, grant, ownsShiny, grantShiny, merge, setName, upgradesOf,
    onSync(fn) { listeners.add(fn); },
    onLeave(fn) { leaveHooks.push(fn); },
    /** Acceso de bajo nivel para los módulos de red (sólo en modo nube). */
    get fb() { return mode === 'cloud' ? { fs, rtdb, uid } : null; },
    /** ¿Está disponible lo online (amigos, ranking, multijugador)? */
    get online() { return mode === 'cloud' && !guest && !!uid && !!save && G.Auth.user?.id === uid; },
    get mode() { return mode; },
    get localReason() { return localReason; },
    get syncState() { return syncState; },
    get user() { return user; },
    get guest() { return guest; },
    get save() { return save; },
    get loggedIn() { return !!save; },
    get storageOk() { return storageOk; },
    START_COINS
  };
})();
