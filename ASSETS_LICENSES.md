# Registre des licences des assets

Tout asset qui entre dans le dépôt ou dans le jeu est inscrit ici (source, licence, usage). Aucun asset de Zwift, MyWhoosh ou autre jeu.

## Données géographiques

| Asset | Source | Licence | Usage |
| --- | --- | --- | --- |
| Altitudes (MNT LiDAR HD, RGE ALTI 1 m) | IGN — Géoplateforme | Licence Ouverte Etalab 2.0 (attribution « © IGN ») | Relief des tuiles du monde (générées, non versionnées) |
| Orthophotos (ORTHOIMAGERY.ORTHOPHOTOS) | IGN — Géoplateforme | Licence Ouverte Etalab 2.0 | Couleur du sol (générées, non versionnées) |
| Routes, bâtiments, forêts, eau, lieux | OpenStreetMap via Overpass | ODbL 1.0 (attribution « © les contributeurs OpenStreetMap ») | Entités des tuiles et itinéraires (`routes/*.json` versionnés) |

L'attribution est affichée en jeu (bas de l'écran) et dans `world.json`.

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
| Véhicules `sedan`, `hatchback-sports`, `suv`, `delivery`, `tractor` + `colormap.png` — `apps/client/public/models/vehicles/` | [Kenney Car Kit 3.1](https://kenney.nl/assets/car-kit) | CC0 1.0 (licence jointe) | Trafic |
| Cycliste et vélos (`apps/client/public/models/*.glb`) | Générés par `tools/blender/build_cyclist.py` | Code du projet | Avatars |
| Avatar et vélo procéduraux | Générés par le code (`apps/client/src/rider/avatar.ts`) | Code du projet | Coureurs (repli) |
| Sons (vent, pneus, roue libre, oiseaux, pluie) | Synthèse WebAudio (`apps/client/src/audio`) | Code du projet | Ambiance sonore |

## Musique et voix

| Asset | Source | Licence | Usage |
| --- | --- | --- | --- |
| Voix off du tutoriel | Cartesia (synthèse via le serveur, `/api/tts`), repli sur la synthèse vocale du système (Web Speech API) ; script `apps/client/src/onboarding/script.ts` | Audio généré à la demande, mis en cache côté serveur, aucun fichier versionné | Onboarding |
| Musiques « Lofi », « Jazzy », « Effort constant », « Effort pur » (2 versions) — `apps/client/public/music/` | Composées par cris_tof avec [Suno](https://suno.com) (« made with Suno »), réencodées en MP3 128 kbit/s | Droits de l'auteur selon son abonnement Suno au moment de la génération (Pro / Premier : propriété de l'auteur ; offre gratuite : usage non commercial avec crédit Suno) | Musique de fond du menu et des sorties |
