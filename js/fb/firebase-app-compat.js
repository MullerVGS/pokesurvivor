/* ============ firebase-app-compat.js — Firebase "de mentira" contra nuestro servidor ============
 * El juego habla con Firebase a través del SDK compat (firebase.auth(),
 * firebase.firestore(), firebase.database()). Este archivo da esa misma API
 * (sólo lo que usa el juego) pero contra el servidor propio (server/):
 *
 *   auth       POST /api/auth/*  · sesión en localStorage (psfb.auth)
 *   firestore  POST /api/fs/*    · onSnapshot por WebSocket
 *   database   WebSocket /api/ws (salas y señalización del cooperativo)
 *
 * Así el resto del código del juego no cambia. Lo carga js/core/db.js cuando
 * G.FIREBASE_CONFIG.sdk apunta a esta carpeta. Los otros tres archivos de la
 * carpeta están vacíos: todo vive aquí.
 */
(() => {
  if (window.firebase && window.firebase.__self) return;

  let cfg = null;
  const apiBase = () => (cfg && cfg.apiBase) || '/api';
  const err = (code, message) => Object.assign(new Error(message || code), { code });

  // ---------------- sesión ----------------

  const K_AUTH = 'psfb.auth';
  let session = null;                 // { token, uid, email }
  try { session = JSON.parse(localStorage.getItem(K_AUTH) || 'null'); } catch (e) { session = null; }
  function saveSession(s) {
    session = s;
    try { if (s) localStorage.setItem(K_AUTH, JSON.stringify(s)); else localStorage.removeItem(K_AUTH); } catch (e) { /* nada */ }
    Live.reauth();
  }

  async function call(route, body, authCall) {
    let r;
    try {
      r = await fetch(apiBase() + '/' + route, {
        method: 'POST', cache: 'no-store',
        headers: Object.assign({ 'content-type': 'application/json' }, session ? { authorization: 'Bearer ' + session.token } : {}),
        body: JSON.stringify(body || {})
      });
    } catch (e) { throw err(authCall ? 'auth/network-request-failed' : 'unavailable', e.message); }
    let j = {};
    try { j = await r.json(); } catch (e) { /* sin cuerpo */ }
    if (!r.ok) throw err(j.code || (r.status >= 500 ? 'unavailable' : 'unknown'), j.message);
    return j;
  }

  // ---------------- valores (marcas de hora) ----------------

  class Timestamp {
    constructor(ms) { this._ms = ms; this.seconds = Math.floor(ms / 1000); this.nanoseconds = (ms % 1000) * 1e6; }
    toMillis() { return this._ms; }
    toDate() { return new Date(this._ms); }
    valueOf() { return this._ms; }
    toJSON() { return { __ts: this._ms }; }
    static now() { return new Timestamp(Date.now()); }
    static fromMillis(ms) { return new Timestamp(ms); }
  }
  class Sentinel { constructor(kind) { this.kind = kind; } }

  function enc(v) {
    if (v instanceof Sentinel) return { __sv: v.kind };
    if (v instanceof Timestamp) return { __ts: v._ms };
    if (v instanceof Date) return { __ts: v.getTime() };
    if (Array.isArray(v)) return v.map(enc);
    if (v && typeof v === 'object') {
      const o = {};
      for (const k of Object.keys(v)) if (v[k] !== undefined) o[k] = enc(v[k]);
      return o;
    }
    return v;
  }
  function dec(v) {
    if (Array.isArray(v)) return v.map(dec);
    if (v && typeof v === 'object') {
      if (typeof v.__ts === 'number' && Object.keys(v).length === 1) return new Timestamp(v.__ts);
      const o = {};
      for (const k of Object.keys(v)) o[k] = dec(v[k]);
      return o;
    }
    return v;
  }

  // ---------------- conexión en vivo (WebSocket) ----------------

  const Live = (() => {
    let ws = null, ready = false, authed = false, wanted = false, backoff = 1000, timer = 0;
    let seq = 0;
    const queue = [];                    // mensajes esperando a estar conectado
    const pending = new Map();           // rid -> { msg, res, rej }
    const subs = new Map();              // id -> { msg, on(m) }
    const ods = new Map();               // path -> msg de onDisconnect (se repiten al reconectar)

    function url() {
      const b = apiBase();
      if (/^wss?:/.test(b)) return b + '/ws';
      const u = new URL(b + '/ws', location.href);
      u.protocol = u.protocol === 'https:' ? 'wss:' : 'ws:';
      return u.href;
    }

    function connect() {
      if (ws || !session) return;
      wanted = true;
      try { ws = new WebSocket(url()); } catch (e) { ws = null; return retry(); }
      ws.onopen = () => { ready = true; backoff = 1000; ws.send(JSON.stringify({ t: 'auth', token: session ? session.token : '' })); };
      ws.onmessage = e => {
        let m;
        try { m = JSON.parse(e.data); } catch (x) { return; }
        if (m.t === 'auth') {
          authed = true;
          for (const s of subs.values()) raw(s.msg);
          for (const o of ods.values()) raw(o);
          for (const p of pending.values()) raw(p.msg);
          while (queue.length) raw(queue.shift());
          return;
        }
        if (m.t === 'rtr') {
          const p = pending.get(m.rid);
          if (!p) return;
          pending.delete(m.rid);
          if (m.ok) p.res(m); else p.rej(err(m.code || 'unknown'));
          return;
        }
        const s = subs.get(m.id);
        if (s) s.on(m);
      };
      ws.onclose = () => { ws = null; ready = authed = false; if (wanted && session) retry(); };
      ws.onerror = () => { /* llega onclose */ };
    }
    function retry() {
      clearTimeout(timer);
      timer = setTimeout(connect, backoff);
      backoff = Math.min(backoff * 2, 30000);
    }
    function raw(m) { if (ws && ready) ws.send(JSON.stringify(m)); }
    function send(m) { if (ws && ready && authed) raw(m); else { queue.push(m); connect(); } }

    function request(m) {
      return new Promise((res, rej) => {
        m.rid = ++seq;
        pending.set(m.rid, { msg: m, res, rej });
        if (ws && ready && authed) raw(m); else connect();
      });
    }
    function subscribe(msg, on) {
      const id = 's' + (++seq);
      msg.id = id;
      subs.set(id, { msg, on });
      send(msg);
      return id;
    }
    function unsubscribe(id, t) {
      if (!subs.delete(id)) return;
      send({ t, id });
    }
    function onDisconnect(op, path, value) {
      const m = { t: 'rod', op, path, value };
      if (op === 'cancel') ods.delete(path); else ods.set(path, m);
      return request(m);
    }
    /** La sesión ha cambiado: se vuelve a conectar con la nueva. */
    function reauth() {
      if (!ws) return;
      if (!session) { wanted = false; try { ws.close(); } catch (e) { /* nada */ } return; }
      authed = false;
      raw({ t: 'auth', token: session.token });
    }
    return { request, subscribe, unsubscribe, send, onDisconnect, reauth, connect };
  })();

  // ---------------- Authentication ----------------

  class GoogleAuthProvider {}
  const EmailAuthProvider = { credential: (email, password) => ({ providerId: 'password', email, password }) };
  const noGoogle = () => Promise.reject(err('auth/operation-not-allowed'));

  function makeUser(s) {
    return {
      uid: s.uid, email: s.email, displayName: null,
      providerData: [{ providerId: 'password', uid: s.email, email: s.email }],
      getIdToken: () => Promise.resolve(session ? session.token : ''),
      reauthenticateWithCredential: cred => call('auth/reauth', { password: cred && cred.password }, true),
      reauthenticateWithPopup: noGoogle,
      linkWithPopup: noGoogle,
      async delete() { await call('auth/delete', {}, true); setUser(null); }
    };
  }

  const authListeners = new Set();
  let authReady = null;
  const auth = {
    currentUser: null, languageCode: 'es',
    setPersistence: () => Promise.resolve(),
    useEmulator() {},
    onAuthStateChanged(cb) {
      authListeners.add(cb);
      authReady.then(() => { if (authListeners.has(cb)) cb(auth.currentUser); });
      return () => authListeners.delete(cb);
    },
    async createUserWithEmailAndPassword(email, password) {
      const j = await call('auth/register', { email, password }, true);
      setUser(j);
      return { user: auth.currentUser };
    },
    async signInWithEmailAndPassword(email, password) {
      const j = await call('auth/login', { email, password }, true);
      setUser(j);
      return { user: auth.currentUser };
    },
    signInWithPopup: noGoogle,
    async signOut() {
      if (session) await call('auth/logout', {}, true).catch(() => {});
      setUser(null);
    }
  };
  function setUser(j) {
    saveSession(j ? { token: j.token, uid: j.uid, email: j.email } : null);
    auth.currentUser = j ? makeUser(session) : null;
    authListeners.forEach(fn => { try { fn(auth.currentUser); } catch (e) { console.warn(e); } });
  }
  function startAuth() {
    authReady = (async () => {
      if (!session) return;
      try {
        await call('auth/me', {}, true);
        auth.currentUser = makeUser(session);
      } catch (e) {
        // Sin conexión: se sigue con la sesión guardada (se juega con la copia local).
        if (e.code === 'auth/network-request-failed' || e.code === 'unavailable') auth.currentUser = makeUser(session);
        else saveSession(null);
      }
    })();
  }

  // ---------------- Firestore ----------------

  class DocumentSnapshot {
    constructor(ref, exists, data) { this.ref = ref; this.id = ref.id; this.exists = exists; this._d = data; }
    data() { return this.exists ? dec(this._d) : undefined; }
    get(f) { const d = this.data(); return d == null ? undefined : String(f).split('.').reduce((o, k) => (o == null ? o : o[k]), d); }
  }
  class QuerySnapshot {
    constructor(docs, changes) { this.docs = docs; this.size = docs.length; this.empty = !docs.length; this._ch = changes; }
    forEach(fn) { this.docs.forEach(fn); }
    docChanges() { return this._ch || this.docs.map((doc, i) => ({ type: 'added', doc, oldIndex: -1, newIndex: i })); }
  }

  class DocumentReference {
    constructor(path) { this.path = path; this.id = path.split('/').pop(); }
    get parent() { return new Query(this.path.split('/').slice(0, -1).join('/')); }
    collection(name) { return new Query(this.path + '/' + name); }
    async get() { const j = await call('fs/get', { path: this.path }); return new DocumentSnapshot(this, j.exists, j.data); }
    set(data) { return commit([{ op: 'set', path: this.path, data: enc(data) }]); }
    update(data) { return commit([{ op: 'update', path: this.path, data: enc(data) }]); }
    delete() { return commit([{ op: 'delete', path: this.path }]); }
    onSnapshot(next, error) {
      // (Escucha de un documento: una consulta por su colección, filtrada aquí.)
      return this.parent.onSnapshot(s => {
        const d = s.docs.find(x => x.id === this.id);
        next(d ? new DocumentSnapshot(this, true, d._d) : new DocumentSnapshot(this, false, null));
      }, error);
    }
  }

  const AUTO = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  const autoId = () => { let s = ''; const a = new Uint8Array(20); crypto.getRandomValues(a); for (const b of a) s += AUTO[b % AUTO.length]; return s; };

  class Query {
    constructor(path, q) { this.path = path; this.id = path.split('/').pop(); this._q = Object.assign({ where: [], orderBy: null, limit: null, group: false }, q); }
    doc(id) { return new DocumentReference(this.path + '/' + (id == null ? autoId() : id)); }
    where(f, op, v) { return new Query(this.path, Object.assign({}, this._q, { where: this._q.where.concat([[f, op, enc(v)]]) })); }
    orderBy(f, dir) { return new Query(this.path, Object.assign({}, this._q, { orderBy: [f, dir || 'asc'] })); }
    limit(n) { return new Query(this.path, Object.assign({}, this._q, { limit: n })); }
    _wire() { return Object.assign({ path: this.path }, this._q); }
    _snap(rows) { return rows.map(r => new DocumentSnapshot(new DocumentReference(r.path), true, r.data)); }
    async get() { const j = await call('fs/query', this._wire()); return new QuerySnapshot(this._snap(j.docs)); }
    add(data) { const ref = this.doc(); return ref.set(data).then(() => ref); }
    onSnapshot(next, error) {
      if (!session) { if (error) setTimeout(() => error(err('permission-denied')), 0); return () => {}; }
      let prev = new Map();             // ruta -> JSON
      const id = Live.subscribe({ t: 'sub', q: this._wire() }, m => {
        if (m.t === 'serr') { if (error) error(err(m.code)); return; }
        if (m.t !== 'snap') return;
        const docs = this._snap(m.docs), next_ = new Map(), changes = [];
        m.docs.forEach((r, i) => {
          const j = JSON.stringify(r.data);
          next_.set(r.path, j);
          if (!prev.has(r.path)) changes.push({ type: 'added', doc: docs[i], oldIndex: -1, newIndex: i });
          else if (prev.get(r.path) !== j) changes.push({ type: 'modified', doc: docs[i], oldIndex: i, newIndex: i });
        });
        for (const [p, j] of prev) if (!next_.has(p)) {
          changes.push({ type: 'removed', doc: new DocumentSnapshot(new DocumentReference(p), true, JSON.parse(j)), oldIndex: 0, newIndex: -1 });
        }
        prev = next_;
        try { next(new QuerySnapshot(docs, changes)); } catch (e) { console.error(e); }
      });
      return () => Live.unsubscribe(id, 'unsub');
    }
  }

  function commit(writes, reads) { return call('fs/commit', { writes, reads: reads || [] }).then(() => undefined); }

  class Transaction {
    constructor() { this._reads = new Map(); this._writes = []; }
    async get(ref) {
      const j = await call('fs/get', { path: ref.path });
      if (!this._reads.has(ref.path)) this._reads.set(ref.path, j.v || 0);
      return new DocumentSnapshot(ref, j.exists, j.data);
    }
    set(ref, data) { this._writes.push({ op: 'set', path: ref.path, data: enc(data) }); return this; }
    update(ref, data) { this._writes.push({ op: 'update', path: ref.path, data: enc(data) }); return this; }
    delete(ref) { this._writes.push({ op: 'delete', path: ref.path }); return this; }
  }

  class WriteBatch extends Transaction {
    commit() { return commit(this._writes); }
  }

  const firestore = {
    collection: name => new Query(name),
    collectionGroup: name => new Query(name, { group: true }),
    doc: path => new DocumentReference(path),
    batch: () => new WriteBatch(),
    settings() {}, useEmulator() {},
    async runTransaction(fn) {
      for (let i = 0; i < 8; i++) {
        const tx = new Transaction();
        const out = await fn(tx);
        try {
          await commit(tx._writes, [...tx._reads].map(([path, v]) => ({ path, v })));
          return out;
        } catch (e) {
          if (e.code !== 'aborted') throw e;
          await new Promise(r => setTimeout(r, 50 + Math.random() * 200 * (i + 1)));
        }
      }
      throw err('aborted', 'demasiados intentos');
    }
  };

  // ---------------- Realtime Database ----------------

  const PUSH = '-0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ_abcdefghijklmnopqrstuvwxyz';
  let lastPush = 0, lastRand = [];
  function pushId() {
    let now = Date.now();
    const dup = now === lastPush;
    lastPush = now;
    let t = '';
    for (let i = 0; i < 8; i++) { t = PUSH.charAt(now % 64) + t; now = Math.floor(now / 64); }
    if (!dup) lastRand = Array.from({ length: 12 }, () => Math.floor(Math.random() * 64));
    else { let i = 11; while (i >= 0 && lastRand[i] === 63) { lastRand[i] = 0; i--; } if (i >= 0) lastRand[i]++; }
    return t + lastRand.map(n => PUSH.charAt(n)).join('');
  }

  class DataSnapshot {
    constructor(ref, v) { this.ref = ref; this.key = ref.key; this._v = v === undefined ? null : v; }
    val() { return this._v == null ? null : JSON.parse(JSON.stringify(this._v)); }
    exists() { return this._v != null; }
    numChildren() { return this._v && typeof this._v === 'object' ? Object.keys(this._v).length : 0; }
    hasChild(k) { return !!(this._v && typeof this._v === 'object' && k in this._v); }
    child(k) { return new DataSnapshot(this.ref.child(k), this._v && typeof this._v === 'object' ? this._v[k] : null); }
    forEach(fn) { for (const k of Object.keys(this._v || {}).sort()) if (fn(this.child(k)) === true) return true; return false; }
  }

  const rtListeners = new Map();      // ruta -> Set de ids
  class Reference {
    constructor(path) { this.path = String(path || '').split('/').filter(Boolean).join('/'); this.key = this.path ? this.path.split('/').pop() : null; }
    get parent() { const p = this.path.split('/'); p.pop(); return p.length ? new Reference(p.join('/')) : null; }
    get root() { return new Reference(''); }
    child(p) { return new Reference(this.path + '/' + p); }
    push(value) {
      const ref = this.child(pushId());
      if (value === undefined) return ref;
      const p = ref.set(value);
      ref.then = p.then.bind(p); ref.catch = p.catch.bind(p);
      return ref;
    }
    set(value) { return Live.request({ t: 'rt', op: 'set', path: this.path, value: value === undefined ? null : value }).then(() => undefined); }
    update(value) { return Live.request({ t: 'rt', op: 'update', path: this.path, value }).then(() => undefined); }
    remove() { return Live.request({ t: 'rt', op: 'remove', path: this.path }).then(() => undefined); }
    get() { return Live.request({ t: 'rt', op: 'get', path: this.path }).then(m => new DataSnapshot(this, m.value)); }
    once(evt) { return this.get(); }
    on(evt, cb, cancel) {
      const id = Live.subscribe({ t: 'ron', path: this.path, evt }, m => {
        if (m.t === 'rx') { forget(this.path, id); if (cancel) cancel(err(m.code)); return; }
        try {
          if (m.t === 'rv') cb(new DataSnapshot(this, m.value));
          else if (m.t === 'rc') cb(new DataSnapshot(this.child(m.key), m.value));
        } catch (e) { console.error(e); }
      });
      if (!rtListeners.has(this.path)) rtListeners.set(this.path, new Set());
      rtListeners.get(this.path).add(id);
      return cb;
    }
    off() {
      for (const id of rtListeners.get(this.path) || []) Live.unsubscribe(id, 'roff');
      rtListeners.delete(this.path);
    }
    onDisconnect() {
      const p = this.path;
      return {
        remove: () => Live.onDisconnect('remove', p).then(() => undefined),
        set: v => Live.onDisconnect('set', p, v).then(() => undefined),
        cancel: () => Live.onDisconnect('cancel', p).then(() => undefined)
      };
    }
  }
  function forget(path, id) { const s = rtListeners.get(path); if (s) s.delete(id); }

  const database = {
    ref: p => new Reference(p),
    goOnline() {}, goOffline() {}, useEmulator() {}
  };

  // ---------------- conteo del ranking (API REST de Firestore) ----------------
  // js/net/ranking.js cuenta las marcas por delante con la API REST de
  // agregación de Firestore. Esa llamada se desvía aquí a /api/fs/count.
  const realFetch = window.fetch.bind(window);
  window.fetch = function (input, init) {
    const url = typeof input === 'string' ? input : input && input.url;
    const m = url && /\/v1\/projects\/[^/]+\/databases\/\(default\)\/documents\/(.+):runAggregationQuery$/.exec(url);
    if (!m) return realFetch(input, init);
    return (async () => {
      const body = JSON.parse((init && init.body) || '{}');
      const sq = body.structuredAggregationQuery.structuredQuery;
      const ff = sq.where.fieldFilter;
      const OPS = { GREATER_THAN: '>', GREATER_THAN_OR_EQUAL: '>=', LESS_THAN: '<', LESS_THAN_OR_EQUAL: '<=', EQUAL: '==' };
      const val = ff.value.integerValue != null ? +ff.value.integerValue : ff.value.doubleValue != null ? +ff.value.doubleValue : ff.value.stringValue;
      const j = await call('fs/count', { path: decodeURIComponent(m[1]) + '/' + sq.from[0].collectionId, field: ff.field.fieldPath, op: OPS[ff.op], value: val });
      return new Response(JSON.stringify([{ result: { aggregateFields: { n: { integerValue: String(j.n) } } } }]), { headers: { 'content-type': 'application/json' } });
    })();
  };

  // ---------------- espacio de nombres ----------------

  let app = null;
  function initializeApp(c) {
    if (app) return app;
    cfg = c || {};
    startAuth();
    app = { name: '[DEFAULT]', options: cfg };
    return app;
  }

  const fb = {
    __self: true,
    initializeApp,
    app: () => app,
    apps: [],
    auth: Object.assign(() => auth, { Auth: { Persistence: { LOCAL: 'local', SESSION: 'session', NONE: 'none' } }, GoogleAuthProvider, EmailAuthProvider }),
    firestore: Object.assign(() => firestore, { FieldValue: { serverTimestamp: () => new Sentinel('ts') }, Timestamp }),
    database: Object.assign(() => database, { ServerValue: { TIMESTAMP: { '.sv': 'timestamp' } } })
  };
  window.firebase = fb;
})();
