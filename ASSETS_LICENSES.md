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
| Arbres, herbe, bâtiments, routes, ciel, pluie | Générés par le code (`apps/client/src/world`) | Code du projet | Monde |
| Avatar et vélo procéduraux | Générés par le code (`apps/client/src/rider/avatar.ts`) | Code du projet | Coureurs (repli) |
| Sons (vent, pneus, roue libre, oiseaux, pluie) | Synthèse WebAudio (`apps/client/src/audio`) | Code du projet | Ambiance sonore |

## Musique et voix

| Asset | Source | Licence | Usage |
| --- | --- | --- | --- |
| Voix off du tutoriel | Synthèse vocale du système (Web Speech API), script `apps/client/src/onboarding/script.ts` | Voix du système d'exploitation, aucun fichier versionné | Onboarding |
| Musiques Suno | — | À vérifier selon l'abonnement avant tout ajout | Aucune pour l'instant (musique coupée par défaut) |
