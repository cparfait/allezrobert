# Plan — bâti et commerces reconnaissables

> Plan révisé (octobre 2026) après relecture du code existant. Remplace la proposition initiale
> « archétypes + atlas façades + LiDAR brut + troika ».

## Objectif

À 35 km/h, le joueur reconnaît d'un coup d'œil un immeuble haussmannien, une maison en meulière, une
maison à colombages ou une maison labourdine. Il distingue aussi une boulangerie d'un café ou d'une
pharmacie, et sait dans quel monde il roule. On s'appuie d'abord sur les données réelles (BD TOPO,
LiDAR HD, OSM, orthophotos IGN), sans dégrader les performances.

On reconnaît d'abord une **silhouette** (mansarde, balcons filants, hauteur, débords de toit), puis
une **couleur**, et seulement en dernier une texture. Les priorités en découlent.

## Ce qui existe déjà (ne pas refaire)

| Sujet | Où | État |
| --- | --- | --- |
| Type de toit, faîtage, égout et faîtage réels | `tools/terrain/src/lidar.ts` (`measureRoof`, MNS LiDAR HD 50 cm) → `enrich.ts` | plat, 2 pentes, croupe, monopente ; orientation du faîtage |
| Hauteur réelle | BD TOPO `hauteur` + LiDAR | utilisée par `apps/client/src/world/buildings.ts` |
| Matériaux des murs et des toits | BD TOPO `materiaux_des_murs` / `materiaux_de_la_toiture` (`bdtopo.ts`) | bien plus complet qu'OSM `building:material` en France |
| Façades procédurales | `buildings.ts` (shader TSL) + `meuliere.ts` | fenêtres par étage de 2,8 m, travées, chaînes d'angle, génoise, porte côté rue |
| Surface des routes par tronçon | OSM `surface` + nature BD TOPO (`enrich.ts`, `build-open.ts`) ; pavés `COBBLES` dans `network.ts` | données présentes, rendu à enrichir |
| Textures compressées | `engine/textures.ts` (KTX2 + repli image) | en place |
| Draw calls du bâti | `buildings.ts` : un mesh fusionné par tuile | un seul draw call par tuile |
| Panneaux texte | `world/signs.ts` (`CanvasTexture`) | modèle à réutiliser pour les enseignes |

## Ce qu'on abandonne

- **Extraction du nuage de points LiDAR brut (classe bâtiment).** Le MNS raster suffit et il est
  déjà en cache. Les fichiers LAZ font plusieurs Go par zone pour un gain marginal.
- **Atlas de façades global 2048 px.** Il ferait perdre l'ajustement des fenêtres à la hauteur
  réelle et coûterait de la mémoire vidéo. L'archétype devient à la place un jeu de paramètres du
  shader existant.
- **troika-three-text.** Il est conçu pour les matériaux WebGL classiques, alors que le client tourne
  sur `three/webgpu` avec des matériaux nodes. On utilise des `CanvasTexture` regroupées par tuile,
  comme `signs.ts`.
- **InstancedMesh pour les bâtiments.** Chaque emprise est unique et déjà fusionnée. L'instancing
  est réservé aux petits objets répétés : cheminées, stores, enseignes, terrasses.

## Décision préalable : format des tuiles

La version initiale déclarait les « données build:world intouchables » tout en voulant y stocker
les métadonnées. Décision : **le format des tuiles peut gagner des champs facultatifs** (archétype,
mansarde, commerces, couleur de toit). Le client reste compatible avec les tuiles qui ne les ont pas
(repli sur le comportement actuel). Physique, FTMS/FE-C, multijoueur et export FIT ne changent pas.
Chaque étape qui ajoute des champs indique quelles zones reconstruire (`docs/A_RELANCER_ZONES.md`).

## Étapes (une PR vérifiable chacune, dans l'ordre)

### 1. Archétypes = paramètres du shader + profil de style par monde

> **Réalisé (25 octobre 2026), banc d'essai Montmartre.** Écarts avec ce qui suit :
> - fichiers dans `packages/shared/src/styles/` (`archetypes.json`, `worlds/<monde>.json`), lus par
>   le client et par `tools/terrain` via `@allezrobert/shared` (`archetypes.ts`) ;
> - l'archétype est **choisi au chargement de la tuile** à partir des attributs déjà présents
>   (nature, matériaux BD TOPO, niveaux, hauteur). C'est une règle légère, donc pas de champ
>   nouveau dans les tuiles ni de reconstruction des packs. Les mesures lourdes (mansarde, couleur
>   ortho) restent pour `build:world` ;
> - archétypes livrés : `haussmann`, `faubourien`, `brique`, `moderne`, `maison_faubourg` (Paris),
>   plus `meuliere`, `enduit_idf` et `pierre_auvergne`, qui décrivent le rendu actuel des autres
>   mondes (non activés tant que ces mondes n'ont pas de profil). Les archétypes régionaux
>   (colombages, labourdine, rétaise, silex, chalet, pierre sèche) passent à l'étape 6, avec leurs
>   motifs de shader ;
> - aucun octet de plus par sommet : indice d'archétype dans `binfo.z`, hauteur d'étage dans la
>   partie décimale de `facade.y`, paramètres de façade en tableaux d'uniformes ;
> - auto-profilage : `pnpm --filter @allezrobert/terrain style-profile --world <id>`. Il lit les
>   tuiles construites (BD TOPO et OSM fusionnés), donc sans réseau.
>
> Mesures (`pnpm --filter @allezrobert/perf measure -- --world montmartre --quality high`, Chrome
> sans fenêtre, RTX série 40, 60 s ; l'outil relève désormais aussi les draw calls et le bâti) :
>
> | | Avant | Après |
> | --- | --- | --- |
> | Images par seconde | 63 | 62 |
> | Saccades > 100 ms / > 250 ms | 1 / 0 | 1 / 0 |
> | Shaders compilés en roulant | 2 | 2 |
> | Draw calls | 357 | 355 |
> | Triangles | 11,96 M | 10,56 M |
> | Bâti : sommets / attributs | 18,9 M / 1 737 Mo | 15,5 M / 1 424 Mo |
>
> Le bâti allège de 18 % parce que la génoise (géométrie du style de Limagne) n'est plus construite
> à Paris. Deux constats, antérieurs à l'étape 1 : **le budget de 300 draw calls est déjà dépassé**
> à Montmartre, et **le bâti pèse 1,4 Go de sommets** (triangles non indexés, 23 flottants par
> sommet). Un chantier dédié (géométrie indexée, attributs compressés) mériterait de passer avant les
> étapes qui ajoutent de la géométrie (balcons, mansardes, stores).
>
> Photos (touche P, mêmes points de la sortie) : `docs/screenshots/batiments-avant-montmartre-*.jpg`
> et `batiments-apres-montmartre-*.jpg` (vues à 120 m et 380 m ; à 620 m et 790 m, la caméra
> poursuite se coince dans un mur aussi bien avant qu'après). Non-régression d'un monde sans
> profil : `batiments-apres-billom-*.jpg`.

- Chaque archétype définit la palette des murs, des volets
  et des toits, le type de toit préféré, la pente, le débord, la proportion des fenêtres, le bandeau
  de rez-de-chaussée, les balcons (aucun, ponctuels, filants), le nombre de cheminées et les
  ornements (génoise, chaînes d'angle, colombages).
- Archétypes v1, alignés sur le catalogue réel :
  `haussmann`, `meuliere`, `enduit_idf`, `brique_nord`, `colombages_alsace`, `labourdine`,
  `retaise`, `silex_normand`, `pierre_auvergne` (andésite/arkose), `chalet_savoyard`,
  `pierre_seche` (Provence, Ventoux), `moderne`.
- `style.json` par monde : archétypes pondérés, règles de choix (nature, usage, matériau BD TOPO,
  hauteur, ancienneté), `roofStyle`, palette, `roadStyle`, jalons.
- **Auto-profiling fusionné ici** : un script `tools/terrain` calcule sur la bbox des histogrammes
  BD TOPO (matériaux, hauteurs, étages, usage), complétés par OSM (`roof:colour`, `start_date`,
  `building:levels`). Il produit un `style.json` suggéré, validé à la main puis versionné.
- Client : l'archétype passe au shader par un attribut de sommet, en étendant `binfo`. On ajoute une
  variation de teinte de ±8 % par bâtiment, et deux bâtiments voisins n'ont jamais la même
  combinaison.
- **Banc d'essai : Montmartre.** Aucune zone ne couvre la rue du Cardinal-Lemoine. Ensuite
  Chevreuse (meulière) et Riquewihr (colombages).

### 2. Mansardes, zinc et cheminées

- `measureRoof` : détecter la **mansarde** au MNS (brisis raide puis terrasson presque plat, rupture
  de pente sur le profil). Aujourd'hui, `mansard` est rendu comme une croupe (`HIPPED` dans
  `buildings.ts`).
- `roofs.ts` : géométrie de mansarde (brisis à environ 70°, terrasson à environ 15°), lucarnes
  facultatives pour l'archétype `haussmann`.
- Zinc parisien (gris bleuté, joints debout), en plus de l'ardoise.
- Cheminées instanciées, en nombre et en position selon l'archétype (souches de brique alignées sur
  les murs mitoyens pour `haussmann`).
- Balcons filants haussmanniens (2e et 5e étages) en géométrie légère, fusionnée avec la tuile.

### 3. Commerces

- `overpass.ts` : ajouter `shop=*`, `amenity=cafe|restaurant|bar|pharmacy|bank`, `craft=bakery`
  avec `name`, `brand`, `outdoor_seating`. La requête ne les récupère pas aujourd'hui.
- Rattacher chaque point au mur côté rue du bâtiment qui le contient (même logique que
  `streetWall`), et le stocker dans la tuile.
- Correspondance catégorie → couleur, icône, store :
  boulangerie doré + baguette, café bordeaux + tasse (+ terrasse si `outdoor_seating=yes`),
  pharmacie croix verte légèrement émissive, boucherie rouge, primeur vert, fromagerie jaune,
  poissonnerie bleu, tabac rouge foncé + losange, banque bleu, restaurant parasol.
  Catégories génériques uniquement, aucun logo de marque.
- Rez-de-chaussée commerçant : vitrine sombre (shader), bandeau d'enseigne avec une icône tirée d'un
  petit atlas (256 px), store banne instancié.
- LOD : enseignes et stores à moins de 150 m, terrasses à moins de 80 m.
- Saturation des stores modérée : la route doit rester la première chose qu'on lit
  (`ART_DIRECTION.md`).
- Banc d'essai : Montmartre, puis Billom et Riquewihr. Gain quasi nul en montagne (Alpe, Ventoux,
  Tourmalet), et c'est normal.

### 4. Routes selon la surface réelle

- Rendu par surface, à partir des données déjà présentes : pavé (`sett`, `paving_stones`,
  `cobblestone`), bitume, gravier ou terre (`unpaved`, `gravel`, `ground`).
- Trottoirs : bordure et trottoir le long des voies urbaines (`sidewalk=*` ou `footway=sidewalk`
  voisins).
- Bas-côtés par monde (`roadStyle`) : herbe (Chevreuse, Limagne), bitume d'altitude et neige
  résiduelle (Alpe), forêt puis minéral vers le sommet (Ventoux).

### 5. Vrais noms des commerces

- Tag OSM `name` dessiné dans une `CanvasTexture` par tuile (atlas de bandeaux), visible à moins de
  30 m, au plus une vingtaine à la fois. Au-delà, le bandeau coloré seul.
- Cache des textures, libérées avec la tuile.

### 6. Couleur des toits par l'orthophoto (si la comparaison est convaincante)

- `build:world` : échantillonner l'orthophoto (environ 1 m/px à 1 024 px par tuile) dans l'emprise
  réduite de 1 m. On prend la **médiane du pan au soleil**, en écartant les pixels verts et les
  pixels sombres.
- Ramener la teinte à la famille de couleurs plausible du matériau BD TOPO (tuile, ardoise, zinc,
  bac acier). Ordre de priorité : `roof:colour` OSM, puis l'ortho si l'écart-type est sous le seuil,
  puis la palette de l'archétype.
- Garder seulement si la comparaison avant/après (touche P, même rue) montre un gain visible.

### 7. Jalons

- Silhouettes low-poly : Sacré-Cœur (Montmartre), chapelle sommitale et antenne du Ventoux, château
  de Dampierre (Chevreuse), Puy de Dôme et son antenne. Les lacets de l'Alpe d'Huez sont déjà
  marqués par les plaques de virage (`signs.ts`).
- Mesh de toit direct depuis le MNS seulement si la silhouette procédurale est manifestement fausse
  (coupoles, dômes).

## Performance

- Budget : moins de 300 draw calls, 60 fps sur GPU intégré. Mesure de référence **avant l'étape 1**
  (panneau F3 / `ETUDE_PERFORMANCE.md`), puis après chaque étape.
- Les métadonnées (archétype, mansarde, commerces, couleur) sont calculées une seule fois dans
  `build:world` et lues telles quelles au runtime.
- Aucune texture au-delà de 2048 px ; KTX2 pour les nouveaux atlas (icônes, zinc, vitrines).
- Objets répétés (cheminées, stores, enseignes, terrasses) en `InstancedMesh`, un par type et par
  tuile.

## Contrôle à chaque étape

- `pnpm typecheck`, `pnpm test`.
- Photo (touche P) au même endroit avant et après, rangée dans `docs/screenshots/`.
- Mesure des draw calls et des fps sur la même scène.
- `docs/ART_DIRECTION.md` mis à jour : table des archétypes, table des commerces, profils par monde.
