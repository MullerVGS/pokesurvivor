/* Ecological preference within the existing difficulty tiers. Fallbacks are
 * deliberate: the reference sample cannot cover seven species in every tier.
 * The host chooses spawns; clients receive the existing enemy definitions.
 */
G.BiomeEncounters = (() => {
  const habitats={grassland:['grassland'],forest:['forest'],rainforest:['forest'],
    freshwater:['waters-edge'],wetland:['waters-edge'],coast:['sea','waters-edge'],ocean:['sea'],
    mountain:['mountain','rough-terrain'],cave:['cave'],desert:['rough-terrain'],volcanic:['rough-terrain'],snow:[]};
  const affinity={grassland:['normal','grass','flying','bug'],forest:['grass','bug','fairy'],
    rainforest:['grass','bug','poison','dragon'],freshwater:['water','grass'],wetland:['water','poison','bug'],
    coast:['water','flying'],ocean:['water','flying'],mountain:['rock','fighting','flying','steel'],
    cave:['rock','ground','poison','ghost'],desert:['ground','rock','fire'],volcanic:['fire','rock','steel'],snow:['ice','steel']};
  const evidence=Object.fromEntries(Object.entries(G.BIOME_ECOLOGY.evidence).map(([id,v])=>[id,{land:new Set(v.land),water:new Set(v.water)}]));
  function compatible(mon,medium) {
    if(!mon)return false;
    if(medium==='land'||G.Sprites.hovers(mon.dex))return true;
    if(medium==='water'||medium==='swamp')return mon.types.includes('water');
    if(medium==='lava')return mon.types.includes('fire');
    if(medium==='ice')return true;
    if(medium==='poison')return mon.types.some(t=>['poison','steel'].includes(t));
    if(medium==='spark')return mon.types.some(t=>['electric','ground'].includes(t));
    return false;
  }
  function score(mon,biome,medium) {
    const source=evidence[biome], aquatic=['water','swamp'].includes(medium);
    if(source?.[aquatic?'water':'land'].has(mon.dex))return 3;
    if(habitats[biome]?.includes(G.BIOME_ECOLOGY.habitats[mon.dex]))return 2;
    if(affinity[biome]?.some(t=>mon.types.includes(t)))return 1;
    return 0;
  }
  function pool(all,biome,medium,count,behavior,advanced) {
    const possible=all.filter(p=>compatible(p,medium) && (advanced || ['chase','charger','ranged','tank','healer','shielder','summoner'].includes(behavior(p))));
    if(!biome)return possible;
    const tiers=[[],[],[],[]];
    for(const p of possible)tiers[score(p,biome,medium)].push(p);
    const result=[];
    for(let rank=3;rank>=0 && result.length<count;rank--)result.push(...tiers[rank]);
    // Keep the support/telegraph contract when the medium has a candidate.
    const support=p=>['healer','shielder','summoner'].includes(behavior(p));
    const special=p=>!['chase','charger','ranged','tank','healer','shielder','summoner'].includes(behavior(p));
    for(const needed of advanced?[support,special]:[support]) {
      if(result.some(needed))continue;
      for(let rank=3;rank>=0;rank--) {
        const choices=tiers[rank].filter(needed);
        if(choices.length){result.push(...choices);break;}
      }
    }
    return result;
  }
  return {compatible,pool,score};
})();
