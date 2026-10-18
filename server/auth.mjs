import { betterAuth } from 'better-auth';
import { getMigrations } from 'better-auth/db/migration';
import { fromNodeHeaders, toNodeHandler } from 'better-auth/node';
import { DatabaseSync } from 'node:sqlite';
import { randomBytes, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import nodemailer from 'nodemailer';

/** Better Auth owns credentials, sessions, verification and recovery. */
export async function createAuth({ file, env = process.env, afterDelete = () => {}, allowLegacy = false }) {
  const production = env.NODE_ENV === 'production';
  const baseURL = env.BETTER_AUTH_URL || (!production && `http://localhost:${env.PORT || 3000}`);
  if (!baseURL) throw new Error('BETTER_AUTH_URL is required');
  const origin = new URL(baseURL).origin;
  if (production && !origin.startsWith('https://')) throw new Error('BETTER_AUTH_URL must use HTTPS');
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  let secret = env.BETTER_AUTH_SECRET;
  if (!secret && !production) {
    const secretFile = path.join(path.dirname(file), 'auth-secret');
    if (!fs.existsSync(secretFile)) fs.writeFileSync(secretFile, randomBytes(48).toString('base64url'), { mode: 0o600, flag: 'wx' });
    secret = fs.readFileSync(secretFile, 'utf8').trim();
  }
  if (!secret || secret.length < 32) throw new Error('BETTER_AUTH_SECRET must contain at least 32 random characters');
  const outbox = !production && env.AUTH_EMAIL_MODE === 'outbox';
  const emailReady = outbox || !!(env.SMTP_HOST && env.SMTP_FROM);
  const google = !!(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET);
  if (!!env.GOOGLE_CLIENT_ID !== !!env.GOOGLE_CLIENT_SECRET) throw new Error('Configure both Google credentials');
  const transport = emailReady && !outbox ? nodemailer.createTransport({
    host: env.SMTP_HOST, port: Number(env.SMTP_PORT || 587), secure: env.SMTP_SECURE === 'true',
    requireTLS: env.SMTP_SECURE !== 'true',
    auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASS } : undefined,
    connectionTimeout: 10000, socketTimeout: 15000
  }) : null;
  async function send(user, subject, url) {
    if (!emailReady) throw new Error('Email delivery is not configured');
    const message = { to: user.email, from: env.SMTP_FROM, subject,
      text: `${subject}\n\n${url}\n\nPokéSurvivor\nSi no lo has solicitado, ignora este correo. / If you did not request this, ignore this email.` };
    if (outbox) {
      const dir = path.join(path.dirname(file), 'mail');
      fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
      fs.writeFileSync(path.join(dir, randomUUID() + '.json'), JSON.stringify(message), { mode: 0o600 });
    } else await transport.sendMail(message);
  }
  const database = new DatabaseSync(file);
  if (!allowLegacy && database.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='users'").get()) {
    database.close();
    throw new Error('Legacy auth found. Stop the old server and run npm run migrate:auth first.');
  }
  database.exec('PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000; PRAGMA foreign_keys = ON;');
  const options = {
    appName: 'PokéSurvivor', baseURL: origin, secret, database,
    trustedOrigins: [origin],
    emailAndPassword: {
      enabled: true, disableSignUp: !emailReady, requireEmailVerification: true,
      minPasswordLength: 15, maxPasswordLength: 128, resetPasswordTokenExpiresIn: 1800,
      revokeSessionsOnPasswordReset: true,
      // A single-use recovery link proves possession of this email address.
      onPasswordReset: async ({ user }) => { database.prepare('UPDATE user SET emailVerified = 1 WHERE id = ?').run(user.id); },
      sendResetPassword: ({ user, url }) => send(user, 'Restablecer contraseña / Reset password', url)
    },
    emailVerification: {
      sendOnSignUp: true, sendOnSignIn: true, autoSignInAfterVerification: false, expiresIn: 1800,
      sendVerificationEmail: ({ user, url }) => send(user, 'Verificar correo / Verify email', url)
    },
    socialProviders: google ? { google: { clientId: env.GOOGLE_CLIENT_ID, clientSecret: env.GOOGLE_CLIENT_SECRET } } : {},
    account: { accountLinking: {
      enabled: true, trustedProviders: [], requireLocalEmailVerified: false
      // validateUserInfo below keeps the verified-local-email rule, except for
      // operator-mapped migration placeholders that have no login credentials.
    } },
    session: {
      expiresIn: 7 * 86400, disableSessionRefresh: true, freshAge: 300,
      cookieCache: { enabled: false }
    },
    user: {
      validateUserInfo: ({ user, source }) => {
        if (source.method !== 'oauth') return;
        if (source.oauth?.providerId !== 'google' || user.emailVerified !== true) return { error: 'oauth_email_not_verified' };
        if (source.action !== 'link-account') return;
        const local = database.prepare('SELECT email, emailVerified FROM user WHERE id = ?').get(user.id);
        if (!local || local.email !== user.email?.toLowerCase()) return { error: 'account_not_linked' };
        if (local.emailVerified) return;
        const claim = database.prepare(`SELECT userId FROM auth_migration_claims WHERE userId = ? AND email = ?
          AND NOT EXISTS (SELECT 1 FROM account WHERE userId = ?)`).get(user.id, local.email, user.id);
        if (!claim) return { error: 'account_not_linked' };
      },
      deleteUser: {
        enabled: emailReady, deleteTokenExpiresIn: 900,
        sendDeleteAccountVerification: ({ user, url }) => send(user, 'Confirmar eliminación / Confirm account deletion', url),
        afterDelete
      }
    },
    advanced: {
      cookiePrefix: 'pokesurvivor', useSecureCookies: origin.startsWith('https://'),
      defaultCookieAttributes: { httpOnly: true, sameSite: 'lax', path: '/' },
      // index.js supplies this header from the socket or an explicitly trusted proxy.
      ipAddress: { ipAddressHeaders: ['x-pokesurvivor-client-ip'] }
    },
    rateLimit: {
      enabled: true, storage: 'database', window: 60, max: 100,
      customRules: {
        '/sign-in/email': { window: 60, max: 10 },
        '/sign-up/email': { window: 60, max: 5 },
        '/request-password-reset': { window: 60, max: 3 },
        '/send-verification-email': { window: 60, max: 3 },
        '/delete-user': { window: 60, max: 3 }
      }
    }
  };
  const migration = await getMigrations(options);
  await migration.runMigrations();
  database.exec(`CREATE TABLE IF NOT EXISTS auth_migration_claims (
    userId TEXT PRIMARY KEY REFERENCES user(id) ON DELETE CASCADE, email TEXT NOT NULL
  )`);
  const auth = betterAuth(options);
  const context = await auth.$context;
  await context.checkSchema?.();
  return {
    auth, database, handler: toNodeHandler(auth), origin,
    capabilities: { email: emailReady, google },
    async session(req) {
      const session = await auth.api.getSession({ headers: fromNodeHeaders(req.headers), query: { disableCookieCache: true, disableRefresh: true } });
      return session?.user.emailVerified ? session : null;
    },
    close() { transport?.close(); database.close(); }
  };
}
