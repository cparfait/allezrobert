/**
 * Place des zones sur la carte de France du menu : centre de la zone en Lambert-93 (m), type
 * (monde ouvert ou parcours fixés) et nom de secours tant que la zone n'est pas encore dans
 * WORLD_LIST (mondes construits ailleurs, arrivent plus tard). Centres tirés de `originL93` et
 * `bounds` de chaque world.json, ou du départ de la zone dans tools/terrain/src/config.ts.
 */
export interface ZoneSpot {
  id: string;
  /** Centre de la zone, Lambert-93 (m). */
  x: number;
  y: number;
  /** Monde ouvert : parcours libre et parcours à dessiner en plus des parcours fixés. */
  open: boolean;
  region: { fr: string; en: string };
  name: { fr: string; en: string };
}

const PDD = { fr: 'Puy-de-Dôme', en: 'Puy-de-Dôme' };
const IDF = { fr: 'Île-de-France', en: 'Île-de-France' };

export const ZONE_SPOTS: ZoneSpot[] = [
  { id: 'chevreuse', x: 625500, y: 6843500, open: false, region: IDF, name: { fr: 'Vallée de Chevreuse', en: 'Chevreuse Valley' } },
  { id: 'longchamp', x: 646000, y: 6861500, open: true, region: IDF, name: { fr: 'Paris — Longchamp', en: 'Paris — Longchamp' } },
  { id: 'vincennes', x: 662000, y: 6857500, open: true, region: IDF, name: { fr: 'Paris — Vincennes', en: 'Paris — Vincennes' } },
  { id: 'meudon', x: 644000, y: 6855500, open: true, region: IDF, name: { fr: 'Meudon — Clamart', en: 'Meudon — Clamart' } },
  { id: 'limagne', x: 732500, y: 6515500, open: true, region: PDD, name: { fr: 'Limagne — Neuville', en: 'Limagne — Neuville' } },
  { id: 'billom', x: 722000, y: 6515000, open: true, region: PDD, name: { fr: 'Limagne — Billom', en: 'Limagne — Billom' } },
  { id: 'comte', x: 720000, y: 6506500, open: true, region: PDD, name: { fr: 'Comté — Châteaux perchés', en: 'Comté — Hilltop castles' } },
  { id: 'livradois', x: 733000, y: 6519500, open: true, region: PDD, name: { fr: 'Livradois — Châteaux', en: 'Livradois — Castles' } },
  { id: 'puys', x: 694000, y: 6525000, open: true, region: PDD, name: { fr: 'Chaîne des Puys', en: 'Chaîne des Puys' } },
  { id: 'issoire', x: 731000, y: 6491000, open: true, region: PDD, name: { fr: "Val d'Allier — Issoire", en: "Val d'Allier — Issoire" } },
  { id: 'sancy', x: 686000, y: 6491000, open: true, region: PDD, name: { fr: 'Massif du Sancy', en: 'Sancy massif' } },
  { id: 'etretat', x: 501000, y: 6959000, open: true, region: { fr: 'Seine-Maritime', en: 'Seine-Maritime' }, name: { fr: "Étretat — Côte d'Albâtre", en: 'Étretat — Alabaster Coast' } },
  { id: 'opale', x: 606000, y: 7089000, open: true, region: { fr: 'Pas-de-Calais', en: 'Pas-de-Calais' }, name: { fr: "Côte d'Opale — Les deux caps", en: 'Opal Coast — The two capes' } },
  { id: 're', x: 353000, y: 6579000, open: true, region: { fr: 'Charente-Maritime', en: 'Charente-Maritime' }, name: { fr: 'Île de Ré', en: 'Île de Ré' } },
  { id: 'esterel', x: 1010000, y: 6267000, open: true, region: { fr: 'Var', en: 'Var' }, name: { fr: "Corniche de l'Estérel", en: 'Estérel corniche' } },
  { id: 'roubaix', x: 726500, y: 7033500, open: true, region: { fr: 'Nord', en: 'Nord' }, name: { fr: 'Paris–Roubaix — Arenberg', en: 'Paris–Roubaix — Arenberg' } },
  { id: 'montmartre', x: 652000, y: 6866000, open: true, region: { fr: 'Île-de-France', en: 'Île-de-France' }, name: { fr: 'Paris — Montmartre', en: 'Paris — Montmartre' } },
  { id: 'tourmalet', x: 464000, y: 6208000, open: true, region: { fr: 'Hautes-Pyrénées', en: 'Hautes-Pyrénées' }, name: { fr: 'Col du Tourmalet', en: 'Col du Tourmalet' } },
  { id: 'basque', x: 322000, y: 6266000, open: true, region: { fr: 'Pyrénées-Atlantiques', en: 'Pyrénées-Atlantiques' }, name: { fr: 'Pays basque — Corniche', en: 'Basque Country — Corniche' } },
  { id: 'annecy', x: 948000, y: 6532000, open: true, region: { fr: 'Haute-Savoie', en: 'Haute-Savoie' }, name: { fr: "Lac d'Annecy", en: 'Lake Annecy' } },
  { id: 'fontainebleau', x: 675000, y: 6813000, open: true, region: { fr: 'Île-de-France', en: 'Île-de-France' }, name: { fr: 'Forêt de Fontainebleau', en: 'Fontainebleau forest' } },
  { id: 'saint-cloud', x: 638000, y: 6862000, open: true, region: { fr: 'Île-de-France', en: 'Île-de-France' }, name: { fr: 'Saint-Cloud — Marly', en: 'Saint-Cloud — Marly' } },
  { id: 'cote-de-nuits', x: 848000, y: 6678000, open: true, region: { fr: "Côte-d'Or", en: "Côte-d'Or" }, name: { fr: 'Côte de Nuits — Grands crus', en: 'Côte de Nuits — Grands crus' } },
  { id: 'alsace', x: 1019500, y: 6793500, open: true, region: { fr: 'Haut-Rhin', en: 'Haut-Rhin' }, name: { fr: "Route des vins d'Alsace", en: 'Alsace wine road' } },
  { id: 'verrieres-velizy', x: 643000, y: 6851000, open: true, region: { fr: 'Essonne', en: 'Essonne' }, name: { fr: 'Verrières -Vélizy', en: 'Verrières -Vélizy' } },
  { id: 'alpe-dhuez', x: 940000, y: 6446500, open: false, region: { fr: 'Isère · Oisans', en: 'Isère · Oisans' }, name: { fr: "Alpe d'Huez", en: "Alpe d'Huez" } },
  { id: 'mont-ventoux', x: 880000, y: 6341000, open: false, region: { fr: 'Vaucluse', en: 'Vaucluse' }, name: { fr: 'Mont Ventoux', en: 'Mont Ventoux' } },
];
