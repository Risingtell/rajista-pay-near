#!/bin/bash
# Builds both contracts to plain MVP wasm (NEAR's runtime rejects newer wasm features). Run in WSL.
# `--cfg near` is what cargo-near passes: without it near-sdk aborts without the error message.
set -e
source ~/.cargo/env 2>/dev/null || true
ROOT=/mnt/c/Users/HP/Projects/rajista-pay-near
cd "$ROOT"
export CARGO_TARGET_DIR=$HOME/rajista-pay-near-target
RUSTFLAGS="-C link-arg=-s -C target-cpu=mvp --cfg near" cargo build -p rajista-pay -p mock-usdc --target wasm32-unknown-unknown --release 2>&1 | tail -3
mkdir -p "$ROOT/res"
for n in rajista_pay mock_usdc; do
  wasm-opt --enable-bulk-memory --enable-sign-ext --enable-nontrapping-float-to-int --llvm-memory-copy-fill-lowering \
    --llvm-nontrapping-fptoint-lowering --signext-lowering -Oz "$CARGO_TARGET_DIR/wasm32-unknown-unknown/release/$n.wasm" -o "$ROOT/res/$n.wasm"
  wasm-opt --mvp-features "$ROOT/res/$n.wasm" -o /dev/null && echo "$n: $(stat -c %s "$ROOT/res/$n.wasm") bytes, valid MVP wasm"
done
