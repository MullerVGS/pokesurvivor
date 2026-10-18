#!/usr/bin/env python3
"""Recover missing official type symbols, or verify all local hashes with --check."""
from pathlib import Path
import hashlib
import json
import sys
import urllib.request

root = Path(__file__).resolve().parents[1] / 'assets/ui/types'
records = json.loads((root / 'sources.json').read_text())['images']
for record in records:
    path = root / record['file']
    if not path.exists() and '--check' not in sys.argv:
        with urllib.request.urlopen(record['source'], timeout=30) as response:
            data = response.read()
        assert hashlib.sha256(data).hexdigest() == record['sha256'], record['source']
        path.write_bytes(data)
    assert hashlib.sha256(path.read_bytes()).hexdigest() == record['sha256'], str(path)
print(f'OK: {len(records)} official type icons, {sum(r["bytes"] for r in records)} bytes, all hashes verified.')
