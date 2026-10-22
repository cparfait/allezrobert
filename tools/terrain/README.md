# @allezrobert/terrain — mondes « Vallée de Chevreuse », « Alpe d'Huez », « Mont Ventoux », « Neuville — Le Roussel »

Chaîne hors ligne qui fabrique les mondes du jeu à partir du relief IGN, d'OpenStreetMap et (pour
Chevreuse seulement) des sorties Garmin de l'auteur : itinéraires nettoyés, tuiles d'altitude avec
routes déjà creusées dans le terrain, entités vectorielles par tuile.

Le monde est choisi par `--world <id>` (ou `TERRAIN_WORLD=<id>`), `chevreuse` par défaut ; les
paramètres de chaque monde (origine, corridor, montée) sont dans `src/config.ts` (`WORLDS`).
Sortie : `apps/client/public/worlds/<id>/`, chargée par le client avec `?world=<id>`.

```bash
pnpm --filter @allezrobert/terrain build:world -- --world alpe-dhuez    # montée de l'Alpe d'Huez
pnpm --filter @allezrobert/terrain build:world -- --world mont-ventoux  # Ventoux par Bédoin
npx tsx tools/terrain/src/verify-world.ts --world alpe-dhuez
pnpm --filter @allezrobert/terrain build:world      # Chevreuse : tout (réseau la 1re fois, puis cache) ~4 min
pnpm --filter @allezrobert/terrain build:routes     # itinéraires seuls (garde les tuiles existantes)
pnpm --filter @allezrobert/terrain fetch:osm        # remplit seulement le cache OSM
npx tsx tools/terrain/src/verify-world.ts           # tailles, écart route/terrain, raccords de tuiles
npx vitest run tools/terrain                        # tests (projection, profils, creusement, vie privée)
```

Options de `build-world.ts` : `--no-ortho` (pas d'orthophotos), `--offline` (cache seul, échoue
si une donnée manque ; équivalent `TERRAIN_OFFLINE=1`), `--routes-only`. `TERRAIN_OUT_DIR=<dossier>`
construit le monde ailleurs (ex. `data/cache/terrain/stage-world`) pour le recopier d'un coup
dans `apps/client/public/worlds/chevreuse/` sans priver le client de tuiles pendant ~4 min.

Tout ce qui est téléchargé est conservé dans `data/cache/terrain/` (ignoré par git) : une
reconstruction ne sollicite plus les services. Ne jamais écrire sur C: (disque plein).

## Sources et licences

| Donnée | Source | Licence | Attribution affichée |
| --- | --- | --- | --- |
| Relief | IGN **MNT LiDAR HD** (`IGNF_LIDAR-HD_MNT_ELEVATION.ELEVATIONGRIDCOVERAGE.LAMB93`, 50 cm natif) via WMS-R `data.geopf.fr/wms-r`, `image/x-bil;bits=32` ; repli **RGE ALTI® 1 m** (`ELEVATION.ELEVATIONGRIDCOVERAGE.HIGHRES`) là où le LiDAR n'a pas de valeur | Licence Ouverte Etalab 2.0 | « © IGN — RGE ALTI® / LiDAR HD (Licence Ouverte Etalab 2.0) » |
| Routes, bâtiments, forêts, eau, lieux | OpenStreetMap via Overpass (`overpass.openstreetmap.fr` en premier, puis `overpass-api.de`, `overpass.private.coffee`, `maps.mail.ru`, `overpass.kumi.systems`) | ODbL 1.0 | « © les contributeurs OpenStreetMap (ODbL) » |
| Orthophotos (indice de couleur du sol, facultatif) | IGN **BD ORTHO®** `ORTHOIMAGERY.ORTHOPHOTOS` (WMS-R, JPEG) | Licence Ouverte Etalab 2.0 | « © IGN — BD ORTHO® (Licence Ouverte Etalab 2.0) » |
| Itinéraires | sorties Garmin (GPX) de `data/garmin/` — **privées**, jamais exportées | — | — |
| Arbres, haies, formes des toits (tuiles enrichies) | IGN **LiDAR HD MNH / MNS** 50 cm (`IGNF_LIDAR-HD_MNH_…`, `IGNF_LIDAR-HD_MNS_…`) via WMS-R, blocs de 500 m | Licence Ouverte Etalab 2.0 | « © IGN — LiDAR HD MNS / MNH (Licence Ouverte Etalab 2.0) » |
| Bâtiments, nature et largeur des voies (tuiles enrichies) | IGN **BD TOPO®** `BDTOPO_V3:batiment`, `BDTOPO_V3:troncon_de_route` via WFS | Licence Ouverte Etalab 2.0 | « © IGN — BD TOPO® (Licence Ouverte Etalab 2.0) » |

Les chaînes d'attribution sont dans `world.json` (`attribution`) et dans chaque itinéraire ; le
client doit les afficher. Les entités des tuiles sont une base dérivée d'OSM : si on les
redistribue publiquement, elles restent sous ODbL (attribution + partage à l'identique).
Usage respectueux des services : requêtes Overpass en petits blocs (0,06° × 0,042°) avec
`User-Agent`, recul exponentiel et rotation des miroirs ; WMS IGN limité à ~8 requêtes/s,
blocs mis en cache.

## Vie privée (dépôt public)

- Les GPX ne quittent jamais `data/garmin/` ; aucune coordonnée de domicile n'est écrite dans un
  fichier versionné (ni dans le code : les points sensibles sont lus à l'exécution).
- Points sensibles = départ et arrivée de chaque sortie. Les 2 premiers et 2 derniers km de
  chaque sortie, et tout point à moins de 2 km d'un point sensible, sont retirés avant tout
  traitement (`trimPrivate`).
- Les itinéraires sont reconstruits sur le graphe OSM (pas de trace brute) ; ils ne peuvent pas
  passer à moins de 2 km d'un point sensible (contrôle avant écriture).
- Le corridor entier doit être à plus de 2 km de tout point sensible, sinon la construction
  échoue (plutôt qu'un « trou » révélateur dans la grille de tuiles).
- Audit final de `apps/client/public/worlds/chevreuse/` (`auditWorldDir`) + test
  `test/privacy.test.ts` (itinéraires, tuiles, emprise, entités, absence de coordonnées GPS
  brutes dans les fichiers versionnés). Le test est ignoré sur un clone sans `data/garmin`.
- L'analyse des sorties (fréquentation, côtes candidates) reste dans `data/cache/terrain/analysis/`.

## Repère et projection

- Lambert-93 (EPSG:2154) implémenté dans `src/lambert93.ts` (LCC sécante GRS80, formules IGN
  NT/G 71). Testé : origine (3°E, 46,5°N) → (700 000, 6 600 000) exactement, facteur d'échelle 1
  à 44° et 49° (1e-12), Paris (2,3522°E, 48,8566°N) ↔ (652 469,02 ; 6 862 035,26) à < 1 cm,
  aller-retour < 1 mm sur toute la métropole.
- Repère monde (mètres) : **x = E − 629 000**, **z = −(N − 6 846 000)**, **y = altitude** (NGF/IGN69).
  Three.js : y vers le haut, x vers l'est, z vers le **sud**. L'origine (629 000 ; 6 846 000) est à
  ~500 m du centre de Chevreuse. `src/frame.ts` fournit les conversions WGS84 ↔ monde.
- Tuile `(tx, tz)` de 1 000 m : x ∈ [tx·1000, (tx+1)·1000], z ∈ [tz·1000, (tz+1)·1000]. Les
  tuiles sont alignées sur le kilomètre Lambert-93 (E = 629 000 + 1000·tx, N_nord = 6 846 000 − 1000·tz).

## Sorties : `apps/client/public/worlds/chevreuse/`

```
world.json                 index (WorldMeta)             versionné
routes/<id>.json           itinéraires (RouteData)       versionnés
tiles/<tx>_<tz>.json       entités (WorldTile)           non versionné (.gitignore local)
tiles/<tx>_<tz>.lo.u16     altitudes 8 m, 126×126        non versionné
tiles/<tx>_<tz>.hi.u16     altitudes 2 m, 501×501        non versionné (tuiles proches des itinéraires)
tiles/<tx>_<tz>.ortho.jpg  orthophoto 256² (lo) ou 512² (hi) px, nord en haut   non versionné
```

Les types TypeScript sont dans `packages/shared/src/route.ts` (`RouteData`, `WorldMeta`,
`WorldTileIndex`, `WorldRouteIndex`, `WorldLod`, `WorldTile`).

### world.json (`WorldMeta`)

```jsonc
{
  "formatVersion": 1, "id": "chevreuse", "name": "Vallée de Chevreuse", "crs": "EPSG:2154",
  "originL93": { "x": 629000, "y": 6846000 },
  "bounds": { "minX": -20000, "minZ": -6000, "maxX": 13000, "maxZ": 11000 },  // monde, m
  "tileSizeM": 1000, "heightResolutionM": 2,
  "heightEncoding": { "type": "uint16le", "stepM": 0.01, "rowOrder": "north-to-south", "colOrder": "west-to-east" },
  "lods": [ { "id": "lo", "resolutionM": 8, "n": 125, "suffix": ".lo.u16" },
            { "id": "hi", "resolutionM": 2, "n": 500, "suffix": ".hi.u16" } ],
  "tiles": [ { "id": "-3_-1", "tx": -3, "tz": -1, "baseM": 103, "minM": 104.54, "maxM": 168.17,
               "lods": ["lo", "hi", "ortho"], "bytes": 633759 }, … ],           // 561 tuiles
  "routes": [ { "id": "chevreuse-boucle", "file": "routes/chevreuse-boucle.json", "name": "…",
                "lengthM": 10059.35, "elevationGainM": 126.61, "loop": true, "main": true }, … ],
  "mainRoute": "chevreuse-boucle",
  "attribution": [ "© IGN — RGE ALTI® / LiDAR HD (Licence Ouverte Etalab 2.0)", "© les contributeurs OpenStreetMap (ODbL)", "© IGN — BD ORTHO® (Licence Ouverte Etalab 2.0)" ]
}
```

`tiles[].lods` liste les fichiers présents : `lo` toujours, `hi` pour les tuiles à moins de 2 km
de la boucle principale ou à moins de 300 m d'un itinéraire secondaire, `ortho` si l'orthophoto a
été téléchargée.

### Altitudes `tiles/<id>.lo.u16` / `.hi.u16`

- Grille de **(n+1)×(n+1)** échantillons `Uint16` petit-boutiste, sans en-tête :
  lo : n = 125, pas 8 m (126² × 2 o = 31 752 o) ; hi : n = 500, pas 2 m (501² × 2 o = 502 002 o).
- Ligne `j` (0 = **nord**, z min) × colonne `i` (0 = **ouest**, x min), rang `k = j·(n+1) + i`.
- Échantillon `(i, j)` au point monde `x = tx·1000 + i·res`, `z = tz·1000 + j·res` ; les
  échantillons de bord sont **partagés** avec la tuile voisine (même valeur, vérifié : écart 0).
- Altitude : `h = baseM + q × 0,01` (cm), `baseM` dans `world.json` et dans le JSON de la tuile
  (même base pour lo et hi).
- Les routes sont **déjà creusées** : sur la chaussée (demi-largeur + 0,5 m) le terrain vaut le
  profil de route lissé, puis raccord smoothstep sur 4 m + demi-largeur (hi) ou 14 m (lo, demi-largeur
  min. 4 m). Priorité : boucle principale > autres itinéraires > routes OSM. Sous un point
  d'itinéraire, terrain hi (bilinéaire) = `y` de la route à 0,2 cm près en moyenne, 1 cm max sur
  la boucle principale. Ponts/tunnels ne sont pas creusés (le client pose le tablier au `y` de la route).
- Source : lo = MNT 8 m (LiDAR HD rééchantillonné par le service, repli RGE ALTI) ; hi = MNT 1 m
  filtré [1 2 1]² puis échantillonné à 2 m. Les deux niveaux d'une même tuile ne coïncident pas
  exactement entre eux (prévoir des jupes aux transitions lo/hi).

Décodage (client) :

```ts
const buf = await (await fetch(`/worlds/chevreuse/tiles/${id}.hi.u16`)).arrayBuffer();
const q = new Uint16Array(buf);            // plateformes petit-boutistes
const N = 501, h = (i: number, j: number) => tile.baseM + q[j * N + i] * 0.01;
```

### Entités `tiles/<id>.json` (`WorldTile`)

Coordonnées **monde absolues** en mètres, arrondies au cm, tableaux plats.

| Champ | Contenu |
| --- | --- |
| `heights` | `{ baseM, stepM: 0.01, encoding: "uint16le", lo: { n: 125, resolutionM: 8, file }, hi?: { n: 500, resolutionM: 2, file } }` (`file` relatif à `tiles/`) |
| `roads[]` | `{ id, kind (highway OSM), name?, ref?, width (m), surface, bridge?, tunnel?, route?, flatten?: [demiLargeurPlate, rayonExtérieur], pts: [x,y,z,…] }` — `y` = profil de chaussée lissé (cohérent avec le terrain creusé). Les arêtes empruntées par un itinéraire sont remplacées par la géométrie lissée de l'itinéraire (`id: "route:<routeId>:<wayId>"`, `route: <routeId>`, mêmes points que `routes/<id>.json`). Géométrie OSM simplifiée à 20 cm en plan / 3 cm en altitude. Découpées aux bords de la tuile. `flatten` présent = couloir déjà creusé (motorway…service, cycleway, track hors ponts/tunnels) ; absent = sentier/piste non creusé. |
| `buildings[]` | `{ id, kind, height (faîtage, m), levels, minHeight?, roof: { shape, height, colour? }, colour?, material?, name?, y (altitude min du terrain sous l'emprise), pts: [x,z,…], holes?: [[x,z,…]] }` — rattaché à la tuile de son centroïde (non découpé). `kind` ∈ house, apartments, church, chapel, farm, barn, shed, garage, industrial, commercial, public, castle, greenhouse, tower, roof, ruins. Hauteurs : `height`/`building:levels`/`roof:*` OSM sinon défauts par type (niveau 3 m, toit 2,5–6 m). |
| `forests[]` | `{ id, kind: deciduous \| conifer \| mixed, name?, rings }` (`leaf_type` OSM, défaut feuillus) |
| `fields[]` | `{ id, kind: farmland \| meadow \| grass \| orchard \| vineyard \| allotments \| heath \| scrub \| wetland \| bare \| sand, rings }` |
| `landuse[]` | `{ id, kind: residential \| industrial \| commercial \| cemetery \| farmyard \| park \| golf \| pitch \| garden \| quarry \| railway, rings }` |
| `water[]` | `{ id, kind: lake \| pond \| river \| reservoir, name?, level (m, 10e centile du terrain sur le contour), rings }` |
| `waterways[]` | `{ id, kind (river, stream, ditch, drain, canal…), width, name?, tunnel?, pts: [x,z,…] }` |
| `railways[]` | `{ id, kind (rail, light_rail…), width, name?, tunnel?, bridge?, pts: [x,z,…] }` |
| `pois[]` | `{ id, kind (village, hamlet, town, locality, church, castle, peak…), name, x, y, z, ele? }` |

`rings` : tableau d'anneaux plats `[x0,z0,x1,z1,…]` (non fermés) ; le premier est l'extérieur
(aire signée positive dans le plan (x, z)), les suivants sont des trous. Les polygones sont
découpés au bord de la tuile (Sutherland–Hodgman) et simplifiés (0,5 m hi, 1,5 m lo).

### Itinéraires `routes/<id>.json` (`RouteData`)

- `points[]` : `{ x, y, z, d }` tous les **~2 m** (`stepM` exact = longueur / nombre de points),
  boucle fermée (le dernier point est à un pas du premier, `d` repart de 0 après `lengthM`).
- Plan : géométrie OSM concaténée, rééchantillonnée à 4 m, lissage gaussien σ = 5 m (arrondit les
  angles des carrefours), Catmull-Rom centripète, rééchantillonnage uniforme à 2 m.
- Altitude : MNT 1 m sous la chaussée (médiane centre / ±1,5 m latéral), ponts et tunnels
  interpolés entre culées, lissage gaussien σ = 10 m puis passes locales jusqu'à une variation de
  pente ≤ 3,5 % par 20 m (rayon de raccordement vertical ≥ ~600 m) ; pas de bruit sous le mètre.
- `segments[]` : `{ id, kind: "kom" | "sprint", name, startM, endM, avgGrade }`. KOM = montée
  ≥ 500 m et ≥ 3 % de moyenne (extrêmes du profil avec hystérésis 4 m, approches plates rognées) ;
  sprint = ligne droite de 300 à 500 m, pente moyenne ≤ 1 %, locale ≤ 2,5 %, écart à la corde
  ≤ 10 m, de préférence sur des routes déjà roulées. Aucun segment ne chevauche le départ.
  Noms : nom de voie explicite (« Côte … », « Route des 17 Tournants » → « Côte des 17 Tournants »),
  sinon « Côte de <lieu OSM le plus proche du sommet> » / « Sprint de <lieu> », élision française.
- Champs facultatifs : `roadWidths[]` (largeur OSM par tronçon), `landmarks[]` (villages traversés
  avec `d`), `stepM`, `minElevationM`, `maxElevationM`, `maxGradePct` (sur 10 m).
- `roadWidthM` = médiane des largeurs OSM (tag `width`, sinon `lanes` × 3 m, sinon défaut par type).

## Méthode

1. **GPX** (`gpx.ts`) → points monde ; parties privées retirées.
2. **OSM** (`overpass.ts`, `osm.ts`) : 32 blocs, éléments dédoublonnés, multipolygones assemblés.
   Graphe routier (`graph.ts`) coupé aux carrefours.
3. **Recalage** (`mapmatch.ts`) : arête la plus proche (≤ 25 m) avec pénalité de cap (> 45° :
   +20 m) et bonus de continuité, trous comblés par plus court chemin (≤ 300 m). Une arête est
   « roulée » par une sortie si au moins la moitié est couverte. Fréquentation = nombre de sorties.
4. **Côtes et sprints candidats** sur les parties publiques des sorties (rapport privé
   `data/cache/terrain/analysis/candidates.json`).
5. **Boucle** (`loop.ts`) : cycles simples énumérés par paires de carrefours (un par maille de
   250 m, priorité aux carrefours roulés) : aller = plus court chemin pondéré, retour = plus court
   chemin disjoint (arêtes et nœuds), 3 pondérations (préférence routes roulées, aléa, neutre).
   Interdits : autoroutes, voies rapides, chemins non revêtus, voies de service non roulées ;
   pénalités primaire ×3,5, secondaire ×1,9 ; un cycle simple n'a pas de cul-de-sac.
   Note rapide = 4·part roulée + 2·fréquence − 3·trafic − écart de longueur + villages + compacité
   + bonus côte/sprint (profil 10 m) ; puis les 40 meilleurs sont reconstruits finement et
   renotés avec les vrais segments ; une boucle sans KOM ni sprint est écartée.
6. **Itinéraires des sorties** (`ridematch.ts`) : un itinéraire par sortie Garmin, fidèle à la
   trace. Partie gardée = plus long morceau contigu de la partie publique (`trimPrivate`) à plus de
   300 m du bord du monde (≥ 10 km, sinon la sortie est ignorée). Recalage HMM (Viterbi façon
   Newson & Krumm) : échantillons tous les 15 m, ≤ 6 arêtes candidates à ≤ 35 m, émission
   ½ (d/6 m)² (+ pénalité trottoir / site propre / chemin), transition |distance routière − distance
   à vol d'oiseau| / 8 m. Résultat : marche ordonnée d'arêtes entières (voies à plus de 100 m du
   bord), demi-tours retirés (injouables), extrémités au carrefour le plus proche. Boucle refermée
   par le plus court chemin cyclable entre la fin et le début (routes roulées un peu préférées,
   grands axes un peu évités). Le rapport privé `data/cache/terrain/analysis/ride-routes.json`
   donne, par sortie, distance/D+ Garmin, partie gardée, écart de recalage, demi-tours, fermeture.
   Nom : « Boucle de <départ> par <A> et <B> » (communes les plus peuplées de la partie roulée).
   Les sorties partent et reviennent hors du monde (≥ 3,4 km du bord) : seule la partie dans le
   monde est reprise, la fermeture remplace l'approche depuis le domicile.
7. **Itinéraire** (`route.ts`) : voir ci-dessus ; départ placé hors segments, au plus près du
   principal village traversé (de la partie roulée pour une sortie). Là où l'itinéraire repasse
   sur la même voie, une seule altitude (moyenne des passages, correction lissée).
8. **Tuiles** (`tiles.ts`, `roads3d.ts`) : profils 3D de toutes les routes OSM (altitude unique par
   nœud, égale à celle de l'itinéraire s'il y passe → continuité aux carrefours), creusement, entités.

## Résultat actuel (octobre 2026)

- **Boucle du jalon 1** `chevreuse-boucle` — « Boucle de Chevreuse par Dampierre-en-Yvelines et
  Saint-Forget » : 10,06 km, D+ 127 m, 81,9 → 166,7 m, 5 030 points, chaussée 6,5 m, 100 % sur
  des routes déjà roulées. Départ à Chevreuse ; D 58 (vallée de l'Yvette, 3,75 km) → D 91
  (2,8 km) → D 13 par le plateau (3,5 km). Segments : KOM « Côte des 17 Tournants » 1 358 m à
  5,4 % (pente max 7,8 %) ; sprint « Sprint de Saint-Forget » 500 m sur le plateau.
- Sorties Garmin (7) : 4 ont assez de parcours dans le monde. Partie gardée recalée à ≤ 0,5 %
  près de la trace GPS (demi-tours compris).

  | Itinéraire | Partie roulée gardée | Fermeture | Longueur | D+ |
  | --- | --- | --- | --- | --- |
  | `boucle-toussus-le-noble-villiers-le-bacle` | 20,0 km | 12,4 km | 32,2 km | 190 m |
  | `boucle-voisins-le-bretonneux-chevreuse` | 37,4 km | 8,8 km | 46,0 km | 379 m |
  | `boucle-gif-sur-yvette-gometz-la-ville` | 33,5 km (2,1 km de demi-tours retirés) | 17,0 km | 50,1 km | 516 m |
  | `boucle-voisins-le-bretonneux-les-molieres` | 58,2 km | 18,3 km | 76,2 km | 821 m |
- 561 tuiles (corridor 33 × 17 km : lon ≈ 1,77–2,21, lat ≈ 48,61–48,76), dont 204 en 2 m.
  Tailles : `.hi.u16` 102 Mo, `.lo.u16` 18 Mo, `.json` 54 Mo, `.ortho.jpg` 14 Mo — **≈ 190 Mo**
  (non versionnés) ; `world.json` 96 Ko et `routes/` 5,4 Mo (versionnés).
- Cache : MNT ≈ 850 Mo (1 m sur ~205 km², 8 m sur le corridor), OSM 168 Mo, orthos 12 Mo.

## Montées célèbres (`src/build-climb.ts`, `src/climb.ts`)

Mondes `kind: 'climb'` de `WORLDS` : un seul itinéraire point à point (`loop: false`), **aucune
donnée Garmin lue** (les règles de vie privée ci-dessus ne concernent que Chevreuse).

1. **OSM** du corridor, avec en plus éboulis (`scree`), glaciers, cols, stèles et panneaux
   `tourism=information` nommés « Virage … » (`mountainClauses`, requête distincte : le cache de
   Chevreuse reste valable).
2. **Tracé imposé** : chaque point de la config (départ, pied, passages, arrivée, fin) est rattaché
   à l'arête OSM la plus proche (routes `preferRefs` d'abord) ; plus court chemin qui parcourt ces
   arêtes dans l'ordre, sens uniques respectés (`routeViaEdges`), rogné aux projections du départ
   et de la fin.
3. **Plan fidèle aux lacets** : rééchantillonnage 1 m, lissage gaussien σ = 1,5 m seulement (pas de
   Catmull-Rom), pas uniforme de 2 m ; écart au tracé OSM ≤ 0,5 m. Seuls les angles de carrefour
   plus serrés que la demi-chaussée + 1 m sont arrondis localement (`relaxTightCorners`) ; les
   épingles (rayon d'axe ≥ 5 m) sont intactes.
4. **Profil** : altitude de la *plate-forme* de chaussée (`platformHeight` : profil en travers du
   MNT 1 m sur ±5 m, fenêtre de ±2 m la plus plate), ponts/tunnels interpolés, lissage σ = 8 m,
   variation de pente ≤ 6 %/20 m (montagne).
5. **Lacets** (`hairpins` dans l'itinéraire, type `RouteHairpin`) : épingles ≥ 150° sur ≤ 120 m
   détectées sur la géométrie ; pour l'Alpe d'Huez, les 21 panneaux OSM font foi (numéro `ref`,
   nom, altitude `ele`, plaque `inscription` ; numéro manquant déduit des voisins), sommet = point
   de courbure maximale à ±45 m du panneau, rayon minimal sur une corde de ±4 m. Repères HUD
   (`landmarks`) : « Virage 21 · La Savoyâte »…, villages et hameaux, repères de la config.
6. **KOM** du pied (`climbStart`) à l'arrivée (`finish`) ; bilan comparé aux valeurs publiées
   (`reference`) dans le journal et dans `data/cache/terrain/analysis/<id>-report.json`.
7. **Tuiles** seulement à moins de `loMarginM` (5 km) de la route, en 2 m à moins de `hiMarginM`
   (400 m). Creusement « par passage » (`carveGridPasses`) : dans un lacet, les deux branches
   proches contribuent toutes deux (moyenne pondérée, chaussée plate à l'altitude de sa branche)
   au lieu d'une marche à mi-distance. Pas de quantification par tuile (`stepM`, 1 cm, 2 cm si la
   tuile a plus de 650 m de dénivelé), indiqué dans le JSON de la tuile et dans `world.json`.
8. **Horizon** (`world.json` → `horizon`, fichier `tiles/horizon.u16`) : grille unique de 100 m sur
   ±30 km (Alpe) / ±35 km (Ventoux), même encodage que les tuiles, pas de 10 cm, pour la ligne de
   crête au-delà des tuiles (Écrins, Grandes Rousses, Belledonne ; Alpilles, Luberon).

### Résultat (octobre 2026)

| Monde | Montée (KOM) | Réf. publiées | Lacets | Tuiles |
| --- | --- | --- | --- | --- |
| `alpe-dhuez` | 14,24 km du giratoire D1091/D211 (720 m) au sommet de la D211 (1 851 m) : 1 130 m, 7,94 % ; max 11,5 %/100 m (16,5 %/10 m, carrefour de la station) | 13,8 km / 1 071–1 120 m / 7,9–8,1 % (Wikipédia), 14,454 km / 1 121 m / 7,9 % (alpedhuez.com), 14 km / 1 122 m / 8 % (climbfinder) | 21 numérotés (panneaux OSM, altitudes à ±6 m de celles des panneaux), rayon d'axe 5,5–13,4 m | 161 (16 en 2 m), 23,5 Mo + horizon 0,7 Mo |
| `mont-ventoux` | 21,27 km de Bédoin (310 m) au sommet routier (1 890 m) : 1 580 m, 7,43 % ; max 11,8 %/100 m | 21,8 km / 1 617 m / 7,43 % (Wikipédia EN), 20,8 km / 1 594 m / 7,7 % (climbfinder), 21 km (itinéraire OSM) | 3 épingles (Saint-Estève km 6,0) | 285 (39 en 2 m), 46,3 Mo + horizon 1,0 Mo |

## Monde ouvert « limagne » (Neuville, Puy-de-Dôme)

`pnpm --filter @allezrobert/terrain build:world -- --world limagne` (`src/build-open.ts`, type
`open` dans `src/config.ts`) : emprise de 7 × 7 km (E 729–736 km, N 6 512–6 519 km) autour de
Neuville, Glaine-Montaigut, Bongheat et Égliseneuve-près-Billom, en bordure de la Limagne.

- **Toujours** les trois sources : relief **LiDAR HD** 1 m (repli RGE ALTI) sur toute l'emprise,
  toutes les tuiles en 2 m ; **OSM** pour la topographie (routes, chemins, bâti, cultures, eau) ;
  **orthophotos** IGN à 1 024 px par tuile (≈ 1 m/px). Horizon à ±45 km (Chaîne des Puys, Forez).
- OSM : Overpass si un miroir répond, sinon l'**API principale d'OpenStreetMap** (`/api/0.6/map`,
  blocs de 0,02° × 0,015°, `fetchOsmApi`), convertie au format Overpass `out geom`.
- Toutes les routes sont creusées (aucun itinéraire prioritaire) et **`graph.json`** décrit le
  réseau roulable (`RoadGraphData` de `packages/shared`) : routes, rues, chemins agricoles et pistes
  cyclables, sens uniques, revêtement, profil de chaque arête identique à celui qui est creusé,
  altitude unique aux carrefours. Une arête qui sort de l'emprise (à 30 m du bord) n'est pas roulable.
- Tours proposés (`tours`) : boucles par des villages nommés (lieux OSM), construites avec le
  même chemin lissé que le mode ouvert (`OpenPath`), montées détectées sur le profil.

Résultat (22/10/2026) : 1 245 arêtes, 227 km roulables dont 114 km revêtus (0,7 Mo) ; « Tour de
Neuville » 16,2 km, 346 m D+, 4 côtes ; 49 tuiles (relief 24,6 Mo, orthophotos 8,6 Mo), raccords
de bords à 0,0 cm ; construction en 2 min 30 une fois les données en cache.

## Mondes privés et tuiles enrichies (`src/enrich.ts`, `src/lidar.ts`, `src/bdtopo.ts`)

- **Monde privé** : `data/private/worlds/<id>.json` (même forme que `WORLDS`, jamais versionné) ;
  le dossier de sortie reçoit un `.gitignore` « `*` » (ni tuiles, ni `world.json`, ni itinéraire
  dans le dépôt). Construction : `build:world -- --world <id>`. Champs propres aux montées
  utiles ici : `markings` (`none` : petite départementale sans marquage), `roadWidthM` (largeur
  mesurée, BD TOPO ou orthophoto).
- **`enrich`** `{ radiusM, lidarVegetation, bdtopoBuildings }` : sur les tuiles haute résolution
  à moins de `radiusM` de l'itinéraire, le JSON de la tuile reçoit :
  - `trees` [x, z, hauteur, rayon, …] : maxima locaux du MNH lissé (fenêtre 1,2 m + 7 % de la
    hauteur), rayon du houppier sur 8 directions ; hors bâtiments BD TOPO (dilatés de 1 m) ;
  - `shrubs` [x, z, hauteur, …] : cellules de 1,5 m de végétation basse (0,6–2,5 m) hors
    houppiers et chaussées. Les **cultures hautes** (maïs) sont écartées : composante connexe
    > 900 m² dont > 40 % de cellules « intérieures » (une haie n'en a presque pas) ;
  - `buildings` remplacés par la BD TOPO (emprises relevées sur les photos aériennes, une par
    bâtiment réel) : `kind` d'après nature / usage / surface, `material` des murs et
    `roof.material` d'après les codes des fichiers fonciers, toit mesuré dans le MNS (faîtage =
    95e centile, égout = 8e centile, forme plat / deux pans / croupes / monopente, `roof.ridge:
    'short'` si le faîtage suit le petit côté) ;
  - voies OSM hors itinéraire : `surface` (`gravel` pour « Route empierrée », `ground` pour
    « Chemin ») et `width` du tronçon BD TOPO apparié (distance médiane ≤ 4 m) ;
  - `enriched` { vegetation, buildings, roads } : le client n'y sème plus d'arbres au hasard.
- Le client place un arbre « réel » (tronc, branches, cartes de feuillage, `world/trees.ts`) par
  sommet, à sa hauteur et à son houppier mesurés, en blocs de 125 m (détail jusqu'à 160 m).

## Limites connues

- Bâtiments sans `height`/`building:levels` : hauteurs par défaut ; les `building:part`
  (clochers détaillés) ne sont pas exploités.
- Les ponts ne sont pas modélisés (le client doit poser un tablier entre culées au `y` fourni).
- Les forêts sans `leaf_type` sont classées en feuillus.
- Le niveau lo des tuiles hi provient du MNT 8 m : raccords lo/hi à gérer côté client (jupes).
