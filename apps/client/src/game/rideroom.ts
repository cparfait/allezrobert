import '../ui/blocks.css';
import './rideroom.css';
import { strings } from '../i18n/index.ts';
import type { RideEventMsg, RideResult, RouteTrack } from '@allezrobert/shared';
import { flagSvg } from '../ui/flagSvg.ts';
import type { RideNetClient } from '../net/index.ts';
import type { VoiceConfig } from './voice.ts';
import { countdownLabel, formatGap, formatRaceTime, liveStandings, paceBand, selfRaceInfo, statusLabel, type LiveRider, type StandingRow } from './race.ts';

const esc = (s: string): string => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
/** Remplace le contenu seulement s'il a changé (les clics en cours ne sont pas perdus). */
function setHtml(el: HTMLElement, html: string): void {
  const h = html.trim();
  if ((el as HTMLElement & { _html?: string })._html === h) return;
  (el as HTMLElement & { _html?: string })._html = h;
  el.innerHTML = h;
  el.style.display = h ? '' : 'none';
}
const S = strings(
  {
    rankFirst: '{n}er',
    rankOther: '{n}e',
    placeFirst: '{n}er',
    placeOther: '{n}e',
    finishRanked: 'Arrivée ! {rank} en {time}',
    finishUnranked: 'Arrivée (hors classement)',
    wins: '🏁 {name} remporte la course',
    you: 'Toi',
    prime: 'Prime',
    abandons: '{name} abandonne',
    dqSelf: 'Mis hors course : puissance invraisemblable',
    dqOther: '{name} mis hors course (puissance)',
    powerCheck: 'Contrôle de puissance : {reason}. Vérifie ton capteur.',
    deadline: 'Heure limite : {time} pour franchir la ligne',
    regroupOn: 'Regroupement ! (écart {m} m) — la tête temporise, la queue est aidée',
    regroupOff: 'Groupe reformé',
    split: 'Le groupe s’est scindé ({m} m)',
    splitHint: ' — G pour regrouper',
    freePace: 'Allure libre',
    announcedPaceToast: 'Allure annoncée : {p} W/kg',
    lead: 'tête',
    primes: 'Primes',
    race: 'Course',
    lap: 'tour',
    finishedIn: 'Arrivé en',
    toGo: 'Reste',
    ahead: 'Devant',
    behind: 'Derrière',
    timeLimit: 'Heure limite',
    lobbyTitle: 'Salle d’attente',
    lobbySub: 'Course · {route}',
    laps: '{n} tours',
    primesSub: 'primes KOM et sprint',
    distance: 'Distance',
    inviteCode: 'Code d’invitation',
    inviteDetail: 'À donner aux amis pour rejoindre la course.',
    riders: 'Coureurs ({n})',
    youSuffix: ' (toi)',
    host: 'Organisateur',
    ai: 'IA',
    guest: 'Invité · non classé',
    ready: 'Prêt',
    reconnecting: 'Reconnexion…',
    hostHint: 'Les IA complètent le peloton ; chaque ami qui arrive prend la place d’une IA.',
    waitingHost: 'En attente du départ donné par {name}…',
    start: 'Donner le départ (10 s)',
    discordChannel: 'Salon Discord',
    leave: 'Quitter',
    finishTitle: 'Arrivée !',
    finishTitleRank: 'Arrivée ! {rank} · {time}',
    waitingOne: 'en attente de 1 coureur…',
    waitingMany: 'en attente de {n} coureurs…',
    provisional: 'classement provisoire',
    hide: 'Masquer',
    endRide: 'Terminer la sortie',
    results: 'Résultats',
    keepRiding: 'Continuer à rouler',
    rider: 'Coureur',
    time: 'Temps',
    gap: 'Écart',
    raceResults: 'Résultats de la course',
    standingsLeft: 'Classement au moment de ton départ',
    groupRide: 'Sortie de groupe',
    sticky: 'groupe soudé',
    regrouping: 'Regroupement en cours',
    targetAvg: 'Moyenne visée (IA)',
    announcedPace: 'Allure annoncée',
    free: 'libre',
    yourPace: 'Ton allure (3 s)',
    leader: 'Meneur',
    targetDown: 'Moyenne visée −1 km/h',
    targetUp: 'Moyenne visée +1 km/h',
    noTarget: 'Moyenne libre',
    paceDown: 'Allure annoncée −0,1 W/kg ([)',
    paceUp: 'Allure annoncée +0,1 W/kg (])',
    freeBtn: 'Libre',
    stopRegroup: 'Arrêter (G)',
    regroup: 'Regrouper (G)',
  },
  {
    rankFirst: '#{n}',
    rankOther: '#{n}',
    placeFirst: '{n}',
    placeOther: '{n}',
    finishRanked: 'Finished! {rank} in {time}',
    finishUnranked: 'Finished (unranked)',
    wins: '🏁 {name} wins the race',
    you: 'You',
    prime: 'Prime',
    abandons: '{name} abandons',
    dqSelf: 'Disqualified: implausible power',
    dqOther: '{name} disqualified (power)',
    powerCheck: 'Power check: capped. Check your power meter.',
    deadline: 'Time limit: {time} to finish',
    regroupOn: 'Regroup! (gap {m} m)',
    regroupOff: 'Group back together',
    split: 'The group has split ({m} m)',
    splitHint: ' — G to regroup',
    freePace: 'Free pace',
    announcedPaceToast: 'Announced pace: {p} W/kg',
    lead: 'lead',
    primes: 'Primes',
    race: 'Race',
    lap: 'lap',
    finishedIn: 'Finished in',
    toGo: 'To go',
    ahead: 'Ahead',
    behind: 'Behind',
    timeLimit: 'Time limit',
    lobbyTitle: 'Waiting room',
    lobbySub: 'Race · {route}',
    laps: '{n} laps',
    primesSub: 'KOM and sprint primes',
    distance: 'Distance',
    inviteCode: 'Invite code',
    inviteDetail: 'Give it to friends so they can join the race.',
    riders: 'Riders ({n})',
    youSuffix: ' (you)',
    host: 'Host',
    ai: 'AI',
    guest: 'Guest · unranked',
    ready: 'Ready',
    reconnecting: 'Reconnecting…',
    hostHint: 'AI riders fill the field; each friend who joins takes an AI’s place.',
    waitingHost: 'Waiting for {name} to start…',
    start: 'Start the race (10 s)',
    discordChannel: 'Discord channel',
    leave: 'Leave',
    finishTitle: 'Finish!',
    finishTitleRank: 'Finish! {rank} · {time}',
    waitingOne: 'waiting for 1 rider…',
    waitingMany: 'waiting for {n} riders…',
    provisional: 'provisional standings',
    hide: 'Hide',
    endRide: 'End ride',
    results: 'Results',
    keepRiding: 'Keep riding',
    rider: 'Rider',
    time: 'Time',
    gap: 'Gap',
    raceResults: 'Race results',
    standingsLeft: 'Standings when you left',
    groupRide: 'Group ride',
    sticky: 'sticky',
    regrouping: 'Regrouping',
    targetAvg: 'Target average (AI)',
    announcedPace: 'Announced pace',
    free: 'free',
    yourPace: 'Your pace (3 s)',
    leader: 'Leader',
    targetDown: 'Target −1 km/h',
    targetUp: 'Target +1 km/h',
    noTarget: 'No target',
    paceDown: 'Announced pace −0.1 W/kg ([)',
    paceUp: 'Announced pace +0.1 W/kg (])',
    freeBtn: 'Free',
    stopRegroup: 'Stop (G)',
    regroup: 'Regroup (G)',
  },
);
/** Remplit les `{clé}` d'un gabarit du dictionnaire. */
const fill = (tpl: string, v: Record<string, string | number>): string => tpl.replace(/\{(\w+)\}/g, (m, k: string) => (k in v ? String(v[k]) : m));
const rankText = (n: number): string => fill(n === 1 ? S('rankFirst') : S('rankOther'), { n });
const placeText = (n: number): string => fill(n === 1 ? S('placeFirst') : S('placeOther'), { n });

const km = (m: number): string => (m / 1000).toFixed(m < 10_000 ? 2 : 1).replace('.', ',');

export interface RideRoomUiOptions {
  /** Racine du HUD (le panneau va dans la colonne de gauche, les fenêtres par-dessus). */
  hudRoot: HTMLElement;
  net: RideNetClient;
  track: RouteTrack;
  mode: 'group' | 'race';
  lang: 'fr' | 'en';
  toast: (text: string) => void;
  voice: Promise<VoiceConfig>;
}

/**
 * Interface des sorties à plusieurs (jeu) :
 * - **course** : salle d'attente (code, coureurs, départ donné par l'hôte), compte à rebours
 *   synchronisé sur l'heure serveur, panneau en direct (place, distance restante, écarts, heure
 *   limite, primes, classement), annonces (primes, abandons, contrôle de puissance), résultats ;
 * - **sortie de groupe** : allure annoncée (et la sienne, en couleur), meneur, regroupement
 *   (G, hôte ou meneur), réglage de l'allure ([ / ], hôte), alerte de groupe scindé ;
 * - salon Discord de repli quand il est configuré.
 */
export class RideRoomUi {
  private readonly o: RideRoomUiOptions;
  private readonly net: RideNetClient;
  private readonly fr: boolean;
  private readonly panel: HTMLElement;
  private readonly body: HTMLElement;
  private readonly btns: HTMLElement;
  private readonly overlay: HTMLElement;
  private readonly known = new Map<string, RideResult>();
  private readonly unranked = new Set<string>();
  private readonly offs: Array<() => void> = [];
  private discord: string | null = null;
  private wasHolding = false;
  private lobbyKey = '';
  private resultsShown = false;
  private arrivalClosed = false;
  private finalResults: RideResult[] | null = null;
  private lastStandings: StandingRow[] = [];
  /** Le coureur doit rester immobile (salle d'attente, compte à rebours). */
  onHoldChange?: (holding: boolean) => void;
  /** Quitter la sortie depuis la salle d'attente ou les résultats. */
  onLeave?: () => void;
  /** Résultats finaux reçus (podium). */
  onResults?: (results: RideResult[]) => void;
  /** Le coureur franchit la ligne en tête (bras levés). */
  onWin?: () => void;
  /** Mon passage de la ligne d'arrivée (classé ou non). */
  onFinish?: () => void;

  constructor(o: RideRoomUiOptions) {
    this.o = o;
    this.net = o.net;
    this.fr = o.lang === 'fr';
    this.panel = document.createElement('div');
    this.panel.className = 'panel mp-panel';
    this.panel.innerHTML = '<div class="mp-body"></div><div class="mp-btns"></div>';
    this.body = this.panel.firstElementChild as HTMLElement;
    this.btns = this.panel.lastElementChild as HTMLElement;
    // Boutons : délégation sur le panneau (le contenu est rafraîchi à 10 Hz).
    this.panel.addEventListener('click', (e) => {
      const act = (e.target as HTMLElement).closest<HTMLElement>('[data-act]')?.dataset.act;
      if (act === 'slower') this.adjustPace(-0.1);
      else if (act === 'faster') this.adjustPace(0.1);
      else if (act === 'tslower') this.adjustTarget(-1);
      else if (act === 'tfaster') this.adjustTarget(1);
      else if (act === 'tfree') this.net.setHostOptions({ targetKmh: null });
      else if (act === 'free') this.net.setHostOptions({ paceWkg: null });
      else if (act === 'regroup') this.net.regroup();
    });
    const left = o.hudRoot.querySelector('.hud-col-left');
    const anchor = left?.querySelector('.hud-bl');
    if (left && anchor) left.insertBefore(this.panel, anchor);
    else o.hudRoot.appendChild(this.panel);
    this.overlay = document.createElement('div');
    this.overlay.className = 'mp-overlay';
    o.hudRoot.parentElement?.appendChild(this.overlay);
    for (const r of this.net.welcome?.results ?? []) this.known.set(r.riderId, r);
    void o.voice.then((v) => {
      this.discord = v.discordInvite;
      this.lobbyKey = '';
    });
    this.offs.push(this.net.on('event', (ev) => this.onEvent(ev)));
    this.offs.push(this.net.on('welcome', (w) => w.results?.forEach((r) => this.known.set(r.riderId, r))));
    const onKey = (e: KeyboardEvent) => this.onKey(e);
    window.addEventListener('keydown', onKey);
    this.offs.push(() => window.removeEventListener('keydown', onKey));
  }

  private get w() {
    return this.net.welcome;
  }

  get phase(): string {
    return this.w?.phase ?? 'running';
  }

  /** Course pas encore lancée : on ne roule pas (le serveur tient tout le monde sur la grille). */
  get holding(): boolean {
    if (this.o.mode !== 'race' || !this.w) return false;
    if (this.phase === 'lobby' || this.phase === 'countdown') return true;
    return this.w.startsAt !== undefined && this.net.serverNow() < this.w.startsAt;
  }

  /** Course commencée et non terminée (« Terminer » = abandonner). */
  get racing(): boolean {
    return this.o.mode === 'race' && this.phase === 'running' && this.known.get(this.net.selfId)?.status !== 'finished';
  }

  private get leaderId(): string {
    return this.w?.hostOptions?.leaderId || this.net.hostId;
  }

  private name(id: string): string {
    return this.net.roster.get(id)?.name ?? this.known.get(id)?.name ?? '?';
  }

  /** Drapeau du coureur (nationalité de sa fiche), suivi d'une espace ; vide si inconnue. */
  private flag(id: string): string {
    const f = flagSvg(this.net.roster.get(id)?.avatar.nationality, 11);
    return f ? `<span class="flag">${f}</span> ` : '';
  }

  private targetM(): number {
    const route = this.w?.route;
    const laps = this.w?.options.laps ?? 1;
    return route?.loop ? laps * route.lengthM : this.o.track.length;
  }

  /** Rang d'arrivée du joueur (0 : non classé ou pas encore arrivé) — récompenses de l'atelier. */
  selfRank(): number {
    const me = this.known.get(this.net.selfId);
    return me?.status === 'finished' ? me.rank : 0;
  }

  /* ───────────── Événements ───────────── */

  private upsert(id: string, patch: Partial<RideResult>): RideResult {
    const cur = this.known.get(id) ?? { riderId: id, name: this.name(id), rank: 0, timeMs: 0, isAI: !!this.net.roster.get(id)?.isAI, isGuest: !!this.net.roster.get(id)?.isGuest, status: 'racing' as const };
    const next = { ...cur, ...patch };
    this.known.set(id, next);
    return next;
  }

  private onEvent(ev: RideEventMsg): void {
    const fr = this.fr;
    const me = this.net.selfId;
    switch (ev.kind) {
      case 'finish': {
        this.upsert(ev.riderId, { rank: ev.rank, timeMs: ev.timeMs, status: ev.rank > 0 ? 'finished' : 'unranked' });
        if (ev.riderId === me) this.onFinish?.();
        if (ev.riderId === me && ev.rank === 1) this.onWin?.();
        this.refreshArrival();
        if (ev.riderId === me) this.o.toast(ev.rank > 0 ? fill(S('finishRanked'), { rank: rankText(ev.rank), time: formatRaceTime(ev.timeMs) }) : S('finishUnranked'));
        else if (ev.rank === 1) this.o.toast(fill(S('wins'), { name: this.name(ev.riderId) }));
        break;
      }
      case 'results':
        this.known.clear();
        for (const r of ev.results) this.known.set(r.riderId, r);
        this.finalResults = ev.results;
        this.onResults?.(ev.results);
        this.showResults(ev.results);
        break;
      case 'prime': {
        queueMicrotask(() => this.refreshArrival());
        const r = this.known.get(ev.riderId);
        this.upsert(ev.riderId, ev.segmentKind === 'kom' ? { komPts: (r?.komPts ?? 0) + ev.points } : { sprintPts: (r?.sprintPts ?? 0) + ev.points });
        const seg = this.o.track.route.segments.find((s) => s.id === ev.segmentId)?.name ?? '';
        const icon = ev.segmentKind === 'kom' ? '⛰' : '⚡';
        const who = ev.riderId === me ? S('you') : this.name(ev.riderId);
        this.o.toast(`${icon} ${S('prime')} ${seg} : ${who} ${placeText(ev.place)} (+${ev.points} pts)`);
        break;
      }
      case 'abandon':
        this.upsert(ev.riderId, { name: ev.name, status: 'dnf', rank: 0 });
        this.o.toast(fill(S('abandons'), { name: ev.name }));
        break;
      case 'flag':
        if (ev.action === 'dq') {
          this.upsert(ev.riderId, { status: 'dq', rank: 0 });
          this.o.toast(ev.riderId === me ? S('dqSelf') : fill(S('dqOther'), { name: this.name(ev.riderId) }));
        } else if (ev.riderId === me) this.o.toast(fill(S('powerCheck'), { reason: ev.reason }));
        break;
      case 'deadline':
        this.o.toast(fill(S('deadline'), { time: formatRaceTime(ev.at - this.net.serverNow()) }));
        break;
      case 'join':
        if (this.o.mode === 'race' && this.phase === 'running') this.unranked.add(ev.riderId);
        break;
      case 'regroup':
        this.o.toast(ev.active ? fill(S('regroupOn'), { m: ev.spreadM }) : S('regroupOff'));
        break;
      case 'split': {
        const canAsk = this.net.selfId === this.net.hostId || this.net.selfId === this.leaderId;
        this.o.toast(fill(S('split'), { m: ev.gapM }) + (canAsk ? S('splitHint') : ''));
        break;
      }
      case 'options': {
        const pace = ev.options.paceWkg;
        this.o.toast(pace === null ? S('freePace') : fill(S('announcedPaceToast'), { p: pace.toFixed(1).replace('.', fr ? ',' : '.') }));
        break;
      }
      default:
        break;
    }
  }

  private onKey(e: KeyboardEvent): void {
    if ((e.target as HTMLElement | null)?.tagName === 'INPUT' || this.o.mode !== 'group') return;
    const me = this.net.selfId;
    if ((e.key === 'g' || e.key === 'G') && (me === this.net.hostId || me === this.leaderId)) this.net.regroup();
    if ((e.key === '[' || e.key === ']') && this.net.isHost) this.adjustPace(e.key === ']' ? 0.1 : -0.1);
  }

  /** Hôte : vitesse moyenne visée +/− 1 km/h (part de celle annoncée, ou de 28 km/h si elle est libre). */
  private adjustTarget(delta: number): void {
    const cur = this.w?.hostOptions?.targetKmh ?? 28;
    this.net.setHostOptions({ targetKmh: Math.min(50, Math.max(15, cur + delta)) });
  }

  private adjustPace(delta: number): void {
    const cur = this.w?.hostOptions?.paceWkg ?? 2.5;
    this.net.setHostOptions({ paceWkg: Math.round(Math.min(6, Math.max(1, cur + delta)) * 10) / 10 });
  }

  /* ───────────── Affichage (10 Hz) ───────────── */

  private liveRiders(self: { distM: number; speedMs: number }): LiveRider[] {
    const out: LiveRider[] = [];
    for (const r of this.net.getAllInterpolated()) {
      if (r.id === this.net.selfId) continue;
      out.push({ id: r.id, name: r.name, distM: r.unwrappedM, speedMs: r.speedMs, isAI: r.isAI, isGuest: r.isGuest });
    }
    const me = this.net.roster.get(this.net.selfId);
    if (me) out.push({ id: me.id, name: me.name, distM: self.distM, speedMs: self.speedMs, isAI: false, isGuest: me.isGuest });
    return out;
  }

  update(self: { distM: number; speedMs: number; wkg: number }): void {
    const hold = this.holding;
    if (hold !== this.wasHolding) {
      this.wasHolding = hold;
      this.onHoldChange?.(hold);
    }
    if (this.o.mode === 'race') this.updateRace(self);
    else this.updateGroup(self);
  }

  private updateRace(self: { distM: number; speedMs: number }): void {
    const w = this.w;
    if (!w) return;
    // Salle d'attente.
    if (this.phase === 'lobby') {
      this.panel.style.display = 'none';
      this.renderLobby();
      return;
    }
    // Compte à rebours.
    const left = w.startsAt !== undefined ? w.startsAt - this.net.serverNow() : -1e9;
    const label = countdownLabel(left, this.o.lang);
    if (label !== null && !this.resultsShown) {
      this.lobbyKey = '';
      this.overlay.innerHTML = `<div class="mp-countdown ${left <= 0 ? 'go' : ''}">${esc(label)}</div>`;
    } else if (!this.resultsShown && this.overlay.firstElementChild?.classList.contains('mp-countdown')) this.overlay.innerHTML = '';
    else if (this.overlay.querySelector('.mp-lobby')) this.overlay.innerHTML = '';

    const riders = this.liveRiders(self);
    const rows = liveStandings(riders, this.known, this.unranked);
    this.lastStandings = rows;
    const laps = w.route.loop ? (w.options.laps ?? 1) : 1;
    const info = selfRaceInfo(rows, riders, this.net.selfId, this.targetM(), w.route.lengthM, laps);
    const mine = this.known.get(this.net.selfId);
    this.panel.style.display = '';
    const top = rows.filter((r) => r.pos > 0).slice(0, 5);
    const meRow = rows.find((r) => r.id === this.net.selfId);
    if (meRow && meRow.pos > 5) top.push(meRow);
    const gapCell = (r: StandingRow): string =>
      r.status === 'finished' ? (r.gapMs ? formatGap(r.gapMs) : formatRaceTime(r.timeMs ?? 0)) : r.behindM ? `+ ${Math.round(r.behindM)} m` : r.pos === 1 ? S('lead') : '';
    const deadline = w.deadline !== undefined && this.phase === 'running' ? w.deadline - this.net.serverNow() : undefined;
    const pts = (mine?.komPts ?? 0) + (mine?.sprintPts ?? 0) > 0 ? `<div class="mp-line"><span>${S('primes')}</span><b>⛰ ${mine?.komPts ?? 0} · ⚡ ${mine?.sprintPts ?? 0} pts</b></div>` : '';
    const status = meRow && meRow.status !== 'racing' && meRow.status !== 'finished' ? `<div class="mp-line"><b>${esc(statusLabel(meRow.status, this.o.lang))}</b></div>` : '';
    setHtml(this.btns, '');
    setHtml(this.body, `<h4><span>${S('race')}</span><span>${S('lap')} ${info?.lap ?? 1}/${laps}</span></h4>
      <div class="mp-big num">${info && info.pos > 0 ? `${info.pos}<small> / ${info.total}</small>` : '—'}</div>
      ${status}
      ${mine?.status === 'finished' ? `<div class="mp-line"><span>${S('finishedIn')}</span><b class="num">${formatRaceTime(mine.timeMs)}</b></div>` : `<div class="mp-line"><span>${S('toGo')}</span><b class="num">${km(info?.remainingM ?? 0)} km</b></div>`}
      ${info?.aheadM !== undefined ? `<div class="mp-line"><span>${S('ahead')}</span><b class="num">${Math.round(info.aheadM)} m</b></div>` : ''}
      ${info?.behindM !== undefined ? `<div class="mp-line"><span>${S('behind')}</span><b class="num">${Math.round(info.behindM)} m</b></div>` : ''}
      ${deadline !== undefined && deadline > 0 ? `<div class="mp-line"><span>${S('timeLimit')}</span><b class="num">${formatRaceTime(deadline)}</b></div>` : ''}
      ${pts}
      <div class="mp-standings">${top
        .map((r) => {
          const cls = r.id === this.net.selfId ? 'me' : '';
          return `<span class="num ${cls}">${r.pos}</span><span class="mp-name ${cls}" title="${esc(r.name)}">${this.flag(r.id)}${esc(r.name)}</span><span class="num muted">${gapCell(r)}</span>`;
        })
        .join('')}</div>`);
  }

  private renderLobby(): void {
    const w = this.w!;
    const riders = [...this.net.roster.values()];
    const host = this.net.roster.get(this.net.hostId)?.name ?? '';
    const key = `${riders.map((r) => `${r.id}${r.connected ? 1 : 0}`).join(',')}|${this.net.hostId}|${this.discord}`;
    if (key === this.lobbyKey && this.overlay.querySelector('.mp-lobby')) return;
    this.lobbyKey = key;
    const laps = w.route.loop ? (w.options.laps ?? 1) : 1;
    const dist = km(this.targetM());
    const tag = (r: (typeof riders)[number]): [string, string] =>
      r.isHost ? ['is-info', S('host')] : r.isAI ? ['', S('ai')] : r.isGuest ? ['is-warn', S('guest')] : r.connected ? ['is-ok', S('ready')] : ['is-warn', S('reconnecting')];
    this.overlay.innerHTML = `<div class="panel mp-modal mp-lobby" role="dialog" aria-labelledby="mp-lobby-title">
      <header class="mp-head"><h2 class="ab-title" id="mp-lobby-title">${S('lobbyTitle')}</h2><p class="ab-sub">${fill(S('lobbySub'), { route: esc(w.route.name) })} · ${S('primesSub')}</p></header>
      <div class="ab-grid ab-grid-2 mp-tiles">
        <div class="ab-tile is-on"><span class="ab-name">${S('inviteCode')}</span><span class="ab-detail">${S('inviteDetail')}</span><span class="ab-val"><b class="mp-code">${esc(w.inviteCode)}</b></span></div>
        <div class="ab-tile"><span class="ab-name">${S('distance')}</span><span class="ab-detail">${esc(w.route.name)}</span><span class="ab-val"><b>${dist}</b><small>km${laps > 1 ? ` · ${fill(S('laps'), { n: laps })}` : ''}</small></span></div>
      </div>
      <section><h3 class="ab-section">${fill(S('riders'), { n: riders.length })}</h3>
      <div class="mp-roster">${riders
        .map((r) => {
          const [cls, label] = tag(r);
          return `<span>${this.flag(r.id)}${esc(r.name)}${r.id === this.net.selfId ? S('youSuffix') : ''}</span><span class="ab-state ${cls}"><i></i>${label}</span>`;
        })
        .join('')}</div></section>
      <p class="mp-note">${this.net.isHost ? S('hostHint') : fill(S('waitingHost'), { name: esc(host) })}</p>
      <div class="ab-foot">
        <button type="button" class="ab-btn" data-act="leave">${S('leave')}</button>
        <div class="ab-btns">
          ${this.discord ? `<a class="ab-btn mp-discord" href="${esc(this.discord)}" target="_blank" rel="noopener noreferrer">${S('discordChannel')}</a>` : ''}
          ${this.net.isHost ? `<button type="button" class="ab-btn ab-go" data-act="start">${S('start')}</button>` : ''}
        </div>
      </div></div>`;
    this.overlay.querySelector('[data-act="start"]')?.addEventListener('click', () => this.net.startCountdown(10));
    this.overlay.querySelector('[data-act="leave"]')?.addEventListener('click', () => this.onLeave?.());
  }

  /** Le coureur a franchi la ligne : il ne pédale plus (roue libre) et attend les autres. */
  get finished(): boolean {
    const r = this.known.get(this.net.selfId);
    return this.o.mode === 'race' && !!r && (r.status === 'finished' || r.rank > 0);
  }

  /** Classement du moment sous forme de résultats (arrivés d'abord, puis les coureurs encore en course). */
  private liveResults(): RideResult[] {
    return this.lastStandings
      .filter((r) => r.status === 'finished' || r.status === 'racing')
      .map((r) => {
        const out: RideResult = { riderId: r.id, name: r.name, rank: r.pos, timeMs: r.timeMs ?? 0, isAI: r.isAI, isGuest: false, status: r.status, komPts: r.komPts, sprintPts: r.sprintPts };
        if (r.gapMs !== undefined) out.gapMs = r.gapMs;
        return out;
      });
  }

  /**
   * Écran d'arrivée : dès que le coureur franchit la ligne, le classement s'affiche et se met à
   * jour à chaque arrivée et chaque prime, jusqu'aux résultats finaux (dernier arrivé ou heure limite).
   */
  private refreshArrival(): void {
    if (!this.finished || this.arrivalClosed || this.finalResults) return;
    const mine = this.known.get(this.net.selfId);
    const rows = this.liveResults();
    const waiting = rows.filter((r) => r.status === 'racing' && !r.isAI).length;
    const title = mine && mine.rank > 0 ? fill(S('finishTitleRank'), { rank: rankText(mine.rank), time: formatRaceTime(mine.timeMs) }) : S('finishTitle');
    this.overlay.innerHTML = `<div class="panel mp-modal" role="dialog" aria-labelledby="mp-arrival-title">
      <header class="mp-head"><h2 class="ab-title" id="mp-arrival-title">${title}</h2>
      <p class="ab-sub">${esc(this.o.track.route.name)} · ${waiting > 0 ? (waiting > 1 ? fill(S('waitingMany'), { n: waiting }) : S('waitingOne')) : S('provisional')}</p></header>
      ${this.resultsTable(rows)}
      <div class="ab-foot"><div class="ab-btns">
        <button type="button" class="ab-btn" data-act="close">${S('hide')}</button>
        <button type="button" class="ab-btn ab-go" data-act="leave">${S('endRide')}</button>
      </div></div></div>`;
    this.overlay.querySelector('[data-act="close"]')?.addEventListener('click', () => {
      this.arrivalClosed = true;
      this.overlay.innerHTML = '';
    });
    this.overlay.querySelector('[data-act="leave"]')?.addEventListener('click', () => this.onLeave?.());
  }

  private showResults(results: RideResult[]): void {
    this.resultsShown = true;
    this.overlay.innerHTML = `<div class="panel mp-modal" role="dialog" aria-labelledby="mp-results-title">
      <header class="mp-head"><h2 class="ab-title" id="mp-results-title">${S('results')}</h2><p class="ab-sub">${esc(this.o.track.route.name)}</p></header>
      ${this.resultsTable(results)}
      <div class="ab-foot"><div class="ab-btns">
        <button type="button" class="ab-btn" data-act="close">${S('keepRiding')}</button>
        <button type="button" class="ab-btn ab-go" data-act="leave">${S('endRide')}</button>
      </div></div></div>`;
    this.overlay.querySelector('[data-act="close"]')?.addEventListener('click', () => {
      this.overlay.innerHTML = '';
    });
    this.overlay.querySelector('[data-act="leave"]')?.addEventListener('click', () => this.onLeave?.());
  }

  /** Tableau des résultats (fenêtre de fin et résumé de la sortie). */
  resultsTable(results: RideResult[]): string {
    const hasPts = results.some((r) => (r.komPts ?? 0) + (r.sprintPts ?? 0) > 0);
    const komLeader = Math.max(0, ...results.map((r) => r.komPts ?? 0));
    const sprintLeader = Math.max(0, ...results.map((r) => r.sprintPts ?? 0));
    return `<table class="mp-results"><thead><tr><th class="num">#</th><th>${S('rider')}</th><th class="num">${S('time')}</th><th class="num">${S('gap')}</th>${hasPts ? '<th class="num">⛰</th><th class="num">⚡</th>' : ''}</tr></thead><tbody>${results
      .map((r) => {
        const st = r.status ?? (r.rank > 0 ? 'finished' : 'unranked');
        const cls = r.riderId === this.net.selfId ? 'me' : '';
        const jersey = (r.komPts ?? 0) > 0 && r.komPts === komLeader ? ' ⛰' : '';
        const green = (r.sprintPts ?? 0) > 0 && r.sprintPts === sprintLeader ? ' ⚡' : '';
        return `<tr class="${cls}"><td class="num">${r.rank > 0 ? r.rank : '–'}</td><td>${this.flag(r.riderId)}${esc(r.name)}${r.isAI ? ` <span class="mp-ai">${S('ai')}</span>` : ''}${jersey}${green}</td><td class="num">${st === 'finished' ? formatRaceTime(r.timeMs) : esc(statusLabel(st, this.o.lang))}</td><td class="num">${st === 'finished' && r.gapMs !== undefined ? formatGap(r.gapMs) : r.distM !== undefined && st !== 'unranked' ? `${km(r.distM)} km` : ''}</td>${hasPts ? `<td class="num">${r.komPts ?? 0}</td><td class="num">${r.sprintPts ?? 0}</td>` : ''}</tr>`;
      })
      .join('')}</tbody></table>`;
  }

  /**
   * Résumé de fin de sortie : résultats finaux, sinon classement au moment où l'on quitte
   * (en pleine course, quitter = abandon).
   */
  summaryHtml(): string {
    if (this.o.mode !== 'race' || this.phase === 'lobby') return '';
    const me = this.net.selfId;
    const res: RideResult[] =
      this.finalResults ??
      this.lastStandings.map((r) => {
        const status = r.id === me && r.status === 'racing' ? 'dnf' : r.status;
        const out: RideResult = { riderId: r.id, name: r.name, rank: status === 'finished' || status === 'racing' ? r.pos : 0, timeMs: r.timeMs ?? 0, isAI: r.isAI, isGuest: false, status, komPts: r.komPts, sprintPts: r.sprintPts };
        if (r.gapMs !== undefined) out.gapMs = r.gapMs;
        return out;
      });
    if (!res.length) return '';
    return `<h2 class="ab-section">${this.finalResults ? S('raceResults') : S('standingsLeft')}</h2>${this.resultsTable(res)}`;
  }

  private updateGroup(self: { distM: number; wkg: number }): void {
    const fr = this.fr;
    const w = this.w;
    if (!w) return;
    const pace = w.hostOptions?.paceWkg ?? null;
    const target = w.hostOptions?.targetKmh ?? null;
    const leaderId = this.leaderId;
    const leader = leaderId && leaderId !== this.net.selfId ? this.net.getInterpolated(leaderId) : null;
    const me = this.net.selfId;
    const canRegroup = me === this.net.hostId || me === leaderId;
    const band = pace !== null ? paceBand(self.wkg, pace) : 'ok';
    const nf = (v: number) => v.toFixed(1).replace('.', fr ? ',' : '.');
    setHtml(this.body, `<h4><span>${S('groupRide')}</span><span>${w.options.stickyGroup ? S('sticky') : ''}</span></h4>
      ${w.regrouping ? `<div class="mp-banner">${S('regrouping')}</div>` : ''}
      ${target !== null ? `<div class="mp-line"><span>${S('targetAvg')}</span><b class="num">${nf(target).replace(/[,.]0$/, '')} km/h</b></div>` : ''}
      <div class="mp-line"><span>${S('announcedPace')}</span><b class="num">${pace !== null ? `${nf(pace)} W/kg` : S('free')}</b></div>
      <div class="mp-line"><span>${S('yourPace')}</span><span class="mp-pace num ${pace !== null ? band : ''}">${nf(self.wkg)}</span></div>
      <div class="mp-line"><span>${S('leader')}</span><b>★ ${esc(this.name(leaderId))}${leader ? ` · ${leader.unwrappedM - self.distM >= 0 ? '+' : '−'}${Math.round(Math.abs(leader.unwrappedM - self.distM))} m` : leaderId === me ? S('youSuffix') : ''}</b></div>`);
    setHtml(
      this.btns,
      `
        ${this.net.isHost ? `<button type="button" class="mp-btn" data-act="tslower" title="${S('targetDown')}" aria-label="${S('targetDown')}">−1 km/h</button><button type="button" class="mp-btn" data-act="tfaster" title="${S('targetUp')}" aria-label="${S('targetUp')}">+1 km/h</button>${target !== null ? `<button type="button" class="mp-btn" data-act="tfree">${S('noTarget')}</button>` : ''}` : ''}
        ${this.net.isHost ? `<button type="button" class="mp-btn" data-act="slower" title="${S('paceDown')}" aria-label="${S('paceDown')}">−</button><button type="button" class="mp-btn" data-act="faster" title="${S('paceUp')}" aria-label="${S('paceUp')}">+</button><button type="button" class="mp-btn" data-act="free">${S('freeBtn')}</button>` : ''}
        ${canRegroup ? `<button type="button" class="mp-btn ${w.regrouping ? '' : 'primary'}" data-act="regroup">${w.regrouping ? S('stopRegroup') : S('regroup')}</button>` : ''}
        ${this.discord ? `<a class="mp-btn discord" href="${esc(this.discord)}" target="_blank" rel="noopener noreferrer">Discord</a>` : ''}`,
    );
    this.panel.style.display = '';
  }

  dispose(): void {
    for (const off of this.offs) off();
    this.panel.remove();
    this.overlay.remove();
  }
}
