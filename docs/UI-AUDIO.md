# Interface e áudio

## Direção aprovada — 18/10/2026

Arthur aprovou o piloto com “Gostei, pode continuar”. A direção é **FireRed/LeafGreen como identidade visual estável, fonte da geração III e fluxos oficiais adaptados às mecânicas atuais do survivor**. A versão de trabalho agora usa esse perfil por padrão, sem seletor de comparação ou rotação visual.

Implementação aprovada em `feat/frlg-ui-prototype`, preservada na porta 3095. A candidata à release está em `release/frlg-ui`, worktree `pessoal/.worktrees/pokesurvivor-frlg-release`, sobre `origin/main` `b9ca467`. Integra as fontes de UI/áudio com Better Auth, ativação, correção da tela rosa e bosses errantes já publicados. A main e as worktrees anteriores foram preservadas.

## Prévia local

- Desenvolvimento da release: <http://localhost:3105/dev.html>.
- Coleção completa para testes: <http://localhost:3105/dev.html?preview=collection>.
- Build gerado: <http://localhost:3105/> e <http://localhost:3105/en/>.
- Instalar dependências: `npm ci --prefix server`. Iniciar: `PORT=3105 DATA_DIR=/tmp/pokesurvivor-frlg-release-data AUTH_EMAIL_MODE=outbox bash tools/preview-ui.sh`. Usa o servidor desta worktree; não depende da versão antiga no checkout principal. O banco é isolado e os e-mails de teste ficam no diretório privado de outbox.
- A sessão local aberta exibe Google com credenciais fictícias para conferir o layout; o callback real é validado pelo teste de ativação com provedor simulado. Não autentica contas Google reais. Produção permanece independente.
- Os parâmetros antigos `variant=frlg` e `variant=original` não alternam mais o visual. O protótipo aprovado foi arquivado no tracker em `research/ui-rework-2026-10-18/frlg-prototype/accepted-source.tar.gz`.

Build regenerado e verificado nas entradas ES/EN e na imagem Docker. O fechamento e a publicação são acompanhados no tracker pessoal (`release-frlg-2026-10-18.md`); o atlas de pesquisa é independente do deploy do jogo.

## Login e ativação

O login atual mantém Google, e-mail, recuperação, importação e modo offline com a moldura FRLG, fonte Gen III, campos claros, seleção vermelha e ações secundárias legíveis. Em telas baixas a janela mantém um único scroll. A página isolada `ativar/` usa a mesma direção, preservando a confirmação explícita da conta, cookies e fluxo existentes. A disponibilidade de cadastro, recuperação e Google continua seguindo as capacidades do servidor.

Na integração, a barra de HP do boss continua oculta enquanto ele vaga sem combate; as setas de direção e a regra de 100 metros de `origin/main` foram preservadas. `test-roaming-bosses.cjs`, `test-events.cjs` e `test-rift.cjs` verificam os comportamentos publicados junto da nova HUD.

## Apresentação e fonte

`dev.html` define `data-ui="frlg"`; `css/style.css` contém a apresentação aprovada. `G.Presentation` em `js/core/presentation.js` fornece paleta e tipografia para canvas. O boot aguarda o carregamento da fonte local. A rotação de músicas pertence a `G.SoundLibrary.enter` e usa a preferência `ps.sound-era`, migrando a posição anterior de `ps.presentation`.

A fonte LG/FR/E vem de ArcaneNibble/pokefont, release `0f5c9f`. `assets/fonts/gen3/PokemonGen3-mono.woff2` tem 26.528 bytes; a derivação remove somente COLR/CPAL, preservando contornos e métricas. Isso permite usar as cores dos painéis sem alterar os glifos. Proveniência e escopo da licença estão em `assets/fonts/gen3/SOURCE.txt`; reprodução em `tools/make_gen3_font.py`. Acentos ES/PT, números e sinais foram conferidos; glifos ausentes usam fallback.

As posições e os controles conhecidos foram preservados. Reroll, voltar e escolher parceiro ficam fora das áreas roláveis. A comparação de itens permanece compacta acima do personagem. HP, EXP, golpes, prévias reais e informações do combate usam os dados existentes. Golpes usam uma ficha compacta após 1 segundo de hover; os demais assuntos continuam por consulta explícita.

## HUD de batalha — HP e ataques escritos

`js/ui/battle-panels.js` desenha as molduras de HP do jogador e de até três aliados com os mesmos dados da partida. Fichas ampliadas visualmente em 15%, incluindo texto e barra. Nome, nível, HP verde/amarelo/vermelho; a EXP fica dentro da ficha do jogador. Aliados preservam apelido/cor, estado caído e progresso de reanimação. Sexo e PP não são acrescentados ao modelo.

As quatro posições de ataque formam um bloco centralizado na base, com altura de 142 px no desktop: etiqueta FRLG de tipo no canto superior esquerdo, ícone, nome, nível, recarga em segundos e contorno do ativo. Abaixo de 760 px de largura ou 480 px de altura, os ataques passam para uma fileira de ícones com alvos de 52 px (ajustados ao espaço disponível), atalho, nível e recarga. Vínculos mostram os ícones e recargas individuais, com consulta completa via hover/T; slots vazios permanecem identificáveis. Item equipado e vínculos disponíveis ficam junto ao bloco. Fundos das habilidades e moldura externa com 80% de opacidade; habilidade ativa e fundo do item com 85%. Textos, ícones e recargas ficam opacos. Os fundos não se sobrepõem sob os cartões, para manter a transparência efetiva.

`dockLayout` é compartilhado com o minimapa e o editor de controles, que usa o desenho real no canvas. A posição padrão centraliza a grade dos ataques e se desloca quando necessário para liberar o joystick fixo. Centros customizados do toque continuam salvos no formato existente; limites respeitam viewport e safe areas. O resumo A reúne tempo real, bioma traduzido, derrotados e moedas, com fundo a 85% de opacidade; em telas estreitas fica na lateral livre do HP. `topLayout` reserva espaço para clima, chefe e pausa (inclusive posição salva). O minimapa evita esses painéis, o bloco e as fichas, reduzindo de tamanho se necessário; a comparação de item no desktop sobe acima dos ataques. O editor mantém Salvar/Cancelar acessíveis. Avisos de conquista e mensagens breves seguem o painel de ataques por cima, inclusive ao reposicioná-lo, e não capturam o ponteiro durante a partida. Contadores grandes usam notação compacta quando não cabem. Nenhuma regra ou autoridade de host/guest muda.

Validação: `tools/test-battle-hud.cjs` (ES/EN, quatro ataques, três aliados por fixture, caído/desconectado, vínculo, clique/números/roda/Cinta Elección, hover/T, toque e arrastar/salvar controles; 1280/844/667/390). `test-inspection-ui.cjs` usa a geometria atual dos ataques. Desempenho é registrado em `validation.json` como custo isolado dos novos painéis, sem atribuí-lo ao frame completo do jogo.

## Pokédex, pausa e resultado

`js/ui/pokemon-summary.js` renderiza identidade, características e movimentos disponíveis. A lista mostra nomes e tipos, identifica o golpe inicial e abre diretamente a consulta interativa de T ao selecionar por mouse, teclado ou toque. A Pokédex permanece visível ao fundo; não insere detalhes na ficha nem abre outra página. Fechar, Escape ou T retorna o foco ao golpe, preservando filtros, Pokémon e posição de rolagem. A prévia é liberada ao fechar. Não acrescenta PP, atributos dos jogos principais ou novos estados ao save.

`js/ui/menu.js` mantém a grade e os filtros. Setas/Home/End navegam; selecionar uma ficha não muda o parceiro. A escolha do parceiro e de sua aparência shiny exige o botão explícito. Filtros, seleção e scroll da lista são preservados; o foco é restaurado após atualizar os controles. Entradas não obtidas continuam sem nome, tipo, atributos ou golpes, com `???` e silhueta.

A pausa identifica o parceiro atual, nível, tipos e vida. O resultado usa linhas e tipografia consistentes, com retorno visível fora do scroll. As alterações são locais de apresentação: não mudam as regras ou a autoridade do host no cooperativo.

## Correção de direção: tipos, UI e HUD

Arthur esclareceu que **as sprites anteriores dos Pokémon eram as desejadas**.
Os assets oficiais pedidos são os tipos e elementos de UI/HUD. O caminho de retratos
FRLG/HGSS/BW/HOME foi retirado; `G.UI.sprite` voltou a animar SpriteCollab em todos os menus.

**Filtros avançados** abre os 18 símbolos oficiais lado a lado. É possível selecionar
até dois tipos, com interseção: Água + Dragão exige ambos. O máximo deriva dos tipos
presentes no catálogo. A seleção atual continua clicável para remoção; tipos novos,
gerações e filtros de coleção que não tenham resultados ficam desabilitados enquanto
houver tipos selecionados. Limpar tipos reativa as possibilidades. Abrir/fechar,
seleção e foco são preservados ao voltar; navegar não troca o parceiro.

`js/ui/type-icons.js` fornece os mesmos símbolos para DOM, filtros e canvas do HUD.
Os emblemas de golpes mantêm a indicação da família. São 18 arquivos originais de
Scarlet/Violet, 60×60 px, somando 24.304 bytes, com origem/hash em
`assets/ui/types/sources.json`. `tools/fetch_type_icons.py --check` audita o pacote.

Arthur também pediu liberar os Pokémon para testar. A entrada
`http://localhost:3095/dev.html?preview=collection` abre um convidado em memória com
as 966 espécies e as variantes shiny disponíveis nas sprites existentes. O servidor
da prévia não tinha contas/saves cadastrados. `js/ui/collection-preview.js` restringe
essa entrada a `dev.html`; o build normal e os saves de contas não recebem a liberação.
O parâmetro é mantido ao recarregar, mas a seleção de parceiro da sessão não é salva.

Teste principal: `test-pokemon-ui.cjs` cobre interseção, máximo de dois tipos,
disponibilidade, reset, retorno, teclado e toque. `test-collection-preview.cjs`
cobre a coleção completa isolada, sprites animadas, ícones, HUD e tamanhos de tela.

## Menu simples e ficha FRLG por hover — direção atual

Arthur pediu voltar à lista simples da segunda imagem, com o tipo no canto superior esquerdo do ataque, e reservar o formato FRLG da primeira imagem para a ficha após **1 segundo de hover**. Isso substitui a etapa anterior de painel permanente e confirmação extra.

- Nível/vínculo: ícone, nome, descrição, estado da melhoria e etiqueta de tipo no canto superior esquerdo. `js/ui/choice-cards.js` confirma diretamente por clique, toque, Enter/Espaço ou número. Setas/Home/End apenas navegam. Sem Details ou botão Escolher adicional; reroll, duas etapas/Voltar do vínculo e espera cooperativa permanecem.
- A ficha compacta tem identidade, números e efeito à esquerda; nome/tipo e animação real à direita. `G.InfoPanel.peek` é uma única janela sem backdrop, inerte, sem capturar cliques/foco nem pausar. O posicionamento considera o alvo e as regiões do HUD; tamanho limitado ao viewport.
- `G.Tooltip` espera 1.000 ms sobre a mesma skill. Sair fecha; trocar de skill, rolar ou redimensionar reinicia o prazo. Clique, troca de tela e blur cancelam a consulta. Apenas movimentos/cartas de movimento/slots ganham hover; loja, tipos e outros assuntos mantêm T/toque longo.
- T ou toque longo de 500 ms abre a consulta interativa com Voltar/fechar visíveis. Só essa consulta pausa o solo; coop continua. Links navegam na mesma janela, campos nativos conservam T e o clique após toque longo não aplica a recompensa. Pokédex abre diretamente o popup interativo de T por clique/toque, além do hover dos golpes.
- `G.TypeIcons.badge` desenha etiquetas retangulares em HTML/CSS com a fonte Gen III, texto contornado e cores inspiradas em FRLG. Não são arquivos extraídos do jogo; tipos posteriores usam o mesmo tratamento. Os 18 símbolos oficiais dos filtros e os emblemas do HUD permanecem; sprites animadas SpriteCollab não mudam.
- Melhorias permanentes mantêm os bônus reais, preço/saldo, motivos de indisponibilidade e foco. Save, custos, recompensas e autoridade coop preservados.

Passaram `test-progression-ui.cjs`, `test-inspection-ui.cjs`, `test-pokemon-ui.cjs` e `test-ux.cjs`: escolha direta, hover sem escolher, atraso/cancelamento, tipo no canto superior esquerdo, telas 1280/844/667/390, teclado, toque longo sem aplicação e toque direto único, coop por fixture. Evidências em `research/ui-rework-2026-10-18/frlg-hover/`. Referências enviadas pelo usuário são documentação, não assets do jogo.

## Trilha pronta para tocar

Foram obtidos **65 arquivos originais de jogos Pokémon**, abrangendo as nove gerações, na [ENLS’s Pre-Looped Music Library](https://enls.eu/prelooped/). Há temas de Red/Blue/Yellow, Gold/Silver/Crystal, Ruby/Sapphire/Emerald, FireRed/LeafGreen, Diamond/Pearl/Platinum, HeartGold/SoulSilver, Black/White, X/Y, Sun/Moon, Sword/Shield e Scarlet/Violet.

`assets/audio/pokemon/sources.json` registra título, jogo, geração, origem, hash original, hash local e pontos de loop de cada arquivo. As cópias locais usam Vorbis a 32 kHz: **83.990.094 bytes**, frente a 278.679.869 bytes dos arquivos baixados. A introdução e o trecho musical de repetição são preservados; o áudio posterior ao final do loop é descartado. Os originais baixados nesta sessão ficaram em `/tmp/pokesurvivor-ui-audio/originals`.

Os contextos `village`, `forest`, `cave`, `volcano` e `boss` têm 11 opções cada. A fenda também inclui Mewtwo de FRLG; o julgamento usa Arceus de DPPt. Nível, cura e confirmação têm efeitos originais. Os demais efeitos de combate e interface continuam sintetizados.

A seleção avança entre famílias musicais e faixas compatíveis em novas visitas. O catálogo inclui todas as nove gerações; as gerações posteriores ao GBA compartilham o agrupamento de áudio `ds`. Esse agrupamento não muda a interface FRLG. Pedir o mesmo contexto a cada frame não reinicia a música. A prioridade existente do jogo continua sendo julgamento, fenda, chefe e bioma.

Apenas a música atual é buscada e decodificada. O buffer anterior é liberado após o crossfade; a biblioteca inteira não é pré-carregada. `AudioBufferSourceNode` mantém o loop pelos pontos musicais originais. URLs com hash preservam a política de cache do fork. Se uma mídia falhar, o sintetizador mantém a trilha funcionando.

`city`, `gym` e `pokestop` ficam reservados no catálogo para futuros gatilhos de área. Ainda não existem esses locais no mundo; a interface não os apresenta como recursos jogáveis. Quando forem implementados, o sistema de áreas deve resolver sua prioridade antes de chamar `G.Audio.music(cue)`.

## Substituições pessoais

**Ajustes > Sonido > Tu banda sonora** permite substituir a seleção de um lugar/ação por um arquivo pessoal. **Restaurar** volta ao catálogo padrão. Os arquivos importados ficam no IndexedDB `ps.sound-library`, fora do save e do cooperativo; cada navegador guarda sua biblioteca. Importações da prévia local não passam automaticamente para outro domínio.

Música pessoal usa streaming e loop do arquivo inteiro, até 32 MB. Efeitos pessoais: até 2 MB e 5 segundos. A importação valida o áudio antes de gravar; arquivo inválido ou erro de armazenamento preserva a atribuição anterior.

## Verificação e manutenção

Verificações executadas nesta integração:

- `tools/test-pokemon-ui.cjs`: fonte carregada, visual fixo, informações desconhecidas, navegação por teclado, filtro/retorno/foco, escolha explícita de parceiro/shiny, prévia de golpe, rodapé fixo, pausa e resultado; ES/EN em 1280×800, 844×390, 667×375 e 390×844, além de toque emulado.
- `tools/test-ux.cjs`: recargas inativas, roda, itens, prévias reais, evolução desconhecida, consulta com navegação interna, fechar/voltar, descoberta e protocolo de equipamentos host/guest com transporte simulado.
- `tools/test-ui-audio.cjs`: teclado, layouts, importação/persistência, mute/volume, restauração, mídia inválida, armazenamento e fallback.
- `tools/test-sound-pack.cjs`: hashes dos 65 arquivos, nove gerações, três famílias musicais sem trocar o visual, estabilidade em encontros e decodificação/loops/saída real no Chromium.
- `tools/test-updater.cjs`: atualização exclusivamente manual, espera de save e cancelamento ao sair do menu.
- Sintaxe JS/CJS, diff com CRLF, build protegido e entrada `/en/`: fonte e perfil corretos, sem módulo de comparação, sem erros JS ou assets com erro no smoke test.

Build: `node tools/build.js --sin-seo && node tools/export_data.js && python3 tools/make_seo_pages.py`. O gerador SEO preserva `data-ui` ao trocar o idioma e os finais CRLF. A expressão de texto foi corrigida para funcionar também no Python 3.10 disponível neste ambiente.

Os testes Playwright precisam de `playwright` e Chromium disponíveis; aceitam `PLAYWRIGHT_CHROMIUM_EXECUTABLE`. Para cada suíte, consulte as variáveis de URL no cabeçalho do arquivo. O pacote pode ser auditado com `python3 tools/fetch_audio_pack.py --check`; sua recuperação exige ffmpeg.

Capturas iniciais em `pessoal/.scratch/pokesurvivor/research/ui-rework-2026-10-18/frlg-implementation/`; evidências dos tipos/coleção em `frlg-advanced-types/`, e da etapa anterior em `frlg-moves/` e do menu simples/hover atual em `frlg-hover/` no mesmo diretório de pesquisa. Os testes usam fixtures de convidado e toque emulado; não equivalem a aparelho físico ou sessão cooperativa real. O rework completo continua incremental: perfil/social, gacha, lobby e estados auxiliares ainda podem receber revisão dedicada seguindo a direção aprovada.

## Decisão do resumo da partida

Arthur escolheu a opção A: painel superior compacto com tempo em destaque, bioma e contadores reunidos. Integrado ao canvas com dados reais. A versão em ícones nas telas pequenas compartilha geometria com o editor, preserva posições salvas, grupos de até quatro movimentos e hover/T/toque longo. O loader e o módulo descartável A/B/C foram removidos; as capturas do estudo permanecem como histórico em `frlg-hud-top-study/`.
