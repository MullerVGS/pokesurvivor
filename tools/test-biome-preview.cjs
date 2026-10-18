const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const URL=process.env.BIOMES_TEST_URL||'http://localhost:3106/dev.html';
const OUTPUT=process.env.BIOMES_TEST_OUTPUT||'/tmp/pokesurvivor-biomes-validation';
(async()=>{
  const browser=await chromium.launch({executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE,args:['--no-sandbox']});
  try{
    const page=await browser.newPage({viewport:{width:1280,height:800},serviceWorkers:'block'}),errors=[],results=[];
    page.on('pageerror',e=>errors.push(e.message));
    await page.goto(URL+'?preview=biomes');
    await page.waitForFunction(()=>document.querySelector('#biome-preview')||!document.querySelector('#tap-start').classList.contains('hidden'));
    if(!await page.locator('#biome-preview').count())await page.locator('#tap-start').click();
    await page.locator('#biome-preview output').filter({hasText:'4242'}).waitFor();
    for(const id of await page.locator('#biome-preview select option').evaluateAll(es=>es.map(e=>e.value))){
      await page.locator('#biome-preview select').selectOption(id);await page.locator('#biome-preview button').click();
      await page.waitForFunction(()=>!document.querySelector('#biome-preview button').disabled);
      const result=await page.evaluate(id=>({id,region:G.World.regionAt(G.Game.player.x,G.Game.player.y)?.id,seed:G.World.seed}),id);
      assert.equal(result.id,result.region);assert.equal(result.seed,4242);results.push(result);
    }
    fs.mkdirSync(OUTPUT,{recursive:true});
    await page.screenshot({path:OUTPUT+'/preview-desktop.png'});
    await page.setViewportSize({width:844,height:390});await page.screenshot({path:OUTPUT+'/preview-mobile.png'});
    await page.locator('#biome-preview summary').click();assert.equal(await page.locator('#biome-preview form').isVisible(),false);
    assert.deepEqual(errors,[]);fs.writeFileSync(OUTPUT+'/preview.json',JSON.stringify({results,errors},null,2));
    console.log(JSON.stringify({passed:results.length,errors}));
  }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
