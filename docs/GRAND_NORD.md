# Le Grand Nord robertien — monde du mode Poly

> Monde imaginaire, frère de l'île de Robert et du Pays de Robert, mais tourné vers le froid : une côte découpée de
> fjords profonds entre de hautes parois, le massif enneigé du Storfjell (≈ 1 150 et 1 250 m) et son glacier qui
> descend jusqu'à la mer, la toundra rousse du haut-plateau de Vidda et des Mille-Lacs, des forêts d'épicéas dans les
> vallées, des villages de bois rouges, jaunes et blancs, des cabanes de pêcheurs sur pilotis, un bac qui traverse un
> fjord, des rennes et des aurores boréales la nuit. Il est produit par `tools/grand-nord`, copie adaptée du
> générateur du Pays de Robert (`tools/massif`, qui n'est pas modifié), au même format que les mondes réels : le
> moteur l'affiche tel quel.

## Repère et taille

- Même emprise que l'île : x de −19 000 à 19 000 m, z de −13 000 à 13 000 m, tuiles de 1 km (988 tuiles), mer au niveau 0.
- Repère Lambert-93 fictif en mer (`originL93` 1 330 000 / 5 800 000) : ne recouvre ni une zone réelle ni un autre
  monde Poly. Les sorties sont annoncées comme virtuelles et prennent la météo de la ville du joueur.
- Tuiles de montagne : plus de 655 m de dénivelé dans une tuile, pas de quantification élargi (`stepM` de la tuile).

## Géographie

| Lieu | Où | Caractère |
| --- | --- | --- |
| **Nordrobert** | centre-ouest, plaine | bourg de départ, place, église de bois, critérium |
| **Circuit du Grand Nord** | au sud-ouest de Nordrobert | boucle plate de 3,6 km, tribunes, portique, drapeaux (sans voitures ni clôtures) |
| **Port-Boréal** | fond de la baie (sud) | petite ville portuaire : quai, promenade en bois, hangars à bateaux colorés sur la grève, halle aux poissons, hôtels de bois, port de pêche |
| **Skarvik** | presqu'île du sud-est | village de pêcheurs : cabanes sur pilotis, séchoirs à poisson, port, landes côtières |
| **Nordvik** | côte nord, au pied du col | village de pêcheurs au fond de sa vik : port, cabanes sur pilotis, séchoirs |
| **Col du Renne** | massif du nord | col à ≈ 680 m entre le Storfjell (≈ 1 160 m, belvédère des Aurores) et la Dent du Renne (≈ 1 250 m) ; lacets des deux versants, cairns, neige dès 650 m en été |
| **Rennesby** | pied sud du col | hameau, départ des montées du col et du belvédère |
| **Glacier de Robert** | versant nord de la Dent du Renne | langue de glace qui descend dans son auge jusqu'au fond du **fjord du Glacier** ; hameau d'**Isbrevik** sur la rive ouest |
| **Grand Fjord** | nord-ouest | long fjord sinueux qui tranche les monts du Nord ; parois presque à pic |
| **Fjord du Bac** | est | bac entre **Ferjeby** (rive nord) et **Utnes** (rive sud), cales, gares du bac |
| **Fjellheim** | monts du nord-ouest, ≈ 480 m | station : route en lacets, bike park, lac de Fjellheim |
| **Le Grand Lac** | au pied des monts | grand lac, **Vatnby** sur sa rive sud, église en bois sur la rive nord |
| **Gorges de la Renne** | est | la rivière garde le niveau de la plaine en entaillant le rebord du haut-plateau ; **Fossbru** au pont |
| **Haut-plateau de Vidda** | est, 400 à 570 m | toundra rase et rousse semée de lacs (Lac de Vidda, Lac Long, Lac Noir…), village de **Vidda**, station météo, antenne, rennes |
| **Les Mille-Lacs** | plateau du sud | toundra et lacs (Plongeons, Mousses, Lemming), cyclo-cross, rennes |
| **Delta de la Saumonée, Lagune des Cygnes** | ouest et sud-ouest | **Granlia** (vallée de résineux), **Myrbu**, fumoir à saumon, marais |
| **Phare du Cap Boréal** | cap de l'est | phare blanc à bandes rouges, feu tournant la nuit |

Relief (`design.ts`) : côte découpée (anses et pointes rocheuses, sauf au fond de la baie de Port-Boréal), trois fjords
dessinés comme des lignes (`FJORDS`, demi-largeur croissante du fond vers le large, parois où la montagne tombe presque
d'aplomb), monts du Nord (`CHAIN`, hauteur lissée entre tronçons), massif du Storfjell (deux sommets, selle creusée),
combe de la Vik jusqu'à Nordvik, auge en U du glacier (`GLACIER`), haut-plateau de Vidda, plateau des Mille-Lacs,
cuvette du Grand Lac. La distance aux fjords est mise en cache par blocs de 200 m (le relief la lit des millions de fois).
Occupation du sol (`land.ts`) : résineux dans les vallées jusqu'à la limite des arbres (≈ 450 m), bouleaux au bord de
l'eau, toundra rase sur les plateaux et au-dessus des forêts, rochers sur les sommets et les parois, prés de fauche dans
les fonds de vallée, grèves de galets, marais de Myrbu, glacier (champ `glacier`).
Bâtiments (`settle.ts`) : maisons de bois peintes (rouge de Falun, ocre, blanc) à toit pentu, églises de bois blanches,
fermes et granges rouges, hangars à bateaux sur la grève de Port-Boréal.

## Réseau et parcours

- Routes : tour du Grand Nord (coupé par le fjord du Glacier : la côte nord-est ne se rejoint pas par la côte), grands
  axes depuis Nordrobert, route des Gorges, routes communales, routes du Bac vers Vidda, maillage de petites routes,
  pistes cyclables (piste du Circuit, voies vertes de la Saumonée et du Grand Lac), promenade de Port-Boréal ; la
  Vélo de la Baie emprunte les petites routes (les Mille-Lacs sont trop raides pour une piste à 7 %).
- Routes de montagne en lacets (`climb.ts`) : col du Renne (deux versants), route du Belvédère, route de Fjellheim.
- Chemins gravel et sentiers VTT (`TRAILS`, `SKIN`) : Vidda, Mille-Lacs, Saumonée, Pêcheurs, Galets, Toundra,
  Marais ; Lemmings, Bouleaux, Dent du Renne, descente du Renne, Gorges, Skarvik, Grand Lac, cyclo-cross de la
  Toundra, bike park de Fjellheim.
- Un parcours n'est publié que s'il passe les contrôles (`routeFlaw` dans `build.ts`, mêmes règles que `verify.ts`) ;
  un parcours impossible ou écarté est signalé dans le journal de construction (avec l'endroit du défaut).

Parcours (40, tous avec `nameEn`) :

| Genre | Parcours |
| --- | --- |
| Découverte (en tête) | `decouverte-du-grand-nord` (≈ 8,9 km, de Nordrobert vers le Circuit) |
| Classiques | `classique-des-fjords` (route, 62 km de Port-Boréal à Isbrevik par le col du Renne), `classique-de-la-toundra` (gravel, 21 km de Granlia aux Mille-Lacs) |
| Contre-la-montre | `chrono-du-fjord` (Nordvik → Isbrevik, 9,5 km), `chrono-de-la-saumonee` (Nordrobert → Granlia, 10,5 km) |
| Nuit (départ à 23 h) | `aurores-de-nuit` : montée de Rennesby au belvédère des Aurores (10,6 km, ≈ 900 m D+, KOM) |
| Montées (KOM) | `col-du-renne`, `col-du-renne-par-nordvik`, `montee-de-fjellheim`, `grand-tour-du-col` |
| Circuit, critérium | `anneau` (Circuit du Grand Nord, 3,6 km), `criterium-de-nordrobert` |
| Tour du monde | `tour-du-grand-nord` (106 km : Port-Boréal, Myrbu, Granlia, Vatnby, Rennesby, Fossbru, Vidda, Utnes, Skarvik) |
| Autres routes | `boucle-de-nordrobert`, `route-des-pecheurs`, `haut-plateau-de-vidda`, `baie-et-mille-lacs`, `marais-de-myrbu`, `route-du-bac`, `gorges-de-la-renne` |
| Pistes et voies vertes | `promenade-de-port-boreal`, `piste-du-circuit`, `voie-verte-de-la-saumonee`, `voie-verte-du-grand-lac`, `velo-de-la-baie` |
| Gravel | `classique-de-la-toundra`, `gravel-de-vidda`, `gravel-des-mille-lacs`, `gravel-de-la-saumonee`, `gravel-des-marais`, `chemin-des-pecheurs`, `chemin-des-galets`, `cyclo-cross-de-la-toundra` |
| VTT | `vtt-des-lemmings` (descente), `vtt-de-la-dent-du-renne`, `descente-du-renne`, `vtt-des-gorges`, `vtt-de-skarvik`, `vtt-du-grand-lac`, `vtt-des-bouleaux`, `bike-park-de-fjellheim` |

Écarts au Pays de Robert : pas de « secondary » (les grandes routes sont des « tertiary » : en terrain accidenté leurs
virages restaient sous 7,5 m de rayon) ; profils plafonnés sous les seuils des contrôles (route 14,5 %, piste 5,8 %,
chemin gravel 18,5 %) ; creux de plus de 7 cm sur 16 m comblés après le lissage ; dans le graphe, premier et dernier
pas d'un tronçon recoupés à ≈ 2 m et remis en pente régulière vers le nœud ; un parcours écarté signale l'endroit du
défaut. Mise au point : `ISLAND_DEBUG_SAG=1` liste les creux du graphe, `VERIFY_ALL=1` tous les défauts des contrôles.

## Générer

```
cd apps/server
ISLAND_OUT='D:/zzCACHE_ALLEZROBERT/zones-travail/grand-nord' ISLAND_THREADS=4 pnpm exec tsx ../../tools/grand-nord/src/build.ts
ISLAND_PLAN=1 …                                    # tracé seul (≈ 2 à 4 min), écrit aussi net.json pour la mise au point
pnpm exec tsx ../../tools/grand-nord/src/verify.ts # contrôles du monde installé (apps/client/public/worlds/grand-nord)
pnpm exec tsx ../../tools/grand-nord/src/map.ts --px 25 --out ../client/public/worlds/grand-nord/carte.png
pnpm exec tsx ../../tools/grand-nord/src/map.ts --px 40 --style flat --out ../client/public/worlds/grand-nord/vignette.png
```

`ISLAND_OUT` est obligatoire pour un essai : sans lui, le générateur écrit dans `apps/client/public/worlds/grand-nord` et
met à jour le catalogue partagé. Les tuiles (`tiles/`) ne sont pas versionnées ; `carte.png` et `vignette.png` le sont.

## Dans le jeu (mode Poly)

- Données du monde (titre, lieux de la carte, parcours en tête, lieux à découvrir, nom du Tour à étapes, thème) :
  `apps/client/src/world/lands/grand-nord.ts`. Lieux à découvrir gardés dans `ar.found.grand-nord`.
- Thème : sol vert-brun froid, toundra rousse (vive en automne), neige dès 650 m en été (450 au printemps, 500 en
  automne, partout en hiver), givre en hiver (0,9) et un peu au printemps, feuillage sombre (bouleaux jaunes en
  automne), eau bleu-gris, grève de galets gris, roche sombre, limite des arbres à 450 m.
- Bâtiments : toits pentus et débordants, bois peint, toits sombres ou de tourbe (`grandNordBuilding`).
- Décor propre (`world/lands/grand-nordSites.ts`) : ports de Port-Boréal, Skarvik et Nordvik ; bac animé qui traverse
  le fjord du Bac (quatre minutes l'aller-retour) et rampes des cales ; cabanes de pêcheurs sur pilotis et séchoirs à
  poisson des villages ; cabanes de pêche et pontons au bord des lacs de la toundra ; troupeaux de rennes (un groupe en
  marche) ; langue de glace du glacier (crevasses, séracs) ; phare du cap Boréal et son feu tournant la nuit ; cairns du
  col et des sommets, belvédère des Aurores ; tribunes, portique et drapeaux du Circuit ; balisage, tremplins et
  portique du bike park de Fjellheim ; piquets, rubalise et tentes du cyclo-cross de la Toundra ; **aurores boréales**
  la nuit (rubans verts et violets additifs, animés, au nord du coureur, dès que la nuit dépasse 0,3).
- Ni clôtures ni poteaux sur la promenade de Port-Boréal, les quais et les cales du bac (`grandNordNoFence`).
