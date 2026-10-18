#!/usr/bin/env bash
# Local trial with its own database; never points at the deployed game.
set -euo pipefail
preview_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
export PORT="${PORT:-3095}"
export DATA_DIR="${DATA_DIR:-/tmp/pokesurvivor-frlg-preview-data}"
export STATIC_DIR="$preview_root"
export BETTER_AUTH_URL="${BETTER_AUTH_URL:-http://localhost:$PORT}"
node "$preview_root/server/index.js"
