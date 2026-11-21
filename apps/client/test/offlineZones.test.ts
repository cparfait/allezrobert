import { describe, expect, it } from 'vitest';
import { DEFAULT_ZONES, DISK_MARGIN_BYTES, decideDefaultZone, type DefaultZoneContext } from '../src/platform/offlineZones.ts';

const ok: DefaultZoneContext = { desktop: true, installed: false, declined: false, online: true, freeBytes: 50e9, bytes: 67e6, riding: false };

describe('zones installées d’office', () => {
  it('prévoit Longchamp au démarrage et l’Île de Robert en tâche de fond', () => {
    expect(DEFAULT_ZONES.map((z) => [z.id, z.when])).toEqual([
      ['longchamp', 'boot'],
      ['ile-de-robert', 'background'],
    ]);
  });

  it('installe au premier lancement de l’application', () => {
    expect(decideDefaultZone(ok)).toBe('install');
  });

  it('ne fait rien dans un navigateur', () => {
    expect(decideDefaultZone({ ...ok, desktop: false })).toBe('not-desktop');
  });

  it('ne réinstalle pas une zone déjà là', () => {
    expect(decideDefaultZone({ ...ok, installed: true })).toBe('installed');
  });

  it('respecte une suppression par le joueur', () => {
    expect(decideDefaultZone({ ...ok, declined: true })).toBe('declined');
    // Réinstallée à la main depuis : elle est là, la question ne se pose plus.
    expect(decideDefaultZone({ ...ok, declined: true, installed: true })).toBe('installed');
  });

  it('attend le réseau', () => {
    expect(decideDefaultZone({ ...ok, online: false })).toBe('offline');
  });

  it('garde une marge sur le disque', () => {
    expect(decideDefaultZone({ ...ok, freeBytes: 67e6 + DISK_MARGIN_BYTES - 1 })).toBe('disk-full');
    expect(decideDefaultZone({ ...ok, freeBytes: 67e6 + DISK_MARGIN_BYTES })).toBe('install');
    // Place libre inconnue : le Rust refait le contrôle avant d'écrire.
    expect(decideDefaultZone({ ...ok, freeBytes: null })).toBe('install');
  });

  it('ne télécharge pas pendant une sortie', () => {
    expect(decideDefaultZone({ ...ok, riding: true })).toBe('riding');
    expect(decideDefaultZone({ ...ok, riding: true, online: false })).toBe('riding');
  });
});
