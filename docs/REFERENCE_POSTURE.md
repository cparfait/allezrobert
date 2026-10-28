# Référence de posture du coureur (route)

Références fournies par l'utilisateur le 24/10/2026 (5 images ; les images ne sont pas copiées dans le
dépôt : licence inconnue, sources web). Mesures relevées à la main, en pixels, sur chaque image
(repères hanche, épaule, coude, poignet, genou, cheville, oreille) ; précision ≈ ±3°.

| Image | Contenu | Dos (hanche→épaule / horizontale) | Épaule (tronc / bras) | Coude | Hanche (tronc / cuisse) | Cou / tête |
|---|---|---|---|---|---|---|
| 14 | route sur home-trainer, angle d'épaule affiché 80,7° | ≈ 44° (position assez relevée) | 80° (mesuré, 80,7° affiché) | ≈ 165° (15° de flexion) | ≈ 106° | tête relevée |
| 15 | route, « drop » selle / guidon important | ≈ 30–36° (dos du maillot presque plat) | ≈ 90° | ≈ 165° | bassin à l'arrière de la selle | nuque dans le prolongement du dos (≈ 15–25° au-dessus de l'horizontale), tête relevée |
| 16 | « mauvaise position » (à ne pas reproduire) | dos rond, trop redressé | 106° | — | 96° | — |
| 17 | angles de référence | 35° | 91° | — | genou 25°, cheville 19° (flexions) | — |
| 18 | « bonne position » | dos presque plat | ≈ 90° | — | ≈ 90° | os de la hanche à la verticale de l'axe de pédale, contact du bassin vers l'arrière de la selle |

Cibles retenues (route) : dos 30–35°, angle d'épaule 80–95°, coudes légèrement fléchis (≈ 155–165°),
bassin au fond de la selle, épaules basses et en avant, nuque dans le prolongement du dos, tête relevée.

Deux Shorts YouTube indiqués (kNLvrCr4ag0, uekjSM38ieI) : non consultés (la page demande un
consentement de cookies avant tout affichage ; je ne l'ai pas accepté).

## Avatar MPFB : avant / après (mesuré au banc d'essai, `avatar-test.html?refview`)

| Mesure | Avant | Après | Référence |
|---|---|---|---|
| Dos (hanche→épaule) | 26° | 30,6° | 30–36° |
| Angle d'épaule | 93° | 94° | 80–91° |
| Coude | 128° | 155° | ≈ 165° |
| Cou (au-dessus de l'horizontale) | 42° | 38° | ≈ 20–40° (nuque dans le prolongement du dos) |
| Bassin (centre des hanches) | z −0,17 (puis −0,20 depuis la correction des fesses) | z −0,20, soit 3 cm en arrière de l'origine ; selle de z −0,33 à −0,09 | au fond de la selle |

Réglages dans `tools/blender/avatars/build_avatar.py` : `ARM_REACH` 0,70 → 0,775, `NECK_DEG` 42 → 38,
`SPINE_SHAPE` {3, 2, 0, −6}, `HIP` z −0,20, `GLUTE_FLAT` 0,6, `BACK_DAMP`. Les mains restent exactement
sur leur cible (102 vélos × 160 / 195 cm × assis / danseuse). Reste écart : angle d'épaule (94° au
lieu de 80–91°) et dos un peu plus relevé que la photo 15 à cause de la géométrie du vélo
(moins de « drop »).

Planches : `docs/screenshots/avatar-ref-avant.jpg`, `avatar-ref-apres.jpg` (profil strict avec repères) ;
comparaisons à côté de l'image 15 (non versionnées, image tierce) : `out/posture-ref/comparaison-avant.jpg`
et `comparaison-apres.jpg`.

## Superposition normalisée (24/10/2026, 2e passe)

Méthode : repères relevés en pixels sur les images 14, 15 et 18 ; origine = axe du pédalier ; échelle
commune par image (14 : longueur de jambe hanche→genou→cheville = 0,852 m de l'avatar ; 15 : diamètre
de roue 193 px = 0,68 m ; 18 : diamètre de roue ≈ 138 px). Les photos ont de la perspective (la roue
avant de la 14 paraît plus grosse que l'arrière) : la normalisation par la roue y est trompeuse,
la longueur de jambe est plus fiable. Écarts avatar − référence en cm (x avant, y haut) :

| Réf. | Hanche | Épaule | Coude | Poignet |
|---|---|---|---|---|
| 14 (avant → après) | (+3, +2) → (+6, +2) | (+9, −6) → (+11, −5) | (+5, 0) → (+6, 0) | (+5, −2) → (+5, −2) |
| 15 | (−5, +6) → (−2, +6) | (+4, +7) → (+6, +9) | (+11, +17) → (+11, +17) | (−7, +7) → (−7, +7) |
| 18 | (+11, −10) → (+14, −10) | (+8, −2) → (+10, −1) | (+10, +7) → (+11, +8) | (−6, +4) → (−6, +4) |

(« avant » = hanche z −0,21 / dos 30,6° ; « après » = hanche z −0,18 / dos 32,4°.)

Lecture :
- Hanche : les références la placent **derrière** l'axe du pédalier (≈ 16 cm sur la 15, 24 cm sur la 14,
  davantage sur la 18) ; l'avatar est à 18 cm : cohérent. Avancer le bassin (z −0,12 à −0,14) donnait
  un dos plus redressé (36°) mais s'éloigne des références et remet le bassin sur le nez de selle.
- Poignet : l'avatar est 5 à 7 cm plus en arrière que les références 15 et 18 et au même endroit que la 14 :
  la cocotte du vélo du jeu (z 0,60) n'est pas plus loin que celle des photos (14 : 0,58 ; 15 : 0,61).
  Il n'y a donc pas de « +35 % de portée » une fois les distances normalisées par la jambe.
- Épaule : plus en avant (+6 à +11 cm) et de 0 à +9 cm plus haute que les références ; dos 32° contre
  44° (14), 36° (15), 21° (18) : moyenne des trois ≈ 34°.
- **Proportions du squelette MPFB (mesurées)** : fémur 0,418 m (attendu pour 1,75 m : 0,43), tibia 0,436 m
  (0,43), humérus **0,252 m (attendu ≈ 0,33)**, avant-bras 0,267 m (0,255). Les jambes sont normales,
  mais le haut du bras est environ 22 % trop court : le coude est donc trop haut/proche de l'épaule
  (écart de coude de +11 / +17 cm sur la 15), ce qui donne l'impression d'un avatar « trop petit pour
  le vélo ». Corriger demande de rallonger l'humérus dans le squelette et le maillage (rig MPFB),
  à décider avec l'utilisateur.
- Stature : jambe (fémur + tibia = 0,854 m) → ≈ 1,71–1,77 m ; `MPFB_HEIGHT_CM` = 175 est cohérent.
  Les vélos du jeu ne sont pas trop grands : roues 700c (0,68 m), selle de z −0,33 à −0,09.

## Réglage sur la référence 14 (3e passe, carte blanche)

Références retenues : la 14 (principale), puis 15 et 18 (repères secondaires). Réglages dans
`tools/blender/avatars/build_avatar.py` : humérus × 1,28 (`HUMERUS_SCALE`, 0,252 → 0,322 m : os et
maillage, peau étirée seulement sur le bras, avant-bras/main/doigts translatés), bassin z −0,215 / y 1,02
(`HIP`), `ARM_REACH` 0,83, cou 38°, + atténuations des fesses et du haut du dos. Côté client : cible de
la paume sur la cocotte z 0,565 (`HOOD_PALM`, avant 0,60 : la paume reste sur le corps de cocotte, qui
s'étend jusqu'à z 0,67).

Écarts avatar − référence 14 (cm ; x avant, y haut ; crank 6 h + 14° comme sur la photo) :

| Repère | Avant (hanche z −0,18) | Après |
|---|---|---|
| Hanche | (+6, +2) | **(+1, +1)** |
| Épaule | (+11, −5) | **(+2, −1)** |
| Coude | (+6, 0) | **(+2, −1)** |
| Poignet | (+5, −2) | **(+2, −1)** |
| Genou | (+2, +3) | **(+1, +3)** |
| Cheville | (0, +2) | **(0, +2)** |

Tous ≤ 3 cm. Angles : dos 40,8° (réf. 42,6°), épaule 84,7° (80,7°), coude 149° (≈ 165°), hanche 101°
(106°), genou 136° (139°). Écarts sur 15 / 18 (hanche, épaule, coude, poignet, cm) :
15 : (−7,+5) (−4,+13) (+7,+17) (−10,+8) ; 18 : (+9,−11) (0,+3) (+6,+7) (−10,+5) — la 15 (position basse
de contre-la-montre) et la 18 (dos plat 21°) sont plus basses/plus plates que la 14 : non visées.

Contrôles : mains exactement sur leur cible (écart < 0,1 mm) sur 102 vélos × 160/175/195 cm × assis/danseuse
(612 cas) ; gravel et VTT à 160/195 cm assis/danseuse ; pieds à distance constante de la pédale sur
tout un tour (160, 175, 195 cm). Géométrie des vélos non modifiée (roues 700c, selle, cintre). Reste : coude
à 149° au lieu de ≈ 165° (pas de gain sans reculer le bassin ou allonger encore l'avant-bras).
Sauvegardes : `out/avatar-avant-bras/` (avant l'humérus), `out/avatar-avant-ref2/`, `out/avatar-avant-ref/`.

## Cou des profils féminins (film4, film6, film7)

Mesure (squelette identique pour tous) : tête / épaule horizontalement 0,14 à 0,165 m pour tous les coureurs
du film, mais menton plus haut sur film4 (0,092 contre 0,066 à 0,082 m au-dessus de l'épaule) : cou plus fin
et plus long (`neckWidth` −0,56 / −0,63, cible `sex−`). Corrigé dans `build_avatar.py` : `NECK_DAMP`
(`sex−` atténuée à 60 % sur le cou), `NECK_KEY_SCALE` (`neckWidth−` à 50 %), `NECK_DEG` 38 → 44° (nuque dans
le prolongement du dos, 41°). Casque, lunettes, queues de cheval et cols inchangés visuellement.
Sauvegarde : `out/avatar-avant-cou/`. Captures : `docs/screenshots/avatar-profil-cou-avant.jpg`, `-apres.jpg`.

## Ventre et tête des profils féminins (film2, 4, 6, 7)

- Profondeur du torse (face avant → dos, au milieu du buste, 175 cm) : 15 à 18 cm sur les profils `sex−`
  contre 20 à 23 cm pour les autres (ventre « rentré » par la cible `sex−`). Corrigé dans `build_avatar.py` :
  `BELLY_DAMP` (déplacement vers le dos de `sex−` atténué à 90 % sur la face avant du torse, taille → poitrine ;
  le buste reste en avant). Après : 19,6 à 21,6 cm vers la taille (autres : 19 à 22).
- Tête : la tête est à la même distance de l'épaule pour tous (squelette identique) ; l'impression de tête
  trop avancée vient du torse moins profond et du cou. Côté client (`gltfAvatar.ts`, `NECK_LIFT` = −0,12 rad ×
  morphologie féminine) : cou relevé, tête ≈ 1,5 cm plus en arrière et un peu relevée ; plus (−0,2) le casque
  se met à regarder en l'air. Les autres coureurs sont inchangés.
- Sauvegarde : `out/avatar-avant-tete/`. Captures : `docs/screenshots/avatar-profil-ventre-apres.jpg`,
  `avatar-profil-tete-apres.jpg`, `avatar-profil-tete-rear.jpg` (les « avant » : `avatar-profil-cou-apres.jpg`).

## Poitrine des profils féminins

Après `BELLY_DAMP` 0,9 le buste faisait un creux sous la clavicule puis un ventre plein. Réglage dans
`build_avatar.py` : macro `cupsize` 0,5 → 0,75 pour la cible `sex−` (poitrine plus volumineuse, valeur modérée)
et `BELLY_DAMP` 0,9 → 0,6 (ventre moins plein) : ligne poitrine → ventre → bassin en courbe douce, sans creux.
Hommes inchangés. Sauvegarde : `out/avatar-avant-poitrine/`. Captures : `docs/screenshots/avatar-profil-poitrine1.jpg`
(profil strict, film0/2/4/5/6/7/8), `avatar-profil-poitrine-danseuse.jpg` (danseuse), `avatar-film-tenues.jpg`
(face et profil des 10). Avant : `avatar-profil-tete-apres.jpg`.

## Avatar féminin dédié (`rider_female*.glb`)

Modèle MPFB féminin de base (`build_avatar.py --variant female`, macro `gender` 0, `height` 0,62, `cupsize` 0,5), choisi
par `GltfRiderAvatar` pour les looks `sex ≤ −0,25` (types chargés ensemble : `['mpfb', 'female']` par défaut ; sans
fichiers féminins le jeu garde l'avatar de base). Mêmes textures de peau et de tissu que le modèle de base. Les
correctifs `sex−` du modèle de base (BELLY_DAMP, NECK_DAMP, cupsize 0,75, NECK_LIFT) ne servent plus qu'en repli.
Réglages de build : `--height 0.62 --humerus 1.26 --forearm 1.12 --reach 0.83 --cup 0.5` (commande : `out/rebuild-female.sh`, puis
`out/install-female.sh` qui copie vers `rider_female*.glb`). Stature de référence 1,748 m (`FEMALE_HEIGHT_CM` 175), fémur 0,434, tibia
0,409, humérus 0,262 → 0,330, avant-bras 0,232 → 0,260 (jambes à la longueur du vélo de référence : la taille du joueur
met l'ensemble à l'échelle par `sizeOf`). Fichiers : 1,69 + 1,00 + 0,84 Mo.

Mesures sur la géométrie du jeu (banc d'essai `?refview`, vélo route, pédale en bas = manivelle à 6 h pour le pied droit ;
angles sur un tour de pédale par pas de 15°) :

| Coureur | Genou à 6 h | Genou min–max | Hanche min–max | Coude min–max | Épaule |
|---|---|---|---|---|---|
| Homme 160 cm | 147,9° | 63–149° | 51–105° | 146–151° | 85° |
| Homme 175 cm | 140,9° | 65–142° | 53–101° | 146–151° | 85° |
| Homme 195 cm | 134,4° | 68–135° | 56–98° | 146–151° | 85° |
| Femme 160 cm | 152,3° | 63–154° | 56–108° | 149–155° | 82–83° |
| Femme 175 cm | 144,3° | 66–146° | 58–104° | 149–155° | 82–83° |
| Femme 195 cm | 137,3° | 69–138° | 60–101° | 149–155° | 82–83° |
| Plages (schémas 36–38) | 145° ± 5 | 65–145 | 60–110 | 150–160 | 65–80 |

Le genou à 6 h sort de la plage 140–150° pour les grands (195 cm : 134–137°, selle trop basse) : la mise à l'échelle uniforme
de `sizeOf` laisse roues et pédalier à taille réelle ; une hauteur de selle propre à la taille reste à faire (chantier « vélo
adapté à la taille », non traité). Pied : pédale inclinée de `REST_PITCH` 0,35 rad (20°) au point bas : dans la plage 15–20°.
Hanche par rapport au pédalier (6 h, 175 cm) : x −23 cm, y +75 cm (photo 14 : −24 / +74). Cocotte : paume à z 0,565, y 0,90
(0,57 m devant le pédalier). Nuque 44° (plage externe 30–38° : non appliquée, la tête serait plus en avant).
Segments pour 1,75 m (Winter : fémur 0,43, tibia 0,43, humérus 0,326, avant-bras 0,255) : homme fémur 0,418 / tibia 0,436 /
humérus 0,322 (corrigé) / avant-bras 0,267 ; femme fémur 0,434 / tibia 0,409 / humérus 0,330 / avant-bras 0,260.
Mains : exactement sur la cible (écart < 0,05 mm) sur 102 vélos × 160/165/175 cm × assis/danseuse pour le modèle féminin
(612 cas). Photos féminines 28 à 34 : dos relevé à environ 28–30° (31, 34), plus de 50° en côte (28) ; l'avatar féminin est à 39° ;
non superposées au pixel (échelle et perspective trop incertaines).
Mensurations (modèle féminin ramené à 1,67 m, sections du torse seul sans cuisses) : poitrine ≈ 78–85 cm, taille ≈ 66–70 cm,
hanches ≈ 80 cm (sous-estimées : cuisses exclues) ; cibles 88–92 / 68–72 / 92–98 : poitrine et hanches un peu fines. Ces
mensurations sont des réglages de build (macros `cupsize`, `proportions`), non exposés comme curseurs du look.

### Fessiers du modèle féminin

Vues de dos (photos de référence de coureuses) : deux fesses rondes séparées par le pli central, au-dessus de la selle, la
cuisse s'en détachant plus bas. Dans le modèle, le haut de la fesse était porté par la cuisse : à la flexion de hanche de
la position de course et à chaque coup de pédale, la fesse de la jambe levée s'écrasait en diagonale et l'autre gonflait
(collage linéaire des poids, figé aussi dans la pose de repos). `stabilize_glutes` (`build_avatar.py`) reporte le poids de
cuisse sur le bassin pour l'arrière de la hanche, du haut jusqu'au pli fessier (`GLUTE_PELVIS` 1, `GLUTE_FOLD` 0,19 m,
`GLUTE_SIDE` 0,24 m ; options `--glute-pelvis/-fold/-side`), le côté de la hanche et la cuisse gardant leurs poids.
Ces valeurs sont les constantes par défaut ; les deux modèles (`rider*.glb` et `rider_female*.glb`) sont reconstruits avec. Banc d'essai :
`avatar-test.html?avatar=mpfb&profil&behind&low&big&spin=0,90,180,270&morphs=sex:-1&only=sex:-1` (`&greyshorts` : cuissard gris
pour lire les volumes, `&side` : trois quarts arrière). Sauvegarde avant : `out/avatar-avant-fesses2/`.

**Désactivé le 28/10/2026** (`GLUTE_PELVIS` 0 : retour aux fesses du 27/10, commit bbaf413). Porté par le bassin penché de
la position de course, le bas de la fesse pivotait vers l'arrière et finissait en pointe au ras de la selle (« étagère »,
« trop pointu en bas »). Mesure faite à cette occasion : au repos, la chair des fesses descend jusqu'à y 0,88 alors que le
dessus de la selle des vélos de base est à y 0,955 (emprise x ±0,072, z −0,332 à −0,088) ; elle traverse donc la selle
de 7 à 8 cm, masquée par la selle et le cuissard noir.

## Vélo adapté à la taille (hauteur de selle et de cintre)

`gltfAvatar.ts` : `saddleLiftFor(k)` calcule, d'après les longueurs réelles du squelette (fémur, tibia), la manivelle réelle
(non mise à l'échelle) et le pied sur la pédale en bas, le décalage vertical qui donne un **genou à 145° pédale en bas**
(`KNEE_BOTTOM_DEG`). Ce décalage monte ou descend ensemble la selle, le poste de pilotage (cocottes), le bassin et les
cibles des mains, donc buste et coudes restent identiques d'une taille à l'autre. Roues et pédalier gardent leur taille
réelle (échelle inverse déjà en place) ; cadre, tige et cintre suivent la taille du coureur par `sizeOf`. Pas de
réglage pour le VTT (kit de cadre propre : selle et poignées fusionnées). Le haut de tige de selle et la potence peuvent
laisser un jour de 0 à 3 cm (non visible à distance de jeu).

Mesures (banc d'essai, vélo route Cervélo S5, chrono UAE TT1, gravel ; pas de 15° sur un tour ; genou à 6 h =
manivelle verticale, pédale droite) :

| Coureur | Genou à 6 h (avant → après) | Genou min–max | Hanche min–max | Coude | Épaule | Décalage selle |
|---|---|---|---|---|---|---|
| Homme 160 | 147,9° → 145° | 62–146 | 50–103 | 146–151 | 85 | −0,6 cm |
| Homme 175 | 140,9° → 145° | 67–146 | 55–103 | 146–151 | 85 | +1,0 cm |
| Homme 195 | 134,4° → 145° | 72–146 | 59–103 | 146–151 | 85 | +2,8 cm |
| Femme 160 | 152,3° → 145° | 61–147 | 54–104 | 149–155 | 82–83 | −1,5 cm |
| Femme 175 | 144,3° → 145° | 66–146 | 58–104 | 149–155 | 82–83 | +0,2 cm |
| Femme 195 | 137,3° → 145° | 72–146 | 62–104 | 149–155 | 82–83 | +1,9 cm |

Chrono : genou à 6 h 146–147°, hanche 28–82°, coude 57–73°, épaule 60–67° (position aéro). Gravel : identique à la route. Mains
exactes sur 1224 cas (modèles masculin et féminin × 102 vélos × 160/175/195 cm × assis/danseuse) ; distance pied–pédale
constante sur un tour. Coude masculin (146–151°) un peu sous la plage 150–160° (plage externe) ; nuque 44° inchangée.
