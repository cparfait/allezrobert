# @allezrobert/server

Serveur multijoueur d'Allez Robert ! : salles Colyseus autoritaires à 10 Hz, API HTTP
(comptes, profils, sorties FIT, segments, progression, intégrations, voix, rendu vidéo),
PostgreSQL. Déploiement : [docs/DEPLOY.md](../../docs/DEPLOY.md).

## Démarrer en développement

```bash
cp apps/server/.env.example apps/server/.env      # DATABASE_URL=memory : pg-mem, aucune base à installer
pnpm --filter @allezrobert/server dev             # http://localhost:2567 (API /api, salles « ride »)
pnpm --filter @allezrobert/companion dev          # appli compagnon http://localhost:5174
npx vitest run apps/server                        # tests (dont charge 20 clients)
npx tsc -p apps/server/tsconfig.json              # types
```
`DEV_LOGIN=true` ouvre `POST /api/auth/dev {name}` (connexion sans OAuth, refusée en production).
Itinéraires : `ROUTES_DIR` (JSON `RouteData` de tools/terrain ; plusieurs dossiers séparés par des virgules) ; sinon boucle procédurale de 10 km.
Tests d'API sur un vrai PostgreSQL : `TEST_DATABASE_URL=postgres://… npx vitest run apps/server/test/api.test.ts`.

### Voix en local (LiveKit) et voix off (Cartesia)

```bash
docker run -d --name allezrobert-livekit -p 7880:7880 -p 7881:7881 -p 7882:7882/udp livekit/livekit-server:latest --dev --bind 0.0.0.0 --node-ip 127.0.0.1
```

Puis dans `apps/server/.env` : `LIVEKIT_URL=ws://localhost:7880`, `LIVEKIT_API_KEY=devkey`, `LIVEKIT_API_SECRET=secret`
(clés de développement publiques de LiveKit). `--node-ip 127.0.0.1` est indispensable sous Docker Windows,
sinon WebRTC annonce l'IP interne du conteneur (« could not establish pc connection »).

Repli de la voix : `DISCORD_VOICE_INVITE=https://discord.gg/…` (salon vocal Discord proposé dans le jeu quand
LiveKit est absent ou échoue ; `GET /api/voice` → `{ livekit, discordInvite }`).

Voix off du tutoriel : `CARTESIA_API_KEY=…` dans `apps/server/.env` (jamais versionné). `POST /api/tts {text, lang}`
renvoie un MP3 mis en cache dans `TTS_CACHE_DIR` ; voix réglables par `CARTESIA_VOICE_FR` / `CARTESIA_VOICE_EN`.

## Organisation

| Fichier | Rôle |
| --- | --- |
| `src/server.ts`, `src/main.ts` | Démarrage : config → base + migrations → itinéraires → Colyseus + Express |
| `src/config.ts` | Variables d'environnement validées par zod (`.env.example`) |
| `src/ride/simulation.ts` | Simulation pure de la sortie (physique, aspiration, groupe soudé, IA, invités, segments, tours, course) |
| `src/ride/RideRoom.ts` | Salle Colyseus « ride » : rôles, messages, reconnexion, hôte |
| `src/ride/registry.ts` | Codes d'invitation, participants, sortie en cours d'un compte |
| `src/ride/routes.ts` | Chargement des itinéraires, résumé pour la carte, boucle de secours |
| `src/http/*` | API Express (montée par Colyseus), cookies, CORS, contrôle d'origine |
| `src/auth/*` | Jetons jose, OAuth (PKCE), lien magique (nodemailer) |
| `src/db/*`, `migrations/*.sql` | pg, migrations SQL au démarrage, dépôts |
| `src/crypto.ts` | AES-256-GCM des données sensibles, empreinte HMAC des e-mails |
| `src/integrations/*` | Strava, intervals.icu, jetons LiveKit |
| `src/activities/fit-import.ts` | Lecture FIT (SDK Garmin), résumé, retrait de la FC |
| `src/progression/xp.ts` | Aides serveur ; formules et catalogue dans `@allezrobert/shared` |
| `src/worker/render-worker.ts` | Worker vidéo (conteneur renderer) → scripts de packages/sequences |

## Salle « ride »

### Choix du protocole : messages simples plutôt que l'état Schema

Les instantanés partent en **messages Colyseus simples** (msgpack), pas en état `@colyseus/schema` :
- les données statiques d'un coureur (nom, avatar, badges IA / invité / hôte) partent dans la
  liste des coureurs (`roster`) uniquement quand elle change ;
- l'instantané 10 Hz (`s`) ne contient que les champs dynamiques, quantifiés en entiers dans un
  tableau plat (`CompactSnapshotMsg`, 10 entiers par coureur) : **366 octets pour 20 coureurs**
  contre 5,3 Ko pour des `RiderSnapshot` complets (mesuré dans le test de charge) ;
- tout change à chaque tick (distance, vitesse, puissance…) : le delta-encodage Schema
  n'apporterait presque rien, alors que le tableau compact est trivial à décoder dans le jeu
  comme dans l'appli compagnon (`decodeSnapshot()` dans `@allezrobert/shared`).

Distances : le serveur intègre en distances **dépliées** (tour × longueur + distance, nécessaire
à l'aspiration autour de la ligne) et diffuse `distM` dans le tour + `lap`.

### Messages (`NET_MSG` dans packages/shared/src/net.ts)

| Type | Sens | Contenu |
| --- | --- | --- |
| `welcome` | S → C | `WelcomeMsg` : salle, code, rôle, `selfId`, hôte, options, phase, itinéraire résumé (polyligne), liste |
| `roster` | S → C | `RosterMsg` (arrivée, départ, hôte, connexion) |
| `s` | S → C | `CompactSnapshotMsg` à 10 Hz |
| `ev` | S → C | `RideEventMsg` : segments, tours, arrivée, compte à rebours, phase, chat, Ride On, hôte, résultats, options, erreurs |
| `t` | C → S | `TelemetryMsg` à 10 Hz (watts mesurés, cadence, FC, rapport, direction, accélérateur invité) |
| `chat` / `rideOn` | C → S | `{ text }` / `{ to }` (anti-flood côté serveur) |
| `cmp` | compagnon → S → jeu | `CompanionCommand` (vitesses, caméra, pause, ventilateur ; chat / Ride On exécutés par le serveur) |
| `cmpState` | jeu → S → compagnon | `CompanionStateMsg` (rapport, pause, caméra, ventilateur) |
| `start` / `opts` / `kick` / `host` | hôte → S | compte à rebours, options (invités, groupe soudé, aspiration, allure annoncée `paceWkg`, meneur `leaderId`), exclusion, passation |
| `regroup` | hôte ou meneur → S | `{ active? }` lance / arrête un regroupement (sortie de groupe) |
| `ping` | C ↔ S | estimation de l'aller-retour |

### Monde ouvert : salle `public`

`PublicRideRoom` (`gameServer.define('public', …).filterBy(['routeId'])`, constante `PUBLIC_ROOM`) : une
salle par zone et par tranche de 20 coureurs, créée par `joinOrCreate('public', { routeId, token })` (client :
`RideNetClient.joinPublic(routeId)`) et fermée quand elle se vide.
- Compte obligatoire (ni invité, ni anonyme) ; pas de code d'invitation (le code existe toujours pour le
  registre et « rejoindre un ami ») ; itinéraire inconnu = erreur 404, jamais de repli sur un autre parcours.
- Mode `free`, aucun hôte (`hostId` vide, `start` / `opts` / `kick` / `host` / `regroup` sans effet), météo
  et heure (Paris) fixées par le serveur, `welcome.public = true`.
- 6 IA d'ambiance (`PUBLIC_AMBIENT_AI`) : chaque humain qui arrive en remplace une.
- Pleine (20) : `lock()` ; une place libérée : `unlock()`. Le 21ᵉ coureur ouvre une autre salle.
- Chat, Ride On et voix comme dans une sortie privée (anti-flood du chat : 5 messages / 10 s).
- Pas de segments chronométrés ni de classement (`sim.segmentsEnabled = false`).
- **Demi-tour** (message `uturn`, `RideNetClient.uturn()`, 3 s entre deux) : le coureur repart du même endroit
  en sens inverse, presque à l'arrêt. Sa distance est alors mesurée sur l'itinéraire inversé (`L − d`) ; le
  sens est dans l'instantané (`dir = −1`, bit 4 de la posture). L'aspiration ne joue qu'entre coureurs de
  même sens ; les IA et le groupe ne suivent que ceux qui vont dans le sens de l'itinéraire.

### Rôles, invités, IA

- `rider` : compte requis, puissance mesurée intégrée par la physique serveur (Martin 1998,
  densité de l'air selon l'altitude, pente sous la roue, aspiration, groupe soudé optionnel).
- `guest` : sans matériel, avec ou sans compte (`ALLOW_ANONYMOUS_GUESTS`), si l'hôte l'autorise.
  Sans `guestThrottle` : **pilote automatique** accroché à la queue du groupe à la vitesse du
  groupe. Avec `guestThrottle` ∈ [0, 1] (clavier / manette, à envoyer tant que la touche est
  tenue) : puissance virtuelle = `guestThrottle × GUEST_MAX_WKG (3,5 W/kg) × masse`, la
  puissance mesurée envoyée est ignorée. Badge invité, rang 0 (non classé), aucun segment,
  aucune XP, FIT refusé par l'API.
- `companion` : appli compagnon du même compte ; ne roule pas, reçoit les instantanés (carte).
- IA (`aiRiders` à la création) : `AiRider` de packages/physics avec un `AiContext` construit
  par le serveur (pente, écart et vitesse du coureur devant, position dans le groupe, allure
  du groupe d'après les humains, segment proche, attaque détectée). Hors course, les IA
  attaquent rarement et attendent / rejoignent les humains (ou le meneur) au-delà de 40 m.
  Niveau : FTP du créateur × `aiLevel` (0,6–1,3). En course, au salon, chaque humain qui
  arrive prend la place d'une IA (taille du peloton = 1 + `aiRiders`).

### Phases, segments, résultats

- `free` / `group` : `running` dès la création. `race` : `lobby` → l'hôte envoie `start`
  (`countdownS`) → grille de départ → `running` → `finished` quand tous les humains classés sont
  arrivés (ou 10 min après le premier) → événement `results`.
- Segments KOM / sprint de l'itinéraire : `segmentStart`, puis `segmentEnd` avec temps
  interpolé au franchissement, rang dans la sortie et record personnel (`pr`). Les efforts des
  humains (hors invités et arrivées tardives en course) sont enregistrés en base.
- Sortie de groupe : allure annoncée (`paceWkg`, W/kg, tenue par les IA et affichée par le
  jeu), meneur (`leaderId`, l'hôte par défaut), regroupement à la demande (élastique doux
  sans téléportation, fini quand l'écart tête – queue reste sous 20 m pendant 3 s, 3 min au
  plus → événements `regroup`), alerte `split` quand les humains sont à plus de 150 m.
- Course : primes `prime` aux 3 premiers au sommet des KOM / sur la ligne des sprints (5 / 3 / 1
  points, par tour), `deadline` (heure limite = première arrivée + 10 min), `abandon` (un
  humain qui quitte la course est classé `dnf`), `results` avec état (`finished`, `racing`,
  `otl` hors délai, `dnf`, `dq`, `unranked`), écart au vainqueur et points. Un coureur qui
  (re)joint reçoit le classement courant et l'heure limite dans `welcome`.
- Contrôle de puissance (`src/ride/power-guard.ts`) : pic isolé d'un paquet ignoré, plafond
  30 W/kg, moyennes 5 s / 1 min / 5 min / 20 min plafonnées à 25 / 12 / 7,8 / 6,8 W/kg
  (au-dessus des records humains) ; la physique ne profite jamais de l'excès. Premier
  plafonnement → `flag` `warn` ; en course, plus de 10 s cumulées → `flag` `dq` (hors course).

### Reconnexion, hôte

- Coupure réseau : le coureur reste sur la route en roue libre pendant `RECONNECT_GRACE_S`
  (30 s) ; le SDK Colyseus se reconnecte seul (`allowReconnection`) et reçoit un nouvel `welcome`.
- Même compte depuis un autre onglet / appareil : la nouvelle connexion reprend le coureur.
- Hôte = créateur. S'il part (ou ne revient pas dans le délai), le rôle passe au plus ancien
  humain connecté avec compte (événement `host`).

### Performance mesurée (test `test/load.test.ts`, 20 clients WebSocket réels dans le même processus)

Tick serveur moyen 1,8 ms, p99 4,9 ms, max 4,9 ms (budget 100 ms) ; 9,3 instantanés/s reçus par
client ; 3,6 Ko/s descendants par client, 72 Ko/s pour la salle ; simulation seule 0,04 ms/tick
pour 20 coureurs (10 IA).

## Client réseau du jeu : `RideNetClient` (apps/client/src/net)

```ts
import { RideNetClient } from './net';

const net = new RideNetClient({
  endpoint: 'https://allezrobert.cparfait.ovh/colyseus', // dev : 'http://localhost:2567'
  // apiBase?: défaut endpoint sans /colyseus + '/api'
  // token?: string | () => Promise<string|undefined>  défaut : GET /api/auth/game-token (cookie)
  // interpolationDelayMs?: 150, maxExtrapolationMs?: 250, telemetryHz?: 10, autoRejoin?: true
});
```

| Membre | Description |
| --- | --- |
| `create(options?: Partial<RideRoomOptions>, join?)` → `Promise<WelcomeMsg>` | Crée une sortie (compte requis) ; `welcome.inviteCode` à partager |
| `joinByCode(code, { role?: 'rider' \| 'guest', displayName? })` → `Promise<WelcomeMsg>` | Rejoint par code (casse et tirets ignorés) |
| `joinById(roomId, inviteCode, join?)` | Variante directe |
| `joinCurrent()` | Appli compagnon : sortie en cours du compte |
| `leave()` | Départ volontaire (pas de reconnexion) |
| `startTelemetry(() => TelemetryInput \| null)` / `stopTelemetry()` | Envoi à 10 Hz de `{ watts, cadence, hr?, gear, steer, guestThrottle? }` |
| `sendTelemetry(t)` | Envoi immédiat (numéro de séquence et horodatage ajoutés) |
| `getInterpolated(riderId, now?)` → `InterpolatedRider \| null` | État interpolé (retard 150 ms) : `distM`, `lap`, `unwrappedM`, `lateralM`, `speedMs`, `watts`, `cadence`, `hr?`, `draftPct`, `pose`, `isAI`, `isGuest`, `name`, `avatar`, `extrapolated` |
| `getAllInterpolated(now?)` | Tous les coureurs |
| `getSelfSnapshot()` → `RiderSnapshot \| null` | Dernier état autoritaire de son coureur (dont `draftPct`) |
| `reconcileSelf(localUnwrappedM, dtS, now?)` → `number` | Correction (m) à ajouter à la position prédite localement |
| `serverNow()` | Heure serveur estimée (epoch ms) — comptes à rebours |
| `chat(text)`, `rideOn(riderId)` | Chat et Ride On |
| `startCountdown(s?)`, `setHostOptions({ allowGuests?, stickyGroup?, draftingStrength?, paceWkg?, leaderId? })`, `regroup(active?)`, `kick(id)`, `transferHost(id)` | Hôte (regroupement : aussi le meneur) |
| `sendCompanionCommand(cmd)` / `sendCompanionState(state)` | Compagnon → jeu / jeu → compagnon |
| `on(event, cb)` → désabonnement | `welcome`, `roster`, `snapshot`, `event`, `companion`, `companionState`, `connection` (`idle` / `connecting` / `connected` / `reconnecting` / `disconnected`), `error` |
| Propriétés | `state`, `welcome`, `roster: Map<id, RosterEntry>`, `hostId`, `isHost`, `selfId`, `role`, `roomId`, `inviteCode`, `latest`, `rtt` |

Outils purs exportés aussi : `SnapshotBuffer`, `ClockSync`, `SelfReconciler`.

### Réconciliation et interpolation : mode d'emploi pour le jeu

1. **Son coureur** : le jeu intègre sa propre physique à 60 Hz (`stepRider`) avec la puissance
   mesurée, la pente et l'aspiration **reçue du serveur** (`getSelfSnapshot().draftPct` →
   `cdaFactor = 1 − draftPct / 100`). Il affiche toujours sa prédiction (aucune latence perçue).
2. À chaque image : `distLocale += net.reconcileSelf(distLocaleDépliée, dt)`. Le client garde
   3 s d'historique de la prédiction, compare chaque instantané serveur à la prédiction au même
   instant (heure serveur → heure locale, moins ½ aller-retour) et résorbe l'écart en douceur
   (constante 0,6 s), ou recale d'un coup au-delà de 25 m (groupe soudé, reprise après coupure).
   Appliquer la même correction au décalage latéral n'est pas nécessaire (direction locale).
3. **Les autres coureurs** : `getInterpolated(id)` chaque image, rendu à `serveur − 150 ms`
   entre deux instantanés (distances dépliées : pas de saut à la ligne), extrapolation bornée à
   250 ms si des paquets manquent. Positionner l'avatar avec
   `track.positionAt(r.distM, r.lateralM)` ; animer le pédalage avec `cadence`, la posture avec `pose`.
4. Le **compte à rebours** s'affiche avec `welcome.startsAt − net.serverNow()`.
5. Le **trainer** reçoit la pente sous la roue locale ; la position serveur ne pilote jamais
   directement la résistance.

## API HTTP (préfixe `/api`, JSON, cookie de session HTTP-only `ar_session` ou `Authorization: Bearer`)

| Méthode et chemin | Description |
| --- | --- |
| `GET /health` | Santé, sorties actives, statistiques de tick |
| `GET /auth/providers` | Fournisseurs actifs `{ google, discord, email, dev }` |
| `GET /auth/{google,discord}/start?redirect=/…` → `…/callback` | OAuth (PKCE + état signé), ouvre la session |
| `POST /auth/magic {email, redirect?, locale?}` → `GET /auth/magic/verify?token=` | Lien magique 15 min, usage unique |
| `POST /auth/logout` | Révoque la session |
| `GET /auth/game-token` | Jeton de jeu (4 h) pour la connexion aux salles |
| `GET /me` | Compte, profil, niveau |
| `GET /me/profile`, `PUT /me/profile` | Profil : `displayName`, `weightKg`, `heightCm`, `ftpWatts`, `maxHr`, `restHr`, `avatar`, `equipped`, `consentHr`, `consentFace`, `skipStrava`, `locale` |
| `DELETE /me {confirm:"SUPPRIMER"}` | Suppression définitive du compte et de toutes ses données |
| `GET /me/export` | Export RGPD complet (JSON, FIT en base64) |
| `GET /me/progression`, `GET /cosmetics` | XP, niveau, cosmétiques débloqués ; catalogue |
| `POST /activities?name=&rideId=&routeId=&skipStrava=` (corps FIT) | Téléversement : résumé, XP, envoi Strava / intervals.icu en arrière-plan |
| `GET /activities`, `GET /activities/:id`, `GET /activities/:id/fit`, `DELETE /activities/:id` | Sorties |
| `POST /activities/:id/upload {target}` | Envoi manuel vers `strava` ou `intervals` |
| `GET /segments/:routeId/:segmentId/leaderboard`, `GET /me/segments` | Classements (meilleur temps par coureur), records |
| `GET /routes`, `GET /routes/:id/summary` | Itinéraires disponibles |
| `GET /integrations`, `GET /integrations/strava/start` → `/callback`, `DELETE /integrations/strava`, `PUT /integrations/intervals {apiKey, athleteId?}`, `DELETE /integrations/intervals` | Liaisons |
| `GET /rides/code/:code`, `GET /rides/current` | Code d'invitation → salle ; sortie en cours (compagnon) |
| `GET /rides/:roomId/voice-token` | Jeton LiveKit (participants seulement), salle `ride-<roomId>` |
| `GET /voice` | Voix disponible : `{ livekit, discordInvite }` (salon Discord de repli, public) |
| `POST /renders {composition, activityId?, lang?, variables?}`, `GET /renders`, `GET /renders/:id`, `GET /renders/:id/file` | File de rendu vidéo (`summary`, `intro`, `kom`, `sprint`, `podium`, `tv`) |

Sécurité : CORS limité à `CORS_ORIGINS`, contrôle de l'en-tête `Origin` sur les requêtes
modifiantes, cookies `HttpOnly; SameSite=Lax; Secure` en HTTPS, redirections relatives
uniquement, limitation des liens magiques (5 / 15 min par IP, 3 par adresse).

## Données et progression

- Pas d'e-mail en clair (empreinte HMAC), pas d'IP stockée ; FC (réglages et résumés), fichiers
  FIT et secrets tiers chiffrés AES-256-GCM (clé `DATA_ENCRYPTION_KEY`, données associées
  liant chaque bloc à sa ligne). FC stockée et diffusée seulement avec `consentHr`.
- XP d'une sortie : `20 × km + 1 × m D+ + 2 × min en mouvement`, plafonnée à 4 000 ; niveau L à
  `250 × L × (L − 1)` XP (niveau 2 = 500, niveau 10 = 22 500), maximum 50 ; cosmétiques
  débloqués par niveau (`packages/shared/src/cosmetics.json`).
