#!/bin/bash
#***********************************************************
# build.sh — Build TQMesh WASM module for FEPS-web
#
# Prerequisites:
#   source ~/emsdk/emsdk_env.sh
#
# Output (SINGLE_FILE mode):
#   ../js/tqmesh.js   — Emscripten JS + embedded WASM
#***********************************************************

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

# Check emcmake is available
if ! command -v emcmake &> /dev/null; then
    echo "Error: emcmake not found. Please run:"
    echo "  source ~/emsdk/emsdk_env.sh"
    exit 1
fi

echo "=== Building TQMesh WASM module (SINGLE_FILE) ==="

# Create build directory
mkdir -p build
cd build

# Clean previous build to force re-link
rm -f tqmesh.js tqmesh.wasm

# Configure with Emscripten
emcmake cmake .. -DCMAKE_BUILD_TYPE=Release

# Build
emmake make -j4

# Copy output to FEPS-web/js/
echo "=== Copying output files ==="
rm -f ../../js/tqmesh.js ../../js/tqmesh.wasm
cp tqmesh.js ../../js/

echo "=== Build complete ==="
echo "Output: js/tqmesh.js (SINGLE_FILE — WASM embedded)"
ls -lh tqmesh.js
