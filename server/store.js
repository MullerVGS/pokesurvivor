/* ============ store.js — documentos, contas y sesiones en SQLite ============
 * Hace de Firestore: cada documento es una fila (ruta completa + JSON) con un
 * número de versión que sube en cada escritura (para las transacciones).
 * Las marcas de hora del servidor se guardan como { __ts: ms }.
 */
const { DatabaseSync } = require('node:sqlite');
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
  `);

  const q = {
    get: db.prepare('SELECT data, v FROM docs WHERE path = ?'),
    byParent: db.prepare('SELECT path, id, data, v FROM docs WHERE parent = ?'),
    byCid: db.prepare('SELECT path, id, data, v FROM docs WHERE cid = ?'),
    put: db.prepare(`INSERT INTO docs (path, parent, cid, id, data, v, updated) VALUES (?, ?, ?, ?, ?, 1, ?)
                     ON CONFLICT(path) DO UPDATE SET data = excluded.data, v = docs.v + 1, updated = excluded.updated`),
    del: db.prepare('DELETE FROM docs WHERE path = ?')
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

  /** Remove all game data belonging to a deleted account, including shared summaries. */
  function deletePlayer(uid) {
    atomic(() => {
      for (const row of db.prepare('SELECT path, data FROM docs').all()) {
        const [collection, id] = row.path.split('/');
        const data = JSON.parse(row.data);
        if ((['saves', 'runs', 'profiles', 'pres'].includes(collection) && id === uid)
            || (collection === 'names' && data.uid === uid)
            || (collection === 'friendships' && (data.users || []).includes(uid))
            || (collection === 'inv' && (data.from === uid || data.to === uid))
            || (collection === 'lb' && (data.uids || []).includes(uid))
            || (collection === 'reports' && data.by === uid)) {
          delDoc(row.path);
        } else if (collection === 'lbs' && data.top) {
          let changed = false;
          for (const [key, entry] of Object.entries(data.top)) {
            if ((entry.uids || []).includes(uid)) { delete data.top[key]; changed = true; }
          }
          if (changed) putDoc(row.path, data, Date.now());
        }
      }
    });
  }

  return { getDoc, putDoc, delDoc, list, atomic, split, deletePlayer, close: () => db.close() };
}

module.exports = { open };
