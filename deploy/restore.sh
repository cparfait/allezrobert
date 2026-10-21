#!/usr/bin/env bash
# Restauration d'une sauvegarde PostgreSQL (lancer depuis deploy/ sur le VPS).
#   ./restore.sh backups/allezrobert-20261021-030000.dump
# Arrête le serveur et le worker, recrée la base, restaure, relance. La clé
# DATA_ENCRYPTION_KEY de deploy/.env doit être CELLE en vigueur lors de la sauvegarde.
set -euo pipefail
cd "$(dirname "$0")"

file="${1:-}"
if [[ -z "$file" || ! -f "$file" ]]; then
  echo "Usage : $0 <fichier .dump>" >&2
  ls -1t backups/*.dump 2>/dev/null | head -5 | sed 's/^/  disponible : /' >&2 || true
  exit 1
fi

read -r -p "Restaurer $file ? Les données actuelles seront REMPLACÉES. Taper « oui » : " ok
[[ "$ok" == "oui" ]] || { echo "Abandon."; exit 1; }

compose() { docker compose "$@"; }

echo "→ Sauvegarde de sécurité de l'état actuel"
compose run --rm --entrypoint /bin/sh backup /backup/backup-loop.sh now

echo "→ Arrêt du serveur et du worker"
compose stop server renderer 2>/dev/null || compose stop server

echo "→ Recréation de la base"
compose exec -T postgres psql -U allezrobert -d postgres -v ON_ERROR_STOP=1 \
  -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = 'allezrobert' AND pid <> pg_backend_pid();" \
  -c "DROP DATABASE IF EXISTS allezrobert;" \
  -c "CREATE DATABASE allezrobert OWNER allezrobert;"

echo "→ Restauration"
compose exec -T postgres pg_restore -U allezrobert -d allezrobert --no-owner --exit-on-error < "$file"

echo "→ Redémarrage"
compose up -d
echo "Restauration terminée. Vérifier : https://$(grep -E '^DOMAIN=' .env | cut -d= -f2)/api/health"
