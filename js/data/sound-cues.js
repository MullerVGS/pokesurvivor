/* Audio contexts. Areas can supply their own cue without changing the mixer. */
G.SOUND_CUES = {
  village: { kind: 'music', label: 'Menú principal', fallback: 'village' },
  forest: { kind: 'music', label: 'Bosque Umbrío', fallback: 'forest' },
  cave: { kind: 'music', label: 'Cueva Cristal', fallback: 'cave' },
  volcano: { kind: 'music', label: 'Volcán Ceniza', fallback: 'volcano' },
  boss: { kind: 'music', label: 'Jefes', fallback: 'boss' },
  rift: { kind: 'music', label: 'Grieta legendaria', fallback: 'rift' },
  judgment: { kind: 'music', label: 'Juicio de Arceus', fallback: 'judgment' },
  // Reserved for area triggers; these locations do not exist in the world yet.
  city: { kind: 'music', label: 'Ciudad', fallback: 'village', future: true },
  gym: { kind: 'music', label: 'Gimnasio', fallback: 'boss', future: true },
  pokestop: { kind: 'music', label: 'Poképarada', fallback: 'village', future: true },
  click: { kind: 'sfx', label: 'Seleccionar' },
  back: { kind: 'sfx', label: 'Volver' },
  confirm: { kind: 'sfx', label: 'Confirmar' },
  levelup: { kind: 'sfx', label: 'Subir de nivel' },
  heal: { kind: 'sfx', label: 'Curación' },
  biome: { kind: 'sfx', label: 'Cambio de bioma' }
};
