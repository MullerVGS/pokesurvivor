# Pokémon Generation III (LG/FR/E) OpenType font

Game font converted to OpenType with advanced typography.

Read the [blog post](https://arcanenibble.github.io/a-quick-introduction-to-opentype.html)!

![Preview of basic latin characters](preview.png)

## Get the file

See GitHub releases.

## Preview

Open [`test.html`](test.html) from a local web server.

## Build setup

1. Clone [the Emerald decomp](https://github.com/pret/pokeemerald/) here
2. Install Pillow and fonttools: `pip install Pillow fonttools`
3. `python3 splitimg.py`
4. `python3 pathify.py`
5. `python3 build.py`

## License notes

This software which produces font software, and custom glyphs in [`xtra.png`](xtra.png) are licensed under the terms of the 0-Clause BSD license. Check your local jurisdiction regarding copyrightability of typefaces.
