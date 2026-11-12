#!/bin/bash
# Contract unit tests (Linux, macOS or WSL). Needs Rust stable.
set -e
source ~/.cargo/env 2>/dev/null || true
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
export CARGO_TARGET_DIR="${CARGO_TARGET_DIR:-$ROOT/target}"
cargo test -p rajista-pay 2>&1 | tail -30
