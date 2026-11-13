import * as THREE from 'three/webgpu';
import { uv, attribute, mix, smoothstep, step, fract, floor, hash, min, vec2, vec3, vec4, float, uniform, mx_noise_float, positionWorld, positionLocal, clamp, abs, max, fwidth, mrt, normalMap, normalView, output, packNormalToRGB, cos } from 'three/tsl';
import { LOW_POLY } from '../engine/style.ts';
import type { LoadedTile, TileRoad } from './types.ts';
import { asphaltGrain } from './asphalt.ts';
import { isRouteTwin } from './splat.ts';
import { chainPieces, ribbonIndex, sideRoadStrips, type RouteFootprint } from './ribbon.ts';
import { cloudShade } from './clouds.ts';
import { LAMP_STRENGTH, LAMP_FROM_CURB, LAMP_LEFT, LAMP_RIGHT, LAMP_SPACING, LAMP_STAGGERED, ROAD_FX, RoadLightingModel, asphaltColor, asphaltGrainSoft, decalShade, lampIsLeft, lampPool, reflectAlpha, rippleNormal, wetAlbedo, wetMasks, wetRoughness } from './roadSurface.ts';
import { LampField, NearLampLights, createLampMaterial, type LampSpot } from './streetLamps.ts';
import { CURB_H, CURB_W, StreetIndex, pushSidewalk, dropShortRuns, refineSidewalkEnds, bevelSidewalkEnds, resampleStrip, trimOverBank, WALK_STRIDE, walkHeight, type EdgeKind, type MeshSink } from './sidewalks.ts';
import { DECAL_CROSSWALK, DECAL_GUTTER, DECAL_OIL, GUTTER_W, decalAtCrossing, placeDecals, pushDecal, stripSeed } from './roadDecals.ts';
import { tune } from '../dev/tuning.ts';
import { bollardGeometry, buildShopProps, createBollardMaterial, createPropMaterial, placeBollards } from './streetProps.ts';

/** Réglages (?reglages, voir dev/tuning.ts). */
const ASPHALT = tune('route.enrobe', "Teinte de l'enrobé", 1, 0.4, 2.5, 0.02);
const WEAR = tune('route.usure', "Usure de l'enrobé", 0, -0.5, 0.5, 0.01);
const DECALS = tune('route.defauts', 'Défauts et équipements', 1, 0, 1, 0.02);
const SLAB_TINT = tune('trottoir.teinte', 'Teinte des trottoirs', 1, 0.4, 2.5, 0.02);
const WALL_SHADOW = tune('trottoir.ombre', 'Ombre au pied des murs', 0.45, 0, 1, 0.01);
const SHOP_LIGHT = tune('nuit.vitrines', 'Lumière des vitrines', 1, 0, 3, 0.05);
tune('pluie.forcer', 'Forcer la pluie (chaussée)', 0, 0, 1, 0.01);

/** Routes revêtues avec marquage axial (départementales et plus). */
const MARKED = new Set(['primary', 'secondary', 'tertiary', 'trunk', 'primary_link', 'secondary_link']);
const UNPAVED = new Set(['unpaved', 'gravel', 'dirt', 'ground', 'compacted', 'fine_gravel', 'grass', 'sand']);
/** Pavés (secteurs de Paris–Roubaix, vieilles rues) : mêmes valeurs OSM que la physique et le son. */
const COBBLES = new Set(['sett', 'cobblestone', 'unhewn_cobblestone', 'cobblestone:flattened', 'paving_stones:sett']);
const SKIP = new Set(['footway', 'path', 'steps', 'cycleway', 'bridleway', 'pedestrian', 'corridor', 'platform']);

const WALK_CELL = 4;

/** Surface des trottoirs d'une tuile : segments et cellules (WALK_CELL m) qui les croisent. */
interface WalkIndex {
  seg: number[];
  cells: Map<number, number[]>;
}

function indexWalk(seg: number[]): WalkIndex {
  const cells = new Map<number, number[]>();
  for (let o = 0; o < seg.length; o += WALK_STRIDE) {
    // Boîte du segment : bords de chaussée et bords extérieurs de ses deux profils.
    let x0 = Infinity;
    let x1 = -Infinity;
    let z0 = Infinity;
    let z1 = -Infinity;
    for (const p of [0, 8]) {
      const x = seg[o + p] as number;
      const z = seg[o + p + 1] as number;
      const ox = x + (seg[o + p + 2] as number) * (seg[o + p + 5] as number);
      const oz = z + (seg[o + p + 3] as number) * (seg[o + p + 5] as number);
      x0 = Math.min(x0, x, ox);
      x1 = Math.max(x1, x, ox);
      z0 = Math.min(z0, z, oz);
      z1 = Math.max(z1, z, oz);
    }
    for (let cx = Math.floor(x0 / WALK_CELL); cx <= Math.floor(x1 / WALK_CELL); cx++)
      for (let cz = Math.floor(z0 / WALK_CELL); cz <= Math.floor(z1 / WALK_CELL); cz++) {
        const key = cx * 100003 + cz;
        let list = cells.get(key);
        if (!list) cells.set(key, (list = []));
        list.push(o);
      }
  }
  return { seg, cells };
}

/**
 * Réseau routier OSM (hors itinéraire actif, déjà dessiné par RoadMesh) en rubans 3D posés
 * sur le profil lissé fourni par le pipeline (l'eau est dans water.ts).
 */
export class RoadNetwork {
  readonly group = new THREE.Group();
  readonly wetness = uniform(0);
  /** 1 la nuit : lampadaires allumés (voir streetLamps.ts). */
  readonly night = uniform(0);
  private readonly lampMat = createLampMaterial(this.night);
  /** Lampadaires de toutes les tuiles : un seul appel de dessin. */
  private readonly lamps = new LampField(this.lampMat);
  /** Potelets de toutes les tuiles (un appel de dessin) ; stores et terrasses : un maillage par tuile. */
  private readonly bollards = new LampField(createBollardMaterial(), bollardGeometry(), 'bollards');
  private readonly propMat = createPropMaterial();
  /** Lampadaires proches allumés en vraies lumières la nuit (groupe à ajouter à la scène, hors du décor figé). */
  readonly lampLights: NearLampLights;
  /** Murs à vitrine d'une tuile (bâtiments construits avant la voirie, voir world.ts). */
  private shopWallsOf: (tileId: string) => readonly number[] = () => [];
  private readonly roadMat: THREE.MeshStandardNodeMaterial;
  private readonly tiles = new Map<string, THREE.Object3D[]>();
  /** Surface des trottoirs par tuile. */
  private readonly walks = new Map<string, WalkIndex>();
  private readonly activeRoute: string;
  private readonly footprint: RouteFootprint | null;

  /**
   * `footprint` : emprise de l'itinéraire actif ; les routes qui la recouvrent (même route tracée
   * par OSM ou par un autre itinéraire, bouts de carrefour) y sont découpées au bord de chaussée.
   */
  /** Monde ouvert : les pistes cyclables sont roulables, donc dessinées. */
  private readonly drawCycleways: boolean;
  private readonly groundAt: (x: number, z: number) => number;

  constructor(activeRoute: string, groundAt: (x: number, z: number) => number, footprint: RouteFootprint | null = null, drawCycleways = false, lampLights = 0) {
    this.lampLights = new NearLampLights(ROAD_FX && !LOW_POLY ? lampLights : 0);
    this.activeRoute = activeRoute;
    this.drawCycleways = drawCycleways;
    this.groundAt = groundAt;
    this.footprint = footprint;
    this.group.name = 'network';
    this.roadMat = this.createRoadMaterial();
    this.group.add(this.lamps.group, this.bollards.group);
  }

  /** La nuit, les lampadaires les plus proches éclairent vraiment (voir NearLampLights). */
  updateLights(dt: number, focus: THREE.Vector3): void {
    this.lampLights.update(dt, focus, this.night.value, LAMP_STRENGTH.value, this.lamps.spots());
  }

  /** Branche les vitrines des bâtiments : le trottoir s'éclaire devant elles la nuit. */
  setShopWalls(of: (tileId: string) => readonly number[]): void {
    this.shopWallsOf = of;
  }

  private createRoadMaterial(): THREE.MeshStandardNodeMaterial {
    const m = new THREE.MeshStandardNodeMaterial();
    const info = attribute<'vec3'>('roadInfo'); // demi-largeur, marquage axial, revêtement (0 enrobé, 1 non revêtu, 2 pavés)
    const across = uv().x; // mètres depuis l'axe (signé)
    const along = uv().y;
    const half = info.x;
    const ax = abs(across);
    const n = mx_noise_float(positionWorld.xz.mul(1.7)).mul(0.5).add(0.5);
    const n2 = mx_noise_float(positionWorld.xz.mul(0.08)).mul(0.5).add(0.5);
    // Style jeu vidéo : enrobé foncé uni (même teinte que la route de l'itinéraire, road.ts).
    const asphalt = LOW_POLY ? vec3(0.075, 0.078, 0.085) : vec3(0.24, 0.245, 0.26).mul(asphaltGrain()).mul(n2.mul(0.2).add(0.9));
    // Style jeu vidéo : chemins de terre bruns (le gris clair se lisait comme une dalle de béton).
    const gravel = LOW_POLY ? vec3(0.42, 0.33, 0.23) : vec3(0.5, 0.46, 0.38).mul(n.mul(0.35).add(0.7));
    const unpaved = clamp(info.z, 0, 1).mul(step(info.z, 1.5));
    const cobble = step(1.5, info.z);
    // Pavés : rangées de 14 cm décalées d'un demi-pavé, pavés de 17 cm, joints sombres, teinte par pavé.
    const rowF = along.div(0.14);
    const row = floor(rowF);
    const u = across.div(0.17).add(fract(row.mul(0.5)));
    const fu = fract(u);
    const fv = fract(rowF);
    const jointM = min(min(fu, float(1).sub(fu)).mul(0.17), min(fv, float(1).sub(fv)).mul(0.14));
    const inStone = smoothstep(0.01, 0.024, jointM);
    const shade = hash(floor(u).add(row.mul(57)));
    const stone = vec3(0.43, 0.41, 0.38).mul(shade.mul(0.4).add(0.72)).mul(n.mul(0.2).add(0.9));
    const cobbles = mix(vec3(0.13, 0.12, 0.1), stone, inStone);
    let edge = smoothstep(half.sub(0.35), half.sub(0.3), ax).mul(smoothstep(half.sub(0.1), half.sub(0.15), ax)).mul(info.y);
    const dash = step(fract(along.div(13)), float(3 / 13));
    let center = smoothstep(0.08, 0.06, ax).mul(dash).mul(info.y);
    if (LOW_POLY) {
      // Marquages antialiasés selon leur taille à l'écran (plus de scintillement au loin).
      const aa = fwidth(ax).max(0.002);
      const dv = along.div(13);
      const da = fwidth(dv).max(0.001);
      const t = fract(dv);
      const dashAA = smoothstep(float(0).sub(da), da, t).mul(float(1).sub(smoothstep(float(3 / 13).sub(da), float(3 / 13).add(da), t)));
      edge = float(1).sub(smoothstep(float(0.075).sub(aa), float(0.075).add(aa), abs(ax.sub(half.sub(0.225))))).mul(info.y);
      center = float(1).sub(smoothstep(float(0.07).sub(aa), float(0.07).add(aa), ax)).mul(dashAA).mul(info.y);
    }
    const paint = max(edge, center).mul(LOW_POLY ? float(1) : n2.mul(0.25).add(0.75)).mul(float(1).sub(cobble));
    let col = mix(mix(asphalt, gravel, unpaved), cobbles, cobble);
    col = mix(col, vec3(0.9, 0.9, 0.86), paint);
    // Bords fondus dans le bas-côté (pas d'arête nette sur l'herbe).
    col = col.mul(float(1).sub(this.wetness.mul(0.4).mul(float(1).sub(unpaved))));
    m.colorNode = col.mul(cloudShade());
    // pavés mouillés : brillants entre les joints (le « Enfer du Nord » sous la pluie)
    m.roughnessNode = clamp(mix(mix(float(0.8), float(0.97), unpaved), mix(float(0.62), float(0.9), float(1).sub(inStone)), cobble).sub(this.wetness.mul(0.55).mul(float(1).sub(unpaved))), 0.06, 1);
    m.metalnessNode = float(0);
    if (ROAD_FX && !LOW_POLY) {
      const pix = max(fwidth(across), fwidth(along));
      // Trottoir (revêtement 3) : même maillage que la voirie, donc même pluie et même lumière des lampadaires.
      const walk = step(2.5, info.z);
      const cobbleF = cobble.mul(float(1).sub(walk));
      const paved = float(1).sub(unpaved).sub(cobbleF).sub(walk).max(0);
      const roadEdge = half.add(0.6);
      const isCurb = walk.mul(step(ax, roadEdge.add(CURB_W)));
      // Peu de flaques sur un trottoir bombé vers le caniveau, qui garde l'humidité.
      // Caniveau pavé contre la bordure (drapeaux par côté dans `side` sur la chaussée) : passé au shader des
      // décalques comme un décalque de plus, sans géométrie (il suivrait chaque profil de chaque rue).
      const side = attribute<'vec2'>('side');
      const gutterW = float(GUTTER_W);
      const inGutter = float(1).sub(walk).mul(max(step(roadEdge.sub(gutterW), across.negate()).mul(side.x), step(roadEdge.sub(gutterW), across).mul(side.y))).mul(step(side.x, 1.5));
      const dkAttr = attribute<'vec4'>('decal');
      const dk = mix(dkAttr, vec4(DECAL_GUTTER, ax.sub(roadEdge.sub(gutterW)).div(gutterW), 0, 0), inGutter.mul(step(dkAttr.x, 0.5)));
      const dsz = mix(attribute<'vec2'>('decalSize'), vec2(GUTTER_W, 1), inGutter.mul(step(dkAttr.x, 0.5)));
      // Creux où l'eau stagne : tranchée tassée, avaloir, caniveau (type de décalque, sans calcul de son aspect).
      const dKind = dk.x;
      const hollow = step(1.5, dKind).mul(step(dKind, 2.5)).mul(0.12).add(step(3.5, dKind).mul(step(dKind, 4.5)).mul(0.1)).add(step(6.5, dKind).mul(0.22));
      const wetRoad = wetMasks(this.wetness, across, half, pix, hollow as unknown as ReturnType<typeof float>);
      const masks = mix(wetRoad, wetRoad.mul(vec3(1, 0.7, 0.2)), walk) as unknown as ReturnType<typeof vec3>;
      // Pavés de granit, moins clairs ; au loin, une teinte moyenne plutôt que des joints qui scintillent.
      const stoneFx = vec3(0.21, 0.2, 0.185).mul(shade.mul(0.4).add(0.72)).mul(n.mul(0.2).add(0.9));
      const cobblesFx = mix(mix(vec3(0.045, 0.04, 0.035), stoneFx, inStone), vec3(0.14, 0.135, 0.125), smoothstep(0.018, 0.045, pix));
      const pore = mix(mix(mix(float(0.75), float(0.9), unpaved), float(0.45), cobbleF), mix(float(0.6), float(0.35), isCurb), walk);
      // Dalle : asphalte coulé gris, un peu plus clair que la chaussée ; bordure en granit par blocs de 1 m.
      const walkN = mx_noise_float(positionWorld.xz.mul(0.5).add(41)).mul(0.5).add(0.5);
      const walkJoint = float(1).sub(smoothstep(0.012, 0.03, min(fract(along.div(2.1)), float(1).sub(fract(along.div(2.1)))).mul(2.1))).mul(float(1).sub(smoothstep(0.02, 0.05, pix)));
      const slab = vec3(0.135, 0.128, 0.118).mul(walkN.mul(0.25).add(0.87)).mul(float(1).sub(walkJoint.mul(0.28))).mul(n.mul(0.1).add(0.95));
      const curbBlock = float(1).sub(smoothstep(0.01, 0.025, min(fract(along), float(1).sub(fract(along))))).mul(float(1).sub(smoothstep(0.02, 0.05, pix)));
      const curbCol = vec3(0.27, 0.26, 0.24).mul(hash(floor(along).add(4096).mul(31)).mul(0.2).add(0.9)).mul(float(1).sub(curbBlock.mul(0.55)));
      // Pied du mur : ombre de contact (le ciel n'y arrive qu'à moitié) ; la GTAO, à l'écran, la manque souvent.
      const contact = float(1).sub(float(1).sub(smoothstep(0, 0.55, side.x)).mul(WALL_SHADOW).mul(walk));
      const walkCol = mix(slab.mul(SLAB_TINT), curbCol, isCurb).mul(contact);
      const road = mix(mix(asphaltColor(across, along, half, paved, false, WEAR, ASPHALT), gravel.mul(0.75), unpaved), cobblesFx, cobbleF);
      // Décalques (rapiéçages, plaques, caniveaux, passages piétons… voir roadDecals.ts) : la chaussée recalculée dessous.
      const dShade = decalShade(dk, dsz, pix, road, asphaltGrainSoft(), along);
      const dCover = dShade.look.a.mul(DECALS);
      const onDecal = step(0.5, dk.x);
      const surface = mix(mix(road, dShade.look.rgb, dCover), walkCol, walk);
      const chipped = smoothstep(0.25, 0.55, mx_noise_float(positionWorld.xz.mul(0.9)).mul(0.5).add(0.5)).mul(0.5).add(0.5);
      // Marquage interrompu sous un décalque (passage piéton, reprise d'enrobé).
      const paintFx = paint.mul(chipped).mul(float(1).sub(onDecal));
      const poreD = mix(pore, dShade.mat.y, dCover);
      const fxSurface = surface.mul(wetAlbedo(poreD, masks));
      // Tache d'huile mouillée : irisation (film mince), légère.
      const oil = dCover.mul(step(DECAL_OIL - 0.5, dk.x)).mul(step(dk.x, DECAL_OIL + 0.5)).mul(masks.x);
      const irid = cos(vec3(0, 2.1, 4.2).add(positionWorld.x.add(positionWorld.z).mul(9))).mul(0.5).add(0.5).mul(0.025).mul(oil);
      const fxCol = mix(fxSurface.add(irid), vec3(0.62, 0.62, 0.58), paintFx).mul(cloudShade());
      m.colorNode = fxCol;
      const rough0 = mix(mix(mix(mix(float(0.88), float(0.97), unpaved), mix(float(0.66), float(0.92), float(1).sub(inStone)), cobbleF), float(0.9), walk), float(0.62), paintFx);
      const rough = mix(rough0, dShade.mat.x, dCover);
      m.roughnessNode = clamp(wetRoughness(rough, poreD, masks), 0.04, 1);
      m.metalnessNode = dShade.mat.z.mul(dCover);
      // Relief : pavés bombés (bords de 3,5 cm) près de la caméra, anneaux des gouttes dans les flaques.
      const near = float(1).sub(smoothstep(0.012, 0.03, pix));
      const roundX = float(1).sub(smoothstep(0, 0.035, min(fu, float(1).sub(fu)).mul(0.17))).mul(step(0.5, fu).mul(2).sub(1));
      const roundY = float(1).sub(smoothstep(0, 0.035, min(fv, float(1).sub(fv)).mul(0.14))).mul(step(0.5, fv).mul(2).sub(1));
      const rip = rippleNormal(across, along, masks, this.wetness, pix);
      const bump = vec2(roundX, roundY).mul(0.55).mul(cobbleF).mul(near);
      m.normalNode = normalMap(vec3(rip.xy.add(bump), 1).normalize().mul(0.5).add(0.5), vec2(1, 1));
      (m as unknown as { setupLightingModel: () => unknown }).setupLightingModel = () => new RoadLightingModel(mix(float(0.2), float(1), max(masks.x.mul(0.6), max(masks.y, masks.z))));
      (m as unknown as { mrtNode: unknown }).mrtNode = mrt({ normal: vec4(packNormalToRGB(normalView), reflectAlpha(masks)) });
      // Lumière des lampadaires hors émissif (sans bloom) : diffuse sur l'albédo, plus une brillance sur le mouillé.
      const pool = lampPool(across, along, roadEdge.add(LAMP_FROM_CURB), attribute<'float'>('lamp')).mul(this.night);
      const warm = vec3(1.0, 0.72, 0.42);
      // Vitrines éclairées : lumière chaude devant le mur, par travée de 3,1 m (environ sept sur dix allumées).
      const bay = step(0.3, hash(floor(along.div(3.1)).add(65536).mul(13).add(floor(abs(across)).mul(7))));
      const shopLight = side.y.mul(walk).mul(this.night).mul(bay).mul(float(1).div(side.x.max(0).mul(side.x.max(0)).mul(0.8).add(1)).sub(0.08).max(0)).mul(SHOP_LIGHT);
      const light = warm.mul(pool.add(shopLight.mul(vec3(1.0, 0.92, 0.8)))).mul(fxCol.mul(0.85).add(max(masks.x.mul(0.012), masks.z.mul(0.035))));
      m.outputNode = vec4(output.rgb.add(light), output.a);
    }
    m.polygonOffset = true;
    m.polygonOffsetFactor = -2;
    m.polygonOffsetUnits = -2;
    // Chemins non revêtus 6 cm sous l'enrobé : au carrefour, la route passe dessus (sinon le chemin recouvrait
    // la chaussée jusqu'en pointe).
    if (LOW_POLY) {
      m.positionNode = positionLocal.sub(vec3(0, unpaved.mul(0.06), 0));
      // Mat : le reflet du ciel (environnement de la scène) noyait la couleur en rasant (enrobé bleuté, chemins
      // de terre gris) ; seule la pluie fait encore briller la chaussée.
      m.roughnessNode = clamp(float(0.95).sub(this.wetness.mul(0.5)), 0.3, 1);
      // (envMapIntensity est sans effet ici : environnement remplacé par un gris neutre, qui éclaire l'ombre sans bleuir)
      m.envNode = vec3(0.34, 0.34, 0.35);
    }
    return m;
  }

  addTile(tile: LoadedTile): void {
    if (this.tiles.has(tile.id)) return;
    const objs: THREE.Object3D[] = [];
    // Voies OSM empruntées par l'itinéraire (le ruban les dessine) : leurs copies au nom d'un autre itinéraire
    // (« route:<autre>:<osm> », deux boucles sur la même route) passaient dessus, lissées autrement.
    const osmOf = (r: TileRoad) => (r.id ?? '').slice((r.id ?? '').lastIndexOf(':') + 1);
    const mine = new Set(this.activeRoute ? tile.features.roads.filter((r) => r.route === this.activeRoute).map(osmOf) : []);
    // Monde ouvert : pistes cyclables, et toute voie empruntée par un itinéraire (chemin, voie piétonne…) qu'on y roule.
    let roads = tile.features.roads.filter((r) => r.pts3 && !r.tunnel && (!SKIP.has(r.kind) || (this.drawCycleways && (r.kind === 'cycleway' || (!!r.route && r.kind !== 'steps')))) && r.route !== this.activeRoute && !(r.route && mine.has(osmOf(r))) && !isRouteTwin(r, tile.features.roads, this.activeRoute));
    // Une voie partagée par plusieurs itinéraires figure une fois par itinéraire (« route:<id>:<osm> ») :
    // dessinée une seule fois (copies superposées : marquages qui scintillaient).
    const seen = new Set<string>();
    roads = roads.filter((r) => {
      const id = r.id ?? '';
      const key = r.route ? `${id.slice(id.lastIndexOf(':') + 1)}|${r.pts3?.[0]}|${r.pts3?.[2]}` : `${id}|${r.pts3?.[0]}|${r.pts3?.[2]}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    if (roads.length) {
      const lamps: LampSpot[] = [];
      const bollards: LampSpot[] = [];
      const street = ROAD_FX && !LOW_POLY ? new StreetIndex(tile, roads, this.shopWallsOf(tile.id)) : null;
      const walk: number[] = [];
      const geo = buildRoads(roads, this.footprint, street, lamps, this.groundAt, bollards, walk);
      if (walk.length) this.walks.set(tile.id, indexWalk(walk));
      if (geo) {
        const mesh = new THREE.Mesh(geo, this.roadMat);
        mesh.receiveShadow = true;
        mesh.name = `roads_${tile.id}`;
        objs.push(mesh);
      }
      this.lamps.set(tile.id, lamps);
      this.bollards.set(tile.id, bollards);
      // Stores bannes et terrasses devant les vitrines (ombres portées sur le trottoir).
      const props = street ? buildShopProps(this.shopWallsOf(tile.id), street, this.groundAt) : null;
      if (props) {
        const mesh = new THREE.Mesh(props, this.propMat);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        mesh.name = `props_${tile.id}`;
        objs.push(mesh);
      }
    }
    objs.forEach((o) => this.group.add(o));
    this.tiles.set(tile.id, objs);
  }

  /**
   * Hauteur du dessus d'un trottoir en (x, z) (le plus haut s'ils se recouvrent), NaN hors trottoir :
   * les spectateurs y sont posés au lieu d'être enfoncés sous la dalle, qui monte au-dessus du terrain.
   */
  walkHeightAt(x: number, z: number): number {
    let y = Number.NaN;
    const key = Math.floor(x / WALK_CELL) * 100003 + Math.floor(z / WALK_CELL);
    for (const idx of this.walks.values()) {
      const list = idx.cells.get(key);
      if (!list) continue;
      for (const o of list) {
        const h = walkHeight(idx.seg, o, x, z);
        if (Number.isFinite(h) && !(h <= y)) y = h;
      }
    }
    return y;
  }

  removeTile(tile: LoadedTile): void {
    const objs = this.tiles.get(tile.id);
    if (!objs) return;
    this.lamps.remove(tile.id);
    this.bollards.remove(tile.id);
    this.walks.delete(tile.id);
    for (const o of objs) {
      this.group.remove(o);
      (o as THREE.Mesh).geometry.dispose();
    }
    this.tiles.delete(tile.id);
  }
}

/**
 * Largeur de trottoir depuis un bord de chaussée (x, y, z) vers (dx, dz), et ce qui l'arrête (mur, vitrine). Avec
 * `groundAt`, il s'arrête aussi là où le sol tombe sous la chaussée (talus vers une rue en contrebas).
 */
function edgeAt(street: StreetIndex, x: number, y: number, z: number, dx: number, dz: number, groundAt: ((x: number, z: number) => number) | null): { w: number; kind: EdgeKind } {
  const w0 = street.clearWidth(x, z, dx, dz);
  const w = groundAt ? trimOverBank(w0, x, y, z, dx, dz, groundAt) : w0;
  const wall = street.hit === 'wall' && w === w0;
  return { w, kind: { wall, shop: wall && street.shopNear(x + dx * (w - 0.3), z + dz * (w - 0.3)) } };
}

/** Rubans de toutes les routes d'une tuile, fusionnés (un seul appel de dessin). */
function buildRoads(roads: TileRoad[], footprint: RouteFootprint | null, street: StreetIndex | null, lamps: LampSpot[], groundAt: ((x: number, z: number) => number) | null, bollards: LampSpot[] = [], walk: number[] = []): THREE.BufferGeometry | null {
  const lampGrid = new Map<number, LampSpot[]>();
  const sink: MeshSink = { pos: [], uvs: [], info: [], lit: [], decal: [], dsize: [], side: [], index: [], walk };
  const { pos, uvs, info, lit, decal, dsize, side, index } = sink;
  const pieces = roads
    .filter((r) => (r.pts3 as number[]).length >= 6)
    .map((r) => {
      const half = Math.max(r.width, 2.5) / 2;
      const marked = MARKED.has(r.kind) && r.width >= 5 ? 1 : 0;
      const unpaved = COBBLES.has(r.surface ?? '') ? 2 : UNPAVED.has(r.surface ?? '') || r.kind === 'track' ? 1 : 0;
      return { pts3: r.pts3 as number[], half, marked, unpaved, key: `${half}|${marked}|${unpaved}` };
    });
  // Tronçons du graphe mis bout à bout : rives continues aux nœuds, pointillé sans à-coup.
  for (const c of chainPieces(pieces)) {
    const { half, marked, unpaved } = pieces[c.piece] as (typeof pieces)[number];
    // Bords à demi-largeur + 0,6 m de bas-côté fondu ; découpe contre l'itinéraire actif.
    const o = half + 0.6;
    for (const raw of sideRoadStrips(c.pts3, o, half, footprint, 0.05, c.dirs, c.stops)) {
      // En ville, profils tous les 3 m : largeur de trottoir et lampadaires varient plus vite que les points OSM.
      const city = !!street && unpaved !== 1 && half >= 2;
      // Routes marquées hors ville : profils tous les 4 m, pour couper net les lignes au carrefour (voir plus bas).
      const s = city ? resampleStrip(raw.left, raw.right, raw.along, 3) : marked && street ? resampleStrip(raw.left, raw.right, raw.along, 4) : raw;
      const base = pos.length / 3;
      const n = s.along.length;
      const lampAt = new Float32Array(n);
      const ux: number[] = [];
      const uz: number[] = [];
      const wL = new Array<number>(n).fill(0);
      const wR = new Array<number>(n).fill(0);
      const kL: EdgeKind[] = [];
      const kR: EdgeKind[] = [];
      if (city && street) {
        for (let i = 0; i < n; i++) {
          const dx = (s.right[i * 3] as number) - (s.left[i * 3] as number);
          const dz = (s.right[i * 3 + 2] as number) - (s.left[i * 3 + 2] as number);
          const w = Math.hypot(dx, dz) || 1;
          ux.push(dx / w);
          uz.push(dz / w);
          // Ce qui borde chaque côté : un mur (ombre à son pied), et s'il porte une vitrine (lumière la nuit).
          for (const sd of [-1, 1]) {
            const e = sd < 0 ? s.left : s.right;
            const { w: width, kind } = edgeAt(street, e[i * 3] as number, e[i * 3 + 1] as number, e[i * 3 + 2] as number, (sd * dx) / w, (sd * dz) / w, groundAt);
            if (sd < 0) {
              wL[i] = width;
              kL[i] = kind;
            } else {
              wR[i] = width;
              kR[i] = kind;
            }
          }
        }
        // Pas de bout de trottoir isolé (quelques mètres devant un bâtiment seul, posés dans l'herbe).
        dropShortRuns(wL, s.along, 4);
        dropShortRuns(wR, s.along, 4);
        // Lampadaires : sur le trottoir, à 60 cm de la bordure. Rue étroite : d'un seul côté, le plus large.
        // Jamais sur une chaussée ou contre un carrefour (trottoir coupé à côté), ni à moins de 14 m d'un autre.
        const sum = (a: number[]) => a.reduce((t, v) => t + v, 0);
        const mode = half >= 3.5 ? LAMP_STAGGERED : sum(wL) >= sum(wR) ? LAMP_LEFT : LAMP_RIGHT;
        const a0 = Math.min(s.along[0] as number, s.along[n - 1] as number);
        const a1 = Math.max(s.along[0] as number, s.along[n - 1] as number);
        for (let k = Math.ceil(a0 / LAMP_SPACING); k <= Math.floor(a1 / LAMP_SPACING); k++) {
          const at = k * LAMP_SPACING;
          let i = 0;
          let best = Infinity;
          for (let j = 0; j < n; j++) {
            const d = Math.abs((s.along[j] as number) - at);
            if (d < best) {
              best = d;
              i = j;
            }
          }
          if (i < 2 || i > n - 3 || best > 2) continue;
          const left = lampIsLeft(mode, k);
          const widths = left ? wL : wR;
          if (Math.min(widths[i - 2] as number, widths[i - 1] as number, widths[i] as number, widths[i + 1] as number, widths[i + 2] as number) < LAMP_FROM_CURB + 0.35) continue;
          const edge = left ? s.left : s.right;
          const sign = left ? -1 : 1;
          const x = (edge[i * 3] as number) + (ux[i] as number) * sign * LAMP_FROM_CURB;
          const z = (edge[i * 3 + 2] as number) + (uz[i] as number) * sign * LAMP_FROM_CURB;
          if (street.onRoad(x, z, 0.3) || street.inBuilding(x, z)) continue;
          const g = Math.floor(x / 14) * 65536 + Math.floor(z / 14);
          let close = false;
          for (let gx = -1; gx <= 1 && !close; gx++)
            for (let gz = -1; gz <= 1 && !close; gz++)
              for (const l of lampGrid.get(g + gx * 65536 + gz) ?? []) if (Math.hypot(l.x - x, l.z - z) < 14) close = true;
          if (close) continue;
          const spot = { x, y: (edge[i * 3 + 1] as number) + CURB_H, z };
          lamps.push(spot);
          const cell = lampGrid.get(g);
          if (cell) cell.push(spot);
          else lampGrid.set(g, [spot]);
          // Flaque de lumière de ce lampadaire, à ±15 m : seulement là où il existe vraiment.
          for (let j = 0; j < n; j++) if (Math.abs((s.along[j] as number) - at) <= LAMP_SPACING / 2 + 0.01) lampAt[j] = mode;
        }
      }
      for (let i = 0; i < n; i++) {
        pos.push(s.left[i * 3] as number, s.left[i * 3 + 1] as number, s.left[i * 3 + 2] as number);
        pos.push(s.right[i * 3] as number, s.right[i * 3 + 1] as number, s.right[i * 3 + 2] as number);
        uvs.push(-o, s.along[i] as number, o, s.along[i] as number);
        // Carrefour : pas de ligne de rive ni d'axe sur la chaussée de la rue qui croise (elles se superposaient).
        let mL = marked;
        let mR = marked;
        if (marked && street) {
          const ex = (s.right[i * 3] as number) - (s.left[i * 3] as number);
          const ez = (s.right[i * 3 + 2] as number) - (s.left[i * 3 + 2] as number);
          const el = Math.hypot(ex, ez) || 1;
          const ax = ex / el;
          const az = ez / el;
          const cx = ((s.left[i * 3] as number) + (s.right[i * 3] as number)) / 2;
          const cz = ((s.left[i * 3 + 2] as number) + (s.right[i * 3 + 2] as number)) / 2;
          const r = half - 0.3;
          if (street.crossRoad(cx - ax * r, cz - az * r, -az, ax)) mL = 0;
          if (street.crossRoad(cx + ax * r, cz + az * r, -az, ax)) mR = 0;
        }
        info.push(half, mL, unpaved, half, mR, unpaved);
        lit.push(lampAt[i] as number, lampAt[i] as number);
        decal.push(0, 0, 0, 0, 0, 0, 0, 0);
        dsize.push(0, 0, 0, 0);
        // Chaussée : caniveau pavé à gauche, à droite (là où il y a un trottoir), lu par le shader.
        const gL = (wL[i] as number) > 0 ? 1 : 0;
        const gR = (wR[i] as number) > 0 ? 1 : 0;
        side.push(gL, gR, gL, gR);
      }
      for (const k of ribbonIndex(pos.slice(base * 3), 3, 2, n, true)) index.push(base + k);
      // Défauts et équipements de chaussée, posés selon la rue (enrobé seulement). Seulement là où le shader
      // les dessine (ROAD_FX, style réaliste) : sinon ces quads restaient en dalles d'enrobé uni, sombres, posées
      // de travers sur la chaussée et jusque sur les bas-côtés (rapiéçages, tranchées, plaques en low poly).
      if (ROAD_FX && !LOW_POLY && street && unpaved === 0) {
        // Pas de rapiéçage, tache ou plaque là où la rue croise une autre chaussée (deux rubans s'y recouvrent).
        // Profil sur la chaussée d'une rue qui croise (au milieu ou à l'un des bords) : carrefour.
        const atCrossing = (k: number) => {
          const ex = (s.right[k * 3] as number) - (s.left[k * 3] as number);
          const ez = (s.right[k * 3 + 2] as number) - (s.left[k * 3 + 2] as number);
          return [0, 0.15, 0.5, 0.85, 1].some((t) => street.crossRoad((s.left[k * 3] as number) + ex * t, (s.left[k * 3 + 2] as number) + ez * t, -ez, ex, 1));
        };
        const decals = placeDecals({ along: s.along, half, o, city, wL, wR, seed: stripSeed(s.left[0] as number, s.left[2] as number), atCrossing }).filter(
          (d) => d.kind === DECAL_CROSSWALK || !decalAtCrossing(d, s.left, s.right, s.along, o, (x, z, dx, dz) => street.crossRoad(x, z, dx, dz)),
        );
        for (const d of decals) pushDecal(sink, s.left, s.right, s.along, o, half, d, Array.from(lampAt));
        // Potelets : près des passages piétons, et le long d'une rue sur trois environ.
        if (city) {
          const crossings = decals.filter((d) => d.kind === DECAL_CROSSWALK);
          // Rue entière bordée de potelets : à la parisienne, seulement en quartier dense (pas dans les villages).
          const mid = Math.floor(n / 2);
          const dense = street.density(((s.left[mid * 3] as number) + (s.right[mid * 3] as number)) / 2, ((s.left[mid * 3 + 2] as number) + (s.right[mid * 3 + 2] as number)) / 2) >= 14;
          const wholeStreet = dense && stripSeed(s.left[0] as number, s.left[2] as number) % 100 < 33;
          for (const sd of [-1, 1])
            bollards.push(...placeBollards({ edge: sd < 0 ? s.left : s.right, along: s.along, widths: sd < 0 ? wL : wR, ux, uz, sign: sd, crossings, lamps, wholeStreet }));
        }
      }
      if (city && groundAt && street) {
        // Bouts de trottoir posés au bord de la chaussée voisine (plus de pointe qui la recouvre).
        for (const sd of [-1, 1]) {
          const r = bevelSidewalkEnds(refineSidewalkEnds(
            { edge: sd < 0 ? s.left : s.right, along: s.along, widths: sd < 0 ? wL : wR, kinds: sd < 0 ? kL : kR, lamp: Array.from(lampAt), ux, uz },
            (x, y, z, ax, az) => edgeAt(street, x, y, z, sd * ax, sd * az, groundAt),
          ));
          pushSidewalk(sink, r.edge, r.along, r.widths, r.ux, r.uz, sd, o, half, r.lamp, groundAt, r.kinds, r.fall);
        }
      }
    }
  }
  if (!pos.length) return null;
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  g.setAttribute('roadInfo', new THREE.Float32BufferAttribute(info, 3));
  if (ROAD_FX && !LOW_POLY) {
    g.setAttribute('lamp', new THREE.Float32BufferAttribute(lit, 1));
    g.setAttribute('decal', new THREE.Float32BufferAttribute(decal, 4));
    g.setAttribute('decalSize', new THREE.Float32BufferAttribute(dsize, 2));
    g.setAttribute('side', new THREE.Float32BufferAttribute(side, 2));
  }
  g.setIndex(index);
  g.computeVertexNormals();
  g.computeBoundingSphere();
  return g;
}
