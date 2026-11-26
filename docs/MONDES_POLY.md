# Mondes du mode Poly

Le mode Poly propose six mondes imaginaires. Ils ont tous la même emprise (x de −19 000 à 19 000 m, z de −13 000 à
13 000 m, tuiles de 1 km) et le même format que les zones réelles.

| Monde | Identifiant | Générateur | Doc |
| --- | --- | --- | --- |
| L’Île de Robert | `ile-de-robert` | `tools/island` | [ILE_DE_ROBERT.md](ILE_DE_ROBERT.md) |
| Le Pays de Robert | `pays-de-robert` | `tools/massif` | [PAYS_DE_ROBERT.md](PAYS_DE_ROBERT.md) |
| L’Archipel des volcans | `archipel-des-volcans` | `tools/archipel-des-volcans` | [ARCHIPEL_DES_VOLCANS.md](ARCHIPEL_DES_VOLCANS.md) |
| Le Grand Nord robertien | `grand-nord` | `tools/grand-nord` | [GRAND_NORD.md](GRAND_NORD.md) |
| Le Désert rouge | `desert-rouge` | `tools/desert-rouge` | [DESERT_ROUGE.md](DESERT_ROUGE.md) |
| Les Rizières et la jungle | `rizieres` | `tools/rizieres` | [RIZIERES.md](RIZIERES.md) |

## Ajouter un monde

1. **Générateur.** Copier `tools/massif` vers `tools/<id>`, puis l'adapter : `design.ts`, `land.ts`, `settle.ts`,
   `build.ts`. Prendre un `originL93` propre au monde, pour qu'il ne recouvre ni une zone réelle ni un autre monde.
2. **Module client.** Créer `apps/client/src/world/lands/<id>.ts`, une `PolyLand` (types dans `lands/types.ts`) :
   - `world` : titre, lieux de la carte, parcours en tête de liste, lieux à découvrir, nom du tour ;
   - `theme` : couleurs du sol par saison, sable, roche, neige, givre, feuillage, eau ;
   - `ring` : le circuit, s'il y en a un ;
   - `sites()` : le décor propre, construit près du coureur ;
   - `building` : le restyle des bâtiments, facultatif ;
   - `noFence` : facultatif.
3. **Inscription.**
   - Ajouter le module à `lands/index.ts`.
   - Ajouter l'identifiant à `POLY_LAND_IDS` et à `WORLD_LIST` dans `world/worlds.ts`.
   - Ajouter la vignette à `world/zoneMap.ts`.

## Conventions de parcours

Elles valent pour tous les mondes.

| Identifiant | Effet |
| --- | --- |
| `decouverte-…` | Étiquette « Découverte » ; à mettre en tête de `priority`. |
| `classique-…` ou `fleche-…` | Étiquette « Classique ». |
| `chrono-…` | Étiquette « Contre-la-montre ». En course, il se court en chrono (hors format tour), avec des arches intermédiaires. |
| `…-de-nuit` | Départ à 23 h ; étiquette « Montée de nuit ». |

## Ce qui reste commun

Ces éléments servent aux six mondes :
- l'écran de carte et le choix du monde (`ui/islandAtlas.ts`) ;
- les lieux à découvrir (`islandDiscover.ts`, une clé par monde) ;
- les gués et passerelles, trouvés d'après le graphe (`polyOutdoor.ts`) ;
- la sortie virtuelle et la météo de la ville du joueur ;
- les formats de course ;
- le tour à étapes.
