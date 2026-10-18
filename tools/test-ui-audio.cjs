/* Start server/index.js with an isolated DATA_DIR first.
 * UI_AUDIO_TEST_URL=http://127.0.0.1:3092/dev.html node tools/test-ui-audio.cjs
 * Uses a generated test tone, never a copyrighted soundtrack.
 */
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const fs = require('node:fs');
const URL = process.env.UI_AUDIO_TEST_URL || 'http://127.0.0.1:3092/dev.html';
const artifacts = process.env.UI_AUDIO_ARTIFACTS || '/tmp/pokesurvivor-ui-audio';

function wav(seconds = 1) {
  const rate = 22050, n = rate * seconds, data = Buffer.alloc(44 + n * 2);
  data.write('RIFF'); data.writeUInt32LE(data.length - 8, 4); data.write('WAVEfmt ', 8);
  data.writeUInt32LE(16, 16); data.writeUInt16LE(1, 20); data.writeUInt16LE(1, 22);
  data.writeUInt32LE(rate, 24); data.writeUInt32LE(rate * 2, 28);
  data.writeUInt16LE(2, 32); data.writeUInt16LE(16, 34); data.write('data', 36);
  data.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) data.writeInt16LE(Math.round(Math.sin(i * 2 * Math.PI * 440 / rate) * 5000), 44 + i * 2);
  return data;
}

(async () => {
  fs.mkdirSync(artifacts, { recursive: true });
  const browser = await chromium.launch({ headless: true,
    executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || undefined,
    args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'] });
  const errors = [], passed = [];
  try {
    async function fixture(lang = 'en', storage = true) {
      const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, serviceWorkers: 'block' });
      page.on('pageerror', e => errors.push(e.message));
      await page.addInitScript(({ lang, storage }) => {
        localStorage.setItem('ps.lang', lang);
        window.__media = [];
        window.__sampleStarts = 0;
        const sampleStart = AudioBufferSourceNode.prototype.start;
        AudioBufferSourceNode.prototype.start = function (...args) { window.__sampleStarts++; return sampleStart.apply(this, args); };
        const play = HTMLMediaElement.prototype.play;
        HTMLMediaElement.prototype.play = function () {
          if (!window.__media.includes(this)) window.__media.push(this);
          return play.call(this);
        };
        if (!storage) indexedDB.open = () => { throw new Error('blocked'); };
      }, { lang, storage });
      await page.route('**/js/data/sound-pack.js', route => route.fulfill({contentType:'application/javascript', body:'G.SOUND_PACK = {};'}));
      await page.goto(URL);
      await ready(page);
      return page;
    }
    async function ready(page) {
      await page.waitForFunction(() => window.G?.SoundLibraryUI && document.getElementById('boot').classList.contains('hidden'));
      await page.evaluate(async () => {
        await G.SoundLibrary.ready;
        document.getElementById('tap-start').classList.add('hidden');
        G.DB.playAsGuest(); G.DB.save.partner = 25; G.Flow.goMenu();
      });
    }
    async function importFile(page, key, name = 'test-tone.wav', buffer = wav()) {
      await page.locator('#sound-context').selectOption(key);
      await page.locator('.sound-library input').setInputFiles({ name, mimeType: 'audio/wav', buffer });
      await page.waitForFunction(() => !document.querySelector('.sound-library [data-import]').disabled);
    }
    const page = await fixture();
    await page.locator('[data-go=play]').focus();
    await page.keyboard.press('ArrowDown');
    assert.equal(await page.locator(':focus').getAttribute('data-go'), 'dex');
    await page.keyboard.press('Home');
    assert.equal(await page.locator(':focus').getAttribute('data-go'), 'play');
    await page.keyboard.press('End');
    assert.equal(await page.locator(':focus').getAttribute('data-go'), 'settings');
    await page.keyboard.press('Enter');
    await page.keyboard.press('Tab');
    assert.notEqual(await page.locator(':focus').getAttribute('data-go'), 'settings');
    await page.locator('#sound-context').focus();
    await page.keyboard.press('ArrowDown');
    assert.equal(await page.locator('#sound-context').inputValue(), 'forest');
    passed.push('Menu arrows, Enter, Tab and native select keyboard controls');

    await importFile(page, 'village');
    assert.match(await page.locator('.sound-status').innerText(), /Audio saved/);
    await page.waitForFunction(() => G.Audio.track === 'village' && G.Audio.source === 'file');
    await page.waitForTimeout(1100);
    assert.equal(await page.evaluate(() => window.__media.filter(m => !m.paused).length), 1);
    const meter = await page.evaluate(() => G.Audio.debugMeter(300));
    assert(meter.rms > 0, 'Imported music reaches the shared audio output');
    const starts = await page.evaluate(() => window.__media.length);
    await page.evaluate(() => { for (let i = 0; i < 120; i++) G.Audio.music('village'); });
    assert.equal(await page.evaluate(() => window.__media.length), starts);
    passed.push('Imported music plays, loops and is not restarted by repeated context updates');

    await importFile(page, 'forest', 'forest.wav');
    await page.evaluate(() => { G.Audio.music('forest'); G.Audio.music('boss'); G.Audio.music('village'); });
    await page.waitForFunction(() => G.Audio.track === 'village' && G.Audio.source === 'file');
    await page.waitForTimeout(1100);
    assert.equal(await page.evaluate(() => window.__media.filter(m => !m.paused).length), 1);
    await page.evaluate(() => G.Audio.music('boss'));
    assert.equal(await page.evaluate(() => G.Audio.source), 'synth');
    await page.waitForTimeout(1100);
    assert.equal(await page.evaluate(() => window.__media.filter(m => !m.paused).length), 0);
    passed.push('Rapid context changes cancel stale music; missing boss track falls back to synthesis');

    await page.evaluate(() => G.Audio.music('village'));
    await page.waitForFunction(() => G.Audio.source === 'file');
    await page.evaluate(() => G.Audio.toggleMute());
    await page.waitForTimeout(700);
    assert((await page.evaluate(() => G.Audio.debugMeter(250))).rms < 0.0001);
    await page.evaluate(() => { G.Audio.toggleMute(); G.Audio.setVolume('music', 0.23); });
    await page.reload(); await ready(page);
    await page.evaluate(() => G.Audio.unlock());
    await page.waitForFunction(() => G.Audio.source === 'file');
    assert.equal(await page.evaluate(() => G.Audio.settings.music), 0.23);
    assert.equal(await page.evaluate(() => G.SoundLibrary.get('forest').name), 'forest.wav');
    passed.push('Mute, independent volume and files persist across reloads');

    await page.locator('[data-go=settings]').click();
    await importFile(page, 'village', 'invalid.wav', Buffer.from('not audio'));
    assert.match(await page.locator('.sound-status').innerText(), /Could not read/);
    assert.equal(await page.evaluate(() => G.SoundLibrary.get('village').name), 'test-tone.wav');
    await importFile(page, 'click', 'too-long.wav', wav(6));
    assert.match(await page.locator('.sound-status').innerText(), /5 seconds/);
    assert.equal(await page.evaluate(() => !!G.SoundLibrary.get('click')), false);
    await importFile(page, 'click', 'click.wav');
    await page.waitForTimeout(200);
    await page.evaluate(() => G.Audio.music(null));
    await page.waitForTimeout(1100);
    const triggered = await page.evaluate(() => { const before = window.__sampleStarts; for (let i = 0; i < 10; i++) G.Audio.sfx('click'); return window.__sampleStarts - before; });
    assert.equal(triggered, 1, 'A long effect does not stack repeatedly with itself');
    await page.waitForTimeout(300);
    assert((await page.evaluate(() => G.Audio.debugMeter(200))).rms > 0);
    passed.push('Invalid imports preserve existing audio; long effects rejected; imported effect plays');

    await page.locator('#sound-context').selectOption('village');
    await page.locator('[data-reset]').click();
    await page.waitForFunction(() => !G.SoundLibrary.get('village'));
    await page.evaluate(() => G.Audio.music('village'));
    assert.equal(await page.evaluate(() => G.Audio.source), 'synth');
    await page.reload(); await ready(page);
    assert.equal(await page.evaluate(() => !!G.SoundLibrary.get('village')), false);
    passed.push('Restore removes the imported file durably and resumes game music');

    for (const lang of ['en', 'es']) {
      const layout = await fixture(lang);
      for (const [width, height] of [[1280, 800], [844, 390], [667, 375], [390, 844]]) {
        await layout.setViewportSize({ width, height });
        await layout.evaluate(() => {
          G.SettingsUI.close(); G.UI.hideAll(); G.Flow.goMenu();
          document.getElementById('rotate').classList.add('hidden');
        });
        await layout.waitForTimeout(250);
        const overflow = await layout.evaluate(() => document.documentElement.scrollWidth > innerWidth);
        assert.equal(overflow, false, `${lang} ${width} menu overflow`);
        await layout.locator('[data-go=settings]').scrollIntoViewIfNeeded();
        await layout.locator('[data-go=settings]').click();
        await layout.waitForTimeout(300);
        const close = await layout.locator('#set-close').boundingBox();
        assert(close && close.y >= 0 && close.y + close.height <= height, 'Settings close stays on screen');
        const sound = await layout.locator('#sound-context').boundingBox();
        assert(sound && sound.x >= 0 && sound.x + sound.width <= width, 'Audio picker fits');
        await layout.screenshot({ path: `${artifacts}/sound-${lang}-${width}.png` });
        await layout.locator('#set-close').click();
        await layout.screenshot({ path: `${artifacts}/menu-${lang}-${width}.png` });
      }
      await layout.setViewportSize({ width: 1280, height: 800 });
      await layout.evaluate(() => { G.Game.startRun(); G.Game.debugSpeed(0); });
      await layout.waitForTimeout(200);
      await layout.screenshot({ path: `${artifacts}/hud-${lang}.png` });
      await layout.evaluate(() => G.RunUI.showLevelUp(2, G.LevelUp.offer(G.Game.player), () => {}));
      await layout.waitForTimeout(300);
      await layout.screenshot({ path: `${artifacts}/levelup-${lang}.png` });
      await layout.locator('#cards .card').first().click();
      assert(await layout.locator('#scr-levelup').isHidden());
      await layout.close();
    }
    passed.push('ES/EN layouts at 1280, 844, 667 and 390 px; HUD and level-up selection');

    const blocked = await fixture('en', false);
    await blocked.locator('[data-go=settings]').click();
    await importFile(blocked, 'village');
    assert.match(await blocked.locator('.sound-status').innerText(), /Could not save/);
    assert.equal(await blocked.evaluate(() => !!G.SoundLibrary.get('village')), false);
    await blocked.close();
    passed.push('Unavailable browser storage reports failure without claiming a saved import');
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ passed, errors, artifacts }, null, 2));
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
