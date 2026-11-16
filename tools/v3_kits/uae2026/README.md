# Tenue UAE Team Emirates XRG 2026 (essai V3)

Tenue d'essai pour le coureur du style V3 (garage), peinte d'après les photos produit Pissei du body route 2026.
Usage **local seulement** : les logos sont des marques déposées (redessinés avec des polices Windows), et le style V3
repose sur des ressources Zwift jamais distribuées. Les textures produites ne sont pas versionnées.

## Chaîne

1. `export_uv.py` (Blender) : triangles du matériau `CyclistKIT` du coureur V3 (UV + positions + normales) → `kit_tris.json`.
   `blender -b --python export_uv.py -- out/v3/rider/homme-0-<empreinte>.glb <dossier>/kit_tris.json`
2. `raster.py` : carte des positions 3D par texel du dépliage → `<dossier>/maps2048.npz`.
   `python raster.py <dossier> 2048`
3. `paint_uae.py` : motifs décrits sur le corps (repère du coureur : +x devant, +y gauche, +z haut, mètres) puis projetés
   sur le dépliage ; tissu (maille ajourée, côtes du lycra, picots), coutures, plis tirés de la normale Zwift.
   Attend `<dossier>/maps2048.npz` et `<dossier>/ref_normal.png` (normale du maillot Zwift, ex. `out/v3/map/171-normal-0-*.png`).
   `python paint_uae.py <dossier> <dossier>/uae2026` → `uae2026-diffuse.png`, `uae2026-normal.png` (2048²).
4. `render.py` (Blender, Cycles) : rendus de contrôle (face, trois-quarts, profil, dos, dos-34, zoom).
   `blender -b --python render.py -- <rider.glb> <diffuse.png> <normal.png> <préfixe> 64 800 face,dos`

## Dans le garage

Ligne `i = 9001` ajoutée au catalogue de l'étude (`D:/zzCACHE_ALLEZROBERT/zwift-etude/tenues-catalogue.json`), textures dans
`D:/zzCACHE_ALLEZROBERT/zwift-etude/tenues-perso/uae-2026/`. La chaîne V3 ramène les textures à 1024². La tenue apparaît
dans Tenue → Maillot → Équipes pro, « UAE Team Emirates XRG 2026 (essai) » (redémarrer le serveur pour relire le catalogue).
