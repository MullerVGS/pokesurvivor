/* Terrain-only comparison. Headless measurements are not device FPS claims. */
const {chromium}=require('playwright');
const fs=require('node:fs');
const urls=(process.env.BIOMES_PERF_URLS||'http://localhost:3105/dev.html,http://localhost:3106/dev.html').split(',');
const output=process.env.BIOMES_TEST_OUTPUT||'/tmp/pokesurvivor-biomes-validation';
(async()=>{
  const browser=await chromium.launch({executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE,args:['--no-sandbox']});
  try{
    const results=[];
    for(const url of urls){
      const page=await browser.newPage({serviceWorkers:'block'});
      await page.addInitScript(()=>window.requestAnimationFrame=()=>0);
      await page.goto(url);await page.waitForFunction(()=>window.G?.World,null,{polling:50});
      const result=await page.evaluate(()=>{
        G.World.reset(4242);
        const cv=document.createElement('canvas');cv.width=cv.height=512;const ctx=cv.getContext('2d');
        const cam={w:511,h:511,left(){return this.x},top(){return this.y}};
        const stats=values=>{values.sort((a,b)=>a-b);return {samples:values.length,medianMs:values[Math.floor(values.length*.5)],p95Ms:values[Math.floor(values.length*.95)],maxMs:values.at(-1)};};
        const measure=points=>stats(points.map(([x,y])=>{
          cam.x=x;cam.y=y;ctx.setTransform(1,0,0,1,-x,-y);
          const start=performance.now();G.World.drawGround(ctx,cam);ctx.getImageData(0,0,1,1);return performance.now()-start;
        }));
        const points=[];for(let j=-3;j<3;j++)for(let i=-3;i<3;i++)points.push([i*1024,j*1024]);
        const cold=measure(points),cached=measure(points);
        G.World.reset(4242);
        const moving=measure(Array.from({length:900},(_,i)=>[i*4,Math.sin(i/100)*320]));
        return {cold,cached,moving};
      });
      results.push({url,...result});await page.close();
    }
    fs.mkdirSync(output,{recursive:true});fs.writeFileSync(output+'/performance.json',JSON.stringify({seed:4242,viewport:[512,512],environment:'Chromium headless, terrain render and pixel readback only',results},null,2));
    console.log(JSON.stringify(results));
  }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
