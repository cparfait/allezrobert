# Robert sur son home trainer (écran d'attente)

Le jeu affiche l'image fixe `apps/client/public/robert-trainer.png` (plus légère qu'une vidéo pendant
un chargement). La boucle animée ci-dessous reste disponible si besoin.

Boucle vidéo de l'écran d'attente (`apps/client/public/robert-trainer.webm`, fond transparent) faite à
partir de l'illustration `source.jpg`, animée avec [HyperFrames](https://github.com/heygen-com/hyperframes).

1. `python3 prep.py` (Pillow, numpy, scipy, matplotlib) : détourage, maillot rouge passé au jaune du
   site, calques séparés dans `robert/` : bras levé, tête, corps en 12 images de pédalage (pieds sur un cercle).
2. `npx hyperframes@0.8.193 render . --format webm --resolution square --crf 28 -o robert-trainer.webm`
   (`index.html` : boucle de 1,5 s, deux tours de pédalier, poing levé en rythme, tête qui dodeline).
3. Copier `robert-trainer.webm` dans `apps/client/public/` ; l'image fixe `robert-trainer.png` (400 px)
   vient de `robert/full.png`.
