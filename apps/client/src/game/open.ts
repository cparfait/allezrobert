import { OpenPath, RoadNet, RouteTrack, type RoadGraphData, type RouteData, type TurnChoice } from '@allezrobert/shared';

/** Distance planifiée devant le coureur (m) : trafic, caméras et mini-carte voient la suite. */
const LOOKAHEAD_M = 800;
/** On replanifie quand il reste moins que cela devant. */
const REPLAN_M = 500;
/** Le choix d'un carrefour se fige à cette distance (le chemin est déjà lissé jusque-là). */
const COMMIT_M = 25;
/** Marge de lissage recalculée avant un changement (≥ 3σ du lissage du chemin). */
const SMOOTH_MARGIN_M = 10;

export interface Junction {
  /** Distance du carrefour sur le chemin (m). */
  d: number;
  /** Indice de l'arête qui arrive au carrefour dans `path.steps`. */
  stepIndex: number;
  choices: TurnChoice[];
  selected: number;
  /** Trop près pour changer d'avis. */
  locked: boolean;
}

/**
 * Mode ouvert : le chemin se construit au fil des carrefours. Par défaut on continue « tout
 * droit » (même route si possible) ; au prochain carrefour à plusieurs sorties, ← / → change de
 * direction tant qu'on en est à plus de 25 m. Demi-tour possible à tout moment.
 * Le `RouteTrack` est le même objet pendant toute la sortie : il s'allonge.
 */
export class OpenNavigator {
  readonly net: RoadNet;
  readonly path: OpenPath;
  readonly track: RouteTrack;
  readonly route: RouteData;
  next: Junction | null = null;
  /** Prévenu quand le chemin devant change (mini-carte, trafic). */
  onChange?: () => void;

  constructor(graph: RoadGraphData, start: { x: number; z: number }, name: string) {
    this.net = new RoadNet(graph);
    this.path = new OpenPath(this.net);
    // Départ : la voie sous le point de départ (à moins de 15 m), sinon la route revêtue la plus
    // proche, dans le sens autorisé.
    const paved = (e: { surface: string; kind: string }) => /^(asphalt|paved|concrete|chipseal)/.test(e.surface) && e.kind !== 'service' && e.kind !== 'track';
    const under = this.net.nearest(start.x, start.z);
    const near = under && under.dist < 15 ? under : (this.net.nearest(start.x, start.z, paved) ?? under);
    if (!near) throw new Error('Graphe routier vide');
    const forward = this.net.allowed({ edge: near.edge, forward: true });
    const len = this.net.edge(near.edge).len;
    this.path.add({ edge: near.edge, forward }, forward ? near.along : len - near.along);
    this.extendPlan();
    this.route = {
      id: 'open',
      name,
      loop: false,
      lengthM: 0,
      elevationGainM: 0,
      points: this.path.pointsFrom(0),
      segments: [],
      roadWidthM: this.net.edge(near.edge).width,
      attribution: graph.attribution,
    };
    this.track = new RouteTrack(this.route);
    this.findNext(0);
  }

  /** À chaque image : prolonge le plan, fige le carrefour proche, passe au suivant. */
  update(distM: number): void {
    if (this.path.length - distM < REPLAN_M) {
      const from = Math.max(distM + 1, this.path.length - SMOOTH_MARGIN_M);
      this.extendPlan();
      this.track.extend(this.path.pointsFrom(from), from);
      this.onChange?.();
      if (!this.next) this.findNext(distM);
    }
    if (this.next && distM > this.next.d) this.findNext(distM);
    if (this.next && !this.next.locked && this.next.d - distM < COMMIT_M) this.next.locked = true;
  }

  /** Change la sortie choisie au prochain carrefour (−1 : plus à gauche, +1 : plus à droite). */
  select(delta: number, distM: number): boolean {
    const j = this.next;
    if (!j || j.locked || j.d - distM < COMMIT_M) return false;
    const i = Math.min(Math.max(j.selected + delta, 0), j.choices.length - 1);
    if (i === j.selected) return false;
    j.selected = i;
    this.replanFrom(j.stepIndex, j.choices[i] as TurnChoice, Math.max(distM + 1, j.d - SMOOTH_MARGIN_M));
    return true;
  }

  /** Demi-tour sur place : le chemin repart en sens inverse depuis `distM`. */
  uturn(distM: number): boolean {
    const cut = this.path.cutAt(distM);
    if (!cut) return false;
    const len = this.net.edge(cut.step.edge).len;
    const back = { edge: cut.step.edge, forward: !cut.step.forward };
    if (!this.net.allowed(back)) {
      // Sens interdit : on refait le plan normal plutôt que de remonter un sens unique.
      this.extendPlan();
      this.track.extend(this.path.pointsFrom(distM), distM);
      return false;
    }
    this.path.add(back, Math.max(0, len - cut.along));
    this.extendPlan();
    this.track.extend(this.path.pointsFrom(distM), distM);
    this.findNext(distM);
    this.onChange?.();
    return true;
  }

  /** Revêtement OSM sous les roues. */
  surfaceAt(distM: number): string | undefined {
    const s = this.path.stepAt(distM);
    return s ? this.net.edge(s.edge).surface : undefined;
  }

  /** Largeur de la chaussée sous les roues (m). */
  widthAt(distM: number): number {
    const s = this.path.stepAt(distM);
    return s ? this.net.edge(s.edge).width : this.route.roadWidthM;
  }

  /** Nom de la route sous les roues. */
  roadName(distM: number): string {
    const s = this.path.stepAt(distM);
    if (!s) return '';
    const e = this.net.edge(s.edge);
    return e.name || e.ref || '';
  }

  private replanFrom(stepIndex: number, choice: TurnChoice, from: number): void {
    this.path.truncateSteps(stepIndex + 1);
    this.path.add(choice.step);
    this.extendPlan();
    this.track.extend(this.path.pointsFrom(from), from);
    this.onChange?.();
  }

  /** Suit la route la plus naturelle jusqu'à LOOKAHEAD_M devant le dernier point connu. */
  private extendPlan(): void {
    const target = this.path.length + LOOKAHEAD_M;
    let guard = 0;
    while (this.path.length < target && guard++ < 400) {
      const last = this.path.last;
      if (!last) break;
      this.path.add(this.net.straightest(last).step);
    }
  }

  /** Prochain carrefour à plusieurs sorties après `distM` (sortie déjà planifiée sélectionnée). */
  private findNext(distM: number): void {
    this.next = null;
    const steps = this.path.steps;
    for (let k = 0; k + 1 < steps.length; k++) {
      const s = steps[k] as (typeof steps)[number];
      if (s.endD <= distM + 1) continue;
      const choices = this.net.choices(s).filter((c) => c.dir !== 'back');
      if (choices.length < 2) continue;
      const planned = steps[k + 1] as (typeof steps)[number];
      const sel = choices.findIndex((c) => c.step.edge === planned.edge && c.step.forward === planned.forward);
      this.next = { d: s.endD, stepIndex: k, choices, selected: Math.max(0, sel), locked: s.endD - distM < COMMIT_M };
      return;
    }
  }
}
