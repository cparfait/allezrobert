---
name: asset-provenance
description: Registre des licences et de la provenance des assets d'Allez Robert (ASSETS_LICENSES.md) et contrôles d'un modèle 3D avant de l'ajouter au jeu. À lire dès qu'un modèle, une texture, un son, une musique, une police, une donnée ou un décor généré (FLUX, TRELLIS, Suno, Cartesia, Sketchfab, Poly Haven, Quaternius…) entre dans le dépôt ou dans public/, ou quand on parle de licence, crédit, attribution, CC BY, IA générative.
---

# Provenance des assets

Adapté de `create-game-assets` (références `provenance` et `three-d-pipeline`, awesome-gamedev-agent-skills,
Apache 2.0 — voir `SOURCE.md`). Tenue de registre, pas un avis juridique.

## Règle

**Tout asset qui entre dans le dépôt ou dans le jeu a sa ligne dans `ASSETS_LICENSES.md`, dans le même
commit.** Aucun asset de Zwift, MyWhoosh ou d'un autre jeu.

## Ce que la ligne doit dire

- chemin(s) dans le dépôt (`apps/client/public/...`) et variantes (`.far.glb`, `_lod1.glb`) ;
- source : URL d'origine et auteur (pas un site miroir), ou outil de génération avec **modèle et version** ;
- pour un asset généré : où sont l'invite et la graine (ex. `tools/blender/props/catalogue.json`) ;
- licence exacte (CC0, CC BY 4.0, CC BY-SA 4.0…) et **texte de crédit** quand elle l'exige ;
- modifications faites et par quel script (`tools/blender/...`) ;
- usage dans le jeu.

Les assets générés sont aussi listés dans la section « Contenu généré par IA » du registre, en distinguant
**généré pendant le développement** (fichiers livrés) et **généré pendant le jeu** (voix du tutoriel) : c'est
ce que demandent les questionnaires des boutiques (Steam, section IA générative).

## Décisions

1. « Gratuit », « libre de droits », visible sur un moteur de recherche ou généré par un modèle : ce n'est pas
   une licence. Vérifier les conditions sur la page d'origine.
2. CC BY : crédit conservé à travers renommage, conversion, simplification, atlas.
3. CC BY-SA : le modèle adapté et son script restent sous BY-SA (cf. VTT) ; le reste du jeu n'est pas concerné.
4. Licence du modèle génératif ≠ licence des outils qu'il charge : noter les deux quand elles diffèrent et
   signaler à l'utilisateur toute clause non commerciale.
5. Pas d'invite qui imite un artiste vivant ; décrire des propriétés visuelles.
6. Conditions floues ou sortie commerciale en jeu → le signaler à l'utilisateur plutôt que trancher.

## Contrôles d'un modèle 3D (Sketchfab, TRELLIS, Blender) avant `public/models`

Un beau rendu ne prouve pas une géométrie utilisable. Vérifier dans Blender / dans le jeu :

- échelle réelle (mètres), axe Y vers le haut, origine au sol au pied de l'objet ;
- pas de faces internes, de normales inversées ni de géométrie dégénérée (fréquent sur TRELLIS) ;
- budget : triangles du `.glb` proche et du `.far.glb`, textures dimensionnées d'après la taille à l'écran ;
- matériaux PBR cohérents, pas d'éclairage cuit dans la couleur de base ;
- compression Meshopt / KTX2 par `tools/blender/vehicles/optimize.mjs` ;
- vu dans le jeu à la distance réelle, sous le soleil et la nuit, et coût lu dans F3 (voir `perf-budget`).
