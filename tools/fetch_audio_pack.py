"""Check/restore curated audio: python3 tools/fetch_audio_pack.py [--check]. Requires ffmpeg."""
import hashlib
import json
from pathlib import Path
import subprocess
import sys
import tempfile
from urllib.parse import quote
from urllib.request import urlopen

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "assets/audio/pokemon/sources.json"
manifest = json.loads(SOURCE.read_text())
changed = False
for track in manifest["tracks"]:
    target = ROOT / track["src"]
    if target.exists():
        if hashlib.sha256(target.read_bytes()).hexdigest() != track["localSha256"]:
            raise SystemExit(f"Local file differs; preserved without replacement: {target}")
        continue
    if "--check" in sys.argv:
        raise SystemExit(f"Missing: {target}")
    with tempfile.TemporaryDirectory() as directory:
        original = Path(directory) / "source.ogg"
        data = urlopen(quote(track["url"], safe=":/"), timeout=90).read()
        if hashlib.sha256(data).hexdigest() != track["sha256"]:
            raise SystemExit(f"Remote source changed: {track['id']}")
        original.write_bytes(data)
        target.parent.mkdir(parents=True, exist_ok=True)
        args = ["ffmpeg", "-v", "error", "-nostdin", "-y", "-i", str(original)]
        if track.get("loopEnd", 0) > 0:
            args += ["-t", str(track["loopEnd"])]
        args += ["-map_metadata", "-1", "-ar", "32000", "-c:a", "libvorbis", "-q:a", "4", str(target)]
        subprocess.run(args, check=True)
        track["localBytes"] = target.stat().st_size
        track["localSha256"] = hashlib.sha256(target.read_bytes()).hexdigest()
        changed = True

if changed:
    SOURCE.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n")
    pack = {}
    for track in manifest["tracks"]:
        record = {key: track[key] for key in ["era", "generation", "game", "loopStart", "loopEnd"] if key in track}
        record.update(src=track["src"] + "?v=" + track["localSha256"][:10], name=track["title"])
        pack.setdefault(track["cue"], []).append(record)
    pack["rift"] += pack["boss"]
    pack.update(city=pack["village"], gym=pack["boss"], pokestop=pack["village"])
    (ROOT / "js/data/sound-pack.js").write_text(
        "/* Original game audio. Provenance: assets/audio/pokemon/sources.json. */\nG.SOUND_PACK = "
        + json.dumps(pack, ensure_ascii=False, indent=2) + ";\n")
print(f"OK: {len(manifest['tracks'])} files, {sum(t['localBytes'] for t in manifest['tracks']):,} bytes")
