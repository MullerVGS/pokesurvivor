# PokéSurvivor · Mundo Misterioso

Bullet-heaven con Pokémon al estilo de Survivor.io y Megabonk, con sprites de
*Pokémon Mundo Misterioso*, capa roguelike, **966 Pokémon de las 9 generaciones**,
shinies y gacha por región. Trilhas de Pokémon das nove gerações, efeitos e interface estável inspirada em FireRed/LeafGreen. Este fork é de uso pessoal; detalhes em `docs/UI-AUDIO.md`.

HTML + CSS + JavaScript vanilla sobre Canvas 2D. Sin build, sin dependencias y
**todo local**: no necesita internet para jugar.

> **Aviso sobre criptomonedas / Crypto disclaimer**
>
> PokéSurvivor **no tiene ninguna criptomoneda, token ni NFT oficial**, y yo no
> he creado ninguno. Cualquier token que use el nombre del juego lo han creado
> terceros. **No me hago cargo de ninguna compra, venta o inversión** que hagas
> con ellos y nada de lo que hay aquí es una recomendación de inversión. El
> juego es gratis y lo seguirá siendo.
>
> PokéSurvivor has **no official cryptocurrency, token or NFT**, and I have not
> created any. Any token using the game's name was created by third parties.
> **I take no responsibility for any purchase, sale or investment** you make
> with them, and nothing here is investment advice. The game is free and will
> stay free.

## Jugar

Doble clic en `index.html`. Crea una cuenta o entra como invitado, haz el test
de personalidad y a la mazmorra.

| Tecla | Acción |
|---|---|
| `W` `A` `S` `D` / flechas | Moverse |
| `1` `2` `3` `4` | Elegir el movimiento activo |
| `Q` / `E` | Ciclar movimientos |
| `Esc` / `P` | Pausa |

**En móvil o tablet** (en horizontal): pon el dedo en cualquier sitio y arrastra
para moverte (el joystick aparece donde tocas), toca un ataque de abajo para
cambiarlo y el botón de arriba a la derecha para pausar. Se puede instalar como
app ("Añadir a pantalla de inicio"). En **Ajustes** hay sonido, calidad gráfica
(con modo automático), números de daño, menos sacudidas, FPS y la cuenta.

El Pokémon ataca solo con el movimiento activo (o con todos los de un
**vínculo**: cada legendario vencido deja fusionar movimientos para lanzarlos a
la vez desde un solo hueco, hasta 4). Las rocas, cofres y la hierba
alta se rompen; las paredes y los árboles bloquean los disparos enemigos; el
agua frena y la lava quema (también a los enemigos).

En el mapa hay **altares de poder**, **manantiales** que curan, **cofres con
candado** (quédate a su lado unos segundos) y **trampas** que también dañan a
los enemigos. A veces se abre una **grieta**: entra y lucharás contra un
**legendario** en una arena aparte.

Hay **tabla de tipos** (un Rayo Burbuja le quita más a un Charmander) y,
de vez en cuando, **climas** (sol, lluvia, arena, nieve, niebla) que potencian
unos tipos y debilitan otros.

Cada día hay **misiones** (y semanales) que dan tickets y monedas; los
**logros** dan medallas y títulos, y tu **perfil** enseña tus 3 Pokémon
favoritos, tus marcas y tus medallas. En las runs encuentras **objetos** (Restos,
Cinta Elección...) y tus movimientos **evolucionan** al máximo nivel. Los
enemigos tienen personalidad: curan, ponen escudos, llaman a su manada o atacan
con aviso en el suelo.

Las **mejoras** son de cada Pokémon. El **gacha** va con **tickets** que se
ganan jugando (×1 de algunos Pokémon, ×10 de jefes y legendarios), y se tira
en una tragaperras pixel art.

Cada enemigo tiene 1/4096 de salir **shiny**: brilla, una flecha en el borde de
la pantalla te dice dónde está, y si lo derrotas te lo quedas. En el gacha sale
shiny 1 de cada 100 tiradas. En la colección eliges tu compañero en versión
normal o shiny.

La música suena tras el primer clic (los navegadores no dejan reproducir sonido
antes). Volumen y silencio: botón del altavoz arriba a la derecha, o en la pausa.

El guardado vive en el `localStorage` del navegador: si borras los datos del
sitio, se pierde.

En `videos/` hay grabaciones del juego (con su música): un combate contra un
jefe, la captura de un shiny salvaje y un shiny en el gacha.

## Guardado en la nube y publicación

- **Base de datos (Firebase):** cuentas con nombre + contraseña o Google, y la
  partida se sigue en cualquier ordenador. Pasos en [docs/FIREBASE.md](docs/FIREBASE.md).
  Sin configurar, el juego guarda sólo en el navegador, como antes.
- **Jugar con amigos (hasta 4) y ranking:** con cuenta en la nube, menú
  **Amigos** (añadir por apodo, invitar a tu sala) y **Ranking** (tiempo
  aguantado: solo o grupo, de hoy a histórico, amigos, por Pokémon).
- **Publicar gratis en GitHub Pages:** [docs/PUBLICAR.md](docs/PUBLICAR.md).
- Si se juega en dos ordenadores a la vez o sin conexión, las partidas se
  **fusionan**: las colecciones se unen (nunca se pierde un Pokémon ni un
  shiny), mejoras y estadísticas se quedan con el máximo, y monedas y
  compañero con la versión más reciente. Los cambios de otro ordenador llegan
  en directo.

## Licencia

Código bajo [PolyForm Noncommercial 1.0.0](LICENSE-NONCOMMERCIAL.md) desde el
14-10-2026: se puede usar, estudiar y modificar, pero **no con fines
comerciales** (ni vender el juego ni cobrar nada dentro de él). Las versiones
hasta el commit `b297089` se publicaron bajo MIT. Los sprites (CC BY-NC 4.0),
la fuente (OFL) y las marcas de Pokémon tienen sus propias condiciones: ver
[LICENSE](LICENSE) y [CREDITS.md](CREDITS.md). Proyecto de fan sin ánimo de
lucro.

**La única web oficial es [pokesurvivor.com](https://pokesurvivor.com).** El
juego es y será gratis: si alguien te pide pagar, no somos nosotros.

## Estructura

```
index.html              pantallas + orden de carga
css/style.css           interfaz estilo Mundo Misterioso
assets/pokemon/{dex}/   hojas de sprites PMD (Idle, Walk, Attack, Shoot, Charge, Hurt, Faint)
assets/pokemon/{dex}/s/ las mismas en versión shiny
assets/fonts/           Fuente Gen III, procedencia y fuentes heredadas (tools/make_gen3_font.py)
js/
  net/      social (apodo, amigos, salas), net (WebRTC + relé),
            coop (partida en grupo), ranking
  core/     util, db (guardado), audio (sintetizador + efectos), input,
            sprites (animador PMD), camera
  data/     pokedex*, sprites-meta*, moves, starters (+ test), enemies,
            upgrades, music (partituras)
  world/    tiles (pixel art en código), world (terreno, objetos, colisiones)
  entities/ player, enemy, projectile, pickup, fx
  systems/  combat, spawner, levelup, gacha
  ui/       icons (pixel art), ui, hud, login, test, menu, gacha-ui, run-ui,
            social-ui, ranking-ui
  game.js   flujo y bucle principal
tools/      scripts que regeneran los ficheros marcados con *
```

`*` = generado. Para rehacerlos (necesita Python 3 + Pillow e internet, sólo esa vez):

```
python tools/fetch_sprites.py    # sprites normal y shiny + js/data/sprites-meta.js
                                 # (~20 min; se puede cortar y relanzar: usa tools/cache/)
python tools/fetch_pokedex.py    # js/data/pokedex.js
python tools/fetch_credits.py    # CREDITS.md
```

## Notas de implementación

- **Sprites PMD.** Columnas = fotogramas, filas = 8 direcciones (Down, DownRight,
  Right, UpRight, Up, UpLeft, Left, DownLeft — verificado con los `-Offsets.png`).
  Cada animación tiene su propio tamaño de fotograma, así que se alinean por el
  **ancla al suelo** sacada del `-Shadow.png`; sin eso el sprite saltaría al atacar.
- **Coordenadas.** `(x, y)` de una entidad son sus **pies**. Las colisiones
  ocurren en el plano del suelo; los proyectiles vuelan en ese plano y se dibujan
  elevados con su sombra debajo.
- **Mundo.** Chunks de 16×16 tiles: los *datos* (terreno, objetos) son baratos y
  se generan siempre; la *imagen* se hornea a resolución de arte escribiendo en un
  `ImageData` (~4 ms por chunk en Chrome) y sólo para los visibles.
- **Rendimiento.** Rejilla espacial de enemigos reconstruida cada frame. Con 420
  enemigos, simulación + render completo ≈ 3 ms por frame en Chrome.
- **Metadatos en `.js`, no `.json`**, porque `fetch()` está bloqueado en `file://`.
- **Shiny.** Los shiny de SpriteCollab son el mismo dibujo con otra paleta; están
  en `s/` y sólo 30 tienen geometría distinta (campo `sa` en los metadatos).
  Las hojas se guardan como PNG con paleta exacta: misma imagen, la mitad de peso.
- **Audio.** Sintetizador Web Audio con planificador anticipado (programa las
  notas 150 ms por delante) y reverb por convolución con un impulso generado.
  Las partituras están en `js/data/music.js` en un formato de texto propio.
  Los efectos tienen separación mínima entre repeticiones y un tope de voces,
  para que 400 enemigos golpeados a la vez no saturen.
- **Iconos.** Mapas de caracteres convertidos a canvas y data URLs; siempre a
  múltiplos enteros de su tamaño para que el píxel quede limpio.

## HUD de batalla

Vida con marcos clásicos de Pokémon un 15 % mayores para ti y tus compañeros, con EXP en tu ficha.
Tiempo, bioma, derrotados y monedas se reúnen en un panel compacto arriba.
Los ataques están centrados abajo: nombre, icono, tipo, nivel y recarga real,
o una fila de iconos en pantallas pequeñas, con un contorno para el activo. Los vínculos y controles existentes se conservan.
El editor táctil usa el mismo dibujo y medidas del HUD; el minimapa deja espacio al resumen, clima, jefe y pausa.
Pruebas y medición: `tools/test-battle-hud.cjs`.

## Tipos y filtros avanzados

La Pokédex abre una fila de 18 iconos con **Filtros avanzados**. Permite seleccionar
hasta dos tipos: Agua + Dragón muestra Pokémon que tienen ambos. Las opciones sin
coincidencias con la generación y el filtro de colección se desactivan. Seleccionar
de nuevo un tipo lo retira; **Limpiar tipos** reinicia la combinación.

Al seleccionar un movimiento se abre directamente la consulta interactiva de **T**,
con la Pokédex visible detrás. Cerrar, Escape o T devuelve el foco al movimiento,
conservando los filtros, la selección y la posición de la lista.

Se conservan los sprites animados de Pokémon. Los símbolos oficiales de tipo se
comparten entre filtros, etiquetas y emblemas del HUD mediante `js/ui/type-icons.js`.
`python3 tools/fetch_type_icons.py --check` verifica las 18 imágenes locales (24.304 bytes).

Para probar con los 966 Pokémon desbloqueados, abrir
<http://localhost:3095/dev.html?preview=collection>. Es una colección de invitado en
memoria, con las variantes shiny disponibles; no modifica una cuenta ni se guarda.
El parámetro sólo funciona en `dev.html`, no en el build publicado.

Pruebas: `tools/test-pokemon-ui.cjs`, `tools/test-collection-preview.cjs` y `tools/test-ux.cjs`.

## Mejoras y cartas de nivel

Las mejoras permanentes muestran el bonus actual, el siguiente nivel, el precio y
cuántas Pokémonedas faltan. Mantienen las mejoras por Pokémon y el foco al comprar.
Nivel y vínculo vuelven a una lista sencilla con elección directa, descripción y
etiqueta de tipo en la esquina superior izquierda. Sin Detalles ni confirmación adicional.
Tras **1 segundo de hover sobre un movimiento**, aparece una ficha compacta FRLG:
datos/efecto a la izquierda y golpe/animación a la derecha. Se cierra al salir;
no pausa ni bloquea clics. T o mantener pulsado permite explorar sin elegir.
Las etiquetas rectangulares de tipo se inspiran en FRLG; los símbolos de los
filtros avanzados y las sprites animadas se conservan.
Pruebas: `tools/test-progression-ui.cjs` (precios, límites, consultas, elección,
cooperativo y vínculo), `tools/test-inspection-ui.cjs` (consulta explícita y
controles visibles), además de UI Pokémon y UX.

## Créditos y licencia

Sprites de [SpriteCollab](https://github.com/PMDCollab/SpriteCollab) bajo
**CC BY-NC 4.0** — uso **no comercial** y con atribución; la lista de artistas
está en [`CREDITS.md`](CREDITS.md). Pokémon es propiedad de Nintendo, Creatures
Inc. y GAME FREAK. Proyecto de fan sin ánimo de lucro.

## Interfaz FireRed/LeafGreen

Fuente de generación III en menús y combate, ventanas estables y ficha Pokémon
con datos, características y movimientos seleccionables. Los controles y reglas
del survivor se mantienen. Iniciar la vista local: `bash tools/preview-ui.sh`;
abrir `http://localhost:3095/dev.html`. El build está en `/` y `/en/`.
Detalles y validación en [docs/UI-AUDIO.md](docs/UI-AUDIO.md).
