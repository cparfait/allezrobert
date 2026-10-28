# Fork « jeu vidéo » (low poly) — analyse et mise en œuvre

> Branche `fork/low-poly`. Référence : la vidéo de NCT Ride (« J'ai demandé à une IA de recréer Zwift… »,
> octobre 2026), sa transcription et les captures d'écran fournies.

## 1. Ce que montre la vidéo

### Le rendu

Le style s'appelle **low poly** (« peu de polygones ») avec **flat shading** (une couleur unie par facette) :

| Élément | Ce qu'on voit | Ce que ça demande techniquement |
| --- | --- | --- |
| Arbres feuillus | gros houppiers en icosaèdres à facettes, vert pomme, **pommes rouges** posées dessus, troncs bruns à 5–6 pans | 50 à 200 triangles par arbre, normales de face, aplats |
| Conifères | cônes empilés à facettes | idem |
| Herbe | touffes hautes vert vif, pointes claires | cartes instanciées, sans texture |
| Fleurs | petites tiges et corolles rouges, roses, blanches, jaunes sur les bas-côtés | milliers d'instances de quelques triangles |
| Clôtures | lisses blanches (haras) et clôtures en bois le long des routes | poteaux et lisses instanciés |
| Poteaux électriques | poteaux en bois avec câbles fins qui pendent | lignes de 1 pixel en chaînette |
| Route | enrobé gris foncé uni, accotement clair, lignes nettes | aucune texture photo |
| Bâtiments | volumes simples, aplats pastel, fenêtres sombres en aplat, toits rouges ou ardoise | couleurs par sommet, aucune texture |
| Eau | bleu franc, reflets doux | une seule octave de vaguelettes |
| Ciel | bleu pâle à blanc laiteux, quelques nuages plats | dégradé simple |
| Cyclistes | corps à facettes, maillots à grands aplats (bandes), casques à aérations, vélos simples | ~1 000 triangles, aucune texture de peau ou de tissu |
| Véhicules | voitures, camions, tracteurs en volumes simples | quelques centaines de triangles |

### Le monde vivant (transcription)

- Circulation qui se décale et ralentit pour doubler, tracteurs, camion, voitures en face.
- Personnages : joggers qui font demi-tour, enfant qui salue, pêcheurs, terrain de foot, public avec pancartes dans les montées.
- Animaux : vaches (avec leurs sons), chevaux sur l'hippodrome, oiseaux, papillons.
- Train déclenché quand le coureur arrive à un point précis.
- Poussière derrière la roue sur le gravel, photo au sommet des montées répertoriées.
- Ambiances sonores spatialisées : cloches, oiseaux, vaches, mer, enfants au mini-golf, chevaux (plus fort quand on s'approche).
- Caméras : poursuite, cockpit, action-cam ventrale, drone, réalisation TV.

### Le jeu (déjà largement présent dans Allez Robert)

Sortie de groupe avec IA (pourcentage de FTP réglable, relais, aspiration y compris légèrement décalé),
course contre l'IA avec stratégies et réserve d'énergie, défis KOM, séances d'entraînement, XP, niveaux
et trophées qui débloquent cadres, roues et tenues, personnalisation (vélo route, aéro, VTT ; roues alu,
40, 55, 88 ; chaussettes hautes), pilotage par Zwift Play, rapport de fin, .fit et image pour Strava.
**Allez Robert a déjà presque tout cela** (peloton, course, KOM, entraînement, garage, trophées, trafic,
trains, public, poussière, caméras TV et drone, photo au sommet, export .fit et Strava). L'écart est
surtout **visuel** et dans la **densité de vie** du décor.

## 2. Pourquoi le low poly permet « plus d'objets »

| Poste | Réaliste (branche principale) | Low poly (ce fork) |
| --- | --- | --- |
| Sol | orthophoto JPEG par tuile + bruits procéduraux par pixel | aplats par occupation du sol, **orthophotos non téléchargées** |
| Routes | photo d'asphalte (Poly Haven) + usure procédurale | enrobé uni, **photo jamais chargée** |
| Façades et toits | 5 textures photo + 5 cartes de normales | couleurs par sommet, **aucune texture chargée** |
| Arbres | normales sphériques, contre-jour, rameaux d'hiver | facettes, sans contre-jour |
| Coureurs | GLB MPFB 28 k triangles, peau SSS (3 textures), tissu (normales, lustre) | **modèle procédural d'environ 1 000 triangles, aucun téléchargement** |
| Véhicules | GLB de 10 modèles (+ versions lointaines) | primitives à facettes, **aucun téléchargement** |

Moins de textures, donc moins de mémoire graphique, de bande passante et de temps de chargement. Des
shaders plus courts, donc des pixels moins chers. Des objets de quelques dizaines de triangles instanciés
par milliers : c'est ce budget qui finance les clôtures, les poteaux, les fleurs et les troupeaux.

## 3. Ce qui est fait dans ce fork

Le style se choisit dans **Réglages → Graphismes → Style graphique : Jeu vidéo / Réaliste** (rechargement
de la page), ou par `?style=lowpoly|real`. Valeur par défaut du fork : jeu vidéo. Tout est derrière le
drapeau `LOW_POLY` (`apps/client/src/engine/style.ts`), si bien que le rendu réaliste reste intact et que
le travail peut être rapatrié dans la branche principale comme une option.

| Fichier | Changement |
| --- | --- |
| `engine/style.ts` | drapeau global `LOW_POLY`, `setGraphicStyle()` |
| `ui/menu.ts` | réglage « Style graphique » |
| `world/terrain.ts`, `world/fileWorld.ts` | matériau du sol en aplats francs (taches en 3 paliers), facettes, palette vive ; orthophotos non téléchargées |
| `world/horizon.ts` | relief lointain sans orthophoto, palette claire, facettes |
| `world/road.ts`, `world/asphalt.ts` | enrobé uni, rive nette, accotement clair, marquages francs |
| `world/clouds.ts` | ombres de nuages coupées (aplats lisibles) |
| `world/water.ts` | eau bleu franc, une octave de vaguelettes |
| `world/vegetation.ts` | feuillus refaits (icosaèdres à facettes, **fruits rouges** sur 4 arbres sur 10), sapins à facettes, buissons en icosaèdres, palette vert pomme, sans contre-jour |
| `world/grass.ts` | herbes vert vif |
| `world/buildings.ts` | façades et toits en aplats (couleur de chaque maison), fenêtres et volets gardés, facettes |
| `world/roadsideLife.ts` (nouveau) | **clôtures** blanches ou en bois, **poteaux électriques et câbles**, **fleurs**, **cailloux**, troupeaux de **vaches, moutons et chevaux** qui broutent (tête animée) ; 8 appels de dessin et une ligne pour tout le parcours |
| `rider/lowPolyRider.ts` (nouveau) | **cycliste et vélo low poly refaits de zéro** : corps en prismes, casque à aérations, lunettes, barbe, maillot avec bande, cadre en tubes hexagonaux bicolore, roues à rayons ; pédalage, danseuse, roue libre, bras levés à l'arrivée |
| `rider/gltfAvatar.ts`, `rider/bikes.ts`, `rider/flatLook.ts` | `createAvatar` renvoie le cycliste low poly ; facettes sur les vélos du catalogue (garage) |
| `world/lowPolyVehicles.ts` (nouveau), `world/traffic.ts` | véhicules low poly refaits (voitures, utilitaires, camions, tracteurs), aucun GLB téléchargé |
| `ui/waitBike.ts` | écran d'attente : Robert en low poly (`public/robert-lowpoly/velo.png`, `attente.png`), repli sur l'illustration d'origine |

## 4. Suite proposée (par ordre d'intérêt)

1. **Personnages au bord de la route** : joggers, promeneurs avec chien, enfants qui saluent, pêcheurs au bord
   de l'eau, construits comme le cycliste low poly (mêmes prismes), animés simplement.
2. **Sons d'animaux spatialisés** (vaches, moutons, chevaux) branchés sur les troupeaux de `roadsideLife.ts`
   (le moteur audio sait déjà jouer des sources positionnées par tuile).
3. **Oiseaux et papillons** : petites volées en V dans le ciel, papillons au-dessus des fleurs (instances animées
   dans le shader).
4. **Ciel stylisé** : dégradé simple et nuages plats en cartes, à la place du ciel physique.
5. **Bâtiments refaits** : toits plus épais à débord marqué, fenêtres en volumes, cheminées, comme les maisons
   de la vidéo (la géométrie actuelle est fidèle à l'emprise réelle, c'est un atout à garder).
6. **Garage et menu** : décor du garage en low poly, vignettes des vélos refaites.
7. **Contour optionnel** (outline) pour un rendu plus « dessin » ; la branche `feat/perso-toon` en contient un essai.
8. **Clôtures et accès** : ouvrir les clôtures devant les chemins et les entrées de champs (routes OSM latérales).
9. Ne plus précharger les GLB des coureurs en style jeu vidéo (chargement plus court).
