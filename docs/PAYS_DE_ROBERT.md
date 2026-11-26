# Le Pays de Robert — second monde du mode Poly

> Monde imaginaire, comme l'île de Robert, mais d'un autre caractère : une vraie montagne (col à près de 800 m,
> sommets à 1 300 et 1 500 m), un grand lac, des gorges, une station de ski, un plateau de lavande, des calanques, un
> delta et une lagune salée, une grande plaine bocagère et un golfe avec sa station balnéaire. Il est produit par
> `tools/massif`, copie adaptée du générateur de l'île (`tools/island`, qui n'est pas modifié), au même format que
> les mondes réels : le moteur l'affiche tel quel.

## Repère et taille

- Même emprise que l'île : x de −19 000 à 19 000 m, z de −13 000 à 13 000 m, tuiles de 1 km (988 tuiles), mer au niveau 0.
- Repère Lambert-93 fictif en Méditerranée, à l'est de la Corse (`originL93` 1 330 000 / 6 000 000) : ne recouvre ni
  une zone réelle ni l'île. Les sorties sont annoncées comme virtuelles et prennent la météo de la ville du joueur
  (`game/virtualRide.ts`).
- Tuiles de montagne : plus de 655 m de dénivelé dans une tuile, pas de quantification élargi (`stepM` de la tuile).

## Géographie

| Lieu | Où | Caractère |
| --- | --- | --- |
| **Valrobert** | centre-ouest, plaine | bourg de départ, place, critérium |
| **Circuit de la Plaine** | plaine, au sud-ouest de Valrobert | boucle plate de 3,6 km, tribunes, portique, drapeaux (sans voitures ni clôtures) |
| **Port-Azur** | fond du golfe d'Azur (sud) | station balnéaire : boulevard du Golfe, promenade en bois, casino, grands hôtels, port de plaisance |
| **La Calanque** | presqu'île du sud-est | village de pêcheurs entre les falaises, pinède, garrigue |
| **L'Aber** | côte nord, au pied de la montagne | port de pêche au débouché de la combe du col |
| **Col de l'Aigle** | massif du nord | col à ≈ 800 m entre le Pic de l'Aigle (≈ 1 300 m, observatoire) et la Grande Tête (≈ 1 490 m, chapelle) ; lacets des deux versants |
| **Le Planay** | pied sud du col | hameau, départ de la montée |
| **Pralong** | chaîne du nord-ouest, ≈ 550 m | station : route en lacets, téléphérique, bike park, lac de Pralong, alpages |
| **Lac de Robert** | au pied de la chaîne | grand lac, Bellerive sur sa rive sud, abbaye sur la rive nord |
| **Gorges de la Robine** | est | la rivière garde le niveau de la plaine en entaillant les collines ; route des Gorges de Pont-de-Robine au Planay |
| **Plateau des Lavandes** | est | Roche-Haute, château, champs de lavande |
| **Les Olivettes** | collines du sud | oliviers, vignes, moulin |
| **Delta du Gave, Étang du Sel** | ouest et sud-ouest | Sainte-Marthe, Les Salins, saline, flamants roses, marais salants |
| **Fort du Cap** | cap Robert (est) | fort en ruine sur la falaise |

Relief (`design.ts`) : côte découpée (golfe profond, presqu'île, caps, aber, delta), chaîne du Nord (`CHAIN`, arête et
versants en bruit de crêtes), massif de l'Aigle (deux sommets, selle creusée), combe de l'Aber (fond en pente régulière
jusqu'au port), plateau, collines, cuvette du lac. Les villes du bord de mer ont un arrière-pays en pente douce.
Occupation du sol (`land.ts`) : résineux en montagne jusqu'à ≈ 1 050 m, alpages au-dessus, rochers sur les sommets et
les parois raides, pinède et garrigue aux calanques, vignes et oliviers sur les coteaux exposés au sud.

## Réseau et parcours

- Routes : tour du pays, grands axes depuis Valrobert, route des Gorges, routes communales, maillage de petites routes,
  pistes cyclables (piste de la Plaine, voies vertes du Gave et du Lac, Vélo du Golfe), promenade de Port-Azur.
- Routes de montagne en lacets (`climb.ts`) : col de l'Aigle (deux versants), route de l'Observatoire, route de Pralong.
- Chemins gravel et sentiers VTT (`TRAILS`, `SKIN`) : lavandes, oliviers, delta, vignes, calanques, pointe des Sables,
  grande traversée, alpages, salins ; marmottes, Grande Tête, descente de l'Aigle, gorges, calanques, lac, crêtes,
  cyclo-cross de la Plaine, bike park de Pralong.
- Un parcours n'est publié que s'il passe les contrôles (`routeFlaw` dans `build.ts`, mêmes règles que `verify.ts`) ;
  un parcours impossible ou écarté est signalé dans le journal de construction.
- En montagne, les contrôles tolèrent un peu plus qu'à l'île : déblais et remblais jusqu'à 40 m, marches de 65 cm sur
  route, pente de 16 % sur 10 m (passages raides des cols).

## Générer

```
node node_modules/tsx/dist/cli.mjs tools/massif/src/build.ts                    # écrit apps/client/public/worlds/pays-de-robert
ISLAND_OUT=D:/zzCACHE_ALLEZROBERT/zones-travail/pays-de-robert ISLAND_THREADS=8 node node_modules/tsx/dist/cli.mjs tools/massif/src/build.ts   # essai ailleurs
ISLAND_PLAN=1 …                                                                   # tracé seul (≈ 1 min)
node node_modules/tsx/dist/cli.mjs tools/massif/src/verify.ts                   # contrôles du monde écrit
```

Mêmes réglages d'essai que l'île (`ISLAND_RELIEF`, `ISLAND_MESH`…), plus `ISLAND_THREADS` (nombre de fils de calcul).
Les tuiles (`tiles/`) ne sont pas versionnées ; `carte.png` et `vignette.png` le sont.

## Dans le jeu (mode Poly)

- Choix du monde : onglets « L'Île de Robert » / « Le Pays de Robert » en haut de l'écran de carte Poly
  (`ui/islandAtlas.ts`), monde chargé sur place ; lien direct `/?style=lowpoly&world=pays-de-robert`.
- Données propres à chaque monde (titre, lieux de la carte, parcours en tête, lieux à découvrir, nom du Tour à étapes) :
  `world/polyWorlds.ts`. Lieux à découvrir gardés dans `ar.paysFound`.
- Décor propre (`world/paysSites.ts`) : ports (même construction que ceux de l'île), tribunes du Circuit, téléphérique
  animé de Pralong, parapentes, dôme de l'observatoire, croix de la Grande Tête, flamants roses et tas de sel, champs de
  lavande selon la saison. Le décor de l'île (Robertville, Anneau, Saint-Robert, cyclo-cross…) ne s'affiche que sur l'île.
- Pas encore : envoi des tuiles sur le serveur et pack hors ligne publié ; installation d'office dans l'application de
  bureau (seule l'île l'est).
