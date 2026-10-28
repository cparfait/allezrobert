# Construire l'application Windows sans les zones

L'exe ne contient **aucune tuile de zone** : il embarque le jeu, le catalogue des zones
(`worlds/index.json`), la description et les parcours de chaque zone (≈ 145 Mo pour toutes), les
modèles, la musique et les vidéos du menu. Les tuiles (relief, photos, bâtiments, de 12 à 450 Mo
par zone) se téléchargent depuis le menu du jeu, sur
`https://allezrobert.cparfait.ovh/worlds/<zone>/tiles/`, puis restent sur le PC (cache WebView2).

Côté code :

- `apps/client/vite.config.ts`, plugin `ar-exclude-world-tiles` : supprime `dist/worlds/*/tiles`
  après chaque build, sauf si `AR_BUNDLE_TILES=1` (exe hors ligne, à ne **pas** utiliser ici) ;
- `apps/client/vite.config.ts`, plugin `ar-installer-diet` (`scripts/installerDiet.ts`) : retire de `dist/` les photos de pose de développement (`__pose/`, ≈ 30 Mo, partout) et, avec `AR_DESKTOP=1` (posé par `deploy/publish-desktop.sh`), les boucles vidéo VP9 du menu (`.webm`, ≈ 125 Mo) : H.264 joue dans WebView2, l'AV1 sert de secours ;
- `apps/client/src/world/packs.ts` : dans l'application Windows, les tuiles viennent de
  `VITE_WORLDS_URL`, sinon de `https://allezrobert.cparfait.ovh` ;
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
- Taille : les vidéos du menu (`apps/client/public/menu/loop-*`, ≈ 245 Mo en .mp4 + .webm) sont
  embarquées si elles sont présentes au moment du build. Sans elles, le menu affiche les images
  fixes des saisons et l'installateur est bien plus léger.

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
