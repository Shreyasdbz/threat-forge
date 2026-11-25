#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

toolchain=1.99.1
bindgen_version=0.2.114
if [[ "$(wasm-bindgen --version)" != "wasm-bindgen $bindgen_version" ]]; then
  echo "Install wasm-bindgen-cli $bindgen_version before building the scene." >&2
  exit 1
fi

repo=$(pwd -P)
cargo_home=$(realpath "${CARGO_HOME:-$HOME/.cargo}")
export CARGO_ENCODED_RUSTFLAGS="--remap-path-prefix=$repo=."$'\x1f'"--remap-path-prefix=$cargo_home=/cargo"
cargo "+$toolchain" build --manifest-path scene-wasm/Cargo.toml --target wasm32-unknown-unknown --release --locked
wasm-bindgen --target web --no-typescript --out-dir public/scene --out-name renderer \
  scene-wasm/target/wasm32-unknown-unknown/release/threatforge_scene_wasm.wasm
