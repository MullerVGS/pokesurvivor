/* Original audio pack: integrity, real browser decoding, loops and era rotation. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { chromium } = require('playwright');
const root = path.join(__dirname, '..');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'assets/audio/pokemon/sources.json')));
for (const track of manifest.tracks) {
  const data = fs.readFileSync(path.join(root, track.src));
  assert.equal(data.subarray(0, 4).toString(), 'OggS');
  assert.equal(crypto.createHash('sha256').update(data).digest('hex'), track.localSha256);
}
assert.deepEqual([...new Set(manifest.tracks.map(t => t.generation))].sort(), [1,2,3,4,5,6,7,8,9]);

(async () => {
  const browser = await chromium.launch({ headless: true,
    executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || undefined,
    args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'] });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, serviceWorkers: 'block' });
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.addInitScript(() => {
      localStorage.setItem('ps.lang', 'en');
      const start = AudioBufferSourceNode.prototype.start;
      AudioBufferSourceNode.prototype.start = function (...args) {
        if (this.loop) window.__lastLoop = this;
        return start.apply(this, args);
      };
    });
    await page.goto(process.env.UI_AUDIO_TEST_URL || 'http://127.0.0.1:3092/dev.html');
    await page.waitForFunction(() => window.G?.Presentation && document.getElementById('boot').classList.contains('hidden'));
    await page.evaluate(async () => {
      await G.SoundLibrary.ready;
      document.getElementById('tap-start').classList.add('hidden');
      G.DB.playAsGuest(); G.DB.save.partner = 25; G.Flow.goMenu();
      window.__originalPack = G.SOUND_PACK;
    });
    const selection = await page.evaluate(() => {
      const generations = new Set(), eras = new Set();
      for (let i = 0; i < 60; i++) {
        G.SoundLibrary.enter(i % 2 ? 'forest' : 'cave');
        eras.add(G.SoundLibrary.era);
        generations.add(G.SoundLibrary.pick('forest').generation);
      }
      const era = G.SoundLibrary.era;
      G.SoundLibrary.enter('boss'); G.SoundLibrary.enter('rift'); G.SoundLibrary.enter('judgment');
      return { generations: [...generations].sort(), eras: [...eras].sort(), stable: era === G.SoundLibrary.era };
    });
    assert.deepEqual(selection.generations, [1,2,3,4,5,6,7,8,9]);
    assert.deepEqual(selection.eras, ['ds','gb','gba']);
    assert(selection.stable);

    assert.equal(await page.evaluate(() => document.documentElement.dataset.ui), 'frlg');
    const tracks = manifest.tracks.filter(t => t.cue === 'village')
      .filter((t, i, all) => all.findIndex(other => other.generation === t.generation) === i);
    tracks.push(manifest.tracks.find(t => t.id === 'swsh-boss')); // longest/heaviest source
    const decoded = [];
    for (const track of tracks) {
      await page.evaluate(track => {
        G.SOUND_PACK = { village: [{ ...track, name: track.title }] };
        G.Audio.music(null); G.Audio.music('village'); G.Audio.unlock();
      }, track);
      await page.waitForFunction(title => G.Audio.source === 'file' && G.Audio.title === title, track.title);
      await page.waitForTimeout(1000);
      const result = await page.evaluate(() => ({
        start: window.__lastLoop.loopStart, end: window.__lastLoop.loopEnd,
        duration: window.__lastLoop.buffer.duration, title: G.Audio.title
      }));
      assert(Math.abs(result.start - (track.loopStart || 0)) < .001);
      assert(result.end <= result.duration);
      assert(result.end > result.start);
      assert((await page.evaluate(() => G.Audio.debugMeter(150))).rms > 0);
      decoded.push({ game: track.game, seconds: +result.duration.toFixed(2) });
    }

    await page.evaluate(() => { G.Audio.music(null); G.SOUND_PACK = window.__originalPack; });
    for (let i = 0; i < 3; i++) {
      const era = await page.evaluate(i => {
        G.SoundLibrary.enter(i % 2 ? 'forest' : 'cave'); return G.SoundLibrary.era;
      }, i);
      assert.equal(await page.evaluate(() => document.documentElement.dataset.ui), 'frlg');
    }

    await page.evaluate(() => {
      G.SOUND_PACK = { village: [{ name: 'missing', src: 'assets/audio/pokemon/missing.ogg' }] };
      G.Audio.music('village');
    });
    await page.waitForFunction(() => G.Audio.source === 'synth');
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ files: manifest.tracks.length, bytes: manifest.tracks.reduce((n,t) => n+t.localBytes,0), selection, decoded, errors }, null, 2));
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
