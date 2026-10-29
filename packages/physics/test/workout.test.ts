import { describe, expect, it } from 'vitest';
import { parseErgOrMrc, parseWorkoutFile, parseXml, parseZwo, workoutDuration, WorkoutRunner, XmlParseError } from '../src/index.ts';

const ZWO = `<?xml version="1.0" encoding="UTF-8"?>
<!-- Séance d'exemple -->
<workout_file>
  <author>Robert &amp; Cie</author>
  <name>Sweet Spot 2×10</name>
  <description><![CDATA[Deux blocs <sweet spot> & récup]]></description>
  <sportType>bike</sportType>
  <tags><tag name="SS"/><tag name="Intervals"/></tags>
  <workout>
    <Warmup Duration="600" PowerLow="0.25" PowerHigh="0.75" Cadence="85">
      <textevent timeoffset="0" message="C'est parti !"/>
      <textevent timeoffset="540" message="Prépare-toi" duration="5"/>
    </Warmup>
    <SteadyState Duration="600" Power="0.9" Cadence="90"/>
    <IntervalsT Repeat="3" OnDuration="30" OffDuration="60" OnPower="1.2" OffPower="0.55" Cadence="100" CadenceResting="85">
      <textevent timeoffset="95" message="Deuxième !"/>
    </IntervalsT>
    <Ramp Duration="120" PowerLow="0.6" PowerHigh="0.8"/>
    <FreeRide Duration="300" FlatRoad="1"/>
    <MaxEffort Duration="20"/>
    <SteadyState Duration="60" PowerLow="0.5" PowerHigh="0.7"/>
    <Cooldown Duration="300" PowerLow="0.7" PowerHigh="0.3"/>
    <UnknownThing Duration="999"/>
  </workout>
</workout_file>`;

describe('XML', () => {
  it('analyse entités, CDATA, commentaires et attributs', () => {
    const root = parseXml(`<a x='1' y="&lt;2&gt;"><!-- c --><b>t&#233;&#x41;</b><c/></a>`);
    expect(root.name).toBe('a');
    expect(root.attrs).toEqual({ x: '1', y: '<2>' });
    expect(root.children.map((c) => c.name)).toEqual(['b', 'c']);
    expect(root.children[0]!.text).toBe('téA');
  });
  it('signale les erreurs de structure', () => {
    expect(() => parseXml('<a><b></a>')).toThrow(XmlParseError);
    expect(() => parseXml('<a>')).toThrow(XmlParseError);
    expect(() => parseXml('')).toThrow(XmlParseError);
  });
});

describe('.zwo', () => {
  const w = parseZwo(ZWO);
  it('métadonnées', () => {
    expect(w.name).toBe('Sweet Spot 2×10');
    expect(w.author).toBe('Robert & Cie');
    expect(w.description).toBe('Deux blocs <sweet spot> & récup');
    expect(w.tags).toEqual(['SS', 'Intervals']);
  });
  it('étapes', () => {
    expect(w.steps.map((s) => s.kind)).toEqual([
      'warmup',
      'steady',
      'intervalOn',
      'intervalOff',
      'intervalOn',
      'intervalOff',
      'intervalOn',
      'intervalOff',
      'ramp',
      'freeRide',
      'maxEffort',
      'steady',
      'cooldown',
    ]);
    expect(workoutDuration(w)).toBe(600 + 600 + 3 * 90 + 120 + 300 + 20 + 60 + 300);
    expect(w.steps[0]).toMatchObject({ powerStart: 0.25, powerEnd: 0.75, cadence: 85, powerUnit: 'ftp' });
    expect(w.steps[0]!.textEvents).toHaveLength(2);
    expect(w.steps[2]).toMatchObject({ powerStart: 1.2, cadence: 100, repeatIndex: 0, repeatCount: 3 });
    expect(w.steps[3]).toMatchObject({ powerStart: 0.55, cadence: 85 });
    // textevent à 95 s du bloc → 2e intervalle « on » (90–120 s), décalage 5 s.
    expect(w.steps[4]!.textEvents).toEqual([{ offsetS: 5, message: 'Deuxième !' }]);
    expect(w.steps[11]).toMatchObject({ powerStart: 0.6, powerEnd: 0.6 });
    expect(w.steps[12]).toMatchObject({ powerStart: 0.7, powerEnd: 0.3 });
  });
  it('lecteur : cible, progression, messages', () => {
    const r = new WorkoutRunner(w, { ftpWatts: 250 });
    expect(r.at(0)).toMatchObject({ stepIndex: 0, targetWatts: 63, messages: ["C'est parti !"] });
    expect(r.at(300).targetWatts).toBe(125); // milieu de la rampe 0,25 → 0,75
    expect(r.at(542).messages).toEqual(['Prépare-toi']);
    expect(r.at(548).messages).toEqual([]);
    const p = r.at(900);
    expect(p).toMatchObject({ stepIndex: 1, targetWatts: 225, mode: 'erg', cadence: 90 });
    expect(p.stepProgress).toBeCloseTo(0.5, 9);
    expect(r.at(1200 + 10)).toMatchObject({ stepIndex: 2, targetWatts: 300 });
    expect(r.at(1200 + 31).targetWatts).toBe(138);
    const free = r.at(r.stepStartS(9) + 1);
    expect(free).toMatchObject({ mode: 'free', targetWatts: null });
    expect(r.at(r.stepStartS(10))).toMatchObject({ mode: 'max', stepIndex: 10 });
    const end = r.at(r.totalDurationS + 5);
    expect(end.finished).toBe(true);
    expect(end.totalProgress).toBe(1);
    r.intensity = 1.1;
    expect(r.at(900).targetWatts).toBe(Math.round(225 * 1.1));
  });
  it('refuse un document qui n’est pas un .zwo', () => {
    expect(() => parseZwo('<html></html>')).toThrow();
  });
});

describe('.erg / .mrc', () => {
  const ERG = `[COURSE HEADER]
VERSION = 2
UNITS = ENGLISH
DESCRIPTION = Test ERG
FILE NAME = test.erg
FTP = 260
MINUTES WATTS
[END COURSE HEADER]
[COURSE DATA]
0.00\t100
5.00\t200
5.00\t250
10.00\t250
10.00\t120
12.50\t120
[END COURSE DATA]
[COURSE TEXT]
330\tAllez Robert !\t8
[END COURSE TEXT]
`;
  it('.erg en watts, rampes, paliers, textes', () => {
    const w = parseWorkoutFile('séance.ERG', ERG);
    expect(w.name).toBe('test');
    expect(w.description).toBe('Test ERG');
    expect(w.fileFtpWatts).toBe(260);
    expect(w.steps).toHaveLength(3);
    expect(w.steps[0]).toMatchObject({ kind: 'ramp', durationS: 300, powerStart: 100, powerEnd: 200, powerUnit: 'watts' });
    expect(w.steps[1]).toMatchObject({ kind: 'steady', durationS: 300, powerStart: 250 });
    expect(w.steps[1]!.textEvents).toEqual([{ offsetS: 30, message: 'Allez Robert !', durationS: 8 }]);
    const r = new WorkoutRunner(w, { ftpWatts: 999 });
    expect(r.at(150).targetWatts).toBe(150);
    expect(r.at(700).targetWatts).toBe(120);
  });
  it('.mrc en % FTP', () => {
    const w = parseErgOrMrc(`[COURSE HEADER]\r\nMINUTES PERCENT\r\n[END COURSE HEADER]\r\n[COURSE DATA]\r\n0 50\r\n10 50\r\n10 105\r\n15 105\r\n[END COURSE DATA]\r\n`);
    expect(w.steps).toHaveLength(2);
    expect(w.steps[1]).toMatchObject({ powerStart: 1.05, powerUnit: 'ftp', durationS: 300 });
    expect(new WorkoutRunner(w, { ftpWatts: 200 }).at(700).targetWatts).toBe(210);
  });
});

describe('séances intégrées', () => {
  it('chaque séance maison se construit, dure entre 40 et 75 min et vise des % de FTP plausibles', async () => {
    const { WORKOUT_LIBRARY, workoutDuration } = await import('../src/index.ts');
    expect(WORKOUT_LIBRARY.length).toBeGreaterThanOrEqual(5);
    for (const w of WORKOUT_LIBRARY.filter((x) => x.source === 'allezrobert')) {
      const wk = w.build();
      const min = workoutDuration(wk) / 60;
      expect(min, w.id).toBeGreaterThan(40);
      expect(min, w.id).toBeLessThan(75);
      for (const s of wk.steps) if (s.mode === 'erg') expect(Math.max(s.powerStart, s.powerEnd), w.id).toBeLessThanOrEqual(1.2);
    }
  });
});
