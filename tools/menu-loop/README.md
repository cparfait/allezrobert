# Film d'accueil du menu (tools/menu-loop)

Le fond du menu joue une boucle de 60 s par saison, tournée dans le jeu lui-même (mode
« cinématique » du client de dev, `apps/client/src/ui/cinematic.ts`, plan de tournage dans
`cinematicPlan.ts`) : un groupe de 10 coureurs sur la boucle de Chevreuse, six plans, raccord
de boucle invisible (les 1,5 dernières secondes fondues dans les premières).

Sorties, dans `apps/client/public/menu/` :

| Fichier | Contenu | Dans git |
| --- | --- | --- |
| `loop-<saison>.mp4` | H.264 High, 1920×1080, 30 i/s, yuv420p BT.709, CRF 19 plafonné à 3 800 kbit/s, image clé toutes les 2 s, faststart, ≤ 30 Mo | non (`.gitignore`) |
| `loop-<saison>.webm` | VP9 profil 0, CRF 40 (`-b:v 0`), deux passes, ≈35 Mo, repli si le MP4 échoue | non |
| `still-<saison>.jpg` | première image de la vidéo, 1920×1080, ≈200–300 ko : affichée tout de suite, et seule si la vidéo manque | oui |

Les vidéos sont trop lourdes pour le dépôt public : on les régénère ici, puis on les copie sur
le serveur (docs/DEPLOY.md § 12 bis). Sans elles, le menu affiche l'image fixe (`createMenuVideo`
dans `apps/client/src/main.ts`).

## Régénérer

```bash
pnpm --filter @allezrobert/menu-loop capture                     # 4 saisons (≈1 h 30 sur RTX 4090)
pnpm --filter @allezrobert/menu-loop capture -- --season autumn  # une saison
pnpm --filter @allezrobert/menu-loop encode -- --season autumn   # réencoder des images déjà capturées
```

Puis augmenter `MENU_MEDIA_VERSION` dans `apps/client/src/main.ts` (cache des navigateurs) et
copier les vidéos sur le serveur.

Le script lance son propre serveur de dev (port 5199, sans rechargement à chaud) et un Chrome
sans fenêtre (WebGPU, profil dédié `out/menu-loop/chrome-profile`, pas de ralentissement des pages
en arrière-plan) ; les saisons s'enchaînent dans le même onglet. Pour chaque saison il attend le
manifeste écrit par la page, encode, écrit l'image fixe et extrait des images de contrôle (une
par plan et les deux côtés du raccord) dans `out/menu-loop/check-<saison>/`.

Options : `--season spring,winter`, `--url http://localhost:5173` (serveur existant),
`--browser open|manual` (navigateur par défaut / adresse affichée seulement), `--headed`
(fenêtre de Chrome visible), `--ss 2`, `--sub 8`, `--crf 19`, `--vp9-crf 40`,
`--mp4-max-kbps 3800` (plafond du MP4, 0 = CRF pur), `--no-webm`.
`CHROME_PATH` désigne un autre navigateur Chromium.

## Rendu

- Préréglage graphique `ultra`, 1920×1080, 30 i/s, 61,5 s (1 845 images) par saison.
- Suréchantillonnage `ss=2` : rendu à 3840×2160, réduit à 1920×1080 dans la page.
- Anticrénelage temporel convergé : `sub=8` rendus de plus par image, scène immobile (48 à la
  première image d'un plan, où l'historique repart de zéro).
- Images PNG sans perte (`POST /__save` du serveur de dev) dans `out/menu-loop/<saison>/`
  (≈3 Mo l'image, ≈6 Go par saison ; `out/` n'est pas versionné).
- Paysage figé avant la première image (`apps/client/src/ui/cinematicStream.ts`) : tuiles
  chargées une fois pour tout le trajet (orthophotos comprises, plus aucune requête réseau),
  niveau de détail des arbres calculé sur tout le trajet de la caméra, herbe posée sur une
  grille fixe du monde, coureurs toujours au niveau de détail maximal ; aucune apparition en
  cours de plan.
- Horloge des shaders (vent, eau) = temps du film : animation régulière quelle que soit la
  durée de rendu d'une image.
- Visages : avatar MPFB, un profil de base par coureur (`BASE_PROFILES`, Robert en tête) aux
  traits un peu variés, effort d'endurance tranquille (`setEffort`), 6 s de mise en route.

Réglage des plans : `/?cinematic=autumn&route=chevreuse-boucle&quality=ultra&ss=2&sub=8&stills=4,14.5`
rend seulement ces instants dans `out/menu-loop/stills-autumn/` ; sans `capture` ni `stills`,
aperçu en continu. `&hour=13` change l'heure (essais d'éclairage).
