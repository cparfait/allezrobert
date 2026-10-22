# Protocoles matériels — Allez Robert !

Ce document décrit tout ce que le jeu envoie et reçoit des capteurs et des home trainers :
services Bluetooth, op codes, pages ANT+, trames Direct Connect, séquences de connexion et pièges
connus. Le code correspondant se trouve dans deux paquets :

- `packages/protocols` : encodage et décodage purs (aucune E/S), testés octet par octet ;
- `packages/devices` : transports, profils, gestionnaire d'appareils, simulateur.

Conventions : les entiers Bluetooth et ANT sont en **little-endian**. Seule la longueur de l'en-tête
Direct Connect est en big-endian. Toutes les UUID sont manipulées en 128 bits minuscules
(`0000xxxx-0000-1000-8000-00805f9b34fb` pour les identifiants 16 bits du Bluetooth SIG).

---

## 1. Vue d'ensemble

| Matériel | Liaison préférée | Repli | Profil |
| --- | --- | --- | --- |
| Wahoo KICKR CORE (2018) | Bluetooth FTMS (si firmware récent) | ANT+ FE-C | `FtmsTrainer` / `FecTrainer` |
| Wahoo KICKR CORE 2 | Bluetooth FTMS | WiFi Direct Connect, ANT+ FE-C | `FtmsTrainer` sur `DirconTransport` |
| Autres trainers 2020+ (Elite, Tacx, Saris…) | FTMS | FE-C over BLE (Tacx), ANT+ FE-C | idem |
| Wahoo TICKR | Bluetooth HRS (3 connexions possibles) | ANT+ HR | `HeartRateMonitor` / `AntHeartRateMonitor` |
| Favero Assioma Duo | Bluetooth CPS (**1 seule connexion**) | ANT+ PWR (TE/PS) | `PowerMeter` / `AntPowerMeter` |
| Zwift Click / Play / Ride | Bluetooth propriétaire (expérimental) | — | `ZwiftControllerShifter` |
| Shimano Di2 D-Fly | Bluetooth propriétaire (expérimental) | — | `DflyShifter` |
| SRAM AXS (dérailleur arrière) | Bluetooth propriétaire (expérimental) | — | `SramAxsShifter` |
| KICKR HEADWIND | Bluetooth propriétaire (expérimental) | — | `HeadwindFan` |
| Clavier, manette | API navigateur | — | `KeyboardShifter`, `GamepadShifter` |

Transports, tous derrière la même interface `Transport` → `DeviceLink` (GATT abstrait ou canal ANT) :

| Transport | Où | Implémentation |
| --- | --- | --- |
| Web Bluetooth | Chrome, Edge, Opera (pas Firefox ni Safari) | `WebBluetoothTransport` |
| Bluetooth natif | app desktop Tauri (Rust btleplug) | `NativeBleTransport` (commandes `ble_*`) |
| Direct Connect | app desktop (TCP + mDNS côté Rust) | `DirconTransport` (commandes `dircon_*`) |
| ANT+ USB | app desktop (clé USB) | `AntTransport` (commandes `ant_*`) |
| Simulateur | partout (dev, tests) | `SimulatorTransport` |

Le contrat Rust ↔ TypeScript est dans `packages/shared/src/native-bridge.ts`. Les modules
`@tauri-apps/api/core` et `@tauri-apps/api/event` ne sont importés dynamiquement que si
`'__TAURI_INTERNALS__' in window`.

---

## 2. Fitness Machine Service (FTMS, 0x1826)

Référence : Bluetooth SIG, *Fitness Machine Service Specification* v1.0. Code : `protocols/src/ble/ftms.ts`.

### 2.1 Caractéristiques utilisées

| UUID | Nom | Propriétés | Usage |
| --- | --- | --- | --- |
| 0x2ACC | Fitness Machine Feature | read | capacités (ERG, simulation, spindown…) |
| 0x2AD2 | Indoor Bike Data | notify | puissance, cadence, vitesse du trainer |
| 0x2AD3 | Training Status | read/notify | informatif |
| 0x2AD6 | Supported Resistance Level Range | read | plage du mode résistance |
| 0x2AD8 | Supported Power Range | read | bornes de la consigne ERG |
| 0x2AD9 | Fitness Machine Control Point | write + indicate | commandes |
| 0x2ADA | Fitness Machine Status | notify | changements d'état, perte de contrôle |

### 2.2 Indoor Bike Data (0x2AD2, §4.9)

Champ `Flags` uint16, puis les champs présents dans l'ordre des bits :

| Bit | Champ | Type | Résolution |
| --- | --- | --- | --- |
| 0 | **More Data** (logique inversée : 0 = vitesse instantanée présente) | uint16 | 0,01 km/h |
| 1 | Average Speed | uint16 | 0,01 km/h |
| 2 | Instantaneous Cadence | uint16 | 0,5 tr/min |
| 3 | Average Cadence | uint16 | 0,5 tr/min |
| 4 | Total Distance | uint24 | 1 m |
| 5 | Resistance Level | sint16 | 1 |
| 6 | Instantaneous Power | sint16 | 1 W |
| 7 | Average Power | sint16 | 1 W |
| 8 | Expended Energy : total, par heure, par minute | uint16, uint16, uint8 | kcal (0xFFFF/0xFF = n.d.) |
| 9 | Heart Rate | uint8 | bpm |
| 10 | Metabolic Equivalent | uint8 | 0,1 |
| 11 | Elapsed Time | uint16 | s |
| 12 | Remaining Time | uint16 | s |

Si le bit 0 vaut 1, la suite arrive dans la notification suivante : `FtmsTrainer` fusionne les
fragments et n'émet qu'à réception du dernier (bit 0 = 0).

### 2.3 Fitness Machine Feature (0x2ACC, §4.3)

Deux uint32. Bits utiles du second (*Target Setting Features*) : 2 résistance, 3 puissance (ERG),
13 simulation (pente), 14 circonférence de roue, 15 spindown.

### 2.4 Control Point (0x2AD9, §4.16)

| Op code | Commande | Paramètres |
| --- | --- | --- |
| 0x00 | Request Control | — (obligatoire avant tout le reste) |
| 0x01 | Reset | — (libère le contrôle) |
| 0x03 | Set Target Inclination | sint16, 0,1 % |
| 0x04 | Set Target Resistance Level | uint8, 0,1 (borné à la plage 0x2AD6) |
| 0x05 | Set Target Power (ERG) | sint16, W |
| 0x07 | Start or Resume | — |
| 0x08 | Stop or Pause | uint8 : 0x01 stop, 0x02 pause |
| 0x11 | Set Indoor Bike Simulation Parameters | vent sint16 ×0,001 m/s · pente sint16 ×0,01 % · Crr uint8 ×0,0001 · Cw uint8 ×0,01 kg/m |
| 0x12 | Set Wheel Circumference | uint16, 0,1 mm |
| 0x13 | Spin Down Control | uint8 : 0x01 start, 0x02 ignore |
| 0x14 | Set Targeted Cadence | uint16, 0,5 tr/min |

Exemple : pente 5,5 %, vent nul, Crr 0,004, Cw 0,51 → `11 00 00 26 02 28 33`.

Réponse (indication) : `80 <op code de la requête> <résultat> [paramètres]`.

| Résultat | Sens |
| --- | --- |
| 0x01 | Success |
| 0x02 | Op Code not supported |
| 0x03 | Invalid Parameter |
| 0x04 | Operation Failed |
| 0x05 | **Control Not Permitted** (un autre client pilote le trainer) |

La réponse à un Spin Down réussi contient la plage de vitesse cible (2 × uint16, 0,01 km/h).

### 2.5 Fitness Machine Status (0x2ADA, §4.17)

Op codes gérés : 0x01 reset, 0x02 arrêt/pause utilisateur, 0x04 démarrage, 0x05–0x09 cibles
modifiées, 0x12 paramètres de simulation modifiés, 0x13 circonférence, 0x14 état du spindown
(0x01 demandé, 0x02 réussi, 0x03 erreur, 0x04 arrêtez de pédaler), 0x15 cadence cible,
**0xFF perte de contrôle**.

### 2.6 Séquences

**Appairage puis prise de contrôle**

1. Connexion, découverte des services, lecture de Device Information (fabricant, modèle, firmware).
2. Lecture de 0x2ACC, 0x2AD8 et 0x2AD6 (facultatives).
3. Abonnement à 0x2AD2, 0x2ADA, puis indications de 0x2AD9.
4. `00` Request Control → attente de `80 00 01`.
5. `07` Start or Resume (certains trainers répondent « non pris en charge », c'est ignoré).
6. Renvoi de la dernière consigne si c'est une reconnexion.

**Boucle de simulation (1 à 4 Hz)**

Le jeu calcule la vitesse lui-même (modèle de Martin et al.). Il envoie la pente effective,
c'est-à-dire la pente réelle × difficulté, modulée par le rapport virtuel :
`11 <vent> <pente> <crr> <cw>`. Une seule commande est en vol à la fois. Si une consigne plus
récente arrive avant l'envoi de la précédente, elle la remplace : pas d'embouteillage à 4 Hz.

**ERG**

`05 <W>` à chaque changement de cible, plus les petites corrections du power match (§8).

**Perte de contrôle**

Le trainer envoie le statut `FF`, ou répond `80 xx 05`. Le jeu affiche l'alerte de cohabitation
(§9), redemande le contrôle et renvoie la dernière consigne.

---

## 3. Cycling Power Service (CPS, 0x1818)

Références : *Cycling Power Service* v1.1 et GATT Specification Supplement §3.59–3.61.
Code : `protocols/src/ble/cycling-power.ts`.

### 3.1 Cycling Power Measurement (0x2A63)

`Flags` uint16, puis `Instantaneous Power` sint16 (W), toujours présent, puis les champs suivants :

| Bit | Champ | Type |
| --- | --- | --- |
| 0 | Pedal Power Balance | uint8, 1/2 % |
| 1 | Balance Reference : 0 = inconnue, **1 = gauche** | (drapeau seul) |
| 2 | Accumulated Torque | uint16, 1/32 N·m |
| 3 | Source du couple : 0 = roue, 1 = manivelle | (drapeau seul) |
| 4 | Wheel Revolution Data | uint32 révolutions + uint16 temps 1/2048 s |
| 5 | Crank Revolution Data | uint16 révolutions + uint16 temps 1/1024 s |
| 6 | Extreme Force Magnitudes | sint16 max, sint16 min (N) |
| 7 | Extreme Torque Magnitudes | sint16 max, sint16 min (1/32 N·m) |
| 8 | Extreme Angles | 3 octets : 12 bits max + 12 bits min (degrés) |
| 9 | Top Dead Spot Angle | uint16 (degrés) |
| 10 | Bottom Dead Spot Angle | uint16 (degrés) |
| 11 | Accumulated Energy | uint16 (kJ) |
| 12 | Offset Compensation Indicator | (drapeau seul) |

**Cadence** : `CrankCadenceCalculator`. On calcule Δrévolutions × 60 × 1024 / Δtemps, avec les
débordements des compteurs uint16 (révolutions à 65 536, temps à 64 s). Sans nouvel événement
pendant 3 s, la cadence passe à 0. Les valeurs aberrantes au-delà de 250 tr/min sont ignorées.

**Balance** : `balanceLeft` n'est renseignée que si la référence est « gauche ». Avec une
référence inconnue, on ne sait pas quelle jambe est décrite.

### 3.2 Cycling Power Feature (0x2A65, uint32)

Bits : 0 balance, 1 couple cumulé, 2 roue, 3 manivelle, 4 forces/couples extrêmes, 5 angles
extrêmes, 6 points morts, 7 énergie, 8–9 compensation d'offset, 10 masquage, 11 emplacements
multiples, 12–15 réglages (manivelle, chaîne, porte-à-faux), 16 contexte force/couple,
17 direction, 18 date d'étalonnage, 19 compensation améliorée, 20–21 système distribué.

### 3.3 Cycling Power Vector (0x2A64, optionnel)

Flags uint8 : bit 0 manivelle (uint16 + uint16), bit 1 premier angle (uint16), bit 2 tableau de
forces (sint16 N), bit 3 tableau de couples (sint16 1/32 N·m), bits 4–5 direction de mesure.

### 3.4 TE et PS : uniquement en ANT+

Le CPS **n'a pas de champ** pour la Torque Effectiveness ni pour la Pedal Smoothness. Les Favero
Assioma ne les transmettent qu'en **ANT+ PWR, page 0x13** (§6.3). Pour les afficher et les
écrire dans le FIT, il faut donc une clé ANT+ USB. L'ANT+ étant une diffusion, l'Edge peut
recevoir les mêmes données en parallèle.

---

## 4. Heart Rate (0x180D), CSC (0x1816), batterie, Device Information

**Heart Rate Measurement 0x2A37** : flags uint8. Bit 0 : format (0 = uint8, 1 = uint16).
Bits 1–2 : contact (bit 2 géré, bit 1 détecté). Bit 3 : énergie (uint16 kJ). Bit 4 : intervalles
R-R (uint16 en 1/1024 s ; convertis en ms, arrondis à 0,1 ms). Le TICKR accepte 3 connexions
Bluetooth simultanées : la montre peut rester appairée.

**CSC Measurement 0x2A5B** : flags uint8. Bit 0 : roue (uint32 révolutions + uint16 temps
1/1024 s). Bit 1 : manivelle (uint16 + uint16 temps 1/1024 s). `WheelSpeedCalculator` utilise
une circonférence de 2,105 m par défaut (700×25C). **CSC Feature 0x2A5C** (uint16) : bit 0 roue,
bit 1 manivelle, bit 2 emplacements multiples.

**Battery Level 0x2A19** : uint8, 0–100 %.

**Device Information 0x180A** : chaînes UTF-8 (zéros terminaux retirés).
0x2A29 fabricant, 0x2A24 modèle, 0x2A25 n° de série, 0x2A27 révision matérielle,
0x2A26 firmware, 0x2A28 logiciel.

---

## 5. ANT : trames USB

Référence : *ANT Message Protocol and Usage* rev 5.1. Code : `protocols/src/ant/message.ts`.

```
[0xA4 SYNC][LONGUEUR][ID][CHARGE UTILE…][XOR de tous les octets précédents]
```

| ID | Message | Charge utile |
| --- | --- | --- |
| 0x4A | Reset System | `00` |
| 0x46 | Set Network Key | n° de réseau + 8 octets de clé |
| 0x42 | Assign Channel | canal, type (0x00 esclave bidirectionnel), réseau |
| 0x51 | Set Channel ID | canal, n° d'appareil uint16 (0 = joker), type (bit 7 = appairage), transmission |
| 0x43 | Channel Period | canal, uint16 (1/32 768 s) |
| 0x45 | Channel RF Frequency | canal, **57** (2457 MHz) |
| 0x44 | Search Timeout | canal, unités de 2,5 s |
| 0x4B / 0x4C | Open / Close Channel | canal |
| 0x4E | Broadcast Data | canal + 8 octets |
| 0x4F | Acknowledged Data | canal + 8 octets (commandes FE-C) |
| 0x40 | Channel Response / Event | canal, id (1 = événement RF), code |
| 0x6E | Lib Config | `00 80` : n° d'appareil ajouté aux messages reçus (messages étendus) |

Exemples : `A4 01 4A 00 EF` (reset), `A4 02 45 00 39 DA` (fréquence 57 sur le canal 0).

`AntMessageReader` reconstitue le flux USB. Il se resynchronise sur 0xA4 si la somme de contrôle
est fausse ou la longueur invraisemblable.

### Clé réseau ANT+ : jamais dans le dépôt

La clé du réseau ANT+ est fournie par ANT Wireless (thisisant.com) aux adoptants qui acceptent la
licence ANT+. Cette licence n'en autorise pas la redistribution, et le dépôt est public : la clé
**n'est donc pas codée en dur**. Elle est lue dans la configuration, par exemple la variable
d'environnement `ANT_PLUS_NETWORK_KEY` ou un réglage de l'app desktop, avec `parseAntNetworkKey()`.
Elle est ensuite passée à `ant_open({ stickId, networkKey })`. Si elle est absente, l'app desktop
doit la connaître par sa propre configuration. Les tests utilisent une valeur fictive.

---

## 6. Profils ANT+

Paramètres de canal (`ANT_PLUS_PROFILES`) :

| Profil | Type d'appareil | Période | Fréquence |
| --- | --- | --- | --- |
| HR | 120 | 8070 (4,06 Hz) | 57 |
| PWR | 11 | 8182 (4,005 Hz) | 57 |
| FE-C | 17 | 8192 (4 Hz) | 57 |
| Vitesse+cadence / vitesse / cadence | 121 / 123 / 122 | 8086 / 8118 / 8102 | 57 |
| Controls | 16 | 8192 | 57 |

### 6.1 FE-C (*Fitness Equipment Device Profile* rev 5)

| Page | Sens | Contenu |
| --- | --- | --- |
| 16 (0x10) General FE Data | trainer → jeu | type (25 = trainer), temps 0,25 s, distance 1 m, vitesse 0,001 m/s, FC, capacités, état (bits 4–6 : 1 veille, 2 prêt, 3 en cours, 4 terminé) |
| 25 (0x19) Specific Trainer Data | trainer → jeu | compteur, cadence, puissance cumulée uint16, puissance instantanée **12 bits** (octet 5 + bits 0–3 de l'octet 6), bits d'étalonnage requis, limites de puissance cible |
| 48 (0x30) Basic Resistance | jeu → trainer | octet 7 : résistance 0,5 % (0–200) |
| 49 (0x31) Target Power | jeu → trainer | octets 6–7 : 0,25 W |
| 50 (0x32) Wind Resistance | jeu → trainer | octet 5 : coefficient 0,01 kg/m · octet 6 : vent km/h + 127 · octet 7 : aspiration 0,01 |
| 51 (0x33) Track Resistance | jeu → trainer | octets 5–6 : (pente + 200 %) / 0,01 · octet 7 : Crr ×5·10⁻⁵ |
| 55 (0x37) User Configuration | jeu → trainer | poids coureur 0,01 kg, poids vélo 0,05 kg, diamètre de roue, rapport |
| 1 (0x01) Calibration Request | jeu → trainer | bit 7 spin-down, bit 6 zéro |
| 71 (0x47) Command Status | trainer → jeu | dernière commande, séquence, statut (0 OK, 1 échec, 2 non géré, 3 rejeté, 4 en attente) |
| 80 / 81 / 82 | communes | fabricant, produit et n° de série, batterie |

Les commandes partent en message acquitté (0x4F). Le mode simulation envoie la page 50
uniquement si le vent change, puis la page 51.

**FE-C over BLE (Tacx)** : service `6e40fec1-b5a3-f393-e0a9-e50e24dcca9e`. Notifications sur
`…fec2`, écriture sur `…fec3`. Les mêmes pages y circulent, encapsulées dans des messages ANT
complets (canal 5). C'est géré par `FecTrainer`.

### 6.2 HR

L'octet 0 contient le n° de page (bits 0–6) et le bit « toggle » (bit 7). Octets 4–5 : temps du
dernier battement (1/1024 s). Octet 6 : compteur de battements. Octet 7 : FC calculée.
Pages 1 (temps cumulé), 2 (fabricant), 3 (produit), 4 (battement précédent → R-R exact),
7 (batterie). `AntHeartRateRrCalculator` déduit les R-R.

### 6.3 PWR (*Bicycle Power Device Profile*)

| Page | Contenu |
| --- | --- |
| 0x10 Standard Power-Only | compteur, *pedal power* (bit 7 = 1 → bits 0–6 = part **droite** en %), cadence, puissance cumulée uint16, puissance instantanée uint16 |
| 0x12 Standard Crank Torque | compteur, tours, cadence, période cumulée (1/2048 s), couple cumulé (1/32 N·m). Puissance = 128π·ΔCouple/ΔPériode ; cadence = 60·Δévénements·2048/ΔPériode |
| 0x13 TE & PS | TE gauche/droite, PS gauche/droite en 0,5 % ; 0xFF = invalide ; PS droite = 0xFE → PS gauche = valeur combinée |

`AntPowerMeter` fusionne la dernière page 0x13 dans chaque `PowerSample`
(`teLeft`, `teRight`, `psLeft`, `psRight`).

### 6.4 Limites du contrat natif actuel

Les messages `ant://message` ne portent pas le n° d'appareil. La recherche ouvre donc un canal
« joker » par profil, qui s'appaire au premier capteur entendu (suffisant à la maison). Ce canal
est réutilisé à la connexion. `ant_close_channel` est proposée comme commande optionnelle. Il
faudra ajouter le n° d'appareil (messages étendus 0x6E) si plusieurs capteurs du même type
émettent à proximité.

---

## 7. Wahoo Direct Connect (DirCon)

Le GATT transporté en TCP. Réimplémentation d'après les descriptions publiques de
[Berg0162/DirCon](https://github.com/Berg0162/DirCon),
[binarylogic/py-wftnp](https://github.com/binarylogic/py-wftnp) et
[qdomyos-zwift](https://github.com/cagnulein/qdomyos-zwift) (`dirconpacket.h/.cpp`), sans copie de
code. Code : `protocols/src/dircon.ts` et `devices/src/transports/dircon.ts`.

**Découverte** : mDNS `_wahoo-fitness-tnp._tcp`, port typique 36866, TXT `ble-service-uuids`.
Elle est faite côté Rust (`dircon_discover`). Un ajout manuel par adresse IP est possible
(`addManualDevice`).

**En-tête (6 octets)**

| Octet | Champ |
| --- | --- |
| 0 | version = 1 |
| 1 | identifiant de message |
| 2 | n° de séquence (repris dans la réponse ; 0 pour une notification) |
| 3 | code réponse |
| 4–5 | longueur de la charge utile, uint16 **big-endian** |

| Id | Message | Requête | Réponse |
| --- | --- | --- | --- |
| 0x01 | Discover Services | vide | N × UUID (16 octets) |
| 0x02 | Discover Characteristics | UUID service | UUID service + N × (UUID + propriétés : 1 read, 2 write, 4 notify, 8 indicate) |
| 0x03 | Read | UUID | UUID + données |
| 0x04 | Write | UUID + données | UUID |
| 0x05 | Enable Notifications | UUID + 1 octet (1 = activer, 0 = désactiver) | UUID |
| 0x06 | Unsolicited Notification | — | UUID + données (séquence 0) |
| 0xFF | Error | — | — |

Codes réponse : 0 succès, 1 type inconnu, 2 erreur inattendue, 3 service introuvable,
4 caractéristique introuvable, 5 opération non gérée, 6 écriture échouée, 7 protocole inconnu.

Les UUID font 16 octets, dans l'ordre de la chaîne : FTMS = `00 00 18 26 00 00 10 00 80 00 00 80 5F 9B 34 FB`.

`DirconReassembler` reconstitue les trames coupées ou collées par TCP. Il se resynchronise
sur l'octet de version. `DirconGattConnection` sérialise les requêtes (une à la fois), associe
chaque réponse par n° de séquence et identifiant, et expose la même interface `GattConnection`
que le Bluetooth : `FtmsTrainer`, `PowerMeter` et les autres profils sont réutilisés tels quels.

**Un seul client TCP à la fois** : si une autre appli est connectée en WiFi ou Ethernet,
la connexion échoue ou l'autre appli est éjectée.

---

## 8. Power match

Avec des pédales et un trainer en ERG, la **puissance de référence vient des pédales**. Le trainer
reste maître de sa régulation, mais sa consigne est corrigée lentement pour que les pédales lisent
la cible (`PowerMatchController`) :

- consigne trainer = cible × (1 + c) ;
- erreur relative e = (cible − pédales filtrées sur 3 s) / cible ;
- intégrale c ← c + e·dt/T, avec T = 15 s par défaut (plage 10–20 s) ; gain proportionnel 0,1 ;
- correction bornée à **±15 %** ;
- intégration gelée si la cadence est inférieure à 40 tr/min, la mesure absente, pendant 5 s après
  un changement de cible, ou si l'écart dépasse 25 % (sprint, relance : ce n'est pas un défaut
  d'étalonnage). Limite assumée : un écart d'étalonnage supérieur à 25 % n'est jamais corrigé ;
- c est conservé quand la cible change, car c'est l'écart d'étalonnage trainer/pédales ;
- envoi au trainer au plus une fois par seconde, et seulement si l'écart dépasse 1 W.

Sans pédales, ou si elles sont muettes ou déconnectées, la puissance du trainer prend le relais
automatiquement. Le retour des pédales est lui aussi automatique.

---

## 9. Pièges matériels

### Favero Assioma Duo

- **Une seule connexion Bluetooth** : l'appli Favero, Zwift ou un téléphone peut « tenir » les
  pédales. Si la connexion échoue, l'écran d'appairage affiche l'avertissement
  `single-ble-connection`.
- **Mode G+D combiné** : sans l'option « Bluetooth : G+D combiné » de l'appli Favero, une appli BLE
  ne lit qu'une pédale, qui double sa valeur. `AssiomaModeDetector` lève l'alerte
  `assioma-single-side` après 10 trames sans balance, si seule la référence « gauche » apparaît ou
  si le nom contient « ASSIOMA ». Ignorez l'alerte pour des Assioma UNO.
- TE et PS : ANT+ uniquement (§3.4).

### KICKR CORE et KICKR CORE 2

- **KICKR CORE (2018)** : Bluetooth et ANT+ FE-C, pas de WiFi. FTMS selon le firmware ; sinon FE-C
  via une clé ANT+.
- **KICKR CORE 2** : WiFi (Direct Connect), ANT+ FE-C et ANT+ Power, Bluetooth FTMS, plus le
  « Zwift Protocol » que le jeu **n'utilise pas**. Le WiFi apparaît dans la découverte mDNS : même
  FTMS, transporté par DirCon. Le **mode course** (réponse quasi instantanée de la résistance)
  se règle dans l'appli Wahoo : le jeu ne fait qu'en profiter. Avec ce mode, envoyer la pente à
  4 Hz pour un ressenti plus vif.
- Avec un Zwift Cog (pignon unique de 14 dents), les vitesses virtuelles du jeu (paquet `physics`)
  modulent la pente envoyée en FTMS.

### Cohabitation avec un Garmin Edge 1050

- Les capteurs passent en ANT+ vers l'Edge et en Bluetooth vers le jeu (ou en ANT+ vers les deux).
- **Un seul maître pour le trainer** : si l'Edge le pilote (mode résistance, entraînement), le
  trainer répond `Control Not Permitted` ou envoie le statut 0xFF. Le gestionnaire émet alors
  l'avertissement `trainer-control-not-permitted` ou `trainer-control-lost`. Le crochet
  `DeviceManager.onTrainerControlConflict()` permet à l'UI d'expliquer à l'utilisateur qu'il doit
  garder le trainer comme simple capteur sur l'Edge. Le contrôle est redemandé au plus toutes les
  5 s, à chaque consigne.
- Option « ne pas envoyer à Strava » côté jeu si l'Edge enregistre déjà (hors de ce paquet).

### Robustesse

- **Reconnexion automatique** avec des délais de 1, 2, 4, 8, 15 puis 30 s. Le profil FTMS
  redemande le contrôle et renvoie la dernière consigne.
- **Capteur muet** : un appareil connecté sans données depuis 5 s passe à l'état `silent`, avec
  l'avertissement `sensor-silent`. Il revient à `connected` dès la donnée suivante.
- **Lissage 3 s** optionnel (`setSmoothing`). La valeur brute reste disponible (`rawWatts`).
- **Calibration** : spindown FTMS (0x13 et statut 0x14) ou FE-C (page 1), via les événements
  `calibration`.
- **Appairages persistés** : JSON sérialisable (`PairingConfig`), avec un stockage injecté
  (`localStoragePairingStorage`, fichier Tauri…). La restauration reconnecte tout, sauf Web
  Bluetooth, qui exige un geste utilisateur.
- **Choix de l'adaptateur** Bluetooth (intégré ou dongle) : `listAdapters` / `selectAdapter`,
  mémorisé.

---

## 10. Adaptateurs optionnels (expérimentaux, désactivés par défaut)

Ils sont activés par `DeviceManager.setExperimental({...})`. Ce sont des protocoles propriétaires
non documentés, décodés par la communauté : ils peuvent cesser de fonctionner après une mise à jour
de firmware. Chaque connexion émet l'avertissement `experimental-adapter`.

| Adaptateur | Ce qui est implémenté | Non implémenté | Source |
| --- | --- | --- | --- |
| Zwift Click v1, Play, Ride ≤ 1.2 | service `00000001-19ca-4651-86e5-fa29dcdd09d1` (ou 0xFC82), poignée de main « RideOn » en clair, décodage protobuf des boutons (0x37 Click, 0x07 Play, 0x23 Ride/Click v2/Play fw 2 ; bit à 0 = appuyé), palettes analogiques, batterie (0x19, champ 1 ou 2), journal 0x2A, messages vendeur 0xFF, fronts montants | — | BikeControl, zwift-play-remote |
| Zwift Play / Click (anciens firmwares chiffrés « Zap ») | `createZapUnlockStrategy()` (opt-in) : ECDH P-256 éphémère (WebCrypto), HKDF-SHA-256, AES-256-CCM (étiquette 4 o) ; repli automatique en clair si la manette ne renvoie pas de clé | vérification sur matériel (aucune capture publique avec clés) | Makinolo, ajchellew/zwiftplay |
| Zwift Click v2 | palets séparés (0x0A droit, 0x0B gauche) : filtrage des boutons relayés par le gauche, « − » = descendre, RideOn toutes les 3 s (sinon veille au bout d'~1 min), détection du verrou (`ff 03 …` sans écho RideOn → `zwift-controller-locked`) | réponse au défi `ff 03` (clé détenue par Zwift) ; trame `ff 04 00` de « maintien du déverrouillage » (contournement de la fenêtre de 24 h : écartée) | qdomyos-zwift #4743, Torqa #271, ORQWA #306, BikeControl |
| Zwift Ride v2 (firmware ≥ 1.3) | détection du service masqué (annonce Zwift sans service → `zwift-controller-locked`) ; une fois déverrouillé par l'appli Zwift, même décodage que le Ride | déverrouillage (clé Zwift, voir §10.2) | BikeControl #398 |
| KICKR HEADWIND | `[04 mode]` (1 arrêt, 2 FC, 3 vitesse, 4 manuel), `[02 %]`, état `FD 01 % mode` ; pas de 25 % par défaut (seules valeurs observées) | vérification des valeurs intermédiaires, ANT+ | BikeControl (bêta) |
| Shimano Di2 D-Fly | service `000018ef-5348-494d-414e-4f5f424c4500`, canaux 1–4 : 0x10 court, 0x20 long, 0x40 double, 0xF0 = canal non affecté (ignoré) | « mode boutons » et rapport engagé des Di2 12 v sans fil (service 0x18FF authentifié par le code E-TUBE, non publié) | BikeControl, kelvkk/shimano-di2-media-controls |
| SRAM AXS | annonces (batterie mV/%, série, firmware) ; caractéristiques en clair (série, modèle, firmware + build, MicroAdjust, compteur) ; appairage SRAMBond v1 hors ligne (DH 128 bits + AES-EAX) ; rapport engagé `d905000b` déchiffré → `shift` avec `realGear` ; sans appairage : appuis anonymes clic simple / double | identité du bouton pressé (chiffrée, format non publié), SRAMBond v2, reconnexion « greet », réglages | GaborWnuk/sram-axs (MPL-2.0), tarekrached/esphome-sram-axs (MIT), BikeControl #234 |
| ANT+ Controls | page 73 « Generic Command » (haut, bas, sélection, retour…) | — | ANT+ Controls profile |

**Jamais** de « Zwift Protocol » pour piloter la résistance d'un trainer : le jeu passe par FTMS ou
FE-C. Le décodeur Zwift ne lit que les boutons. Licence : BikeControl est publié sous licence non
commerciale (avant le tag `gpl3` : GPL-3.0). Nous n'en reprenons que des **faits de protocole**
(UUID, valeurs d'octets), réimplémentés sans copie de code. Même règle pour tous les projets cités
ci-dessous, quelle que soit leur licence.

### 10.1 Utilisation

- **Click v2** : le type de palet vient des données fabricant (`0x094A`, transmises par l'app desktop ;
  clé décimale `"2378"`). En Web Bluetooth, sans données fabricant, le nom « Zwift Click » et le service
  0xFC82 suffisent à reconnaître un Click v2 (maintien en éveil), mais pas le côté : connecter **un seul
  palet** évite alors le double appui. Mode « palet droit seul » (sans déverrouillage) :
  `zwift: { actions: ZWIFT_CLICK_V2_RIGHT_ONLY_ACTIONS }` (« + » monte, B descend).
- **Manette verrouillée** (`zwift-controller-locked`) : ouvrir l'appli Zwift (compte gratuit), y
  connecter la manette 10 à 30 s, fermer Zwift, reconnecter dans le jeu. Valable ~24 h.
- **Zap** : `createProfiles(link, { experimental: { zwiftControllers: true }, zwift: { unlock: createZapUnlockStrategy() } })`,
  pour une manette dont le firmware n'a jamais été mis à jour. Sinon, mettre le firmware à jour dans
  Zwift Companion (plus simple).
- **SRAM AXS** : fournir `sramAxs: { keyStore }` (clé par numéro de série). Sans clé, le profil
  passe en clics anonymes et émet `sram-axs-not-bonded`. L'interface appelle
  `SramAxsShifter.createBond()` **après** avoir demandé au cycliste de maintenir le bouton AXS du
  dérailleur jusqu'au clignotement. L'appairage renouvelle la clé : l'appli SRAM AXS se ré-appaire
  seule ensuite (le changement de vitesses, sur la radio AIREA, n'est jamais affecté). Pour les clics
  anonymes, régler l'action des palettes sur « aucune » dans l'appli SRAM si le dérailleur ne doit pas
  bouger. Web Bluetooth ne connaît que les services SRAM listés dans `ALL_KNOWN_SERVICES` ; l'app
  desktop découvre tout. Ne jamais écrire sur 0xFE59 (DFU Nordic).

### 10.2 État de la recherche (22 octobre 2026)

Recherche menée sur les dépôts GitHub, tickets, forums et blogs publics. Règle suivie : on implémente
ce qui est **décrit publiquement** et ne demande **ni clé ni secret du constructeur, ni contournement**
d'une mesure de protection ; tout le reste est documenté ici et laissé de côté.

**Zwift Click v2, Ride v2 (déverrouillage)**

- Fonctionne : le Click v2 parle le protocole « Ride » **en clair** (`RideOn` → `RideOn 02 03`, trames
  0x23, masque de 32 bits, repos `23 08 ff ff ff ff 0f`). Le palet droit n'est jamais verrouillé ; les
  deux s'endorment sans trafic (RideOn toutes les 3 s). Batterie `19 10 64` (champ 2), journal 0x2A,
  `ff 05 …` (série) après chaque RideOn. Masques confirmés sur matériel par ORQWA #306 : + 0x1000,
  − 0x100, Y 0x40, Z 0x80, A 0x10, B 0x20, haut 0x2, bas 0x8, gauche 0x1, droite 0x4.
- Bloqué : le palet gauche (et le Ride ≥ 1.3, qui masque même son service) n'envoie ses boutons que si
  l'appli Zwift l'a « déverrouillé » dans les ~24 h. Verrouillé, il répond au RideOn par un défi
  `ff 03 …`. **La réponse exige une clé de Zwift** : BikeControl la conserve dans un paquet privé
  (`prop`, « clé de déverrouillage par famille ») et fait déverrouiller la manette par l'appli Zwift
  elle-même en relayant le défi (émulation d'un pont). Rien de public : non implémenté.
- Écarté volontairement : `ff 04 00` écrit après la poignée de main (BikeControl, repris par
  qdomyos-zwift #4743 et Torqa) maintiendrait déverrouillée une manette déjà déverrouillée, au-delà
  des 24 h. Aucune clé n'est en jeu, mais c'est contourner la fenêtre imposée par Zwift : décision
  laissée aux mainteneurs, non implémentée. Le mode « redémarrage chaque minute » de BikeControl
  (palet gauche réinitialisé) n'est pas décrit publiquement.
- Sources : [BikeControl](https://github.com/OpenBikeControl/bikecontrol) (`zwift_unlock.dart`,
  `constants.dart`, [PR #398](https://github.com/OpenBikeControl/bikecontrol/pull/398),
  [ticket #68](https://github.com/OpenBikeControl/bikecontrol/issues/68),
  [billet](https://bikecontrol.app/blog/zwift-click-v2-with-other-trainer-apps/), licence non
  commerciale) ; [qdomyos-zwift PR #4743](https://github.com/cagnulein/qdomyos-zwift/pull/4743)
  (GPL-3.0) ; [Torqa PR #271](https://github.com/Torqa-Indoor-Cycling/Torqa/pull/271) ;
  [ORQWA PR #306](https://github.com/ORQWA/ORQWA/pull/306) ;
  [MarcelCode/zwift-play-remote, docs/protocol.md](https://github.com/MarcelCode/zwift-play-remote/blob/main/docs/protocol.md) ;
  [michalbychawski/zwift-click-bridge](https://github.com/michalbychawski/zwift-click-bridge).
  Fiabilité : bonne pour le décodage (plusieurs projets indépendants, tests matériels ORQWA) ; les
  durées (veille ~56 s, 24 h) sont des observations d'auteurs, non confirmées par Zwift.

**Zwift Play / Click, mode chiffré « Zap » (anciens firmwares)**

- Implémenté (opt-in, non vérifié sur matériel) : ECDH P-256 éphémère — **aucune clé du
  constructeur**, la manette accepte la clé publique de n'importe quel hôte —, HKDF-SHA-256
  (sel = clé manette ‖ clé hôte, 36 octets : 32 de clé AES-256, 4 de nonce), AES-CCM (nonce 8 octets =
  4 HKDF ‖ compteur tel que reçu, étiquette 4 octets). Le CCM est validé par la RFC 3610 et par un
  vecteur AES-256 produit avec OpenSSL ; l'échange est testé de bout en bout contre une manette simulée.
- Sources : [Makinolo, « Connecting to Zwift Play controllers »](https://www.makinolo.com/blog/2023/10/08/connecting-to-zwift-play-controllers/)
  (pas de licence ; description seulement) ; [ajchellew/zwiftplay](https://github.com/ajchellew/zwiftplay)
  (pas de licence : lu pour les faits, rien repris). Les firmwares actuels n'en ont plus besoin.

**SRAM AXS**

- Fonctionne (lecture seule, sans connexion) : annonces `0x0933` — octets 7–8 tension (mV, LE),
  octet 11 % (batteries AXS ; 0xFF sur pile bouton), octets 2–3 firmware ; données de service 0xFE51 —
  série (u32 LE, octets 2–5). Les palettes ne réveillent pas la radio : les annonces ne disent rien du
  rapport. Source : [tarekrached/esphome-sram-axs](https://github.com/tarekrached/esphome-sram-axs)
  (MIT, `docs/protocol.md`, `facts.yaml`), recoupé par ShannoG/home-assistant-sram-axs.
- Fonctionne (connecté, en clair) : série `d905fe54`, modèle `d905fe56` (1075 = RD-GX-E-B1),
  enregistrement `d905fe58` (version à l'octet 5, correctif d'abord : `06 37 02` = 2.55.6, build ASCII
  en fin), MicroAdjust `d905000a`, compteur de changements (octet 50 de `d9050003`), batterie 0x2A19.
- Fonctionne après appairage : **SRAMBond v1** sur `d905ee52`, entièrement hors ligne : écrire
  `00 01 … 0f`, écrire g^x mod p (g = 5, p = 2¹²⁸ − 713, 16 octets gros-boutistes), lire la clé publique
  du composant, lire 48 octets (nonce ‖ chiffré ‖ étiquette) que l'on déchiffre en AES-128-EAX avec le
  secret partagé → clé du composant, écrire `73`. Puis chaque lecture de `d905000b` (41 octets) se
  déchiffre en `drivetrain_status` : champ 20 plateau, **21 pignon**, 22 trim. Pas de clé du
  constructeur : la clé est générée par le composant et ne sort que pendant l'appairage, qui exige de
  **maintenir le bouton AXS** (possession physique) — la même procédure que l'appli officielle.
  Vérifié octet par octet contre l'exemple publié (§6.2) et 3 trames réelles d'un RD-GX-E-B1.
  Source : [GaborWnuk/sram-axs](https://github.com/GaborWnuk/sram-axs) (`PROTOCOL.md`,
  `SECURITY.md`, MPL-2.0 ; réimplémenté depuis la description, seuls des vecteurs de test repris).
  Fiabilité : un seul auteur, un dérailleur GX Eagle Transmission et une AXS Controller ; les autres
  composants devraient suivre (même plateforme), non vérifié. Hypothèse non vérifiée : pignon 1 = le
  plus facile (sens « up » des actions émises).
- Partiel : sans appairage, `d9050054` notifie `ff` à chaque appui (BikeControl
  [#234](https://github.com/OpenBikeControl/bikecontrol/issues/234)) ; l'identité du bouton est dans une
  lecture chiffrée dont le format n'est pas publié (BikeControl ≥ 6.3 la décode avec du code privé).
  On distingue donc seulement clic simple / double au temps.
- Bloqué : SRAMBond v2 (`d905ee58`–`ee5b`) et reconnexion « greet » (non décrits), écriture de réglages
  (bouton, désactivation du passage des vitesses : non publiés). Le passage des vitesses lui-même passe
  par la radio AIREA, inaccessible. Le rapport est aussi diffusé en ANT+ « Shifting », profil réservé
  aux membres ANT+ ([annonce Shifting 2](https://www.thisisant.com/developer/resources/tech-bulletin/ant-shifting-2-profile-now-available-to-ant-members)).
  Autre lecture possible : [karl-petter/sram-axs-for-ha](https://github.com/karl-petter/sram-axs-for-ha) (batterie 0x180F).

**Shimano Di2**

- Fonctionne : D-Fly (service 0x18EF, caractéristique 0x2AC2 en indications, `[compteur, c1…c4]`,
  0x10 / 0x20 / 0x40, 0xF0 = non affecté) ; l'appareil doit être appairé au niveau Bluetooth.
  Sources : BikeControl, [kelvkk/shimano-di2-media-controls](https://github.com/kelvkk/shimano-di2-media-controls)
  (pas de licence : faits seulement).
- Bloqué : Di2 12 v sans fil (RD-R7150…) en « mode boutons » (sans affecter de canal D-Fly) et
  rapport engagé : service 0x18FF « E-TUBE », authentifié par le code d'accès E-TUBE ; BikeControl 7.3
  ([PR #414](https://github.com/OpenBikeControl/bikecontrol/pull/414)) l'implémente dans son paquet
  privé, rien de public. Les travaux de K. Wakeham sur l'ANT privé Shimano
  ([Hackaday](https://hackaday.com/2019/03/26/reverse-engineering-shimano-bike-electronics/)) ne sont
  plus en ligne ; l'article MakeShift (USENIX WOOT'24) analyse la sécurité de l'ANT, pas un protocole
  utilisable. Le rapport engagé passe aussi par ANT+ « Shifting » (réservé aux membres ANT+).

---

## 11. Simulateur

`SimulatorTransport` expose un trainer FTMS, des pédales CPS (type Assioma), un TICKR, un Zwift
Click et un HEADWIND comme de **vrais serveurs GATT** : les octets passent par les mêmes encodeurs
et décodeurs que le matériel. Ses caractéristiques :

- modèle : ERG asservi sur la puissance *lue par le trainer* (biais d'étalonnage réglable),
  constante de temps de 1,5 s ; vitesse d'équilibre sur route ; FC du premier ordre (30 s) ;
- bruit gaussien déterministe (`seed`), horloge injectable (`ManualClock` pour les tests) ;
- injection de pannes : `dropConnection(clé, durée)`, `silence(clé, durée)`, `denyControl`
  (simule un Edge qui pilote déjà), `pedals.combinedMode = false` (Assioma sur une pédale),
  `pressClick('plus' | 'minus')`.

Les tests d'intégration (`packages/devices/test`) couvrent le flux FTMS complet, la reconnexion,
le capteur muet, la convergence du power match, la cohabitation Edge, l'alerte Assioma, les
transports natifs (pont Tauri factice adossé au simulateur, DirCon avec réponses découpées en
morceaux), Web Bluetooth (faux `navigator.bluetooth`) et ANT+ (FE-C, PWR avec TE/PS, HR).

---

## 12. Références

- Bluetooth SIG — [Specifications](https://www.bluetooth.com/specifications/specs/) : Fitness Machine Service 1.0, Cycling Power Service 1.1, Heart Rate Service 1.0, Cycling Speed and Cadence 1.0, Battery Service, Device Information Service, GATT Specification Supplement ; [Assigned Numbers](https://www.bluetooth.com/specifications/assigned-numbers/).
- ANT Wireless — [ANT Message Protocol and Usage](https://www.thisisant.com/developer/resources/downloads/), ANT+ Device Profiles : Fitness Equipment (FE-C), Bicycle Power, Heart Rate, Controls, Common Data Pages (adoptant ANT+ requis).
- Tacx — *FE-C and Bluetooth Protocol for Tacx Trainers* (FE-C over BLE).
- Wahoo — [Direct Connect](https://support.wahoofitness.com/hc/en-us/articles/360018905100), [KICKR CORE 2](https://support.wahoofitness.com/hc/en-us/articles/28096790110354).
- [Berg0162/DirCon](https://github.com/Berg0162/DirCon), [binarylogic/py-wftnp](https://github.com/binarylogic/py-wftnp), [cagnulein/qdomyos-zwift](https://github.com/cagnulein/qdomyos-zwift).
- [OpenBikeControl/bikecontrol](https://github.com/OpenBikeControl/bikecontrol) (ex-jonasbark/swiftcontrol), [pymmog/virtual-cog](https://github.com/pymmog/virtual-cog), [doudar/SHIFTR](https://github.com/doudar/SHIFTR).
- Adaptateurs expérimentaux (détail et licences au §10.2) : [GaborWnuk/sram-axs](https://github.com/GaborWnuk/sram-axs), [tarekrached/esphome-sram-axs](https://github.com/tarekrached/esphome-sram-axs), [Makinolo — Zwift Play](https://www.makinolo.com/blog/2023/10/08/connecting-to-zwift-play-controllers/), [MarcelCode/zwift-play-remote](https://github.com/MarcelCode/zwift-play-remote), [qdomyos-zwift #4743](https://github.com/cagnulein/qdomyos-zwift/pull/4743).
- Normes de chiffrement utilisées par `optional/aes.ts` : FIPS-197 (AES), RFC 4493 (CMAC), RFC 3610 / NIST SP 800-38C (CCM), Bellare-Rogaway-Wagner « The EAX Mode of Operation ».
- [dvmarinoff/Auuki](https://github.com/dvmarinoff/Flux) (FTMS / FE-C dans le navigateur).
- Favero Assioma, une seule connexion BLE : [forum TrainerRoad](https://www.trainerroad.com/forum/t/favero-assioma-users/24651?page=44) ; mode G+D combiné : [DC Rainmaker](https://dcrainmaker.com/2018/08/bluetooth-compatibility-additional.html).
- Virtual shifting, protocole Zwift propriétaire : [DC Rainmaker](https://dcrainmaker.com/2024/12/zwift-virtual-shifting-compatibility-jetblack-decathlon.html).
- Web Bluetooth — [spécification W3C CG](https://webbluetoothcg.github.io/web-bluetooth/), [Gamepad API](https://w3c.github.io/gamepad/).
