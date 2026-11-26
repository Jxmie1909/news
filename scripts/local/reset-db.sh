#!/bin/bash
# Lokale Testdatenbank neu aufbauen
set -e
cd "$(dirname "$0")/../.."
su postgres -c "psql -q -c \"drop database if exists news\"" 
for r in authenticator supabase_auth_admin anon authenticated service_role; do su postgres -c "psql -q -c \"drop role if exists $r\"" ; done
su postgres -c "psql -q -c \"create database news\""
su postgres -c "psql -q -c \"alter user postgres password 'postgres'\""
su postgres -c "psql -q -v ON_ERROR_STOP=1 -d news" < scripts/local/bootstrap.sql
