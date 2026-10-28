# L'île de Robert — conception

> Monde imaginaire du fork « jeu vidéo » (option A de `PROPOSITIONS_MONDE.md`). Il est produit par un
> générateur (`tools/island/`) au même format que les mondes réels : le moteur l'affiche tel quel. Tout est
> dessiné, donc cohérent par construction, et des contrôles automatiques le vérifient avant livraison.

## Repère

- Île d'environ 12 × 8 km : x de −6 000 à 6 000 m (ouest → est), z de −4 000 à 4 000 m (nord → sud),
  tuiles de 1 km, mer tout autour (niveau 0 m).
- Le relief est une somme de formes simples (plateau côtier, collines, crête du col, vallée creusée par la
  rivière) ; les routes sont posées dessus puis le sol est arasé sous la chaussée et ses accotements.

## Zones

| Zone | Où | Contenu |
| --- | --- | --- |
| **L'Anneau** | ouest du centre, sur un plateau plat à ≈ 30 m | boucle fermée de 3,6 km sans voitures, large (8 m), tribunes, arche départ/arrivée, pelouse centrale, bois autour |
| **Le Bourg** | centre, ≈ 25 m | place et église, rue principale, rues en damier, maisons pastel, école, stade de foot, café |
| **La Piste verte** | Bourg → Anneau | voie verte de 2,5 km séparée de la route, haies et bancs |
| **Le Col du Phare** | nord-est | montée de 6 km à 6–8 %, lacets numérotés, phare au sommet (≈ 430 m) |
| **La Vallée** | du col vers le sud | rivière, ponts en pierre, étang de pêche, moulin, prés à vaches et chevaux |
| **Le Front de mer** | côte sud | promenade, plage, port, mini-golf |
| **Les Bois** | nord-ouest | boucle gravel de 9 km en forêt, gués |
| **Le Plateau** | est | éoliennes, longues lignes droites, champs dorés |

## Livraison par étapes

1. **Générateur, contrôles automatiques, relief de l'île, l'Anneau et le Bourg** (roulables) ← fait (voir plus bas).
2. Le Col du Phare et la Vallée.
3. Le Front de mer, les Bois et le Plateau ; le Grand Tour de l'île (≈ 45 km).
4. Finitions : sons, vie, saisons.

## Contrôles automatiques (à chaque génération)

- aucun point du sol au-dessus d'une route (chaussée et accotements) ;
- pentes et rayons de virage des routes dans les bornes (anneau ≤ 1 %, routes ≤ 10 %) ;
- carrefours raccordés (extrémités de routes sur un nœud du graphe) ;
- aucun bâtiment, arbre ou buisson sur la chaussée ;
- itinéraires bouclés, mesurés et sans demi-tour.

## Générer et contrôler

```
npx tsx tools/island/src/build.ts     # écrit apps/client/public/worlds/ile-de-robert puis lance les contrôles
npx tsx tools/island/src/verify.ts    # relit le monde déjà écrit
```

Les tuiles (`tiles/`, ≈ 47 Mo) ne sont pas versionnées : les régénérer après un `git pull`. Le test
`tools/island/test/island.test.ts` relance les contrôles quand elles sont là. En jeu (pas encore dans le menu) :
`/?world=ile-de-robert&route=anneau` ou `&route=boucle-du-bourg`.

## État de l'étape 1

- **L'Anneau** : 3,59 km, 8 m de large, parfaitement plat (32 m), trois tribunes au bord de la ligne droite sud
  (départ devant elles), pelouse centrale, bosquets autour.
- **La boucle du Bourg** : 7,46 km — place de l'église, Grand-Rue, route de l'Anneau, trois quarts d'anneau,
  Piste verte, rue des Écoles, rue de l'Église ; pente max 5,6 %.
- **Le Bourg (Saint-Robert)** : rues en damier raccordées au graphe (croisements en X compris), ≈ 400 maisons,
  église et clocher, place pavée, stade.
- Contrôles au vert : tuiles et raccords, sol sous les routes, graphe, pentes et rayons, bâtiments et bois hors
  chaussée, itinéraires.
- Côte : plage en pente douce (≈ 1 %) continue jusqu'au fond marin ; les reliefs s'effacent sur la plage. Le sommet
  du col a été reculé à ≈ 700 m du rivage (il faisait une falaise verticale de 400 m) : l'étape 2 reprend son tracé.

Limites vues en jeu, côté moteur (hors générateur) :
- les tribunes sont des bâtiments pleins (pas de gradins) ;
- la plage (`sand`) est peinte comme un champ : pas encore de sable en style jeu vidéo ;
- la circulation et les poteaux électriques du bord de route existent aussi sur l'anneau (voulu sans voitures) ;
- l'île n'est pas au menu : il faudrait une entrée dans `worlds.ts`, `zoneMap.ts` (point sur la carte de France)
  et le catalogue `worlds/index.json`.
