/**
 * Conditions d'un pas de physique, communes au client (prédiction locale) et au serveur (autorité) :
 * à entrées égales, les deux obtiennent la même densité d'air, le même vent ressenti, la même résistance
 * au roulement et le même CdA, donc la même vitesse. Avant ce module chaque côté construisait les siens
 * (température de l'air, vent, pluie et morphologie absents du serveur) et le client se recalait sans cesse.
 */
import { bodyCdaFactor, riderWind, surfaceCrr, wetCrrFactor } from './conditions.ts';
import { airDensity, type Environment, type RiderPhysicsParams } from './model.ts';

/** Température de l'air des sorties en solo (°C) : la densité suit l'altitude à cette température. */
export const RIDE_AIR_TEMP_C = 14;

/**
 * Paramètres du coureur avec sa morphologie : le CdA du vélo vaut pour 1,78 m et 75 kg, il suit l'aire
 * frontale du coureur. Taille inconnue (0 ou absente) : CdA inchangé.
 */
export function rideParams(base: RiderPhysicsParams, heightCm: number | undefined, riderMassKg: number, inertiaFactor = 1): RiderPhysicsParams {
  return { ...base, cda: base.cda * bodyCdaFactor(heightCm ?? 0, riderMassKg), inertiaFactor };
}

/**
 * Composante de face (m/s, positive = vent contraire) du vent météo à 10 m pour un coureur qui roule
 * dans la direction (dirX, dirZ) du repère du monde (x est, z sud). `fromRad` : direction d'où vient le
 * vent (cap depuis le nord, sens horaire).
 */
export function headwindAlong(windMs: number, fromRad: number, dirX: number, dirZ: number): number {
  if (!(windMs > 0)) return 0;
  // Vent venant de `from` : il souffle vers −(sin, −cos) dans le repère x est / z sud.
  const blowX = -Math.sin(fromRad);
  const blowZ = Math.cos(fromRad);
  return -(blowX * dirX + blowZ * dirZ) * windMs;
}

export interface RideConditions {
  /** Altitude du coureur (m). */
  altitudeM: number;
  /** Vent de face météo à 10 m (m/s), voir {@link headwindAlong}. */
  headwindMs: number;
  /** Abri du vent (0–1), connu du client seul (relief, bâti) ; 0 en salle, où le serveur fait foi. */
  shelter?: number;
  /** Pluie (0–1). */
  rain: number;
  /** Revêtement (étiquette OSM) sous les roues. */
  surface: string | undefined;
  tyre?: 'road' | 'gravel' | 'mtb';
  /**
   * Salle : atmosphère standard (température ISA selon l'altitude), celle du serveur depuis toujours ;
   * la garder évite de déplacer les vitesses et les records des sorties en ligne. Solo : RIDE_AIR_TEMP_C.
   */
  standardAtmosphere?: boolean;
}

/**
 * Remplit l'environnement du pas (densité de l'air, vent ressenti) et renvoie le Crr effectif
 * (revêtement, pneu, chaussée mouillée). `env` est réutilisé d'un pas à l'autre : aucune allocation.
 */
export function rideStepConditions(env: Environment, params: RiderPhysicsParams, c: RideConditions): number {
  env.airDensity = c.standardAtmosphere ? airDensity(c.altitudeM) : airDensity(c.altitudeM, RIDE_AIR_TEMP_C);
  env.windSpeedMs = riderWind(c.headwindMs, c.shelter ?? 0);
  return surfaceCrr(c.surface, params.crr, c.tyre ?? 'road') * wetCrrFactor(c.rain);
}
