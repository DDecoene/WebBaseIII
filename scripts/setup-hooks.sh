#!/bin/sh
# Point git at the tracked hooks directory. Run once after cloning.
# (core.hooksPath is a local config and is not committed, so each clone runs this.)
set -e
cd "$(dirname "$0")/.."
git config core.hooksPath .githooks
chmod +x .githooks/* 2>/dev/null || true
echo "Git hooks enabled (core.hooksPath = .githooks)."
