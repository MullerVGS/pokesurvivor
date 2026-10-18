"""Rebuild the monochrome Gen III webfont. Requires fonttools + brotli.

The upstream COLR palette hardcodes black foregrounds, which cannot follow the
game's dark overlays. Keep its original outline glyphs; remove only color tables.
"""
from pathlib import Path
from fontTools.ttLib import TTFont

folder = Path(__file__).resolve().parents[1] / "assets/fonts/gen3"
font = TTFont(folder / "Emerald.ttf")
del font["COLR"]
del font["CPAL"]
font.flavor = "woff2"
font.save(folder / "PokemonGen3-mono.woff2")
