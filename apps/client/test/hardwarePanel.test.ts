import { describe, expect, it, vi } from 'vitest';

// Le panneau importe les réglages et la langue, qui lisent `localStorage` dès leur chargement.
vi.hoisted(() => {
  const store = new Map<string, string>();
  (globalThis as { localStorage?: unknown }).localStorage ??= { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) };
});

import { deviceOptionsHtml, deviceTilesHtml, type DeviceTileDevice } from '../src/ui/hardware-panel.ts';

const dev = (id: string, roles: string[], over: Partial<DeviceTileDevice> = {}): DeviceTileDevice => ({ id, name: id.toUpperCase(), roleIds: roles, ok: true, raw: 'connected', state: 'connecté', ...over });
const count = (html: string, needle: string) => html.split(needle).length - 1;
const tileOf = (html: string, role: string) => html.split('<div class="ab-tile').find((part) => part.includes(`data-role="${role}"`)) ?? '';

describe('onglet Capteurs : blocs des appareils', () => {
  it('six blocs, un bouton d’association par rôle, les mêmes mots d’état que l’écran de départ', () => {
    const html = deviceTilesHtml({ devices: [], simulatorOn: false, lang: 'fr' });
    expect(count(html, 'class="ab-tile')).toBe(6);
    for (const role of ['trainer', 'power', 'cadence', 'heartRate', 'shifter', 'fan']) expect(count(html, `data-pair="${role}"`)).toBe(1);
    expect(count(html, 'Non associé')).toBe(6);
    expect(count(html, '>Associer<')).toBe(6);
    expect(html).not.toContain('data-forget');
  });

  it('home trainer connecté : état, liens de l’appareil, watts en direct, puissance fournie par lui', () => {
    const html = deviceTilesHtml({
      devices: [dev('neo', ['trainer'], { canReconnect: true })],
      live: { powerFrom: 'trainer', powerName: 'NEO', watts: 187 },
      simulatorOn: false,
      canReconnect: true,
      roadFeel: true,
      liveText: (kind) => (kind === 'watts' ? '187 W' : '–'),
      lang: 'fr',
    });
    const trainer = tileOf(html, 'trainer');
    expect(trainer).toContain('is-ok');
    expect(trainer).toContain('Connecté');
    expect(trainer).toContain('data-forget="neo"');
    expect(trainer).toContain('data-reconnect="neo"');
    expect(trainer).toContain('data-roadtest-open');
    expect(trainer).toContain('<b data-live="watts">187 W</b>');
    expect(trainer).toContain('>Changer<');
    const power = tileOf(html, 'power');
    expect(power).toContain('NEO · via le home trainer');
    expect(power).toContain('>Associer<');
    expect(power).toContain('pédales associées');
  });

  it('simulateur : blocs « Simulé », sans lien « oublier »', () => {
    const html = deviceTilesHtml({ devices: [dev('kickr sim', ['trainer'], { simulated: true }), dev('assioma sim', ['power', 'cadence'], { simulated: true })], live: { watts: 210, cadence: 88 }, simulatorOn: true, liveText: () => '210 W', lang: 'fr' });
    expect(tileOf(html, 'power')).toContain('Simulé');
    expect(tileOf(html, 'power')).toContain('hw-sim');
    expect(html).not.toContain('data-forget');
  });

  it('signal perdu et recherche se distinguent ; les noms sont échappés', () => {
    const html = deviceTilesHtml({ devices: [dev('tickr', ['heartRate'], { ok: false, raw: 'silent', name: '<b>TICKR</b>' }), dev('rpm', ['cadence'], { ok: false, raw: 'reconnecting' })], simulatorOn: false, lang: 'fr' });
    expect(tileOf(html, 'heartRate')).toContain('Signal perdu');
    expect(tileOf(html, 'heartRate')).toContain('&lt;b&gt;TICKR&lt;/b&gt;');
    expect(tileOf(html, 'cadence')).toContain('Recherche…');
  });

  it('le rapport ne s’affiche sur le bloc Vitesses qu’avec une cassette réelle', () => {
    const base = { devices: [dev('di2', ['shifter'])], live: { gear: '34×17' }, simulatorOn: false, liveText: () => '34×17', lang: 'fr' as const };
    expect(tileOf(deviceTilesHtml(base), 'shifter')).not.toContain('data-live');
    expect(tileOf(deviceTilesHtml({ ...base, cassette: true }), 'shifter')).toContain('data-live="gear"');
  });

  it('anglais tenu à jour', () => {
    const html = deviceTilesHtml({ devices: [], simulatorOn: false, lang: 'en' });
    expect(html).toContain('Not paired');
    expect(html).toContain('>Pair<');
    expect(html).toContain('Heart rate');
  });
});

describe('onglet Capteurs : connexion, simulateur, invité', () => {
  it('garde les identifiants lus par le menu', () => {
    const html = deviceOptionsHtml({ transportSeg: '<div id="m-transport"></div>', bluetooth: true, simulatorOn: true, guest: false, lang: 'fr' });
    expect(html).toContain('id="m-transport"');
    expect(html).toContain('id="m-adapters"');
    expect(html).toMatch(/id="m-sim"[^>]*checked/);
    expect(html).toMatch(/id="m-guest"(?![^>]*checked)/);
  });

  it('la mise en garde Bluetooth n’apparaît qu’avec le Bluetooth du navigateur ; les avertissements sont échappés', () => {
    const off = deviceOptionsHtml({ transportSeg: '', bluetooth: false, simulatorOn: false, guest: false, warnings: ['<i>ANT+</i> absent'], lang: 'fr' });
    expect(off).not.toContain('une appli à la fois');
    expect(off).toContain('&lt;i&gt;ANT+&lt;/i&gt; absent');
    expect(off).not.toContain('Connexion');
    expect(deviceOptionsHtml({ transportSeg: 'x', bluetooth: true, simulatorOn: false, guest: false, lang: 'fr' })).toContain('une appli à la fois');
  });
});
