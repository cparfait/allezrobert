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
- Fichiers ou dossiers réservés : aucun en cours. Fichiers commités (5a070067, 5155b4a7, e36fc2db) : `tools/terrain/src/bridge-decks.ts`, `simulate-bridge-decks.ts`, `probe-bridge-z.ts`, `roads3d.ts`, `build-open.ts`, `tools/terrain/test/bridge-decks.test.ts`, données billom, montmartre, chevreuse et roubaix dans `apps/client/public/worlds/` (sauf `chevreuse/collisions/`)
- État : commité, non poussé ; push et déploiement des tuiles en attente de décision. Préviendra avant de relancer un build dans `worlds/`.
- Mis à jour : 2026-11-12

## Paysan manquant sur tracteur (Paysan manquant sur tracteur)
- Chantier : occupants des véhicules du trafic (conducteurs, paysan des tracteurs)
- Fichiers ou dossiers réservés : aucun en cours. Fichiers commités (0e682945, 24a06c65) : `apps/client/src/world/vehicleDriver.ts`, `lowPolyVehicles.ts`, `traffic.ts`, `apps/client/src/vehicle-test.ts`, `apps/client/vehicle-test.html`, `tools/blender/crowd/pose_driver.py`, `apps/client/public/models/drivers/`, deux lignes de `ASSETS_LICENSES.md`
- État : commité, non poussé. Serveur de prévisualisation « lowpoly » (port 5192) lancé.
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
- Chantier : Roubaix 54, fil V1 (adaptation vélo-cycliste), V1e-11
- Fichiers ou dossiers réservés : aucun dans le dépôt (tout est écrit hors dépôt, dans `C:\Users\chris\.codex\visualizations\…\roubaix54_v1e*`). Lit sans modifier `apps/client/public/models/bikes/*.glb`, `models/avatar/**/rider.glb`, `packages/shared/src/bikeMetric.ts`, `apps/client/src/rider/gltfAvatar.ts`.
- État : rapport en rédaction, puis en attente de validation.
- Mis à jour : 2026-11-12

## Modifications sans session ouverte (ne pas toucher sans l'accord de l'utilisateur)
Relevé du 2026-11-12. Elles viennent de sessions fermées ; aucune session ouverte ne les revendique.
- Matériel et home-trainers : `packages/devices/**`, `packages/protocols/src/ant/profiles.ts`, `optional/shimano-dfly.ts`, `apps/desktop/src-tauri/src/ant.rs`, `ble.rs`, `apps/client/src/game/devices.ts`, `hardware.ts`, `ui/hardware-panel.ts`, `ui/homeTrainers.ts`, `docs/HARDWARE_TEST.md`
- Coureurs et vélos (migration E1/E2, Tripo) : `packages/shared/src/bikeGeometry.ts`, `bikeMetric.ts`, `bikeReference.ts` et leurs tests, `packages/shared/src/index.ts`, `apps/client/src/rider/**`, `ui/atelier.ts`, `avatar-test.ts`, `models/bikes/mtb*.glb`, `models/avatar/tripo*/`, `tools/blender/avatars/**`, `build_cyclist.py`, `build_vtt.py`, tests `gltfAvatarSize`, `assetContract`, `lookCompat`
- Public (spectateurs) : `models/crowd/**`, `world/crowd.ts`, `crowdRealistic.ts`, `crowd-test.ts`, `tools/blender/crowd/` (sauf `pose_driver.py`)
- Rue et rendu : `world/roadCorners.ts`, `streetProps.ts`, `roadDecals.ts`, `roadSurface.ts`, `sidewalks.ts`, `streetLamps.ts`, `buildings.ts`, `tileDecode.ts`, `world.ts`, `engine/quality.ts`, `game/chaseFraming.ts`, leurs tests, `tools/terrain/test/building-visual.test.ts`, `tools/blender/textures/to-ktx2.mjs`
- Divers : `apps/client/src/ui/menu.ts`, `apps/server/src/server.ts`, `.agents/`, `ASSETS_LICENSES.md` (lignes non commitées)

## Points d'attention
- `main` a au moins 24 commits d'avance sur l'origine, venant de plusieurs chantiers : un `git push` les publie tous.
- `pose_driver.py` (commité) lit `tools/blender/crowd/characters.json`, qui n'est pas commité et appartient à la session du public (spectateurs).
- `ASSETS_LICENSES.md` contient encore des modifications non commitées d'une autre session.
- `apps/client/public/worlds/chevreuse/collisions/` : chantier COLL-MURS, non commité.
- **Fichiers partagés entre chantiers non commités** : `ride.ts`, `peloton.ts`, `simulation.ts`, `network.ts` et `main.ts` contiennent des sections COLL-MURS et des modifications d'autres sessions (propriétaire non identifié). Ne commiter ces fichiers qu'avec `git add -p`, section par section.
