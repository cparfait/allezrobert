import type { V3Equipment } from './visuals.ts';
import { V3_ICON } from './icons.ts';

/**
 * Profils de coureur du garage V3 : tout l'équipement (silhouette, corps, visage, cheveux, barbe, tenue, vélo, coloris,
 * roues, home trainer) enregistré sous un nom, pour le retrouver plus tard. Rangés dans le navigateur (le style V3
 * est réservé au poste de développement), renommables et supprimables.
 */
export type V3Profile = { id: string; name: string; equipment: V3Equipment; savedAt: number };

const LIST = 'ar.v3.profiles';
const ACTIVE = 'ar.v3.profile';

export function readProfiles(): V3Profile[] {
  try {
    const list = JSON.parse(localStorage.getItem(LIST) ?? '[]') as V3Profile[];
    return Array.isArray(list) ? list.filter(profile => profile && typeof profile.name === 'string' && profile.equipment) : [];
  } catch {
    return [];
  }
}

function writeProfiles(list: V3Profile[]): void {
  try { localStorage.setItem(LIST, JSON.stringify(list)); } catch { /* stockage indisponible */ }
}

function readActive(): string | undefined {
  try { return localStorage.getItem(ACTIVE) ?? undefined; } catch { return undefined; }
}

function writeActive(id: string | undefined): void {
  try {
    if (id) localStorage.setItem(ACTIVE, id);
    else localStorage.removeItem(ACTIVE);
  } catch { /* stockage indisponible */ }
}

/** Équipement comparable (clés triées) : un profil est « modifié » si l'équipement courant en diffère. */
function same(a: V3Equipment, b: V3Equipment): boolean {
  const canonical = (value: unknown): unknown => Array.isArray(value) ? value.map(canonical)
    : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined).sort(([x], [y]) => x.localeCompare(y)).map(([k, v]) => [k, canonical(v)]))
      : value;
  return JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
}

const when = (time: number) => new Date(time).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })
  + ' ' + new Date(time).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });

/**
 * Carte « Profils » en tête du garage V3 : repliée, l'intitulé montre le profil chargé (et s'il a été modifié depuis).
 * Dépliée : la liste (clic pour charger, crayon pour renommer, croix pour supprimer), puis l'enregistrement.
 */
export function createProfilesCard(options: { current(): V3Equipment; load(equipment: V3Equipment): void }) {
  const card = document.createElement('div');
  card.className = 'v3-settings v3-profiles';
  const head = document.createElement('div');
  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.className = 'v3-fold v3-setting-toggle';
  toggle.setAttribute('aria-expanded', 'false');
  const state = document.createElement('span');
  const label = document.createElement('i');
  label.className = 'v3-profiles-label';
  label.innerHTML = V3_ICON.save;
  label.append('Profils');
  toggle.append(label, state);
  head.append(toggle);
  const body = document.createElement('div');
  body.className = 'v3-profiles-body';
  body.hidden = true;
  card.append(head, body);
  toggle.onclick = () => {
    body.hidden = !body.hidden;
    toggle.setAttribute('aria-expanded', String(!body.hidden));
    render();
  };

  let editing: string | undefined;
  let deleting: string | undefined;

  function active(): V3Profile | undefined {
    const id = readActive();
    return readProfiles().find(profile => profile.id === id);
  }

  function save(list: V3Profile[]): void {
    writeProfiles(list);
    render();
  }

  function nameInput(value: string, placeholder: string): HTMLInputElement {
    const input = document.createElement('input');
    input.type = 'text';
    input.maxLength = 40;
    input.value = value;
    input.placeholder = placeholder;
    input.setAttribute('aria-label', placeholder);
    return input;
  }

  function small(text: string, className = 'gr-sub'): HTMLButtonElement {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = className;
    button.textContent = text;
    return button;
  }

  function row(profile: V3Profile, current: V3Profile | undefined, equipment: V3Equipment): HTMLElement {
    const line = document.createElement('div');
    line.className = 'v3-profile' + (profile.id === current?.id ? ' on' : '');
    if (editing === profile.id) {
      // Renommage : Entrée ou clic ailleurs pour valider, Échap pour annuler.
      const input = nameInput(profile.name, 'Nouveau nom');
      let done = false;
      const commit = (keep: boolean) => {
        if (done) return;
        done = true;
        editing = undefined;
        const name = input.value.trim();
        if (keep && name) save(readProfiles().map(item => (item.id === profile.id ? { ...item, name } : item)));
        else render();
      };
      input.onkeydown = event => {
        if (event.key === 'Enter') commit(true);
        if (event.key === 'Escape') commit(false);
      };
      input.onblur = () => commit(true);
      line.append(input);
      queueMicrotask(() => { input.focus(); input.select(); });
      return line;
    }
    const open = document.createElement('button');
    open.type = 'button';
    open.className = 'v3-profile-open';
    const name = document.createElement('b');
    name.textContent = profile.name;
    const meta = document.createElement('small');
    const modified = profile.id === current?.id && !same(profile.equipment, equipment);
    meta.textContent = (profile.id === current?.id ? (modified ? 'Chargé, modifié depuis · ' : 'Chargé · ') : 'Enregistré le ') + when(profile.savedAt);
    open.append(name, meta);
    open.title = 'Charger ce profil';
    open.onclick = () => {
      writeActive(profile.id);
      options.load(structuredClone(profile.equipment));
      render();
    };
    line.append(open);
    if (deleting === profile.id) {
      const ask = document.createElement('span');
      ask.className = 'v3-profile-ask';
      ask.textContent = 'Supprimer ?';
      const yes = small('Oui', 'gr-sub v3-danger');
      const no = small('Non');
      yes.onclick = () => {
        deleting = undefined;
        if (readActive() === profile.id) writeActive(undefined);
        save(readProfiles().filter(item => item.id !== profile.id));
      };
      no.onclick = () => { deleting = undefined; render(); };
      line.append(ask, yes, no);
      return line;
    }
    const rename = small('✎', 'v3-icon-button');
    rename.title = 'Renommer';
    rename.setAttribute('aria-label', 'Renommer ' + profile.name);
    rename.onclick = () => { editing = profile.id; deleting = undefined; render(); };
    const remove = small('✕', 'v3-icon-button');
    remove.title = 'Supprimer';
    remove.setAttribute('aria-label', 'Supprimer ' + profile.name);
    remove.onclick = () => { deleting = profile.id; editing = undefined; render(); };
    line.append(rename, remove);
    return line;
  }

  function render(): void {
    const list = readProfiles();
    const current = active();
    const equipment = options.current();
    const modified = !!current && !same(current.equipment, equipment);
    state.textContent = current ? current.name + (modified ? ' · modifié' : '') : list.length ? 'Aucun chargé' : 'Aucun';
    if (body.hidden) return;
    const rows: HTMLElement[] = list.map(profile => row(profile, current, equipment));
    if (!list.length) {
      const empty = document.createElement('p');
      empty.className = 'mm-hint';
      empty.textContent = 'Aucun profil : enregistrez le coureur actuel (personnage, tenue, vélo, roues, home trainer).';
      rows.push(empty);
    }
    // Enregistrement : mise à jour du profil chargé (s'il a changé), ou nouveau profil sous un nom.
    const actions = document.createElement('div');
    actions.className = 'v3-profile-save';
    if (current && modified) {
      const update = small('Mettre à jour « ' + current.name + ' »', 'gr-sub v3-accent');
      update.onclick = () => save(readProfiles().map(item => (item.id === current.id ? { ...item, equipment: structuredClone(equipment), savedAt: Date.now() } : item)));
      actions.append(update);
    }
    const input = nameInput('', 'Nom du nouveau profil');
    const create = small('Enregistrer', 'gr-sub v3-accent');
    const add = () => {
      const name = input.value.trim() || 'Coureur ' + (readProfiles().length + 1);
      const profile: V3Profile = { id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), name, equipment: structuredClone(equipment), savedAt: Date.now() };
      writeActive(profile.id);
      save([...readProfiles(), profile]);
    };
    create.onclick = add;
    input.onkeydown = event => { if (event.key === 'Enter') add(); };
    const line = document.createElement('div');
    line.className = 'v3-profile-new';
    line.append(input, create);
    actions.append(line);
    rows.push(actions);
    body.replaceChildren(...rows);
  }

  render();
  return { element: card, sync: render };
}
