/**
 * Lecture des fichiers Zwift .zwo (XML) :
 *   <workout_file><name/><author/><description/><tags><tag name="…"/></tags>
 *     <workout>
 *       <Warmup Duration PowerLow PowerHigh [Cadence]/>        rampe PowerLow → PowerHigh
 *       <Cooldown Duration PowerLow PowerHigh/>                rampe PowerLow → PowerHigh (souvent décroissante)
 *       <Ramp Duration PowerLow PowerHigh/>
 *       <SteadyState Duration Power | PowerLow+PowerHigh [Cadence]/>
 *       <IntervalsT Repeat OnDuration OffDuration OnPower OffPower | PowerOnLow… [Cadence CadenceResting]/>
 *       <FreeRide Duration [FlatRoad Cadence]/>   <MaxEffort Duration/>
 *       … chaque élément peut contenir <textevent timeoffset="s" message="…" [duration]/>
 *     </workout></workout_file>
 * Puissances en fraction de FTP. Les éléments inconnus sont ignorés.
 */
import { parseXml, xmlAttr, xmlChild, xmlText, type XmlElement } from './xml.ts';
import type { Workout, WorkoutStep, WorkoutTextEvent } from './model.ts';

function num(el: XmlElement, ...names: string[]): number | undefined {
  for (const n of names) {
    const v = xmlAttr(el, n);
    if (v !== undefined && v.trim() !== '') {
      const x = Number(v);
      if (Number.isFinite(x)) return x;
    }
  }
  return undefined;
}

function textEvents(el: XmlElement): WorkoutTextEvent[] | undefined {
  const out: WorkoutTextEvent[] = [];
  for (const c of el.children) {
    if (c.name.toLowerCase() !== 'textevent') continue;
    const message = xmlAttr(c, 'message') ?? xmlText(c);
    if (!message) continue;
    const ev: WorkoutTextEvent = { offsetS: num(c, 'timeoffset', 'TimeOffset') ?? 0, message };
    const d = num(c, 'duration');
    if (d !== undefined) ev.durationS = d;
    out.push(ev);
  }
  return out.length ? out : undefined;
}

function withCadence(step: WorkoutStep, el: XmlElement): WorkoutStep {
  const c = num(el, 'Cadence');
  if (c !== undefined) step.cadence = c;
  const lo = num(el, 'CadenceLow');
  const hi = num(el, 'CadenceHigh');
  if (lo !== undefined) step.cadenceLow = lo;
  if (hi !== undefined) step.cadenceHigh = hi;
  const te = textEvents(el);
  if (te) step.textEvents = te;
  return step;
}

/** Analyse un fichier .zwo. */
export function parseZwo(xml: string): Workout {
  const root = parseXml(xml);
  if (root.name.toLowerCase() !== 'workout_file') throw new Error(`.zwo : racine <workout_file> attendue, trouvé <${root.name}>`);
  const name = (xmlChild(root, 'name') && xmlText(xmlChild(root, 'name')!)) || 'Séance';
  const workout: Workout = { name, steps: [] };
  const author = xmlChild(root, 'author');
  if (author) workout.author = xmlText(author);
  const desc = xmlChild(root, 'description');
  if (desc) workout.description = xmlText(desc);
  const tags = xmlChild(root, 'tags');
  if (tags) workout.tags = tags.children.map((t) => xmlAttr(t, 'name') ?? xmlText(t)).filter((t) => t.length > 0);
  const body = xmlChild(root, 'workout');
  if (!body) return workout;

  for (const el of body.children) {
    const kind = el.name.toLowerCase();
    const duration = num(el, 'Duration') ?? 0;
    switch (kind) {
      case 'warmup':
      case 'cooldown':
      case 'ramp': {
        const lo = num(el, 'PowerLow', 'Power') ?? 0.5;
        const hi = num(el, 'PowerHigh', 'Power') ?? lo;
        workout.steps.push(
          withCadence(
            { kind: kind === 'ramp' ? 'ramp' : kind, mode: 'erg', durationS: duration, powerStart: lo, powerEnd: hi, powerUnit: 'ftp' },
            el,
          ),
        );
        break;
      }
      case 'steadystate':
      case 'solidstate': {
        let p = num(el, 'Power');
        if (p === undefined) {
          const lo = num(el, 'PowerLow');
          const hi = num(el, 'PowerHigh');
          p = lo !== undefined && hi !== undefined ? (lo + hi) / 2 : (lo ?? hi ?? 0.5);
        }
        workout.steps.push(withCadence({ kind: 'steady', mode: 'erg', durationS: duration, powerStart: p, powerEnd: p, powerUnit: 'ftp' }, el));
        break;
      }
      case 'intervalst': {
        const repeat = Math.max(1, Math.round(num(el, 'Repeat') ?? 1));
        const onD = num(el, 'OnDuration') ?? 0;
        const offD = num(el, 'OffDuration') ?? 0;
        const onLo = num(el, 'OnPower', 'PowerOnLow') ?? 1;
        const onHi = num(el, 'OnPower', 'PowerOnHigh') ?? onLo;
        const offLo = num(el, 'OffPower', 'PowerOffLow') ?? 0.5;
        const offHi = num(el, 'OffPower', 'PowerOffHigh') ?? offLo;
        const cad = num(el, 'Cadence');
        const cadRest = num(el, 'CadenceResting');
        const te = textEvents(el);
        // Les textevents d'un IntervalsT sont relatifs au début du bloc : on les répartit.
        let blockT = 0;
        for (let r = 0; r < repeat; r++) {
          const on: WorkoutStep = { kind: 'intervalOn', mode: 'erg', durationS: onD, powerStart: onLo, powerEnd: onHi, powerUnit: 'ftp', repeatIndex: r, repeatCount: repeat };
          const off: WorkoutStep = { kind: 'intervalOff', mode: 'erg', durationS: offD, powerStart: offLo, powerEnd: offHi, powerUnit: 'ftp', repeatIndex: r, repeatCount: repeat };
          if (cad !== undefined) on.cadence = cad;
          if (cadRest !== undefined) off.cadence = cadRest;
          for (const [st, t0] of [[on, blockT], [off, blockT + onD]] as const) {
            const evs = te?.filter((e) => e.offsetS >= t0 && e.offsetS < t0 + st.durationS).map((e) => ({ ...e, offsetS: e.offsetS - t0 }));
            if (evs && evs.length) st.textEvents = evs;
          }
          blockT += onD + offD;
          workout.steps.push(on);
          if (offD > 0) workout.steps.push(off);
        }
        break;
      }
      case 'freeride': {
        workout.steps.push(withCadence({ kind: 'freeRide', mode: 'free', durationS: duration, powerStart: 0, powerEnd: 0, powerUnit: 'ftp' }, el));
        break;
      }
      case 'maxeffort': {
        workout.steps.push(withCadence({ kind: 'maxEffort', mode: 'max', durationS: duration, powerStart: 0, powerEnd: 0, powerUnit: 'ftp' }, el));
        break;
      }
      default:
        break;
    }
  }
  return workout;
}
