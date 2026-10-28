# Étude performance : saccades et coupures en roulant

*25 octobre 2026 — mesures sur la machine de développement (Windows 11, RTX série 40 « Lovelace »,
Chrome 155 / WebGPU-D3D12), monde Billom, qualité basse, simulateur à 1 500 W (≈ 70 km/h).*

> **Mise à jour du 25 octobre (P0, P1, P2 faits)** : en qualité basse, **plus aucune image de plus de
> 100 ms** en 60 s de route (39 → 174 fps, 0 shader compilé en roulant) ; en qualité haute, 81 fps et
> une seule saccade de plus de 250 ms par minute (passage d'une rangée de tuiles). Détail au § 7.

## En bref

- **Les coupures ne viennent ni de la carte, ni du chargement des tuiles, ni du ramasse-miettes,
  ni de la puissance du GPU.** Elles viennent de **la compilation de shaders en pleine sortie** :
  le jeu fabrique un shader différent pour presque chaque nouvel objet (bloc d'arbres, cycliste
  animé…), et chaque shader neuf bloque le processus GPU de Chrome **de 60 ms à 2 s** le temps
  que DirectX le compile. Rien ne s'affiche pendant ce temps : c'est le poste « autre » du panneau F3.
- La cause exacte est un comportement de three.js r186 (voir § 2.1) : **deux lignes à changer**.
  Essai fait sur le vrai jeu : de 159 shaders compilés en 60 s de route à **5**, saccades > 250 ms
  de 7 à **2**, 39 → **58 fps** de moyenne.
- Deuxième cause, du côté du jeu : la **collision de la caméra poursuite** lance un rayon contre
  tous les triangles de tous les bâtiments chargés. C'est **45 % du temps processeur** de
  l'image en village ; sans elle : 58 → **86 fps**.
- **Changer de moteur (Unreal, Unity, Godot) n'est pas nécessaire** et ne réglerait pas le
  problème de lui-même : ces moteurs ont exactement la même famille de saccades (compilation
  des PSO) et la traitent avec les mêmes remèdes que ceux proposés ici. On garde three.js +
  WebGPU + l'application Tauri qui existe déjà.

## 1. Méthode

Le panneau F3 attribuait les saccades à « autre » (non mesuré). Pour voir ce qu'il y a dedans :

1. Un Chrome dédié piloté par script (WebGPU actif, sans ralentissement d'arrière-plan) lance
   `?world=billom&autostart&nointro&quality=low`, pousse le simulateur à 1 500 W, puis roule 60 s.
2. Pendant ce temps : **trace DevTools complète** (fil principal, processus GPU, Dawn), **profil
   processeur échantillonné** (0,5 ms), *Long Animation Frames*, intervalles entre images, et
   compteurs de tous les appels WebGPU (`createRenderPipeline`, `writeBuffer`…), avec le code WGSL
   de chaque shader créé.
3. Essais A/B : three.js corrigé à la volée (interception de la requête, sans toucher au dépôt),
   collision caméra coupée, chacun avec un cache de shaders vierge.

Outil de mesure versionné depuis : [`tools/perf`](../tools/perf/README.md)
(`pnpm --filter @allezrobert/perf measure`). Scripts d'enquête : `out/perf-study/` (non versionné).

## 2. Ce qui cause les saccades (mesuré)

### 2.1 Cause n° 1 — un shader neuf pour chaque objet, compilé en bloquant le GPU

Dans la trace du lancement + 30 s de route : **245 pipelines de rendu, 343 shaders**, et dans le
processus GPU de Chrome :

| Poste (processus GPU) | Nombre | Total | Pire |
|---|---|---|---|
| `CompileShaderDXC` (compilation DirectX) | 347 | **24,0 s** | **1 607 ms** |
| `DeviceBase::APICreateRenderPipeline` | 245 | 24,7 s | 2 147 ms |
| `tint::hlsl::writer::Generate` (WGSL → HLSL) | 347 | 0,7 s | 18 ms |
| Ramasse-miettes du fil principal (toutes passes) | — | 0,3 s | 33 ms |

Chaque longue tâche du GPU (90 tâches de 80 ms à 3,6 s) est une compilation. three.js crée ses
pipelines de façon **synchrone** au premier rendu d'un objet (`device.createRenderPipeline`) :
l'appel JavaScript ne prend que 0,1 ms (d'où « rendu 8 ms » dans F3), mais le processus GPU,
occupé à compiler, ne peut plus présenter d'image.

**Pourquoi autant de shaders ?** Après 100 s de route, 530 codes WGSL distincts, et le nombre
grandit avec la distance (159 nouveaux en 60 s de route, même avec un cache chaud). En comparant
les codes, deux constructions de three.js r186 rendent presque chaque objet unique :

1. **Instanciation** (`three/src/nodes/accessors/Instance.js`, `createInstanceMatrixNode`) : un
   `InstancedMesh` de moins de 1 024 instances range ses matrices dans un *uniform buffer* dont la
   **taille** est écrite dans le shader (`array<mat4x4<f32>, 137>`). Chaque bloc d'arbres
   (`vegetation.ts`), de roseaux (`water.ts`), de figurants (`crowd.ts`) a un nombre d'instances
   différent → un shader par bloc. **312 des 530 shaders.**
2. **Nommage des tampons** (`WGSLNodeBuilder.getUniformFromNode`) : ces tampons s'appellent
   `NodeBuffer_<identifiant du nœud>` dans le code, identifiant unique par objet. Même à taille
   égale le code diffère. Les matrices d'os des coureurs (`Skinning.js`) aussi : **chaque
   cycliste animé qui apparaît (IA, trafic, public) a ses propres shaders**, ombre comprise
   (≈ 145 shaders).

three.js ne réutilise un programme que si le code est identique à l'octet près : tout cela part
en compilation. Le cache disque de Chrome (Dawn) fonctionne (384 réutilisations observées au
2ᵉ lancement), mais il ne peut pas servir pour des shaders qui n'existaient pas encore.

Les captures du panneau F3 collent avec ce schéma : « rendu 6–12 ms · autre 443 / 480 / 567 ms ».

### 2.2 Cause n° 2 — la collision de la caméra poursuite

`main.ts:815` : `rig.occluders = [world.buildings.group]`. Une image sur trois,
`cameras.ts:148` lance un rayon tête → caméra contre **tout** le groupe bâtiments. Les bâtiments
d'une tuile sont fusionnés en grands maillages de 1 km : la sphère englobante est toujours
touchée, three.js teste alors chaque triangle (`checkGeometryIntersection` → `intersectTriangle`),
sans structure d'accélération.

Profil processeur (60 s de route, three.js corrigé) : **25,2 s sur 56 s** passées dans
`CameraRig.update`, et la pire image (1 071 ms) y passait 474 ms. Sans cette collision :
**58 → 86 fps** de moyenne.

### 2.3 Fond de coût processeur du rendu (pas des saccades, mais de la marge)

Une fois les deux causes retirées, le temps processeur va au rendu de three.js lui-même :

| Poste | Part du temps (60 s) |
|---|---|
| `updateMatrixWorld` (matrices recalculées pour tout le décor, chaque image) | ≈ 17 % |
| `writeBuffer` : ≈ 800 envois d'uniformes par image (un par objet et par passe) | ≈ 5 % |
| Préparation des objets (`_renderObjectDirect`, liaisons, projections) | ≈ 15 % |

Reste à élucider : une image isolée de ≈ 1 s, entièrement dans `pipeline.render()` sans poste
dominant (à suivre avec l'instrumentation proposée au § 6).

### 2.4 Ce qui n'est **pas** en cause

- **Le format de la carte et le chargement des tuiles** : téléchargement, `JSON.parse`, décodage
  des altitudes, décodage des orthophotos (5–13 ms par image) restent petits. La construction
  des entités est déjà étalée (`WorkQueue`, 4 ms par image). À améliorer plus tard (§ 5, P1),
  mais pas la source des coupures.
- **Le ramasse-miettes** : 33 ms au pire, 0,3 s en tout sur la trace.
- **Le GPU** : il n'est pas à la peine (une RTX 40 coupe aussi). Baisser la qualité ne change
  rien aux coupures : le nombre de shaders à compiler ne dépend pas de la qualité.
- **Le navigateur en soi** : WebView2 (l'application Tauri) et Chrome passent par le même
  moteur (Dawn → D3D12 → DXC). Le problème est le même dans les deux.

## 3. Preuve : essais A/B sur le vrai jeu

Billom, qualité basse, 60 s de route après 20 s de mise en route, cache de shaders vierge.
Chrome sans écran (pas de synchro verticale : les fps dépassent 60).

| Essai | Shaders créés en roulant | Saccades > 100 ms | > 250 ms | fps moyen |
|---|---|---|---|---|
| A. Jeu actuel | **159** | 21 | 7 | 39 |
| B. three.js corrigé (2 changements) | **5** | 6 | 2 | 58 |
| E. B + collision caméra coupée | **0** | 11 * | 2 | **86** |

\* Saccades courtes de 100–200 ms dans le rendu (§ 2.3), à 86 fps de moyenne.

Correctifs essayés en B :
1. `Instance.js` : toujours prendre la voie « attributs d'instance » (4 attributs `vec4`) au lieu
   du *uniform buffer* dimensionné → plus de taille écrite dans le code.
2. `WGSLNodeBuilder` : nommer les tampons dans l'ordre d'apparition dans le shader
   (`NodeBuffer_0`, `_1`…) plutôt que par identifiant de nœud.

Rendu vérifié à l'œil (arbres instanciés, coureur animé) : identique.

## 4. Pourquoi l'autre jeu (capture) est fluide

Son style « low poly » à couleurs unies a très peu de matériaux différents, donc très peu de
shaders : une fois compilés au démarrage, plus rien à compiler en route. Notre problème ne tient
pas au réalisme : avec les correctifs, le jeu entier tient en ≈ 130 shaders, compilés une fois.

## 5. Faut-il changer de techno ?

| Option | Règle les coupures ? | Coût | Avis |
|---|---|---|---|
| **Corriger three.js + le jeu (ce document)** | **Oui, mesuré** | Jours | **Recommandé** |
| Tauri / WebView2 (déjà en place) | Non à lui seul : même moteur WebGPU que Chrome | — | À garder : utile pour le cache de shaders persistant et le préchauffage (§ 6, P2) |
| Electron | Non : même Chromium/Dawn | Semaines | Aucun gain sur Tauri |
| Repli WebGL2 de three.js | Non : même système de nœuds (`NodeBuffer_<id>` aussi en GLSL), compilation ANGLE/FXC | — | Non |
| Babylon.js / PlayCanvas | Partiellement (autre système de shaders) mais même WebGPU | Mois (couche rendu à refaire) | Non : le correctif three.js suffit |
| Godot 4 | Il a la même famille de saccades (« ubershaders » depuis 4.4 pour l'atténuer) | 6–12 mois (36 000 lignes TS, chaîne des mondes, multijoueur, matériel) | Non |
| Unity | Même problème de PSO, réglé par préchauffage (« PSO warmup ») | 6–12 mois + licence | Non |
| Unreal Engine 5 | Célèbre pour ces mêmes saccades (« shader compilation stutter ») ; demande des caches de PSO à constituer | 9–18 mois, C++/Blueprints, ≥ 2 Go installés, redevance 5 % au-delà de 1 M$ | Non |

Changer de moteur, c'est réécrire tout le client, la chaîne de construction des zones, l'intégration
des capteurs et le multijoueur, pour retrouver ensuite le même problème à traiter de la même
façon : **un nombre fini de shaders, compilés à l'avance, jamais en roulant**.

Ce que l'installation apporte vraiment (Tauri, déjà là) :
- un **cache de shaders persistant** (dossier WebView2 de l'application) : compilés une fois à la
  première ouverture, réutilisés ensuite (constaté sur la trace : cache Dawn actif) ;
- un **écran « Préparation des shaders » à la première ouverture** : avec ≈ 130 shaders au lieu
  de 500+, quelques secondes une seule fois ;
- les fichiers des mondes en local (pas de réseau), le build de production (pas le serveur Vite).

## 6. Plan d'action

### P0 — les coupures (quelques jours)

1. **Corriger three.js** par `pnpm patch three@0.186.1` (les deux changements du § 3, dans
   `src/` et dans `build/three.webgpu.js`, que Vite précompile). Signaler le problème en amont
   (dépôt mrdoob/three.js) pour s'en défaire à une version future.
   - Sans patch, pour l'instanciation seule : allouer chaque `InstancedMesh` avec au moins
     1 025 places et régler `mesh.count` au nombre réel. Les coureurs animés exigent le patch.
2. **Collision caméra en quelques microsecondes** : tester le segment tête → caméra contre les
   **empreintes des bâtiments** (polygones + hauteur, déjà dans les tuiles) rangées dans une
   grille autour du coureur, au lieu des triangles. Autre voie : `three-mesh-bvh`.
3. **Plus jamais de compilation en roulant** : tout objet créé en cours de sortie (tuile,
   cycliste) passe par `renderer.compileAsync(objet, camera, scène)` avant d'être affiché, avec
   la passe réelle (cf. `compilePass`). C'est la voie `createRenderPipelineAsync` : la trace montre
   qu'elle compile sur des fils de travail de Dawn, sans bloquer l'affichage.
4. **Garde-fou dans F3** : compter les pipelines créés pendant la sortie et étiqueter
   « compilation shader » dans les saccades (en enveloppant `GPUDevice.createRenderPipeline`).
   Objectif : **0 pipeline créé après le départ**.

Gain attendu (mesuré en E) : plus de coupure longue en roulant, ≈ 85 fps processeur en village
sur cette machine (avant : 39).

### P1 — la marge processeur (1–2 semaines)

- Décor statique figé : `matrixAutoUpdate = false` et `matrixWorldAutoUpdate = false` sur les
  groupes des tuiles une fois posés (≈ 17 % du temps d'image aujourd'hui).
- Moins d'objets dessinés : fusionner par tuile ce qui est statique, `BatchedMesh` pour les
  accessoires, revoir les projeteurs d'ombre. Moins d'objets = moins de `writeBuffer`
  (≈ 800 par image).
- Un matériau de terrain partagé par variante (aujourd'hui un graphe TSL par tuile, reconstruit
  à chaque tuile).
- Tuiles : décodage et construction des géométries (bâtiments, routes, placement de la
  végétation) dans un *Web Worker*, tableaux typés transférés ; format binaire au lieu du JSON
  (jusqu'à 1,5 Mo par tuile) ; orthophotos par `createImageBitmap` ou KTX2.
- Comprendre l'image isolée de ≈ 1 s restante (§ 2.3) avec le garde-fou du P0.

### P2 — l'application installée (quelques jours)

- Première ouverture : « Préparation des shaders » (une scène avec un exemplaire de chaque type
  d'objet, compilée par `compileAsync`), puis cache persistant de WebView2.
- Jouer sur le build de production dans Tauri (pas sur le serveur Vite).
- Script de mesure de `out/perf-study/` déplacé dans `tools/` et lancé avant chaque version :
  shaders créés en roulant, saccades > 100 ms, fps.

## 7. Réalisé et mesuré (25 octobre)

Mesures avec `tools/perf` : Billom, simulateur à 1 500 W, 20 s de route puis 60 s de mesure, cache de
shaders vierge (le cas du premier lancement), Chrome sans fenêtre (sans synchro verticale).

| | Avant | Après, qualité basse | Après, qualité haute |
|---|---|---|---|
| Images par seconde | 39 (basse) | **174** | **81** |
| Saccades > 100 ms | 21 | **0** (pire 76 ms) | 4 |
| Saccades > 250 ms | 7 | **0** | 1 (539 ms) |
| Shaders compilés en roulant | 159 | **0** | 6 (dont 3 en direct) |
| Chargement jusqu'au départ | — | 28 s | 41 s |

### Ce qui a été changé

**P0 — compilations en roulant**
- `patches/three@0.186.1.patch` (`pnpm patch`, déclaré dans `pnpm-workspace.yaml`) : instances
  toujours en attributs, tampons nommés dans l'ordre d'apparition. Le moteur WebGL de secours n'est
  pas corrigé (même défaut, sans conséquence en WebGPU).
- `engine/renderer.ts` : tout objet arrivé dans la scène pendant la sortie (tuile, cycliste) passe par
  une **file de précompilation**, un objet à la fois, et n'est dessiné qu'une fois prêt.
- Deux défauts de three.js trouvés en route, qui rendaient la précompilation **inutile** (chaque objet
  était reconstruit en direct à sa première image, 551 constructions en 60 s en qualité haute) :
  `compileAsync` demande le contexte de rendu de profondeur 0 alors que la passe de scène est dessinée
  imbriquée (1, ou 2 avec le TAA), et reprend une clé d'environnement périmée (`info.calls` non avancé).
  Corrigés côté jeu (`sharedSceneContext`, `withoutCulling`) : 551 → 72 constructions en direct.
- Précompilation du départ : objets hors du champ et **tous les niveaux de détail des coureurs** (un
  coureur distancé passait à un niveau jamais dessiné) ; quatre images rendues sous l'écran
  d'attente (ombres, post-traitement).
- `game/cameras.ts` + `world/footprints.ts` : collision de la caméra sur les **emprises des
  bâtiments** (grille, quelques microsecondes) au lieu des triangles.
- Panneau F3 (`engine/pipelineStats.ts`) : `shaders : N en direct, M à l'avance · en sortie K en
  direct (objectif 0)`, et `COMPIL. SHADER ×n` sur les saccades dues à une compilation.

**P1 — marge processeur**
- Décor figé (`freezeStatic`, `world.ts`) : matrices du terrain, des bâtiments, des routes, de la
  végétation, de l'eau et des rails calculées une fois (le temps de `updateMatrixWorld` par image
  divisé par 3,4).
- Coureurs (`gltfAvatar.ts`) : niveau de détail choisi avant le calcul des matrices ; les niveaux
  masqués (plus d'une centaine d'objets chacun) ne sont plus recalculés.
- Végétation (`vegetation.ts`) : changements de niveau de détail **étalés, deux blocs par image** (une
  tuile qui passait « près » en basculait une centaine d'un coup : 0,6 s figée).
- Herbe (`grass.ts`) : regénération étalée sur une vingtaine d'images au lieu de 55 ms d'un coup tous
  les 12 m.
- Terrain (`terrain.ts`) : normales tirées des hauteurs voisines et tableaux typés (changement de
  détail d'une tuile : 96 → 34 ms) ; orthophotos décodées hors du fil principal (`createImageBitmap`).

**P2 — mesure et application installée**
- `tools/perf` : mesure reproductible, bilan JSON, capture, profil processeur ou trace en option,
  **code de sortie 1 si le budget est dépassé** (plus de 10 shaders en roulant ou plus de 3 saccades
  de plus de 250 ms par minute). Le jeu pose le repère `ar:ride-start` pour l'outil.
- Application Tauri : rien à changer (elle embarque le build de production ; WebView2 garde le cache
  de shaders de Dawn d'un lancement à l'autre). **Non vérifié sur l'application construite.**

### Essayé puis écarté (mesures à l'appui)

- Compiler aussi tous les objets masqués au départ : +25 s de chargement en qualité haute, sans gain.
- Les compiler en fond pendant la sortie : three.js construit les graphes de nœuds sur le fil principal
  même « en asynchrone » ; vingt images de 120 ms d'affilée. Remplacé par l'étalement côté végétation.

### Ce qui reste

- **Qualité haute, passage d'une rangée de tuiles** (≈ 0,5 s, une fois par kilomètre) : plusieurs tuiles
  changent de détail et sont dessinées pour la première fois dans la même image (liaisons, tampons,
  ombres). Piste : étaler aussi les changements de détail du terrain (comme la végétation), et
  construire les géométries dans un *Web Worker*.
- three.js construit un graphe de nœuds par `InstancedMesh` (clé de cache = identifiant de l'objet,
  « TODO » du moteur) : environ 10 ms par bloc d'arbres. Moins de blocs (`realChunk` plus grand) ou
  `BatchedMesh` réduiraient ce coût.
- Un matériau de terrain par tuile : un graphe de nœuds par tuile (≈ 15 ms). Un matériau partagé
  demanderait des textures en tableau (`DataArrayTexture`).
- Le test de charge du serveur (`apps/server/test/load.test.ts`) échoue quand la machine est chargée
  (passe seul) : sans lien avec ces changements.

## 8. 28 octobre : chargement, herbe, installateur

Cap : un **logiciel installé** (Tauri). Le chargement se paie à chaque lancement, l'installateur et le disque
comptent ; le réseau (compression Caddy, découpe du bundle pour le cache) beaucoup moins.

Même scénario qu'au § 7 (Chevreuse, qualité haute, 1 600 × 900, `tools/perf`, 1 500 W) :

| | Avant | Après |
|---|---|---|
| Chargement jusqu'au départ, profil Chrome vierge (1er lancement) | 82 s (57 s en rejouant l'ancien comportement : `compileconc=1`) | **23 s** |
| Chargement, cache de shaders chaud | 36 à 50 s | **20 s** |
| Images par seconde | 53 à 66 | **89 à 90** |
| Saccades > 250 ms sur 45 s | 1 à 4 | 0 à 1 (la seule est à l'instant 0 de la sonde) |
| Part du processeur prise par l'herbe | 9,0 % | **1,0 %** |

### Où partait le temps de chargement (nouveaux repères `ar:…` + `--cpu-load`)

Le jeu pose maintenant des repères de démarrage (`bootStep` et `performance.mark` dans `main.ts`), que
`tools/perf` imprime et range dans le JSON (`startup`). Cache chaud : menu prêt à 2,5 s, tuiles à 8 s, paysage
compilé à 14 s, puis **23 à 28 s « départ : objets de la sortie → compilés »**. Le profil processeur de cette
phase montre le fil principal **inactif 17 s sur 27** : `Renderer.compileAsync` de three.js traite les objets un
par un et attend la fin du pipeline de chacun (`await Promise.all(pipelinePromises)`) avant de construire les
nœuds du suivant ; la compilation DXC du processus GPU et la construction des nœuds ne se chevauchaient jamais.

Correctif (`patches/three@0.186.1.patch`, trois fichiers) : jusqu'à N pipelines en vol, les erreurs sont gardées
et relancées à la fin. Réglage `?compileconc=N` (16 par défaut), profil Chrome vierge :

| Pipelines en vol | 1 | 4 | 8 | 16 | 32 |
|---|---|---|---|---|---|
| Chargement jusqu'au départ | 57 s | 29 s | 27 s | 24 s | 23 s |

Reste après ce correctif : tuiles (≈ 6 s) et compilation du paysage (≈ 6 s), limitées par le processeur
(construction des graphes de nœuds de three.js, bâtiments 2,2 s dont `paint` 0,6 s avant correction).

### Herbe : 9 % → 1 % du processeur

`GrassField.advance` refaisait tous les ~80 blocs de 12 m du disque d'herbe à chaque pas de 12 m (toutes les 0,6 s
à 70 km/h), alors que chaque bloc a une graine fixe et ne dépend ni du coureur ni du rayon. Les blocs sont
maintenant mémorisés (`world/grassPlacement.ts`) : une regénération ne refait que la bande qui entre dans le
disque. Résultat **identique à l'algorithme d'origine à l'octet près** (test `grassPlacement.test.ts`, qui
rejoue l'ancien code sur 18 pas, été et hiver, avec et sans plafond). Au passage, `buildRoadProximity` (clés
numériques au lieu de chaînes, `roadProximity.ts`) et `splatCell` (un calcul d'indice pour sept canaux).

### Installateur

- `__pose/` (photos de référence et modèle de pose de développement, non versionnés, **30 Mo**) n'est plus copié
  dans `dist/` ; avec `AR_DESKTOP=1` (posé par `deploy/publish-desktop.sh`) les boucles `.webm` du menu
  (**125 Mo**) non plus : H.264 joue dans WebView2, l'AV1 logiciel sert de dernier recours (`scripts/installerDiet.ts`).
- `navigator.storage.persist()` après l'installation d'une zone et au démarrage : les zones (jusqu'à 2 Go) vivent
  dans le Cache Storage de WebView2, « au mieux » par défaut, donc purgeable quand le disque se remplit.
- Graphes routiers : fusion des zones voisines 3 fois plus rapide (commit 1147f06). Les `graph.json` (≈ 330 Mo pour
  45 zones) ne partent **plus** dans l'installateur (`AR_DESKTOP=1`) : `graphFetch` (`world/packs.ts`) les prend dans le
  pack de la zone (téléchargé avec elle, gardé compressé, donc utilisable hors ligne), sinon dans les fichiers de
  l'application, sinon sur le serveur des mondes (Caddy les autorise en CORS). Sans réseau ni pack, une zone sans
  graphe se charge quand même, sans mode monde ouvert.

### Premier lancement, vraiment à froid

Les mesures « profil Chrome vierge » gardaient le cache de shaders du pilote. Mesuré avec le cache DirectX du pilote
vidé : **28 s** jusqu'au départ (23 s avec le cache du pilote), compilation des objets de la sortie 11,5 s. Le
premier lancement réel est donc ≈ 5 s plus lent que le chiffre du tableau ci-dessus. Le cache de Dawn n'a rien
écrit dans le cache DirectX pendant la mesure (1,8 Mo) : le gros du coût à froid est dans Chrome, pas dans le pilote.

### Tuiles et compilation du paysage (processeur)

Profil du chargement : tuiles ≈ 3 à 5 s, paysage compilé ≈ 4 à 5 s, limités par le fil principal. Dans les tuiles,
`buildings.addTile` fait 2,2 s dont `computeVertexNormals` 0,5 s : remplacé par `setFlatNormals` (`flatNormals.ts`, normales
par face identiques au bit près à celles de three.js, test sur 4 000 triangles). Le reste est la construction des
graphes de nœuds de three.js (un par objet) ; la réduire demande moins d'objets ou un Web Worker pour la géométrie.

### Essayé ou estimé, non retenu

- **Maillage des bâtiments par cellules** (culling) : sur Chevreuse, cellules de 500 m = 12 % des sommets de la
  tuile au lieu de 17 % sur les 4 passes (principale + 3 cascades), mais 54 objets au lieu de 28 dans la passe
  principale ; le coût par objet de three.js domine déjà : non.
- **Indexer la géométrie des bâtiments** : 21 % seulement des sommets sont des doublons exacts (attributs de
  façade distincts par face) : non.
- **Compacter les attributs** (92 octets par sommet : `color`, `accent`, `binfo` identiques sur tout un bâtiment) :
  gain de 22 à 30 % par demi-précision et 8 bits, jusqu'à 52 % avec un index de partie et une table ; à faire
  avec comparaison de captures, car `vertexColors` de three multiplie déjà l'attribut `color`.
- `lod.updateMatrixWorld` des coureurs (3 % du processeur) et `updateAfter` de three.js (6 %, vitesse du TAA par
  maillage animé) : pistes ouvertes.

`tools/perf` : `--cpu-load` (profil du chargement), `--probe-buildings` (sommets répétés), `--query "a=1&b=2"`
(paramètres d'URL du jeu).
