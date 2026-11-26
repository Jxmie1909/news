#!/bin/bash
# Lokale Testumgebung: Anmeldedienst (GoTrue) + Daten-API (PostgREST) gegen lokales Postgres
JWT_SECRET="super-secret-jwt-token-with-at-least-32-characters-long"
docker rm -f news-auth news-rest >/dev/null 2>&1
docker run -d --name news-auth --network host \
  -e GOTRUE_API_HOST=0.0.0.0 -e GOTRUE_API_PORT=9999 -e API_EXTERNAL_URL=http://127.0.0.1:54321 \
  -e GOTRUE_DB_DRIVER=postgres -e "GOTRUE_DB_DATABASE_URL=postgres://supabase_auth_admin:postgres@127.0.0.1:5432/news" \
  -e GOTRUE_SITE_URL=http://127.0.0.1:8080 -e GOTRUE_JWT_SECRET=$JWT_SECRET -e GOTRUE_JWT_EXP=3600 \
  -e GOTRUE_JWT_AUD=authenticated -e GOTRUE_JWT_DEFAULT_GROUP_NAME=authenticated -e GOTRUE_JWT_ADMIN_ROLES=service_role \
  -e GOTRUE_DISABLE_SIGNUP=false -e GOTRUE_EXTERNAL_EMAIL_ENABLED=true -e GOTRUE_MAILER_AUTOCONFIRM=false \
  -e GOTRUE_RATE_LIMIT_TOKEN_REFRESH=1000 \
  supabase/gotrue:v2.198.0 >/dev/null
sleep 5
docker run -d --name news-rest --network host \
  -e "PGRST_DB_URI=postgres://authenticator:postgres@127.0.0.1:5432/news" -e PGRST_DB_SCHEMAS=public \
  -e PGRST_DB_ANON_ROLE=anon -e PGRST_JWT_SECRET=$JWT_SECRET -e PGRST_SERVER_PORT=3000 \
  postgrest/postgrest:v16.6 >/dev/null
sleep 2
docker ps --format '{{.Names}} {{.Status}}'
