#!/usr/bin/env bash
# Envoie vers le VPS les tuiles des zones (et, avec --menu, les boucles vidéo du menu), depuis le PC.
# À lancer depuis Git Bash (tar et ssh suffisent, pas besoin de rsync) :
#
#   deploy/sync-zones.sh                    toutes les zones qui ont des tuiles
#   deploy/sync-zones.sh montmartre         seulement celles-ci
#   deploy/sync-zones.sh --menu             les vidéos du menu en plus (ou seules : --menu --none)
#   deploy/sync-zones.sh --graphs           seulement les graphes routiers (graph.json) de toutes les zones
#                                           qui en ont un, ou des zones citées : premier remplissage du serveur
#   deploy/sync-zones.sh --no-graphs …      les tuiles sans les graphes (comportement d'avant le 22/11/2026)
#
# Avec les tuiles d'une zone part aussi son graphe routier (worlds/<zone>/graph.json), déposé à côté du dossier
# tiles : Caddy le sert de là en priorité, avec repli sur celui de l'image web. Il n'est envoyé que s'il a
# changé (empreinte SHA-256 comparée à celle du serveur), d'abord sous un nom provisoire puis renommé, avec sa
# copie compressée graph.json.gz que Caddy sert telle quelle (un graphe de 34 Mo en fait 4 à 5).
#
# Chaque zone est envoyée dans tiles.new puis échangée d'un coup avec tiles : les joueurs ne voient
# jamais une zone à moitié copiée, et les fichiers supprimés d'une zone disparaissent du serveur.
# Réglages (variables d'environnement) : SYNC_HOST, SYNC_PORT, SYNC_KEY, SYNC_REMOTE, SYNC_URL.
#
# ORDRE D'UNE MISE À JOUR : 1) ce script (tuiles et graphe), 2) commit de world.json / index.json / graph.json /
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
graphs=1
graphs_only=0
zones=()
for a in "$@"; do
  case "$a" in
    --menu) menu=1 ;;
    --none) none=1 ;;
    --graphs) graphs_only=1 ;;
    --no-graphs) graphs=0 ;;
    *) zones+=("$a") ;;
  esac
done
if [ "$none" = 0 ] && [ "${#zones[@]}" = 0 ]; then
  if [ "$graphs_only" = 1 ]; then
    for g in "$WORLDS"/*/graph.json; do
      [ -f "$g" ] && zones+=("$(basename "$(dirname "$g")")")
    done
  else
    for t in "$WORLDS"/*/tiles/pack.json; do
      [ -f "$t" ] && zones+=("$(basename "$(dirname "$(dirname "$t")")")")
    done
  fi
fi
[ "$none" = 1 ] && zones=()

# Graphe routier d'une zone : envoyé seulement s'il diffère de celui du serveur, puis échangé d'un coup.
sync_graph() {
  local id="$1" src="$WORLDS/$1/graph.json" dir="$REMOTE/data/worlds/$1"
  [ -f "$src" ] || return 0
  local here there
  here="$(sha256sum "$src" | cut -d' ' -f1)"
  there="$("${SSH[@]}" "$HOST" "sha256sum '$dir/graph.json' 2>/dev/null | cut -d' ' -f1" || true)"
  if [ -n "$there" ] && [ "$here" = "$there" ]; then
    echo "   graphe : identique à celui du serveur, non renvoyé"
    return 0
  fi
  echo "   graphe : envoi ($(du -h "$src" | cut -f1))"
  gzip -9 -c "$src" | "${SSH[@]}" "$HOST" "mkdir -p '$dir' && cat > '$dir/graph.json.gz.new' && gunzip -c '$dir/graph.json.gz.new' > '$dir/graph.json.new' && [ \"\$(sha256sum '$dir/graph.json.new' | cut -d' ' -f1)\" = '$here' ] && mv '$dir/graph.json.new' '$dir/graph.json' && mv '$dir/graph.json.gz.new' '$dir/graph.json.gz'"     || { echo "!! $id : envoi du graphe échoué (empreinte différente ou liaison coupée), ancien graphe gardé"; "${SSH[@]}" "$HOST" "rm -f '$dir/graph.json.new' '$dir/graph.json.gz.new'" || true; return 0; }
  if curl -fsI "$URL/worlds/$id/graph.json" >/dev/null; then echo "   ok : $URL/worlds/$id/graph.json"; else echo "!! $id : le serveur ne répond pas sur graph.json"; fi
}

for id in "${zones[@]}"; do
  if [ "$graphs_only" = 1 ]; then
    echo "== $id"
    [ -f "$WORLDS/$id/graph.json" ] || { echo "!! $id : pas de graph.json, ignorée"; continue; }
    sync_graph "$id"
    continue
  fi
  src="$WORLDS/$id/tiles"
  [ -f "$src/pack.json" ] || { echo "!! $id : pas de $src/pack.json, ignorée"; continue; }
  dir="$REMOTE/data/worlds/$id"
  echo "== $id ($(du -sh "$src" | cut -f1))"
  "${SSH[@]}" "$HOST" "rm -rf '$dir/tiles.new' && mkdir -p '$dir/tiles.new'"
  tar -czf - -C "$src" . | "${SSH[@]}" "$HOST" "tar -xzf - -C '$dir/tiles.new'"
  "${SSH[@]}" "$HOST" "cd '$dir' && rm -rf tiles.old && if [ -d tiles ]; then mv tiles tiles.old; fi && mv tiles.new tiles && rm -rf tiles.old"
  if curl -fsI "$URL/worlds/$id/tiles/pack.json" >/dev/null; then echo "   ok : $URL/worlds/$id/tiles/pack.json"; else echo "!! $id : le serveur ne répond pas sur pack.json"; fi
  [ "$graphs" = 1 ] && sync_graph "$id"
done

if [ "$menu" = 1 ]; then
  echo "== vidéos du menu"
  "${SSH[@]}" "$HOST" "mkdir -p '$REMOTE/data/menu'"
  scp -i "$KEY" -P "$PORT" apps/client/public/menu/loop-*.mp4 apps/client/public/menu/loop-*.webm "$HOST:$REMOTE/data/menu/"
  curl -fsI "$URL/menu/loop-spring.mp4" >/dev/null && echo "   ok : $URL/menu/loop-spring.mp4" || echo "!! vidéo du menu introuvable côté serveur"
fi

echo
echo "Terminé. Si le contenu d'une zone a changé : commiter world.json / index.json de la zone, puis redéployer l'image web."
