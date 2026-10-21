import { describe, expect, it } from 'vitest';
import {
  AntGenericCommandDeduplicator,
  DflyDecoder,
  EXPERIMENTAL_ADAPTERS_DEFAULT,
  SRAM_AXS_STUB,
  ZwiftButtonEdgeDetector,
  decodeAntGenericCommand,
  decodeHeadwindStatus,
  decodeZwiftControllerMessage,
  encodeHeadwindMode,
  encodeHeadwindSpeed,
  fromHex,
  parseProtobuf,
  toHex,
  writeVarint,
  zigzagDecode,
  zigzagEncode,
  zwiftDeviceTypeFromManufacturerData,
  ZWIFT_RIDE_ON,
} from '../src/index.ts';

const h = fromHex;

describe('adaptateurs optionnels : désactivés par défaut', () => {
  it('tous à false', () => {
    expect(Object.values(EXPERIMENTAL_ADAPTERS_DEFAULT).every((v) => v === false)).toBe(true);
  });
});

describe('protobuf minimal', () => {
  it('varint et zigzag', () => {
    expect(writeVarint(126975)).toEqual([0xff, 0xdf, 0x07]);
    expect(zigzagDecode(199)).toBe(-100);
    expect(zigzagEncode(-100)).toBe(199);
    expect(parseProtobuf(h('08 96 01'))).toEqual([{ field: 1, wireType: 0, value: 150 }]);
  });
});

describe('manettes Zwift (expérimental)', () => {
  it('poignée de main RideOn', () => {
    expect(toHex(ZWIFT_RIDE_ON)).toBe('52 69 64 65 4f 6e');
    const m = decodeZwiftControllerMessage(h('52 69 64 65 4f 6e 01 03'));
    expect(m.type).toBe('handshake');
  });

  it('Click v1 : plus / moins (0 = appuyé)', () => {
    expect(decodeZwiftControllerMessage(h('37 08 00 10 01'))).toEqual({ type: 'buttons', source: 'click', pressed: ['plus'] });
    expect(decodeZwiftControllerMessage(h('37 08 01 10 00'))).toEqual({ type: 'buttons', source: 'click', pressed: ['minus'] });
    expect(decodeZwiftControllerMessage(h('37 08 01 10 01'))).toEqual({ type: 'buttons', source: 'click', pressed: [] });
  });

  it('Ride / Click v2 : masque de boutons (bit à 0 = appuyé) et palette analogique', () => {
    expect(decodeZwiftControllerMessage(h('23 08 FF DF 07'))).toMatchObject({ source: 'ride', pressed: ['shiftUpRight'] });
    const m = decodeZwiftControllerMessage(h('23 08 FF FF 07 1A 05 08 01 10 C7 01'));
    expect(m).toEqual({ type: 'buttons', source: 'ride', pressed: ['paddleRight'], analog: [{ location: 1, value: -100 }] });
  });

  it('Play : côté droit (A) et côté gauche (haut)', () => {
    expect(decodeZwiftControllerMessage(h('07 08 00 10 01 18 01 20 00 28 01 30 01 38 01 40 00 48 00'))).toMatchObject({ source: 'play', pressed: ['a'] });
    expect(decodeZwiftControllerMessage(h('07 08 01 10 00 18 01 20 01 28 01 30 01 38 01 40 00 48 00'))).toMatchObject({ source: 'play', pressed: ['navUp'] });
  });

  it('batterie, inactivité, inconnu', () => {
    expect(decodeZwiftControllerMessage(h('19 08 50'))).toEqual({ type: 'battery', percent: 80 });
    expect(decodeZwiftControllerMessage(h('15'))).toEqual({ type: 'idle' });
    expect(decodeZwiftControllerMessage(h('3C 01')).type).toBe('unknown');
  });

  it('fronts montants uniquement', () => {
    const e = new ZwiftButtonEdgeDetector();
    expect(e.update(['plus'])).toEqual(['plus']);
    expect(e.update(['plus'])).toEqual([]);
    expect(e.update([])).toEqual([]);
    expect(e.update(['plus', 'minus'])).toEqual(['plus', 'minus']);
  });

  it('type d\'appareil dans les données fabricant', () => {
    expect(zwiftDeviceTypeFromManufacturerData([0x09, 0x00])).toBe('click');
    expect(zwiftDeviceTypeFromManufacturerData([0x07])).toBe('rideRight');
    expect(zwiftDeviceTypeFromManufacturerData([0x42])).toBeUndefined();
  });
});

describe('KICKR HEADWIND (expérimental)', () => {
  it('commandes', () => {
    expect(toHex(encodeHeadwindMode('manual'))).toBe('04 04');
    expect(toHex(encodeHeadwindMode('heartRate'))).toBe('04 02');
    expect(toHex(encodeHeadwindSpeed(50))).toBe('02 32');
    expect(toHex(encodeHeadwindSpeed(60))).toBe('02 32');
    expect(toHex(encodeHeadwindSpeed(60, false))).toBe('02 3c');
    expect(toHex(encodeHeadwindSpeed(150))).toBe('02 64');
  });
  it('état', () => {
    expect(decodeHeadwindStatus(h('FD 01 32 04'))).toEqual({ speedPercent: 50, mode: 'manual' });
    expect(decodeHeadwindStatus(h('FD 02 32 04'))).toBeUndefined();
  });
});

describe('Shimano D-Fly (expérimental)', () => {
  it('court, relâché, long tenu, relâché', () => {
    const d = new DflyDecoder();
    expect(d.push(h('00 00 00 00 00'))).toEqual([]);
    expect(d.push(h('00 10 00 00 00'))).toEqual([{ channel: 1, kind: 'short' }]);
    expect(d.push(h('00 00 00 00 00'))).toEqual([{ channel: 1, kind: 'release' }]);
    expect(d.push(h('00 00 21 00 00'))).toEqual([{ channel: 2, kind: 'long' }]);
    expect(d.push(h('00 00 11 00 00'))).toEqual([]);
    expect(d.push(h('00 00 00 00 00'))).toEqual([{ channel: 2, kind: 'release' }]);
    expect(d.push(h('00 00 00 00 42'))).toEqual([{ channel: 4, kind: 'double' }]);
  });
});

describe('SRAM AXS : interface seule', () => {
  it('non pris en charge', async () => {
    expect(SRAM_AXS_STUB.supported).toBe(false);
    await expect(SRAM_AXS_STUB.bond(async () => {})).rejects.toThrow();
  });
});

describe('ANT+ Controls page 73 (expérimental)', () => {
  it('décodage + déduplication par séquence', () => {
    const c = decodeAntGenericCommand(h('49 34 12 FF 00 05 01 00'))!;
    expect(c).toEqual({ serialNumber: 0x1234, manufacturerId: 0xff, sequence: 5, command: 1 });
    const d = new AntGenericCommandDeduplicator();
    expect(d.accept(c)).toBe(true);
    expect(d.accept(c)).toBe(false);
    expect(decodeAntGenericCommand(h('10 00 00 00 00 00 00 00'))).toBeUndefined();
  });
});
