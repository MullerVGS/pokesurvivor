/* Expresión de Ditto sobre las hojas originales; se calcula una vez por hoja. */
G.DittoFace = (() => {
  const cache = new WeakMap();
  // Posición del rostro respecto a la silueta (orejas, plantas y colas no son la cara).
  const faces = { 1: 0.73, 2: 0.70, 3: 0.70, 4: 0.44, 5: 0.45, 6: 0.38, 7: 0.44,
    8: 0.44, 9: 0.42, 25: 0.55, 26: 0.55, 133: 0.61, 143: 0.38, 658: 0.43, 813: 0.55 };
  function sheet(img, m, dex) {
    if (dex === 132) return img;
    if (cache.has(img)) return cache.get(img);
    const canvas = document.createElement('canvas'); canvas.width = img.width; canvas.height = img.height;
    const ctx = canvas.getContext('2d', { willReadFrequently: true }); ctx.drawImage(img, 0, 0);
    const data = ctx.getImageData(0, 0, canvas.width, canvas.height), px = data.data, stride = canvas.width;
    const at = (x, y) => (y * stride + x) * 4;
    for (let row = 0; row < m.r; row++) {
      if (row >= 3 && row <= 5) continue; // No poner una cara en la nuca.
      for (let frame = 0; frame < m.n; frame++) {
        const ox = frame * m.w, oy = row * m.h;
        let left = m.w, top = m.h, right = 0, bottom = 0;
        for (let y = 0; y < m.h; y++) for (let x = 0; x < m.w; x++) if (px[at(ox + x, oy + y) + 3] > 128) {
          left = Math.min(left, x); right = Math.max(right, x); top = Math.min(top, y); bottom = Math.max(bottom, y);
        }
        if (right - left < 7 || bottom - top < 8) continue;
        const side = row === 2 || row === 6, dir = row === 1 || row === 2 ? 1 : row === 6 || row === 7 ? -1 : 0;
        const cx = Math.round((left + right) / 2 + dir * (right - left) * (side ? 0.22 : 0.12));
        const cy = Math.round(top + (bottom - top) * (faces[dex] || 0.5));
        const rw = side ? 3 : 5, rh = 3, colors = new Map();
        for (let y = cy - rh; y <= cy + rh; y++) for (let x = cx - rw; x <= cx + rw; x++) {
          if (x <= left || x >= right || y <= top || y >= bottom) continue;
          const i = at(ox + x, oy + y);
          if (px[i + 3] < 128 || Math.max(px[i], px[i + 1], px[i + 2]) < 95) continue;
          const key = [px[i], px[i + 1], px[i + 2]].join(','); colors.set(key, (colors.get(key) || 0) + 1);
        }
        const weight = ([rgb, count]) => count * (rgb.split(',').reduce((sum, v) => sum + Number(v), 0) ** 2);
        const best = [...colors].sort((a, b) => weight(b) - weight(a))[0];
        if (!best) continue;
        const skin = best[0].split(',').map(Number);
        const paint = (x, y, rgb) => {
          if (x <= left || x >= right || y <= top || y >= bottom) return;
          const i = at(ox + x, oy + y);
          if (px[i + 3] < 128) return;
          // Conservar el contorno de la especie.
          if ([[-1, 0], [1, 0], [0, -1], [0, 1]].some(([dx, dy]) => px[at(ox + x + dx, oy + y + dy) + 3] < 128)) return;
          px[i] = rgb[0]; px[i + 1] = rgb[1]; px[i + 2] = rgb[2];
        };
        for (let y = -rh; y <= rh; y++) for (let x = -rw; x <= rw; x++) {
          if ((x * x) / (rw * rw) + (y * y) / (rh * rh) <= 1.15) paint(cx + x, cy + y, skin);
        }
        const ink = [62, 44, 45];
        if (!side) { paint(cx - 3, cy - 1, ink); paint(cx + 3, cy - 1, ink); }
        else paint(cx + dir, cy - 1, ink);
        for (let x = -2; x <= 2; x++) paint(cx + x, cy + (Math.abs(x) === 2 ? 1 : 2), ink);
      }
    }
    ctx.putImageData(data, 0, 0); cache.set(img, canvas); return canvas;
  }
  return { sheet };
})();
