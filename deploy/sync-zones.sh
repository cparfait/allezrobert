#!/usr/bin/env bash
# Envoie vers le VPS les tuiles des zones (et, avec --menu, les boucles vidéo du menu), depuis le PC.
# À lancer depuis Git Bash (tar et ssh suffisent, pas besoin de rsync) :
#
#   deploy/sync-zones.sh                    toutes les zones qui ont des tuiles
#   deploy/sync-zones.sh montmartre         seulement celles-ci
#   deploy/sync-zones.sh --menu             les vidéos du menu en plus (ou seules : --menu --none)
#
# Chaque zone est envoyée dans tiles.new puis échangée d'un coup avec tiles : les joueurs ne voient
# jamais une zone à moitié copiée, et les fichiers supprimés d'une zone disparaissent du serveur.
# Réglages (variables d'environnement) : SYNC_HOST, SYNC_PORT, SYNC_KEY, SYNC_REMOTE, SYNC_URL.
#
# ORDRE D'UNE MISE À JOUR : 1) ce script (tuiles), 2) commit de world.json / index.json / graph.json /
# places.json de la zone, 3) redéploiement de l'image web (deploy.sh). Dans l'autre sens, le catalogue
# annoncerait une version dont les tuiles ne sont pas encore là.
set -euo pipefail
cd "$(dirname "$0")/.."

HOST="${SYNC_HOST:-debian@allezrobert.cparfait.ovh}"
PORT="${SYNC_PORT:-22222}"
KEY="${SYNC_KEY:-$HOME/.ssh/id_ed25519_openssh}"
REMOTE="${SYNC_REMOTE:-/home/debian/docker/allezrobert/deploy}"
URL="${SYNC_URL:-https://allezrobert.cparfait.ovh}"
SSH=(ssh -i "$KEY" -p "$PORT" -o ServerAliveInterval=30)
WORLDS=apps/client/public/worlds

menu=0
none=0
zones=()
for a in "$@"; do
  case "$a" in
    --menu) menu=1 ;;
    --none) none=1 ;;
    *) zones+=("$a") ;;
  esac
done
if [ "$none" = 0 ] && [ "${#zones[@]}" = 0 ]; then
  for t in "$WORLDS"/*/tiles/pack.json; do
    [ -f "$t" ] && zones+=("$(basename "$(dirname "$(dirname "$t")")")")
  done
fi
[ "$none" = 1 ] && zones=()

for id in "${zones[@]}"; do
  src="$WORLDS/$id/tiles"
  [ -f "$src/pack.json" ] || { echo "!! $id : pas de $src/pack.json, ignorée"; continue; }
  dir="$REMOTE/data/worlds/$id"
  echo "== $id ($(du -sh "$src" | cut -f1))"
  "${SSH[@]}" "$HOST" "rm -rf '$dir/tiles.new' && mkdir -p '$dir/tiles.new'"
  tar -czf - -C "$src" . | "${SSH[@]}" "$HOST" "tar -xzf - -C '$dir/tiles.new'"
  "${SSH[@]}" "$HOST" "cd '$dir' && rm -rf tiles.old && if [ -d tiles ]; then mv tiles tiles.old; fi && mv tiles.new tiles && rm -rf tiles.old"
  if curl -fsI "$URL/worlds/$id/tiles/pack.json" >/dev/null; then echo "   ok : $URL/worlds/$id/tiles/pack.json"; else echo "!! $id : le serveur ne répond pas sur pack.json"; fi
done

if [ "$menu" = 1 ]; then
  echo "== vidéos du menu"
  "${SSH[@]}" "$HOST" "mkdir -p '$REMOTE/data/menu'"
  scp -i "$KEY" -P "$PORT" apps/client/public/menu/loop-*.mp4 apps/client/public/menu/loop-*.webm "$HOST:$REMOTE/data/menu/"
  curl -fsI "$URL/menu/loop-spring.mp4" >/dev/null && echo "   ok : $URL/menu/loop-spring.mp4" || echo "!! vidéo du menu introuvable côté serveur"
fi

echo
echo "Terminé. Si le contenu d'une zone a changé : commiter world.json / index.json de la zone, puis redéployer l'image web."
