import { describe, expect, it } from 'vitest';
import { WORKOUT_LIBRARY, WORKOUT_TYPES, WORKOUT_TYPE_LABELS, type LibraryWorkout, type WorkoutType } from '@allezrobert/physics';
import { durationMatches, normalizeSearch, visibleWorkouts, workoutStats, workoutStudioHtml, type StudioCtx } from '../src/ui/workoutStudio.ts';
import { WorkoutController, clampWorkoutIntensity } from '../src/game/workout.ts';

const COLORS = Object.fromEntries(WORKOUT_TYPES.map((t) => [t, '#888888'])) as Record<WorkoutType, string>;

function ctx(over: Partial<StudioCtx> = {}): StudioCtx {
  return {
    fr: true,
    filter: '',
    types: WORKOUT_TYPES,
    library: WORKOUT_LIBRARY,
    mine: [],
    favs: new Set<string>(),
    current: undefined,
    selected: undefined,
    ftp: 250,
    typeColors: COLORS,
    typeLabels: WORKOUT_TYPE_LABELS,
    zoneColor: () => '#3b82f6',
    query: '',
    dur: '',
    sort: 'type',
    intensity: 1,
    ...over,
  };
}

describe('studio des séances : filtres et tri', () => {
  it('recherche sans accents ni casse, tous les mots exigés', () => {
    expect(normalizeSearch('  Récupération   ACTIVE ')).toBe('recuperation active');
    const v = visibleWorkouts(ctx({ query: 'recuperation active' }));
    expect(v.map((w) => w.id)).toContain('recuperation');
    expect(v.every((w) => normalizeSearch(`${w.name.fr} ${w.description.fr} ${w.name.en} ${w.description.en} ${WORKOUT_TYPE_LABELS[w.type].fr}`).includes('recuperation'))).toBe(true);
    expect(visibleWorkouts(ctx({ query: 'zzz-aucune-seance' }))).toHaveLength(0);
  });

  it('filtre de durée : bornes en minutes arrondies, borne haute incluse', () => {
    expect(durationMatches(30 * 60, 'le30')).toBe(true);
    expect(durationMatches(31 * 60, 'le30')).toBe(false);
    expect(durationMatches(31 * 60, '30-45')).toBe(true);
    expect(durationMatches(45 * 60, '30-45')).toBe(true);
    expect(durationMatches(90 * 60, '60-90')).toBe(true);
    expect(durationMatches(91 * 60, 'gt90')).toBe(true);
    expect(durationMatches(5 * 3600, '')).toBe(true);
    for (const w of visibleWorkouts(ctx({ dur: '45-60' }))) {
      const m = Math.round(workoutStats(w).total / 60);
      expect(m > 45 && m <= 60).toBe(true);
    }
  });

  it('les filtres se cumulent avec la famille', () => {
    const v = visibleWorkouts(ctx({ filter: 'threshold', dur: '60-90' }));
    expect(v.length).toBeGreaterThan(0);
    expect(v.every((w) => w.type === 'threshold')).toBe(true);
  });

  it('tri par durée croissante, par TSS décroissant, par nom', () => {
    const byDur = visibleWorkouts(ctx({ sort: 'dur' })).map((w) => workoutStats(w).total);
    expect(byDur).toEqual([...byDur].sort((a, b) => a - b));
    const byTss = visibleWorkouts(ctx({ sort: 'tss' })).map((w) => workoutStats(w).tss);
    expect(byTss).toEqual([...byTss].sort((a, b) => b - a));
    const byName = visibleWorkouts(ctx({ sort: 'name' })).map((w) => w.name.fr);
    expect(byName).toEqual([...byName].sort((a, b) => a.localeCompare(b, 'fr', { numeric: true })));
  });

  it('tri par famille : de la plus facile à la plus dure, toute la bibliothèque', () => {
    const v = visibleWorkouts(ctx());
    expect(v).toHaveLength(WORKOUT_LIBRARY.length);
    const ranks = v.map((w) => WORKOUT_TYPES.indexOf(w.type));
    expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
  });

  it('« mes séances » : favoris et séances importées, filtrés eux aussi', () => {
    const fav = WORKOUT_LIBRARY[0] as LibraryWorkout;
    const mine: LibraryWorkout = { ...fav, id: 'mine:essai', name: { fr: 'Ma séance perso', en: 'My own' } };
    const v = visibleWorkouts(ctx({ filter: 'mine', favs: new Set([fav.id]), mine: [mine] }));
    expect(v.map((w) => w.id)).toEqual([fav.id, 'mine:essai']);
    expect(visibleWorkouts(ctx({ filter: 'mine', favs: new Set([fav.id]), mine: [mine], query: 'perso' })).map((w) => w.id)).toEqual(['mine:essai']);
  });
});

describe('intensité des séances', () => {
  it('bornes 80–120 % et pas de 5 %', () => {
    expect(clampWorkoutIntensity(1)).toBe(1);
    expect(clampWorkoutIntensity(1.07)).toBeCloseTo(1.05, 10);
    expect(clampWorkoutIntensity(2)).toBe(1.2);
    expect(clampWorkoutIntensity(0.1)).toBe(0.8);
    expect(clampWorkoutIntensity(undefined)).toBe(1);
    expect(clampWorkoutIntensity(Number.NaN)).toBe(1);
  });

  it('TSS et IF suivent l’intensité (IF × k, TSS × k²), la durée non', () => {
    const w = WORKOUT_LIBRARY.find((x) => x.id === 'seuil-3x10') as LibraryWorkout;
    const a = workoutStats(w, 1);
    const b = workoutStats(w, 1.1);
    expect(b.total).toBe(a.total);
    expect(b.ifv).toBeCloseTo(a.ifv * 1.1, 6);
    expect(b.tss).toBeCloseTo(a.tss * 1.21, -1);
  });

  it('la fiche affiche l’intensité et les watts ajustés', () => {
    const html = workoutStudioHtml(ctx({ selected: 'seuil-3x10', intensity: 1.1 }));
    expect(html).toContain('110 %');
    expect(html).toContain('data-wkint="0"');
    // Seuil à 98 % de FTP × 1,1 = 107,8 % → 270 W pour une FTP de 250 W.
    expect(html).toContain('270 W');
    const base = workoutStudioHtml(ctx({ selected: 'seuil-3x10' }));
    expect(base).not.toContain('data-wkint="0"');
    expect(base).toContain('245 W');
  });

  it('la sortie applique l’intensité aux séances, pas aux tests FTP', () => {
    const lib = new WorkoutController('library', 250, undefined, 'seuil-3x10', 1.1);
    const t = lib.runner.stepStartS(1) + 5;
    expect(lib.runner.at(t).targetWatts).toBe(Math.round(0.98 * 250 * 1.1));
    const prof = lib.profile(250);
    expect(prof[1]?.[2]).toBeCloseTo(0.98 * 250 * 1.1, 6);
    const ramp = new WorkoutController('ramp', 250, undefined, undefined, 1.2);
    expect(ramp.runner.intensity).toBe(1);
  });

  it('message clair quand aucun résultat, avec un bouton pour tout afficher', () => {
    const html = workoutStudioHtml(ctx({ query: 'zzz-aucune-seance' }));
    expect(html).toContain('Aucune séance ne correspond');
    expect(html).toContain('data-wkreset');
    expect(html).toContain('0 séance');
  });
});
