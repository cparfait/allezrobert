# Architecture — Allez Robert !

> Simulateur de vélo d'intérieur privé et multijoueur (3 à 10 coureurs, serveur testé à 20), client web Three.js (WebGPU), app desktop Tauri pour le Bluetooth natif, serveur autoritaire sur VPS OVH.

## Vue d'ensemble

```
 Capteurs                Poste du coureur                          VPS OVH (Docker Compose)
 ─────────               ──────────────────────────────            ─────────────────────────────
 KICKR CORE/CORE 2 ─┐    apps/desktop (Tauri 2, Rust)               Caddy (HTTPS, allezrobert.cparfait.ovh)
 Assioma Duo ───────┤ BLE  btleplug · mDNS DirCon · ANT+ USB          ├── apps/server  (Node + Colyseus, 10 Hz)
 TICKR ─────────────┤      │ invoke/listen (native-bridge.ts)         │     ├── auth (Google, Discord, lien magique)
 Click / Di2 / AXS ─┤      ▼                                          │     ├── salles de sortie, IA, segments
 HEADWIND ──────────┘    apps/client (TS + Vite + Three.js)  ◄─WS──►  │     └── API (profils, activités, exports)
                         │  packages/devices  (transports)            ├── PostgreSQL
 (ou Web Bluetooth  ──►  │  packages/protocols (FTMS, CPS…)           ├── LiveKit (voix WebRTC)  ◄─WebRTC─ clients
  directement dans       │  packages/physics  (Martin, drafting)      └── renderer (Node 22 + FFmpeg + HyperFrames)
  Chrome / Edge)         │  packages/fit      (export FIT)
                         │  packages/sequences (HyperFrames)    apps/companion (PWA téléphone / tablette)
                         ▼                                         ◄─WS── commandes : vitesses, caméra, pause, chat
                    Rendu 3D, HUD, son
```

Seules les positions, la télémétrie agrégée et les résultats transitent par le VPS : les capteurs restent locaux, le serveur reste léger.

## Monorepo (pnpm)

| Dossier | Rôle |
| --- | --- |
| `apps/client` | Jeu : rendu Three.js `WebGPURenderer` (repli WebGL2), HUD, menus, son, i18n FR/EN, modes de jeu |
| `apps/desktop` | Coque Tauri 2 : Bluetooth natif (choix de l'adaptateur), Direct Connect, ANT+ USB ; empaquette `apps/client` |
| `apps/companion` | PWA : carte, chat, vitesses virtuelles, caméra, pause, HEADWIND |
| `apps/server` | Colyseus (salles autoritaires), API HTTP, PostgreSQL, jetons LiveKit, file de rendu vidéo, exports Strava / intervals.icu |
| `packages/shared` | Types partagés : capteurs, profils, itinéraires, messages réseau, contrat natif |
| `packages/protocols` | Encodage / décodage purs : FTMS, CPS, HRS, CSC, ANT+ (FE-C, PWR, HR), DirCon ; adaptateurs optionnels isolés |
| `packages/devices` | Transports interchangeables + simulateur de capteurs + gestionnaire d'appareils + power match |
| `packages/physics` | Modèle de Martin et al. (1998), drafting, groupe soudé, vitesses virtuelles, coureurs IA, entraînements |
| `packages/fit` | Encodeur FIT d'activité (balance G/D, TE, PS), validé par le SDK officiel Garmin |
| `packages/sequences` | Compositions HyperFrames (intro, KOM, podium, habillage TV, vidéo résumé) |
| `tools/terrain` | IGN (RGE ALTI, LiDAR HD) + OpenStreetMap → tuiles du monde, itinéraires, segments |
| `tools/blender` | Scripts Python Blender (avatars, vélos, bâtiments) → glTF |

Les paquets sont distribués en **sources TypeScript** (`exports: ./src/index.ts`) : Vite, Vitest et tsx les consomment directement, sans étape de build intermédiaire.

## Flux de données d'une sortie

1. **Capteurs → `devices`** : chaque transport produit des événements typés (`PowerSample`, `HeartRateSample`, `TrainerSample`, `ShiftEvent`). Le `DeviceManager` choisit la source de puissance de référence (pédales > trainer), détecte les capteurs muets, reconnecte.
2. **Boucle de jeu (60 Hz, client)** : `physics.stepRider` intègre la vitesse à partir de la puissance mesurée, de la pente sous la roue, du vent et du drafting reçu du serveur. La vitesse est **toujours calculée par le jeu**, jamais lue sur le trainer.
3. **Trainer (1 à 4 Hz)** : la pente de l'itinéraire, combinée au rapport virtuel et à la difficulté (50 % par défaut), est envoyée en *FTMS Indoor Bike Simulation* (ou consigne ERG en entraînement, corrigée par le power match).
4. **Réseau (10 Hz)** : le client envoie `TelemetryMsg` ; le serveur, autoritaire, intègre la physique de groupe (drafting, groupe soudé, IA), puis diffuse `WorldSnapshotMsg`. Le client réconcilie sa propre position (correction douce) et interpole les autres coureurs (tampon de 150 à 200 ms).
5. **Enregistrement (1 Hz)** : `ActivityRecord` → fichier FIT en fin de sortie, envoi optionnel à Strava (désactivable si le Garmin Edge enregistre déjà) et à intervals.icu.

## Repère du monde

- Projection Lambert-93 (EPSG:2154), origine arrondie près de Chevreuse ; repère Three.js : `x` = est, `y` = altitude, `z` = sud.
- Monde découpé en tuiles de 1 km : grille d'altitude (2 m près des itinéraires, 8 à 10 m ailleurs) + entités vectorielles (routes, bâtiments, forêts, eau, champs). Les routes sont déjà « creusées » dans le relief par le pipeline.
- Position d'un coureur = distance curviligne sur l'itinéraire + décalage latéral : c'est compact sur le réseau et suffit au drafting.

## Physique

Modèle de Martin et al. (1998) : `P·η = (½ρ·CdA·(v+vw)² + Crr·m·g·cosθ + m·g·sinθ)·v + (m + I/r²)·v·dv/dt`. Drafting par réduction du CdA selon l'écart longitudinal et latéral, avec bonus de peloton ; option « groupe soudé » (régulateur élastique côté serveur). Détails et références dans `packages/physics`.

## Réseau et serveur

- **Colyseus** (Node.js) : salles privées sur invitation, 10 coureurs par sortie, testé à 20. Choisi plutôt que Go parce que la physique et les types sont partagés en TypeScript avec le client.
- **PostgreSQL** : comptes, profils, activités, records de segments, progression (XP, niveaux, cosmétiques).
- **Auth** : OAuth Google et Discord, lien magique par e-mail ; sessions par cookie HTTP-only.
- **LiveKit** auto-hébergé pour la voix (WebRTC, ports UDP à ouvrir) ; bouton « ouvrir Discord » en repli.
- **Rendu vidéo** : file d'attente, conteneur Node 22 + FFmpeg + HyperFrames, vidéo résumé de chaque sortie.

### Amis

- **Données** (`migrations/002_friends.sql`, `src/db/friends.ts`) : `friend_codes` (un code de 8 caractères par compte, unique, régénérable) et `friendships` (une ligne par paire rangée `user_a < user_b`, état `pending` ou `accepted`, auteur de la demande) ; tout part en cascade avec le compte. Refus et retrait suppriment la ligne.
- **API** `/api/friends` (`src/http/friends-routes.ts`, compte requis) : vue d'ensemble (code, amis avec présence, demandes reçues / envoyées, invitations), demande par code, acceptation, refus / annulation, retrait, « rejoindre » un ami, invitations, records d'un ami ; `GET /api/segments/:route/:segment/leaderboard?scope=friends`. Aucun identifiant de compte n'est exposé : on agit par l'identifiant de la relation ou de l'invitation ; présence, sortie en cours et code de sortie ne sont donnés qu'aux amis (une relation d'autrui répond 404 comme une relation inconnue). Demandes, nouveaux codes et invitations sont limités en débit.
- **Présence et invitations** (`src/friends/hub.ts`, en mémoire comme le registre des sorties) : le menu interroge `GET /api/friends` toutes les 25 s tant qu'il est affiché ; être vu depuis moins de 70 s = en ligne, avoir une sortie dans le registre = en train de rouler. Choix d'une interrogation légère plutôt qu'un canal temps réel : il n'y a pas de salle Colyseus « accueil » (une salle = une sortie) et quelques secondes de retard sur un statut d'ami ne gênent pas. Une invitation vit 30 min au plus et disparaît avec la sortie.
- **Client** : `apps/client/src/ui/friends.ts` (onglet, bandeau d'invitation, invitation depuis la pause), logique pure testée dans `friendsLogic.ts`.
- **Fantôme d'un ami (pas encore fait)** : le fantôme actuel (`apps/client/src/game/ghost.ts`) ne vit que dans le navigateur (`localStorage` `ar.ghost.<itinéraire>`, distance depuis le début du tour échantillonnée chaque seconde) et n'est jamais envoyé au serveur. Le serveur garde bien les FIT chiffrés avec leur `route_id`, mais ni la distance de départ (`?d=`), ni le meilleur tour : il faudrait décoder chaque FIT pour le retrouver. Il faudrait donc : (1) à l'enregistrement d'une sortie, extraire côté serveur le meilleur tour complet (messages de tour du FIT + `distanceM` des enregistrements, 1 Hz) et le stocker sans FC ni GPS, p. ex. table `ghost_laps (user_id, route_id, lap_time_s, dist jsonb)` avec un meilleur tour par couple compte / itinéraire et suppression en cascade ; (2) `GET /api/friends/ghost?routeId=` qui renvoie le meilleur tour parmi les amis (nom, couleur, temps, série distance-temps), réservé aux amis ; (3) un `Ghost` alimenté par ce tour plutôt que par `localStorage`, avec le nom et la couleur de l'ami ; (4) une ligne dans l'export RGPD.

## Plateformes

| Cible | Bluetooth | Remarques |
| --- | --- | --- |
| Windows, app Tauri | natif (btleplug), choix de l'adaptateur intégré ou dongle | ANT+ USB et Direct Connect disponibles |
| Chrome / Edge (Windows, Mac) | Web Bluetooth | pas d'ANT+ ni de Direct Connect |
| Téléphone / tablette | — | appli compagnon PWA |

## Sécurité et données personnelles

- Dépôt **public** : aucune donnée personnelle ni secret. `data/garmin/` est ignoré ; les itinéraires versionnés ne contiennent ni départ ni arrivée au domicile (test automatique dans `tools/terrain`).
- FC et photos de visage : consentement explicite, minimisation, chiffrement au repos, suppression du compte sur demande ; hébergement en France (OVH).
- Secrets (OAuth, LiveKit, Strava, intervals.icu, clé réseau ANT+) uniquement dans `.env` sur le VPS ou sur le poste.

## Qualité

- Protocoles testés octet par octet ; FIT validé par `@garmin/fitsdk` ; physique comparée à des valeurs de référence.
- CI GitHub Actions : vérification des types, tests, build, images Docker.
- Captures d'écran examinées et courte vidéo de démo à chaque jalon.
