/**
 * Communes françaises (public/geo/communes-fr.txt, préparé par tools/communes/build.mjs) : recherche par nom ou code
 * postal pour la ville du joueur. Le fichier (≈ 1 Mo) n'est chargé qu'à la première recherche, et marche hors ligne.
 */
export interface Commune {
  name: string;
  /** Codes postaux, dans l'ordre. */
  codes: readonly string[];
  lat: number;
  lon: number;
}

/** Ville choisie par le joueur, enregistrée dans ses réglages. */
export interface PlayerCity {
  name: string;
  code: string;
  lat: number;
  lon: number;
}

/** Sans accents, apostrophes ni tirets, « st » pour « saint » : « Saint-Étienne » et « st etienne » se rejoignent. */
export function foldName(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/œ/g, 'oe')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\bsainte\b/g, 'ste')
    .replace(/\bsaint\b/g, 'st');
}

export interface CommuneIndex {
  list: readonly Commune[];
  folded: readonly string[];
}

export function parseCommunes(text: string): CommuneIndex {
  const list: Commune[] = [];
  for (const line of text.split('\n')) {
    const [name, codes, lat, lon] = line.split(';');
    if (!name || !codes || !lat || !lon) continue;
    list.push({ name, codes: codes.split(','), lat: Number(lat), lon: Number(lon) });
  }
  return { list, folded: list.map((c) => foldName(c.name)) };
}

/** Meilleures communes pour une saisie : nom exact, puis début de nom, puis début d'un mot ; les plus peuplées d'abord. */
export function searchCommunes(index: CommuneIndex, query: string, limit = 8): Commune[] {
  const raw = query.trim();
  const byCode = /^\d{2,5}$/.test(raw);
  const q = foldName(raw);
  if (!byCode && q.length < 2) return [];
  const ranks: Commune[][] = [[], [], []];
  for (let i = 0; i < index.list.length; i++) {
    const c = index.list[i]!;
    if (byCode) {
      if (c.codes.some((code) => code.startsWith(raw))) ranks[c.codes.includes(raw) ? 0 : 1]!.push(c);
    } else {
      const n = index.folded[i]!;
      const at = n.indexOf(q);
      if (at === 0) ranks[n.length === q.length ? 0 : 1]!.push(c);
      else if (at > 0 && n[at - 1] === ' ') ranks[2]!.push(c);
    }
    if (ranks[0]!.length + ranks[1]!.length >= 400) break;
  }
  return ranks.flat().slice(0, limit);
}

export const cityOf = (c: Commune, query = ''): PlayerCity => ({ name: c.name, code: c.codes.find((code) => code === query.trim()) ?? c.codes[0]!, lat: c.lat, lon: c.lon });

let loading: Promise<CommuneIndex> | null = null;
export function loadCommunes(): Promise<CommuneIndex> {
  return (loading ??= fetch('/geo/communes-fr.txt')
    .then((r) => {
      if (!r.ok) throw new Error(`communes : ${r.status}`);
      return r.text();
    })
    .then(parseCommunes)
    .catch((e) => {
      loading = null;
      throw e;
    }));
}
