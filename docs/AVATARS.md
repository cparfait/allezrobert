# Visages et avatars — choix, budgets, pipeline

> Document de cadrage (étape 1 de la mission « Visages et avatars »), **à valider avant tout
> développement**. Les faits sur MPFB et les paquets d'assets ont été vérifiés le 22/10/2026 en
> téléchargeant et en inspectant les fichiers (voir « Ce que fournit MPFB »). Les points à
> trancher sont regroupés à la fin (§ 12).

## 1. Objectifs et contraintes (rappel)

- Jusqu'à 10 coureurs à l'écran à 60 fps, quatre préréglages (bas, moyen, haut, ultra = RTX 4090),
  Three.js WebGPU avec repli WebGL2.
- Casque et lunettes cachent front, yeux et cheveux : priorité au **bas du visage** (mâchoire,
  bouche, barbe), au **teint** et à la **silhouette**. En caméra de poursuite, un visage fait
  quelques dizaines de pixels ; le détail fin sert au garage, au podium et au mode photo.
- Assets gratuits à licence compatible seulement (Blender, MPFB 2 et ses modèles en CC0, CC0 de
  Poly Haven / ambientCG, créations maison), tous tracés dans `ASSETS_LICENSES.md`. MetaHuman :
  référence visuelle uniquement. Aucun modèle d'IA dont la licence exclut l'UE.
- Photo de visage = donnée personnelle sensible : consentement explicite, traitement 100 % dans
  le navigateur, photo jamais envoyée ni stockée, seuls les réglages sont sauvegardés,
  effacement à tout moment.

## 2. Ce que fournit MPFB (vérifié)

| Élément | Constat | Usage prévu |
| --- | --- | --- |
| MPFB 2.0.18 (extension Blender, extensions.blender.org) | Code **GPL-3** ; installable dans Blender 4.2+ (testé ici avec le module `bpy` 5.2) | Outil de génération seulement : aucun code MPFB n'est livré avec le jeu |
| Maillage de base `hm08` (`data/3dobjs/base.obj`) | 19 158 sommets ; corps 13 378 quads (≈ 26 700 triangles) dont **tête ≈ 3 900 quads ≈ 7 800 triangles** ; UV unique ; aides séparées : globes oculaires, dents haut / bas, langue, cils, cheveux, collants | Topologie unique de tous les avatars ; la tête correspond déjà au budget LOD0 |
| Cibles de modelage (`data/targets`, ≈ 900 fichiers) | tête (formes, âge, gras, échelles), menton (largeur, hauteur, saillie, prognathisme, fossette, mâchoire), joues (pommettes, volume), nez (42), bouche (44), yeux (68), oreilles (44), front, cou, sourcils, macros (sexe, âge, muscle, poids, taille, proportions, origine africaine / asiatique / caucasienne) | Curseurs de forme (§ 4) |
| Unités d'expression MakeHuman (`targets/expression/units`) | 35 unités type FACS (paupières, sourcils, bouche, nez, platysma) × 3 variantes d'origine | Repli si les formes ARKit ne sont pas utilisables (§ 5) |
| Squelettes (`data/rigs/standard`) | `game_engine` 53 os (noms type Unreal : pelvis, spine_01-03, neck_01, head, upperarm, lowerarm, hand, doigts, thigh, calf, foot, ball), `default` 163 os ; **poids : licence CC0** | `game_engine` (§ 7) |
| Paquet système `makehuman_system_assets_cc0` (280 Mo) | Topologies basse définition `male1591` (1 570 faces), `female1605` (1 584), `male_generic` / `female_generic` (≈ 13 700), sourcils (12), cils (4), yeux haute / basse définition, cheveux, peaux | LOD2 / LOD3, yeux, sourcils, cils |
| Paquets `eyebrows01_cc0`, `eyelashes01_cc0`, `hair01_cc0`, `skins01-03_cc0` | Explicitement CC0 (nom du fichier) | Sourcils, cils, coiffures de départ, base de peau |
| Paquet `faceunits01` (contribution de Mika Suominen, févr. 2026) | **Exactement les 52 formes ARKit** (`eyeBlinkLeft` … `tongueOut`) en cibles sur `hm08` ; **aucune mention de licence** dans le paquet ni sur sa page, contrairement aux paquets `*_cc0` | Expressions (§ 5), sous réserve de licence (§ 12) |
| Paquets `visemes01/02` | Formes de bouche pour la parole | Non prévus |

Licence des assets : la page « License » de MakeHuman indique que **tous les assets de base sont
en CC0** (aucune attribution requise) ; le code de MPFB est en GPL, celui de MakeHuman en AGPL.
Le forum et le dépôt d'assets communautaire sont arrêtés depuis le 21/10/2026 ; le site statique
et ses paquets restent en ligne (voir § 12, versionnement des sources).

Blender MCP n'est pas disponible dans les sessions cloud : Blender y est piloté par des scripts
Python versionnés exécutés sans interface (`bpy`). Le MCP reste utilisable sur un poste local
pour l'exploration, mais tout ce qui produit un fichier du jeu passe par un script.

## 3. Pipeline

```
tools/blender/avatars/
  fetch_assets.py        télécharge les paquets CC0 utilisés (empreintes SHA-256 vérifiées)
  build_base.py          MPFB : tête et corps de base, rig game_engine, pose de conduite
  build_targets.py       curseurs (§ 4) → cibles exportées ; formes ARKit (§ 5)
  build_lods.py          LOD0 / LOD1 / LOD2 (transfert des cibles), imposteurs LOD3
  build_textures.py      calques de peau (§ 6), cartes de détail, encodage KTX2
  build_hair.py          coiffures compatibles casque, barbes en cartes
  export.py              glTF (meshopt), rapport de budgets (triangles, cibles, Mo)
apps/client/public/models/avatar/   fichiers produits (versionnés)
```

1. **Base** : MPFB charge `hm08`, le rig `game_engine` et ses poids CC0 ; on retire les aides
   inutiles (collants, jupe, organes génitaux) et on sépare la tête du corps au ras du col
   (couture cachée par le maillot, voir § 7).
2. **Pose de conduite** : le client actuel suppose que la pose de repos est la pose de conduite
   (cinématique inverse calculée en écarts). On garde cette convention : le script pose le rig
   (assis, mains aux cocottes, manivelle à 0) et l'applique comme pose de repos, **cibles
   comprises** (chaque cible est réévaluée à travers le modificateur d'armature puis
   ré-enregistrée).
3. **Cibles** : chaque curseur est exporté comme cible (morph target) ; la tête et le corps
   ont leurs propres jeux (§ 4, § 5).
4. **Export** : glTF binaire, compression **meshopt** (`gltfpack`, MIT, paquet npm), textures
   **KTX2 / Basis** (encodeur Basis Universal, Apache-2.0). Draco écarté : décodage plus lent et
   moins bon sur les cibles.
5. **Contrôle** : à chaque étape, planches de captures (face, 3/4, profil, avec et sans casque)
   générées par le banc d'essai `avatar-test.html` et examinées ; mesure des fps avec 10
   avatars dans chaque préréglage (§ 10).

## 4. Curseurs de forme (identité)

Les curseurs ne bougent pas pendant une sortie : leur effet est **précalculé sur le processeur**
au chargement (ou à chaque modification dans l'éditeur) dans une géométrie propre à l'avatar.
Ils ne coûtent donc rien au rendu, même à 40 curseurs. Chaque curseur va de −1 à +1 (0 = base),
avec des bornes réalistes ; les combinaisons extrêmes sont testées (planche aléatoire de 50 têtes).

### Visage (34)

| Curseur | Cibles MPFB | Effet |
| --- | --- | --- |
| `jawWidth` | chin-width, chin-bones | Largeur de mâchoire |
| `jawHeight` | chin-jaw-drop | Hauteur de mâchoire |
| `jawAngle` | head-square ↔ head-triangular | Angle mandibulaire (carré ↔ fin) |
| `chinProtrusion` | chin-prominent, chin-prognathism | Menton en avant / en retrait |
| `chinHeight` | chin-height | Hauteur du menton |
| `chinWidth` | chin-width (bas) | Largeur du menton |
| `chinCleft` | chin-cleft | Fossette du menton |
| `cheekbones` | cheek-bones (G+D) | Pommettes saillantes |
| `cheekVolume` | cheek-volume (G+D) | Joues pleines ↔ creusées |
| `cheekHeight` | cheek-trans-up/down | Hauteur des pommettes |
| `faceFat` | head-fat | Visage maigre ↔ rond |
| `headWidth` | head-scale-horiz | Largeur du crâne |
| `headLength` | head-scale-vert | Hauteur du visage |
| `headDepth` | head-scale-depth, head-back-scale-depth | Profondeur du crâne |
| `foreheadSlope` | forehead-trans-backward/forward | Front fuyant ↔ droit |
| `browRidge` | forehead-nubian, eyebrows-trans-forward | Arcades marquées |
| `browHeight` | eyebrows-trans-up/down | Hauteur des sourcils |
| `browAngle` | eyebrows-angle-up/down | Inclinaison des sourcils |
| `eyeSize` | eye-scale | Taille des yeux |
| `eyeSpacing` | eye-trans-in/out | Écartement des yeux |
| `eyeHeight` | eye-trans-up/down | Hauteur des yeux |
| `eyeTilt` | eye-corner1/2 up/down | Inclinaison (amande) |
| `eyelidFold` | eye-epicanthus, eye-eyefold | Pli de la paupière |
| `noseLength` | nose-scale-vert | Longueur du nez |
| `noseWidth` | nose-scale-horiz, nose-nostrils-width | Largeur du nez |
| `noseBridge` | nose-hump, nose-width1 | Arête (bosse, largeur) |
| `noseTip` | nose-point-up/down, nose-point-width | Pointe (relevée, large) |
| `nostrilFlare` | nose-flaring | Ailes du nez |
| `lipFullness` | mouth-upper/lowerlip-volume | Épaisseur des lèvres |
| `mouthWidth` | mouth-scale-horiz | Largeur de la bouche |
| `mouthCorners` | mouth-angles-up/down | Commissures (au repos) |
| `earSize` | ear-scale, ear-scale-vert | Taille des oreilles |
| `earAngle` | ear-flap, ear-wing | Oreilles décollées |
| `neckWidth` | measure-neck-circ, neck-scale-horiz | Cou fin ↔ large |

### Corps et macros (8)

| Curseur | Source | Effet |
| --- | --- | --- |
| `sex` | macro gender | Morphologie féminine ↔ masculine |
| `age` | macro age + head-age | 18 → 80 ans (rides : § 6) |
| `origin` | 3 macros (africain, asiatique, caucasien) | Mélange de trois poids, somme = 1 (« air d'origine », jamais une catégorie imposée) |
| `height` | macro height | **Calé sur la taille du profil** (heightCm) |
| `weight` | macro weight | **Calé sur poids / taille du profil** (IMC), ajustable ±20 % |
| `muscle` | macro muscle | Carrure |
| `shoulders` | torso-scale-horiz, shoulders | Largeur d'épaules |
| `legLength` | proportions / legs-scale-vert | Longueur des jambes (selle du vélo inchangée : les angles de jambe s'adaptent) |

Le curseur `build` actuel (fin ↔ costaud) est remplacé par `weight` + `muscle` ; les tenues
existantes sont migrées (`build` → `muscle`).

## 5. Expressions

### Les 52 formes ARKit

- **Source** : le paquet `faceunits01` fournit les 52 formes ARKit sur `hm08`. S'il est
  utilisable (licence, § 12), elles sont transférées telles quelles sur la tête de base ; sinon,
  elles sont **recréées** par script : 30 d'entre elles se déduisent des 35 unités MakeHuman CC0
  (`eye-left-closure` → `eyeBlinkLeft`, `mouth-open` → `jawOpen`, `mouth-corner-puller` →
  `mouthSmile*`, `eyebrows-*-inner-up` → `browInnerUp`…), les autres (`jawLeft/Right/Forward`,
  `mouthRoll*`, `cheekPuff`, `tongueOut`, `eyeLook*`) sont sculptées par déformations scriptées
  (rotation de la mâchoire autour de l'articulation `joint-jaw`, gonflement radial des joues…).
- **Regard** (`eyeLook*`) : les globes oculaires sont des maillages séparés tournés par le code ;
  les formes `eyeLook*` ne déplacent que les paupières qui les suivent.
- **Coût** : seules les expressions s'animent en jeu. Elles sont sur la **tête seule** (≈ 4 000
  sommets) et ne sont actives qu'en LOD0 (52 formes) et LOD1 (12 formes regroupées : clignement,
  mâchoire, sourire, grimace, joues, sourcils) ; LOD2 et LOD3 n'en ont pas.

### Pilotage en jeu (`rider/face.ts`)

| Situation | Entrées | Formes (poids lissés, constante de temps 0,3 à 0,8 s) |
| --- | --- | --- |
| Effort | % de FTP sur 10 s, FC en % de FC max | `browDown`, `eyeSquint`, `noseSneer`, `mouthStretch` progressifs au-delà de 85 % FTP ; `jawOpen` et `mouthFunnel` au rythme respiratoire |
| Respiration | cadence respiratoire tirée de la FC | `jawOpen` (0 → 0,35), `mouthLowerDown` ; mouvement des côtes par les os `spine_02/03` |
| Sprint | puissance > 130 % FTP, danseuse | `cheekPuff` alterné, grimace maximale |
| Roue libre, descente | cadence nulle | visage détendu, léger `mouthSmile` en descente |
| Podium, arrivée | événement | `mouthSmile` franc, bras levés (pose scriptée du rig) |
| Clignements | aléatoire 3–6 s, plus rare en effort | `eyeBlink*` 120 ms |

Aucune transition brusque : chaque poids suit une poursuite exponentielle, et les clignements ont
une courbe d'ouverture / fermeture asymétrique.

## 6. Peau, yeux, matériaux

- **Albedo neutre** (base dérivée de `skins01_cc0`, désaturée) multiplié par le **teint** : palette
  de 24 teintes de référence (du très clair au très foncé, sous-tons froids / neutres / chauds)
  plus un réglage continu.
- **Calques combinables** (une texture RGBA de masques par LOD + uniformes) :
  rougeur d'effort (pilotée par l'effort et la chaleur), taches de rousseur, grains de beauté,
  barbe naissante (densité, couleur), rides (pilotées par `age`), transpiration (brillance et
  gouttes, pilotées par la durée et l'intensité de l'effort).
- **Shader de peau** (TSL, WebGPU et WebGL2) : diffusion sous-cutanée simulée par diffusion
  « enveloppée » teintée et transmission en lumière rasante (oreilles, nez), carte de normales
  + carte de détail en mosaïque (pores, faite maison ou ambientCG CC0), rugosité variable
  (zone T, lèvres), sueur = rugosité abaissée + micro-normales.
- **Yeux** : globe + cornée séparés ; iris avec parallaxe, reflet humide ; réfraction réelle
  (transmission) en ultra seulement.
- **Textures KTX2** : 512 px (bas), 1024 (moyen, haut), 2048 (ultra) ; une seule texture
  partagée par tous les avatars pour la base et les détails, seuls les uniformes diffèrent.

## 7. Intégration au jeu

- **Rig** : `game_engine` (53 os). Correspondance avec la cinématique inverse actuelle :
  `pelvis → hips`, `spine_01/02/03 → spine/chest`, `neck_01 → neck`, `head`, `upperarm/lowerarm/
  hand_l/r`, `thigh/calf/foot_l/r`. Les doigts sont posés une fois sur les cocottes (pose de
  conduite). Le code de `gltfAvatar.ts` est généralisé à une table de correspondance.
- **Tête / corps** : deux maillages skinnés sur le même squelette ; la couture est sous le col du
  maillot et partage exactement les mêmes sommets et normales (pas de fente visible).
- **Casque et lunettes** : coiffures « sous casque » courtes et plaquées, plus une queue de cheval
  qui sort sous la coque ; masquage des mèches dans le volume du casque (test d'ellipsoïde dans le
  shader des cheveux) ; casque et lunettes recalés sur des points du visage précalculés (arête du
  nez, tempes, oreilles) après application des curseurs : aucune interpénétration quelle que soit
  la forme de la tête (vérifiée sur la planche aléatoire).
- **Instanciation** : géométries de base, textures et programmes partagés ; par avatar seulement
  la géométrie « identité » (précalculée), les poids d'expression et les uniformes de peau.
- **Réseau** : `AvatarLook` gagne un champ compact `face` (42 curseurs quantifiés sur 8 bits en
  base64url, 56 caractères) + teint, calques, coiffure, barbe : **≈ 150 octets**. Le serveur valide
  la taille et les bornes ; aucune géométrie ni image ne circule.

## 8. Niveaux de détail

| LOD | Distance (préréglage haut) | Tête | Corps | Expressions | Matériau |
| --- | --- | --- | --- | --- | --- |
| LOD0 | < 6 m (garage, podium, photo, coureur proche) | ≈ 7 800 tri (hm08 natif) | ≈ 15 000 tri (hm08 réduit de ≈ 20 %) | 52 | peau complète, yeux réfractés (ultra) |
| LOD1 | 6–25 m | ≈ 3 900 | ≈ 7 500 | 12 | peau sans détail fin |
| LOD2 | 25–60 m | topologie `male1591` / `female1605` (≈ 3 100 tri au total) | inclus | 0 | albedo + teint |
| LOD3 | > 60 m | imposteur : 8 vues pré-rendues du coureur générique, teintées (maillot, peau) | | 0 | — |

- Les cibles sont transférées vers LOD1 et LOD2 **exactement** grâce aux fichiers `.proxy`
  de MakeHuman (chaque sommet de la topologie réduite est une combinaison fixe de sommets de
  `hm08`) : un même jeu de curseurs donne la même tête à tous les niveaux.
- Distances multipliées par 0,6 (bas), 0,8 (moyen), 1 (haut), 1,5 (ultra).

## 9. Profils de base (8) et éditeur

| Profil | Âge | Sexe | Origine (dominante) | Morphologie | Particularités |
| --- | --- | --- | --- | --- | --- |
| Robert | 72 | H | européenne | sec, endurant | rides, moustache grise (clin d'œil au nom du jeu) |
| Léa | 27 | F | européenne | grimpeuse fine | taches de rousseur, queue de cheval |
| Moussa | 34 | H | ouest-africaine | rouleur athlétique | barbe courte |
| Aiko | 41 | F | est-asiatique | fine, nerveuse | cheveux courts |
| Karim | 46 | H | nord-africaine | costaud, mâchoire carrée | barbe naissante |
| Inès | 55 | F | métissée (Antilles) | moyenne | cheveux courts gris |
| Tom | 21 | H | européenne | très fin, joues creuses | imberbe |
| Marta | 36 | F | latino-américaine | sprinteuse puissante | cheveux tressés sous le casque |

Chaque profil est un simple jeu de curseurs (JSON). Planche de validation : face, 3/4, profil,
avec et sans casque et lunettes, avant / après chaque itération.

**Éditeur** (onglet Garage → « Visage ») : choix d'un profil, curseurs groupés (Visage, Yeux,
Nez, Bouche, Corps, Peau), aperçu 3D en rotation, bascule casque / lunettes, aléatoire
contrôlé, annulation.

## 10. Performances : protocole de mesure

Banc d'essai `avatar-test.html?bench` : 10 coureurs animés (pédalage, expressions d'effort),
caméra de poursuite et caméra garage, 30 s par préréglage ; on relève fps moyen et 1 % bas,
temps GPU (WebGPU timestamp queries quand disponibles), triangles, mémoire des textures.
Objectif : 60 fps en haut sur une carte milieu de gamme, aucun recul de plus de 1 ms par image
par rapport aux avatars actuels en préréglage bas. Résultats notés dans les notes de version.

## 11. Ressemblance à partir d'une photo (optionnelle)

1. Écran de consentement (ce qui est fait, ce qui est conservé : uniquement des curseurs ;
   effacement à tout moment) ; rien ne démarre sans accord explicite.
2. **MediaPipe Face Landmarker** (Apache-2.0) exécuté dans le navigateur ; modèle et WASM servis
   par notre propre serveur (aucune requête vers un tiers). Photo de face, option deux profils.
3. Normalisation de pose (Procuste) puis **moindres carrés régularisés** (Tikhonov, bornes des
   curseurs) entre les 478 points détectés et les sommets correspondants de `hm08` (table de
   correspondance calculée une fois hors ligne) ; la régularisation tire vers le profil de
   départ pour rester crédible.
4. Teint : médiane des joues et du front en espace linéaire, balance des blancs estimée sur la
   photo (gris moyen et sclérotique), projetée sur la palette de teints.
5. Résultat = « air de famille », ajustable à la main ; la photo est libérée de la mémoire dès
   la fin du calcul et n'est jamais affichée sur le visage 3D.

## 12. Points à valider

1. **Licence des 52 formes ARKit (`faceunits01`)** : le paquet n'indique aucune licence.
   Proposition : les **recréer nous-mêmes** à partir des unités CC0 et de déformations scriptées
   (§ 5), et n'utiliser `faceunits01` que si son auteur confirme le CC0. Coût : environ deux
   jours de plus à l'étape 3.
2. **Versionnement des sources** : le site communautaire de MakeHuman a fermé une partie de ses
   services le 21/10/2026. Proposition : versionner dans `tools/blender/avatars/vendor/` le
   **sous-ensemble CC0 utilisé** (cibles, poids, topologies, sourcils, cils, quelques
   coiffures : ≈ 30–60 Mo) pour que le pipeline reste reproductible, plutôt que de dépendre du
   téléchargement.
3. **Budget du corps** : `hm08` fait ≈ 18 900 triangles de corps ; on vise 15 000 en LOD0
   (réduction de 20 % hors mains et visage).
4. **Taille et poids** du corps tirés du profil du coureur (avec ajustement limité) plutôt que
   libres.
5. **Coureurs IA et invités** : profils de base tirés au hasard avec variations légères.
6. **Ordre des étapes** conforme à la mission : base + 5 curseurs (preuve de bout en bout) →
   tous les curseurs, expressions, peau, LOD → 8 profils → éditeur → photo.

Prochaine étape après validation : `build_base.py` (MPFB, rig, pose de conduite), 5 curseurs
(`jawWidth`, `cheekVolume`, `noseLength`, `lipFullness`, `age`), export et affichage dans le
banc d'essai et en jeu, planche de captures et mesure des fps.

## 13. Avancement

### Étape 2 — base, 5 curseurs, export, affichage (faite)

- `tools/blender/avatars/build_avatar.py` : télécharge et vérifie MPFB 2.0.18, crée l'humain
  (macros), le squelette « game_engine » (53 os), cuit les macros, ajoute les 5 curseurs en
  cibles `nom+` / `nom-`, découpe la tenue (ourlets nets par plans : col, manches, bande,
  maillot / cuissard, chaussettes), pose le coureur sur le vélo de base (bassin sur la selle,
  buste penché, IK jambes vers les pédales à la manivelle 0, mains sur les cocottes), fige
  cette pose comme pose de repos (maillage, cibles et squelette), reprend casque, lunettes,
  cheveux et chaussures de `cyclist.glb` et exporte `apps/client/public/models/avatar/rider.glb`
  (13 884 sommets, 27 660 triangles pour le corps, 10 cibles).
  Commande : `blender -b -P tools/blender/avatars/build_avatar.py -- --mpfb <mpfb.zip> --out <dossier>`.
- Client : `?avatar=mpfb` charge cet avatar (banc d'essai et jeu) ; correspondance des os
  classique / MPFB (`RIG_BONES`), colonne à trois segments et clavicules, `setFace({ jawWidth: 1, … })`.
- Vérifié à l'image (`docs/screenshots/avatars-etape2.jpg`) : profil, trois quarts, dos,
  visage avec casque et lunettes, portrait sans casque, curseurs à ±1 et âge ; en jeu
  (`/?avatar=mpfb&autostart`) avec les coureurs IA.
- Banc `avatar-test.html?bench&quality=…` (10 coureurs animés, caméra de poursuite).
  Mesures du conteneur de développement, rendu logiciel SwiftShader : les fps absolus n'y ont
  pas de sens (≈ 1 à 2 fps pour les deux avatars), on n'en retient que les écarts :

  | | avatar actuel | avatar MPFB |
  | --- | --- | --- |
  | Mise à jour des 10 avatars (IK, pédalage), CPU | 0,81 ms / image | 1,23 ms / image |
  | Triangles de la scène, préréglage bas (ombres comprises) | 345 k | 748 k |
  | Triangles, préréglage haut | 389 k | 830 k |

  Le surcoût en triangles vient du LOD 0 non réduit (le même fichier sert aux deux LOD) : les
  niveaux de détail (§ 8, 15 k / 5 k / 1,5 k) sont prévus à l'étape 3, avant toute mise en
  service par défaut. La mesure des fps sur une vraie carte graphique reste à faire sur un poste.

Limites connues, pour l'étape 3 : peau unie (sans texture ni SSS), index de la main
proche un peu tendu, poitrine du maillage par défaut à corriger par les macros, lunettes
reprises de l'ancien modèle un peu grandes pour ce visage.

### Étape 3a — tous les curseurs de forme (faite)

- 42 curseurs (`packages/shared/src/face.ts`) : les 34 du visage (§ 4) et 8 de corps (sexe,
  âge, poids, muscle, épaules, trois poids d'origine). Taille et longueur des jambes ne sont pas
  des cibles : elles déplacent les articulations que la pose de course fige (à traiter par le
  squelette côté client).
- Cibles de corps : écart entre deux humains MPFB (macros modifiées), **ramené au squelette de
  base** (chaque sommet replacé par l'inverse des déplacements de ses os) : le corps change de
  forme sans changer de taille, mains et pieds restent sur le cintre et les pédales.
- Cheveux, casque, lunettes et chaussures suivent les curseurs (cibles reportées depuis les
  sommets du corps les plus proches, moyennées pour garder casque et lunettes rigides).
- Client : les cibles d'identité sont retirées des cibles animées au chargement et appliquées
  une fois sur le processeur (géométrie propre à l'avatar, index, UV et poids partagés) ; coût
  de rendu nul. `AvatarLook.face` : 42 octets en base64url (56 caractères), validé par l'API.
- Fichier : 81 cibles ; 12 Mo brut, **2,5 Mo** après quantification et compression meshopt
  (glTF-Transform, décodeur meshopt de three.js).
- Planches : `avatar-test.html?avatar=mpfb&sliders` (chaque curseur à −1, 0, +1) et
  `&random=24` (têtes aléatoires passées par `look.face`, casque et lunettes en place).

### Étape 3b — expressions (faite)

- 51 formes ARKit (la langue tirée manque : pas de langue animable) recréées dans
  `build_avatar.py` : unités d'expression MakeHuman CC0 (moyenne des trois variantes d'origine),
  séparées gauche / droite et haut / bas de la bouche par masques doux ; mâchoire latérale et en
  avant, bouche latérale, joues gonflées et regard (rotation des globes, paupières qui suivent)
  scriptés. Langue gardée, intérieur de bouche sombre ; les dents d'aide de MakeHuman, trop
  grossières, sont retirées.
- `apps/client/src/rider/face.ts` : effort (puissance / FTP lissée), respiration (rythme selon
  la FC, bouche plus ouverte dans l'effort), grimace au-delà de 85 % de la FTP, joues gonflées
  au sprint en danseuse, sourire en descente, clignements toutes les 3 à 6 s ; poursuites
  exponentielles. Seulement au premier niveau de détail. Effort transmis par le joueur, les
  coureurs IA et les coureurs distants (FTP de référence 250 W).
- Compression : les cibles n'ont plus de normales (fichier 3 fois plus léger ; celles des
  curseurs sont recalculées, lissées à travers les coutures) ; le client remet positions,
  normales et cibles en flottants au chargement, three.js r186 appliquant mal les cibles animées
  sur des attributs quantifiés. Fichier : **1,95 Mo**.
- Corrigé au passage : des sommets d'aides MakeHuman restaient dans le cuissard (indices décalés
  après la séparation des yeux).
- Planches : `&sliders&expr` (chaque forme à 1), `&sliders&effort` (au train, au seuil, à bloc,
  sprint, descente).

### Étape 3c — peau (faite)

- Textures communes fabriquées par `build_avatar.py` (`bake_skin_textures`), à partir des peaux
  MakeHuman CC0 (sous-ensemble réduit versionné dans `tools/blender/avatars/vendor/makehuman`) :
  `skin_albedo.webp` (variations relatives de la peau jeune autour de la teinte de base : lèvres,
  sourcils, ombres ; 64 Ko) et `skin_masks.webp` (R rougeur d'effort et sueur, G barbe, B rides =
  détail de la peau âgée moins celui de la peau jeune, A taches de rousseur ; zones calculées en
  3D puis reportées dans l'espace UV par rastérisation ; 570 Ko).
- `apps/client/src/rider/skin.ts` (TSL) : teint × variations relatives, rides selon l'âge, barbe
  en poils fins (bruit) de la couleur des cheveux, taches de rousseur ; en sortie, rougeur des
  pommettes, du nez, des oreilles et du front avec l'effort, sueur (peau plus brillante) qui
  s'installe en quelques minutes au-dessus du seuil et s'en va lentement.
- `AvatarLook.beard` et `AvatarLook.freckles` (0 → 1), validés par l'API ; rides : curseur `age`.
- Écarts au plan : textures en WebP (pas de KTX2 : pas d'encodeur Basis dans la chaîne actuelle),
  pas de carte de normales de pores ni de transmission en lumière rasante ; yeux sans parallaxe.
- Planche : `&sliders&skin` (base, teint foncé, âgé, barbe, taches de rousseur, effort 20 min).

### Étape 3d — niveaux de détail et mesure (faite)

- Niveau 0 : corps décimé hors de la tête (tête et cou protégés : visage, curseurs et expressions
  intacts ; ourlets protégés) : **12,6 k triangles** au lieu de 27,9 k ; toutes les cibles
  reportées depuis le maillage complet (sommets inchangés : copie exacte ; ailleurs : moyenne
  pondérée des 3 plus proches).
- Niveau 1 (au-delà de 10 m) : 5 k triangles, ourlets protégés, curseurs de forme seulement ;
  niveau 2 (au-delà de 30 m) : 2,5 k. Accessoires réduits à 60 % et 30 %. Fichiers
  `rider.glb` 1,49 Mo, `rider_lod1.glb` 0,91 Mo, `rider_lod2.glb` 0,73 Mo.
- Distances × 0,6 (bas), 0,8 (moyen), 1 (haut), 1,5 (ultra) (`GltfRiderAvatar.lodScale`). Le
  client gère un nombre quelconque de niveaux, tous liés au squelette du niveau 0 ; le vélo
  simplifié sert au-delà du niveau 0.
- Pas d'imposteurs (niveau 3) : à plus de 60 m, 2,5 k triangles suffisent ; les coureurs au-delà
  de 600 m sont masqués.
- Banc `?bench` (10 coureurs, poursuite à 5 m du dernier), conteneur sans carte graphique
  (rendu logiciel : seuls les écarts comptent) :

  | | avatar actuel | avatar MPFB |
  | --- | --- | --- |
  | Mise à jour des 10 avatars (IK, visage, peau), CPU | 0,84 ms / image | 0,75 à 1,24 ms / image |
  | Triangles, préréglage bas (ombres comprises) | 109 k | 152 k |
  | Triangles, préréglage haut | 298 k | 240 k |

  Reste à mesurer les fps sur une vraie carte graphique (poste local, `avatar-test.html?bench`).
- Planche : `&sliders&lod` (5, 15 et 45 m au téléobjectif).
