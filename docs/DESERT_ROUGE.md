# Le Désert rouge — monde du mode Poly

> Monde imaginaire, comme l'île de Robert et le Pays de Robert, mais désertique : un plateau ocre et rouge bordé de
> falaises sur presque toute sa côte, un canyon de plus de 300 m creusé par l'Oued Rouge (route au fond, route de
> corniche au bord), des mesas et des buttes à sommet plat et parois verticales, des arches de pierre, le Grand Erg et
> ses cordons de dunes rouge orangé, le Chott Blanc (lac salé à sec, sel au sol), des oasis et leurs palmeraies, des
> villages en terre crue et une citadelle, le col des Vents (≈ 897 m, KOM) et une petite ville blanche au bord de la
> mer. Il est produit par `tools/desert-rouge`, copie adaptée de `tools/massif` (le générateur du Pays de Robert, qui
> n'est pas modifié), au même format que les mondes réels : le moteur l'affiche tel quel.

## Repère et taille

- Même emprise que l'île : x de −19 000 à 19 000 m, z de −13 000 à 13 000 m, tuiles de 1 km (988 tuiles), mer au niveau 0.
- Repère Lambert-93 fictif en Méditerranée, au sud-est de la Corse (`originL93` 1 330 000 / 5 700 000) : ne recouvre
  ni une zone réelle ni un autre monde Poly. Les sorties sont virtuelles et prennent la météo de la ville du joueur.
- Hors limites : la mer, comme pour les autres mondes (le générateur et l'écran de carte la supposent).

## Géographie

| Lieu | Où | Caractère |
| --- | --- | --- |
| **Rocherouge** | centre-ouest | bourg de départ, place, critérium, départ de la découverte |
| **La Piste Droite** | de Rocherouge vers Sablons | 7,3 km en ligne droite, à plat (couloir aplani dans le reg), chrono |
| **Chott Blanc** | au pied des Monts de Braise | lac salé à sec, cuvette plate et blanche ; le **Circuit du Chott** (3,6 km, tribunes) y est posé |
| **Puits-Salé** | rive sud du chott | village en terre crue, puits ; caravansérail à l'est |
| **La Grande Mesa** | ouest | mesa de 300 m aux parois verticales ; rampe au sud-est, route en lacets jusqu'à **Mesa-Haute** |
| **Monts de Braise** | nord | chaîne rocheuse ; massif du Vautour (Pic du Vautour ≈ 1 390 m, observatoire ; la Dent Rouge) |
| **Col des Vents** | entre les deux sommets | ≈ 897 m, lacets des deux versants, cairns ; descente vers **Port-Vent** |
| **Les Cairns** | pied sud du col | hameau, départ de la montée et de la route du Canyon |
| **Canyon de l'Oued Rouge** | est | l'oued garde le niveau du bas pays sous le Plateau des Canyons : fond plat de 100 m, parois presque verticales, 200 à 400 m de profondeur |
| **Plateau des Canyons** | est | **Ksar-Rouge** et la **Citadelle Rouge** (enceinte, tours, donjon) ; corniche au bord du canyon |
| **Le Gué** | sortie sud du canyon | hameau au bord de l'oued |
| **Les Buttes Rouges** | entre Rocherouge et les monts | dix buttes à sommet plat, bike park, arches de pierre |
| **Le Grand Erg** | ouest et sud-ouest | cordons de dunes (≈ 20 m) ; **Oasis des Dunes**, cyclo-cross des Sables ; **Sablons** au nord |
| **L'Oasis** | collines Fauves, au sud | source turquoise, palmeraie irriguée, tour |
| **Port-Corail** | fond du golfe de Corail (sud) | petite ville blanche : boulevard, promenade en bois, hôtels, halle aux poissons, port |
| **Cap-Brique** | presqu'île des Falaises Rouges (sud-est) | port de pêche entre les falaises |
| **Lagune des Flamants, Les Salines** | côte ouest | lagune peu profonde, salines |

Relief (`design.ts`) : côte surtout en falaises (`cliffinessExact` : falaise par défaut, plages au golfe, à la côte
des Dunes et à la lagune), Monts de Braise (`CHAIN`), massif du Vautour (deux sommets, selle creusée, socle relevé :
col ≈ 897 m), vallée de Port-Vent, Plateau des Canyons (`PLATEAU`), mesas et buttes (`MESAS` : sommet plat, paroi,
éboulis, rampe de la Grande Mesa), Grand Erg (`ERG` : cordons de dunes), Chott Blanc (`CHOTT` : cuvette aplanie),
couloir de la Piste Droite (`PISTE`). Canyon : `floor` (fond plat) et `drop` (lit abaissé vers le bas pays) des oueds.
Occupation du sol (`land.ts`) : sol nu ocre partout, palmeraies et jardins irrigués autour des oasis et le long des
oueds (`orchard`, `farmland`), tamaris et acacias épars, sable (`sand`) de l'erg et des plages, roche rouge sur les
parois et les sommets, sel du chott (`quarry` : sol clair).
Bâtiments (`settle.ts`) : toits plats partout, terre crue ocre ou rouge, chaux blanche à Port-Corail et dans les ports,
quelques tours (pigeonniers, tours de guet), maisons communes à haute tour carrée, Citadelle Rouge, caravansérail.

## Réseau et parcours

- Routes : tour du désert, grands axes depuis Rocherouge, La Piste Droite (route dessinée), route du Canyon (au fond,
  le long de l'oued), route de la Corniche (au bord du canyon, côté est), routes communales, maillage de petites routes,
  pistes cyclables (piste du Chott, voies vertes des Sablons et du Chott, Vélo du Golfe), promenade de Port-Corail.
- Routes en lacets (`climb.ts`) : col des Vents (deux versants), route de l'Observatoire, route de la Grande Mesa.
- Pistes gravel et sentiers VTT (`TRAILS`, `SKIN`) ; cyclo-cross des Sables et bike park des Buttes : boucles dessinées
  (forme sinueuse), raccordées au réseau, parcours tirés de la boucle elle-même.
- Un parcours n'est publié que s'il passe les contrôles (`routeFlaw` dans `build.ts`, mêmes règles que `verify.ts`).

Parcours publiés (voir le journal de construction pour les longueurs) :

- Découverte : `decouverte-du-desert` (≈ 9 km autour de Rocherouge, par le début de la Piste Droite).
- Classiques : `classique-des-canyons` (route : fond du canyon, Les Cairns, corniche, Ksar-Rouge), `classique-des-dunes`
  (gravel, piste des Dunes dans l'erg).
- Chrono : `chrono-de-la-piste-droite` (7,3 km en ligne droite, plat).
- Nuit : `mesa-de-nuit` (montée de la Grande Mesa, départ forcé à 23 h par le jeu).
- Circuit fermé : `circuit-du-chott` ; critérium : `criterium-de-rocherouge`.
- Montées avec KOM : `col-des-vents`, `col-par-port-vent`, `pic-du-vautour`, `montee-de-la-grande-mesa`.
- Tour du monde : `tour-du-desert`.
- Route : `route-du-canyon`, `corniche-du-canyon`, `corniche-des-falaises`, `plateau-du-ksar`,
  `golfe-et-oasis`, `lagune-et-salines`, `tour-du-chott`, `boucle-de-rocherouge`, `route-des-dunes`.
- Pistes cyclables : `promenade-de-port-corail`, `piste-du-chott`, `voie-verte-des-sablons`, `voie-verte-du-chott`, `velo-du-golfe`.
- Gravel : `classique-des-dunes`, `gravel-de-la-mesa`, `gravel-du-plateau`, `gravel-de-la-palmeraie`, `gravel-des-buttes`,
  `chemin-des-falaises`, `chemin-de-la-pointe`, `grande-traversee`, `cyclo-cross-des-sables`.
- VTT : `vtt-des-monts-de-braise`, `vtt-de-la-dent-rouge`, `descente-du-vautour` (descente), `vtt-du-canyon`,
  `vtt-des-falaises`, `vtt-des-arches`, `bike-park-des-buttes`.

## Générer

Depuis `apps/server` (pour tsx) :

```
ISLAND_OUT='D:/zzCACHE_ALLEZROBERT/zones-travail/desert-rouge' ISLAND_THREADS=4 pnpm exec tsx ../../tools/desert-rouge/src/build.ts   # essai ailleurs
ISLAND_PLAN=1 …                                                                   # tracé seul (≈ 1 min)
ISLAND_DEBUG=1 …                                                                  # détails des défauts (bouts de routes, col)
pnpm exec tsx ../../tools/desert-rouge/src/verify.ts                              # contrôles du monde installé
pnpm exec tsx ../../tools/desert-rouge/src/map.ts --px 25 --out ../client/public/worlds/desert-rouge/carte.png
pnpm exec tsx ../../tools/desert-rouge/src/map.ts --px 40 --style flat --out ../client/public/worlds/desert-rouge/vignette.png
```

Sans `ISLAND_OUT`, `build.ts` écrit dans `apps/client/public/worlds/desert-rouge` et publie le monde au catalogue
(`catalogue.ts`). Les tuiles (`tiles/`) ne sont pas versionnées ; `carte.png` et `vignette.png` le sont.

## Dans le jeu (mode Poly)

- Module du monde : `apps/client/src/world/lands/desert-rouge.ts` (titre, lieux de la carte, parcours en tête, lieux à
  découvrir, nom du Tour, thème, circuit, restyle des bâtiments, pas de clôtures sur le chott, l'erg et la promenade).
- Thème : sol ocre (`meadow` #c47a45), terre rouge (`dirt` #a8562e), palmeraies vert sombre (`field`), sable rouge
  orangé, roche rouge brique (#9c4a2c), pas de neige ni de givre, feuillage vert olive poussiéreux, eau turquoise.
- Décor propre (`world/lands/desert-rougeSites.ts`) : palmiers (gabarit low poly) et palmeraies des deux oasis, puits,
  abreuvoirs, tentes, dromadaires couchés, deux caravanes de dromadaires qui marchent, cinq arches de pierre, cactus,
  touffes sèches, buissons morts et cailloux semés par carrés de 2 km autour du coureur, croûte de sel du Chott Blanc,
  tribunes et portique du Circuit, montgolfières au-dessus du canyon au lever du jour (5 h 30 à 10 h 30, heure du monde
  par `islandClock()`), bike park des Buttes (virages relevés, tremplins, tour de départ), cyclo-cross des Sables
  (piquets, rubalise, bottes, tentes), dôme de l'observatoire, cairns du col, puits et palmiers des villages, ports.
