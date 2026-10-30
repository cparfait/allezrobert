#!/usr/bin/env bash
# Application Windows SANS les zones : construit les installateurs (NSIS .exe + MSI), les range
# sous des noms simples dans out/release/ avec version.json, et peut les envoyer sur le VPS.
# Les tuiles des zones ne sont jamais embarquées : l'application les télécharge depuis le VPS
# (menu → zones), comme la version web. Les ressources lourdes (vidéos du menu, modèles, musique,
# voix, mondes) ne sont pas non plus dans l'exe : publiées par empreinte dans media/, l'application
# télécharge au lancement celles qui ont changé. Voir docs/BUILD_EXE.md.
#
# À lancer sur le PC Windows (Git Bash), depuis n'importe où :
#   deploy/publish-desktop.sh                         build → out/release/
#   VPS=debian@1.2.3.4 deploy/publish-desktop.sh --upload
#   deploy/publish-desktop.sh --upload-only           renvoie out/release/ sans reconstruire
#
# Variables : DOMAIN (allezrobert.cparfait.ovh), VPS (utilisateur@hôte pour --upload),
# REMOTE_DIR (/home/debian/docker/allezrobert/deploy/data/downloads), NOTES (texte de la mise à jour),
# TAURI_SIGNING_PRIVATE_KEY (clé des mises à jour ; par défaut ~/.tauri/allezrobert-updater.key).
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
  # Le jeu embarqué parle au VPS : salles, API, tuiles des zones et ressources du jeu.
  export VITE_SERVER_URL="${VITE_SERVER_URL:-https://$DOMAIN/colyseus}"
  export VITE_WORLDS_URL="${VITE_WORLDS_URL:-https://$DOMAIN}"
  # Jamais de tuiles dans l'exe (le plugin Vite ne les garde qu'avec AR_BUNDLE_TILES=1).
  unset AR_BUNDLE_TILES
  # Installateur : le plugin Vite ar-installer-diet retire de dist/ les boucles vidéo VP9 en double et sort les
  # ressources lourdes vers apps/client/dist-media/ (manifeste embarqué : dist/media-manifest.json).
  export AR_DESKTOP=1
  # Mises à jour signées : sans la clé privée, tauri build refuse de produire la signature.
  if [[ -z "${TAURI_SIGNING_PRIVATE_KEY:-}" ]]; then
    key="$HOME/.tauri/allezrobert-updater.key"
    [[ -f "$key" ]] || { echo "Clé des mises à jour absente ($key) : voir docs/BUILD_EXE.md" >&2; exit 1; }
    TAURI_SIGNING_PRIVATE_KEY="$(cat "$key")"
    export TAURI_SIGNING_PRIVATE_KEY
    export TAURI_SIGNING_PRIVATE_KEY_PASSWORD="${TAURI_SIGNING_PRIVATE_KEY_PASSWORD:-}"
  fi

  echo "→ Build de l'application Windows $version (serveur : $VITE_SERVER_URL)"
  pnpm --filter @allezrobert/desktop build

  if [[ -n "$(find apps/client/dist/worlds -type d -name tiles 2>/dev/null)" ]]; then
    echo "Des tuiles sont restées dans apps/client/dist/worlds : l'exe ne doit pas les contenir." >&2
    exit 1
  fi
  [[ -f apps/client/dist/media-manifest.json && -d apps/client/dist-media ]] || { echo "Ressources non sorties de l'exe (AR_DESKTOP=1 ignoré ?)" >&2; exit 1; }

  bundle=apps/desktop/src-tauri/target/release/bundle
  shopt -s nullglob
  nsis_files=("$bundle"/nsis/*_"${version}"_x64-setup.exe)
  msi_files=("$bundle"/msi/*_"${version}"_x64_*.msi)
  shopt -u nullglob
  [[ ${#nsis_files[@]} -gt 0 ]] || { echo "Installateur NSIS $version introuvable dans $bundle/nsis" >&2; exit 1; }
  [[ -f "${nsis_files[0]}.sig" ]] || { echo "Signature de mise à jour absente (${nsis_files[0]}.sig)" >&2; exit 1; }

  rm -rf "$OUT" && mkdir -p "$OUT"
  cp "${nsis_files[0]}" "$OUT/$exe"
  cp "${nsis_files[0]}.sig" "$OUT/$exe.sig"
  cp "$OUT/$exe" "$OUT/allez-robert-setup.exe"
  if [[ ${#msi_files[@]} -gt 0 ]]; then
    cp "${msi_files[0]}" "$OUT/$msi"
    cp "$OUT/$msi" "$OUT/allez-robert.msi"
  else
    echo "  (pas de MSI produit : seul l'installateur .exe est publié)"
  fi

  # Ressources du jeu rangées par empreinte (un fichier n'est jamais réécrit : les anciennes versions
  # de l'application retrouvent toujours les leurs), version.json pour le site, latest.json pour les mises à jour.
  node - "$OUT" "$version" "$exe" "$msi" "$DOMAIN" "${NOTES:-}" <<'EOF'
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const [out, version, exe, msi, domain, notes] = process.argv.slice(2);
const manifest = JSON.parse(fs.readFileSync('apps/client/dist/media-manifest.json', 'utf8'));
fs.mkdirSync(path.join(out, 'media'), { recursive: true });
for (const f of manifest.files) {
  // nom = empreinte + extension d'origine : Caddy en déduit le type (JSON compressé, vidéos telles quelles)
  const dest = path.join(out, 'media', f.h + path.extname(f.p).toLowerCase());
  if (!fs.existsSync(dest)) fs.copyFileSync(path.join('apps/client/dist-media', f.p), dest);
}
console.log(`→ ${out}/media : ${manifest.files.length} ressources, ${(manifest.bytes / 1e6).toFixed(0)} Mo (version ${manifest.version})`);
const info = (f) => {
  const p = path.join(out, f);
  if (!fs.existsSync(p)) return undefined;
  const buf = fs.readFileSync(p);
  return { file: f, bytes: buf.length, sha256: crypto.createHash('sha256').update(buf).digest('hex') };
};
const data = { version, date: new Date().toISOString().slice(0, 10), exe: info(exe), msi: info(msi), mediaBytes: manifest.bytes };
fs.writeFileSync(path.join(out, 'version.json'), JSON.stringify(data, null, 2) + '\n');
console.log(`→ ${out}/version.json`, JSON.stringify(data));
const latest = {
  version,
  notes: notes || `Allez Robert ! ${version}`,
  pub_date: new Date().toISOString(),
  platforms: { 'windows-x86_64': { signature: fs.readFileSync(path.join(out, `${exe}.sig`), 'utf8').trim(), url: `https://${domain}/telechargement/${exe}` } },
};
fs.writeFileSync(path.join(out, 'latest.json'), JSON.stringify(latest, null, 2) + '\n');
console.log(`→ ${out}/latest.json`);
EOF
  ls -lh "$OUT"
fi

if [[ "$mode" == "--upload" || "$mode" == "--upload-only" ]]; then
  [[ -n "${VPS:-}" ]] || { echo "VPS non défini (ex. VPS=debian@1.2.3.4)" >&2; exit 1; }
  [[ -f "$OUT/$exe" && -f "$OUT/latest.json" ]] || { echo "$OUT/$exe ou latest.json absent : lancer d'abord le build" >&2; exit 1; }
  echo "→ Envoi sur $VPS:$REMOTE_DIR"
  ssh "$VPS" "mkdir -p '$REMOTE_DIR/media'"
  # Ressources d'abord, seulement celles que le serveur n'a pas encore (rangées par empreinte).
  missing=$(mktemp)
  ssh "$VPS" "ls '$REMOTE_DIR/media'" | sort > "$missing.remote"
  (cd "$OUT/media" && ls) | sort | comm -23 - "$missing.remote" > "$missing"
  if [[ -s "$missing" ]]; then
    echo "  $(wc -l < "$missing") ressources à envoyer"
    tar -C "$OUT/media" -cf - -T "$missing" | ssh "$VPS" "tar -C '$REMOTE_DIR/media' -xf -"
  else
    echo "  ressources déjà sur le serveur"
  fi
  rm -f "$missing" "$missing.remote"
  # Fichiers versionnés, puis les alias « dernière version », version.json et enfin latest.json : ni le site
  # ni les applications installées n'annoncent une version dont les fichiers ne sont pas encore arrivés.
  versioned=("$OUT/$exe" "$OUT/$exe.sig")
  [[ -f "$OUT/$msi" ]] && versioned+=("$OUT/$msi")
  scp "${versioned[@]}" "$VPS:$REMOTE_DIR/"
  latest=("$OUT/allez-robert-setup.exe")
  [[ -f "$OUT/allez-robert.msi" ]] && latest+=("$OUT/allez-robert.msi")
  scp "${latest[@]}" "$VPS:$REMOTE_DIR/"
  scp "$OUT/version.json" "$VPS:$REMOTE_DIR/"
  scp "$OUT/latest.json" "$VPS:$REMOTE_DIR/"
  # Anciennes versions : plus conservées (seule la dernière reste en ligne, avec ses alias). Les ressources de media/
  # ne sont pas touchées : les applications déjà installées y retrouvent les leurs.
  ssh "$VPS" "cd '$REMOTE_DIR' && for f in allez-robert_*_x64-setup.exe allez-robert_*_x64-setup.exe.sig allez-robert_*_x64_fr-FR.msi; do case \"\$f\" in allez-robert_${version}_*) ;; *) rm -f -- \"\$f\" ;; esac; done"
  echo "→ En ligne : https://$DOMAIN/telechargement/allez-robert-setup.exe (mise à jour proposée aux applications installées)"
fi
