/* ============ live.js — datos en vivo de las salas (hace de Realtime Database) ============
 * Sólo vive en memoria: las salas del cooperativo y la señalización de WebRTC
 * (rooms/{id}/...). Si el servidor se reinicia, las salas abiertas se cierran,
 * igual que si se cayera la conexión.
 *
 * Reglas (database.rules.json, resumidas):
 *   rooms/{id}            la crea quien se pone de anfitrión; luego sólo el anfitrión
 *   rooms/{id}/m/{uid}    cada uno su plaza (y sólo si la sala sigue abierta)
 *   rooms/{id}/q/{to}/*   escriben los miembros; lee y borra el destinatario
 */
const ERR = (code, msg) => Object.assign(new Error(msg || code), { code });

function createLive() {
  let root = {};
  const listeners = new Set();       // { conn, id, path, evt, last, known }

  const segs = p => String(p || '').split('/').filter(Boolean);
  const norm = p => segs(p).join('/');

  function getVal(p) {
    let cur = root;
    for (const k of segs(p)) { if (cur == null || typeof cur !== 'object') return null; cur = cur[k]; }
    return cur === undefined ? null : cur;
  }

  function resolve(v, now) {
    if (v && typeof v === 'object') {
      if (v['.sv'] === 'timestamp') return now;
      const o = {};
      for (const k of Object.keys(v)) { const x = resolve(v[k], now); if (x != null) o[k] = x; }
      return Object.keys(o).length ? o : null;
    }
    return v === undefined ? null : v;
  }

  function setRaw(p, v) {
    const ks = segs(p);
    if (!ks.length) { root = v && typeof v === 'object' ? v : {}; return; }
    const chain = [root];
    let cur = root;
    for (const k of ks.slice(0, -1)) {
      if (cur[k] == null || typeof cur[k] !== 'object') {
        if (v == null) return;
        cur[k] = {};
      }
      cur = cur[k];
      chain.push(cur);
    }
    const last = ks[ks.length - 1];
    if (v == null) delete cur[last]; else cur[last] = v;
    // Lo que se queda vacío desaparece (como en Firebase).
    for (let i = chain.length - 1; i > 0; i--) {
      if (Object.keys(chain[i]).length) break;
      delete chain[i - 1][ks[i - 1]];
    }
  }

  // ---------------- reglas ----------------

  function canRead(uid, p) {
    const [c, room, k, to] = segs(p);
    if (!uid || c !== 'rooms' || !room) return false;
    if (k === 'host' || k === 'open') return true;
    if (k === 'q') return to === uid;
    return getVal(`rooms/${room}/m/${uid}`) != null;
  }

  function canWrite(uid, p, v) {
    const [c, room, k, a, b] = segs(p);
    if (!uid || c !== 'rooms' || !room) return false;
    const cur = getVal('rooms/' + room);
    const host = cur && cur.host;
    if (!k) return (!cur && v && v.host === uid) || host === uid;
    if (k === 'm' && a) {
      if (host === uid) return true;
      if (a !== uid) return false;
      return v == null || getVal(`rooms/${room}/m/${uid}`) != null || (cur && cur.open === true);
    }
    if (k === 'q' && a && b) {
      if (v != null && (typeof v !== 'string' || v.length >= 200000)) return false;
      return uid === a || getVal(`rooms/${room}/m/${uid}`) != null;
    }
    return host === uid;
  }

  // ---------------- avisos ----------------

  const related = (a, b) => a === b || a.startsWith(b + '/') || b.startsWith(a + '/') || !a || !b;

  function fire(l, first) {
    if (!canRead(l.conn.uid, l.path)) {
      listeners.delete(l);
      l.conn.send({ t: 'rx', id: l.id, code: 'permission-denied' });
      return;
    }
    const val = getVal(l.path);
    if (l.evt === 'value') {
      const j = JSON.stringify(val);
      if (!first && j === l.last) return;
      l.last = j;
      l.conn.send({ t: 'rv', id: l.id, value: val });
    } else {
      const kids = val && typeof val === 'object' ? Object.keys(val).sort() : [];
      for (const k of kids) if (!l.known.has(k)) l.conn.send({ t: 'rc', id: l.id, key: k, value: val[k] });
      l.known = new Set(kids);
    }
  }

  function changed(p) { for (const l of [...listeners]) if (related(l.path, p)) fire(l, false); }

  // ---------------- operaciones ----------------

  function write(uid, op, p, value) {
    p = norm(p);
    const now = Date.now();
    if (op === 'update') {
      const v = value || {};
      for (const k of Object.keys(v)) {
        const full = norm(p + '/' + k);
        if (!canWrite(uid, full, resolve(v[k], now))) throw ERR('permission-denied');
      }
      for (const k of Object.keys(v)) setRaw(p + '/' + k, resolve(v[k], now));
    } else {
      const v = op === 'remove' ? null : resolve(value, now);
      if (!canWrite(uid, p, v)) throw ERR('permission-denied');
      setRaw(p, v);
    }
    changed(p);
  }

  function read(uid, p) {
    if (!canRead(uid, p)) throw ERR('permission-denied');
    return getVal(p);
  }

  function listen(conn, id, p, evt) {
    unlisten(conn, id);
    if (!canRead(conn.uid, p)) { conn.send({ t: 'rx', id, code: 'permission-denied' }); return; }
    const l = { conn, id, path: norm(p), evt: evt === 'child_added' ? 'child_added' : 'value', last: null, known: new Set() };
    listeners.add(l);
    fire(l, true);
  }

  function unlisten(conn, id) { for (const l of listeners) if (l.conn === conn && l.id === id) listeners.delete(l); }

  /** La conexión se ha cerrado: fuera sus escuchas y se ejecuta lo que dejó encargado. */
  function drop(conn) {
    for (const l of listeners) if (l.conn === conn) listeners.delete(l);
    for (const od of conn.onDisconnect || []) {
      try { write(conn.uid, od.op, od.path, od.value); } catch (e) { /* ya no estaba */ }
    }
    conn.onDisconnect = [];
  }

  function onDisconnect(conn, op, p, value) {
    p = norm(p);
    conn.onDisconnect = (conn.onDisconnect || []).filter(x => x.path !== p);
    if (op !== 'cancel') conn.onDisconnect.push({ op, path: p, value });
  }

  return { write, read, listen, unlisten, drop, onDisconnect, get size() { return Object.keys(root.rooms || {}).length; } };
}

module.exports = { createLive };
