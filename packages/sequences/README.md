# @allezrobert/sequences — séquences animées HyperFrames

Les moments scénarisés du jeu, écrits en HTML + GSAP et rendus par
[HyperFrames](https://github.com/heygen-com/hyperframes) (HeyGen, Apache 2.0) :

- **en jeu**, par-dessus le canvas Three.js, via `<hyperframes-player>` : intro du parcours et
  compte à rebours, KOM / sprint franchi, arrivée et podium, habillage de la caméra « réalisation TV » ;
- **hors jeu**, en MP4 sur le VPS : la vidéo résumé envoyée aux participants.

Versions épinglées : `hyperframes` (CLI), `@hyperframes/player`, `@hyperframes/core` **0.8.185**, GSAP 3.15.

## Arborescence

```
tokens.css                  jetons de design partagés avec le HUD (--ar-*, --z1…--z7, --font, --mono)
assets/fonts/               Inter + JetBrains Mono (woff2 variables, OFL) — versionnés
lib/ar-seq.js, ar-seq.css   utilitaires communs des compositions (window.AR : variables, i18n, formats, profil, tracé…)
src/strings.ts              textes FR / EN (source unique)
compositions/<nom>/index.html   un projet HyperFrames par composition (intro, segment, podium, tv, summary)
compositions/<nom>/assets/  copies générées par scripts/sync-assets.ts (gitignore)
src/                        API TypeScript : SequencePlayer (navigateur), catalogue, assemblage, données du résumé
scripts/                    sync-assets, hf (check / render / snapshot / preview), render-summary, bench
samples/                    variables d'exemple (overlays) et données de sortie (résumé)
dev/                        banc d'essai navigateur (Vite, port 5180)
docker/Dockerfile.renderer  conteneur du renderer MP4
out/                        rendus et captures locales (gitignore)
```

## Compositions

Toutes en 1920 × 1080, 30 i/s au rendu, GSAP sur une timeline unique en pause
(`window.__timelines[id]`), déterministes (aucune horloge, PRNG semé, aucun réseau).

| Séquence (`play(nom)`) | Fichier | Durée | Type | Repères / maintien |
| --- | --- | --- | --- | --- |
| `intro` | `intro` | 6 s | overlay transparent | `countdown` 2,85 s · **`go` 5,1 s** (départ réel) |
| `kom` | `segment` (kind=kom) | 3,5 s | overlay transparent | — |
| `sprint` | `segment` (kind=sprint) | 3,5 s | overlay transparent | — |
| `podium` | `podium` | 6 s | overlay transparent | — |
| `tv` | `tv` | 6 s | overlay transparent | boucle de maintien 1,0 → 4,6 s (`hold`) + données en direct |
| `summary` | `summary` | 28 s | plein cadre opaque | rendu MP4 (jouable aussi en direct) |

Déroulé :

- **intro** — carte du parcours (saison, type de sortie, nom, distance, D+, coureurs, mini-profil SVG
  dessiné depuis les altitudes, lieux de départ / arrivée), puis disque 3 · 2 · 1 et « Allez ! ».
- **kom / sprint** — carte « segment franchi » : liseré à pois (KOM, rouge) ou vert (sprint), nom du
  segment, coureur, chrono qui défile, rang « 2e sur 12 », écart au meilleur temps, badge « Record perso −4,2 s ».
- **podium** — bandeau « Arrivée · Podium », trois marches qui montent (3e, 2e, 1er) aux couleurs
  d'équipe, noms / équipes / temps (écart pour 2e et 3e), halo et confettis semés pour le vainqueur.
- **tv** — bandeau coureur bas d'écran (position sur la couleur d'équipe, nom, équipe, W/kg, W, pastille
  « En direct ») et graphique des écarts entre groupes (jusqu'à 4 groupes, groupe du coureur surligné).
- **summary** — titre, tracé du parcours dessiné depuis les coordonnées avec point mobile synchronisé au
  profil d'altitude, chiffres (distance, temps, puissance moyenne, NP, D+, calories, vitesse moyenne),
  classement (le destinataire surligné « toi »), meilleurs moments (3 segments), fin « À la prochaine ! ».

## Variables

Les variables HyperFrames sont scalaires (`string`, `number`, `boolean`, `color`, `enum`). Les listes
(profil, podium, groupes, tracé, classement, segments) sont des **chaînes JSON** ; l'API TypeScript
accepte directement des tableaux et les sérialise (`serializeVariables`). Les types complets sont dans
`src/catalog.ts` (`IntroVariables`, `SegmentVariables`, `PodiumVariables`, `TvVariables`, `SummaryVariables`).

Communes à tous les overlays : `lang` (`fr` | `en`, défaut `fr`), `preview_backdrop` (faux décor 3D
pour les rendus de contrôle) et `show_safe_zones` (contours des zones vitales du HUD) — ces deux
dernières restent à `false` en jeu.

| Composition | Variables |
| --- | --- |
| intro | `route_name`, `ride_type` (free · group · race · workout · ftpTest), `season` (printemps · ete · automne · hiver), `distance_km`, `elevation_m`, `riders`, `start_label`, `finish_label`, `profile` (altitudes en m, régulièrement espacées), `accent` (couleur) |
| kom / sprint | `kind` (imposé par le nom), `segment_name`, `rider_name`, `time_s`, `rank`, `rank_total`, `gap_s` (écart au meilleur temps, 0 = meilleur temps), `pr`, `pr_delta_s` |
| podium | `route_name`, `podium` (`[{name, time_s, team, team_color}]`, du 1er au 3e), `seed` (confettis) |
| tv | `show_banner`, `rider_name`, `team`, `team_color`, `position`, `wkg`, `watts`, `show_gaps`, `groups` (`[{label, riders, gap_s, color}]` — `label` = clé `tv.breakaway` · `tv.chasers` · `tv.peloton` · `tv.gruppetto` · `tv.leader` ou texte libre), `focus_group` (index, −1 = aucun) |
| summary | `ride_title`, `date_label`, `route_name`, `season`, `rider_name`, `trace` (`[[lat, lon], …]` ou `[[x, y], …]`), `trace_projection` (latlon · xy), `elevation` (altitudes), `distance_km`, `duration_s`, `avg_power_w`, `np_w`, `elevation_m`, `calories_kcal`, `leaderboard` (`[{name, time_s, team_color, me}]`, 8 max), `segments` (`[{kind, name, time_s, rank, rank_total, pr, pr_delta_s}]`, 3 max), `accent` |

Textes : toutes les chaînes de l'interface viennent de `src/strings.ts` (FR / EN, mêmes clés,
vérifié par les tests). Les nombres sont formatés à la française (`42,3`, `1 098`, `4:23,4`) ou à
l'anglaise selon `lang`. Les textes fournis par variables passent par `textContent` (jamais d'HTML).

## Zones vitales (« ne jamais masquer les données vitales »)

Géométrie du HUD (`apps/client/src/hud/hud.css`) exprimée en px composition, pour un HUD à l'échelle
1:1 dans une fenêtre 1080p (`SAFE_ZONES` dans `src/catalog.ts`) :

| Zone | x | y | l × h |
| --- | --- | --- | --- |
| Puissance · FC · cadence · pente · segment (haut centre) | 560 | 0 | 800 × 260 |
| Infos (haut gauche) | 0 | 0 | 260 × 160 |
| Mini-carte (haut droite) | 1660 | 0 | 260 × 255 |
| Coureurs proches (droite) | 1660 | 255 | 260 × 450 |
| Micro / capteurs / vitesses / équilibre (bas gauche) | 0 | 720 | 400 × 230 |
| **Profil de l'itinéraire (bas)** | 0 | 950 | 1920 × 130 |

Zones occupées par les overlays (`SEQUENCES[nom].occupies`, test automatique « aucun recouvrement ») :
intro carte x 440–1480 / y 262–692 et compte à rebours x 660–1260 / y 712–942 ; segment x 560–1360 / y 282–496 ; podium x 460–1460 / y 262–920 ;
TV bandeau x 420–1220 / y 770–916 et écarts x 24–524 / y 276–540.

Le HUD est en px CSS fixes alors que la composition est mise à l'échelle (contain) : dans une fenêtre
plus petite que 1080p, le HUD occupe proportionnellement plus de place. Passer alors des marges au
lecteur : `new SequencePlayer(app, { insets: { top: 250, bottom: 130 } })` (ou `setInsets()`) — la
composition est réduite dans la bande libre. Les marges ne s'appliquent pas au résumé plein cadre.
En 32:9, la composition 16:9 reste centrée (la route garde le centre, les panneaux du HUD sont aux bords).

Contrôle visuel : `pnpm --filter @allezrobert/sequences snapshot kom samples/kom.preview.json --at 1.8`
(les fichiers `samples/*.preview.json` activent décor et zones).

## Performance (« jamais de chute de fps »)

- Hors lecture : aucun élément dans le DOM (le calque est `display: none`, le lecteur est retiré à la fin).
- Compositions légères (≈ 20–60 nœuds par overlay), animations en `transform` / `opacity`
  uniquement ; seules exceptions : le défilement des chiffres (texte) et le tracé du résumé
  (`stroke-dashoffset`, hors jeu). Pas de `backdrop-filter` (inopérant dans l'iframe et coûteux),
  pas de filtre animé, polices locales.
- `preload()` télécharge le code (chunks paresseux) **et chauffe** chaque composition dans un lecteur
  invisible (≈ 0,5 s au total, à faire pendant un écran de chargement).
- Mesures (`pnpm --filter @allezrobert/sequences bench`, Chrome headless, page hôte animée en continu,
  build de production) : 60 i/s de référence, p95 de 16,8 ms pendant toutes les séquences ; une seule
  image longue au montage du lecteur (≈ 33 ms après chauffe, 50–130 ms sans chauffe ; 67–83 ms pour la
  première intro, avant le départ). Mêmes valeurs en 1280 × 720.

## Prévisualiser

```bash
pnpm --filter @allezrobert/sequences dev                 # banc d'essai : http://localhost:5180 (boutons, fps, maintien, update)
pnpm --filter @allezrobert/sequences preview tv          # Studio HyperFrames (édition visuelle de compositions/tv)
pnpm --filter @allezrobert/sequences check               # lint + audits navigateur (runtime, layout, contraste) de toutes les compositions
pnpm --filter @allezrobert/sequences snapshot intro samples/intro.preview.json --at 1.9,3.1,5.4
pnpm --filter @allezrobert/sequences bench               # mesure fps + captures dans out/bench/ (banc dev lancé)
pnpm --filter @allezrobert/sequences test                # tests unitaires (catalogue, zones, assemblage, données du résumé)
```

Les scripts recopient d'abord les ressources partagées (`sync-assets`) : après modification de
`tokens.css`, `lib/` ou `src/strings.ts`, il suffit de relancer la commande. Seul avertissement
`check` restant : `composition_file_too_large` sur le résumé (fichier monolithique volontaire, voir Limites).

## Rendre

```bash
# n'importe quelle séquence, variables d'exemple → out/<nom>-<échantillon>.mp4
pnpm --filter @allezrobert/sequences render intro samples/intro.preview.json --out out/intro.mp4
pnpm --filter @allezrobert/sequences render kom samples/kom.preview.json --format webm   # overlay transparent (VP9 + alpha)

# vidéo résumé depuis les données d'une sortie
pnpm --filter @allezrobert/sequences render:summary samples/ride.sample.json out/summary.mp4 [--lang en] [--quality draft|looks|delivery] [--fps 30]
```

Résultats de référence (Windows 11, RTX 4090, capture « screenshot ») :

| Fichier | Durée | Taille | Temps de rendu |
| --- | --- | --- | --- |
| `out/intro.mp4` (FR, décor + zones) | 6,0 s, 1920×1080, H.264 30 i/s | 532 Ko | 16 s |
| `out/intro-en.mp4` | 6,0 s | 443 Ko | 15 s |
| `out/kom-overlay.webm` (alpha) | 3,5 s, VP9 + alpha | 337 Ko | 18 s |
| `out/summary.mp4` (qualité looks) | 28,0 s, 1920×1080, H.264 30 i/s | 4,5 Mo | 52 s |
| `out/summary-en.mp4` (qualité draft) | 28,0 s | 3,3 Mo | 71 s |

### Données d'entrée du résumé

`render-summary` accepte un `RideSummaryInput` (`src/summary-data.ts`) :

```jsonc
{
  "lang": "fr",
  "title": "La sortie du dimanche",
  "date": "2026-10-18T09:30:00+02:00",      // → « Dimanche 18 octobre 2026 » ; saison déduite si absente
  "routeName": "Boucle de la Madeleine",
  "riderName": "Christophe P.",
  "trace": [[48.706, 2.132], …],             // ou omis : déduit de records[].lat/lon
  "elevation": [92, 95, …],                  // ou omis : déduit de records[].altitudeM
  "stats": { "distanceKm": 42.3, "durationS": 5135.6, "avgPowerW": 214, "npW": 236, "elevationM": 612, "caloriesKcal": 1098 },
  "records": [ … ],                          // optionnel : ActivityRecord de @allezrobert/shared, complète les stats manquantes (NP 30 s, D+ avec hystérésis, kJ ≈ kcal)
  "leaderboard": [{ "name": "Robert", "time_s": 5123, "team_color": "#ef4444" }, { "name": "Christophe P.", "time_s": 5135.6, "me": true }],
  "segments": [{ "kind": "kom", "name": "Côte de la Madeleine", "time_s": 263.4, "rank": 2, "rank_total": 12, "pr": true, "pr_delta_s": 4.2 }]
}
```

…ou directement l'objet de variables de la composition (s'il contient `ride_title`). Usage programmatique
côté serveur : `import { renderSummary } from '@allezrobert/sequences/render-summary'`
→ `renderSummary(input, 'out.mp4', { quality: 'looks' })` renvoie `{ output, bytes, durationS }`.

### Renderer sur le VPS

Dépendances système : **Node ≥ 22**, **FFmpeg + FFprobe** (PATH ou `HYPERFRAMES_FFMPEG_PATH` /
`HYPERFRAMES_FFPROBE_PATH`), **Chromium** : le chrome-headless-shell épinglé par la CLI
(`npx hyperframes browser ensure`, cache `~/.cache/hyperframes`) ou `PRODUCER_HEADLESS_SHELL_PATH`, plus
les bibliothèques Chromium (libnss3, libgbm1, libatk-bridge2.0-0, libgtk-3-0, libasound2…). Diagnostic :
`npx hyperframes doctor`. Image proposée : `docker/Dockerfile.renderer`, base **`node:22-bookworm-slim`**
(comme l'image officielle de la CLI), `--shm-size=1g` conseillé. Compter ≈ 1 Go de RAM par worker Chrome
(`--workers` pour limiter) ; un rendu de 28 s prend ≈ 1 min sur un poste rapide, davantage en rendu
logiciel sur un VPS sans GPU — à placer derrière la file d'attente.

## Intégrer dans le client

```ts
import { SequencePlayer } from '@allezrobert/sequences';
import '@allezrobert/sequences/tokens.css'; // facultatif : mêmes jetons + polices pour le HUD

const seq = new SequencePlayer(document.getElementById('app')!, { lang: settings.lang });
await seq.preload(); // pendant le chargement : code + chauffe des compositions

// Départ : on lance la course au repère « go »
await seq.play('intro', { route_name, distance_km, elevation_m, riders, season, profile: altitudes },
  { onCue: (cue) => cue === 'go' && race.start() });

// Événement serveur segmentEnd
void seq.play(seg.kind === 'sprint' ? 'sprint' : 'kom',
  { segment_name, rider_name, time_s: ev.timeMs / 1000, rank: ev.rank, rank_total, gap_s, pr: ev.pr, pr_delta_s });

// Caméra TV : maintien tant que la caméra suit le coureur, mises à jour en direct
const tv = seq.play('tv', { rider_name, team, team_color, position, wkg, watts, groups }, { hold: true });
setInterval(() => seq.update({ wkg, watts, position, groups, focus_group }), 1000);
// … changement de caméra :
seq.release(); await tv;
```

API (`src/player.ts`) :

```ts
class SequencePlayer {
  constructor(container: HTMLElement, options?: { lang?: 'fr' | 'en'; insets?: Insets; zIndex?: number; readyTimeoutMs?: number });
  preload(names?: SequenceName[], options?: { warm?: boolean }): Promise<void>;
  play<N extends SequenceName>(name: N, variables?: Partial<SequenceVariablesMap[N]>, options?: PlayOptions): Promise<PlayResult>;
  release(): void;              // sort de la boucle de maintien (tv)
  update(data: TvLiveData): void; // données en direct, sans rechargement
  stop(reason?: 'stopped' | 'interrupted'): void;
  setLang(lang: Lang): void;
  setInsets(insets: Insets): void;
  dispose(): void;
  readonly current: SequenceName | null;
  readonly holding: boolean;
  readonly layer: HTMLDivElement;
}
interface PlayOptions { lang?: Lang; hold?: boolean; onCue?: (cue: string, time: number) => void; signal?: AbortSignal; insets?: Insets }
interface PlayResult { name: SequenceName; completed: boolean; reason: 'ended' | 'stopped' | 'interrupted' | 'aborted' | 'error'; error?: string }
```

`play()` ne rejette jamais : une nouvelle lecture interrompt la précédente (`reason: 'interrupted'`).
Le conteneur doit être positionné (ex. `#app { position: fixed; inset: 0 }`) ; le calque est en
`pointer-events: none` et `z-index: 20` (au-dessus du canvas, sous les menus).

### Comment c'est chargé (Vite)

HyperFrames ne fournit pas d'API pour passer des variables au `<hyperframes-player>` ; le runtime lit
`window.__hfVariables` (fusionné avec les défauts déclarés), exactement comme `render --variables`.
`SequencePlayer` assemble donc un document autonome (`src/assemble.ts`) passé en **`srcdoc`** :
HTML de la composition importé en `?raw`, CSS / GSAP / utilitaires / textes inlinés, polices en `?url`
(fichiers hachés par Vite), `window.__hfVariables` et le **runtime HyperFrames inliné**
(`@hyperframes/core/runtime-script`) — le lecteur n'injecte alors pas sa copie CDN : tout fonctionne
hors ligne, y compris dans l'app desktop. Tout est en imports dynamiques : le chunk principal ne pèse
que ≈ 16 Ko ; le reste (≈ 800 Ko, ≈ 265 Ko gzip, dont 556 Ko de runtime) n'est chargé qu'au premier
`preload()` / `play()`. Mêmes fichiers HTML pour la CLI (rendu MP4) et le jeu : aucune divergence.

## Limites connues

- **Variables figées au chargement** : changer une variable = recharger la composition (≈ 1 image
  longue). Seul l'habillage TV accepte des mises à jour en direct (`update`, canal runtime data
  `ar-tv`, textes uniquement).
- **Durée fixe** par composition (`data-duration` lu à la compilation) : le résumé dure 28 s même avec
  peu de segments (la scène des meilleurs moments est alors remplacée par une fin plus longue).
- **Pas d'audio** dans les séquences (le jeu gère ses sons ; le lecteur est muet et verrouillé).
- **Iframe same-origin** (`allow-same-origin` + scripts, nécessaire aux données en direct) : ne charger
  que nos compositions, jamais de HTML fourni par un utilisateur.
- **Onglet masqué** : le navigateur bride `requestAnimationFrame` ; une séquence jouée en arrière-plan
  avance par à-coups (sans conséquence en jeu, mais les mesures de fps n'ont de sens que fenêtre visible).
- **Le HUD n'est pas mis à l'échelle** avec la fenêtre : utiliser `insets` en dessous de 1080p (voir Zones vitales).
- Les avatars ne sont pas animés par HyperFrames (pédalage procédural côté Three.js).
- Résumé monolithique (un seul fichier, avertissement `composition_file_too_large`) : choix volontaire
  pour que le même fichier se charge en `srcdoc` sans sous-compositions à résoudre.
- Le Dockerfile n'a pas encore été construit ; le rendu est validé sous Windows (capture « screenshot »,
  GPU matériel). Sur Linux, la CLI utilise BeginFrame avec chrome-headless-shell.
