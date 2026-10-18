import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { backupDatabase } from './backup.mjs';
import { createAuth } from './auth.mjs';

/** Offline cutover, or activation of pending testers. No legacy password is imported. */
export async function migrateAccounts({ file, emails, env = process.env }) {
  const probe = new DatabaseSync(file, { readOnly: true });
  let accounts;
  try {
    const legacy = probe.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='users'").get();
    const pending = probe.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='pending_accounts'").get();
    accounts = legacy
      ? probe.prepare('SELECT uid, email, created FROM users').all().map(u => {
        const save = probe.prepare('SELECT data FROM docs WHERE path = ?').get('saves/' + u.uid);
        return { uid: u.uid, name: save ? JSON.parse(save.data).save.name : Buffer.from(u.email.split('@')[0], 'hex').toString('utf8'), created: u.created };
      })
      : pending ? probe.prepare('SELECT uid, name, created FROM pending_accounts').all() : [];
    for (const [name, email] of Object.entries(emails)) {
      if (!accounts.some(u => u.name.toLowerCase() === name.toLowerCase())) throw new Error('Unknown account in mapping: ' + name);
      if (typeof email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.endsWith('@jugadores.pokesurvivor.net')) throw new Error('A real email is required for ' + name);
    }
  } finally { probe.close(); }
  const mapping = new Map(Object.entries(emails).map(([name, email]) => [name.toLowerCase(), email.trim().toLowerCase()]));
  if (new Set(mapping.values()).size !== mapping.size) throw new Error('Each account needs a different email');
  const backup = await backupDatabase(file);
  const identity = await createAuth({ file, env, allowLegacy: true });
  const db = identity.database;
  let activated = 0, pending = 0;
  try {
    db.exec('BEGIN IMMEDIATE');
    try {
      db.exec('CREATE TABLE IF NOT EXISTS pending_accounts (uid TEXT PRIMARY KEY, name TEXT NOT NULL, created INTEGER NOT NULL)');
      for (const account of accounts) {
        const email = mapping.get(account.name.toLowerCase());
        if (!email) {
          db.prepare('INSERT OR IGNORE INTO pending_accounts (uid, name, created) VALUES (?, ?, ?)').run(account.uid, account.name, account.created);
          pending++;
          continue;
        }
        db.prepare('INSERT INTO user (id, name, email, emailVerified, createdAt, updatedAt) VALUES (?, ?, ?, 0, ?, ?)')
          .run(account.uid, account.name, email, new Date(account.created).toISOString(), new Date().toISOString());
        db.prepare('INSERT INTO auth_migration_claims (userId, email) VALUES (?, ?)').run(account.uid, email);
        db.prepare('DELETE FROM pending_accounts WHERE uid = ?').run(account.uid);
        activated++;
      }
      db.exec('DROP TABLE IF EXISTS sessions; DROP TABLE IF EXISTS users; COMMIT');
    } catch (error) { db.exec('ROLLBACK'); throw error; }
    return { backup, activated, pending, documents: db.prepare('SELECT count(*) AS n FROM docs').get().n };
  } finally { identity.close(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const mappingFile = process.argv[2];
  if (!mappingFile) throw new Error('Usage: npm run migrate:auth -- /private/account-emails.json (stop the game server first)');
  const file = path.join(process.env.DATA_DIR || './data', 'pokesurvivor.sqlite');
  console.log(JSON.stringify(await migrateAccounts({ file, emails: JSON.parse(fs.readFileSync(mappingFile, 'utf8')) })));
}
