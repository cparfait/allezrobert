import * as THREE from 'three/webgpu';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { rng } from '../../engine/noise.ts';
import { box, part, prism, segmentsIn, template, type Template } from '../lowPolyKit.ts';
import { buildHarbour, harbourCorners, harbourTemplates, type HarbourSite, type HarbourTemplates } from '../polyHarbour.ts';
import { islandClock } from '../polyOutdoor.ts';
import { meshOf, strollPath, type Site, type SiteContext } from '../polySites.ts';
import type { LoadedTile } from '../types.ts';

/**
 * Décor propre des Rizières et de la jungle (mode Poly, tools/rizieres) : ports, tribunes du Circuit des Rizières,
 * pagodes, stupas et lanternes des temples, ruines envahies par la jungle, villages sur pilotis, marché flottant,
 * barques sur le Grand Fleuve et la Rivière du Dragon, ponts suspendus, buffles d'eau dans les rizières, palmiers et
 * bambous, cascades, bike park de la jungle et cyclo-cross des Digues, lanternes de fête la nuit (islandClock()).
 * Même mécanique que les lieux de l'île (polySites.ts) : chaque lieu est construit par pas quand le coureur approche.
 */
const WHITE = new THREE.Color(0xffffff);
const yawOf = (dx: number, dz: number) => Math.atan2(dx, dz);
const C = (c: string) => new THREE.Color(c);

// ───────────────────────────── Cotes du générateur (tools/rizieres/src/sites-data.ts : design.ts, graph.json, places.json)

const PORT_JADE: HarbourSite = {
  x: 2202.1, z: 8251.5, dir: 1.31, halfLen: 230, halfWid: 95, side: -1, lines: [-160, -100, -40, 20, 80], officeW: 30, officeU: -110, sail: 0.5, fishing: false,
  hulls: ['#e2604f', '#f4d35e', '#2fb7a8', '#3d6fb0', '#ffffff'],
};
const PORT_PITONS: HarbourSite = {
  x: 7129.5, z: 4371.1, dir: 0.55, halfLen: 140, halfWid: 60, side: 1, lines: [-90, -40, 10], officeW: 26, officeU: -95, sail: 0.2, fishing: true,
  hulls: ['#2f8fb5', '#c0392b', '#f2f0e8', '#2e7d32', '#e7b23c'],
};
const PORT_JONQUES: HarbourSite = {
  x: 9698.1, z: -9787.8, dir: -0.79, halfLen: 150, halfWid: 70, side: 1, lines: [-100, -45, 10], officeW: 28, officeU: -110, sail: 0.35, fishing: true,
  hulls: ['#8a3b24', '#c0392b', '#3c7f58', '#253f66', '#d79a33'],
};
/** Circuit des Rizières (ANNEAU), Vat-Robert, colline du temple, sommets, Bambouseraie, col de la Jungle. */
export const RIZIERES_RING = { x: -5183, z: 4689, half: 560, radius: 215 };
const VAT_ROBERT = { x: -424, z: 2079, angle: -0.4 };
const TEMPLE_HILL: readonly [number, number] = [-1299, 3861];
const LANTERN_PEAK: readonly [number, number] = [12619, -5335];
const TIGER_PEAK: readonly [number, number] = [9144, -6363];
const BAMBOUSERAIE: readonly [number, number] = [8385, -4305];
const LOTUS_LAKE = { x: -5602, z: 360, rx: 1150, rz: 330, rot: -0.48, level: 20.2 };
const LAGOON = { x: -12913, z: 9260, rx: 900, rz: 380, rot: 0.6, level: 0.35 };
const FLEUVE: ReadonlyArray<readonly [number, number]> = [[-6682, 2780], [-6738, 2800], [-6798, 2812], [-6860, 2819], [-6922, 2828], [-6980, 2846], [-7033, 2874], [-7083, 2911], [-7131, 2949], [-7180, 2989], [-7229, 3025], [-7281, 3055], [-7337, 3077], [-7395, 3096], [-7452, 3115], [-7507, 3139], [-7560, 3166], [-7612, 3198], [-7662, 3231], [-7715, 3259], [-7771, 3280], [-7831, 3295], [-7892, 3307], [-7953, 3319], [-8014, 3334], [-8069, 3358], [-8117, 3395], [-8160, 3444], [-8199, 3498], [-8241, 3547], [-8288, 3585], [-8339, 3618], [-8394, 3641], [-8454, 3655], [-8515, 3670], [-8572, 3691], [-8621, 3726], [-8664, 3771], [-8705, 3820], [-8750, 3863], [-8803, 3893], [-8860, 3913], [-8919, 3930], [-8975, 3953], [-9025, 3988], [-9068, 4034], [-9111, 4080], [-9160, 4116], [-9218, 4136], [-9282, 4143], [-9350, 4144], [-9414, 4152], [-9470, 4174], [-9521, 4205], [-9575, 4232], [-9632, 4253], [-9690, 4271], [-9746, 4292], [-9799, 4320], [-9849, 4355], [-9896, 4395], [-9943, 4435], [-9990, 4475], [-10039, 4512], [-10092, 4541], [-10148, 4564], [-10205, 4584], [-10261, 4605], [-10316, 4628], [-10374, 4646], [-10436, 4656], [-10498, 4664], [-10557, 4677], [-10613, 4699], [-10664, 4731], [-10714, 4767], [-10763, 4805], [-10812, 4847], [-10861, 4887], [-10912, 4922], [-10967, 4948], [-11024, 4966], [-11084, 4983], [-11142, 4999], [-11200, 5016], [-11258, 5033], [-11317, 5048], [-11376, 5060], [-11437, 5068], [-11497, 5074], [-11558, 5080], [-11618, 5086], [-11679, 5094], [-11738, 5103], [-11797, 5114], [-11856, 5126], [-11915, 5136], [-11975, 5143], [-12035, 5149], [-12096, 5149], [-12158, 5146], [-12219, 5143], [-12280, 5147], [-12338, 5159], [-12395, 5176], [-12452, 5195], [-12510, 5212], [-12567, 5226], [-12626, 5238], [-12684, 5251], [-12742, 5268], [-12800, 5290], [-12856, 5314], [-12913, 5339], [-12971, 5360], [-13030, 5374], [-13090, 5380], [-13150, 5382], [-13210, 5386], [-13269, 5394], [-13328, 5410], [-13386, 5428], [-13445, 5441], [-13505, 5443], [-13567, 5430], [-13631, 5406], [-13695, 5382], [-13759, 5365], [-13821, 5358], [-13881, 5361], [-13939, 5383], [-13994, 5422], [-14047, 5467], [-14102, 5504], [-14159, 5524], [-14220, 5527], [-14281, 5526], [-14342, 5527], [-14402, 5533], [-14460, 5545], [-14519, 5560], [-14577, 5575], [-14636, 5586], [-14696, 5594], [-14756, 5599], [-14817, 5599], [-14879, 5596], [-14940, 5594], [-15002, 5597], [-15061, 5604], [-15120, 5615], [-15178, 5633], [-15231, 5674], [-15279, 5735], [-15328, 5797], [-15379, 5843], [-15436, 5864], [-15498, 5861], [-15561, 5849], [-15626, 5837], [-15688, 5830], [-15749, 5835], [-15807, 5852], [-15863, 5876], [-15919, 5898], [-15977, 5913], [-16035, 5928], [-16091, 5953], [-16145, 5985], [-16200, 6017], [-16256, 6039], [-16315, 6051], [-16376, 6052], [-16438, 6050], [-16502, 6040], [-16567, 6027], [-16629, 6024], [-16687, 6040], [-16740, 6074], [-16792, 6117], [-16844, 6159], [-16897, 6196], [-16953, 6218], [-17015, 6218], [-17082, 6196], [-17150, 6165], [-17217, 6143], [-17279, 6142], [-17338, 6154], [-17399, 6158], [-17462, 6149], [-17527, 6137], [-17589, 6134], [-17648, 6146], [-17699, 6192]];
/** Indice du marché flottant (au droit des Pilotis) dans FLEUVE. */
const FLEUVE_MARKET = 40;
const BRAS: ReadonlyArray<readonly [number, number]> = [[-11132, 4996], [-11162, 5048], [-11192, 5100], [-11223, 5152], [-11255, 5202], [-11288, 5252], [-11322, 5302], [-11356, 5352], [-11389, 5402], [-11422, 5452], [-11454, 5502], [-11486, 5553], [-11518, 5604], [-11549, 5655], [-11580, 5707], [-11612, 5757], [-11644, 5808], [-11674, 5860], [-11704, 5913], [-11734, 5965], [-11765, 6015], [-11799, 6065], [-11834, 6114], [-11869, 6163], [-11905, 6211], [-11940, 6260], [-11974, 6309], [-12007, 6359], [-12039, 6410], [-12071, 6461], [-12103, 6512], [-12136, 6562], [-12168, 6612], [-12201, 6663], [-12234, 6713], [-12266, 6763], [-12299, 6814], [-12332, 6864], [-12365, 6914], [-12400, 6963], [-12439, 7009], [-12481, 7053], [-12522, 7098], [-12559, 7145], [-12593, 7195], [-12624, 7246], [-12654, 7299], [-12682, 7350], [-12713, 7402], [-12747, 7450], [-12787, 7496], [-12830, 7537], [-12874, 7578], [-12919, 7617], [-12959, 7661], [-12992, 7712], [-13019, 7769], [-13045, 7828], [-13077, 7881], [-13117, 7926], [-13166, 7963], [-13216, 7997], [-13268, 8030], [-13319, 8063], [-13369, 8096], [-13418, 8131], [-13467, 8166], [-13515, 8201], [-13565, 8235], [-13614, 8270], [-13661, 8307], [-13708, 8344], [-13755, 8381], [-13804, 8415], [-13856, 8445], [-13909, 8474], [-13962, 8502], [-14013, 8534], [-14061, 8571], [-14105, 8611], [-14150, 8653], [-14196, 8692], [-14245, 8726], [-14297, 8756], [-14349, 8787], [-14399, 8820], [-14448, 8854], [-14496, 8890], [-14544, 8927], [-14593, 8961], [-14644, 8994], [-14694, 9027], [-14741, 9065], [-14788, 9103], [-14838, 9137], [-14892, 9163], [-14950, 9183], [-15011, 9199], [-15071, 9215], [-15131, 9233], [-15186, 9257], [-15236, 9291], [-15279, 9336], [-15319, 9386], [-15361, 9432], [-15408, 9470], [-15457, 9504], [-15512, 9529], [-15571, 9547], [-15631, 9564], [-15685, 9591]];
const DRAGON: ReadonlyArray<readonly [number, number]> = [[14984, -3078], [14949, -3030], [14915, -2980], [14880, -2931], [14845, -2882], [14807, -2835], [14771, -2787], [14737, -2738], [14705, -2687], [14671, -2638], [14635, -2590], [14597, -2542], [14561, -2495], [14527, -2445], [14496, -2394], [14466, -2342], [14436, -2290], [14404, -2239], [14371, -2189], [14339, -2138], [14309, -2086], [14282, -2032], [14258, -1976], [14233, -1920], [14207, -1865], [14176, -1814], [14136, -1768], [14090, -1727], [14041, -1688], [13997, -1646], [13959, -1599], [13925, -1550], [13898, -1495], [13879, -1435], [13861, -1374], [13838, -1317], [13806, -1265], [13765, -1221], [13720, -1180], [13678, -1136], [13642, -1088], [13611, -1036], [13585, -981], [13556, -927], [13522, -877], [13481, -833], [13437, -791], [13386, -754], [13333, -720], [13281, -685], [13235, -645], [13197, -599], [13163, -550], [13130, -499], [13100, -446], [13070, -392], [13035, -343], [12992, -301], [12941, -267], [12886, -236], [12832, -204], [12779, -173], [12727, -140], [12680, -103], [12639, -61], [12602, -13], [12566, 35], [12526, 80], [12482, 121], [12445, 167], [12415, 224], [12391, 287], [12365, 348], [12331, 400], [12287, 441], [12235, 474], [12183, 506], [12133, 540], [12085, 576], [12036, 611], [11984, 642], [11927, 667], [11868, 689], [11808, 709], [11755, 737], [11714, 782], [11686, 844], [11662, 915], [11634, 981], [11593, 1029], [11540, 1060], [11483, 1084], [11422, 1100], [11361, 1115], [11304, 1136], [11253, 1168], [11209, 1209], [11168, 1255], [11129, 1301], [11085, 1342], [11034, 1371], [10975, 1393], [10915, 1415], [10861, 1443], [10816, 1483], [10781, 1534], [10752, 1589], [10733, 1652], [10717, 1716], [10692, 1771], [10651, 1815], [10595, 1846], [10534, 1873], [10473, 1900], [10405, 1920], [10333, 1936], [10269, 1959], [10223, 1998], [10195, 2053], [10176, 2117], [10155, 2179], [10137, 2244], [10126, 2317], [10117, 2391], [10099, 2456]];
/** Indice de Pont-des-Lianes dans DRAGON. */
const DRAGON_PONT = 116;
const JADE_BEACH: ReadonlyArray<readonly [number, number]> = [[229, 8853], [284, 8808], [340, 8764], [395, 8729], [450, 8707], [505, 8688], [560, 8669], [615, 8648], [669, 8620], [722, 8591], [777, 8573], [832, 8569], [889, 8578], [947, 8595], [1003, 8598], [1057, 8579], [1110, 8551], [1162, 8525], [1216, 8509], [1272, 8508], [1329, 8510], [1383, 8502], [1437, 8482], [1489, 8462], [1543, 8446], [1597, 8436], [1653, 8431], [1710, 8433], [1768, 8438], [1825, 8441], [1880, 8431], [1932, 8410]];
const PITONS_BEACH: ReadonlyArray<readonly [number, number]> = [[8564, 2649], [8071, 2709], [7630, 2765], [7416, 2889], [7127, 2973], [6980, 3109], [6869, 3258], [6799, 3425], [6914, 3692], [7089, 4005], [7173, 4758], [7155, 4996], [7170, 5264], [7099, 5477], [7095, 5748], [6998, 5952], [6895, 6152], [6816, 6380], [6793, 6669], [6676, 6874]];
const SUSPENSION: ReadonlyArray<{ id: string; x: number; z: number; cap: number; span: number }> = [
  { id: 'pont-du-delta', x: -14545, z: 4221, cap: -1.109, span: 44 },
  { id: 'pont-des-lianes', x: 11890, z: 680, cap: -0.459, span: 25 },
  { id: 'pont-des-singes', x: 4764, z: -1380, cap: -2.037, span: 34 },
];
const FOOTBRIDGES: ReadonlyArray<{ id: string; x: number; z: number; cap: number; span: number }> = [
  { id: 'passerelle-des-lianes', x: 10251, z: 1970, cap: 4.083, span: 24 },
  { id: 'passerelle-des-gorges', x: 13191, z: -591, cap: 3.764, span: 19 },
  { id: 'passerelle-du-marche', x: -9575, z: 4232, cap: 4.314, span: 48 },
];
const RUINS: ReadonlyArray<{ id: string; x: number; z: number; size: number }> = [
  { id: 'prasat-vert', x: 12613, z: -4938, size: 1.3 },
  { id: 'temple-englouti', x: 13274, z: -1002, size: 1 },
  { id: 'ruines-du-fleuve', x: 6868, z: -190, size: 1.1 },
  { id: 'palais-des-theiers', x: 10045, z: -1292, size: 1.2 },
];
const HERDS: ReadonlyArray<readonly [number, number]> = [[3837, 504], [-4633, 3790], [-7195, 3697], [-1288, 317], [-9758, 3603], [-3851, 223], [1440, 1355], [-10873, 4502], [3503, -2165], [-4966, 1121], [941, -2259], [-7529, 1028]];
const BAMBOO: ReadonlyArray<readonly [number, number]> = [[8185, -4105], [8635, -4455], [8085, -4555], [8765, -4045], [-5855, -239], [-8209, 5751], [9790, 1072], [-4420, -3777], [-246, 4555]];
const FALLS: ReadonlyArray<{ id: string; x: number; z: number; h: number }> = [
  { id: 'cascade-des-nuages', x: -4740, z: -4583, h: 26 },
  { id: 'cascade-du-dragon', x: 12671, z: -199, h: 32 },
];
const BIKE_PARK: readonly [number, number] = [-2227, -3727];
const CYCLO_CROSS: readonly [number, number] = [-6452, 6311];
const COL_JUNGLE: readonly [number, number] = [10888, -5961];

// ───────────────────────────── Gabarits

function kit() {
  const roof = (w: number, d: number, h: number, y: number, col: string) =>
    // Toit relevé : pyramide tronquée à 4 pans, débords marqués, faîtage court.
    part(new THREE.CylinderGeometry(0.35, Math.SQRT1_2, 1, 4, 1).rotateY(Math.PI / 4).scale(w * 1.25, h, d * 1.25).translate(0, y + h / 2, 0), col);
  const person = (shirt: string) => [
    part(box(0.3, 0.75, 0.2, 0, 0.42), '#3a3a40'),
    part(box(0.4, 0.58, 0.24, 0, 1.08), shirt, 1),
    part(new THREE.IcosahedronGeometry(0.13, 0).translate(0, 1.52, 0), '#c99a6e'),
    part(new THREE.ConeGeometry(0.34, 0.2, 8).translate(0, 1.72, 0), '#d8c27a'),
  ];
  return {
    stand: template([
      ...Array.from({ length: 6 }, (_, i) => part(box(12, 0.45 * (i + 1), 0.95, 0, 0.225 * (i + 1), -2.8 + i * 0.95), i % 2 ? '#c9c4b8' : '#d6d1c4')),
      ...Array.from({ length: 6 }, (_, i) => part(box(11.6, 0.36, 0.1, 0, 0.45 * (i + 1) + 0.2, -2.8 + i * 0.95 + 0.4), '#ffffff', 1)),
      part(box(12.4, 0.22, 7.6, 0, 5.4, -0.4).rotateX(-0.06), '#c0392b'),
      ...[-5.8, 5.8].map((x) => part(prism(0.12, 0.1, 0, 5.4, 6, x, 2.8), '#8f9699')),
    ]),
    arch: template([
      ...[-6, 6].map((x) => part(box(0.8, 6.4, 0.8, x, 3.2), '#c0392b')),
      part(box(14.5, 0.6, 1.1, 0, 6.6), '#2b2f33'),
      part(box(13, 0.4, 0.8, 0, 5.6), '#c0392b'),
      part(box(4, 1.2, 0.3, 0, 6.1), '#f4d35e'),
    ]),
    flag: template([part(prism(0.05, 0.04, 0, 6, 5), '#e9e6dc'), part(box(0.03, 1, 1.6, 0, 5.4, 0.85), '#ffffff', 1)]),
    /** Pagode à cinq toits, rouge et or. */
    pagoda: template([
      part(box(9, 1, 9, 0, 0.5), '#d9cdb4'),
      ...Array.from({ length: 5 }, (_, i) => {
        const s = 6 - i * 0.9;
        const y = 1 + i * 3.1;
        return [part(box(s, 2.2, s, 0, y + 1.1), i % 2 ? '#f4ead2' : '#c0392b'), roof(s + 1.6, s + 1.6, 0.9, y + 2.2, '#8e2f22')];
      }).flat(),
      part(prism(0.35, 0.05, 16.5, 21, 6), '#e8c35a'),
    ]),
    /** Stupa en cloche, doré. */
    stupa: template([
      part(box(7, 1.2, 7, 0, 0.6), '#f2f0e8'),
      part(prism(3.2, 3.2, 1.2, 2.4, 10), '#f2f0e8'),
      part(new THREE.SphereGeometry(2.9, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, 1.2, 1).translate(0, 2.4, 0), '#e8c35a'),
      part(box(1.4, 0.8, 1.4, 0, 6.2), '#e8c35a'),
      part(prism(0.7, 0.05, 6.6, 11, 8), '#e8c35a'),
    ]),
    /** Portique de temple (deux poteaux rouges, double linteau). */
    gate: template([
      ...[-2.6, 2.6].map((x) => part(prism(0.3, 0.26, 0, 5, 8, x), '#c0392b')),
      part(box(7.6, 0.4, 0.6, 0, 5.1), '#2b2f33'),
      part(box(6.4, 0.3, 0.4, 0, 4.2), '#c0392b'),
    ]),
    /** Lanterne de papier rouge sur son poteau (le globe s'allume à part, la nuit). */
    lanternPost: template([part(prism(0.06, 0.05, 0, 2.6, 5), '#4a3424'), part(box(0.7, 0.06, 0.06, 0.3, 2.6), '#4a3424'), part(box(0.34, 0.5, 0.34, 0.6, 2.25), '#d23a2a', 1)]),
    lantern: template([part(box(0.36, 0.48, 0.36, 0, 0), '#d23a2a', 1), part(box(0.38, 0.06, 0.38, 0, 0.27), '#2b2f33'), part(box(0.38, 0.06, 0.38, 0, -0.27), '#2b2f33')]),
    /** Maison sur pilotis : poteaux, plancher, murs de bois, toit de chaume relevé (avant +z). */
    stilt: template([
      ...[-2.6, 0, 2.6].flatMap((x) => [-2.2, 2.2].map((z) => part(box(0.22, 3.4, 0.22, x, 1.0, z), '#5a3f2a'))),
      part(box(6.4, 0.25, 5.6, 0, 2.6), '#7a5638'),
      part(box(5.6, 2.4, 4.4, 0, 3.9, -0.3), '#9c6a40', 1),
      part(box(1, 1.6, 0.08, 0, 3.6, 1.95), '#3a2a1e'),
      roof(5.8, 4.8, 2.6, 5.1, '#b8955a'),
      part(box(6.4, 0.9, 0.08, 0, 3.1, 2.75), '#7a5638'),
      part(box(1.2, 0.12, 3, 0, 1.2, 4.1).rotateX(0.5), '#7a5638'),
    ]),
    /** Barque (sampan) : coque, auvent de paille (avant +z). */
    sampan: template([
      part(new THREE.CylinderGeometry(0.9, 0.55, 7, 6, 1, false, 0, Math.PI).rotateZ(Math.PI).rotateX(Math.PI / 2).scale(1, 0.75, 1).translate(0, 0.62, 0), '#6a4428', 1),
      part(box(1.5, 0.08, 6.4, 0, 0.62), '#8a6038'),
      part(new THREE.CylinderGeometry(0.85, 0.85, 2.4, 8, 1, true, -Math.PI / 2, Math.PI).rotateX(Math.PI / 2).translate(0, 1.05, -0.6), '#c8a86a'),
      part(prism(0.03, 0.03, 0.6, 2.8, 4, 0, 2.6).rotateX(-0.5), '#4a3424'),
    ]),
    /** Paniers de fruits, légumes et fleurs posés dans les barques du marché. */
    goods: template([
      part(prism(0.35, 0.42, 0, 0.35, 7, -0.3, 1.2), '#c49a5a'),
      part(new THREE.IcosahedronGeometry(0.34, 0).scale(1, 0.6, 1).translate(-0.3, 0.42, 1.2), '#f4a62a', 1),
      part(prism(0.35, 0.42, 0, 0.35, 7, 0.35, 2), '#c49a5a'),
      part(new THREE.IcosahedronGeometry(0.34, 0).scale(1, 0.6, 1).translate(0.35, 0.42, 2), '#7fb069'),
      part(box(0.6, 0.3, 0.5, 0, 0.15, 0.2), '#e2604f'),
    ]),
    vendor: template(person('#ffffff')),
    /** Buffle d'eau (avant +z). */
    buffalo: template([
      part(box(1.1, 1, 2.2, 0, 1.15), '#4a4a4e'),
      part(box(0.7, 0.6, 0.7, 0, 1.25, 1.35), '#3f3f43'),
      part(box(1.7, 0.12, 0.14, 0, 1.6, 1.2).rotateZ(0), '#d9d0bc'),
      ...[-0.42, 0.42].flatMap((x) => [-0.8, 0.8].map((z) => part(box(0.22, 0.7, 0.22, x, 0.35, z), '#3a3a3e'))),
    ]),
    /** Cocotier penché : stipe en trois tronçons, palmes. */
    palm: template([
      part(prism(0.22, 0.18, 0, 3.2, 5).rotateZ(0.12), '#8a6a48'),
      part(prism(0.18, 0.16, 0, 3.2, 5).rotateZ(0.2).translate(0.38, 3.1, 0), '#8a6a48'),
      part(prism(0.16, 0.14, 0, 3, 5).rotateZ(0.28).translate(1.0, 6.1, 0), '#8a6a48'),
      ...Array.from({ length: 7 }, (_, i) => {
        const a = (i / 7) * Math.PI * 2;
        return part(box(0.5, 0.06, 3.4, 0, 0, 1.6).rotateX(0.45).rotateY(a).translate(1.8, 8.9, 0), '#3f8f3a', 1);
      }),
      part(new THREE.IcosahedronGeometry(0.35, 0).translate(1.8, 8.6, 0), '#6a4a2a'),
    ]),
    /** Touffe de bambous. */
    bamboo: template(
      Array.from({ length: 9 }, (_, i) => {
        const a = i * 2.39;
        const r = 0.3 + (i % 3) * 0.35;
        const h = 7 + (i % 4) * 1.6;
        return [part(prism(0.07, 0.05, 0, h, 4, Math.cos(a) * r, Math.sin(a) * r).rotateZ(Math.cos(a) * 0.08).rotateX(Math.sin(a) * 0.08), '#8fae3a'), part(new THREE.IcosahedronGeometry(0.9, 0).scale(1, 1.6, 1).translate(Math.cos(a) * r * 1.8, h - 0.6, Math.sin(a) * r * 1.8), '#5e9a32', 1)];
      }).flat(),
    ),
    /** Bloc de grès moussu, colonne brisée, tour-sanctuaire (prang) en ruine, racines. */
    block: template([part(box(1.6, 0.9, 1.1, 0, 0.45), '#8f8f78', 1), part(box(1.62, 0.12, 1.12, 0, 0.92), '#5d7a3a')]),
    column: template([part(prism(0.45, 0.42, 0, 3.2, 8), '#9a9a82', 1), part(box(1.1, 0.35, 1.1, 0, 3.35), '#8f8f78'), part(box(0.95, 1.3, 0.1, 0, 1.6, 0.42), '#4f7a32')]),
    prang: template([
      part(box(8, 1.6, 8, 0, 0.8), '#8f8f78'),
      part(box(6, 3.6, 6, 0, 3.4), '#9a9a82', 1),
      part(box(4.6, 2.6, 4.6, 0, 6.5), '#8f8f78'),
      part(prism(2.2, 0.6, 7.8, 13, 8), '#9a9a82', 1),
      part(box(1.6, 2.4, 0.2, 0, 2.8, 3.05), '#2b2b26'),
      part(box(6.2, 2.6, 0.15, 0, 3.6, -3.05), '#4f7a32'),
      part(box(0.15, 3.4, 4.2, 3.05, 4.2, 0.6), '#3f6a2a'),
    ]),
    /** Figuier étrangleur : racines sur les ruines, gros houppier. */
    banyan: template([
      part(prism(1.2, 0.8, 0, 8, 7), '#6f6650'),
      ...Array.from({ length: 6 }, (_, i) => part(box(0.25, 6, 0.25, 0, 3, 0).rotateZ(0.5).rotateY((i / 6) * Math.PI * 2).translate(Math.cos((i / 6) * Math.PI * 2) * 1.4, 0, -Math.sin((i / 6) * Math.PI * 2) * 1.4), '#5f5844')),
      part(new THREE.IcosahedronGeometry(6, 0).scale(1.2, 0.7, 1.2).translate(0, 11, 0), '#2e5e2a', 1),
      part(new THREE.IcosahedronGeometry(4, 0).scale(1.2, 0.7, 1.2).translate(3, 9, 2), '#3a6e2e', 1),
    ]),
    /** Pylône de pont suspendu (deux mâts, linteau). */
    tower: template([
      ...[-2.6, 2.6].map((x) => part(box(0.5, 8, 0.5, x, 4), '#5a3f2a')),
      part(box(5.8, 0.5, 0.6, 0, 7.6), '#5a3f2a'),
      part(box(5.8, 0.3, 0.4, 0, 6.6), '#c0392b'),
    ]),
    plank: template([part(box(1.6, 0.08, 0.3, 0, 0), '#8a6038', 1)]),
    rope: template([part(box(0.06, 0.06, 1, 0, 0, 0.5), '#6a5236')]),
    /** Falaise de calcaire et vasque d'une cascade (la chute est animée à part). */
    cliff: template([
      part(box(14, 1, 9, 0, 0.5, -4.5).scale(1, 1, 1), '#9a9a90', 1),
      part(new THREE.IcosahedronGeometry(1, 0).scale(9, 1, 5).translate(-7, 0.5, -1), '#8a8a80'),
      part(new THREE.IcosahedronGeometry(1, 0).scale(8, 1, 5).translate(7, 0.5, -1.5), '#a3a39a'),
      part(new THREE.IcosahedronGeometry(1, 0).scale(5, 0.6, 3).translate(-5, 1, -6), '#3f6a2a'),
      part(new THREE.IcosahedronGeometry(1, 0).scale(5, 0.6, 3).translate(5, 1, -6), '#2e5e2a'),
    ]),
    pool: template([part(prism(6, 6.4, -0.2, 0.15, 12), '#2fb7a8'), part(prism(6.6, 7.2, -0.3, 0.35, 12), '#8a8a80')]),
    /** Départ du bike park (portique de bois et banderole) et bosses de terre. */
    start: template([
      ...[-2.4, 2.4].map((x) => part(box(0.4, 4.2, 0.4, x, 2.1), '#6a4428')),
      part(box(5.4, 1, 0.12, 0, 3.8), '#2e7d32', 1),
      part(box(5.2, 0.4, 2.2, 0, 1.2, -1.2).rotateX(0.25), '#7a5638'),
    ]),
    jump: template([part(new THREE.CylinderGeometry(0.8, 2.2, 1.1, 6, 1).scale(1, 1, 0.6).translate(0, 0.55, 0), '#a05a32')]),
    /** Piquets et rubalise du cyclo-cross. */
    stake: template([part(prism(0.04, 0.04, 0, 1.1, 4), '#f2efe6'), part(box(0.03, 0.08, 2.6, 0, 0.95, 1.3), '#ffffff', 1)]),
    banner: template([...[-2, 2].map((x) => part(box(0.12, 2.2, 0.12, x, 1.1), '#4a4a4e')), part(box(4.2, 0.8, 0.06, 0, 1.8), '#ffffff', 1)]),
    /** Étal du marché de nuit (auvent rayé teinté). */
    stall: template([
      ...[-1.3, 1.3].flatMap((x) => [-0.9, 0.9].map((z) => part(prism(0.05, 0.05, 0, 2.3, 4, x, z), '#4a3424'))),
      part(box(2.8, 0.1, 2.1, 0, 2.35), '#ffffff', 1),
      part(box(2.4, 0.8, 1.2, 0, 0.4, 0.2), '#8a6038'),
      part(box(2.2, 0.2, 1, 0, 0.9, 0.2), '#f4a62a'),
    ]),
    prayer: template([part(box(0.05, 0.4, 0.5, 0, 0), '#ffffff', 1)]),
  };
}
type Kit = ReturnType<typeof kit>;

// ───────────────────────────── Aides

/** Globes des lanternes : un maillage à part, allumé la nuit seulement (heure du monde, islandClock()). */
function lanternGlow(c: SiteContext, pts: number[], name: string, size = 0.34): void {
  if (!pts.length) return;
  const geos: THREE.BufferGeometry[] = [];
  for (let i = 0; i + 2 < pts.length; i += 3) geos.push(new THREE.BoxGeometry(size, size * 1.35, size).translate(pts[i]!, pts[i + 1]!, pts[i + 2]!));
  const glow = new THREE.Mesh(mergeGeometries(geos), new THREE.MeshBasicNodeMaterial({ color: '#ffb347' }));
  glow.name = name;
  glow.castShadow = false;
  glow.visible = false;
  c.moving.push({ object: glow, step: () => void (glow.visible = islandClock().night > 0.25) });
}

/** Point libre (ni route, ni bâtiment, ni eau) le plus proche de (x, z), en spirale ; null sinon. */
function freeSpot(c: SiteContext, x: number, z: number, clear = 4, tries = 60, water = 0.1): [number, number, number] | null {
  for (let k = 0; k < tries; k++) {
    const px = x + Math.cos(k * 2.4) * k * 3;
    const pz = z + Math.sin(k * 2.4) * k * 3;
    const p = c.probe;
    if (!p.read(px, pz) || p.road > 0.02 || p.water > water || p.buildingNear(px, pz, clear)) continue;
    const y = p.heightAt(px, pz);
    if (Number.isFinite(y)) return [px, y, pz];
  }
  return null;
}

/** Bâtiment du générateur du genre `kind` le plus proche de (x, z) dans un rayon `r` : centre et cap du grand côté. */
function buildingAt(c: SiteContext, x: number, z: number, r: number, kind: string): { x: number; z: number; ang: number; half: number } | null {
  const list: Array<{ tile: LoadedTile; i: number }> = [];
  c.probe.buildingsIn(x - r, z - r, x + r, z + r, list);
  let best: { x: number; z: number; ang: number; half: number } | null = null;
  let bd = Infinity;
  for (const { tile, i } of list) {
    const b = tile.features.buildings[i]!;
    if (b.kind !== kind) continue;
    const n = b.pts.length / 2;
    let cx = 0;
    let cz = 0;
    for (let k = 0; k < b.pts.length; k += 2) {
      cx += b.pts[k]! / n;
      cz += b.pts[k + 1]! / n;
    }
    const d = Math.hypot(cx - x, cz - z);
    if (d >= bd) continue;
    bd = d;
    const ang = Math.atan2(b.pts[3]! - b.pts[1]!, b.pts[2]! - b.pts[0]!);
    best = { x: cx, z: cz, ang, half: Math.hypot(b.pts[2]! - b.pts[0]!, b.pts[3]! - b.pts[1]!) / 2 };
  }
  return best;
}

/** Ligne de lanternes suspendues entre deux poteaux (guirlande de fête). */
function garland(c: SiteContext, K: Kit, a: readonly [number, number, number], b: readonly [number, number, number], n: number, glow: number[], tints: THREE.Color[]): void {
  for (let i = 1; i < n; i++) {
    const t = i / n;
    const x = a[0] + (b[0] - a[0]) * t;
    const z = a[2] + (b[2] - a[2]) * t;
    const y = a[1] + (b[1] - a[1]) * t - Math.sin(t * Math.PI) * 0.9;
    c.mesh.put(K.lantern, x, y, z, 0, 1, 1, 1, tints[i % tints.length]!);
    glow.push(x, y - 0.02, z);
  }
}

const LANTERN_TINTS = [C('#ffffff'), C('#f4d35e'), C('#ff8a3d'), C('#e2604f')];

// ───────────────────────────── Lieux

const harbourSite = (id: string, h: HarbourSite, reach: number, templates: () => HarbourTemplates): Site => ({
  id,
  x: h.x,
  z: h.z,
  reach,
  needs: harbourCorners(h),
  *build(c) {
    yield* buildHarbour(c.mesh, c.probe, templates(), h);
    const ux = Math.cos(h.dir);
    const uz = Math.sin(h.dir);
    const w = -h.side * (h.halfWid + 6);
    const at = (u: number): [number, number] => [h.x + ux * u - uz * w, h.z + uz * u + ux * w];
    strollPath(c, [at(-h.halfLen * 0.8), at(h.halfLen * 0.6), at(-h.halfLen * 0.8)], 31 + Math.round(h.x));
  },
});

/** Tribunes à toit rouge, portique d'arrivée et drapeaux du Circuit des Rizières. */
function circuit(k: () => Kit): Site {
  const R = RIZIERES_RING;
  const zS = R.z + R.radius;
  return {
    id: 'circuit',
    x: R.x,
    z: R.z,
    reach: 900,
    needs: [[R.x - R.half, zS], [R.x + R.half, zS], [R.x, R.z - R.radius]],
    *build(c) {
      const K = k();
      const flags = [C('#c0392b'), C('#f4d35e'), C('#2fb7a8'), C('#2e7d32')];
      for (let i = -2; i <= 2; i++) {
        const x = R.x + i * 13;
        const z = zS + 26;
        const y = c.probe.heightAt(x, z);
        if (Number.isFinite(y)) c.mesh.put(K.stand, x, y, z, Math.PI, 1, 1, 1, WHITE);
        for (let s = 0; s < 8; s++) c.spots.push({ kind: 'villager', x: x - 5 + s * 1.4, y: y + 1.6, z: z - 1.2, yaw: Math.PI, seed: ((i + 2) * 0.137 + s * 0.071) % 1 });
      }
      yield;
      const ay = c.probe.heightAt(R.x + 120, zS);
      if (Number.isFinite(ay)) c.mesh.put(K.arch, R.x + 120, ay, zS, Math.PI / 2, 1, 1, 1, WHITE);
      for (let i = 0; i < 24; i++) {
        const x = R.x - R.half + (i * 2 * R.half) / 23;
        for (const z of [zS + 12, R.z - R.radius - 12]) {
          const y = c.probe.heightAt(x, z);
          if (Number.isFinite(y)) c.mesh.put(K.flag, x, y, z, 0, 1, 1, 1, flags[i % flags.length]!);
        }
      }
      yield;
      strollPath(c, [[R.x - 300, R.z], [R.x + 300, R.z - 60], [R.x + 300, R.z + 60], [R.x - 300, R.z]], 404, 'jogger');
    },
  };
}

/** Grand Temple de Vat-Robert sur sa colline : pagode, portique, lanternes de fête la nuit, fidèles. */
function templeHill(k: () => Kit): Site {
  const [x0, z0] = TEMPLE_HILL;
  return {
    id: 'grand-temple',
    x: x0,
    z: z0,
    reach: 1500,
    needs: [[x0, z0], [x0 - 200, z0 - 200], [x0 + 200, z0 + 200]],
    *build(c) {
      const K = k();
      const t = buildingAt(c, x0, z0, 220, 'temple');
      const cx = t?.x ?? x0;
      const cz = t?.z ?? z0;
      const ang = t?.ang ?? 0.15;
      const ux = Math.cos(ang);
      const uz = Math.sin(ang);
      const P = (a: number, b: number): [number, number] => [cx + ux * a - uz * b, cz + uz * a + ux * b];
      const pg = freeSpot(c, ...P(30, -22), 5);
      if (pg) c.mesh.put(K.pagoda, pg[0], pg[1], pg[2], -ang, 1, 1, 1, WHITE);
      const st = freeSpot(c, ...P(-34, 20), 4);
      if (st) c.mesh.put(K.stupa, st[0], st[1], st[2], 0, 1, 1, 1, WHITE);
      yield;
      // Allée de lanternes devant le temple, portique au bout.
      const glow: number[] = [];
      for (let i = 0; i < 12; i++)
        for (const s of [-1, 1]) {
          const [x, z] = P(-10, 14 + i * 6);
          const q = freeSpot(c, x + ux * s * 4, z + uz * s * 4, 1.5, 6);
          if (!q) continue;
          const yaw = -ang + (s > 0 ? Math.PI : 0);
          c.mesh.put(K.lanternPost, q[0], q[1], q[2], yaw, 1, 1, 1, LANTERN_TINTS[i % 4]!);
          glow.push(q[0] + Math.cos(yaw) * 0.6, q[1] + 2.25, q[2] - Math.sin(yaw) * 0.6);
        }
      const g = freeSpot(c, ...P(-10, 88), 3);
      if (g) c.mesh.put(K.gate, g[0], g[1], g[2], -ang, 1, 1, 1, WHITE);
      // Guirlandes de lanternes autour du temple.
      const corners = [P(-24, -16), P(24, -16), P(24, 16), P(-24, 16)].map(([x, z]) => [x, (c.probe.heightAt(x, z) || 0) + 5, z] as const);
      for (let i = 0; i < 4; i++) garland(c, K, corners[i]!, corners[(i + 1) % 4]!, 10, glow, LANTERN_TINTS);
      lanternGlow(c, glow, 'rizieres-lanternes-temple');
      yield;
      const r = rng(707);
      for (let i = 0; i < 10; i++) {
        const q = freeSpot(c, ...P(-10 + (r() - 0.5) * 16, 20 + r() * 60), 1.5, 8);
        if (q) c.spots.push({ kind: 'villager', x: q[0], y: q[1], z: q[2], yaw: r() * 6.28, seed: r() });
      }
      strollPath(c, [P(-10, 90), P(-10, 18), P(-10, 90)], 4711);
    },
  };
}

/** Place du marché de Vat-Robert : étals, guirlandes de lanternes allumées la nuit. */
function marketSquare(k: () => Kit): Site {
  const { x: X, z: Z, angle } = VAT_ROBERT;
  const ux = Math.cos(angle);
  const uz = Math.sin(angle);
  const P = (a: number, b: number): [number, number] => [X + ux * a - uz * b, Z + uz * a + ux * b];
  return {
    id: 'marche-vat-robert',
    x: X,
    z: Z,
    reach: 800,
    needs: [P(-30, -30), P(30, 30)],
    *build(c) {
      const K = k();
      const r = rng(3131);
      const tints = [C('#e2604f'), C('#2fb7a8'), C('#f4d35e'), C('#ff8a3d'), C('#ffffff')];
      for (let i = 0; i < 10; i++) {
        const q = freeSpot(c, ...P(-20 + (i % 5) * 9, i < 5 ? -12 : 12), 1.2, 6, 0.1);
        if (!q) continue;
        c.mesh.put(K.stall, q[0], q[1], q[2], -angle + (i < 5 ? 0 : Math.PI), 1, 1, 1, tints[i % tints.length]!);
        c.spots.push({ kind: 'villager', x: q[0] + (r() - 0.5) * 2, y: q[1], z: q[2] + (r() - 0.5) * 2, yaw: r() * 6.28, seed: r() });
      }
      yield;
      const glow: number[] = [];
      const posts = [P(-24, -18), P(24, -18), P(24, 18), P(-24, 18)].map(([x, z]) => [x, (c.probe.heightAt(x, z) || 0) + 4.5, z] as const);
      for (let i = 0; i < 4; i++) garland(c, K, posts[i]!, posts[(i + 1) % 4]!, 12, glow, LANTERN_TINTS);
      garland(c, K, posts[0]!, posts[2]!, 16, glow, LANTERN_TINTS);
      garland(c, K, posts[1]!, posts[3]!, 16, glow, LANTERN_TINTS);
      lanternGlow(c, glow, 'rizieres-lanternes-marche');
    },
  };
}

/** Lanternes le long de la montée de nuit au Temple des Lanternes (routes col-sud et col-observatoire), par tronçons. */
function lanternRoad(k: () => Kit, i: number, x: number, z: number): Site {
  return {
    id: `lanternes-montee-${i}`,
    x,
    z,
    reach: 1300,
    needs: [[x - 450, z - 450], [x + 450, z + 450], [x, z]],
    *build(c) {
      const K = k();
      const glow: number[] = [];
      for (const t of c.probe.tilesIn(x - 500, z - 500, x + 500, z + 500))
        for (const road of t.features.roads) {
          if (!road.id || !/^col-(sud|observatoire)-/.test(road.id)) continue;
          const p = road.pts;
          let run = 0;
          for (let j = 2; j + 3 < p.length; j += 2) {
            const ax = p[j - 2]!;
            const az = p[j - 1]!;
            const bx = p[j]!;
            const bz = p[j + 1]!;
            run += Math.hypot(bx - ax, bz - az);
            if (run < 45) continue;
            run = 0;
            if (Math.abs(bx - x) > 500 || Math.abs(bz - z) > 500) continue;
            const l = Math.hypot(bx - ax, bz - az) || 1;
            const nx = -(bz - az) / l;
            const nz = (bx - ax) / l;
            const s = (Math.round(bx + bz) & 1) === 0 ? 1 : -1;
            const off = road.width / 2 + 1.6;
            const px = bx + nx * off * s;
            const pz = bz + nz * off * s;
            const y = c.probe.heightAt(px, pz);
            if (!Number.isFinite(y)) continue;
            // Le bras du poteau penche vers la chaussée.
            const yaw = Math.atan2(nz * s, -nx * s);
            c.mesh.put(K.lanternPost, px, y, pz, yaw, 1, 1, 1, LANTERN_TINTS[(j >> 1) % 4]!);
            glow.push(px + Math.cos(yaw) * 0.6, y + 2.25, pz - Math.sin(yaw) * 0.6);
          }
        }
      lanternGlow(c, glow, 'rizieres-lanternes-montee');
    },
  };
}

/** Sommet du Mont des Lanternes : pagode, guirlandes et drapeaux de prière ; stupa du Mont du Tigre. */
function summits(k: () => Kit): Site {
  const [px, pz] = LANTERN_PEAK;
  return {
    id: 'sommets',
    x: px,
    z: pz,
    reach: 2200,
    needs: [LANTERN_PEAK, TIGER_PEAK],
    *build(c) {
      const K = k();
      const glow: number[] = [];
      const q = freeSpot(c, px - 30, pz + 26, 5);
      if (q) c.mesh.put(K.pagoda, q[0], q[1], q[2], 0.4, 0.8, 0.8, 0.8, WHITE);
      const ring: Array<readonly [number, number, number]> = [];
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        const x = px + Math.cos(a) * 18;
        const z = pz + Math.sin(a) * 18;
        const y = c.probe.heightAt(x, z);
        if (Number.isFinite(y)) {
          c.mesh.put(K.lanternPost, x, y, z, -a, 1, 1, 1, LANTERN_TINTS[i % 4]!);
          ring.push([x, y + 4.2, z]);
        }
      }
      for (let i = 0; i < ring.length; i++) garland(c, K, ring[i]!, ring[(i + 1) % ring.length]!, 6, glow, LANTERN_TINTS);
      lanternGlow(c, glow, 'rizieres-lanternes-sommet');
      yield;
      // Drapeaux de prière tendus vers le Mont du Tigre.
      const [tx, tz] = TIGER_PEAK;
      const ty = c.probe.heightAt(tx, tz);
      const flagTints = [C('#2f6db5'), C('#ffffff'), C('#c0392b'), C('#3aa36b'), C('#f2c230')];
      if (Number.isFinite(ty)) {
        const s = freeSpot(c, tx + 26, tz - 14, 4);
        if (s) c.mesh.put(K.stupa, s[0], s[1], s[2], 0, 0.8, 0.8, 0.8, WHITE);
        for (let i = 0; i < 30; i++) {
          const a = (i / 30) * Math.PI * 2;
          const x = tx + Math.cos(a) * 12;
          const z = tz + Math.sin(a) * 12;
          const y = c.probe.heightAt(x, z);
          if (Number.isFinite(y)) c.mesh.put(K.prayer, x, y + 2.4 + Math.sin(i) * 0.2, z, -a, 1, 1, 1, flagTints[i % 5]!);
        }
      }
    },
  };
}

/** Ruine envahie : prang moussu, blocs épars, colonnes brisées, figuier étrangleur, visiteurs. */
function ruin(k: () => Kit, R: (typeof RUINS)[number]): Site {
  return {
    id: `ruine-${R.id}`,
    x: R.x,
    z: R.z,
    reach: 900,
    needs: [[R.x, R.z], [R.x - 120, R.z - 120], [R.x + 120, R.z + 120]],
    *build(c) {
      const K = k();
      const b = buildingAt(c, R.x, R.z, 400, 'ruins');
      const cx = b?.x ?? R.x;
      const cz = b?.z ?? R.z;
      const r = rng(Math.round(cx * 3 + cz));
      const moss = [C('#9a9a82'), C('#8a9478'), C('#a3a08a')];
      const p1 = freeSpot(c, cx + 22, cz - 6, 6, 40, 0.2);
      if (p1) c.mesh.put(K.prang, p1[0], p1[1] - 0.3, p1[2], r() * 6.28, R.size, R.size, R.size, moss[0]!);
      const p2 = freeSpot(c, cx - 20, cz + 14, 5, 40, 0.2);
      if (p2) c.mesh.put(K.prang, p2[0], p2[1] - 0.5, p2[2], r() * 6.28, R.size * 0.7, R.size * 0.6, R.size * 0.7, moss[1]!);
      yield;
      for (let i = 0; i < 26; i++) {
        const a = r() * Math.PI * 2;
        const d = 8 + r() * 30;
        const q = freeSpot(c, cx + Math.cos(a) * d, cz + Math.sin(a) * d, 1.5, 4, 0.3);
        if (!q) continue;
        if (i % 3 === 0) c.mesh.put(K.column, q[0], q[1], q[2], r() * 6.28, 1, 0.5 + r() * 0.6, 1, moss[i % 3]!);
        else c.mesh.put(K.block, q[0], q[1] - 0.2, q[2], r() * 6.28, 0.7 + r() * 0.6, 0.7 + r() * 0.6, 0.7 + r() * 0.6, moss[i % 3]!);
      }
      yield;
      const t = freeSpot(c, cx + 6, cz + 20, 3, 40, 0.2);
      if (t) c.mesh.put(K.banyan, t[0], t[1], t[2], r() * 6.28, 1, 1, 1, C('#d6e6c4'));
      // Singes et oiseaux perchés sur les ruines, visiteurs.
      if (p1) c.perches.push({ pts: new Float32Array([p1[0] - 1, p1[1] + 4.9 * R.size, p1[2], p1[0] + 1.2, p1[1] + 4.9 * R.size, p1[2] + 0.8]), yaw: 0, ground: false, x: p1[0], z: p1[2] });
      strollPath(c, [[cx - 30, cz + 30], [cx + 30, cz + 20], [cx + 20, cz - 30], [cx - 30, cz + 30]], Math.round(cx));
    },
  };
}

/** Village sur pilotis : maisons au bord de l'eau, le long d'une rive (points de la rive, côté de l'eau). */
function stiltVillage(k: () => Kit, id: string, shore: ReadonlyArray<readonly [number, number, number, number]>, waterY: number | null): Site {
  const cx = shore.reduce((s, p) => s + p[0], 0) / shore.length;
  const cz = shore.reduce((s, p) => s + p[1], 0) / shore.length;
  return {
    id,
    x: cx,
    z: cz,
    reach: 1100,
    needs: [[shore[0]![0], shore[0]![1]], [shore[shore.length - 1]![0], shore[shore.length - 1]![1]], [cx, cz]],
    *build(c) {
      const K = k();
      const r = rng(Math.round(cx + cz * 7));
      const walls = [C('#9c6a40'), C('#b07a4c'), C('#8a5a36'), C('#c49060'), C('#e8c48a')];
      const glow: number[] = [];
      let n = 0;
      for (const [x, z, wx, wz] of shore) {
        // (wx, wz) : vers l'eau. La maison avance au-dessus de l'eau, l'échelle côté terre.
        if (r() < 0.2) continue;
        const px = x + wx * 3;
        const pz = z + wz * 3;
        const land = c.probe.heightAt(x - wx * 3, z - wz * 3);
        if (!Number.isFinite(land)) continue;
        if (!c.probe.read(x - wx * 4, z - wz * 4) || c.probe.road > 0.02 || c.probe.buildingNear(px, pz, 6)) continue;
        const y = Math.max(waterY ?? c.probe.heightAt(px, pz), land - 1.6);
        const yaw = yawOf(-wx, -wz);
        c.mesh.put(K.stilt, px, y, pz, yaw, 1, 1, 1, walls[n % walls.length]!);
        glow.push(px - wx * 3.3 + wz * 1.5, y + 4.6, pz - wz * 3.3 - wx * 1.5);
        if (n % 3 === 0) c.spots.push({ kind: r() < 0.5 ? 'fisher' : 'villager', x: px + wx * 2.6, y: y + 2.75, z: pz + wz * 2.6, yaw: yawOf(wx, wz), seed: r() });
        n++;
        if (n % 6 === 0) yield;
      }
      lanternGlow(c, glow, `rizieres-lanternes-${id}`);
    },
  };
}

/** Rive d'une rivière : points de la berge (gauche ou droite) tous les ~18 m, avec la direction de l'eau. */
function riverShore(path: ReadonlyArray<readonly [number, number]>, i0: number, i1: number, half: number, side: 1 | -1): Array<[number, number, number, number]> {
  const out: Array<[number, number, number, number]> = [];
  for (let i = i0; i < i1; i++) {
    const [ax, az] = path[i]!;
    const [bx, bz] = path[i + 1]!;
    const l = Math.hypot(bx - ax, bz - az) || 1;
    const nx = (-(bz - az) / l) * side;
    const nz = ((bx - ax) / l) * side;
    for (let s = 0; s < 3; s++) {
      const t = s / 3;
      const x = ax + (bx - ax) * t;
      const z = az + (bz - az) * t;
      out.push([x + nx * half, z + nz * half, -nx, -nz]);
    }
  }
  return out;
}

/** Rive d'un lac (ellipse tournée) entre deux angles. */
function lakeShore(L: { x: number; z: number; rx: number; rz: number; rot: number }, a0: number, a1: number, n: number, e = 1.0): Array<[number, number, number, number]> {
  const out: Array<[number, number, number, number]> = [];
  for (let i = 0; i <= n; i++) {
    const a = a0 + ((a1 - a0) * i) / n;
    const ex = Math.cos(a) * L.rx * e;
    const ez = Math.sin(a) * L.rz * e;
    const x = L.x + ex * Math.cos(L.rot) - ez * Math.sin(L.rot);
    const z = L.z + ex * Math.sin(L.rot) + ez * Math.cos(L.rot);
    const d = Math.hypot(x - L.x, z - L.z) || 1;
    out.push([x, z, (L.x - x) / d, (L.z - z) / d]);
  }
  return out;
}

/** Marché flottant sur le Grand Fleuve : barques chargées amarrées en grappe, marchandes, lanternes la nuit. */
function floatingMarket(k: () => Kit): Site {
  const i0 = FLEUVE_MARKET - 5;
  const i1 = FLEUVE_MARKET + 5;
  const [x0, z0] = FLEUVE[(i0 + i1) >> 1]!;
  return {
    id: 'marche-flottant',
    x: x0,
    z: z0,
    reach: 1200,
    needs: [FLEUVE[i0]!, FLEUVE[i1]!, [x0, z0]],
    *build(c) {
      const K = k();
      const r = rng(9090);
      const hulls = [C('#6a4428'), C('#7a5032'), C('#5a3a22'), C('#8a5a36')];
      const goods = [C('#f4a62a'), C('#e2604f'), C('#f4d35e'), C('#ef8fb0')];
      const glow: number[] = [];
      for (let i = i0; i < i1; i++) {
        const [ax, az] = FLEUVE[i]!;
        const [bx, bz] = FLEUVE[i + 1]!;
        const l = Math.hypot(bx - ax, bz - az) || 1;
        const dx = (bx - ax) / l;
        const dz = (bz - az) / l;
        for (let b = 0; b < 4; b++) {
          const t = r();
          const w = (r() - 0.5) * 18;
          const x = ax + (bx - ax) * t - dz * w;
          const z = az + (bz - az) * t + dx * w;
          const y = c.probe.heightAt(x, z) - 0.06;
          if (!Number.isFinite(y)) continue;
          const yaw = yawOf(dx, dz) + (r() - 0.5) * 0.6 + (r() < 0.5 ? Math.PI : 0);
          c.mesh.put(K.sampan, x, y, z, yaw, 1, 1, 1, hulls[b % 4]!);
          c.mesh.put(K.goods, x, y + 0.66, z, yaw, 1, 1, 1, goods[(i + b) % 4]!);
          c.spots.push({ kind: 'villager', x: x - Math.sin(yaw) * 1.6, y: y + 0.4, z: z - Math.cos(yaw) * 1.6, yaw: yaw + Math.PI / 2, seed: r() });
          glow.push(x + Math.sin(yaw) * 2.2, y + 2.4, z + Math.cos(yaw) * 2.2);
        }
        if ((i & 1) === 0) yield;
      }
      lanternGlow(c, glow, 'rizieres-lanternes-marche-flottant', 0.4);
    },
  };
}

/** Barques qui remontent et descendent un tronçon de rivière (va-et-vient, au fil de l'eau). */
function riverBoats(k: () => Kit, id: string, path: ReadonlyArray<readonly [number, number]>, count: number, speed: number): Site {
  const mid = path[path.length >> 1]!;
  return {
    id,
    x: mid[0],
    z: mid[1],
    reach: 2400,
    needs: [path[0]!, mid, path[path.length - 1]!],
    *build(c) {
      const K = k();
      yield;
      // Profil de l'eau : le sol au fil de l'eau, jamais en remontant vers l'aval.
      const ys: number[] = [];
      let prev = Infinity;
      for (const [x, z] of path) {
        const g = c.probe.heightAt(x, z);
        const y = Number.isFinite(g) ? Math.min(prev, g - 0.06) : prev;
        ys.push(y);
        prev = y;
      }
      const L: number[] = [0];
      for (let i = 1; i < path.length; i++) L.push(L[i - 1]! + Math.hypot(path[i]![0] - path[i - 1]![0], path[i]![1] - path[i - 1]![1]));
      const total = L[L.length - 1]!;
      if (!(total > 50) || !ys.every(Number.isFinite)) return;
      const at = (s: number): [number, number, number, number, number] => {
        let i = 1;
        while (i < L.length - 1 && L[i]! < s) i++;
        const t = (s - L[i - 1]!) / Math.max(1e-6, L[i]! - L[i - 1]!);
        const [ax, az] = path[i - 1]!;
        const [bx, bz] = path[i]!;
        return [ax + (bx - ax) * t, ys[i - 1]! + (ys[i]! - ys[i - 1]!) * t, az + (bz - az) * t, bx - ax, bz - az];
      };
      const hulls = ['#6a4428', '#c0392b', '#2f8fb5', '#7a5032'];
      for (let b = 0; b < count; b++) {
        const g = new THREE.Group();
        g.name = 'rizieres-barque';
        g.add(meshOf([{ t: K.sampan, x: 0, y: 0, z: 0, c: C(hulls[b % hulls.length]!) }, { t: K.vendor, x: 0, y: 0.6, z: -2.4, c: C(['#2fb7a8', '#f4d35e', '#ffffff'][b % 3]!) }], c.mat));
        const lane = (b % 2 ? 1 : -1) * 4;
        const phase = (b / count) * 2;
        c.moving.push({
          object: g,
          step: (time) => {
            // Va-et-vient : montée puis descente du tronçon, un aller en total / speed secondes.
            const q = ((time * speed) / total + phase) % 2;
            const up = q < 1;
            const s = (up ? q : 2 - q) * total;
            const [x, y, z, dx, dz] = at(Math.max(1, Math.min(total - 1, s)));
            const l = Math.hypot(dx, dz) || 1;
            const side = up ? lane : -lane;
            g.position.set(x - (dz / l) * side, y + Math.sin(time * 1.4 + b) * 0.05, z + (dx / l) * side);
            g.rotation.set(0, yawOf(dx, dz) + (up ? 0 : Math.PI), Math.sin(time * 1.1 + b) * 0.03);
          },
        });
      }
    },
  };
}

/** Pont suspendu : pylônes aux deux culées, câbles porteurs et suspentes, garde-corps de corde (sur une route ou en passerelle). */
function suspension(k: () => Kit, B: (typeof SUSPENSION)[number], deck: boolean): Site {
  const ux = Math.cos(B.cap);
  const uz = Math.sin(B.cap);
  const half = B.span / 2;
  return {
    id: B.id,
    x: B.x,
    z: B.z,
    reach: 800,
    needs: [[B.x - ux * (half + 6), B.z - uz * (half + 6)], [B.x + ux * (half + 6), B.z + uz * (half + 6)]],
    *build(c) {
      const K = k();
      const ends = [-1, 1].map((s) => {
        const x = B.x + ux * (half + 2) * s;
        const z = B.z + uz * (half + 2) * s;
        return [x, c.probe.heightAt(x, z), z] as [number, number, number];
      });
      if (!ends.every((e) => Number.isFinite(e[1]))) return;
      // Repère du pont : x local en travers (mâts de part et d'autre), z local le long du tablier.
      const yaw = yawOf(ux, uz);
      const width = deck ? 1.8 : 9;
      for (const [x, y, z] of ends) c.mesh.put(K.tower, x, y, z, yaw, width / 2 / 2.6, 1, 1, WHITE);
      yield;
      const px = -uz;
      const pz = ux;
      const y0 = ends[0]![1];
      const y1 = ends[1]![1];
      // Tablier (passerelle seulement : sur une route, la chaussée sert de tablier).
      const n = Math.max(8, Math.round(B.span / 0.4));
      for (let i = 0; i <= n; i++) {
        const t = i / n;
        const sag = deck ? Math.sin(t * Math.PI) * 1.2 : 0;
        const x = ends[0]![0] + (ends[1]![0] - ends[0]![0]) * t;
        const z = ends[0]![2] + (ends[1]![2] - ends[0]![2]) * t;
        const y = y0 + (y1 - y0) * t - sag + 0.3;
        if (deck) c.mesh.put(K.plank, x, y, z, yaw, 1, 1, 1, C(i % 3 ? '#ffffff' : '#d8c8a8'));
      }
      // Câbles porteurs (chaînette de 18 segments) et main courante, de chaque côté.
      const seg = 18;
      for (const side of [-1, 1]) {
        const off = side * (width / 2 + 0.05);
        for (const [top, sagK] of [[7.5, 3.2], [1.1, deck ? 1.2 : 0]] as const)
          for (let i = 0; i < seg; i++) {
            const t0 = i / seg;
            const t1 = (i + 1) / seg;
            const P = (t: number): [number, number, number] => [ends[0]![0] + (ends[1]![0] - ends[0]![0]) * t + px * off, y0 + (y1 - y0) * t + top - Math.sin(t * Math.PI) * sagK + (top > 5 ? 0 : 0.3), ends[0]![2] + (ends[1]![2] - ends[0]![2]) * t + pz * off];
            const [ax, ay, az] = P(t0);
            const [bx, by, bz] = P(t1);
            const dx = bx - ax;
            const dy = by - ay;
            const dz = bz - az;
            const L = Math.hypot(dx, dy, dz);
            const h = Math.hypot(dx, dz) || 1;
            c.mesh.putBasis(K.rope, ax, ay, az, (dz / h) * 1, 0, -(dx / h) * 1, (-dy * dx) / (L * h), h / L, (-dy * dz) / (L * h), dx, dy, dz, 0.42, 0.32, 0.21);
            // Suspentes.
            if (top > 5 && i > 0) {
              const ly = y0 + (y1 - y0) * t0 + 1.1 - (deck ? Math.sin(t0 * Math.PI) * 1.2 : 0) + 0.3;
              const len = ay - ly;
              if (len > 0.3) c.mesh.putBasis(K.rope, ax, ly, az, 1, 0, 0, 0, 0, 1, 0, len, 0, 0.42, 0.32, 0.21);
            }
          }
      }
      // Promeneurs arrêtés au milieu de la passerelle, qui regardent la rivière.
      if (deck)
        for (const t of [0.42, 0.58]) {
          const x = ends[0]![0] + (ends[1]![0] - ends[0]![0]) * t;
          const z = ends[0]![2] + (ends[1]![2] - ends[0]![2]) * t;
          const y = y0 + (y1 - y0) * t - Math.sin(t * Math.PI) * 1.2 + 0.34;
          c.spots.push({ kind: 'villager', x, y, z, yaw: yawOf(px, pz) * (t < 0.5 ? 1 : -1), seed: t });
        }
    },
  };
}

/** Buffles d'eau : troupeau qui paît dans les rizières, un ou deux qui avancent lentement, le bouvier. */
function herd(k: () => Kit, i: number): Site {
  const [x0, z0] = HERDS[i]!;
  return {
    id: `buffles-${i}`,
    x: x0,
    z: z0,
    reach: 900,
    needs: [[x0, z0]],
    *build(c) {
      const K = k();
      const r = rng(5200 + i);
      const tints = [C('#ffffff'), C('#d9d4cc'), C('#b8b0a8')];
      const pts: Array<[number, number, number]> = [];
      for (let j = 0; j < 40 && pts.length < 6; j++) {
        const x = x0 + (r() - 0.5) * 160;
        const z = z0 + (r() - 0.5) * 160;
        const p = c.probe;
        if (!p.read(x, z) || p.road > 0.02 || p.forest > 0.4 || p.urban > 0.3 || p.buildingNear(x, z, 4)) continue;
        const y = p.heightAt(x, z);
        if (Number.isFinite(y)) pts.push([x, y, z]);
      }
      if (!pts.length) return;
      pts.forEach(([x, y, z], j) => {
        if (j < pts.length - 2) c.mesh.put(K.buffalo, x, y - (r() < 0.4 ? 0.35 : 0), z, r() * 6.28, 1, 1, 1, tints[j % 3]!);
      });
      // Deux buffles qui marchent au pas, aller-retour sur une diguette.
      for (const [x, y, z] of pts.slice(-2)) {
        const m = meshOf([{ t: K.buffalo, x: 0, y: 0, z: 0 }], c.mat);
        m.name = 'rizieres-buffle';
        const a = r() * 6.28;
        const dx = Math.sin(a);
        const dz = Math.cos(a);
        const ph = r() * 100;
        c.moving.push({
          object: m,
          step: (time) => {
            const q = ((time + ph) / 90) % 2;
            const s = (q < 1 ? q : 2 - q) * 30 - 15;
            m.position.set(x + dx * s, y + Math.abs(Math.sin(time * 2.2)) * 0.04, z + dz * s);
            m.rotation.y = a + (q < 1 ? 0 : Math.PI);
          },
        });
      }
      const [bx, by, bz] = pts[0]!;
      c.spots.push({ kind: 'villager', x: bx + 3, y: by, z: bz + 2, yaw: r() * 6.28, seed: r() });
      // Hérons garde-bœufs posés près du troupeau.
      c.perches.push({ pts: new Float32Array(pts.flatMap(([x, y, z]) => [x + 1.8, y, z + 1.2])), yaw: r() * 6.28, ground: true, x: bx, z: bz });
    },
  };
}

/** Cocotiers le long d'une plage (sur le sable, jamais sur une route ni un bâtiment). */
function palms(k: () => Kit, id: string, line: ReadonlyArray<readonly [number, number]>, every: number): Site {
  const mid = line[line.length >> 1]!;
  return {
    id,
    x: mid[0],
    z: mid[1],
    reach: 1600,
    needs: [line[0]!, mid, line[line.length - 1]!],
    *build(c) {
      const K = k();
      const r = rng(Math.round(mid[0] * 7 + mid[1]));
      for (let i = 0; i + 1 < line.length; i++) {
        const [ax, az] = line[i]!;
        const [bx, bz] = line[i + 1]!;
        const L = Math.hypot(bx - ax, bz - az);
        for (let s = 0; s < L; s += every * (0.6 + r() * 0.8)) {
          const t = s / L;
          const x = ax + (bx - ax) * t + (r() - 0.5) * 20;
          const z = az + (bz - az) * t + (r() - 0.5) * 20;
          const p = c.probe;
          if (!p.read(x, z) || p.road > 0.02 || p.water > 0.2 || p.buildingNear(x, z, 3)) continue;
          const y = p.heightAt(x, z);
          if (!Number.isFinite(y) || y < 0.3) continue;
          const sc = 0.8 + r() * 0.5;
          c.mesh.put(K.palm, x, y, z, r() * 6.28, sc, sc, sc, C(r() < 0.5 ? '#ffffff' : '#d8e8a8'));
        }
        if (i % 6 === 5) yield;
      }
    },
  };
}

/** Bosquet de bambous. */
function bambooGrove(k: () => Kit, i: number): Site {
  const [x0, z0] = BAMBOO[i]!;
  return {
    id: `bambous-${i}`,
    x: x0,
    z: z0,
    reach: 700,
    needs: [[x0, z0]],
    *build(c) {
      const K = k();
      const r = rng(6100 + i);
      for (let j = 0; j < 22; j++) {
        const x = x0 + (r() - 0.5) * 120;
        const z = z0 + (r() - 0.5) * 120;
        const p = c.probe;
        if (!p.read(x, z) || p.road > 0.02 || p.water > 0.2 || p.buildingNear(x, z, 3)) continue;
        const y = p.heightAt(x, z);
        if (!Number.isFinite(y)) continue;
        const sc = 0.8 + r() * 0.5;
        c.mesh.put(K.bamboo, x, y, z, r() * 6.28, sc, sc, sc, C(r() < 0.5 ? '#ffffff' : '#c8dc90'));
      }
    },
  };
}

/** Cascade : falaise calcaire, nappe d'eau qui tombe (bandes animées), vasque turquoise, embruns. */
function waterfall(k: () => Kit, F: (typeof FALLS)[number]): Site {
  return {
    id: F.id,
    x: F.x,
    z: F.z,
    reach: 1000,
    needs: [[F.x, F.z]],
    *build(c) {
      const K = k();
      const q = freeSpot(c, F.x, F.z, 14, 120, 0.05);
      if (!q) return;
      const [x, y, z] = q;
      // Falaise tournée dos à la route la plus proche (on voit la chute depuis la chaussée).
      let yaw = 0;
      let best = Infinity;
      const segs = segmentsIn(c.probe, x - 120, z - 120, x + 120, z + 120, 'roads');
      for (let i = 0; i + 4 < segs.length; i += 5) {
        const mx = (segs[i]! + segs[i + 2]!) / 2;
        const mz = (segs[i + 1]! + segs[i + 3]!) / 2;
        const d = Math.hypot(mx - x, mz - z);
        if (d < best) {
          best = d;
          yaw = yawOf(mx - x, mz - z);
        }
      }
      const H = F.h;
      const rock = template([
        part(box(16, H, 7, 0, H / 2, -3.5), '#a3a39a'),
        part(new THREE.IcosahedronGeometry(1, 0).scale(8, H * 0.55, 6).translate(-9, H * 0.45, -3), '#9a9a90'),
        part(new THREE.IcosahedronGeometry(1, 0).scale(8, H * 0.5, 6).translate(9, H * 0.42, -3.5), '#8a8a80'),
        part(new THREE.IcosahedronGeometry(1, 0).scale(10, 2.5, 6).translate(0, H, -4), '#2e5e2a'),
        part(new THREE.IcosahedronGeometry(1, 0).scale(6, 3, 4).translate(-8, H * 0.9, -1), '#3f6a2a'),
      ]);
      c.mesh.put(rock, x, y - 0.5, z, yaw, 1, 1, 1, WHITE);
      c.mesh.put(K.pool, x + Math.sin(yaw) * 5, y, z + Math.cos(yaw) * 5, 0, 1, 1, 1, WHITE);
      c.mesh.put(K.cliff, x + Math.sin(yaw) * 5, y - 0.2, z + Math.cos(yaw) * 5, yaw, 1, 0.4, 1, WHITE);
      yield;
      // Nappe : trois bandes blanches qui défilent (déplacement vertical périodique), embruns au pied.
      const g = new THREE.Group();
      g.name = 'rizieres-cascade';
      g.position.set(x + Math.sin(yaw) * 0.2, y, z + Math.cos(yaw) * 0.2);
      g.rotation.y = yaw;
      const mat = new THREE.MeshBasicNodeMaterial({ color: '#e8fbff', transparent: true, opacity: 0.8, depthWrite: false });
      const sheets = [0, 1, 2].map((i) => {
        const m = new THREE.Mesh(new THREE.PlaneGeometry(4.2 - i * 0.6, H * 0.5), mat);
        m.position.set((i - 1) * 0.7, 0, 0.05 + i * 0.02);
        g.add(m);
        return m;
      });
      const mist = new THREE.Mesh(new THREE.IcosahedronGeometry(3, 0).scale(1.6, 0.6, 1), new THREE.MeshBasicNodeMaterial({ color: '#ffffff', transparent: true, opacity: 0.35, depthWrite: false }));
      mist.position.set(0, 1, 4);
      g.add(mist);
      c.moving.push({
        object: g,
        step: (time) => {
          sheets.forEach((m, i) => {
            const f = (time * (0.9 + i * 0.25) + i * 0.33) % 1;
            m.position.y = H * (1 - 0.25 - f * 0.5);
          });
          mist.scale.setScalar(1 + Math.sin(time * 3) * 0.08);
        },
      });
      strollPath(c, [[x + Math.sin(yaw) * 14 - Math.cos(yaw) * 8, z + Math.cos(yaw) * 14 + Math.sin(yaw) * 8], [x + Math.sin(yaw) * 14 + Math.cos(yaw) * 8, z + Math.cos(yaw) * 14 - Math.sin(yaw) * 8], [x + Math.sin(yaw) * 14 - Math.cos(yaw) * 8, z + Math.cos(yaw) * 14 + Math.sin(yaw) * 8]], Math.round(x));
    },
  };
}

/** Bike park de la jungle : portique de départ, bosses de terre rouge le long des pistes, banderoles. */
function bikePark(k: () => Kit): Site {
  const [x0, z0] = BIKE_PARK;
  return {
    id: 'bike-park',
    x: x0,
    z: z0,
    reach: 900,
    needs: [[x0, z0], [x0 - 300, z0], [x0 + 300, z0]],
    *build(c) {
      const K = k();
      const r = rng(8484);
      let placed = 0;
      for (const t of c.probe.tilesIn(x0 - 600, z0 - 500, x0 + 600, z0 + 500))
        for (const road of t.features.roads) {
          if (road.kind !== 'track' || road.width > 2.8) continue;
          const p = road.pts;
          for (let j = 4; j + 3 < p.length; j += 18) {
            const x = p[j]!;
            const z = p[j + 1]!;
            if (Math.hypot(x - x0, z - z0) > 560) continue;
            const l = Math.hypot(p[j + 2]! - p[j - 2]!, p[j + 3]! - p[j - 1]!) || 1;
            const nx = -(p[j + 3]! - p[j - 1]!) / l;
            const nz = (p[j + 2]! - p[j - 2]!) / l;
            const s = r() < 0.5 ? 1 : -1;
            const y = c.probe.heightAt(x + nx * 3.2 * s, z + nz * 3.2 * s);
            if (!Number.isFinite(y)) continue;
            c.mesh.put(r() < 0.3 ? K.banner : K.jump, x + nx * 3.4 * s, y - 0.1, z + nz * 3.4 * s, yawOf(nx, nz), 1, 1, 1, C(['#e2604f', '#f4d35e', '#2fb7a8'][placed % 3]!));
            placed++;
          }
        }
      yield;
      const q = freeSpot(c, x0, z0, 5);
      if (q) c.mesh.put(K.start, q[0], q[1], q[2], 0, 1, 1, 1, WHITE);
      for (let i = 0; i < 6; i++) {
        const s = freeSpot(c, x0 + (r() - 0.5) * 60, z0 + (r() - 0.5) * 60, 1.5, 8);
        if (s) c.spots.push({ kind: 'villager', x: s[0], y: s[1], z: s[2], yaw: r() * 6.28, seed: r() });
      }
    },
  };
}

/** Cyclo-cross des Digues : piquets et rubalise le long du circuit, banderoles, spectateurs. */
function cycloCross(k: () => Kit): Site {
  const [x0, z0] = CYCLO_CROSS;
  return {
    id: 'cyclo-cross',
    x: x0,
    z: z0,
    reach: 900,
    needs: [[x0, z0], [x0 - 450, z0], [x0 + 450, z0]],
    *build(c) {
      const K = k();
      const r = rng(4646);
      for (const t of c.probe.tilesIn(x0 - 600, z0 - 500, x0 + 600, z0 + 500))
        for (const road of t.features.roads) {
          if (road.kind !== 'track') continue;
          const p = road.pts;
          for (let j = 2; j + 3 < p.length; j += 6) {
            const x = p[j]!;
            const z = p[j + 1]!;
            if (Math.hypot((x - x0) / 1.3, z - z0) > 480) continue;
            const l = Math.hypot(p[j + 2]! - p[j - 2]!, p[j + 3]! - p[j - 1]!) || 1;
            const dx = (p[j + 2]! - p[j - 2]!) / l;
            const dz = (p[j + 3]! - p[j - 1]!) / l;
            for (const s of [-1, 1]) {
              const px = x - dz * (road.width / 2 + 1.2) * s;
              const pz = z + dx * (road.width / 2 + 1.2) * s;
              const y = c.probe.heightAt(px, pz);
              if (Number.isFinite(y)) c.mesh.put(K.stake, px, y, pz, yawOf(dx, dz) + Math.PI / 2, 1, 1, 1, C(j % 12 ? '#ffffff' : '#e2604f'));
            }
            if (r() < 0.05) {
              const y = c.probe.heightAt(x - dz * 6, z + dx * 6);
              if (Number.isFinite(y)) {
                c.mesh.put(K.banner, x - dz * 6, y, z + dx * 6, yawOf(-dz, dx), 1, 1, 1, C(['#2fb7a8', '#f4d35e', '#c0392b'][j % 3]!));
                for (let s = 0; s < 4; s++) c.spots.push({ kind: 'villager', x: x - dz * 7.5 + dx * (s - 1.5) * 1.3, y, z: z + dx * 7.5 + dz * (s - 1.5) * 1.3, yaw: yawOf(dz, -dx), seed: r() });
              }
            }
          }
        }
    },
  };
}

/** Marché de nuit de Plage-de-Jade : étals et guirlandes de lanternes entre le boulevard et la promenade. */
function nightMarket(k: () => Kit): Site {
  const line = JADE_BEACH.slice(6, 22);
  const mid = line[line.length >> 1]!;
  return {
    id: 'marche-de-nuit',
    x: mid[0],
    z: mid[1],
    reach: 1000,
    needs: [line[0]!, mid, line[line.length - 1]!],
    *build(c) {
      const K = k();
      const r = rng(1212);
      const glow: number[] = [];
      const tints = [C('#e2604f'), C('#2fb7a8'), C('#f4d35e'), C('#ff8a3d')];
      let last: [number, number, number] | null = null;
      for (let i = 0; i < line.length; i++) {
        const [x, z] = line[i]!;
        // Vers l'intérieur des terres (la ligne suit le rivage à 75 m) : entre la plage et la promenade.
        const q = freeSpot(c, x * 0.9973, z * 0.9973, 2, 10, 0.05);
        if (!q) continue;
        c.mesh.put(K.stall, q[0], q[1], q[2], r() * 0.4 + yawOf(-x, -z), 1, 1, 1, tints[i % 4]!);
        c.spots.push({ kind: 'villager', x: q[0] + 1.5, y: q[1], z: q[2] + 1, yaw: r() * 6.28, seed: r() });
        const top: [number, number, number] = [q[0], q[1] + 3.2, q[2]];
        if (last && Math.hypot(top[0] - last[0], top[2] - last[2]) < 90) garland(c, K, last, top, 10, glow, LANTERN_TINTS);
        last = top;
      }
      lanternGlow(c, glow, 'rizieres-lanternes-plage');
    },
  };
}

/** Lieux des Rizières et de la jungle (lands/rizieres.ts). */
export function rizieresSites(): Site[] {
  let templates: Kit | undefined;
  let harbours: HarbourTemplates | undefined;
  const k = () => (templates ??= kit());
  const h = () => (harbours ??= harbourTemplates());
  // Montée de nuit : tronçons tous les ≈ 800 m, de la Bambouseraie au col de la Jungle puis au Temple des Lanternes.
  const lanterns: Site[] = [];
  let li = 0;
  for (const [[ax, az], [bx, bz]] of [[BAMBOUSERAIE, COL_JUNGLE], [COL_JUNGLE, LANTERN_PEAK]] as const) {
    const n = Math.max(1, Math.round(Math.hypot(bx - ax, bz - az) / 800));
    for (let i = li ? 1 : 0; i <= n; i++) lanterns.push(lanternRoad(k, li++, ax + ((bx - ax) * i) / n, az + ((bz - az) * i) / n));
  }
  return [
    harbourSite('port-jade', PORT_JADE, 750, h),
    harbourSite('port-pitons', PORT_PITONS, 700, h),
    harbourSite('port-jonques', PORT_JONQUES, 700, h),
    circuit(k),
    templeHill(k),
    marketSquare(k),
    summits(k),
    ...lanterns,
    ...RUINS.map((r) => ruin(k, r)),
    floatingMarket(k),
    stiltVillage(k, 'pilotis-du-fleuve-est', riverShore(FLEUVE, FLEUVE_MARKET - 14, FLEUVE_MARKET + 6, 22, 1), null),
    stiltVillage(k, 'pilotis-du-fleuve-ouest', riverShore(FLEUVE, FLEUVE_MARKET - 10, FLEUVE_MARKET + 4, 22, -1), null),
    stiltVillage(k, 'pilotis-des-lotus', lakeShore(LOTUS_LAKE, 1.1, 2.1, 26, 1.01), LOTUS_LAKE.level),
    stiltVillage(k, 'pilotis-des-mangroves', lakeShore(LAGOON, 2.4, 3.4, 22, 1.01), LAGOON.level),
    stiltVillage(k, 'pilotis-du-dragon', riverShore(DRAGON, DRAGON_PONT - 6, DRAGON_PONT + 6, 8, 1), null),
    riverBoats(k, 'barques-du-fleuve', FLEUVE.slice(0, FLEUVE_MARKET + 30), 6, 2.2),
    riverBoats(k, 'barques-du-delta', FLEUVE.slice(FLEUVE_MARKET + 20), 4, 2.6),
    riverBoats(k, 'barques-de-la-lagune', BRAS, 3, 2.4),
    riverBoats(k, 'barques-du-dragon', DRAGON.slice(Math.max(0, DRAGON_PONT - 30), DRAGON.length - 1), 3, 1.8),
    ...SUSPENSION.map((b) => suspension(k, b, false)),
    ...FOOTBRIDGES.map((b) => suspension(k, b, true)),
    ...HERDS.map((_, i) => herd(k, i)),
    palms(k, 'cocotiers-de-jade', JADE_BEACH, 14),
    palms(k, 'cocotiers-des-pitons', PITONS_BEACH, 18),
    ...BAMBOO.map((_, i) => bambooGrove(k, i)),
    ...FALLS.map((f) => waterfall(k, f)),
    bikePark(k),
    cycloCross(k),
    nightMarket(k),
  ];
}

export type { Template };
