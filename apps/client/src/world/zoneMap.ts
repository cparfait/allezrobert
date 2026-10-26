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
  { id: 'chevreuse', x: 625500, y: 6843500, open: true, region: IDF, name: { fr: 'Vallée de Chevreuse', en: 'Chevreuse Valley' } },
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
  { id: 'idf-rambouillet', x: 616000, y: 6836000, open: true, region: { fr: 'Yvelines', en: 'Yvelines' }, name: { fr: 'Île-de-France — Rambouillet', en: 'Île-de-France — Rambouillet' } },
  { id: 'idf-ablis', x: 616000, y: 6820000, open: true, region: { fr: 'Yvelines', en: 'Yvelines' }, name: { fr: 'Île-de-France — Ablis', en: 'Île-de-France — Ablis' } },
  { id: 'idf-angerville', x: 632000, y: 6804000, open: true, region: { fr: 'Essonne', en: 'Essonne' }, name: { fr: 'Île-de-France — Angerville', en: 'Île-de-France — Angerville' } },
  { id: 'idf-aubergenville', x: 616000, y: 6868000, open: true, region: { fr: 'Yvelines', en: 'Yvelines' }, name: { fr: 'Île-de-France — Aubergenville', en: 'Île-de-France — Aubergenville' } },
  { id: 'idf-ballancourt-sur-essonne', x: 648000, y: 6820000, open: true, region: { fr: 'Essonne', en: 'Essonne' }, name: { fr: 'Île-de-France — Ballancourt-sur-Essonne', en: 'Île-de-France — Ballancourt-sur-Essonne' } },
  { id: 'idf-bazoches-les-bray', x: 712000, y: 6804000, open: true, region: { fr: 'Seine-et-Marne', en: 'Seine-et-Marne' }, name: { fr: 'Île-de-France — Bazoches-lès-Bray', en: 'Île-de-France — Bazoches-lès-Bray' } },
  { id: 'idf-beaumont-du-gatinais', x: 664000, y: 6788000, open: true, region: { fr: 'Seine-et-Marne', en: 'Seine-et-Marne' }, name: { fr: 'Île-de-France — Beaumont-du-Gâtinais', en: 'Île-de-France — Beaumont-du-Gâtinais' } },
  { id: 'idf-blaru', x: 584000, y: 6884000, open: true, region: { fr: 'Yvelines', en: 'Yvelines' }, name: { fr: 'Île-de-France — Blaru', en: 'Île-de-France — Blaru' } },
  { id: 'idf-boulogne-billancourt', x: 648000, y: 6852000, open: true, region: { fr: 'Hauts-de-Seine', en: 'Hauts-de-Seine' }, name: { fr: 'Île-de-France — Boulogne-Billancourt', en: 'Île-de-France — Boulogne-Billancourt' } },
  { id: 'idf-bures-sur-yvette', x: 632000, y: 6836000, open: true, region: { fr: 'Essonne', en: 'Essonne' }, name: { fr: 'Île-de-France — Bures-sur-Yvette', en: 'Île-de-France — Bures-sur-Yvette' } },
  { id: 'idf-bussy-saint-georges', x: 680000, y: 6852000, open: true, region: { fr: 'Seine-et-Marne', en: 'Seine-et-Marne' }, name: { fr: 'Île-de-France — Bussy-Saint-Georges', en: 'Île-de-France — Bussy-Saint-Georges' } },
  { id: 'idf-cergy', x: 632000, y: 6884000, open: true, region: { fr: 'Val-d\'Oise', en: 'Val-d\'Oise' }, name: { fr: 'Île-de-France — Cergy', en: 'Île-de-France — Cergy' } },
  { id: 'idf-coulommiers', x: 712000, y: 6852000, open: true, region: { fr: 'Seine-et-Marne', en: 'Seine-et-Marne' }, name: { fr: 'Île-de-France — Coulommiers', en: 'Île-de-France — Coulommiers' } },
  { id: 'idf-creteil', x: 664000, y: 6852000, open: true, region: { fr: 'Val-de-Marne', en: 'Val-de-Marne' }, name: { fr: 'Île-de-France — Créteil', en: 'Île-de-France — Créteil' } },
  { id: 'idf-crouy-sur-ourcq', x: 712000, y: 6884000, open: true, region: { fr: 'Seine-et-Marne', en: 'Seine-et-Marne' }, name: { fr: 'Île-de-France — Crouy-sur-Ourcq', en: 'Île-de-France — Crouy-sur-Ourcq' } },
  { id: 'idf-dammarie-les-lys', x: 664000, y: 6820000, open: true, region: { fr: 'Seine-et-Marne', en: 'Seine-et-Marne' }, name: { fr: 'Île-de-France — Dammarie-les-Lys', en: 'Île-de-France — Dammarie-les-Lys' } },
  { id: 'idf-dammartin-en-goele', x: 680000, y: 6884000, open: true, region: { fr: 'Seine-et-Marne', en: 'Seine-et-Marne' }, name: { fr: 'Île-de-France — Dammartin-en-Goële', en: 'Île-de-France — Dammartin-en-Goële' } },
  { id: 'idf-donnemarie-dontilly', x: 712000, y: 6820000, open: true, region: { fr: 'Seine-et-Marne', en: 'Seine-et-Marne' }, name: { fr: 'Île-de-France — Donnemarie-Dontilly', en: 'Île-de-France — Donnemarie-Dontilly' } },
  { id: 'idf-egreville', x: 696000, y: 6788000, open: true, region: { fr: 'Seine-et-Marne', en: 'Seine-et-Marne' }, name: { fr: 'Île-de-France — Égreville', en: 'Île-de-France — Égreville' } },
  { id: 'idf-etampes', x: 632000, y: 6820000, open: true, region: { fr: 'Essonne', en: 'Essonne' }, name: { fr: 'Île-de-France — Étampes', en: 'Île-de-France — Étampes' } },
  { id: 'idf-evry-courcouronnes', x: 664000, y: 6836000, open: true, region: { fr: 'Essonne', en: 'Essonne' }, name: { fr: 'Île-de-France — Évry-Courcouronnes', en: 'Île-de-France — Évry-Courcouronnes' } },
  { id: 'idf-fontenay-tresigny', x: 696000, y: 6852000, open: true, region: { fr: 'Seine-et-Marne', en: 'Seine-et-Marne' }, name: { fr: 'Île-de-France — Fontenay-Trésigny', en: 'Île-de-France — Fontenay-Trésigny' } },
  { id: 'idf-goussainville', x: 664000, y: 6884000, open: true, region: { fr: 'Val-d\'Oise', en: 'Val-d\'Oise' }, name: { fr: 'Île-de-France — Goussainville', en: 'Île-de-France — Goussainville' } },
  { id: 'idf-hermeray', x: 600000, y: 6836000, open: true, region: { fr: 'Yvelines', en: 'Yvelines' }, name: { fr: 'Île-de-France — Hermeray', en: 'Île-de-France — Hermeray' } },
  { id: 'idf-houdan', x: 600000, y: 6852000, open: true, region: { fr: 'Yvelines', en: 'Yvelines' }, name: { fr: 'Île-de-France — Houdan', en: 'Île-de-France — Houdan' } },
  { id: 'idf-jouy-le-chatel', x: 712000, y: 6836000, open: true, region: { fr: 'Seine-et-Marne', en: 'Seine-et-Marne' }, name: { fr: 'Île-de-France — Jouy-le-Châtel', en: 'Île-de-France — Jouy-le-Châtel' } },
  { id: 'idf-la-ferte-gaucher', x: 728000, y: 6852000, open: true, region: { fr: 'Seine-et-Marne', en: 'Seine-et-Marne' }, name: { fr: 'Île-de-France — La Ferté-Gaucher', en: 'Île-de-France — La Ferté-Gaucher' } },
  { id: 'idf-la-ferte-sous-jouarre', x: 712000, y: 6868000, open: true, region: { fr: 'Seine-et-Marne', en: 'Seine-et-Marne' }, name: { fr: 'Île-de-France — La Ferté-sous-Jouarre', en: 'Île-de-France — La Ferté-sous-Jouarre' } },
  { id: 'idf-les-mureaux', x: 616000, y: 6884000, open: true, region: { fr: 'Yvelines', en: 'Yvelines' }, name: { fr: 'Île-de-France — Les Mureaux', en: 'Île-de-France — Les Mureaux' } },
  { id: 'idf-lizy-sur-ourcq', x: 696000, y: 6884000, open: true, region: { fr: 'Seine-et-Marne', en: 'Seine-et-Marne' }, name: { fr: 'Île-de-France — Lizy-sur-Ourcq', en: 'Île-de-France — Lizy-sur-Ourcq' } },
  { id: 'idf-magny-en-vexin', x: 616000, y: 6900000, open: true, region: { fr: 'Val-d\'Oise', en: 'Val-d\'Oise' }, name: { fr: 'Île-de-France — Magny-en-Vexin', en: 'Île-de-France — Magny-en-Vexin' } },
  { id: 'idf-maisse', x: 648000, y: 6804000, open: true, region: { fr: 'Essonne', en: 'Essonne' }, name: { fr: 'Île-de-France — Maisse', en: 'Île-de-France — Maisse' } },
  { id: 'idf-mantes-la-jolie', x: 600000, y: 6884000, open: true, region: { fr: 'Yvelines', en: 'Yvelines' }, name: { fr: 'Île-de-France — Mantes-la-Jolie', en: 'Île-de-France — Mantes-la-Jolie' } },
  { id: 'idf-mantes-la-ville', x: 600000, y: 6868000, open: true, region: { fr: 'Yvelines', en: 'Yvelines' }, name: { fr: 'Île-de-France — Mantes-la-Ville', en: 'Île-de-France — Mantes-la-Ville' } },
  { id: 'idf-marines', x: 632000, y: 6900000, open: true, region: { fr: 'Val-d\'Oise', en: 'Val-d\'Oise' }, name: { fr: 'Île-de-France — Marines', en: 'Île-de-France — Marines' } },
  { id: 'idf-meaux', x: 696000, y: 6868000, open: true, region: { fr: 'Seine-et-Marne', en: 'Seine-et-Marne' }, name: { fr: 'Île-de-France — Meaux', en: 'Île-de-France — Meaux' } },
  { id: 'idf-melun', x: 680000, y: 6820000, open: true, region: { fr: 'Seine-et-Marne', en: 'Seine-et-Marne' }, name: { fr: 'Île-de-France — Melun', en: 'Île-de-France — Melun' } },
  { id: 'idf-milly-la-foret', x: 664000, y: 6804000, open: true, region: { fr: 'Essonne', en: 'Essonne' }, name: { fr: 'Île-de-France — Milly-la-Forêt', en: 'Île-de-France — Milly-la-Forêt' } },
  { id: 'idf-montereau-fault-yonne', x: 696000, y: 6804000, open: true, region: { fr: 'Seine-et-Marne', en: 'Seine-et-Marne' }, name: { fr: 'Île-de-France — Montereau-Fault-Yonne', en: 'Île-de-France — Montereau-Fault-Yonne' } },
  { id: 'idf-montreuil', x: 664000, y: 6868000, open: true, region: { fr: 'Seine-Saint-Denis', en: 'Seine-Saint-Denis' }, name: { fr: 'Île-de-France — Montreuil', en: 'Île-de-France — Montreuil' } },
  { id: 'idf-moret-loing-et-orvanne', x: 680000, y: 6804000, open: true, region: { fr: 'Seine-et-Marne', en: 'Seine-et-Marne' }, name: { fr: 'Île-de-France — Moret-Loing-et-Orvanne', en: 'Île-de-France — Moret-Loing-et-Orvanne' } },
  { id: 'idf-nangis', x: 696000, y: 6836000, open: true, region: { fr: 'Seine-et-Marne', en: 'Seine-et-Marne' }, name: { fr: 'Île-de-France — Nangis', en: 'Île-de-France — Nangis' } },
  { id: 'idf-nemours', x: 680000, y: 6788000, open: true, region: { fr: 'Seine-et-Marne', en: 'Seine-et-Marne' }, name: { fr: 'Île-de-France — Nemours', en: 'Île-de-France — Nemours' } },
  { id: 'idf-paris', x: 648000, y: 6868000, open: true, region: { fr: 'Paris', en: 'Paris' }, name: { fr: 'Île-de-France — Paris', en: 'Île-de-France — Paris' } },
  { id: 'idf-persan', x: 648000, y: 6900000, open: true, region: { fr: 'Val-d\'Oise', en: 'Val-d\'Oise' }, name: { fr: 'Île-de-France — Persan', en: 'Île-de-France — Persan' } },
  { id: 'idf-plaisir', x: 616000, y: 6852000, open: true, region: { fr: 'Yvelines', en: 'Yvelines' }, name: { fr: 'Île-de-France — Plaisir', en: 'Île-de-France — Plaisir' } },
  { id: 'idf-provins', x: 728000, y: 6836000, open: true, region: { fr: 'Seine-et-Marne', en: 'Seine-et-Marne' }, name: { fr: 'Île-de-France — Provins', en: 'Île-de-France — Provins' } },
  { id: 'idf-rueil-malmaison', x: 632000, y: 6868000, open: true, region: { fr: 'Hauts-de-Seine', en: 'Hauts-de-Seine' }, name: { fr: 'Île-de-France — Rueil-Malmaison', en: 'Île-de-France — Rueil-Malmaison' } },
  { id: 'idf-saint-clair-sur-epte', x: 600000, y: 6900000, open: true, region: { fr: 'Val-d\'Oise', en: 'Val-d\'Oise' }, name: { fr: 'Île-de-France — Saint-Clair-sur-Epte', en: 'Île-de-France — Saint-Clair-sur-Epte' } },
  { id: 'idf-saint-germain-laval', x: 696000, y: 6820000, open: true, region: { fr: 'Seine-et-Marne', en: 'Seine-et-Marne' }, name: { fr: 'Île-de-France — Saint-Germain-Laval', en: 'Île-de-France — Saint-Germain-Laval' } },
  { id: 'idf-sarcelles', x: 648000, y: 6884000, open: true, region: { fr: 'Val-d\'Oise', en: 'Val-d\'Oise' }, name: { fr: 'Île-de-France — Sarcelles', en: 'Île-de-France — Sarcelles' } },
  { id: 'idf-savigny-sur-orge', x: 648000, y: 6836000, open: true, region: { fr: 'Essonne', en: 'Essonne' }, name: { fr: 'Île-de-France — Savigny-sur-Orge', en: 'Île-de-France — Savigny-sur-Orge' } },
  { id: 'idf-sourdun', x: 728000, y: 6820000, open: true, region: { fr: 'Seine-et-Marne', en: 'Seine-et-Marne' }, name: { fr: 'Île-de-France — Sourdun', en: 'Île-de-France — Sourdun' } },
  { id: 'idf-versailles', x: 632000, y: 6852000, open: true, region: { fr: 'Yvelines', en: 'Yvelines' }, name: { fr: 'Île-de-France — Versailles', en: 'Île-de-France — Versailles' } },
  { id: 'idf-vert-saint-denis', x: 680000, y: 6836000, open: true, region: { fr: 'Seine-et-Marne', en: 'Seine-et-Marne' }, name: { fr: 'Île-de-France — Vert-Saint-Denis', en: 'Île-de-France — Vert-Saint-Denis' } },
  { id: 'idf-villenauxe-la-petite', x: 728000, y: 6804000, open: true, region: { fr: 'Seine-et-Marne', en: 'Seine-et-Marne' }, name: { fr: 'Île-de-France — Villenauxe-la-Petite', en: 'Île-de-France — Villenauxe-la-Petite' } },
  { id: 'idf-villeneuve-sur-bellot', x: 728000, y: 6868000, open: true, region: { fr: 'Seine-et-Marne', en: 'Seine-et-Marne' }, name: { fr: 'Île-de-France — Villeneuve-sur-Bellot', en: 'Île-de-France — Villeneuve-sur-Bellot' } },
  { id: 'idf-villeparisis', x: 680000, y: 6868000, open: true, region: { fr: 'Seine-et-Marne', en: 'Seine-et-Marne' }, name: { fr: 'Île-de-France — Villeparisis', en: 'Île-de-France — Villeparisis' } },
  { id: 'alpe-dhuez', x: 940000, y: 6446500, open: true, region: { fr: 'Isère · Oisans', en: 'Isère · Oisans' }, name: { fr: "Alpe d'Huez", en: "Alpe d'Huez" } },
  { id: 'mont-ventoux', x: 880000, y: 6341000, open: true, region: { fr: 'Vaucluse', en: 'Vaucluse' }, name: { fr: 'Mont Ventoux', en: 'Mont Ventoux' } },
];
