import { getLang } from '../i18n/index.ts';

/** Adresse de l'outil de création de zones (`pnpm zone-builder`, voir docs/CONSTRUIRE_UNE_ZONE.md). */
const TOOL_URL = 'http://127.0.0.1:5199';
const KEY = 'ar.expert';

export const isExpertMode = (): boolean => localStorage.getItem(KEY) === '1';

/** L'outil répond-il sur cette machine ? (réponse opaque suffisante : pas de CORS, on teste seulement la connexion) */
async function toolRunning(): Promise<boolean> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 1500);
  try {
    await fetch(`${TOOL_URL}/api/zones`, { mode: 'no-cors', cache: 'no-store', signal: ctl.signal });
    return true;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

const cmd = (c: string): string => `<code style="display:block;margin:4px 0;padding:6px 8px;background:#0006;border-radius:6px;user-select:all">${c}</code>`;

function tutorial(fr: boolean): string {
  const steps: Array<[string, string]> = fr
    ? [
        ['Ce qu’il faut', `Un ordinateur (Windows, Mac ou Linux) avec <b>Node.js 22 ou plus</b>, <b>pnpm</b> et <b>Git</b>, une connexion Internet et <b>20 à 50 Go libres</b> (relief LiDAR et photos de l’IGN, routes d’OpenStreetMap). L’outil tourne <b>sur ta machine</b>, pas sur le serveur du jeu.${cmd('git clone &lt;adresse du dépôt du jeu&gt;<br>cd allezrobert<br>pnpm install')}`],
        ['Lancer l’outil', `Dans le dossier du jeu : ${cmd('pnpm zone-builder')}Puis ouvre <b>${TOOL_URL}</b> (le bouton ci-dessus le fait). Pour l’arrêter : Ctrl+C dans le terminal.`],
        ['Dessiner la zone', '« Emprise » : trace un rectangle sur la carte (fond Plan IGN). Vise <b>4 à 8 km de côté</b> ; au-delà de 150 tuiles de 1 km, la construction devient longue. L’estimation (tuiles, durée, cache) s’affiche.'],
        ['Remplir le formulaire', 'Il se remplit seul : nom, région, accroche, bord de mer. Retouche ce que tu veux (un champ modifié n’est plus écrasé). <b>Orthophotos (px / km)</b> : définition de la photo posée sur le sol pour chaque tuile de 1 km. 1024 ≈ 1 m par pixel (conseillé) ; 512 ≈ 2 m (plus léger et rapide) ; 2048 ≈ 0,5 m (beaucoup plus lourd).'],
        ['Choisir l’itinéraire', '« Proposer des tours » calcule des boucles sur de vraies routes (longueur réglable), puis « Utiliser ce tour ». Tu peux aussi poser le départ et les points de passage à la main, environ un tous les 2 à 3 km, sur des routes plutôt que dans les champs.'],
        ['Construire', '« Enregistrer + construire » : téléchargement, assemblage et vérification (30 min à 2 h selon la taille). Le journal s’affiche en direct ; « Annuler » arrête, et « Construire / reprendre » repart du cache.'],
        ['Vérifier', '« Vérifier cette zone » ou « toutes les zones » compare les routes au terrain (coureurs enfoncés ou en l’air, sauts de hauteur, raccords de tuiles) et signale ce qui est à regarder.'],
        ['Rouler', `Quand c’est fini, la zone apparaît dans le menu <b>Monde</b> du jeu lancé depuis ton dossier (<code>pnpm dev</code>), ou avec <code>?world=&lt;identifiant&gt;</code>. Tes zones restent sur ta machine.`],
        ['Sources et licences', 'Relief et photos : IGN (Licence Ouverte Etalab 2.0). Routes et lieux : OpenStreetMap (ODbL, attribution obligatoire). Les attributions sont ajoutées à la zone.'],
      ]
    : [
        ['What you need', `A computer (Windows, Mac or Linux) with <b>Node.js 22+</b>, <b>pnpm</b> and <b>Git</b>, an Internet connection and <b>20–50 GB free</b> (IGN LiDAR relief and photos, OpenStreetMap roads). The tool runs <b>on your machine</b>, not on the game server.${cmd('git clone &lt;game repository address&gt;<br>cd allezrobert<br>pnpm install')}`],
        ['Start the tool', `In the game folder: ${cmd('pnpm zone-builder')}Then open <b>${TOOL_URL}</b> (the button above does it). Stop it with Ctrl+C in the terminal.`],
        ['Draw the zone', '“Emprise” (extent): draw a rectangle on the map (IGN Plan background). Aim for <b>4–8 km wide</b>; beyond 150 one-km tiles the build gets long. The estimate (tiles, time, cache) is shown.'],
        ['Fill in the form', 'It fills itself: name, region, tagline, seaside. Edit anything (an edited field is no longer overwritten). <b>Orthophotos (px / km)</b>: resolution of the aerial photo laid on the ground for each 1 km tile. 1024 ≈ 1 m per pixel (recommended); 512 ≈ 2 m (lighter, faster); 2048 ≈ 0.5 m (much heavier).'],
        ['Choose the route', '“Proposer des tours” (suggest tours) computes loops on real roads (adjustable length), then “Utiliser ce tour” (use this tour). You can also place the start and waypoints by hand, about one every 2–3 km, on roads rather than in fields.'],
        ['Build', '“Enregistrer + construire” (save + build): download, assembly and check (30 min to 2 h depending on size). The log is live; “Annuler” stops, and “Construire / reprendre” resumes from the cache.'],
        ['Check', '“Vérifier cette zone” or “toutes les zones” compares roads to terrain (riders sunk or floating, height jumps, tile seams) and flags what to look at.'],
        ['Ride', 'When done, the zone shows in the game’s <b>World</b> menu when launched from your folder (<code>pnpm dev</code>), or with <code>?world=&lt;id&gt;</code>. Your zones stay on your machine.'],
        ['Sources and licences', 'Relief and photos: IGN (Licence Ouverte Etalab 2.0). Roads and places: OpenStreetMap (ODbL, attribution required). Attributions are added to the zone.'],
      ];
  return `<ol style="margin:8px 0 0;padding-left:20px;display:grid;gap:8px">${steps.map(([h, b]) => `<li><b>${h}</b><div style="opacity:.85;font-size:13px;margin-top:2px">${b}</div></li>`).join('')}</ol>`;
}

/**
 * Bloc « Mode expert » de l'onglet Réglages : active la création de zones (outil local `pnpm zone-builder`),
 * détecte si l'outil tourne sur la machine, l'ouvre, et affiche le tutoriel pas à pas.
 */
export function renderExpertSettings(el: Element | null): void {
  if (!el) return;
  const fr = getLang() === 'fr';
  const on = isExpertMode();
  el.innerHTML = `<label class="field" style="flex-direction:row;align-items:center;gap:8px"><input id="exp-on" type="checkbox" ${on ? 'checked' : ''} style="width:auto" />
      ${fr ? 'Activer le mode expert (créer mes propres zones)' : 'Enable expert mode (build my own zones)'}</label>
    ${
      on
        ? `<div id="exp-box" style="margin-top:10px">
        <div class="row" style="align-items:center;gap:10px;flex-wrap:wrap">
          <a class="btn primary" id="exp-open" href="${TOOL_URL}" target="_blank" rel="noopener">${fr ? 'Ouvrir l’outil de zones' : 'Open the zone tool'}</a>
          <button class="btn" id="exp-check">${fr ? 'Vérifier s’il tourne' : 'Check if it is running'}</button>
          <span id="exp-state" style="font-size:13px;opacity:.85"></span>
        </div>
        <p style="font-size:12.5px;opacity:.75;margin:8px 0 0">${fr ? 'Réservé aux utilisateurs avancés : l’outil se lance en ligne de commande sur ton ordinateur et construit les zones localement.' : 'For advanced users: the tool runs from the command line on your computer and builds zones locally.'}</p>
        <details open style="margin-top:8px"><summary style="cursor:pointer"><b>${fr ? 'Tutoriel : créer une zone pas à pas' : 'Tutorial: build a zone step by step'}</b></summary>${tutorial(fr)}</details>
      </div>`
        : ''
    }`;
  el.querySelector<HTMLInputElement>('#exp-on')?.addEventListener('change', (e) => {
    localStorage.setItem(KEY, (e.target as HTMLInputElement).checked ? '1' : '0');
    renderExpertSettings(el);
  });
  const state = el.querySelector<HTMLElement>('#exp-state');
  const check = async () => {
    if (!state) return;
    state.textContent = fr ? 'Recherche de l’outil…' : 'Looking for the tool…';
    const ok = await toolRunning();
    state.innerHTML = ok
      ? `<span style="color:#7bd88f">● ${fr ? 'L’outil tourne sur cette machine.' : 'The tool is running on this machine.'}</span>`
      : `<span style="color:#e8a96b">○ ${fr ? 'Introuvable : lance <code>pnpm zone-builder</code> dans le dossier du jeu.' : 'Not found: run <code>pnpm zone-builder</code> in the game folder.'}</span>`;
  };
  el.querySelector('#exp-check')?.addEventListener('click', () => void check());
  if (on) void check();
}
