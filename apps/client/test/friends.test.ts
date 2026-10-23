import { describe, expect, it } from 'vitest';
import { formatFriendCode, isFriendCode, normalizeFriendCode, type FriendEntry, type FriendPresence } from '@allezrobert/shared';
import {
  badgeCount,
  friendCodeFromSearch,
  friendErrorMessage,
  friendLink,
  initials,
  joinSettings,
  presenceLabel,
  presenceParts,
  remainingLabel,
  segmentTime,
  sortFriends,
  withoutFriendParam,
} from '../src/ui/friendsLogic.ts';

const friend = (name: string, presence: FriendPresence): Pick<FriendEntry, 'name' | 'presence'> => ({ name, presence });
const RIDE = { routeId: 'chevreuse-boucle', name: 'Boucle de Chevreuse', mode: 'group' as const, riders: 3 };
const riding = (riders = 3): FriendPresence => ({ state: 'riding', ride: { ...RIDE, riders } });

describe('amis — code et lien', () => {
  it('code ami : saisie tolérante, validation, affichage en deux groupes', () => {
    expect(normalizeFriendCode(' k7qm-2xra ')).toBe('K7QM2XRA');
    expect(isFriendCode('K7QM2XRA')).toBe(true);
    // Caractères ambigus exclus de l'alphabet (0, O, 1, I, L).
    expect(isFriendCode('K7QM2XR0')).toBe(false);
    expect(isFriendCode('K7QM2XR')).toBe(false);
    expect(formatFriendCode('k7qm2xra')).toBe('K7QM-2XRA');
    expect(formatFriendCode('abc')).toBe('ABC');
  });

  it('lien /?ami=CODE : lecture, construction, retrait de l’adresse', () => {
    expect(friendCodeFromSearch('?ami=k7qm-2xra')).toBe('K7QM2XRA');
    expect(friendCodeFromSearch('?route=x&ami=K7QM2XRA')).toBe('K7QM2XRA');
    expect(friendCodeFromSearch('?ami=nimporte')).toBeNull();
    expect(friendCodeFromSearch('?route=x')).toBeNull();
    expect(friendLink('https://allezrobert.cparfait.ovh/', 'k7qm-2xra')).toBe('https://allezrobert.cparfait.ovh/?ami=K7QM2XRA');
    expect(withoutFriendParam('http://localhost:5173/?route=r1&ami=K7QM2XRA')).toBe('http://localhost:5173/?route=r1');
  });
});

describe('amis — liste et présence', () => {
  it('tri : en sortie, puis en ligne, puis hors ligne ; alphabétique ensuite (accents ignorés)', () => {
    const list = [friend('Zoé', { state: 'offline' }), friend('Émile', { state: 'online' }), friend('bob', { state: 'riding', ride: RIDE }), friend('Alice', { state: 'offline' }), friend('Agathe', riding())];
    expect(sortFriends(list).map((f) => f.name)).toEqual(['Agathe', 'bob', 'Émile', 'Alice', 'Zoé']);
    // La liste d'origine n'est pas modifiée.
    expect(list[0]!.name).toBe('Zoé');
  });

  it('libellés de présence (FR / EN), itinéraire traduit si connu', () => {
    expect(presenceLabel({ state: 'offline' }, 'fr')).toBe('Hors ligne');
    expect(presenceLabel({ state: 'online' }, 'fr')).toBe('En ligne · dans le menu');
    expect(presenceLabel(riding(3), 'fr')).toBe('Roule · Boucle de Chevreuse · sortie de groupe · 3 coureurs');
    expect(presenceLabel(riding(1), 'en', () => 'Chevreuse loop')).toBe('Riding · Chevreuse loop · group ride · 1 rider');
    expect(presenceLabel(riding(2), 'fr', () => undefined)).toContain('Boucle de Chevreuse');
    // En deux parties pour la liste (l'itinéraire, souvent long, sur sa propre ligne).
    expect(presenceParts(riding(2), 'fr')).toEqual({ state: 'Roule · sortie de groupe · 2 coureurs', where: 'Boucle de Chevreuse' });
    expect(presenceParts({ state: 'offline' }, 'en')).toEqual({ state: 'Offline' });
    expect(presenceParts({ state: 'riding', ride: RIDE, withYou: true }, 'fr').state).toBe('Roule avec toi · sortie de groupe · 3 coureurs');
  });

  it('pastille : demandes reçues + invitations', () => {
    expect(badgeCount(null)).toBe(0);
    expect(badgeCount({ incoming: [{ id: 'a', name: 'A', color: '#fff', createdAt: '' }], invites: [] })).toBe(1);
    expect(badgeCount({ incoming: [{ id: 'a', name: 'A', color: '#fff', createdAt: '' }], invites: [{ id: 'i', from: 'B', fromColor: '#fff', ride: RIDE, expiresAt: '' }] })).toBe(2);
  });

  it('temps restant, temps de segment, initiales', () => {
    const now = Date.parse('2026-10-22T10:00:00Z');
    expect(remainingLabel('2026-10-22T10:24:30Z', now, 'fr')).toBe('encore 24 min');
    expect(remainingLabel('2026-10-22T10:00:20Z', now, 'fr')).toBe('expire bientôt');
    expect(remainingLabel('pas une date', now, 'en')).toBe('expires soon');
    expect(segmentTime(278_400)).toBe('4:38');
    expect(segmentTime(3_723_000)).toBe('1:02:03');
    expect(initials('Jean-Pierre Dupont')).toBe('JD');
    expect(initials('  ')).toBe('?');
  });
});

describe('amis — rejoindre et erreurs', () => {
  it('rejoindre : mode groupe ou course, itinéraire de l’ami s’il est dans ce monde', () => {
    const cur = { mode: 'free' as const, routeId: 'r-locale' };
    expect(joinSettings({ mode: 'race', routeId: 'r2' }, ['r1', 'r2'], cur)).toEqual({ mode: 'race', routeId: 'r2', reverse: false, startM: 0, routeKnown: true });
    expect(joinSettings({ mode: 'group', routeId: 'ailleurs' }, ['r1'], cur)).toEqual({ mode: 'group', routeId: 'r-locale', reverse: false, startM: 0, routeKnown: false });
    // l'ami roule le parcours dans l'autre sens : on le rejoint dans ce sens
    expect(joinSettings({ mode: 'group', routeId: 'r1-inverse' }, ['r1'], cur)).toEqual({ mode: 'group', routeId: 'r1', reverse: true, startM: 0, routeKnown: true });
    // l'ami est parti d'un autre point de la boucle : même départ (et même sens)
    expect(joinSettings({ mode: 'group', routeId: 'r1-inverse-depart-5400' }, ['r1'], cur)).toEqual({ mode: 'group', routeId: 'r1', reverse: true, startM: 5400, routeKnown: true });
    expect(joinSettings({ mode: 'group', routeId: 'r1-depart-120' }, ['r1'], cur)).toMatchObject({ routeId: 'r1', reverse: false, startM: 120 });
    expect(joinSettings({ mode: 'free', routeId: 'r1' }, ['r1'], cur).mode).toBe('group');
  });

  it('messages d’erreur de l’API', () => {
    expect(friendErrorMessage('self', 'fr')).toBe('C’est ton propre code ami !');
    expect(friendErrorMessage('unknown_code', 'en')).toBe('No rider with this code.');
    expect(friendErrorMessage('inconnu', 'fr')).toBe('Action impossible pour le moment.');
    expect(friendErrorMessage(undefined, 'en')).toBe('Could not do that right now.');
  });
});
