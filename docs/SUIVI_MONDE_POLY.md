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

## Contrôles et limites du lot

- [x] Vérifier le sélecteur, le catalogue et le repli d’un ancien lien vers l’île dans Chromium en Réel, Bêta et Poly.
- [x] Passer le contrôle TypeScript et les trois tests de disponibilité des mondes par mode.
- [x] Construire les neuf secteurs, le port et les neuf panneaux sur les tuiles existantes. Contrôler les variantes du même secteur dans les quatre saisons.
- [x] Afficher le public et les nouvelles affiches en été et en hiver dans un aperçu Chromium avec rendu WebGL logiciel. L’essai d’une arrivée complète sur l’île reste à faire.
- [x] Contrôler le nouvel écran Poly dans Chromium sur ordinateur et mobile, avec changement de parcours, tracé, zoom et accès au roulage libre.
- [x] Afficher un échantillon de 64 maisons sur deux tuiles de Robertville dans un banc WebGL, avec le maillage et les couleurs du jeu.
- [ ] Rouler la boucle **Front de mer de Robertville**, dans les deux sens, du matin à la nuit. Contrôler à hauteur de selle l’ancrage des accessoires, la lisibilité des panneaux, l’accès au port et la transition entre les secteurs.
- [ ] Faire une arrivée de course sur l’île avec le public et les nouvelles bâches, puis comparer la scène à hauteur de guidon et avec la vue TV. Mesurer le temps d’image sur une machine courante après coordination avec les autres sessions.
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

## Repères pour reprendre le chantier

- Géographie, routes et contrôles de génération dans [ILE_DE_ROBERT.md](ILE_DE_ROBERT.md).
- Inventaire des systèmes de décor existants dans [LOW_POLY.md](LOW_POLY.md).
- Filtrage des zones dans [worlds.ts](../apps/client/src/world/worlds.ts), [loader.ts](../apps/client/src/world/loader.ts) et [zoneMap.ts](../apps/client/src/world/zoneMap.ts).
- Carte topographique générée par [map.ts](../tools/island/src/map.ts) et écran de choix dans [islandAtlas.ts](../apps/client/src/ui/islandAtlas.ts).
- Décor de Robertville dans [robertville.ts](../apps/client/src/world/robertville.ts). Public et publicités dans [crowdLowPoly.ts](../apps/client/src/world/crowdLowPoly.ts) et [polySponsors.ts](../apps/client/src/world/polySponsors.ts).
- Sources de la conception initiale. [Liaisons de Watopia](https://news.zwift.com/en-WW/230929-new-roads-reveal-parts-of-watopia-previously-inaccessible-by-bike/) · [Parcours MyWhoosh](https://mywhoosh.com/routes/) · [Prototype vidéo NCT](https://www.youtube.com/watch?v=WhQQy_kTbxA) · [La Hague par NCT](https://nctlemag.fr/immersion/point-de-la-hague-et-ces-cotes-sauvages/).
