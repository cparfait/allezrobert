# Plan — Monde ouvert en ligne (v1 : Longchamp)

Objectif : se connecter à tout moment sur Longchamp, y croiser d'autres coureurs, et rejoindre un ami
où qu'il roule. Pas de départ, pas d'hôte, pas de classement.

## État des lieux (ce qui existe, vérifié dans le code)

| Besoin | Existant | Fichier |
| --- | --- | --- |
| Salle temps réel, 20 coureurs, physique serveur | `RideRoom` (privée, code d'invitation) | `apps/server/src/ride/RideRoom.ts` |
| Remplacer une IA par un humain qui arrive | `sim.yieldAiSlot()` | `ride/simulation.ts` |
| Reconnexion 30 s, anti-triche puissance | oui | `RideRoom`, `power-guard.ts` |
| Amis, présence, invitations, « rejoindre » | `FriendHub`, `POST /friends/:id/join` → `{roomId, inviteCode, routeId, mode}` | `friends/hub.ts`, `http/friends-routes.ts` |
| Rejoindre un ami côté jeu | `FriendsPanel.join` → `joinSettings` → `launch({inviteCode})` | `ui/menu.ts:465` |
| Rendu des autres coureurs | `Multiplayer.render` | `game/multiplayer.ts` |
| Longchamp | boucle `anneau-de-longchamp`, 3,58 km, 12,7 m D+ | `public/worlds/longchamp/` |

## Constats qui cadrent le plan

1. **Le serveur ne connaît pas Longchamp** : `ROUTES_DIR` pointe vers un seul dossier (Chevreuse) et
   `RouteStore.resolve` retombe silencieusement sur l'itinéraire par défaut si l'identifiant est inconnu.
2. **Une salle = un itinéraire fixe.** Le mode `open` (carrefours au choix) est un chemin propre à chaque
   joueur, non partageable. La v1 se fait donc sur **la boucle de Longchamp**, avec **demi-tour possible** :
   le coureur passe sur l'itinéraire inversé (distance L − d), l'instantané porte son sens (`dir`).
3. **Aucune salle n'est publique** : `setPrivate(true)`, entrée par code, créateur obligatoire, hôte.
4. **Rejoindre un ami ne marche que dans le monde déjà chargé** (`joinSettings` cherche l'itinéraire parmi
   ceux de la zone ouverte).

## Décisions par défaut (modifiables)

- Comptes obligatoires (pas d'invités anonymes) : responsabilité du pseudo, signalement possible.
- **Chat, « Ride On » et voix (micro) actifs** dans les salles publiques, comme dans une sortie privée
  (anti-flood du chat en place). Signalement et blocage deviennent d'autant plus nécessaires (S5).
- Segments et classements : désactivés (efforts non enregistrés). XP et export FIT conservés.
- IA d'ambiance : 6 au départ, chacune cède sa place à un humain qui arrive (salle jamais vide à l'arrivée).
- Météo et heure : fixées par le serveur à la création (heure de Paris), identiques pour tous.

## Serveur

**S1 — Itinéraires multiples.** `ROUTES_DIR` accepte plusieurs dossiers séparés par des virgules
(`config.ts`, `RouteStore.load`). Ajouter Longchamp dans le Dockerfile et `deploy/docker-compose.yml`.
Pour les salles publiques, un `routeId` inconnu est refusé au lieu de retomber sur le défaut.

**S2 — Salle publique.** Nouvelle classe `PublicRideRoom extends RideRoom`, définie par
`gameServer.define('public', PublicRideRoom).filterBy(['routeId'])`. Colyseus remplit la première salle
non pleine de la zone, puis en ouvre une autre (`joinOrCreate`), et la ferme quand elle est vide.
- Pas de `setPrivate(true)` ; pas de code d'invitation requis à l'entrée (le code existe toujours pour le
  registre et les amis) ; pas de « créateur » à authentifier.
- `lock()` quand 20 coureurs sont présents, `unlock()` au départ de l'un d'eux (les compagnons ne comptent
  pas dans la limite : aujourd'hui `maxClients = 2 × 20`).
- Mode `free`, `allowGuests: false`, `stickyGroup: false`, aspiration réaliste.

**S3b — Demi-tour.** Message `uturn`; la simulation donne un sens à chaque coureur (`dir`), calcule sa pente
(et son revêtement) sur l'itinéraire inversé, et sépare l'aspiration par sens. Le client devra dessiner les
coureurs `dir = −1` sur l'itinéraire inversé (cap retourné) et recaler sa prédiction au moment du demi-tour.

**S3 — Sans hôte.** Pas de `setHost`, pas de migration d'hôte, `start` / `opts` / `kick` / `regroup`
ignorés pour une salle publique. Le `welcome` indique `public: true` pour que le client masque les
commandes d'hôte.

**S4 — Choix de la salle (priorité aux amis).** `POST /api/public/pick {routeId}` :
si un ami roule dans une salle publique de cette zone et qu'elle n'est pas pleine → renvoie son `roomId` ;
sinon une salle non pleine ; sinon « créer ». `GET /api/public/zones` → nombre de coureurs par zone
(depuis le registre), interrogé comme la présence des amis.

**S5 — Modération minimale.** chat conservé (anti-flood existant) ; pseudos déjà filtrés
(`sanitizeName`) ; table `reports` (migration SQL) + `POST /api/reports {userId, roomId, reason}` ;
limitation de débit. Blocage d'un joueur : masquage côté client en v1 (liste locale).

**S6 — Données.** Pas d'enregistrement de segments dans ces salles ; FC diffusée seulement avec
`consentHr` (déjà le cas).

## Client

**C1 — Catalogue.** Drapeau `"public": true` sur Longchamp dans `public/worlds/index.json`.

**C2 — Entrée « Retrouver des coureurs ».** Dans le menu, une carte par zone publique avec le nombre de
coureurs en ligne et les amis présents. Bouton « Rouler en ligne » → `launch(..., { publicRoom: true })`.

**C3 — Démarrage.** `startRide` : si `publicRoom`, appelle `/api/public/pick`, puis
`Multiplayer.connect` en `joinById`/`joinOrCreate('public', { routeId })`, sans réglages d'IA, de départ
ni de météo locale (météo reçue du `welcome`). Écran de salle sans commandes d'hôte.

**C4 — Rejoindre un ami, y compris dans une autre zone.** Étendre `joinSettings` : si l'itinéraire de
l'ami n'est pas dans le monde chargé, retrouver sa zone dans le catalogue, la charger (avec demande de
confirmation et taille si le pack n'est pas installé) puis lancer. S'appuyer sur le mécanisme déjà présent
(`routesAfterWorld`, « montée choisie dans une autre zone »). Message clair si la salle est pleine (409).

**C5b — Demi-tour.** Touche / bouton « Demi-tour » ; rendu des coureurs `dir = −1` sur l'itinéraire inversé ;
recalage immédiat de la prédiction locale (la position change de repère).

**C5 — En roulant.** Pastille « N coureurs en ligne », annonces d'arrivée et de départ, nom au-dessus
des coureurs proches, bouton « Aller vers un ami » (le rejoint dans la salle) et bouton « Signaler ».

## Tests

- Serveur (vitest, `apps/server/test/public.test.ts`) : 21e joueur envoyé dans une 2ᵉ salle ; priorité à la salle de
  l'ami ; routeId inconnu refusé ; chat reçu par un inconnu ; demi-tour ; aucune migration d'hôte ; départ d'un joueur → déverrouillage ;
  segments non enregistrés ; test de charge 20 clients sur la salle publique.
- Client : tests de `joinSettings` (ami dans une autre zone, salle pleine).
- Manuel : deux navigateurs avec `DEV_LOGIN`, vérifier visibilité mutuelle, « rejoindre un ami »,
  reconnexion après coupure.

## Déploiement et charge

Un seul processus suffit pour la v1 (tick moyen 1,8 ms pour 20 coureurs ; ≈ 72 Ko/s par salle).
Limite connue : présence, registre et invitations sont en mémoire ; un redémarrage éjecte tout le monde
(ils se reconnectent à une nouvelle salle). Pour plusieurs serveurs : stockage partagé (Redis) — hors v1.

## Ordre de réalisation

1. S1 + S2 + S3 + S3b + tests serveur (une salle publique fonctionnelle, testée sans interface) — **fait**.
2. S4 + C1–C3 (entrée au menu, deux joueurs se voient).
3. C4 (ami dans une autre zone) + C5.
4. S5 (signalement) avant toute ouverture au public.

## Hors v1

Plusieurs zones publiques, mode ouvert partagé (carrefours), modération du chat et de la voix, classements en monde
libre, plusieurs serveurs, option « ne pas être rejoint par mes amis ».
