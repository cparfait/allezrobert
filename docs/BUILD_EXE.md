# Construire l'application Windows sans les zones

L'exe ne contient **que le code du jeu** (≈ 40 Mo avant compression), le catalogue des zones
(`worlds/index.json`), les polices et les images de l'écran de chargement. Le reste vit dans le
**dossier de données** de l'application (`%LOCALAPPDATA%\fr.cparfait.allezrobert\donnees` par
défaut, déplaçable dans Réglages › Zones et cartes) :

| Sous-dossier | Contenu | D'où il vient |
| --- | --- | --- |
| `media/` | ressources du jeu : vidéos du menu, modèles, musique, voix, textures, description et parcours des zones (≈ 390 Mo) | téléchargées au premier lancement, puis **seulement les fichiers changés** à chaque version (`/telechargement/media/<empreinte>.<ext>`) |
| `worlds/<zone>/` | tuiles (relief, photos, bâtiments, de 12 à 450 Mo par zone) et graphe routier | téléchargées depuis le menu du jeu (`/worlds/<zone>/tiles/`) |
| `profil/` | sauvegarde des réglages et de la progression (restaurée si WebView2 perd ses données) | le jeu |

Le Rust télécharge (16 fichiers à la fois, tailles et empreintes SHA-256 vérifiées, reprise après
coupure, mise à jour par différence) et sert ces fichiers au jeu : `worlds://` pour les zones,
le fournisseur de fichiers de l'exe (`assets.rs`) pour les ressources. Les mises à jour de
l'application sont **signées** et proposées dans le jeu (§ 9).

Côté code :

- `apps/client/vite.config.ts`, plugin `ar-exclude-world-tiles` : supprime `dist/worlds/*/tiles`
  après chaque build, sauf si `AR_BUNDLE_TILES=1` (exe hors ligne, à ne **pas** utiliser ici) ;
- `apps/client/vite.config.ts`, plugin `ar-installer-diet` (`scripts/installerDiet.ts`) : retire de `dist/` les photos de pose de développement (`__pose/`, ≈ 30 Mo, partout) et, avec `AR_DESKTOP=1` (posé par `deploy/publish-desktop.sh`), les boucles vidéo VP9 du menu (`.webm`, ≈ 125 Mo : H.264 joue dans WebView2, l'AV1 sert de secours), les graphes routiers `worlds/<zone>/graph.json` (≈ 330 Mo pour 45 zones : ils viennent avec le pack de la zone) et les cartes de sources ; il **sort les ressources lourdes** (`MEDIA_DIRS`) vers `apps/client/dist-media/` et écrit `dist/media-manifest.json` (chemin, taille, empreinte de chaque fichier), embarqué. Sans `AR_DESKTOP=1`, tout reste dans l'exe (l'application fonctionne aussi, sans rien télécharger au lancement) ;
- `apps/client/src/world/packs.ts` et `apps/desktop/src-tauri/src/packs.rs` : dans l'application Windows, les tuiles viennent de
  `VITE_WORLDS_URL`, sinon de `https://allezrobert.cparfait.ovh`, et vont dans `worlds/` ;
- `apps/client/src/platform/desktopBoot.ts` : au lancement, ressources du jeu mises à la version de l'exe ;
- `apps/client/src/game/multiplayer.ts` : le serveur de jeu est `VITE_SERVER_URL`. **Obligatoire
  pour l'exe** : sans cette variable, l'application chercherait le serveur sur sa propre adresse
  (`http://tauri.localhost/colyseus`).

## 1. Prérequis (PC Windows, une seule fois)

Détails dans [apps/desktop/README.md](../apps/desktop/README.md) :

- Microsoft C++ Build Tools (« Développement Desktop en C++ » + SDK Windows) ;
- Rust stable (`rustup default stable-x86_64-pc-windows-msvc`) ;
- Node.js ≥ 22, pnpm 10, puis `pnpm install` à la racine du dépôt ;
- Git Bash (pour le script) et OpenSSH (`ssh`, `scp`, fournis avec Windows 10/11).

Le premier build Rust prend 10 à 20 minutes ; les suivants, 2 à 5 minutes.

## 2. Monter le numéro de version

Le nom des fichiers publiés vient de la version de `apps/desktop/src-tauri/tauri.conf.json`
(`"version": "0.1.0"`). L'augmenter à chaque publication, et garder la même valeur dans
`apps/desktop/src-tauri/Cargo.toml` et `apps/desktop/package.json`. Une version déjà publiée
n'est jamais écrasée : le site et `/telechargement/` gardent l'historique.

## 3. Construire

Depuis la racine du dépôt, dans Git Bash :

```bash
bash deploy/publish-desktop.sh
```

Le script :

1. définit `VITE_SERVER_URL=https://allezrobert.cparfait.ovh/colyseus` et
   `VITE_WORLDS_URL=https://allezrobert.cparfait.ovh`, retire `AR_BUNDLE_TILES` et pose `AR_DESKTOP=1` ;
2. lance `pnpm --filter @allezrobert/desktop build` (build du client, puis Tauri : NSIS + MSI) ;
3. **s'arrête si une tuile est restée** dans `apps/client/dist/worlds` ;
4. range les installateurs dans `out/release/` sous des noms sans espaces :

| Fichier | Rôle |
| --- | --- |
| `allez-robert_<version>_x64-setup.exe` | installateur NSIS de cette version (par utilisateur, sans droits admin) |
| `allez-robert_<version>_x64_fr-FR.msi` | MSI de cette version (déploiement sur plusieurs postes) |
| `allez-robert-setup.exe`, `allez-robert.msi` | copies « dernière version », pour les liens fixes |
| `version.json` | version, date, taille et SHA-256, lus par le site |

Autre domaine ou serveur de test : `DOMAIN=test.exemple.fr bash deploy/publish-desktop.sh`.

### Sans le script

```bash
export VITE_SERVER_URL=https://allezrobert.cparfait.ovh/colyseus
export VITE_WORLDS_URL=https://allezrobert.cparfait.ovh
unset AR_BUNDLE_TILES
export AR_DESKTOP=1
pnpm --filter @allezrobert/desktop build
```

Installateurs produits : `apps/desktop/src-tauri/target/release/bundle/nsis/Allez Robert !_<version>_x64-setup.exe`
et `…/bundle/msi/Allez Robert !_<version>_x64_fr-FR.msi`. Les renommer (sans espace ni `!`)
avant de les mettre en ligne.

## 4. Publier sur le VPS

```bash
VPS=allezrobert bash deploy/publish-desktop.sh --upload        # build + envoi
VPS=allezrobert bash deploy/publish-desktop.sh --upload-only   # renvoie out/release/ tel quel
```

`allezrobert` est un raccourci de `~/.ssh/config` (SSH écoute sur le port 22222) :

```
Host allezrobert
  HostName 51.255.34.26
  Port 22222
  User debian
  IdentityFile ~/.ssh/id_ed25519_openssh
```


Les fichiers vont dans `/home/debian/docker/allezrobert/deploy/data/downloads/` (variable `REMOTE_DIR`).
Ordre d'envoi : fichiers versionnés, puis les copies « dernière version », puis `version.json` :
le site n'annonce jamais une version dont le fichier n'est pas encore arrivé. Rien à redémarrer.

Envoi à la main, sans le script :

```bash
scp out/release/allez-robert_* allezrobert:/home/debian/docker/allezrobert/deploy/data/downloads/
scp out/release/allez-robert-setup.exe out/release/allez-robert.msi out/release/version.json allezrobert:/home/debian/docker/allezrobert/deploy/data/downloads/
```

## 5. Liens de téléchargement

| Lien | Contenu |
| --- | --- |
| https://allezrobert.cparfait.ovh/telechargement/allez-robert-setup.exe | dernière version, installateur .exe (lien à partager) |
| https://allezrobert.cparfait.ovh/telechargement/allez-robert.msi | dernière version, MSI |
| https://allezrobert.cparfait.ovh/telechargement/allez-robert_0.1.0_x64-setup.exe | une version précise |
| https://allezrobert.cparfait.ovh/telechargement/ | liste de toutes les versions |
| https://allezrobert.cparfait.ovh/telechargement/version.json | informations de la dernière version |

Les boutons du site (`deploy/site/index.html`) pointent sur `allez-robert-setup.exe`, puis
sont remplacés par le fichier versionné dès que `version.json` est lu (version, date, taille et
SHA-256 affichés).

## 6. Vérifier l'exe

- Le script refuse de publier s'il reste des tuiles. Contrôle manuel :
  `find apps/client/dist/worlds -name tiles` ne doit rien afficher.
- Installer l'exe sur un PC, ouvrir le menu des zones : chaque zone propose son
  téléchargement ; une fois téléchargée, elle s'ouvre même hors ligne.
- Il refuse aussi si les ressources ne sont pas sorties de l'exe (`dist/media-manifest.json` et
  `apps/client/dist-media/` absents) ou si la signature de mise à jour manque.
- Taille : l'installateur ne contient plus les vidéos, modèles ni musique (ressources du jeu, § 9) ;
  les vidéos du menu (`apps/client/public/menu/loop-*`) partent dans les ressources si elles sont
  présentes au moment du build. Sans elles, le menu affiche les images fixes des saisons.
- Premier lancement : l'écran de chargement télécharge les ressources du jeu (≈ 390 Mo), une fois.

## 7. SmartScreen et signature

L'exe n'est pas signé : au premier lancement, Windows affiche « Windows a protégé votre
ordinateur » → *Informations complémentaires* → *Exécuter quand même* (expliqué sur le site).
Pour supprimer cet avertissement, il faut un certificat de signature de code (par exemple
Azure Trusted Signing) déclaré dans `bundle.windows` de `tauri.conf.json`.

## 8. Limite connue : connexion au compte dans l'exe

L'application tourne sur l'origine `http://tauri.localhost` et appelle l'API sur
`https://allezrobert.cparfait.ovh`. Les cookies de session sont en `SameSite=Lax` : le
navigateur WebView2 ne les envoie pas dans ces appels d'une origine à l'autre, et la connexion
Google / Discord redirige la fenêtre vers le site au lieu de revenir dans l'application. Les
sorties solo et le téléchargement des zones fonctionnent. Le compte et les sorties à plusieurs
depuis l'exe demandent une évolution côté serveur (jeton porté par l'application au lieu du
cookie) : à prévoir avant de diffuser l'exe pour le multijoueur.

## 9. Mises à jour de l'application et ressources du jeu

**Mises à jour signées** (`tauri-plugin-updater`). Au lancement, l'application lit
`https://allezrobert.cparfait.ovh/telechargement/latest.json` ; si la version est plus récente,
un bandeau propose « Installer et redémarrer » : l'installateur est téléchargé, sa signature
vérifiée avec la clé publique de `tauri.conf.json` (`plugins.updater.pubkey`), puis installé sans
question (`installMode: passive`).

- **Clé privée** : `~/.tauri/allezrobert-updater.key` (sans mot de passe), jamais dans le dépôt.
  `deploy/publish-desktop.sh` la lit (ou `TAURI_SIGNING_PRIVATE_KEY`). **À sauvegarder** : sans
  elle, les applications déjà installées n'accepteront plus aucune mise à jour (il faudrait
  réinstaller à la main une version portant une nouvelle clé publique).
- Nouvelle clé (seulement si elle est perdue) :
  `pnpm --filter @allezrobert/desktop exec tauri signer generate --ci -p "" -w ~/.tauri/allezrobert-updater.key`,
  puis recopier le contenu du `.pub` dans `plugins.updater.pubkey`.
- Publier une mise à jour = monter la version (§ 2), puis `VPS=allezrobert bash deploy/publish-desktop.sh --upload`.
  `NOTES="…"` donne le texte affiché. `latest.json` part en dernier.

**Ressources du jeu** : `publish-desktop.sh` les range dans `out/release/media/<empreinte>.<ext>`
et n'envoie que celles que le serveur n'a pas encore (`tar` sur `ssh`). Elles ne sont jamais
réécrites ni supprimées : une ancienne version de l'application retrouve toujours les siennes.
Au lancement, l'application compare le manifeste embarqué aux fichiers du disque et ne télécharge
que la différence (barre « Téléchargement des ressources du jeu » sur l'écran de chargement).
Hors ligne, elle démarre avec les ressources déjà présentes.

**Zones** : `tools/terrain` écrit une empreinte par fichier (`h`) dans `tiles/pack.json`
(`pnpm --filter @allezrobert/terrain packs` pour régénérer les manifestes). Avec elle,
l'application vérifie chaque fichier reçu et une mise à jour de zone ne retélécharge que les
fichiers modifiés ; sans elle (anciens manifestes), la zone est retéléchargée en entier.
