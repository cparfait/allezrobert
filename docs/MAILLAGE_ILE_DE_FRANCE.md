# Maillage de l'Île-de-France

L'Île-de-France entière (12 070 km²) découpée en **58 zones ouvertes** de 16 km × 16 km
(256 tuiles de 1 km), générées par `tools/terrain/src/mesh-idf.ts` et complétées par
`tools/terrain/src/mesh-tours.ts` (un tour d'environ 20, 30, 40 et 50 km par zone).

## Principe

- **Quadrillage Lambert-93 au kilomètre**, comme toutes les zones : décalage de la grille choisi
  (10, 0) km pour couvrir la région avec le moins de zones.
- **Zones jointives, sans recouvrement entre elles** : chaque zone partage un bord complet avec sa
  voisine, donc `neighbourZones` (`composite.ts`) les raccorde et le parcours libre passe de l'une à l'autre.
- **Contour** : `tools/terrain/mesh/ile-de-france.geojson` (Etalab / IGN, géo.api.gouv.fr). Une zone est
  gardée si au moins 10 % de ses tuiles sont dans la région ; 41 km² de bord restent hors maillage.
- **Nom et départ** : commune la plus peuplée dont le centre est dans la zone.
- **Taille 16 km** : un tour de 50 km (≈ 8 km de rayon) y tient avec la marge de 150 m au bord que
  respecte `zone-plan.ts`, sans dépasser la taille d'une construction raisonnable (Tourmalet : 391 tuiles).
- Les zones thématiques existantes (Montmartre, Longchamp, Meudon, Saint-Cloud, Vincennes, Chevreuse,
  Verrières-Vélizy, Fontainebleau) **restent telles quelles** et recouvrent des zones du maillage (colonne
  de droite) : le monde composé prend chaque tuile d'une seule zone, la principale d'abord.

## Fabrication

```bash
cd tools/terrain
npx tsx src/mesh-idf.ts                       # 1. plan + zones sans tours → mesh/ile-de-france.json, mesh/zones/
npx tsx src/mesh-tours.ts --only idf-rambouillet   # 2. tours 20/30/40/50 km → zones/<id>.json (reprenable)
npx tsx src/mesh-tours.ts                     #    toutes les zones restantes
npx tsx src/mesh-register.ts                  #    inscription au menu (worlds.ts) et à la carte (zoneMap.ts)
npx tsx src/mesh-build.ts                     # 3. construire toutes les zones, une par une, cache vidé entre deux
```

`mesh-tours.ts` écrit `mesh/tours-report.json` (longueur réelle, D+, doublons, échecs). Les zones sans
tours restent dans `mesh/zones/` : elles ne sont ni construites ni listées tant que leurs tours manquent.

## Construction enchaînée et disque

`mesh-build.ts` attend qu'aucune autre construction ni calcul de tours ne tourne, inscrit les zones, puis
construit les zones du centre vers la périphérie. **Après chaque zone il supprime du cache lourd (LiDAR,
MNT, BD TOPO, orthophotos) les seuls fichiers absents d'une photo prise au départ** : le cache des zones
existantes n'est jamais touché, le cache OSM est gardé. Il saute les zones déjà construites, continue
après un échec et s'arrête sous 30 Go libres. Journaux : `data/cache/mesh/build-<id>.log`,
`build-report.json`. Options : `--only`, `--limit`, `--keep-cache`, `--min-free-gb`.

**État d'avancement** : `pnpm --filter @allezrobert/terrain mesh:status` (zones construites, en cours avec ses
tuiles faites, en échec, durée moyenne, temps restant, disque libre).

Bâti : les zones n'ont pas de bloc `enrich`, donc la qualité standard (600 m) : bâtiments BD TOPO aux
toits mesurés au LiDAR sur toute tuile à moins de 600 m d'une route.

## Coût

Total : 14,848 tuiles ; au rythme du guide (12 s et 35 Mo de cache par tuile) ≈ **49 h**
de construction et 508 Go de cache. À construire une zone à la fois (le WMS de l'IGN est
lent), en commençant par la petite couronne, et à ne pas lancer d'un bloc. Le catalogue (`packs`), les
lignes `worlds.ts` / `zoneMap.ts` (`mesh-register.ts`, exigées par les tests) et le déploiement restent à faire
zone par zone ; une zone inscrite mais pas dans le catalogue s'affiche « à venir ».

## Les zones

| Zone | Col, ligne | Part de l'IDF | Zones existantes recouvertes |
|---|---|---|---|
| `idf-saint-clair-sur-epte` | 1, 7 | 23 % | — |
| `idf-magny-en-vexin` | 2, 7 | 36 % | — |
| `idf-marines` | 3, 7 | 44 % | — |
| `idf-persan` | 4, 7 | 28 % | — |
| `idf-blaru` | 0, 6 | 16 % | — |
| `idf-mantes-la-jolie` | 1, 6 | 86 % | — |
| `idf-les-mureaux` | 2, 6 | 100 % | — |
| `idf-cergy` | 3, 6 | 100 % | — |
| `idf-sarcelles` | 4, 6 | 100 % | — |
| `idf-goussainville` | 5, 6 | 89 % | — |
| `idf-dammartin-en-goele` | 6, 6 | 68 % | — |
| `idf-lizy-sur-ourcq` | 7, 6 | 68 % | — |
| `idf-crouy-sur-ourcq` | 8, 6 | 49 % | — |
| `idf-mantes-la-ville` | 1, 5 | 90 % | — |
| `idf-aubergenville` | 2, 5 | 100 % | — |
| `idf-rueil-malmaison` | 3, 5 | 100 % | saint-cloud |
| `idf-paris` | 4, 5 | 100 % | longchamp, montmartre, saint-cloud |
| `idf-montreuil` | 5, 5 | 100 % | vincennes |
| `idf-villeparisis` | 6, 5 | 100 % | — |
| `idf-meaux` | 7, 5 | 100 % | — |
| `idf-la-ferte-sous-jouarre` | 8, 5 | 97 % | — |
| `idf-villeneuve-sur-bellot` | 9, 5 | 36 % | — |
| `idf-houdan` | 1, 4 | 71 % | — |
| `idf-plaisir` | 2, 4 | 100 % | chevreuse |
| `idf-versailles` | 3, 4 | 100 % | chevreuse, meudon, saint-cloud, verrieres-velizy |
| `idf-boulogne-billancourt` | 4, 4 | 100 % | chevreuse, longchamp, meudon, saint-cloud, verrieres-velizy |
| `idf-creteil` | 5, 4 | 100 % | vincennes |
| `idf-bussy-saint-georges` | 6, 4 | 100 % | — |
| `idf-fontenay-tresigny` | 7, 4 | 100 % | — |
| `idf-coulommiers` | 8, 4 | 100 % | — |
| `idf-la-ferte-gaucher` | 9, 4 | 80 % | — |
| `idf-hermeray` | 1, 3 | 35 % | — |
| `idf-rambouillet` | 2, 3 | 98 % | chevreuse |
| `idf-bures-sur-yvette` | 3, 3 | 100 % | chevreuse |
| `idf-savigny-sur-orge` | 4, 3 | 100 % | chevreuse |
| `idf-evry-courcouronnes` | 5, 3 | 100 % | — |
| `idf-vert-saint-denis` | 6, 3 | 100 % | — |
| `idf-nangis` | 7, 3 | 100 % | — |
| `idf-jouy-le-chatel` | 8, 3 | 100 % | — |
| `idf-provins` | 9, 3 | 92 % | — |
| `idf-ablis` | 2, 2 | 62 % | — |
| `idf-etampes` | 3, 2 | 100 % | — |
| `idf-ballancourt-sur-essonne` | 4, 2 | 100 % | — |
| `idf-dammarie-les-lys` | 5, 2 | 100 % | fontainebleau |
| `idf-melun` | 6, 2 | 100 % | fontainebleau |
| `idf-saint-germain-laval` | 7, 2 | 100 % | — |
| `idf-donnemarie-dontilly` | 8, 2 | 100 % | — |
| `idf-sourdun` | 9, 2 | 69 % | — |
| `idf-angerville` | 3, 1 | 74 % | — |
| `idf-maisse` | 4, 1 | 60 % | — |
| `idf-milly-la-foret` | 5, 1 | 98 % | fontainebleau |
| `idf-moret-loing-et-orvanne` | 6, 1 | 100 % | fontainebleau |
| `idf-montereau-fault-yonne` | 7, 1 | 93 % | — |
| `idf-bazoches-les-bray` | 8, 1 | 29 % | — |
| `idf-villenauxe-la-petite` | 9, 1 | 13 % | — |
| `idf-beaumont-du-gatinais` | 5, 0 | 55 % | — |
| `idf-nemours` | 6, 0 | 86 % | — |
| `idf-egreville` | 7, 0 | 53 % | — |
