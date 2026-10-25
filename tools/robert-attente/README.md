# Robert qui patiente (écran d'attente)

`source.webp` : planche de deux Robert bras croisés. Le jeu utilise celui de droite, détouré (fond blanc
retiré depuis les bords) et réduit à 460 px de haut : `apps/client/public/robert-attente.png`.

`robert-attente-velo.png` : Robert sur son vélo, poing levé (image fournie à fond transparent, maillot rouge
passé au jaune du site, langue épargnée). Les deux images alternent d'un écran d'attente à l'autre.

Sur l'écran d'attente, Robert à vélo pédale : `python layers.py ../../apps/client/public/robert-attente-velo.png <dossier>`
découpe l'image en quatre calques (vélo avec bassin et mains, jambe, buste et tête, bras levé), à convertir en
WebP sans perte dans `apps/client/public/robert-velo/`. L'animation est en CSS (`.rb` dans `apps/client/index.html`).
