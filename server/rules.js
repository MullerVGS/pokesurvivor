/* ============ rules.js — quién puede leer y escribir cada documento ============
 * Versión resumida de firestore.rules: se mantiene quién es dueño de qué
 * (partidas, perfiles, amistades, invitaciones, marcas) y se deja fuera el
 * anti-trampas del ranking, que en un servidor entre amigos no hace falta.
 *
 *   canRead(uid, path, data)            data = documento (o null si no existe)
 *   canWrite(uid, path, before, after)  after = null al borrar
 */
const ADMINS = (process.env.ADMINS || '').split(',').map(s => s.trim()).filter(Boolean);
const isAdmin = uid => !!uid && ADMINS.includes(uid);
const NICK = /^[a-z0-9_ñáéíóú]{3,16}$/;

function parts(path) { return path.split('/'); }

function canRead(uid, path, data) {
  if (!uid) return false;
  const [c, a, sub] = parts(path);
  switch (c) {
    case 'saves': return a === uid || isAdmin(uid);
    case 'runs': return a === uid;
    case 'names': case 'profiles': case 'pres': case 'lbs': return true;
    case 'lb': return sub === 'e';
    case 'friendships': return !data || (data.users || []).includes(uid);
    case 'inv': return !data || data.to === uid || data.from === uid;
    case 'reports': return isAdmin(uid);
    default: return false;
  }
}

function canWrite(uid, path, before, after) {
  if (!uid) return false;
  const [c, a, sub, id] = parts(path);
  const del = after == null;
  switch (c) {
    case 'saves':
      if (a !== uid) return isAdmin(uid) && !del;
      // El dueño no puede quitarse un baneo del ranking.
      return del || !!(before && before.ban) === !!after.ban;
    case 'runs': case 'profiles': case 'pres':
      return a === uid;
    case 'names':
      if (del) return !!before && before.uid === uid;
      return !before && after.uid === uid && NICK.test(a);
    case 'friendships':
      if (del) return !!before && (before.users || []).includes(uid);
      if (!before) {
        const u = after.users || [];
        return after.from === uid && after.to !== uid && after.status === 'pending'
          && u.length === 2 && u[0] < u[1] && u.includes(uid) && u.includes(after.to) && a === u[0] + '_' + u[1];
      }
      return before.to === uid && before.status === 'pending' && after.status === 'ok'
        && JSON.stringify(after.users) === JSON.stringify(before.users);
    case 'inv':
      if (del) return !!before && (before.to === uid || before.from === uid);
      return after.from === uid && a === after.to + '_' + uid;
    case 'lb':
      if (sub !== 'e' || !id) return false;
      if (del) return isAdmin(uid) || (!!before && (before.uids || []).includes(uid));
      if (!(after.uids || []).includes(uid)) return false;
      return a.startsWith('s_') ? id === uid : id === after.uids.join('_');
    case 'lbs':
      return !del || isAdmin(uid);
    case 'reports':
      if (del) return isAdmin(uid);
      return !before && after.by === uid;
    default:
      return false;
  }
}

module.exports = { canRead, canWrite, isAdmin };
