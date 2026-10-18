/* Browser integration for spatial regions. Uses public game interfaces.
 * BIOMES_TEST_URL=http://localhost:3106/dev.html node tools/test-biomes.cjs
 */
const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const URL=process.env.BIOMES_TEST_URL||'http://localhost:3106/dev.html';
const OUTPUT=process.env.BIOMES_TEST_OUTPUT||'/tmp/pokesurvivor-biomes-validation';
fs.mkdirSync(OUTPUT,{recursive:true});

(async()=>{
  const browser=await chromium.launch({executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE||undefined,args:['--no-sandbox']});
  const page=await browser.newPage({viewport:{width:1280,height:800},serviceWorkers:'block'}),errors=[],checks=[];
  page.on('pageerror',e=>errors.push(e.message));
  page.on('console',m=>{if(m.type()==='error'&&m.text().includes('[Game]'))errors.push(m.text());});
  page.on('response',r=>{if(r.status()>=400&&new global.URL(r.url()).pathname.startsWith('/js/'))errors.push(`${r.status()} ${r.url()}`);});
  await page.addInitScript(()=>{window.requestAnimationFrame=fn=>{if(fn.name==='loop')window.runFrame=fn;return 0;};});
  const check=(name,value)=>{assert.ok(value,name);checks.push(name);};
  try{
    await page.goto(URL);await page.waitForFunction(()=>window.G?.Game&&document.querySelector('#boot.hidden'));
    await page.evaluate(()=>{
      document.getElementById('tap-start').classList.add('hidden');G.DB.playAsGuest();G.DB.save.partner=25;G.Game.startRun();
      let now=performance.now();window.step=(n=1)=>{for(let i=0;i<n;i++)runFrame(now+=1000/60);};
      window.fresh=()=>{G.Tooltip.hide();G.Game.startRun();G.World.reset(4242);G.World.focus(0,0,0,true);G.Game.player.hp=G.Game.player.maxHp=1e6;step();};
      fresh();
    });
    const geometry=await page.evaluate(()=>{
      const TS=G.World.TS,sampler=G.Regions.create(4242),sites={},liquids={};
      for(let y=-1200;y<=1200;y+=15)for(let x=-1200;x<=1200;x+=15){
        const sample=sampler.sample(x,y),b=G.Biomes.all[sample.biome],d=Math.hypot(x,y);
        if(sample.terrain===0&&(!sites[b.id]||d<sites[b.id].d)&&G.World.isFree(x*TS+TS/2,y*TS+TS/2,14))sites[b.id]={x:x*TS+TS/2,y:y*TS+TS/2,d};
        if(sample.terrain===2&&!liquids[b.palette.liquid])liquids[b.palette.liquid]={x:x*TS+TS/2,y:y*TS+TS/2};
      }
      window.sites=sites;window.liquids=liquids;
      const positions=Object.values(sites).map(p=>[p.x,p.y]);
      const snapshot=points=>points.map(([x,y])=>({x,y,kind:G.World.kindAt(x,y),biome:G.World.biomeName(x,y),liquid:G.World.liquidKind(x,y)}));
      const before=snapshot(positions);G.World.reset(4242);snapshot(positions.toReversed());const after=snapshot(positions);
      return {sites,liquids,deterministic:JSON.stringify(before)===JSON.stringify(after),arenas:G.Tiles.ARENA_TYPES.map(t=>G.Tiles.arenaBiome(t))};
    });
    check('Twelve accessible regions in the same world',Object.keys(geometry.sites).length===12);
    check('World queries are independent of visit order',geometry.deterministic);
    check('Existing arena protocol indices preserved',geometry.arenas.join(',')===Array.from({length:19},(_,i)=>i+3).join(','));
    const physical=await page.evaluate(()=>{
      const saved=Object.entries(sites).map(([id,p])=>[id,G.World.biomeAt(p.x,p.y)]);
      G.World.setBiome(G.Tiles.arenaBiome('fire'),true);
      const stable=saved.every(([id,b])=>G.World.biomeAt(sites[id].x,sites[id].y)===b);
      const lava=liquids.lava,water=liquids.water,ice=liquids.ice;
      G.World.focus(water.x,water.y,0,true);
      const independent=G.World.liquidEffect(['normal'],lava.x,lava.y).dmg>0&&G.World.liquidEffect(['normal'],water.x,water.y).slow===.6&&G.World.liquidEffect(['normal'],ice.x,ice.y).slide===true;
      const immune=!G.World.liquidEffect(['fire'],lava.x,lava.y).dmg&&!G.World.liquidEffect(['water'],water.x,water.y).slow;
      const point=sites.forest,tx=Math.floor(point.x/32),ty=Math.floor(point.y/32);
      const before=[];for(let y=-15;y<=15;y++)for(let x=-15;x<=15;x++)before.push([G.World.kindAt((tx+x)*32,(ty+y)*32),G.World.biomeAt((tx+x)*32,(ty+y)*32)]);
      G.World.setArena({tx,ty,r:12,type:'fire'});
      const localArena=G.World.biomeAt(point.x,point.y)===G.Tiles.arenaBiome('fire')&&G.World.biomeAt(sites.snow.x,sites.snow.y)===saved.find(v=>v[0]==='snow')[1];
      G.World.setArena(null);const after=[];for(let y=-15;y<=15;y++)for(let x=-15;x<=15;x++)after.push([G.World.kindAt((tx+x)*32,(ty+y)*32),G.World.biomeAt((tx+x)*32,(ty+y)*32)]);
      return {stable,independent,immune,localArena,restored:JSON.stringify(before)===JSON.stringify(after)};
    });
    for(const [name,value] of Object.entries(physical))check(`Position/arena: ${name}`,value);
    const chests=await page.evaluate(()=>{
      const found=new Set();
      for(let y=-650;y<=650&&found.size<3;y++)for(let x=-650;x<=650;x++){
        const h=G.U.hash(x,y,4242+404);if(h<=.985||h>.992||G.U.hash(x,y,4242+606)>=.07)continue;
        const px=x*32+16,py=y*32+31,b=G.World.regionAt(px,py);
        if(b?.props.rock>=.015&&G.World.propsInCircle(px,py,2).some(p=>p.tx===x&&p.ty===y&&p.type==='chest'))found.add(b.id);
      }
      return [...found];
    });
    check('Ordinary chests remain available in rocky biomes',chests.length>=3);
    const presentation=await page.evaluate(()=>{
      const a=sites.forest,b=sites.snow;G.World.focus(a.x,a.y,0,true);const cue=G.World.musicCue();
      G.World.focus(b.x,b.y,.4);G.World.focus(a.x,a.y,.1);G.World.focus(b.x,b.y,.4);
      const stable=G.World.musicCue()===cue;
      G.World.focus(b.x,b.y,1);const hudFirst=G.World.musicCue()===cue&&G.World.biomeName()==='Nieve y hielo';
      G.World.focus(b.x,b.y,44);const changed=G.World.musicCue()==='snow';
      fresh();step(90);const initial=G.World.biomeName();
      G.Game.player.x=sites.desert.x;G.Game.player.y=sites.desert.y;G.Camera.x=sites.desert.x;G.Camera.y=sites.desert.y;step(90);
      return {stable,hudFirst,changed,follows:G.World.biomeName()==='Desierto',initial};
    });
    check('Boundary oscillation does not restart the presentation',presentation.stable);
    check('HUD updates before the music changes',presentation.hudFirst);
    check('Stable crossing eventually changes the music',presentation.changed);
    check('Game loop follows player region',presentation.follows);
    const ecology=await page.evaluate(()=>{
      const stats=[],violations=[];G.Enemies.rollRun();
      for(const biome of G.Biomes.all)for(const t of [0,70,160,260,380,500])for(const medium of ['land',biome.palette.liquid]){
        const bag=G.Enemies.bagAt(t,biome.id,medium),ids=new Set(bag.map(d=>d.dex));
        stats.push({biome:biome.id,t,medium,species:ids.size});
        for(const def of bag){const mon=G.DEX_BY[def.dex];if(!mon||mon.rarity>=5||!G.SPRITE_META[def.dex]||!G.BiomeEncounters.compatible(mon,medium))violations.push([biome.id,t,medium,def.dex]);}
      }
      let spawned=0;fresh();
      for(const [id,p] of Object.entries(sites)){
        G.EnemyMgr.clear();G.Game.player.x=p.x;G.Game.player.y=p.y;G.Camera.x=p.x;G.Camera.y=p.y;
        G.Spawner.update(15,G.Game.player,100);
        for(const e of G.EnemyMgr.all()){
          if(e.boss)continue;spawned++;
          const r=G.World.regionAt(e.x,e.y)?.id,medium=G.World.isLiquid(e.x,e.y)?G.World.liquidKind(e.x,e.y):'land';
          if(!G.Enemies.bagAt(100,r,medium).some(d=>d.dex===e.dex))violations.push(['spawn-region',id,e.dex]);
          if(!e.flying&&!G.World.isFree(e.x,e.y,14,medium!=='land'))violations.push(['spawn-space',id,e.dex]);
        }
      }
      return {stats,violations,spawned};
    });
    check('Regional bags retain eligible species and physical compatibility',ecology.violations.length===0);
    check('Every biome/tier/medium has a nonempty roster',ecology.stats.every(s=>s.species>0));
    check('Actual spawns use their point region and free space',ecology.spawned>25);
    fs.writeFileSync(path.join(OUTPUT,'rosters.json'),JSON.stringify(ecology,null,2));
    const hordes=await page.evaluate(()=>{
      const violations=[];
      for(const t of [0,260,600])for(const type of G.Enemies.hordeTypes(t))for(const medium of ['water','lava']){
        const defs=G.Enemies.hordeDefs(type,t,medium);
        if(!defs.length||defs.some(d=>!G.DEX_BY[d.dex].types.includes(type)||!G.BiomeEncounters.compatible(G.DEX_BY[d.dex],medium)))violations.push([t,type,medium]);
      }
      fresh();
      let openSea=null;
      const reach=G.View.reach(G.Game.player);
      for(let y=-1200;y<=1200&&!openSea;y+=15)for(let x=-1200;x<=1200&&!openSea;x+=15){
        const px=x*32,py=y*32;
        if(G.World.regionAt(px,py)?.id!=='ocean'||!G.World.isLiquid(px,py))continue;
        if([10,40,70].every(extra=>Array.from({length:32},(_,i)=>i*Math.PI/16).every(a=>G.World.isLiquid(px+Math.cos(a)*(reach+extra),py+Math.sin(a)*(reach+extra)*.9))))openSea={x:px,y:py};
      }
      if(!openSea)throw Error('No open ocean fixture');
      G.Game.player.x=openSea.x;G.Game.player.y=openSea.y;G.Camera.x=openSea.x;G.Camera.y=openSea.y;
      // Force the event type, while retaining its real selection, medium adaptation and spawner.
      const types=G.Enemies.hordeTypes;G.Enemies.hordeTypes=()=>['grass'];
      G.Events.debugStart('horde');G.Enemies.hordeTypes=types;
      G.Spawner.burst(20);
      const enemies=G.EnemyMgr.all().filter(e=>!e.boss);
      return {violations,spawned:enemies.length,typed:enemies.every(e=>G.DEX_BY[e.dex].types.includes('grass')),compatible:enemies.every(e=>G.BiomeEncounters.compatible(G.DEX_BY[e.dex],G.World.isLiquid(e.x,e.y)?G.World.liquidKind(e.x,e.y):'land'))};
    });
    check('Every horde type has a viable roster on water and lava',hordes.violations.length===0);
    check('Typed hordes continue spawning in open ocean',hordes.spawned>5&&hordes.typed&&hordes.compatible);

    await page.evaluate(()=>fresh());
    for(const id of Object.keys(geometry.sites)){
      await page.evaluate(id=>{const p=sites[id];G.EnemyMgr.clear();G.Game.player.x=p.x;G.Game.player.y=p.y;G.Camera.x=p.x;G.Camera.y=p.y;G.World.focus(p.x,p.y,0,true);step(3);},id);
      await page.screenshot({path:path.join(OUTPUT,`${id}.png`)});
    }
    await page.setViewportSize({width:844,height:390});await page.evaluate(()=>step(3));
    await page.screenshot({path:path.join(OUTPUT,'mobile.png')});
    check('Mobile landscape renders without page overflow',await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    check('No game JavaScript errors',errors.length===0);
    fs.writeFileSync(path.join(OUTPUT,'run.json'),JSON.stringify({status:'passed',checks,errors,geometry,rosters:ecology.stats,date:new Date().toISOString()},null,2));
    console.log(JSON.stringify({status:'passed',checks:checks.length,spawns:ecology.spawned,output:OUTPUT}));
  }catch(e){await page.screenshot({path:path.join(OUTPUT,'failure.png')});fs.writeFileSync(path.join(OUTPUT,'run.json'),JSON.stringify({status:'failed',checks,errors,failure:String(e)},null,2));throw e;}
  finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
