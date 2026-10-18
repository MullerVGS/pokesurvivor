import fs from 'node:fs';
import path from 'node:path';
import { createAuth } from './auth.mjs';
import { backupDatabase } from './backup.mjs';
import { issueActivationLinks } from './activation.mjs';

const names = process.argv.slice(2);
if (!names.length) throw new Error('Usage: node issue-activation-links.mjs nickname [nickname...]');
const file = path.join(process.env.DATA_DIR || './data', 'pokesurvivor.sqlite');
if (!fs.existsSync(file)) throw new Error('Existing game database required');
const backup = await backupDatabase(file);
const identity = await createAuth({ file });
try {
  if (!identity.capabilities.google) throw new Error('Configure Google before issuing activation links');
  // Contains bearer links: redirect stdout to a private file (umask 077).
  console.log(JSON.stringify({ backup, links: issueActivationLinks(identity.database, names, identity.origin) }));
} finally { identity.close(); }
