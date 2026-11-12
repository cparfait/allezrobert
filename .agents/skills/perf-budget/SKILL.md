---
name: perf-budget
description: Méthode de performance d'Allez Robert — mesurer d'abord avec le panneau F3 (?perf=1 pour le temps GPU), lire le budget d'image et la limite CPU/GPU, trouver la cause unique d'une saccade (compilation de shader, chargement de tuile, GC), corriger, remesurer. À lire quand on parle de fps, saccades, à-coups, lenteur, appels de dessin, triangles, ombres, préréglages graphiques (quality.ts) ou avant d'optimiser du code de rendu.
---

# Performance : mesurer, puis corriger une seule chose

Adapté de `performance-optimization` (awesome-gamedev-agent-skills, Apache 2.0 — voir `SOURCE.md`), relié
aux outils déjà présents dans le client.

## Règle d'or

Ne pas optimiser ce qui n'a pas été mesuré. Boucle : **mesurer → trouver le goulot → corriger celui-là →
remesurer**. Une optimisation qui ne bouge pas la mesure est retirée (elle ajoute de la complexité pour rien).

## Budgets

| Cible | Budget par image |
| --- | --- |
| 60 fps (préréglage `ultra` calibré RTX 4090, `high`/`medium` sur machines courantes) | 16,7 ms |
| 30 fps (préréglage `low`, portables) | 33,3 ms |

Regarder le **95e centile** et le **pire**, pas seulement la moyenne : une saccade de 80 ms toutes les deux
secondes gâche plus qu'une moyenne à 18 ms.

## Outils du projet

- **F3** : panneau `PerfOverlay` (`apps/client/src/engine/perf.ts`) — fps, ms moyen / p95 / max, temps GPU,
  « limite : GPU / CPU préparation du rendu / CPU logique », appels de dessin, triangles, taille de rendu,
  cinq dernières saccades avec leur cause (dont `COMPIL. SHADER ×n`).
- **`?perf=1`** au démarrage : active les mesures GPU (horodatage) — sans lui, « GPU off ».
- **Alt+1 / Alt+2 / Alt+3** (panneau ouvert) : coupe ou rétablit AO, bloom, TAA à chaud ; l'écart de ms donne
  le coût de chaque effet sur la machine.
- `engine/frameStats.ts`, `engine/pipelineStats.ts` : compteurs par image (parts du temps CPU, pipelines
  compilés en direct).
- `engine/quality.ts` : préréglages (taille d'ombres, cascades, distance de vue, densités de végétation et de
  décor, rayon de tuiles, coureurs IA). Un réglage coûteux va dans un préréglage, pas en dur.

## Démarche

1. **Reproduire** : un parcours et un endroit précis (village dense, forêt, montée avec horizon), même
   préréglage, même taille de fenêtre. « Parfois lent » ne se corrige pas.
2. **Lire la limite** dans F3 avec `?perf=1` :
   - **GPU** → résolution (`maxPixels`, `pixelRatio`), ombres (taille, cascades, nombre de projeteurs),
     effets (Alt+1/2/3), surdessin de la végétation.
   - **CPU préparation du rendu** → trop d'objets dessinables : fusionner, instancier (`InstancedMesh`),
     retirer `castShadow` des petits objets, LOD (`.far.glb`), masquer au-delà de la distance de vue.
   - **CPU logique** → profileur de Chrome (onglet Performance) sur la tâche longue ; souvent génération de
     tuile, maillage de route/bâtiments, décodage réseau.
3. **Saccades isolées** : lire la cause notée par F3.
   - `COMPIL. SHADER` → préchauffer le matériau (compiler hors écran au chargement) ou réutiliser un matériau
     existant au lieu d'en créer une variante.
   - Chargement de tuile / modèle → étaler sur plusieurs images, déplacer dans un worker, préparer avant
     d'arriver.
   - Ramasse-miettes → retirer les allocations par image (`new THREE.Vector3()` dans `update`, `clone()`,
     tableaux temporaires) : vecteurs de travail au niveau du module.
4. **Corriger une seule chose**, remesurer au même endroit, noter l'écart (ms, appels, triangles) dans le
   message de commit.

## Pièges

- Mesurer en `pnpm dev` (Vite, sources non minifiées, sondes de dev) au lieu du build ou de l'appli de bureau
  quand le chiffre compte.
- Mesurer avec l'onglet en arrière-plan (cadence bridée par le navigateur).
- Optimiser le CPU quand la limite est le GPU, et inversement.
- Pooler ou fusionner « par principe » : seulement si la mesure montre le coût.
