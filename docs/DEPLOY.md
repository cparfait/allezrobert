# Déploiement — Allez Robert ! sur un VPS OVH

Guide pas à pas pour mettre en ligne le serveur, le jeu web, l'appli compagnon et la voix sur
`allezrobert.cparfait.ovh`. Tout se fait par toi, sur ton VPS : le dépôt ne contient aucun
secret, et rien n'a accès au VPS depuis l'extérieur.

## 1. Ce qui tourne sur le VPS

```
Internet ──► 80/443 tcp, 443 udp ──► caddy (HTTPS auto, Let's Encrypt)
                                       ├── /            jeu web (statique)
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
| Voix muette | 7881/tcp et 7882/udp ouverts (ufw + pare-feu OVH) ; `docker compose logs livekit` |
| Rendus en échec | `docker compose logs renderer` ; mémoire (`docker stats`) ; `shm_size` |
| Base injoignable | `docker compose logs postgres` ; espace disque (`df -h`) |
