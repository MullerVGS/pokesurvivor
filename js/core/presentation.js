/* Fixed FRLG presentation. Audio selection lives in SoundLibrary. */
G.Presentation = (() => {
  const palette = Object.freeze({ paper: '#f8f8e8', edge: '#486860', ink: '#303838' });
  // Preserve existing canvas geometry while matching Gen III glyph metrics.
  function font(weight, size) {
    return `400 ${Math.round(size * 1.35 / 2) * 2}px PokemonGen3,"Segoe UI",sans-serif`;
  }
  return Object.freeze({ palette, font });
})();
