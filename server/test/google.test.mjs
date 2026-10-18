import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { createAuth } from '../auth.mjs';
import { migrateAccounts } from '../migrate-auth.mjs';

test('Google callback claims only verified migration identities and preserves saves', async t => {
  const dir = fs.mkdtempSync('/tmp/pokesurvivor-google-test-'), file = dir + '/game.sqlite';
  const origin = 'http://localhost:3097';
  const env = { NODE_ENV: 'test', BETTER_AUTH_URL: origin, AUTH_EMAIL_MODE: 'outbox',
    GOOGLE_CLIENT_ID: 'test.apps.googleusercontent.com', GOOGLE_CLIENT_SECRET: 'fixture-only' };
  const legacy = new DatabaseSync(file);
  legacy.exec('CREATE TABLE users(uid TEXT PRIMARY KEY,email TEXT,hash TEXT,created INTEGER); CREATE TABLE sessions(token TEXT,uid TEXT); CREATE TABLE docs(path TEXT PRIMARY KEY,data TEXT)');
  legacy.prepare('INSERT INTO users VALUES(?,?,?,?)').run('original-uid', 'legacy@jugadores.pokesurvivor.net', 'discarded-hash', Date.now());
  legacy.prepare('INSERT INTO docs VALUES(?,?)').run('saves/original-uid', JSON.stringify({save:{name:'Muller',coins:4321}}));
  legacy.close();
  await migrateAccounts({ file, emails: { Muller:'migrated@example.com' }, env });
  const identity = await createAuth({ file, env });
  t.after(() => { identity.close(); fs.rmSync(dir, { recursive: true, force: true }); });
  // Stub only Google's external exchange/profile. Exercise real Better Auth
  // routes, state cookies, linking policy, SQLite records and session cookies.
  const context = await identity.auth.$context;
  const provider = context.socialProviders.find(p => p.id === 'google');
  const profiles = new Map();
  provider.validateAuthorizationCode = async ({code,codeVerifier}) => {
    assert.ok(codeVerifier); assert.ok(profiles.has(code)); return {accessToken:code, scopes:['openid','email','profile']};
  };
  provider.getUserInfo = async ({accessToken}) => {
    const user = profiles.get(accessToken);
    return {user,data:{sub:user.id,email:user.email,email_verified:user.emailVerified}};
  };
  const cookie = r => r.headers.getSetCookie().map(v=>v.split(';')[0]).join('; ');
  let client = 1;
  const request = (path,body,cookies='') => identity.auth.handler(new Request(origin+'/api/auth/'+path,{
    method:body===undefined?'GET':'POST',headers:{origin,'content-type':'application/json',cookie:cookies,'x-pokesurvivor-client-ip':'192.0.2.'+client},
    body:body===undefined?undefined:JSON.stringify(body)
  }));
  async function google(email, verified = true, subject = email) {
    client++;
    const start = await request('sign-in/social',{provider:'google',callbackURL:origin+'/dev.html',errorCallbackURL:origin+'/dev.html?auth=error'});
    assert.equal(start.status,200);
    const authorize = new URL((await start.json()).url);
    assert.ok(authorize.searchParams.get('code_challenge'));
    const code = String(profiles.size);
    profiles.set(code,{id:subject,name:'Google name',email,emailVerified:verified});
    const path = 'callback/google?'+new URLSearchParams({code,state:authorize.searchParams.get('state')});
    const result = await request(path,undefined,cookie(start));
    return {result,replay:()=>request(path,undefined,cookie(start))};
  }
  const denied = (await google('migrated@example.com',false)).result;
  assert.equal(new URL(denied.headers.get('location')).searchParams.get('error'),'account_not_linked');
  assert.equal(identity.database.prepare('SELECT count(*) n FROM account').get().n,0);
  const unverifiedNew = (await google('unverified-new@example.com',false)).result;
  assert.equal(new URL(unverifiedNew.headers.get('location')).searchParams.get('error'),'oauth_email_not_verified');
  assert.equal(identity.database.prepare("SELECT count(*) n FROM user WHERE email='unverified-new@example.com'").get().n,0);

  const claimed = await google('migrated@example.com');
  assert.equal(claimed.result.headers.get('location'),origin+'/dev.html');
  const session = await (await request('get-session',undefined,cookie(claimed.result))).json();
  assert.equal(session.user.id,'original-uid'); assert.equal(session.user.emailVerified,true);
  assert.equal(session.user.name,'Muller');
  assert.equal(JSON.parse(identity.database.prepare('SELECT data FROM docs').get().data).save.coins,4321);
  assert.equal(identity.database.prepare('SELECT accountId FROM account WHERE userId=?').get('original-uid').accountId,'migrated@example.com');
  assert.ok(new URL((await claimed.replay()).headers.get('location')).searchParams.has('error'),'state cannot be replayed');

  const registered = await request('sign-up/email',{name:'Unverified',email:'unverified@example.com',password:'an attacker password 123'});
  assert.equal(registered.status,200);
  const blocked = (await google('unverified@example.com')).result;
  assert.equal(new URL(blocked.headers.get('location')).searchParams.get('error'),'account_not_linked');
  // Even a stale operator claim must not admit an unverified account with a password.
  const unsafe = identity.database.prepare('SELECT id FROM user WHERE email=?').get('unverified@example.com');
  identity.database.prepare('INSERT INTO auth_migration_claims VALUES(?,?)').run(unsafe.id,'unverified@example.com');
  assert.equal(new URL((await google('unverified@example.com')).result.headers.get('location')).searchParams.get('error'),'account_not_linked');
  assert.equal(identity.database.prepare("SELECT count(*) n FROM account WHERE providerId='google'").get().n,1);

  const fresh = (await google('new@example.com')).result;
  assert.equal(fresh.headers.get('location'),origin+'/dev.html');
  const freshSession = await (await request('get-session',undefined,cookie(fresh))).json();
  assert.notEqual(freshSession.user.id,'original-uid');
  assert.equal(identity.database.prepare("SELECT count(*) n FROM user WHERE email='migrated@example.com'").get().n,1);
});
