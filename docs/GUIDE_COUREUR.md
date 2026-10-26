# Guide du coureur — Allez Robert !

## 1. Installer

- **Windows (recommandé)** : installeur de l'app (`Allez Robert !_x.y.z_x64_fr-FR.msi`). Bluetooth natif avec choix de l'adaptateur (intégré ou dongle), Wahoo Direct Connect et clé ANT+ en option.
- **Navigateur** : Chrome ou Edge (Windows, Mac), à l'adresse de test `https://allezrobert.cparfait.ovh`. Bluetooth via le navigateur ; pas d'ANT+ ni de Direct Connect.
- **Téléphone / tablette** : appli compagnon (PWA, « Ajouter à l'écran d'accueil ») pour la carte, le chat, les vitesses, la caméra et le ventilateur.

## 2. Premier lancement

Le tutoriel (voix off, coupable) règle : la langue, ton profil (poids, taille, FTP — ou le test FTP), ton avatar, tes capteurs, tes vitesses. Il est rejouable depuis le menu (« Tutoriel »).

## 3. Brancher son matériel

| Appareil | Comment | À savoir |
| --- | --- | --- |
| Wahoo KICKR CORE / CORE 2 | « + Home trainer », pédaler pour le réveiller | Le jeu envoie la pente (FTMS). Un seul pilote : jamais le Garmin en même temps. |
| Favero Assioma Duo | « + Capteur de puissance » | **Une seule connexion Bluetooth** : ferme Zwift, MyWhoosh, l'appli Favero. Active le mode **G + D combinés** dans l'appli Favero, sinon une seule pédale est lue et doublée. TE / PS : uniquement en ANT+. |
| Wahoo TICKR | « + Cardio » | Jusqu'à 3 connexions : la montre peut rester appairée. |
| Zwift Cog + Click, Di2 (D-Fly), boutons Bluetooth | « + Vitesses » | Adaptateurs expérimentaux, désactivables ; le clavier et la manette marchent toujours. |
| KICKR HEADWIND | « + Ventilateur » | Vent asservi à la vitesse du jeu (48 km/h = 100 %). |

**Garmin Edge 1050** : garde Assioma et TICKR en **ANT+** vers l'Edge et en **Bluetooth** vers le jeu ; ne laisse jamais l'Edge piloter le home trainer pendant une sortie. Option « Ne pas envoyer à Strava » si l'Edge enregistre déjà (évite les doublons).

**Sans matériel** : le simulateur prend le relais (touches + / − pour la puissance), ou coche « Invité sans matériel » (Z / S, Maj pour attaquer ; hors classements).

## 4. Rouler

| Touche | Action |
| --- | --- |
| ↑ / ↓ | Vitesse suivante / précédente (24 rapports virtuels) |
| PageUp / PageDown | Grand / petit plateau |
| ← / → | Se décaler sur la chaussée (prendre la roue, doubler) ; en monde ouvert, à l'approche d'un carrefour : choisir la sortie |
| U | Demi-tour (en solo ; en monde ouvert, nouveau chemin) |
| X (maintenue) | Regarder derrière soi |
| C | Caméra : poursuite, cockpit, drone, réalisation TV, photo (souris pour orbiter) |
| Espace / Échap | Pause (reprendre, terminer la sortie) |
| H | Masquer l'interface |
| M | Couper le son (la musique a sa touche B) |
| P | Photo (image PNG de la scène) |
| T / V | Chat texte / micro (sorties à plusieurs) |
| [ / ] | Allure : des équipiers IA (solo) ou annoncée au groupe (organisateur d'une sortie de groupe) |
| R | « Ralentissez ! » aux équipiers IA (solo) |
| K | « Attendez-moi ! » : les équipiers devant toi lèvent le pied pendant 90 s (solo) |
| F | Forme du peloton d'équipiers : auto, file indienne, deux files tournantes, bordure (solo) |
| G | Regroupement (sortie de groupe : organisateur ou meneur) |

Le **HUD** affiche la puissance moyenne 3 s (couleur de zone), FC, cadence, vitesse, pente, temps, distance, D+, NP, aspiration, rapport, balance G/D, le profil de l'itinéraire et la mini-carte.

**Difficulté du home trainer** (50 % par défaut) : la pente ressentie est atténuée (et encore plus en descente), la vitesse du jeu reste réaliste.

Le panneau **À proximité** liste jusqu'à quatre coureurs devant et quatre derrière : écart en secondes (à ta vitesse) et en mètres, W/kg. Le bouton en haut du panneau bascule entre les coureurs **réels** (joueurs en ligne, par défaut en groupe) et **tous** (coureurs IA compris).

**Fin de sortie** (Échap → Terminer) : distance, temps, D+, vitesses, cardio, puissance moyenne et normalisée, TSS · IF, calories, comparaison avec ta dernière sortie sur le même itinéraire ; courbe de puissance avec tes records d'avant en pointillés (records battus listés à gauche), profil · puissance · cardio (survol pour lire les valeurs), temps par zone, segments, et en groupe le temps dans les roues, l'énergie économisée et les relais pris. Boutons : carte de sortie (image), `.fit` (Strava), `.gpx`, **Reprendre** (en solo), nouvelle sortie, quitter.

## 5. Modes

- **Sortie libre** avec coureurs IA (nombre réglable), aspiration réaliste.
- **Entraînement** : charge un fichier `.zwo`, `.erg` ou `.mrc` ; le home trainer passe en ERG, corrigé par les pédales (power match).
- **Test FTP** : rampe (+20 W / min) ; la FTP estimée est enregistrée dans ton profil.
- **Fantôme** : ton meilleur tour sur la boucle roule à côté de toi (silhouette bleutée).
- **Sortie de groupe** (serveur requis) : crée la sortie, donne le **code d'invitation** aux amis
  (champ « Code d'invitation » du menu). Le groupe est soudé par défaut. Panneau « Sortie de
  groupe » à gauche : **allure annoncée** (W/kg ; ta propre allure s'affiche en vert dans la
  bande, orange au-dessus, bleu en dessous), **meneur** ★ (l'organisateur par défaut) et l'écart
  avec lui. L'organisateur règle l'allure avec **[ / ]** (ou − / + / Libre) ; l'organisateur ou
  le meneur lance un **regroupement** avec **G** : la tête temporise, la queue est aidée,
  jusqu'à ce que le groupe soit reformé. Si le groupe se scinde, une alerte le signale.
- **Course** (serveur requis) : salle d'attente avec le code d'invitation et les coureurs ;
  l'organisateur choisit le nombre de **tours** dans le menu et donne le départ ; compte à
  rebours de 10 s sur la grille, puis panneau « Course » : place, distance restante, écarts
  devant / derrière, classement en direct, **primes** au sommet des KOM et sur les sprints
  (5 / 3 / 1 points aux trois premiers), heure limite (10 min après le premier). Les **IA**
  complètent le peloton (niveau réglé dans « Coureurs IA ») : chaque ami qui arrive en salle
  d'attente prend la place d'une IA. À l'arrivée : **résultats** (temps, écarts, points, hors
  délai, abandons) et podium. Quitter une course en cours (Échap → « Abandonner la course »)
  = abandon. Un invité ou un coureur arrivé après le départ roule hors classement.
  Contrôle de puissance : une puissance invraisemblable (au-delà des records humains) est
  plafonnée et, si elle dure, met le coureur hors course : vérifie ton capteur si un
  avertissement apparaît.
- **Voix** : chat vocal intégré (V pour le micro). S'il est indisponible, la pastille de la voix
  propose de **rejoindre le salon Discord** des sorties (s'il est configuré).

## 6. Amis

Onglet **Amis** du menu (compte requis : un invité sans compte roule seul ou avec un code d'invitation).

- **Mon code ami** : 8 caractères faciles à dicter (ex. `K7QM-2XRA`, sans 0/O ni 1/I/L). « Copier », « Copier le lien » (`…/?ami=K7QM2XRA` : ouvre le jeu sur l'onglet Amis avec la demande prête à envoyer, même après la connexion) et « Nouveau code » (l'ancien code et les liens déjà partagés ne marchent plus).
- **Ajouter** : saisis le code d'un ami (minuscules, espaces et tiret acceptés) ; il reçoit une demande qu'il **accepte** ou **refuse** (l'autre n'est pas prévenu d'un refus). Si vous vous êtes demandés mutuellement, l'amitié est faite tout de suite. Tu peux annuler une demande envoyée et **retirer** un ami (×).
- **Présence** : chaque ami apparaît *hors ligne*, *en ligne* (menu ouvert) ou *en train de rouler* (itinéraire, mode, nombre de coureurs). La liste se met à jour toute seule toutes les 25 s environ.
- **Rejoindre** : un clic sur « Rejoindre » à côté d'un ami qui roule, sans code : le jeu prend son itinéraire et son mode. Le serveur ne donne le code de la sortie qu'à ses amis.
- **Inviter** : coche des amis puis « Partir et inviter » (une sortie de groupe est créée sur l'itinéraire choisi), ou, en cours de sortie de groupe, **Pause** → « Inviter des amis dans cette sortie ». L'ami voit un bandeau « X t'invite à rouler sur … — Rejoindre / Ignorer » dans son menu ; l'invitation tombe au bout de 30 min ou à la fin de la sortie.
- **Pastille** rouge sur l'onglet : demandes reçues + invitations en attente.
- **Classements entre amis** : temps des segments KOM / sprint de l'itinéraire choisi, entre toi et tes amis (ta ligne en jaune) ; « Records » sur un ami affiche ses meilleurs temps sur cet itinéraire.
- **Données** : l'export du compte (RGPD) contient ton code et tes relations ; supprimer le compte efface code, amitiés, demandes et invitations.

## 7. Après la sortie

Résumé (distance, temps, D+, puissance moyenne, NP, kcal, segments), XP et niveau, et **fichier FIT** (balance G/D, positions GPS) à importer dans Garmin Connect, Strava ou intervals.icu.

## 8. Réglages graphiques

Bas / moyen / haut / ultra (ultra calibré pour une RTX 4090), saison, heure, nuages, pluie, brouillard. Paramètres d'URL utiles : `?quality=ultra`, `?season=winter`, `?hour=18`.

## 8. Son

Tout le son est synthétisé par le jeu : le vent et le roulement suivent la vitesse et le revêtement (enrobé lisse ou rugueux, pavés, gravier, chaussée mouillée), le moyeu cliquette en roue libre, le dérailleur claque au changement de vitesse, les oiseaux chantent selon la saison et l'heure (pas l'hiver, chœur à l'aube, grillons les soirs d'été, hulotte la nuit en forêt), le public encourage dans les 350 derniers mètres des côtes et sur les sprints — plus fort quand vous souffrez — et les voitures passent de gauche à droite avec l'effet Doppler. Au-delà d'environ 60 % de la FTP, on entend son souffle (rythme calé sur la FC).

Réglages → **Son** (et menu pause) : volume général et par catégorie (ambiance, vélo, souffle, public, trafic), souffle désactivable. En pause, seuls les bruits d'ambiance restent, atténués.
