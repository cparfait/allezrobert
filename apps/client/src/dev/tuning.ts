import { uniform } from 'three/tsl';

/**
 * Réglages en direct (?reglages) : curseurs branchés sur des uniformes TSL, donc appliqués à l'image suivante sans
 * recompiler. Les valeurs sont gardées dans le navigateur et ne s'appliquent qu'avec ?reglages : le jeu normal
 * garde les valeurs du code. « Copier » donne le JSON des valeurs changées, à reporter dans le code.
 */
export const TUNING = typeof location !== 'undefined' && new URLSearchParams(location.search).has('reglages');

const STORE = 'ar:reglages';

const makeUniform = (v: number) => uniform(v);
type U = ReturnType<typeof makeUniform>;

interface Entry {
  key: string;
  label: string;
  group: string;
  def: number;
  min: number;
  max: number;
  step: number;
  u: U;
}

const entries = new Map<string, Entry>();
let saved: Record<string, number> = {};
if (TUNING) {
  try {
    saved = JSON.parse(localStorage.getItem(STORE) ?? '{}') as Record<string, number>;
  } catch {
    saved = {};
  }
}

const save = () => {
  const out: Record<string, number> = {};
  for (const e of entries.values()) if (e.u.value !== e.def) out[e.key] = e.u.value;
  try {
    localStorage.setItem(STORE, JSON.stringify(out));
  } catch {
    /* stockage indisponible : réglages perdus au rechargement */
  }
  return out;
};

/**
 * Uniforme réglable : `key` stable (« groupe.nom »), valeur par défaut et bornes. Sans ?reglages, renvoie un
 * uniforme fixé à `def`. Un même `key` renvoie le même uniforme (matériaux recréés).
 */
export function tune(key: string, label: string, def: number, min: number, max: number, step = (max - min) / 100): U {
  const known = entries.get(key);
  if (known) return known.u;
  const v = TUNING && typeof saved[key] === 'number' ? (saved[key] as number) : def;
  const u = makeUniform(v);
  entries.set(key, { key, label, group: key.split('.')[0] ?? '', def, min, max, step, u });
  panelRefresh?.();
  return u;
}

/** Valeur courante d'un réglage (côté JavaScript), ou `def` s'il n'existe pas encore. */
export function tuned(key: string, def: number): number {
  return entries.get(key)?.u.value ?? def;
}

let panelRefresh: (() => void) | null = null;

const GROUPS: Record<string, string> = { route: 'Route', pluie: 'Pluie', trottoir: 'Trottoirs', nuit: 'Nuit', image: 'Image' };

/** Panneau flottant (à droite), replié par un clic sur son titre. */
export function openTuningPanel(): void {
  if (!TUNING || typeof document === 'undefined') return;
  const root = document.createElement('div');
  root.style.cssText =
    'position:fixed;top:12px;right:12px;z-index:9999;width:300px;max-height:calc(100vh - 24px);overflow:auto;background:rgba(15,17,20,.88);color:#e8e6e1;font:12px/1.35 system-ui,sans-serif;border-radius:8px;box-shadow:0 4px 18px rgba(0,0,0,.4);padding:8px 10px;user-select:none';
  const head = document.createElement('div');
  head.style.cssText = 'display:flex;align-items:center;gap:6px;font-weight:600;cursor:pointer;margin-bottom:4px';
  head.textContent = 'Réglages';
  const body = document.createElement('div');
  head.onclick = () => (body.style.display = body.style.display === 'none' ? '' : 'none');
  const bar = document.createElement('div');
  bar.style.cssText = 'display:flex;gap:6px;margin:6px 0';
  const btn = (text: string, fn: () => void) => {
    const b = document.createElement('button');
    b.textContent = text;
    b.style.cssText = 'flex:1;background:#2b2f36;color:inherit;border:1px solid #444a53;border-radius:4px;padding:3px 0;cursor:pointer;font:inherit';
    b.onclick = (ev) => {
      ev.stopPropagation();
      fn();
    };
    bar.appendChild(b);
    return b;
  };
  const copy = btn('Copier', () => {
    const text = JSON.stringify(save(), null, 1);
    void navigator.clipboard?.writeText(text).then(
      () => (copy.textContent = 'Copié ✓'),
      () => (copy.textContent = 'Échec'),
    );
    setTimeout(() => (copy.textContent = 'Copier'), 1500);
  });
  btn('Tout remettre', () => {
    for (const e of entries.values()) e.u.value = e.def;
    save();
    render();
  });
  const list = document.createElement('div');
  body.append(bar, list);
  root.append(head, body);
  // Le jeu écoute le clavier : ne pas lui passer les touches tapées dans le panneau.
  root.addEventListener('keydown', (ev) => ev.stopPropagation());
  document.body.appendChild(root);

  const render = () => {
    list.textContent = '';
    const byGroup = new Map<string, Entry[]>();
    for (const e of entries.values()) byGroup.set(e.group, [...(byGroup.get(e.group) ?? []), e]);
    for (const [g, items] of byGroup) {
      const h = document.createElement('div');
      h.textContent = GROUPS[g] ?? g;
      h.style.cssText = 'margin:8px 0 2px;color:#9fb3c8;font-weight:600;text-transform:uppercase;font-size:10px;letter-spacing:.06em';
      list.appendChild(h);
      for (const e of items) {
        const row = document.createElement('label');
        row.style.cssText = 'display:grid;grid-template-columns:1fr 46px 16px;align-items:center;gap:4px;margin:2px 0';
        const name = document.createElement('span');
        name.textContent = e.label;
        const val = document.createElement('span');
        val.style.cssText = 'text-align:right;font-variant-numeric:tabular-nums;color:#cfd6dd';
        const reset = document.createElement('span');
        reset.textContent = '↺';
        reset.title = `Valeur du code : ${e.def}`;
        reset.style.cssText = 'cursor:pointer;color:#7d8793;text-align:center';
        const range = document.createElement('input');
        range.type = 'range';
        range.min = String(e.min);
        range.max = String(e.max);
        range.step = String(e.step);
        range.value = String(e.u.value);
        range.style.cssText = 'grid-column:1 / span 3;width:100%;margin:0';
        const show = () => {
          val.textContent = e.u.value.toFixed(e.step < 0.01 ? 3 : 2);
          val.style.color = e.u.value === e.def ? '#cfd6dd' : '#ffd479';
        };
        range.oninput = () => {
          e.u.value = Number(range.value);
          show();
          save();
        };
        reset.onclick = (ev) => {
          ev.preventDefault();
          e.u.value = e.def;
          range.value = String(e.def);
          show();
          save();
        };
        show();
        row.append(name, val, reset, range);
        list.appendChild(row);
      }
    }
  };
  panelRefresh = render;
  render();
}
