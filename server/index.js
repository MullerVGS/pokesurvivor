/* Game HTTP/WebSocket server. Better Auth owns authentication at /api/auth/*.
 * /api/fs/* and /api/ws use the same verified cookie session.
 * Configuration and migration: docs/AUTENTICACAO.md.
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');
const { open } = require('./store');
const rules = require('./rules');
const { createDocs, ERR } = require('./docs');
const { createLive } = require('./live');
const { isIP } = require('net');

async function main() {

const PORT = +process.env.PORT || 3000;
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const STATIC_DIR = path.resolve(process.env.STATIC_DIR || path.join(__dirname, '..'));
const MAX_BODY = 8 * 1024 * 1024;

const store = open(path.join(DATA_DIR, 'pokesurvivor.sqlite'));
const subs = new Set();               // consultas en vivo: { conn, id, q, last }
const docs = createDocs(store, rules, paths => notify(paths));
const live = createLive();

const { createAuth } = await import('./auth.mjs');
const identity = await createAuth({
  file: path.join(DATA_DIR, 'pokesurvivor.sqlite'),
  afterDelete: async user => { store.deletePlayer(user.id); await revalidateConnections(); }
});
const trustedProxies = new Set((process.env.AUTH_TRUSTED_PROXIES || '').split(',').map(x => x.trim()).filter(Boolean));
function clientIp(req) {
  const remote = (req.socket.remoteAddress || '').replace(/^::ffff:/, '');
  if (!trustedProxies.has(remote)) return remote;
  // Only the rightmost hop supplied by our trusted ingress is considered.
  const forwarded = String(req.headers['x-forwarded-for'] || '').split(',').pop().trim();
  return isIP(forwarded) ? forwarded : remote;
}
function sameOrigin(req) { return req.headers.origin === identity.origin; }
function send(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body));
}

// ---------------- game documents (Better Auth supplies the identity) ----------------
const routes = {
  'fs/get'(uid, b) { const d = docs.get(uid, String(b.path)); return { exists: !!d.data, data: d.data, v: d.v }; },
  'fs/query'(uid, b) { return { docs: docs.run(uid, b) }; },
  'fs/commit'(uid, b) { docs.commit(uid, b); return {}; },
  'fs/count'(uid, b) { return { n: docs.count(uid, b) }; }
};

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
  const fn = routes[name];
  if (!fn || req.method !== 'POST') return send(res, 404, { code: 'not-found' });
  if (!sameOrigin(req) || !String(req.headers['content-type']).startsWith('application/json')) return send(res, 403, { code: 'permission-denied' });
  try {
    const body = await readBody(req);
    // Authorize after the final await, so a stalled upload cannot outlive logout.
    const session = await identity.session(req);
    if (!session) return send(res, 401, { code: 'unauthenticated' });
    send(res, 200, fn(session.user.id, body, req) || {});
  } catch (e) {
    const code = e.code || 'internal';
    if (!STATUS[code]) console.error('[api]', name, code);
    if (!res.destroyed) send(res, STATUS[code] || 500, { code });
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

function serveStatic(req, res, pathname, search) {
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
    // Sprites, iconos y fuentes no cambian. El código con huella (?v=) tampoco:
    // si cambia, cambia la dirección. El resto (css/style.css, js/fb/, html,
    // json) con no-store: Cloudflare cambia el no-cache por 4 h de caché en .css
    // y .js, y el navegador seguía con el CSS viejo con el JS nuevo.
    const art = /^assets\/(pokemon|icons|fonts)\//.test(rel);
    const cache = art ? 'public, max-age=604800' : search.has('v') ? 'public, max-age=31536000, immutable' : 'no-store';
    res.writeHead(200, { 'content-type': TYPES[ext] || 'application/octet-stream', 'content-length': st.size,
      'cache-control': cache, 'last-modified': st.mtime.toUTCString() });
    if (req.method === 'HEAD') return res.end();
    fs.createReadStream(file).pipe(res);
  });
}

const server = http.createServer((req, res) => {
  // Copia privada: fuera de los buscadores (la web oficial es pokesurvivor.com).
  res.setHeader('x-robots-tag', 'noindex, nofollow');
  res.setHeader('referrer-policy', 'no-referrer');
  res.setHeader('x-content-type-options', 'nosniff');
  const { pathname, searchParams } = new URL(req.url, 'http://x');
  if (pathname === '/api/health') { res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ ok: true, rooms: live.size, ws: wss.clients.size })); }
  if (pathname === '/api/account/config' && req.method === 'GET') return send(res, 200, identity.capabilities);
  if (pathname.startsWith('/api/auth/')) {
    if (req.method === 'POST' && !sameOrigin(req)) return send(res, 403, { code: 'INVALID_ORIGIN' });
    req.headers['x-pokesurvivor-client-ip'] = clientIp(req);
    if (Number(req.headers['content-length'] || 0) > 16384) return send(res, 413, { code: 'resource-exhausted' });
    let size = 0;
    req.on('data', chunk => { size += chunk.length; if (size > 16384) req.destroy(); });
    res.setHeader('cache-control', 'no-store');
    res.on('finish', () => { revalidateConnections().catch(() => {}); });
    return Promise.resolve(identity.handler(req, res)).catch(() => { if (!res.headersSent) send(res, 500, { code: 'internal' }); });
  }
  if (pathname.startsWith('/api/')) return api(req, res, pathname.slice(5));
  if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); return res.end(); }
  serveStatic(req, res, pathname, searchParams);
});

// ---------------- WebSocket ----------------

const wss = new WebSocketServer({ noServer: true, maxPayload: 256 * 1024 });
const connections = new Set();
server.on('upgrade', async (req, sock, head) => {
  if (new URL(req.url, 'http://x').pathname !== '/api/ws' || !sameOrigin(req)) return sock.destroy();
  try {
    const session = await identity.session(req);
    if (!session || sock.destroyed) return sock.destroy();
    wss.handleUpgrade(req, sock, head, ws => wss.emit('connection', ws, req, session));
  } catch { sock.destroy(); }
});
async function validateConnection(conn) {
  if (conn.closed) return false;
  const session = await identity.session(conn.request);
  if (!session || session.session.id !== conn.sessionId) {
    conn.closed = true;
    conn.ws.close(1008, 'Session expired');
    return false;
  }
  return true;
}
async function revalidateConnections() {
  await Promise.all([...connections].map(conn => validateConnection(conn).catch(() => conn.ws.terminate())));
}
const sessionCheck = setInterval(() => revalidateConnections().catch(() => {}), 30000);
sessionCheck.unref();

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

wss.on('connection', (ws, request, session) => {
  const conn = {
    uid: session.user.id, sessionId: session.session.id, request, ws, closed: false, onDisconnect: [],
    send(m) {
      validateConnection(this).then(valid => {
        if (valid && ws.readyState === 1) ws.send(JSON.stringify(m));
      }).catch(() => ws.terminate());
    }
  };
  connections.add(conn);
  conn.send({ t: 'auth', ok: true, uid: conn.uid });
  let alive = true;
  ws.on('pong', () => { alive = true; });
  const ping = setInterval(() => { if (!alive) return ws.terminate(); alive = false; ws.ping(); }, 30000);

  let queue = Promise.resolve(), queued = 0;
  ws.on('message', raw => {
    if (++queued > 64) return ws.close(1008, 'Too many pending messages');
    queue = queue.then(async () => {
    if (!await validateConnection(conn)) return;
    let m;
    try { m = JSON.parse(raw); } catch (e) { return; }
    const reply = (ok, extra) => conn.send(Object.assign({ t: 'rtr', rid: m.rid, ok }, extra));
    try {
      switch (m.t) {
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

    }).catch(() => ws.terminate()).finally(() => { queued--; });
  });

  ws.on('close', () => {
    conn.closed = true; connections.delete(conn);
    clearInterval(ping);
    for (const s of subs) if (s.conn === conn) subs.delete(s);
    live.drop(conn);
  });
});

server.listen(PORT, () => console.log(`[pokesurvivor] http://0.0.0.0:${PORT} · datos en ${DATA_DIR} · juego en ${STATIC_DIR}`));
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => {
  clearInterval(sessionCheck); for (const ws of wss.clients) ws.terminate();
  server.close(() => { identity.close(); store.close(); process.exit(0); });
});
}
main().catch(error => { console.error('[startup]', error.message); process.exit(1); });
