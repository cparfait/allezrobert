# L'Archipel des volcans — monde du mode Poly

> Monde imaginaire, comme l'île de Robert et le Pays de Robert, d'un caractère volcanique : une grande île dominée par
> un volcan conique d'≈ 1 440 m, avec son cratère et son lac, deux îles plus petites reliées par un pont et une
> chaussée sur la mer, des coulées de lave noire figées jusqu'à la mer, des plages de sable noir, des falaises
> basaltiques (orgues), une forêt tropicale humide sur le versant au vent, des vignes sur la cendre et des champs en
> terrasses. Il est produit par `tools/archipel-des-volcans`, copie adaptée du générateur du Pays de Robert
> (`tools/massif`, qui n'est pas modifié), au même format que les mondes réels : le moteur l'affiche tel quel.

## Repère et taille

- Même emprise que l'île : x de −19 000 à 19 000 m, z de −13 000 à 13 000 m, tuiles de 1 km (988 tuiles), mer au niveau 0.
- Repère Lambert-93 fictif en Méditerranée, au sud-est de la Corse (`originL93` 1 330 000 / 5 900 000) : ne recouvre
  ni une zone réelle ni les autres mondes Poly.
- Tuiles du volcan : plus de 655 m de dénivelé dans une tuile, pas de quantification élargi (`stepM` de la tuile).

## Géographie

| Lieu | Où | Caractère |
| --- | --- | --- |
| **Le Volcan** | nord de la Grande Île | cône d'≈ 1 440 m (profil exp(−(r/S)^1,5)), cratère de 520 m de rayon, lac du Cratère (≈ 1 220 m), brèche au sud-est du rebord où arrive la route |
| **Aigues-Chaudes** | flanc sud, ≈ 345 m | village thermal : thermes, bassins fumants, fumerolles ; départ de la route du Cratère |
| **Observatoire du volcan** | épaule est, ≈ 1 000 m | tour et coupole, station de surveillance ; route en lacets qui bifurque de la route du Cratère |
| **Sainte-Iris** | baie des Cendres (sud) | petite ville colorée : boulevard de la Baie, promenade en bois, marché couvert, hôtels, cabines, port |
| **Port-Lave** | côte sud-ouest | port de pêche au pied de la Coulée du Sud |
| **La Plaine** | plaine de l'ouest | bourg de départ, place, critérium |
| **Circuit des Laves** | plaine de l'ouest | boucle plate de 3,6 km, tribunes, portique, drapeaux (sans voitures ni clôtures) |
| **Vigne-Noire** | versant ouest (sous le vent) | vignes sur la cendre, cave |
| **Rocheverte** | versant est (au vent) | forêt tropicale humide, Ravine des Pluies, chapelle de la Forêt |
| **Les Terrasses** | collines du sud-est | champs en terrasses (bandes étroites), moulin |
| **Le Pont, La Chaussée** | côte est et sud-est | hameaux des culées du Pont des Orgues et de la Chaussée |
| **L'Île des Orgues** | à l'est | plateau de basalte (≈ 70 m) cerné de falaises (orgues), village et port des Orgues, Phare des Orgues sur le cap est |
| **L'Île de Sable-Noir** | au sud-est | île basse, grandes plages de sable noir, vignes, village de Sable-Noir, Mont Cendre (cône de scories, bike park) |
| **Coulées de lave** | quatre coulées | Grande Coulée (ouest), Coulée du Sud, Coulée du Nord, Coulée de 1904 (est) : bourrelet de 2 à 6 m, roche nue |

Relief (`design.ts`) : une forme de rivage par île (super-ellipse déformée, caps, anses, falaises selon la direction,
`ISLES`), distance au rivage le plus proche (`shoreDist`, `isleAt`), volcan (`VOLCANO`, `volcanoHeight`), coulées
(`LAVA_FLOWS`, `lavaAt`), plateau des Orgues, Mont Cendre (`CINDER`), collines des Terrasses, rivières (Ravine des
Pluies, Ruisseau Chaud, Rivière des Vignes), lacs (lac du Cratère, étang des Laves). Les villes du bord de mer et les
culées ont un arrière-pays en pente douce.

Falaises : sur les secteurs en falaise (`cliff` des `ISLES`), une grève de sable noir de 14 à 36 m (`cliffFoot`) au
ras de l'eau, puis une paroi verticale (2,5 m de large, `CLIFF_FACE`, une à deux cases de la grille de 2 m) de 24 à
56 m sur la Grande Île et Sable-Noir (`cliffHeight`). Sur l'Île des Orgues, la paroi porte directement le plateau de
basalte : ≈ 60 à 70 m d'un seul jet, plateau presque plat dès le rebord. Les rivières ont deux ressauts
(`RIVER_FALL_SPECS`, `riverFalls`) : 16 m sur la Ravine des Pluies, 13 m sur la Rivière des Vignes, paroi verticale
en amphithéâtre, vasque qui rejoint la pente d'origine en aval, loin des routes.

Routes sur la mer (`SEA_LINKS`) :

- **Pont des Orgues** (≈ 1,15 km) : route dessinée en dos d'âne (tablier à 11 m), le sol n'est jamais remblayé sous le
  tablier (`bridge` des routes, `roads.ts`), tronçons marqués `bridge` dans les tuiles ;
- **La Chaussée** (≈ 1,45 km) : digue empierrée creusée dans le relief (dessus à 2,2 m), chaussée droite à 2,6 m.

Occupation du sol (`land.ts`) : forêt tropicale humide sur le versant au vent jusqu'à ≈ 950 m, lande d'altitude et
scories au-dessus, roche nue sur les coulées, au sommet et dans le cratère, falaises basaltiques, vignes sur la cendre
(ouest et Sable-Noir), champs en terrasses (trois bandes par parcelle), vergers, prés du plateau des Orgues, plages de
sable noir de chaque île, grèves de sable noir au pied des falaises (la roche commence à la paroi).

## Réseau et parcours

- Routes : tour de la Grande Île, grands axes depuis La Plaine, routes communales, route du Pont et de la Chaussée,
  route du Phare et du plateau des Orgues, tour de Sable-Noir, maillage de petites routes, pistes cyclables (piste du
  Circuit, voies vertes des Laves, de la Baie et des Cendres), promenade de Sainte-Iris.
- Route du Cratère en lacets (`climb.ts`) d'Aigues-Chaudes à la brèche (≈ 15 km, ≈ 1 060 m de dénivelé), route de
  l'Observatoire qui en bifurque vers 820 m.
- Chemins gravel et sentiers VTT (`TRAILS`, `SKIN`) : cendres, vignes, forêt, terrasses, orgues, Sable-Noir,
  fumerolles, coulée, littoral ; lande, descente du Volcan, forêt, orgues, coulée, ravine, bike park du Mont Cendre.
- Cyclo-cross des Cendres : petite boucle dessinée (`CROSS`), parcours écrit comme le Circuit.
- Un parcours n'est publié que s'il passe les contrôles (`routeFlaw` dans `build.ts`, mêmes règles que `verify.ts`).

Parcours en tête : `decouverte-de-l-archipel` (découverte), `classique-des-trois-iles` (route, passe le pont et la
chaussée), `classique-des-cendres` (gravel), `chrono-de-la-chaussee` (contre-la-montre plat), `cratere-de-nuit`
(montée au cratère, départ à 23 h), `montee-du-volcan` (depuis Sainte-Iris, 24 km, ≈ 1 430 m de dénivelé).

## Générer

```
cd apps/server
ISLAND_OUT='D:/zzCACHE_ALLEZROBERT/zones-travail/archipel-des-volcans' ISLAND_THREADS=4 pnpm exec tsx ../../tools/archipel-des-volcans/src/build.ts
ISLAND_PLAN=1 …                                                       # tracé seul (≈ 1 min)
pnpm exec tsx ../../tools/archipel-des-volcans/src/verify.ts <dossier>   # contrôles du monde écrit
pnpm exec tsx ../../tools/archipel-des-volcans/src/map.ts --dir <dossier> --px 25 --out <dossier>/carte.png
pnpm exec tsx ../../tools/archipel-des-volcans/src/probe.ts              # altitudes des lieux, carte ASCII
pnpm exec tsx ../../tools/archipel-des-volcans/src/dump.ts <dossier>     # cotes du décor du client
```

Sans `ISLAND_OUT`, le générateur écrit dans `apps/client/public/worlds/archipel-des-volcans` et publie le catalogue :
à ne faire que depuis la session principale. Les tuiles (`tiles/`) ne sont pas versionnées ; `carte.png` et
`vignette.png` le sont.

## Dans le jeu (mode Poly)

- Données du monde (titre, lieux de la carte, parcours en tête, lieux à découvrir, nom du Tour à étapes, thème,
  circuit) : `apps/client/src/world/lands/archipel-des-volcans.ts`.
- Identité : l'**Islande** (27/11/2026). On s'en inspire sans reproduire aucun lieu précis : il faut qu'au premier
  coup d'œil on sache qu'on est dans l'Archipel.
  - Thème : prés et lande vert mousse, roussis à l'automne, givrés l'hiver ; terre volcanique noire, sable noir
    (`#1f1d1c` / `#3b3836`), roche `#33302e`, mer bleu pétrole (`#2c6c80`), calotte de neige sur le volcan (sous
    1 320 m l'été, 620 m l'hiver).
  - Lumière (`theme.light`) : horizon gris bleuté, brume 1,3, lumière froide (−0,35), couleurs un peu éteintes (0,92).
  - Biome : peu d'arbres (bouleaux, 18 %), herbe rase, moutons, vaches et chevaux dans les prés ; au bord des routes,
    lupins bleu-violet, rochers de lave moussus, touffes d'herbe sèche, pas de buissons.
  - Bâtiments (`building`) : villages en enduits crème et ocre, toits de tuile cuite et de basalte (palette validée
    par l'utilisateur) ; églises et chapelles blanches à toit de tôle rouge ; hors des villages, fermes, granges et
    maisons en tôle peinte (blanc, crème, gris, jaune paille, rouge, noir) à toits de tôle rouges, verts, bleus, noirs.
- Décor propre (`lands/archipel-des-volcansSites.ts`) : panache de fumée du volcan (animé, lueur rouge la nuit),
  fumerolles, bassins thermaux, Pont des Orgues (piles, pylônes, haubans, lampadaires), Chaussée (enrochements,
  bornes), Phare des Orgues (feu tournant la nuit), trois ports et bateaux au large, champs de lave (blocs, dalles
  cordées, hornitos), bike park du Mont Cendre, cyclo-cross des Cendres, tribunes du Circuit, coupole de
  l'observatoire, belvédère du cratère, lampadaires et bancs du front de mer, blocs de lave et orgues de basalte.
  Pas de clôtures sur la promenade, les quais, le pont et la chaussée (`noFence`).
- Décor islandais :
  - coulées anciennes (à plus de 2,8 km du cratère) couvertes de mousse : buttes de mousse vert vif, blocs et dalles
    moussus ;
  - sept cascades (`FALLS`, relevées sur le relief du générateur) qui tombent à la verticale : trois du rebord du
    plateau des Orgues (sud, cap du Phare, nord, ≈ 60 à 70 m), deux des falaises de la Grande Île (Terrasses au sud,
    cap de la Grande Coulée à l'ouest, ≈ 43 à 47 m), toutes sur la grève de sable noir, et les ressauts de la Ravine
    des Pluies et de la Rivière des Vignes ; ruban d'eau détaché de la paroi, écume, vasque, embruns et paquets d'eau
    animés ;
  - quatre églises blanches à toit rouge dans leur enclos (Sainte-Iris, qui n'en avait pas, et trois isolées sur la
    côte), porte tournée vers la route ;
  - quatorze maisons isolées en tôle et leur remise, au bord des routes de campagne ;
  - aiguilles de basalte au large des plages de sable noir (Plage des Cendres, Sable-Noir, Grande Anse), mouettes ;
  - lupins en touffes à Sainte-Iris et Sable-Noir, et six prairies de lupins le long des routes.
- Pas encore : envoi des tuiles sur le serveur et pack hors ligne publié.
