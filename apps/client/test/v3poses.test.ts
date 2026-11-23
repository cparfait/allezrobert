import { describe, expect, it } from 'vitest';
import { clipForBike, transitionClip } from '../src/v3/visuals.ts';

const clips = new Set([
  'cyclistSeatedHoods', 'cyclistSeatedDrops', 'cyclistStandingHoods', 'cyclistSprint', 'cyclistSuperAero',
  'cyclistSeatedDrops_TT', 'cyclistStandingHoods_TT', 'CyclistSeatedHoodsMountain', 'CyclistSeatedDropsMountain',
  'CyclistSeatedHoodsRecumbent', 'cyclistFootDownIdle', 'CyclistFootDownIdleMountain', 'cyclistClipIn', 'cyclistClipOut',
  'cyclist_clipIn_TT', 'CyclistIdleRecumbent',
]);
const exists = (name: string) => clips.has(name);

describe('postures V3 en sortie', () => {
  it('adapte la posture au type de vélo', () => {
    expect(clipForBike('cyclistSeatedHoods', 'chrono', exists)).toBe('cyclistSeatedDrops_TT');
    expect(clipForBike('cyclistSeatedDrops', 'vtt', exists)).toBe('CyclistSeatedDropsMountain');
    expect(clipForBike('cyclistSeatedHoods', 'couché', exists)).toBe('CyclistSeatedHoodsRecumbent');
    expect(clipForBike('cyclistSprint', 'route', exists)).toBe('cyclistSprint');
  });

  it('garde la pose debout à l\'arrêt quel que soit le vélo (portrait du départ)', () => {
    const withStanding = (name: string) => exists(name) || /StandingHoodsMountain|SprintRecumbent|SprintHandcycle/.test(name);
    for (const type of ['vtt', 'couché', 'handbike', 'chrono', 'route']) {
      expect(clipForBike('CyclistStandingIdle01', type, withStanding)).toBe('CyclistStandingIdle01');
    }
  });

  it('pied à terre, départ et arrivée selon le vélo', () => {
    expect(transitionClip('idle', 'vtt', exists)).toBe('CyclistFootDownIdleMountain');
    expect(transitionClip('idle', 'chrono', exists)).toBe('cyclistFootDownIdle');
    expect(transitionClip('clipIn', 'chrono', exists)).toBe('cyclist_clipIn_TT');
    expect(transitionClip('clipOut', 'route', exists)).toBe('cyclistClipOut');
    expect(transitionClip('idle', 'couché', exists)).toBe('CyclistIdleRecumbent');
    expect(transitionClip('clipIn', 'couché', exists)).toBeUndefined();
  });
});
