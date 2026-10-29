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
  /** Monde imaginaire : pas de place sur la carte de France, présenté à côté avec cette vignette. */
  image?: string;
}

const PDD = { fr: 'Puy-de-Dôme', en: 'Puy-de-Dôme' };
const IDF = { fr: 'Île-de-France', en: 'Île-de-France' };

export const ZONE_SPOTS: ZoneSpot[] = [
  // Île imaginaire : hors de la carte de France, à côté (vignette = carte de l'île).
  { id: 'ile-de-robert', x: 150000, y: 6815000, open: true, region: { fr: 'Monde imaginaire', en: 'Imaginary world' }, name: { fr: "L'île de Robert", en: "Robert's Island" }, image: '/worlds/ile-de-robert/vignette.png' },
  { id: 'chevreuse', x: 625500, y: 6843500, open: true, region: IDF, name: { fr: 'Vallée de Chevreuse', en: 'Chevreuse Valley' } },
  { id: 'longchamp', x: 646000, y: 6861500, open: true, region: IDF, name: { fr: 'Longchamp', en: 'Longchamp' } },
  { id: 'vincennes', x: 662000, y: 6857500, open: true, region: IDF, name: { fr: 'Vincennes', en: 'Vincennes' } },
  { id: 'meudon', x: 644000, y: 6855500, open: true, region: IDF, name: { fr: 'Meudon — Clamart', en: 'Meudon — Clamart' } },
  { id: 'limagne', x: 732500, y: 6515500, open: true, region: PDD, name: { fr: 'Limagne — Neuville', en: 'Limagne — Neuville' } },
  { id: 'billom', x: 722000, y: 6515000, open: true, region: PDD, name: { fr: 'Limagne — Billom', en: 'Limagne — Billom' } },
  { id: 'comte', x: 720000, y: 6506500, open: true, region: PDD, name: { fr: 'Comté — Châteaux perchés', en: 'Comté — Hilltop castles' } },
  { id: 'livradois', x: 733000, y: 6519500, open: true, region: PDD, name: { fr: 'Livradois — Châteaux', en: 'Livradois — Castles' } },
  { id: 'puys', x: 694000, y: 6525000, open: true, region: PDD, name: { fr: 'Chaîne des Puys', en: 'Chaîne des Puys' } },
  { id: 'issoire', x: 731000, y: 6491000, open: true, region: PDD, name: { fr: "Val d'Allier — Issoire", en: "Val d'Allier — Issoire" } },
  { id: 'sancy', x: 686000, y: 6491500, open: true, region: PDD, name: { fr: 'Massif du Sancy', en: 'Sancy massif' } },
  { id: 'etretat', x: 501000, y: 6959000, open: true, region: { fr: 'Seine-Maritime', en: 'Seine-Maritime' }, name: { fr: "Étretat", en: 'Étretat' } },
  { id: 'opale', x: 606000, y: 7089000, open: true, region: { fr: 'Pas-de-Calais', en: 'Pas-de-Calais' }, name: { fr: "Côte d'Opale", en: 'Opal Coast' } },
  { id: 're', x: 353000, y: 6579000, open: true, region: { fr: 'Charente-Maritime', en: 'Charente-Maritime' }, name: { fr: 'Île de Ré', en: 'Île de Ré' } },
  { id: 'esterel', x: 1010000, y: 6267000, open: true, region: { fr: 'Var', en: 'Var' }, name: { fr: "Corniche de l'Estérel", en: 'Estérel corniche' } },
  { id: 'roubaix', x: 726500, y: 7033500, open: true, region: { fr: 'Nord', en: 'Nord' }, name: { fr: 'Paris–Roubaix', en: 'Paris–Roubaix' } },
  { id: 'montmartre', x: 652000, y: 6866000, open: true, region: { fr: 'Île-de-France', en: 'Île-de-France' }, name: { fr: 'Paris — Montmartre', en: 'Paris — Montmartre' } },
  { id: 'tourmalet', x: 464000, y: 6208000, open: true, region: { fr: 'Hautes-Pyrénées', en: 'Hautes-Pyrénées' }, name: { fr: 'Col du Tourmalet', en: 'Col du Tourmalet' } },
  { id: 'basque', x: 322000, y: 6266000, open: true, region: { fr: 'Pyrénées-Atlantiques', en: 'Pyrénées-Atlantiques' }, name: { fr: 'Pays basque — Corniche', en: 'Basque Country — Corniche' } },
  { id: 'annecy', x: 948000, y: 6532000, open: true, region: { fr: 'Haute-Savoie', en: 'Haute-Savoie' }, name: { fr: "Lac d'Annecy", en: 'Lake Annecy' } },
  { id: 'fontainebleau', x: 675000, y: 6813000, open: true, region: { fr: 'Île-de-France', en: 'Île-de-France' }, name: { fr: 'Forêt de Fontainebleau', en: 'Fontainebleau forest' } },
  { id: 'saint-cloud', x: 638000, y: 6862000, open: true, region: { fr: 'Île-de-France', en: 'Île-de-France' }, name: { fr: 'Saint-Cloud — Marly', en: 'Saint-Cloud — Marly' } },
  { id: 'cote-de-nuits', x: 848000, y: 6678000, open: true, region: { fr: "Côte-d'Or", en: "Côte-d'Or" }, name: { fr: 'Côte de Nuits — Grands crus', en: 'Côte de Nuits — Grands crus' } },
  { id: 'alsace', x: 1019500, y: 6793500, open: true, region: { fr: 'Haut-Rhin', en: 'Haut-Rhin' }, name: { fr: "Route des vins d'Alsace", en: 'Alsace wine road' } },
  { id: 'verrieres-velizy', x: 643000, y: 6851000, open: true, region: { fr: 'Essonne', en: 'Essonne' }, name: { fr: 'Verrières -Vélizy', en: 'Verrières -Vélizy' } },
  { id: 'idf-rambouillet', x: 616000, y: 6836000, open: true, region: { fr: 'Yvelines', en: 'Yvelines' }, name: { fr: 'Rambouillet', en: 'Rambouillet' } },
  { id: 'idf-ablis', x: 616000, y: 6820000, open: true, region: { fr: 'Yvelines', en: 'Yvelines' }, name: { fr: 'Ablis', en: 'Ablis' } },
  { id: 'idf-angerville', x: 632000, y: 6804000, open: true, region: { fr: 'Essonne', en: 'Essonne' }, name: { fr: 'Angerville', en: 'Angerville' } },
  { id: 'idf-aubergenville', x: 616000, y: 6868000, open: true, region: { fr: 'Yvelines', en: 'Yvelines' }, name: { fr: 'Aubergenville', en: 'Aubergenville' } },
  { id: 'idf-ballancourt-sur-essonne', x: 648000, y: 6820000, open: true, region: { fr: 'Essonne', en: 'Essonne' }, name: { fr: 'Ballancourt-sur-Essonne', en: 'Ballancourt-sur-Essonne' } },
  { id: 'idf-bazoches-les-bray', x: 712000, y: 6804000, open: true, region: { fr: 'Seine-et-Marne', en: 'Seine-et-Marne' }, name: { fr: 'Bazoches-lès-Bray', en: 'Bazoches-lès-Bray' } },
  { id: 'idf-beaumont-du-gatinais', x: 664000, y: 6788000, open: true, region: { fr: 'Seine-et-Marne', en: 'Seine-et-Marne' }, name: { fr: 'Beaumont-du-Gâtinais', en: 'Beaumont-du-Gâtinais' } },
  { id: 'idf-blaru', x: 584000, y: 6884000, open: true, region: { fr: 'Yvelines', en: 'Yvelines' }, name: { fr: 'Blaru', en: 'Blaru' } },
  { id: 'idf-boulogne-billancourt', x: 648000, y: 6852000, open: true, region: { fr: 'Hauts-de-Seine', en: 'Hauts-de-Seine' }, name: { fr: 'Boulogne-Billancourt', en: 'Boulogne-Billancourt' } },
  { id: 'idf-bures-sur-yvette', x: 632000, y: 6836000, open: true, region: { fr: 'Essonne', en: 'Essonne' }, name: { fr: 'Bures-sur-Yvette', en: 'Bures-sur-Yvette' } },
  { id: 'idf-bussy-saint-georges', x: 680000, y: 6852000, open: true, region: { fr: 'Seine-et-Marne', en: 'Seine-et-Marne' }, name: { fr: 'Bussy-Saint-Georges', en: 'Bussy-Saint-Georges' } },
  { id: 'idf-cergy', x: 632000, y: 6884000, open: true, region: { fr: 'Val-d\'Oise', en: 'Val-d\'Oise' }, name: { fr: 'Cergy', en: 'Cergy' } },
  { id: 'idf-coulommiers', x: 712000, y: 6852000, open: true, region: { fr: 'Seine-et-Marne', en: 'Seine-et-Marne' }, name: { fr: 'Coulommiers', en: 'Coulommiers' } },
  { id: 'idf-creteil', x: 664000, y: 6852000, open: true, region: { fr: 'Val-de-Marne', en: 'Val-de-Marne' }, name: { fr: 'Créteil', en: 'Créteil' } },
  { id: 'idf-crouy-sur-ourcq', x: 712000, y: 6884000, open: true, region: { fr: 'Seine-et-Marne', en: 'Seine-et-Marne' }, name: { fr: 'Crouy-sur-Ourcq', en: 'Crouy-sur-Ourcq' } },
  { id: 'idf-dammarie-les-lys', x: 664000, y: 6820000, open: true, region: { fr: 'Seine-et-Marne', en: 'Seine-et-Marne' }, name: { fr: 'Dammarie-les-Lys', en: 'Dammarie-les-Lys' } },
  { id: 'idf-dammartin-en-goele', x: 680000, y: 6884000, open: true, region: { fr: 'Seine-et-Marne', en: 'Seine-et-Marne' }, name: { fr: 'Dammartin-en-Goële', en: 'Dammartin-en-Goële' } },
  { id: 'idf-donnemarie-dontilly', x: 712000, y: 6820000, open: true, region: { fr: 'Seine-et-Marne', en: 'Seine-et-Marne' }, name: { fr: 'Donnemarie-Dontilly', en: 'Donnemarie-Dontilly' } },
  { id: 'idf-egreville', x: 696000, y: 6788000, open: true, region: { fr: 'Seine-et-Marne', en: 'Seine-et-Marne' }, name: { fr: 'Égreville', en: 'Égreville' } },
  { id: 'idf-etampes', x: 632000, y: 6820000, open: true, region: { fr: 'Essonne', en: 'Essonne' }, name: { fr: 'Étampes', en: 'Étampes' } },
  { id: 'idf-evry-courcouronnes', x: 664000, y: 6836000, open: true, region: { fr: 'Essonne', en: 'Essonne' }, name: { fr: 'Évry-Courcouronnes', en: 'Évry-Courcouronnes' } },
  { id: 'idf-fontenay-tresigny', x: 696000, y: 6852000, open: true, region: { fr: 'Seine-et-Marne', en: 'Seine-et-Marne' }, name: { fr: 'Fontenay-Trésigny', en: 'Fontenay-Trésigny' } },
  { id: 'idf-goussainville', x: 664000, y: 6884000, open: true, region: { fr: 'Val-d\'Oise', en: 'Val-d\'Oise' }, name: { fr: 'Goussainville', en: 'Goussainville' } },
  { id: 'idf-hermeray', x: 600000, y: 6836000, open: true, region: { fr: 'Yvelines', en: 'Yvelines' }, name: { fr: 'Hermeray', en: 'Hermeray' } },
  { id: 'idf-houdan', x: 600000, y: 6852000, open: true, region: { fr: 'Yvelines', en: 'Yvelines' }, name: { fr: 'Houdan', en: 'Houdan' } },
  { id: 'idf-jouy-le-chatel', x: 712000, y: 6836000, open: true, region: { fr: 'Seine-et-Marne', en: 'Seine-et-Marne' }, name: { fr: 'Jouy-le-Châtel', en: 'Jouy-le-Châtel' } },
  { id: 'idf-la-ferte-gaucher', x: 728000, y: 6852000, open: true, region: { fr: 'Seine-et-Marne', en: 'Seine-et-Marne' }, name: { fr: 'La Ferté-Gaucher', en: 'La Ferté-Gaucher' } },
  { id: 'idf-la-ferte-sous-jouarre', x: 712000, y: 6868000, open: true, region: { fr: 'Seine-et-Marne', en: 'Seine-et-Marne' }, name: { fr: 'La Ferté-sous-Jouarre', en: 'La Ferté-sous-Jouarre' } },
  { id: 'idf-les-mureaux', x: 616000, y: 6884000, open: true, region: { fr: 'Yvelines', en: 'Yvelines' }, name: { fr: 'Les Mureaux', en: 'Les Mureaux' } },
  { id: 'idf-lizy-sur-ourcq', x: 696000, y: 6884000, open: true, region: { fr: 'Seine-et-Marne', en: 'Seine-et-Marne' }, name: { fr: 'Lizy-sur-Ourcq', en: 'Lizy-sur-Ourcq' } },
  { id: 'idf-magny-en-vexin', x: 616000, y: 6900000, open: true, region: { fr: 'Val-d\'Oise', en: 'Val-d\'Oise' }, name: { fr: 'Magny-en-Vexin', en: 'Magny-en-Vexin' } },
  { id: 'idf-maisse', x: 648000, y: 6804000, open: true, region: { fr: 'Essonne', en: 'Essonne' }, name: { fr: 'Maisse', en: 'Maisse' } },
  { id: 'idf-mantes-la-jolie', x: 600000, y: 6884000, open: true, region: { fr: 'Yvelines', en: 'Yvelines' }, name: { fr: 'Mantes-la-Jolie', en: 'Mantes-la-Jolie' } },
  { id: 'idf-mantes-la-ville', x: 600000, y: 6868000, open: true, region: { fr: 'Yvelines', en: 'Yvelines' }, name: { fr: 'Mantes-la-Ville', en: 'Mantes-la-Ville' } },
  { id: 'idf-marines', x: 632000, y: 6900000, open: true, region: { fr: 'Val-d\'Oise', en: 'Val-d\'Oise' }, name: { fr: 'Marines', en: 'Marines' } },
  { id: 'idf-meaux', x: 696000, y: 6868000, open: true, region: { fr: 'Seine-et-Marne', en: 'Seine-et-Marne' }, name: { fr: 'Meaux', en: 'Meaux' } },
  { id: 'idf-melun', x: 680000, y: 6820000, open: true, region: { fr: 'Seine-et-Marne', en: 'Seine-et-Marne' }, name: { fr: 'Melun', en: 'Melun' } },
  { id: 'idf-milly-la-foret', x: 664000, y: 6804000, open: true, region: { fr: 'Essonne', en: 'Essonne' }, name: { fr: 'Milly-la-Forêt', en: 'Milly-la-Forêt' } },
  { id: 'idf-montereau-fault-yonne', x: 696000, y: 6804000, open: true, region: { fr: 'Seine-et-Marne', en: 'Seine-et-Marne' }, name: { fr: 'Montereau-Fault-Yonne', en: 'Montereau-Fault-Yonne' } },
  { id: 'idf-montreuil', x: 664000, y: 6868000, open: true, region: { fr: 'Seine-Saint-Denis', en: 'Seine-Saint-Denis' }, name: { fr: 'Montreuil', en: 'Montreuil' } },
  { id: 'idf-moret-loing-et-orvanne', x: 680000, y: 6804000, open: true, region: { fr: 'Seine-et-Marne', en: 'Seine-et-Marne' }, name: { fr: 'Moret-Loing-et-Orvanne', en: 'Moret-Loing-et-Orvanne' } },
  { id: 'idf-nangis', x: 696000, y: 6836000, open: true, region: { fr: 'Seine-et-Marne', en: 'Seine-et-Marne' }, name: { fr: 'Nangis', en: 'Nangis' } },
  { id: 'idf-nemours', x: 680000, y: 6788000, open: true, region: { fr: 'Seine-et-Marne', en: 'Seine-et-Marne' }, name: { fr: 'Nemours', en: 'Nemours' } },
  { id: 'idf-paris', x: 648000, y: 6868000, open: true, region: { fr: 'Paris', en: 'Paris' }, name: { fr: 'Paris', en: 'Paris' } },
  { id: 'idf-persan', x: 648000, y: 6900000, open: true, region: { fr: 'Val-d\'Oise', en: 'Val-d\'Oise' }, name: { fr: 'Persan', en: 'Persan' } },
  { id: 'idf-plaisir', x: 616000, y: 6852000, open: true, region: { fr: 'Yvelines', en: 'Yvelines' }, name: { fr: 'Plaisir', en: 'Plaisir' } },
  { id: 'idf-provins', x: 728000, y: 6836000, open: true, region: { fr: 'Seine-et-Marne', en: 'Seine-et-Marne' }, name: { fr: 'Provins', en: 'Provins' } },
  { id: 'idf-rueil-malmaison', x: 632000, y: 6868000, open: true, region: { fr: 'Hauts-de-Seine', en: 'Hauts-de-Seine' }, name: { fr: 'Rueil-Malmaison', en: 'Rueil-Malmaison' } },
  { id: 'idf-saint-clair-sur-epte', x: 600000, y: 6900000, open: true, region: { fr: 'Val-d\'Oise', en: 'Val-d\'Oise' }, name: { fr: 'Saint-Clair-sur-Epte', en: 'Saint-Clair-sur-Epte' } },
  { id: 'idf-saint-germain-laval', x: 696000, y: 6820000, open: true, region: { fr: 'Seine-et-Marne', en: 'Seine-et-Marne' }, name: { fr: 'Saint-Germain-Laval', en: 'Saint-Germain-Laval' } },
  { id: 'idf-sarcelles', x: 648000, y: 6884000, open: true, region: { fr: 'Val-d\'Oise', en: 'Val-d\'Oise' }, name: { fr: 'Sarcelles', en: 'Sarcelles' } },
  { id: 'idf-savigny-sur-orge', x: 648000, y: 6836000, open: true, region: { fr: 'Essonne', en: 'Essonne' }, name: { fr: 'Savigny-sur-Orge', en: 'Savigny-sur-Orge' } },
  { id: 'idf-sourdun', x: 728000, y: 6820000, open: true, region: { fr: 'Seine-et-Marne', en: 'Seine-et-Marne' }, name: { fr: 'Sourdun', en: 'Sourdun' } },
  { id: 'idf-versailles', x: 632000, y: 6852000, open: true, region: { fr: 'Yvelines', en: 'Yvelines' }, name: { fr: 'Versailles', en: 'Versailles' } },
  { id: 'idf-vert-saint-denis', x: 680000, y: 6836000, open: true, region: { fr: 'Seine-et-Marne', en: 'Seine-et-Marne' }, name: { fr: 'Vert-Saint-Denis', en: 'Vert-Saint-Denis' } },
  { id: 'idf-villenauxe-la-petite', x: 728000, y: 6804000, open: true, region: { fr: 'Seine-et-Marne', en: 'Seine-et-Marne' }, name: { fr: 'Villenauxe-la-Petite', en: 'Villenauxe-la-Petite' } },
  { id: 'idf-villeneuve-sur-bellot', x: 728000, y: 6868000, open: true, region: { fr: 'Seine-et-Marne', en: 'Seine-et-Marne' }, name: { fr: 'Villeneuve-sur-Bellot', en: 'Villeneuve-sur-Bellot' } },
  { id: 'idf-villeparisis', x: 680000, y: 6868000, open: true, region: { fr: 'Seine-et-Marne', en: 'Seine-et-Marne' }, name: { fr: 'Villeparisis', en: 'Villeparisis' } },
  { id: 'alpe-dhuez', x: 940000, y: 6446500, open: true, region: { fr: 'Isère · Oisans', en: 'Isère · Oisans' }, name: { fr: "Alpe d'Huez", en: "Alpe d'Huez" } },
  { id: 'mont-ventoux', x: 880000, y: 6341000, open: true, region: { fr: 'Vaucluse', en: 'Vaucluse' }, name: { fr: 'Mont Ventoux', en: 'Mont Ventoux' } },
];
