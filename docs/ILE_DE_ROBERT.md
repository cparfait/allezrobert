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

1. **Générateur, contrôles automatiques, relief de l'île, l'Anneau et le Bourg** (roulables) ← étape en cours.
2. Le Col du Phare et la Vallée.
3. Le Front de mer, les Bois et le Plateau ; le Grand Tour de l'île (≈ 45 km).
4. Finitions : sons, vie, saisons.

## Contrôles automatiques (à chaque génération)

- aucun point du sol au-dessus d'une route (chaussée et accotements) ;
- pentes et rayons de virage des routes dans les bornes (anneau ≤ 1 %, routes ≤ 10 %) ;
- carrefours raccordés (extrémités de routes sur un nœud du graphe) ;
- aucun bâtiment, arbre ou buisson sur la chaussée ;
- itinéraires bouclés, mesurés et sans demi-tour.
