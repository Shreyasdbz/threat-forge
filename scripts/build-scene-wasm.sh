#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

cargo build --manifest-path scene-wasm/Cargo.toml --target wasm32-unknown-unknown --release --locked
wasm-bindgen --target web --no-typescript --out-dir public/scene --out-name renderer \
  scene-wasm/target/wasm32-unknown-unknown/release/threatforge_scene_wasm.wasm
