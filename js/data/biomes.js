/* Spatial biomes. Palette indices for the existing arenas stay unchanged.
 * Ecology is curated separately in biome-encounters.js. Music reuses the
 * released playlists; these associations are gameplay choices, not OST canon.
 */
G.Biomes = (() => {
  const rows = [
    // id, ES name, EN name, music, weather group, liquid %, walls threshold, trees, rocks, grass
    ['grassland', 'Praderas y rutas', 'Grasslands and routes', 'forest', 0, .13, .89, .009, .009, .20],
    ['forest', 'Bosque Umbrío', 'Shaded Forest', 'forest', 0, .19, .85, .044, .009, .34],
    ['rainforest', 'Selva tropical', 'Tropical rainforest', 'forest', 0, .30, .86, .054, .008, .40],
    ['freshwater', 'Ríos y lagos', 'Rivers and lakes', 'forest', 0, .55, .92, .014, .012, .23],
    ['wetland', 'Pantano', 'Wetlands', 'forest', 0, .49, .94, .018, .006, .37],
    ['coast', 'Playa y costa', 'Beach and coast', 'forest', 0, .43, .91, .012, .016, .06],
    ['ocean', 'Mar e islas', 'Sea and islands', 'forest', 0, .76, .96, .010, .015, .04],
    ['mountain', 'Montañas', 'Mountains', 'cave', 1, .12, .59, .016, .035, .09],
    ['cave', 'Cueva Cristal', 'Crystal Cave', 'cave', 1, .16, .54, .020, .030, .025],
    ['desert', 'Desierto', 'Desert', 'volcano', 2, .05, .83, .012, .022, .02],
    ['volcanic', 'Volcán Ceniza', 'Ash Volcano', 'volcano', 2, .32, .72, .009, .035, .025],
    ['snow', 'Nieve y hielo', 'Snow and ice', 'cave', 1, .31, .78, .018, .020, .06]
  ];
  // floor, dirt, wall, liquid kind/color, canopy, trunk, rock, grass, prop silhouette
  const colors = [
    ['#91ba66','#c1ac77','#879b70','water','#559dc0','#5a9146','#856344','#8c977e','#649442','tree'],
    ['#639c53','#af9564','#69835c','water','#4c92b6','#3e7c3f','#745237','#7c8876','#41753b','tree'],
    ['#438d65','#9a9260','#568777','water','#389eac','#286d55','#6c5c3d','#6b9183','#32764d','palm'],
    ['#a0bb78','#c9bb89','#91a397','water','#4fa8ce','#5c9b73','#846b4a','#8a9b93','#638f58','tree'],
    ['#87966a','#b0a577','#7d8871','swamp','#647f6b','#617b46','#79704b','#89917b','#6e8a48','dead'],
    ['#e0cb91','#c5af76','#aab0a0','water','#59b9cc','#6c9a55','#a28055','#9b9d8c','#9aad65','palm'],
    ['#dac78f','#b7ab78','#8eaba8','water','#3f91bd','#598851','#96764f','#8ba6a5','#7ca36b','palm'],
    ['#aaa286','#8d856d','#87897d','water','#719dab','#76937d','#78634c','#98998c','#818f6b','pine'],
    ['#746f91','#625d78','#7b748e','water','#60a6b4','#87b9cf','#5e6482','#9392aa','#677b83','crystal'],
    ['#ddbc7b','#c4a063','#aa8b66','water','#75acb2','#668353','#92734c','#b69c77','#aa995c','cactus'],
    ['#8b7970','#6c5b53','#5b5860','lava','#df7038','#887e72','#66564d','#827c7b','#7d775d','dead'],
    ['#e0e9e8','#b8d0d6','#96a9b5','ice','#a0d1df','#c6ddd5','#70867c','#aabdc7','#c9dbd0','pine']
  ];
  const all = rows.map((r, index) => {
    const c = colors[index];
    return { id:r[0], index, name:r[1], english:r[2], musicCue:r[3], weatherGroup:r[4],
      water:r[5], wall:r[6], props:{tree:r[7],rock:r[8],grass:r[9]},
      palette:{name:r[1],floor:c[0],dirt:c[1],wall:c[2],liquid:c[3],liq:c[4],
        leaf:c[5],trunk:c[6],rock:c[7],grass:c[8],prop:c[9],
        flowers:index<5?['#f6e9a6','#f0c1b5','#e5eed1']:[c[7],c[1],c[0]],
        groundStyle:['desert','volcanic','cave','mountain','snow','coast','ocean'].includes(r[0])?'mineral':'grass'} };
  });
  for (const b of all) {
    b.musicSource=b.musicCue;
    if (!['forest','cave','volcanic'].includes(b.id)) {
      G.SOUND_CUES[b.id]={kind:'music',label:b.name,fallback:b.musicSource};
      G.SOUND_PACK[b.id]=G.SOUND_PACK[b.musicSource];
      b.musicCue=b.id;
    }
  }
  G.I18n?.add(Object.fromEntries(all.map(b=>[b.name,b.english])));
  return { all, byId:Object.fromEntries(all.map(b=>[b.id,b])) };
})();
