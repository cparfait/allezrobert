# Mesure de fluidité (`@allezrobert/perf`)

Roule une sortie dans un Chrome sans fenêtre et mesure ce que le joueur ressent : images par
seconde, **saccades** (images de plus de 100 et 250 ms) et **shaders compilés en roulant** (chacun
fige l'affichage de 60 ms à 2 s sous Windows, voir [docs/ETUDE_PERFORMANCE.md](../../docs/ETUDE_PERFORMANCE.md)).

```bash
pnpm --filter @allezrobert/perf measure
pnpm --filter @allezrobert/perf measure -- --world billom --quality high --seconds 90
```

- Lance son propre serveur de dev (port 5198, sans rechargement à chaud) ; `--url http://localhost:5173`
  utilise un serveur existant.
- Profil Chrome vierge à chaque mesure (aucun shader en cache : le cas du premier lancement) ;
  `--warm-cache` garde le cache d'une mesure à l'autre.
- Monte le simulateur à 1 500 W (≈ 70 km/h, une tuile nouvelle toutes les 50 s), roule `--warm`
  secondes (20 par défaut), puis mesure `--seconds` secondes (60 par défaut).
- `--cpu-load` : profil processeur du chargement (ouverture de la page → départ) ; `--query "compileconc=4"` : paramètres d'URL
  supplémentaires du jeu ; `--probe-buildings` : part des sommets de bâtiments répétés à l'identique.
- Le détail du chargement (repères `ar:…` du jeu : moteur, monde, tuiles, compilation) est imprimé après « sortie lancée » et rangé
  dans le JSON (`startup`).
- `--cpu` : profil processeur (`.cpuprofile`, à ouvrir dans DevTools > Performance) ;
  `--trace` : trace DevTools complète, processus GPU compris (compilation `CompileShaderDXC`) ;
  `--trace gpu` : seulement Dawn (pipelines nommés d'après leur matériau, trace légère) ;
  `--headed` : montre la fenêtre.

Bilan dans `out/perf/<monde>-<qualité>-<date>.json` avec une capture d'écran. **Code de sortie 1 si
le budget est dépassé** : plus de 10 shaders compilés en roulant ou plus de 3 saccades de plus de
250 ms par minute. À lancer avant chaque version et après toute modification des matériaux.

En jeu, le panneau F3 affiche les mêmes compteurs (`shaders : … en direct, … à l'avance`) et
étiquette `COMPIL. SHADER` les saccades dues à une compilation.
