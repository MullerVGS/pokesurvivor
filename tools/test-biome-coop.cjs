/* Two clients running the actual co-op protocol with an in-memory transport. */
const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const URL=process.env.BIOMES_TEST_URL||'http://localhost:3106/dev.html';
const OUTPUT=process.env.BIOMES_TEST_OUTPUT||'/tmp/pokesurvivor-biomes-validation';
(async()=>{
  const browser=await chromium.launch({executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE,args:['--no-sandbox']});
  const errors=[],checks=[];
  const check=(name,value)=>{assert.ok(value,name);checks.push(name);};
  async function client(uid){
    const page=await browser.newPage({viewport:{width:1280,height:800},serviceWorkers:'block'});
    page.on('pageerror',e=>errors.push(e.message));
    await page.addInitScript(()=>{window.requestAnimationFrame=fn=>{if(fn.name==='loop')window.runFrame=fn;return 0;};});
    await page.route('**/js/net/net.js',route=>route.fulfill({contentType:'application/javascript',body:`
      window.packets=[];G.Net={uid:${JSON.stringify(uid)},on(fn){window.receivePacket=fn},onPeer(){},slow(){return false},
        send(to,msg){packets.push({from:this.uid,to,msg})},toHost(msg){this.send('host',msg)},
        broadcast(msg){this.send(this.uid==='host'?'guest':'host',msg)},
        close(){},peers(){return []},mode(){return 'direct'}};`}));
    await page.goto(URL);await page.waitForFunction(()=>G.Game&&document.querySelector('#boot.hidden'),null,{polling:50});
    await page.evaluate(uid=>{
      document.getElementById('tap-start').classList.add('hidden');G.DB.playAsGuest();G.DB.save.partner=25;
      const members=['host','guest'].map(uid=>({uid,name:uid,dex:25,generatorVersion:G.Regions.VERSION}));
      window.cfg={seed:4242,host:'host',members,generatorVersion:G.Regions.VERSION};
      Object.defineProperty(G.Social,'room',{value:{id:'fixture',host:'host',isHost:uid==='host',members},configurable:true});
      Object.defineProperty(G.Social,'uid',{value:uid,configurable:true});
      G.Social.setPlaying=G.Social.setOpen=()=>{};
      let now=performance.now();window.step=(n=1)=>{for(let i=0;i<n;i++)runFrame(now+=1000/60);};
    },uid);
    return page;
  }
  try{
    const host=await client('host'),guest=await client('guest'),pages={host,guest};
    const gate=await host.evaluate(()=>{
      G.Game.toUI();G.Flow.startCoop({...cfg,generatorVersion:undefined});const blocked=G.Game.state==='ui';
      G.Social.room.members[1].generatorVersion=G.Regions.VERSION-1;G.LobbyUI.render();const disabled=document.getElementById('lobby-start').disabled;
      G.Social.room.members[1].generatorVersion=G.Regions.VERSION;G.LobbyUI.render();const enabled=!document.getElementById('lobby-start').disabled;
      G.Flow.startCoop(cfg);return {blocked,disabled,enabled,playing:G.Game.state==='playing'};
    });
    for(const [k,v]of Object.entries(gate))check('Version gate: '+k,v);
    await guest.evaluate(()=>{G.Game.toUI();G.Flow.startCoop(cfg);});
    async function exchange(){
      for(let turn=0;turn<3;turn++)for(const p of Object.values(pages)){
        const packets=await p.evaluate(()=>{G.Coop.tick(.1);return window.packets.splice(0);});
        for(const packet of packets)await pages[packet.to].evaluate(o=>receivePacket(o.from,o.msg),packet);
      }
    }
    const points=[];for(let y=-750;y<=750;y+=75)for(let x=-750;x<=750;x+=75)points.push([x*32+16,y*32+16]);
    const sample=(p,points)=>p.evaluate(points=>points.map(([x,y])=>[x,y,G.World.kindAt(x,y),G.World.biomeAt(x,y),G.World.walkable(Math.floor(x/32),Math.floor(y/32))]),points);
    const expected=await sample(host,points);await sample(guest,points.toReversed());
    check('Same seed geometry on clients with different visit orders',JSON.stringify(expected)===JSON.stringify(await sample(guest,points)));
    const forest=expected.find(p=>p[2]==='floor'&&p[3]===23),snow=expected.find(p=>p[2]==='floor'&&p[3]===33);
    assert.ok(forest&&snow,'both regions in sample');
    for(const [p,site]of [[host,forest],[guest,snow]])await p.evaluate(([x,y])=>{
      G.Game.player.x=x;G.Game.player.y=y;G.Camera.x=x;G.Camera.y=y;G.World.focus(x,y,0,true);step(2);
    },site);
    await exchange();
    check('Local soundtrack follows each player independently',(await host.evaluate(()=>G.World.musicCue()))==='forest'&&(await guest.evaluate(()=>G.World.musicCue()))==='snow');
    check('Distant players retain identical geography',JSON.stringify(await sample(host,points))===JSON.stringify(await sample(guest,points)));
    await host.evaluate(()=>G.Spawner.update(12,G.Game.player,100));await exchange();
    const enemies=await host.evaluate(()=>G.EnemyMgr.all().filter(e=>!e.dead).map(e=>[e.id,e.dex]));
    const remote=await guest.evaluate(()=>G.EnemyMgr.all().filter(e=>!e.dead).map(e=>[e.id,e.dex]));
    check('Host spawns propagate species and IDs to the guest',enemies.length>5&&enemies.every(e=>remote.some(r=>r[0]===e[0]&&r[1]===e[1])));
    check('No JavaScript errors',errors.length===0);
    fs.mkdirSync(OUTPUT,{recursive:true});fs.writeFileSync(OUTPUT+'/coop.json',JSON.stringify({checks,errors,hostEnemies:enemies.length,guestEnemies:remote.length},null,2));
    console.log(JSON.stringify({passed:checks.length,enemies:enemies.length}));
  }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
