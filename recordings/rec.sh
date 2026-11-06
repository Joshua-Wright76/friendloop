#!/usr/bin/env bash
# Runs recordings/run.mjs against one shard's isolated database.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
shard=0; args=("$@")
for ((i=0;i<$#;i++)); do [ "${args[$i]}" = "--shard" ] && shard="${args[$((i+1))]}"; done
export DATABASE_URL="postgresql://postgres@127.0.0.1:55490/friendloop_rec_$shard"
export TEST_DATABASE_URL="$DATABASE_URL" E2E_PORT=$((3190+shard)) CRON_SECRET=rec-cron-secret
export E2E=1 NEXT_PUBLIC_APP_URL="http://localhost:$((3190+shard))"
cd "$HOME/Library/Caches/friendloop-rec/shard-$shard"
exec node --import "$ROOT/test/register.mjs" "$ROOT/recordings/run.mjs" "$@"
