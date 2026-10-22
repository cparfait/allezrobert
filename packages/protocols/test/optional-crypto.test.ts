/**
 * Primitives AES (vecteurs officiels), mode « Zap » des manettes Zwift et SRAM AXS.
 * Vecteurs SRAM : exemple publié et capture réelle d'un RD-GX-E-B1 dans GaborWnuk/sram-axs
 * (PROTOCOL.md §6.2 et sa capture de test, MPL-2.0 ; série remplacée par 1234567890 par l'auteur).
 * Annonces : exemples de tarekrached/esphome-sram-axs (docs/protocol.md, MIT).
 */
import { describe, expect, it } from 'vitest';
import {
  AesKey,
  SRAM_AXS,
  SRAMBOND_V1,
  SramAxsClickClassifier,
  SramAxsGearTracker,
  aesCmac,
  buildZapHandshake,
  ccmDecrypt,
  ccmEncrypt,
  createZapUnlockStrategy,
  decodeSramAxsDeviceRecord,
  decodeSramAxsDrivetrainConfig,
  decodeSramAxsDrivetrainStatus,
  decodeSramAxsManufacturerData,
  decodeSramAxsMicroAdjust,
  decodeSramAxsModelId,
  decodeSramAxsSerial,
  decodeSramAxsServiceData,
  decodeSramAxsSupplementalRecord,
  decodeSramAxsUsageRecord,
  decodeZwiftControllerMessage,
  decryptSramAxsFrame,
  decryptZapFrame,
  deriveZapSessionFromSecret,
  eaxDecrypt,
  eaxEncrypt,
  encryptZapFrame,
  fromHex,
  generateZapKeyPair,
  isSramAxsChangeEdge,
  sramAxsSerialFromName,
  srambondCreateBond,
  srambondPublicKey,
  srambondSharedSecret,
  srambondUnwrapDeviceKey,
  toHex,
  zapSessionFromHkdf,
  zapSharedSecret,
  ZWIFT_RIDE_ON,
} from '../src/index.ts';

const h = (s: string) => fromHex(s.replace(/\s+/g, ''));
const hx = (b: Uint8Array) => toHex(b).replace(/ /g, '');
const subtle = (globalThis as { crypto?: { subtle?: SubtleCrypto } }).crypto?.subtle;

describe('AES (FIPS-197, RFC 4493, EAX, RFC 3610)', () => {
  it('bloc AES-128 et AES-256 (FIPS-197 annexe C)', () => {
    expect(hx(new AesKey(h('000102030405060708090a0b0c0d0e0f')).encryptBlock(h('00112233445566778899aabbccddeeff')))).toBe('69c4e0d86a7b0430d8cdb78070b4c55a');
    expect(hx(new AesKey(h('000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f')).encryptBlock(h('00112233445566778899aabbccddeeff')))).toBe('8ea2b7ca516745bfeafc49904b496089');
  });

  it('CMAC (RFC 4493 exemples 1 et 2)', () => {
    const k = h('2b7e151628aed2a6abf7158809cf4f3c');
    expect(hx(aesCmac(k, new Uint8Array(0)))).toBe('bb1d6929e95937287fa37d129b756746');
    expect(hx(aesCmac(k, h('6bc1bee22e409f96e93d7e117393172a')))).toBe('070a16b46b4d4144f79bdd9dd04a287c');
  });

  it('EAX (vecteurs de l’article EAX) et aller-retour', () => {
    expect(hx(eaxEncrypt(h('233952dee4d5ed5f9b9c6d6ff80ff478'), h('62ec67f9c3a4a407fcb2a8c49031a8b3'), new Uint8Array(0), { header: h('6bfb914fd07eae6b') }))).toBe('e037830e8389f27b025a2d6527e79d01');
    const sealed = eaxEncrypt(h('91945d3f4dcbee0bf45ef52255f095a4'), h('becaf043b0a23d843194ba972c66debd'), h('f7fb'), { header: h('fa3bfd4806eb53fa') });
    expect(hx(sealed)).toBe('19dd5c4c9331049d0bdab0277408f67967e5');
    expect(hx(eaxDecrypt(h('91945d3f4dcbee0bf45ef52255f095a4'), h('becaf043b0a23d843194ba972c66debd'), sealed, { header: h('fa3bfd4806eb53fa') }))).toBe('f7fb');
    sealed[0] = sealed[0]! ^ 1;
    expect(() => eaxDecrypt(h('91945d3f4dcbee0bf45ef52255f095a4'), h('becaf043b0a23d843194ba972c66debd'), sealed, { header: h('fa3bfd4806eb53fa') })).toThrow();
  });

  it('CCM (RFC 3610 paquet 1) et AES-256 / nonce 8 / étiquette 4 (référence OpenSSL)', () => {
    const out = ccmEncrypt(h('c0c1c2c3c4c5c6c7c8c9cacbcccdcecf'), h('00000003020100a0a1a2a3a4a5'), h('08090a0b0c0d0e0f101112131415161718191a1b1c1d1e'), { tagLength: 8, aad: h('0001020304050607') });
    expect(hx(out)).toBe('588c979a61c663d2f066d0c2c0f989806d5f6b61dac38417e8d12cfdf926e0');
    const key = new Uint8Array(32).fill(0x11);
    const z = ccmEncrypt(key, h('0102030405000000'), h('0708001001'), { tagLength: 4 });
    expect(hx(z)).toBe('b4b7287912025a616b');
    expect(hx(ccmDecrypt(key, h('0102030405000000'), z, { tagLength: 4 }))).toBe('0708001001');
    z[8] = z[8]! ^ 1;
    expect(() => ccmDecrypt(key, h('0102030405000000'), z, { tagLength: 4 })).toThrow();
  });
});

describe('Zwift « Zap » (anciens firmwares chiffrés, expérimental)', () => {
  it('trame de poignée de main : RideOn 01 02 + clé de 64 octets', () => {
    const k = new Uint8Array(64).fill(0xab);
    const f = buildZapHandshake(k);
    expect(f.length).toBe(72);
    expect(hx(f.subarray(0, 8))).toBe('526964654f6e0102');
  });

  it('trame chiffrée : compteur tel que reçu dans le nonce, clair = [type][protobuf]', () => {
    const session = zapSessionFromHkdf(Uint8Array.from({ length: 36 }, (_, i) => i));
    expect(hx(session.iv)).toBe('20212223');
    const frame = encryptZapFrame(session, 0x22, h('37 08 00 10 01'));
    expect(hx(frame.subarray(0, 4))).toBe('22000000');
    const { counter, plaintext } = decryptZapFrame(session, frame);
    expect(counter).toBe(0x22);
    expect(decodeZwiftControllerMessage(plaintext)).toEqual({ type: 'buttons', source: 'click', pressed: ['plus'] });
  });

  it.skipIf(!subtle)('échange ECDH + HKDF : la stratégie déchiffre ce que la « manette » chiffre', async () => {
    const s = subtle!;
    const strategy = createZapUnlockStrategy({ subtle: s });
    const [hello] = await strategy.handshake();
    expect(hello!.length).toBe(72);
    const hostPublic = hello!.subarray(8);
    // Côté manette simulée.
    const device = await generateZapKeyPair(s);
    const secret = await zapSharedSecret(s, device.privateKey, hostPublic);
    const deviceSession = await deriveZapSessionFromSecret(s, secret, device.publicKey, hostPublic);
    await strategy.onHandshakeResponse!(Uint8Array.from([...ZWIFT_RIDE_ON, 0x01, 0x03, ...device.publicKey]));
    expect(strategy.mode).toBe('encrypted');
    const frame = encryptZapFrame(deviceSession, 1, h('19 08 4b'));
    expect(decodeZwiftControllerMessage(strategy.decrypt!(frame))).toEqual({ type: 'battery', percent: 75 });
  });

  it.skipIf(!subtle)('firmware récent : réponse sans clé → trames en clair', async () => {
    const strategy = createZapUnlockStrategy({ subtle: subtle! });
    await strategy.handshake();
    await strategy.onHandshakeResponse!(h('52 69 64 65 4f 6e 01 03'));
    expect(strategy.mode).toBe('plain');
    expect(hx(strategy.decrypt!(h('37 08 00 10 01')))).toBe('3708001001');
  });
});

describe('SRAM AXS : annonces BLE (sans connexion)', () => {
  it('données fabricant standard (12 octets) : batterie mV et %, firmware', () => {
    expect(decodeSramAxsManufacturerData(h('00 00 01 02 00 04 05 b6 1f 03 80 64'))).toEqual({ firmware: [1, 2], batteryMv: 8118, batteryPercent: 100 });
    // Pile bouton : % non fourni (0xFF).
    expect(decodeSramAxsManufacturerData(h('00 00 01 02 00 04 05 c0 0a 03 80 ff'))).toEqual({ firmware: [1, 2], batteryMv: 2752 });
    expect(decodeSramAxsManufacturerData(h('00 00 01'))).toBeUndefined();
  });

  it('données de service FE51 et forme de 25 octets (série intégrée)', () => {
    const svc = '0d 03 d2 02 96 49 32 04 81';
    expect(decodeSramAxsServiceData(h(svc))).toEqual({ serial: 1234567890, classByte: 0x81, packPowered: true });
    const ext = decodeSramAxsManufacturerData(h(`00 00 01 02 00 04 05 b6 1f 03 80 64 01 01 09 ${svc} 01`));
    expect(ext).toMatchObject({ serial: 1234567890, packPowered: true, batteryMv: 8118 });
    expect(decodeSramAxsSupplementalRecord(h(`01 01 09 ${svc} 01`))?.serial).toBe(1234567890);
    expect(sramAxsSerialFromName('SRAM 1234567890')).toBe(1234567890);
    expect(sramAxsSerialFromName('Zwift Click')).toBeUndefined();
  });
});

describe('SRAM AXS : caractéristiques en clair (capture RD-GX-E-B1)', () => {
  it('série, modèle, firmware + build, MicroAdjust, compteur', () => {
    expect(decodeSramAxsSerial(h('d2029649'))).toBe(1234567890);
    expect(decodeSramAxsModelId(h('3304'))).toBe(1075);
    expect(decodeSramAxsDeviceRecord(h('0200000000063702000002015401000000010106402805' + '0067333133636161306564362e64697200'))).toEqual({
      major: 2,
      minor: 55,
      patch: 6,
      text: '2.55.6',
      buildId: 'g313caa0ed6.dir',
    });
    expect(decodeSramAxsMicroAdjust(h('b80101c0010cc80117'))).toEqual({ min: 1, current: 12, max: 23 });
    const usage = new Uint8Array(54);
    usage[46] = 0x34;
    usage[47] = 0x12;
    usage[50] = 22;
    expect(decodeSramAxsUsageRecord(usage)).toEqual({ shiftCountLow: 22, uptime: 0x1234 });
    expect(isSramAxsChangeEdge(h('ff'))).toBe(true);
    expect(isSramAxsChangeEdge(h('ff 00'))).toBe(false);
    expect(SRAM_AXS.liveState).toBe('d905000b-90aa-4c7c-b036-1e01fb8eb7ee');
  });
});

describe('SRAM AXS : SRAMBond v1 (exemple publié, PROTOCOL.md §6.2)', () => {
  // La clé privée de l'exemple est notée en petit-boutiste ; tout ce qui passe sur le fil est gros-boutiste.
  const privLE = h('6418b20cb4e1d4cf4af19b184aff1d2a');
  const priv = privLE.slice().reverse();
  const devicePublic = h('9ac11ad0a4f6c2b99c5559e2d210c410');
  const blob = h('8d7a16ed42128ee445b9864f20324a0e 0b9e1982be7a9ad3cf611f453696fa8d 2f24f1878c44eb7f77ff5b4a3c616395');

  it('clé publique, secret partagé, clé du composant', () => {
    expect(hx(srambondPublicKey(priv))).toBe('297ca1db5827261af813875fd09800b0');
    const shared = srambondSharedSecret(priv, devicePublic);
    expect(hx(shared)).toBe('55406a336a328156b81019d7ac3d5d24');
    expect(hx(srambondUnwrapDeviceKey(shared, blob))).toBe('b0690781867fde13ac1b9d30bbb4004f');
  });

  it('séquence complète : init, clé publique, 0x73 — et rien d’autre', async () => {
    const writes: string[] = [];
    const reads = [devicePublic, blob];
    const key = await srambondCreateBond({ write: async (d) => void writes.push(hx(d)), read: async () => reads.shift()! }, () => priv.slice());
    expect(hx(key)).toBe('b0690781867fde13ac1b9d30bbb4004f');
    expect(writes).toEqual([hx(SRAMBOND_V1.init), '297ca1db5827261af813875fd09800b0', '73']);
  });

  it('composant pas en mode appairage : erreur explicite', async () => {
    await expect(srambondCreateBond({ write: async () => undefined, read: async () => new Uint8Array(0) }, () => priv.slice())).rejects.toThrow(/bouton AXS/);
  });
});

describe('SRAM AXS : rapport engagé (trames réelles d905000b)', () => {
  const deviceKey = h('1f1dd977bc1c6707e6da9b811608f456');
  const sweep: Array<[number, string]> = [
    [1, '597c1e0ca539c9e80c9e5f010ac5274a22419e2dcbee1f99fe1b7ce7fae2a4def1caffddbe325cbfc8'],
    [7, '174d634b6f0dfc866d918339d09f4dc209e31b9c9213bf466b40743b3f9230da1e74fddb0481f60de9'],
    [12, 'be32c0a36b2542d6b095937cba5967391a40f47819b235de6557d17e8275b6d81c55354b14b119eb22'],
  ];

  it('déchiffrement → drivetrain_status', () => {
    const pt = decryptSramAxsFrame(deviceKey, h(sweep[1]![1]));
    expect(hx(pt)).toBe('a00101a80107b0010c');
    for (const [gear, frame] of sweep) expect(decodeSramAxsDrivetrainStatus(decryptSramAxsFrame(deviceKey, h(frame)))).toEqual({ front: 1, rear: gear, rearTrim: 12 });
    expect(() => decryptSramAxsFrame(new Uint8Array(16), h(sweep[0]![1]))).toThrow();
  });

  it('drivetrain_config, suivi des changements', () => {
    expect(decodeSramAxsDrivetrainConfig(h('b8 01 02 c0 01 0c c8 01 05'))).toEqual({ frontGears: 2, rearGears: 12, trimPositions: 5 });
    expect(decodeSramAxsDrivetrainStatus(h('ff ff ff'))).toEqual({});
    const t = new SramAxsGearTracker();
    expect(t.update({ rear: 7, front: 1 })).toEqual([]);
    expect(t.update({ rear: 9, front: 1 })).toEqual(['up', 'up']);
    expect(t.update({ rear: 8, front: 2 })).toEqual(['down', 'frontUp']);
  });

  it('sans appairage : clic simple / double au temps', () => {
    const c = new SramAxsClickClassifier(300);
    expect(c.press(0)).toBeUndefined();
    expect(c.poll(200)).toBeUndefined();
    expect(c.poll(300)).toBe('single');
    expect(c.press(1000)).toBeUndefined();
    expect(c.press(1200)).toBe('double');
    expect(c.poll(2000)).toBeUndefined();
  });
});
