# Registre des licences des assets

Tout asset qui entre dans le dépôt ou dans le jeu est inscrit ici (source, licence, usage). Aucun asset de Zwift, MyWhoosh ou autre jeu.

## Données géographiques

| Asset | Source | Licence | Usage |
| --- | --- | --- | --- |
| Altitudes (MNT LiDAR HD, RGE ALTI 1 m) | IGN — Géoplateforme | Licence Ouverte Etalab 2.0 (attribution « © IGN ») | Relief des tuiles du monde (générées, non versionnées) |
| Orthophotos (ORTHOIMAGERY.ORTHOPHOTOS) | IGN — Géoplateforme | Licence Ouverte Etalab 2.0 | Couleur du sol (générées, non versionnées) |
| Routes, bâtiments, forêts, eau, lieux | OpenStreetMap via Overpass | ODbL 1.0 (attribution « © les contributeurs OpenStreetMap ») | Entités des tuiles et itinéraires (`routes/*.json` versionnés) |
| Montées célèbres : relief Alpe d'Huez (Isère) et mont Ventoux (Vaucluse) — MNT LiDAR HD 1 m (repli RGE ALTI 1 m) près de la route, 8 m sur le corridor, 100 m pour l'horizon (`tiles/horizon.u16`) | IGN — Géoplateforme (WMS-R `data.geopf.fr`) | Licence Ouverte Etalab 2.0 (attribution « © IGN ») | Tuiles et horizon des mondes `alpe-dhuez` et `mont-ventoux` (générés, non versionnés) |
| Montées célèbres : orthophotos BD ORTHO® | IGN — Géoplateforme | Licence Ouverte Etalab 2.0 | Couleur du sol des mondes `alpe-dhuez` et `mont-ventoux` (générées, non versionnées) |
| Montées célèbres : tracé (D211, D974), panneaux des 21 virages de l'Alpe d'Huez (nom, numéro, altitude, plaque des vainqueurs : tags `name`, `ref`, `ele`, `inscription`), lieux, éboulis, glaciers | OpenStreetMap via Overpass | ODbL 1.0 | `routes/alpe-dhuez.json` et `routes/mont-ventoux-bedoin.json` (versionnés : géométrie dérivée d'OSM, champ `hairpins`, repères) et entités des tuiles |
| Contour simplifié de la France et de la Corse (≈ 130 points lon/lat) | Tracé original pour Allez Robert, d'après des repères géographiques connus (villes côtières, caps, cols frontaliers) | CC0 1.0 (domaine public) | Carte de France du choix des zones (`apps/client/src/world/franceOutline.ts`) |
| Noms et positions des villes, villages et hameaux des mondes ouverts (`places.json`) | OpenStreetMap (tag `place`), extraits des tuiles par tools/terrain | ODbL 1.0 | Noms sur la carte d'itinéraire du menu et repères des parcours dessinés |

L'attribution est affichée en jeu (bas de l'écran) et dans `world.json` (`attribution`) et dans chaque itinéraire. Les
valeurs publiées utilisées pour valider les montées (longueur, dénivelé, pente) ne sont que citées dans
`tools/terrain/src/config.ts` (`reference.sources`) : aucune donnée n'en est reprise.

## Polices

| Asset | Source | Licence | Usage |
| --- | --- | --- | --- |
| Inter (variable, latin) | `@fontsource-variable/inter` | SIL Open Font License 1.1 | Séquences HyperFrames, HUD |
| JetBrains Mono (variable, latin) | `@fontsource-variable/jetbrains-mono` | SIL Open Font License 1.1 | Chiffres tabulaires des séquences et du HUD |

## Modèles 3D, textures, sons

| Asset | Source | Licence | Usage |
| --- | --- | --- | --- |
| Arbres, herbe, géométrie des bâtiments, routes, ciel, pluie | Générés par le code (`apps/client/src/world`) | Code du projet | Monde |
| Textures `painted_plaster_wall` (Amal Kumar), `plaster_stone_wall_01` (Charlotte Baglioni), `brick_wall_09` (Rob Tuytel, Matterfield), `clay_roof_tiles` (Amal Kumar), `grey_roof_tiles_02` (Rob Tuytel), `asphalt_02` (Rob Tuytel) — `apps/client/public/assets/textures/` | [Poly Haven](https://polyhaven.com) | CC0 1.0 | Façades et toits (couleur + normales, 1K) |
| Véhicules du trafic `citadine`, `berline`, `suv`, `porsche-911`, `utilitaire`, `tractor` (`.glb` proche et `.far.glb` lointain) — `apps/client/public/models/vehicles/` | [Sketchfab](https://sketchfab.com) : [Compact '07](https://sketchfab.com/3d-models/compact-07-low-poly-model-25c6874d173a4f6ca63e150bbd505686), [Kiri '10](https://sketchfab.com/3d-models/kiri-10-low-poly-model-7fd6e15785fa4aa9bfd6e31eb7c97ba6), [Urban '10](https://sketchfab.com/3d-models/urban-10-low-poly-model-2866efdfa943484391ef8313768e074d) (DanielZhabotinsky) ; [FREE 1975 Porsche 911 (930) Turbo](https://sketchfab.com/3d-models/free-1975-porsche-911-930-turbo-8568d9d14a994b9cae59499f0dbed21e) (lionsharp) ; [European Delivery Van](https://sketchfab.com/3d-models/european-delivery-van-0b2f1ad95a79419f9a092420024d329c) (evan.hiltz) ; [Tractor sgw3](https://sketchfab.com/3d-models/tractor-sgw3-38625f3e0fd0465bb7cc99de89590071) (tnikita). Modifiés : habitacle et pièces parasites retirés, roues regroupées, mis à l'échelle, simplifiés et compressés par `tools/blender/vehicles` (Blender, glTF-Transform, meshoptimizer, ktx2-encoder) | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) ; la Porsche reproduit un modèle réel, la marque reste la propriété de son constructeur | Trafic |
| Cycliste et vélos (`apps/client/public/models/*.glb`) | Générés par `tools/blender/build_cyclist.py` | Code du projet | Avatars |
| Avatar MPFB (`apps/client/public/models/avatar/rider.glb`, essai `?avatar=mpfb`) : maillage de base hm08, macros, cibles de modelage `data/targets` (menton, joues, tête, front, sourcils, yeux, nez, bouche, oreilles, cou, épaules ; liste dans `SLIDERS` du script) et macros (sexe, âge, poids, muscle, origine), unités d'expression `expression/units` (formes ARKit), langue (`helper-tongue`), squelette « game_engine » et ses poids, globes oculaires | [MPFB 2.0.18](https://extensions.blender.org/add-ons/mpfb/) (MakeHuman), téléchargé et vérifié (SHA-256) par `tools/blender/avatars/build_avatar.py` ; l'extension elle-même (GPL-3.0) n'est qu'un outil de fabrication, ni versionnée ni livrée ; compression par [glTF-Transform](https://gltf-transform.dev) 4.5.1 et meshoptimizer 0.22 (MIT, outils de fabrication, `tools/blender/avatars/compress.mjs`) | CC0 1.0 pour les assets MakeHuman (maillage, cibles, squelettes, poids) ; modèle exporté par nous : CC0 | Avatars (étape 2, docs/AVATARS.md) ; tenue découpée, pose de course, casque, lunettes, cheveux et chaussures repris de `cyclist.glb` (code du projet) |
| Peau de l'avatar MPFB (`apps/client/public/models/avatar/skin_albedo.webp`, `skin_masks.webp`) | Fabriquées par `build_avatar.py` à partir de `young_lightskinned_male_diffuse` et `old_lightskinned_male_diffuse` du paquet « MakeHuman system assets » (sous-ensemble réduit versionné dans `tools/blender/avatars/vendor/makehuman`, voir son README) | CC0 1.0 (MakeHuman, Data Collection AB) | Peau, rides, zones de barbe, de rougeur et de taches de rousseur |
| Détecteur de repères faciaux (`apps/client/public/models/face/face_landmarker.task`, float16 v1, SHA-256 `64184e22…bc9ff`) et moteur `@mediapipe/tasks-vision` 1.1.1 (WebAssembly servi par le jeu) | [MediaPipe Face Landmarker](https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task) (Google) : modèles BlazeFace court, Face Mesh V2, Blendshape V2 | Apache 2.0 (fiches des modèles et paquet npm) ; aucune restriction géographique (la mention « hors UE » des fiches ne concerne que l'échantillon d'évaluation) ; identification de personnes hors de l'usage prévu, et non faite ici | Ressemblance à partir d'une photo, sur l'appareil (docs/AVATARS.md § 11) |
| Avatar et vélo procéduraux | Générés par le code (`apps/client/src/rider/avatar.ts`) | Code du projet | Coureurs (repli) |
| Tous les sons du jeu : vent, roulement (enrobé, pavés, gravier, terre), roue libre, dérailleur, souffle, oiseaux (merle, mésange, pouillot, alouette, coucou, pic, ramier, corneille, hulotte), grillons, feuillage, pluie, rumeur de village, chien, cloches, vaches, eau, public (applaudissements, « Allez ! », sifflets, cloches de vache), voitures et tracteurs | Synthèse procédurale WebAudio (`apps/client/src/audio`), tampons générés au lancement : **aucun fichier audio**, aucun échantillon enregistré, rien d'un autre jeu | Code du projet | Son du jeu |

## Musique et voix

| Asset | Source | Licence | Usage |
| --- | --- | --- | --- |
| Voix off du tutoriel | Cartesia (synthèse via le serveur, `/api/tts`), repli sur la synthèse vocale du système (Web Speech API) ; script `apps/client/src/onboarding/script.ts` | Audio généré à la demande, mis en cache côté serveur, aucun fichier versionné | Onboarding |
| Musiques « Tempo », « À bloc », « Échappée » — `apps/client/public/music/` | Composées par cris_tof avec [Suno](https://suno.com) (« made with Suno »), réencodées en MP3 128 kbit/s | Droits de l'auteur selon son abonnement Suno au moment de la génération (Pro / Premier : propriété de l'auteur ; offre gratuite : usage non commercial avec crédit Suno) | Musique de fond du menu et des sorties |
