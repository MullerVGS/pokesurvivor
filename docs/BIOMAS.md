# Biomas procedurais — gerador v2

Implementação local de 18/10/2026, sobre a release `2e2813b7` (UI FRLG e trilhas). A geografia passa a depender da seed e da posição; o tempo da partida continua determinando dificuldade, eventos e clima. Não há migração de saves: o mundo é criado a cada partida.

## Experimentar

Inicie o servidor de desenvolvimento com uma base local isolada, conforme `tools/preview-ui.sh`. Abra `/dev.html?preview=biomes`, toque para começar e use o seletor. Ele cria um convidado com Pikachu, permite informar a seed e inicia uma nova partida em uma área livre do bioma escolhido. O combate segue as regras normais. Recolha o painel para jogar. O parâmetro só funciona em `dev.html`; as páginas compiladas não ativam essa ferramenta.

Na entrega local: `http://localhost:3106/dev.html?preview=biomes`. A referência de pesquisa permanece em `http://localhost:3096`.

## Geografia e apresentação

`js/world/regions.js` fornece `Regions.create(seed).sample(tx,ty)` para coordenadas de tile, incluindo negativas. O resultado contém bioma, terreno, caminho e faixa livre de props. Ruído de elevação, umidade, temperatura e bolsões distribui as regiões. A escala linear regional foi triplicada após o teste da primeira prévia; piscinas locais, rochas e largura dos caminhos conservam sua escala. Um campo contínuo adicional forma rios; piscinas locais distribuem água, gelo ou lava. O cache limitado a 24.576 amostras não participa da geração.

Os doze ambientes são praderas/campos, bosque/floresta, selva tropical, rios/lagos, pântano, costa, mar/ilhas, montanhas, caverna, deserto, vulcão e neve/gelo. Cavernas são áreas abertas de rocha e cristal. Água mantém travessia com lentidão e imunidades; esta versão não introduz barcos ou mapas subterrâneos.

O raio inicial de 9 tiles é chão livre e a região inicial é campo até 72 tiles. Caminhos curvos conectados, espaçados a cada 80 tiles, atravessam líquidos e rochas, com margem sem vegetação sólida. Cores se misturam em uma faixa estreita nas bordas, sem recolorir chunks já visitados. Pinheiros, palmeiras e cactos complementam os props existentes. As sprites animadas dos Pokémon são preservadas.

`World.biomeAt/regionAt/liquidKind/liquidEffect` recebem posição em pixels. `World.focus` atualiza o nome do HUD após 1,2 s na mesma região candidata. A música tem foco independente: exige 8 s contínuos no novo bioma e pelo menos 45 s desde a última troca regional. Uma passagem curta ou retorno à região musical atual cancela a troca pendente. Nova partida, visita explícita da prévia e retorno de arena ajustam o foco imediatamente; chefes/Rift/Judgment conservam prioridade. Os timers contam tempo de gameplay, sem avançar durante pausa. Assim o HUD informa o lugar mesmo enquanto a faixa anterior continua; terreno, colisão, efeitos e minimapa usam coordenadas. `World.revision` invalida o minimapa ao reiniciar ou abrir/fechar arenas; cruzar uma borda não descarta o mapa.

As 22 paletas anteriores mantêm seus índices (0–2 base, 3–21 arenas). As doze regionais são anexadas. Rift/Judgment substituem somente a área da arena; o retorno de Rift remove o override e restaura a geografia original. O fundo dos menus conserva o gerador e o ciclo visual anteriores.

## Música

Os 65 arquivos publicados permanecem idênticos. A associação abaixo é uma escolha inicial de implementação: os novos ambientes compartilham playlists existentes, sem alegar músicas exclusivas ou associações oficiais de Pokémon.

| Playlist publicada | Ambientes |
| --- | --- |
| `forest` | campos, floresta, selva, rios/lagos, pântano, costa, mar/ilhas |
| `cave` | montanhas, caverna, neve/gelo |
| `volcano` | deserto, vulcão |

Cada novo ambiente tem contexto próprio em Ajustes > Som, permitindo importar sua música. Os contextos antigos `forest`, `cave` e `volcano` conservam seus arquivos pessoais; imports continuam locais ao contexto escolhido. Mixer, loops, rotação e crossfade existentes são reaproveitados. Prioridade: Judgment → Rift → chefe/desafio → região do jogador local.

## Fauna e lacunas da pesquisa

`js/data/biome-ecology.js` deriva do recorte fixado de PokéAPI e pret FRLG/Emerald. `docs/biome-ecology-sources.json` registra revisões e hashes. Reconstrução:

```sh
python3 tools/build-biome-ecology.py --research /caminho/biomas-2026-10-18
```

Entram encontros recorrentes, com espécie/forma presente no jogo e contexto não ambíguo. Métodos aquáticos ficam separados; encontros em árvores e no ar entram na preferência terrestre, sujeitos às regras físicas. Habitat é somente uma indicação ampla. A pesquisa não cobre sete espécies por todas as combinações bioma/faixa, especialmente espécies fortes e recentes.

O spawn consulta a região do ponto em que nascerá. Dentro da faixa de BST atual, prefere evidência de encontro, depois habitat, afinidade de tipo e, se necessário, candidatos gerais. Mantém raridade elegível, sprites disponíveis, apoios, ataques anunciados, corredor, pesos e escalas anteriores. Água exige espécie aquática ou flutuante; lava exige fogo ou flutuação. A ecologia é preferência, não filtro canônico rígido. O host decide e transmite os inimigos.

Hordas conservam seu tipo. Se o elenco original não ocupa o meio do spawn, o evento mantém um elenco alternativo compatível por meio. Primeiro busca a mesma faixa de BST; se vazia, usa espécies elegíveis do tipo com BST mais próximo, mantendo os stats de combate da faixa atual. Isso evita uma horda sem inimigos no mar e não libera lendários/míticos. Os baús são sorteados antes das densidades regionais de árvores/rochas para preservar sua ocorrência.

## Cooperativo e versão

`Regions.VERSION = 2` acompanha os dados dos membros e a mensagem de início. A sala bloqueia início se algum cliente não declara a mesma versão, e o cliente recusa início de host incompatível. A orientação usa o atualizador manual do menu; não força reload. Mesma seed/versão produz mesma geografia em qualquer ordem de visita. Isso não promete reproduzir integralmente uma partida: sorteios de combate continuam aleatórios.

Ao alterar regras determinísticas de terreno, caminhos, props ou classificação, incremente a versão para impedir partidas com geometrias divergentes.

## Verificação e limites

- `tools/test-regions.cjs`: seed, coordenadas negativas, ordem de consulta, expulsão de cache, presença dos doze biomas, início e conectividade dos caminhos.
- `tools/test-biomes.cjs`: consultas físicas por posição, arenas, fronteiras, elenco de todos os biomas/faixas, spawns reais, baús em regiões rochosas, hordas em água/lava e renderização móvel.
- `tools/test-biome-coop.cjs`: dois navegadores, protocolo real com transporte em memória, compatibilidade, terreno idêntico, foco local independente e inimigos transmitidos pelo host.
- `tools/test-biome-music.cjs`: reprodução real, oscilação na fronteira, espera mínima, intervalo entre mudanças, reset e prioridade de Rift.
- `tools/test-biome-preview.cjs`: visita dos doze ambientes pela UI e painel recolhível.
- `tools/measure-biomes.cjs`: custo do terreno frio, em cache e durante movimento, com seed e parâmetros fixos. Os resultados de Chromium headless não representam FPS de celular.
- Suítes anteriores de autenticação, ativação, UI, áudio, eventos, chefes, Rift e atualização manual, além dos testes do servidor, foram executadas. Build ES/EN protegido deve ser gerado e conferido antes de publicar.

Os valores de tamanho, densidade e afinidade são a configuração inicial a ajustar jogando. Não houve teste em aparelho físico nem sessão de coop pela internet. O clima continua global. As adjacências do atlas são sugestões; o classificador contínuo não impõe seu grafo como restrição rígida. Usina, torre e ruínas permanecem referências futuras, sem novos eventos nesta entrega. A implementação usa arte procedural nativa; o atlas gerado é referência conceitual, não uma captura do jogo.
