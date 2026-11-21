import { describe, expect, it } from 'vitest';
import { skipStartCheck, startCheckModel, startCheckWanted, type CheckDevice, type CheckInput, type CheckRole } from '../src/ui/startCheck.ts';

const dev = (id: string, roles: CheckRole[], over: Partial<CheckDevice> = {}): CheckDevice => ({ id, name: id.toUpperCase(), roleIds: roles, ok: true, raw: 'connected', ...over });
const sim = (id: string, roles: CheckRole[]): CheckDevice => dev(id, roles, { simulated: true });
const input = (over: Partial<CheckInput>): CheckInput => ({ devices: [], simulatorOn: false, loaded: true, ...over });
const tile = (m: ReturnType<typeof startCheckModel>, role: CheckRole) => m.tiles.find((t) => t.role === role)!;

describe('écran de départ : état des blocs et du bouton', () => {
  it('montre toujours les six rôles, dans le même ordre', () => {
    expect(startCheckModel(input({})).tiles.map((t) => t.role)).toEqual(['trainer', 'power', 'cadence', 'heartRate', 'shifter', 'fan']);
  });

  it('simulateur seul : blocs simulés, départ possible', () => {
    const m = startCheckModel(input({ simulatorOn: true, devices: [sim('kickr sim', ['trainer']), sim('assioma sim', ['power', 'cadence']), sim('tickr sim', ['heartRate'])], live: { powerFrom: 'pedals', watts: 209.6, cadence: 88.2, hr: 131 } }));
    expect(tile(m, 'trainer').state).toBe('simulated');
    expect(tile(m, 'power')).toMatchObject({ state: 'simulated', value: 210, unit: 'W' });
    expect(tile(m, 'heartRate')).toMatchObject({ state: 'simulated', value: 131, unit: 'bpm' });
    expect(m.powerSource).toBe('simulator');
    expect(m.canStart).toBe(true);
    expect(m.reason).toBe('ok');
    expect(m.offerSimulator).toBe(false);
  });

  it('home trainer connecté : puissance et cadence fournies par lui, capteurs dédiés facultatifs à associer', () => {
    const m = startCheckModel(input({ devices: [dev('neo', ['trainer'])], live: { powerFrom: 'trainer', powerName: 'NEO', watts: 187, cadenceFrom: 'trainer', cadenceName: 'NEO', cadence: 91 } }));
    expect(tile(m, 'trainer')).toMatchObject({ state: 'live', device: 'NEO', value: 187, unit: 'W', action: 'none', optional: false });
    expect(tile(m, 'power')).toMatchObject({ state: 'live', via: 'trainer', value: 187, action: 'pair' });
    expect(tile(m, 'cadence')).toMatchObject({ state: 'live', via: 'trainer', value: 91, unit: 'tr/min', optional: true });
    expect(tile(m, 'heartRate')).toMatchObject({ state: 'none', optional: true, action: 'pair' });
    expect(m.powerSource).toBe('trainer');
    expect(m.canStart).toBe(true);
    expect(m.allConnected).toBe(true);
  });

  it('capteur de puissance seul : il suffit pour rouler', () => {
    const m = startCheckModel(input({ devices: [dev('assioma', ['power'])], live: { powerFrom: 'pedals', powerName: 'ASSIOMA', watts: 240, cadenceFrom: 'pedals', cadenceName: 'ASSIOMA', cadence: 85 } }));
    expect(tile(m, 'power')).toMatchObject({ state: 'live', device: 'ASSIOMA', value: 240 });
    expect(tile(m, 'power').via).toBeUndefined();
    expect(tile(m, 'trainer').state).toBe('none');
    // Le home trainer n'affiche pas les watts des pédales.
    expect(tile(m, 'trainer').value).toBeUndefined();
    expect(tile(m, 'cadence')).toMatchObject({ state: 'live', via: 'pedals' });
    expect(m.powerSource).toBe('power');
    expect(m.canStart).toBe(true);
  });

  it('rien du tout : pas de départ, le simulateur est proposé', () => {
    const m = startCheckModel(input({}));
    expect(m.tiles.every((t) => t.state === 'none' && t.action === 'pair')).toBe(true);
    expect(m.powerSource).toBe('none');
    expect(m.canStart).toBe(false);
    expect(m.reason).toBe('noPower');
    expect(m.offerSimulator).toBe(true);
    expect(m.allConnected).toBe(false);
  });

  it('signal perdu : le bloc le dit, propose de reconnecter, et bloque le départ sans autre source', () => {
    const m = startCheckModel(input({ devices: [dev('neo', ['trainer'], { ok: false, raw: 'disconnected', canReconnect: true }), dev('tickr', ['heartRate'], { ok: false, raw: 'silent' })] }));
    expect(tile(m, 'trainer')).toMatchObject({ state: 'lost', action: 'reconnect', deviceId: 'neo', device: 'NEO' });
    // Sans reconnexion directe possible (Web Bluetooth) : on repasse par l'association.
    expect(tile(m, 'heartRate')).toMatchObject({ state: 'lost', action: 'pair' });
    expect(m.canStart).toBe(false);
    expect(m.reason).toBe('noPower');
    expect(m.offerSimulator).toBe(true);
  });

  it('recherche en cours : état « recherche », pas de clic, pas encore prêt', () => {
    const m = startCheckModel(input({ devices: [dev('neo', ['trainer'], { ok: false, raw: 'reconnecting' })] }));
    expect(tile(m, 'trainer')).toMatchObject({ state: 'searching', action: 'none' });
    expect(m.allConnected).toBe(false);
  });

  it('simulateur lancé alors qu’un vrai capteur ne répond plus : on peut rouler, le bloc reste « signal perdu »', () => {
    const m = startCheckModel(input({ simulatorOn: true, devices: [dev('neo', ['trainer'], { ok: false, raw: 'error' }), sim('kickr sim', ['trainer'])] }));
    expect(tile(m, 'trainer').state).toBe('lost');
    expect(m.powerSource).toBe('simulator');
    expect(m.canStart).toBe(true);
    expect(m.allConnected).toBe(false);
  });

  it('chargement en cours : le bouton attend, avec la raison', () => {
    const m = startCheckModel(input({ loaded: false, devices: [dev('neo', ['trainer'])] }));
    expect(m.canStart).toBe(false);
    expect(m.reason).toBe('loading');
  });

  it('un simulateur coupé dans les réglages ne compte pas comme source', () => {
    const m = startCheckModel(input({ simulatorOn: false, devices: [sim('kickr sim', ['trainer'])] }));
    expect(m.powerSource).toBe('none');
    expect(tile(m, 'trainer').state).toBe('none');
  });
});

describe('écran de départ : quand il ne s’affiche pas', () => {
  const all = startCheckModel(input({ devices: [dev('neo', ['trainer']), dev('tickr', ['heartRate'])], live: { powerFrom: 'trainer', powerName: 'NEO', watts: 150 } }));

  it('tout connecté avec la case cochée : écran sauté', () => {
    expect(all.allConnected).toBe(true);
    expect(skipStartCheck(all, true)).toBe(true);
  });

  it('tout connecté sans la case : écran affiché', () => {
    expect(skipStartCheck(all, false)).toBe(false);
  });

  it('case cochée mais un capteur associé ne répond pas : écran affiché', () => {
    const m = startCheckModel(input({ devices: [dev('neo', ['trainer']), dev('tickr', ['heartRate'], { ok: false, raw: 'disconnected' })] }));
    expect(skipStartCheck(m, true)).toBe(false);
  });

  it('case cochée sans source de puissance : écran affiché', () => {
    expect(skipStartCheck(startCheckModel(input({})), true)).toBe(false);
  });

  it('outils, invité, tutoriel et salle déjà partie : pas d’écran', () => {
    const base = { autostart: false, nointro: false, guest: false, tutorial: false, joining: false };
    expect(startCheckWanted(base)).toBe(true);
    for (const k of Object.keys(base) as Array<keyof typeof base>) expect(startCheckWanted({ ...base, [k]: true })).toBe(false);
  });
});
