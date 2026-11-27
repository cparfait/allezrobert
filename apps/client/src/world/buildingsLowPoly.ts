import * as THREE from 'three/webgpu';
import { attribute, frontFacing, uv, fract, floor, step, mix, vec3, vec4, float, int, max, min, abs, hash, mrt, smoothstep, fwidth, type uniformArray } from 'three/tsl';
import { windowLamp } from './windowLighting.ts';

type ArchArray = ReturnType<typeof uniformArray>;

/**
 * Matériau des bâtiments en style jeu vidéo (low poly) : mêmes attributs que le matériau réaliste
 * (buildings.ts : `color`, `accent`, `binfo`, `facade`, `bstyle`, uv en mètres) et même placement des
 * baies, mais tout en aplats : enduit à la teinte de la maison, soubassement plus sombre, vitres bleu
 * franc à deux tons sous un encadrement clair, volets et portes à la couleur d'accent, toits unis.
 * Aucune texture (les photos et cartes de normales du matériau réaliste ne sont jamais demandées), aucun
 * motif plus fin qu'un pixel qui scintillerait au loin (tuiles, lames, gravillons, mousse, rouille).
 * Styles de façade non européens (`bstyle.z` = drapeaux + 8 × code, voir buildings.ts) : terre crue, maison de bois
 * asiatique, bois peint nordique ; sans style (code 0), toutes leurs retouches valent zéro et la façade est inchangée.
 */
export function createLowPolyBuildingMaterial(night: THREE.UniformNode<'float', number>, archAArr: ArchArray, archBArr: ArchArray, archCArr: ArchArray): THREE.MeshStandardNodeMaterial {
  const m = new THREE.MeshStandardNodeMaterial({ vertexColors: true });
  m.flatShading = true;
  const info = attribute<'vec3'>('binfo'); // type, matériau du mur, fenêtres + 4 × archétype
  const kind = info.x;
  const base = attribute<'vec3'>('color');
  const accent = attribute<'vec3'>('accent');
  const facade = attribute<'vec2'>('facade'); // longueur du mur, travées (+ hauteur d'étage ÷ 10)
  const bstyle = attribute<'vec4'>('bstyle'); // style local, hauteur du mur, drapeaux, travée de la porte + 1
  const isLocal = bstyle.x;
  const wallH = bstyle.y;
  const u = uv().x;
  const v = uv().y;
  // Taille d'un pixel sur la façade : les petits-bois (seul trait fin) s'effacent avant de scintiller.
  const pix = max(fwidth(u), fwidth(v));
  const isWall = step(kind, float(0.5));
  const isMetal = step(float(2.5), kind).mul(step(kind, float(3.5)));
  const isRoof = step(float(0.5), kind);
  // Codes entiers lus avec une marge (interpolés entre sommets, voir buildings.ts).
  const archIdx = floor(info.z.add(0.01).div(4));
  const winCode = info.z.sub(archIdx.mul(4));
  const isArch = step(float(0.5), archIdx);
  const aI = int(archIdx);
  const archA = archAArr.element(aI) as unknown as THREE.Node<'vec4'>; // demi-largeur, hauteur des fenêtres, allège, rez-de-chaussée
  const archB = archBArr.element(aI) as unknown as THREE.Node<'vec4'>; // volets, balcons, bandeaux, petits-bois
  const archC = archCArr.element(aI) as unknown as THREE.Node<'vec4'>; // encadrement, corniche
  const genoiseOn = floor(bstyle.z.add(0.01)).mod(2);
  // bstyle.z = drapeaux (1 génoise + 2 côté rue + 4 vitrine) + 8 × style de façade (0 aucun, 1 terre crue,
  // 2 maison de bois asiatique, 3 bois peint nordique) ; la parité (génoise) ne bouge pas.
  const facadeCode = floor(bstyle.z.add(0.01).div(8));
  const shopOn = step(float(3.5), bstyle.z.sub(facadeCode.mul(8)));
  const isAdobe = step(abs(facadeCode.sub(1)), float(0.5));
  const isAsian = step(abs(facadeCode.sub(2)), float(0.5));
  const isTimber = step(abs(facadeCode.sub(3)), float(0.5));
  const noStyle = float(1).sub(step(float(0.5), facadeCode));
  const windowed = step(float(0.5), winCode).mul(step(winCode, float(1.5)));
  const isStone = step(float(0.5), info.y).mul(step(info.y, float(1.5)));
  const aboveGround = step(float(0), v);

  // ── Mur : aplat de la teinte de la maison, soubassement (0,6 m) plus sombre sur les murs à baies ──
  const houseWall = isWall.mul(step(float(0.5), winCode));
  let wall: THREE.Node<'vec3'> = mix(base, base.mul(0.78), step(v, float(0.6)).mul(houseWall));
  const wallLight = base.mul(1.14).min(1);
  // Motifs propres aux styles de façade (planches, poutres, claustra) lissés sur le pixel et effacés au loin.
  const fine = float(1).sub(smoothstep(0.02, 0.05, pix));
  const aa = (edge: THREE.Node<'float'>, x: THREE.Node<'float'>) => smoothstep(edge.sub(pix), edge.add(pix), x);
  const styledWall = isWall.mul(aboveGround);
  // Terre crue : angles arrondis suggérés (le mur s'assombrit sur ses 35 derniers centimètres).
  const edgeDist = min(u, facade.x.sub(u));
  wall = mix(wall, wall.mul(mix(float(0.86), float(1), smoothstep(0.0, 0.35, edgeDist))), isAdobe.mul(styledWall));
  // Maison de bois asiatique : soubassement sombre (socle de pierre, 0,8 m) et poutre sombre sous le toit (25 cm).
  wall = mix(wall, vec3(0.16, 0.15, 0.14), isAsian.mul(isWall).mul(step(v, float(0.8))));
  wall = mix(wall, base.mul(0.55), isAsian.mul(styledWall).mul(step(wallH.sub(0.25), v)));
  // Bois peint nordique : planches verticales de 20 cm (joint plus sombre), planches d'angle blanches de 15 cm.
  const plankD = abs(fract(u.div(0.2)).sub(0.5)).mul(0.2);
  const plankJoint = float(1).sub(aa(float(0.012), plankD)).mul(fine).mul(step(float(0.6), v));
  wall = mix(wall, wall.mul(0.82), plankJoint.mul(isTimber).mul(styledWall));
  const cornerBoard = float(1).sub(aa(float(0.15), edgeDist)).mul(step(float(0.6), v));
  wall = mix(wall, vec3(0.93, 0.92, 0.9), cornerBoard.mul(isTimber).mul(styledWall));

  // ── Baies : même placement que le matériau réaliste (travées, étages, archétypes) ──
  const bays = max(floor(facade.y.add(0.0004)), float(0.0001));
  const local = fract(u.div(facade.x).mul(bays));
  const bayW = facade.x.div(bays);
  const bayIdx = floor(u.div(facade.x).mul(bays));
  const wx = local.sub(0.5).mul(bayW);
  const fhA = max(facade.y.sub(floor(facade.y.add(0.0004))).mul(10), float(2.4));
  const rdc = archA.w.mul(isArch);
  const hasRdc = step(float(0.01), rdc);
  const flA = floor(v.sub(rdc).div(fhA));
  const floorBase = rdc.add(flA.mul(fhA));
  const zF = v.sub(floorBase);
  const floorNo = flA.add(hasRdc);
  const floorIdx = mix(floor(v.sub(0.9).div(2.8)), floorNo, isArch);
  const fy = mix(fract(v.sub(0.9).div(2.8)).mul(2.8), zF.sub(archA.z), isArch);
  const winH = mix(mix(float(1.35), archA.y, isArch), float(0.95), isAdobe);
  const doorBay = bstyle.w;
  const isDoorBay = step(float(0.5), doorBay).mul(step(abs(bayIdx.add(1).sub(doorBay)), float(0.5)));
  // Terre crue : petites fenêtres (70 × 95 cm).
  const halfW = mix(mix(mix(float(0.5), float(0.42), isLocal.mul(isStone)), archA.x, isArch), float(0.35), isAdobe);
  const archRow = step(rdc, v).mul(step(floorBase.add(archA.z).add(archA.y), wallH.sub(archC.y.mul(0.45)).sub(0.08)));
  // Encadrement plus large qu'en réaliste (12 cm) : il reste lisible de loin.
  const fm = mix(mix(float(0.12), max(archC.x, float(0.1)), isArch), float(0.08), isAdobe);
  // Fenêtre entière sous le haut du mur (pas de baie coupée par l'égout).
  const fits = step(v.sub(fy).add(winH).add(fm), wallH);
  const winCol = step(float(0.5), facade.y)
    .mul(windowed)
    .mul(mix(step(0.9, v), archRow, isArch))
    .mul(float(1).sub(isDoorBay.mul(step(floorIdx, float(0.5)))))
    .mul(max(step(v, wallH.sub(genoiseOn.mul(0.5))), step(isLocal, float(0.5))))
    .mul(fits)
    .mul(aboveGround);
  const hasWin = winCol.mul(step(float(0), fy));
  const inWin = step(abs(wx), halfW).mul(step(fy, winH)).mul(hasWin);
  const inFrame = step(abs(wx), halfW.add(fm)).mul(step(fy, winH.add(fm))).mul(step(fm.negate(), fy)).mul(winCol);
  const shutterX = abs(wx);
  const inShutter = step(halfW.add(fm).add(0.04), shutterX)
    .mul(step(shutterX, halfW.mul(2).add(fm).add(0.04)))
    .mul(step(fy, winH.add(0.03)))
    .mul(hasWin)
    .mul(mix(float(1), archB.x, isArch))
    // ni volets pour les styles de façade non européens
    .mul(noStyle);
  // Tirage constant dans toute la baie, même si elle chevauche une cellule du monde.
  const facadeSeed = floor(facade.x.mul(64)).add(floor(wallH.mul(64)).mul(17))
    .add(floor(base.r.mul(255)).mul(37)).add(floor(base.g.mul(255)).mul(157)).add(floor(base.b.mul(255)).mul(251));
  const roomSeed = facadeSeed.add(bayIdx.mul(107)).add(floorIdx.add(64).mul(607));
  const lit = step(0.66, hash(roomSeed)).mul(night);
  const lamp = windowLamp(roomSeed.add(1901));
  // Vitre en deux aplats : bleu soutenu en bas, reflet du ciel plus clair en haut ; croisillon blanc.
  const paneSplit = winH.mul(0.62);
  const paneDay = mix(vec3(0.028, 0.06, 0.15), vec3(0.09, 0.18, 0.34), step(paneSplit, fy));
  const pane = mix(paneDay, lamp.mul(0.22), lit);
  // Encadrement (sert aussi aux portes) : clair d'origine, ombre du mur sur la terre crue, bois sombre chez les
  // maisons de bois, blanc du bois peint nordique.
  const frameCol = mix(mix(mix(vec3(0.9, 0.88, 0.83), base.mul(0.72), isAdobe), base.mul(0.42).add(vec3(0.03, 0.02, 0.01)), isAsian), vec3(0.95, 0.94, 0.92), isTimber);
  // Croisillon blanc (ni sur la terre crue ni chez les maisons de bois, qui ont leur claustra).
  const bars = max(step(abs(wx), float(0.035)), step(abs(fy.sub(paneSplit)), float(0.03))).mul(float(1).sub(smoothstep(0.02, 0.05, pix))).mul(float(1).sub(isAdobe).sub(isAsian));
  // Vitre : brun-noir sur la terre crue (ouverture profonde) ; papier clair derrière une claustra de bois (carreaux
  // de 22 cm) chez les maisons de bois, fondue vers sa teinte moyenne au loin.
  const latticeD = max(abs(fract(wx.div(0.22)).sub(0.5)), abs(fract(fy.div(0.22)).sub(0.5))).mul(0.22);
  const lattice = mix(float(1).sub(aa(float(0.088), latticeD)), float(0.35), float(1).sub(fine));
  const paper = mix(vec3(0.8, 0.7, 0.52), frameCol, lattice);
  const styledPane = mix(mix(pane, mix(vec3(0.045, 0.035, 0.03), lamp.mul(0.22), lit), isAdobe), mix(paper, mix(frameCol, lamp.mul(0.3), lattice.oneMinus()), lit), isAsian);

  // Corniche des archétypes : bandeau clair sous l'égout.
  const orn = isArch.mul(isWall).mul(windowed).mul(step(float(0.5), wallH)).mul(step(float(0.5), facade.y)).mul(aboveGround);
  wall = mix(wall, wallLight, orn.mul(archC.y).mul(step(wallH.sub(v), float(0.38))));
  wall = mix(wall, accent, inShutter.mul(float(1).sub(inWin)));
  wall = mix(wall, frameCol, inFrame.mul(float(1).sub(inWin)));
  wall = mix(wall, mix(styledPane, frameCol, bars), inWin);
  // Terre crue : bouts de poutres (vigas) sous le toit plat, 16 cm tous les 90 cm, et leur ombre sur le mur.
  const vigaX = abs(fract(u.div(0.9)).sub(0.5)).mul(0.9);
  const vigaIn = float(1).sub(aa(float(0.08), vigaX)).mul(step(float(0.9), u)).mul(step(u, facade.x.sub(0.9))).mul(step(float(2.2), wallH));
  const vigaTop = wallH.sub(v);
  const viga = vigaIn.mul(step(float(0.3), vigaTop)).mul(step(vigaTop, float(0.46)));
  const vigaShade = vigaIn.mul(step(float(0.46), vigaTop)).mul(step(vigaTop, float(0.62))).mul(fine);
  wall = mix(wall, wall.mul(0.78), vigaShade.mul(isAdobe).mul(styledWall));
  wall = mix(wall, vec3(0.3, 0.19, 0.11), viga.mul(isAdobe).mul(styledWall));

  // ── Rez-de-chaussée des archétypes : vitrines (bandeau d'enseigne de couleur vive) ou hautes fenêtres ──
  const inRdc = isArch.mul(isWall).mul(hasRdc).mul(step(v, rdc.sub(0.3))).mul(step(float(0.5), wallH)).mul(aboveGround);
  const shop = inRdc.mul(shopOn).mul(float(1).sub(isDoorBay)).mul(step(float(0.5), facade.y));
  const glassTop = rdc.sub(1.05);
  const shopFront = shop.mul(step(abs(wx), bayW.mul(0.5).sub(0.04))).mul(step(v, rdc.sub(0.35)));
  const shopGlass = shop.mul(step(abs(wx), bayW.mul(0.5).sub(0.3))).mul(step(float(0.45), v)).mul(step(v, glassTop));
  const signBand = shopFront.mul(step(rdc.sub(0.95), v));
  // Couleur du bâtiment ramenée à 8 bits : même tirage sur toute la façade.
  const shopSeed = hash(floor(base.r.mul(255).add(0.5)).mul(3.573).add(floor(base.g.mul(255).add(0.5)).mul(2.265)).add(floor(base.b.mul(255).add(0.5)).mul(1.031)));
  const signCol = mix(mix(vec3(0.6, 0.06, 0.05), vec3(0.04, 0.32, 0.12), step(0.3, shopSeed)), mix(vec3(0.04, 0.14, 0.5), vec3(0.85, 0.55, 0.05), step(0.8, shopSeed)), step(0.55, shopSeed));
  const shopLit = night.mul(step(0.45, hash(facadeSeed.add(bayIdx.mul(107)).add(945))));
  const shopLamp = windowLamp(facadeSeed.add(bayIdx.mul(107)).add(1979));
  wall = mix(wall, mix(frameCol, signCol, signBand), shopFront);
  wall = mix(wall, mix(paneDay, shopLamp.mul(0.2), shopLit), shopGlass);
  const rdcCol = inRdc.mul(float(1).sub(shopOn)).mul(windowed).mul(float(1).sub(isDoorBay)).mul(step(float(0.5), facade.y));
  const rdcTop = rdc.sub(0.8);
  const rdcWin = rdcCol.mul(step(abs(wx), halfW)).mul(step(float(1.0), v)).mul(step(v, rdcTop));
  const rdcFrame = rdcCol.mul(step(abs(wx), halfW.add(fm))).mul(step(float(1.0).sub(fm), v)).mul(step(v, rdcTop.add(fm))).mul(float(1).sub(rdcWin));
  wall = mix(wall, frameCol, rdcFrame);
  wall = mix(wall, mix(vec3(0.028, 0.06, 0.15), vec3(0.09, 0.18, 0.34), step(rdcTop.sub(0.5), v)), rdcWin);

  // ── Porte d'entrée (travée côté rue) : couleur d'accent, encadrement clair, imposte vitrée ──
  const cochere = isArch.mul(hasRdc);
  const fdW = mix(float(0.55), float(0.75), cochere);
  const fdH = mix(float(2.25), rdc.sub(0.55).min(3.6), cochere);
  const frontOk = isDoorBay.mul(isWall).mul(step(float(0.5), facade.y)).mul(aboveGround);
  const inFront = step(abs(wx), fdW).mul(step(v, fdH)).mul(frontOk);
  const inFrontFrame = step(abs(wx), fdW.add(0.16)).mul(step(v, fdH.add(0.16))).mul(frontOk).mul(float(1).sub(inFront));
  // Imposte vitrée, sauf sur la terre crue et les maisons de bois (porte pleine).
  const transom = step(fdH.sub(0.35), v).mul(float(1).sub(isAdobe).sub(isAsian));
  wall = mix(wall, frameCol, inFrontFrame);
  wall = mix(wall, mix(accent.mul(0.85), paneDay, transom), inFront);

  // ── Porte de grange / garage (annexes) : aplat bois teinté de l'accent, encadrement clair ──
  const wallSeed = hash(floor(facade.x.mul(7.31)));
  const hasDoor = step(float(1.5), winCode).mul(step(float(3.2), facade.x)).mul(step(float(0.45), wallSeed)).mul(aboveGround);
  const doorW = mix(float(1.1), float(2.8), step(float(6), facade.x));
  const doorC = facade.x.mul(wallSeed.mul(0.4).add(0.3));
  const doorH = min(float(2.7), facade.x.mul(0.6));
  const dx = abs(u.sub(doorC));
  const archDoor = isLocal.mul(isStone);
  const rr = dx.div(doorW.mul(0.5)).min(1);
  const archTop = doorH.sub(archDoor.mul(0.55).mul(float(1).sub(float(1).sub(rr.mul(rr)).max(0).sqrt())));
  const inDoor = step(dx, doorW.mul(0.5)).mul(step(v, archTop)).mul(hasDoor);
  const inDoorFrame = step(dx, doorW.mul(0.5).add(0.14)).mul(step(v, archTop.add(0.14))).mul(hasDoor);
  wall = mix(wall, frameCol, inDoorFrame);
  wall = mix(wall, mix(accent, vec3(0.3, 0.16, 0.07), 0.45), inDoor);

  // ── Génoise (style local) : bandeau terre cuite uni sous l'égout ──
  const gz = genoiseOn.mul(isWall).mul(step(wallH.sub(0.45), v)).mul(step(v, wallH.add(0.05)));
  wall = mix(wall, vec3(0.42, 0.15, 0.07), gz);

  // ── Toits : aplat de la couleur du toit ; sous-face du débord (face arrière des pans) à la teinte du mur ──
  const underside = isRoof.mul(float(1).sub(float(frontFacing)));
  let col = mix(wall, base, isRoof);
  col = mix(col, accent, underside);
  m.colorNode = col;
  const paneGlow = mix(float(0.74), float(1), step(paneSplit, fy)).mul(hash(roomSeed.add(4219)).mul(0.25).add(0.24));
  m.emissiveNode = lamp.mul(inWin.mul(lit).mul(float(1).sub(bars)).mul(paneGlow))
    .add(shopLamp.mul(shopGlass.mul(shopLit).mul(0.28))).mul(isWall);
  // Le vitrage s'éclaire dans la scène sans alimenter le halo des phares et lampadaires.
  m.mrtNode = mrt({ emissive: vec4(0) });
  const glazed = inWin.max(shopGlass).max(rdcWin).mul(isWall);
  m.roughnessNode = mix(mix(mix(float(0.92), float(0.3), glazed), float(0.8), isRoof), float(0.55), isMetal).max(underside);
  m.metalnessNode = isMetal.mul(0.15).mul(float(1).sub(underside));
  m.side = THREE.DoubleSide;
  return m;
}
