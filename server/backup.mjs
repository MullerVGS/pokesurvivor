import { DatabaseSync, backup } from 'node:sqlite';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export async function backupDatabase(file) {
  const dir = path.join(path.dirname(file), 'backups');
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const destination = path.join(dir, 'pre-better-auth-' + new Date().toISOString().replace(/[:.]/g, '-') + '.sqlite');
  const source = new DatabaseSync(file, { readOnly: true });
  try { await backup(source, destination); } finally { source.close(); }
  fs.chmodSync(destination, 0o600);
  const copy = new DatabaseSync(destination, { readOnly: true });
  try {
    if (copy.prepare('PRAGMA integrity_check').get().integrity_check !== 'ok') throw new Error('Backup failed integrity check');
  } finally { copy.close(); }
  return { file: destination, sha256: createHash('sha256').update(fs.readFileSync(destination)).digest('hex') };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  console.log(JSON.stringify(await backupDatabase(path.join(process.env.DATA_DIR || './data', 'pokesurvivor.sqlite'))));
}
