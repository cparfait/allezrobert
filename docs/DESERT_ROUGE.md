# Le Désert rouge — monde du mode Poly

> Monde imaginaire, comme l'île de Robert et le Pays de Robert, mais désertique et d'une tout autre forme : **un
> croissant de terre rouge** ouvert au sud sur le golfe de Corail. Le **Grand Canyon de l'Oued Rouge** le parcourt
> d'une corne à l'autre ; la corne ouest est une **mer de dunes** (le Grand Erg, un tiers du monde), la corne est un
> **haut plateau en gradins** coiffé du massif du Vautour. Des **oasis éparses** sont reliées en étoile au Puits de
> l'Étoile ; le **Chott Blanc** (lac salé à sec) porte le Circuit du Chott. Villages en terre crue à toits plats,
> citadelle, petite ville blanche au fond du golfe. Il est produit par `tools/desert-rouge`, copie adaptée de
> `tools/massif` (le générateur du Pays de Robert, qui n'est pas modifié), au même format que les mondes réels.

## Repère et taille

- Même emprise que les autres mondes Poly : x de −19 000 à 19 000 m, z de −13 000 à 13 000 m, tuiles de 1 km
  (988 tuiles), mer au niveau 0.
- Repère Lambert-93 fictif en Méditerranée, au sud-est de la Corse (`originL93` 1 330 000 / 5 700 000).
- Le croissant suit un arc de cercle (`ARC` dans `design.ts`) : centre (0, 11 700), dans le golfe, rayon 17 km ; un
  lieu se repère par son angle `t` (compté depuis le nord, positif vers l'est) et son rayon (`polar(t, r)`). Les cornes
  sont à t = −1,05 (ouest) et t = 1,12 (est). Demi-largeur des terres `halfWidth(t)` : 5,8 km au milieu, 2,1 à 2,9 km
  aux cornes. Rivage : `shoreDist` (distance à l'arc, bruit, caps et anses, calme devant les ports), mis en grille de
  20 m ; `coastPoint(t, inset, side)` donne un point du rivage nord (`side` = 1) ou du golfe (`side` = −1).

## Géographie

| Lieu | Où | Caractère |
| --- | --- | --- |
| **Grand Canyon de l'Oued Rouge** | tout le long du croissant | de la source (corne est) à la mer (corne ouest), ≈ 36 km ; fond plat de 100 m, parois en quatre gradins, 130 à 170 m de profondeur à l'est, 40 à 60 m dans l'erg |
| **Les brèches** | quatre passages | Gué des Sables (t = −0,92), Brèche de l'Erg (−0,55), Brèche du Centre (−0,02) : rampes de 5 à 6 % taillées dans les parois ; **Les Lacets du Canyon** (0,55) : rampe de 20 % montée en lacets des deux côtés |
| **Plateaux en gradins** | centre et corne est | paliers de 45 m, contremarches tantôt raides, tantôt adoucies en rampes ; le plateau monte de ≈ 60 m (erg) à ≈ 400 m (est) |
| **Le Grand Erg** | corne ouest (un tiers du monde) | cordons de dunes (≈ 22 m) jusqu'à la mer sur la côte des Dunes ; **Sablons**, **Oasis des Dunes**, **Les Salines** |
| **La Piste Droite** | à travers l'erg, de Puits-Salé à Sablons | 6,1 km en ligne droite, à plat (couloir aplani), chrono |
| **Chott Blanc** | au bord de l'erg, côté golfe | lac salé à sec ; le **Circuit du Chott** (3,6 km, tribunes) y est posé ; caravansérail au nord |
| **Rocherouge** | au-dessus de Port-Corail | bourg de départ, place, critérium, départ de la découverte |
| **Port-Corail** | fond du golfe | petite ville blanche : boulevard, promenade en bois, hôtels, halle aux poissons, port |
| **Le Puits de l'Étoile** | plateau nord, en face de la Brèche du Centre | hameau, caravansérail, oasis ; sept pistes gravel en étoile vers les oasis et les villages |
| **Port-Vent** | anse de la côte nord | port de pêche au pied des falaises rouges |
| **La Grande Mesa** | plateau nord-ouest | mesa de 260 m aux parois verticales ; rampe à l'est, route en lacets jusqu'à **Mesa-Haute** |
| **Les Cairns** | plateau nord, au bord du canyon | hameau, route de la Corniche, oasis des Cairns |
| **Massif du Vautour** | corne est | Pic du Vautour (≈ 840 m, observatoire, route en lacets), Tête du Vautour, Guelta du Vautour |
| **L'Oasis** | côté golfe, à l'est | source turquoise, grande palmeraie |
| **Ksar-Rouge** | haut plateau, côté golfe | village et **Citadelle Rouge** (enceinte, tours, donjon) |
| **Cap-Brique** | anse au fond est du golfe | port de pêche sous les falaises du Levant |
| **Les Buttes Rouges** | entre Rocherouge et L'Oasis | dix buttes à sommet plat, bike park, arches de pierre ; la Dent Rouge et la Mesa du Lion plus loin |
| **Buttes témoins** | plaine et plateau, du Chott au Vautour | dix-sept tours à sommet plat et aiguilles dressées seules sur la plaine (70 à 150 m, cône d'éboulis au pied) : La Sentinelle, L'Aiguille Rouge, Le Château Rouge, L'Enclume, La Butte du Corbeau, La Chandelle, Le Vieux Fort, La Table du Couchant… |

**Identité (27/11/2026) : le Sud-Ouest américain** (Utah, Arizona), sans reproduire aucun lieu : buttes et mesas
isolées sur une plaine plate, roche rouge-orangé en strates (bandes crème de temps en temps, corniche claire), sable
clair des dunes, longues routes droites, yuccas, armoises, grands cactus à bras, arbres à pompons, ranchs à éolienne de
pompage, troupeaux menés par des cavaliers, virevoltants, lumière chaude et sèche, couleurs franches. Les buttes
témoins (`SENTINEL_SPOTS` dans `design.ts`) sont posées à plus de 500 m de toute route, sur un sol plat : aucun tracé
n'a changé. Leur talus d'éboulis porte 30 % de la hauteur (`skirt` des mesas, 16 % par défaut).

Relief (`design.ts`) : rivage (`shoreDist`, `cliffAt` : falaises sur la côte nord sauf l'anse de Port-Vent et la côte
des Dunes, plages dans le golfe, falaises du Levant au fond est du golfe), plateau incliné (`TILT`) et gradins
(`base`), massif du Vautour (`MASSIF`), mesas et buttes (`MESAS`), Grand Erg (`ERG`, `ergMask`), Chott Blanc
(`CHOTT`), couloir de la Piste Droite (`PISTE`), canyon (`RIVERS` : `floor`, `drop`, parois en gradins dans `carve`),
brèches (`BREACHES`, `breachFrames`). Aucun lac d'eau douce : six petites sources d'oasis et la guelta.
Occupation du sol (`land.ts`) : sol nu ocre partout ; palmiers et jardins irrigués **seulement autour des sources**
(`orchard`, `farmland`) ; sable de l'erg et des plages, roche rouge sur les parois et les sommets, sel du chott et des
Salines (`quarry`).
Bâtiments (`settle.ts`) : terre crue ocre, toits plats en terrasse ; les maisons sont écrites en nature `hut` (le jeu
n'y pose ni boîtes aux lettres, ni poubelles, ni poules) ; chaux blanche à Port-Corail ; tours de guet, maisons
communes à haute tour, Citadelle Rouge, caravansérails du Chott et de l'Étoile.

## Réseau et parcours

- Routes : tour du désert (côte nord, corne est, golfe, retour par le Gué des Sables), route du Corail et route de la
  Brèche (Port-Corail, Rocherouge, Puits de l'Étoile, Port-Vent), Piste Droite (route dessinée), route du Canyon (au
  fond, des Lacets à la Brèche de l'Erg), route de la Corniche (bord nord), routes du golfe et du plateau, maillage de
  petites routes, pistes cyclables (piste du Chott, voies vertes des Sablons et du Chott, Vélo du Golfe), promenade.
- Routes en lacets (`climb.ts`) : Les Lacets du Canyon (deux versants), route de l'Observatoire, route de la Grande Mesa.
- Pistes de l'Étoile (`STAR`), pistes gravel et sentiers VTT (`TRAILS`, `SKIN`) ; cyclo-cross des Sables et bike park
  des Buttes : boucles dessinées, parcours tirés de la boucle elle-même.
- Un parcours n'est publié que s'il passe les contrôles (`routeFlaw` dans `build.ts`, mêmes règles que `verify.ts`).

Parcours publiés (39, tous au vert ; longueurs de la construction du 27/11/2026) :

- Découverte : `decouverte-du-desert` (11 km : Rocherouge, le Chott Blanc, le caravansérail).
- Classiques : `classique-des-canyons` (route, 50 km : Port-Corail, Brèche du Centre, Puits de l'Étoile, Les Cairns,
  Lacets du Canyon, L'Oasis), `classique-des-dunes` (gravel, 9 km dans l'erg).
- Chrono : `chrono-de-la-piste-droite` (6,1 km en ligne droite, plat).
- Nuit : `mesa-de-nuit` (montée de la Grande Mesa, départ forcé à 23 h par le jeu).
- Circuit fermé : `circuit-du-chott` (3,6 km) ; critérium : `criterium-de-rocherouge` (1,7 km).
- Montées avec KOM : `lacets-du-canyon`, `pic-du-vautour` (≈ 570 m de dénivelé), `grande-montee-du-vautour` (les
  Lacets puis l'Observatoire), `montee-de-la-grande-mesa`.
- Tour du monde : `tour-du-desert` (95 km : golfe, corne est, côte nord, erg).
- Route : `route-du-canyon` (20 km au fond), `corniche-du-canyon`, `corniche-des-falaises`, `plateau-du-ksar`,
  `golfe-et-oasis`, `salines-et-sablons`, `tour-du-chott`, `boucle-de-rocherouge`, `route-des-dunes`.
- Pistes cyclables : `promenade-de-port-corail`, `piste-du-chott`, `voie-verte-des-sablons`, `voie-verte-du-chott`,
  `velo-du-golfe`.
- Gravel (8) : `classique-des-dunes`, `gravel-de-l-etoile` (pistes en étoile), `gravel-des-oasis`, `gravel-de-la-mesa`,
  `chemin-des-falaises`, `chemin-de-la-pointe`, `grande-traversee` (par le Gué des Sables), `cyclo-cross-des-sables`.
- VTT (6) : `vtt-du-vautour`, `vtt-de-la-dent-rouge`, `descente-du-vautour` (descente), `vtt-du-canyon`,
  `vtt-des-arches`, `bike-park-des-buttes`.

Contrôles propres au Désert rouge dans `build.ts` : après les raccords, les petites routes du maillage restées trop
raides sont retirées (et le graphe refait) ; les bâtiments qui ne reposent plus sur le sol final sont retirés. Dans
`settle.ts`, un bâtiment reste à distance du bord des falaises et du bord des gradins.

## Générer

Depuis `apps/server` (pour tsx) :

```
ISLAND_OUT='D:/zzCACHE_ALLEZROBERT/zones-travail/desert-rouge' ISLAND_THREADS=4 pnpm exec tsx ../../tools/desert-rouge/src/build.ts   # essai ailleurs
ISLAND_PLAN=1 …                                                                   # tracé seul (≈ 2 min)
ISLAND_DEBUG=1 …                                                                  # détails des défauts
pnpm exec tsx ../../tools/desert-rouge/src/probe.ts --px 25 --graph <dossier>/graph.json --out aperçu.png   # relief et réseau
pnpm exec tsx ../../tools/desert-rouge/src/verify.ts [<dossier>]                   # contrôles (monde installé par défaut)
pnpm exec tsx ../../tools/desert-rouge/src/map.ts [--dir <dossier>] --px 25 --out ../client/public/worlds/desert-rouge/carte.png
pnpm exec tsx ../../tools/desert-rouge/src/map.ts [--dir <dossier>] --px 40 --style flat --out ../client/public/worlds/desert-rouge/vignette.png
```

Sans `ISLAND_OUT`, `build.ts` écrit dans `apps/client/public/worlds/desert-rouge` et publie le monde au catalogue
(`catalogue.ts`). Les tuiles (`tiles/`) ne sont pas versionnées ; `carte.png` et `vignette.png` le sont.

## Dans le jeu (mode Poly)

- Module du monde : `apps/client/src/world/lands/desert-rouge.ts` (titre, lieux de la carte, parcours en tête, lieux à
  découvrir, nom du Tour, thème, biome, circuit, restyle des bâtiments, clôtures).
- Biome : palmiers à la place des feuillus, cactus à la place des sapins, presque pas d'herbe (0,08), ni bétail ni
  mobilier de village européen.
- Bâtiments : terre crue ocre (les rouges brique ramenés vers l'ocre), murs pleins sans volets (rendu en nature
  `ruins` : portes de bois), terrasses de la couleur des murs ; maisons blanches du bord de mer inchangées.
- Clôtures : nulle part, sauf autour des oasis (jardins de la palmeraie).
- Thème : plaine rouge-orangé (`meadow` #c97745 l'été), terre battue ocre près des maisons (`urban`), terre rouge
  (`dirt`), champs en vert palmeraie (seulement autour des sources), sable clair (#d09062 / #ecc594), roche rouge
  (#a8482a), pas de neige ni de givre, eau turquoise. Lumière (`theme.light`) : pas de brume en plus, chaleur 0,45,
  saturation 1,14. Pas de teinte d'horizon : `environment.ts` la mêle au brouillard à toute heure, la nuit comprise
  (il faudrait l'atténuer la nuit pour donner au désert un horizon bleu pâle de jour).
- Décor propre (`world/lands/desert-rougeSites.ts`) : palmeraies des six oasis avec un ranch (éolienne de pompage dont
  le rotor tourne, réservoir, abreuvoir, chevaux à l'attache, feu de camp), guelta du Vautour, deux troupeaux de vaches
  à longues cornes menés par deux cavaliers, virevoltants qui roulent au vent près des routes (carrés de 1 km, 2 à 4
  chacun), cinq arches de pierre, armoises, yuccas, grands cactus, touffes sèches et cailloux semés par carrés de 2 km,
  croûte de sel du Chott Blanc, tribunes du Circuit,
  montgolfières au-dessus du Grand Canyon au lever du jour (heure du monde par `islandClock()`), bike park des Buttes,
  cyclo-cross des Sables (barnums), dôme de l'observatoire, cairns de la Tête du Vautour, puits, palmiers et éolienne des
  villages, ports.
