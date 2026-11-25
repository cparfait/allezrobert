# Sessions Codex

## Paris low-poly

- Chantier : reprise de la Tour Eiffel et intégration dans le Paris low-poly.
- Fichiers modifiés : `apps/client/src/world/buildings.ts`, `apps/client/src/world/parisEiffel.ts`, `apps/client/test/parisEiffel.test.ts`, une entrée dans `ASSETS_LICENSES.md`.
- État : tour et plateforme ouverte intégrées localement. Jardins et vues d’inspection vérifiés dans le prototype hors jeu. Aucun fichier réservé.

## Refonte des coureurs et vélos du mode réel

- Chantier : variantes aéro, chrono et gravel du mode Réel, casque route et taille du maillot féminin des avatars MPFB.
- État : intégré localement. Modèles exportés et vérifiés dans Blender. Fichiers libérés.

## Fenêtres et éclairage nocturne low-poly

- Chantier : adoucir les fenêtres et la lumière nocturne du jeu, avec teintes chaudes et froides.
- Fichiers réservés : apps/client/src/world/buildingsLowPoly.ts, apps/client/src/world/environment.ts, apps/client/src/world/world.ts.
- État : en cours.
- Extension aux deux modes : apps/client/src/world/buildings.ts et apps/client/src/world/windowLighting.ts, réservés pour la correction nocturne.
- Corrections appliquées dans les deux styles, typecheck et 7 tests ciblés OK. Aucune réservation restante. Essai sur les Champs-Élysées via un client local, sans modifier les données de zone.

## Style V3 local

- Chantier : troisième style du jeu, moteur de pose et ressources Zwift locales à la demande.
- Fichiers réservés : apps/client/src/v3/, apps/client/src/ui/atelier.ts (vélos exposés), apps/client/scripts/v3Assets.ts, tools/v3_assets.py et out/v3/.
- État : repris par la session Claude « Garage V3 » le 16/11 (voir .claude/SESSIONS.md).

## Essai local des modèles Zwift

- Chantier : comparaison en sortie de quatre vélos et quatre avatars du cache local.
- État : 19 postures dans le garage autonome après retrait des variantes BW. Fichiers libérés.

## Nom de la commune dans le HUD à Paris

- Chantier : détection de la commune de Paris par son contour officiel.
- Fichiers réservés : apps/client/src/game/place.ts, apps/client/src/world/parisBoundary.ts, apps/client/test/place.test.ts, appel de PlaceFinder dans apps/client/src/main.ts et une nouvelle ligne dans le tableau géographique d’ASSETS_LICENSES.md.
- État : en cours.
- Correctif intégré localement et vérifié par 19 tests. Fichiers libérés.

## Toits parisiens dans le jeu

- Chantier : pans et terrassons des toits de zinc ou d’ardoise de Paris à partir des empreintes du jeu.
- Fichiers réservés : apps/client/src/world/parisRoof.ts, apps/client/src/world/buildings.ts (choix et géométrie des toits dans addTile, état du monde), apps/client/test/parisRoof.test.ts.
- État : en cours.
- Correctif intégré localement. 31 tests ciblés, typecheck et contrôle des maillages sur neuf tuiles réussis. Fichiers libérés.

## Couverture de Paris et des villes

- Chantier : accès à Paris entier, extension des toits et verdures aux zones compatibles.
- Fichiers réservés : apps/client/src/world/composite.ts, buildings.ts (profil de toiture), parisRoof.ts, grassPlacement.ts, apps/client/src/ui/menu.ts (choix des zones), apps/client/test/composite.test.ts, parisRoof.test.ts et grassPlacement.test.ts.
- État : en cours.
- Extension : urbanRoof.ts (renommage de parisRoof.ts), apurVegetation.ts, fileWorld.ts, types.ts, splat.ts, tools/terrain/scripts/build-apur-cover.py, apps/client/public/geo/grand-paris-vegetation.bin.gz et une ligne dédiée dans ASSETS_LICENSES.md.
- Générateur livré dans tools/terrain/build-apur-cover.py. Paris entier, masque APUR et règles nationales vérifiés par 42 tests et une sortie au bois de Vincennes. Fichiers libérés.

## Modèles Tacx et Wahoo du garage

- Chantier : Tacx NEO 2T Smart et NEO 3M (99ac9204), Wahoo KICKR et KICKR CORE 2 (10abbee6).
- État : modèles et provenance commités, rendus vérifiés en réel et low poly. Fichiers libérés.

## Logos officiels de la tenue UAE V3

- Chantier : installer la texture UAE 2026 corrigée, après libération confirmée par l’utilisateur.
- État : article 9001 corrigé, texture servie et vérifiée sur le garage V3 (5233). Fichiers libérés.

## Épaisseur des carters Tacx du garage

- Chantier : affiner le carter des NEO 2T et NEO 3M à proximité de l’axe arrière, d’après la capture de l’utilisateur.
- État : carters affinés, seconde retouche du NEO 3M validée en réel et low poly. Modification locale. Fichier libéré.

## Publication V3

- Chantier : retirer les anciennes restrictions de la documentation sur la diffusion du style V3.
- Fichiers réservés : README.md, docs/ART_DIRECTION.md, ASSETS_LICENSES.md (introduction et paragraphe V3), .agents/skills/asset-provenance/SKILL.md, .claude/skills/asset-provenance/SKILL.md, tools/menu-loop/README.md, tools/v3_kits/uae2026/README.md.
- État : en cours.
- Documentation commitée dans 71c2cc8e. Fichiers libérés.

## Accès V3 par code

- Chantier : contrôler la saisie du code V3 et protéger le service de ressources.
- Fichiers réservés : apps/client/src/engine/style.ts, apps/client/src/engine/v3Access.ts, apps/client/scripts/v3Access.ts, apps/client/vite.config.ts.
- État : en cours. Aucun fichier modifié dans le dossier du garage V3.
- Protection du serveur local et du dialogue vérifiée en HTTP et dans Chromium, commit 773adc8d. Fichiers libérés. Service de ressources de production et installateurs à faire.

## V3 en production et installateurs

- Chantier : service de ressources V3 protégé, intégration web et Tauri, publication Windows et macOS.
- Fichiers réservés : sources V3 et appels V3 de main.ts (reprise autorisée par l’utilisateur), apps/client/scripts/v3Assets.ts, apps/client/src/engine/style.ts et v3Access.ts, apps/client/vite.config.ts, apps/desktop (pont V3 et versions), deploy (service, proxy et build web), .github/workflows/macos.yml.
- État : en cours. Builds applicatifs prévus dans un checkout isolé et sur le VPS. Aucune génération de données dans apps/client/public/worlds.
- Intégration commitée et poussée (95c6f333). Images web et service prêtes sur le VPS. EXE avec sa signature de mise à jour et DMG universel 0.1.28 construits et vérifiés, déposés dans le dossier privé de préparation. Archive V3 filtrée prête localement. Transfert en attente de confirmation après le refus automatique du transfert intégral. Aucun basculement du site effectué.
- Déployé sur le VPS. Archive filtrée transférée après autorisation explicite et vérifiée par SHA-256. Service V3 testé sur Linux et en HTTPS, avec et sans code. Installateurs Windows et macOS 0.1.28 publiés. Empreintes des téléchargements et mise à jour Windows vérifiées. Fichiers libérés.

## Catalogue V3 commun

- Chantier : pilotage administrateur des articles proposés sur le web et les applications.
- Fichiers réservés : apps/client/src/v3/catalogAdmin.ts, apps/client/scripts/v3Assets.ts, apps/server/src/http/admin-routes.ts et v3-catalogue.ts, apps/server/src/config.ts, apps/server/test/admin.test.ts, deploy/v3-server.mts et deploy/docker-compose.yml.
- État : en cours. Builds isolés, aucune génération dans les données de zones.
- Catalogue commun déployé dans 7fa5cb7a, accès et masquage vérifiés. Fichiers libérés.

## Démarrage 0.1.29 et accès V3

- Chantier : sessions V3 conservées entre redémarrages du service, reprise après expiration, lancement en plein écran et zone d’interface en pleine largeur.
- Fichiers réservés : deploy/v3-server.mts, apps/client/src/engine/display.ts et v3Access.ts, apps/client/src/platform/desktop.ts, apps/client/src/v3/visuals.ts (chargement), versions et configuration Tauri dans apps/desktop.
- État : en cours. Aucun build de zones.

## Sorties V3 hors ligne

- Chantier : télécharger et préparer le vélo, l’avatar et la tenue du joueur pour les zones installées.
- Fichiers réservés : apps/desktop/src-tauri/src/v3.rs et lib.rs, config et version desktop, apps/client/src/engine/style.ts et v3Access.ts, apps/client/src/v3/visuals.ts, apps/client/src/platform/desktopBoot.ts, apps/client/src/world/packs.ts et boot de main.ts.
- État : en cours. La version 0.1.29 n’est pas activée sur le site. Aucune génération de données de zones.
- Repris par Claude le 16/11 dans le worktree v3-release (non commité) : liste des fichiers d’une sortie (v3/offline.ts, v3RidePaths), copie disque tolérant les fichiers absents, démarrage en Réel sans réseau ni copie. Typecheck, cargo check et tests V3 OK. Publié dans la 0.1.30 (18270766) le 16/11 ; essai réel sans connexion encore à faire. Fichiers libérés.

## Accès au catalogue avec le compte administrateur

- Chantier : ouvrir les seules routes du catalogue V3 avec le compte administrateur connecté sur le web, conformément au choix de l’utilisateur.
- Fichiers réservés : apps/server/src/http/admin-routes.ts et apps/server/test/admin.test.ts.
- État : en cours. Redéploiement de l’API uniquement.

## Essai du bâti précalculé à Boulogne

- Chantier : comparaison CPU du maillage des bâtiments Bêta et de leur chargement depuis une archive locale.
- Fichiers produits : out/bench-bati-boulogne/ uniquement. Lecture des sources et tuiles actuelles. Aucun build de zones ni mesure GPU.
- État : terminé, quatre tuiles testées, résultats dans results.json. Fichiers libérés.
- Rectificatif utilisateur : style Bêta (V3) uniquement, y compris les questions précédentes.

## Branchement expérimental du bâti Bêta à Boulogne

- Chantier : serveur local d’essai Bêta exclusivement, boucle de 20 km, activation A/B. Les sources partagées sont lues et transformées uniquement par ce serveur d’essai.
- Fichiers réservés : out/bench-bati-boulogne/ uniquement. Port local 5268. Aucun build de zones.
- État : en cours. Un essai court du client peut occuper le GPU pendant la validation. Ne pas utiliser cette fenêtre pour des mesures de performance concurrentes.
- Validation terminée : six archives exportées puis rechargées dans Chromium Bêta. Mesure CPU de montage seulement. Serveur local conservé sur le port 5268. Fichiers libérés.

## Diagnostic du départ Bêta à Boulogne

- Chantier : mesure et comparaison du démarrage Bêta avec le serveur local 5268, essais Chromium susceptibles d’occuper le GPU. Fenêtre de mesure à éviter en parallèle.
- Fichiers réservés : out/bench-bati-boulogne/ uniquement. Aucun build de zones.
- État : en cours.
- Validation terminée : comparatifs Chromium WebGPU dans startup-0-0.json, startup-1-0.json et startup-1-1.json. Blocage maximal de construction passé de 22,7 s à 0,99 s avec batistart=1. Serveur local 5268 disponible. Mesures terminées, fichiers libérés.

## Publication du démarrage fractionné Bêta

- Chantier : versionner le démarrage fractionné de la boucle de 20 km à Boulogne depuis un worktree basé sur origin/main, puis pousser ce seul commit.
- Fichiers réservés dans le worktree uniquement : apps/client/src/world/world.ts et workQueue.ts. Aucun build de zones ni opération sur le main local partagé.
- État : en cours.

## Moto chrono autonome

- Chantier : deux modèles 3D de moto chrono, rendu comparatif et aperçu autonome.
- Fichiers réservés : out/moto-chrono/ uniquement. Aucun build du jeu ni mesure GPU.
- État : en cours.
- État final : deux GLB et deux Blender livrés, rendus vérifiés et aperçu hors ligne testé dans Chromium. Fichiers libérés.

## Roulage de la moto chrono autonome

- Chantier : aperçu en mouvement et retrait de la plaque latérale sur les deux modèles.
- Fichiers réservés : out/moto-chrono/ uniquement. Aucun build du jeu ni mesure GPU.
- État : en cours.
- État final : plaque retirée des deux GLB et Blender, quatre vues recalculées, les deux variantes testées en roulage dans Chromium. Aperçu local ouvert. Fichiers libérés.

## Essai des motos chrono dans Allez Robert

- Chantier : vérifier le rendu des deux motos sur le Tourmalet avec un client local isolé, en Poly, Réel et Bêta.
- Fichiers réservés : out/moto-chrono/ uniquement. Les points de branchement du jeu sont lus et transformés en mémoire. Aucun build de zones ni mesure GPU.
- État : en cours.
- État final : captures WebGPU Poly, Réel et Bêta sur le Tourmalet à 6 et 16 m. Chrono négatif contrôlé. Serveur local 5376 laissé ouvert. Fichiers libérés.

## Île de Robert réservée au mode Poly

- Chantier : carte de France seule en Réel et Bêta, île en Poly et premier décor des Planches de Robertville.
- Fichiers réservés : apps/client/src/world/worlds.ts, zoneMap.ts, loader.ts, packs.ts, roadsideLife.ts et robertville.ts, apps/client/src/ui/openWorld.ts, apps/client/src/platform/offlineZones.ts et tests ciblés.
- État : en cours. Aucun build ni modification de données de zones.
- Extension : une ligne dans ASSETS_LICENSES.md consacrée au décor procédural original de Robertville. La ligne des motos chrono reste réservée à son chantier.
- Extension saisons et public Poly : apps/client/src/world/crowd.ts, crowdLowPoly.ts et, dans world.ts, uniquement le branchement RoadsideLife et la méthode setSeason. Étapes de montage des tuiles, fonctions de densité et autres sections partagées laissées à leurs chantiers.
- Banc de vérification : apps/client/src/crowd-test.ts, ajout de la largeur au faux itinéraire, et fichiers temporaires out/poly-*. Aucun relevé GPU.
Extension publicites Poly : apps/client/src/world/polySponsors.ts, raccords dans crowd.ts et robertville.ts.
- Suivi demandé : nouveau fichier docs/SUIVI_MONDE_POLY.md.
- État final : lot intégré localement. Sélecteur vérifié en Réel, Bêta et Poly, TypeScript et trois tests ciblés réussis, neuf décors et panneaux vérifiés sur les tuiles existantes. Public et nouvelles publicités affichés en été et hiver dans un aperçu WebGL isolé. Suivi et contrôles de roulage restants dans docs/SUIVI_MONDE_POLY.md. Aucun build de zones. Fichiers libérés.
- Retouche utilisateur en cours : palettes de vêtements dans crowdLowPoly.ts et bilan dans docs/SUIVI_MONDE_POLY.md.
- Retouche terminée : vêtements et bonnets Poly plus vifs, suivi Markdown actualisé. TypeScript et aperçus WebGL été et hiver vérifiés. Fichiers libérés.

## Présentation du monde Poly et bâti de Robertville

- Chantier : carte de l’île, écran de sélection Poly et diversité des maisons de Robertville.
- Réservations : tools/island/src/map.ts et ses sorties carte.png et vignette.png ; menu.ts uniquement imports et sections du sélecteur de zone, nouveau ui/islandAtlas.ts et .css ; world/worlds.ts, platform/offlineZones.ts, test/worldStyle.test.ts ; world/buildings.ts uniquement l’adaptation de l’enregistrement de la maison avant son maillage, nouveau world/robertvilleBuildings.ts et son test ; docs/SUIVI_MONDE_POLY.md et la ligne procédurale Robertville de ASSETS_LICENSES.md. Essais dans out/robertville-atlas/.
- État : en cours. Lecture des tuiles existantes, seules les deux cartes sont régénérées. Aucun relevé GPU.
- État final : atlas Poly, fond topographique et sept familles de maisons intégrés localement. Carte vérifiée en Chromium sur ordinateur et mobile, bâti vérifié sur deux tuiles dans un aperçu WebGL isolé, TypeScript et cinq tests ciblés réussis. Captures dans out/robertville-atlas/. Fichiers libérés.


## Reformulation de la provenance V3

- Chantier : corriger et commiter la phrase sur les exports d’étude.
- Fichier réservé : ASSETS_LICENSES.md (première phrase du paragraphe V3 uniquement).
- État : en cours.
- Correction commitée dans 7792255e. Fichier libéré.


## Choix du matériel Bêta et ancienne moto

- Chantier : appliquer le choix du joueur au départ du chrono en Bêta et supprimer l’ancien modèle de moto à la demande de l’utilisateur.
- Fichiers réservés : apps/client/src/main.ts (appel de v3WithHeadgear pour le joueur uniquement), apps/client/public/models/vehicles/race-moto.glb (hors Git).
- État : en cours.
- Correctif appliqué localement, 25 tests ciblés réussis. Ancien modèle hors Git supprimé et deux modèles actifs vérifiés. Fichiers libérés.
- Lot Bêta commité dans 65b3a76d. Vérification TypeScript réussie.


## Mentions des ressources Bêta dans le code

- Chantier : reformuler les textes affichés et commentaires qui citent l’origine des modèles Bêta.
- Fichiers réservés : apps/client/src/v3/ (textes et commentaires), apps/client/scripts/v3Assets.ts, commentaires ciblés de apps/client/src/main.ts, game/cameras.ts, game/headgear.ts, game/peloton.ts, game/riderMerge.ts, game/v3Crowd.ts, ui/startRider.ts et ui/atelier.ts, commentaires de tools/v3_loc.py, tools/v3_smooth_glb.py, tools/menu-loop/src/capture.ts et tools/v3_kits/uae2026/ (scripts Python).
- État : en cours. Aucun build de zones.
- État final : libellés et commentaires reformulés. Comparaison du code confirmant que les données et la logique du catalogue sont identiques. TypeScript et 15 tests ciblés réussis. Fichiers libérés.
