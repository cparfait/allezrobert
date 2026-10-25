# Direction artistique — Allez Robert !

> **À valider** avant toute production d'assets en masse. Les captures de référence de chaque jalon sont rangées dans `docs/screenshots/`.

## Intention

**Semi-réalisme lumineux.** Un monde qui donne envie de rouler un dimanche matin : lumière dorée et ciels spectaculaires (esprit Forza Horizon), lecture sportive immédiate (esprit Riders Republic), HUD sobre et lisible (esprit Zwift). On évite le photoréalisme froid et le « cartoon » : formes simplifiées, matériaux PBR crédibles, couleurs légèrement saturées, contre-jours généreux.

Trois règles :

1. **La route se lit en premier** : contraste route / bas-côtés, marquages au sol nets, pente lisible au relief et au profil.
2. **La lumière raconte l'heure et la saison** : chaque combinaison saison × moment a son étalonnage (LUT), sa couleur de brume et son ciel.
3. **Rien ne masque les données vitales** : puissance, FC, cadence et pente restent toujours visibles, y compris pendant les séquences HyperFrames.

## Le territoire

| Zone | Signature visuelle |
| --- | --- |
| Plateau de Saclay | Grandes cultures ouvertes, horizon lointain, vent visible (blés, haies qui ploient), fermes en pierre, ciels immenses |
| Vallée de Chevreuse | Vallées boisées encaissées, routes en lacets, villages en **meulière** (pierre ocre-brun alvéolée), **toits de tuiles plates** brun-rouge, murets, lavoirs, château de la Madeleine sur la colline |
| Vallée de l'Yvette et étangs | Rivières, étangs, roselières, reflets du ciel, brume matinale |
| Forêt de Rambouillet | Grande forêt domaniale : chênes, hêtres, pins sylvestres, allées rectilignes, sous-bois sombres et percées lumineuses |

## Palettes par saison

| Saison | Végétation | Sol / champs | Lumière | Brume |
| --- | --- | --- | --- | --- |
| Printemps | `#7fb24a` vert tendre, `#a9cf6a` jeunes feuilles, fleurs blanches (aubépine, merisiers) | `#8a9a4b` blé vert, `#c9b45a` colza en fleur `#e8d43a` | Blanche, douce, 5 600 K | Légère, `#dfe8ef` |
| Été | `#4f7a32` vert profond, `#6b8e3a` | `#d8b86a` blé mûr, `#c79d4f` chaume | Chaude et dure, 5 200 K midi, 3 200 K soir | Chaleur, `#e8e0cf` |
| Automne | `#c8762c` roux, `#e0a33a` or, `#9b3d1f` rouille, `#6f7d35` résiduel | `#7b6a4a` labours, feuilles au sol `#b5793a` | Rasante, dorée, 3 800 K | Matinale dense, `#d9d2c3` |
| Hiver | `#5e6b52` persistants, branches nues `#6e5d4f` | `#8f8a6e` herbe sèche, givre `#e6eef2` | Froide, basse, 6 500 K | Grise, `#c9d1d6` |

Matériaux constants : meulière `#a8835a` / `#7d5d3b`, tuile plate `#9c4a2f` / `#7a3825`, enduit `#e6dccb`, asphalte `#3c3d40` (sec) / `#2a2b2e` (mouillé, spéculaire fort), marquages `#f2f2ec`.

## Archétypes de bâti

Source : `packages/shared/src/styles/archetypes.json`. Chaque monde qui a un profil
(`packages/shared/src/styles/worlds/<monde>.json`) donne un archétype à chaque bâtiment d'après ses
attributs réels (BD TOPO : matériau des murs et du toit, niveaux, hauteur). Les annexes et les
édifices gardent le rendu historique. On reconnaît d'abord la silhouette, puis la couleur, puis
le détail : travées, étages, rez-de-chaussée et balcons priment sur la texture.

| Archétype | Murs | Toit | Façade (signature à 35 km/h) |
| --- | --- | --- | --- |
| `haussmann` | pierre de taille `#dcd0b8` → `#cfc2a8`, assises de 50 cm | zinc `#7f8a90` (mansarde à l'étape 2) | rez-de-chaussée de 4,4 m à refends et vitrines, portes-fenêtres de 2,15 m sans volets, balcons filants aux 2e et 5e étages, bandeaux, corniche |
| `faubourien` | plâtre `#e4ddcf` → `#d4c8b0` | zinc ou tuile mécanique | étages de 2,8 m, persiennes grises, balconnets en fonte, vitrines sur rue |
| `brique` | brique `#a35f45` → `#8f5240` | tuile mécanique `#9a5a40` | larges baies à encadrement clair, bandeaux, corniche |
| `moderne` | béton `#cfcac0`, panneaux de 3 m | terrasse | bandeaux de fenêtres de 2,2 m, sans volets ni modénature |
| `maison_faubourg` | enduit pastel `#e9dfc9` → `#dcc7a5` | tuile mécanique | maison basse à volets peints (vieux village de Montmartre) |
| `meuliere`, `enduit_idf`, `pierre_auvergne` | rendu historique d'Île-de-France et de Limagne, décrit en archétypes | tuile plate / canal | réservés aux profils de l'étape 6 |

Profils de monde : **Montmartre** (pierre et 5 niveaux ou plus → haussmannien à 85 %, brique →
`brique`, béton ou 10 niveaux et plus → `moderne`, 3 à 4 niveaux → faubourien, petites maisons →
`maison_faubourg`).

## Ciels et heures

- **Aube** : bleu froid → rose saumon à l'horizon, brume dans les vallées, soleil bas.
- **Matinée** : ciel `#7fb0e6`, cumulus épars, ombres longues.
- **Midi** : contraste fort, ombres courtes, ciel profond `#4f8fd9`.
- **Soir / heure dorée** : or `#ffb35c` → mauve `#8b6aa8`, contre-jour sur la route, rayons dans les sous-bois.
- **Nuit** : bleu nuit `#0d1a2e`, lune, éclairage public orangé dans les villages, phare du vélo.
- Météo : couverture nuageuse (0–100 %), pluie (route mouillée, gouttes, éclaboussures), brouillard (densité de brume), vent (végétation, et effet sur la physique).

## HUD et interface

- Typographie : **Inter** (texte) et **JetBrains Mono** chiffres tabulaires pour les valeurs.
- Couleurs : fond `rgba(10,14,22,0.62)` avec flou, texte `#f5f7fa`, accent jaune maillot `#ffd23f`, zones de puissance Z1 `#9aa5b1`, Z2 `#3b82f6`, Z3 `#22c55e`, Z4 `#eab308`, Z5 `#f97316`, Z6 `#ef4444`, Z7 `#a855f7`.
- Disposition 16:9 : puissance (grand) en haut au centre, FC / cadence / vitesse autour ; profil de l'itinéraire en bas ; mini-carte en haut à droite ; classement des coureurs proches à droite ; vitesses virtuelles en bas à gauche.
- 32:9 : les panneaux s'écartent vers les bords, la route garde le centre ; champ de vision horizontal élargi (pas d'étirement).
- Les mêmes jetons de design (couleurs, typos, rayons) servent aux séquences HyperFrames (`packages/sequences/tokens.css`).

## Avatars et vélos

- Proportions réalistes, surfaces légèrement stylisées ; peau et tissu en PBR (le tissu des maillots en subsurface léger).
- Personnalisables : morphologie, peau, cheveux, tenue (maillot, cuissard, chaussettes, casque, lunettes), vélo et roues ; option de ressemblance à partir d'une photo, avec accord.
- Pédalage procédural calé sur la cadence réelle ; position assis / danseuse / roue libre.

## Références

Ambiances à collecter en planches (photos libres de droits ou personnelles) : routes de la vallée de Chevreuse en automne, plateau de Saclay au lever du soleil, étangs de Hollande en forêt de Rambouillet, villages de Dampierre et Saint-Lambert. Aucun visuel issu de Zwift ou MyWhoosh n'entre dans le dépôt.
