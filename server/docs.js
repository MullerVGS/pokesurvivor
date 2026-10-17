/* ============ docs.js — lecturas, consultas y escrituras de documentos ============
 * Lo que el juego pide a "Firestore" llega aquí ya traducido por js/fb/:
 *   get(path) · query({ path, group, where, orderBy, limit }) · commit({ reads, writes })
 *   count({ path, field, op, value })
 * Una transacción manda las versiones de lo que leyó: si algo ha cambiado
 * entretanto, se rechaza con 'aborted' y el cliente la repite.
 */
const ERR = (code, msg) => Object.assign(new Error(msg || code), { code });

function createDocs(store, rules, onChange) {
  // ---------------- valores ----------------

  /** Cambia las marcas "hora del servidor" por la hora de ahora. */
  function resolve(v, now) {
    if (Array.isArray(v)) return v.map(x => resolve(x, now));
    if (v && typeof v === 'object') {
      if (v.__sv === 'ts') return { __ts: now };
      const o = {};
      for (const k of Object.keys(v)) o[k] = resolve(v[k], now);
      return o;
    }
    return v;
  }

  const plain = v => (v && typeof v === 'object' && '__ts' in v ? v.__ts : v);
  function field(data, f) {
    let cur = data;
    for (const k of String(f).split('.')) { if (cur == null || typeof cur !== 'object') return undefined; cur = cur[k]; }
    return cur;
  }
  function cmp(a, b) {
    a = plain(a); b = plain(b);
    if (a === b) return 0;
    if (a == null) return -1;
    if (b == null) return 1;
    if (typeof a !== typeof b) return typeof a < typeof b ? -1 : 1;
    return a < b ? -1 : 1;
  }
  const same = (a, b) => JSON.stringify(plain(a)) === JSON.stringify(plain(b));

  function matches(data, [f, op, val]) {
    const x = field(data, f);
    switch (op) {
      case '==': return same(x, val);
      case '!=': return x !== undefined && !same(x, val);
      case '<': return x !== undefined && cmp(x, val) < 0;
      case '<=': return x !== undefined && cmp(x, val) <= 0;
      case '>': return x !== undefined && cmp(x, val) > 0;
      case '>=': return x !== undefined && cmp(x, val) >= 0;
      case 'array-contains': return Array.isArray(x) && x.some(y => same(y, val));
      case 'array-contains-any': return Array.isArray(x) && Array.isArray(val) && x.some(y => val.some(z => same(y, z)));
      case 'in': return Array.isArray(val) && val.some(z => same(x, z));
      default: throw ERR('invalid-argument', 'operador no soportado: ' + op);
    }
  }

  // ---------------- lectura ----------------

  function get(uid, path) {
    const d = store.getDoc(path);
    if (!rules.canRead(uid, path, d.data)) throw ERR('permission-denied');
    return d;
  }

  /** Ejecuta una consulta. Sólo devuelve lo que el usuario puede leer. */
  function run(uid, qy) {
    let rows = store.list(qy.path, !!qy.group).filter(r => (qy.where || []).every(w => matches(r.data, w)));
    rows = rows.filter(r => rules.canRead(uid, r.path, r.data));
    if (qy.orderBy) {
      const [f, dir] = qy.orderBy;
      rows.sort((a, b) => cmp(field(a.data, f), field(b.data, f)) * (dir === 'desc' ? -1 : 1));
    }
    if (qy.limit) rows = rows.slice(0, qy.limit);
    return rows.map(r => ({ path: r.path, id: r.id, data: r.data }));
  }

  function count(uid, { path, field: f, op, value }) {
    return store.list(path, false).filter(r => rules.canRead(uid, r.path, r.data) && matches(r.data, [f, op, value])).length;
  }

  // ---------------- escritura ----------------

  function setPath(obj, dotted, val) {
    const ks = dotted.split('.');
    let cur = obj;
    for (const k of ks.slice(0, -1)) {
      if (!cur[k] || typeof cur[k] !== 'object' || Array.isArray(cur[k])) cur[k] = {};
      cur = cur[k];
    }
    cur[ks[ks.length - 1]] = val;
  }

  function commit(uid, { reads = [], writes = [] }) {
    const now = Date.now();
    const changed = store.atomic(() => {
      for (const r of reads) if (store.getDoc(r.path).v !== (r.v || 0)) throw ERR('aborted');
      const touched = [];
      for (const w of writes) {
        const cur = store.getDoc(w.path).data;
        let next = null;
        if (w.op === 'set') next = resolve(w.data || {}, now);
        else if (w.op === 'update') {
          if (!cur) throw ERR('not-found', 'no existe: ' + w.path);
          next = JSON.parse(JSON.stringify(cur));
          const d = resolve(w.data || {}, now);
          for (const k of Object.keys(d)) setPath(next, k, d[k]);
        } else if (w.op !== 'delete') throw ERR('invalid-argument');
        if (!rules.canWrite(uid, w.path, cur, next)) throw ERR('permission-denied', 'sin permiso: ' + w.path);
        if (next) store.putDoc(w.path, next, now); else store.delDoc(w.path);
        touched.push(w.path);
      }
      return touched;
    });
    if (changed.length) onChange(changed);
  }

  return { get, run, count, commit, matches };
}

module.exports = { createDocs, ERR };
