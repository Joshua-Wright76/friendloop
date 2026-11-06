#!/usr/bin/env bash
# Isolated recording stack: its own Postgres, build, Mailpit and shim per shard.
# Nothing here touches .env, the dev server on :3000, or the shared Mailpit.
#   stack.sh build         build once
#   stack.sh up <k>        start shard k (app 3190+k, mailpit 8190+k)
#   stack.sh down          stop everything this script started
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
RUN="$HOME/Library/Caches/friendloop-rec"
PGPORT=55490
PGBIN="$(brew --prefix postgresql@16 2>/dev/null)/bin"
[ -x "$PGBIN/initdb" ] || PGBIN="$(dirname "$(command -v initdb)")"
mkdir -p "$RUN"

pg_up() {
  [ -d "$RUN/pg" ] || "$PGBIN/initdb" -D "$RUN/pg" -U postgres --auth=trust --encoding=UTF8 --locale=C >/dev/null
  "$PGBIN/pg_ctl" status -D "$RUN/pg" >/dev/null 2>&1 || \
    "$PGBIN/pg_ctl" start -D "$RUN/pg" -l "$RUN/pg.log" -w -o "-p $PGPORT -k $RUN -c listen_addresses=127.0.0.1 -c fsync=off" >/dev/null
}
dburl() { echo "postgresql://postgres@127.0.0.1:$PGPORT/friendloop_rec_$1"; }

case "${1:-}" in
  build)
    pg_up
    "$PGBIN/createdb" -h 127.0.0.1 -p $PGPORT -U postgres friendloop_rec_0 2>/dev/null || true
    cd "$ROOT"
    # Prerendering reads the database, so it needs the current schema.
    DATABASE_URL="$(dburl 0)" TEST_DATABASE_URL="$(dburl 0)" node --import ./test/register.mjs -e 'const db = await import("./e2e/support/db.ts"); await db.resetSchema(); await db.migrate(); process.exit(0)' --input-type=module
    E2E=1 EMAIL_TRANSPORT=resend RESEND_API_KEY=re_local RESEND_BASE_URL=http://127.0.0.1:3290 \
      CRON_SECRET=rec-cron-secret UI_PREVIEW_SECRET=rec-preview-secret \
      DATABASE_URL="$(dburl 0)" NEXT_PUBLIC_APP_URL=http://localhost:3190 npx next build
    ;;
  up)
    k="$2"; pg_up
    S="$RUN/shard-$k"; APP=$((3190+k)); MP=$((8190+k)); SMTP=$((1190+k)); SHIM=$((3290+k))
    "$PGBIN/createdb" -h 127.0.0.1 -p $PGPORT -U postgres "friendloop_rec_$k" 2>/dev/null || true
    rm -rf "$S"; mkdir -p "$S"
    # An APFS clone of the build, with the baked-in app URL pointed at this shard.
    cp -cR "$ROOT/.next" "$ROOT/public" "$ROOT/package.json" "$ROOT/next.config.ts" "$ROOT/tsconfig.json" "$ROOT/drizzle" "$ROOT/src" "$S/"
    ln -s "$ROOT/node_modules" "$S/node_modules"
    grep -rlF "localhost:3190" "$S/.next" | xargs sed -i '' "s/localhost:3190/localhost:$APP/g" || true
    nohup mailpit --listen 127.0.0.1:$MP --smtp 127.0.0.1:$SMTP --database "$S/mailpit.db" --max 0 >"$S/mailpit.log" 2>&1 &
    echo $! > "$S/mailpit.pid"
    MAILPIT_SHIM_PORT=$SHIM MAILPIT_URL=http://127.0.0.1:$MP nohup node "$ROOT/recordings/mailpit-shim.mjs" >"$S/shim.log" 2>&1 &
    echo $! > "$S/shim.pid"
    (cd "$S" && E2E=1 EMAIL_TRANSPORT=resend RESEND_API_KEY=re_local RESEND_BASE_URL=http://127.0.0.1:$SHIM \
      CRON_SECRET=rec-cron-secret UI_PREVIEW_SECRET=rec-preview-secret RESEND_WEBHOOK_SECRET="whsec_ZTJlLXJlc2VuZC13ZWJob29rLXNlY3JldA==" DATABASE_URL="$(dburl $k)" \
      NEXT_PUBLIC_APP_URL=http://localhost:$APP nohup "$ROOT/node_modules/.bin/next" start -H localhost -p $APP >"$S/next.log" 2>&1 & echo $! > "$S/next.pid")
    for _ in $(seq 60); do curl -sf -o /dev/null "http://localhost:$APP/signin" && break; sleep 1; done
    curl -sf -o /dev/null "http://localhost:$APP/signin" && echo "shard $k up: app $APP mailpit $MP" || { tail -20 "$S/next.log"; exit 1; }
    ;;
  down)
    for p in "$RUN"/shard-*/*.pid; do [ -f "$p" ] && kill "$(cat "$p")" 2>/dev/null || true; done
    "$PGBIN/pg_ctl" stop -D "$RUN/pg" -m fast >/dev/null 2>&1 || true
    ;;
  *) echo "usage: stack.sh build|up <k>|down"; exit 2;;
esac
