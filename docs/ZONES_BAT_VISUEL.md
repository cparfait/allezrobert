# ZONES-BAT-2a · Compléments visuels de bâtiment

## Identité de source

La tuile conserve les identifiants déjà livrés. La BD TOPO fournit `bdtopo:<CLEABS>` et le pipeline OSM conserve `w…` ou `r…`. Le décodeur transmet l’ID à la liste de bâtiments consommée par `Buildings.addTile`, dans le même ordre et avec les mêmes champs géométriques. Les anciens bâtiments sans ID restent rendables. Aucun ID n’est inventé. Un ID répété dans la même tuile ne permet aucune correction sur cet ID.

L’adresse d’un bâtiment est le tuple `(buildingSource.worldId, buildingSource.tileId, building.id)`. Le monde source désigne ici la zone de fichiers qui fournit effectivement la tuile. En mode composite, le client choisit la zone propriétaire, puis translate la tuile. Le couple source et les mesures déjà validées sont conservés. Le nouveau `LoadedTile.id` exprime la position dans la grille d’affichage, indépendamment de l’ID de tuile source.

## Format v1

Deux fichiers facultatifs se trouvent dans `worlds/<zone>/tiles/`. Aucun de ces fichiers n’est présent pour une zone ordinaire.

| Fichier | Champs |
| --- | --- |
| `buildings-visual.json` | `schemaVersion: 1`, `worldId`, `tiles` associant chaque ID de tuile au SHA-256 intégral des octets de son complément. |
| `<tx>_<tz>.buildings-visual.json` | `schemaVersion: 1`, `worldId`, `tileId`, `sourceTileSha256` et `corrections`. L’empreinte de source porte sur les octets UTF-8 exacts du JSON de tuile de base tel qu’il est chargé après décompression. |

Une correction v1 a un `buildingId` source et un `kind: "roof"`. `eaveM` et `ridgeM` sont des altitudes absolues en mètres **IGN69**. `pitchDeg` est en degrés, de 0 inclus à 90 exclu. Les valeurs sont finies, et le faîtage est à la cote de l’égout ou au-dessus. `confidence` vaut `medium` ou `high`. `provenance` porte le jeu de données, la référence du relevé ou du dossier, la date ISO du relevé et la méthode, dans `dataset`, `reference`, `observedOn` et `method`. La v1 décrit des mesures simples. Elle ne définit ni maillage, ni axes, ni sections multiples.

## Format v2 · pignon à faîtage libre (ZONES-BAT-2c)

Le complément de tuile peut passer en `schemaVersion: 2` pour porter une correction `kind: "gable"`. Il s'agit de deux pans plans de part et d'autre d'une ligne de faîtage quelconque : faîtage décentré, pentes inégales.

| Champ | Sens |
| --- | --- |
| `ridge` | `[x1, z1, x2, z2]` en mètres, **relatif au premier sommet de l'emprise** (`pts[0]`, `pts[1]`) de la tuile source. La correction suit ainsi le bâtiment quand un monde composite translate la tuile. |
| `ridgeM` | Altitude IGN69 du faîtage, supposé horizontal. |
| `pitchLeftDeg`, `pitchRightDeg` | Pente de chaque pan, dans ]0 ; 60°]. Le pan gauche est du côté où (x2 − x1)(z − z1) − (z2 − z1)(x − x1) < 0, c'est-à-dire à gauche en allant du point 1 au point 2 sur une carte nord en haut (x vers l'est, z vers le sud). |

`confidence` et `provenance` suivent les règles de la v1. L'égout n'est pas stocké : il se déduit, mur par mur, de la distance à la ligne de faîtage et de la pente du pan. Le contrat ne dépend donc pas de la façon dont le générateur construit ses toits.

Règles de validation :
- les deux extrémités, ramenées au repère de l'emprise, tombent dans sa boîte élargie de 1 m ;
- le faîtage mesure au moins 1 m ;
- un bâtiment sans emprise ne peut pas recevoir de pignon.

Versions :
- le producteur écrit la version la plus basse qui suffit : un lot sans pignon reste en v1, lisible par les clients déjà publiés ;
- un fichier v2 doit contenir au moins un pignon ;
- un pignon dans un fichier v1 invalide le complément ;
- un client v1 refuse tout fichier v2 et garde le rendu de base ;
- l'index ne change pas et reste en version 1.

En 2c, le générateur n'applique pas encore les pignons. L'application est prévue en ZONES-BAT-2d.

## Format v3 · volumes (ZONES-BAT-3b)

Un complément de tuile en `schemaVersion: 3` peut porter une correction `kind: "volumes"`. Elle décrit un bâtiment fait de plusieurs volumes, chacun avec sa hauteur et son toit.

Le champ `parts` liste de 1 à 12 volumes. Chacun a :
- `pts` : la sous-emprise, en mètres, relative au premier sommet de l'emprise du bâtiment ;
- `roof` : le toit, soit à deux pans (`type: "gable"`, avec `ridgeM`, `ridge` relatif au même premier sommet, `pitchLeftDeg` et `pitchRightDeg`, selon les règles de la v2), soit plat (`type: "flat"`, avec `topM` en IGN69).

Règles de validation :
- chaque sous-emprise est un polygone simple d'au moins 1 m² ;
- ses sommets restent dans la boîte de l'emprise élargie de 0,5 m ;
- son centre est dans l'emprise ;
- la somme des aires des sous-emprises vaut celle de l'emprise à 3 % près ;
- le faîtage d'un volume tombe dans la boîte de ce volume, élargie de 1 m.

Le chevauchement entre volumes n'est pas vérifié directement : la règle d'aire le limite.

L'emprise de base, et donc la collision COLL-MURS, ne change pas : seul le rendu est découpé.

Versions :
- le producteur écrit la version la plus basse qui suffit (v1, v2 ou v3) ;
- un client v2 refuse un fichier v3 et garde le rendu de base ;
- l'index ne change pas.

Derrière `?visualBuildings=1`, le générateur (ZONES-BAT-3c, `volumesRoof.ts`) dessine chaque volume comme un prisme. Ses murs montent jusqu'à son toit : deux pans via `gableRoof.ts`, ou dalle plate.

Pilote : le repère 28 du Roussel, découpé en trois volumes aux décrochements de son emprise. L'écart moyen au MNS LiDAR passe de 1,28 m à 0,12 m.

Le repère 54 demandera un découpage piloté par le LiDAR (plans de toit) : ses volumes ne suivent pas les sommets de l'emprise.

L’index et le complément doivent être compatibles avec le monde et la tuile réellement décodée. Chaque ID corrigé doit exister exactement une fois. Une correction dupliquée, une version inconnue ou une entrée invalide invalide le complément de la tuile. Seuls les champs du contrat sont exposés au client. Un changement quelconque du JSON de base, même de mise en forme, demande de recalculer le lien de compatibilité.

[Exemple synthétique complet](../apps/client/test/fixtures/building-visual/0_0.buildings-visual.json) · [Tuile source synthétique](../apps/client/test/fixtures/building-visual/0_0.json)

## Chargement, version et repli

La lecture est désactivée par défaut. `?visualBuildings=1` active uniquement la lecture et la validation. Le résultat est une table de métadonnées séparée des entités de base. Le générateur Three.js ne l’applique pas en 2a, même avec le drapeau.

Le client demande un index réseau avec `cache: "no-store"`, une fois par ouverture de la zone. Il demande chaque complément avec son SHA-256 dans l’URL, sans passer par le pack installé, puis vérifie les octets reçus et le SHA de la tuile chargée. Cela évite d’utiliser silencieusement un ancien complément ou d’appliquer un complément récent à une tuile installée incompatible. L’index constitue l’instantané de la session. Une réouverture de la zone découvre la nouvelle révision. Sans réseau, sans Web Crypto, après expiration du délai, ou si un fichier manque ou échoue à la validation, les entités et le rendu existants sont conservés. Le pack de base reste utilisable hors ligne.

Lorsqu’un pack contient des fichiers de correction, leur empreinte contribue aussi à la version de pack. Les packs ordinaires gardent leur formule historique. Les SHA visuels n’interviennent ni dans les prismes, ni dans le manifeste COLL-MURS, ni dans le protocole de salle.

## Point de branchement du constructeur

`writeBuildingVisualCorrections` dans `tools/terrain/src/building-visual.ts` est le point commun pour la CLI et le Constructeur de zone. Le futur appel peut suivre `writeWorldTiles` et précéder la fabrication du pack. Pour mettre à jour une zone existante, le même producteur peut lire une copie de ses tuiles de base sans les réécrire. En 2a aucun build n’appelle le producteur.

Le producteur valide tout le lot avant la première écriture. Il trie les tuiles et les corrections par identifiant, sérialise en UTF-8 avec des fins de ligne LF, remplace les fichiers un par un, puis publie l’index en dernier. Le producteur et la fabrication du pack doivent être séquencés. Si un lecteur rencontre des versions intermédiaires discordantes, le SHA déclenche le repli. Les anciens compléments sans entrée dans l’index sont ignorés.

## ZONES-BAT-2b · Résultat des étapes 1 et 2 (11/11/2026)

La tuile `-1_-1` publiée (SHA `293f26e0…`) contient le 49 une seule fois. Le LiDAR HD du 2 août 2022 montre deux pans de 17,3° et 17,6°, avec un faîtage à 365,07 m, **décalé de 1,56 m vers le sud**.

Le contrat v1 corrige la pente : l'écart moyen au MNS passe de 0,73 à 0,43 m. Il ne peut pas représenter ce décalage, d'où la v2. Un prototype de pignon v2 ramène l'écart à 0,08 m.

Valeurs du 49 en v2 :
- `ridge` : `[-0.63, -2.42, 12.06, -5.70]`, relatif à (−76,3 ; −659,8) ;
- `ridgeM` : 365,07 ;
- pan gauche, au nord, côté D152 : 17,27° ;
- pan droit, au sud : 17,56°.

## ZONES-BAT-2b · Pilote du bâtiment 49 après validation

1. Figer une copie de la tuile publiée Limagne `-1_-1` et de la géométrie de référence du Roussel. Vérifier l’unicité de `bdtopo:BATIMENT0000000310275523`, le SHA de la tuile, les cotes IGN69 et la correspondance avec les profils LiDAR de BAT-FID-ROUSSEL-2. Documenter les deux pans, leur axe, la pente d’environ 17,4° et les cotes d’égout et de faîtage. Si une donnée nécessaire au raccord des murs manque, la mesurer avant d’ajouter une correction.
2. Produire le complément sur une copie de zone et contrôler la mesure avec deux caméras appariées, dont une depuis la D152. Vérifier que le plan v1 permet de restituer le toit avec le générateur existant. Si la correction demande un axe ou des pans indépendants non représentables, étendre le contrat explicitement avant d’appliquer le toit.
3. Brancher l’application géométrique dans le générateur derrière le même drapeau, uniquement pour le tuple pilote. Garder la même emprise, le même pied de mur et le lot fusionné. Recalculer le raccord visuel des murs au toit. Vérifier que le drapeau désactivé et toute incompatibilité restituent le rendu historique. Relever l’écart de pente et de cotes, les triangles et les appels.
4. Comparer les SHA des tuiles de base, du relief, du tracé et des données physiques. Vérifier l’absence d’effet sur les voisins et le filtre du 38. Montrer le résultat avant toute décision de diffusion.
