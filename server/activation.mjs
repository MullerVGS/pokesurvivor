import { createHash, randomBytes } from 'node:crypto';
import { createAuthEndpoint, getAuthoritativeSessionFromCtx, sensitiveSessionMiddleware, APIError } from 'better-auth/api';
import { z } from 'zod';

const FLOW_MS = 15 * 60 * 1000, FRESH_MS = 5 * 60 * 1000;
const hash = value => createHash('sha256').update(value).digest('hex');
const secret = () => randomBytes(32).toString('base64url');
const fail = code => { throw new APIError('BAD_REQUEST', { code, message: code }); };

export function ensureActivationSchema(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS pending_accounts (uid TEXT PRIMARY KEY, name TEXT NOT NULL, created INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS beta_activation_links (
      uid TEXT PRIMARY KEY, tokenHash TEXT NOT NULL UNIQUE, expiresAt INTEGER NOT NULL, usedAt INTEGER);
    CREATE TABLE IF NOT EXISTS beta_activation_flows (
      tokenHash TEXT PRIMARY KEY, linkHash TEXT NOT NULL, expiresAt INTEGER NOT NULL);`);
}

/** Operator only. Reissuing a pending account's link invalidates its previous link and flows. */
export function issueActivationLinks(db, names, origin, days = 7) {
  if (!names.length || new Set(names.map(n => n.toLowerCase())).size !== names.length) throw new Error('Provide distinct pending nicknames');
  if (!Number.isInteger(days) || days < 1 || days > 7) throw new Error('Validity must be 1–7 days');
  const expiresAt = Date.now() + days * 86400000;
  db.exec('BEGIN IMMEDIATE');
  try {
    const links = names.map(name => {
      const pending = db.prepare('SELECT * FROM pending_accounts WHERE lower(name)=lower(?)').get(name);
      if (!pending || db.prepare('SELECT id FROM user WHERE id=?').get(pending.uid)) throw new Error('Not a pending account: ' + name);
      const token = secret();
      db.prepare('DELETE FROM beta_activation_flows WHERE linkHash IN (SELECT tokenHash FROM beta_activation_links WHERE uid=?)').run(pending.uid);
      db.prepare(`INSERT INTO beta_activation_links(uid,tokenHash,expiresAt,usedAt) VALUES(?,?,?,NULL)
        ON CONFLICT(uid) DO UPDATE SET tokenHash=excluded.tokenHash,expiresAt=excluded.expiresAt,usedAt=NULL`).run(pending.uid, hash(token), expiresAt);
      return { name: pending.name, url: new URL('/ativar/#' + token, origin).href, expiresAt: new Date(expiresAt).toISOString() };
    });
    db.exec('COMMIT'); return links;
  } catch (error) { db.exec('ROLLBACK'); throw error; }
}

function availableLink(db, tokenHash) {
  return db.prepare(`SELECT l.*,p.name FROM beta_activation_links l JOIN pending_accounts p ON p.uid=l.uid
    WHERE l.tokenHash=? AND l.usedAt IS NULL AND l.expiresAt>?`).get(tokenHash, Date.now());
}

function googleIdentity(db, sessionId) {
  const user = db.prepare(`SELECT u.id,u.email,s.createdAt,s.expiresAt FROM session s JOIN user u ON u.id=s.userId
    WHERE s.id=? AND u.emailVerified=1`).get(sessionId || '');
  if (!user || new Date(user.expiresAt).getTime() <= Date.now()) return { code: 'UNAUTHORIZED' };
  if (Date.now() - new Date(user.createdAt).getTime() >= FRESH_MS) return { code: 'SESSION_NOT_FRESH', user };
  const accounts = db.prepare('SELECT providerId FROM account WHERE userId=?').all(user.id);
  if (accounts.length !== 1 || accounts[0].providerId !== 'google') return { code: 'GOOGLE_REQUIRED', user };
  // An existing player must never lose progress or become a different player.
  if (db.prepare('SELECT 1 FROM docs WHERE instr(path,?)>0 OR instr(data,?)>0 LIMIT 1').get(user.id, user.id)
      || db.prepare('SELECT 1 FROM auth_migration_claims WHERE userId=?').get(user.id)) return { code: 'ACCOUNT_HAS_PROGRESS', user };
  return { user };
}

export function activationPlugin(db, origin, googleEnabled) {
  const secure = origin.startsWith('https://');
  const cookieName = (secure ? '__Secure-' : '') + 'pokesurvivor.activation';
  const cookieOptions = { httpOnly: true, secure, sameSite: 'lax', path: '/api/auth/beta-activation', maxAge: FLOW_MS / 1000 };
  function requireOrigin(ctx) { if (ctx.headers?.get('origin') !== origin) fail('INVALID_ORIGIN'); }
  function currentLink(ctx) {
    const token = ctx.getCookie(cookieName);
    const flow = token && db.prepare('SELECT * FROM beta_activation_flows WHERE tokenHash=? AND expiresAt>?').get(hash(token), Date.now());
    if (!flow) fail('ACTIVATION_SESSION_EXPIRED');
    const link = availableLink(db, flow.linkHash);
    if (!link) fail('ACTIVATION_LINK_INVALID');
    return link;
  }
  return {
    id: 'beta-activation',
    endpoints: {
      beginBetaActivation: createAuthEndpoint('/beta-activation/begin', {
        method: 'POST', body: z.object({ token: z.string().regex(/^[A-Za-z0-9_-]{43}$/) })
      }, async ctx => {
        requireOrigin(ctx);
        if (!googleEnabled) fail('GOOGLE_UNAVAILABLE');
        const link = availableLink(db, hash(ctx.body.token));
        if (!link) fail('ACTIVATION_LINK_INVALID');
        const old = ctx.getCookie(cookieName);
        if (old) db.prepare('DELETE FROM beta_activation_flows WHERE tokenHash=?').run(hash(old));
        db.prepare('DELETE FROM beta_activation_flows WHERE expiresAt<=?').run(Date.now());
        const token = secret();
        db.prepare('INSERT INTO beta_activation_flows VALUES(?,?,?)').run(hash(token), link.tokenHash, Math.min(link.expiresAt, Date.now() + FLOW_MS));
        ctx.setCookie(cookieName, token, cookieOptions);
        return ctx.json({ name: link.name });
      }),
      betaActivationStatus: createAuthEndpoint('/beta-activation/status', { method: 'GET' }, async ctx => {
        const session = await getAuthoritativeSessionFromCtx(ctx);
        const link = currentLink(ctx);
        const identity = googleIdentity(db, session?.session.id);
        return ctx.json({ account: { id: link.uid, name: link.name },
          user: identity.user ? { id: identity.user.id, email: identity.user.email } : null,
          canActivate: !identity.code, code: identity.code });
      }),
      completeBetaActivation: createAuthEndpoint('/beta-activation/complete', {
        method: 'POST', use: [sensitiveSessionMiddleware],
        body: z.object({ accountId: z.string(), userId: z.string() })
      }, async ctx => {
        requireOrigin(ctx);
        db.exec('BEGIN IMMEDIATE');
        try {
          // Re-read both capabilities after the middleware's final await.
          const link = currentLink(ctx);
          const identity = googleIdentity(db, ctx.context.session.session.id);
          if (identity.code) fail(identity.code);
          if (ctx.body.accountId !== link.uid || ctx.body.userId !== identity.user.id) fail('ACTIVATION_CHANGED');
          if (db.prepare('SELECT id FROM user WHERE id=?').get(link.uid)) fail('ACTIVATION_LINK_INVALID');
          // Move the verified Google identity and its current session to the original
          // player UID. Deferred FKs make this one atomic rename, with no save copies.
          db.exec('PRAGMA defer_foreign_keys=ON');
          db.prepare('UPDATE user SET id=?,name=?,updatedAt=? WHERE id=?').run(link.uid, link.name, new Date().toISOString(), identity.user.id);
          db.prepare('UPDATE account SET userId=? WHERE userId=?').run(link.uid, identity.user.id);
          db.prepare('DELETE FROM session WHERE userId=? AND id<>?').run(identity.user.id, ctx.context.session.session.id);
          db.prepare('UPDATE session SET userId=? WHERE id=?').run(link.uid, ctx.context.session.session.id);
          db.prepare('DELETE FROM pending_accounts WHERE uid=?').run(link.uid);
          db.prepare('UPDATE beta_activation_links SET usedAt=? WHERE tokenHash=?').run(Date.now(), link.tokenHash);
          db.prepare('DELETE FROM beta_activation_flows WHERE linkHash=?').run(link.tokenHash);
          if (db.prepare('PRAGMA foreign_key_check').all().length) throw new Error('Activation foreign key check failed');
          db.exec('COMMIT');
        } catch (error) { db.exec('ROLLBACK'); throw error; }
        ctx.setCookie(cookieName, '', { ...cookieOptions, maxAge: 0 });
        return ctx.json({ ok: true });
      })
    }
  };
}
