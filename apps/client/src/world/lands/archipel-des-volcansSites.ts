import * as THREE from 'three/webgpu';
import { rng } from '../../engine/noise.ts';
import { box, part, prism, template, type MeshBuilder } from '../lowPolyKit.ts';
import { buildHarbour, harbourCorners, harbourTemplates, type HarbourSite, type HarbourTemplates } from '../polyHarbour.ts';
import { islandClock } from '../polyOutdoor.ts';
import { meshOf, strollPath, type Site, type SiteContext } from '../polySites.ts';

/**
 * Décor propre de l'Archipel des volcans (mode Poly, tools/archipel-des-volcans) : panache de fumée du volcan
 * (animé), fumerolles, bassins thermaux d'Aigues-Chaudes, Pont des Orgues (piles, pylônes, haubans) et Chaussée
 * (enrochements, lampadaires), phare des Orgues (feu tournant la nuit), ports et bateaux au large, champs de lave
 * (blocs, dalles cordées, petits cônes), bike park du Mont Cendre, cyclo-cross des Cendres, tribunes du Circuit,
 * dôme de l'observatoire, belvédère du cratère, lampadaires et bancs du front de mer ; gros blocs de lave à facettes
 * en tas le long des bords des coulées et sur les pentes du volcan, orgues de basalte autour du phare.
 * Identité islandaise (27/11/2026) : coulées anciennes couvertes de mousse vert vif (buttes de mousse, blocs
 * moussus), lupins bleu-violet au bord des routes et en prairies, cascades (ruban d'eau, écume et embruns) sur les
 * falaises de la côte, le plateau des Orgues et les rivières, églises blanches à toit rouge et leur enclos, maisons
 * isolées en tôle peinte, aiguilles de basalte au large des plages de sable noir. Même mécanique que les lieux de l'île
 * (polySites.ts) : chaque lieu est construit par pas quand le coureur approche, puis oublié. Cotes : la copie
 * des sorties du générateur dans archipel-des-volcansData.ts.
 */
const WHITE = new THREE.Color(0xffffff);

type P2 = [number, number];
/** Cotes du générateur reprises par le décor (bloc écrit par la mise au point de tools/archipel-des-volcans). */
interface ArchipelData {
  anneau: { cx: number; cz: number; half: number; radius: number };
  volcano: { x: number; z: number; rim: number; lake: number; rimPt: P2 };
  thermes: P2;
  observatory: P2;
  lighthouse: P2;
  cinder: { x: number; z: number };
  cross: { x: number; z: number };
  harbours: Array<{ id: string; x: number; z: number; dir: number; sea: number; halfLen: number; halfWid: number; side: number; lines: number[]; sail: number; fishing: boolean; hulls: string[]; offshore: number }>;
  lava: Array<{ name: string; pts: P2[]; w: number }>;
  /** Fumerolles : x, z, nombre de bouches, étendue (m). */
  fumaroles: Array<[number, number, number, number]>;
  /** Polylignes à plat (x, y, z…). */
  bridge: number[];
  causeway: number[];
  bike: number[][];
  cross3: number[][];
  promenade: number[];
  promenadeSea: number;
  promenadeCentre: P2;
  sableNoirStreet: number[];
}

// ── Cotes du générateur (début) ──
/** Copie des sorties de tools/archipel-des-volcans (dump.ts, graph.json, places.json) : ne pas retoucher à la main. */
const A: ArchipelData = {"anneau":{"cx":-8200,"cz":3300,"half":560,"radius":215},"volcano":{"x":-1500,"z":-2600,"rim":520,"lake":1219.7,"rimPt":[-1203.9,-2138.9]},"thermes":[248,2214],"observatory":[527,-2293.7],"lighthouse":[18472.5,-4166.3],"cinder":{"x":15300,"z":8700},"cross":{"x":-10600,"z":3600},"harbours":[{"id":"port-lave","x":-9426.8,"z":5671.1,"dir":2.6,"sea":2.6,"halfLen":170,"halfWid":75,"side":1,"lines":[-110,-50,10,70],"sail":0.2,"fishing":true,"hulls":["#2d5d8f","#b8432f","#3c7f58","#e2a23a","#f2f0e8"],"offshore":5},{"id":"port-orgues","x":13372.1,"z":-4592.8,"dir":3.262,"sea":-2.3,"halfLen":120,"halfWid":55,"side":-1,"lines":[-70,-20,30],"sail":0.3,"fishing":true,"hulls":["#2f8fb5","#e2593f","#f2f0e8","#2f5f8a","#e7b23c"],"offshore":3},{"id":"port-iris","x":812.9,"z":8928.8,"dir":1.48,"sea":1.48,"halfLen":150,"halfWid":60,"side":1,"lines":[-90,-30,30],"sail":0.6,"fishing":false,"hulls":["#e46b4f","#f3c85a","#3fa7b5","#3d6fb0","#8c6bc8"],"offshore":4}],"lava":[{"name":"La Grande Coulée","pts":[[-2300,-2200],[-5200,-1300],[-8200,-500],[-10800,300],[-12600,700]],"w":420},{"name":"La Coulée du Sud","pts":[[-2000,-1900],[-3900,1400],[-6000,3900],[-7700,5800],[-8600,7200]],"w":340},{"name":"La Coulée du Nord","pts":[[-1500,-3200],[-1900,-5600],[-2300,-7600],[-2600,-9900]],"w":380},{"name":"La Coulée de 1904","pts":[[-900,-3000],[1800,-4400],[3600,-5500]],"w":230}],"fumaroles":[[1700,1300,8,180],[358,2124,5,90],[-1650,-2930,6,140],[-3900,-3300,5,120],[-1120,-2480,4,90]],"bridge":[12324.1,2.08,-3274.7,12354.1,3.81,-3276.1,12386.1,5.36,-3277.6,12416.0,6.57,-3279.0,12448.0,7.63,-3280.6,12478.0,8.45,-3282.2,12509.9,9.14,-3283.9,12541.8,9.68,-3285.8,12571.8,10.08,-3287.8,12601.7,10.37,-3289.8,12631.6,10.59,-3292.1,12663.5,10.76,-3294.6,12693.4,10.86,-3297.2,12723.3,10.93,-3300.0,12753.1,10.97,-3303.0,12783.0,10.99,-3306.2,12814.7,11,-3309.9,12846.5,11,-3313.9,12876.2,11,-3317.8,12906.0,11,-3322.0,12937.6,11,-3326.7,12969.2,11,-3331.7,12998.8,10.99,-3336.6,13028.4,10.97,-3341.7,13059.9,10.93,-3347.4,13091.3,10.87,-3353.3,13120.7,10.78,-3359.1,13150.1,10.64,-3365,13181.5,10.42,-3371.6,13210.8,10.14,-3377.9,13240.1,9.78,-3384.3,13269.4,9.3,-3390.9,13300.6,8.66,-3398.0,13329.8,7.9,-3404.8,13359.0,6.96,-3411.7,13390.1,5.75,-3419.1,13421.2,4.29,-3426.6,13450.4,2.65,-3433.6,13459.8,2.05,-3435.9],"causeway":[9880.0,2.2,6876.9,9920.9,2.29,6909.1,9961.7,2.46,6941.3,10002.5,2.59,6973.5,10041.8,2.6,7004.5,10082.6,2.6,7036.7,10123.4,2.6,7068.9,10162.7,2.6,7099.9,10201.9,2.6,7130.8,10242.7,2.6,7163.1,10283.5,2.6,7195.3,10324.4,2.6,7227.5,10363.6,2.6,7258.4,10404.4,2.6,7290.7,10445.3,2.6,7322.9,10484.5,2.6,7353.8,10523.8,2.6,7384.8,10564.6,2.6,7417.0,10605.4,2.6,7449.2,10646.2,2.6,7481.4,10685.5,2.6,7512.4,10726.3,2.6,7544.6,10767.1,2.6,7576.9,10806.4,2.6,7607.8,10845.6,2.6,7638.8,10886.5,2.6,7671.0,10927.3,2.51,7703.2,10966.5,2.35,7734.2,11007.3,2.21,7766.4,11023.0,2.2,7778.7],"bike":[[16034.2,34.3,9245.7,16016.8,36.9,9226.4,15999.4,40.3,9207.1,15982.5,44.3,9187.3,15971.4,48.9,9164,15961.5,53.9,9140,15949.3,59.5,9117.1,15937.1,65.4,9094.1,15924.9,71.5,9071.2,15915.3,77.4,9047.3,15910.1,82.8,9022.7,15887.9,87.6,9009.5,15863.2,91.9,9002,15838.9,96.3,8993.2,15820.3,100.9,8975.3,15803.2,105.7,8955.8,15784.2,110.6,8938,15767.3,115.2,8918.4,15747.6,119.5,8901.5,15723.9,123.6,8890.9,15700.8,127.4,8879.1,15684.6,130.7,8859.3,15667.4,132.9,8843.3,15653.3,133.7,8864.3,15640.1,133.3,8886.6,15620.9,132.3,8903.7,15600.4,131.3,8919.5,15578.2,130.3,8932.3,15553.8,129.2,8941.5,15530.6,127.6,8953.2,15507.5,125.5,8965.2,15484.5,122.9,8977.1,15461.4,120.1,8989.1,15438.3,117.1,9001.1,15415.3,114.2,9013.1,15392.2,111.5,9025.1,15369.1,109.2,9037.1,15346.5,107.4,9049.9,15323.9,106.4,9062.7,15299.7,106.1,9065.2,15276.4,106,9053.7,15251.9,105.6,9058.3,15228.2,104.6,9069,15203.2,103.1,9076,15178,101.2,9081.9,15154.1,98.9,9092.3,15131.5,96.2,9105.1,15109.7,93.3,9119.2,15087.9,90.3,9133.4,15065.8,87.3,9147,15042.9,84.5,9159.5,15018.4,81.7,9167.9,14993,79.1,9173,14968.6,76.8,9181.9,14944.1,75.2,9186.8,14920.9,74.5,9175.1,14905.2,74.5,9155.3,14888.2,74.6,9137.7,14865.6,74.4,9125,14846.9,73.9,9106.9,14828.1,73.1,9089.1,14804.9,72.2,9077.3,14790,71.5,9069.7],[15190,134.2,8510,15178.4,137.5,8533.3,15186,140.9,8549.9,15212,143.8,8550,15238,145.4,8551.1,15263.8,146.1,8550.4,15289.6,146.2,8547.6,15315.5,146.1,8550,15330,146.1,8550],[15009.2,118.9,8530.4,14998.1,114,8506.9,14981.6,109.4,8490.1,14955.6,105.1,8490,14950,104.3,8490],[14769.6,102.3,8670.7,14758,101,8693.9,14750,99.2,8718.1,14732.6,96.9,8729.8,14730.4,96.8,8729.8],[14770.2,88.5,8830.3,14758.4,84.9,8853.5,14744.7,80.7,8875.3,14727.4,76.6,8894.7,14708.8,73.5,8912.5,14697,71.4,8935.7,14698.2,70.1,8958.2,14708.3,69.6,8970.4],[14708.3,69.6,8970.4,14698,67.8,8994.1,14690,65.7,9018.3,14690.1,63.5,9044.3,14690.2,61.3,9070.1,14687.2,59.1,9095.5,14675.4,57,9118.7,14669.6,56,9130],[14790,74.9,9029.7,14766.6,73.4,9018.2,14744.6,72,9004.8,14725.7,70.6,8987,14708.3,69.6,8970.4]],"cross3":[[-10246,41.6,3652.9,-10252.6,40.8,3677.8,-10268.6,39.7,3698.2,-10289,38.6,3714.2,-10311.5,37.4,3727.1,-10335.1,36.1,3738,-10359.3,34.6,3747.7,-10383.6,33.1,3756.9,-10408,31.6,3765.9,-10432.4,30.2,3774.8,-10457.1,28.9,3782.9,-10482.3,27.7,3789.2,-10508,26.5,3792.8,-10534,25.4,3793.1,-10554.6,24.5,3791],[-10554.6,24.5,3791,-10579.3,23.6,3785.7,-10604.1,22.7,3777.9,-10628.6,22,3769.1,-10653.5,21.2,3762,-10679.4,20.4,3759.5,-10705.3,19.5,3761.2,-10731,18.5,3764.9,-10756.7,17.6,3768.6,-10782.6,16.7,3771.6,-10808.5,15.9,3773.3,-10834.5,15.1,3773.2,-10860.4,14.5,3770.9,-10885.8,13.9,3765.7,-10910.2,13.5,3756.8,-10931.5,13.3,3742.2,-10946.8,13.5,3721.5,-10950.7,13.9,3696.1,-10943.3,14.6,3671.4,-10929.6,15.5,3649.3,-10911.8,16.4,3630.4,-10892.2,17.3,3613.4,-10871.5,18.3,3597.6,-10850.7,19.3,3582,-10832,20.3,3564.1,-10821.7,21.2,3540.5,-10819.9,22,3514.6,-10816.7,22.8,3488.8,-10807,23.7,3464.8,-10790.9,24.9,3444.6,-10770.5,26.2,3428.6,-10747.8,27.5,3415.9,-10739.3,28,3411.9],[-10739.3,28,3411.9,-10714.9,29.4,3401.3,-10690.8,30.7,3391.6,-10666.6,32,3382,-10642.3,33.4,3372.8,-10617.7,34.9,3364.4,-10592.6,36.4,3357.7,-10567,37.9,3353,-10541.1,39.3,3351.3,-10515.2,40.6,3353.4,-10490,41.7,3359.6,-10466.9,42.6,3371.3,-10447.1,43,3387.9,-10432.9,43,3409.6,-10424.6,42.4,3434.1,-10422,41.6,3460,-10423.1,40.6,3485.9,-10423.6,39.8,3511.9,-10410.6,39.7,3533.4,-10387.4,40.3,3544.9,-10363,41.1,3553.9,-10338.7,41.8,3563.3,-10315.1,42.3,3574,-10292.5,42.6,3586.9,-10271.9,42.6,3602.8,-10255.3,42.4,3622.7,-10246.8,41.8,3646.9,-10246,41.6,3652.9]],"promenade":[-1.7,1.88,8471.6,-15.1,1.88,8467.4,-26.6,1.88,8463.9,-38.2,1.88,8460.9,-51.9,1.88,8458.0,-63.7,1.88,8456.0,-77.6,1.88,8454.4,-89.6,1.89,8453.5,-103.5,1.89,8453.0,-115.5,1.89,8452.9,-127.5,1.89,8453.0,-139.6,1.89,8453.3,-153.5,1.89,8453.7,-165.5,1.89,8454,-177.5,1.89,8454.2,-189.5,1.89,8454.3,-201.5,1.9,8454.2,-215.5,1.9,8454.0,-227.5,1.9,8453.5,-241.5,1.9,8452.7,-255.4,1.9,8451.5,-267.4,1.9,8450.0,-281.2,1.9,8447.9,-295.0,1.9,8445.4,-306.7,1.9,8443.0,-320.3,1.9,8439.7,-333.8,1.9,8436.0,-347.2,1.9,8431.9,-360.6,1.9,8427.9,-372.2,1.89,8424.6,-383.8,1.89,8421.8,-397.6,1.89,8419.3,-411.5,1.89,8418.0,-425.5,1.89,8418.2,-439.4,1.89,8420.0,-453.1,1.89,8423.0,-466.4,1.89,8427.3,-477.6,1.89,8431.7,-490.3,1.89,8437.5,-502.8,1.89,8443.8,-515.1,1.89,8450.4,-527.3,1.89,8457.3,-539.5,1.89,8464.3,-549.9,1.89,8470.3,-562.0,1.89,8477.2,-572.4,1.89,8483.2,-584.6,1.89,8490.1,-596.8,1.89,8497.0,-609.0,1.89,8503.9,-621.2,1.9,8510.7,-631.7,1.9,8516.5,-644.3,1.9,8522.7,-655.2,1.9,8527.6,-668.3,1.9,8532.5,-681.8,1.91,8536.2,-693.7,1.91,8538,-705.6,1.91,8538.6,-719.6,1.91,8537.4,-733.2,1.9,8534.3,-746.6,1.9,8530.1,-759.5,1.9,8524.7,-770.4,1.9,8519.7,-783,1.89,8513.6,-793.8,1.89,8508.3,-806.4,1.89,8502.3,-819.2,1.89,8496.5,-832.0,1.89,8490.9,-843.0,1.89,8486.2,-856.0,1.9,8480.8,-868.7,1.9,8475.1,-879.6,1.9,8469.9,-892.1,1.89,8463.7,-904.7,1.89,8457.6,-917.3,1.89,8451.6,-928.5,1.88,8447.2,-940,1.88,8443.8,-953.8,1.88,8441.4,-965.8,1.87,8441.5,-979.6,1.87,8443.7,-991.0,1.87,8447.4,-1003.7,1.87,8453.3,-1013.9,1.87,8459.5,-1025.5,1.87,8467.4,-1036.5,1.88,8476.0,-1047.2,1.88,8485.0,-1056.2,1.88,8493.0,-1066.5,1.88,8502.5,-1076.7,1.89,8512.1,-1085.3,1.89,8520.4,-1094.0,1.89,8528.8,-1104.0,1.89,8538.5,-1112.7,1.89,8546.8,-1122.8,1.89,8556.4,-1131.5,1.88,8564.7,-1141.5,1.88,8574.5,-1150.2,1.88,8582.8,-1158.8,1.88,8591.2,-1168.8,1.88,8600.9,-1178.9,1.88,8610.7,-1187.5,1.89,8619.0,-1196.2,1.89,8627.3,-1205.0,1.89,8635.4,-1215.5,1.89,8644.7,-1226.2,1.89,8653.8,-1237.1,1.89,8662.5,-1246.8,1.89,8669.6,-1256.7,1.89,8676.4,-1268.6,1.89,8683.7,-1279.1,1.89,8689.5,-1291.7,1.89,8695.6,-1304.6,1.89,8701.0,-1315.9,1.88,8705.0,-1329.3,1.88,8709.3,-1340.8,1.88,8712.5,-1354.3,1.87,8716.2,-1367.8,1.87,8720.0,-1379.3,1.87,8723.4,-1392.6,1.87,8727.9,-1405.6,1.86,8733.0,-1416.5,1.86,8737.9,-1429.0,1.86,8744.2,-1441.3,1.86,8751.0,-1453.2,1.86,8758.3,-1463.4,1.87,8764.7,-1475.1,1.87,8772.4,-1485.0,1.87,8779.1,-1496.5,1.87,8787.0,-1506.4,1.87,8793.9,-1517.8,1.87,8802.0,-1527.6,1.87,8808.9,-1537.4,1.87,8815.8,-1548.9,1.87,8823.9,-1558.7,1.87,8830.8,-1570.2,1.87,8838.8,-1580.2,1.87,8845.5,-1591.9,1.87,8853.1,-1602.0,1.87,8859.6,-1613.9,1.87,8866.9,-1624.3,1.87,8872.9,-1636.6,1.87,8879.6,-1649.1,1.87,8885.9,-1659.9,1.87,8891.1,-1672.7,1.87,8896.7,-1685.7,1.87,8902.0,-1696.3,1.87,8906.3],"promenadeSea":1,"promenadeCentre":[-876,8570],"sableNoirStreet":[12900,20.7,8900,12913.7,20.7,8902.1,12925.5,20.7,8903.9,12939.4,20.7,8906.0,12951.2,20.7,8907.7,12965.1,20.7,8909.8,12978.9,20.7,8911.9,12990.8,20.7,8913.7,13004.6,20.7,8915.8,13018.5,20.7,8917.9,13030.3,20.7,8919.7,13042.2,20.7,8921.5,13056.0,20.7,8923.7,13067.9,20.7,8925.6,13081.7,20.7,8928.0,13095.5,20.7,8930.4,13107.3,20.7,8932.5,13121.0,20.7,8935.0,13132.8,20.71,8937.2,13146.6,20.72,8940.0,13158.3,20.74,8942.4,13172.0,20.77,8945.3,13183.7,20.8,8948.0,13197.3,20.85,8951.2,13210.9,20.92,8954.7,13222.5,20.99,8957.8,13236.0,21.08,8961.5,13249.5,21.17,8965.2,13261.1,21.25,8968.4,13274.6,21.32,8972.1,13289,21.4,8976.1]};
// ── Cotes du générateur (fin) ──

/** Circuit des Laves (ANNEAU du générateur). */
export const ARCHIPEL_RING = { x: A.anneau.cx, z: A.anneau.cz, half: A.anneau.half, radius: A.anneau.radius };

// ───────────────────────────── Gabarits

/**
 * Bosselle un polyèdre : chaque sommet est déplacé selon sa position (les faces restent jointives), pour des
 * blocs à grandes facettes irrégulières au lieu de solides réguliers.
 */
function facet(g: THREE.BufferGeometry, seed: number, amt: number): THREE.BufferGeometry {
  const ng = g.index ? g.toNonIndexed() : g;
  const p = ng.getAttribute('position') as THREE.BufferAttribute;
  const h = (x: number, y: number, z: number, k: number) => {
    const s = Math.sin(x * 127.1 + y * 311.7 + z * 74.7 + seed * 13.37 + k * 57.9) * 43758.5453;
    return s - Math.floor(s) - 0.5;
  };
  for (let i = 0; i < p.count; i++) {
    const x = Math.round(p.getX(i) * 1000) / 1000;
    const y = Math.round(p.getY(i) * 1000) / 1000;
    const z = Math.round(p.getZ(i) * 1000) / 1000;
    p.setXYZ(i, x + h(x, y, z, 0) * amt, y + h(x, y, z, 1) * amt, z + h(x, y, z, 2) * amt);
  }
  return ng;
}

/** Orgues de basalte : colonnes hexagonales jointives (rayon 0,55 m), hauteurs données du centre vers le bord. */
function columns(heights: number[]): THREE.BufferGeometry[] {
  const out: THREE.BufferGeometry[] = [];
  const d = 0.97;
  // Centre, premier anneau (6), puis quelques colonnes du second anneau.
  const at: P2[] = [[0, 0]];
  for (let k = 0; k < 6; k++) at.push([Math.sin(Math.PI / 6 + (k * Math.PI) / 3) * d, Math.cos(Math.PI / 6 + (k * Math.PI) / 3) * d]);
  for (let k = 0; k < 6; k++) at.push([Math.sin((k * Math.PI) / 3) * d * Math.sqrt(3), Math.cos((k * Math.PI) / 3) * d * Math.sqrt(3)]);
  heights.forEach((hgt, i) => {
    const [x, z] = at[i]!;
    out.push(part(prism(0.55, 0.55, -0.6, hgt, 6, x, z), i % 3 === 0 ? '#ffffff' : i % 3 === 1 ? '#e2e2e2' : '#f0f0f0', 1));
  });
  return out;
}

/**
 * Toit à deux pans : prisme triangulaire de largeur `w` (débords compris) et de hauteur `h`, faîtage le long de z,
 * posé à la hauteur `y` (bas des pans).
 */
function gable(w: number, h: number, len: number, x: number, y: number, z: number): THREE.BufferGeometry {
  return new THREE.CylinderGeometry(1, 1, len, 3).rotateX(-Math.PI / 2).scale(w / (2 * 0.866), h / 1.5, 1).translate(x, y + h / 3, z);
}

function kit() {
  const rock =(r: number, col: string, sy = 0.7) => part(new THREE.IcosahedronGeometry(r, 0).scale(1, sy, 1.15).translate(0, r * sy * 0.45, 0), col, 1);
  return {
    puff: template([part(new THREE.IcosahedronGeometry(1, 0), '#ffffff', 1)]),
    /** Bouche de fumerolle : croûte de soufre, cailloux, trou sombre. */
    vent: template([
      part(new THREE.CylinderGeometry(2.4, 2.8, 0.12, 9).translate(0, 0.04, 0), '#e7d36a'),
      part(new THREE.CylinderGeometry(1.3, 1.6, 0.16, 7).translate(0.3, 0.08, -0.2), '#f4ecc0'),
      part(new THREE.CylinderGeometry(0.45, 0.5, 0.2, 6).translate(0.2, 0.12, 0), '#2a2422'),
      ...[[1.8, 0.4], [-1.6, 1.1], [0.6, -1.9], [-1.1, -1.4]].map(([x, z], i) => part(new THREE.IcosahedronGeometry(0.35 + i * 0.08, 0).translate(x!, 0.2, z!), '#8d7b4a')),
    ]),
    /** Bloc de lave (teinté). */
    boulder: template([rock(1, '#ffffff')]),
    /** Dalle cordée (pahoehoe), basse et large. */
    slab: template([part(new THREE.CylinderGeometry(2.2, 2.6, 0.45, 7).scale(1.3, 1, 0.8).translate(0, 0.15, 0), '#ffffff', 1), part(new THREE.CylinderGeometry(1.2, 1.6, 0.35, 6).translate(0.6, 0.45, 0.2), '#ffffff', 1)]),
    /** Hornito : petit cône de scories. */
    hornito: template([part(new THREE.CylinderGeometry(0.5, 2.2, 2.6, 7).translate(0, 1.2, 0), '#ffffff', 1), part(new THREE.CylinderGeometry(0.3, 0.45, 0.3, 6).translate(0, 2.55, 0), '#1c1918')]),
    /** Bassin thermal : margelle de pierre (8 × 5 m), eau turquoise laiteuse. */
    pool: template([
      ...[-1, 1].flatMap((s) => [part(box(8.6, 0.5, 0.4, 0, 0.25, s * 2.7), '#cfc6b4'), part(box(0.4, 0.5, 5.8, s * 4.1, 0.25, 0), '#cfc6b4')]),
      part(box(7.8, 0.06, 5, 0, 0.32), '#7fd8d0'),
      part(box(7.4, 0.04, 4.6, 0, 0.36), '#a6e6dc'),
    ]),
    /** Baigneur dans l'eau jusqu'à la poitrine. */
    bather: template([part(box(0.42, 0.42, 0.26, 0, 0.21), '#e0b48f'), part(new THREE.IcosahedronGeometry(0.14, 0).translate(0, 0.58, 0), '#e0b48f'), part(box(0.24, 0.1, 0.22, 0, 0.7), '#3a2a1e')]),
    /** Pile du pont (unité de hauteur : 1 m, posée sur le fond). */
    pier: template([part(box(1.6, 1, 1.6, 0, 0.5), '#b7b1a6')]),
    /** Chevêtre sous le tablier, en travers (x). */
    capBeam: template([part(box(9.4, 1, 1.4, 0, -0.5), '#a59f94')]),
    /** Tranche du tablier (le long de z, unité 1 m). */
    fascia: template([part(box(0.35, 1.1, 1, 0, -0.55, 0.5), '#d8d3c8')]),
    /** Pylône en A du pont haubané : 42 m. */
    pylon: template([
      ...[-1, 1].map((s) => part(box(1.4, 44, 1.6, s * 2.6, 22, 0).rotateZ(-s * 0.075), '#e8e4da')),
      part(box(7.4, 1.6, 1.6, 0, 30), '#e8e4da'),
      part(box(4, 3, 2, 0, 42.5), '#e8e4da'),
      part(box(0.6, 1.2, 0.6, 0, 44.6), '#d2433b'),
    ]),
    cable: template([part(box(0.09, 0.09, 1, 0, 0, 0.5), '#d9d6cc')]),
    lamp: template([part(prism(0.07, 0.06, 0, 6.5, 6), '#5a6066'), part(box(1.1, 0.08, 0.08, 0.5, 6.5), '#5a6066'), part(box(0.5, 0.16, 0.28, 1.0, 6.42), '#f6efd0')]),
    bollard: template([part(prism(0.14, 0.12, 0, 0.8, 6), '#ffffff', 1), part(prism(0.15, 0.15, 0.5, 0.62, 6), '#d2433b')]),
    /** Enrochement de la Chaussée (teinté). */
    riprap: template([rock(1.3, '#ffffff', 0.6)]),
    /** Haut du phare : bandes rouges, galerie, lanterne, coupole (posé sur la tour de 26 m). */
    lightTop: template([
      ...[4, 12, 20].map((y) => part(new THREE.CylinderGeometry(4.25, 4.25, 3, 8).translate(0, y, 0), '#c8352e')),
      part(new THREE.CylinderGeometry(5.2, 5.2, 0.4, 10).translate(0, 26.2, 0), '#2b2f33'),
      ...Array.from({ length: 10 }, (_, i) => part(box(0.1, 1.1, 0.1, Math.cos((i / 10) * Math.PI * 2) * 5, 26.9, Math.sin((i / 10) * Math.PI * 2) * 5), '#2b2f33')),
      part(new THREE.CylinderGeometry(2.4, 2.4, 3.2, 10).translate(0, 28, 0), '#7fa9b8'),
      part(new THREE.CylinderGeometry(0.3, 2.9, 2, 10).translate(0, 30.6, 0), '#c8352e'),
      part(prism(0.08, 0.05, 31.4, 33, 5), '#2b2f33'),
    ]),
    /** Coupole de l'observatoire (posée sur la tour de 12 m) et antenne. */
    dome: template([
      part(new THREE.SphereGeometry(5.6, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2), '#f4f4f0'),
      part(box(1.3, 5, 0.12, 0, 2.8, 4.9).rotateX(-0.5), '#2b2f33'),
      part(prism(5.8, 5.8, -0.6, 0.2, 12), '#d9d6cc'),
    ]),
    antenna: template([part(prism(0.35, 0.12, 0, 16, 4), '#c9c6bc'), ...[5, 9, 13].map((y) => part(box(2.4, 0.12, 0.12, 0, y), '#c9c6bc')), part(box(0.5, 0.5, 0.5, 0, 16.2), '#d2433b')]),
    /** Panneau de belvédère et garde-corps de bois (le long de x, 4 m). */
    sign: template([part(box(0.12, 1.6, 0.12, -0.9, 0.8), '#5d4630'), part(box(0.12, 1.6, 0.12, 0.9, 0.8), '#5d4630'), part(box(2.2, 1.1, 0.1, 0, 1.6).rotateX(-0.35), '#6d5236'), part(box(2, 0.9, 0.04, 0, 1.62, 0.06).rotateX(-0.35), '#e8dcc2')]),
    rail: template([...[-2, 0, 2].map((x) => part(box(0.12, 1.05, 0.12, x, 0.52), '#6d5236')), part(box(4.1, 0.1, 0.1, 0, 1.0), '#8a6a46'), part(box(4.1, 0.08, 0.08, 0, 0.55), '#8a6a46')]),
    bench: template([part(box(1.8, 0.08, 0.45, 0, 0.45), '#8a6a46'), ...[-0.75, 0.75].map((x) => part(box(0.08, 0.45, 0.4, x, 0.22), '#3a3f44')), part(box(1.8, 0.35, 0.06, 0, 0.75, -0.22), '#8a6a46')]),
    /** Bateau de pêche au large (+z : avant). */
    fishingBoat: template([
      part(prism(0.9, 1.4, -0.3, 0.9, 6).scale(1, 1, 3.1), '#ffffff', 1),
      part(prism(1.4, 1.45, 0.9, 1.1, 6).scale(1, 1, 3.1), '#f3efe4'),
      part(box(1.7, 1.6, 1.8, 0, 1.9, -1.4), '#f5f3ea'),
      part(box(1.72, 0.5, 1.4, 0, 2.3, -1.3), '#3e5a66'),
      part(prism(0.06, 0.05, 1.1, 5.6, 6, 0, 1.2), '#d9a441'),
      part(box(0.06, 0.06, 2.6).rotateX(0.6).translate(0, 4.3, 2.2), '#d9a441'),
    ]),
    sailboat: template([
      part(prism(0.7, 1.1, -0.3, 0.7, 5).scale(1, 1, 3.3), '#ffffff', 1),
      part(prism(0.06, 0.04, 0.7, 11, 6, 0, 0.6), '#e9e6dc'),
      part(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 1.4, 0.7), new THREE.Vector3(0, 10.6, 0.7), new THREE.Vector3(0, 1.4, -3.4), new THREE.Vector3(0, 1.4, -3.4), new THREE.Vector3(0, 10.6, 0.7), new THREE.Vector3(0, 1.4, 0.7)]), '#f8f6ee'),
      part(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 1.6, 0.9), new THREE.Vector3(0, 9.8, 0.75), new THREE.Vector3(0, 1.6, 4.6), new THREE.Vector3(0, 1.6, 4.6), new THREE.Vector3(0, 9.8, 0.75), new THREE.Vector3(0, 1.6, 0.9)]), '#ffffff', 1),
    ]),
    /** Gradin de 12 m : six rangs face à −z, dossiers colorés. */
    stand: template([
      ...Array.from({ length: 6 }, (_, i) => part(box(12, 0.45 * (i + 1), 0.95, 0, 0.225 * (i + 1), -2.8 + i * 0.95), i % 2 ? '#c9c4b8' : '#d6d1c4')),
      ...Array.from({ length: 6 }, (_, i) => part(box(11.6, 0.36, 0.1, 0, 0.45 * (i + 1) + 0.2, -2.8 + i * 0.95 + 0.4), '#ffffff', 1)),
      part(box(12.4, 0.22, 7.6, 0, 5.4, -0.4).rotateX(-0.06), '#3a3634'),
      ...[-5.8, 5.8].map((x) => part(prism(0.12, 0.1, 0, 5.4, 6, x, 2.8), '#8f9699')),
    ]),
    arch: template([
      ...[-6, 6].map((x) => part(box(0.7, 6, 0.7, x, 3), '#2b2f33')),
      part(box(13, 1.4, 0.5, 0, 6.2), '#ffffff', 1),
      ...Array.from({ length: 8 }, (_, i) => part(box(1.5, 0.7, 0.52, -5.25 + i * 1.5, 6.2 + (i % 2 ? 0.35 : -0.35)), i % 2 ? '#1b1b1b' : '#f5f5f5')),
    ]),
    flag: template([part(prism(0.05, 0.04, 0, 6, 5), '#e9e6dc'), part(box(0.03, 1, 1.6, 0, 5.4, 0.85), '#ffffff', 1)]),
    /** Piquet et rubalise du cyclo-cross (le long de x, 6 m). */
    tape: template([part(box(0.06, 1, 0.06, 0, 0.5), '#e9e6dc'), part(box(6, 0.06, 0.02, 3, 0.9), '#ffffff', 1)]),
    /** Barnum d'équipe (3 × 3 m). */
    tent: template([...[-1.4, 1.4].flatMap((x) => [-1.4, 1.4].map((z) => part(box(0.07, 2.2, 0.07, x, 1.1, z), '#d9d6cc'))), part(new THREE.ConeGeometry(2.2, 0.9, 4).rotateY(Math.PI / 4).translate(0, 2.65, 0), '#ffffff', 1), part(box(3, 0.4, 0.04, 0, 2.05, 1.45), '#ffffff', 1)]),
    /** Butte de cendre du bike park (saut), et virage relevé en planches (le long de x). */
    mound: template([part(new THREE.CylinderGeometry(1.2, 3.4, 1.6, 8).scale(1.4, 1, 1).translate(0, 0.8, 0), '#2b2725')]),
    berm: template([part(box(6, 1.6, 0.18, 0, 0.8).rotateX(-0.35), '#9a7a58'), ...[-2.8, 0, 2.8].map((x) => part(box(0.15, 1.7, 0.15, x, 0.85, 0.3), '#6d5236'))]),
    hut: template([part(box(5, 3, 4, 0, 1.5), '#e9e6dc'), part(new THREE.ConeGeometry(4, 1.6, 4).rotateY(Math.PI / 4).scale(1, 1, 0.85).translate(0, 3.8, 0), '#c8352e'), part(box(1.2, 2, 0.06, 0, 1, 2.02), '#5d4630')]),
    /** Gros bloc de lave à grandes facettes (teinté), ≈ 2,4 × 1,5 × 2 m à l'échelle 1. */
    lavaBlock: template([part(facet(new THREE.DodecahedronGeometry(1, 0).scale(1.2, 0.75, 1), 3, 0.38).translate(0, 0.5, 0), '#ffffff', 1)]),
    /** Tas de blocs : un gros, trois au pied, un perché dessus. */
    lavaHeap: template([
      part(facet(new THREE.DodecahedronGeometry(1.1, 0).scale(1.2, 0.8, 1), 5, 0.4).translate(0, 0.6, 0), '#ffffff', 1),
      part(facet(new THREE.IcosahedronGeometry(0.7, 0), 6, 0.3).translate(1.35, 0.35, 0.4), '#ffffff', 1),
      part(facet(new THREE.IcosahedronGeometry(0.55, 0), 7, 0.25).translate(-1.15, 0.3, 0.7), '#e8e8e8', 1),
      part(facet(new THREE.IcosahedronGeometry(0.45, 0), 8, 0.2).translate(0.2, 0.25, -1.3), '#f4f4f4', 1),
      part(facet(new THREE.IcosahedronGeometry(0.5, 0).scale(1.2, 0.8, 1), 9, 0.25).translate(0.35, 1.3, 0.15), '#dcdcdc', 1),
    ]),
    /** Vieux bloc des basses pentes : lave teintée, dessus couvert de mousse et de fougères rases. */
    lavaMoss: template([
      part(facet(new THREE.DodecahedronGeometry(1, 0).scale(1.2, 0.75, 1), 11, 0.38).translate(0, 0.5, 0), '#ffffff', 1),
      part(facet(new THREE.IcosahedronGeometry(1, 0).scale(1.15, 0.26, 0.95), 12, 0.15).translate(0.05, 1.08, 0), '#7ea544'),
    ]),
    /** Butte de mousse des vieilles coulées (teintée), ≈ 2,6 × 0,9 × 2,2 m à l'échelle 1. */
    hummock: template([part(facet(new THREE.IcosahedronGeometry(1, 0).scale(1.3, 0.45, 1.1), 13, 0.22).translate(0, 0.12, 0), '#ffffff', 1)]),
    /** Dalle cordée sous la mousse : lave sombre, coussin de mousse dessus. */
    slabMoss: template([
      part(new THREE.CylinderGeometry(2.2, 2.6, 0.45, 7).scale(1.3, 1, 0.8).translate(0, 0.15, 0), '#ffffff', 1),
      part(facet(new THREE.IcosahedronGeometry(1, 0).scale(2.3, 0.3, 1.5), 14, 0.2).translate(0.2, 0.42, 0.1), '#86ab47'),
    ]),
    /** Orgues de basalte : faisceau de colonnes en gradins (≈ 5 m au centre). */
    organ: template(columns([5.2, 4.4, 3.6, 4.8, 2.9, 3.9, 3.3, 1.9, 2.4, 1.4, 2.1, 1.2, 1.7])),
    /** Pavé de colonnes rases, comme une chaussée de géants. */
    organLow: template(columns([1.1, 0.8, 1.3, 0.6, 0.9, 0.5, 1.0])),
    /** Touffe de lupins : feuilles en rosette et trois épis (teintés bleu-violet). */
    tuft: template([
      part(new THREE.OctahedronGeometry(0.42, 0).scale(1, 0.35, 1).translate(0, 0.12, 0), '#4f7a35'),
      ...([[0, 0, 0.95], [0.22, 0.12, 0.75], [-0.18, -0.16, 0.82]] as const).flatMap(([x, z, h]) => [
        part(prism(0.025, 0.02, 0, h * 0.55, 3, x, z), '#4a7334'),
        part(new THREE.ConeGeometry(0.09, h * 0.5, 4).translate(x, h * 0.8, z), '#ffffff', 1),
      ]),
    ]),
    /** Grande touffe de lupins : rosette large et six épis. */
    bush: template([
      part(new THREE.IcosahedronGeometry(0.7, 0).scale(1.2, 0.4, 1.1).translate(0, 0.2, 0), '#4b7633'),
      ...Array.from({ length: 6 }, (_, i) => {
        const a = i * 1.05 + 0.4;
        const d = i ? 0.45 : 0;
        const h = 0.9 + ((i * 37) % 5) * 0.08;
        return [part(prism(0.03, 0.02, 0, h * 0.55, 3, Math.cos(a) * d, Math.sin(a) * d), '#4a7334'), part(new THREE.ConeGeometry(0.1, h * 0.5, 4).translate(Math.cos(a) * d, h * 0.8, Math.sin(a) * d), '#ffffff', 1)];
      }).flat(),
    ]),
    /** Église blanche à toit rouge (nef le long de z, clocher et porte en +z) : ≈ 6 × 15 m, flèche à 14 m. */
    church: template([
      part(box(6, 4.6, 11, 0, 2.3, -1), '#f6f5f0'),
      part(gable(6.8, 3.4, 11.6, 0, 4.6, -1), '#b8302a'),
      part(box(3.2, 7.4, 3.2, 0, 3.7, 6), '#f6f5f0'),
      part(new THREE.ConeGeometry(2.4, 5.6, 4).rotateY(Math.PI / 4).translate(0, 7.4 + 2.8, 6), '#b8302a'),
      part(box(0.12, 1.4, 0.12, 0, 13.7, 6), '#2b2f33'),
      part(box(0.8, 0.12, 0.12, 0, 13.9, 6), '#2b2f33'),
      part(box(1.3, 2.3, 0.08, 0, 1.15, 7.63), '#5a2f28'),
      part(box(0.8, 1, 0.06, 0, 5.6, 7.62), '#3e4b55'),
      ...[-1, 1].flatMap((sd) => [-4.5, -1, 2.5].map((zz) => part(box(0.06, 1.5, 0.9, sd * 3.02, 2.6, zz), '#3e4b55'))),
      part(box(3.6, 0.3, 3.6, 0, 0.15, 6), '#d9d6cc'),
    ]),
    /** Enclos de l'église (20 × 26 m, entrée en +z) : muret blanc, croix et stèles. */
    churchyard: template([
      part(box(20, 0.8, 0.4, 0, 0.4, -13), '#e9e7e0'),
      part(box(0.4, 0.8, 26, -10, 0.4, 0), '#e9e7e0'),
      part(box(0.4, 0.8, 26, 10, 0.4, 0), '#e9e7e0'),
      part(box(7.5, 0.8, 0.4, -6.25, 0.4, 13), '#e9e7e0'),
      part(box(7.5, 0.8, 0.4, 6.25, 0.4, 13), '#e9e7e0'),
      ...Array.from({ length: 10 }, (_, i) => {
        const gx = -7 + (i % 5) * 1.8;
        const gz = -10 + Math.floor(i / 5) * 2.2;
        return i % 2 ? part(box(0.5, 0.7, 0.1, gx, 0.35, gz), '#9a9a96') : part(box(0.08, 0.9, 0.08, gx, 0.45, gz), '#f3f3ef');
      }),
    ]),
    /** Maisons de tôle (murs teintés) à toit rouge, vert ou bleu ardoise : 6 × 8 m, pignons en ±z, porte en +z. */
    tin: (['#b3332b', '#3f6b4b', '#3d5975'] as const).map((roof) =>
      template([
        part(box(6, 3.4, 8, 0, 1.7, 0), '#ffffff', 1),
        part(gable(6.8, 2.6, 8.6, 0, 3.4, 0), roof),
        part(box(0.7, 1.4, 0.7, 1.4, 5.2, -1.6), '#f2f1ec'),
        ...[-1, 1].flatMap((sd) => [-2.2, 0.4, 2.6].map((zz) => part(box(0.06, 1.1, 0.95, sd * 3.02, 1.9, zz), '#2f3a44'))),
        ...[-1, 1].map((sd) => part(box(1, 1, 0.06, sd * 1.4, 4.1, 4.02), '#2f3a44')),
        part(box(1, 2, 0.06, 1.6, 1, 4.03), '#7a3a2a'),
        part(box(6.1, 0.3, 8.1, 0, 0.15, 0), '#3a3735'),
      ]),
    ),
    /** Remise de tôle (teintée), toit à deux pans. */
    tinShed: template([part(box(4, 2.6, 5, 0, 1.3, 0), '#ffffff', 1), part(gable(4.5, 1.4, 5.4, 0, 2.6, 0), '#ffffff', 1), part(box(1.8, 2, 0.06, 0, 1, 2.53), '#2b2b2b')]),
    /** Tronçon de cascade : feuille d'eau d'un mètre (largeur x, longueur y, épaisseur z), teintée. */
    sheet: template([part(box(1, 1, 0.14, 0, 0.5, 0), '#ffffff', 1)]),
    /** Écume au pied d'une cascade. */
    foam: template([
      part(new THREE.IcosahedronGeometry(1, 0).scale(1.4, 0.35, 1.1), '#f4f8f8'),
      ...([[1.1, 0.4], [-1, 0.6], [0.3, -1.1], [-0.6, -0.8]] as const).map(([x, z], i) => part(new THREE.IcosahedronGeometry(0.55 + i * 0.08, 0).scale(1, 0.5, 1).translate(x, 0.1, z), i % 2 ? '#e6f1f3' : '#ffffff')),
    ]),
    /** Vasque au pied d'une cascade (teintée). */
    plunge: template([part(new THREE.CylinderGeometry(1, 1, 0.08, 10), '#ffffff', 1)]),
    /** Aiguille de basalte au large (≈ 20 m, base à y = 0, teintée), coiffe de mousse et de fientes. */
    seaStack: template([
      part(facet(new THREE.CylinderGeometry(3.4, 4.6, 8, 6).translate(0, 4, 0), 21, 0.5), '#ffffff', 1),
      part(facet(new THREE.CylinderGeometry(2.5, 3.3, 7.5, 6).translate(0.3, 11.5, 0.2), 22, 0.45), '#ffffff', 1),
      part(facet(new THREE.CylinderGeometry(1.3, 2.4, 5, 5).translate(0.5, 17.5, 0.1), 23, 0.35), '#ffffff', 1),
      part(new THREE.CylinderGeometry(2.0, 2.2, 0.3, 5).translate(0.5, 19.9, 0.1), '#e8e6dc'),
      part(facet(new THREE.IcosahedronGeometry(1.5, 0).scale(1, 0.35, 1).translate(0.5, 20.2, 0.1), 24, 0.2), '#7f9a52'),
    ]),
    startRamp: template([part(box(3, 0.3, 6, 0, 2.4, 0).rotateX(0.3), '#9a7a58'), part(box(3, 2.5, 2, 0, 1.25, -3), '#6d5236'), ...[-1.4, 1.4].map((x) => part(box(0.1, 1, 6, x, 3.1, 0).rotateX(0.3), '#e9e6dc'))]),
  };
}
type Kit = ReturnType<typeof kit>;

// ───────────────────────────── Outils

/** Points d'une polyligne (x, y, z à plat) : position et cap au point i. */
function along(line: readonly number[], i: number): { x: number; y: number; z: number; dx: number; dz: number } {
  const n = line.length / 3;
  const a = Math.max(0, i - 1);
  const b = Math.min(n - 1, i + 1);
  const dx = line[b * 3]! - line[a * 3]!;
  const dz = line[b * 3 + 2]! - line[a * 3 + 2]!;
  const l = Math.hypot(dx, dz) || 1;
  return { x: line[i * 3]!, y: line[i * 3 + 1]!, z: line[i * 3 + 2]!, dx: dx / l, dz: dz / l };
}

/** Câble tendu de (x0, y0, z0) à (x1, y1, z1) (gabarit unitaire le long de +z). */
function wire(mesh: MeshBuilder, t: Kit['cable'], x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): void {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const dz = z1 - z0;
  const L = Math.hypot(dx, dy, dz);
  const h = Math.hypot(dx, dz) || 1e-6;
  const zx = dx / L;
  const zy = dy / L;
  const zz = dz / L;
  // x local à plat, perpendiculaire au câble ; y local = z × x.
  const px = dz / h;
  const pz = -dx / h;
  mesh.putBasis(t, x0, y0, z0, px, 0, pz, zy * pz - 0, zz * px - zx * pz, -zy * px, zx * L, zy * L, zz * L, 0.85, 0.84, 0.8);
}

/** Bouffées animées (fumée, vapeur) : sphères qui montent, grossissent et dérivent, puis repartent du bas. */
function puffs(c: SiteContext, K: Kit, name: string, x: number, y: number, z: number, o: { n: number; rise: number; size: number; drift: [number, number]; period: number; spread: number; colour: string; seed: number; night?: boolean }): void {
  const r = rng(o.seed);
  const base = new THREE.Color(o.colour);
  for (let i = 0; i < o.n; i++) {
    const m = meshOf([{ t: K.puff, x: 0, y: 0, z: 0, c: base.clone().multiplyScalar(0.88 + r() * 0.12) }], c.mat);
    m.name = name;
    m.castShadow = false;
    const ph = i / o.n;
    const ox = (r() - 0.5) * o.spread;
    const oz = (r() - 0.5) * o.spread;
    const wob = r() * 6.28;
    c.moving.push({
      object: m,
      step: (t) => {
        const q = (t / o.period + ph) % 1;
        const s = o.size * (0.35 + q * 1.4);
        m.position.set(x + ox + o.drift[0] * q + Math.sin(t * 0.2 + wob) * o.spread * 0.15, y + o.rise * q, z + oz + o.drift[1] * q);
        m.scale.set(s, s * 0.8, s);
        m.rotation.y = wob + q;
        // Une bouffée qui se dissout : s'aplatit et disparaît en haut.
        m.visible = q < 0.96;
      },
    });
  }
}

/** Distance (m) d'un point à une polyligne [[x, z], …]. */
function distLine(pts: ReadonlyArray<readonly [number, number]>, x: number, z: number): number {
  let best = Infinity;
  for (let k = 0; k + 1 < pts.length; k++) {
    const [ax, az] = pts[k]!;
    const [bx, bz] = pts[k + 1]!;
    const dx = bx - ax;
    const dz = bz - az;
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz)));
    best = Math.min(best, Math.hypot(x - ax - dx * t, z - az - dz * t));
  }
  return best;
}

// ───────────────────────────── Lieux

/** Panache du volcan : grosses bouffées qui montent du cratère et dérivent avec l'alizé ; lueur rouge la nuit. */
function plume(k: () => Kit): Site {
  const V = A.volcano;
  return {
    id: 'panache',
    x: V.x,
    z: V.z,
    reach: 16000,
    // Hauteurs connues (le cratère n'a pas besoin d'être chargé pour qu'on voie sa fumée de loin).
    needs: [],
    *build(c) {
      const K = k();
      yield;
      // Bouche active au pied de la paroi nord du cratère.
      const vx = V.x - 140;
      const vz = V.z - 240;
      const vy = V.lake + 6;
      puffs(c, K, 'archipel-panache', vx, vy, vz, { n: 18, rise: 900, size: 46, drift: [1500, -260], period: 140, spread: 60, colour: '#e6e3dc', seed: 77 });
      yield;
      puffs(c, K, 'archipel-panache-bas', vx, vy, vz, { n: 6, rise: 260, size: 22, drift: [260, -60], period: 45, spread: 30, colour: '#bdb8ae', seed: 78 });
      // Lueur de la bouche, la nuit.
      const glowMat = new THREE.MeshBasicNodeMaterial({ color: '#ff6a2a' });
      const glow = new THREE.Mesh(new THREE.IcosahedronGeometry(9, 1).scale(1.4, 0.5, 1.4), glowMat);
      glow.name = 'archipel-lueur';
      glow.position.set(vx, vy, vz);
      glow.castShadow = false;
      c.moving.push({ object: glow, step: (t) => void ((glow.visible = islandClock().night > 0.25), glow.scale.setScalar(1 + 0.08 * Math.sin(t * 1.7))) });
    },
  };
}

/** Fumerolles : bouches de soufre et petites vapeurs. */
function fumaroles(k: () => Kit, id: string, x0: number, z0: number, n: number, spread: number, seed: number): Site {
  return {
    id,
    x: x0,
    z: z0,
    reach: 900,
    needs: [[x0, z0]],
    *build(c) {
      const K = k();
      const r = rng(seed);
      for (let i = 0; i < n * 3 && c.moving.length < n * 4; i++) {
        const x = x0 + (r() - 0.5) * spread;
        const z = z0 + (r() - 0.5) * spread;
        const pr = c.probe;
        if (!pr.read(x, z) || pr.road > 0.05 || pr.water > 0.1 || pr.buildingNear(x, z, 4)) continue;
        const y = pr.heightAt(x, z);
        if (!Number.isFinite(y)) continue;
        c.mesh.put(K.vent, x, y, z, r() * 6.28, 1, 1, 1, WHITE);
        puffs(c, K, 'archipel-fumerolle', x, y + 0.5, z, { n: 4, rise: 14, size: 1.6, drift: [5, -2], period: 9 + r() * 4, spread: 1.2, colour: '#f2f0ea', seed: seed + i });
        if (i % 3 === 0) yield;
      }
      strollPath(c, [[x0 - 40, z0 + 30], [x0 + 30, z0 + 40], [x0 + 40, z0 - 30], [x0 - 40, z0 + 30]], seed + 9);
    },
  };
}

/** Bassins thermaux d'Aigues-Chaudes : trois bassins fumants, baigneurs, bancs de bois. */
function thermalPools(k: () => Kit): Site {
  const [x0, z0] = A.thermes;
  return {
    id: 'thermes',
    x: x0,
    z: z0,
    reach: 800,
    needs: [[x0, z0], [x0 + 40, z0 + 40]],
    *build(c) {
      const K = k();
      const r = rng(4411);
      let made = 0;
      for (let i = 0; i < 40 && made < 3; i++) {
        const a = i * 2.4;
        const x = x0 + Math.cos(a) * (26 + i * 2.5);
        const z = z0 + Math.sin(a) * (26 + i * 2.5);
        const pr = c.probe;
        if (!pr.read(x, z) || pr.road > 0.02 || pr.buildingNear(x, z, 7) || !pr.clear(x, z, 6)) continue;
        const y = pr.heightAt(x, z);
        if (!Number.isFinite(y) || Math.abs(pr.heightAt(x + 5, z) - y) > 0.8 || Math.abs(pr.heightAt(x, z + 4) - y) > 0.8) continue;
        const yaw = 0.6 + made * 0.3;
        c.mesh.put(K.pool, x, y, z, yaw, 1, 1, 1, WHITE);
        for (let b = 0; b < 4; b++) c.mesh.put(K.bather, x + (r() - 0.5) * 6, y - 0.05, z + (r() - 0.5) * 3.5, r() * 6.28, 1, 1, 1, WHITE);
        for (let d = 0; d < 3; d++) {
          const dx = x + Math.cos(yaw) * (-3 + d * 3) - Math.sin(yaw) * 4.6;
          const dz = z - Math.sin(yaw) * (-3 + d * 3) - Math.cos(yaw) * 4.6;
          const dy = pr.heightAt(dx, dz);
          if (Number.isFinite(dy) && c.probe.read(dx, dz) && c.probe.road < 0.02) c.mesh.put(K.bench, dx, dy, dz, yaw, 1, 1, 1, WHITE);
        }
        puffs(c, K, 'archipel-vapeur', x, y + 0.4, z, { n: 5, rise: 9, size: 1.8, drift: [3, -1], period: 12, spread: 5, colour: '#f6f5f0', seed: 4500 + made });
        made++;
        yield;
      }
      strollPath(c, [[x0 - 30, z0 - 30], [x0 + 40, z0 - 20], [x0 + 30, z0 + 40], [x0 - 30, z0 - 30]], 4499);
    },
  };
}

/** Pont des Orgues : piles et chevêtres, tranches du tablier, deux pylônes et leurs haubans, lampadaires. */
function bridge(k: () => Kit): Site {
  const L = A.bridge;
  const n = L.length / 3;
  const mid = along(L, Math.floor(n / 2));
  return {
    id: 'pont-des-orgues',
    x: mid.x,
    z: mid.z,
    reach: 1700,
    needs: [[L[0]!, L[2]!], [mid.x, mid.z], [L[(n - 1) * 3]!, L[(n - 1) * 3 + 2]!]],
    *build(c) {
      const K = k();
      const pyl = [Math.round(n * 0.3), Math.round(n * 0.7)];
      for (let i = 0; i < n; i++) {
        const p = along(L, i);
        const yaw = Math.atan2(p.dx, p.dz);
        const g = c.probe.heightAt(p.x, p.z);
        const ground = Number.isFinite(g) ? g : -6;
        // Tranches du tablier jusqu'au point suivant.
        if (i + 1 < n) {
          const q = along(L, i + 1);
          for (const s of [-1, 1]) {
            const ox = p.dz * s * 3.7;
            const oz = -p.dx * s * 3.7;
            const dx = q.x - p.x;
            const dy = q.y - p.y;
            const dz = q.z - p.z;
            c.mesh.putBasis(K.fascia, p.x + ox, p.y, p.z + oz, p.dz, 0, -p.dx, 0, 1, 0, dx, dy, dz, 0.85, 0.83, 0.79);
          }
        }
        // Piles là où il y a de l'eau sous le tablier.
        if (p.y - ground > 3.5 && !pyl.includes(i)) {
          c.mesh.put(K.capBeam, p.x, p.y - 0.4, p.z, yaw, 1, 1, 1, WHITE);
          for (const s of [-2.6, 2.6]) c.mesh.put(K.pier, p.x + p.dz * s, ground - 1, p.z - p.dx * s, yaw, 1, p.y - 1.4 - ground + 1, 1, WHITE);
        }
        if (i % 2 === 0) for (const s of [-1, 1]) c.mesh.put(K.lamp, p.x + p.dz * s * 4.2, p.y, p.z - p.dx * s * 4.2, yaw + (s > 0 ? Math.PI : 0), 1, 1, 1, WHITE);
        if (i % 6 === 5) yield;
      }
      // Pylônes en A (le tablier passe entre les jambes) et haubans en éventail.
      for (const i of pyl) {
        const p = along(L, i);
        const yaw = Math.atan2(p.dx, p.dz);
        const g = c.probe.heightAt(p.x, p.z);
        const ground = Number.isFinite(g) ? Math.min(g, p.y - 2) : -6;
        c.mesh.put(K.pylon, p.x, ground, p.z, yaw, 1.55, 1, 1, WHITE);
        const top = ground + 41;
        for (const dir of [-1, 1])
          for (let s = 1; s <= 5; s++) {
            const j = i + dir * s;
            if (j < 0 || j >= n) continue;
            const q = along(L, j);
            for (const side of [-1, 1]) wire(c.mesh, K.cable, p.x + p.dz * side * 0.8, top - s * 1.3, p.z - p.dx * side * 0.8, q.x + q.dz * side * 3.6, q.y + 0.6, q.z - q.dx * side * 3.6);
          }
        yield;
      }
      // Pêcheurs à la ligne sur le trottoir du pont.
      for (const f of [0.18, 0.52, 0.86]) {
        const p = along(L, Math.floor(n * f));
        c.spots.push({ kind: 'fisher', x: p.x + p.dz * 4.6, y: p.y, z: p.z - p.dx * 4.6, yaw: Math.atan2(p.dz, -p.dx), seed: f });
      }
    },
  };
}

/** La Chaussée : enrochements des deux bords, bornes et lampadaires, oratoire au milieu. */
function causeway(k: () => Kit): Site {
  const L = A.causeway;
  const n = L.length / 3;
  const mid = along(L, Math.floor(n / 2));
  return {
    id: 'la-chaussee',
    x: mid.x,
    z: mid.z,
    reach: 1500,
    needs: [[L[0]!, L[2]!], [mid.x, mid.z], [L[(n - 1) * 3]!, L[(n - 1) * 3 + 2]!]],
    *build(c) {
      const K = k();
      const r = rng(6262);
      const dark = [new THREE.Color('#3a3634'), new THREE.Color('#4a4542'), new THREE.Color('#2f2b29')];
      for (let i = 0; i + 1 < n; i++) {
        const p = along(L, i);
        const q = along(L, i + 1);
        const seg = Math.hypot(q.x - p.x, q.z - p.z);
        const yaw = Math.atan2(p.dx, p.dz);
        for (let s = 0; s < seg; s += 3.2) {
          const t = s / seg;
          const x = p.x + (q.x - p.x) * t;
          const z = p.z + (q.z - p.z) * t;
          for (const side of [-1, 1]) {
            const lat = side * (7.5 + r() * 4);
            const rx = x + p.dz * lat;
            const rz = z - p.dx * lat;
            const y = c.probe.heightAt(rx, rz);
            if (!Number.isFinite(y) || y > p.y - 0.6) continue;
            const sc = 0.7 + r() * 0.8;
            c.mesh.put(K.riprap, rx, Math.max(y, -1.2), rz, r() * 6.28, sc, sc, sc, dark[Math.floor(r() * 3)]!);
          }
        }
        for (const side of [-1, 1]) {
          c.mesh.put(K.bollard, p.x + p.dz * side * 4.3, p.y, p.z - p.dx * side * 4.3, yaw, 1, 1, 1, WHITE);
          if (i % 2 === 0) c.mesh.put(K.lamp, p.x + p.dz * side * 4.6, p.y, p.z - p.dx * side * 4.6, yaw + (side > 0 ? Math.PI : 0), 1, 1, 1, WHITE);
        }
        if (i % 4 === 3) yield;
      }
      // Pêcheurs sur les enrochements, joggeurs sur la chaussée.
      for (const f of [0.25, 0.6]) {
        const p = along(L, Math.floor(n * f));
        c.spots.push({ kind: 'fisher', x: p.x + p.dz * 5.4, y: p.y - 0.3, z: p.z - p.dx * 5.4, yaw: Math.atan2(p.dz, -p.dx), seed: f + 0.3 });
      }
    },
  };
}

/** Phare des Orgues : bandes rouges, lanterne, et la nuit deux faisceaux qui tournent. */
function lighthouse(k: () => Kit): Site {
  const [px, pz] = A.lighthouse;
  return {
    id: 'phare-des-orgues',
    x: px,
    z: pz,
    reach: 9000,
    needs: [[px, pz]],
    *build(c) {
      const K = k();
      yield;
      const y = c.probe.heightAt(px, pz);
      if (!Number.isFinite(y)) return;
      c.mesh.put(K.lightTop, px, y, pz, 0, 1, 1, 1, WHITE);
      c.mesh.put(K.bench, px - 14, c.probe.heightAt(px - 14, pz + 6), pz + 6, 1.2, 1, 1, 1, WHITE);
      const mat = new THREE.MeshBasicNodeMaterial({ color: '#fff3c4', transparent: true, opacity: 0.16, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
      const beamGeo = new THREE.ConeGeometry(18, 420, 16, 1, true).rotateZ(Math.PI / 2).translate(-210, 0, 0);
      const g = new THREE.Group();
      g.name = 'archipel-phare-faisceaux';
      g.position.set(px, y + 28, pz);
      const beams = [0, Math.PI].map((a) => {
        const m = new THREE.Mesh(beamGeo, mat);
        m.rotation.y = a;
        m.castShadow = false;
        g.add(m);
        return m;
      });
      const lamp = new THREE.Mesh(new THREE.SphereGeometry(1.6, 10, 8), new THREE.MeshBasicNodeMaterial({ color: '#ffe7a0' }));
      g.add(lamp);
      c.moving.push({
        object: g,
        step: (time) => {
          const on = islandClock().night > 0.3;
          for (const b of beams) b.visible = on;
          lamp.visible = on;
          g.rotation.y = time * 0.9;
        },
      });
      strollPath(c, [[px - 40, pz - 20], [px - 10, pz - 30], [px - 20, pz + 25], [px - 40, pz - 20]], 818);
    },
  };
}

const harbourSite = (id: string, h: HarbourSite, reach: number, templates: () => HarbourTemplates): Site => ({
  id,
  x: h.x,
  z: h.z,
  reach,
  needs: harbourCorners(h),
  *build(c) {
    yield* buildHarbour(c.mesh, c.probe, templates(), h);
    // Promeneurs sur le quai.
    const ux = Math.cos(h.dir);
    const uz = Math.sin(h.dir);
    const w = -h.side * (h.halfWid + 6);
    const at = (u: number): [number, number] => [h.x + ux * u - uz * w, h.z + uz * u + ux * w];
    strollPath(c, [at(-h.halfLen * 0.8), at(h.halfLen * 0.6), at(-h.halfLen * 0.8)], 31 + Math.round(h.x));
  },
});

/** Bateaux au large d'un port : chalutiers et voiliers qui tournent lentement sur de grands cercles. */
function boatsOffshore(k: () => Kit, id: string, h: { x: number; z: number; sea: number }, count: number, sail: number): Site {
  const cx = h.x + Math.cos(h.sea) * 1400;
  const cz = h.z + Math.sin(h.sea) * 1400;
  return {
    id,
    x: cx,
    z: cz,
    reach: 4500,
    needs: [],
    *build(c) {
      const K = k();
      const r = rng(Math.round(cx));
      const hulls = ['#2d5d8f', '#b8432f', '#3c7f58', '#f2f0e8', '#e2a23a'].map((q) => new THREE.Color(q));
      for (let i = 0; i < count; i++) {
        const isSail = r() < sail;
        const m = meshOf([{ t: isSail ? K.sailboat : K.fishingBoat, x: 0, y: 0, z: 0, c: hulls[i % hulls.length]! }], c.mat);
        m.name = 'archipel-bateau';
        const R = 200 + r() * 250;
        const ox = (r() - 0.5) * 500;
        const oz = (r() - 0.5) * 500;
        const sp = (isSail ? 0.006 : 0.004) * (r() < 0.5 ? 1 : -1);
        const ph = r() * 6.28;
        c.moving.push({
          object: m,
          step: (t) => {
            const a = ph + t * sp;
            m.position.set(cx + ox + Math.cos(a) * R, Math.sin(t * 0.9 + ph) * 0.15, cz + oz + Math.sin(a) * R);
            // Cap : tangente au cercle (avant du bateau +z local).
            m.rotation.y = Math.atan2(-Math.sin(a) * Math.sign(sp), Math.cos(a) * Math.sign(sp));
            m.rotation.z = Math.sin(t * 0.7 + ph) * 0.04;
          },
        });
        yield;
      }
    },
  };
}

/** Champ de lave : blocs, dalles cordées et hornitos noirs autour d'un point d'une coulée. */
function lavaField(k: () => Kit, f: (typeof A.lava)[number], x0: number, z0: number, i: number): Site {
  return {
    id: `lave-${i}`,
    x: x0,
    z: z0,
    reach: 750,
    needs: [[x0, z0]],
    *build(c) {
      const K = k();
      const r = rng(9100 + i);
      const tints = [new THREE.Color('#2b2725'), new THREE.Color('#3a3532'), new THREE.Color('#24201f'), new THREE.Color('#4a3f38')];
      const R = Math.min(320, f.w * 0.8);
      // Coulée ancienne (loin du cratère) : la mousse a tout recouvert, blocs moussus et buttes vert vif.
      const V = A.volcano;
      const old = Math.hypot(x0 - V.x, z0 - V.z) > 2800;
      if (old) {
        const tries = c.density < 0.7 ? 160 : 260;
        for (let j = 0; j < tries; j++) {
          const a = r() * 6.28;
          const d = Math.sqrt(r()) * R;
          const x = x0 + Math.cos(a) * d;
          const z = z0 + Math.sin(a) * d;
          if (distLine(f.pts, x, z) > f.w * 0.62) continue;
          const s = 0.7 + r() * 1.3;
          const pr = c.probe;
          if (!freeSpot(pr, x, z, 1.4 * s) || pr.urban > 0.2) continue;
          const y = pr.heightAt(x, z);
          if (!Number.isFinite(y) || y < 0.5) continue;
          c.mesh.put(K.hummock, x, y - 0.1, z, r() * 6.28, s, s * (0.7 + r() * 0.6), s, MOSS_TINTS[Math.floor(r() * MOSS_TINTS.length)]!);
          if (j % 60 === 59) yield;
        }
      }
      for (let j = 0; j < 260; j++) {
        const a = r() * 6.28;
        const d = Math.sqrt(r()) * R;
        const x = x0 + Math.cos(a) * d;
        const z = z0 + Math.sin(a) * d;
        if (distLine(f.pts, x, z) > f.w * 0.6) continue;
        const pr = c.probe;
        if (!pr.read(x, z) || pr.road > 0.02 || pr.water > 0.1 || pr.urban > 0.2 || pr.buildingNear(x, z, 5) || !pr.clear(x, z, 3)) continue;
        const y = pr.heightAt(x, z);
        if (!Number.isFinite(y) || y < 0.5) continue;
        const roll = r();
        const tint = tints[Math.floor(r() * tints.length)]!;
        if (roll < 0.62) {
          const s = 0.5 + r() * r() * 2.4;
          c.mesh.put(old && r() < 0.75 ? K.lavaMoss : K.boulder, x, y - 0.15 * s, z, r() * 6.28, s, s * (0.6 + r() * 0.5), s, tint);
        } else if (roll < 0.93) c.mesh.put(old && r() < 0.8 ? K.slabMoss : K.slab, x, y - 0.1, z, r() * 6.28, 0.6 + r() * 0.9, 0.7 + r() * 0.6, 0.6 + r() * 0.9, tint);
        else c.mesh.put(K.hornito, x, y - 0.2, z, r() * 6.28, 0.7 + r() * 0.6, 0.6 + r() * 0.8, 0.7 + r() * 0.6, tint);
        if (j % 50 === 49) yield;
      }
    },
  };
}

/** Bike park du Mont Cendre : départ et cabane, virages relevés en planches, buttes de cendre, drapeaux, public. */
function bikePark(k: () => Kit): Site {
  const lines = A.bike;
  const all = lines.flat();
  let top = 0;
  for (let i = 1; i < all.length / 3; i++) if (all[i * 3 + 1]! > all[top * 3 + 1]!) top = i;
  const [tx, ty, tz] = [all[top * 3]!, all[top * 3 + 1]!, all[top * 3 + 2]!];
  return {
    id: 'bike-park',
    x: A.cinder.x,
    z: A.cinder.z,
    reach: 1100,
    needs: [[tx, tz], [A.cinder.x, A.cinder.z]],
    *build(c) {
      const K = k();
      const r = rng(3131);
      const flags = ['#e2604f', '#f4d35e', '#2f9c95', '#5c6bc0'].map((q) => new THREE.Color(q));
      // Départ : rampe et cabane au point le plus haut.
      c.mesh.put(K.startRamp, tx + 6, ty, tz + 4, r() * 6.28, 1, 1, 1, WHITE);
      const hy = c.probe.heightAt(tx - 12, tz - 8);
      if (Number.isFinite(hy)) c.mesh.put(K.hut, tx - 12, hy, tz - 8, 0.4, 1, 1, 1, WHITE);
      for (let s = 0; s < 6; s++) c.spots.push({ kind: 'villager', x: tx - 4 + s * 1.6, y: ty, z: tz + 9, yaw: Math.PI, seed: s * 0.13 });
      yield;
      for (const line of lines) {
        const n = line.length / 3;
        for (let i = 1; i + 1 < n; i++) {
          const p = along(line, i);
          const q = along(line, i + 1);
          // Virage : planches à l'extérieur ; ligne droite : butte de cendre à côté de la trace.
          const turn = p.dx * q.dz - p.dz * q.dx;
          const side = turn > 0 ? -1 : 1;
          const yaw = Math.atan2(p.dx, p.dz) + Math.PI / 2;
          const lat = side * 3.2;
          const x = p.x + p.dz * lat;
          const z = p.z - p.dx * lat;
          const y = c.probe.heightAt(x, z);
          if (!Number.isFinite(y)) continue;
          if (Math.abs(turn) > 0.25) c.mesh.put(K.berm, x, y, z, yaw + (side > 0 ? Math.PI : 0), 1, 1, 1, WHITE);
          else if (i % 3 === 0) {
            const mx = p.x + p.dz * side * 9;
            const mz = p.z - p.dx * side * 9;
            const my = c.probe.heightAt(mx, mz);
            if (Number.isFinite(my) && c.probe.read(mx, mz) && c.probe.road < 0.05) c.mesh.put(K.mound, mx, my - 0.2, mz, yaw, 0.8 + r() * 0.5, 0.7 + r() * 0.6, 0.8 + r() * 0.4, WHITE);
          }
          if (i % 4 === 0) c.mesh.put(K.flag, x, y, z, yaw, 1, 0.7, 1, flags[i % 4]!);
        }
        yield;
      }
    },
  };
}

/** Cyclo-cross des Cendres : rubalise des deux côtés, portique de départ, barnums des équipes, public. */
function cycloCross(k: () => Kit): Site {
  const lines = A.cross3;
  const all = lines.flat();
  const [sx, sy, sz] = [all[0]!, all[1]!, all[2]!];
  return {
    id: 'cyclo-cross',
    x: A.cross.x,
    z: A.cross.z,
    reach: 1000,
    needs: [[A.cross.x, A.cross.z], [sx, sz]],
    *build(c) {
      const K = k();
      const r = rng(2727);
      const tape = new THREE.Color('#e9d84a');
      for (const line of lines) {
        const n = line.length / 3;
        for (let i = 0; i + 1 < n; i++) {
          const p = along(line, i);
          const q = along(line, i + 1);
          const len = Math.hypot(q.x - p.x, q.z - p.z);
          for (let s = 0; s + 5.9 < len; s += 6) {
            for (const side of [-1, 1]) {
              const x = p.x + p.dx * s + p.dz * side * 2.6;
              const z = p.z + p.dz * s - p.dx * side * 2.6;
              const y = c.probe.heightAt(x, z);
              if (Number.isFinite(y)) c.mesh.put(K.tape, x, y, z, -Math.atan2(p.dz, p.dx), 1, 1, 1, tape);
            }
          }
          if (i % 8 === 0) {
            const side = i % 16 === 0 ? 1 : -1;
            const x = p.x + p.dz * side * 4;
            const z = p.z - p.dx * side * 4;
            const y = c.probe.heightAt(x, z);
            for (let s = 0; s < 3 && Number.isFinite(y); s++) c.spots.push({ kind: 'villager', x: x + p.dx * s * 1.3, y, z: z + p.dz * s * 1.3, yaw: Math.atan2(-p.dz * side, p.dx * side), seed: (i * 0.071 + s * 0.13) % 1 });
          }
        }
        yield;
      }
      const s0 = along(all, 0);
      c.mesh.put(K.arch, sx, sy, sz, Math.atan2(s0.dx, s0.dz), 0.6, 0.75, 1, WHITE);
      const cols = ['#e2604f', '#2f9c95', '#5c6bc0', '#f4d35e', '#7fb069'].map((q) => new THREE.Color(q));
      for (let i = 0; i < 6; i++) {
        const x = A.cross.x + (i - 2.5) * 6;
        const z = A.cross.z + 4;
        const y = c.probe.heightAt(x, z);
        if (Number.isFinite(y) && c.probe.road < 0.05 && !c.probe.buildingNear(x, z, 3)) c.mesh.put(K.tent, x, y, z, 0, 1, 1, 1, cols[i % cols.length]!);
      }
      void r;
    },
  };
}

/** Tribunes, portique d'arrivée et drapeaux du Circuit des Laves (ligne droite sud). */
function circuit(k: () => Kit): Site {
  const RING = ARCHIPEL_RING;
  const zS = RING.z + RING.radius;
  return {
    id: 'circuit',
    x: RING.x,
    z: RING.z,
    reach: 900,
    needs: [[RING.x - RING.half, zS], [RING.x + RING.half, zS], [RING.x, RING.z - RING.radius]],
    *build(c) {
      const K = k();
      const flags = [new THREE.Color('#e2604f'), new THREE.Color('#f4d35e'), new THREE.Color('#2f9c95'), new THREE.Color('#3a3634')];
      for (let i = -2; i <= 2; i++) {
        const x = RING.x + i * 13;
        const z = zS + 26;
        const y = c.probe.heightAt(x, z);
        if (Number.isFinite(y)) c.mesh.put(K.stand, x, y, z, Math.PI, 1, 1, 1, WHITE);
        for (let s = 0; s < 8; s++) c.spots.push({ kind: 'villager', x: x - 5 + s * 1.4, y: y + 1.6, z: z - 1.2, yaw: Math.PI, seed: ((i + 2) * 0.137 + s * 0.071) % 1 });
      }
      yield;
      const ay = c.probe.heightAt(RING.x + 120, zS);
      if (Number.isFinite(ay)) c.mesh.put(K.arch, RING.x + 120, ay, zS, Math.PI / 2, 1, 1, 1, WHITE);
      for (let i = 0; i < 24; i++) {
        const x = RING.x - RING.half + (i * 2 * RING.half) / 23;
        for (const z of [zS + 12, RING.z - RING.radius - 12]) {
          // Jamais sur une chaussée : la route d'accès longe le circuit, et le tracé réel s'écarte un peu de l'ovale.
          if ([-3, 0, 3].some((dz) => !c.probe.read(x, z + dz) || c.probe.road > 0.02)) continue;
          const y = c.probe.heightAt(x, z);
          if (Number.isFinite(y)) c.mesh.put(K.flag, x, y, z, 0, 1, 1, 1, flags[i % flags.length]!);
        }
      }
      yield;
      strollPath(c, [[RING.x - 300, RING.z], [RING.x + 300, RING.z - 60], [RING.x + 300, RING.z + 60], [RING.x - 300, RING.z]], 404, 'jogger');
    },
  };
}

/** Observatoire du volcan : coupole sur la tour, antenne ; belvédère de la brèche du cratère. */
function summit(k: () => Kit): Site {
  const [ox, oz] = A.observatory;
  const [bx, bz] = A.volcano.rimPt;
  return {
    id: 'sommet',
    x: (ox + bx) / 2,
    z: (oz + bz) / 2,
    reach: 2600,
    needs: [[ox, oz], [bx, bz]],
    *build(c) {
      const K = k();
      const oy = c.probe.heightAt(ox, oz);
      if (Number.isFinite(oy)) {
        c.mesh.put(K.dome, ox, oy + 12, oz, 0.4, 1, 1, 1, WHITE);
        const ay = c.probe.heightAt(ox + 24, oz - 14);
        if (Number.isFinite(ay)) c.mesh.put(K.antenna, ox + 24, ay, oz - 14, 0, 1, 1, 1, WHITE);
      }
      yield;
      // Belvédère : garde-corps côté cratère, panneau, bancs, randonneurs.
      const V = A.volcano;
      const ang = Math.atan2(bz - V.z, bx - V.x);
      for (let k2 = -3; k2 <= 3; k2++) {
        const a = ang + k2 * 0.0085;
        const rx = V.x + Math.cos(a) * (V.rim + 8);
        const rz = V.z + Math.sin(a) * (V.rim + 8);
        const ry = c.probe.heightAt(rx, rz);
        if (Number.isFinite(ry) && c.probe.read(rx, rz) && c.probe.road < 0.05) c.mesh.put(K.rail, rx, ry, rz, -a - Math.PI / 2, 1, 1, 1, WHITE);
      }
      const sx = bx + Math.cos(ang) * 10;
      const sz = bz + Math.sin(ang) * 10;
      const sy = c.probe.heightAt(sx, sz);
      if (Number.isFinite(sy)) c.mesh.put(K.sign, sx, sy, sz, -ang + Math.PI / 2, 1, 1, 1, WHITE);
      for (const d of [-14, 14]) {
        const x = bx + Math.cos(ang + Math.PI / 2) * d + Math.cos(ang) * 8;
        const z = bz + Math.sin(ang + Math.PI / 2) * d + Math.sin(ang) * 8;
        const y = c.probe.heightAt(x, z);
        if (Number.isFinite(y) && c.probe.road < 0.05) c.mesh.put(K.bench, x, y, z, -ang - Math.PI / 2, 1, 1, 1, WHITE);
      }
      strollPath(c, [[bx + 20, bz + 10], [bx - 30, bz + 25], [bx - 10, bz - 20], [bx + 20, bz + 10]], 1440);
    },
  };
}

/** Front de mer de Sainte-Iris et rue de Sable-Noir : lampadaires et bancs côté mer (plus de palmiers sous ce ciel). */
function seafront(k: () => Kit, id: string, line: readonly number[], side: number, every: number, seed: number): Site {
  const n = line.length / 3;
  const mid = along(line, Math.floor(n / 2));
  return {
    id,
    x: mid.x,
    z: mid.z,
    reach: 1200,
    needs: [[line[0]!, line[2]!], [mid.x, mid.z]],
    *build(c) {
      const K = k();
      const r = rng(seed);
      let k2 = 0;
      for (let i = 0; i < n; i += every) {
        const p = along(line, i);
        const pr = c.probe;
        for (const lat of [4.4, 5.6]) {
          const x = p.x + p.dz * side * lat;
          const z = p.z - p.dx * side * lat;
          if (!freeSpot(pr, x, z, 0.5)) continue;
          const y = pr.heightAt(x, z);
          if (!Number.isFinite(y) || y < 0.3) continue;
          // Lampadaire (bras vers la promenade) ou banc tourné vers elle, en alternance.
          if (k2++ % 2 === 0) c.mesh.put(K.lamp, x, y, z, Math.atan2(-side * p.dx, -side * p.dz), 1, 1, 1, WHITE);
          else c.mesh.put(K.bench, x, y, z, Math.atan2(-side * p.dz, side * p.dx), 1, 1, 1, WHITE);
          break;
        }
        if (i % 40 === 0) yield;
      }
      void r;
    },
  };
}

// ───────────────────────────── Rochers, orgues et fleurs

const LAVA_TINTS = ['#2b2725', '#35302d', '#24201f', '#3f3632', '#2f2a2a'].map((q) => new THREE.Color(q));
/** Mousse des vieilles coulées : vert vif, vert jaune, vert olive. */
const MOSS_TINTS = ['#7fa346', '#8db04a', '#6f9a3e', '#99b552', '#789c40'].map((q) => new THREE.Color(q));
const RING4: ReadonlyArray<readonly [number, number]> = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const RING8: ReadonlyArray<readonly [number, number]> = [...RING4, [0.71, 0.71], [-0.71, 0.71], [0.71, -0.71], [-0.71, -0.71]];

/**
 * Emplacement libre pour un objet de rayon `r` : jamais sur une chaussée (centre et quatre points du pourtour,
 * route < 0,02), ni dans l'eau, ni contre un bâtiment. La sonde reste lue au centre.
 */
function freeSpot(pr: SiteContext['probe'], x: number, z: number, r: number, waterMax = 0.1): boolean {
  for (const [dx, dz] of RING4) if (!pr.read(x + dx * r, z + dz * r) || pr.road >= 0.02) return false;
  if (!pr.read(x, z) || pr.road >= 0.02 || pr.water > waterMax) return false;
  return !pr.buildingNear(x, z, r + 2);
}

/** Bourrelets d'une coulée : tas et gros blocs à facettes le long des deux bords, sur ± `half` m autour d'un point. */
function lavaLevee(k: () => Kit, f: (typeof A.lava)[number], x0: number, z0: number, ux: number, uz: number, half: number, i: number): Site {
  return {
    id: `bourrelets-${i}`,
    x: x0,
    z: z0,
    reach: 900,
    needs: [[x0, z0], [x0 + ux * half, z0 + uz * half], [x0 - ux * half, z0 - uz * half]],
    *build(c) {
      const K = k();
      const r = rng(9700 + i);
      const V = A.volcano;
      const keep = c.density < 0.7 ? 0.33 : 0.55;
      let made = 0;
      for (let t = -half; t < half; t += 13) {
        for (const side of [-1, 1]) {
          if (r() > keep) continue;
          const lat = side * f.w * (0.47 + (r() - 0.4) * 0.16);
          const x = x0 + ux * t + uz * lat;
          const z = z0 + uz * t - ux * lat;
          if (Math.hypot(x - V.x, z - V.z) < V.rim + 40) continue;
          const heap = r() < 0.4;
          const s = heap ? 0.9 + r() * 1.3 : 0.8 + r() * r() * 2.6;
          const pr = c.probe;
          if (!freeSpot(pr, x, z, 1.6 * s) || pr.urban > 0.2 || pr.treeNear(x, z, 1.2 * s)) continue;
          const y = pr.heightAt(x, z);
          if (!Number.isFinite(y) || y < 0.5) continue;
          // Loin du cratère, la mousse a gagné les bourrelets.
          const moss = !heap && Math.hypot(x - V.x, z - V.z) > 2800 && r() < 0.6;
          c.mesh.put(heap ? K.lavaHeap : moss ? K.lavaMoss : K.lavaBlock, x, y - 0.15 * s, z, r() * 6.28, s, s * (0.75 + r() * 0.4), s, LAVA_TINTS[Math.floor(r() * LAVA_TINTS.length)]!);
          if (++made % 15 === 0) yield;
        }
      }
    },
  };
}

/** Pentes du volcan : blocs épars et tas ; plus bas (> 1,5 km du cratère), vieux blocs moussus. */
function volcanoSlope(k: () => Kit, i: number, x0: number, z0: number): Site {
  return {
    id: `pentes-${i}`,
    x: x0,
    z: z0,
    reach: 800,
    needs: [[x0, z0]],
    *build(c) {
      const K = k();
      const r = rng(9900 + i * 7);
      const V = A.volcano;
      const tries = c.density < 0.7 ? 55 : 90;
      for (let j = 0; j < tries; j++) {
        const a = r() * 6.28;
        const d = Math.sqrt(r()) * 260;
        const x = x0 + Math.cos(a) * d;
        const z = z0 + Math.sin(a) * d;
        const dV = Math.hypot(x - V.x, z - V.z);
        if (dV < V.rim + 60) continue;
        const roll = r();
        const moss = dV > 1500 && roll < 0.4;
        const heap = !moss && roll > 0.75;
        const s = heap ? 0.8 + r() * 1.1 : 0.7 + r() * r() * 3;
        const pr = c.probe;
        if (!freeSpot(pr, x, z, 1.6 * s) || pr.urban > 0.2 || pr.forest > (moss ? 0.7 : 0.4) || pr.treeNear(x, z, 1.2 * s)) continue;
        const y = pr.heightAt(x, z);
        if (!Number.isFinite(y) || y < 0.5) continue;
        c.mesh.put(moss ? K.lavaMoss : heap ? K.lavaHeap : K.lavaBlock, x, y - 0.18 * s, z, r() * 6.28, s, s * (0.7 + r() * 0.45), s, LAVA_TINTS[Math.floor(r() * LAVA_TINTS.length)]!);
        if (j % 20 === 19) yield;
      }
    },
  };
}

/** Orgues de basalte autour du phare : faisceaux de colonnes en gradins et pavés de colonnes rases. */
function basaltOrgans(k: () => Kit): Site {
  const [px, pz] = A.lighthouse;
  return {
    id: 'orgues-du-phare',
    x: px,
    z: pz,
    reach: 1400,
    needs: [[px, pz], [px - 200, pz], [px, pz + 200], [px, pz - 200]],
    *build(c) {
      const K = k();
      const r = rng(5151);
      const greys = ['#3b3d40', '#2f3134', '#46484b', '#36383a'].map((q) => new THREE.Color(q));
      let made = 0;
      for (let j = 0; j < 160 && made < 16; j++) {
        const a = r() * 6.28;
        const d = 30 + r() * 200;
        const x = px + Math.cos(a) * d;
        const z = pz + Math.sin(a) * d;
        const tall = r() < 0.55;
        const s = 0.8 + r() * 0.6;
        const pr = c.probe;
        // Le basalte peut descendre jusqu'au rivage, pas dans la mer.
        if (!freeSpot(pr, x, z, 2.3 * s, 0.35) || pr.urban > 0.3 || pr.treeNear(x, z, 2 * s)) continue;
        const y = pr.heightAt(x, z);
        if (!Number.isFinite(y) || y < 0.3) continue;
        const yaw = r() * 6.28;
        c.mesh.put(tall ? K.organ : K.organLow, x, y, z, yaw, s, s * (0.8 + r() * 0.5), s, greys[Math.floor(r() * greys.length)]!);
        // Un pavé de colonnes rases au pied des grands faisceaux.
        if (tall) {
          const qx = x + Math.cos(yaw) * 4.2 * s;
          const qz = z - Math.sin(yaw) * 4.2 * s;
          const qy = pr.heightAt(qx, qz);
          if (Number.isFinite(qy) && qy > 0.3 && freeSpot(pr, qx, qz, 2 * s, 0.35)) c.mesh.put(K.organLow, qx, qy, qz, yaw + 0.5, s, s, s, greys[Math.floor(r() * greys.length)]!);
        }
        made++;
        if (made % 4 === 0) yield;
      }
    },
  };
}

/**
 * Lupins bleu-violet (quelques roses et blancs) en touffes et grandes touffes, au bord des rues (chaussée à moins
 * de 5 m) et en haut des plages (sable à moins de 9 m), jamais sur la chaussée ni sur le sable. `meadow` : prairie
 * de lupins, partout sur la terre ouverte (sans bord de route), comme les pentes bleues des étés islandais.
 */
function flowerPatch(k: () => Kit, id: string, x0: number, z0: number, R: number, tries: number, seed: number, meadow = false): Site {
  return {
    id,
    x: x0,
    z: z0,
    reach: R + 500,
    needs: [[x0, z0]],
    *build(c) {
      const K = k();
      const r = rng(seed);
      const colours = ['#5b4fc4', '#6c5cd6', '#4f63c8', '#7a63c9', '#5b4fc4', '#6c5cd6', '#d58fbf', '#efeaf4'].map((q) => new THREE.Color(q));
      const n = Math.round(tries * (c.density < 0.7 ? 0.6 : 1));
      const pr = c.probe;
      let made = 0;
      for (let j = 0; j < n && made < (meadow ? 150 : 220); j++) {
        if (j % 80 === 79) yield;
        const a = r() * 6.28;
        const d = Math.sqrt(r()) * R;
        const x = x0 + Math.cos(a) * d;
        const z = z0 + Math.sin(a) * d;
        if (!pr.read(x, z) || pr.road >= 0.02 || pr.water > 0.1 || pr.sand > 0.5) continue;
        let edge = meadow && pr.open(x, z);
        if (!edge) for (const [dx, dz] of RING8) {
          if ((pr.read(x + dx * 5, z + dz * 5) && pr.road > 0.3) || (pr.read(x + dx * 9, z + dz * 9) && pr.sand > 0.5)) {
            edge = true;
            break;
          }
        }
        if (!edge) continue;
        const col = colours[Math.floor(r() * colours.length)]!;
        const count = 1 + Math.floor(r() * 3);
        for (let q = 0; q < count; q++) {
          const fx = x + (q ? (r() - 0.5) * 3 : 0);
          const fz = z + (q ? (r() - 0.5) * 3 : 0);
          if (!freeSpot(pr, fx, fz, 0.9) || pr.sand > 0.5 || pr.treeNear(fx, fz, 1.2)) continue;
          const y = pr.heightAt(fx, fz);
          if (!Number.isFinite(y) || y < 0.3) continue;
          const bush = r() < (meadow ? 0.5 : 0.3);
          const s = 0.8 + r() * 0.5;
          c.mesh.put(bush ? K.bush : K.tuft, fx, y - 0.05, fz, r() * 6.28, s, s, s, q && r() < 0.3 ? colours[Math.floor(r() * colours.length)]! : col);
          // Papillons (skyLife) sur les touffes.
          if (q === 0) c.flowers.push(fx, y + 0.4, fz);
          made++;
        }
      }
    },
  };
}

// ───────────────────────────── Cascades, églises, maisons de tôle, aiguilles

/**
 * Cascades (relevées sur le relief du générateur : plus forte chute locale, sens de la pente `a`) : falaises de la
 * côte, rebord du plateau des Orgues, ressauts des rivières. `w` : largeur du ruban d'eau (m).
 */
const FALLS: ReadonlyArray<{ id: string; x: number; z: number; a: number; w: number }> = [
  { id: 'cascade-des-orgues', x: 15860, z: -4285, a: 1.96, w: 7 },
  { id: 'cascade-de-la-ravine', x: 1895, z: -4354, a: -0.18, w: 5 },
  { id: 'cascade-des-vignes', x: -8143, z: -5672, a: -2.68, w: 4.5 },
  { id: 'cascade-du-cap', x: 18410, z: -3655, a: 0.39, w: 4 },
  { id: 'cascade-des-falaises', x: 15155, z: -7630, a: 3.93, w: 5 },
  { id: 'cascade-du-sud', x: 6275, z: -9040, a: 4.71, w: 6 },
  { id: 'cascade-de-l-ouest', x: -6025, z: 9755, a: 1.57, w: 4 },
];

/**
 * Cascade : le profil du sol est relu dans le sens de la pente (pas de 1 m), la chute est le tronçon le plus raide ;
 * deux rubans d'eau (cœur blanc, voile bleu pâle) le suivent juste au-dessus du sol, de la lèvre au pied (ou à la
 * mer), avec écume, vasque, embruns et paquets d'eau qui tombent. Rien si la chute fait moins de 3 m ou si une
 * chaussée passe dessous.
 */
function waterfall(k: () => Kit, f: (typeof FALLS)[number]): Site {
  const ux = Math.cos(f.a);
  const uz = Math.sin(f.a);
  return {
    id: f.id,
    x: f.x,
    z: f.z,
    reach: 1600,
    needs: [[f.x - ux * 30, f.z - uz * 30], [f.x + ux * 60, f.z + uz * 60]],
    *build(c) {
      const K = k();
      const pr = c.probe;
      const T0 = -30;
      const hs: number[] = [];
      for (let t = T0; t <= 60; t++) hs.push(pr.heightAt(f.x + ux * t, f.z + uz * t));
      if (hs.some((h) => !Number.isFinite(h))) return;
      // Tronçon le plus raide (sur 4 m), puis lèvre et pied là où la pente retombe sous 0,25 m/m.
      let kMax = 2;
      for (let i = 2; i + 2 < hs.length; i++) if (hs[i - 2]! - hs[i + 2]! > hs[kMax - 2]! - hs[kMax + 2]!) kMax = i;
      let top = kMax;
      while (top > 0 && hs[top - 1]! - hs[top]! > 0.25) top--;
      let bot = kMax;
      while (bot + 1 < hs.length && hs[bot]! - hs[bot + 1]! > 0.25 && hs[bot]! > 0.2) bot++;
      const level = (i: number) => Math.max(hs[i]!, 0);
      const drop = level(top) - level(bot);
      if (drop < 3) return;
      // Jamais sur une chaussée ni contre un bâtiment, de la lèvre au pied.
      for (let i = Math.max(0, top - 2); i <= bot; i++) {
        const x = f.x + ux * (i + T0);
        const z = f.z + uz * (i + T0);
        if (!pr.read(x, z) || pr.road >= 0.02 || pr.buildingNear(x, z, f.w)) return;
      }
      yield;
      // Rubans : un tronçon par mètre, décollés du sol (assez pour passer les bosses entre deux échantillons).
      const px = -uz;
      const pz = ux;
      const core = new THREE.Color('#eef6f8');
      const veil = new THREE.Color('#a9d3de');
      const pts: number[] = [];
      for (let i = top - 1; i <= bot; i++) {
        const t = Math.max(0, i) + T0;
        pts.push(f.x + ux * t, level(Math.max(0, i)), f.z + uz * t);
      }
      for (const [w, lift, col] of [[f.w, 0.35, veil], [f.w * 0.55, 0.5, core]] as const) {
        for (let j = 0; j + 5 < pts.length; j += 3) {
          const x0 = pts[j]!;
          const y0 = pts[j + 1]! + lift;
          const z0 = pts[j + 2]!;
          const bx = pts[j + 3]! - x0;
          const by = pts[j + 4]! + lift - y0;
          const bz = pts[j + 5]! - z0;
          // Normale du ruban : B × A (A en travers, à plat), à l'échelle 1.
          let nx = by * pz;
          let ny = bz * px - bx * pz;
          let nz = -by * px;
          const nl = Math.hypot(nx, ny, nz) || 1;
          nx /= nl;
          ny /= nl;
          nz /= nl;
          c.mesh.putBasis(K.sheet, x0, y0, z0, px * w, 0, pz * w, bx, by, bz, nx, ny, nz, col.r, col.g, col.b);
        }
      }
      // Pied : écume, vasque (pas en mer), embruns, paquets d'eau qui tombent le long du ruban.
      const fx = pts[pts.length - 3]!;
      const fy = pts[pts.length - 2]!;
      const fz = pts[pts.length - 1]!;
      const sea = hs[bot]! < 0.3;
      if (!sea) c.mesh.put(K.plunge, fx + ux * 1.5, fy + 0.06, fz + uz * 1.5, 0, f.w * 0.9, 1, f.w * 0.8, new THREE.Color('#8cc3cf'));
      c.mesh.put(K.foam, fx + ux * 0.8, fy + 0.1, fz + uz * 0.8, f.a, f.w * 0.3, 0.8, f.w * 0.3, WHITE);
      puffs(c, K, 'archipel-embruns', fx + ux * 1.5, fy + 0.5, fz + uz * 1.5, { n: 6, rise: Math.min(10, drop * 0.5), size: 0.9 + f.w * 0.18, drift: [ux * 4, uz * 4], period: 5.5, spread: f.w * 0.6, colour: '#f4f8f8', seed: Math.round(f.x) });
      const r = rng(Math.round(f.z));
      const n = pts.length / 3;
      for (let i = 0; i < 4; i++) {
        const m = meshOf([{ t: K.puff, x: 0, y: 0, z: 0, c: core }], c.mat);
        m.name = 'archipel-cascade';
        m.castShadow = false;
        const ph = r();
        const lat = (r() - 0.5) * f.w * 0.5;
        c.moving.push({
          object: m,
          step: (time) => {
            const q = (time * 0.9 + ph) % 1;
            const s = q * (n - 1);
            const a = Math.floor(s);
            const b = Math.min(n - 1, a + 1);
            const u = s - a;
            m.position.set(pts[a * 3]! + (pts[b * 3]! - pts[a * 3]!) * u + px * lat, pts[a * 3 + 1]! + (pts[b * 3 + 1]! - pts[a * 3 + 1]!) * u + 0.6, pts[a * 3 + 2]! + (pts[b * 3 + 2]! - pts[a * 3 + 2]!) * u + pz * lat);
            m.scale.set(0.35 + f.w * 0.05, 0.7, 0.35 + f.w * 0.05);
          },
        });
      }
      // Promeneurs venus voir la cascade, au pied (pas en mer).
      if (!sea) strollPath(c, [[fx + ux * 12 - px * 10, fz + uz * 12 - pz * 10], [fx + ux * 14 + px * 10, fz + uz * 14 + pz * 10], [fx + ux * 12 - px * 10, fz + uz * 12 - pz * 10]], Math.round(f.x) + 7);
    },
  };
}

/**
 * Emplacement plat et libre près d'un point de route (entre `rMin` et `rMax` m), pour un objet de rayon `rad` :
 * jamais sur une chaussée, ni dans l'eau, le bois, le sable ou contre un bâtiment ; pente < `slope` m sur le rayon.
 * Renvoie (x, y le plus bas des quatre coins, z) ou null.
 */
function flatSpot(pr: SiteContext['probe'], x0: number, z0: number, rMin: number, rMax: number, rad: number, seed: number, slope = 1.6): [number, number, number] | null {
  const r = rng(seed);
  for (let i = 0; i < 90; i++) {
    const a = r() * 6.28;
    const d = rMin + r() * (rMax - rMin);
    const x = x0 + Math.cos(a) * d;
    const z = z0 + Math.sin(a) * d;
    if (!freeSpot(pr, x, z, rad, 0.05) || pr.forest > 0.3 || pr.sand > 0.3 || pr.treeNear(x, z, rad)) continue;
    const ys = [pr.heightAt(x, z), ...RING4.map(([dx, dz]) => pr.heightAt(x + dx * rad, z + dz * rad))];
    if (ys.some((y) => !Number.isFinite(y))) continue;
    const lo = Math.min(...ys);
    if (Math.max(...ys) - lo > slope || lo < 1) continue;
    return [x, lo - 0.15, z];
  }
  return null;
}

/** Églises blanches à toit rouge, porte tournée vers la route : celle de Sainte-Iris et trois isolées sur la côte. */
const CHURCHES: ReadonlyArray<{ id: string; x: number; z: number; rMin: number; rMax: number }> = [
  { id: 'eglise-de-sainte-iris', x: -389, z: 7902, rMin: 60, rMax: 380 },
  { id: 'eglise-de-la-grande-anse', x: 16015, z: 9804, rMin: 30, rMax: 120 },
  { id: 'eglise-des-cendres', x: -12148, z: 240, rMin: 30, rMax: 120 },
  { id: 'eglise-du-pont', x: 10668, z: -4154, rMin: 30, rMax: 120 },
];

function church(k: () => Kit, ch: (typeof CHURCHES)[number]): Site {
  return {
    id: ch.id,
    x: ch.x,
    z: ch.z,
    reach: 2200,
    needs: [[ch.x, ch.z], [ch.x + ch.rMax, ch.z], [ch.x - ch.rMax, ch.z], [ch.x, ch.z + ch.rMax], [ch.x, ch.z - ch.rMax]],
    *build(c) {
      const K = k();
      yield;
      const at = flatSpot(c.probe, ch.x, ch.z, ch.rMin, ch.rMax, 16, Math.round(ch.x * 7 + ch.z), 2.2);
      if (!at) return;
      const [x, y, z] = at;
      const yaw = Math.atan2(ch.x - x, ch.z - z);
      c.mesh.put(K.churchyard, x, y, z, yaw, 1, 1, 1, WHITE);
      c.mesh.put(K.church, x, y, z, yaw, 1, 1, 1, WHITE);
      // Paroissiens devant la porte.
      for (let s = 0; s < 3; s++) {
        const d = 16 + s * 1.2;
        c.spots.push({ kind: 'villager', x: x + Math.sin(yaw) * d + Math.cos(yaw) * (s - 1) * 1.4, y: c.probe.heightAt(x + Math.sin(yaw) * d, z + Math.cos(yaw) * d), z: z + Math.cos(yaw) * d - Math.sin(yaw) * (s - 1) * 1.4, yaw: yaw + Math.PI, seed: (s * 0.31 + x * 0.001) % 1 });
      }
    },
  };
}

/** Maisons isolées en tôle (et leur remise) au bord des routes de campagne, loin des villages. */
const TIN_HOMES: ReadonlyArray<readonly [number, number]> = [
  [8291, 4450], [14310, -5630], [11806, 9796], [-1955, 7429], [7170, 7270], [16606, -7161], [-11047, 2593],
  [1991, 7810], [15661, -1427], [-7912, 7170], [8875, -5486], [13664, 7734], [-9550, -4565], [4751, 8279],
];
const TIN_WALL_TINTS = ['#f3f2ed', '#ebe6d6', '#dfe3e2', '#efe1ad', '#b5443a', '#33363a', '#f3f2ed'].map((q) => new THREE.Color(q));
const TIN_SHED_TINTS = ['#a8402f', '#8f3a2c', '#33363a', '#b3332b'].map((q) => new THREE.Color(q));

function tinHome(k: () => Kit, i: number, x0: number, z0: number): Site {
  return {
    id: `maison-de-tole-${i}`,
    x: x0,
    z: z0,
    reach: 1400,
    needs: [[x0, z0], [x0 + 90, z0], [x0 - 90, z0], [x0, z0 + 90], [x0, z0 - 90]],
    *build(c) {
      const K = k();
      const r = rng(7300 + i * 29);
      yield;
      const at = flatSpot(c.probe, x0, z0, 22, 90, 7, 7400 + i * 31);
      if (!at) return;
      const [x, y, z] = at;
      const yaw = Math.atan2(x0 - x, z0 - z) + (r() - 0.5) * 0.4;
      c.mesh.put(K.tin[Math.floor(r() * K.tin.length)]!, x, y, z, yaw, 1, 0.95 + r() * 0.15, 1, TIN_WALL_TINTS[Math.floor(r() * TIN_WALL_TINTS.length)]!);
      // Remise à côté, si la place est libre.
      const sx = x + Math.cos(yaw) * 9;
      const sz = z - Math.sin(yaw) * 9;
      if (freeSpot(c.probe, sx, sz, 3.5, 0.05)) {
        const sy = c.probe.heightAt(sx, sz);
        if (Number.isFinite(sy) && Math.abs(sy - y) < 1.5) c.mesh.put(K.tinShed, sx, Math.min(sy, y + 0.15) - 0.1, sz, yaw + Math.PI / 2, 1, 1, 1, TIN_SHED_TINTS[Math.floor(r() * TIN_SHED_TINTS.length)]!);
      }
    },
  };
}

/** Aiguilles de basalte au large des plages de sable noir (Plage des Cendres, Sable-Noir, Grande Anse). */
function seaStacks(k: () => Kit, id: string, x0: number, z0: number, seed: number): Site {
  return {
    id,
    x: x0,
    z: z0,
    reach: 3500,
    needs: [[x0, z0]],
    *build(c) {
      const K = k();
      const pr = c.probe;
      const r = rng(seed);
      // Direction de la mer la plus proche (24 caps, pas de 10 m, jusqu'à 900 m).
      let best = { d: Infinity, a: 0 };
      for (let q = 0; q < 24; q++) {
        const a = (q / 24) * Math.PI * 2;
        for (let d = 0; d < 900; d += 10) {
          const h = pr.heightAt(x0 + Math.cos(a) * d, z0 + Math.sin(a) * d);
          if (!Number.isFinite(h)) break;
          if (h < -2.5) {
            if (d < best.d) best = { d, a };
            break;
          }
        }
      }
      if (!Number.isFinite(best.d)) return;
      yield;
      const tints = ['#2a2827', '#34312f', '#232120'].map((q) => new THREE.Color(q));
      let made = 0;
      for (let j = 0; j < 30 && made < 5; j++) {
        const a = best.a + (r() - 0.5) * 0.7;
        const d = best.d + 40 + r() * 160;
        const x = x0 + Math.cos(a) * d;
        const z = z0 + Math.sin(a) * d;
        const h = pr.heightAt(x, z);
        if (!Number.isFinite(h) || h > -2 || h < -18) continue;
        if (pr.read(x, z) && pr.road >= 0.02) continue;
        const tall = 12 + r() * 14;
        const s = 0.6 + r() * 0.6;
        c.mesh.put(K.seaStack, x, h - 0.5, z, r() * 6.28, s, (tall - h) / 20, s, tints[Math.floor(r() * tints.length)]!);
        // Oiseaux de mer sur la coiffe.
        c.perches.push({ pts: new Float32Array([x + 0.5 * s, tall + 0.3, z, x - 0.4 * s, tall + 0.2, z + 0.5 * s]), yaw: r() * 6, ground: true, x, z, gull: true });
        made++;
      }
    },
  };
}

/** Lieux de l'Archipel (voir le haut du fichier). */
export function archipelSites(): Site[] {
  let templates: Kit | undefined;
  let harbours: HarbourTemplates | undefined;
  const k = () => (templates ??= kit());
  const h = () => (harbours ??= harbourTemplates());
  const sites: Site[] = [plume(k), thermalPools(k), bridge(k), causeway(k), lighthouse(k), bikePark(k), cycloCross(k), circuit(k), summit(k)];
  for (const [i, f] of A.fumaroles.entries()) sites.push(fumaroles(k, `fumerolles-${i}`, f[0], f[1], f[2], f[3], 6100 + i * 17));
  for (const hb of A.harbours) {
    const site: HarbourSite = { x: hb.x, z: hb.z, dir: hb.dir, halfLen: hb.halfLen, halfWid: hb.halfWid, side: hb.side as 1 | -1, lines: hb.lines, officeW: 26, officeU: -hb.halfLen * 0.7, sail: hb.sail, fishing: hb.fishing, hulls: hb.hulls };
    sites.push(harbourSite(`port-${hb.id}`, site, 750, h));
    sites.push(boatsOffshore(k, `large-${hb.id}`, hb, hb.offshore, hb.sail));
  }
  // Champs de lave : un lieu tous les ≈ 1 400 m le long de chaque coulée.
  let li = 0;
  for (const f of A.lava) {
    for (let s = 0; s + 1 < f.pts.length; s++) {
      const [ax, az] = f.pts[s]!;
      const [bx, bz] = f.pts[s + 1]!;
      const L = Math.hypot(bx - ax, bz - az);
      for (let d = 500; d < L; d += 1400) sites.push(lavaField(k, f, ax + ((bx - ax) * d) / L, az + ((bz - az) * d) / L, li++));
    }
  }
  // Bourrelets des coulées : des lieux d'environ 700 m bout à bout sur chaque tronçon.
  let bi = 0;
  for (const f of A.lava) {
    for (let s = 0; s + 1 < f.pts.length; s++) {
      const [ax, az] = f.pts[s]!;
      const [bx, bz] = f.pts[s + 1]!;
      const L = Math.hypot(bx - ax, bz - az);
      const ux = (bx - ax) / L;
      const uz = (bz - az) / L;
      const m = Math.max(1, Math.round(L / 700));
      for (let j = 0; j < m; j++) {
        const d = ((j + 0.5) * L) / m;
        sites.push(lavaLevee(k, f, ax + ux * d, az + uz * d, ux, uz, L / m / 2, bi++));
      }
    }
  }
  // Pentes du volcan : trois couronnes de lieux autour du cratère.
  let vi = 0;
  for (const [R, m] of [[850, 6], [1350, 9], [1950, 12]] as const) {
    for (let j = 0; j < m; j++) {
      const a = (j / m) * Math.PI * 2 + R * 0.001;
      sites.push(volcanoSlope(k, vi++, A.volcano.x + Math.cos(a) * R, A.volcano.z + Math.sin(a) * R));
    }
  }
  sites.push(basaltOrgans(k));
  // Lupins : rues de Sainte-Iris, front de mer et Plage des Cendres, village et plages de Sable-Noir ; prairies de
  // lupins le long des routes de la Plaine, de Port-Lave, du plateau des Orgues et de Sable-Noir.
  sites.push(flowerPatch(k, 'lupins-sainte-iris', -389, 7902, 520, 900, 8181));
  sites.push(flowerPatch(k, 'lupins-plage-des-cendres', -850, 8560, 650, 900, 8282));
  sites.push(flowerPatch(k, 'lupins-sable-noir', 12900, 8900, 550, 700, 8383));
  for (const [i, [x, z]] of ([[-6459, 5089], [-7912, 7170], [-4511, 8150], [14310, -5630], [16155, 7508], [7170, 7270]] as const).entries()) {
    sites.push(flowerPatch(k, `prairie-de-lupins-${i}`, x, z, 260, 520, 8400 + i * 13, true));
  }
  // Identité islandaise : cascades, églises blanches, maisons de tôle, aiguilles de basalte au large du sable noir.
  for (const f of FALLS) sites.push(waterfall(k, f));
  for (const ch of CHURCHES) sites.push(church(k, ch));
  for (const [i, [x, z]] of TIN_HOMES.entries()) sites.push(tinHome(k, i, x, z));
  sites.push(seaStacks(k, 'aiguilles-des-cendres', -418, 8482, 6601));
  sites.push(seaStacks(k, 'aiguilles-de-sable-noir', 11806, 9796, 6602));
  sites.push(seaStacks(k, 'aiguilles-de-la-grande-anse', 16015, 9804, 6603));
  if (A.promenade.length) sites.push(seafront(k, 'front-de-mer-sainte-iris', A.promenade, A.promenadeSea, 6, 7070));
  if (A.sableNoirStreet.length) sites.push(seafront(k, 'rue-de-sable-noir', A.sableNoirStreet, 1, 8, 7171));
  return sites;
}

/** Pas de clôtures ni poteaux : promenade de Sainte-Iris, quais, pont et chaussée, Circuit. */
export function archipelNoFence(x: number, z: number): boolean {
  if (Math.hypot(x - A.promenadeCentre[0], z - A.promenadeCentre[1]) < 1500) return true;
  for (const hb of A.harbours) if (Math.hypot(x - hb.x, z - hb.z) < hb.halfLen + 200) return true;
  for (const L of [A.bridge, A.causeway]) {
    for (let i = 0; i < L.length; i += 3) if (Math.abs(x - L[i]!) < 120 && Math.abs(z - L[i + 2]!) < 120) return true;
  }
  return false;
}
