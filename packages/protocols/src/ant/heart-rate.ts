/**
 * ANT+ Heart Rate Monitor — « ANT+ Device Profile: Heart Rate » rev 2.x, §5.3.
 * Tous les messages : octet 0 = n° de page (bits 0–6) + bit « toggle » (bit 7) ;
 * octets 4–5 = temps du dernier battement (1/1024 s), 6 = compteur de battements, 7 = FC calculée.
 * Pages 0 (défaut), 1 (temps cumulé), 2 (fabricant), 3 (produit), 4 (battement précédent), 7 (batterie).
 */
import { ByteReader } from '../bytes.ts';
import type { ByteSource } from '../bytes.ts';

export interface AntHeartRatePage {
  page: number;
  toggle: boolean;
  heartBeatEventTime: number;
  heartBeatCount: number;
  computedHeartRate: number;
  /** Page 1 : temps de fonctionnement cumulé, en s (unités de 2 s). */
  cumulativeOperatingTimeS?: number;
  /** Page 2 : identifiant fabricant et 16 bits hauts du n° de série. */
  manufacturerId?: number;
  serialNumberHigh?: number;
  /** Page 3 : versions matérielle, logicielle, n° de modèle. */
  hardwareVersion?: number;
  softwareVersion?: number;
  modelNumber?: number;
  /** Page 4 : temps du battement précédent (1/1024 s). */
  previousHeartBeatEventTime?: number;
  /** Page 7 : niveau de batterie en % (0xFF = non géré). */
  batteryPercent?: number;
}

export function decodeAntHeartRatePage(data: ByteSource): AntHeartRatePage {
  const r = new ByteReader(data);
  const b0 = r.u8();
  const page = b0 & 0x7f;
  const b1 = r.u8();
  const b2 = r.u8();
  const b3 = r.u8();
  const out: AntHeartRatePage = {
    page,
    toggle: (b0 & 0x80) !== 0,
    heartBeatEventTime: r.u16(),
    heartBeatCount: r.u8(),
    computedHeartRate: r.u8(),
  };
  switch (page) {
    case 1:
      out.cumulativeOperatingTimeS = (b1 | (b2 << 8) | (b3 << 16)) * 2;
      break;
    case 2:
      out.manufacturerId = b1;
      out.serialNumberHigh = b2 | (b3 << 8);
      break;
    case 3:
      out.hardwareVersion = b1;
      out.softwareVersion = b2;
      out.modelNumber = b3;
      break;
    case 4:
      out.previousHeartBeatEventTime = b2 | (b3 << 8);
      break;
    case 7:
      if (b1 !== 0xff) out.batteryPercent = b1;
      break;
  }
  return out;
}

export function encodeAntHeartRatePage(p: { page?: number; toggle?: boolean; eventTime: number; beatCount: number; bpm: number; previousEventTime?: number }): Uint8Array {
  const page = p.page ?? 0;
  const out = Uint8Array.of((page & 0x7f) | (p.toggle ? 0x80 : 0), 0xff, 0xff, 0xff, p.eventTime & 0xff, (p.eventTime >> 8) & 0xff, p.beatCount & 0xff, p.bpm & 0xff);
  if (page === 4 && p.previousEventTime !== undefined) {
    out[1] = 0xff;
    out[2] = p.previousEventTime & 0xff;
    out[3] = (p.previousEventTime >> 8) & 0xff;
  }
  return out;
}

/**
 * Intervalles R-R (ms) à partir des pages HR successives :
 * si le compteur avance d'exactement 1, RR = Δtemps ; si la page 4 est reçue, RR = temps − temps précédent.
 */
export class AntHeartRateRrCalculator {
  private lastCount: number | undefined;
  private lastTime: number | undefined;

  update(p: AntHeartRatePage): number[] {
    const out: number[] = [];
    if (this.lastCount !== undefined && this.lastTime !== undefined) {
      const dCount = (p.heartBeatCount - this.lastCount + 256) % 256;
      if (dCount >= 1) {
        if (p.page === 4 && p.previousHeartBeatEventTime !== undefined) {
          out.push(rr(p.heartBeatEventTime, p.previousHeartBeatEventTime));
        } else if (dCount === 1) {
          out.push(rr(p.heartBeatEventTime, this.lastTime));
        }
      }
    }
    this.lastCount = p.heartBeatCount;
    this.lastTime = p.heartBeatEventTime;
    return out;
  }
}

function rr(t: number, prev: number): number {
  const d = (t - prev + 65536) % 65536;
  return Math.round((d * 1000 * 10) / 1024) / 10;
}
