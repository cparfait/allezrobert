# Feuille de route — Allez Robert !

> État au 22 octobre 2026 (v0.1.0) : les cases cochées sont faites et vérifiées **en simulation** ; aucune n'a encore été testée avec le vrai matériel. Détails dans `docs/releases/v0.1.0.md`.

Chaque jalon n'est déclaré terminé qu'après vérification : tests (protocoles octet par octet), test de charge réseau quand il y a du réseau, captures d'écran examinées, courte vidéo de démo, notes de version (`docs/releases/`).

## Jalon 0 — Socle

- [x] Monorepo pnpm, TypeScript strict, Vitest
- [ ] CI GitHub Actions (types, tests, build, images Docker) — fichier écrit, jamais exécuté sur GitHub
- [x] `packages/shared` : contrats capteurs, profils, itinéraires, réseau, pont natif
- [x] Simulateur de capteurs (trainer + pédales + FC + commandes) pour coder sans rouler
- [x] Scène Three.js minimale (WebGPU, repli WebGL2)
- [ ] Fichiers de déploiement de test (Docker Compose, Caddy) et `docs/DEPLOY.md`

## Jalon 1 — Premier coup de pédale

- [x] Boucle d'environ 10 km en vallée de Chevreuse : relief IGN, routes OSM, tirée des sorties Garmin
- [ ] KICKR CORE / CORE 2 en FTMS (simulation de pente), Assioma en CPS, TICKR en HRS — Web Bluetooth et Tauri
- [x] Physique de Martin, vitesse calculée par le jeu, pente envoyée au trainer (difficulté 50 %)
- [x] HUD complet : puissance (3 s), FC, cadence, vitesse, distance, temps, pente, profil, mini-carte, balance G/D, rapport
- [x] Export FIT (balance G/D) validé par le SDK Garmin — TE / PS : seulement via ANT+ PWR (le Bluetooth CPS ne les transmet pas)

## Jalon 2 — Matériel complet

- [ ] Vitesses virtuelles (24 rapports, Cog ou cassette), Di2 105 12 v en priorité, Click v1/v2, Play, Ride, HID, clavier, manette, compagnon
- [ ] KICKR HEADWIND asservi (vitesse, FC, pente, manuel)
- [ ] ANT+ USB (FE-C, PWR, HR), Wahoo Direct Connect (mDNS + TCP)
- [ ] Power match en ERG, calibration (spindown), reconnexion, capteur muet

## Jalon 3 — Beauté

- [ ] `docs/ART_DIRECTION.md` validé
- [x] Ciel physique, atmosphère, ombres en cascade, AO, bloom, TAA, étalonnage par saison et par heure (LUT dédiées : plus tard)
- [x] Saisons, jour/nuit, météo (pluie, brouillard, vent qui pèse sur la physique)
- [ ] Végétation instanciée animée par le vent, villages en meulière, toits de tuiles, eau
- [ ] Avatars riggés, pédalage procédural, cosmétiques ; caméras poursuite, cockpit, drone, TV, photo
- [ ] Son : ambiances, roulement, roue libre, souffle, public
- [x] Corridor complet Saclay → Chevreuse → Rambouillet, streaming par tuiles, préréglages bas → ultra

## Jalon 4 — Multijoueur

- [ ] Salles privées sur invitation, serveur autoritaire 10 Hz, drafting réseau, groupe soudé
- [ ] Comptes Google, Discord, lien magique ; profils
- [ ] Voix LiveKit, repli Discord ; chat texte ; « Ride On »
- [ ] Appli compagnon PWA ; mode invité sans matériel
- [ ] Test de charge à 20 coureurs

## Jalon 5 — Jeu

- [x] Modes solo : libre, ERG (.zwo / .erg / .mrc), test FTP, segments KOM / sprint, fantôme
- [ ] Modes groupe et course (dépendent du jalon 4)
- [x] Coureurs IA (relais, attaques, profils)
- [x] Progression : XP, niveaux, garage, déblocages cosmétiques
- [ ] Export Strava (option « ne pas envoyer » si l'Edge enregistre) et intervals.icu

## Jalon 6 — Mise en scène

- [x] Séquences HyperFrames en jeu : intro et compte à rebours, KOM / sprint, arrivée et podium, habillage TV
- [ ] Vidéo résumé MP4 rendue sur le VPS
- [x] Onboarding guidé avec voix off FR / EN et sous-titres, rejouable

## Idées NCT Ride (ajoutées le 22/10/2026)

Idées seulement : ni nom, ni asset, ni code, ni physique de NCT Ride (la vitesse reste calculée par le jeu, modèle de Martin).

| # | Idée | Jalon | État |
| --- | --- | --- | --- |
| 1 | Équipiers IA pour rouler seul : allure à % de FTP réglable en sortie, relais, équipiers lâchés en côte et attendus, ordre « ralentissez », barre d'aspiration, aspiration partielle si décalé | 5, avancé juste après le jalon 1 | fait en solo ([ / ] allure, R ralentir, attente des lâchés, barre d'aspiration) ; demi-tour : à faire |
| 2 | IA avec réserve W′bal ; profils échappée / sprinteur / suiveur ; niveaux 80 / 100 / 115 % FTP | 5 | fait (W′bal, profils, niveau 80 / 100 / 115 % au menu) |
| 3 | Monde vivant : trafic qui double en s'écartant, piétons, déclencheurs à une distance de route | 3 | fait (voitures, camionnettes, tracteur, piétons) ; trains : à faire |
| 4 | Son positionné depuis OSM (église → cloches, prairie → vaches, eau…) | 3 | fait |
| 5 | Caméra « GoPro » sur la poitrine | 3 | fait |
| 6 | Poussière sur les chemins, roulement selon le revêtement | 3 | à faire |
| 7 | Foule avec pancartes et photo automatique au sommet des segments, réutilisée dans la vidéo résumé | 5 | fait (foule animée, photo au sommet, en fond de l'image de partage) ; pancartes et vidéo résumé : à faire |
| 8 | Image de fin de sortie à partager | 5 | fait |
| 9 | Mondes génériques (emprise + itinéraires via tools/terrain) | 3 | pipeline générique fait ; montée célèbre à tester |
| 10 | Contrôle visuel automatique du monde généré | 3 | fait (?worldcheck=1, toits inversés corrigés à la construction) ; détection automatique d'anomalies : à faire |

## Plus tard

- Apps natives Mac et iPad (Mac et compte Apple Developer requis)
- Affichage 32:9 (5120 × 1440) optimisé
- Mondes supplémentaires
