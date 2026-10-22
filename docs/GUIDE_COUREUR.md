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
| U | Monde ouvert : demi-tour |
| C | Caméra : poursuite, cockpit, drone, réalisation TV, photo (souris pour orbiter) |
| Espace / Échap | Pause (reprendre, terminer la sortie) |
| H | Masquer l'interface |
| M | Couper le son |
| P | Photo (image PNG de la scène) |

Le **HUD** affiche la puissance moyenne 3 s (couleur de zone), FC, cadence, vitesse, pente, temps, distance, D+, NP, aspiration, rapport, balance G/D, le profil de l'itinéraire et la mini-carte.

**Difficulté du home trainer** (50 % par défaut) : la pente ressentie est atténuée (et encore plus en descente), la vitesse du jeu reste réaliste.

Le panneau **À proximité** liste jusqu'à quatre coureurs devant et quatre derrière : écart en secondes (à ta vitesse) et en mètres, W/kg. Le bouton en haut du panneau bascule entre les coureurs **réels** (joueurs en ligne, par défaut en groupe) et **tous** (coureurs IA compris).

**Fin de sortie** (Échap → Terminer) : distance, temps, D+, vitesses, cardio, puissance moyenne et normalisée, TSS · IF, calories, comparaison avec ta dernière sortie sur le même itinéraire ; courbe de puissance avec tes records d'avant en pointillés (records battus listés à gauche), profil · puissance · cardio (survol pour lire les valeurs), temps par zone, segments, et en groupe le temps dans les roues, l'énergie économisée et les relais pris. Boutons : carte de sortie (image), `.fit` (Strava), `.gpx`, **Reprendre** (en solo), nouvelle sortie, quitter.

## 5. Modes

- **Sortie libre** avec coureurs IA (nombre réglable), aspiration réaliste.
- **Entraînement** : charge un fichier `.zwo`, `.erg` ou `.mrc` ; le home trainer passe en ERG, corrigé par les pédales (power match).
- **Test FTP** : rampe (+20 W / min) ; la FTP estimée est enregistrée dans ton profil.
- **Fantôme** : ton meilleur tour sur la boucle roule à côté de toi (silhouette bleutée).
- **Sortie de groupe / course** : sur invitation, avec chat vocal (serveur requis).

## 6. Après la sortie

Résumé (distance, temps, D+, puissance moyenne, NP, kcal, segments), XP et niveau, et **fichier FIT** (balance G/D, positions GPS) à importer dans Garmin Connect, Strava ou intervals.icu.

## 7. Réglages graphiques

Bas / moyen / haut / ultra (ultra calibré pour une RTX 4090), saison, heure, nuages, pluie, brouillard. Paramètres d'URL utiles : `?quality=ultra`, `?season=winter`, `?hour=18`.
