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
- État : en attente de validation (essai sur Billom en V3 fait, non commité)
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
- État : terminé : commité (a30ec2e8, 3996d134) et actif par défaut en production depuis le 13/11 (fe81edf0). Reste l'essai sur le Neo. Fichiers libérés (relevé du 15/11).
- Mis à jour : 2026-11-15

## Bâtiments du Roussel, ZONES-BAT (Reprendre ce point)
- Chantier : corrections visuelles des toits par ID de bâtiment (contrats v1 à v3, volumes, découpage LiDAR, corrections manuelles par zone)
- Fichiers ou dossiers réservés : aucun en cours. Fichiers commités (84f1eac7, 443eaced, cd405dd1, 84c00b89 poussés ; 197f3ed2, 12f72959 non poussés) : `tools/terrain/src/building-visual.ts`, `world-tiles.ts`, `tools/terrain/building-visual/`, `tools/terrain/test/building-visual-manual.test.ts`, `docs/ZONES_BAT_VISUEL.md`, `packages/shared/src/building-visual.ts`, `tools/terrain/src/building-volumes.ts`, `enrich.ts` (volumes mesurés), `packs.ts` (version des compléments), `apps/client/src/world/buildingVisual.ts`, `gableRoof.ts`, `volumesRoof.ts`, sections ZONES-BAT de `buildings.ts`, `tileDecode.ts`, `fileWorld.ts`, `types.ts`, leurs tests. Dans `tools/terrain/test/building-visual.test.ts`, le contrôle COLL-MURS non commité appartient à COLL-MURS.
- Option : `TERRAIN_BUILDING_VOLUMES=1` (désactivée par défaut). Les corrections manuelles de `tools/terrain/building-visual/<zone>.json` s'appliquent à chaque construction. Aucun build dans `worlds/` sans prévenir.
- État : commité (12f72959), non poussé. Réduction du coût en triangles validée par l'utilisateur dans `tools/terrain/src/building-volumes.ts` (réservé), non commitée.
- Mis à jour : 2026-11-12

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

## Voitures, public et optimisation CPU en Bêta (Essai voiture Tripo)
- Chantier : terminé le 2026-11-19. Voitures Tripo puis Porsche 930 abandonnées ; public par tronçons (f4b2b291) ; scène immobile et cascades (f8b073bf) ; ombres des coureurs et rail (f74510c4) ; correctifs relevés par la session de test (87c93444). Rien de poussé. Medium 30,5 → 38,3 images/s (Bêta, Boulogne, 8 coureurs).
- Fichiers ou dossiers réservés : aucun. Banc de mesure gardé hors Git dans `out/cpu-opt/` (bench.mts, port 5291, accès Bêta ouvert en local ; prototypes d'atlas abandonnés dans `atlas-proto/`). Banc d'essai voiture supprimé (`tripo-car-test.*`, `models/vehicles-essai/`) : commité (a4b34690), non poussé.
- État : terminé. Aucun serveur lancé.
- Mis à jour : 2026-11-19

## Vélo hors route (Largeurs des parcours)
- Chantier : largeurs de route des parcours (`roadWidths`, `roadWidthM`) recalées sur le graphe dessiné ; le vélo sortait de la chaussée (demande de l'utilisateur du 2026-11-13)
- Fichiers ou dossiers réservés : `apps/client/public/worlds/*/routes/*.json` (champs `roadWidths` et `roadWidthM` seulement), sauf `idf-boulogne-billancourt` (modifié par une autre session, non touché)
- État : terminé : commité (09bce12d, bbff9001 pour Boulogne, f79671da pour le gravel du Sancy). Fichiers libérés (relevé du 15/11).
- Mis à jour : 2026-11-15

## Complément Limagne ZONES-BAT (Reprise des chantiers en pause)
- Chantier : reconstruire Limagne avec `TERRAIN_BUILDING_VOLUMES=1` (49, 54 et volumes mesurés) pour publier tuiles et complément d'une même construction (demande de l'utilisateur du 2026-11-13)
- Fichiers ou dossiers réservés : construction dans `D:\zzCACHE_ALLEZROBERT\zones-travail\limagne-zonesbat\limagne` (`TERRAIN_OUT_DIR`), puis seulement `apps/client/public/worlds/limagne/tiles/` (non versionné). `graph.json`, `world.json`, `routes/` de Limagne ne sont pas touchés sans accord. Aucun envoi au serveur sans accord.
- État : toits corrigés actifs par défaut commités le 15/11 (7d0176f7) sur accord de l'utilisateur ; catalogue à jour (faa9b045). Reste : redéploiement de l'image web. Fichiers libérés.
- Mis à jour : 2026-11-15

## Coudes du cycliste trop bas (Coudes du cycliste)
- Chantier : hauteur du vélo en monde ouvert (Limagne) : roues posées sur la chaussée du réseau ; ensuite, à la demande de l'utilisateur (15/11) : demi-tours en roulant, virages à 90° trop brusques, public qui ne regarde pas le coureur, taches sur les vêtements du public
- Fichiers ou dossiers réservés : aucun
- État : terminé, tout commité, non poussé : compteur 1a6607c0, hauteur du vélo fe8f8673, demi-tour 0b583bf0, virages ff0b7158, public d742fa3d, tous les véhicules sur la chaussée fd09875c. Aucun fichier réservé. Serveur de banc arrêté.
- Mis à jour : 2026-11-15

## Arbres sans amas bosselés (Reprise des chantiers en pause)
- Chantier : étape A des arbres LiDAR retirée par défaut (`treesteps` passe de `abcd` à `bcd`), demande de l'utilisateur du 2026-11-13
- Fichiers ou dossiers réservés : `apps/client/src/world/vegetation.ts` (ligne de `TREES_PARAMS` seulement)
- État : commité (f25e1088), non poussé. Plus aucun fichier réservé.
- Mis à jour : 2026-11-13

## Bas-côtés et arbres (Photoréalisme paysages P2)
- Chantier : P2.2c (bas-côté de 0,6 m des routes en terre et gravillons, shader des routes), puis défauts d'arbres restants et remesure, demande de l'utilisateur du 2026-11-14. P2.3c (sol sous canopée) commité ad2b5a98 et poussé.
- Fichiers ou dossiers réservés : aucun. IA et cyclistes en V3, freinage pour tous, compteurs harmonisés (a6c38ab3, poussé). Dé de la tenue et emplacements 3×2 du garage V3 (4971aff6, poussé, fichiers v3/garage.ts et garage.css du chantier Garage V3, sur demande de l’utilisateur). Caméra plus proche (a3cf1cbc), freinage avant les virages serrés, cadence simulée, panneau à 50 m, bandeau KOM en bas, compteurs au centre et toits variés (6a9e2ef2) commités et poussés le 16/11.
- État : P2 (bas-côtés, houppiers, raccords du réseau, champs, vrais arbres EZ-Tree) commité et poussé ; vrais arbres actifs par défaut avec fondus (23a7a12f, poussé le 16/11 ; `?eztree=0` pour couper). Aucun fichier réservé. Panneau de virage aux carrefours et bords proches sans scintillement commités (a514acd4, poussé le 16/11 avec 7e429bc4 et e4c762d1 du garage V3). Serveur `bord-de-route` (5210) encore ouvert.
- Mis à jour : 2026-11-15

## Registre des personnages du public (Registre public)
- Chantier : compléter `ASSETS_LICENSES.md` pour les 9 personnages Tripo du public (demande de l'utilisateur du 2026-11-13)
- Fichiers ou dossiers réservés : aucun. Commité : deux lignes de `ASSETS_LICENSES.md`
- État : commité (8efc29b8), non poussé
- Mis à jour : 2026-11-13

## Matériaux du Roubaix, M3 (P1 matériaux Roubaix)
- Chantier : support « carbone » de la livrée (`substrate: 'carbon'`, encre après le carbone, sergé filtré, uniforme `frameOffset`), demande et accord de l'utilisateur du 2026-11-14 (y compris pour `livery.ts`, classé dans `rider/**`)
- Fichiers ou dossiers réservés : aucun (libérés). Commités : `apps/client/src/rider/livery.ts`, `packages/shared/src/bikes.ts`, `packages/shared/src/tuning.ts`, `packages/shared/test/tuning.test.ts`
- État : validé et commité (29081890, 14/11/2026), non poussé ; chantier M3 terminé
- Mis à jour : 2026-11-14

## Matériaux du Roubaix, M4 (P1 matériaux Roubaix)
- Chantier : emplacement d'inscription « ss » (haubans) et graphiques de cadre (`graphics`, filets), demande et accord de l'utilisateur du 2026-11-14 (y compris pour `wordmarks.ts`, classé dans `rider/**`)
- Fichiers ou dossiers réservés : aucun (libérés). Commités : `apps/client/src/rider/wordmarks.ts`, `apps/client/test/wordmarks.test.ts`, `packages/shared/src/bikes.ts`, `packages/shared/src/tuning.ts`, `packages/shared/test/tuning.test.ts`
- État : validé et commité (7eec0c64, 14/11/2026), non poussé ; chantier M4 terminé
- Mis à jour : 2026-11-14

## Roubaix 44 (fil T2c, vélo 44)
- Chantier : Roubaix dédié par taille. 44 fini (c7922ac3, ed013921, 761f7b60, 1a34291c, ca43ff72, 43e493cc, non poussés). En cours (14/11) : Roubaix 54 pour les coureurs adultes, d'une traite à la demande de l'utilisateur (asset hors dépôt puis intégration dans le même dossier `roubaix/`, choix de la taille selon le coureur).
- Fichiers ou dossiers réservés : `apps/client/public/models/bikes/roubaix/`, `packages/shared/src/roubaixMetric.ts`, `apps/client/src/rider/roubaix.ts` et leurs tests, `apps/client/roubaix-test.html`, `apps/client/src/roubaix-test.ts`, une ligne de `ASSETS_LICENSES.md`. Lit sans modifier `rider/bikes.ts` (réservé par « Coudes du cycliste »), `livery.ts`, `wordmarks.ts`, `gltfAvatar.ts`, `ui/atelier.ts`. N'utilise pas les noms réservés par « Reprise sans continuation » (`models/bikes/roubaix54/`, `roubaix54Metric.ts`, `rider/roubaix54.ts`).
- État : Roubaix 54 commité (aeba9120), Roubaix 61 commité (79713d12, 15/11), correctifs cassette / dérailleur / couleurs commités (71e56d00), non poussés : 44 jusqu'à 160 cm, 54 jusqu'à 183, 61 au-delà. Fichiers libérés. Serveur de banc sur le port 5188 (config « film-accueil », le 5173 est pris par un autre processus). Aucun build dans `worlds/`, aucune mesure GPU.
- Mis à jour : 2026-11-15

## Petits coureurs sur vélos dédiés (fil T2c, vélo 44)
- Chantier : coureurs dès 142 cm à leur taille sur les vélos dédiés (Roubaix, LOOK), demande de l'utilisateur du 15/11 ; puis étape E4 (proportions).
- Fichiers ou dossiers réservés : `apps/client/src/rider/gltfAvatar.ts` (constante `DEDICATED_MIN_CM`, `sizeOf`, en-tête des vélos dédiés ; pas les bras, réservés à « Coudes du cycliste (reprise) »).
- État : appliqué, non commité, en attente de l'accord de l'utilisateur. Tests et typecheck OK.
- Mis à jour : 2026-11-15

## LOOK 785 dédié (fil T2c, vélo 44)
- Chantier : LOOK 785 Huez RS dédié par taille (XS, M, L, XL), cadre procédural Blender tracé sur la photo libre n° 13, mécanique reprise du Roubaix ; d'une traite à la demande de l'utilisateur (15/11) : asset, intégration (même chargeur que le Roubaix), tests, commit local.
- Fichiers ou dossiers réservés : `apps/client/public/models/bikes/look785/` (nouveau), `packages/shared/src/look785Metric.ts` et `packages/shared/test/look785Metric.test.ts` (nouveaux), `packages/shared/src/roubaixMetric.ts`, `apps/client/src/rider/roubaix.ts`, `apps/client/test/roubaix.test.ts`, `apps/client/src/roubaix-test.ts`, une ligne de `gltfAvatar.ts` et de `ui/atelier.ts` (choix de taille par modèle), une ligne de `ASSETS_LICENSES.md`. Ne touche pas `rider/bikes.ts` (« Coudes du cycliste »).
- État : commité (9301e71d, puis XL 3a43908f, non poussés) ; fichiers libérés. Chaîne de construction hors dépôt (scratchpad look785_2). Aucun build dans `worlds/`, aucune mesure GPU.
- Mis à jour : 2026-11-15

## Écran de choix des séances, P1 (Analyse REA Zwift)
- Chantier : Studio des séances : filtre de durée, recherche, tri, intensité avant départ, « Où rouler ? » en mode séance (inspiré de Zwift).
- Fichiers ou dossiers réservés : aucun en cours. Commité (56908640, non poussé) : `apps/client/src/ui/workoutStudio.ts`, `workoutStudio.css`, `menu.ts`, `settings.ts`, `apps/client/src/game/workout.ts`, deux lignes de `main.ts`, `apps/client/test/workoutStudio.test.ts`.
- État : commité (56908640), fichiers libérés. Suite possible : P2 (affichage de la séance en sortie). Serveur de prévisualisation « client » (port 5173) lancé par cette session. Aucun build dans `worlds/`, aucune mesure GPU.
- Mis à jour : 2026-11-15

## Test FTP amélioré, P-FTP (Analyse REA Zwift)
- Chantier : test FTP : fin automatique de la rampe (15 s sous la cible), rampe douce, test 20 min complet, estimation en direct, écran de résultat à valider.
- Fichiers ou dossiers réservés : aucun en cours. Commité (9547444f, non poussé) : `packages/physics/src/workout/model.ts`, `apps/client/src/game/workout.ts`, sections de `main.ts`, `menu.ts`, `settings.ts`, `hud/hud.ts`, `apps/client/src/ui/ftpResult.ts`, `packages/physics/test/ftpTests.test.ts`, `apps/client/test/ftpTest.test.ts`.
- État : commité (9547444f), fichiers libérés. Test complet en roulant (simulateur ou Neo) pas encore fait. Aucun build dans `worlds/`, aucune mesure GPU.
- Mis à jour : 2026-11-15

## Graphique des protocoles du test FTP (Analyse REA Zwift)
- Chantier : profil du protocole choisi (rampe, rampe douce, 20 min) dessiné dans l'encart du test FTP du menu, fin probable selon la FTP.
- Fichiers ou dossiers réservés : aucun en cours. Commité (5be21bfb, non poussé) : `apps/client/src/ui/ftpTestChart.ts`, `apps/client/test/ftpTestChart.test.ts`, deux lignes de `ui/menu.ts` (import et appel dans `ftpTestHtml`).
- État : commité (5be21bfb), fichiers libérés.
- Mis à jour : 2026-11-15

## Boîtier du Roubaix corrigé (Analyse REA Zwift)
- Chantier : coque du boîtier de pédalier refaite (cylindre Ø 46 mm, cuvettes) sur les Roubaix 44, 54 et 61, LOD 0 à 2 ; correctif appliqué aux GLB par `D:\zzCACHE_ALLEZROBERT\roubaix-boitier\scripts\boitier.py`, hors chaîne d'origine.
- Fichiers ou dossiers réservés : `apps/client/public/models/bikes/roubaix/roubaix{44,54,61}_lod{0,1,2}.glb` ; une mention dans la ligne Roubaix de `ASSETS_LICENSES.md` (le reste du fichier appartient à d'autres sessions, non touché).
- État : appliqué et vérifié dans le banc (livrée, 3 tailles), tests verts (689), en attente de validation, rien de commité. Aucun build dans `worlds/`, aucune mesure GPU.
- Mis à jour : 2026-11-15

## Voix du coach pendant le test FTP (Voix test FTP)
- Chantier : coach vocal du test FTP et bilan de fin consacré à la FTP (écran et voix), demandes de l'utilisateur du 15/11.
- Fichiers ou dossiers réservés : aucun (libérés). Commités (b0b0fba2, f47be845, ce40c591, non poussés) : `ui/ftpTestReport.ts`, `ui/summary.ts` (variante test FTP), `game/ftpCoach.ts`, `audio/coachVoice.ts`, `audio/coachLines.ts`, `scripts/bake-coach-voice.ts`, `public/voice/coach/`, `game/workout.ts` (getters), sections de `main.ts`, `ui/menu.ts`, `ui/settings.ts`, tests.
- État : commité (ce40c591), non poussé. Reste : ligne de provenance dans `ASSETS_LICENSES.md`, rampe complète en roulant. Démo sur le port 5191 (config « client-madone »).
- Mis à jour : 2026-11-15

## Points d'attention
- Boulogne (18/11) : piliers isolés le long des routes = minuscules « bâtiments » BD TOPO (piliers de portail) extrudés par `world/buildings.ts` ; filtrer les très petites emprises (quelques m²). À faire par la session qui tient `buildings.ts` (signalé par l'étude de rendu, non corrigé).
- `main` a au moins 24 commits d'avance sur l'origine, venant de plusieurs chantiers : un `git push` les publie tous.
- `pose_driver.py` (commité) lit `tools/blender/crowd/characters.json`, qui n'est pas commité et appartient à la session du public (spectateurs).
- `ASSETS_LICENSES.md` contient encore des modifications non commitées d'une autre session.
- `apps/client/public/worlds/chevreuse/collisions/` : chantier COLL-MURS, non commité.
- **Fichiers partagés entre chantiers non commités** : `ride.ts`, `peloton.ts`, `simulation.ts`, `network.ts` et `main.ts` contiennent des sections COLL-MURS et des modifications d'autres sessions (propriétaire non identifié). Ne commiter ces fichiers qu'avec `git add -p`, section par section.

## Morceau « Roue libre » (Ajout musique Roue libre)
- Chantier : ajouter le morceau Suno `Unknown-Untitled.m4a` (Téléchargements) à la playlist sous le titre « Roue libre » (demande de l'utilisateur du 2026-11-15)
- Fichiers ou dossiers réservés : aucun (libérés). Commités (4ca4fa25) : `apps/client/public/music/roue-libre.mp3`, une ligne de `audio/music.ts`, la ligne « Musiques » de `ASSETS_LICENSES.md` (la ligne Tour Eiffel non commitée n'est pas à cette session et reste en place)
- État : terminé, commité (4ca4fa25), non poussé.
- Mis à jour : 2026-11-15

## Trottoirs et lampadaires en poly, LP-T1 (Écarts poly / réel)
- Chantier : couche « rue » (trottoirs, bordures, lampadaires, mobilier des boutiques) aussi dans le style low poly, demande et accord de l'utilisateur du 2026-11-15
- Fichiers ou dossiers réservés : aucun (libéré). Commité : `apps/client/src/world/network.ts`
- État : validé et commité (36d9e5f0, non poussé). Suites possibles : potelets et passages piétons, lumières des lampadaires la nuit, regard des spectateurs en poly. Serveur « lowpoly » sur le port 5192.
- Mis à jour : 2026-11-15

## Serveur de jeu pour l'utilisateur (test FTP)
- Chantier : serveur de dev pour jouer, cartes absentes du disque lues sur le serveur en ligne (VITE_WORLDS_URL), demande de l'utilisateur du 2026-11-15
- Fichiers ou dossiers réservés : `.claude/launch.json` (config « jeu-cartes-en-ligne » seulement)
- État : en cours. Serveur « jeu-cartes-en-ligne » sur le port 5175. Aucun build dans `worlds/`, aucune mesure GPU.
- Mis à jour : 2026-11-15

## Relevé des chantiers (relevé du 15/11)
- Chantier : ligne de provenance de la voix du coach du test FTP (Cartesia), demande de l'utilisateur du 2026-11-15 ; redéploiement de l'application sur le serveur fait (36d9e5f0, Limagne comprise)
- Fichiers ou dossiers réservés : aucun (libérés). Commité : deux lignes « Voix du coach » de `ASSETS_LICENSES.md` ; les autres changements non commités du fichier ne sont pas à cette session et restent en place
- État : terminé, commité (10f03725), non poussé. Redéploiement vérifié (santé OK, catalogue Limagne 685b5be82e23 en ligne).
- Mis à jour : 2026-11-15

## Garage V3 (reprise du chantier Codex « Style V3 local »)
- Chantier : garage V3 sur le modèle du menu Réel, vélos V3 exposés, vignettes photographiées sur le coureur V3 (articles sans icône Zwift), classement des accessoires par marque ; reprise demandée par l'utilisateur le 16/11.
- Fichiers ou dossiers réservés : `apps/client/src/v3/`, `apps/client/scripts/v3Assets.ts`, `tools/v3_assets.py`, `out/v3/`, `D:/zzCACHE_ALLEZROBERT/zwift-etude/v3/` (vélos réassemblés), sections V3 de `apps/client/src/ui/atelier.ts`, `ui/menu.ts` et une ligne de `main.ts`, config « garage-v3 » de `.claude/launch.json` (port 5226).
- État : commité (5009021e, abb80605, 2c9e004f, a66e2f93, acdb6ddd, 592fa3e0, 5fbf2dec et suivant, non poussés) : maillots seuls, chaussettes en couleur et hauteur, familles de maillots repliées, têtes (visage, cou, pièce 3) et coiffures sous couvre-chef corrigées, banc 5226 sur les cartes en ligne (VITE_WORLDS_URL), doublons Zwift retirés, clips décodés de l’étude (couché, handbike, version 24), postures par type de vélo, corps mince et fort, planches et couleurs des cheveux et de la barbe, coiffures intégrées, filtre par silhouette. Aucun build dans `worlds/`, aucune mesure GPU. Postures V3 en sortie, home trainer du garage V3 et infobulles commités (73e0c63c, non poussé). Coloris sous le vélo, balancement au garage, home trainer replié et menus sur l'équipement porté commités (cc6e9265, non poussé). Charnière du balancement sur home trainer et oscillation de danseuse/sprint transférée au vélo commitées (voir git log, non poussées). Roues Zwift et menus repliés avec l'équipement en tête commités (voir git log, non poussés). Photos des roues et dés complets commités (voir git log, non poussés). Profils, réglages du vélo, effet sur la route, listes déroulantes et lissage des conversions commités (voir git log, non poussés). Vélos de l'étude reconstruits lissés (ancienne version : D:/zzCACHE_ALLEZROBERT/zwift-etude/v3/velos_facettes_2026-11-16), casques par défaut lissés dans v3/perso.
- Coloris lisibles, garage replié, accordéons et Mensurations commités (voir git log, non poussés ; seules les lignes du correctif Mensurations de menu.ts).
- FTP et corps selon l'IMC commités (voir git log). En cours : vidéos du menu en style V3 — fichiers réservés en plus : apps/client/src/ui/cinematic.ts, tools/menu-loop/src/capture.ts, apps/client/src/v3/cinematicRiders.ts ; film V3 tourné (4 saisons dans out/v3/menu, AV1 de l'hiver manquant), capture terminée ; serveur 5226 relancé à neuf ; favicon du jeu : tête de Robert sur fond jaune (commité, non poussé). Ouverture du maillot, articles par silhouette et vélos du mur commités (voir git log, non poussés). Bouton Retirer, page de gestion réservée, casques seuls au dé, pas de maillot ouvert féminin et photos féminines commités et poussés (db6e2627, 16/11) ; vélos de l'étude réassemblés avec les roues corrigées (ancienne version : v3/velos_avant_roues) ; casting et page de gestion des objets V3 commités (voir git log, non poussés). Aussi touchés : apps/client/src/main.ts (3 lignes du menu V3), tools/menu-loop/README.md.
- Code du film V3 commité (8ddfb92b, non poussé) ; capture toujours en cours.
- Mis à jour : 2026-11-16 21:05

## Tenue UAE 2026 V3 (essai de tenue)
- Chantier : tenue d'essai UAE Team Emirates XRG 2026 pour le coureur V3, ajoutée au vestiaire sans toucher au code (demande de l'utilisateur du 2026-11-16)
- Fichiers ou dossiers réservés : `out/tenue-uae-2026/`, `D:/zzCACHE_ALLEZROBERT/zwift-etude/tenues-perso/`, une ligne ajoutée (i = 9001) à la fin de `D:/zzCACHE_ALLEZROBERT/zwift-etude/tenues-catalogue.json` (copie d'avant : `tenues-catalogue.avant-uae2026.json`), config « garage-v3-uae » de `.claude/launch.json` (port 5233). Ne modifie ni `apps/client/src/v3/`, ni `v3Assets.ts`, ni `tools/v3_assets.py` (réservés par « Garage V3 »).
- État : tenue visible dans le vestiaire V3 (Équipes pro, « UAE Team Emirates XRG 2026 (essai) »), vérifiée sur le banc 5233 ; commité (3437ba34, non poussé : scripts dans `tools/v3_kits/uae2026/`, config « garage-v3-uae », cette entrée ; textures et catalogue hors dépôt). Serveur « garage-v3-uae » (port 5233) arrêté. Aucun build dans `worlds/`, aucune mesure GPU.
- Mis à jour : 2026-11-16 17:40

## Public seulement en course (session lancée depuis local_71dc6a59)
- Chantier : plus de spectateurs du bord de route hors course (sortie libre, itinéraire, entraînement, défi…), demande de l'utilisateur du 2026-11-16
- Fichiers ou dossiers réservés : aucun (libérés). Commité : 3 lignes de `apps/client/src/main.ts`
- État : commité (1665d061), non poussé
- Mis à jour : 2026-11-16

## Beta : tenue par défaut et niveaux (session local_71dc6a59)
- Chantier : style Beta (ex-V3) : maillot blanc du Tour par défaut, objets (vélos, roues, tenues, accessoires) débloqués par niveau, gratuits ; reprise du dossier du garage V3 autorisée par l'utilisateur le 16/11
- Fichiers ou dossiers réservés : `apps/client/src/v3/` (visuals.ts, garage.ts, wardrobe.ts, nouveau levels.ts), `apps/client/test/v3levels.test.ts`
- État : terminé. 0.1.30 puis 0.1.31 publiées le 16/11 (origin/main 0f937200 : EXE/MSI/DMG en ligne, site, API et service V3 redéployés, session Beta d'un an gardée par l'application, CI verte). Dossier principal avancé sur 0f937200 (modifications des autres sessions conservées). Fichiers libérés.
- Mis à jour : 2026-11-16

## Étude Zwift rendu (Étude Zwift rendu)
- Chantier : étude REA + Ghidra du rendu de Zwift et MyWhoosh, puis optimisations sans perte visible, arches, liste « À proximité » et étiquettes des coureurs
- Fichiers ou dossiers réservés : `apps/client/src/world/bridgeRailings.ts` (nouveau), quelques lignes de `world/network.ts` (garde-corps des ponts) ; `apps/client/public/worlds/idf-boulogne-billancourt` remplacé localement par la reconstruction des ponts du 16/11 (ancienne copie : D:/zzCACHE_ALLEZROBERT/ponts-travail/avant-ponts/idf-boulogne-billancourt-local-13-11), et la config « bench-build-5175 » de `.claude/launch.json` (non commitée)
- État : tout commité (jusqu'à 6bae0179 et f9f758a5, 18/11), non poussé depuis 4a10034d. Boulogne : reconstruction des ponts du 16/11 installée localement (worlds/, non commitée, non déployée) et vérifiée en jeu (pont relevé) ; garde-corps des ponts (bridgeRailings.ts + test, network.ts) faits, non commités.
- Mis à jour : 2026-11-17

## Touches caméra 1–8 (comparaison des vues avec Zwift)
- Chantier : touches 1 à 8 pour choisir directement une caméra (demande de l'utilisateur du 2026-11-17)
- Fichiers ou dossiers réservés : aucun (libérés). Commités : bloc des touches 1 à 8 de `apps/client/src/main.ts` (la ligne `PlaceFinder` non commitée n'est pas à cette session), `exitHint` de `game/cameras.ts`, une ligne de `docs/GUIDE_COUREUR.md`
- État : commité (5b3afd1f), non poussé
- Mis à jour : 2026-11-17

## Progression Beta : voir la pièce au garage (session du 17/11)
- Chantier : Progression Beta « Voir au garage » (pièce essayée et pulsée sur le coureur, bouton de retour à la progression) ; garage Beta : tout le catalogue visible avec cadenas « Niveau N » et essai des objets non gagnés ; manches courtes/longues (groupes 3/40 ; pas de 40 sur le corps fort) et poches (9–12 / 55–58) ; fermeture Ouvert/Fermé dessinée (matériau à nœuds sur CyclistKIT) ; pneus sans lettrage blanc (gomme unie, visuals.ts) ; clic sur une pièce de la vue du garage Beta → sa rubrique + pulsation ; nom du lieu sous la mini-carte ronde (3 lignes de hud/hud.css, à côté d'une modification non commitée d'une autre session). Demandes de l'utilisateur des 17 et 18/11.
- Fichiers ou dossiers réservés (sections seulement) : `apps/client/src/ui/progressPage.ts`, `ui/menu.ts` (hôte de Progression, `onV3Reveal`, bouton `gr-back`), `ui/menu.css` (`.gr-back`), une ligne de `main.ts`, `ui/atelier.ts` (`revealV3`, `highlight`), `v3/garage.ts`, `v3/wardrobe.ts`, `v3/garage.css`, `v3/visuals.ts` (highlight, partAt, showZip/poches/ouverture, plainTyres), une ligne de plus dans `main.ts` (`onV3Pick`), `hud/hud.css` (3 lignes `.map-town`)
- État : commité le 18/11 sur demande de l'utilisateur (voir git log, non poussé ; sans les 3 lignes `.map-town` de hud.css, liées à une modification non commitée d'une autre session). Puis col fermé dessiné (V du maillot 3 comblé à la couleur du maillot, matériaux FLESH, visuals.ts) : vérifié sur le banc, commité (voir git log, non poussé). Captures d'étude dans `out/zip-essai/`. Aucun build dans `worlds/`, aucune mesure GPU.
- Mis à jour : 2026-11-18

## Démarrage par tranches dans le client normal

- Chantier : activer le chargement par tranches dans tous les mondes, conserver ?startflush=1 et mesurer deux départs Bêta à Boulogne. Pas de bâti précalculé, pas de commit.
- Fichiers libérés : apps/client/src/world/world.ts (import et preload uniquement), apps/client/src/world/startupDrain.ts, apps/client/test/startupDrain.test.ts.
- État : terminé, typecheck et 877 tests OK. Bêta normale à Boulogne, ancien / nouveau : blocage 25,321 s / 1,176 s, départ 56,916 s / 56,872 s, images au-delà de 100 ms 140 / 183. Mesures terminées, serveur 5268 arrêté. En attente de la validation utilisateur, aucun commit.
- Mis à jour : 2026-11-18

## Bâti précalculé : format compact (étude)
- Chantier : étude hors jeu d'un format compact pour le bâti Bêta précalculé (indexé, quantifié, meshopt) sur les 4 tuiles de Boulogne du banc de Codex. Mesure CPU Node uniquement.
- Fichiers ou dossiers réservés : aucun (libéré). Résultats dans `out/bati-compact/results.json` (hors Git).
- État : terminé. Format quantifié : 94 → 55 Mo décodés par tuile dense, 8,6 → 7,6 Mo gzip ; l'indexation ne fusionne que 12 % des sommets. Aucun commit. Étude des attributs (attrs.mts, table.mts) : attributs constants par triangle, table par tuile (≈ 33 000 lignes) → 94 → 31 Mo décodés sans perte sauf normales. Aucun code du jeu modifié.
- Mis à jour : 2026-11-18

## Limite processeur en Bêta (mesures et leviers)
- Chantier : mesure de référence Bêta en groupe à Boulogne, puis BundleGroup pour le décor immobile, passes d'ombre, coureurs lointains, logique par image. Demande de l'utilisateur du 18/11.
- Fichiers ou dossiers réservés : `out/cpu-beta/` (nouveau). Serveur de dev d'essai sur le port 5281. MESURES GPU EN COURS : éviter builds et mesures en parallèle. Regroupement BatchedMesh ABANDONNÉ (diagnostic du 19/11) : lots fixes réduits = 33,5 contre 37,8 images/s sans regroupement, 876 Mo réservés ; le ralentissement après défilement vient du jeu lui-même (tas JS 4,3 → 6,7 Go après une boucle, ramasse-miettes 49 %). Prototype dans out/cpu-beta/prototype-tilebatch-fixe. Fichiers du jeu libérés. Enquête MÉMOIRE en cours (lecture seule du jeu, serveur 5281, essais Chromium). Éclairage nocturne de Codex commité à la demande de l'utilisateur (40792c35).
- État : mesures terminées (out/cpu-beta/*.json) : référence 33,5 FPS, BundleGroup + ombres 1/3 + matrices figées = 36,5 FPS (+9 %). Recensement fait (out/cpu-beta/census.json) : 315 dessins par image, décor par tuile ≈ 108, végétation ≈ 64, coureurs ≈ 80, ombres 36. Décor par tuile en BatchedMesh commité (c1e21fd9) puis ANNULÉ (523ab372) : tampons > 256 Mo puis RangeError au défilement des tuiles ; prototype dans out/cpu-beta/prototype-tilebatch. Étiquettes commitées (c4b23a3d, non poussé). Serveur 5281 arrêté, plus de mesure en cours. +9 % NON intégrés (doublon de « Optimisation CPU en Bêta », f8b073bf/f74510c4). nameTags.ts modifié (non commité), toujours réservé.
- Mis à jour : 2026-11-18

## Vérification des commits de perf du 18/11 (session lancée depuis local_e002f6ea)
- Chantier : essai en jeu (Bêta, lecture seule) de f4b2b291, f8b073bf, f74510c4 ; rapport et captures dans `out/test-perf/`
- Fichiers ou dossiers réservés : `out/test-perf/` (nouveau). Aucun fichier du jeu modifié. Serveur Vite d'essai sur le port 5295 (accès Bêta ouvert en local). Pas de mesure d'images par seconde pendant une « MESURE EN COURS » d'une autre session.
- État : terminé. Rapport `out/test-perf/RAPPORT.md` (2 défauts : regard du public figé après un saut ; ombres des coureurs légers hors budget, corrigé par une autre session dans riderShadows.ts et vérifié en jeu). Serveur 5295 arrêté. Rien de commité.
- Mis à jour : 2026-11-18

## Couleurs des RER par ligne (session lancée depuis local_e002f6ea)
- Chantier : trains de banlieue aux couleurs officielles IDFM selon la ligne (RER A–E, Transilien), demande de l'utilisateur du 2026-11-18. Signalé, non corrigé : voie qui plonge sous les ponts routiers (railY suit le relief).
- Fichiers ou dossiers réservés : `apps/client/src/world/railways.ts` (matériau et attribut des voitures), `apps/client/src/world/railLivery.ts` et `apps/client/test/railLivery.test.ts` (nouveaux), `out/test-perf/`. Serveur d'essai 5295.
- État : terminé. Couleurs (c22ce0fd) et voie sous les ponts ferroviaires (862cb616) commitées, non poussées. Fichiers libérés. Serveurs 5295/5296 arrêtés.
- Mis à jour : 2026-11-18

## Public MPFB (session lancée depuis local_a58e3fce)
- Chantier : remplacer les spectateurs Tripo du public (style Bêta) par des spectateurs tirés des avatars MPFB, demande du 2026-11-19
- Fichiers ou dossiers réservés : config « public-mpfb » de `.claude/launch.json` (port 5297). Commités (d6e0151b, poussé) : `tools/blender/crowd/bake_mpfb_spectators.py`, `mpfb_spectators.json`, `apps/client/public/models/crowd/mpfb_*`, `index.json`, `index_tripo.json`, `apps/client/src/world/crowdRealistic.ts` (?crowd=tripo), la ligne « Spectateurs MPFB » de `ASSETS_LICENSES.md` (le reste du fichier n'est pas à cette session et reste en place).
- État : d6e0151b poussé. 404 = favicon du banc crowd-test.html (pas le public). Version allégée au loin commitée (a87c08b7, non poussée) : tools/blender/crowd/crowd_lod.mjs (meshoptimizer, poses de la VAT), index allégé ajouté aux 8 mpfb_*.bin/.json, bascule par tronçon dans crowd.ts (LOD_M 50 m, ?crowdLod=0), spectatorLodGeometry dans crowdRealistic.ts, une ligne d'usage dans bake_mpfb_spectators.py. Essais dans out/crowd-mpfb (lodcount, lodbench, measure). Serveur « public-mpfb » (5297) lancé, config ajoutée à launch.json (non commitée).
- Mis à jour : 2026-11-19 (après-midi)

## Micro sur le compagnon (demande du 2026-11-19)
- Chantier : utiliser le micro du téléphone (appli compagnon) pour le chat vocal LiveKit ; le jeu relaie un jeton vocal « téléphone »
- Fichiers ou dossiers réservés : `apps/companion/` (src/main.ts, src/phoneMic.ts nouveau, i18n.ts, style.css, package.json), `pnpm-lock.yaml` (3 lignes : livekit-client au compagnon), `packages/shared/src/companion.ts`, `apps/server/src/ride/PairRoom.ts`, route `voice-token` de `apps/server/src/http/api.ts`, `apps/server/src/integrations/livekit.ts`, `apps/client/src/game/voice.ts`, `setVoice` de `apps/client/src/hud/hud.ts`, sections voix et compagnon de `apps/client/src/main.ts` (`phoneMic`, touche V, `companion.listen`, `companion.provider`, `companion.onCommand`), lignes de test dans `apps/server/test/pair.test.ts`, `api.test.ts`, `apps/client/test/openWorld.test.ts`
- État : commité (fb37e412, non poussé). Fichiers libérés ; dans `main.ts`, les lignes `menu.onScene` et `PlaceFinder(…, source.originL93)` ne sont pas à cette session et restent non commitées.
- Mis à jour : 2026-11-19

## Ombre du coureur qui scintille (session lancée depuis local_13667506)
- Chantier : trame dans la pénombre des ombres sans TAA (Bêta, medium), demande du 2026-11-19
- Fichiers ou dossiers réservés : `apps/client/src/engine/stableShadowFilter.ts` (filtre en tente, ombre dédoublée en 4096), `apps/client/src/world/environment.ts` (direction des ombres par pas, `update`), `apps/client/src/engine/quality.ts` (shadowEvery de medium), `apps/client/src/game/riderShadows.ts` (ombres des coureurs coupées, ?ridershadows=1). Commités (non poussés) : 77550c49 (`stableShadowFilter.ts`, bloc CSM de `environment.ts`), puis carte d'ombre 4096 en medium et `?shadowmap` dans `quality.ts`. Captures dans `out/shadow-flicker/`.
- État : 77550c49 et a0814569 commités, non poussés ; en attente de validation (non commité) : filtre en tente (plus de copies en peigne) et lumière des ombres tournée par pas de 0,25° (grille qui glissait 4×/s). Ombres redessinées à chaque image en medium (+2,3 ms CPU), choix de l'utilisateur.
- Mis à jour : 2026-11-19

## Pied à terre à l'arrivée (session lancée depuis local_13667506)
- Chantier : pied à terre à l'arrivée commité (be3f3737, non poussé). En cours : coup de coude (clip Zwift existant cyclistHoodsElbowFlick) des IA en fin de relais, file simple et double file
- Fichiers ou dossiers réservés : sections « arrivée » et « coup de coude » de `apps/client/src/game/peloton.ts` (FLICK_*, `flicks`, `prevLane`, `flick`, `stepFlicks`, `gesture`, déclencheurs après `this.lanes.update` et autour de `r.ai.update`, option `...this.gesture(r)` de l'appel `r.v3?.update`). Ne touche pas aux appels riderMerge/riderLight (« perf-styles »). Banc hors Git : `out/pied-a-terre/`.
- État : coup de coude appliqué, typecheck OK, non vérifié en jeu (attend la fin des mesures de « perf-styles »), rien de commité. Dans `main.ts`, les lignes `menu.onScene` et `PlaceFinder(…, source.originL93)` ne sont pas à cette session.
- Mis à jour : 2026-11-19

## Optimisations Bêta portées en réaliste et poly (session lancée depuis local_ad20c8f5)
- Chantier : fusion, version légère et ombres allégées des coureurs réalistes et poly ; roues poly (LOD) corrigées, demande du 19/11
- Fichiers ou dossiers réservés : aucun (libérés). Commités et poussés (374478f6, 6259544d) : `game/riderDetail.ts`, `test/riderDetail.test.ts`, `game/riderLight.ts`, `rider/lowPolyRider.ts`, `world/cyclists.ts`, sections version légère / fusion de `game/peloton.ts` (le coup de coude non commité de `peloton.ts` n'est pas à cette session et reste en place). Banc hors Git : `out/perf-styles/`.
- État : terminé, poussé sur origin (d6e0151b..6259544d, avec les 5 commits locaux d'autres sessions).
- Mis à jour : 2026-11-19

## Recul de la caméra en virage, phare de nuit (Recul caméra virage)
- Chantier : la poursuite recule et monte un peu en virage ; phare de nuit plus étroit et plus bas, sol proche sans microrelief la nuit (scintillement sous le phare) — demandes de l'utilisateur du 2026-11-19
- Fichiers ou dossiers réservés : `apps/client/src/game/cameras.ts` (cas `chase`), `apps/client/src/game/headlightBeam.ts`, bloc du phare de `apps/client/src/main.ts` (`new THREE.SpotLight`, `headlight.intensity`, `world.terrain.night`), uniforme `night` et `normalNode` de `apps/client/src/world/terrain.ts`, config « recul-camera » de `.claude/launch.json` (accès Bêta ouvert via `out/recul-camera/vite.config.mts`)
- État : caméra essayée en V3 ; phare et sol non encore vérifiés en jeu (attente de la fin des mesures « perf-styles »). Rien de commité. Serveur arrêté.
- Mis à jour : 2026-11-19 20:18

## Règle de largeur des itinéraires de l'île (relevé avant publication du 19/11)
- Chantier : la vérification de l'île comparait la largeur annoncée à la voie la plus étroite, alors que le jeu borne déjà le coureur au tronçon (a30ec2e8) ; remplacée par un contrôle de couverture des tronçons de largeur
- Fichiers ou dossiers réservés : `tools/island/src/verify.ts`
- État : commité, non poussé ; test de l'île vert (5/5), types OK. Fichier libéré.
- Mis à jour : 2026-11-19

## Corrections du relevé avant publication (relevé du 19-20/11)
- Chantier : branchements Beta de `main.ts` (52111b1a) ; `?hour` respecté et colonnes du HUD sous le cockpit sur écran étroit (afade71f) ; chantier Paris commité d'un bloc (3a099122)
- Fichiers ou dossiers réservés : aucun (libérés). Config « verif-paris » ajoutée à `.claude/launch.json` (port 5310, accès Bêta ouvert, cartes en ligne ; `out/verif-paris/`)
- État : commité, non poussé
- Mis à jour : 2026-11-20

## Départ Beta : coureurs réalistes puis Beta, écran bloqué (demande du 20/11)
- Chantier : au lancement d'une sortie en Beta, coureurs affichés d'abord en réaliste ; écran de départ qui reste figé sans HUD
- Fichiers ou dossiers réservés : aucun (libérés). Commités : `apps/client/src/game/v3Crowd.ts`, 3 lignes de `apps/client/src/main.ts` (le phare non commité de `main.ts` n'est pas à cette session). Serveur « verif-paris » (5310) réutilisé.
- État : commité (b1c8f817, non poussé). Fichiers libérés. Serveur « verif-paris » (5310) ouvert.
- Mis à jour : 2026-11-20

## Envoi des zones aux ponts relevés (demande du 2026-11-21)
- Chantier : remplacer dans `worlds/` les 66 zones reconstruites (D:/zzCACHE_ALLEZROBERT/ponts-travail/idf-ponts), parcours gravel/VTT, catalogue, envoi des tuiles au serveur, commit et redéploiement
- Fichiers ou dossiers réservés : `apps/client/public/worlds/<zone>/` des 66 zones (sauf chevreuse et Boulogne), `apps/client/public/worlds/index.json`
- État : terminé, en production le 21/11 (87fcfe84, images v3-87fcfe84, .env d'avant : deploy/.env.avant-87fcfe84). Fichiers libérés.
- Mis à jour : 2026-11-21

## Corrections de l'étude d'optimisation (étude du 21/11)
- Chantier : corrections de l'étude d'optimisation du 21/11, refonte des écrans en gros blocs, zones de la reprise des ponts
- Fichiers ou dossiers réservés : aucun (libérés le 22/11). Ne touche plus `apps/client/src` (réservé par « Corrections de l'audit du 21/11 »).
- État : tout commité sur main jusqu'à b8e83b02, rien de poussé. 12 zones de la reprise installées dans `worlds/` (tuiles locales à envoyer par sync-zones avant déploiement) ; Moret-Loing-et-Orvanne et Évry-Courcouronnes refusées (défauts), Limagne laissée. En attente : format compact des itinéraires (après la fin du chantier de l'audit), mesures de performance du rendu.
- Mis à jour : 2026-11-22

## Corrections de l'audit du 21/11 (audit complet, une traite)
- Chantier : corrections de l'audit du 21/11 et suites demandées par l'utilisateur le 22/11 (pause, panneaux, sons, fantôme, bandeau du menu, capteurs), puis format compact des itinéraires (lecture seulement).
- Fichiers ou dossiers réservés : aucun (libérés).
- État : tout commité, non poussé depuis 5d5513b2 (dernier : cee12afc). Itinéraires : les lecteurs acceptent le format compact ; AUCUN fichier de `worlds/*/routes` converti (à faire par `tools/terrain/src/compact-routes.ts --write` après publication d'une version qui lit ce format ; empreintes inchangées, vérifié sur les 311 fichiers). Mesures GPU de la passation non faites. Serveur « verif-paris » (5310) ouvert.
- Mis à jour : 2026-11-22

## Mode du ventilateur sur le compagnon (demande du 2026-11-22)
- Chantier : choisir le mode du ventilateur (arrêt, fixe, vitesse, cardio, pente) depuis l'appli compagnon
- Fichiers ou dossiers réservés : `packages/shared/src/companion.ts` (commande `fanMode`, état `fanMode`), `apps/server/src/ride/PairRoom.ts` (une ligne zod), `apps/client/src/game/inputs.ts` (2 méthodes), `apps/client/src/game/devices.ts` (`setFanMode`, `fanMode`), deux gestionnaires `fan` de `apps/client/src/main.ts` et l'état `fanPercent`, `apps/companion/src/main.ts` + `i18n.ts` (+ `style.css` si besoin), `apps/server/test/pair.test.ts`
- État : terminé, commité (b3bff2c8) (typecheck et test pair OK, pas vérifié sur le téléphone). Fichiers libérés.
- Mis à jour : 2026-11-22

## Itinéraires compacts et publication 0.1.38 (suite de l'audit, 22/11)
- Chantier : 311 itinéraires au format compact (ced59fd5), version 0.1.38 (43de4372) publiée : EXE/MSI (worktree Codex) et DMG (release mac-0.1.38) en ligne, serveur et site sur les images v3-43de4372 (.env d'avant : deploy/.env.avant-43de4372 ; base : data/sauvegardes-manuelles/avant-43de4372.sql.gz ; anciens téléchargements dans downloads/.avant-0.1.38). Clés Strava ajoutées au .env du VPS (copie d'avant : .env.avant-strava), capacité Strava portée à 10 athlètes par l'utilisateur.
- Fichiers ou dossiers réservés : aucun (libérés).
- État : terminé.
- Mis à jour : 2026-11-22

## Hippodrome de Longchamp (session lancée depuis local_ad7ce48e, 22/11)
- Chantier : hippodrome de Longchamp reconnaissable depuis l'anneau (tribune, moulin, lices de la piste, poteau d'arrivée), modèle fait en code comme la tour Eiffel, sans reconstruction de la zone
- Fichiers ou dossiers réservés : aucun (libérés). Commité : `apps/client/src/world/longchampRacecourse.ts`, `apps/client/test/longchampRacecourse.test.ts`, quelques lignes de `world/buildings.ts` et `world/network.ts`, un paragraphe de `ASSETS_LICENSES.md`. Non commitée : config « longchamp-hippodrome » de `.claude/launch.json` (port 5321).
- État : terminé, commité (7afc39ba), non poussé, non déployé. Pas de chevaux (décision de l'utilisateur). `?longchamp=0` coupe l'hippodrome.
- Mis à jour : 2026-11-22

## Pieds des arches et panneaux au sol (session lancée depuis local_e944cd11, 22/11)
- Chantier : « les totems ont toujours un souci, leurs pieds ne touchent pas le sol » : arches gonflables (départ, arrivée, KOM, sprint), drapeaux et panneaux du bord de route reposés sur le sol affiché quand les tuiles se chargent
- Fichiers ou dossiers réservés : `apps/client/src/world/finishBanners.ts`, `apps/client/src/world/signs.ts`, `apps/client/src/world/groundSettle.ts` (nouveau), `apps/client/test/groundSettle.test.ts` (nouveau). `main.ts` non touché.
- État : terminé, commité (4493588b, non poussé). Fichiers libérés. Aucun build dans `worlds/`, aucune mesure GPU.
- Mis à jour : 2026-11-22

## Aspiration sous le cadran, bloc de zone (session lancée depuis local_e944cd11, 22/11)
- Chantier : HUD de sortie complet (Bêta) : aspiration intégrée sous le cadran de puissance (nouveau look), bloc « Temps par zone » du HUD poly remis ; demandes de l'utilisateur du 2026-11-22
- Fichiers ou dossiers réservés : `apps/client/src/hud/hud.ts`, `apps/client/src/hud/hud.css` (sections cadran, aspiration, zones, panneau vent/altitude/tour, puces des capteurs)
- État : terminé, commité et poussé (90cd859f, 62172c7f, 58b6ad5c). Fichiers libérés ; les deux lignes Spotify non commitées de `hud.css` ne sont pas à cette session.
- Mis à jour : 2026-11-22

## Strava dans le Profil (session lancée depuis local_e944cd11, 22/11)
- Chantier : « il faut ajouter la connexion strava ici aussi » : ligne Strava dans l'écran Profil (onglet Mon profil), même liaison que celle des Réglages
- Fichiers ou dossiers réservés : `apps/client/src/ui/stravaLink.ts`, quelques lignes de `apps/client/src/ui/menu.ts` (`profileHtml`, appel de `renderStravaLink`) et de `apps/client/src/ui/menu.css` (`.strava-row`)
- État : terminé, commité (d5bf92b3). Aucun build dans `worlds/`, aucune mesure GPU.
- Mis à jour : 2026-11-22

## Personnage en T en caméra TV (session lancée depuis local_e944cd11, 22/11)
- Chantier : « en caméra tv j'ai ça un perso en T position derrière » : cycliste lointain figé bras en croix (version légère des coureurs fabriquée avant que le coureur Bêta soit complet et en posture)
- Fichiers ou dossiers réservés : aucun (libérés). Commités : `game/riderLight.ts`, `test/riderLight.test.ts`, une ligne de `game/peloton.ts` et de `world/cyclists.ts`, quelques lignes de `v3/visuals.ts`. Captures dans `out/perso-en-t/`.
- État : terminé, commité (59f69f54), non poussé. Non essayé en course avec un peloton (même branchement). Aucun serveur lancé.
- Mis à jour : 2026-11-22

## Audit et corrections du jeu (session principale)
- Chantier : déplacer Réglages › Home trainer dans l'écran Capteurs ; danseuse et lissage vers Réglages › Sortie
- Fichiers ou dossiers réservés (sections seulement) : `apps/client/src/ui/menu.ts` (rubrique `trainer` des Réglages, onglet Capteurs), `apps/client/src/ui/hardware-panel.ts`, `apps/client/src/ui/menu.css` (styles de la partie « Réglages du home trainer »)
- État : commité (bf486ce7, poussé) ; fichiers libérés
- Mis à jour : 2026-11-22 20:45

## Bloc « Mes données » des Réglages (session lancée depuis local_e944cd11, 22/11)
- Chantier : « ce menu est laid il faut modifier » : bloc « Mes données » (Réglages › Général) redessiné en deux lignes de réglage, confirmation de suppression dessous
- Fichiers ou dossiers réservés : aucun (libérés). Commités : sections « Mes données » de `apps/client/src/ui/menu.ts` et `menu.css`
- État : terminé, commité et poussé (41b4044f), non déployé. Captures dans `out/menu-mes-donnees/`.
- Mis à jour : 2026-11-22

## Écran « Choisis ta séance » refait (session lancée depuis local_7bada94a, 22/11)
- Chantier : « cette page n'est pas très optimisée ux/ui ni très jolie » : studio des séances en trois colonnes (familles, liste, fiche), import dans l'en-tête
- Fichiers ou dossiers réservés : aucun (libérés). Commités : `apps/client/src/ui/workoutStudio.ts`, `workoutStudio.css` (853f8428) ; l'en-tête de la fenêtre et 2 chaînes de `menu.ts` sont partis dans d152e878 (commit « bureau » d'une autre session, fait depuis l'index commun).
- État : terminé, commité, non poussé. Banc hors Git dans `out/ws-studio/`. Aucun build dans `worlds/`, aucune mesure GPU.
- Mis à jour : 2026-11-22 23:45

## Bilans de fin de sortie, P1 (demande du 2026-11-22)
- Chantier : bilan de fin adapté à chaque fin, blocs Résultat / Sauvegarde / FIT et compte, envois Strava et intervals.icu réessayables au bilan et dans l'historique, FIT d'une sortie récupérée envoyé sur le compte
- Fichiers ou dossiers réservés : aucun (libérés). Commités : `ui/summary.ts`, `summary.css`, `rideRecovery.ts`, `rideRecovery.css`, `ridepanels.ts`, `rideOutcome.ts`, `rideExports.ts`, `test/rideOutcome.test.ts`, sections de `main.ts`. Non commitée : config « bilans-fin » de `.claude/launch.json` (port 5336).
- État : commité (e60fdfb7), non poussé. Non vérifié : envoi sur un compte réel et « Réessayer » Strava.
- Mis à jour : 2026-11-22

## Écran blanc au lancement et icône de l'appli PC (demande du 2026-11-22)
- Chantier : flash blanc au démarrage de l'EXE (fenêtre WebView2 blanche avant la page) ; icône de l'appli = tête de Robert sur fond jaune (comme le favicon) au lieu du vélo orange provisoire
- Fichiers ou dossiers réservés : `apps/desktop/src-tauri/tauri.conf.json`, `tauri.macos.conf.json` (couleur de fond de la fenêtre), `apps/desktop/src-tauri/icons/`, `apps/desktop/package.json` (script `icons`), `apps/desktop/scripts/make-icon.mjs` (supprimé), une ligne de `apps/desktop/README.md`
- État : commité (voir git log, non poussé, non publié) ; fichiers libérés. L'EXE installé (0.1.42) garde l'ancien comportement jusqu'à la prochaine version
- Mis à jour : 2026-11-22 23:20

## Audit : bilan sûr, KOM, records simulés, touches (demande du 2026-11-22)
- Chantier : phase 2 (bilan KOM malgré la pause, montée close au sommet, records simulés non retenus, touches relâchées à la perte de focus) ; phase 1 (enregistrement sûr du bilan) en attente, car elle touche `ui/rideRecovery.ts` et le bloc `finish` réservés par « Bilans de fin de sortie, P1 »
- Fichiers ou dossiers réservés : `apps/client/src/game/challenge.ts`, `game/inputs.ts` (KeyboardControls), `game/guest.ts`, `game/ride.ts` (`updateSegments`, nouvelle méthode `closeSegmentAtFinish`), sections de `apps/client/src/main.ts` : `ride.onSegmentDone`, `reachSummit`, `challenge.onDone`, `togglePause`, écouteur `keyup` de la touche X ; tests nouveaux `apps/client/test/challenge.test.ts`, `test/keyboardControls.test.ts`
- État : repris et terminé par « Finaliser les chantiers en cours » (25/11), non commité. Aucun build dans `worlds/`, aucune mesure GPU.
- Mis à jour : 2026-11-22

## Défi KOM : toutes les côtes de toutes les zones (session lancée depuis local_5adc9c42, 22/11)
- Chantier : le tableau du Défi KOM liste toutes les côtes chronométrées des zones publiées (index statique), pas seulement les zones déjà ouvertes ; la côte choisie n'est plus remplacée pendant le chargement de son parcours
- Fichiers ou dossiers réservés : nouveaux `apps/client/scripts/kom-index.ts`, `apps/client/src/ui/komCatalog.ts`, `apps/client/src/data/komIndex.json`, `apps/client/test/komCatalog.test.ts` ; sections de `apps/client/src/ui/menu.ts` : `komsHtml`, `komRouteLoading`, `challengeChoiceHtml`, `challengeHtml` (garde de la côte choisie), champs `komCatalog*`, import de komCatalog, chaînes `aZoneSClimbs` et `kom*` (fr/en), champ `komDone` et écouteurs `#m-kom-zone` / `#m-kom-done` de `bind` ; `apps/client/src/ui/menu.css` : lignes `.kom-filter` (puces `.kom-chip` retirées). Rien dans `worlds/` (lecture seule).
- Aussi, sur demande explicite de l'utilisateur (22/11, fichiers propres à ce moment) : clé des records KOM avec la zone dans `game/challenge.ts` (KEY, readKomRecord, writeKomRecord, setKomZone), appels de readKomRecord dans `main.ts` (3 lignes) et `ui/routeDetail.ts`, `setKomZone` à côté de `menu.worldId` / `menu.setWorld` dans `main.ts` ; nouveau test `apps/client/test/komRecordZone.test.ts`. Anciens records repris par longueur de la côte (±1 m).
- Suite (demande de l'utilisateur) : meilleurs temps de segments rangés par zone : `game/sequences.ts` (readZonedTime/writeZonedTime, readSegmentPr, `segment`), `game/challenge.ts` (`recordZone`), `main.ts` (ar.segbest dans `ride.onSegmentDone`, import), test `komRecordZone.test.ts`.
- État : terminé, commité (4847c2ef, 22d78a3d, 5d48b720), non poussé. Fichiers libérés. Aucun build dans `worlds/`, aucune mesure GPU.
- Mis à jour : 2026-11-22

## Vidéos du menu en HD (vidéos HD)
- Chantier : essai d'encodage sans plafond de débit des boucles du menu (out/menu-loop/essai-hd, rien remplacé) ; film V3 : coureuse 2 en Lazer Sphere blanc + POC foncées (visière rouge du Vanquish), lunettes rosées 1927 des coureurs 3 et 4 remplacées par les bleues 1928 , Goodr 1934 de la coureuse 6 aussi ; coiffure du 3, têtes 3/8/10 plus claires, Robert gris (teinte libre), casques de couleurs variées ; col fermé corrigé dans v3/visuals.ts (bordure du V recouverte, couleur la plus fréquente) ; tournage V3 relancé
- Fichiers ou dossiers réservés : `apps/client/src/v3/cinematicRiders.ts` (coureurs 2, 3, 4 et 6), une ligne de `tools/menu-loop/src/capture.ts` (--mute-audio), sections col fermé de `apps/client/src/v3/visuals.ts` (openableJersey, COLLAR_TRIM, COLLAR_SKIN_TOP, closableSkin, collarColor), à la demande de l'utilisateur
- État : commité et poussé (38b26df1) ; film V3 retourné le 23/11 et publié sur le VPS (deploy/data/v3-source/cache/menu, ancien film supprimé le 23/11 (validé))
- Mis à jour : 2026-11-22 23:55

## Publication 0.1.43 (session lancée depuis local_b148f315, 23/11)
- Chantier : version 0.1.43 publiée (EXE/MSI du worktree Codex, DMG mac-0.1.43, serveur et web v3-cc095f40 sur le VPS)
- Fichiers ou dossiers réservés : aucun (libérés)
- État : terminé, commité et poussé (cc095f40)
- Mis à jour : 2026-11-23

## Hauteurs des routes au bord (bords de tuile, bord de chaussée, limite LiDAR) (demande du 2026-11-23)
- Chantier : sol affiché qui ne coïncide pas aux bords de tuile, sol qui mord ou route qui flotte au bord de la chaussée, marche à la limite LiDAR HD / RGE ALTI
- Fichiers ou dossiers réservés : `clampUnderRoads`, `gridHeight` et `buildGeometry` de `apps/client/src/world/terrain.ts` (pas l'uniforme `night` ni `normalNode`), `apps/client/test/terrainRoads.test.ts`, banc hors Git `out/road-heights/`. Aucun build dans `worlds/`.
- État : bords de tuile commités (2040e04e, non poussé). Recalage RGE ALTI sur LiDAR commité (8fc21c24, non poussé) ; EN COURS : passages sous les ponts (bosse du MNT), fichiers réservés `tools/terrain/src/roads3d.ts`, `build-open.ts`, `build-world.ts` (markSidepaths), `loop.ts`, `graph.ts` (champ sidepath), `dem.ts`, `build-climb.ts` (passages sous les ponts), section ballast de `apps/client/src/world/railways.ts` (buildTrack, RAIL_DECK_GAP_M), scripts de reconstruction de toutes les zones dans `D:/zzCACHE_ALLEZROBERT/zones-travail/hauteurs-routes` (lancés par l’utilisateur, hors Claude ; worlds/ non touché), `tools/terrain/test/underpass.test.ts`, `sidepath.test.ts`, section « Corrections appliquées » de `docs/CONSTRUIRE_UNE_ZONE.md` ; recalage LiDAR désormais actif par défaut ; Angerville reconstruite à part pour essai (serveur 5305 lancé), worlds/ non touché ; autres zones sur accord ; fichiers réservés `tools/terrain/src/dem.ts`, `tools/terrain/test/dem-seam.test.ts` ; cache neuf `dem/*-seam` sur D: (ancien `hi-1m` intact) ; essai : zone reconstruite dans `D:/zzCACHE_ALLEZROBERT/zones-travail/lidar-seam`, serveur `out/lidar-seam/` (port 5305), config « lidar-seam » de `.claude/launch.json`. Aucun build dans `worlds/`.
- Mis à jour : 2026-11-23

## Flèche du panneau de virage (session lancée depuis local_6199256a, 23/11)
- Chantier : flèche du panneau « À GAUCHE / À DROITE » orientée vers le haut (↰ / ↱) même pour les virages serrés
- Fichiers ou dossiers réservés : `apps/client/src/hud/hud.ts` (section panneau de virage de `drawJunction` seulement)
- État : terminé, commité (c54a3215), non poussé. Fichier libéré.
- Mis à jour : 2026-11-23

## Perso bras croisés sur « Prêt à rouler ? » (session lancée depuis local_6199256a, 23/11)
- Chantier : coureur du joueur (tenue V3 actuelle), debout mains sur les hanches (pose Zwift CyclistStandingIdle01), à gauche des cartes de l'écran de départ
- Fichiers ou dossiers réservés : `apps/client/src/ui/startCheck.ts`, `apps/client/src/ui/startCheck.css`, `apps/client/src/ui/startRider.ts` (nouveau), quelques lignes de `beginStartCheck` dans `apps/client/src/main.ts`, config « perso-bras-croises » de `.claude/launch.json` (port 5342), banc hors Git `out/perso-bras-croises/`. Lit sans modifier `v3/` (réservé).
- État : fait, vérifié en ?style=v3 (captures `out/perso-bras-croises/avant.jpg`, `apres-mains-hanches.jpg`), en attente de l'accord de l'utilisateur, rien de commité. Serveur d'essai 5342 ouvert. Aucun build dans `worlds/`, aucune mesure GPU.
- Mis à jour : 2026-11-23 19:20
- Reprise (accord de l'utilisateur du 23/11, session « Couleur du cou col ouvert ») : photo du portrait mise en cache et prise dès la sortie du garage ; touche `startRider.ts` et une ligne de `menu.onScene` dans `main.ts`. Commité (d02415ae, non poussé) avec le portrait de la session d'origine. Puis photo aussi prise à l'ouverture du jeu (une ligne de `prepareAtelier` dans `main.ts`), vérifiée, commitée (dd84cb22, non poussée). Fichiers libérés.

## Cou du maillot ouvert V3 (Couleur du cou col ouvert)
- Chantier : teinte de peau du V du maillot ouvert (Bêta/V3), prise sur le cou au lieu de toute la planche du visage (demande de l'utilisateur du 2026-11-23)
- Fichiers ou dossiers réservés : `apps/client/src/v3/visuals.ts` (fonction `skinTone` seulement)
- État : commité (9b566648, non poussé). Fichier libéré. Serveur « garage-v3 » (5226) ouvert.
- Mis à jour : 2026-11-23

## Coureur du garage Bêta préchargé (Couleur du cou col ouvert)
- Chantier : coureur V3 du garage chargé dès le lancement (`Atelier.prepare`) au lieu de la première entrée au garage (demande de l'utilisateur du 2026-11-23)
- Fichiers ou dossiers réservés : `apps/client/src/ui/atelier.ts` (`prepare`, `setV3`, nouvelle méthode `ensureV3`)
- État : commité (e022ee8b, non poussé). Fichier libéré.
- Mis à jour : 2026-11-23

## Dé principal du garage Bêta (Couleur du cou col ouvert)
- Chantier : le dé général tire toujours un autre vélo et un autre home trainer que ceux montés (demande de l'utilisateur du 2026-11-23)
- Fichiers ou dossiers réservés : `apps/client/src/v3/garage.ts` (`randomBike`, `randomTrainer` seulement)
- État : commité (a6b5dbfa, non poussé). Fichier libéré.
- Mis à jour : 2026-11-23

## Dé de la tenue Bêta (Couleur du cou col ouvert)
- Chantier : le dé de la tenue (général et tenue) tire parmi toutes les pièces, verrouillées comprises, sans retomber sur la pièce portée (choix de l'utilisateur du 2026-11-23)
- Fichiers ou dossiers réservés : `apps/client/src/v3/garage.ts` (`randomKit` et import de `levels.ts`)
- État : commité (6d6a2913, non poussé). Fichier libéré.
- Mis à jour : 2026-11-23

## Arrivée du garage Bêta côté transmission (Couleur du cou col ouvert)
- Chantier : vue 3/4 du garage Bêta du côté transmission (mur aux affiches derrière), recul de l'arrivée borné à la pièce (demande de l'utilisateur du 2026-11-23)
- Fichiers ou dossiers réservés : une ligne de `showGarage` dans `apps/client/src/main.ts` (vue '3q' en Bêta, recul des vues Vélo, Profil et Face), l'arc d'arrivée de `apps/client/src/ui/atelier.ts`
- État : commité (ed91ec40, non poussé). Fichiers libérés.
- Mis à jour : 2026-11-23

## Publication 0.1.44 (demande du 2026-11-23 soir)
- Chantier : commit du chantier « Hauteurs des routes » (54a2f64c) puis version 0.1.44 (a794fcbf), tout poussé
- Fichiers ou dossiers réservés : aucun (version dans `apps/desktop/` commitée). VPS : web v3-a794fcbf, serveur inchangé (v3-cc095f40), EXE/MSI et DMG 0.1.44 en ligne
- État : terminé
- Mis à jour : 2026-11-23 20:55

## Portrait debout et panneau F3 (Couleur du cou col ouvert)
- Chantier : pose debout du portrait de « Prêt à rouler ? » quel que soit le vélo ; panneau F3 qui ne s'ouvre plus à chaque lancement après Maj+F3 (demandes de l'utilisateur du 2026-11-23)
- Fichiers ou dossiers réservés : `apps/client/src/v3/visuals.ts` (`clipForBike`), `apps/client/test/v3poses.test.ts`, `apps/client/src/engine/perf.ts`
- État : commité (b3286299, 4d19a710, non poussés). Fichiers libérés.
- Mis à jour : 2026-11-23

## Publication 0.1.46 (Couleur du cou col ouvert, demande du 2026-11-23 soir)
- Chantier : push (4d19a710) puis version 0.1.46 (10c4a012) : EXE/MSI du worktree Codex, DMG mac-0.1.46, image web v3 sur le VPS
- Fichiers ou dossiers réservés : aucun dans le dépôt ; worktree Codex v3-release ; VPS (downloads, image web, deploy/.env)
- État : terminé : 0.1.46 publiée (f90d6be2, poussé) ; EXE/MSI/DMG en ligne, web v3-f90d6be2, serveur v3-cc095f40 ; ménage du VPS fait (66 %)
- Mis à jour : 2026-11-23

## Fondu des coureurs proches (F1)
- Chantier : coureurs proches de la caméra ou entre la caméra et le joueur estompés en tramé (alphaHash), dans les 3 styles (demande de l'utilisateur du 2026-11-24)
- Fichiers ou dossiers réservés : nouveaux `apps/client/src/game/nearFade.ts`, `apps/client/test/nearFade.test.ts` ; une section de `apps/client/src/main.ts` (appel après `peloton.render`) ; accesseurs de lecture seule dans `game/peloton.ts`, `game/multiplayer.ts`, `world/cyclists.ts`
- État : commité et poussé (4068f727). Fichiers libérés. Serveurs client-5175 et server (2567) lancés.
- Mis à jour : 2026-11-24

## Chacun sa moitié de chaussée (session lancée depuis local_362b2745, 24/11)
- Chantier : ceux qui arrivent en face (équipiers IA après demi-tour, cyclistes d'ambiance `sens: -1`, joueurs à contresens) restent sur leur moitié avec une marge ; le joueur ne passe pas sur la moitié d'en face
- Fichiers ou dossiers réservés : `packages/physics/src/lanes.ts`, `regroup.ts` (garde des phases back/brakeBack), nouveaux `packages/physics/test/lanes.test.ts`, `apps/client/test/oncomingPlayer.test.ts`, `apps/server/test/oncoming-lanes.test.ts`, quelques lignes de `packages/physics/test/regroup.test.ts` ; sections latérales de `apps/client/src/game/ride.ts` (`oncoming`, `facing`, bornes de la direction ; pas `closeSegmentAtFinish`), `game/peloton.ts` (`approaching`, `facing`, demi-tour, `rideOn`, `RETURN_LATERAL_MS`), `world/cyclists.ts` (`latScale`, `approaching`, `facingFor`, `range` ; pas `roots()`), `apps/server/src/ride/simulation.ts` (`facing`, étape 5, `separateAi`) ; lignes `ride.oncoming` + `ride.dir` passé à `cyclists.update` + import `facingWithin` dans `main.ts`. `multiplayer.ts` non touché (on lit `remoteRiders`).
- État : terminé, commité et poussé (7cfebad0, 24/11) ; fichiers libérés. Essai en jeu du demi-tour d'une IA non fait (couvert par un test).
- Mis à jour : 2026-11-24

## Énergie des IA visible, jeu et compagnon (F1 idées NCT)
- Chantier : jauge d'énergie (W′) et état « attaque / poursuite / cramé » des IA dans « À proximité » du jeu et dans la carte Équipe du compagnon (demande de l'utilisateur du 2026-11-24)
- Fichiers ou dossiers réservés (sections seulement) : `packages/shared/src/companion.ts` (`PairRider`, helper `aiEffortTag`), `apps/client/src/hud/hud.ts` (`HudRider`, `nearbyHtml`, `nearbyCompactHtml`), `apps/client/src/hud/hud.css` (classes `.nb-en*`), `apps/client/src/main.ts` (lignes des IA dans les coureurs du HUD et du compagnon), `apps/companion/src/main.ts` (carte Équipe), `apps/companion/src/i18n.ts`, `apps/companion/src/style.css` (classes `.grp-list*`), nouveau test `packages/shared/test/aiEffort.test.ts`
- État : commité et poussé (0e8a9f75). Fichiers libérés. Serveurs client-5175, server 2567 et companion 5174 lancés.
- Mis à jour : 2026-11-24

## Traverser en fondu le coureur qu'on rattrape
- Chantier : le joueur qui rattrape un coureur le traverse (fondu) au lieu de le faire s'écarter ou d'être retenu (demande de l'utilisateur du 2026-11-24)
- Fichiers ou dossiers réservés : `packages/physics/src/collision.ts` (option `passThrough`), nouveau `packages/physics/test/passThrough.test.ts`, bloc « Collisions » de `apps/client/src/main.ts` (corps `me`), `apps/client/src/game/nearFade.ts`, `apps/client/test/nearFade.test.ts`
- État : commité et poussé (voir git log, « traverser en fondu »). Fichiers libérés.
- Mis à jour : 2026-11-24

## Idées NCT Ride d'une traite (ordres, directeur sportif, saisons, moto, chrono, tour à étapes, Piper, en ligne)
- Chantier : tous les ajouts tirés de la vidéo NCT Ride, faits d'une traite à la demande de l'utilisateur (2026-11-25), à corriger ensuite
- Fichiers réservés (sections) : `packages/physics/src/ai.ts`, `collision.ts` (+ tests `ai.test.ts`, `passThrough.test.ts`), `packages/shared/src/companion.ts`, `net.ts` (+ `test/snapshotEnergy.test.ts`), `apps/server/src/ride/PairRoom.ts`, `simulation.ts` (+ `test/simulation.test.ts`, mesure des chevauchements), `apps/client/src/game/peloton.ts`, `rideControls.ts`, `main.ts`, `net/interpolation.ts`, `onboarding/voice.ts` (export de `cartesiaUrl`), `ui/menu.ts`, `ui/ridepanels.ts`, `ui/settings.ts`, `world/terrain.ts`, `world/vegetation.ts`, `apps/companion/src/main.ts` + `i18n.ts`, `apps/client/package.json` + `pnpm-lock.yaml` (paquet `@mintplex-labs/piper-tts-web`) ; `game/v3Crowd.ts` (maillot d'équipe, maillots de leader), une ligne de `.gitignore` (public/piper/), nouveaux : `world/startRamp.ts`, `ui/startButton.ts`, `ui/raceGaps.ts`, `test/ttPower.test.ts`, `tools/piper/fetch-piper.mjs`, `public/models/vehicles/race-moto.glb`, `game/directeur.ts`, `audio/directorVoice.ts`, `world/raceMoto.ts`, `game/stageRace.ts`, `ui/tourPanel.ts` + `.css`, tests `directeur`, `raceMoto`, `stageRace`
- Saccade du départ (shaders compilés en direct), en plus : `apps/client/src/engine/renderer.ts` (`withAllLevels` : niveaux LOD0/2/5 des coureurs Bêta), `game/nearFade.ts` (copies gardées, `prewarmNearFade`, `releaseNearFade`), `game/ghost.ts` (`v3` public, `refresh`), `game/riderLight.ts` (`riderLightWarmup`), `world/trains.ts` (`warmup`), bloc de précompilation du départ dans `main.ts` ; puis `engine/renderer.ts` (`renderUnculled`, `compileObjects`, `userData.precompile`), `world/weather.ts` (une ligne), `world/workQueue.ts` (tâches découpées) + `test/workQueue.test.ts`, `world/world.ts` (étapes bâtiments/routes/végétation, `whileAlive`), `world/buildings.ts` (`addTileSteps`), `world/network.ts` (`addTileSteps`, `buildRoads` en générateur), `world/vegetation.ts` (`addTileSteps`, `addSeededTile`) ; bilan de course : nouveaux `game/raceReport.ts`, `ui/raceReportCard.ts`, `ui/raceReport.css`, `test/raceReport.test.ts`, `markPoints`/`finishPoints` de `game/stageRace.ts`, champ `race` et une ligne de `ui/summary.ts` ; `engine/renderer.ts` (`compileDetached`, calques remis pendant la compilation à l'avance), `game/nearFade.ts` (`nearFadeProxies`). Puis, avec l'accord de l'utilisateur (25/11, session « Hauteurs des routes » archivée) : `world/terrain.ts` (`buildGeometrySteps`, champ `building`, tuiles et changements de détail construits par pas ; `rebuild` retiré ; `add` accepte une géométrie déjà faite). Calcul des hauteurs inchangé. `engine/renderer.ts` : `keepPipelines` (pipelines et shaders gardés toute la session, ?keeppipelines=0). `rider/rimDecal.ts` (mesures des inscriptions de jante et de manivelle en uniformes) ; un cycliste d'ambiance précompilé au départ (`main.ts`, `userData.precompile`).
- Casque pour tous (25/11) : nouveaux `apps/client/src/game/headgear.ts`, `apps/client/test/headgear.test.ts` ; une ligne de tenue dans `game/peloton.ts` (constructeur, paramètre `gearKind`), `game/v3Crowd.ts` (`crowdV3`, paramètre `gear`), `world/cyclists.ts` (tenue des cyclistes d'ambiance), `game/multiplayer.ts` (`gearKind`, tenue des autres joueurs), `main.ts` (`gearKind`, tenue du joueur, du fantôme et du fantôme ami).
- État : codé, types et tests OK (un test serveur en délai dépassé sous charge, passe seul), essai en jeu incomplet (onglet du navigateur masqué), rien de commité
- Mis à jour : 2026-11-25

## Intégration modèles moto chrono (Intégration modèles moto chrono)
- Chantier : remplacer la moto de l'ardoisier par les deux motos chrono (Poly, Réel/Bêta) avec panneau LED arrière, demande de l'utilisateur du 2026-11-25 ; session NCT Ride prévenue (raceMoto.ts est dans son chantier)
- Fichiers réservés : aucun (libérés). Commités (145093f5, non poussé) : partie moto reprise du chantier NCT Ride à la demande de l'utilisateur : `world/raceMoto.ts`, `world/motoChrono.ts`, `ui/raceGaps.ts`, `test/raceMoto.test.ts`, `public/models/vehicles/moto-chrono-{poly,reel-beta}.glb`, lignes moto de `main.ts` (assemblées depuis HEAD, sans `!timeTrial` : à remettre par NCT Ride avec le chrono), paragraphe moto de `ASSETS_LICENSES.md`. `race-moto.glb` (ancienne moto) non commité, plus chargé.
- État : commité (145093f5, puis moto seulement en course, voir log), non poussé. Session NCT Ride prévenue. main.ts (copie de travail, section NCT) : moto exclue du contre-la-montre, écarts à l'écran gardés en chrono, à commiter avec le chrono.
- Commit du chantier NCT Ride entier, demandé par l'utilisateur : 82d1c354 (non poussé), instantané du 25/11 après-midi, vérifié sur l'index (typecheck, 182 fichiers de tests). Exclus : transparence du fondu (nearFade.ts twinOf et en-tête, nearFade.test.ts), lignes Robertville de world.ts (saison de RoadsideLife), ride.ts (closeSegmentAtFinish, propriétaire inconnu), race-moto.glb. Changements NCT postérieurs (terrain.ts par pas) non commités.
- Mis à jour : 2026-11-25

## Fondu transparent des coureurs proches (25/11)
- Chantier : fondu des coureurs proches en vraie transparence au lieu du tramé alphaHash (demande de l'utilisateur du 2026-11-25)
- Fichiers réservés (sections) : `apps/client/src/game/nearFade.ts`, seulement `twinOf` (création des copies), `FADE_MIN` (0,1) et le commentaire d’en-tête, deux lignes de `apps/client/test/nearFade.test.ts` ; le reste du fichier appartient au chantier « Idées NCT Ride » (non commité)
- État : terminé (repris par « Finaliser les chantiers en cours »), non commité
- Mis à jour : 2026-11-25

## 40 coureurs IA en course (demande du 25/11)
- Chantier : plafond des coureurs IA porté de 19 à 40 (menu, salles du serveur, préréglages high/ultra)
- Fichiers ou dossiers réservés (lignes seulement) : stepper `m-ai` de `apps/client/src/ui/menu.ts`, `aiRidersMax` de `apps/client/src/engine/quality.ts`, `MAX_RIDERS_PER_ROOM` / `MAX_AI_RIDERS` de `packages/shared/src/net.ts`, clamp `aiRiders`, `isFull` et `addAiRiders` de `apps/server/src/ride/simulation.ts`, un test de `apps/server/test/simulation.test.ts`
- État : commité (b7ba2d55, puis low/medium à 40 : voir git log, non poussés) ; fichiers libérés ; redéploiement du serveur nécessaire pour les courses en ligne
- Mis à jour : 2026-11-25

## Finaliser les chantiers en cours (demande de l'utilisateur du 2026-11-25)
- Chantier : finir ce qui était resté ouvert (sessions arrêtées). Fait : audit du 22/11 phases 1 et 2 (remplace l'entrée « Audit : bilan sûr, KOM… »), fondu transparent (un seul passage, seuil de découpe), terrain par pas (tuile plus redemandée pendant sa construction), casque chrono seulement quand le chrono est joué, shaders compilés en arrière-plan avec le MRT (`buildWithSceneState`), tests zoneMap et CSP remis au vert.
- Fichiers : `game/challenge.ts`, `inputs.ts`, `guest.ts`, `ride.ts`, `sequences.ts`, `nearFade.ts`, `headgear.ts`, nouveau `game/rideSave.ts`, `engine/renderer.ts`, `world/terrain.ts`, `ui/rideRecovery.ts`, `rideOutcome.ts`, `summary.ts`, sections de `main.ts`, `apps/desktop/scripts/csp.mjs`, tests `rideSave`, `keyboardControls`, `challenge`, `nearFade`, `zoneMap`
- État : commité (voir git log « bilan enregistré sûrement »), non poussé, fichiers libérés. Exclus : partie Bêta du casque (`v3WithHeadgear`, `v3Crowd.ts` et ses appels), `ASSETS_LICENSES.md`, `tools/v3_assets.py`, `launch.json`, `race-moto.glb`. Essai en jeu en Réel (chrono, fondu, bilan réussi et en échec). Vérifiés ensuite (25/11, zone d'essai `world=dev`) : quitter, récupération, KOM au sommet et pause, chrono en Réel et Poly. Partie Bêta du casque (`v3WithHeadgear`) non reprise ici. Non touchés : `ASSETS_LICENSES.md` et `tools/v3_assets.py` (mention de Zwift retirée par une modification non commitée).
- Mis à jour : 2026-11-25 14:40

## Matériel proposé avant un contre-la-montre (demande de l'utilisateur du 2026-11-25)
- Chantier : choix du joueur gardé en chrono, oubli complété (Réel, Poly), question avant le départ (3 styles ; en Bêta garage ou partir, rien mis d'office par ce code)
- Fichiers : nouveaux `apps/client/src/ui/ttGear.ts`, `test/ttGear.test.ts` ; `game/headgear.ts` (`ttMissing`, branche chrono de `withHeadgear`), `test/headgear.test.ts`, sections de `main.ts` (`onStart`, `isTtRide`, `ttKeep`/`myGear`)
- État : codé, types et tests client OK, question, « garage » et « équiper » essayés en Réel (25/11) ; roues variées des IA ; commité (voir git log « feat(chrono) »), non poussé, fichiers libérés. Attention : en Bêta, `v3WithHeadgear` (non commité) remplace encore le choix du joueur.
- Mis à jour : 2026-11-25

## Reprise du monde Poly de Codex (Île de Robert, session lancée depuis local_cd38e170, 25/11)
- Chantier : état réel, vérification en roulant en Poly, corrections et points restants du suivi `docs/SUIVI_MONDE_POLY.md`
- Fichiers réservés : `apps/client/src/world/` `worlds.ts`, `zoneMap.ts`, `loader.ts`, `packs.ts`, `roadsideLife.ts`, `robertville.ts`, `robertvilleBuildings.ts`, `crowdLowPoly.ts`, `crowd.ts`, `polySponsors.ts`, `buildings.ts` (partie Robertville) ; `ui/islandAtlas.ts` et `.css`, `ui/openWorld.ts`, `platform/offlineZones.ts`, `tools/island/` (sans régénérer les tuiles), tests `worldStyle`, `robertvilleBuildings`, `roadsideLife`, `zoneMap`, `docs/SUIVI_MONDE_POLY.md` ; en plus (demande de l'utilisateur : marquages, panneaux, bras des joggeurs) : nouveaux `world/polyRoadPlan.ts`, `polyRoadAtlas.ts`, `polyRoads.ts`, `test/polyRoadPlan.test.ts`, sections de `world/network.ts` (revêtement bois, niveaux de marquage Poly) et `world/world.ts` (branchement de `PolyRoads`), `world/roadsidePeople.ts` (coudes et genoux)
- Aussi touchés : `world/types.ts` et `buildings.ts` (`roofColour`, `roofOverhang`), `world/skyLife.ts` (mouettes), `rider/lowPolyRider.ts` (FITS.drop), nouveau `world/lowPolyCritters.ts`, `docs/ILE_DE_ROBERT.md`
- État : second lot commité (2ffb03d0, non poussé), vérifié en Poly ; fichiers libérés ; serveur arrêté. Questions ouvertes dans `docs/SUIVI_MONDE_POLY.md`
- Mis à jour : 2026-11-25

## Monde Poly, troisième lot (session lancée depuis local_cd38e170, 25/11)
- Chantier : météo de Paris sur l'île, sortie virtuelle à l'export, route du port et nouveaux parcours (régénération de `apps/client/public/worlds/ile-de-robert`, demandée par l'utilisateur), décor de Saint-Robert, de l'Anneau et de Kerbrou
- Fichiers réservés : `tools/island/`, `apps/client/public/worlds/ile-de-robert/` et l'entrée de l'île dans `worlds/index.json` ; nouveau `game/virtualRide.ts` + test, `ui/ridepanels.ts` (titre, GPX), une ligne de `apps/server/src/integrations/uploads.ts`, trois endroits de `main.ts` (import, titre du brouillon, météo) ; `world/robertville.ts` et nouveaux fichiers de décor Poly ; `docs/SUIVI_MONDE_POLY.md`, `docs/ILE_DE_ROBERT.md`
- Aussi touchés : `world/` `polySites.ts`, `polyHarbour.ts` (nouveaux), `roadsideLife.ts`, `network.ts` (walkHeightAt), `world.ts`, `traffic.ts`, `polyRoads.ts`, `robertvilleBuildings.ts`, `lowPolyProps.ts` (poubelles), `ui/islandAtlas.ts` et `.css` ; ville du joueur : nouveaux `game/communes.ts`, `ui/cityPicker.ts` et `.css`, `test/communes.test.ts`, `public/geo/communes-fr.txt`, `tools/communes/`, une ligne de `ui/settings.ts`, deux endroits de `ui/menu.ts` (Profil), `game/realWeather.ts` (heure locale) et son test, `data/komIndex.json`
- État : troisième lot commité (950e8d53), quatrième lot commité (2878f2c2, poussé) ; fichiers libérés, serveur arrêté
- Mis à jour : 2026-11-25

## Compteurs masqués au départ d'une course (demande de l'utilisateur du 2026-11-25)
- Chantier : sur la ligne ou la rampe, compteurs masqués jusqu'à 4 s après le départ
- Fichiers : nouveaux `apps/client/src/hud/startHud.ts`, `test/startHud.test.ts` ; `hud/hud.ts` (`setStarting`), une section de `hud/hud.css`, quatre lignes de `main.ts` (import, `holdStartHud`, écarts, `hud.update`)
- État : codé, types et tests client OK, vu en Poly (chrono) ; commité (voir git log « compteurs masqués au départ »), non poussé, fichiers libérés
- Mis à jour : 2026-11-25

## Départ de course : coureurs sur toute la largeur, pas de trafic ; salon et micro (demandes de l'utilisateur du 2026-11-25)
- Chantier : grille de départ répartie sur la largeur (local et serveur), circulation et cyclistes d'ambiance absents en course ; mise en page de la salle d'attente, message « voix indisponible »
- Fichiers (sections) : nouveaux `packages/physics/src/start-grid.ts` + test, `packages/physics/src/index.ts` (export), `apps/server/src/ride/simulation.ts` (`placeOnGrid`, `placeOnJoin`, `setTelemetry`, `aiLateral`), `apps/client/src/game/peloton.ts` (`placeOnGrid`, `update`), `game/multiplayer.ts` (`selfLateral`), `main.ts` (`alive`, grille, salon), `game/rideroom.css`, `game/voice.ts`
- État : codé, types et tests OK, vu en Réel (grille, course en ligne sans trafic) ; capteurs retirés de la salle d'attente (`rideroom.ts`) ; commité (e322ec0f), non poussé
- Mis à jour : 2026-11-25

## Pied à terre en Réel et Poly (demande de l'utilisateur du 2026-11-25)
- Chantier : pose d'arrêt originale calculée sur le squelette (pied gauche posé, départ au premier coup de pédale)
- Fichiers (sections) : nouveaux `apps/client/src/rider/footDown.ts` + test ; `update` de `rider/gltfAvatar.ts` et `rider/lowPolyRider.ts` ; lignes `setFootDown` de `main.ts`, `game/peloton.ts`, `game/multiplayer.ts`
- État : codé, types et tests OK, vu en Réel et Poly ; commité (voir git log « pied à terre »), non poussé, fichiers libérés
- Mis à jour : 2026-11-25

## Tour à étapes « Tour de l'Île » et menu de réglages du tour (demande de l'utilisateur du 2026-11-25)
- Chantier : étapes découpées dans la boucle du Tour de l'Île (ou parcours de la zone), menu propre au tour dans l'onglet Rouler
- Fichiers réservés : `apps/client/src/game/stageRace.ts`, `test/stageRace.test.ts`, nouveaux `game/tourPlan.ts`, `test/tourPlan.test.ts`, `ui/tourMenu.ts` et `.css`, `ui/tourPanel.ts` ; sections seulement : `game/direction.ts` (`findRoute`), `world/routeStore.ts` (`loadRouteForKey`), `ui/settings.ts` (réglages du tour), `ui/menu.ts` (`tourHtml`, carte Course de `rideHtml`, `checkRoute`, `start`), `game/peloton.ts` (`park`, `ttTimes`, `noteFinish`), `ui/summit.ts`, `main.ts` (lignes du tour et de `isTtRide`, `teardown`, `reachSummit`). Les changements non commités de `menu.ts` (atlas, garage) ne sont pas à cette session. Aucun fichier de `worlds/`.
- État : codé, types et tests client OK, vu en Poly (menu, départ, trois arrivées, abandon) et en Réel (menu) ; non commité. IA : temps d'arrivée noté quand elles se rangent avant la ligne d'un parcours non bouclé (elles ne la franchissaient jamais). Serveur arrêté.
- Mis à jour : 2026-11-25
- Suite (25/11) : étapes de ville en ville calculées sur le graphe de la zone (aucun fichier de `worlds/` ni de `tools/island/`) : nouveaux `apps/client/src/game/tourRoutes.ts`, `test/tourRoutes.test.ts` ; sections de `ui/routePlanner.ts` (accès au graphe), `ui/menu.ts` (tour, `refreshMap`), `main.ts` (étape reconstruite au chargement), `ui/settings.ts`. Codé, types et tests client OK, essayé en Poly, non commité.
