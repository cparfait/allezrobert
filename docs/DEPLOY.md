# Déploiement — Allez Robert ! sur un VPS OVH

Guide pas à pas pour mettre en ligne le serveur, le jeu web, l'appli compagnon et la voix sur
`allezrobert.cparfait.ovh`. Tout se fait par toi, sur ton VPS : le dépôt ne contient aucun
secret, et rien n'a accès au VPS depuis l'extérieur.

> **Nginx Proxy Manager déjà en place sur le VPS ?** Suivre plutôt [DEPLOY_NPM.md](DEPLOY_NPM.md)
> (NPM fait le HTTPS, Caddy reste en interne). Application Windows : [BUILD_EXE.md](BUILD_EXE.md).

## 1. Ce qui tourne sur le VPS

```
Internet ──► 80/443 tcp, 443 udp ──► caddy (HTTPS auto, Let's Encrypt)
                                       ├── /            site de présentation (deploy/site)
                                       ├── /telechargement/  installateurs Windows (data/downloads)
                                       ├── /jouer       jeu web (statique)
                                       ├── /companion/  appli compagnon (PWA, statique)
                                       ├── /api/*       ──► server:2567 (API HTTP)
                                       └── /colyseus/*  ──► server:2567 (salles temps réel, WebSocket)
             livekit.allezrobert… ───► caddy ──► livekit:7880 (signalisation voix)
Internet ──► 7881 tcp, 7882 udp ─────► livekit (médias WebRTC de la voix)

server ──► postgres (réseau Docker interne, jamais exposé)
renderer (worker vidéo HyperFrames) ──► postgres ; écrit les MP4 dans le volume « renders »
backup (pg_dump quotidien) ──► deploy/backups/
```

| Conteneur | Image | Rôle |
| --- | --- | --- |
| `caddy` | `ghcr.io/cparfait/allezrobert-web` | HTTPS, jeu et compagnon statiques, proxy vers l'API et LiveKit |
| `server` | `ghcr.io/cparfait/allezrobert-server` | Colyseus (sorties à 10 Hz), API, migrations SQL au démarrage |
| `postgres` | `postgres:17-alpine` | Comptes, profils, sorties, segments, progression |
| `livekit` | `livekit/livekit-server` | Voix des sorties (une salle LiveKit par sortie) |
| `renderer` | `ghcr.io/cparfait/allezrobert-renderer` | Vidéos résumé (Node 22 + FFmpeg + Chromium), optionnel |
| `backup` | `postgres:17-alpine` | `pg_dump` quotidien, rétention 14 jours |

Données hors images : `deploy/data/worlds/` (tuiles du monde, §12), `deploy/backups/`.

Fichiers : `deploy/docker-compose.yml`, `deploy/Caddyfile`, `deploy/livekit.yaml`,
`deploy/.env.example`, `deploy/deploy.sh`, `deploy/restore.sh`, `deploy/backup/backup-loop.sh`,
`deploy/docker/*.Dockerfile`.

## 2. Choisir le VPS

Mesures (test de charge `apps/server/test/load.test.ts`, 20 clients simulés dans une sortie) :
tick serveur ≈ 1,8 ms en moyenne, 5 ms au p99, pour un budget de 100 ms ; ~0,4 Ko par instantané,
soit ~3,6 Ko/s par coureur en descendant ; simulation seule ≈ 0,04 ms par tick pour 20 coureurs.
La voix (Opus ~32 kbit/s par participant) : à 10 personnes, ~3 Mbit/s sortants pour le VPS.

| Usage | VPS conseillé | Remarques |
| --- | --- | --- |
| 3–4 coureurs le week-end, sans vidéo résumé | 2 vCPU, 4 Go RAM, 40 Go SSD | `COMPOSE_PROFILES=` (renderer désactivé) |
| 3–10 coureurs + vidéos résumé | 4 vCPU, 8 Go RAM, 80 Go SSD | rendu d'une vidéo : 1–3 min, ~2 Go RAM pendant le rendu |
| Plusieurs sorties simultanées, 20 coureurs | 6–8 vCPU, 12–16 Go | ou renderer sur une seconde machine |

L'entrée de gamme actuelle des VPS OVH couvre largement le premier cas. **Choisir un datacenter
en France** (Gravelines, Roubaix ou Strasbourg) : les fréquences cardiaques sont des données de santé.

Quand monter en gamme :
- `https://allezrobert.cparfait.ovh/api/health` affiche `tick.p99Ms` > 20 ms pendant les sorties ;
- CPU > 70 % en continu pendant une sortie (`docker stats`), ou voix qui hache ;
- mémoire saturée pendant les rendus (le renderer est limité à 2 CPU / 3 Go dans le compose) ;
- plus de 20 coureurs simultanés au total, ou plusieurs groupes en même temps.

## 3. Préparer le VPS

1. Commander le VPS (Debian 12 ou Ubuntu 24.04 LTS), avec ta clé SSH.
2. Se connecter : `ssh debian@<IP>` (ou `ubuntu@<IP>`), puis mettre à jour :
   ```bash
   sudo apt update && sudo apt full-upgrade -y && sudo reboot
   ```
3. Mises à jour de sécurité automatiques :
   ```bash
   sudo apt install -y unattended-upgrades && sudo dpkg-reconfigure -plow unattended-upgrades
   ```
4. Noter l'IPv4 et l'IPv6 du VPS (espace client OVH → VPS → « IP »).

## 4. DNS chez OVH

Espace client OVH → **Web Cloud → Noms de domaine → cparfait.ovh → Zone DNS → Ajouter une entrée** :

| Type | Sous-domaine | Cible | TTL |
| --- | --- | --- | --- |
| A | `allezrobert` | IPv4 du VPS | 3600 |
| AAAA | `allezrobert` | IPv6 du VPS | 3600 |
| A | `livekit.allezrobert` | IPv4 du VPS | 3600 |
| AAAA | `livekit.allezrobert` | IPv6 du VPS | 3600 |

(Pas d'IPv6 sur le VPS ? Ne pas créer les AAAA : un AAAA erroné casse le certificat.)
Vérifier depuis ton PC après quelques minutes :
```bash
nslookup allezrobert.cparfait.ovh
nslookup livekit.allezrobert.cparfait.ovh
```

## 5. Installer Docker

```bash
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker $USER      # puis se déconnecter / reconnecter
docker version && docker compose version
```

## 6. Pare-feu

Ports à ouvrir : 22/tcp (SSH), 80/tcp et 443/tcp (HTTPS + certificats), 443/udp (HTTP/3),
7881/tcp et 7882/udp (médias de la voix LiveKit). Rien d'autre : PostgreSQL et l'API ne sont
jamais publiés hors du réseau Docker.

```bash
sudo apt install -y ufw
sudo ufw default deny incoming && sudo ufw default allow outgoing
sudo ufw allow 22/tcp
sudo ufw allow 80/tcp && sudo ufw allow 443/tcp && sudo ufw allow 443/udp
sudo ufw allow 7881/tcp && sudo ufw allow 7882/udp
sudo ufw enable && sudo ufw status
```

À savoir : Docker publie ses ports en contournant ufw (règles iptables propres). Le compose ne
publie donc que les ports listés ci-dessus. Pour un filtrage en amont, le « Network Firewall »
OVH (espace client → IP → pare-feu) peut reprendre les mêmes règles.

LiveKit utilise un seul port UDP multiplexé (7882) au lieu de la plage classique 50000–60000 :
moins de ports à ouvrir et pas de milliers de règles Docker. Pour revenir à une plage, voir
`deploy/livekit.yaml` (`port_range_start` / `port_range_end`) et publier la plage dans le compose.

## 7. Récupérer les fichiers de déploiement

```bash
sudo mkdir -p /opt/allezrobert && sudo chown $USER /opt/allezrobert
git clone https://github.com/cparfait/allezrobert.git /opt/allezrobert
cd /opt/allezrobert/deploy
cp .env.example .env && chmod 600 .env
```

## 8. Générer les secrets (`deploy/.env`)

```bash
echo "POSTGRES_PASSWORD=$(openssl rand -hex 24)"
echo "SESSION_SECRET=$(openssl rand -base64 48 | tr -d '\n')"
echo "DATA_ENCRYPTION_KEY=$(openssl rand -base64 32)"
echo "LIVEKIT_API_SECRET=$(openssl rand -base64 32 | tr -d '/+=' )"
```
Reporter chaque valeur dans `.env` (`nano .env`), ainsi que `DOMAIN`, `LIVEKIT_DOMAIN` et
`ACME_EMAIL` (ton e-mail, pour Let's Encrypt).

**`DATA_ENCRYPTION_KEY` est vitale** : FC, fichiers FIT et jetons Strava / intervals.icu sont
chiffrés avec elle (AES-256-GCM). Sans elle, les sauvegardes sont inexploitables. La copier
dans ton gestionnaire de mots de passe, hors du VPS. Ne jamais la changer sur une base existante.

## 9. Connexion : Google, Discord, e-mail

Adresses de retour (à saisir exactement) :

| Fournisseur | URL de rappel |
| --- | --- |
| Google | `https://allezrobert.cparfait.ovh/api/auth/google/callback` |
| Discord | `https://allezrobert.cparfait.ovh/api/auth/discord/callback` |
| Strava | domaine de rappel : `allezrobert.cparfait.ovh` (URL : `/api/integrations/strava/callback`) |

**Google** — https://console.cloud.google.com/ → nouveau projet « Allez Robert » →
« API et services » → « Écran de consentement OAuth » (externe, nom de l'appli, ton e-mail,
champs d'application `openid`, `email`, `profile` ; tant que l'appli est « en test », ajouter
tes amis comme utilisateurs test) → « Identifiants » → « Créer un ID client OAuth » (application
Web), origine `https://allezrobert.cparfait.ovh`, URI de redirection ci-dessus. Copier l'ID et
le secret dans `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`.

**Discord** — https://discord.com/developers/applications → « New Application » → « OAuth2 » →
ajouter le redirect ci-dessus → copier « Client ID » et « Client Secret » (Reset Secret) dans
`DISCORD_CLIENT_ID` / `DISCORD_CLIENT_SECRET`. Champs demandés par le serveur : `identify email`.

**E-mail (lien magique)** — renseigner `SMTP_URL`. Avec une adresse e-mail OVH :
`SMTP_URL=smtps://no-reply%40cparfait.ovh:MOTDEPASSE@ssl0.ovh.net:465` (le `@` de l'identifiant
s'écrit `%40`) et `SMTP_FROM=Allez Robert ! <no-reply@cparfait.ovh>`. Vérifier que la zone DNS
contient bien les enregistrements SPF / DKIM d'OVH (sinon les liens partent en indésirables).
Sans SMTP, la connexion par e-mail est simplement désactivée en production.

Seule une empreinte HMAC de l'e-mail est stockée (rapprochement des comptes) : jamais l'adresse.

### 9 bis. Repli Discord pour la voix

La voix des sorties passe par LiveKit (§13). Si LiveKit n'est pas configuré, ne répond pas
(ports UDP fermés, conteneur arrêté) ou si le navigateur refuse WebRTC, le jeu propose de
rejoindre un **salon vocal Discord** : aucun bot, aucune permission, juste un lien d'invitation.

1. Dans Discord : créer (ou choisir) un serveur, puis un salon **vocal** « Allez Robert ! ».
2. Clic droit sur le salon → « Inviter des personnes » → « Modifier le lien d'invitation » :
   **Expire après : Jamais**, nombre d'utilisations : illimité → copier le lien
   (`https://discord.gg/XXXXXXX`).
3. Dans `deploy/.env` : `DISCORD_VOICE_INVITE=https://discord.gg/XXXXXXX`, puis
   `./deploy.sh` (ou `docker compose up -d server`).
4. Vérifier : `curl -s https://allezrobert.cparfait.ovh/api/voice` →
   `{"livekit":true,"discordInvite":"https://discord.gg/XXXXXXX"}`.

Dans le jeu, le lien apparaît dans la pastille de la voix (en bas à gauche) dès que LiveKit est
indisponible, ainsi que dans le salon d'attente des courses et le panneau de la sortie de groupe.
Le serveur n'accepte que des liens `https://discord.gg/…` ou `https://discord.com/invite/…`
(démarrage refusé sinon). Le lien est public pour tout joueur : ne pas y mettre un serveur privé
sans modération. Laisser vide pour désactiver le repli.

## 10. Strava et intervals.icu

**Strava** — https://www.strava.com/settings/api → créer l'application (site
`https://allezrobert.cparfait.ovh`, « Authorization Callback Domain » `allezrobert.cparfait.ovh`).
Copier « Client ID » et « Client Secret » dans `STRAVA_CLIENT_ID` / `STRAVA_CLIENT_SECRET`.
Une nouvelle application Strava est limitée à ton propre compte : demander l'augmentation de la
capacité d'athlètes à Strava pour que les amis puissent la lier. Chaque coureur lie son compte
dans le jeu (droit `activity:write`) ; l'option « ne pas envoyer à Strava » du profil évite les
doublons quand le Garmin Edge enregistre déjà la sortie.

**intervals.icu** — rien à créer côté serveur : chaque coureur colle sa clé API personnelle
(intervals.icu → Settings → Developer Settings) dans le jeu ; elle est stockée chiffrée.

## 11. Images Docker

La CI GitHub publie trois images sur GHCR à chaque push sur `main` :
`ghcr.io/cparfait/allezrobert-server`, `-web`, `-renderer` (étiquettes `latest` et `sha-xxxxxxx`).
Les paquets GHCR sont privés à leur création : soit les passer en public (GitHub → profil →
Packages → paquet → Package settings → Change visibility), soit se connecter sur le VPS avec un
jeton personnel (droit `read:packages` seulement) :
```bash
echo <JETON> | docker login ghcr.io -u cparfait --password-stdin
```
Sans CI, `./deploy.sh build` construit les images directement sur le VPS (plus long).

## 12. Tuiles du monde

> **Packs de cartes** : chaque zone (`chevreuse`, `alpe-dhuez`, `mont-ventoux`, `neuville`…) se
> déploie comme Chevreuse ci-dessous, en copiant tout son dossier `tiles/` (il contient
> `pack.json`, la liste du pack). Le catalogue `worlds/index.json` est livré dans l'image web ; le
> régénérer avec `pnpm --filter @allezrobert/terrain packs` avant le build si des tuiles ont changé.
> L'application Windows télécharge les tuiles sur ce serveur : le Caddyfile autorise CORS sur
> `/worlds/*/tiles/*`.


Le jeu télécharge `/worlds/chevreuse/world.json` et `/worlds/chevreuse/routes/*.json` (inclus
dans l'image web) et les tuiles `/worlds/chevreuse/tiles/*` (≈150 Mo : altitudes `.u16`,
entités `.json`, orthophotos `.jpg`), qui ne sont **pas** dans l'image : Caddy les sert depuis
`deploy/data/worlds/` (monté en lecture seule, compressées zstd/gzip, cache 7 jours).

1. Sur ton PC (données IGN / OSM, voir tools/terrain) :
   ```bash
   pnpm --filter @allezrobert/terrain build:world
   ```
2. Copier les tuiles sur le VPS (depuis la racine du dépôt) :
   ```bash
   ssh debian@<IP> mkdir -p /opt/allezrobert/deploy/data/worlds/chevreuse
   rsync -av --delete apps/client/public/worlds/chevreuse/tiles/      debian@<IP>:/opt/allezrobert/deploy/data/worlds/chevreuse/tiles/
   ```
   (Sous Windows sans rsync : `scp -r apps/client/public/worlds/chevreuse/tiles debian@<IP>:/opt/allezrobert/deploy/data/worlds/chevreuse/`.)
3. Rien à redémarrer : les fichiers sont servis immédiatement. Après une régénération, les
   navigateurs reprennent les nouvelles tuiles sous 7 jours (ou tout de suite après un
   rechargement forcé) ; changer de nom de monde pour une mise à jour immédiate.

Les itinéraires (`routes/*.json`) sont aussi lus par le serveur (`ROUTES_DIR`) : l'image
serveur embarque ceux du même commit que l'image web, donc identiques à ceux du jeu. Pour des
itinéraires régénérés sans reconstruire les images, les copier aussi dans
`deploy/data/worlds/chevreuse/routes/` et mettre `ROUTES_DIR=/data/worlds/chevreuse/routes`
dans `.env` (le jeu, lui, garde ceux de son bundle : reconstruire l'image web pour aligner).

**Monde ouvert (Longchamp)** : Longchamp est le monde chargé par défaut et celui des salles
publiques. Ses tuiles se déploient comme celles de Chevreuse (`worlds/longchamp/tiles/`, ≈ 65 Mo) et le
serveur doit lire ses itinéraires : `ROUTES_DIR` accepte plusieurs dossiers séparés par des virgules
(`…/worlds/longchamp/routes,…/worlds/chevreuse/routes`, valeur par défaut de l'image). Les zones ouvertes
au public sont listées par `PUBLIC_ROUTES` (défaut : `anneau-de-longchamp`).

## 12 bis. Boucles vidéo du menu

Le fond du menu joue une boucle de 60 s par saison et par style graphique (`/menu/loop-<saison>.mp4`
en réaliste, `/menu/loop-lowpoly-<saison>.mp4` en jeu vidéo, H.264, ≈15 à 30 Mo ; `.webm` VP9 en repli). Trop lourdes pour le dépôt public, elles ne sont ni dans git ni
dans l'image web : Caddy les sert depuis `deploy/data/menu/` (volume `MENU_DIR`, lecture seule).
Les images fixes `still-<saison>.jpg` et `still-lowpoly-<saison>.jpg` restent dans l'image : sans vidéo (fichier absent, 404),
le menu affiche simplement l'image fixe de la saison.

1. Sur ton PC, générer les vidéos (≈3 h pour les 2 styles × 4 saisons, voir `tools/menu-loop/README.md`) :
   ```bash
   pnpm --filter @allezrobert/menu-loop capture
   ```
2. Les copier sur le VPS (depuis la racine du dépôt) :
   ```bash
   ssh debian@<IP> mkdir -p /opt/allezrobert/deploy/data/menu
   rsync -av apps/client/public/menu/loop-*.mp4 apps/client/public/menu/loop-*.webm debian@<IP>:/opt/allezrobert/deploy/data/menu/
   ```
   (Sous Windows sans rsync : `scp apps/client/public/menu/loop-* debian@<IP>:/opt/allezrobert/deploy/data/menu/`.)
   Le volume est monté sur `/srv/menu` : `/menu/loop-autumn.mp4` → `deploy/data/menu/loop-autumn.mp4`.
3. Rien à redémarrer. Vérifier `https://allezrobert.cparfait.ovh/menu/loop-autumn.mp4` → 200
   (`video/mp4`). Après une régénération, augmenter `MENU_MEDIA_VERSION` dans
   `apps/client/src/main.ts` (les navigateurs gardent les vidéos 7 jours) et redéployer l'image web.

Application Windows : `pnpm --filter @allezrobert/desktop build` embarque ce qui se trouve dans
`apps/client/public/menu/` au moment du build ; générer (ou copier) les vidéos avant.

## 12 ter. Vidéo résumé MP4 (rendu sur le serveur)

Le bouton « Créer la vidéo (MP4) » de l'écran de fin met un rendu en file (table `render_jobs`) ; un *worker* le traite, l'écran de fin suit l'état (en file → en cours → terminé) puis affiche la vidéo et le lien de téléchargement.

| Mode | Prérequis | Résultat |
| --- | --- | --- |
| **HyperFrames** (conteneur `renderer`) | Node 22, FFmpeg, Chromium (image `-renderer`) | 1920×1080, 28 s, 1 à 3 min |
| **Repli FFmpeg** (automatique si HyperFrames est absent ou échoue) | FFmpeg seul (`apt install ffmpeg fonts-dejavu-core`) | 1280×720, 12 s, ~15 s |
| Sans FFmpeg | — | « Rendu MP4 indisponible » : le jeu joue le résumé animé dans le navigateur |

- `RENDER_INLINE=true` : le serveur de jeu traite lui-même la file (petit VPS, pas de conteneur `renderer`). Sinon `COMPOSE_PROFILES=renderer`.
- Variables : `RENDERS_DIR` (volume `renders`), `RENDER_QUALITY` (`draft`, `looks`, `delivery`), `RENDER_TIMEOUT_S` (900), `RENDER_POLL_S` (5), `FFMPEG_PATH` si FFmpeg n'est pas dans le `PATH`.
- Trois rendus au plus en attente par compte ; la vidéo se régénère, les MP4 ne sont pas sauvegardés.
- **Photos du sommet** : le client réduit les photos prises sur les KOM (3 au plus, JPEG ≤ 200 Ko) et les joint à la demande (`photos`, corps JSON limité à 1 Mo). HyperFrames les place dans une scène « Au sommet » (à la place du classement en solo, sinon des meilleurs moments) ; le repli FFmpeg ajoute une diapositive de 3 s par photo.
- Vérifier : `GET /api/renders/capabilities` renvoie `{"available":true,"engine":"hyperframes"|"ffmpeg"}` ; sinon `docker compose logs renderer` (ou les journaux du serveur en mode inline).

## 13. Premier déploiement

```bash
cd /opt/allezrobert/deploy
./deploy.sh            # ou ./deploy.sh build
```
Le script vérifie `.env`, sauvegarde la base si elle existe, télécharge (ou construit) les images,
démarre PostgreSQL, applique les migrations SQL, démarre tout et contrôle `/api/health`.

Vérifications :
- `https://allezrobert.cparfait.ovh/api/health` → `{"ok":true,"db":"ok",…}` ;
- `https://allezrobert.cparfait.ovh/` → le jeu ; `/companion/` → l'appli compagnon ;
- `https://allezrobert.cparfait.ovh/worlds/chevreuse/tiles/<une tuile>.json` → 200 (tuiles copiées) ;
- `https://livekit.allezrobert.cparfait.ovh/` → « OK » ; test complet de la voix avec
  https://livekit.io/connection-test (URL `wss://livekit.allezrobert.cparfait.ovh`, jeton obtenu
  dans le jeu) ;
- `docker compose ps` : tous les services `running` / `healthy`.

## 14. Mises à jour

```bash
cd /opt/allezrobert && git pull && cd deploy && ./deploy.sh
```
Retour arrière : dans `.env`, épingler l'étiquette précédente
(`SERVER_IMAGE=ghcr.io/cparfait/allezrobert-server:sha-abc1234`, idem `WEB_IMAGE`) puis
`./deploy.sh`. Les migrations sont additives : une image plus ancienne fonctionne sur le schéma
plus récent tant qu'aucune migration destructive n'est annoncée dans les notes de version.

## 15. Sauvegardes

- Le conteneur `backup` fait un `pg_dump` chaque jour à `BACKUP_HOUR` (UTC) dans
  `deploy/backups/` et garde `BACKUP_KEEP_DAYS` jours.
- Sauvegarde immédiate :
  `docker compose run --rm --entrypoint /bin/sh backup /backup/backup-loop.sh now`
- Copier les sauvegardes hors du VPS (une sauvegarde sur la même machine ne protège pas d'une
  panne) : `rsync -a deploy/backups/ moi@maison:/sauvegardes/allezrobert/`, ou rclone vers
  OVH Object Storage (Public Cloud) avec une tâche cron quotidienne.
- Les vidéos rendues (volume `renders`) ne sont pas sauvegardées : elles se régénèrent.

## 16. Restauration

```bash
cd /opt/allezrobert/deploy
ls -lt backups/
./restore.sh backups/allezrobert-20261021-030000.dump
```
Le script fait d'abord une sauvegarde de sécurité de l'état actuel, arrête le serveur et le
worker, recrée la base, restaure le dump et relance tout. `DATA_ENCRYPTION_KEY` doit être celle
utilisée au moment de la sauvegarde.

Nouveau VPS : refaire les étapes 3 à 8 avec la **même** `DATA_ENCRYPTION_KEY`, lancer
`./deploy.sh`, puis `./restore.sh <dump>`.

## 17. Exploitation au quotidien

| Besoin | Commande |
| --- | --- |
| Journaux du serveur | `docker compose logs -f server` |
| État / santé | `docker compose ps` ; `curl -s https://allezrobert.cparfait.ovh/api/health` |
| Ressources | `docker stats` |
| Redémarrer un service | `docker compose restart server` |
| Arrêter / relancer tout | `docker compose down` / `docker compose up -d` |
| Console SQL | `docker compose exec postgres psql -U allezrobert` |
| Désactiver le rendu vidéo | `COMPOSE_PROFILES=` dans `.env`, puis `docker compose up -d --remove-orphans` |

Les sorties en cours vivent en mémoire du serveur : un redémarrage les interrompt (l'hôte en
recrée une, avec un nouveau code ; comptes, sorties enregistrées et records ne sont pas touchés).
Mettre à jour en dehors des créneaux de sortie.

## 18. Données personnelles

- Hébergement en France (datacenter OVH français), pas de service tiers d'analyse.
- Stockage minimal : nom affiché, empreinte d'e-mail, profil physique, sorties. FC et FIT chiffrés.
- La FC n'est conservée et diffusée aux autres coureurs qu'avec le consentement du profil ; le
  retrait du consentement efface les résumés FC et ré-encode les FIT sans FC.
- Chaque coureur peut exporter toutes ses données (`GET /api/me/export`) et supprimer son compte
  (`DELETE /api/me`) : suppression immédiate et complète (les sauvegardes expirent sous 14 jours).

## 19. Dépannage

| Symptôme | Piste |
| --- | --- |
| Certificat HTTPS absent | DNS pas encore propagé, port 80 fermé, AAAA erroné : `docker compose logs caddy` |
| « Connexion requise » en boucle | horloge du VPS (`timedatectl`), `PUBLIC_URL`/`DOMAIN` incohérents, cookies bloqués |
| Google : `redirect_uri_mismatch` | URL de rappel exacte (https, sans / final) dans la console Google |
| Voix muette | 7881/tcp et 7882/udp ouverts (ufw + pare-feu OVH) ; `docker compose logs livekit` ; en attendant, repli Discord (§9 bis) |
| Rendus en échec | `docker compose logs renderer` ; mémoire (`docker stats`) ; `shm_size` |
| Base injoignable | `docker compose logs postgres` ; espace disque (`df -h`) |

## Annexe — Déploiement depuis le PC (constructeur de zone ou outil autonome)

Réservé au propriétaire du serveur : ni le jeu, ni l'installateur, ni les images Docker n'en contiennent rien. Deux
façons de s'en servir, avec le même noyau (`deploy/deploy-core.mjs`) qui pilote le serveur Linux par SSH :

- **Dans le constructeur de zone** (`pnpm zone-builder`, panneau « Serveur (VPS) » à droite) : envoyer la zone en
  cours, les nouvelles et modifiées, ou toutes ; option « envoyer la zone après la construction » ; vidéos du menu ;
  mise à jour de l'application. Le panneau n'apparaît que si `deploy/.deploy-gui.json` existe (le constructeur de
  zone sert aussi aux joueurs en mode expert : ils ne le voient pas). Première activation :
  `ZONE_BUILDER_DEPLOY=1 pnpm zone-builder`, puis « Enregistrer la connexion ».
- **Outil autonome** : `deploy/Deploy.bat` (double-clic) ou `pnpm deploy:gui`, page locale `127.0.0.1` à jeton.

Fonctions : `git pull` sur le VPS puis `deploy.sh` (sauvegarde, images, migrations, démarrage, contrôle) avec choix de
la branche, images construites sur le VPS ou publiées par la CI, `git push` préalable ; état de chaque zone sur le
serveur (absente = nouvelle, à jour, différente) ; envoi en tar compressé + ssh avec échange atomique ; vidéos du menu.

Connexion : hôte, port, clé SSH, dossier du dépôt, adresse publique, enregistrés dans `deploy/.deploy-gui.json`
(ignoré par git). SSH est non interactif : la clé publique doit être dans `~/.ssh/authorized_keys` du serveur. Si le
serveur demande un mot de passe, le bouton **« Installer ma clé SSH sur le serveur »** ouvre une fenêtre noire où SSH
le demande une seule fois ; ensuite plus rien à taper (le mot de passe n'est jamais saisi ni journalisé par l'outil).

Essai à blanc (affiche les commandes sans rien exécuter) : `DEPLOY_GUI_DRY=1`. Ligne de commande :
`node deploy/deploy-core.mjs run <demande.json>`. Ordre d'une mise à jour de zone : envoyer les tuiles, commiter
`world.json` / `index.json` de la zone, puis mettre à jour l'application.
