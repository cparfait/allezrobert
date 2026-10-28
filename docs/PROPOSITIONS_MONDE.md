# Monde virtuel créé de zéro — propositions

Objectif : un monde imaginaire, sans aucun bug de données (on le dessine, tout est cohérent par
construction), varié (plat, bosses, vraie montée, gravel, front de mer), avec routes, pistes cyclables et un
anneau fermé façon Longchamp, peuplé de tout ce qu'on a vu (animaux, enfants, pêcheurs, stade, ponts…).

Point commun aux trois propositions : le monde est produit au **même format de tuiles** que les mondes réels
(relief, routes en 3D, occupation du sol, bâtiments, eau, itinéraires) par un **générateur** à partir d'un
fichier de conception lisible. Le moteur actuel l'affiche donc tel quel. Et des **contrôles automatiques** le
valident avant chaque livraison :
- pas de sol au-dessus d'une route ;
- pentes et virages dans les bornes ;
- carrefours raccordés ;
- pas d'objet sur la chaussée ;
- itinéraires bouclés et mesurés.

## A. « L'île de Robert » — monde dessiné à la main (recommandé)

Une île d'environ 12 × 8 km, entièrement conçue :

| Zone | Contenu | Pour qui |
| --- | --- | --- |
| **L'Anneau** | boucle fermée de 3,6 km, plate, large, sans voitures, comme Longchamp ; tribunes, arche départ/arrivée, sprint | entraînement, courses, intervalles |
| **Le Front de mer** | promenade en planches, plage, parasols, mini-golf, port, phare | balade, sprint |
| **Le Bourg** | église, place, marché, café, école, stade de foot, boulangerie, poubelles et boîtes aux lettres | ambiance, sprint de village |
| **La Vallée** | rivière, ponts en pierre, étang de pêche, moulin, prés à vaches et chevaux | sorties tranquilles |
| **Le Col du Phare** | vraie montée de 6 km à 6–8 %, lacets numérotés, public, photo au sommet | défi KOM |
| **Les Bois** | boucle gravel de 9 km en forêt, poussière, ruisseaux à gué | gravel, VTT |
| **Le Plateau** | éoliennes, longues lignes droites ventées, champs dorés | contre-la-montre |
| **La Piste verte** | voie verte (piste cyclable séparée) qui relie le bourg à l'anneau | débutants |

Itinéraires prévus : Anneau (3,6 km), Tour du Bourg (12 km, vallonné), Grand Tour de l'île (45 km),
Col du Phare (montée chronométrée), Boucle des Bois (gravel), Plateau CLM (20 km plat).

- **Avantages :** contrôle total, zéro bug de données, ambiance « jeu vidéo » assumée, chaque zone a un rôle.
- **Inconvénient :** c'est le plus gros chantier (générateur et conception).
- **Étapes :**
  1. générateur et contrôles automatiques ;
  2. Anneau et Bourg (déjà roulables) ;
  3. Col et Vallée ;
  4. Front de mer, Bois et Plateau ;
  5. finitions (sons, vie, saisons).

## B. Monde hybride : vrai relief, routes inventées

On prend le relief réel d'une région (par exemple la vallée de Chevreuse ou un coin d'Auvergne). On y
**dessine nos propres routes**, villages et pistes, posés proprement sur ce relief.

- **Avantages :** montées et paysages crédibles sans les inventer, moins de travail de relief.
- **Inconvénient :** il faut composer avec le relief existant (moins de liberté pour l'anneau plat ou le front de mer).

## C. Monde généré automatiquement

Un générateur à graine produit relief, routes (avec pente maximale), villages et forêts. On garde les tirages
réussis.

- **Avantages :** autant de mondes qu'on veut, très vite.
- **Inconvénients :** moins « dessiné » et moins mémorable. Les cas limites (carrefours, ponts) sont plus durs à
  garantir sans bug.

## Recommandation

**A**, en commençant par l'Anneau façon Longchamp et le Bourg, roulables rapidement, puis le Col et la
Vallée. Le générateur et ses contrôles servent ensuite à toutes les autres zones.
