# Suivi du monde Poly

**25 novembre 2026.** Premier lot intégré localement. L’Île de Robert est un territoire cycliste entièrement fictif. Son relief, ses villages, ses revêtements, ses saisons et ses usages quotidiens doivent donner l’impression d’un endroit où l’on pourrait réellement rouler.

## Décisions

- **Réel et Bêta** proposent la carte de France et ses parcours réels. Un ancien lien vers l’île ouvre Longchamp dans ces deux modes.
- **Poly** propose l’Île de Robert, y compris dans le catalogue hors ligne. Une ancienne sélection de zone française ouvre l’île au démarrage. L’île a son propre repère.
- **Direction visuelle** avec des volumes à facettes, des couleurs propres à chaque lieu et des scènes lisibles depuis le vélo. Les lieux phares sont composés précisément, puis le décor réutilisable remplit leurs abords selon le terrain.

## Premier lot réalisé

| Sujet | État local |
| --- | --- |
| Choix des cartes | L’île est retirée du sélecteur et du catalogue hors ligne de Réel et Bêta. Le chargement des anciens liens applique la même règle. |
| Robertville | Neuf secteurs le long des Planches avec parasols, transats, bancs et oyats. Bateaux amarrés et pontons dans le port. Les clôtures de campagne, troupeaux et poteaux électriques sont écartés de la promenade en bois. |
| Saisons | La plage suit le réglage du jeu. Les parasols et les transats sont nombreux en été, plus rares au printemps et en automne, puis rangés en hiver. Les oyats changent de densité et de teinte. Les bancs et panneaux restent visibles. |
| Public de course Poly | Silhouettes revues, chaussures, coiffures, bonnets et manches selon la saison. Maillots et vestes aux couleurs vives, du turquoise et du jaune en été au bleu, au vert et au rouge framboise en hiver. Réactions variées au passage du coureur, avec des bras fléchis et des pancartes plus petites. Le placement des spectateurs et barrières suit la largeur de la route. |
| Publicités Poly | Seize enseignes parodiques aux couleurs propres au jeu, dont Pédalidas, Roue Bull, Coca-Cadence et Spécialiselle. Neuf panneaux rigides à Robertville et des bâches alternées sur les barrières de course. Un atlas partagé sert aux deux décors. |
| Carte de l’île | Fond topographique redessiné à partir du relief et des routes. Écran Poly dédié avec repères cliquables, profil, tracé du parcours sélectionné et zoom. |
| Maisons de Robertville | Sept familles de silhouettes réparties entre le front de mer et les rues résidentielles, avec des toits à versants, des terrasses et des façades variées. Les emprises et les bâtiments remarquables servent de repères d’origine. |

## Second lot (25 novembre, après-midi)

Le premier lot a été roulé en Poly pour la première fois. L’état réel trouvé, et ce qui a été fait :

| Constat en roulant | Correction |
| --- | --- |
| Les Planches s’affichaient en bitume noir (la physique et le ressenti home-trainer les traitaient déjà en bois). | Revêtement « bois » dessiné en Poly (lames, joints, lisses de rive) et lampadaires de promenade tous les 36 m, allumés la nuit. |
| Parasols, transats, bancs et affiches étaient derrière les rangées de cabines : invisibles depuis la route. Transats et bancs tournaient le dos à la mer. | Seize secteurs recalés sur l’axe des Planches : mobilier devant les cabines, cinq descentes à la plage (caillebotis, cordes, drapeaux, bouée), serviettes, paravents, filets, affiches à deux faces lisibles dans les deux sens. Rangement l’hiver. |
| Les pontons du port flottaient au milieu de l’eau, sans lien avec la terre. | Quais maçonnés, cinq pontons reliés par passerelle, voiliers et vedettes, capitainerie, feux d’entrée. Le port est visible du quai, mais aucune route de l’île n’y mène (voir les questions ouvertes). |
| Routes nues (demande de l’utilisateur). | Signalisation calculée d’après le graphe routier, sans toucher aux données : cédez-le-passage et stops, passages piétons, axe continu dans les virages, bandes et vélos peints, tirets de rive des petites routes, axe des rues ; panneaux de carrefour, de direction (lieux et km), de virage avec chevrons et balises, de pente, zone 30, entrée et sortie de village. |
| Montants devant les faces des chevrons et des affiches (demande de l’utilisateur). | Un seul poteau entre les deux chevrons, montants d’affiche moins épais que le panneau. |
| Bras raides (demande de l’utilisateur). | Joggeurs : coudes à angle droit et genoux qui fléchissent. Cyclistes Poly sur cintre route : coudes fléchis d’environ 70° et plus ouverts de dos. |
| Peu d’animaux et de promeneurs (demande de l’utilisateur). | Promeneurs avec un ou deux chiens en laisse sur le front de mer et dans les rues ; mouettes, chats, poules et coqs, canards, oies, lapins ; troupeaux plus fréquents et plus proches. |
| Cabines de toutes les couleurs (demande de l’utilisateur : blanches, comme en Normandie ou dans le Nord). | Cabines blanches à pignon et toit clair, portes pastel, marche de bois. |
| Fleurs, haies et terrains de foot verts sous la neige. | Décor des abords suivant la saison : pas de fleurs l’hiver, buissons givrés ou roussis. |
| Bornes, poubelles et passants enfoncés dans les trottoirs surélevés. | Décor des abords posé sur le dessus des trottoirs. |

Fichiers ajoutés : `world/polyRoadPlan.ts` (calcul, testé sur le graphe réel), `polyRoads.ts`, `polyRoadAtlas.ts`, `lowPolyCritters.ts`, `test/polyRoadPlan.test.ts`. Captures dans `out/poly-suite/` (non versionné).

## Contrôles et limites du lot

- [x] Vérifier le sélecteur, le catalogue et le repli d’un ancien lien vers l’île dans Chromium en Réel, Bêta et Poly.
- [x] Passer le contrôle TypeScript et les trois tests de disponibilité des mondes par mode.
- [x] Construire les neuf secteurs, le port et les neuf panneaux sur les tuiles existantes. Contrôler les variantes du même secteur dans les quatre saisons.
- [x] Afficher le public et les nouvelles affiches en été et en hiver dans un aperçu Chromium avec rendu WebGL logiciel. L’essai d’une arrivée complète sur l’île reste à faire.
- [x] Contrôler le nouvel écran Poly dans Chromium sur ordinateur et mobile, avec changement de parcours, tracé, zoom et accès au roulage libre.
- [x] Afficher un échantillon de 64 maisons sur deux tuiles de Robertville dans un banc WebGL, avec le maillage et les couleurs du jeu.
- [x] Boucle **Front de mer de Robertville** contrôlée par points, à hauteur de selle, dans les deux sens, de jour et de nuit, en été et en hiver (25/11). Volet navigateur masqué : déplacements par sauts le long du parcours, pas une sortie continue.
- [x] Arrivée de course sur l’île, en hiver avec public, bâches et IA, à hauteur de guidon et en vue TV (25/11) ; en été, vue TV seulement.
- [x] Carte de l’île dans le menu : choix d’un parcours, tracé, zoom, validation (25/11). Contrôles aussi sur le Tour de l’Île et la boucle de Saint-Robert (Kerbrou, Les Vignes, virages, carrefours).
- [ ] Temps d’image : non mesuré (volet masqué, mesures à coordonner). La signalisation ajoute au plus trois appels de dessin par case de 160 m, une quinzaine de cases proches.
- [ ] Rouler une boucle entière sans saut, sur le home-trainer ou le simulateur, volet affiché.
- [ ] Tester le passage de Poly à Réel ou Bêta dans l’application de bureau avec l’île déjà installée, puis revenir en Poly et ouvrir son pack hors ligne.

## Suite proposée

| Ordre | Chantier | Résultat attendu |
| --- | --- | --- |
| 1 | **Finir Robertville** | Soigner les accès plage, l’animation du port, les scènes de promenade, les devantures et les ambiances sonores. Obtenir une boucle de 4,7 km agréable à faible allure, le jour comme le soir. |
| 2 | **Faire vivre Saint-Robert et l’Anneau** | Donner une identité au bourg avec place du marché, café, école et commerces. Construire les gradins et le paddock de l’Anneau, préciser ses accès et le rendre sans circulation automobile. Il devient le point de départ du critérium, des intervalles et des sorties en groupe. |
| 3 | **Ouvrir des sorties distinctes** | Relier Saint-Robert, les Coteaux, la Vallée de la Robe, le front de mer et les Bois. Prévoir une boucle courte et plate, un chrono sur le Plateau et un gravel court majoritairement hors bitume. Mettre dans le sélecteur la distance, le D+, le revêtement et la durée estimée. |
| 4 | **Donner une identité aux autres secteurs** | Kerbrou et ses quais, corniche et falaises, voie verte et écluses, vignes et vergers, ruine et passerelles des Bois, lagune et oiseaux d’eau. Traiter le Phare avec deux versants, des bornes, un refuge et une descente lisible. Faire varier végétation, fréquentation et ambiances selon la saison. |
| 5 | **Ajouter les objectifs cyclistes** | Chronométrer l’Anneau, les sprints et les deux versants du Phare. Proposer un fantôme personnel, des groupes à allure choisie et des étapes autour de l’île. Constituer progressivement un catalogue de 25 à 35 parcours complémentaires, en réutilisant les liaisons du réseau. |
| 6 | **Finaliser les sorties fictives** | Vérifier la reprise de sortie et les invitations, définir la météo de l’île et le format d’export d’une activité virtuelle sans faux tracé réel. Fixer les conditions communes des événements et classements. |

La carte comprend 22 parcours depuis le troisième lot. [Conception et générateur de l’île](ILE_DE_ROBERT.md)

## Troisième lot (25 novembre, fin d'après-midi, commité 950e8d53)

Réponses de l'utilisateur : météo de Paris, sortie annoncée comme virtuelle, enseignes parodiques gardées, une route vers le port, et les trois chantiers suivants.

| Sujet | État |
| --- | --- |
| Météo | « Du jour (réelles) » prend sur l'île la météo de la ville du joueur, choisie dans le Profil (« Ma ville »), Paris sinon ; le message nomme la ville. Les 34 969 communes françaises, outre-mer compris, se cherchent par nom ou code postal, hors ligne (`public/geo/communes-fr.txt`, 1,1 Mo, 0,5 Mo compressé ; `tools/communes/build.mjs`). Vérifié en jeu avec Saint-Étienne. |
| Export | Titre « … (sortie virtuelle) » pour les sorties de l'île, mention dans le GPX et dans la description Strava (côté serveur : redéploiement nécessaire). Le FIT portait déjà « activité virtuelle ». |
| Port de Robertville | « Quai du Port », du boulevard à la route du Tour de l'Île, et « Promenade du Port » en bois, dans le prolongement des Planches. Routes ajoutées après le tracé du réseau (`tools/island/src/ports.ts`) : les autres routes n'ont pas bougé (seules les deux arêtes raccordées sont coupées en deux). |
| Kerbrou | « Quai des Pêcheurs », bassin avec pontons, chalutiers, criée, casiers et feux d'entrée. |
| Saint-Robert | Vraie place (maisons écartées) : marché, terrasse, fontaine, statue du cycliste, cour d'école, sapin l'hiver. |
| L'Anneau | Gradins, portique, damier, paddock, deux sprints ; au centre, grande roue, manèges, chapiteau, scène, camions, lac et promeneurs, matchs de foot, camping, cerfs-volants et montgolfières animés. Ni voitures, ni clôtures, ni poteaux. |
| Parcours | Douze nouveaux (22 en tout) : critérium, Anneau par la Piste verte, Planches et port, chrono du Plateau, voie verte, Vélomaritime, Phare par le nord, Kerbrou, Coteaux, trois gravels (celui des Vignes : 10 km, 89 % de chemins). Côtes et sprints chronométrés sur quinze parcours. |
| Sélecteur | Durée estimée, revêtements et nombre de côtes et de sprints du parcours choisi. |
| Poubelles | Couvercles gris, verts et jaunes, par une à trois. |
| Fluidité | Lieux construits par tranches de 2 ms par image, sans nouveau matériau, par morceaux écartés du champ ; ombres à moins de 70 m. Mesuré (processeur) : 0,02 ms par image en moyenne pour les lieux, une pointe de 6,9 ms pendant la construction de l'Anneau ; 55 000 triangles et 22 objets au plus. Temps GPU non mesuré. |

L'ancienne île est sauvegardée dans `D:/zzCACHE_ALLEZROBERT/zones-travail/ile-de-robert-avant-port`. La nouvelle passe tous les contrôles (`verify.ts`) et n'est ni envoyée sur le serveur, ni mise dans le pack hors ligne publié.

## Quatrième lot (25 novembre, soir)

Demandes de l'utilisateur : plus de relief, des routes sinueuses mais aussi des lignes droites, des routes un peu partout, des pistes et parcours VTT et gravel.

| Sujet | Avant | Maintenant |
| --- | --- | --- |
| Routes | 404 km | environ 600 km : 190 petites routes de campagne en maillage d'environ 2 km (`meshRoads`), celles qui ne tenaient pas les contrôles étant écartées (`pruneMesh`) |
| Chemins | 47 km | environ 190 km : douze chemins gravel et huit sentiers VTT dans toutes les régions (`TRAILS`), du chemin des Douaniers à la descente du Phare |
| Lignes droites de 400 m et plus | 55 % du réseau | 13 % : méandres (`meander`), coupés de vraies lignes droites de 240 à 900 m (`straighten`, sauf sur les versants du Phare) |
| Relief | 5,6 m de D+ par km, 66 % des routes sous 1 % | 12,1 m de D+ par km, 33 % sous 1 % ; buttes, vallons et coteaux plus hauts, plats gardés autour de l'Anneau, de Saint-Robert et de la lagune |
| Tour de l'Île | 89,8 km, 613 m | 93,8 km, 730 m |

38 parcours (12 gravel, 9 VTT), tous au vert (`verify.ts`, largeurs, KOM). Le tracé de la plupart des anciens a changé : records locaux non comparables.

| Sujet | Fait |
| --- | --- |
| Parcours selon le vélo | L'écran de l'île liste les parcours du vélo équipé (route, gravel, VTT), les lieux de la carte mènent à ceux de ce vélo, une ligne compte ceux des autres. Garage : rubrique « VTT / Gravel ». |
| Matières et largeurs | Neuf matières (stabilisé, pierre, calcaire clair, pavés, terre, argile rouge, sable, herbe, roche) et 1,9 à 4,4 m de large, tronçon par tronçon (`SKIN`). Dessin Poly dans `network.ts` (`trailColor`) : plaques, ornières, herbe au milieu, cailloux, bords d'herbe de la couleur du talus et de la saison. |
| Poussière | Plus claire, plus dense et plus haute en Poly, sans contour carré. |
| Home-trainer | Le revêtement du tronçon (gravier, terre, roche, pavés…) part déjà vers le ressenti Tacx et la résistance ; corrigé : en VTT ou gravel, un chemin roulait mieux que l'enrobé (`surfaceCrr`, partagé avec le serveur : à redéployer). Non essayé sur le Neo. |
| VTT Poly | Poignées nettes à la place du maillage simplifié déchiqueté, mains posées dessus. |
| Peinture des routes | Elle suivait l'axe brut du graphe, la chaussée dessinée arrondit les coudes (jusqu'à 0,5 m d'écart) : recalée (`RoadHeightField.axisAt`), et plus bleutée. |
| Routes de 4,5 m | Axe pointillé ajouté, continu dans les virages. |
| Captures | `public/onboarding/style-lowpoly.jpg` (Planches) et `deploy/site/img/alpe-lowpoly.jpg` (Col du Phare) refaites, texte du site adapté (« Deux mondes, le même vélo »), non mis en ligne. |
| Panneaux de direction | Reculés quand ils entraient dans une façade. |

Les autres cyclistes (IA et ambiance) prennent un VTT sur les parcours VTT, un gravel ou un VTT sur les parcours gravel (`game/trailBike.ts`) ; vérifié sur les IA en Poly. En Bêta, l'équipement V3 garde son vélo.

Vérifié par sauts, son coupé. Pas de sortie continue, temps GPU non mesuré.

## Questions ouvertes

1. **Publication** : tuiles et pack de l'île à renvoyer sur le serveur, et serveur à redéployer pour la description Strava.
2. **Suite du plan** : finir Robertville (devantures, sons), falaises, écluses et ruine des Bois, fantôme et groupes à allure choisie.
3. **Trait clair aux bords de tuile** : un filet d'un pixel traverse parfois une moitié de chaussée, là où le ruban du réseau est coupé (vu à Saint-Robert, km 0,3 de la boucle). Antérieur à ce lot, non corrigé.

## Repères pour reprendre le chantier

- Géographie, routes et contrôles de génération dans [ILE_DE_ROBERT.md](ILE_DE_ROBERT.md).
- Inventaire des systèmes de décor existants dans [LOW_POLY.md](LOW_POLY.md).
- Filtrage des zones dans [worlds.ts](../apps/client/src/world/worlds.ts), [loader.ts](../apps/client/src/world/loader.ts) et [zoneMap.ts](../apps/client/src/world/zoneMap.ts).
- Carte topographique générée par [map.ts](../tools/island/src/map.ts) et écran de choix dans [islandAtlas.ts](../apps/client/src/ui/islandAtlas.ts).
- Décor de Robertville dans [robertville.ts](../apps/client/src/world/robertville.ts). Public et publicités dans [crowdLowPoly.ts](../apps/client/src/world/crowdLowPoly.ts) et [polySponsors.ts](../apps/client/src/world/polySponsors.ts).
- Sources de la conception initiale. [Liaisons de Watopia](https://news.zwift.com/en-WW/230929-new-roads-reveal-parts-of-watopia-previously-inaccessible-by-bike/) · [Parcours MyWhoosh](https://mywhoosh.com/routes/) · [Prototype vidéo NCT](https://www.youtube.com/watch?v=WhQQy_kTbxA) · [La Hague par NCT](https://nctlemag.fr/immersion/point-de-la-hague-et-ces-cotes-sauvages/).
