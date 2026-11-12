import { framePointMmToM, type FrameDirection, type FramePointMm } from './bikeGeometry.ts';
import type { BikePoint } from './bikeReference.ts';

/**
 * Repère fabricant au boîtier, en mm. Repère vélo au sol sous le boîtier, en m.
 * Les deux ont les mêmes axes directs : +x gauche, +y haut, +z avant.
 * Les axes des pièces et les contacts ci-dessous sont exprimés dans le repère vélo.
 * Le montage physique ne dépend d'aucune échelle d'avatar.
 */
export interface MetricBikeId {
  readonly modelId: string;
  readonly size: string;
}

export interface MetricAxis {
  readonly originM: BikePoint;
  readonly direction: FrameDirection;
}

/** Repère direct orthonormé, ses axes étant exprimés dans le repère de destination. */
export interface MetricBasis {
  readonly x: FrameDirection;
  readonly y: FrameDirection;
  readonly z: FrameDirection;
}

/** Changement de repère rigide, avec translation en mètres et sans échelle. */
export interface RigidTransformM {
  readonly originM: BikePoint;
  readonly basis: MetricBasis;
}

export interface RigPlacement {
  /** Transforme le repère du rig vers le repère vélo après l'échelle du corps. */
  readonly rigToBike: RigidTransformM;
  readonly bodyScale: number;
}

/** Point du corps en mètres de liaison, avant le facteur morphologique. */
export type RigPointM = readonly [x: number, y: number, z: number];

export interface MetricBikeAxes {
  /** Les axes transversaux sont orientés vers +x, quel que soit le côté de la pièce. */
  readonly bottomBracket: MetricAxis;
  /** Point sur le pivot et direction montante. */
  readonly steering: MetricAxis;
  readonly frontWheel: MetricAxis;
  readonly rearWheel: MetricAxis;
  /** Phase zéro du contrat, pédale gauche en bas et droite en haut. */
  readonly pedalL: MetricAxis;
  readonly pedalR: MetricAxis;
}

export interface MetricBikeDimensions {
  /** Rayon extérieur du pneu monté. */
  readonly frontWheelRadiusM: number;
  readonly rearWheelRadiusM: number;
  /** Distance radiale boîtier–axe de pédale. Les déports latéraux viennent des axes. */
  readonly crankLengthM: number;
  readonly handlebarWidthM: number;
  readonly stemLengthM: number;
}

/** Contact orienté sur la pièce montée à sa position de référence. +y normale sortante, +z direction de l'appui. */
export type MetricContact = RigidTransformM;

export interface MetricBikeContacts {
  readonly saddle: MetricContact;
  /** Prise principale (cocottes sur route). */
  readonly handL: MetricContact;
  readonly handR: MetricContact;
  /** Interface pédale/cale en phase zéro, distincte de l'axe de pédale. */
  readonly pedalL: MetricContact;
  readonly pedalR: MetricContact;
  readonly topsL?: MetricContact;
  readonly topsR?: MetricContact;
  readonly dropsL?: MetricContact;
  readonly dropsR?: MetricContact;
  readonly padL?: MetricContact;
  readonly padR?: MetricContact;
}

export interface MetricRotor {
  /** Centre du disque sur la ligne d'axe de la roue correspondante. */
  readonly centerM: BikePoint;
  readonly diameterM: number;
}

/** Relevé partiel. Un champ absent reste absent jusqu'à sa mesure ou sa validation. */
export interface MetricBikeDraft {
  readonly id: MetricBikeId;
  readonly brakes: 'rim' | 'disc' | 'none';
  readonly axes: Partial<MetricBikeAxes>;
  readonly dimensions: Partial<MetricBikeDimensions>;
  readonly contacts: Partial<MetricBikeContacts>;
  /** Deux rotors obligatoires sur un montage à disque. */
  readonly rotors?: Partial<Record<'front' | 'rear', MetricRotor>>;
}

export interface MetricBikeValidation {
  readonly missingRequired: readonly string[];
  readonly missingOptional: readonly string[];
  readonly invalid: readonly { readonly path: string; readonly reason: string }[];
}

const EPSILON = 1e-6;
const TRANSVERSE = [1, 0, 0] as const;
const AXES = ['bottomBracket', 'steering', 'frontWheel', 'rearWheel', 'pedalL', 'pedalR'] as const;
const DIMENSIONS = ['frontWheelRadiusM', 'rearWheelRadiusM', 'crankLengthM', 'handlebarWidthM', 'stemLengthM'] as const;
const REQUIRED_CONTACTS = ['saddle', 'handL', 'handR', 'pedalL', 'pedalR'] as const;
const OPTIONAL_CONTACTS = ['topsL', 'topsR', 'dropsL', 'dropsR', 'padL', 'padR'] as const;

const positive = (v: number): boolean => Number.isFinite(v) && v > 0;
const finitePoint = (p: BikePoint): boolean => p.length === 3
  && Number.isFinite(p[0]) && Number.isFinite(p[1]) && Number.isFinite(p[2]);
const near = (a: number, b: number): boolean => Math.abs(a - b) <= EPSILON;
const dot = (a: BikePoint, b: BikePoint): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: BikePoint, b: BikePoint): BikePoint => [
  a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0],
];
const unit = (p: FrameDirection): boolean => finitePoint(p) && near(dot(p, p), 1);

export function isRigidTransformM({ originM, basis: { x, y, z } }: RigidTransformM): boolean {
  return finitePoint(originM) && unit(x) && unit(y) && unit(z)
    && near(dot(x, y), 0) && near(dot(y, z), 0) && near(dot(z, x), 0)
    && near(dot(cross(x, y), z), 1);
}

export function mmToM(mm: number): number {
  if (!Number.isFinite(mm)) throw new RangeError('Distance en mm non finie');
  return mm / 1000;
}

export function mToMm(m: number): number {
  const mm = m * 1000;
  if (!Number.isFinite(mm)) throw new RangeError('Distance en mm non finie');
  return mm;
}

export function manufacturerPointToBikeM(pointMm: FramePointMm, bbHeightM: number): BikePoint {
  if (!finitePoint(pointMm) || !positive(bbHeightM)) throw new RangeError('Point fabricant ou hauteur de boîtier invalide');
  const [x, y, z] = framePointMmToM(pointMm);
  return [x, y + bbHeightM, z];
}

export function bikePointToManufacturerMm(pointM: BikePoint, bbHeightM: number): FramePointMm {
  if (!finitePoint(pointM) || !positive(bbHeightM)) throw new RangeError('Point vélo ou hauteur de boîtier invalide');
  return [mToMm(pointM[0]), mToMm(pointM[1] - bbHeightM), mToMm(pointM[2])];
}

function rotate({ x, y, z }: MetricBasis, p: BikePoint): BikePoint {
  return [
    x[0] * p[0] + y[0] * p[1] + z[0] * p[2],
    x[1] * p[0] + y[1] * p[1] + z[1] * p[2],
    x[2] * p[0] + y[2] * p[1] + z[2] * p[2],
  ];
}

function unrotate({ x, y, z }: MetricBasis, p: BikePoint): BikePoint {
  return [dot(x, p), dot(y, p), dot(z, p)];
}

export function transformPointM(transform: RigidTransformM, point: BikePoint): BikePoint {
  if (!isRigidTransformM(transform) || !finitePoint(point)) throw new RangeError('Repère rigide ou point invalide');
  const [x, y, z] = rotate(transform.basis, point);
  const [tx, ty, tz] = transform.originM;
  return [x + tx, y + ty, z + tz];
}

export function inverseTransformPointM(transform: RigidTransformM, point: BikePoint): BikePoint {
  if (!isRigidTransformM(transform) || !finitePoint(point)) throw new RangeError('Repère rigide ou point invalide');
  const [x, y, z] = point;
  const [tx, ty, tz] = transform.originM;
  return unrotate(transform.basis, [x - tx, y - ty, z - tz]);
}

export function transformDirection(transform: RigidTransformM, direction: FrameDirection): FrameDirection {
  if (!isRigidTransformM(transform) || !unit(direction)) throw new RangeError('Repère rigide ou direction invalide');
  return rotate(transform.basis, direction);
}

export function inverseTransformDirection(transform: RigidTransformM, direction: FrameDirection): FrameDirection {
  if (!isRigidTransformM(transform) || !unit(direction)) throw new RangeError('Repère rigide ou direction invalide');
  return unrotate(transform.basis, direction);
}

/** Seule une coordonnée anatomique en mètres de liaison reçoit le facteur du corps. */
export function rigPointToBikeM({ rigToBike, bodyScale }: RigPlacement, [x, y, z]: RigPointM): BikePoint {
  if (!positive(bodyScale)) throw new RangeError('Échelle de rig invalide');
  return transformPointM(rigToBike, [x * bodyScale, y * bodyScale, z * bodyScale]);
}

/** Convertit une cible métrique en coordonnées de liaison, sans modifier la cible sur le vélo. */
export function bikePointToRigM({ rigToBike, bodyScale }: RigPlacement, point: BikePoint): RigPointM {
  if (!positive(bodyScale)) throw new RangeError('Échelle de rig invalide');
  const [x, y, z] = inverseTransformPointM(rigToBike, point);
  return [x / bodyScale, y / bodyScale, z / bodyScale];
}

/**
 * Signale séparément les absences et les incohérences du montage. Les contrôles croisés
 * portent sur le même montage et la même phase, avec une tolérance d'assemblage en mètres.
 * La tolérance par défaut (1 mm) permet la comparaison de relevés arrondis.
 */
export function validateMetricBike(draft: MetricBikeDraft, toleranceM = 0.001): MetricBikeValidation {
  if (!Number.isFinite(toleranceM) || toleranceM < 0) throw new RangeError('Tolérance de montage invalide');
  const missingRequired: string[] = [];
  const missingOptional: string[] = [];
  const invalid: { path: string; reason: string }[] = [];
  const { id, axes, dimensions, contacts, brakes, rotors } = draft;
  const issue = (path: string, reason: string): void => { invalid.push({ path, reason }); };
  const match = (a: number, b: number): boolean => Math.abs(a - b) <= toleranceM;

  for (const key of ['modelId', 'size'] as const) {
    if (!id[key].trim()) issue(`id.${key}`, 'Identifiant vide');
  }
  if (brakes !== 'rim' && brakes !== 'disc' && brakes !== 'none') issue('brakes', 'Type de freinage inconnu');
  for (const key of DIMENSIONS) {
    const value = dimensions[key];
    if (value === undefined) missingRequired.push(`dimensions.${key}`);
    else if (!positive(value)) issue(`dimensions.${key}`, 'Dimension positive finie attendue');
  }
  for (const key of AXES) {
    const axis = axes[key];
    const path = `axes.${key}`;
    if (axis === undefined) missingRequired.push(path);
    else if (!finitePoint(axis.originM) || !unit(axis.direction)) issue(path, 'Origine finie et direction unitaire attendues');
    else if (key === 'steering' ? axis.direction[1] <= 0 : !near(dot(axis.direction, TRANSVERSE), 1)) {
      issue(path, key === 'steering' ? 'Axe de direction montant attendu' : 'Axe transversal vers +x attendu');
    }
  }
  for (const key of [...REQUIRED_CONTACTS, ...OPTIONAL_CONTACTS]) {
    const contact = contacts[key];
    const path = `contacts.${key}`;
    if (contact === undefined) {
      const optional = OPTIONAL_CONTACTS.some((name) => name === key);
      (optional ? missingOptional : missingRequired).push(path);
    } else if (!isRigidTransformM(contact)) issue(path, 'Repère direct orthonormé attendu');
    else if ((key.endsWith('L') && contact.originM[0] <= 0) || (key.endsWith('R') && contact.originM[0] >= 0)) {
      issue(path, 'Côté incompatible avec le signe de x');
    }
  }
  const bb = axes.bottomBracket?.originM;
  if (bb && (!match(bb[0], 0) || bb[1] <= 0 || !match(bb[2], 0))) {
    issue('axes.bottomBracket', 'Boîtier attendu au-dessus de l’origine du vélo');
  }
  for (const side of ['L', 'R'] as const) {
    const key = `pedal${side}` as const;
    const pedal = axes[key]?.originM;
    if (!pedal) continue;
    const sign = side === 'L' ? 1 : -1;
    if (pedal[0] * sign <= 0) issue(`axes.${key}`, 'Côté incompatible avec le signe de x');
    const crank = dimensions.crankLengthM;
    if (bb && crank !== undefined && positive(crank) && (!match(pedal[1], bb[1] - sign * crank) || !match(pedal[2], bb[2]))) {
      issue(`axes.${key}`, 'Axe de pédale incompatible avec la phase zéro et la longueur de manivelle');
    }
  }
  for (const side of ['front', 'rear'] as const) {
    const key = `${side}Wheel` as const;
    const center = axes[key]?.originM;
    const radius = dimensions[`${key}RadiusM`];
    if (center && (!match(center[0], 0) || center[1] <= 0 || center[2] * (side === 'front' ? 1 : -1) <= 0)) {
      issue(`axes.${key}`, 'Centre de roue incompatible avec le repère vélo');
    }
    if (center && radius !== undefined && positive(radius) && !match(center[1], radius)) {
      issue(`axes.${key}`, 'Hauteur d’axe incompatible avec le rayon du pneu au sol');
    }
    const rotor = rotors?.[side];
    const path = `rotors.${side}`;
    if (rotor === undefined) {
      if (brakes === 'disc') missingRequired.push(path);
    } else if (!finitePoint(rotor.centerM) || !positive(rotor.diameterM)) {
      issue(path, 'Centre fini et diamètre positif fini attendus');
    } else {
      if (center && (!match(rotor.centerM[1], center[1]) || !match(rotor.centerM[2], center[2]))) {
        issue(path, 'Centre du disque hors de l’axe de roue');
      }
      if (radius !== undefined && positive(radius) && rotor.diameterM >= radius * 2) {
        issue(path, 'Diamètre de disque incompatible avec le diamètre de roue');
      }
    }
  }

  return { missingRequired, missingOptional, invalid };
}
