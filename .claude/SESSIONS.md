# Registre des sessions en cours

Toutes les sessions Claude travaillent dans le même dossier, sur `main`, sans worktree.
Ce fichier dit qui touche quoi. **Le relire avant de modifier un fichier, le mettre à jour quand son chantier change.**

Format d'une entrée :

```
## <titre de la session> (<nom pour SendMessage>)
- Chantier : <une ligne>
- Fichiers ou dossiers réservés : <chemins>
- État : en cours | en attente de validation | commité (<sha>) | terminé
- Mis à jour : <AAAA-MM-JJ HH:MM>
```

Quand le chantier est commité ou abandonné, supprimer l'entrée (ou passer l'état à « terminé »).

---

## Communication entre sessions (Communication entre sessions)
- Chantier : coordination des sessions, ce registre et CLAUDE.md
- Fichiers ou dossiers réservés : `.claude/SESSIONS.md`, `CLAUDE.md`
- État : en cours
- Mis à jour : 2026-11-12

## BeamNG.Earth projet intégration (BeamNG.Earth projet intégration)
- Chantier : altitude des ponts (bouts de ponts au niveau du tablier)
- Fichiers ou dossiers réservés : aucun en cours (simulation en lecture seule des zones `idf-*`). Fichiers commités (5a070067, 5155b4a7, e36fc2db, d84d131d) : `tools/terrain/src/bridge-decks.ts`, `simulate-bridge-decks.ts`, `probe-bridge-z.ts`, `roads3d.ts`, `build-open.ts`, `tools/terrain/test/bridge-decks.test.ts`, données billom, montmartre, chevreuse et roubaix dans `apps/client/public/worlds/` (sauf `chevreuse/collisions/`)
- État : billom, montmartre, chevreuse, roubaix en production (serveur 58c6d9e0). Correction activée par défaut dans build-open (d84d131d, non poussé) : tout build:world relève désormais les ponts. Préviendra avant de relancer un build dans `worlds/`.
- Mis à jour : 2026-11-12

## Paysan manquant sur tracteur (Paysan manquant sur tracteur)
- Chantier : occupants des véhicules du trafic (conducteurs, paysan des tracteurs)
- Fichiers ou dossiers réservés : aucun en cours. Fichiers commités (0e682945, 24a06c65) : `apps/client/src/world/vehicleDriver.ts`, `lowPolyVehicles.ts`, `traffic.ts`, `apps/client/src/vehicle-test.ts`, `apps/client/vehicle-test.html`, `tools/blender/crowd/pose_driver.py`, `apps/client/public/models/drivers/`, deux lignes de `ASSETS_LICENSES.md`
- État : terminé, poussé (58c6d9e0). Serveur de prévisualisation arrêté.
- Mis à jour : 2026-11-12

## Attente confirmation pour continuer (Attente confirmation pour continuer)
- Chantier : COLL-MURS (collisions bâtiments, vélo maintenu sur la chaussée réelle)
- Fichiers ou dossiers réservés :
  - nouveaux : `packages/physics/src/building-collision.ts`, `building-obstacles.ts`, `collision-manifest.ts`, `packages/physics/test/building-collision.test.ts`, `apps/client/src/net/collision-follow.ts`, `collision-version.ts`, `apps/server/src/ride/collision-authority.ts`, `ride-transport.ts`, `apps/server/test/building-collision-replay.test.ts`, `collision-pilot-replay.test.ts`, `collision-room.test.ts`, `apps/server/test/fixtures/building-collision/`, `apps/client/public/worlds/chevreuse/collisions/`, `tools/terrain/src/build-collision-obstacles.ts`
  - sections seulement : `apps/client/src/game/ride.ts` (décalage latéral, sharedRoadCorridor, pilote), `game/peloton.ts` (bornes latérales IA), `world/cyclists.ts` (bornes latérales), `world/network.ts` (filtre des voies dans addTile), `apps/server/src/ride/simulation.ts` (corridor, clearSpawn, étape latérale 5), `.claude/launch.json` (config « collision-pilote »)
  - hérités d'une session Codex : `packages/physics/src/index.ts`, `packages/shared/src/net.ts`, `apps/client/src/main.ts` (sections pilote), `game/multiplayer.ts`, `net/RideNetClient.ts`, `apps/server/src/ride/RideRoom.ts`, `config.ts`, `context.ts`, `ride/services.ts`, `ASSETS_LICENSES.md` (provenance des emprises)
- État : en attente de validation, rien de commité. Serveur Vite sur le port 5218.
- Mis à jour : 2026-11-12

## Reprise sans continuation (Reprise sans continuation)
- Chantier : Roubaix 54, fil V1 (adaptation vélo-cycliste), V1e-13 = intégration étape 1 (asset 54 sans logo, contrat, chargeur isolé, banc), autorisée par l'utilisateur le 2026-11-12
- Fichiers ou dossiers réservés (tous NOUVEAUX, aucun fichier existant modifié) : `apps/client/public/models/bikes/roubaix54/`, `packages/shared/src/roubaix54Metric.ts`, `packages/shared/test/roubaix54Metric.test.ts`, `apps/client/src/rider/roubaix54.ts`, `apps/client/test/roubaix54.test.ts`, `apps/client/roubaix-test.html`, `apps/client/src/roubaix-test.ts` ; une seule ligne ajoutée dans `ASSETS_LICENSES.md` (les lignes non commitées des autres restent intactes). Lit sans modifier `bikeMetric.ts`, `gltfAvatar.ts`, `models/bikes/*.glb`.
- État : en cours, rien de commité. Aucun build dans `worlds/`, aucune mesure GPU.
- Mis à jour : 2026-11-12

## Bâtiments du Roussel, ZONES-BAT (Reprendre ce point)
- Chantier : corrections visuelles des toits par ID de bâtiment (contrats v1 à v3, volumes, découpage LiDAR, corrections manuelles par zone)
- Fichiers ou dossiers réservés : aucun en cours. Fichiers commités (84f1eac7, 443eaced, cd405dd1, 84c00b89 poussés ; 197f3ed2, 12f72959 non poussés) : `tools/terrain/src/building-visual.ts`, `world-tiles.ts`, `tools/terrain/building-visual/`, `tools/terrain/test/building-visual-manual.test.ts`, `docs/ZONES_BAT_VISUEL.md`, `packages/shared/src/building-visual.ts`, `tools/terrain/src/building-volumes.ts`, `enrich.ts` (volumes mesurés), `packs.ts` (version des compléments), `apps/client/src/world/buildingVisual.ts`, `gableRoof.ts`, `volumesRoof.ts`, sections ZONES-BAT de `buildings.ts`, `tileDecode.ts`, `fileWorld.ts`, `types.ts`, leurs tests. Dans `tools/terrain/test/building-visual.test.ts`, le contrôle COLL-MURS non commité appartient à COLL-MURS.
- Option : `TERRAIN_BUILDING_VOLUMES=1` (désactivée par défaut). Les corrections manuelles de `tools/terrain/building-visual/<zone>.json` s'appliquent à chaque construction. Aucun build dans `worlds/` sans prévenir.
- État : commité (12f72959), non poussé. Réduction du coût en triangles validée par l'utilisateur dans `tools/terrain/src/building-volumes.ts` (réservé), non commitée.
- Mis à jour : 2026-11-12

## Modifications sans session ouverte (ne pas toucher sans l'accord de l'utilisateur)
Relevé du 2026-11-12. Elles viennent de sessions fermées ; aucune session ouverte ne les revendique.
- Matériel et home-trainers : `packages/devices/**`, `packages/protocols/src/ant/profiles.ts`, `optional/shimano-dfly.ts`, `apps/desktop/src-tauri/src/ant.rs`, `ble.rs`, `apps/client/src/game/devices.ts`, `hardware.ts`, `ui/hardware-panel.ts`, `ui/homeTrainers.ts`, `docs/HARDWARE_TEST.md`
- Coureurs et vélos (migration E1/E2, Tripo) : `packages/shared/src/bikeGeometry.ts`, `bikeMetric.ts`, `bikeReference.ts` et leurs tests, `packages/shared/src/index.ts`, `apps/client/src/rider/**`, `ui/atelier.ts`, `avatar-test.ts`, `models/bikes/mtb*.glb`, `models/avatar/tripo*/`, `tools/blender/avatars/**`, `build_cyclist.py`, `build_vtt.py`, tests `gltfAvatarSize`, `assetContract`, `lookCompat`
- Public (spectateurs) : `models/crowd/**`, `world/crowd.ts`, `crowdRealistic.ts`, `crowd-test.ts`, `tools/blender/crowd/` (sauf `pose_driver.py`)
- Rue et rendu : `world/roadCorners.ts`, `streetProps.ts`, `roadDecals.ts`, `roadSurface.ts`, `sidewalks.ts`, `streetLamps.ts`, `buildings.ts`, `tileDecode.ts`, `world.ts`, `engine/quality.ts`, `game/chaseFraming.ts`, leurs tests, `tools/terrain/test/building-visual.test.ts`, `tools/blender/textures/to-ktx2.mjs`
- Divers : `apps/client/src/ui/menu.ts`, `apps/server/src/server.ts`, `.agents/`, `ASSETS_LICENSES.md` (lignes non commitées)

## Public animé et au sol (Public animé)
- Chantier : spectateurs du bord de route animés et reposés sur le sol (demande de l'utilisateur du 2026-11-12)
- Fichiers ou dossiers réservés : aucun en cours. Commités (909efb59, e31ca1ec, non poussés) : `apps/client/src/world/crowd.ts`, `crowdRealistic.ts`, `crowdLowPoly.ts`. Les modèles de `models/crowd/` (nouveaux personnages, `index.json`) ne sont toujours pas commités.
- État : commité (e31ca1ec), non poussé
- Mis à jour : 2026-11-12

## Foule d'arrivée (Public animé)
- Chantier : foule d'arrivée en course (zone de 250 m, rangs, barrières avec publicités vélo inventées), demande de l'utilisateur du 2026-11-12
- Fichiers ou dossiers réservés : aucun en cours. Commité (246e123c, non poussé) : `apps/client/src/world/crowd.ts`, `apps/client/src/crowd-test.ts`, une ligne de `apps/client/src/main.ts` (`new Crowd(`, option `finish`). Les autres changements non commités de `main.ts` (bornes des IA, `sharedRoadCorridor`) ne sont pas à cette session et restent en place.
- État : commité (246e123c, f18e9baf), non poussé. Aucun fichier réservé. Serveur du banc d'essai sur le port 5214.
- Mis à jour : 2026-11-12

## Essai voiture Tripo (Essai voiture Tripo)
- Chantier : remplacer la Porsche du trafic. Tripo abandonné (pas assez propre) ; préparation de la 930 Turbo de Lexyc16 (Sketchfab, CC BY), vue sur un banc avant tout remplacement (demande de l'utilisateur du 2026-11-13)
- Fichiers ou dossiers réservés (tous NOUVEAUX, aucun fichier existant modifié) : `apps/client/public/models/vehicles-essai/`, `apps/client/tripo-car-test.html`, `apps/client/src/tripo-car-test.ts`, `tools/blender/vehicles/porsche_911_930_turbo_1975.zip` (déposé par l'utilisateur). Lit sans modifier `models/vehicles/porsche-911.glb` et `world/traffic.ts`.
- État : en pause (930 prête sur le banc, remplacement non autorisé à ce jour), rien de commité, `traffic.ts` non touché. Aucun build dans `worlds/`, aucune mesure GPU. Serveur Vite « client » sur le port 5173.
- Mis à jour : 2026-11-13

## Vélo hors route (Largeurs des parcours)
- Chantier : largeurs de route des parcours (`roadWidths`, `roadWidthM`) recalées sur le graphe dessiné ; le vélo sortait de la chaussée (demande de l'utilisateur du 2026-11-13)
- Fichiers ou dossiers réservés : `apps/client/public/worlds/*/routes/*.json` (champs `roadWidths` et `roadWidthM` seulement), sauf `idf-boulogne-billancourt` (modifié par une autre session, non touché)
- État : appliqué sur 305 parcours, en attente de validation, rien de commité. Non traités : `idf-boulogne-billancourt` et `sancy/routes/gravel-sancy.json`. Aucun build, aucune mesure GPU.
- Mis à jour : 2026-11-13

## Points d'attention
- `main` a au moins 24 commits d'avance sur l'origine, venant de plusieurs chantiers : un `git push` les publie tous.
- `pose_driver.py` (commité) lit `tools/blender/crowd/characters.json`, qui n'est pas commité et appartient à la session du public (spectateurs).
- `ASSETS_LICENSES.md` contient encore des modifications non commitées d'une autre session.
- `apps/client/public/worlds/chevreuse/collisions/` : chantier COLL-MURS, non commité.
- **Fichiers partagés entre chantiers non commités** : `ride.ts`, `peloton.ts`, `simulation.ts`, `network.ts` et `main.ts` contiennent des sections COLL-MURS et des modifications d'autres sessions (propriétaire non identifié). Ne commiter ces fichiers qu'avec `git add -p`, section par section.
