/* Browser contract for Better Auth. Use a LOCAL server with AUTH_EMAIL_MODE=outbox. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const url = process.env.AUTH_TEST_URL || 'http://localhost:3097/dev.html';
if (!['localhost', '127.0.0.1'].includes(new URL(url).hostname)) throw new Error('Auth browser tests require a local outbox server');
const mailDir = process.env.AUTH_TEST_MAIL_DIR || path.resolve('server/data/rehearsal/mail');
const email = `browser-${Date.now()}@example.com`, name = 'Auth' + Date.now().toString().slice(-8);
const password = 'a browser test password 123';
function link(subject) {
  const messages = fs.readdirSync(mailDir).map(file => JSON.parse(fs.readFileSync(path.join(mailDir, file))));
  const mail = messages.find(m => m.to === email && m.subject.startsWith(subject));
  assert.ok(mail, 'outbox message: ' + subject);
  return mail.text.split('\n').find(line => line.startsWith('http'));
}
(async () => {
  const browser = await chromium.launch({executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE,args:['--no-sandbox']});
  const errors = [];
  try {
    const context = await browser.newContext({viewport:{width:1280,height:800},serviceWorkers:'block'});
    const page = await context.newPage();
    context.on('page', p => p.on('pageerror', e => errors.push(e.message)));
    page.on('pageerror', e => errors.push(e.message));
    async function boot(target = url) {
      await page.goto(target);
      await page.waitForFunction(() => document.getElementById('boot').classList.contains('hidden'));
      await page.waitForTimeout(100);
      if (await page.locator('#tap-start').isVisible()) await page.locator('#tap-start').click();
    }
    const failureURL = new URL(url);
    failureURL.searchParams.set('auth','error'); failureURL.searchParams.set('error','account_not_linked');
    await boot(failureURL.href);
    assert.ok((await page.locator('#login-err').innerText()).includes('Verify your email'));
    assert.equal(new URL(page.url()).searchParams.has('error'),false);
    await boot();
    assert.equal(await page.locator('#btn-verify').isVisible(),false);
    await page.locator('[data-tab=register]').click();
    await page.locator('#f-user').fill(name);
    await page.locator('#f-email').fill(email);
    await page.locator('#f-pass').fill(password);
    await page.locator('#btn-auth').click();
    await page.waitForFunction(() => document.getElementById('login-note').textContent.includes('Check your email'));
    assert.equal(await page.locator('#btn-verify').isVisible(),true);
    await boot(link('Verificar'));
    await page.evaluate(name => localStorage.setItem('ps.import',JSON.stringify({save:{v:3,name,coins:4321,owned:{25:{at:1,from:'starter'}},partner:25,starter:25}})),name);
    await page.locator('#f-email').fill(email);
    await page.locator('#f-pass').fill(password);
    await page.locator('#btn-auth').click();
    await page.waitForFunction(() => G.DB.online && !document.getElementById('scr-menu').classList.contains('hidden'));
    const snapshot = await page.evaluate(() => ({uid:G.DB.fb.uid,coins:G.DB.save.coins,name:G.DB.save.name,authKeys:Object.keys(localStorage).filter(k=>['psfb.auth','ps.accounts','ps.session'].includes(k))}));
    assert.ok(snapshot.coins>=4321); assert.equal(snapshot.name,name); assert.deepEqual(snapshot.authKeys,[]);
    const cookies = await context.cookies();
    assert.ok(cookies.some(c=>c.name==='pokesurvivor.session_token'&&c.httpOnly&&c.sameSite==='Lax'));
    assert.equal(await page.evaluate(()=>document.cookie.includes('session_token')),false);
    await page.evaluate(()=>G.DB.flush());
    await page.reload();
    await page.waitForFunction(()=>G.DB.online && G.DB.save?.partner===25);
    assert.equal(await page.evaluate(()=>G.DB.fb.uid),snapshot.uid);
    if (await page.locator('#tap-start').isVisible()) await page.locator('#tap-start').click();
    const second = await context.newPage(); await second.goto(url);
    await second.waitForFunction(()=>G.DB.online);
    await page.evaluate(()=>G.Social.createRoom());
    assert.ok(await page.evaluate(()=>G.Social.room));
    await page.locator('#btn-logout').click();
    await page.waitForFunction(()=>!G.DB.loggedIn);
    await second.waitForFunction(()=>!G.DB.online);
    await second.close();
    await page.locator('#f-forgot').click();
    await page.locator('#f-email').fill(email);
    await page.locator('#btn-auth').click();
    await page.waitForFunction(()=>document.getElementById('login-note').textContent.includes('If an account exists'));
    // A recovery link must take priority even when another tab has logged in.
    await page.evaluate(({email,password})=>G.Auth.signIn(email,password),{email,password});
    await boot(link('Restablecer'));
    assert.equal(await page.locator('#scr-login').isVisible(),true);
    assert.equal(await page.locator('#f-email').isVisible(),false);
    await page.locator('#f-pass').fill('a replacement browser password 456');
    await page.locator('#btn-auth').click();
    await page.waitForFunction(()=>document.getElementById('login-note').textContent.includes('Password saved'));
    assert.equal(new URL(page.url()).searchParams.has('token'),false);
    for (const viewport of [{width:390,height:844},{width:844,height:390}]) {
      await page.setViewportSize(viewport);
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
      await page.locator('#btn-auth').scrollIntoViewIfNeeded();
      await page.screenshot({path:`/tmp/pokesurvivor-auth-${viewport.width}.png`});
    }
    await page.setViewportSize({width:1280,height:800});
    await page.locator('#f-email').fill(email);
    await page.locator('#f-pass').fill('a replacement browser password 456');
    await page.locator('#btn-auth').click();
    await page.waitForFunction(()=>G.DB.online);
    await context.setOffline(true);
    await page.evaluate(async()=>{await G.Auth.refresh(); G.Flow.toLogin();});
    await page.locator('#btn-offline').click();
    await page.waitForFunction(()=>G.DB.loggedIn && !G.DB.online && G.DB.mode==='local');
    assert.ok(await page.evaluate(()=>G.DB.save.coins)>=snapshot.coins);
    await page.locator('#btn-logout').click();
    await page.waitForFunction(()=>!G.DB.loggedIn);
    assert.ok(await page.evaluate(uid=>localStorage.getItem('ps.cloud.'+uid),snapshot.uid));
    await context.setOffline(false);
    assert.deepEqual(errors,[]);
    console.log('Auth UI: registration, verification, import, cookie, restored session, two tabs, recovery, mobile and offline passed.');
  } finally { await browser.close(); }
})().catch(error=>{console.error(error);process.exitCode=1;});
