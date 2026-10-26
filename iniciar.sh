#!/usr/bin/env sh
cd "$(dirname "$0")"
if ! command -v node >/dev/null 2>&1; then
  echo "O F.O.G.O. precisa do Node.js 18+ (https://nodejs.org)"; exit 1
fi
exec node server/index.js "$@"
