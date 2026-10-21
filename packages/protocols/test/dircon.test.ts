import { describe, expect, it } from 'vitest';
import {
  CHAR,
  DIRCON_MSG,
  DIRCON_PROP,
  DirconReassembler,
  SERVICE,
  decodeDirconPacket,
  dirconCharacteristicResponse,
  dirconDiscoverCharacteristics,
  dirconDiscoverCharacteristicsResponse,
  dirconDiscoverServices,
  dirconDiscoverServicesResponse,
  dirconEnableNotifications,
  dirconNotification,
  dirconPropertiesToList,
  dirconRead,
  dirconResponseName,
  dirconWrite,
  fromHex,
  parseCharacteristicPayload,
  parseDiscoverCharacteristicsResponse,
  parseDiscoverServicesResponse,
  toHex,
  ProtocolError,
} from '../src/index.ts';

const UUID_2AD2 = '00 00 2a d2 00 00 10 00 80 00 00 80 5f 9b 34 fb';
const UUID_2AD9 = '00 00 2a d9 00 00 10 00 80 00 00 80 5f 9b 34 fb';
const UUID_1826 = '00 00 18 26 00 00 10 00 80 00 00 80 5f 9b 34 fb';
const UUID_180D = '00 00 18 0d 00 00 10 00 80 00 00 80 5f 9b 34 fb';

describe('DirCon : requêtes', () => {
  it('en-tête 6 octets, longueur big-endian', () => {
    expect(toHex(dirconDiscoverServices(1))).toBe('01 01 01 00 00 00');
    expect(toHex(dirconRead(2, CHAR.indoorBikeData))).toBe(`01 03 02 00 00 10 ${UUID_2AD2}`);
    expect(toHex(dirconEnableNotifications(3, CHAR.indoorBikeData))).toBe(`01 05 03 00 00 11 ${UUID_2AD2} 01`);
    expect(toHex(dirconEnableNotifications(4, CHAR.indoorBikeData, false))).toBe(`01 05 04 00 00 11 ${UUID_2AD2} 00`);
    expect(toHex(dirconWrite(5, CHAR.fitnessMachineControlPoint, [0x05, 0xfa, 0x00]))).toBe(`01 04 05 00 00 13 ${UUID_2AD9} 05 fa 00`);
    expect(toHex(dirconDiscoverCharacteristics(6, SERVICE.fitnessMachine))).toBe(`01 02 06 00 00 10 ${UUID_1826}`);
  });

  it('séquence sur 8 bits', () => {
    expect(dirconDiscoverServices(0x1ff)[2]).toBe(0xff);
  });
});

describe('DirCon : réponses et notifications', () => {
  it('discover services', () => {
    const bytes = fromHex(`01 01 01 00 00 20 ${UUID_1826} ${UUID_180D}`);
    expect(toHex(dirconDiscoverServicesResponse(1, [SERVICE.fitnessMachine, SERVICE.heartRate]))).toBe(toHex(bytes));
    const p = decodeDirconPacket(bytes);
    expect(p).toMatchObject({ version: 1, messageId: DIRCON_MSG.discoverServices, sequence: 1, responseCode: 0 });
    expect(parseDiscoverServicesResponse(p.payload)).toEqual([SERVICE.fitnessMachine, SERVICE.heartRate]);
    expect(() => parseDiscoverServicesResponse(new Uint8Array(15))).toThrow(ProtocolError);
  });

  it('discover characteristics : UUID + propriétés', () => {
    const bytes = fromHex(`01 02 05 00 00 32 ${UUID_1826} ${UUID_2AD2} 04 ${UUID_2AD9} 0a`);
    const built = dirconDiscoverCharacteristicsResponse(5, SERVICE.fitnessMachine, [
      { uuid: CHAR.indoorBikeData, properties: DIRCON_PROP.notify },
      { uuid: CHAR.fitnessMachineControlPoint, properties: DIRCON_PROP.write | DIRCON_PROP.indicate },
    ]);
    expect(toHex(built)).toBe(toHex(bytes));
    const r = parseDiscoverCharacteristicsResponse(decodeDirconPacket(bytes).payload);
    expect(r.service).toBe(SERVICE.fitnessMachine);
    expect(r.characteristics).toEqual([
      { uuid: CHAR.indoorBikeData, properties: 4, read: false, write: false, notify: true, indicate: false },
      { uuid: CHAR.fitnessMachineControlPoint, properties: 10, read: false, write: true, notify: false, indicate: true },
    ]);
    expect(dirconPropertiesToList(0x0f)).toEqual(['read', 'write', 'notify', 'indicate']);
  });

  it('notification non sollicitée (séquence 0)', () => {
    const bytes = fromHex(`01 06 00 00 00 14 ${UUID_2AD2} 44 00 8c 0a`);
    expect(toHex(dirconNotification(CHAR.indoorBikeData, [0x44, 0x00, 0x8c, 0x0a]))).toBe(toHex(bytes));
    const p = decodeDirconPacket(bytes);
    expect(parseCharacteristicPayload(p.payload)).toEqual({ characteristic: CHAR.indoorBikeData, data: fromHex('44 00 8c 0a') });
  });

  it('code réponse d\'erreur', () => {
    const p = decodeDirconPacket(dirconCharacteristicResponse(DIRCON_MSG.readCharacteristic, 7, CHAR.indoorBikeData, [], 0x04));
    expect(p.responseCode).toBe(4);
    expect(dirconResponseName(p.responseCode)).toBe('characteristicNotFound');
  });
});

describe('DirCon : réassemblage du flux TCP', () => {
  it('trames coupées en morceaux de 3 octets', () => {
    const frame = dirconNotification(CHAR.indoorBikeData, [0x44, 0x00, 0x8c, 0x0a]);
    const r = new DirconReassembler();
    const got = [];
    for (let i = 0; i < frame.length; i += 3) got.push(...r.push(frame.subarray(i, i + 3)));
    expect(got).toHaveLength(1);
    expect(r.pending).toBe(0);
  });

  it('trames collées + déchets en tête', () => {
    const a = dirconDiscoverServicesResponse(1, [SERVICE.fitnessMachine]);
    const b = dirconNotification(CHAR.indoorBikeData, [1, 2]);
    const r = new DirconReassembler();
    const got = r.push(Uint8Array.from([0x00, 0x99, ...a, ...b, 0x01, 0x06]));
    expect(got.map((p) => p.messageId)).toEqual([1, 6]);
    expect(r.dropped).toBe(2);
    expect(r.pending).toBe(2);
  });
});
