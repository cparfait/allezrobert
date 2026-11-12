---
name: camera-feel
description: Règles de caméra d'Allez Robert (poursuite, vues embarquées, drone, TV, photo, regard arrière) — lissage indépendant de la cadence, vibrations ajoutées après le lissage, recalage sans lissage après un saut, bras anti-façades et cadrage du coureur. À lire avant de toucher apps/client/src/game/cameras.ts, chaseFraming.ts ou freecam.ts, ou quand on parle de caméra qui tremble, fouette, saccade, traverse un bâtiment, perd le coureur, ou de sensation de vitesse.
---

# Caméra : ce qui doit rester vrai

Adapté de `camera-systems` (awesome-gamedev-agent-skills, Apache 2.0 — voir `SOURCE.md`), réduit à ce qui
s'applique à un jeu Three.js de vélo et relié au code du projet.

## Où est quoi

| Sujet | Fichier |
| --- | --- |
| Toutes les vues (`RigMode`), lissage, FOV de vitesse, vibrations | `apps/client/src/game/cameras.ts` (`CameraRig.update`) |
| Bras qui s'arrête avant la façade, cadrage du coureur (`keepInFrame`) | `apps/client/src/game/chaseFraming.ts` (+ `test/chaseFraming.test.ts`) |
| Caméra libre | `apps/client/src/game/freecam.ts` |
| Appel par image, recalage après un saut (`rig.setMode('chase')`) | `apps/client/src/main.ts` |

## Règles

1. **Lissage indépendant de la cadence.** Toujours `x += (cible - x) * (1 - Math.exp(-dt * taux))`
   (ou `v.lerp(cible, 1 - Math.exp(-dt * taux))`). Jamais `lerp(…, 0.1)` par image ni `Math.min(1, dt * k)` :
   la sensation changerait entre 30, 60 et 144 Hz. Taux usuels du projet : 2 (drone, flottant) à 12 (photo,
   vues embarquées), 30–50 pour « presque solidaire ».
2. **Vibrations et secousses en dernier, en décalage additif.** Lissage → bras/collision → cadrage → *puis*
   vibration (`buzzOffset`, vibration de vitesse). Une vibration ajoutée à la cible *avant* le lissage est
   filtrée par lui (passe-bas) : à 37 Hz derrière un lissage de taux 5, il reste ~2 % de l'amplitude.
3. **Mettre à jour la caméra après le coureur.** `rig.update` reçoit la position déjà calculée de l'image
   (physique, interpolation réseau) ; ne pas l'appeler avant le pas de simulation, sinon une image de retard
   et une saccade.
4. **Recaler sans lissage après une téléportation** (saut sur le parcours, changement de zone, de coureur suivi,
   de vue) : `setMode(mode)` remet `initialized`, `subjectInit`, `frameHint` et le bras à zéro. Sinon la caméra
   traverse la carte en « fronde ».
5. **Le coureur reste dans le cadre.** En poursuite, le bras (`boom`) s'arrête avant le premier bâtiment entre
   le coureur et la caméra, testé à chaque image depuis la position lissée ; le regard est ramené dans le champ
   (`keepInFrame`). Ne pas contourner ces deux étapes pour une nouvelle vue qui suit le coureur.
6. **Jamais sous le terrain** : borne `groundAt(x, z) + 0,6 m` sur la position voulue, avant le lissage.
7. **Vues embarquées solidaires** (cockpit, action, gopro) : position copiée, pas lissée — un retard fait
   « nager » le cintre. Le lissage reste sur le regard.
8. **Angles par le plus court chemin** : `atan2(sin(Δ), cos(Δ))` avant de lisser un cap.
9. **Tangage borné** dans les vues à la souris (photo : −0,2 à 1,3 rad) ; jamais de roulis cumulé.
10. **Pas d'allocation par image** dans `update` : vecteurs de travail au niveau du module (`_center`, `_up`…).

## Vérifier

- Rouler à cadence basse et haute (onglet en arrière-plan, `?perf=1` + F3 pour lire la cadence) : même
  sensation de suivi.
- Épingles et rues étroites (Alpe d'Huez, villages) : le vélo reste visible, la caméra ne traverse pas les murs.
- Saut sur le parcours / changement de vue : pas de balayage à travers la carte.
- `pnpm vitest run apps/client/test/chaseFraming.test.ts` après toute modification du cadrage.

## Hors sujet ici

Orbite à ressort de type Cinemachine, zone morte 2D, cadrage multi-cibles et écran partagé : rien de cela
dans le jeu aujourd'hui ; voir la source amont si le besoin apparaît.
