import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import net from 'node:net';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import WebSocket from 'ws';
import { migrateAccounts } from '../migrate-auth.mjs';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
async function server(t, dir = fs.mkdtempSync('/tmp/pokesurvivor-auth-test-')) {
  const listener = net.createServer(); listener.listen(0, '127.0.0.1'); await once(listener, 'listening');
  const port = listener.address().port; await new Promise(resolve => listener.close(resolve));
  const origin = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, ['index.js'], { cwd: root, env: { ...process.env, NODE_ENV: 'test', PORT: String(port), DATA_DIR: dir, AUTH_EMAIL_MODE: 'outbox', BETTER_AUTH_URL: origin, BETTER_AUTH_SECRET: 'test-only-secret-with-more-than-32-characters', GOOGLE_CLIENT_ID: '', GOOGLE_CLIENT_SECRET: '' }, stdio: ['ignore', 'pipe', 'pipe'] });
  let logs = ''; child.stderr.on('data', chunk => { logs += chunk; });
  t.after(async () => {
    if (child.exitCode === null) { const exited = once(child, 'exit'); child.kill('SIGTERM'); await exited; }
    fs.rmSync(dir, { recursive: true, force: true });
  });
  await Promise.race([once(child.stdout, 'data'), once(child, 'exit').then(() => { throw new Error(logs); })]);
  async function request(route, body, cookie = '', extra = {}) {
    const response = await fetch(origin + route, { method: body === undefined ? 'GET' : 'POST', headers: { origin, 'content-type': 'application/json', ...(cookie ? {cookie} : {}), ...extra }, body: body === undefined ? undefined : JSON.stringify(body), redirect: 'manual' });
    return { status: response.status, body: await response.json().catch(() => null), headers: response.headers, cookie: response.headers.getSetCookie().map(x => x.split(';')[0]).join('; ') };
  }
  function mail(to, subject) {
    return fs.readdirSync(dir + '/mail').map(name => JSON.parse(fs.readFileSync(dir + '/mail/' + name))).filter(m => m.to === to && m.subject.startsWith(subject)).at(-1);
  }
  async function follow(message, cookie = '') {
    const url = message.text.split('\n').find(x => x.startsWith('http'));
    return fetch(url, { headers: {cookie}, redirect: 'manual' });
  }
  async function signup(email, name = 'Tester') {
    const result = await request('/api/auth/sign-up/email', { email, name, password: 'long test password 123', callbackURL: origin + '/dev.html?auth=verified' });
    assert.equal(result.status, 200, JSON.stringify(result.body)); return result.body.user;
  }
  async function login(email, password = 'long test password 123') {
    const result = await request('/api/auth/sign-in/email', { email, password });
    assert.equal(result.status, 200, JSON.stringify(result.body)); return result.cookie;
  }
  async function socket(cookie) {
    const ws = new WebSocket(origin.replace('http:', 'ws:') + '/api/ws', { headers: {origin, cookie} });
    const hello = once(ws, 'message'); await once(ws, 'open');
    assert.equal(JSON.parse((await hello)[0]).ok, true);
    t.after(() => ws.terminate()); return ws;
  }
  return { request, mail, follow, signup, login, socket, origin, dir, logs: () => logs };
}

test('WebSocket is closed if activation moves its session to a different player UID', async t => {
  const s = await server(t), email = 'uid-change@example.com';
  const user = await s.signup(email);
  await s.follow(s.mail(email, 'Verificar'));
  const cookie = await s.login(email), ws = await s.socket(cookie);
  const db = new DatabaseSync(path.join(s.dir, 'pokesurvivor.sqlite'));
  db.exec('PRAGMA foreign_keys=ON; BEGIN IMMEDIATE; PRAGMA defer_foreign_keys=ON');
  db.prepare('UPDATE user SET id=? WHERE id=?').run('restored-player', user.id);
  db.prepare('UPDATE account SET userId=? WHERE userId=?').run('restored-player', user.id);
  db.prepare('UPDATE session SET userId=? WHERE userId=?').run('restored-player', user.id);
  db.exec('COMMIT'); db.close();
  const closed = once(ws, 'close');
  ws.send(JSON.stringify({t:'rt',op:'get',path:'rooms/test',rid:'stale-uid'}));
  assert.equal((await closed)[0], 1008);
  assert.equal((await s.request('/api/auth/get-session', undefined, cookie)).body.user.id, 'restored-player');
});

test('verified accounts, cookie sessions, authorization, logout, recovery and deletion', {timeout:30000}, async t => {
  const s = await server(t), email = 'tester@example.com';
  assert.equal((await s.request('/api/auth/sign-up/email', {name:'Tester',email,password:'short'})).status, 400);
  const user = await s.signup(email);
  assert.equal((await s.request('/api/auth/sign-in/email', {email,password:'long test password 123'})).status, 403);
  await s.follow(s.mail(email,'Verificar'));
  let cookie = await s.login(email);
  assert.match(cookie, /pokesurvivor.session_token=/);
  const login = await s.request('/api/auth/sign-in/email', {email,password:'long test password 123'});
  assert.match(login.headers.get('set-cookie'), /HttpOnly/i);
  assert.match(login.headers.get('set-cookie'), /SameSite=Lax/i);
  assert.equal((await s.request('/api/fs/get', {path:'saves/'+user.id})).status,401);
  assert.equal((await s.request('/api/fs/commit', {writes:[{op:'set',path:'saves/'+user.id,data:{save:{name:'Tester',coins:12345}}}]},cookie)).status,200);
  assert.equal((await s.request('/api/fs/get',{path:'saves/'+user.id},cookie)).body.data.save.coins,12345);
  assert.equal((await s.request('/api/fs/get',{path:'saves/another-user'},cookie)).status,403);
  assert.equal((await s.request('/api/fs/get',{path:'saves/'+user.id},cookie,{origin:'https://evil.example'})).status,403);
  assert.equal((await s.request('/api/auth/sign-in/email',{email,password:'long test password 123'},'',{origin:'https://evil.example'})).status,403);
  const ws = await s.socket(cookie);
  const closed = once(ws,'close');
  // A request begun before logout must be authorized again when its body finishes.
  const body = JSON.stringify({writes:[{op:'set',path:'saves/'+user.id,data:{save:{coins:999}}}]});
  let finishUpload;
  const stalled = new Promise((resolve,reject) => {
    const upload = http.request(s.origin+'/api/fs/commit',{method:'POST',headers:{origin:s.origin,cookie,'content-type':'application/json','content-length':Buffer.byteLength(body)}}, response => {response.resume();resolve(response.statusCode);});
    upload.on('error',reject); upload.write(body.slice(0,10));
    finishUpload = () => upload.end(body.slice(10));
  });
  await new Promise(resolve=>setTimeout(resolve,50));
  assert.equal((await s.request('/api/auth/sign-out',{},cookie)).status,200);
  finishUpload(); assert.equal(await stalled,401);
  assert.equal((await closed)[0],1008);
  assert.equal((await s.request('/api/fs/get',{path:'saves/'+user.id},cookie)).status,401);
  cookie = await s.login(email);
  assert.equal((await s.request('/api/fs/get',{path:'saves/'+user.id},cookie)).body.data.save.coins,12345);
  const ws2 = await s.socket(cookie), closed2 = once(ws2,'close');
  assert.equal((await s.request('/api/auth/request-password-reset',{email,redirectTo:s.origin+'/dev.html?auth=reset'})).status,200);
  const redirected = await s.follow(s.mail(email,'Restablecer'));
  const token = new URL(redirected.headers.get('location')).searchParams.get('token');
  const password = 'the replacement password 456';
  assert.equal((await s.request('/api/auth/reset-password',{token,newPassword:password})).status,200);
  assert.equal((await closed2)[0],1008);
  assert.equal((await s.request('/api/auth/reset-password',{token,newPassword:password})).status,400);
  assert.equal((await s.request('/api/auth/sign-in/email',{email,password:'long test password 123'})).status,401);
  cookie = await s.login(email,password);
  assert.equal((await s.request('/api/auth/delete-user',{callbackURL:s.origin+'/dev.html?auth=deleted'},cookie)).status,200);
  assert.equal((await s.request('/api/fs/get',{path:'saves/'+user.id},cookie)).status,200,'requesting deletion must not delete data');
  await s.follow(s.mail(email,'Confirmar'),cookie);
  assert.equal((await s.request('/api/fs/get',{path:'saves/'+user.id},cookie)).status,401);
  assert.equal((await s.request('/api/auth/sign-in/email',{email,password})).status,401);
});

test('rate limits cannot be bypassed by spoofing forwarded IP headers', {timeout:15000}, async t => {
  const s = await server(t);
  let result;
  for (let i=0;i<11;i++) result = await s.request('/api/auth/sign-in/email',{email:'missing@example.com',password:'long test password 123'},'',{'x-forwarded-for':`192.0.2.${i}`,'x-pokesurvivor-client-ip':`192.0.2.${i}`});
  assert.equal(result.status,429);
});

test('cutover keeps saves and IDs, removes old credentials and permits later tester activation', {timeout:30000}, async t => {
  const dir=fs.mkdtempSync('/tmp/pokesurvivor-migrate-test-'), file=dir+'/pokesurvivor.sqlite';
  const db=new DatabaseSync(file);
  db.exec("CREATE TABLE users(uid TEXT PRIMARY KEY,email TEXT,hash TEXT,created INTEGER); CREATE TABLE sessions(token TEXT,uid TEXT); CREATE TABLE docs(path TEXT PRIMARY KEY,parent TEXT,cid TEXT,id TEXT,data TEXT,v INTEGER,updated INTEGER)");
  for (const [uid,name] of [['player-a','Muller'],['player-b','Pending']]) {
    db.prepare('INSERT INTO users VALUES(?,?,?,?)').run(uid,Buffer.from(name.toLowerCase()).toString('hex')+'@jugadores.pokesurvivor.net','legacy-hash-never-accepted',Date.now());
    db.prepare('INSERT INTO docs VALUES(?,?,?,?,?,1,0)').run('saves/'+uid,'saves','saves',uid,JSON.stringify({save:{name,coins:4321}}));
  }
  db.close();
  const env={NODE_ENV:'test',BETTER_AUTH_URL:'http://localhost:3000',AUTH_EMAIL_MODE:'outbox'};
  const migrated=await migrateAccounts({file,emails:{Muller:'muller@example.com'},env});
  assert.equal(migrated.activated,1); assert.equal(migrated.pending,1); assert.equal(migrated.documents,2);
  const original=new DatabaseSync(migrated.backup.file,{readOnly:true});
  assert.equal(original.prepare('SELECT count(*) AS n FROM users').get().n,2); original.close();
  const activated=await migrateAccounts({file,emails:{Pending:'pending@example.com'},env});
  assert.equal(activated.activated,1); assert.equal(activated.pending,0);
  const s=await server(t,dir);
  assert.equal((await s.request('/api/auth/login',{email:'muller@example.com',password:'legacy-hash-never-accepted'})).status,404);
  await s.request('/api/auth/request-password-reset',{email:'muller@example.com',redirectTo:s.origin+'/dev.html?auth=reset'});
  const result=await s.follow(s.mail('muller@example.com','Restablecer'));
  const token=new URL(result.headers.get('location')).searchParams.get('token');
  await s.request('/api/auth/reset-password',{token,newPassword:'long test password 123'});
  const cookie=await s.login('muller@example.com');
  const session=await s.request('/api/auth/get-session',undefined,cookie);
  assert.equal(session.body.user.id,'player-a');
  assert.equal((await s.request('/api/fs/get',{path:'saves/player-a'},cookie)).body.data.save.coins,4321);
});

test('expired cookies and foreign WebSocket origins cannot access the game', {timeout:15000}, async t => {
  const s=await server(t), email='expiration@example.com';
  const user=await s.signup(email); await s.follow(s.mail(email,'Verificar'));
  const cookie=await s.login(email);
  for (const headers of [{origin:s.origin},{origin:'https://evil.example',cookie}]) {
    const rejected=new WebSocket(s.origin.replace('http:','ws:')+'/api/ws',{headers});
    await assert.rejects(once(rejected,'open'));
    rejected.terminate();
  }
  const ws=await s.socket(cookie), closed=once(ws,'close');
  // Advance the persisted session to its expired state, then test the public protocols.
  const fixture=new DatabaseSync(s.dir+'/pokesurvivor.sqlite');
  fixture.prepare('UPDATE session SET expiresAt = ? WHERE userId = ?').run(new Date(Date.now()-60000).toISOString(),user.id); fixture.close();
  assert.equal((await s.request('/api/fs/get',{path:'saves/'+user.id},cookie)).status,401);
  ws.send(JSON.stringify({t:'sub',id:'expired',q:{path:'profiles'}}));
  assert.equal((await closed)[0],1008);
});
