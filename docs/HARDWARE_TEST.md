# Validation du matériel — checklist à la maison

Tout le volet matériel a été développé et vérifié **en simulation uniquement** (simulateur de capteurs
qui parle les vrais octets FTMS / CPS / HRS / D-Fly / HEADWIND, faux pont Tauri, faux Web Bluetooth,
pages ANT+ rejouées). Rien n'a encore été branché sur un vrai appareil. Cette liste sert à valider,
appareil par appareil, ce qui marche chez toi, et à remonter précisément ce qui ne marche pas.

Matériel visé : Wahoo KICKR CORE (ou CORE 2), pédales Favero Assioma DUO, ceinture Wahoo TICKR,
Zwift Click (v1 ou v2), Wahoo KICKR HEADWIND, Shimano 105 Di2 12 vitesses, clé ANT+ USB, Wahoo
Direct Connect (KICKR CORE 2 en WiFi ou Ethernet).

Coche chaque case quand le résultat attendu est observé. Compte environ 2 h pour tout faire,
échauffement du trainer compris. Tu peux t'arrêter après n'importe quelle section.

---

## 0. Avant de commencer

- [ ] **Navigateur** : Chrome ou Edge à jour (Web Bluetooth). Firefox et Safari ne conviennent pas.
- [ ] **App Windows** : installer le MSI d'`apps/desktop` (voir `apps/desktop/README.md`). C'est la
      seule à proposer le Bluetooth natif, l'ANT+ USB et Direct Connect.
- [ ] Fermer **toutes** les autres applis qui parlent aux capteurs : Zwift, MyWhoosh, appli Wahoo,
      appli Favero, Zwift Companion, E-TUBE. Sur le **Garmin Edge**, le trainer doit être appairé en
      simple capteur, jamais en « contrôle » (ou l'Edge éteint pour les premiers essais).
- [ ] Trainer branché, roue libre ; pédales réveillées (faire tourner les manivelles) ; TICKR humidifiée
      et portée.

### Où trouver les journaux (à joindre à tout signalement)

1. **Journal matériel du jeu** : onglet **Capteurs** → **Réglages avancés** → **Diagnostic et journal**
   → bouton **Copier le journal matériel**. Il contient les connexions, états (connecté, muet,
   reconnexion…), alertes, étapes de calibration, appuis de vitesses, avec l'heure à la milliseconde.
   (Dans la console du navigateur — F12 — `__arDeviceLog()` donne la même chose.)
2. **Console** (F12 → Console) : copier les lignes rouges éventuelles.
3. **App Windows** : fichier du dossier `%LOCALAPPDATA%\fr.cparfait.allezrobert\logs\` (Bluetooth
   natif, ANT+, Direct Connect côté Rust).
4. **Tableau Diagnostic** (même section) : capture d'écran, il montre la liaison, l'état, le firmware,
   la batterie et le RSSI de chaque appareil.

### Modèle de signalement

```
Test n° : (ex. 2.3)
Plateforme : Chrome 1xx / Edge / app Windows vX.Y — Windows 11
Appareil : (ex. KICKR CORE, firmware lu dans le tableau Diagnostic)
Ce que j'ai fait :
Ce que j'attendais :
Ce que j'ai observé :
Reproductible : toujours / parfois / une fois
Journal matériel : (coller)
Console / fichier de log Windows : (coller les lignes utiles)
```

---

## 1. Premier passage sans matériel (5 min)

But : vérifier que la version installée est la bonne et que l'interface répond.

- [ ] 1.1 Onglet **Capteurs** : la case **Simulateur** cochée, les tuiles passent au vert
      (KICKR CORE SIM, ASSIOMA SIM, TICKR SIM).
- [ ] 1.2 **Réglages avancés → Calibration** → **Lancer le spin-down** : le texte passe à
      « Accélérez jusqu'à 20–30 km/h », puis « Arrêtez de pédaler », puis « Calibration réussie »
      (une dizaine de secondes, c'est le simulateur).
- [ ] 1.3 Décocher **Simulateur** avant la suite : il s'efface aussi tout seul dès qu'un vrai trainer
      ou de vraies pédales se connectent.

---

## 2. KICKR CORE en Bluetooth FTMS (simulation de pente)

À faire deux fois : **2A dans Chrome/Edge** (Web Bluetooth), **2B dans l'app Windows** (Bluetooth
natif). Dans l'app, si le PC a deux adaptateurs (intégré + dongle), choisir le dongle dans
**Adaptateur Bluetooth**.

- [ ] 2.1 **Capteurs** → Connexion « Bluetooth (navigateur) » ou « Bluetooth (app Windows) » →
      **Home trainer → Associer**. Le KICKR apparaît (nom `KICKR CORE xxxx`) ; après le choix, la tuile
      passe au vert. *Attendu* : Diagnostic → firmware renseigné, état « connecté ».
      *Si le KICKR n'apparaît pas* : firmware trop ancien sans FTMS → mettre à jour dans l'appli Wahoo,
      sinon passer par l'ANT+ FE-C (section 8).
- [ ] 2.2 Journal : pas de ligne `trainer-control-not-permitted`. *Si elle apparaît* : une autre appli
      ou l'Edge pilote le trainer (voir 2.7).
- [ ] 2.3 Rouler 5 min sur le plat (onglet **Rouler** → sortie libre) : la puissance du HUD suit tes
      jambes, la vitesse est cohérente (≈ 30–33 km/h à 200 W pour 75 kg).
- [ ] 2.4 **Pente** : à l'approche d'une côte, la résistance monte progressivement ; en descente elle
      baisse. Difficulté du trainer à 50 % par défaut (**Réglages → Home trainer**) : passer à 100 %,
      la même côte doit être nettement plus dure.
- [ ] 2.5 **Aucun à-coup** : la résistance ne doit pas « cogner » toutes les secondes. *Si oui* :
      noter la pente affichée et joindre le journal.
- [ ] 2.6 **Vitesses virtuelles** (Réglages → Transmission = Vitesses virtuelles) : ↑ / ↓ au clavier,
      le rapport du HUD change (ex. 34×17 → 34×15) et la résistance change aussitôt à vitesse égale.
- [ ] 2.7 **Cohabitation Edge** : allumer l'Edge avec le trainer en simple capteur → rien ne change
      dans le jeu. Puis mettre l'Edge en contrôle du trainer → le jeu affiche l'alerte « Le home
      trainer refuse le contrôle… ». Remettre l'Edge en simple capteur → le jeu reprend la main en
      moins de 10 s (journal : plus d'alerte, consignes à nouveau acceptées).
- [ ] 2.8 **Mode ERG** : Rouler → mode Séance, charger un .zwo simple (ex. 5 min à 150 W puis 200 W).
      La puissance se cale sur la cible en moins de 5 s, quelle que soit la cadence (70 ou 95 tr/min).

## 3. Assioma DUO en Bluetooth CPS

- [ ] 3.1 Dans l'appli Favero : option **Bluetooth « G+D combiné »** activée, puis fermer l'appli
      (une seule connexion Bluetooth à la fois).
- [ ] 3.2 **Capteur de puissance → Associer** : `ASSIOMA…` apparaît, tuile verte, batterie affichée.
- [ ] 3.3 En roulant : la **balance G/D** du HUD est proche de 50/50 et bouge un peu ; le journal ne
      contient pas `assioma-single-side`. *Si l'alerte « la balance n'arrive jamais » apparaît* : le mode
      combiné n'est pas actif (puissance doublée d'une seule pédale).
- [ ] 3.4 Avec le trainer connecté, la puissance du HUD vient des **pédales** (Diagnostic → ERG :
      « source de puissance : pedals »).
- [ ] 3.5 Cadence du HUD ≈ celle de l'Edge (± 2 tr/min).
- [ ] 3.6 **Power match en ERG** (Réglages avancés → ERG · power match, case cochée) : séance à 200 W
      pendant 5 min. *Attendu* : la puissance des pédales converge vers 200 W en 1 à 2 min ; la
      « correction actuelle » se stabilise (souvent entre −5 et +5 %, jamais au-delà de ±15 %). Noter
      la valeur finale : c'est l'écart d'étalonnage trainer / pédales.
- [ ] 3.7 Décocher le power match, refaire 2 min : la puissance pédales reste décalée de cette valeur.

## 4. TICKR en Bluetooth HRS

- [ ] 4.1 **Cardio → Associer** : `TICKR…` apparaît, tuile verte, batterie affichée.
- [ ] 4.2 FC du HUD = FC de l'Edge ou de la montre (± 2 bpm). Le TICKR accepte plusieurs connexions :
      l'Edge et la montre peuvent rester appairés.
- [ ] 4.3 Le fichier FIT exporté en fin de sortie contient la FC (l'ouvrir dans Garmin Connect ou
      intervals.icu).

## 5. Robustesse : reconnexion, capteur muet, redémarrage

- [ ] 5.1 **Capteur muet** : en roulant, retirer la TICKR (ou arrêter de pédaler 10 s avec les
      Assioma, qui se mettent en veille). Après environ 5 s, la puce du HUD affiche **MUET · …** ;
      le journal contient `sensor-silent`. Remettre la TICKR / repédaler : la puce redevient verte sans
      rien toucher.
- [ ] 5.2 **Reconnexion** : débrancher le KICKR du secteur 10 s puis le rebrancher. Le HUD affiche
      **RECONNEXION… · KICKR…**, puis le trainer revient tout seul (essais à 1, 2, 4, 8, 15 puis 30 s) ;
      la pente ou la consigne ERG est **renvoyée** (journal : « renvoi de la dernière consigne »).
- [ ] 5.3 Pendant la coupure du trainer, avec les Assioma : la puissance continue d'arriver (pédales).
      Pédales coupées et trainer présent : le trainer prend le relais (« source de puissance :
      trainer »), puis les pédales reprennent la main à leur retour.
- [ ] 5.4 **Bouton reconnecter** : Diagnostic → un appareil en erreur → « reconnecter » relance tout de
      suite.
- [ ] 5.5 **Redémarrage** : fermer puis rouvrir l'app Windows → trainer, pédales et ceinture se
      reconnectent seuls. Dans Chrome/Edge : recharger la page → ils se reconnectent seuls si le
      navigateur a gardé l'autorisation, sinon il faut recliquer **Associer** (limite de Web Bluetooth,
      à noter dans le signalement avec la version du navigateur).

## 6. Calibration (spin-down)

- [ ] 6.1 Rouler 10 min pour chauffer le trainer.
- [ ] 6.2 Capteurs → Réglages avancés → **Calibration du home trainer**. Deux cas :
  - le texte dit que le trainer **n'annonce pas le spin-down par FTMS** (ou le bouton se termine par
    « non pris en charge ») : c'est possible avec le KICKR CORE, Wahoo réservant parfois la
    calibration à son appli. Faire alors la calibration dans l'appli Wahoo et **noter ce cas** dans
    le signalement (firmware du KICKR) ;
  - sinon : **Lancer le spin-down** → « Accélérez jusqu'à X–Y km/h » → accélérer → « Arrêtez de
    pédaler » → roue libre → « Calibration réussie » (ou « Échec », à signaler avec le journal).
- [ ] 6.3 Avec la clé ANT+ (section 8), refaire 6.2 avec le trainer connecté en **ANT+ FE-C** : les mêmes
      étapes doivent apparaître (pages FE-C 1 et 2), avec la durée du spin-down en cas de réussite.

## 7. Commandes de vitesses

Préalable commun : **Réglages → Transmission = Vitesses virtuelles** (avec un Zwift Cog ou un seul
pignon). Avec **Cassette réelle**, les commandes ne changent rien (c'est voulu) : tu changes de vitesse
sur le vélo et le jeu envoie la pente sans la moduler.

### 7A. Clavier, manette, télécommande HID

- [ ] 7.1 Clavier : ↑ / ↓ = pignon, Page ↑ / Page ↓ = plateau. Le rapport du HUD change.
- [ ] 7.2 **Manette** Xbox ou compatible (Réglages avancés → Manette cochée) : appuyer sur un bouton pour
      qu'elle soit détectée (son nom s'affiche), puis RB / LB et croix ↑ ↓ = pignon, RT / LT = plateau.
- [ ] 7.3 **Télécommande HID** (télécommande Bluetooth de guidon, présentateur…) appairée dans
      Windows : par défaut « piste suivante / précédente » montent / descendent. Sinon, **Apprendre
      « monter »** puis appuyer sur le bouton de la télécommande, idem pour « descendre ». Noter le code
      affiché (ex. `AudioVolumeUp`). *Si le volume de Windows change en même temps* : signaler, et
      apprendre un autre bouton.

### 7B. Zwift Click (v1 / v2), Play, Ride — expérimental

- [ ] 7.4 Réglages avancés → Adaptateurs expérimentaux → cocher **Zwift Click v1 / v2, Play, Ride**.
- [ ] 7.5 **Vitesses → Associer** : la manette apparaît (`Zwift Click`, `Zwift Play`…). Journal :
      « poignée de main RideOn reçue ».
- [ ] 7.6 + / − changent le rapport, un seul cran par appui (pas de double changement).
- [ ] 7.7 Click v2 : si l'alerte « Manette Zwift verrouillée » apparaît (palet gauche, Ride v2),
      suivre la procédure affichée (appli Zwift 10 à 30 s, puis reconnecter). Le palet droit doit
      marcher sans cela. Laisser 2 min sans appuyer : la manette ne doit pas se mettre en veille.
- [ ] 7.8 Noter le modèle et le firmware (Zwift Companion) dans le signalement, même si tout marche.

### 7C. Shimano 105 Di2 12 v (boutons D-Fly) — expérimental, prioritaire

- [ ] 7.9 Dans **E-TUBE** (téléphone) : affecter les boutons du haut des cocottes aux canaux **D-Fly** :
      canal 1 = bouton droit (monter), canal 2 = bouton gauche (descendre). Fermer E-TUBE ensuite.
- [ ] 7.10 Réglages avancés → cocher **Shimano Di2 (boutons D-Fly)**.
- [ ] 7.11 **Vitesses → Associer**. Dans Chrome/Edge, si le Di2 n'apparaît pas dans le sélecteur, cocher
      **afficher tous les appareils** (même section) et réessayer ; le Di2 se présente souvent sous le
      nom du dérailleur (ex. `RD-R7150…`). Windows peut demander une **confirmation d'appairage** :
      accepter (les boutons D-Fly exigent un appareil appairé).
- [ ] 7.12 Bouton D-Fly droit → rapport plus dur, gauche → plus facile ; un cran par appui ; appui long
      = un cran aussi. Journal : `vitesse up (…)` / `vitesse down (…)`.
- [ ] 7.13 **Premier appui après connexion** : vérifier s'il est pris en compte. Le décodeur ignore la
      toute première trame reçue (elle sert de référence) : si le premier appui est perdu à chaque
      connexion, le signaler.
- [ ] 7.14 Les vraies vitesses du Di2 (leviers) doivent continuer à fonctionner normalement : le jeu ne
      fait que lire les boutons D-Fly. Le rapport réellement engagé n'est **pas** lisible (protocole
      E-TUBE non public).

## 8. ANT+ USB (app Windows)

- [ ] 8.1 Clé ANT+ branchée, pilote **WinUSB** installé avec Zadig (sinon message « vérifiez que la clé
      utilise le pilote WinUSB »). Garmin Express fermé.
- [ ] 8.2 Clé réseau ANT+ (fournie par thisisant.com, jamais dans le dépôt) : la saisir dans
      Réglages avancés → **ANT+ USB et Direct Connect**, puis relancer l'app. (Alternatives : variable
      `ANT_PLUS_NETWORK_KEY`, ou fichier `ant-plus-network-key.txt` dans
      `%APPDATA%\fr.cparfait.allezrobert\`.) Sans clé, le journal le dit clairement.
- [ ] 8.3 Connexion « ANT+ (clé USB) » → **Home trainer → Associer** (recherche de 5 s) : le KICKR est
      trouvé en **FE-C** ; refaire 2.3, 2.4, 2.8 et 6.3.
- [ ] 8.4 **Capteur de puissance → Associer** en ANT+ : les Assioma en **ANT+ PWR**. En plus de la
      balance, le **TE / PS** (efficacité du couple, régularité) doit apparaître dans le FIT exporté
      (c'est le seul chemin pour ces valeurs).
- [ ] 8.5 **Cardio → Associer** en ANT+ : la TICKR en ANT+ HR, FC identique à l'Edge.
- [ ] 8.6 Limite connue : la recherche s'appaire au **premier** capteur entendu de chaque type. Si un
      voisin roule avec un capteur ANT+ à côté, noter si c'est le bon qui a été pris.

## 9. Wahoo Direct Connect (KICKR CORE 2, app Windows)

- [ ] 9.1 KICKR CORE 2 relié au WiFi (ou câble Ethernet) via l'appli Wahoo, sur le même réseau que le PC.
- [ ] 9.2 Connexion « Wahoo Direct Connect » → **Home trainer → Associer** : le trainer est trouvé par
      mDNS (`_wahoo-fitness-tnp._tcp`). *Sinon* : Réglages avancés → saisir son adresse IP (visible
      dans la box ou l'appli Wahoo) → **Ajouter**, puis Associer.
- [ ] 9.3 Refaire 2.3, 2.4, 2.8 et 5.2 (couper le WiFi du trainer : reconnexion).
- [ ] 9.4 Une seule appli à la fois en Direct Connect : si Zwift est connecté en WiFi, la connexion du
      jeu échoue (ou éjecte Zwift). Noter le comportement observé.

## 10. KICKR HEADWIND — expérimental

- [ ] 10.1 Réglages avancés → cocher **Wahoo KICKR HEADWIND**, puis **Ventilateur → Associer**.
- [ ] 10.2 Section **Ventilateur** : boutons **Essai 0 % / 50 % / 100 %** → le ventilateur suit. Les
      valeurs sont envoyées par pas de 25 % (seules valeurs vérifiées par la communauté).
- [ ] 10.3 **Vitesse** : en roulant, le souffle augmente avec la vitesse du jeu (100 % à 48 km/h,
      réglable) et s'arrête à l'arrêt.
- [ ] 10.4 **FC** : souffle nul sous 50 % de la FC max, maximal à 90 % (FC max réglable).
- [ ] 10.5 **Pente** : 30 % sur le plat, plus fort en côte, suit la vitesse en descente.
- [ ] 10.6 **Manuel** : curseur 0–100 %. L'appli compagnon (sortie de groupe) passe aussi en manuel.
- [ ] 10.7 **Arrêt** : le ventilateur s'arrête. Noter si le HEADWIND garde ensuite son propre mode
      (boutons physiques) sans conflit.
- [ ] 10.8 Le ventilateur ne doit pas changer de vitesse plus d'une fois toutes les 2 s.

## 11. Fin de sortie

- [ ] 11.1 Exporter le FIT (fin de sortie) et l'ouvrir dans Garmin Connect ou intervals.icu :
      puissance, cadence, FC, balance, (TE / PS si ANT+), distance cohérents.
- [ ] 11.2 Copier le journal matériel complet et le joindre, même si tout s'est bien passé : il
      servira de référence (firmwares, délais réels de connexion).

---

## Ce qui ne pourra pas être validé ici

- **Rapport réellement engagé du Di2** (et « mode boutons » sans D-Fly) : protocole E-TUBE non public.
- **Zwift Click v2 gauche / Ride v2 sans l'appli Zwift** : déverrouillage réservé à Zwift.
- **Appli compagnon en sortie solo** : elle ne rejoint aujourd'hui que les sorties de groupe et les
  courses (salle sur le serveur).
