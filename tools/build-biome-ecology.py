#!/usr/bin/env python3
"""Import the pinned biome research. Usage: --research /path/to/biomas-2026-10-18."""
import argparse
import csv
import hashlib
import json
from pathlib import Path

parser=argparse.ArgumentParser()
parser.add_argument('--research',required=True,type=Path)
args=parser.parse_args()
root=Path(__file__).resolve().parents[1]
data=args.research/'data'
catalog=json.loads((data/'biomes.proposed.json').read_text())
pools={b['id']:{'land':set(),'water':set()} for b in catalog['biomes']}
def rows(file):
    with (data/file).open() as handle:return list(csv.DictReader(handle))
for r in rows('reference-encounters.csv'):
    if any(r[k]!='True' for k in ['in_game','matches_game_form','recurring_wild_method']):continue
    if r['ambiguous_area']=='True' or r['biome_proposal'] not in pools:continue
    medium='water' if r['medium']=='water' else 'land'
    pools[r['biome_proposal']][medium].add(int(r['species_id']))
for r in rows('pret-map-encounters.csv'):
    if r['in_game']!='True' or r['biome_context'] not in pools:continue
    medium='water' if r['method'] in ['water_mons','fishing_mons'] else 'land'
    pools[r['biome_context']][medium].add(int(r['dex']))
habitats={r['dex']:r['habitat'] for r in rows('pokemon.csv') if r['habitat'] and r['habitat']!='rare'}
payload={'evidence':{b:{m:sorted(ids) for m,ids in media.items()} for b,media in pools.items()},'habitats':habitats}
banner='''/* Curated encounter evidence: PokéAPI 6fd69dfe + pret FRLG 037335f4 / Emerald 731ad5bf.
 * Research snapshot 2026-10-18. Habitat is a broad hint; affinity fallback is
 * an explicit gameplay choice, not a claim of a canonical encounter.
 * Rebuild: tools/build-biome-ecology.py --research /path/to/pinned/research */
'''
target=root/'js/data/biome-ecology.js'
target.write_text(banner+'G.BIOME_ECOLOGY = '+json.dumps(payload,ensure_ascii=False,separators=(',',':'))+';\n')
manifest={'snapshot':'2026-10-18','source_repositories':json.loads((args.research/'sources.lock.json').read_text())['repositories'],
          'inputs':{file:hashlib.sha256((data/file).read_bytes()).hexdigest() for file in ['biomes.proposed.json','reference-encounters.csv','pret-map-encounters.csv','pokemon.csv']},
          'output':{'path':str(target.relative_to(root)),'sha256':hashlib.sha256(target.read_bytes()).hexdigest()},
          'notes':['Map contexts are curated; aquatic methods stay separate from land.','Habitat and type affinity are fallback hints, not encounter evidence.']}
(root/'docs/biome-ecology-sources.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n')
print(json.dumps({b:{m:len(ids) for m,ids in v.items()} for b,v in payload['evidence'].items()}))
