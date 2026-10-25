#!/usr/bin/env bash
# Application Windows SANS les zones : construit les installateurs (NSIS .exe + MSI), les range
# sous des noms simples dans out/release/ avec version.json, et peut les envoyer sur le VPS.
# Les tuiles des zones ne sont jamais embarquées : l'application les télécharge depuis le VPS
# (menu → zones), comme la version web. Voir docs/BUILD_EXE.md.
#
# À lancer sur le PC Windows (Git Bash), depuis n'importe où :
#   deploy/publish-desktop.sh                         build → out/release/
#   VPS=debian@1.2.3.4 deploy/publish-desktop.sh --upload
#   deploy/publish-desktop.sh --upload-only           renvoie out/release/ sans reconstruire
#
# Variables : DOMAIN (allezrobert.cparfait.ovh), VPS (utilisateur@hôte pour --upload),
# REMOTE_DIR (/home/debian/docker/allezrobert/deploy/data/downloads).
set -euo pipefail
cd "$(dirname "$0")/.."

DOMAIN="${DOMAIN:-allezrobert.cparfait.ovh}"
REMOTE_DIR="${REMOTE_DIR:-/home/debian/docker/allezrobert/deploy/data/downloads}"
OUT=out/release
mode="${1:-}"

version=$(node -p "require('./apps/desktop/src-tauri/tauri.conf.json').version")
exe="allez-robert_${version}_x64-setup.exe"
msi="allez-robert_${version}_x64_fr-FR.msi"

if [[ "$mode" != "--upload-only" ]]; then
  # Le jeu embarqué parle au VPS : salles, API et tuiles des zones.
  export VITE_SERVER_URL="${VITE_SERVER_URL:-https://$DOMAIN/colyseus}"
  export VITE_WORLDS_URL="${VITE_WORLDS_URL:-https://$DOMAIN}"
  # Jamais de tuiles dans l'exe (le plugin Vite ne les garde qu'avec AR_BUNDLE_TILES=1).
  unset AR_BUNDLE_TILES

  echo "→ Build de l'application Windows $version (serveur : $VITE_SERVER_URL)"
  pnpm --filter @allezrobert/desktop build

  if [[ -n "$(find apps/client/dist/worlds -type d -name tiles 2>/dev/null)" ]]; then
    echo "Des tuiles sont restées dans apps/client/dist/worlds : l'exe ne doit pas les contenir." >&2
    exit 1
  fi

  bundle=apps/desktop/src-tauri/target/release/bundle
  shopt -s nullglob
  nsis_files=("$bundle"/nsis/*_"${version}"_x64-setup.exe)
  msi_files=("$bundle"/msi/*_"${version}"_x64_*.msi)
  shopt -u nullglob
  [[ ${#nsis_files[@]} -gt 0 ]] || { echo "Installateur NSIS $version introuvable dans $bundle/nsis" >&2; exit 1; }

  rm -rf "$OUT" && mkdir -p "$OUT"
  cp "${nsis_files[0]}" "$OUT/$exe"
  cp "$OUT/$exe" "$OUT/allez-robert-setup.exe"
  if [[ ${#msi_files[@]} -gt 0 ]]; then
    cp "${msi_files[0]}" "$OUT/$msi"
    cp "$OUT/$msi" "$OUT/allez-robert.msi"
  else
    echo "  (pas de MSI produit : seul l'installateur .exe est publié)"
  fi

  # version.json : lu par le site pour afficher version, taille et empreinte.
  node - "$OUT" "$version" "$exe" "$msi" <<'EOF'
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const [out, version, exe, msi] = process.argv.slice(2);
const info = (f) => {
  const p = path.join(out, f);
  if (!fs.existsSync(p)) return undefined;
  const buf = fs.readFileSync(p);
  return { file: f, bytes: buf.length, sha256: crypto.createHash('sha256').update(buf).digest('hex') };
};
const data = { version, date: new Date().toISOString().slice(0, 10), exe: info(exe), msi: info(msi) };
fs.writeFileSync(path.join(out, 'version.json'), JSON.stringify(data, null, 2) + '\n');
console.log(`→ ${out}/version.json`, JSON.stringify(data));
EOF
  ls -lh "$OUT"
fi

if [[ "$mode" == "--upload" || "$mode" == "--upload-only" ]]; then
  [[ -n "${VPS:-}" ]] || { echo "VPS non défini (ex. VPS=debian@1.2.3.4)" >&2; exit 1; }
  [[ -f "$OUT/$exe" ]] || { echo "$OUT/$exe absent : lancer d'abord le build" >&2; exit 1; }
  echo "→ Envoi sur $VPS:$REMOTE_DIR"
  ssh "$VPS" "mkdir -p '$REMOTE_DIR'"
  # Fichiers versionnés d'abord, puis les alias « dernière version » et version.json : le site
  # n'annonce jamais une version dont le fichier n'est pas encore arrivé.
  versioned=("$OUT/$exe")
  [[ -f "$OUT/$msi" ]] && versioned+=("$OUT/$msi")
  scp "${versioned[@]}" "$VPS:$REMOTE_DIR/"
  latest=("$OUT/allez-robert-setup.exe")
  [[ -f "$OUT/allez-robert.msi" ]] && latest+=("$OUT/allez-robert.msi")
  scp "${latest[@]}" "$VPS:$REMOTE_DIR/"
  scp "$OUT/version.json" "$VPS:$REMOTE_DIR/"
  echo "→ En ligne : https://$DOMAIN/telechargement/allez-robert-setup.exe"
fi
