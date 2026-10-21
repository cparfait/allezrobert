/**
 * EXPÉRIMENTAL — désactivé par défaut. ANT+ Controls (type d'appareil 16), page 73 (0x49) « Generic Command ».
 * Sert aux télécommandes ANT+ génériques. Octets : 1–2 n° de série esclave, 3–4 identifiant fabricant,
 * 5 n° de séquence, 6–7 n° de commande (uint16 LE).
 * Le Di2 D-Fly en ANT+ n'emprunte PAS forcément cette page (canal Shimano privé) : non garanti.
 */
import { ByteReader, ByteWriter, type ByteSource } from '../bytes.ts';
import type { ShiftAction } from '@allezrobert/shared';

export const ANT_GENERIC_COMMAND = {
  menuUp: 0x0000,
  menuDown: 0x0001,
  menuSelect: 0x0002,
  menuBack: 0x0003,
  home: 0x0004,
  start: 0x0020,
  stop: 0x0021,
  reset: 0x0022,
  length: 0x0023,
  lap: 0x0024,
  noCommand: 0xffff,
} as const;

export interface AntGenericCommand {
  serialNumber: number;
  manufacturerId: number;
  sequence: number;
  command: number;
}

export function decodeAntGenericCommand(data: ByteSource): AntGenericCommand | undefined {
  const r = new ByteReader(data);
  if (r.u8() !== 0x49) return undefined;
  return { serialNumber: r.u16(), manufacturerId: r.u16(), sequence: r.u8(), command: r.u16() };
}

export function encodeAntGenericCommand(c: AntGenericCommand): Uint8Array {
  return new ByteWriter().u8(0x49).u16(c.serialNumber).u16(c.manufacturerId).u8(c.sequence).u16(c.command).toBytes();
}

export const DEFAULT_ANT_COMMAND_ACTIONS: Record<number, ShiftAction> = {
  [ANT_GENERIC_COMMAND.menuUp]: 'up',
  [ANT_GENERIC_COMMAND.menuDown]: 'down',
  [ANT_GENERIC_COMMAND.menuSelect]: 'confirm',
  [ANT_GENERIC_COMMAND.menuBack]: 'back',
  [ANT_GENERIC_COMMAND.home]: 'menu',
};

/** Ne déclenche qu'une fois par n° de séquence (les pages sont répétées). */
export class AntGenericCommandDeduplicator {
  private lastSeq: number | undefined;

  accept(c: AntGenericCommand): boolean {
    if (c.command === ANT_GENERIC_COMMAND.noCommand) return false;
    if (c.sequence === this.lastSeq) return false;
    this.lastSeq = c.sequence;
    return true;
  }
}
