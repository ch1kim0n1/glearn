#!/usr/bin/env bash
#
# Regenerate the PyPI artifacts for glearn.
#
# This script rebuilds the TypeScript, re-bundles the CLI into a single
# Node.js-runnable JavaScript file, copies the tiktoken WASM sidecar and a
# minimal version package.json next to the bundle, and then builds the Python
# sdist + wheel.
#
# Prerequisites: Node.js >= 18, npm, Python 3.8+, and `pip install build twine`.
#
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

BUNDLE_DIR="python/glearn/_bundle"

echo "==> Installing npm deps (ignoring native build scripts)"
npm install --ignore-scripts

echo "==> Compiling TypeScript (npm run build -> dist/)"
npm run build

echo "==> Bundling CLI with esbuild -> $BUNDLE_DIR/glearn.cli.js"
mkdir -p "$BUNDLE_DIR"
# better-sqlite3 is a native addon (no prebuilt-free pure-JS path) and is kept
# external. It is loaded via a lazy require() with an in-memory / error-tolerant
# fallback, so the CLI starts and runs without it. tiktoken is bundled and reads
# its WASM sidecar from __dirname at runtime (char-count fallback if missing).
npx esbuild dist/cli.js \
  --bundle \
  --platform=node \
  --target=node18 \
  --format=cjs \
  --outfile="$BUNDLE_DIR/glearn.cli.js" \
  --external:better-sqlite3

echo "==> Copying tiktoken WASM sidecar"
cp node_modules/tiktoken/tiktoken_bg.wasm "$BUNDLE_DIR/tiktoken_bg.wasm"

echo "==> Writing version package.json (so 'glearn --version' is correct)"
node -e "const p=require('./package.json'); require('fs').writeFileSync('python/glearn/package.json', JSON.stringify({name:p.name,version:p.version},null,2)+'\n')"

echo "==> Building Python sdist + wheel"
rm -rf dist_py
python -m build --outdir dist_py

echo "==> Done. Artifacts in dist_py/"
ls -la dist_py
