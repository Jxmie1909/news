#!/bin/bash
# Lokale Umgebung komplett neu: Datenbank, Anmeldedienst, Schema, Dienste
set -e
cd "$(dirname "$0")/../.."
docker rm -f news-auth news-rest >/dev/null 2>&1 || true
bash scripts/local/reset-db.sh >/dev/null 2>&1
bash scripts/local/stack.sh >/dev/null
for f in supabase/migrations/20261126000001_init.sql supabase/migrations/20261126000002_sources.sql supabase/migrations/20261127000004_briefing.sql; do
  su postgres -c "psql -q -v ON_ERROR_STOP=1 -d news -f $(pwd)/$f"
done
su postgres -c "psql -d news -qc \"notify pgrst, 'reload schema'\""
bash scripts/local/serve.sh >/dev/null 2>&1
sleep 2
curl -s --noproxy '*' -X POST "http://127.0.0.1:54321/functions/v1/news?action=status"; echo
