/**
 * ANT+ Bicycle Power (PWR) — « ANT+ Device Profile: Bicycle Power » rev 5.x.
 *   0x10 Standard Power-Only (§8.2)  : puissance, cadence, balance G/D (« pedal power »).
 *   0x12 Standard Crank Torque (§8.4): couple et période cumulés → puissance et cadence moyennes.
 *   0x13 Torque Effectiveness & Pedal Smoothness (§8.5) : TE et PS par jambe, en 0,5 %.
 *
 * C'est par ce profil (et lui seul) que les Favero Assioma transmettent TE et PS : le Cycling Power
 * Service Bluetooth n'a pas de champ pour ces métriques.
 */
import { ByteReader, ByteWriter, type ByteSource } from '../bytes.ts';
import { decodeCommonPage, type CommonPage } from './profiles.ts';

export const PWR_PAGE = {
  calibration: 0x01,
  standardPowerOnly: 0x10,
  standardWheelTorque: 0x11,
  standardCrankTorque: 0x12,
  torqueEffectivenessPedalSmoothness: 0x13,
} as const;

export interface PwrStandardPowerOnly {
  page: 0x10;
  updateEventCount: number;
  /**
   * « Pedal Power » : bit 7 = 1 → la valeur (bits 0–6, %) est la contribution de la pédale DROITE ;
   * bit 7 = 0 → pédale non identifiée. 0xFF = non utilisé.
   */
  pedalPowerPercent?: number;
  pedalPowerRightReference: boolean;
  cadenceRpm?: number;
  accumulatedPowerW: number;
  instantaneousPowerW: number;
}

export interface PwrCrankTorque {
  page: 0x12;
  updateEventCount: number;
  crankTicks: number;
  cadenceRpm?: number;
  /** Période cumulée, 1/2048 s. */
  accumulatedPeriod: number;
  /** Couple cumulé, 1/32 N·m. */
  accumulatedTorque: number;
}

export interface PwrTePs {
  page: 0x13;
  updateEventCount: number;
  teLeft?: number;
  teRight?: number;
  /** Si `psCombined` est vrai, psLeft contient la régularité combinée des deux jambes. */
  psLeft?: number;
  psRight?: number;
  psCombined: boolean;
}

export type PwrPage = PwrStandardPowerOnly | PwrCrankTorque | PwrTePs | CommonPage | { page: number; kind: 'unknown'; data: Uint8Array };

/** TE/PS : 0,5 % par unité, 0xFF = invalide. */
function halfPercent(v: number): number | undefined {
  return v === 0xff ? undefined : v / 2;
}

export function decodePwrPage(data: ByteSource): PwrPage {
  const r = new ByteReader(data);
  const page = r.u8();
  switch (page) {
    case 0x10: {
      const updateEventCount = r.u8();
      const pp = r.u8();
      const cad = r.u8();
      const accumulatedPowerW = r.u16();
      const instantaneousPowerW = r.u16();
      const out: PwrStandardPowerOnly = {
        page,
        updateEventCount,
        pedalPowerRightReference: pp !== 0xff && (pp & 0x80) !== 0,
        accumulatedPowerW,
        instantaneousPowerW,
      };
      if (pp !== 0xff) out.pedalPowerPercent = pp & 0x7f;
      if (cad !== 0xff) out.cadenceRpm = cad;
      return out;
    }
    case 0x12: {
      const updateEventCount = r.u8();
      const crankTicks = r.u8();
      const cad = r.u8();
      const out: PwrCrankTorque = { page, updateEventCount, crankTicks, accumulatedPeriod: r.u16(), accumulatedTorque: r.u16() };
      if (cad !== 0xff) out.cadenceRpm = cad;
      return out;
    }
    case 0x13: {
      const updateEventCount = r.u8();
      const teL = r.u8();
      const teR = r.u8();
      const psL = r.u8();
      const psR = r.u8();
      // §8.5 : PS droite = 0xFE → psLeft porte la valeur combinée.
      const psCombined = psR === 0xfe;
      const out: PwrTePs = { page, updateEventCount, psCombined };
      const tl = halfPercent(teL);
      const tr = halfPercent(teR);
      const pl = halfPercent(psL);
      const pr = psCombined ? undefined : halfPercent(psR);
      if (tl !== undefined) out.teLeft = tl;
      if (tr !== undefined) out.teRight = tr;
      if (pl !== undefined) out.psLeft = pl;
      if (pr !== undefined) out.psRight = pr;
      return out;
    }
    default: {
      const common = decodeCommonPage(data);
      if (common) return common;
      return { page, kind: 'unknown', data: new ByteReader(data).bytesN(8).slice() };
    }
  }
}

/** Part gauche (%) déduite de la page 0x10 : uniquement si la référence droite est indiquée. */
export function leftBalanceFromPwr(p: PwrStandardPowerOnly): number | undefined {
  if (p.pedalPowerPercent === undefined || !p.pedalPowerRightReference) return undefined;
  return 100 - p.pedalPowerPercent;
}

export function encodePwrStandardPowerOnly(p: { eventCount: number; rightPercent?: number; cadenceRpm?: number; accumulatedPowerW: number; powerW: number }): Uint8Array {
  return new ByteWriter()
    .u8(0x10)
    .u8(p.eventCount & 0xff)
    .u8(p.rightPercent === undefined ? 0xff : 0x80 | (Math.round(p.rightPercent) & 0x7f))
    .u8(p.cadenceRpm === undefined ? 0xff : p.cadenceRpm)
    .u16(Math.round(p.accumulatedPowerW) % 65536)
    .u16(p.powerW)
    .toBytes();
}

export function encodePwrTePs(p: { eventCount: number; teLeft?: number; teRight?: number; psLeft?: number; psRight?: number; psCombined?: boolean }): Uint8Array {
  const hp = (v: number | undefined) => (v === undefined ? 0xff : Math.round(v * 2));
  return Uint8Array.of(0x13, p.eventCount & 0xff, hp(p.teLeft), hp(p.teRight), hp(p.psLeft), p.psCombined ? 0xfe : hp(p.psRight), 0xff, 0xff);
}

/**
 * Puissance moyenne à partir de pages 0x10 successives : ΔPuissanceCumulée / ΔÉvénements (§8.2.1).
 * Plus robuste que la puissance instantanée quand des messages sont perdus.
 */
export class PwrPowerOnlyCalculator {
  private last: PwrStandardPowerOnly | undefined;

  update(p: PwrStandardPowerOnly): number | undefined {
    const prev = this.last;
    this.last = p;
    if (!prev) return p.instantaneousPowerW;
    const dEv = (p.updateEventCount - prev.updateEventCount + 256) % 256;
    if (dEv === 0) return undefined; // même événement répété
    const dAcc = (p.accumulatedPowerW - prev.accumulatedPowerW + 65536) % 65536;
    return dAcc / dEv;
  }

  reset(): void {
    this.last = undefined;
  }
}

/**
 * Puissance et cadence moyennes à partir de pages 0x12 successives (§8.4.2) :
 *   cadence = 60 · ΔÉvénements / (ΔPériode / 2048)
 *   puissance = 128 π · ΔCouple / ΔPériode
 */
export class PwrCrankTorqueCalculator {
  private last: PwrCrankTorque | undefined;

  update(p: PwrCrankTorque): { powerW: number; cadenceRpm: number } | undefined {
    const prev = this.last;
    this.last = p;
    if (!prev) return undefined;
    const dEv = (p.updateEventCount - prev.updateEventCount + 256) % 256;
    const dPeriod = (p.accumulatedPeriod - prev.accumulatedPeriod + 65536) % 65536;
    const dTorque = (p.accumulatedTorque - prev.accumulatedTorque + 65536) % 65536;
    if (dEv === 0) return undefined;
    if (dPeriod === 0) return { powerW: 0, cadenceRpm: 0 }; // roue libre : événements sans rotation
    return { powerW: (128 * Math.PI * dTorque) / dPeriod, cadenceRpm: (60 * dEv * 2048) / dPeriod };
  }

  reset(): void {
    this.last = undefined;
  }
}
