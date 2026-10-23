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
  { id: 'limagne', x: 732500, y: 6515500, open: true, region: PDD, name: { fr: 'Limagne — Neuville', en: 'Limagne — Neuville' } },
  { id: 'billom', x: 722000, y: 6515000, open: true, region: PDD, name: { fr: 'Limagne — Billom', en: 'Limagne — Billom' } },
  { id: 'comte', x: 720000, y: 6506500, open: true, region: PDD, name: { fr: 'Comté — Châteaux perchés', en: 'Comté — Hilltop castles' } },
  { id: 'livradois', x: 733000, y: 6519500, open: true, region: PDD, name: { fr: 'Livradois — Châteaux', en: 'Livradois — Castles' } },
  { id: 'puys', x: 694000, y: 6525000, open: true, region: PDD, name: { fr: 'Chaîne des Puys', en: 'Chaîne des Puys' } },
  { id: 'issoire', x: 731000, y: 6491000, open: true, region: PDD, name: { fr: "Val d'Allier — Issoire", en: "Val d'Allier — Issoire" } },
  { id: 'sancy', x: 686000, y: 6491000, open: true, region: PDD, name: { fr: 'Massif du Sancy', en: 'Sancy massif' } },
  { id: 'alpe-dhuez', x: 940000, y: 6446500, open: false, region: { fr: 'Isère · Oisans', en: 'Isère · Oisans' }, name: { fr: "Alpe d'Huez", en: "Alpe d'Huez" } },
  { id: 'mont-ventoux', x: 880000, y: 6341000, open: false, region: { fr: 'Vaucluse', en: 'Vaucluse' }, name: { fr: 'Mont Ventoux', en: 'Mont Ventoux' } },
];
