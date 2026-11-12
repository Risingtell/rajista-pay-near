#!/bin/bash
# Contract unit tests. Run in WSL.
set -e
source ~/.cargo/env 2>/dev/null || true
cd /mnt/c/Users/HP/Projects/rajista-pay-near
export CARGO_TARGET_DIR=$HOME/rajista-pay-near-target
cargo test -p rajista-pay 2>&1 | tail -30
