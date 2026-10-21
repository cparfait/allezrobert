#!/usr/bin/env bash
# Déploiement / mise à jour d'Allez Robert ! sur le VPS (lancer depuis deploy/).
#   ./deploy.sh            images publiées par la CI (GHCR) : pull
#   ./deploy.sh build      construction locale des images sur le VPS (sans CI)
# Étapes : vérifications → sauvegarde → images → base → migrations → démarrage → contrôle.
set -euo pipefail
cd "$(dirname "$0")"

mode="${1:-pull}"
[[ -f .env ]] || { echo "deploy/.env manquant : cp .env.example .env puis renseigner les secrets (docs/DEPLOY.md)" >&2; exit 1; }
chmod 600 .env || true
set -a; . ./.env; set +a

for v in DOMAIN LIVEKIT_DOMAIN POSTGRES_PASSWORD SESSION_SECRET DATA_ENCRYPTION_KEY LIVEKIT_API_KEY LIVEKIT_API_SECRET; do
  [[ -n "${!v:-}" ]] || { echo "Variable $v vide dans .env" >&2; exit 1; }
done
if grep -qE '^(SESSION_SECRET|DATA_ENCRYPTION_KEY|POSTGRES_PASSWORD|LIVEKIT_API_SECRET)=a-generer' .env || grep -q '^DATA_ENCRYPTION_KEY=AAAAAAAA' .env; then
  echo "Des secrets d'exemple sont encore présents dans .env : les générer (docs/DEPLOY.md, étape 5)." >&2
  exit 1
fi

worlds="${WORLDS_DIR:-./data/worlds}"
mkdir -p "$worlds" "${BACKUP_DIR:-./backups}"
if [[ -z "$(ls -A "$worlds" 2>/dev/null)" ]]; then
  echo "Attention : aucune tuile du monde dans $worlds (le relief ne s'affichera pas) : voir docs/DEPLOY.md §12."
fi

compose() { docker compose "$@"; }
compose config -q

if compose ps --status running postgres 2>/dev/null | grep -q postgres; then
  echo "→ Sauvegarde avant mise à jour"
  compose run --rm --entrypoint /bin/sh backup /backup/backup-loop.sh now || echo "  (sauvegarde impossible, on continue)"
fi

if [[ "$mode" == "build" ]]; then
  echo "→ Construction des images (peut prendre plusieurs minutes)"
  compose build
else
  echo "→ Téléchargement des images"
  compose pull
fi

echo "→ Base de données"
compose up -d postgres
for i in $(seq 1 60); do
  compose exec -T postgres pg_isready -U allezrobert -d allezrobert >/dev/null 2>&1 && break
  sleep 2
done

echo "→ Migrations"
compose run --rm --no-deps server ./node_modules/.bin/tsx src/db/migrate-cli.ts

echo "→ Démarrage"
compose up -d --remove-orphans

echo "→ Contrôle de santé"
ok=0
for i in $(seq 1 45); do
  if compose exec -T server node -e "fetch('http://127.0.0.1:2567/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" >/dev/null 2>&1; then ok=1; break; fi
  sleep 2
done
[[ $ok == 1 ]] || { echo "Le serveur ne répond pas : docker compose logs server" >&2; exit 1; }
if command -v curl >/dev/null && curl -fsS --max-time 10 "https://${DOMAIN}/api/health" >/dev/null 2>&1; then
  echo "  https://${DOMAIN}/api/health : OK"
else
  echo "  Serveur OK en interne ; HTTPS pas encore joignable (DNS ou certificat en cours ?) : docker compose logs caddy"
fi

docker image prune -f >/dev/null
compose ps
echo "Déploiement terminé."
