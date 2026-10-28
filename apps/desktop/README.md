# Allez Robert ! — application Windows (Tauri 2)

`apps/desktop` emballe le client web (`apps/client`) dans une application Windows native et
expose au TypeScript ce que le navigateur ne sait pas (ou mal) faire :

- **Bluetooth LE natif** (btleplug / WinRT) : home-trainers FTMS, capteurs de puissance,
  cardio, cadence… avec choix de l'adaptateur (intégré ou dongle USB) ;
- **Wahoo Direct Connect** (DirCon) : découverte mDNS `_wahoo-fitness-tnp._tcp` + liaison TCP ;
- **ANT+** par clé USB Garmin/Dynastream (USB2 `0fcf:1008`, USB-m `0fcf:1009`) ;
- **dossier de données** (`storage.rs`) : zones (`worlds/`), ressources du jeu (`media/`) et sauvegarde
  du profil (`profil/`) sur le disque, déplaçable sur un autre disque ;
- **téléchargements** (`packs.rs`) : 16 fichiers à la fois, empreintes vérifiées, reprise, mise à jour
  par différence, échange atomique de version ; zones servies par `worlds://` (`worlds.rs`), ressources
  par le fournisseur de fichiers de l'exe (`assets.rs`, disque si l'exe ne les a pas) ;
- **système** (`system.rs`) : écran gardé allumé pendant une sortie, plein écran natif (F11), mises à
  jour signées (`tauri-plugin-updater`) ; sorties FIT/GPX enregistrées dans `Documents\Allez Robert\Sorties`,
  captures dans `Images\Allez Robert` ;
- **WebView2 réglé pour le jeu** (`tauri.conf.json`, `additionalBrowserArgs`) : carte graphique dédiée
  (`--force_high_performance_gpu`), pas de ralentissement quand la fenêtre perd le focus, cache disque
  des shaders porté à 256 Mo (6 Mo par défaut dans Chromium : les shaders étaient recompilés).

Construction et publication : [docs/BUILD_EXE.md](../../docs/BUILD_EXE.md).

Le contrat exact (commandes `invoke`, arguments, formes de retour, événements) est défini dans
[`packages/shared/src/native-bridge.ts`](../../packages/shared/src/native-bridge.ts). Les octets
circulent sous forme de tableaux de nombres (0–255) et les UUID en 128 bits minuscules.

## Prérequis

- **Windows 10/11 x64** avec le runtime **WebView2** (présent d'office sur Windows 11 ; sinon
  l'installateur le télécharge automatiquement).
- **Microsoft C++ Build Tools** (Visual Studio Build Tools, charge de travail « Développement
  Desktop en C++ » avec le SDK Windows 10/11).
- **Rust** stable ≥ 1.90 (`rustup default stable-x86_64-pc-windows-msvc`).
- **Node.js ≥ 22** et **pnpm 10** (racine du dépôt : `pnpm install`).

### Disque C: plein ? Déplacer le cache Cargo

Le premier build télécharge et compile plusieurs centaines de crates (≈ 1 Go de sources,
≈ 4–5 Go dans `src-tauri/target`). `target/` est déjà dans `apps/desktop/src-tauri/` (sur D:).
Pour que le registre Cargo ne remplisse pas `C:\Users\<vous>\.cargo`, définissez :

```bash
# Git Bash
export CARGO_HOME=D:/cargo
# PowerShell (permanent pour l'utilisateur)
[Environment]::SetEnvironmentVariable("CARGO_HOME", "D:\cargo", "User")
```

Les binaires `cargo`/`rustc` restent ceux de rustup (`%USERPROFILE%\.cargo\bin` dans le `PATH`) ;
seuls le registre et les dépôts git téléchargés vont dans `D:\cargo`. C'est la configuration
utilisée pour développer ce paquet.

## Commandes

Depuis la racine du dépôt :

```bash
pnpm --filter @allezrobert/desktop dev     # lance le client Vite (localhost:5173) + la fenêtre Tauri
pnpm --filter @allezrobert/desktop build   # build optimisé + installateurs MSI et NSIS
pnpm --filter @allezrobert/desktop test    # tests Rust (trames ANT, TXT DirCon, UUID…)
pnpm --filter @allezrobert/desktop check   # cargo check
pnpm --filter @allezrobert/desktop icons   # régénère les icônes provisoires
```

- `dev` exécute d'abord `pnpm --filter @allezrobert/client dev` (serveur Vite sur
  `http://localhost:5173`) puis ouvre la fenêtre (1920×1080, redimensionnable) sur cette URL.
- `build` exécute `pnpm --filter @allezrobert/client build` (sortie `apps/client/dist`) puis
  produit les installateurs dans `src-tauri/target/release/bundle/msi/` (`.msi`) et
  `src-tauri/target/release/bundle/nsis/` (`-setup.exe`, installation par utilisateur, sans
  droits administrateur).
- Directement en Rust : `cd apps/desktop/src-tauri && cargo build` / `cargo test`.
  `tauri::generate_context!` exige que `apps/client/dist` existe : si le client n'a jamais été
  construit, un `apps/client/dist/index.html` vide suffit (dossier ignoré par git).

Côté TypeScript, l'application se détecte via `window.__TAURI_INTERNALS__` ; les appels passent
par `invoke('ble_connect', { deviceId })` et `listen('ble://notification', …)` du paquet
`@tauri-apps/api`. Les arguments sont en camelCase (`deviceId`, `withResponse`, `timeoutMs`,
`connectionId`, `deviceType`, `rfFreq`…), convertis automatiquement par Tauri.

## Bluetooth LE : choix de l'adaptateur

- `ble_list_adapters()` renvoie les adaptateurs connus de Windows avec leur nom (ex.
  « Intel(R) Wireless Bluetooth(R) », « Realtek Bluetooth 5.3 Adapter ») et leur adresse ;
  `isDefault` désigne l'adaptateur actif par défaut.
- `ble_select_adapter({ adapterId })` sélectionne l'adaptateur pour les recherches suivantes.
  Sans sélection explicite, l'adaptateur par défaut est utilisé.
- **Limite Windows** : la pile Bluetooth de Windows n'utilise réellement qu'**une radio à la
  fois**. Pour utiliser un dongle USB (souvent bien plus fiable que la puce intégrée pour
  plusieurs capteurs), désactivez l'adaptateur intégré dans le *Gestionnaire de périphériques*
  (Bluetooth → clic droit → Désactiver), branchez le dongle, puis relancez la recherche. La liste
  permet de vérifier lequel est actif.
- La recherche (`ble_start_scan({ services })`) filtre sur les services annoncés et émet
  `ble://discovered` au plus une fois par seconde et par appareil (mise à jour du RSSI), ou
  immédiatement si le nom ou les services changent. `name` vaut `""` si l'appareil n'annonce pas
  de nom ; les clés de `manufacturerData` sont les identifiants fabricant en décimal.
- `ble_connect({ deviceId })` connecte, découvre les services et renvoie la liste
  services/caractéristiques (propriétés au format Web Bluetooth : `read`, `write`,
  `writeWithoutResponse`, `notify`, `indicate`…).
- Les notifications arrivent sur `ble://notification`. Une perte de connexion (capteur éteint,
  hors de portée) est détectée par l'événement système **et** par une vérification toutes les
  3 s ; elle émet `ble://disconnected` (aussi émis après `ble_disconnect`, comme
  `gattserverdisconnected` en Web Bluetooth).
- Windows : autorisez le Bluetooth dans *Paramètres → Confidentialité et sécurité*. Un capteur
  appairé dans les paramètres Windows peut refuser une autre connexion : évitez de l'appairer.

## Wahoo Direct Connect

- `dircon_discover({ timeoutMs })` écoute le mDNS pendant `timeoutMs` (3 s par défaut) et renvoie
  les appareils (KICKR, KICKR CORE, KICKR BIKE…) avec `host` (IPv4 de préférence), `port`, et les
  enregistrements TXT `serial-number`, `mac-address`, `ble-service-uuids` (convertis en UUID
  128 bits).
- `dircon_connect({ host, port })` ouvre une connexion TCP et renvoie un `connectionId` ;
  `dircon_send` envoie des trames DirCon complètes ; les octets reçus arrivent sur `dircon://data`
  (découpage TCP arbitraire : le TypeScript réassemble), la fermeture sur `dircon://closed`.
- Le PC et le home-trainer doivent être sur le même réseau local (pas de réseau « invité »
  isolé). Autorisez l'application dans le pare-feu Windows (réseau **privé**) au premier lancement,
  sinon les réponses mDNS (UDP 5353) sont bloquées.

## ANT+ (clé USB)

Clés prises en charge : **Garmin USB-m** (`0fcf:1009`, la petite) et **ANT USB2** (`0fcf:1008`).
Les anciennes clés USB1 (`0fcf:1004`, puce série Silicon Labs) ne sont pas gérées.

### Pilote : WinUSB via Zadig

La communication USB passe par [`nusb`](https://crates.io/crates/nusb) (Rust pur, pas de
`libusb` à installer), qui exige le pilote **WinUSB** :

1. Fermez Garmin Express, Zwift et toute application qui utilise la clé.
2. Téléchargez [Zadig](https://zadig.akeo.ie/), lancez-le, menu *Options → List All Devices*.
3. Choisissez « ANT USBStick2 » / « ANT USB-m Stick » (ID `0FCF 1008` ou `0FCF 1009`).
4. Pilote cible **WinUSB** → *Replace Driver* (ou *Install Driver*).

Zwift, TrainerRoad et la plupart des applications récentes fonctionnent aussi avec WinUSB. Pour
revenir en arrière : Gestionnaire de périphériques → clé ANT → *Désinstaller* (cocher la
suppression du pilote), puis rebrancher.

### Clé réseau ANT+

La clé réseau ANT+ est soumise à licence : **elle n'est pas dans le dépôt** (dépôt public).
Récupérez-la sur [thisisant.com](https://www.thisisant.com/) (compte « ANT+ Adopter ») puis
fournissez-la, en hexadécimal (8 octets, ex. `0011223344556677` ou `0x00,0x11,…`), par :

1. la variable d'environnement `ANT_PLUS_NETWORK_KEY` (pratique en développement) ;
2. ou le fichier `%APPDATA%\fr.cparfait.allezrobert\ant-plus-network-key.txt` ;
3. ou le fichier `ant-plus-network-key.txt` à côté de l'exécutable installé.

### Fonctionnement

- `ant_list_sticks()` liste les clés présentes (tableau vide si aucune).
- `ant_open({ stickId })` (`stickId` vide = première clé) : réinitialise la clé et charge la clé
  réseau ANT+ sur le réseau 0. Sans clé USB : erreur « Aucune clé ANT+ détectée ».
- `ant_open_channel({ channel, deviceType, deviceNumber, transmissionType, period, rfFreq })` :
  assignation (esclave en réception), identifiant de canal (`deviceNumber`/`transmissionType` à 0
  = joker), période, fréquence (57 pour ANT+), recherche infinie en basse priorité, ouverture.
  Exemple cardio : `{ channel: 0, deviceType: 120, deviceNumber: 0, transmissionType: 0,
  period: 8070, rfFreq: 57 }` ; puissance : `deviceType: 11, period: 8182` ; FE-C :
  `deviceType: 17, period: 8192`.
- Chaque message de données (diffusion, acquitté, rafale) émet `ant://message`
  `{ channel, data }` avec les 8 octets de charge utile (données étendues ignorées).
- `ant_send({ channel, data, acknowledged })` envoie 8 octets (ex. commande de résistance FE-C,
  de préférence `acknowledged: true`).
- `ant_close()` ferme les canaux, réinitialise et libère la clé (aussi fait à la fermeture de
  l'application).

## Journaux

`tauri-plugin-log` écrit dans la console (mode `dev`) et dans un fichier du dossier
`%LOCALAPPDATA%\fr.cparfait.allezrobert\logs\`. Niveau `debug` pour
l'application en développement, `info` en production. Les erreurs renvoyées au TypeScript sont
des chaînes en français (`invoke(...)` rejette avec ce texte).

## Dépannage

| Symptôme | Piste |
| --- | --- |
| `cargo` : « no space left on device » | `CARGO_HOME=D:/cargo` (voir plus haut), vider `src-tauri/target` (`cargo clean`). |
| `build` : NSIS échoue avec « os error 4395 » après « NSIS.exe is outdated » | Le cache d'outils de tauri-cli est corrompu : supprimer `%LOCALAPPDATA%\tauri\NSIS` (re-téléchargé automatiquement). Le MSI est produit avant NSIS. |
| Fenêtre blanche en `dev` | Le serveur Vite n'est pas lancé sur le port 5173 (`pnpm --filter @allezrobert/client dev`). |
| `generate_context!` : `frontendDist` introuvable | Construire le client ou créer `apps/client/dist/index.html`. |
| « Aucun adaptateur Bluetooth détecté » | Bluetooth désactivé (mode avion ?) ou pilote absent. |
| Le dongle Bluetooth n'est jamais utilisé | Désactiver l'adaptateur intégré dans le Gestionnaire de périphériques. |
| Aucun appareil trouvé à la recherche BLE | Capteur déjà connecté à une autre appli (montre, téléphone, Zwift) ; le réveiller (pédaler). |
| Connexion BLE qui expire | Capteur appairé dans Windows : le supprimer des appareils Bluetooth puis réessayer. |
| Direct Connect : liste vide | Même réseau ? pare-feu (réseau privé) ? Le KICKR doit avoir son voyant Wi-Fi/Ethernet actif. |
| « Ouverture de la clé ANT+ impossible » | Pilote WinUSB absent (Zadig) ou clé utilisée par une autre application. |
| « Clé réseau ANT+ absente » | Définir `ANT_PLUS_NETWORK_KEY` ou créer le fichier de clé (voir plus haut). |
| Pas de messages ANT+ | Mauvaise période/type d'appareil, capteur endormi, clé trop loin (rallonge USB conseillée). |

## Organisation

```
apps/desktop/
├── package.json              # @allezrobert/desktop (scripts tauri dev / build)
├── scripts/make-icon.mjs     # icône provisoire 1024 px (sans dépendance)
└── src-tauri/
    ├── Cargo.toml / build.rs / tauri.conf.json
    ├── capabilities/default.json
    ├── icons/                # générées par `tauri icon`
    └── src/
        ├── main.rs / lib.rs  # point d'entrée, plugins, état, commandes
        ├── error.rs          # erreurs → chaînes françaises
        ├── ble.rs            # Bluetooth LE (btleplug)
        ├── ble_windows.rs    # noms d'adaptateurs / adaptateur par défaut (WinRT)
        ├── dircon.rs         # Wahoo Direct Connect (mdns-sd + TCP tokio)
        ├── ant.rs            # clé ANT+ USB (nusb)
        ├── ant_protocol.rs   # trames ANT (encodage, décodage, clé réseau)
        ├── storage.rs        # dossier de données, profil, fichiers exportés
        ├── packs.rs          # téléchargement des zones et des ressources du jeu
        ├── worlds.rs         # protocole worlds:// (zones du disque)
        ├── assets.rs         # fichiers du jeu : exe, puis ressources du disque
        └── system.rs         # veille, plein écran, mises à jour
```
