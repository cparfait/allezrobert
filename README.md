# Allez Robert !

> Simulateur de vélo d'intérieur gratuit, privé et multijoueur, pour rouler entre amis du plateau de Saclay à la forêt de Rambouillet par la vallée de Chevreuse.
> Clin d'œil à Robert Marchand, recordman de l'heure à 105 ans au vélodrome de Saint-Quentin-en-Yvelines, et à Robert Chassat.

![Village de la vallée de Chevreuse](docs/screenshots/j3-1-village-matin.jpg)

## Ce qui marche aujourd'hui

- **Monde réel** : relief IGN LiDAR HD / RGE ALTI, routes, bâtiments, forêts et eau OpenStreetMap, orthophotos IGN ; vallée de Chevreuse (boucle de 10 km par la Côte des 17 Tournants, trois grandes boucles), Alpe d'Huez, Mont Ventoux, et le monde ouvert « Limagne — Neuville » (63) où l'on choisit sa route à chaque carrefour.
- **Matériel** : home trainers FTMS et FE-C (KICKR CORE / CORE 2…), pédales Assioma (CPS, balance G/D), cardio TICKR, Wahoo Direct Connect et ANT+ dans l'app Windows ; vitesses virtuelles (24 rapports), power match, simulateur de capteurs pour rouler sans matériel.
- **Jeu** : physique de Martin et al. (1998), aspiration, coureurs IA, segments KOM / sprint, fantôme de son record, séances ERG (.zwo / .erg / .mrc), test FTP, progression et garage.
- **Rendu** : Three.js WebGPU (repli WebGL2), saisons, jour / nuit, pluie, brouillard, végétation animée par le vent, préréglages bas → ultra.
- **Export** : fichier FIT conforme (balance G/D, positions GPS), validé par le SDK officiel Garmin.

## Démarrer

Prérequis : Node.js ≥ 22, pnpm 10 ; pour l'app Windows : Rust + outils MSVC + WebView2 (voir [apps/desktop/README.md](apps/desktop/README.md)).

```bash
pnpm install
pnpm --filter @allezrobert/terrain build:world   # génère les tuiles du monde (≈ 150 Mo, 3–4 min)
pnpm dev                                          # client (5173) + serveur (2567) + compagnon (5174)
```

Sans tuiles générées, le client bascule sur un monde procédural de développement.

| Commande | Rôle |
| --- | --- |
| `pnpm dev` | Client + serveur + compagnon d'un coup (Chrome / Edge pour le Web Bluetooth) |
| `pnpm dev:client` | Client seul |
| `pnpm --filter @allezrobert/desktop dev` | App Windows (Bluetooth natif, Direct Connect, ANT+) |
| `pnpm dev:server` | Serveur multijoueur (Colyseus) |
| `pnpm dev:all` | Client + serveur + appli compagnon d'un coup (nécessaire au QR code du compagnon) |
| `pnpm test` | Tous les tests (protocoles octet par octet, physique, FIT, terrain, serveur) |
| `pnpm typecheck` | Vérification des types |

Raccourcis en jeu : ↑ / ↓ vitesses, PageUp / PageDown plateau, ← / → direction, C caméra, Espace pause, H interface, M son, B musique (marche / arrêt), N morceau suivant ; avec le simulateur : + / − puissance.

### Tester le monde « Limagne — Neuville » (63)

Le monde ouvert de 7 × 7 km autour de Neuville (Glaine-Montaigut, Bongheat, Égliseneuve-près-Billom) est construit à partir du LiDAR HD, des données topographiques et des orthophotos IGN, et d'OpenStreetMap. Le graphe des routes et le « Tour de Neuville » sont dans le dépôt ; le relief et les photos aériennes (≈ 37 Mo) se génèrent une fois sur ta machine :

```bash
pnpm install
pnpm --filter @allezrobert/terrain build:world -- --world limagne   # ≈ 3 min la 1re fois (téléchargements IGN + OSM), puis tout est en cache
pnpm dev                                                           # puis http://localhost:5173/?world=limagne
```

Dans le menu : **Monde → Limagne — Neuville**, puis le mode **Monde ouvert** (← / → pour choisir ta route au carrefour signalé « Bifurcation dans X m », U pour faire demi-tour), ou **Sortie libre** / **Défi KOM** sur le Tour de Neuville (16,2 km, 4 côtes). Sans matériel, le simulateur fait l'affaire (+ / − pour la puissance). **Explorer la carte** survole le monde en caméra libre.

### Musique et Spotify

La musique de fond (`apps/client/public/music`) démarre au premier clic ; elle se coupe depuis l'accueil, les réglages ou la touche B. Pour piloter son propre Spotify depuis le jeu (titre en cours, lecture / pause, suivant), créer une application sur [developer.spotify.com](https://developer.spotify.com/dashboard) (API « Web API »), y déclarer l'URL de retour, puis créer `apps/client/.env.local` :

```bash
VITE_SPOTIFY_CLIENT_ID=identifiant_de_l_application
# Spotify refuse « localhost » : en local, ouvrir le jeu via http://127.0.0.1:5173 et déclarer cette adresse.
VITE_SPOTIFY_REDIRECT_URI=http://127.0.0.1:5173/
```

La connexion utilise PKCE (aucun secret). La musique sort de l'appli Spotify du coureur (ordinateur, téléphone) ; les commandes de lecture demandent un compte Premium. Quand Spotify joue, la musique du jeu se tait.

## Organisation

Voir [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md). En bref : `apps/client` (jeu), `apps/desktop` (Tauri), `apps/server` (Colyseus + API), `apps/companion` (PWA), `packages/*` (protocoles, capteurs, physique, FIT, séquences HyperFrames, types partagés), `tools/terrain` (IGN + OSM → tuiles).

Documentation : [ROADMAP](docs/ROADMAP.md) · [PROTOCOLS](docs/PROTOCOLS.md) · [ART_DIRECTION](docs/ART_DIRECTION.md) · [DEPLOY](docs/DEPLOY.md).

## Données et licences

- Relief et orthophotos : © IGN, Licence Ouverte Etalab 2.0. Cartographie : © les contributeurs OpenStreetMap (ODbL).
- Aucune donnée personnelle dans ce dépôt public : les traces Garmin (`data/garmin/`) ne sont jamais versionnées, et les itinéraires ne contiennent ni départ ni arrivée au domicile (vérifié par un test).
- Aucun code, asset, nom ni monde issu de Zwift ou MyWhoosh.
- Code : tous droits réservés pour l'instant (dépôt consultable, licence open source prévue plus tard).
