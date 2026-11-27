# Le Grand Nord robertien — monde du mode Poly

> Monde imaginaire, frère de l'île de Robert et du Pays de Robert, mais tourné vers le froid : un pays de montagnes
> en étoile, entaillé de fjords profonds et étroits qui rayonnent depuis la calotte de glace du centre, un
> haut-plateau de toundra semé de dizaines de lacs, un strandflat bas et ses îlots, des villages de bois rouges,
> jaunes et blancs au fond des fjords, des cabanes de pêcheurs sur pilotis, un bac qui traverse un fjord, des rennes
> et des aurores boréales la nuit. Il est produit par `tools/grand-nord`, copie adaptée du
> générateur du Pays de Robert (`tools/massif`, qui n'est pas modifié), au même format que les mondes réels : le
> moteur l'affiche tel quel.

## Repère et taille

- Même emprise que l'île : x de −19 000 à 19 000 m, z de −13 000 à 13 000 m, tuiles de 1 km (988 tuiles), mer au niveau 0.
- Repère Lambert-93 fictif en mer (`originL93` 1 330 000 / 5 800 000) : ne recouvre ni une zone réelle ni un autre
  monde Poly. Les sorties sont annoncées comme virtuelles et prennent la météo de la ville du joueur.
- Tuiles de montagne : plus de 655 m de dénivelé dans une tuile, pas de quantification élargi (`stepM` de la tuile).

## Géographie

Refaite le 26/11/2026 pour ne plus rien devoir au Pays de Robert : un pays de montagnes en forme d'étoile, entaillé de
toutes parts par des fjords qui rayonnent depuis la calotte de glace du centre.

| Lieu | Où | Caractère |
| --- | --- | --- |
| **Calotte de Robert** | centre | dôme de glace (≈ 1 080 m) ; le **glacier de Robert** en descend jusqu'au fond du **fjord du Glacier** |
| **Massif du Storfjell** | à l'est de la calotte | le Storfjell (belvédère des Aurores) et la Dent du Renne ; **col du Renne** entre les deux, lacets des deux versants |
| **Haut-plateau de Vidda** | sud-est, ≈ 230 m | toundra rase semée de 34 petits lacs ; **Nordrobert** (bourg de départ, critérium), **Vidda**, **Les Mille-Lacs**, **Circuit du Grand Nord**, station météo, antenne, rennes |
| **Rennesby** | rebord nord du plateau | hameau, départ des montées du col et du belvédère |
| **Fjords** (7) | tout autour | Storfjord (nord-est, ≈ 12 km), Grand Fjord (ouest), fjord du Bac (est), fjord de Fjellheim (nord-ouest), fjord du Glacier (nord), fjord de Skarvik (sud-est), Sørfjord (sud) ; parois presque à pic |
| **Viks** (9) | entre les fjords | petites anses étroites et profondes : la côte est découpée partout |
| **Villages au fond des fjords** | | **Nordvik** (Storfjord, port), **Vatnby** (Grand Fjord), **Fossbru** (fjord du Bac), **Fjellheim** (bike park, montée de la Calotte), **Skarvik** (port), **Sørvik**, **Isbrevik** (rive est du fjord du Glacier, face au front de glace) |
| **Bac** | fjord du Bac | entre **Ferjeby** (rive sud) et **Utnes** (rive nord), cales, gares du bac ; route des deux rives par Fossbru |
| **Strandflat** | sud-ouest | plate-forme côtière basse : tourbières, landes, îlots ; **Port-Boréal** (seule ville : quai, promenade en bois, hangars à bateaux, halle aux poissons, port), **Myrbu**, **Granlia** |
| **Skerries et îles** | au large | semis d'îlots rocheux (surtout devant le strandflat) ; îles de Hvalø, Ytterøy, Kvitøy et Fyrøy |
| **Vallées** | | vallée du Grand Fjord (la Saumonée), vallée de la Myra, gorges de la Renne, vallées de Sørvik et de Skarvik, col de Vatnby, vallée des Lemmings, combe de Nordvik |
| **Phare du Cap Boréal** | côte est | phare blanc, feu tournant la nuit |

Relief (`design.ts`) : contour dessiné en coordonnées polaires (18 rayons, spline périodique) et découpé à toutes les
échelles (sauf l'anse de Port-Boréal) ; fjords et viks dessinés comme des lignes (`FJORDS`), distance aux fjords
tamponnée une fois sur une grille de 20 m ; montagnes partout (bruit en crêtes, 500 à 750 m) qui montent vite derrière
le rivage ; parois des fjords creusées (`fjordWall`, 27/11/2026) : un ressaut presque vertical d'environ 80 m au ras
de l'eau puis des montagnes qui montent deux fois plus vite, eau jusqu'à −60 m, sauf au fond des fjords (1,8 km), près
des villages et le long des vallées des rives ; strandflat bas au sud-ouest ; haut-plateau (`PLATEAU`) ; calotte
(`CAP`) et glacier (`GLACIER`) ; massif du Storfjell, selle du col, combe de Nordvik fermée sous le col par une paroi
de ≈ 300 m (≈ 50 %, courbes de niveau droites en travers) puis à fond plat jusqu'au Storfjord ; vallées dessinées (`VALLEYS`, fond à pente régulière, tamponnées sur une
grille de 20 m) qui relient les fonds de fjords au plateau et entre eux ; îlots (`skerry`) et îles (`ISLES`) au large.
`preview.ts` donne un aperçu du relief en une minute, sans construire le monde ; `probe.ts`, `dump.ts`, `dbgcol.ts` et
`dbgtry.ts` servent à la mise au point (relief en un point, cotes reprises par le client, routes de montagne
dessinées, essais de parcours sur le graphe d'un essai).
Occupation du sol (`land.ts`) : résineux et bouleaux dans les vallées jusqu'à ≈ 420 m, toundra rase sur le plateau et
au-dessus des arbres, landes et tourbières du strandflat, roche sur les sommets, les parois et les îlots, glace de la
calotte et du glacier (champ `glacier`), quelques prés seulement autour des villages et des fermes (pas de grande
plaine).
Bâtiments (`settle.ts`) : maisons de bois peintes (rouge de Falun, ocre, blanc) à toit pentu, églises de bois blanches,
fermes et granges rouges, hangars à bateaux sur la grève de Port-Boréal.

## Réseau et parcours

- Routes : pas de tour par la côte (les fjords la coupent partout) ; le réseau suit les vallées. Sur le haut-plateau,
  routes entre Nordrobert, Vidda, les Mille-Lacs, Rennesby et le Circuit ; du plateau, une vallée descend vers chaque
  fond de fjord (Sørvik, Skarvik, Fossbru par les gorges de la Renne, Vatnby par la vallée du Grand Fjord) ; vallée de
  la Myra (route du Grand Fjord → Port-Boréal), route du strandflat (Port-Boréal, Myrbu, Granlia), rive sud du Grand
  Fjord (Granlia → Vatnby), col de Vatnby (Vatnby → Fjellheim), route du Bac (les deux rives par Fossbru), vallée des
  Lemmings (Isbrevik → Nordvik). Pistes : piste du Circuit, voies vertes des Mille-Lacs et des Skerries, promenade de
  Port-Boréal. Maillage de petites routes là où le relief le permet (plateau, strandflat).
- Routes de montagne en lacets (`climb.ts`) : col du Renne (versant sud depuis Rennesby, versant nord par la combe de
  Nordvik : fond de la combe tout droit, puis lacets serrés et superposés sur la paroi sous le col, sept ou huit
  épingles à 60 ou 70 m l'une au-dessus de l'autre, ≤ 160 m de part et d'autre de l'axe ; option `straight` de
  `switchbacks`), route du Belvédère (part en biais de la montée sud), route de la Calotte (de Fjellheim au refuge).
- Chemins gravel et sentiers VTT (`TRAILS`, `SKIN`) : Vidda, Mille-Lacs, Skerries, Marais, Tourbières, Pêcheurs,
  Toundra, Glacier ; Lemmings, Dent du Renne, descente du Renne, Gorges, Skarvik, Grand Fjord, Bouleaux, cyclo-cross de
  la Toundra, bike park de Fjellheim.
- Un parcours n'est publié que s'il passe les contrôles (`routeFlaw` dans `build.ts`, mêmes règles que `verify.ts`) ;
  un parcours impossible ou écarté est signalé dans le journal de construction (avec l'endroit du défaut).

Parcours (43, tous avec `nameEn`) :

| Genre | Parcours |
| --- | --- |
| Découverte (en tête) | `decouverte-du-grand-nord` (≈ 11 km sur la toundra : Nordrobert, le Circuit, les Mille-Lacs) |
| Classiques | `classique-des-fjords` (route, ≈ 39 km de Port-Boréal à Isbrevik par la vallée de la Myra et le col du Renne), `classique-de-la-toundra` (gravel, ≈ 7 km des Mille-Lacs à la vallée du Grand Fjord) |
| Contre-la-montre | `chrono-du-fjord` (Nordvik → Isbrevik par la vallée des Lemmings, ≈ 7 km), `chrono-de-la-saumonee` (du Circuit à Vatnby, ≈ 10 km en descente douce) |
| Nuit (départ à 23 h) | `aurores-de-nuit` : de Rennesby au belvédère des Aurores (≈ 6 km, ≈ 470 m D+, KOM) |
| Montées (KOM) | `col-du-renne`, `col-du-renne-par-nordvik`, `montee-de-fjellheim` (montée de la Calotte), `grand-tour-du-col` |
| Circuit, critérium | `anneau` (Circuit du Grand Nord, 3,6 km), `criterium-de-nordrobert` |
| Tour du monde | `tour-du-grand-nord` (≈ 41 km : Port-Boréal, Myrbu, Granlia, Vatnby, vallée de la Myra) |
| Fjords et vallées | `gorges-de-la-renne`, `route-du-bac`, `route-de-sorvik`, `route-de-skarvik`, `col-de-vatnby`, `route-de-la-myra`, `rive-du-grand-fjord`, `route-des-pecheurs` |
| Plateau | `boucle-de-nordrobert`, `haut-plateau-de-vidda` |
| Pistes et voies vertes | `promenade-de-port-boreal`, `piste-du-circuit`, `voie-verte-des-skerries`, `voie-verte-des-mille-lacs` |
| Gravel | `classique-de-la-toundra`, `gravel-de-vidda`, `gravel-des-mille-lacs`, `gravel-des-skerries`, `gravel-des-marais`, `gravel-des-tourbieres`, `chemin-des-pecheurs`, `chemin-du-glacier`, `cyclo-cross-de-la-toundra` |
| VTT | `vtt-des-lemmings`, `vtt-de-la-dent-du-renne`, `descente-du-renne`, `vtt-des-gorges`, `vtt-de-skarvik`, `vtt-du-grand-fjord`, `vtt-des-bouleaux`, `bike-park-de-fjellheim` |

Identifiants retirés avec l'ancienne géographie : `baie-et-mille-lacs`, `marais-de-myrbu`, `voie-verte-de-la-saumonee`,
`voie-verte-du-grand-lac`, `velo-de-la-baie`, `gravel-de-la-saumonee`, `chemin-des-galets`, `vtt-du-grand-lac`.

Écarts au Pays de Robert : pas de « secondary » (les grandes routes sont des « tertiary » : en terrain accidenté leurs
virages restaient sous 7,5 m de rayon) ; profils plafonnés sous les seuils des contrôles (route 14,5 %, piste 5,8 %,
chemin gravel 18,5 %) ; creux de plus de 7 cm sur 16 m comblés après le lissage ; dans le graphe, premier et dernier
pas d'un tronçon recoupés à ≈ 2 m et remis en pente régulière vers le nœud ; un parcours écarté signale l'endroit du
défaut. Chemins (`easeTracks`, après le tracé) : virages de moins de 5 m de rayon adoucis sur les chemins gravel, puis
profil recalculé ; pente bornée pas à pas sur tous les chemins (hors carrefours), creux comblés en jugeant la pente sur
± 8 m. Mise au point : `ISLAND_DEBUG_SAG=1` liste les creux du graphe, `VERIFY_ALL=1` tous les défauts des contrôles,
`chk.ts` refait les contrôles de pente, de rayon et de creux sur le graphe d'un tracé seul (≈ 2 min au lieu de 13).

## Générer

```
cd apps/server
ISLAND_OUT='D:/zzCACHE_ALLEZROBERT/zones-travail/grand-nord' ISLAND_THREADS=4 pnpm exec tsx ../../tools/grand-nord/src/build.ts
ISLAND_PLAN=1 …                                    # tracé seul (≈ 2 min), écrit aussi net.json pour la mise au point
pnpm exec tsx ../../tools/grand-nord/src/preview.ts --px 70 --out apercu.png   # aperçu du relief seul (≈ 1 min)
pnpm exec tsx ../../tools/grand-nord/src/verify.ts # contrôles du monde installé (apps/client/public/worlds/grand-nord)
pnpm exec tsx ../../tools/grand-nord/src/map.ts --px 25 --out ../client/public/worlds/grand-nord/carte.png
pnpm exec tsx ../../tools/grand-nord/src/map.ts --px 40 --style flat --out ../client/public/worlds/grand-nord/vignette.png
```

`ISLAND_OUT` est obligatoire pour un essai : sans lui, le générateur écrit dans `apps/client/public/worlds/grand-nord` et
met à jour le catalogue partagé. Les tuiles (`tiles/`) ne sont pas versionnées ; `carte.png` et `vignette.png` le sont.

## Dans le jeu (mode Poly)

- Données du monde (titre, lieux de la carte, parcours en tête, lieux à découvrir, nom du Tour à étapes, thème) :
  `apps/client/src/world/lands/grand-nord.ts`. Lieux à découvrir gardés dans `ar.found.grand-nord`.
- Thème : aucun champ cultivé : lande brun-vert, toundra rousse (vive en automne), mousses ; neige dès 560 m en été
  (360 au printemps, 420 en automne, partout en hiver), givre en hiver (0,95) et au printemps, feuillage sombre
  (bouleaux jaunes en automne), eau bleu-gris, grève de galets gris, roche sombre, limite des arbres à 420 m.
- Végétation (`biome`) : les feuillus deviennent des bouleaux, 60 % des arbres gardés, moitié moins d'herbe, ni boîtes
  aux lettres, poubelles ni poules, ni vaches, moutons ni chevaux (les rennes sont dans le décor).
- Bâtiments : tout en bois peint (rouge de Falun, ocre, blanc, jamais de brique ni de crépi), façade `timber` (bois
  peint nordique du shader des bâtiments), toits très pentus, sombres et débordants pour les maisons
  (`grandNordBuilding`).
- Décor propre (`world/lands/grand-nordSites.ts`) : ports de Port-Boréal, Skarvik et Nordvik ; bac animé qui traverse
  le fjord du Bac (quatre minutes l'aller-retour) et rampes des cales ; cabanes de pêcheurs sur pilotis et séchoirs à
  poisson des villages du fond des fjords (Skarvik, Nordvik, Isbrevik, Sørvik, Vatnby, Fjellheim, Port-Boréal) ; cabanes de pêche et pontons au bord des lacs de la toundra ; troupeaux de rennes (un groupe en
  marche) ; langue de glace du glacier (crevasses, séracs) ; phare du cap Boréal et son feu tournant la nuit ; cairns du
  col et des sommets, belvédère des Aurores ; tribunes, portique et drapeaux du Circuit ; balisage, tremplins et
  portique du bike park de Fjellheim ; piquets, rubalise et tentes du cyclo-cross de la Toundra ; **aurores boréales**
  la nuit (rubans verts et violets additifs, animés, au nord du coureur, dès que la nuit dépasse 0,3).
- **Identité (27/11/2026), inspirée de la Norvège, sans aucun lieu réel reproduit** :
  - lumière froide et ciel bas (`theme.light`) : horizon gris-bleu `#8d9ba6` (mélange 0,55), brume 1,1, chaleur −0,55,
    saturation 0,9 ; eau des fjords sombre, presque ardoise (`#2c4552`) ;
  - maisons : rouge de Falun pour une sur deux, toits de tourbe plus fréquents ; cabanes sur pilotis plus nombreuses
    (jusqu'à 13 par village), surtout rouges, de tailles inégales ;
  - **cascades** sur les parois des fjords (`fallSites`) : tronçons de 900 m le long des sept fjords, une ou deux chutes
    par tronçon (deux sur trois), tracées en suivant la plus grande pente d'un point haut et raide (pente ≥ 0,9, dans les 400 m de la rive)
    jusqu'à l'eau (au moins 60 m de chute, à plus de 40° en moyenne, jamais sur une route ni une maison) ; ruban blanc et bleuté drapé sur la paroi dans le décor
    fixe, voile animé (filets qui coulent, nœuds TSL) et embruns de près, écume au pied ; gelées en hiver ;
  - **jalons à neige** orange à bande sombre au bord des routes revêtues au-dessus de 200 m (col du Renne, Vidda,
    Fjellheim), tous les 28 m en alternance, hors des villages et du Circuit (`poleSites`, grille de 1,5 km).
- Ni clôtures ni poteaux sur la promenade de Port-Boréal, les quais et les cales du bac (`grandNordNoFence`).
