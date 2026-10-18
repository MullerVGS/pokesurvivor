/* Exercise real audio while simulating time and positions at region boundaries. */
const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const URL=process.env.BIOMES_TEST_URL||'http://localhost:3106/dev.html';
const OUTPUT=process.env.BIOMES_TEST_OUTPUT||'/tmp/pokesurvivor-biomes-v2-validation';
(async()=>{
  const browser=await chromium.launch({executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE,args:['--no-sandbox']});
  const checks=[],errors=[];
  const check=(name,value)=>{assert.ok(value,name);checks.push(name);};
  try{
    const page=await browser.newPage({viewport:{width:1280,height:800},serviceWorkers:'block'});
    page.on('pageerror',e=>errors.push(e.message));
    await page.addInitScript(()=>{
      window.requestAnimationFrame=fn=>{if(fn.name==='loop')window.runFrame=fn;return 0;};
      window.sampleStarts=0;
      const start=AudioBufferSourceNode.prototype.start;
      AudioBufferSourceNode.prototype.start=function(...args){sampleStarts++;return start.apply(this,args);};
    });
    await page.goto(URL);await page.waitForFunction(()=>G.Game&&document.querySelector('#boot.hidden'),null,{polling:50});
    await page.mouse.click(20,20);
    await page.evaluate(()=>{
      document.getElementById('tap-start').classList.add('hidden');G.DB.playAsGuest();G.DB.save.partner=25;G.Game.startRun();G.World.reset(4242);
      window.sites={};
      for(let y=-1200;y<=1200;y+=15)for(let x=-1200;x<=1200;x+=15){
        const id=G.World.regionAt(x*32,y*32).id;if(!sites[id])sites[id]={x:x*32,y:y*32};
      }
      window.enter=(id,dt,instant=false)=>{const p=sites[id];G.World.focus(p.x,p.y,dt,instant);G.Audio.music(G.World.musicCue());};
      G.Audio.unlock();enter('forest',0,true);
    });
    await page.waitForFunction(()=>G.Audio.track==='forest'&&G.Audio.source==='file',null,{polling:50});
    const initial=await page.evaluate(()=>({starts:sampleStarts,title:G.Audio.title}));
    const border=await page.evaluate(()=>{
      for(let i=0;i<20;i++){enter('snow',7);enter('forest',1);}
      return {cue:G.World.musicCue(),starts:sampleStarts,title:G.Audio.title};
    });
    check('Repeated short crossings retain the actual playing track',border.cue==='forest'&&border.starts===initial.starts&&border.title===initial.title);
    const settling=await page.evaluate(()=>{
      enter('snow',7.9);const held=G.World.musicCue()==='forest',label=G.World.biomeName();
      enter('snow',.2);return {held,label,cue:G.World.musicCue()};
    });
    check('HUD follows the region while music waits for a continuous stay',settling.held&&settling.label==='Nieve y hielo');
    check('Music changes after staying in the new region',settling.cue==='snow');
    await page.waitForFunction(()=>G.Audio.track==='snow'&&G.Audio.source==='file',null,{polling:50});
    const cooldown=await page.evaluate(()=>{enter('desert',44);const held=G.World.musicCue()==='snow';enter('desert',1.1);return {held,cue:G.World.musicCue()};});
    check('A second region cannot change the music before 45 seconds',cooldown.held);
    check('The pending region changes music when the minimum stay ends',cooldown.cue==='desert');
    await page.waitForFunction(()=>G.Audio.track==='desert'&&G.Audio.source==='file',null,{polling:50});
    const same=await page.evaluate(()=>{const before=sampleStarts;for(let i=0;i<120;i++)enter('desert',1);return sampleStarts===before;});
    check('Remaining in one region does not restart the song',same);
    const instant=await page.evaluate(()=>{
      enter('snow',0,true);const visit=G.World.musicCue()==='snow';
      G.World.reset(4242);return {visit,reset:G.World.musicCue()==='grassland'};
    });
    check('Explicit visits and new worlds reset the music focus immediately',instant.visit&&instant.reset);
    await page.evaluate(()=>{
      G.Game.startRun();G.World.reset(4242);G.Rift.debugArena('psychic');runFrame(performance.now()+17);
    });
    await page.waitForFunction(()=>G.Audio.track==='rift',null,{polling:50});
    check('Rift music bypasses region dwell timers',true);
    check('No JavaScript errors',errors.length===0);
    fs.mkdirSync(OUTPUT,{recursive:true});fs.writeFileSync(OUTPUT+'/music.json',JSON.stringify({checks,errors},null,2));
    console.log(JSON.stringify({passed:checks.length}));
  }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
