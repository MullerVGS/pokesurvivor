/* ============ store.js — documentos, contas y sesiones en SQLite ============
 * Hace de Firestore: cada documento es una fila (ruta completa + JSON) con un
 * número de versión que sube en cada escritura (para las transacciones).
 * Las marcas de hora del servidor se guardan como { __ts: ms }.
 */
const { DatabaseSync } = require('node:sqlite');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

function open(file) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = NORMAL;
    CREATE TABLE IF NOT EXISTS docs (
      path TEXT PRIMARY KEY, parent TEXT NOT NULL, cid TEXT NOT NULL, id TEXT NOT NULL,
      data TEXT NOT NULL, v INTEGER NOT NULL, updated INTEGER NOT NULL);
    CREATE INDEX IF NOT EXISTS docs_parent ON docs(parent);
    CREATE INDEX IF NOT EXISTS docs_cid ON docs(cid);
    CREATE TABLE IF NOT EXISTS users (
      uid TEXT PRIMARY KEY, email TEXT UNIQUE NOT NULL, hash TEXT NOT NULL, created INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS sessions (
      token TEXT PRIMARY KEY, uid TEXT NOT NULL, created INTEGER NOT NULL, last INTEGER NOT NULL);
    CREATE INDEX IF NOT EXISTS sessions_uid ON sessions(uid);
  `);

  const q = {
    get: db.prepare('SELECT data, v FROM docs WHERE path = ?'),
    byParent: db.prepare('SELECT path, id, data, v FROM docs WHERE parent = ?'),
    byCid: db.prepare('SELECT path, id, data, v FROM docs WHERE cid = ?'),
    put: db.prepare(`INSERT INTO docs (path, parent, cid, id, data, v, updated) VALUES (?, ?, ?, ?, ?, 1, ?)
                     ON CONFLICT(path) DO UPDATE SET data = excluded.data, v = docs.v + 1, updated = excluded.updated`),
    del: db.prepare('DELETE FROM docs WHERE path = ?'),
    userByEmail: db.prepare('SELECT uid, email, hash FROM users WHERE email = ?'),
    userByUid: db.prepare('SELECT uid, email, hash FROM users WHERE uid = ?'),
    addUser: db.prepare('INSERT INTO users (uid, email, hash, created) VALUES (?, ?, ?, ?)'),
    delUser: db.prepare('DELETE FROM users WHERE uid = ?'),
    addSession: db.prepare('INSERT INTO sessions (token, uid, created, last) VALUES (?, ?, ?, ?)'),
    session: db.prepare('SELECT uid, last FROM sessions WHERE token = ?'),
    touchSession: db.prepare('UPDATE sessions SET last = ? WHERE token = ?'),
    delSession: db.prepare('DELETE FROM sessions WHERE token = ?'),
    delSessions: db.prepare('DELETE FROM sessions WHERE uid = ?')
  };

  // ---------------- documentos ----------------

  /** 'lb/s_all2/e/abc' -> { parent: 'lb/s_all2/e', cid: 'e', id: 'abc' } */
  function split(p) {
    const parts = p.split('/');
    if (parts.length % 2 || parts.some(x => !x)) throw Object.assign(new Error('ruta inválida: ' + p), { code: 'invalid-argument' });
    return { parent: parts.slice(0, -1).join('/'), cid: parts[parts.length - 2], id: parts[parts.length - 1] };
  }

  function getDoc(p) {
    split(p);
    const r = q.get.get(p);
    return r ? { data: JSON.parse(r.data), v: r.v } : { data: null, v: 0 };
  }

  function putDoc(p, data, now) {
    const s = split(p);
    q.put.run(p, s.parent, s.cid, s.id, JSON.stringify(data), now);
  }

  function delDoc(p) { split(p); q.del.run(p); }

  /** Todos los documentos de una colección (o de todas las que se llaman así). */
  function list(collPath, group) {
    const rows = group ? q.byCid.all(collPath) : q.byParent.all(collPath);
    return rows.map(r => ({ path: r.path, id: r.id, data: JSON.parse(r.data), v: r.v }));
  }

  /** Ejecuta fn de forma atómica (todo o nada). */
  function atomic(fn) {
    db.exec('BEGIN IMMEDIATE');
    try { const r = fn(); db.exec('COMMIT'); return r; }
    catch (e) { db.exec('ROLLBACK'); throw e; }
  }

  // ---------------- contas ----------------

  function hashPass(pass) {
    const salt = crypto.randomBytes(16);
    const key = crypto.scryptSync(pass, salt, 32);
    return 'scrypt$' + salt.toString('hex') + '$' + key.toString('hex');
  }
  function checkPass(pass, stored) {
    const [, salt, key] = String(stored).split('$');
    if (!salt || !key) return false;
    const got = crypto.scryptSync(pass, Buffer.from(salt, 'hex'), 32);
    return crypto.timingSafeEqual(got, Buffer.from(key, 'hex'));
  }
  const tokenHash = t => crypto.createHash('sha256').update(t).digest('hex');

  function newUid() {
    // Mismo aspecto que los uid de Firebase: 28 caracteres alfanuméricos.
    const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    return [...crypto.randomBytes(28)].map(b => A[b % A.length]).join('');
  }

  function createUser(email, pass) {
    if (q.userByEmail.get(email)) return null;
    const uid = newUid();
    q.addUser.run(uid, email, hashPass(pass), Date.now());
    return { uid, email };
  }

  function verifyUser(email, pass) {
    const u = q.userByEmail.get(email);
    return u && checkPass(pass, u.hash) ? { uid: u.uid, email: u.email } : null;
  }

  function verifyUid(uid, pass) {
    const u = q.userByUid.get(uid);
    return !!(u && checkPass(pass, u.hash));
  }

  function userOf(uid) {
    const u = q.userByUid.get(uid);
    return u ? { uid: u.uid, email: u.email } : null;
  }

  function deleteUser(uid) { q.delSessions.run(uid); q.delUser.run(uid); }

  function newSession(uid) {
    const token = crypto.randomBytes(32).toString('base64url');
    const now = Date.now();
    q.addSession.run(tokenHash(token), uid, now, now);
    return token;
  }

  function sessionUid(token) {
    if (!token) return null;
    const h = tokenHash(token);
    const s = q.session.get(h);
    if (!s) return null;
    // Se apunta el último uso como mucho una vez por hora.
    if (Date.now() - s.last > 3600e3) q.touchSession.run(Date.now(), h);
    return s.uid;
  }

  function endSession(token) { if (token) q.delSession.run(tokenHash(token)); }

  return { getDoc, putDoc, delDoc, list, atomic, split,
           createUser, verifyUser, verifyUid, userOf, deleteUser, newSession, sessionUid, endSession };
}

module.exports = { open };
