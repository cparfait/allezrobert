# Ce qu'il reste à faire

État au 22 octobre 2026, branche `claude/optimistic-einstein-hqh9c5`. Point d'entrée pour
reprendre : `docs/REPRISE.md` (commandes, outils) puis ce fichier. Détail des jalons :
`docs/ROADMAP.md`.

## 1. Vérifier le travail fusionné mais interrompu

Les chantiers « Monde » et « Jeu » ont été arrêtés en cours de route puis fusionnés tels quels.
Ils compilent et les 467 tests passent, une sortie démarre sans erreur, mais **rien n'a été relu
ni vérifié à l'image** ; les derniers commits « wip » sont du travail non terminé.

- [ ] Monde (`apps/client/src/world/`, `tools/terrain/`) : vérifier à l'image l'eau animée, le
      vent orienté sur la végétation, la meulière procédurale, cheminées et faîtages, les tuiles
      reconstruites depuis les itinéraires (sans Garmin).
- [ ] Trains : les modules (voies OSM, horaires) existent ; brancher l'affichage d'un train qui
      passe et vérifier.
- [ ] Poussière sur les chemins (`world/dust.ts`, non terminé) : terminer, brancher, vérifier.
- [ ] Détection automatique d'anomalies du monde (`?worldcheck=1`) : à faire.
- [ ] `docs/ART_DIRECTION.md` : mise à jour et « points à valider » non faites.
- [ ] Modes groupe et course : serveur et interface commités ; tester à plusieurs pages
      (départ groupé, classement, arrivée, podium, primes, abandon).
- [ ] Demi-tour des équipiers IA, pancartes du public, repli Discord : commités ; à vérifier
      en jeu.
- [x] Vidéo résumé MP4 : rendu FFmpeg (repli, testé : 18 s avec 2 photos), file, écran de fin et
      photos du sommet (scène HyperFrames « Au sommet » non rendue faute de Chromium ici) ;
      documenté dans `docs/DEPLOY.md` § 12 ter.
- [ ] Mettre à jour `docs/ROADMAP.md`, `docs/GUIDE_COUREUR.md`, `ASSETS_LICENSES.md` pour ces
      deux chantiers.

## 2. À faire par toi (impossible dans l'environnement cloud)

- [ ] **Matériel réel** : suivre `docs/HARDWARE_TEST.md` (KICKR CORE, Assioma, TICKR, Click,
      HEADWIND, Di2 105, clé ANT+, Direct Connect), envoyer les journaux en cas de problème.
- [ ] **App Windows** (`apps/desktop`, Tauri / Rust) : la compiler sous Windows.
- [ ] **Performances** : `avatar-test.html?bench&quality=low|medium|high|ultra` sur ta carte
      graphique (comparer avec `&avatar=classic`).
- [ ] **Son** : écouter une sortie et `apps/client/audio-bench.html` (tout est synthétisé, jamais
      écouté).
- [ ] **Direction artistique** : valider `docs/ART_DIRECTION.md`.
- [ ] **Comptes et services** : identifiants OAuth (Google, Discord, Strava), LiveKit, lien
      Discord de repli, ffmpeg sur le VPS.
- [ ] **CI GitHub Actions** (`.github/workflows/ci.yml`) : jamais exécutée sur GitHub.
- [ ] **Déploiement de test** (`deploy/`, `docs/DEPLOY.md`) : à essayer sur le VPS.

## 3. Reste de la feuille de route

- [x] Fantôme d'un ami (`PUT /api/ghost/:routeId`, `GET /api/friends/ghost`) : à voir en jeu à deux comptes.
- [ ] Rapport réellement engagé du Di2 (protocole E-TUBE non public) ; appli compagnon en
      sortie solo.
- [ ] Spin-down : confirmer que le KICKR CORE l'annonce en FTMS ; confirmer la disposition des
      pages FE-C de calibration sur la spécification ANT+.
- [ ] Son : coureurs IA et trains muets ; FC max fixée à 190 (pas de réglage) ; pavés et gravier
      rarement entendus (itinéraires goudronnés).
- [ ] Danseuse : retravailler la pose (buste au-dessus du cintre, vélo qui se balance, bras
      tendus) et la déclencher en sortie quand le coureur se met debout : position assis / debout
      des pédales à capteur qui la transmettent (dynamique de pédalage ANT+ « Cycling Dynamics »,
      Garmin Rally / Vector ; à vérifier pour les Assioma), sinon cadence basse et forte puissance.
- [ ] Tenues : ajouter des gants (mitaines et gants longs) et des tenues à manches longues
      (maillot, veste, collant), choisis dans l'éditeur et variés dans le peloton.
- [ ] Avatars : expression `tongueOut` absente ; visages féminins encore un peu androgynes ;
      moustache unie ; ressemblance photo faible pour le cou, les oreilles, le pli de paupière.
- [ ] Tutoriel (`apps/client/src/onboarding/`, `RideTutorial` en sortie) : l'illustrer et
      l'animer (images, schémas des commandes, petites animations à chaque étape) au lieu
      d'étapes en texte seul.
- [ ] Idées du tableau de `docs/ROADMAP.md` encore ouvertes : photos du sommet dans la vidéo
      résumé, LUT d'étalonnage dédiées.
- [ ] Le script `pnpm lint` (`pnpm -r --if-present lint`) ne vérifie rien : aucun paquet n'a de
      script lint ; en ajouter un (ESLint) si on veut un vrai contrôle.
