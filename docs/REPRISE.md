# Reprise du travail en local

Point d'étape pour reprendre le projet sur ton PC (ou dans une nouvelle session Claude Code).
Mis à jour à chaque fusion sur la branche de travail.

## Branche et récupération

- Branche de travail : `claude/optimistic-einstein-hqh9c5` (la branche `main` n'a que le
  « commit initial »).
- Sous Windows (invite de commandes), dans `C:\tmp\__DEV__\allezrobert` :

```bat
git fetch origin
git checkout claude/optimistic-einstein-hqh9c5
git pull
pnpm install
pnpm dev
```

- Si `git checkout` refuse à cause d'un fichier local (cas déjà vu :
  `apps\client\public\menu\loop-autumn.webm`) : déplace-le
  (`move apps\client\public\menu\loop-autumn.webm %TEMP%\`), refais le checkout, puis remets-le.
- Port 5173 occupé : `netstat -ano | findstr :5173` puis `taskkill /PID <numéro> /F`.
- Serveur multijoueur (amis, groupe, course) : copier `apps\server\.env.example` en
  `apps\server\.env`, puis `pnpm dev:server`.
- Monde : les tuiles se génèrent avec `pnpm --filter @allezrobert/terrain build:world`
  (≈ 150 Mo, 3–4 min, réseau nécessaire).

> **Liste complète de ce qu'il reste à faire : `docs/A_FAIRE.md`.**

## Ce qui est fait (poussé)

| Chantier | État | Où regarder |
| --- | --- | --- |
| Vélos : 101 modèles, livrées d'après photos, inscriptions des cadres et des jantes, position et casque chrono | fait | `packages/shared/src/bikes.json`, `apps/client/src/rider/bikes.ts`, `rimDecal.ts`, `wordmarks.ts` |
| Amis : code ami, présence, « Rejoindre », invitations, classements entre amis | fait (fantôme d'un ami : décrit, pas codé) | `apps/server/src/http/friends-routes.ts`, `apps/client/src/ui/friends.ts` |
| Avatars (étapes 2 à 5) : base MPFB CC0, 42 curseurs, 51 expressions, peau, 3 niveaux de détail, 8 profils, éditeur au garage, ressemblance photo sur l'appareil | fait | `docs/AVATARS.md` (§ 13 : avancement détaillé) |

Captures de contrôle : `docs/screenshots/avatars-*.jpg`, `bikes-*.jpg`.

## Chantiers parallèles (arrêtés le 22/10 ; monde et jeu fusionnés en l'état, à vérifier)

| Chantier | Contenu | État |
| --- | --- | --- |
| Matériel | audit et compléments : KICKR CORE (FTMS), Assioma (CPS), TICKR (HRS), vitesses virtuelles (Di2, Click, Play, Ride, HID, manette), HEADWIND asservi, ANT+ USB, Direct Connect, power match ERG, calibration, reconnexion ; `docs/HARDWARE_TEST.md` (tests à faire avec le vrai matériel) | **fusionné** — fait en simulation (calibration guidée, ventilateur asservi, manette et HID, adaptateurs Click / Di2 / HEADWIND activables, HUD « muet / reconnexion », réglages avancés dans l'onglet Capteurs) ; à valider avec le vrai matériel |
| Son | ambiances (lieu, heure, saison, météo), roulement selon le revêtement, roue libre, souffle selon l'effort, public ; volumes par catégorie (Réglages et pause) | **fusionné** — synthèse sans fichier, niveaux mesurés au banc (`apps/client/scripts/audio-bench.mjs`), à écouter |
| Monde et beauté | végétation au vent, villages, toits, eau, poussière sur les chemins, trains, détection automatique d'anomalies du monde, `docs/ART_DIRECTION.md` (points à valider par toi) | en cours |
| Jeu | modes groupe et course complets, demi-tour des équipiers IA, pancartes de la foule, vidéo résumé MP4 sur le serveur, repli Discord pour la voix | en cours |

Le tableau est mis à jour à chaque fusion ; l'historique des commits (`git log --oneline`)
donne le détail.

## Ce qui demande une action de ta part

- **Matériel réel** : rien n'a pu être testé avec de vrais appareils (environnement sans
  Bluetooth ni USB). Suivre `docs/HARDWARE_TEST.md` (checklist pas à pas, journaux à copier).
  L'app Windows (`apps/desktop`, Rust) doit être recompilée sous Windows : elle ne compile pas
  dans l'environnement cloud.
- **Après un `git pull`** : si le client affiche une erreur du type « … is not a function »,
  vider le cache de Vite (`rmdir /s /q apps\client\node_modules\.vite`) puis relancer `pnpm dev`.
- **Performances** : mesurer les fps sur ta carte graphique :
  `http://localhost:5173/avatar-test.html?bench&quality=high` (puis `low`, `medium`, `ultra`) ;
  le résultat s'affiche en haut de la page (comparer avec `&avatar=classic`).
- **Son** : écouter une sortie et le banc `apps/client/audio-bench.html` (32 situations) ; tout est synthétisé, le réalisme reste à juger à l'oreille.
- **Direction artistique** : valider `docs/ART_DIRECTION.md` (section « Points à valider »).
- **Comptes et services** : identifiants OAuth Google / Discord / Strava, LiveKit, lien Discord
  de repli, ffmpeg sur le VPS (voir `docs/DEPLOY.md`).

## Outils de vérification

- Banc d'essai des avatars et vélos : `apps/client/avatar-test.html`, paramètres décrits en tête
  de `apps/client/src/avatar-test.ts` (`?bikes=…`, `&rider`, `&view=3q|face|portrait|back|wheel|cockpit`,
  `&sliders`, `&expr`, `&effort`, `&skin`, `&lod`, `&profiles`, `&random`, `&calib`, `&bench`).
- Jeu sans menu : `/?autostart&nointro` ; ancien coureur : `?avatar=classic` ; qualité : `&quality=low|medium|high|ultra`.
- Avatars (Blender en ligne de commande) :
  `blender -b -P tools/blender/avatars/build_avatar.py -- --mpfb <add-on-mpfb-v2.0.18.zip>`
  (régénère `apps/client/public/models/avatar/`) ; vélos : `tools/blender/build_cyclist.py`
  (`--only bikes` pour les vélos seuls).
- Ressemblance photo, ré-étalonnage : `avatar-test.html?calib&raw` puis
  `python3 tools/blender/avatars/likeness_calib.py <repères.json>`.
- Contrôles : `pnpm typecheck`, `pnpm lint`, `pnpm test` (369 tests au dernier passage).

## Reprendre avec Claude Code

Ouvrir le dépôt sur la branche ci-dessus et donner ce fichier comme point de départ :
« Lis docs/REPRISE.md et docs/ROADMAP.md, puis continue ». Conventions : documentation,
commentaires et messages de commit en français ; aucune ressource sans licence compatible
(tracée dans `ASSETS_LICENSES.md`) ; ne rien déclarer fini sans vérification visuelle.
