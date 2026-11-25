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

La carte actuelle comprend 10 parcours. La seule boucle gravel mesure environ 54 km, dont 26 km en bitume. Les dix parcours générés ont actuellement des listes de segments vides. Ces deux points donnent la priorité aux variantes courtes et aux premiers chronos avant d’allonger le catalogue. [Conception et générateur de l’île](ILE_DE_ROBERT.md)

## Questions ouvertes

1. **Météo réelle de l’île** : avec « Du jour (réelles) », le jeu demande la météo d’un point de l’Atlantique (origine fictive 95000, 6815000). Garder, prendre une météo de référence (Deauville, par exemple) ou imposer les conditions réglées.
2. **Export et Strava** : les activités de l’île portent des coordonnées GPS de ce même point. Format d’une activité virtuelle à choisir.
3. **Enseignes parodiques** : seize noms dérivés de vraies marques (Pédalidas, Coca-Cadence, Ikécôte…). À garder, ou à remplacer par des marques inventées avant publication.
4. **Accès au port** : aucune route n’y mène ; une piste demande de régénérer des tuiles (accord nécessaire).
5. **Ligne provenance** : la ligne « Robertville » de `ASSETS_LICENSES.md` ne cite pas la signalisation, les animaux ni le port (procéduraux, originaux). Fichier réservé ailleurs, non touché.
6. **Ordre de la suite** : Saint-Robert et l’Anneau, parcours courts et chronos, ou Kerbrou.

## Repères pour reprendre le chantier

- Géographie, routes et contrôles de génération dans [ILE_DE_ROBERT.md](ILE_DE_ROBERT.md).
- Inventaire des systèmes de décor existants dans [LOW_POLY.md](LOW_POLY.md).
- Filtrage des zones dans [worlds.ts](../apps/client/src/world/worlds.ts), [loader.ts](../apps/client/src/world/loader.ts) et [zoneMap.ts](../apps/client/src/world/zoneMap.ts).
- Carte topographique générée par [map.ts](../tools/island/src/map.ts) et écran de choix dans [islandAtlas.ts](../apps/client/src/ui/islandAtlas.ts).
- Décor de Robertville dans [robertville.ts](../apps/client/src/world/robertville.ts). Public et publicités dans [crowdLowPoly.ts](../apps/client/src/world/crowdLowPoly.ts) et [polySponsors.ts](../apps/client/src/world/polySponsors.ts).
- Sources de la conception initiale. [Liaisons de Watopia](https://news.zwift.com/en-WW/230929-new-roads-reveal-parts-of-watopia-previously-inaccessible-by-bike/) · [Parcours MyWhoosh](https://mywhoosh.com/routes/) · [Prototype vidéo NCT](https://www.youtube.com/watch?v=WhQQy_kTbxA) · [La Hague par NCT](https://nctlemag.fr/immersion/point-de-la-hague-et-ces-cotes-sauvages/).
