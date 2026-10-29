# L'île de Robert — conception

> Monde imaginaire du fork « jeu vidéo » (option A de `PROPOSITIONS_MONDE.md`). Il est produit par un
> générateur (`tools/island/`) au même format que les mondes réels : le moteur l'affiche tel quel. Le relief,
> le réseau routier et les villages sont générés de façon déterministe (deux générations donnent le même
> monde), et des contrôles automatiques vérifient tout avant livraison.

## Repère et taille

- Île d'environ **34 × 22 km** (≈ 600 km²) : x de −17 000 à 17 000 m (ouest → est), z de −11 000 à 11 000 m
  (nord → sud), tuiles de 1 km (988 tuiles avec la mer autour, niveau 0 m).
- Côte « étoilée » (un seul rivage par direction) : caps, baies, plages de sable et secteurs de falaises.
- Relief : campagne ondulée, collines boisées (les Bois), croupe des Coteaux, plateau de l'est en
  escarpement, massif du Phare (deux sommets ≈ 700 et 780 m, col ≈ 490 m), vallées creusées par trois
  rivières, lacs et étangs, lagune derrière un cordon de dunes, deux ports (bassins sous le niveau de la mer).

## Lieux

| Lieu | Où | Contenu |
| --- | --- | --- |
| **Saint-Robert** | centre | bourg : église et clocher, mairie, école, café, place, stade, cimetière |
| **L'Anneau** | ouest du centre | boucle plate de 3,6 km (8 m, marquage), tribunes, pelouse ; 4 accès depuis le réseau |
| **Robertville-sur-Mer** | côte sud | station « à la Deauville » : boulevard de la Mer, **les Planches**, cabines de plage colorées, grands hôtels, casino, villas, port à l'embouchure du Ru, golf, hippodrome |
| **Kerbrou** | côte nord | village de pêcheurs (maisons blanches, ardoise), port |
| **Col du Phare** | nord-est | montée en lacets depuis le Hameau du Col, phare au sommet côté mer, lac d'altitude |
| **Les Bois** | nord-ouest | grande forêt sur des collines, étang, boucle gravel et sentiers VTT, chapelle en ruine |
| **Les Coteaux / Les Vignes** | sud | vignes exposées au sud, château, moulin à vent |
| **La Vallée de la Robe** | est | rivière à méandres, Vallon-sur-Robe, étang de pêche, voie verte |
| **Le Plateau** | est | grandes cultures, Les Granges, château d'eau, chemins |
| **La Lagune** | sud-ouest | lagune, marais, La Pointe, chemin des dunes |
| Villages | partout | Saint-Pierre, Bois-Joli, Port-Sable, ≈ 150 fermes, maisons et hameaux le long des routes |

## Réseau

Tracé automatiquement sur une grille de 20 m par recherche de chemin (A*) qui suit le relief, avec une pente
maximale par catégorie, en réutilisant les routes existantes, sans raccord en biseau ni croisement sans
carrefour. Les tracés sont ensuite simplifiés, arrondis (rayon minimal par catégorie, lissés d'un seul tenant
à travers les carrefours) et reçoivent un profil en long.

| Catégorie | Jeu (`kind`) | Largeur | Pente max |
| --- | --- | --- | --- |
| Route du Tour de l'Île, grands axes | secondary (marquage) | 7 m | 7,5 % |
| Routes communales, col | tertiary (marquage) | 6 m | 9 % (col 8,5 %) |
| Chemins des fermes | unclassified | 4,5 m | 11 % |
| Pistes cyclables (Piste verte, voie verte de la Robe, Vélomaritime, Planches) | cycleway | 4 m | 4 % |
| Chemins gravel | track, gravier | 3,2 m | 13 % |
| Sentiers VTT | track, terre | 2,4 m | 20 % |

## Itinéraires

L'Anneau, la boucle de Saint-Robert, Robertville par les Coteaux, le front de mer de Robertville (planches),
la traversée du Col du Phare (montée sud et descente nord en lacets), la montée au Phare (bifurcation sous le
col), le Tour de l'Île (≈ 95 km), la Piste verte, Gravel des Bois, VTT des Bois.
En monde ouvert, on part de Saint-Robert et on va où l'on veut : rejoindre l'Anneau et y tourner, descendre
au front de mer, monter au phare. Un clic sur la mini-carte ouvre la carte complète de l'île : on y choisit
une destination (route ou lieu) et le jeu guide jusque-là au fil des carrefours, ou l'on repart d'ailleurs.

## Générer, contrôler, voir

```
npx tsx tools/island/src/build.ts     # ≈ 6 min (16 cœurs) : écrit apps/client/public/worlds/ile-de-robert
npx tsx tools/island/src/verify.ts    # relit le monde déjà écrit
npx tsx tools/island/src/map.ts --route tour-de-l-ile   # carte vue du ciel (PNG)
```

`build.ts` écrit aussi `carte.png` (25 m par pixel : fond de la mini-carte et de la carte complète en jeu) et
`vignette.png` (80 m par pixel, ≈ 200 Ko : menu), toutes deux versionnées.

Les tuiles (`tiles/`, ≈ 400 Mo) ne sont pas versionnées : les régénérer après un `git pull`. Au menu, l'île
est présentée à côté de la carte de France (« Hors de France ») ; en direct : `/?world=ile-de-robert&route=anneau`
(ou un autre identifiant d'itinéraire).

Fichiers : `design.ts` (côte, relief, rivières, lacs, ports, lieux), `planner.ts` (recherche de chemin),
`roads.ts` (profils, sol arasé, graphe), `settle.ts` (villes, station balnéaire, fermes, édifices),
`land.ts` (bois, parcelles, plages, eau), `routes.ts` (itinéraires), `worker.ts` / `pool.ts` (calcul
parallèle des tuiles), `verify.ts` (contrôles), `map.ts` (carte).

## Contrôles automatiques (à chaque génération)

- tuiles complètes, raccords sans marche entre tuiles voisines ;
- aucun point du sol au-dessus d'une route (chaussée et accotements) ;
- graphe : extrémités sur des nœuds, un seul tenant, pas de croisement sans carrefour, carrefours francs
  (jamais deux routes à moins de 20° l'une de l'autre) ;
- pentes et rayons de virage par catégorie (anneau ≤ 1 %) ;
- ni bâtiment, ni bois, ni cours d'eau sur la chaussée ; bâtiments posés sur le sol, jamais dans l'eau ;
- itinéraires bouclés, mesurés, posés sur les routes, sans demi-tour ni marche, largeur annoncée ≤ voie la
  plus étroite (le jeu place le coureur d'après cette largeur).

## Limites connues, côté moteur

- les tribunes sont des bâtiments pleins (pas de gradins) ; pas de parasols ni de bateaux ;
- la plage (`sand`) est peinte comme un champ en style jeu vidéo ;
- la circulation et les poteaux électriques suivent aussi l'Anneau (voulu sans voitures).
