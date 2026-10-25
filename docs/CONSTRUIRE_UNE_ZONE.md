# Construire une zone (sans assistant)

Une **zone** est un monde ouvert : un rectangle de quelques kilomètres, avec le relief LiDAR HD de
l'IGN, les routes d'OpenStreetMap creusées dans le terrain, des orthophotos, et un ou plusieurs
**tours** (itinéraires proposés). Tout est fabriqué hors ligne par `tools/terrain` ; le jeu ne lit
ensuite que des fichiers.

Ce guide couvre les zones de type `open` (Ré, Estérel, Étretat, Sancy, Billom…). Les montées
(`kind: 'climb'`, Alpe d'Huez, Ventoux) et Chevreuse (`kind: 'garmin'`) calculent leurs itinéraires avec
leur propre chaîne, voir `tools/terrain/README.md` ; leur bloc `open: { start }` dans `config.ts` les
construit ensuite en monde ouvert comme les autres zones (`build:world`), itinéraires publiés gardés
tels quels et creusés en priorité. Refaire un de ces itinéraires : `build:world -- --world <id>
--routes-only`, puis `build:world -- --world <id>`.

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

## Le plus simple : l'outil graphique

```bash
pnpm zone-builder        # puis http://127.0.0.1:5199  (ZONE_BUILDER_PORT=<port> pour changer)
```

Outil **local de développement** (écoute `127.0.0.1` uniquement, jamais déployé, aucune entrée dans
le bundle du jeu). Il remplace les étapes 1, 2, 3, 4 et 5 ci-dessous :

- **Lit les zones réelles** : `config.ts`, `tools/terrain/zones/*.json`, `worlds.ts`, `zoneMap.ts`,
  `worlds/index.json` ; la colonne de gauche indique pour chacune si elle est construite, au menu, sur
  la carte. Les emprises existantes sont dessinées en bleu.
- **Crée ou modifie** une zone de type `open` (clic sur une zone existante pour la modifier) sur le
  fond Plan IGN : mode *Emprise* (rectangle, calé sur des tuiles de 1 km ; origine, `corridorTiles`,
  nombre de tuiles, temps et cache estimés), formulaire (identifiant, noms, région, accroche, mer,
  orthos), mode *Points du tour* (clic : le 1er point est le départ, les suivants sont les `via`),
  mode *Choisir le départ*. Un tour posé à la main s'affiche en ligne droite ; la vraie route est
  calculée sur OSM à la construction.
- **Remplit le formulaire seul** dès que l'emprise est dessinée : orthos (1024 px), région (géocodage inverse du centre par `geo.api.gouv.fr` : « Département · Région »,
  avec les accents), « bord de mer » (présence de `natural=coastline` dans l'emprise), nom et
  identifiant d'après le plus gros lieu de l'emprise (population puis proximité du centre), accroche
  fr et en (trois lieux marquants, « bord de mer », longueur et D+ du tour retenu, comme les accroches
  de `worlds.ts`). Chaque champ porte un repère « auto » ; dès qu'on en modifie un à la main il n'est
  plus jamais écrasé, et *Recalculer* rend la main à l'automatique. Les zones existantes sont chargées
  sans rien écraser. Sans réseau, les champs restent vides, rien ne bloque.
- **Propose des tours automatiquement** (section *Tour automatique*) : longueur visée (15, 25, 40 ou
  60 km), nombre de variantes, départ par défaut = le plus gros lieu de l'emprise (*Choisir le départ*
  pour le fixer au clic). Le serveur télécharge OSM (mêmes blocs Overpass que `build:world` : le cache
  sert ensuite à la construction ; miroirs de `TERRAIN_OVERPASS`, progression affichée), construit le
  graphe, cherche des boucles sur des routes revêtues nommées (pas de pistes), sans aller-retour
  (au plus 15 % de tronçons doublés), dans l'emprise, avec un point de passage tous les ~2,5 km ; il
  affiche le **tracé réel** sur la carte, avec longueur, D+ (si le MNT est déjà en cache : il n'est
  jamais téléchargé pour l'aperçu), part de chaque type de route. *Régénérer* donne d'autres
  variantes, *Utiliser ce tour* l'ajoute à la zone (les `via` générés vont dans le JSON, modifiables à
  la main). Le tracé proposé utilise les mêmes coûts que `build:world` : c'est celui qui sera
  construit. Si aucune boucle propre n'existe, il propose un compromis signalé, sinon explique
  (emprise trop étroite, lac, relief : agrandir ou changer de départ). Le calcul refuse de démarrer
  pendant une construction (même d'un autre terminal) pour ne pas écrire dans le cache en même temps.
- **Écrit de façon sûre** : la zone va dans `tools/terrain/zones/<id>.json` (même forme que `WORLDS`,
  versionné, chargé par `config.ts` ; un fichier de même `id` qu'une entrée de `WORLDS` la remplace,
  supprimer le fichier revient à l'original). Les champs que l'outil ne gère pas (`horizon`,
  `enrich`, `koms`, `climbNames`, `allowTracks`) sont conservés. Pour une zone **nouvelle**, une ligne
  est ajoutée à `WORLD_LIST` (`worlds.ts`) et à `ZONE_SPOTS` (`zoneMap.ts`) ; pour une zone existante,
  seul le centre de `ZONE_SPOTS` est mis à jour (noms et accroches du menu : à retoucher dans ces
  fichiers). Chaque fichier est sauvegardé avant écriture dans `data/cache/zone-builder/backups/`,
  écrit par fichier temporaire puis renommage, et rien n'est écrit si une des trois cibles est illisible.
- **Construit** : *Enregistrer + construire* enchaîne `build:world`, `verify-world` et `packs`
  (cases à cocher : sans orthos, hors ligne, graphe seul). Journal en direct, bouton *Annuler*
  (arrête tout l'arbre de processus). *Construire / reprendre* relance : le cache
  `data/cache/terrain/` fait repartir où l'on s'était arrêté ; la page retrouve le journal après
  rechargement. Une seule construction à la fois : l'outil refuse de démarrer si une construction tourne déjà, y compris
  lancée depuis un autre terminal (et d'enregistrer pendant la sienne).
- À la fin, la zone est dans le menu du jeu et se charge avec `?world=<id>` : rien d'autre à faire
  (relancer `pnpm dev` si le serveur de développement ne s'est pas rafraîchi). Il reste à
  `pnpm typecheck && pnpm test` avant de commiter, et à déployer les tuiles (§6).

Limites : zones `open` seulement (pas les montées ni Chevreuse), pas de zone privée, tours par noms
de lieux OSM listés mais non placés sur la carte (à saisir en `{lon, lat}` si besoin). Emprise de
plus de 400 tuiles refusée pour le calcul. Le D+ des boucles proposées est une estimation sur le MNT à
8 m ; le profil exact vient de la construction. Le préfixe `ZONE_BUILDER_FORCE=1` désactive le garde-fou
« construction en cours » (tests uniquement).

Le reste du guide décrit ce que l'outil fait, pour le faire à la main ou comprendre un échec.

## 1. Déclarer la zone dans `config.ts`

Ajouter une entrée dans `WORLDS` (`tools/terrain/src/config.ts`) ou un fichier JSON de même forme
`tools/terrain/zones/<id>.json` (c'est ce que fait l'outil graphique) en copiant une zone proche, par
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
  orthoPx: 1024,                       // côté des orthophotos par tuile de 1 km
  // enrich: facultatif (défaut QUALITY.enrich : rayon 600 m, arbres LiDAR, bâtiments BD TOPO) ; false = sans
  horizon: { halfSizeM: 30000, resM: 100 },
  sea: true,                           // facultatif, seulement au bord de la mer
  tours: [ … ],
},
```

- **Origine** : convertir le centre voulu en Lambert-93 (E, N) et arrondir au km. `tools/terrain/src/lambert93.ts`
  contient la projection.
- **Emprise** : `corridorTiles` compte en tuiles de 1 km autour de l'origine. `tx` = est (+), `tz` = sud (+).
  Exemple `txMin: -7, txMax: 5` = de 7 km à l'ouest à 6 km à l'est (13 km). Compter environ
  **12 s et 35 Mo de cache par tuile enrichie** ; viser 100 à 150 tuiles au plus.
- **Champs facultatifs de `WorldBase`** : `enrich` (réglage ou `false`), `region`, `sea`, `private`.
  Un monde privé (lieu personnel) se déclare en JSON dans `data/private/worlds/<id>.json`, même forme
  que `WORLDS`, jamais versionné.
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
  // facultatifs : koms: [{ id, name, from, to }] (montées chronométrées),
  //               allowTracks: true (pistes permises, pénalisées : secteurs pavés)
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

Variables d'environnement : `TERRAIN_WORLD=<id>` (équivalent de `--world`), `TERRAIN_OFFLINE=1`
(équivalent de `--offline`), `TERRAIN_OUT_DIR=<dossier>` (construire à côté puis basculer d'un coup,
utile si `C:` est plein). `--routes-only` (script `build:routes`) ne concerne que les mondes
`garmin`, pas les zones `open`.

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

`verify-world` contrôle les tailles, l'écart route/terrain, les raccords de tuiles et le **départ du
roulage libre** : le jeu pose le coureur sur la route du graphe la plus proche du départ, quelle qu'elle
soit ; `build:world` recale donc `start` sur une vraie route à moins de 300 m (départementale, rue
d'au moins 4 m, allée large et nommée fermée aux voitures), et `verify-world` signale « à revoir »
une piste, une ruelle ou un point à côté de la route (`src/open-start.ts`). L'outil graphique affiche
ce contrôle dans *Vérifier les zones*. Dans le jeu :
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
- **Overpass en panne** : `TERRAIN_OVERPASS=<url>[,<url>…]` pour d'autres miroirs (`--osm-api` existe
  seulement pour `build-tiles.ts`, pas pour `build:world`). Derrière un proxy d'entreprise : `NODE_USE_ENV_PROXY=1`.

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

Les deux listes doivent contenir les mêmes identifiants que `WORLDS` (plus les zones privées
voulues) : vérifier qu'aucune zone déclarée dans `config.ts` n'est absente. Toutes les zones,
montées et Chevreuse comprises, y figurent avec `open: true`. Puis relancer `pnpm typecheck` et `pnpm test`.

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
