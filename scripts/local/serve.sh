#!/bin/bash
# Lokale Dienste starten: Internet-Stellvertreter, Gateway, Edge Function
cd "$(dirname "$0")/../.."
pkill -f tests/mock-upstream.mjs; pkill -f tests/gateway.mjs; pkill -f "functions/news/index.ts"; sleep 1
nohup node tests/mock-upstream.mjs > /tmp/mock.log 2>&1 &
nohup node tests/gateway.mjs > /tmp/gateway.log 2>&1 &
SERVICE=$(node tests/keys.mjs service)
DENO_NO_PACKAGE_JSON=1 DENO_SERVE_ADDRESS=tcp:127.0.0.1:8787 SUPABASE_URL=http://127.0.0.1:54321 SUPABASE_SERVICE_ROLE_KEY=$SERVICE \
  NEWS_TEST_PROXY=http://127.0.0.1:9955/ nohup npx deno run -A supabase/functions/news/index.ts > /tmp/fn.log 2>&1 &
sleep 4
tail -2 /tmp/mock.log /tmp/gateway.log /tmp/fn.log
pkill -f tests/webserver.mjs; sleep 0.5
nohup node tests/webserver.mjs > /tmp/web.log 2>&1 &
sleep 1
