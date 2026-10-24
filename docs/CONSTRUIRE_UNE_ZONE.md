# Construire une zone (sans assistant)

Une **zone** est un monde ouvert : un rectangle de quelques kilomètres, avec le relief LiDAR HD de
l'IGN, les routes d'OpenStreetMap creusées dans le terrain, des orthophotos, et un ou plusieurs
**tours** (itinéraires proposés). Tout est fabriqué hors ligne par `tools/terrain` ; le jeu ne lit
ensuite que des fichiers.

Ce guide couvre les zones de type `open` (Ré, Estérel, Étretat, Sancy, Billom…). Les montées
(`kind: 'climb'`, Alpe d'Huez, Ventoux) et Chevreuse (`kind: 'garmin'`) ont leur propre chaîne,
voir `tools/terrain/README.md`.

## Vue d'ensemble

| Étape | Où | Résultat |
|---|---|---|
| 1. Déclarer la zone | `tools/terrain/src/config.ts` | entrée dans `WORLDS` |
| 2. Construire | `pnpm … build:world -- --world <id>` | `apps/client/public/worlds/<id>/` |
| 3. Vérifier | `verify-world.ts` + le jeu | route sans trou, bonne longueur |
| 4. Catalogue | `pnpm … packs` | `worlds/index.json`, `tiles/pack.json` |
| 5. Menu du jeu | `worlds.ts`, `zoneMap.ts` | la zone apparaît dans le menu et sur la carte |
| 6. Déployer | rsync des tuiles | voir `docs/DEPLOY.md` §12 |

Prérequis : `pnpm install`, accès Internet à la première construction (IGN et OSM). Tout est mis en
cache dans `data/cache/terrain/` ; une reconstruction ne sollicite presque plus les services.
Ne jamais écrire sur `C:` s'il est plein : le cache et la sortie y vivent.

## 1. Déclarer la zone dans `config.ts`

Ajouter une entrée dans `WORLDS` (`tools/terrain/src/config.ts`) en copiant une zone proche, par
exemple `re` ou `esterel` (bord de mer) ou `billom` (campagne). Champs :

```ts
ma-zone: {
  kind: 'open',
  id: 'ma-zone',                       // = nom du dossier et de ?world=
  name: 'Ma zone',
  region: 'Département · Pays',
  originL93: { x: 733000, y: 6516000 },// Lambert-93, multiples de 1 000 m (centre approximatif)
  corridorTiles: { txMin: -7, txMax: 5, tzMin: -5, tzMax: 5 },
  start: { lon: 3.41, lat: 45.73 },    // départ par défaut (centre d'un village)
  orthoPx: 1024,
  enrich: { radiusM: 50, lidarVegetation: true, bdtopoBuildings: true },
  horizon: { halfSizeM: 30000, resM: 100 },
  sea: true,                           // seulement au bord de la mer
  tours: [ … ],
},
```

- **Origine** : convertir le centre voulu en Lambert-93 (E, N) et arrondir au km. `tools/terrain/src/lambert93.ts`
  contient la projection.
- **Emprise** : `corridorTiles` compte en tuiles de 1 km autour de l'origine. `tx` = est (+), `tz` = sud (+).
  Exemple `txMin: -7, txMax: 5` = de 7 km à l'ouest à 6 km à l'est (13 km). Compter environ
  **12 s et 35 Mo de cache par tuile enrichie** ; viser 100 à 150 tuiles au plus.
- **Mer** : `sea: true` remplace les trous du relief par la mer au lieu des terres voisines.

### Écrire un tour

```ts
{
  routeId: 'mon-tour',                 // nom du fichier routes/<id>.json
  routeName: 'Mon tour par X et Y',
  routeNameEn: 'My tour via X and Y',
  start: { lon: 3.41, lat: 45.73 },    // ou un nom de lieu OSM : 'Billom'
  via: [{ lon: 3.43, lat: 45.75 }, 'Glaine-Montaigut', { lon: 3.40, lat: 45.77 }],
  climbNames: ['Côte de X'],           // facultatif : noms des côtes dans l'ordre
}
```

Le tour part de `start`, passe par les `via` **dans l'ordre**, puis revient à `start` par le plus
court chemin cyclable : même point = boucle. Pour une route à sens unique (aller-retour), mettre en
dernier `via` le point le plus éloigné. Un **nom** (`'Billom'`) désigne un lieu OSM (`place=*`) ; un
`{ lon, lat }` est plus sûr. Placer un point de passage **tous les 2 à 3 km** : trop espacés, le
plus court chemin coupe par une autre route ; trop serrés, la route fait des détours aux
carrefours.

### Partir d'une trace GPX

`tools/terrain/src/gpx-courses.ts` transforme des GPX `COURSE_*.gpx` placés dans `data/garmin/` en
points de passage :

```bash
cd tools/terrain && npx tsx src/gpx-courses.ts
```

Il affecte chaque parcours à la zone qui en contient plus de la moitié, et écrit
`data/cache/gpx-courses.json` (départ, arrivée, `via`) à recopier dans `config.ts`. Seuls les points
de passage sont gardés : la route est reconstruite sur OSM, jamais copiée depuis la trace. Les GPX
du dossier `data/garmin/` ne sont pas versionnés ; ne pas y déposer d'activités privées pour une
zone publique (départ et arrivée = domicile).

## 2. Construire

Depuis la racine du dépôt :

```bash
pnpm --filter @allezrobert/terrain build:world -- --world ma-zone
```

Options utiles :

- `--no-ortho` : sans orthophotos IGN (beaucoup plus rapide pour un essai) ;
- `--offline` : cache seul, échoue si une donnée manque ;
- `--graph-only` : ne réécrit que `graph.json` (quelques minutes, sans tuiles ni tours).

Temps : environ 3 minutes la première fois pour une zone de 7 × 7 km, plusieurs dizaines de
minutes pour une zone de 13 × 11 km avec orthophotos. Le journal détaille chaque étape (OSM, MNT
LiDAR, enrichissement, graphe, tours, tuiles, horizon).

Sortie dans `apps/client/public/worlds/ma-zone/` :

| Fichier | Rôle | Versionné |
|---|---|---|
| `world.json` | emprise, tuiles, attributions | oui |
| `routes/<id>.json` | un tour (points 3D tous les 2 m, côtes, repères) | oui |
| `graph.json` | graphe routier pour choisir sa route aux carrefours | oui |
| `places.json` | noms de villages pour la carte du menu | oui |
| `tiles/` | altitudes, entités, orthophotos | **non** (déployées à part) |

## 3. Vérifier

```bash
npx tsx tools/terrain/src/verify-world.ts --world ma-zone
pnpm dev        # puis http://localhost:5173/?world=ma-zone
```

`verify-world` contrôle les tailles, l'écart route/terrain et les raccords de tuiles. Dans le jeu :
menu **Monde → ma zone**, rouler le tour, ouvrir la carte d'itinéraire (le tracé doit suivre de
vraies routes, sans aller-retour parasite ni saut) et regarder le profil d'altitude.

Problèmes fréquents :

- **Tour qui coupe ou fait un détour** : ajouter ou déplacer un point de passage sur une route
  nommée, pas dans un champ ; un point à plus de ~50 m d'une route roulable est accroché à la plus
  proche, parfois la mauvaise.
- **« Pas de chemin entre … »** : un des points est sur une route non roulable (sentier, escalier) ou
  dans une zone coupée par la limite de l'emprise ; le déplacer ou agrandir `corridorTiles`.
- **Aller-retour sur la même route** : normal pour une impasse ; le tour est publié en boucle quand
  il revient au départ dans le même sens (`circuit.ts`).
- **Overpass en panne** : `TERRAIN_OVERPASS=<url>` pour un autre miroir, ou `--osm-api` pour l'API
  principale d'OSM. Derrière un proxy d'entreprise : `NODE_USE_ENV_PROXY=1`.

## 4. Catalogue et packs

```bash
pnpm --filter @allezrobert/terrain packs
```

Régénère `tiles/pack.json` (liste et tailles des fichiers) et `worlds/index.json` (catalogue de
toutes les zones : nom, région, parcours, taille). Ce dernier est versionné et livré avec le jeu ;
c'est aussi lui qui sert à déduire les **zones voisines** chargées ensemble (`?world=a+b`) à partir
des emprises `l93`.

Si la zone touche une zone existante (Neuville/Billom, Meudon/Longchamp…), refaire aussi leur
graphe : `build:world -- --world <voisine> --graph-only`, puis `packs`.

## 5. L'ajouter au menu du jeu

Deux fichiers côté client :

- `apps/client/src/world/worlds.ts` : une ligne dans `WORLD_LIST` (identifiant, nom fr/en, phrase
  d'accroche) ; l'ordre du fichier est l'ordre du menu.
- `apps/client/src/world/zoneMap.ts` : une ligne dans `ZONE_SPOTS` (centre en Lambert-93, `open`,
  région, nom) pour la placer sur la carte de France. Le centre se déduit de `originL93` et de
  `bounds` dans `world.json`.

Puis relancer `pnpm typecheck` et `pnpm test`.

## 6. Déployer

Voir `docs/DEPLOY.md` §12 : les `routes/*.json` et `world.json` partent dans l'image web ; les
`tiles/` se copient sur le serveur (`rsync` ou `scp -r` de `apps/client/public/worlds/<id>/tiles/`
vers `/opt/allezrobert/deploy/data/worlds/<id>/`). Rien à redémarrer.

## 7. Valider avant de commiter

- [ ] la zone se charge avec `?world=<id>` et le tour roule de bout en bout ;
- [ ] `pnpm typecheck` et `pnpm test` passent ;
- [ ] aucun GPX ni `data/` dans le commit (`git status`) ;
- [ ] `world.json`, `routes/`, `graph.json`, `places.json`, `index.json` sont dans le commit, pas `tiles/` ;
- [ ] les attributions (IGN, OSM) sont dans `world.json` et affichées par le client.

## Sources et licences

Relief et orthophotos : IGN (Licence Ouverte Etalab 2.0). Routes et lieux : OpenStreetMap
(ODbL : attribution et partage à l'identique si les entités sont redistribuées). Tableau complet
dans `tools/terrain/README.md`.
