#!/bin/sh

if command -v bun >/dev/null 2>&1; then
  BUN_BIN="$(command -v bun)"
elif [ -x "$HOME/.bun/bin/bun" ]; then
  BUN_BIN="$HOME/.bun/bin/bun"
else
  echo "bun binary not found" >&2
  exit 127
fi

exec "$BUN_BIN" x --bun "$@"
