/**
 * Atelier côté serveur : vélo recalculé à partir des pièces possédées (jamais des valeurs du
 * client), option « Équipement égalisé », récompenses d'événements, migration des anciennes roues.
 */
import { describe, expect, it } from 'vitest';
import { DEFAULT_BIKE, bikeSetupFor } from '@allezrobert/shared';
import { EQUALIZED_BIKE, tunedBikeSetup } from '@allezrobert/physics';
import { grantEvents, migrateLegacyWheels, serverBike } from '../src/progression/atelier.ts';
import { resolveRideOptions } from '../src/ride/simulation.ts';
import type { AtelierState } from '../src/db/repos.ts';

const empty = (): AtelierState => ({ credits: 0, owned: [], events: [], streak: { last: '', days: 0 }, routesDone: [], koms: 0 });

describe('vélo roulé en salle', () => {
  it('pièces possédées appliquées (plafonnées), pièces non possédées ignorées', () => {
    const equipped = { bike: 'bike-carbone', wheelset: 'tune-wh-enve-67', tyres: 'tune-ty-gp5000', groupset: 'tune-gs-red' };
    const owned = ['tune-wh-enve-67', 'tune-ty-gp5000'];
    const r = serverBike(equipped, 20, owned, false);
    expect(r.tune).toEqual(['tune-wh-enve-67', 'tune-ty-gp5000']);
    expect(r.bike).toEqual(tunedBikeSetup(bikeSetupFor({ bike: 'bike-carbone' }), owned).bike);
    expect(r.bike.cda).toBeLessThan(DEFAULT_BIKE.cda);
    // Cosmétique verrouillé (niveau) : retiré aussi.
    const low = serverBike({ helmet: 'helmet-aero' }, 1, [], false);
    expect(low.bike).toEqual(DEFAULT_BIKE);
  });
  it('équipement égalisé : même vélo pour tous, pièces toujours affichées', () => {
    const r = serverBike({ wheelset: 'tune-wh-enve-67' }, 20, ['tune-wh-enve-67'], true);
    expect(r.bike).toEqual(EQUALIZED_BIKE);
    expect(r.tune).toEqual(['tune-wh-enve-67']);
  });
  it('option « Équipement égalisé » : active par défaut en course seulement', () => {
    expect(resolveRideOptions({ mode: 'race' }, 'r').equalEquipment).toBe(true);
    expect(resolveRideOptions({ mode: 'group' }, 'r').equalEquipment).toBe(false);
    expect(resolveRideOptions({ mode: 'race', equalEquipment: false }, 'r').equalEquipment).toBe(false);
  });
});

describe('récompenses et migration', () => {
  it('un événement débloque ses pièces une seule fois', () => {
    const a = empty();
    expect(grantEvents(a, ['win', 'podium'])).toEqual(expect.arrayContaining(['tune-ev-win', 'tune-ev-podium']));
    expect(grantEvents(a, ['win'])).toEqual([]);
    expect(a.events.sort()).toEqual(['podium', 'win']);
  });
  it('anciennes roues : paire de l’atelier offerte', () => {
    const a = empty();
    expect(migrateLegacyWheels({ wheels: 'wheels-lenticulaire', jersey: 'jersey-pois' }, a)).toEqual({ jersey: 'jersey-pois', wheelset: 'tune-wh-zipp-super9' });
    expect(a.owned).toEqual(['tune-wh-zipp-super9']);
    expect(migrateLegacyWheels({ wheels: 'wheels-alu' }, a)).toEqual({});
    expect(migrateLegacyWheels({ jersey: 'x' }, a)).toBeNull();
  });
});
