#!/bin/sh
# Sauvegarde quotidienne de PostgreSQL (conteneur « backup ») : pg_dump au format custom
# chaque jour à BACKUP_HOUR (UTC), rétention BACKUP_KEEP_DAYS jours, dans /backups.
# Les données sensibles (FC, FIT, jetons) restent chiffrées dans le dump : conserver
# DATA_ENCRYPTION_KEY à part, sinon la sauvegarde est inexploitable.
set -eu

HOUR="${BACKUP_HOUR:-3}"
KEEP="${BACKUP_KEEP_DAYS:-14}"
mkdir -p /backups

dump() {
  ts="$(date -u +%Y%m%d-%H%M%S)"
  tmp="/backups/.allezrobert-$ts.dump.part"
  if pg_dump --format=custom --compress=6 --no-owner --file="$tmp"; then
    mv "$tmp" "/backups/allezrobert-$ts.dump"
    echo "$(date -u +%FT%TZ) sauvegarde OK : allezrobert-$ts.dump ($(du -h "/backups/allezrobert-$ts.dump" | cut -f1))"
  else
    rm -f "$tmp"
    echo "$(date -u +%FT%TZ) ÉCHEC de la sauvegarde" >&2
  fi
  find /backups -name 'allezrobert-*.dump' -type f -mtime "+$KEEP" -delete
}

# « backup-loop.sh now » : une sauvegarde immédiate puis sortie (utilisé par deploy.sh).
if [ "${1:-}" = "now" ]; then
  dump
  exit 0
fi

echo "sauvegardes quotidiennes à ${HOUR}h UTC, rétention ${KEEP} jours"
while true; do
  now=$(date -u +%s)
  today=$(date -u +%Y-%m-%d)
  target=$(date -u -d "$today $HOUR:00:00" +%s 2>/dev/null || date -u -D "%Y-%m-%d %H:%M:%S" -d "$today $HOUR:00:00" +%s)
  if [ "$target" -le "$now" ]; then target=$((target + 86400)); fi
  sleep $((target - now))
  dump
done
