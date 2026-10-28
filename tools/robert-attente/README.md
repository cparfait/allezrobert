# Robert qui patiente (écran d'attente)

`source.webp` : planche de deux Robert bras croisés. Le jeu utilise celui de droite, détouré (fond blanc
retiré depuis les bords) et réduit à 460 px de haut : `apps/client/public/robert-attente.png`.

`robert-attente-velo.png` : Robert sur son vélo, poing levé (image fournie à fond transparent, maillot rouge
passé au jaune du site, langue épargnée). Les deux images alternent d'un écran d'attente à l'autre.

Sur l'écran d'attente, Robert à vélo pédale : `python layers.py ../../apps/client/public/robert-attente-velo.png <dossier>`
découpe l'image en quatre calques (vélo avec bassin et mains, jambe, buste et tête, bras levé), à convertir en
WebP sans perte dans `apps/client/public/robert-velo/`. L'animation est en CSS (`.rb` dans `apps/client/index.html`).

## Robert en low poly (fork « jeu vidéo »)

Images fournies à fond blanc (1024 × 1024) : `lowpoly.js`, à coller dans la console du client en développement,
les détoure (fond, ombre portée et sol retirés, chaussures et casque blancs gardés) et découpe Robert à vélo en
quatre calques, comme `layers.py`. Sortie dans `out/robert-lowpoly/`, à copier dans `apps/client/public/robert-lowpoly/`.
Animation : mêmes mouvements que l'ancien Robert, pivots propres à ses calques (`.rb.rb-lp` dans `apps/client/index.html`).
