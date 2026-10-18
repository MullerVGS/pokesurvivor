/* Official elemental symbols shared by DOM labels, advanced filters and HUD. */
G.TypeIcons = (() => {
  const images = new Map();
  const url = type => 'assets/ui/types/' + type + '.png?v=289e84236464';
  const ready = Promise.all(Object.keys(G.U.TYPE_NAME).map(type => new Promise(resolve => {
    const image = new Image();
    images.set(type, image);
    image.onload = image.onerror = resolve;
    image.src = url(type);
  })));
  function draw(ctx, type, x, y, size) {
    const image = images.get(type);
    if (!image || !image.complete || !image.naturalWidth) return false;
    const smoothing = ctx.imageSmoothingEnabled;
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(image, x, y, size, size);
    ctx.imageSmoothingEnabled = smoothing;
    return true;
  }
  function html(type, size = 20) {
    return `<img class="type-symbol" src="${url(type)}" width="${size}" height="${size}" alt="" aria-hidden="true" draggable="false">`;
  }
  // FRLG-style text labels. Types added after Gen III use the same treatment.
  const badgeColors = { normal: '#909888', fighting: '#c06848', flying: '#8898c8', poison: '#a868b8', ground: '#b89858', rock: '#a89868', bug: '#98a838', ghost: '#806898', steel: '#8898a8', fire: '#e07848', water: '#6898d8', grass: '#68b858', electric: '#c8a838', psychic: '#d87890', ice: '#60b8c8', dragon: '#7870c8', dark: '#786858', fairy: '#c880b0' };
  function badge(type) {
    if (!badgeColors[type]) return '';
    return `<span class="type type-badge" data-type-badge="${type}" style="--type-ink:${badgeColors[type]}" translate="no">${G.T(G.U.TYPE_NAME[type])}</span>`;
  }
  const labels = new Map();
  function drawBadge(ctx, type, x, y) {
    const label = G.T(G.U.TYPE_NAME[type]).toUpperCase(), key = type + ':' + label;
    let canvas = labels.get(key);
    if (!canvas) {
      canvas = document.createElement('canvas');
      const g = canvas.getContext('2d');
      g.font = '400 14px PokemonGen3';
      canvas.width = Math.max(36, Math.ceil(g.measureText(label).width) + 8); canvas.height = 16;
      g.fillStyle = badgeColors[type]; g.fillRect(0, 0, canvas.width, 16);
      g.strokeStyle = '#f8f8e8'; g.strokeRect(1.5, 1.5, canvas.width - 3, 13);
      g.font = '400 14px PokemonGen3'; g.lineWidth = 2; g.strokeStyle = '#506058';
      g.strokeText(label, 4, 12); g.fillStyle = '#fff'; g.fillText(label, 4, 12);
      labels.set(key, canvas);
    }
    ctx.drawImage(canvas, Math.round(x), Math.round(y));
  }
  return { ready, url, draw, html, badge, drawBadge };
})();
