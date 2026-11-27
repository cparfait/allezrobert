# Les Rizières et la jungle — monde du mode Poly

> Monde imaginaire du mode Poly, tropical : une longue terre couchée en biais que le Grand Fleuve traverse d'un bout
> à l'autre avant de se diviser en quatre bras dans un delta qui avance dans la mer, des collines couvertes de rizières
> en terrasses de part et d'autre de la plaine, une jungle sombre sur tous les reliefs, une baie semée de pitons
> calcaires en pains de sucre, un plateau de théiers entaillé par des gorges. Il est produit par `tools/rizieres`,
> copie adaptée du générateur du Pays de Robert (`tools/massif`, qui n'est pas modifié), au même format que les mondes
> réels : le moteur l'affiche tel quel.

## Repère et taille

- Même emprise que l'île et le Pays de Robert : x de −19 000 à 19 000 m, z de −13 000 à 13 000 m, tuiles de 1 km
  (988 tuiles), mer au niveau 0.
- Repère Lambert-93 fictif en Méditerranée, au sud-est de la Corse (`originL93` 1 330 000 / 5 600 000) : ne recouvre
  ni une zone réelle ni un autre monde. Les sorties sont annoncées comme virtuelles.
- Repère propre au pays (`design.ts`) : axe `u` le long du Grand Fleuve, du sud-ouest (delta) au nord-est (massif),
  axe `v` en travers, de la côte nord-ouest à la côte sud-est (`FRAME.rot` = −0,4 rad ; `UV(u, v)` → (x, z)).
- Tuiles de montagne : plus de 655 m de dénivelé dans une tuile, pas de quantification élargi (`stepM` de la tuile).

## Géographie (refonte du 26/11/2026)

La première version reprenait la côte en haricot, le grand lac et le réseau du Pays de Robert. Tout a été refait :

- **Côte** : super-ellipse couchée en biais (34 × 17 km), et non plus en haricot. Au sud-ouest, le **delta** avance en
  lobe, avec un doigt de terre le long de chaque bras et des anses entre eux (rivages de vase et de mangroves, pas de
  sable). Au sud-est, la **baie des Pitons**, large et profonde (≈ 3 km), entre la pointe des Cocotiers et le cap du
  Dragon. Côte nord-ouest au pied de la chaîne, avec un replat côtier ; anse de Jade (grande plage) sur la côte sud-est.
- **Grand Fleuve** : naît au pied du Mont des Lanternes (nord-est), traverse tout le pays sur 35 km (pente imposée
  ≈ 2,4 m/km, lit de 5 à 46 m), puis se divise après la fourche (`DELTA_FORK`) en quatre bras : le fleuve lui-même, le
  Bras des Singes, le Bras de la Lagune et le Bras des Sables (`from` : un bras part du lit de sa rivière mère). Dans le
  delta, les lits restent à 0,8 m au moins jusqu'à la bouche : la plaine ne passe jamais sous la mer.
- **Plaine des rizières** (`plainZone`) : bande presque plate de part et d'autre du fleuve, de la Bambouseraie au
  delta ; routes de digue droites et plates (`plainAt` dans `build.ts`).
- **Collines en terrasses** de part et d'autre de la plaine : Collines des Terrasses au sud-est, collines du Nord au
  pied de la chaîne, collines de l'est ; banquettes de 4,5 m qui suivent les courbes de niveau (`terraceZone`).
- **Chaîne de la Jungle** le long de la côte nord-ouest, qui se relève au nord-est en massif : Mont des Lanternes
  (temple, ≈ 640 m) et Mont du Tigre (stupa, ≈ 740 m), **col de la Jungle** (350 m) entre les deux. Le col a trois
  rampes régulières (`ramp`) : depuis la Bambouseraie, vers le port des Jonques et sur l'arête du temple.
- **Plateau des Théiers** (≈ 300 m) au sud du massif, entaillé par les **gorges du Dragon** (la rivière du Dragon finit
  dans la baie des Pitons) ; rampe régulière depuis Pont-des-Lianes.
- **Pitons** : une soixantaine de pains de sucre calcaires, surtout dans la baie, quelques-uns à terre loin des villes.
- **Lacs** : Lac des Lotus (ancien méandre du fleuve, au pied des collines du Nord), Lagune des Mangroves entre deux bras
  du delta, Étang des Nuages, deux mares.

| Lieu | Où | Caractère |
| --- | --- | --- |
| **Vat-Robert** | centre, rive sud du fleuve | bourg de départ, place du marché, critérium ; **Grand Temple** et stupa doré sur sa colline au sud |
| **Circuit des Rizières** | plaine, au sud-ouest de Vat-Robert | boucle plate de 3,6 km, tribunes, portique, drapeaux |
| **Les Pilotis** | bas fleuve, avant la fourche | maisons sur pilotis, **marché flottant** |
| **Les Mangroves** | delta | hameau au milieu des bras, lagune, pêcherie |
| **Rive-des-Lotus** | rive nord, Lac des Lotus | village, Monastère des Lotus |
| **Village-des-Nuages** | chaîne de la Jungle | village de montagne, route en lacets, maison de thé, cascade, bike park |
| **Les Terrasses** | collines du sud-est | rizières en terrasses, Pagode des Terrasses |
| **Plage-de-Jade** | anse de Jade (sud-est) | station balnéaire, promenade des Cocotiers, marché de nuit, port |
| **Les Pitons** | baie des Pitons | village de pêcheurs et port au milieu des pitons |
| **La Bambouseraie** | pied sud du col | hameau, départ des montées |
| **Col de la Jungle**, **Temple des Lanternes** | massif du nord-est | col à 350 m, temple au sommet, lanternes de la montée de nuit |
| **Port-des-Jonques** | côte nord du massif | port de pêche au pied de la descente nord du col |
| **Les Théiers**, **Pont-des-Lianes** | plateau et gorges du Dragon | théiers, séchoir, ruines du Palais, pont suspendu |
| **Ruines** | jungle | Prasat-Vert, Temple englouti du Dragon, Ruines du Fleuve, Fort du Dragon (cap) |

Occupation du sol (`land.ts`, `worker.ts`) : jungle dense sur tous les reliefs et en galeries le long des rivières,
mangroves le long des rivages du delta, rizières en terrasses, rizières de la plaine et du delta entre leurs diguettes,
théiers en rangs sur le plateau, vergers de bananiers, roche calcaire sur les falaises et les flancs des pitons, sable
blanc hors du delta.

## Réseau et parcours

- Routes : Tour des Rizières (côtier ; ses tronçons aux virages trop serrés deviennent des routes de montagne,
  `mountainSections`), grands axes depuis Vat-Robert (route du Fleuve jusqu'à Pont-des-Lianes, routes de Plage-de-Jade,
  des Terrasses, des Pilotis, de Rive-des-Lotus), routes communales, maillage de petites routes.
- Route du col : rampe directe depuis la Bambouseraie, lacets vers Port-des-Jonques et vers le Temple des Lanternes,
  chacune partant du col dans sa direction. Route des Nuages en lacets. Route des Gorges du Dragon au fond des gorges.
- Pistes cyclables : piste des Rizières, voies vertes du Fleuve et des Lotus, Vélo des Terrasses, promenade des Cocotiers.
- Chemins gravel et sentiers VTT (`TRAILS`, `SKIN`) : théiers, terrasses, delta, bambous, pitons, sables blancs,
  traversée, nuages, mangroves ; sentiers des Nuages, du Mont du Tigre, du Dragon, des Pitons, des Lotus, descente de la
  Jungle, cyclo-cross des Digues, bike park de la Jungle.
- Plafonds de pente du profil sous les limites de `verify.ts` (chemins roulants 19 %, sentiers 26 %, pistes cyclables
  6,6 %, routes 15,5 %) ; `easeKinks` adoucit aussi les virages des chemins ; `fillSags` comble aussi les creux des
  routes dessinées ; les chemins de ferme (`Chemin rural`) fautifs sont retirés comme le maillage (`pruneMesh`).
- **État des contrôles (27/11/2026) : `verify.ts` entièrement au vert** (tuiles, raccords, sol sous les routes,
  graphe, carrefours francs, terrassements, profils, pentes et rayons, bâtiments, 40 itinéraires).

### Parcours (40)

- Découverte : `decouverte-des-rizieres` (8,5 km, boucle plate dans les rizières autour de Vat-Robert).
- Classiques : `classique-des-terrasses` (route, 24 km, Vat-Robert → Terrasses → Plage-de-Jade → Pitons →
  Pont-des-Lianes), `classique-de-la-jungle` (gravel, 47 km, Rive-des-Lotus → bambous → Bambouseraie → gorges du Dragon).
- Chrono : `chrono-des-digues` (9 km, Vat-Robert → Les Pilotis, plat).
- Nuit : `temple-de-nuit` (7,2 km, montée au Temple des Lanternes, départ forcé à 23 h, lanternes le long de la route).
- Route : `anneau`, `criterium-de-vat-robert`, `boucle-de-vat-robert`, `col-de-la-jungle`, `mont-des-lanternes`,
  `col-par-les-jonques`, `montee-des-nuages`, `gorges-du-dragon`, `plateau-des-theiers` (montée), `corniche-des-pitons`,
  `golfe-et-terrasses` (anse de Jade et Terrasses), `delta-et-mangroves`, `tour-des-rizieres` (tour du monde, 91 km).
- Pistes cyclables : `promenade-de-plage-de-jade`, `piste-des-rizieres`, `voie-verte-du-fleuve`, `voie-verte-des-lotus`,
  `velo-du-lagon` (la Vélo des Terrasses).
- Gravel : `classique-de-la-jungle`, `gravel-des-nuages`, `gravel-des-theiers`, `gravel-des-terrasses`, `gravel-du-delta`,
  `gravel-des-bambous`, `gravel-des-mangroves`, `chemin-des-pitons`, `chemin-des-sables-blancs`, `grande-traversee`,
  `cyclo-cross-des-digues`.
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
pnpm exec tsx ../../tools/rizieres/src/sites-data.ts <dossier du monde>         # cotes du décor (lands/rizieresSites.ts)
```

Sans `ISLAND_OUT`, le générateur écrit `apps/client/public/worlds/rizieres` et publie le catalogue : à réserver à la
session qui régénère `worlds/index.json`. Les tuiles (`tiles/`) ne sont pas versionnées ; `carte.png` et `vignette.png`
le sont. Après un changement du relief ou du réseau, relancer `sites-data.ts` et recopier son bloc dans
`lands/rizieresSites.ts` (ports, rivières, plages, ponts, ruines, troupeaux, cascades), puis mettre à jour les lieux de
`lands/rizieres.ts`.

## Dans le jeu (mode Poly)

- Données du monde : `apps/client/src/world/lands/rizieres.ts` (titre, lieux de la carte, parcours en tête, lieux à
  découvrir, nom du Tour à étapes, thème, biome, circuit, restyle des bâtiments).
- Biome : arbres de jungle à la place des feuillus, bambous à la place des sapins (et hors des bois), herbe haute, ni
  boîtes aux lettres, ni poubelles, ni poules, ni vaches (les buffles du décor restent).
- Thème : rizières inondées vert tendre et vert d'eau toute l'année (jamais de blé blond), jungle très sombre, feuillage
  tropical très vert et profond, sable blanc, roche calcaire claire, pas de neige, eau de jade.
- Lumière (`theme.light`, 27/11/2026) : air chaud et humide, horizon vert-gris laiteux, brume (`haze` 1,4) qui étage
  les pitons en silhouettes de plus en plus pâles, lumière un peu dorée, couleurs un peu adoucies.
- Bâtiments : maisons en bois sombre (jamais de brique ni de crépi), toits de chaume ou de tuiles relevés à grands
  débords, temples rouge et or, stupas dorés, ruines moussues.
- Décor propre (`lands/rizieresSites.ts`) : ports de Plage-de-Jade, des Pitons et des Jonques ; tribunes du Circuit ;
  Grand Temple de Vat-Robert ; place du marché ; Temple des Lanternes et lanternes de la montée de nuit (Bambouseraie →
  col → temple) ; ruines envahies ; villages sur pilotis (fleuve, Lac des Lotus, lagune, Dragon) ; marché flottant ;
  barques sur le fleuve, le delta, le Bras de la Lagune et le Dragon ; ponts suspendus et passerelles ; buffles et hérons
  dans les rizières ; cocotiers ; bambous ; deux cascades ; bike park et cyclo-cross ; marché de nuit. Toutes les
  lanternes s'allument la nuit (`islandClock()`).
- Pitons de la plaine (`PLAIN_PITONS`, 27/11/2026) : 46 tours calcaires couvertes de jungle qui sortent des rizières,
  surtout en deux groupes (plaine des Digues, de Rive-des-Lotus au Circuit ; plaine de l'est, au sud de Vat-Robert),
  quelques-unes près du Lac des Lotus, des Pilotis et dans le delta. Rayon 42 à 105 m, hauteur 80 à 185 m, quatre formes
  (≈ 195 triangles chacune), vues jusqu'à 4,2 km ; pied à plus de 45 m de toute route, chemin, cours d'eau ou bâtiment.
  Une sur trois a une nappe de brume à son pied, marquée le matin. Les pitons de la baie restent dans le relief.
