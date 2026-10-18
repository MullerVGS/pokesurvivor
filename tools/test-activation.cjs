/* Activation UI with real Better Auth cookies/callbacks; only Google is simulated. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { chromium } = require('playwright');
(async () => {
  const { createAuth } = await import('../server/auth.mjs');
  const { issueActivationLinks } = await import('../server/activation.mjs');
  const dir=fs.mkdtempSync('/tmp/pokesurvivor-activation-ui-'),file=path.join(dir,'game.sqlite');
  const setup=new DatabaseSync(file); setup.exec('CREATE TABLE docs(path TEXT PRIMARY KEY,data TEXT)'); setup.close();
  let identity, googleEmail='browser-rajin@example.com', cancelGoogle=false;
  const requests=[];
  const server=http.createServer(async(req,res)=>{
    requests.push(req.url);
    res.setHeader('cache-control','no-store');
    const url=new URL(req.url,origin);
    if(url.pathname.startsWith('/api/auth/')) {
      req.headers['x-pokesurvivor-client-ip']='127.0.0.1';
      return identity.handler(req,res);
    }
    if(url.pathname==='/test-google') {
      const query=new URLSearchParams({state:url.searchParams.get('state')});
      query.set(cancelGoogle?'error':'code',cancelGoogle?'access_denied':'test-google-code');
      res.writeHead(302,{location:'/api/auth/callback/google?'+query}); return res.end();
    }
    if(url.pathname==='/') {
      const session=await identity.session(req);
      res.setHeader('content-type','text/plain');return res.end(session?'game-ready-'+session.user.id:'anonymous');
    }
    const local=url.pathname==='/ativar/'?'/ativar/index.html':url.pathname;
    const target=path.resolve(__dirname,'..','.'+local);
    if(!target.startsWith(path.resolve(__dirname,'..')+path.sep)||!fs.existsSync(target)) {res.writeHead(404);return res.end();}
    res.setHeader('content-type',local.endsWith('.js')?'application/javascript':local.endsWith('.html')?'text/html':'application/octet-stream');
    fs.createReadStream(target).pipe(res);
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const origin='http://127.0.0.1:'+server.address().port;
  let browser;
  try {
    identity=await createAuth({file,env:{NODE_ENV:'test',BETTER_AUTH_URL:origin,GOOGLE_CLIENT_ID:'fixture',GOOGLE_CLIENT_SECRET:'fixture'}});
    for(const[name,id]of[['Rajin','old-rajin'],['Meems','old-meems']]) {
      identity.database.prepare('INSERT INTO pending_accounts VALUES(?,?,?)').run(id,name,Date.now());
      identity.database.prepare('INSERT INTO docs VALUES(?,?)').run('saves/'+id,JSON.stringify({save:{name,coins:4321}}));
    }
    const before=identity.database.prepare('SELECT * FROM docs ORDER BY path').all();
    const links=issueActivationLinks(identity.database,['Rajin','Meems'],origin);
    const provider=(await identity.auth.$context).socialProviders.find(p=>p.id==='google');
    const authorize=provider.createAuthorizationURL;
    provider.createAuthorizationURL=async options=>{
      const url=new URL(await authorize(options));
      assert.equal(url.searchParams.get('prompt'),'select_account');
      return new URL('/test-google?'+new URLSearchParams({state:url.searchParams.get('state')}),origin);
    };
    provider.validateAuthorizationCode=async ({codeVerifier})=>{assert.ok(codeVerifier);return {accessToken:'test',scopes:['openid','email','profile']};};
    provider.getUserInfo=async()=>({user:{id:googleEmail,name:'Google name',email:googleEmail,emailVerified:true},data:{sub:googleEmail,email:googleEmail,email_verified:true}});
    browser=await chromium.launch({executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE,args:['--no-sandbox']});
    const context=await browser.newContext({viewport:{width:390,height:844},locale:'pt-BR'});
    const page=await context.newPage(),errors=[];
    page.on('pageerror',error=>errors.push(error.message));
    await page.goto(links[0].url);
    await page.waitForFunction(()=>document.getElementById('title').textContent==='Conta: Rajin');
    assert.equal(new URL(page.url()).hash,'');
    assert.equal(await page.locator('#activate').isVisible(),false);
    assert.equal(identity.database.prepare('SELECT usedAt FROM beta_activation_links WHERE uid=?').get('old-rajin').usedAt,null);
    await page.reload(); await page.locator('#google').waitFor({state:'visible'});
    await page.locator('#google').click();
    await page.waitForFunction(()=>!document.getElementById('activate').hidden);
    assert.match(await page.locator('#identity').innerText(),/browser-rajin@example.com/);
    assert.equal(await page.locator('#activate').innerText(),'Ativar Rajin');
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    assert.equal(await page.evaluate(()=>localStorage.length+sessionStorage.length),0);
    assert.ok((await context.cookies()).find(c=>c.name==='pokesurvivor.activation'&&c.httpOnly&&c.sameSite==='Lax'));
    await page.screenshot({path:'/tmp/pokesurvivor-activation-mobile.png',fullPage:true});
    await page.locator('#activate').click();await page.waitForURL(origin+'/');
    assert.equal(await page.locator('body').innerText(),'game-ready-old-rajin');
    assert.deepEqual(identity.database.prepare('SELECT * FROM docs ORDER BY path').all(),before);
    await page.goto(links[0].url);
    await page.waitForFunction(()=>document.getElementById('status').textContent.includes('já foi usado'));
    assert.equal(await page.locator('#activate').isVisible(),false);
    await page.goto(links[1].url);
    await page.waitForFunction(()=>document.getElementById('status').textContent.includes('outra partida'));
    assert.equal(await page.locator('#activate').isVisible(),false);
    cancelGoogle=true; await page.locator('#google').click();
    await page.waitForFunction(()=>document.getElementById('status').textContent.includes('não foi concluído'));
    cancelGoogle=false;googleEmail='browser-meems@example.com';
    await page.locator('#google').click();
    await page.waitForFunction(()=>!document.getElementById('activate').hidden);
    assert.equal(await page.locator('#activate').innerText(),'Ativar Meems');
    await page.setViewportSize({width:1280,height:800});
    await page.screenshot({path:'/tmp/pokesurvivor-activation-desktop.png',fullPage:true});
    await page.locator('#activate').click();await page.waitForURL(origin+'/');
    assert.equal(await page.locator('body').innerText(),'game-ready-old-meems');
    assert.deepEqual(identity.database.prepare('SELECT * FROM docs ORDER BY path').all(),before);
    assert.deepEqual(errors,[]);
    for(const link of links) assert.ok(requests.every(url=>!url.includes(new URL(link.url).hash.slice(1))),'Bearer links never enter request URLs');
    console.log('Activation browser: Google callback, explicit confirmation, original UIDs/saves, replay, existing account, cancellation/retry, mobile/desktop and private tokens passed.');
  } finally {
    if(browser)await browser.close();
    await new Promise(resolve=>{server.close(resolve);server.closeAllConnections();});
    identity?.close();fs.rmSync(dir,{recursive:true,force:true});
  }
})().catch(error=>{console.error(error);process.exitCode=1;});
