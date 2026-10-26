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
- [ ] Mur plus réaliste (essai retiré : abîmait le décor).
- [ ] Vrais pneus avec marques (essai retiré).
- [ ] Un ou deux vrais vélos en fond (essai retiré).

## Visage
- [ ] Tête nue déformée (crâne lisse et allongé, traits étirés) : modèle de tête à reprendre dans le pipeline Blender, avec les coiffures.
- [ ] En attendant, le tutoriel garde le casque (`onboarding.ts`, `bareHead`) : le remettre tête nue une fois la tête corrigée.

## Cheveux
- [ ] Vraies coiffures via le pipeline Blender.
- [ ] **En attente** : exemples de coupes homme et femme (Christophe).

## Voix off
- [ ] Les 8 répliques anglaises.
- [ ] **En attente** : crédits Cartesia.

## Quadrillage de l'Île-de-France
- [ ] **À valider** : mailles de 25 km OK ?
- [ ] Créer les 32 zones dans la configuration.
