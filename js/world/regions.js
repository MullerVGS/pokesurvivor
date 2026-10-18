/* Versioned geography, independent of runtime/camera/cache visit order.
 * Inputs are tile coordinates; physics and drawing share the same sample.
 */
G.Regions = (() => {
  const VERSION = 2, SCALE = 3, ROAD = 80;
  const H = (x,y,s) => G.U.hash(x,y,s);
  function noise(x,y,s) {
    const ix=Math.floor(x), iy=Math.floor(y), fx=x-ix, fy=y-iy;
    const u=fx*fx*(3-2*fx), v=fy*fy*(3-2*fy);
    const a=H(ix,iy,s), b=H(ix+1,iy,s), c=H(ix,iy+1,s), d=H(ix+1,iy+1,s);
    return (a+(b-a)*u)*(1-v)+(c+(d-c)*u)*v;
  }
  const fbm=(x,y,s)=>noise(x,y,s)*.72+noise(x*2.03+13,y*2.03-7,s+1)*.28;
  const distanceToRoad=v=>Math.abs(v-Math.round(v/ROAD)*ROAD);
  function create(value) {
    const seed=(value|0)||1, cache=new Map();
    const phase=H(7,9,seed)*Math.PI*2;
    // Curving, connected crossings. Their half-width exceeds actor collision radii.
    function roadDistance(tx,ty) {
      const x=tx+5*(Math.sin(ty/24+phase)-Math.sin(phase));
      const y=ty+5*(Math.sin(tx/29+phase)-Math.sin(phase));
      return Math.min(distanceToRoad(x),distanceToRoad(y));
    }
    function sample(tx,ty) {
      tx=Math.floor(tx);ty=Math.floor(ty);
      const key=tx+','+ty;
      const saved=cache.get(key);if(saved)return saved;
      // Larger regions; local pools, rocks and path widths keep their original scale.
      const rx=tx/SCALE, ry=ty/SCALE;
      const x=rx+12*(noise(rx/90,ry/90,seed+20)-.5);
      const y=ry+12*(noise(rx/90,ry/90,seed+21)-.5);
      const elevation=fbm(x/145,y/145,seed+31);
      const moisture=fbm(x/125,y/125,seed+41);
      const heat=fbm(x/190,y/190,seed+51);
      const pocket=fbm(x/48,y/48,seed+61);
      let id='grassland';
      if(elevation<.30)id='ocean';
      else if(elevation<.37)id='coast';
      else if(heat<.30||(elevation>.69&&heat<.49))id='snow';
      else if(elevation>.63&&heat>.57)id='volcanic';
      else if(elevation>.60)id=pocket>.60?'cave':'mountain';
      else if(moisture<.39&&heat>.55)id='desert';
      else if(moisture>.59&&heat>.48)id='rainforest';
      else if(elevation<.46&&moisture>.55)id='wetland';
      else if(moisture>.47)id='forest';
      // Rivers follow continuous, winding valleys; lakes widen their low points.
      const river=Math.abs(noise(x/110,y/110,seed+71)-.5);
      if(elevation>=.37&&elevation<.60&&id!=='desert'&&id!=='snow') {
        if(river<.028||(pocket<.24&&moisture>.48))id='freshwater';
      }
      // The opening meadow blends into nearby vegetation and always has exits.
      if(Math.hypot(rx,ry)<24)id='grassland';
      const biome=G.Biomes.byId[id], road=roadDistance(tx,ty);
      const pools=fbm(tx/9,ty/9,seed+101), rocks=fbm(tx/7,ty/7,seed+202);
      let terrain=pools<biome.water?2:rocks>biome.wall?1:0;
      if(id==='freshwater'&&river<.016)terrain=2;
      if(road<2.3||Math.hypot(tx,ty)<9)terrain=0;
      const result=Object.freeze({biome:biome.index,terrain,road:road<2.3,clear:road<3.5});
      if(cache.size>=24576)cache.delete(cache.keys().next().value);
      cache.set(key,result);
      return result;
    }
    return {seed,sample,roadDistance};
  }
  return {VERSION,SCALE,create};
})();
