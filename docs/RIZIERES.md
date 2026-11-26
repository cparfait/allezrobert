# Les Rizières et la jungle — monde du mode Poly

> Monde imaginaire du mode Poly, du même gabarit que le Pays de Robert, mais tropical : collines couvertes de
> rizières en terrasses, plaine des digues, monts de la jungle avec un col à près de 800 m, pitons calcaires en pains
> de sucre au bord de la mer, Grand Fleuve bordé de jungle et son delta, plages de sable blanc. Il est produit par
> `tools/rizieres`, copie adaptée du générateur du Pays de Robert (`tools/massif`, qui n'est pas modifié), au même
> format que les mondes réels : le moteur l'affiche tel quel.

## Repère et taille

- Même emprise que l'île et le Pays de Robert : x de −19 000 à 19 000 m, z de −13 000 à 13 000 m, tuiles de 1 km
  (988 tuiles), mer au niveau 0.
- Repère Lambert-93 fictif en Méditerranée, au sud-est de la Corse (`originL93` 1 330 000 / 5 600 000) : ne recouvre
  ni une zone réelle ni un autre monde. Les sorties sont annoncées comme virtuelles.
- Tuiles de montagne : plus de 655 m de dénivelé dans une tuile, pas de quantification élargi (`stepM` de la tuile).

## Géographie

| Lieu | Où | Caractère |
| --- | --- | --- |
| **Vat-Robert** | centre-ouest, plaine | bourg de départ, place du marché, critérium ; **Grand Temple** et stupa doré sur la colline au sud-ouest |
| **Plaine des rizières** | ouest, de Vat-Robert aux Pilotis | sol presque plat, rizières entre leurs diguettes, routes de digue droites (`RICE_PLAIN`) |
| **Circuit des Rizières** | au sud de la plaine | boucle plate de 3,6 km, tribunes à toit rouge, portique, drapeaux (sans voitures ni clôtures) |
| **Plage-de-Jade** | fond du golfe de Jade (sud) | station balnéaire : boulevard de Jade, promenade des Cocotiers, hôtels, bungalows, paillotes, marché de nuit, port |
| **Les Pitons** | presqu'île du sud-est | village de pêcheurs dans la baie des Pitons : une quarantaine de pains de sucre calcaires en mer et sur la presqu'île |
| **Port-des-Jonques** | côte nord, au pied des monts | port de pêche au débouché de la vallée des Jonques |
| **Col de la Jungle** | massif des Lanternes (nord) | col à ≈ 800 m entre le Mont des Lanternes (**Temple des Lanternes** au sommet) et le Mont du Tigre (stupa) ; lacets des deux versants |
| **La Bambouseraie** | pied sud du col | hameau, bosquets de bambous, départ des montées |
| **Village-des-Nuages** | monts de l'ouest, ≈ 550 m | village de montagne, route en lacets, maison de thé, bike park dans la jungle, cascade |
| **Lac des Lotus** | au pied des monts | grand lac, Rive-des-Lotus et ses pilotis, Monastère des Lotus |
| **Gorges du Dragon** | est | la rivière garde le niveau de la plaine en entaillant les collines ; Pont-des-Lianes, pont suspendu, cascade |
| **Plateau des Théiers** | est | Les Théiers, théiers en rangs, séchoir, ruines du Palais des Théiers |
| **Collines des Terrasses** | sud | Les Terrasses, rizières en terrasses qui suivent les courbes de niveau, Pagode des Terrasses |
| **Grand Fleuve et delta** | ouest | fleuve large bordé de jungle ; Les Pilotis (quartier sur pilotis, **marché flottant**), Les Mangroves, lagune |
| **Ruines** | dans la jungle | Prasat-Vert (Mont du Tigre), Temple englouti du Dragon, Ruines du Fleuve, Fort du Dragon (cap de l'est) |

Relief (`design.ts`) : même squelette que le Pays de Robert (côte découpée, monts au nord, massif à deux sommets,
selle creusée, vallée des Jonques en pente régulière jusqu'au port, plateau, collines, cuvette du lac), avec en plus :
pitons karstiques (`karstPitons`, `karst`) aux flancs presque verticaux et au sommet arrondi, la plaine des rizières
aplanie, la colline du temple de Vat-Robert (`TEMPLE_HILL`), le Grand Fleuve élargi (26 m à l'embouchure).

Occupation du sol (`land.ts`, `worker.ts`) : jungle dense partout (galeries très larges le long des rivières, jusqu'aux
sommets, sur le haut des pitons) ; **rizières en terrasses** : bandes de 4,5 m de dénivelé qui suivent les courbes de
niveau, tracées par tuile (`terraceMask`, grille de 5 m) sur les collines du sud, le piémont des monts et les coteaux de
la Bambouseraie ; rizières de la plaine en parcelles bordées de diguettes ; théiers en rangs sur le plateau ; vergers
de bananiers ; roche calcaire grise sur les falaises et les flancs des pitons ; plages de sable blanc ; mangroves.

## Réseau et parcours

- Routes : Tour des Rizières, grands axes depuis Vat-Robert, route des Gorges du Dragon, routes communales, maillage de
  petites routes. Dans la plaine des rizières, les routes de digue sont droites et plates (coût de tracé uniforme, pas
  de méandres, lignes droites plus longues : `plainAt` dans `build.ts`).
- Pistes cyclables : piste des Rizières, voies vertes du Fleuve et des Lotus, Vélo du Lagon, promenade des Cocotiers.
- Routes de montagne en lacets (`climb.ts`) : col de la Jungle (deux versants), route du Temple des Lanternes, route
  des Nuages.
- Chemins gravel et sentiers VTT (`TRAILS`, `SKIN`, terre rouge et sable dans la jungle) : théiers, terrasses, delta,
  bambous, pitons, sables blancs, grande traversée, nuages, mangroves ; sentiers des Nuages, du Mont du Tigre, du
  Dragon, des Pitons, des Lotus, descente de la Jungle, cyclo-cross des Digues, bike park de la Jungle.
- Les boucles des chemins se referment sur leur propre case d'arrivée (`connect(…, exact)`) : sinon le dernier tronçon
  s'arrêtait sur le premier, près du départ, et la boucle restait ouverte (cas des petites boucles du Pays de Robert).
- Un parcours n'est publié que s'il passe les contrôles (`routeFlaw` dans `build.ts`, mêmes règles que `verify.ts`).
- Après le tracé, `easeKinks` (virages trop serrés adoucis en travers, sans changer la pente) et `fillSags` (creux
  de moins de 25 cm comblés hors des rampes) dans `roads.ts`.
- État des contrôles (26/11/2026) : les 40 parcours, les tuiles, le sol sous les routes, les terrassements et les
  bâtiments sont au vert. Restent en échec, sur le réseau hors parcours, les mêmes familles de défauts que le Pays de
  Robert (dont `verify.ts` échoue aussi) : un nœud isolé du maillage (12 485, −5 073), 7 raccords en biseau, 21 creux
  de 13 à 23 cm (sentiers surtout), des pentes de 16 à 17 % et des virages serrés sur la Route du Tour vers
  (−9 400, −3 500), et une pente de 70 % sur un raccord du bike park vers (−9 180, −3 685).

### Parcours (40)

- Découverte : `decouverte-des-rizieres` (≈ 11 km, plaine et colline du temple).
- Classiques : `classique-des-terrasses` (route, Vat-Robert → Plage-de-Jade par les Terrasses et les Pitons),
  `classique-de-la-jungle` (gravel, Rive-des-Lotus → Pont-des-Lianes par les bambous et les gorges).
- Chrono : `chrono-des-digues` (Vat-Robert → Les Pilotis, plat entre les rizières).
- Nuit : `temple-de-nuit` (montée au Temple des Lanternes, départ forcé à 23 h, lanternes le long de la route).
- Route : `anneau` (Circuit des Rizières), `criterium-de-vat-robert`, `boucle-de-vat-robert`, `col-de-la-jungle`
  (KOM du col), `mont-des-lanternes`, `col-par-les-jonques`, `montee-des-nuages`, `gorges-du-dragon`,
  `corniche-des-pitons`, `plateau-des-theiers`, `golfe-et-terrasses`, `delta-et-mangroves`, `tour-des-rizieres`
  (tour du monde, 115 km).
- Pistes cyclables : `promenade-de-plage-de-jade`, `piste-des-rizieres`, `voie-verte-du-fleuve`,
  `voie-verte-des-lotus`, `velo-du-lagon`.
- Gravel : `classique-de-la-jungle`, `gravel-des-nuages`, `gravel-des-theiers`, `gravel-des-terrasses`,
  `gravel-du-delta`, `gravel-des-bambous`, `gravel-des-mangroves`, `chemin-des-pitons`, `chemin-des-sables-blancs`,
  `grande-traversee`, `cyclo-cross-des-digues`.
- VTT : `vtt-des-nuages`, `vtt-du-mont-du-tigre`, `descente-de-la-jungle`, `vtt-du-dragon`, `vtt-des-pitons`,
  `vtt-des-lotus`, `bike-park-de-la-jungle`.

## Générer

Depuis `apps/server` (pour avoir tsx) :

```
ISLAND_OUT='D:/zzCACHE_ALLEZROBERT/zones-travail/rizieres' ISLAND_THREADS=4 pnpm exec tsx ../../tools/rizieres/src/build.ts   # essai ailleurs
ISLAND_PLAN=1 …                                                                   # tracé seul (≈ 1 min)
pnpm exec tsx ../../tools/rizieres/src/verify.ts <dossier du monde>             # contrôles du monde écrit
pnpm exec tsx ../../tools/rizieres/src/map.ts --px 25 --out <dossier>/carte.png
pnpm exec tsx ../../tools/rizieres/src/map.ts --px 40 --style flat --out <dossier>/vignette.png
```

Sans `ISLAND_OUT`, le générateur écrit `apps/client/public/worlds/rizieres` et publie le catalogue : à réserver à la
session qui régénère `worlds/index.json`. Mêmes réglages d'essai que l'île (`ISLAND_RELIEF`, `ISLAND_MESH`…).
Les tuiles (`tiles/`) ne sont pas versionnées ; `carte.png` et `vignette.png` le sont.

## Dans le jeu (mode Poly)

- Données du monde : `apps/client/src/world/lands/rizieres.ts` (titre, lieux de la carte, parcours en tête, lieux à
  découvrir, nom du Tour à étapes, thème, circuit, restyle des bâtiments).
- Thème : verts vifs de la mousson au printemps et en été, rizières dorées à l'automne, saison sèche plus jaune en
  hiver ; jungle très sombre ; sable blanc ; roche calcaire grise ; pas de neige ; feuillage tropical ; eau
  turquoise.
- Bâtiments : toits relevés à grands débords, chaume de paille ou tuiles rouges et vernissées, temples rouge et or,
  stupas dorés, ruines grises et moussues.
- Décor propre (`lands/rizieresSites.ts`) : ports de Plage-de-Jade, des Pitons et des Jonques ; tribunes du Circuit ;
  Grand Temple de Vat-Robert (pagode, stupa, portique, allée de lanternes) ; place du marché ; Temple des Lanternes
  (pagode, guirlandes, drapeaux de prière vers le stupa du Mont du Tigre) ; lanternes tout le long de la montée de nuit ;
  ruines envahies (prang moussu, blocs, colonnes, figuier étrangleur) ; villages sur pilotis (Grand Fleuve, Lac des
  Lotus, mangroves, Rivière du Dragon) ; marché flottant ; barques qui vont et viennent sur le fleuve, le delta et la
  Rivière du Dragon ; ponts suspendus sur trois franchissements de rivière et trois passerelles ; buffles d'eau et
  hérons dans les rizières ; cocotiers des plages ; bosquets de bambous ; deux cascades ; bike park et cyclo-cross des
  Digues ; marché de nuit de Plage-de-Jade. Toutes les lanternes s'allument la nuit (`islandClock()`).
- Maisons sur pilotis : faites par le décor (le moteur pose toujours un bâtiment sur le sol).
