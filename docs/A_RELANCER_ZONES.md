# Zones à (re)générer — génération arrêtée le 24/10/2026 vers 0 h

Arrêt demandé en cours de série. Tout ce qui est listé ici reste à lancer, **dans l'ordre**, depuis la
racine du dépôt. Une construction à la fois (le WMS de l'IGN est lent la nuit : 10 à 100 s par tuile).

> ⚠️ Une autre session construit aussi des mondes dans ce dossier (Billom en cours au moment de
> l'arrêt). Vérifier qu'aucun `build-world.ts` ne tourne avant de lancer :
> `powershell -NoProfile -Command "Get-CimInstance Win32_Process -Filter \"Name='node.exe'\" | ? { $_.CommandLine -match 'build-world' } | % CommandLine"`
>
> En arrêtant mes constructions, j'ai aussi tué par erreur une construction **Sancy** de cette autre
> session (`--world sancy`) : elle est à relancer par elle (ou ci-dessous en fin de liste).

## 1. Vallée de Chevreuse + 4 côtes célèbres (interrompue pendant l'écriture des tuiles)

Les itinéraires des côtes sont écrits (`routes/cote-de-*.json`) mais `world.json` est encore
l'ancien et les tuiles sont à moitié refaites : **à relancer avant d'utiliser ou de committer
Chevreuse**. Il faut les sorties Garmin dans `data/garmin/` (déjà là). ≈ 25–40 min.

```bash
pnpm --filter @allezrobert/terrain build:world -- --world chevreuse
```

À vérifier dans le journal : 4 lignes `côte : …` (Madeleine, Châteaufort, Vaux de Cernay, Méridon),
`audit vie privée : OK`.

## 2. Paris–Roubaix (cache complet, échec corrigé)

Échec précédent : « pas de chemin jusqu'au point de passage 3 » (Trouée d'Arenberg rejointe par des
pistes). Corrigé (`allowTracks` sur le tour). Tout est en cache : ≈ 15–25 min.

```bash
pnpm --filter @allezrobert/terrain build:world -- --world roubaix --offline
```

## 3. Les zones neuves (réseau)

```bash
for z in tourmalet basque annecy fontainebleau saint-cloud cote-de-nuits alsace; do
  pnpm --filter @allezrobert/terrain build:world -- --world $z > data/cache/build-$z.log 2>&1
  echo "$z exit $? $(grep -o 'durée.*' data/cache/build-$z.log)"
done
```

| Zone | Tuiles | Remarque |
|---|---|---|
| tourmalet | 391 | la plus longue (≈ 1 h 30+) ; 44 tuiles déjà enrichies en cache |
| basque | 176 | bord de mer ; emprise arrêtée à l'est de la Bidassoa (pas de relief IGN en Espagne) : vérifier qu'aucun bout d'Espagne près de Béhobie n'apparaît en mer |
| annecy | 270 | vérifier la surface du lac en jeu |
| fontainebleau | 221 | |
| saint-cloud | 96 | voisine de Longchamp et de Meudon (bloc « Zones voisines ») |
| cote-de-nuits | 180 | |
| alsace | 121 | |

**Montmartre est déjà construite** (5,9 km, D+ 140 m) : seulement vérifier sa boucle (§ 4).

Sancy (autre session) si besoin : `pnpm --filter @allezrobert/terrain build:world -- --world sancy`

## 4. Après chaque zone : vérifier la boucle

Les points de passage donnés par un **nom de village** mènent au centre du village : aller-retour
possible. Détection des allers-retours (même endroit repassé à moins de 3 km d'écart) :

```bash
node -e '
const id=process.argv[1];const w=require("./apps/client/public/worlds/"+id+"/world.json");
for(const e of w.routes){const r=require("./apps/client/public/worlds/"+id+"/"+e.file);const p=r.points;const out=[];
for(let i=0;i<p.length;i+=4)for(let j=i+40;j<p.length;j+=4){if(Math.hypot(p[i].x-p[j].x,p[i].z-p[j].z)<8&&p[j].d-p[i].d<3000){out.push([Math.round(p[i].d),Math.round(p[j].d)]);break;}}
console.log(e.id,r.loop,(r.lengthM/1000).toFixed(1)+" km","D+",Math.round(r.elevationGainM),JSON.stringify(r.segments.map(s=>s.name)),"allers-retours",JSON.stringify(out.filter((o,i)=>i===0||o[0]-out[i-1][0]>100)))}' montmartre
```

Correction : dans `tools/terrain/src/config.ts`, remplacer le nom du village par un point
`{ lon, lat }` pris **sur la route traversante** (lire les coordonnées du tracé avec
`data/cache/terrain/scratch/where.ts`), puis reconstruire la zone avec `--offline` (≈ 10 min).
Allers-retours voulus (routes sans issue) : cap Gris-Nez, Les Portes-en-Ré, les deux montées du
Tourmalet (montée et redescente).

## 5. Ensuite

1. Copier le `.gitignore` des tuiles dans chaque nouveau dossier :
   `for z in montmartre roubaix tourmalet basque annecy fontainebleau saint-cloud cote-de-nuits alsace; do cp apps/client/public/worlds/meudon/.gitignore apps/client/public/worlds/$z/; done`
2. Catalogue (fait par chaque construction ; sinon) : `pnpm --filter @allezrobert/terrain packs`
3. Vérifier en jeu : pavés d'Arenberg (rendu nouveau), lac d'Annecy, mer du Pays basque, défi KOM de
   Chevreuse (liste des 15 côtes dans la fenêtre de la zone).
4. Committer (sans les fichiers des autres sessions, voir § 6).
5. Mise en ligne : **le jeu d'abord** (il lit les deux formats d'altitudes), **puis les tuiles**
   (`apps/client/public/worlds/*/tiles`, non versionnées).

## 6. Changements de cette session non committés

À committer avec les zones (attention, certains fichiers sont aussi modifiés par d'autres sessions :
`menu.ts`, `config.ts`, `index.json` — relire le diff avant d'ajouter) :

- **Pavés visibles** : `apps/client/src/world/network.ts` (surface `sett`, `cobblestone`… : pavés
  décalés, joints, pas de marquage, brillants sous la pluie).
- **Pistes pavées et pistes d'accès dans les tours** : `tools/terrain/src/build-open.ts`
  (`cobbledTrack`, `allowTracks`).
- **LiDAR HD absent** (Nord) : `tools/terrain/src/lidar.ts`, `enrich.ts` — sous 50 % de couverture,
  végétation semée d'après OSM au lieu d'une tuile sans arbre.
- **Côtes célèbres dans un monde Garmin** : `tools/terrain/src/config.ts` (`climbs` de Chevreuse),
  `build-world.ts` (§ 6 bis), `apps/client/public/worlds/chevreuse/routes/cote-*.json`.
- **9 zones** : `tools/terrain/src/config.ts`, `apps/client/src/world/worlds.ts`, `zoneMap.ts`.
- **Menu** : `apps/client/src/ui/menu.ts` / `menu.css` — défi KOM : toutes les côtes de la zone,
  liste directe dans la fenêtre de la zone, panneau de gauche sans ascenseur (carte qui prend la
  place restante) ; `routePlanner.ts` (noms de l'aperçu à l'échelle de la carte agrandie).
