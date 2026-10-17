/* ============ index.js — servidor propio de PokéSurvivor ============
 * Sustituye a Firebase: sirve el juego (la carpeta ya construida) y una API
 * que el cliente js/fb/ usa como si fueran Authentication, Firestore y
 * Realtime Database.
 *
 *   POST /api/auth/*   cuentas (nombre + contraseña)
 *   POST /api/fs/*     documentos
 *   GET  /api/ws       WebSocket: consultas en vivo y salas
 *
 * Variables: PORT (3000) · DATA_DIR (./data) · STATIC_DIR (..) · ADMINS (uids separados por comas)
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');
const { open } = require('./store');
const rules = require('./rules');
const { createDocs, ERR } = require('./docs');
const { createLive } = require('./live');

const PORT = +process.env.PORT || 3000;
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const STATIC_DIR = path.resolve(process.env.STATIC_DIR || path.join(__dirname, '..'));
const MAX_BODY = 8 * 1024 * 1024;

const store = open(path.join(DATA_DIR, 'pokesurvivor.sqlite'));
const subs = new Set();               // consultas en vivo: { conn, id, q, last }
const docs = createDocs(store, rules, paths => notify(paths));
const live = createLive();

// ---------------- límites de intentos (entrar / crear cuenta) ----------------

const tries = new Map();
function limited(ip) {
  const now = Date.now(), t = tries.get(ip) || { n: 0, at: now };
  if (now - t.at > 60e3) { t.n = 0; t.at = now; }
  t.n++;
  tries.set(ip, t);
  if (tries.size > 5000) for (const [k, v] of tries) if (now - v.at > 60e3) tries.delete(k);
  return t.n > 20;
}
const ipOf = req => String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();

// ---------------- API ----------------

const EMAIL = /^[^\s@]{1,200}@[^\s@]{1,200}$/;
const userJson = (u, token) => ({ uid: u.uid, email: u.email, token });

const routes = {
  'auth/register'(uid, b, req) {
    if (limited(ipOf(req))) throw ERR('auth/too-many-requests');
    const email = String(b.email || '').trim().toLowerCase(), pass = String(b.password || '');
    if (!EMAIL.test(email)) throw ERR('auth/invalid-email');
    if (pass.length < 6) throw ERR('auth/weak-password');
    const u = store.createUser(email, pass);
    if (!u) throw ERR('auth/email-already-in-use');
    return userJson(u, store.newSession(u.uid));
  },
  'auth/login'(uid, b, req) {
    if (limited(ipOf(req))) throw ERR('auth/too-many-requests');
    const u = store.verifyUser(String(b.email || '').trim().toLowerCase(), String(b.password || ''));
    if (!u) throw ERR('auth/invalid-credential');
    return userJson(u, store.newSession(u.uid));
  },
  'auth/me'(uid) {
    const u = uid && store.userOf(uid);
    if (!u) throw ERR('auth/user-token-expired');
    return userJson(u);
  },
  'auth/logout'(uid, b, req) { store.endSession(tokenOf(req)); return {}; },
  'auth/reauth'(uid, b, req) {
    if (!uid) throw ERR('auth/requires-recent-login');
    if (limited(ipOf(req))) throw ERR('auth/too-many-requests');
    if (!store.verifyUid(uid, String(b.password || ''))) throw ERR('auth/invalid-credential');
    return {};
  },
  'auth/delete'(uid) {
    if (!uid) throw ERR('auth/requires-recent-login');
    store.deleteUser(uid);
    return {};
  },
  'fs/get'(uid, b) { const d = docs.get(uid, String(b.path)); return { exists: !!d.data, data: d.data, v: d.v }; },
  'fs/query'(uid, b) { return { docs: docs.run(uid, b) }; },
  'fs/commit'(uid, b) { docs.commit(uid, b); return {}; },
  'fs/count'(uid, b) { return { n: docs.count(uid, b) }; }
};

function tokenOf(req) {
  const h = String(req.headers.authorization || '');
  return h.startsWith('Bearer ') ? h.slice(7) : '';
}

function readBody(req) {
  return new Promise((res, rej) => {
    let size = 0; const chunks = [];
    req.on('data', c => { size += c.length; if (size > MAX_BODY) { rej(ERR('resource-exhausted', 'demasiado grande')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => { try { res(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}); } catch (e) { rej(ERR('invalid-argument', 'JSON inválido')); } });
    req.on('error', rej);
  });
}

const STATUS = { 'permission-denied': 403, 'not-found': 404, aborted: 409, 'invalid-argument': 400, 'resource-exhausted': 413,
                 'auth/too-many-requests': 429, 'auth/user-token-expired': 401, 'auth/requires-recent-login': 401 };

async function api(req, res, name) {
  const send = (code, obj) => { res.writeHead(code, { 'content-type': 'application/json', 'cache-control': 'no-store' }); res.end(JSON.stringify(obj)); };
  const fn = routes[name];
  if (!fn || req.method !== 'POST') return send(404, { code: 'not-found' });
  try {
    const body = await readBody(req);
    const uid = store.sessionUid(tokenOf(req));
    send(200, fn(uid, body, req) || {});
  } catch (e) {
    const code = e.code || 'internal';
    if (!STATUS[code] && !code.startsWith('auth/')) console.error('[api]', name, e);
    send(STATUS[code] || (code.startsWith('auth/') ? 400 : 500), { code, message: e.message });
  }
}

// ---------------- archivos del juego ----------------

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.gif': 'image/gif', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.woff': 'font/woff',
  '.ttf': 'font/ttf', '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.wav': 'audio/wav', '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml', '.webp': 'image/webp', '.mp4': 'video/mp4' };
// Nada del servidor ni del repositorio se sirve.
const HIDDEN = /(^|\/)(\.|server\/|tools\/|docs\/|node_modules\/)|\.md$/;

function serveStatic(req, res, pathname) {
  let rel = decodeURIComponent(pathname).replace(/^\/+/, '');
  if (rel === '' || rel.endsWith('/')) rel += 'index.html';
  const file = path.resolve(STATIC_DIR, rel);
  if (!file.startsWith(STATIC_DIR + path.sep) || HIDDEN.test(rel)) { res.writeHead(404); return res.end(); }
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) {
      if (!err && st.isDirectory()) { res.writeHead(301, { location: pathname + '/' }); return res.end(); }
      const nf = path.join(STATIC_DIR, '404.html');
      res.writeHead(404, { 'content-type': TYPES['.html'] });
      return fs.createReadStream(nf).on('error', () => res.end()).pipe(res);
    }
    const ext = path.extname(file).toLowerCase();
    // Sprites, iconos y fuentes no cambian; el código se revalida siempre (el juego se actualiza solo).
    const art = /^assets\/(pokemon|icons|fonts)\//.test(rel);
    res.writeHead(200, { 'content-type': TYPES[ext] || 'application/octet-stream', 'content-length': st.size,
      'cache-control': art ? 'public, max-age=604800' : 'no-cache', 'last-modified': st.mtime.toUTCString() });
    if (req.method === 'HEAD') return res.end();
    fs.createReadStream(file).pipe(res);
  });
}

const server = http.createServer((req, res) => {
  // Copia privada: fuera de los buscadores (la web oficial es pokesurvivor.com).
  res.setHeader('x-robots-tag', 'noindex, nofollow');
  const { pathname } = new URL(req.url, 'http://x');
  if (pathname === '/api/health') { res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ ok: true, rooms: live.size, ws: wss.clients.size })); }
  if (pathname.startsWith('/api/')) return api(req, res, pathname.slice(5));
  if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); return res.end(); }
  serveStatic(req, res, pathname);
});

// ---------------- WebSocket ----------------

const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_BODY });
server.on('upgrade', (req, sock, head) => {
  if (new URL(req.url, 'http://x').pathname !== '/api/ws') return sock.destroy();
  wss.handleUpgrade(req, sock, head, ws => wss.emit('connection', ws, req));
});

function runSub(s) {
  let out;
  try { out = docs.run(s.conn.uid, s.q); }
  catch (e) { s.conn.send({ t: 'serr', id: s.id, code: e.code || 'internal' }); subs.delete(s); return; }
  const j = JSON.stringify(out);
  if (j === s.last) return;
  s.last = j;
  s.conn.send({ t: 'snap', id: s.id, docs: out });
}

/** Algo ha cambiado: se repiten las consultas en vivo de esas colecciones. */
function notify(paths) {
  const parents = new Set(), cids = new Set();
  for (const p of paths) { const s = store.split(p); parents.add(s.parent); cids.add(s.cid); }
  for (const s of subs) if (s.q.group ? cids.has(s.q.path) : parents.has(s.q.path)) runSub(s);
}

wss.on('connection', ws => {
  const conn = {
    uid: null, onDisconnect: [],
    send(m) { if (ws.readyState === 1) ws.send(JSON.stringify(m)); }
  };
  let alive = true;
  ws.on('pong', () => { alive = true; });
  const ping = setInterval(() => { if (!alive) return ws.terminate(); alive = false; ws.ping(); }, 30000);

  ws.on('message', raw => {
    let m;
    try { m = JSON.parse(raw); } catch (e) { return; }
    const reply = (ok, extra) => conn.send(Object.assign({ t: 'rtr', rid: m.rid, ok }, extra));
    try {
      switch (m.t) {
        case 'auth':
          conn.uid = store.sessionUid(m.token);
          conn.send({ t: 'auth', ok: !!conn.uid, uid: conn.uid });
          break;
        case 'sub': {
          for (const x of subs) if (x.conn === conn && x.id === m.id) subs.delete(x);
          const s = { conn, id: m.id, q: m.q, last: null };
          subs.add(s); runSub(s);
          break;
        }
        case 'unsub':
          for (const s of subs) if (s.conn === conn && s.id === m.id) subs.delete(s);
          break;
        case 'rt':
          if (m.op === 'get') reply(true, { value: live.read(conn.uid, m.path) });
          else { live.write(conn.uid, m.op, m.path, m.value); reply(true); }
          break;
        case 'ron': live.listen(conn, m.id, m.path, m.evt); break;
        case 'roff': live.unlisten(conn, m.id); break;
        case 'rod': live.onDisconnect(conn, m.op, m.path, m.value); reply(true); break;
      }
    } catch (e) {
      if (m.rid != null) reply(false, { code: e.code || 'internal' });
      else console.warn('[ws]', m.t, e.message);
    }
  });

  ws.on('close', () => {
    clearInterval(ping);
    for (const s of subs) if (s.conn === conn) subs.delete(s);
    live.drop(conn);
  });
});

server.listen(PORT, () => console.log(`[pokesurvivor] http://0.0.0.0:${PORT} · datos en ${DATA_DIR} · juego en ${STATIC_DIR}`));
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { server.close(); process.exit(0); });
