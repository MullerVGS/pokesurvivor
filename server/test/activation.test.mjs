import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { createAuth } from '../auth.mjs';
import { issueActivationLinks } from '../activation.mjs';

async function fixture(t) {
  const dir = fs.mkdtempSync('/tmp/pokesurvivor-activation-'), file = dir + '/game.sqlite';
  const setup = new DatabaseSync(file);
  setup.exec('CREATE TABLE docs(path TEXT PRIMARY KEY,data TEXT,v INTEGER)'); setup.close();
  const origin = 'https://game.test';
  const identity = await createAuth({ file, env: { NODE_ENV:'test', BETTER_AUTH_URL:origin,
    GOOGLE_CLIENT_ID:'fixture.apps.googleusercontent.com',GOOGLE_CLIENT_SECRET:'fixture' } });
  t.after(() => { identity.close(); fs.rmSync(dir,{recursive:true,force:true}); });
  const db = identity.database;
  for (const [id,name] of [['original-rajin','Rajin'],['original-meems','Meems']]) {
    db.prepare('INSERT INTO pending_accounts VALUES(?,?,?)').run(id,name,1234);
    db.prepare('INSERT INTO docs VALUES(?,?,?)').run('saves/'+id,JSON.stringify({save:{name,coins:4321,owned:{25:{at:1}}}}),9);
    db.prepare('INSERT INTO docs VALUES(?,?,?)').run('profiles/'+id,JSON.stringify({name,lower:name.toLowerCase()}),3);
  }
  db.prepare('INSERT INTO docs VALUES(?,?,?)').run('friendships/original-rajin_original-meems',JSON.stringify({users:['original-rajin','original-meems'],names:{'original-rajin':'Rajin','original-meems':'Meems'}}),2);
  const profiles = new Map();
  const provider = (await identity.auth.$context).socialProviders.find(p=>p.id==='google');
  provider.validateAuthorizationCode = async ({code,codeVerifier}) => { assert.ok(codeVerifier); return {accessToken:code,scopes:['openid','email','profile']}; };
  provider.getUserInfo = async ({accessToken}) => {
    const user=profiles.get(accessToken);
    return {user,data:{sub:user.id,email:user.email,email_verified:user.emailVerified}};
  };
  let serial = 0;
  function browser() {
    const ip = '192.0.2.'+(++serial), cookies = new Map();
    async function request(route, body, requestOrigin = origin) {
      const response = await identity.auth.handler(new Request(origin+'/api/auth/'+route,{
        method:body===undefined?'GET':'POST',headers:{origin:requestOrigin,'content-type':'application/json',cookie:[...cookies].map(([k,v])=>k+'='+v).join('; '),'x-pokesurvivor-client-ip':ip},
        body:body===undefined?undefined:JSON.stringify(body)
      }));
      for (const header of response.headers.getSetCookie()) { const value=header.split(';')[0], at=value.indexOf('='); cookies.set(value.slice(0,at),value.slice(at+1)); }
      return response;
    }
    return {request,cookies,
      begin:link=>request('beta-activation/begin',{token:new URL(link.url).hash.slice(1)}),
      status:async()=> (await request('beta-activation/status')).json(),
      async google(email='tester-'+ip+'@example.com', verified=true) {
        const start=await request('sign-in/social',{provider:'google',callbackURL:origin+'/ativar/',additionalParams:{prompt:'select_account'}});
        assert.equal(start.status,200);
        const authorization=new URL((await start.json()).url);
        assert.equal(authorization.searchParams.get('prompt'),'select_account');
        const code=String(profiles.size); profiles.set(code,{id:email,name:'Google display name',email,emailVerified:verified});
        await request('callback/google?'+new URLSearchParams({state:authorization.searchParams.get('state'),code}));
        return (await request('get-session')).json();
      },
      async complete(status) { return request('beta-activation/complete',{accountId:status.account.id,userId:status.user.id}); }
    };
  }
  return {db,browser,issue:(...names)=>issueActivationLinks(db,names,origin)};
}

test('activation keeps original UID, all documents and Google session; viewing never consumes it',async t=>{
  const f=await fixture(t), [link]=f.issue('Rajin'), b=f.browser();
  const before=f.db.prepare('SELECT * FROM docs ORDER BY path').all();
  assert.ok(!JSON.stringify(f.db.prepare('SELECT * FROM beta_activation_links').all()).includes(new URL(link.url).hash.slice(1)));
  const begin=await b.begin(link); assert.equal(begin.status,200);
  const header=begin.headers.getSetCookie().find(c=>c.includes('activation='));
  assert.match(header,/HttpOnly/i); assert.match(header,/Secure/i); assert.match(header,/SameSite=Lax/i);
  assert.equal((await b.status()).canActivate,false);
  assert.equal(f.db.prepare('SELECT usedAt FROM beta_activation_links').get().usedAt,null);
  const google=await b.google(); assert.notEqual(google.user.id,'original-rajin');
  const status=await b.status(); assert.equal(status.account.name,'Rajin'); assert.equal(status.canActivate,true);
  const wrong=await b.complete({...status,account:{id:'original-meems'}}); assert.equal(wrong.status,400);
  assert.equal((await wrong.json()).code,'ACTIVATION_CHANGED');
  assert.equal((await b.complete(status)).status,200);
  const restored=await (await b.request('get-session')).json();
  assert.equal(restored.user.id,'original-rajin'); assert.equal(restored.user.name,'Rajin'); assert.equal(restored.user.emailVerified,true);
  assert.equal(restored.session.token,google.session.token);
  assert.equal(f.db.prepare('SELECT userId FROM account').get().userId,'original-rajin');
  assert.equal(f.db.prepare('SELECT count(*) n FROM pending_accounts').get().n,1);
  assert.deepEqual(f.db.prepare('SELECT * FROM docs ORDER BY path').all(),before);
  assert.deepEqual(f.db.prepare('PRAGMA foreign_key_check').all(),[]);
  assert.equal((await b.complete(status)).status,400);
  assert.equal((await f.browser().begin(link)).status,400);
});

test('expired, reissued and stale browser flows cannot activate a player',async t=>{
  const f=await fixture(t), b=f.browser();
  const [original]=f.issue('Rajin'); await b.begin(original);
  const [replacement]=f.issue('Rajin');
  assert.equal((await b.begin(original)).status,400);
  assert.equal((await b.status()).code,'ACTIVATION_SESSION_EXPIRED');
  await b.begin(replacement);
  f.db.prepare('UPDATE beta_activation_flows SET expiresAt=0').run();
  assert.equal((await b.status()).code,'ACTIVATION_SESSION_EXPIRED');
  f.db.prepare('UPDATE beta_activation_links SET expiresAt=0').run();
  assert.equal((await b.begin(replacement)).status,400);
  assert.equal(f.db.prepare('SELECT count(*) n FROM pending_accounts').get().n,2);
});

test('two verified identities racing for a link produce exactly one owner',async t=>{
  const f=await fixture(t), [link]=f.issue('Meems'), a=f.browser(),b=f.browser();
  await a.begin(link); await b.begin(link); await a.google(); await b.google();
  const sa=await a.status(),sb=await b.status();
  const results=await Promise.all([a.complete(sa),b.complete(sb)]);
  assert.deepEqual(results.map(r=>r.status).sort(),[200,400]);
  assert.equal(f.db.prepare("SELECT count(*) n FROM user WHERE id='original-meems'").get().n,1);
  assert.equal(f.db.prepare("SELECT count(*) n FROM account WHERE userId='original-meems'").get().n,1);
  assert.deepEqual(f.db.prepare('PRAGMA foreign_key_check').all(),[]);
});

test('existing progress, revoked sessions, unverified Google and cross-origin requests are rejected',async t=>{
  const f=await fixture(t), [link]=f.issue('Rajin'), b=f.browser();
  const invalidOrigin=await b.request('beta-activation/begin',{token:new URL(link.url).hash.slice(1)},'https://evil.test');
  assert.ok([400,403].includes(invalidOrigin.status));
  await b.begin(link);
  assert.equal(await b.google('unverified@example.com',false),null);
  assert.equal((await b.request('beta-activation/complete',{accountId:'original-rajin',userId:'fake'})).status,401);
  const session=await b.google('owner@example.com');
  f.db.prepare('INSERT INTO docs VALUES(?,?,?)').run('saves/'+session.user.id,'{"save":{"coins":999}}',1);
  const status=await b.status(); assert.equal(status.code,'ACCOUNT_HAS_PROGRESS');
  assert.equal((await b.complete(status)).status,400);
  assert.equal(f.db.prepare('SELECT data FROM docs WHERE path=?').get('saves/'+session.user.id).data,'{"save":{"coins":999}}');
  await b.request('sign-out',{});
  assert.equal((await b.complete(status)).status,401);
  assert.equal(f.db.prepare('SELECT count(*) n FROM pending_accounts').get().n,2);
  assert.equal(f.db.prepare('SELECT usedAt FROM beta_activation_links').get().usedAt,null);
});

test('confirmation binds both identities and requires a fresh session; begin is rate-limited',async t=>{
  const f=await fixture(t), [rajin,meems]=f.issue('Rajin','Meems'), b=f.browser();
  await b.begin(rajin); const session=await b.google(); const old=await b.status();
  await b.begin(meems);
  assert.equal((await (await b.complete(old)).json()).code,'ACTIVATION_CHANGED');
  const current=await b.status();
  assert.equal((await (await b.complete({...current,user:{id:'different-google-user'}})).json()).code,'ACTIVATION_CHANGED');
  f.db.prepare('UPDATE session SET createdAt=? WHERE id=?').run(new Date(Date.now()-3600000).toISOString(),session.session.id);
  assert.equal((await b.status()).code,'SESSION_NOT_FRESH');
  assert.equal((await (await b.complete(current)).json()).code,'SESSION_NOT_FRESH');
  const c=f.browser(); let result;
  for(let i=0;i<11;i++) result=await c.begin(rajin);
  assert.equal(result.status,429);
});
