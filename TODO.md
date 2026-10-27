# TODO

## Roues carbone 40 / 55 / 88 mm
- [x] Vraies références ajoutées à l'atelier (Roval Alpinist / Rapide, Zipp 404 / 808, Campagnolo Bora WTO 60, ENVE SES 7.8). Reste : un vrai modèle 3D de jante ≥ 80 mm (le plus haut profil dessiné est le 65 mm).

## Pause : rubrique « Son »
- [x] Ajouter une rubrique « Son » dans le menu pause, avec son propre titre, comme « Graphismes ».

## Gestion du peloton en groupe
Décidé et fait (touche F : auto / file indienne / deux files tournantes / bordure ; K : « attendez-moi » ; R : ralentir ; [ ] : allure) — à valider en jeu par Christophe :
- [x] Forme du peloton (`packages/physics/src/formation.ts`).
- [x] Relais qui tournent (deux files, la rapide remonte, la lente se laisse glisser).
- [x] Ordres aux IA : plus vite ([ ]), plus doucement (R), m'attendre (K) ; aussi sur l'appli compagnon.

## Atelier
- [x] Mur peint vieilli (plinthe sombre, traces de guidons, fissures), pneus marqués (marque, modèle, taille), deux vélos du jeu appuyés au fond (réintroduits : le premier essai avait été retiré sans motif noté ; à valider à l'écran par Christophe).

## Visage
- [x] Tête nue : le crâne lisse venait du bonnet de cheveux unique ; remplacé tête nue par une coque de cheveux par coiffure. Tutoriel de nouveau tête nue (casque quand on choisit sa couleur).
- [x] `tongueOut` ajouté (sort à l'effort extrême) ; visages féminins : traits `FEMININE` renforcés ; poitrine des hommes supprimée (`cupsize` 0), annulé le 27/10 : pour un homme, 0 applique la cible « bonnet minimal » de MPFB qui plissait les pectoraux ; retour à 0,5 (pectoraux neutres).

## Cheveux
- [x] 6 coiffures de plus (dégradé, bouclés, carré, chignon, coiffé, longs), visibles tête nue ; sous le casque : bonnet court (les longs en queue de cheval). Coques à bruit de mèches, pas de vrais brins : pistes d'amélioration (cartes de mèches) au besoin.
- [ ] **En attente** : exemples de coupes homme et femme (Christophe).

## Voix off
- [ ] Les 8 répliques anglaises.
- [ ] **En attente** : crédits Cartesia.

## Quadrillage de l'Île-de-France
- [ ] **À valider** : mailles de 25 km OK ?
- [ ] Créer les 32 zones dans la configuration.
