# Installation sur le VPS derrière Nginx Proxy Manager

Ce guide met en ligne **allezrobert.cparfait.ovh** sur un VPS où **Nginx Proxy Manager** (NPM)
tourne déjà et occupe les ports 80/443. On y trouve :

- le **site de présentation** et les **liens de téléchargement** de l'application Windows ;
- l'**hébergement des zones** (tuiles téléchargées par l'application et par la version web) ;
- le serveur de jeu (comptes, sorties à plusieurs, voix) et la version navigateur du jeu.

Le guide général [DEPLOY.md](DEPLOY.md) suppose que Caddy est en frontal. Ici, c'est NPM qui fait
le HTTPS ; Caddy reste dans la pile, en HTTP, pour le routage interne. Les parties communes
(secrets, OAuth, Strava, sauvegardes) renvoient à DEPLOY.md.

## 1. Vue d'ensemble

```
Internet ─► 80/443 ─► Nginx Proxy Manager (HTTPS, Let's Encrypt)
                         │  allezrobert.cparfait.ovh          ─┐
                         │  livekit.allezrobert.cparfait.ovh  ─┴─► allezrobert-web:80 (Caddy, réseau « proxy »)
                         │
             Caddy ──────┼─ /                    site de présentation      deploy/site/
                         ├─ /telechargement/*    installateurs Windows     deploy/data/downloads/
                         ├─ /worlds/*/tiles/*    zones (tuiles)            deploy/data/worlds/
                         ├─ /jouer               jeu dans le navigateur
                         ├─ /companion/          appli compagnon (téléphone)
                         ├─ /api/*, /colyseus/*  ─► server:2567
                         └─ livekit.…            ─► livekit:7880
Internet ─► 7881/tcp, 7882/udp ─► livekit (médias de la voix, en direct, sans NPM)
```

Fichiers concernés : `deploy/docker-compose.yml` + `deploy/docker-compose.npm.yml` (la surcharge
NPM), `deploy/Caddyfile`, `deploy/site/` (le site), `deploy/publish-desktop.sh` (publication
de l'exe, voir [BUILD_EXE.md](BUILD_EXE.md)).

## 2. Prérequis

- VPS Debian 12 / Ubuntu 24.04, **Docker** et **Docker Compose ≥ 2.24** (`docker compose version`).
- **Nginx Proxy Manager** en conteneur Docker, joignable sur 80/443.
- Espace disque : ≈ 6 Go pour les 27 zones actuelles, + 300 Mo par version de l'installateur
  conservée, + la base et les sauvegardes. Compter 40 Go minimum.

## 3. DNS chez OVH

Espace client OVH → **Noms de domaine → cparfait.ovh → Zone DNS → Ajouter une entrée** :

| Type | Sous-domaine | Cible |
| --- | --- | --- |
| A | `allezrobert` | IPv4 du VPS |
| A | `livekit.allezrobert` | IPv4 du VPS |
| AAAA (si IPv6) | `allezrobert`, `livekit.allezrobert` | IPv6 du VPS |

Vérifier : `nslookup allezrobert.cparfait.ovh` doit renvoyer l'IP du VPS.

## 4. Pare-feu

80/443 sont déjà ouverts pour NPM. Il ne reste que la voix :

```bash
sudo ufw allow 7881/tcp
sudo ufw allow 7882/udp
```

Le port **81** (interface d'administration de NPM) ne devrait pas être ouvert sur internet :
y accéder par un tunnel SSH (`ssh -L 8181:localhost:81 allezrobert`, puis http://localhost:8181).

## 5. Réseau Docker partagé avec NPM

NPM doit pouvoir joindre le conteneur Caddy d'Allez Robert ! par son nom. On crée un réseau
commun, `proxy` :

```bash
docker network create proxy
```

Puis on y branche NPM. Le plus durable : dans le `docker-compose.yml` de NPM, ajouter

```yaml
services:
  app:                      # le service NPM (nom selon ton fichier)
    networks:
      - default
      - proxy

networks:
  proxy:
    external: true
```

puis `docker compose up -d` dans le dossier de NPM. (Dépannage rapide :
`docker network connect proxy <nom-du-conteneur-npm>` marche aussi, mais se perd quand le
conteneur NPM est recréé.)

Ton réseau s'appelle déjà autrement (par exemple `npm_default`) ? Garder ce nom et le reporter
dans `PROXY_NETWORK` à l'étape suivante.

## 6. Récupérer le dépôt et configurer `.env`

```bash
mkdir -p ~/docker
git clone https://github.com/cparfait/allezrobert.git /home/debian/docker/allezrobert
cd /home/debian/docker/allezrobert/deploy
cp .env.example .env && chmod 600 .env
nano .env
```

Dans `.env` :

```ini
DOMAIN=allezrobert.cparfait.ovh
LIVEKIT_DOMAIN=livekit.allezrobert.cparfait.ovh

# Mode Nginx Proxy Manager : Caddy ne publie plus 80/443
COMPOSE_FILE=docker-compose.yml:docker-compose.npm.yml
PROXY_NETWORK=proxy

# API ouverte au site et à l'application Windows
CORS_ORIGINS=https://allezrobert.cparfait.ovh,http://tauri.localhost

# Dossiers de données (relatifs à deploy/)
WORLDS_DIR=./data/worlds
MENU_DIR=./data/menu
DOWNLOADS_DIR=./data/downloads
```

`ACME_EMAIL` ne sert plus (NPM gère les certificats) : le laisser tel quel.

Générer ensuite les secrets (`POSTGRES_PASSWORD`, `SESSION_SECRET`, `DATA_ENCRYPTION_KEY`,
`LIVEKIT_API_SECRET`) comme indiqué dans [DEPLOY.md §8](DEPLOY.md#8-générer-les-secrets-deployenv),
et si besoin la connexion Google / Discord / e-mail et Strava ([§9 et §10](DEPLOY.md#9-connexion--google-discord-e-mail)).
**Sauvegarder `DATA_ENCRYPTION_KEY` hors du VPS.**

Images Docker : celles publiées par la CI sur GHCR ([DEPLOY.md §11](DEPLOY.md#11-images-docker)),
ou construites sur le VPS avec `./deploy.sh build`.

## 7. Héberger les zones

L'application Windows ne contient **aucune zone** : elle télécharge chaque zone depuis
`https://allezrobert.cparfait.ovh/worlds/<zone>/tiles/` (fichier `pack.json` + tuiles). La
version web lit les mêmes fichiers. Il faut donc copier sur le VPS le dossier `tiles/` de
chaque zone, dans `deploy/data/worlds/<zone>/tiles/`.

Sur ton PC, un raccourci SSH évite de répéter l'adresse et le port (`~/.ssh/config`) :

```
Host allezrobert
  HostName 51.255.34.26
  Port 22222
  User debian
  IdentityFile ~/.ssh/id_ed25519_openssh
```

(`id_ed25519` est au format PuTTY ; `id_ed25519_openssh` en est la copie lisible par `ssh`.)

Depuis ton PC (Git Bash, racine du dépôt), toutes les zones d'un coup, en un seul flux :

```bash
ssh allezrobert mkdir -p /home/debian/docker/allezrobert/deploy/data/worlds
cd apps/client/public/worlds && tar -cf - */tiles | ssh allezrobert "tar -C /home/debian/docker/allezrobert/deploy/data/worlds -xf -"
```

(≈ 5 Go à envoyer la première fois.) Pour une seule zone mise à jour, par exemple `billom` :

```bash
cd apps/client/public/worlds && tar -cf - billom/tiles | ssh allezrobert "rm -rf /home/debian/docker/allezrobert/deploy/data/worlds/billom/tiles && tar -C /home/debian/docker/allezrobert/deploy/data/worlds -xf -"
```

Rien à redémarrer : Caddy sert les fichiers immédiatement, avec l'en-tête CORS dont
l'application Windows a besoin.

Une **nouvelle zone** doit aussi figurer dans le catalogue `worlds/index.json`, qui est
embarqué dans le jeu web **et dans l'exe** : après `pnpm --filter @allezrobert/terrain packs`,
redéployer l'image web et republier l'exe ([BUILD_EXE.md](BUILD_EXE.md)), puis copier ses tuiles.

Optionnel, les boucles vidéo du menu de la version web : voir [DEPLOY.md §12 bis](DEPLOY.md#12-bis-boucles-vidéo-du-menu)
(même principe, dans `deploy/data/menu/`).

## 8. Premier démarrage

```bash
cd /home/debian/docker/allezrobert/deploy
./deploy.sh            # ou ./deploy.sh build sans images GHCR
```

`docker compose ps` doit montrer tous les services `running` / `healthy`, et `caddy` **sans
port publié**. Test interne, avant même de configurer NPM :

```bash
docker run --rm --network proxy curlimages/curl -s -H "Host: allezrobert.cparfait.ovh" http://allezrobert-web/api/health
```

→ `{"ok":true,"db":"ok",…}`.

## 9. Configurer Nginx Proxy Manager

Interface NPM → **Hosts → Proxy Hosts → Add Proxy Host**.

### Hôte 1 : le site, le jeu, les zones et l'API

Onglet **Details** :

| Champ | Valeur |
| --- | --- |
| Domain Names | `allezrobert.cparfait.ovh` |
| Scheme | `http` |
| Forward Hostname / IP | `allezrobert-web` |
| Forward Port | `80` |
| Cache Assets | désactivé (Caddy gère déjà le cache) |
| Block Common Exploits | activé |
| Websockets Support | **activé** (salles multijoueur `/colyseus`) |

Onglet **SSL** : *Request a new SSL Certificate*, **Force SSL** activé, **HTTP/2 Support**
activé, ton e-mail, accepter les conditions Let's Encrypt. Laisser **HSTS** désactivé : Caddy
envoie déjà l'en-tête.

Onglet **Advanced** (Custom Nginx Configuration) :

```nginx
# Sorties à plusieurs : connexions WebSocket longues
proxy_read_timeout 1h;
proxy_send_timeout 1h;
# Installateurs (~300 Mo) et tuiles : pas de copie temporaire sur le disque de NPM
proxy_max_temp_file_size 0;
```

### Hôte 2 : la voix (LiveKit)

| Champ | Valeur |
| --- | --- |
| Domain Names | `livekit.allezrobert.cparfait.ovh` |
| Scheme / Hostname / Port | `http` / `allezrobert-web` / `80` |
| Websockets Support | **activé** |

SSL : comme l'hôte 1 (nouveau certificat, Force SSL, HTTP/2). Advanced : les deux lignes
`proxy_read_timeout` / `proxy_send_timeout`.

Les deux hôtes visent le même Caddy : il aiguille selon le nom de domaine demandé. Les médias de
la voix ne passent pas par NPM (7881/tcp, 7882/udp, étape 4).

## 10. Publier l'application Windows

Les installateurs se déposent dans `deploy/data/downloads/` et sont servis sous
`/telechargement/`. Le script `deploy/publish-desktop.sh` construit l'exe sans zones et l'envoie
directement, voir [BUILD_EXE.md](BUILD_EXE.md) :

```bash
VPS=allezrobert bash deploy/publish-desktop.sh --upload
```

Liens publics :

| Lien | Contenu |
| --- | --- |
| https://allezrobert.cparfait.ovh/ | site de présentation |
| https://allezrobert.cparfait.ovh/telechargement/allez-robert-setup.exe | dernière version (installateur .exe) |
| https://allezrobert.cparfait.ovh/telechargement/allez-robert.msi | dernière version (MSI) |
| https://allezrobert.cparfait.ovh/telechargement/ | toutes les versions publiées |
| https://allezrobert.cparfait.ovh/telechargement/version.json | version, taille, SHA-256 (lu par le site) |
| https://allezrobert.cparfait.ovh/jouer | le jeu dans le navigateur |

## 11. Vérifications

```bash
D=https://allezrobert.cparfait.ovh
curl -s $D/api/health                                   # {"ok":true,...}
curl -sI $D/ | head -1                                  # 200 (site)
curl -sI $D/jouer | head -1                             # 200 (jeu web)
curl -s $D/telechargement/version.json                  # version publiée
curl -sI -H "Origin: http://tauri.localhost" $D/worlds/chevreuse/tiles/pack.json | grep -i -e "^HTTP" -e access-control
                                                        # 200 + Access-Control-Allow-Origin: *
curl -s https://livekit.allezrobert.cparfait.ovh/       # OK
```

Puis, dans l'application Windows installée : menu des zones → télécharger une zone → rouler.

## 12. Mises à jour

| Quoi | Comment |
| --- | --- |
| Serveur, jeu web | `cd /home/debian/docker/allezrobert && git pull && cd deploy && ./deploy.sh` |
| Site de présentation (`deploy/site/`) | `git pull` suffit (dossier monté tel quel, rien à redémarrer) |
| Une zone | recopier son dossier `tiles/` (étape 7) |
| L'application Windows | `deploy/publish-desktop.sh --upload` ([BUILD_EXE.md](BUILD_EXE.md)) |

Sauvegardes, restauration et exploitation : [DEPLOY.md §15 à §17](DEPLOY.md#15-sauvegardes).

## 13. Dépannage

| Symptôme | Piste |
| --- | --- |
| `502 Bad Gateway` (page NPM) | NPM pas branché sur le réseau `proxy`, ou nom erroné : `docker network inspect proxy` doit lister NPM et `allezrobert-caddy-1` |
| Page vide / 404 venant de Caddy | `DOMAIN` dans `.env` différent du domaine saisi dans NPM (Caddy aiguille par nom d'hôte) |
| `Bind for 0.0.0.0:80 failed` au démarrage | la surcharge n'est pas active : ligne `COMPOSE_FILE=…npm.yml` dans `.env` |
| `ports: !reset` refusé | Docker Compose trop ancien (< 2.24) : mettre à jour Docker |
| Multijoueur bloqué sur « connexion… » | *Websockets Support* non coché sur l'hôte 1 |
| Zones : « pack introuvable sur le serveur » | tuiles absentes de `deploy/data/worlds/<zone>/tiles/` (étape 7) |
| Voix muette | 7881/tcp et 7882/udp (ufw + pare-feu OVH), hôte 2 avec Websockets |
| Certificat refusé par Let's Encrypt | DNS pas propagé, ou AAAA vers une mauvaise IPv6 |
