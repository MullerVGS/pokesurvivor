/* Node checks at the public geography boundary: order, seed, bounds and routes. */
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const context={};context.window=context;vm.createContext(context);
for(const file of ['js/core/util.js','js/data/sound-cues.js','js/data/sound-pack.js','js/data/biomes.js','js/world/regions.js'])vm.runInContext(fs.readFileSync(path.join(root,file),'utf8'),context);
const {Regions,Biomes}=context.G;
const plain=value=>JSON.parse(JSON.stringify(value));

test('same seed returns the same world after reverse visits and cache eviction',()=>{
  const a=Regions.create(42),b=Regions.create(42),points=[];
  for(let y=-117;y<=117;y+=13)for(let x=-131;x<=131;x+=17)points.push([x,y]);
  const expected=points.map(([x,y])=>plain(a.sample(x,y)));
  for(const [x,y] of points.toReversed())b.sample(x,y);
  for(let i=0;i<27000;i++)b.sample(i,2000);
  assert.deepEqual(points.map(([x,y])=>plain(b.sample(x,y))),expected);
  const other=Regions.create(43);
  assert.ok(points.some(([x,y],i)=>JSON.stringify(other.sample(x,y))!==JSON.stringify(expected[i])));
});
test('every biome occurs across three independent worlds, including negative coordinates',()=>{
  for(const seed of [1,42,4242]){
    const world=Regions.create(seed),seen=new Set();
    for(let y=-1800;y<=1800;y+=36)for(let x=-1800;x<=1800;x+=36){const s=world.sample(x,y);seen.add(Biomes.all[s.biome].id);assert.ok([0,1,2].includes(s.terrain));}
    assert.equal(seen.size,12,`seed ${seed}`);
  }
});
test('opening is safe and dry paths reach all four edges of a local map',()=>{
  for(const seed of [1,42,4242]){
    const world=Regions.create(seed),R=85,W=R*2+1,open=new Uint8Array(W*W),seen=new Uint8Array(W*W);
    for(let y=-R;y<=R;y++)for(let x=-R;x<=R;x++){
      const s=world.sample(x,y);open[(y+R)*W+x+R]=s.terrain===0;
      if(Math.hypot(x,y)<9)assert.equal(s.terrain,0);
      if(s.road)assert.equal(s.terrain,0);
    }
    const queue=[R*W+R];seen[queue[0]]=1;const edges=new Set();
    for(let at=0;at<queue.length;at++){
      const i=queue[at],x=i%W,y=Math.floor(i/W);
      if(!x)edges.add('west');if(x===W-1)edges.add('east');if(!y)edges.add('north');if(y===W-1)edges.add('south');
      for(const [dx,dy] of [[1,0],[-1,0],[0,1],[0,-1]]){
        const nx=x+dx,ny=y+dy,j=ny*W+nx;
        if(nx>=0&&nx<W&&ny>=0&&ny<W&&open[j]&&!seen[j]){seen[j]=1;queue.push(j);}
      }
    }
    assert.equal(edges.size,4,`seed ${seed}`);
  }
});

test('long exploration routes have broad regions instead of many small strips',()=>{
  let crossings=0,shortRuns=0;
  for(const seed of [1,42,4242]){
    const world=Regions.create(seed);
    for(const offset of [-1200,-600,0,600,1200])for(const vertical of [false,true]){
      let last=-1,length=0;
      for(let distance=-1800;distance<=1800;distance+=2){
        const biome=world.sample(vertical?offset:distance,vertical?distance:offset).biome;
        if(last!==-1&&last!==biome){crossings++;if(length<10)shortRuns++;length=0;}
        last=biome;length+=2;
      }
    }
  }
  // The first preview had 2,566 crossings and 479 sub-ten-tile runs on these routes.
  assert.ok(crossings<1200,`${crossings} crossings`);
  assert.ok(shortRuns<100,`${shortRuns} short runs`);
});
