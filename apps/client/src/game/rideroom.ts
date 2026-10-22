import './rideroom.css';
import type { RideEventMsg, RideResult, RouteTrack } from '@allezrobert/shared';
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
  private finalResults: RideResult[] | null = null;
  private lastStandings: StandingRow[] = [];
  /** Le coureur doit rester immobile (salle d'attente, compte à rebours). */
  onHoldChange?: (holding: boolean) => void;
  /** Quitter la sortie depuis la salle d'attente ou les résultats. */
  onLeave?: () => void;
  /** Résultats finaux reçus (podium). */
  onResults?: (results: RideResult[]) => void;

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

  private targetM(): number {
    const route = this.w?.route;
    const laps = this.w?.options.laps ?? 1;
    return route?.loop ? laps * route.lengthM : this.o.track.length;
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
        if (ev.riderId === me) this.o.toast(ev.rank > 0 ? (fr ? `Arrivée ! ${ev.rank}${ev.rank === 1 ? 'er' : 'e'} en ${formatRaceTime(ev.timeMs)}` : `Finished! #${ev.rank} in ${formatRaceTime(ev.timeMs)}`) : fr ? 'Arrivée (hors classement)' : 'Finished (unranked)');
        else if (ev.rank === 1) this.o.toast(fr ? `🏁 ${this.name(ev.riderId)} remporte la course` : `🏁 ${this.name(ev.riderId)} wins the race`);
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
        const r = this.known.get(ev.riderId);
        this.upsert(ev.riderId, ev.segmentKind === 'kom' ? { komPts: (r?.komPts ?? 0) + ev.points } : { sprintPts: (r?.sprintPts ?? 0) + ev.points });
        const seg = this.o.track.route.segments.find((s) => s.id === ev.segmentId)?.name ?? '';
        const icon = ev.segmentKind === 'kom' ? '⛰' : '⚡';
        const who = ev.riderId === me ? (fr ? 'Toi' : 'You') : this.name(ev.riderId);
        this.o.toast(`${icon} ${fr ? 'Prime' : 'Prime'} ${seg} : ${who} ${ev.place}${fr ? (ev.place === 1 ? 'er' : 'e') : ''} (+${ev.points} pts)`);
        break;
      }
      case 'abandon':
        this.upsert(ev.riderId, { name: ev.name, status: 'dnf', rank: 0 });
        this.o.toast(fr ? `${ev.name} abandonne` : `${ev.name} abandons`);
        break;
      case 'flag':
        if (ev.action === 'dq') {
          this.upsert(ev.riderId, { status: 'dq', rank: 0 });
          this.o.toast(ev.riderId === me ? (fr ? 'Mis hors course : puissance invraisemblable' : 'Disqualified: implausible power') : fr ? `${this.name(ev.riderId)} mis hors course (puissance)` : `${this.name(ev.riderId)} disqualified (power)`);
        } else if (ev.riderId === me) this.o.toast(fr ? `Contrôle de puissance : ${ev.reason}. Vérifie ton capteur.` : `Power check: capped. Check your power meter.`);
        break;
      case 'deadline':
        this.o.toast(fr ? `Heure limite : ${formatRaceTime(ev.at - this.net.serverNow())} pour franchir la ligne` : `Time limit: ${formatRaceTime(ev.at - this.net.serverNow())} to finish`);
        break;
      case 'join':
        if (this.o.mode === 'race' && this.phase === 'running') this.unranked.add(ev.riderId);
        break;
      case 'regroup':
        this.o.toast(ev.active ? (fr ? `Regroupement ! (écart ${ev.spreadM} m) — la tête temporise, la queue est aidée` : `Regroup! (gap ${ev.spreadM} m)`) : fr ? 'Groupe reformé' : 'Group back together');
        break;
      case 'split': {
        const canAsk = this.net.selfId === this.net.hostId || this.net.selfId === this.leaderId;
        this.o.toast(fr ? `Le groupe s'est scindé (${ev.gapM} m)${canAsk ? ' — G pour regrouper' : ''}` : `The group has split (${ev.gapM} m)${canAsk ? ' — G to regroup' : ''}`);
        break;
      }
      case 'options': {
        const pace = ev.options.paceWkg;
        this.o.toast(pace === null ? (fr ? 'Allure libre' : 'Free pace') : fr ? `Allure annoncée : ${pace.toFixed(1).replace('.', ',')} W/kg` : `Announced pace: ${pace.toFixed(1)} W/kg`);
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
    const fr = this.fr;
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
      r.status === 'finished' ? (r.gapMs ? formatGap(r.gapMs) : formatRaceTime(r.timeMs ?? 0)) : r.behindM ? `+ ${Math.round(r.behindM)} m` : r.pos === 1 ? (fr ? 'tête' : 'lead') : '';
    const deadline = w.deadline !== undefined && this.phase === 'running' ? w.deadline - this.net.serverNow() : undefined;
    const pts = (mine?.komPts ?? 0) + (mine?.sprintPts ?? 0) > 0 ? `<div class="mp-line"><span>${fr ? 'Primes' : 'Primes'}</span><b>⛰ ${mine?.komPts ?? 0} · ⚡ ${mine?.sprintPts ?? 0} pts</b></div>` : '';
    const status = meRow && meRow.status !== 'racing' && meRow.status !== 'finished' ? `<div class="mp-line"><b>${esc(statusLabel(meRow.status, this.o.lang))}</b></div>` : '';
    setHtml(this.btns, '');
    setHtml(this.body, `<h4><span>${fr ? 'Course' : 'Race'}</span><span>${fr ? 'tour' : 'lap'} ${info?.lap ?? 1}/${laps}</span></h4>
      <div class="mp-big num">${info && info.pos > 0 ? `${info.pos}<small> / ${info.total}</small>` : '—'}</div>
      ${status}
      ${mine?.status === 'finished' ? `<div class="mp-line"><span>${fr ? 'Arrivé en' : 'Finished in'}</span><b class="num">${formatRaceTime(mine.timeMs)}</b></div>` : `<div class="mp-line"><span>${fr ? 'Reste' : 'To go'}</span><b class="num">${km(info?.remainingM ?? 0)} km</b></div>`}
      ${info?.aheadM !== undefined ? `<div class="mp-line"><span>${fr ? 'Devant' : 'Ahead'}</span><b class="num">${Math.round(info.aheadM)} m</b></div>` : ''}
      ${info?.behindM !== undefined ? `<div class="mp-line"><span>${fr ? 'Derrière' : 'Behind'}</span><b class="num">${Math.round(info.behindM)} m</b></div>` : ''}
      ${deadline !== undefined && deadline > 0 ? `<div class="mp-line"><span>${fr ? 'Heure limite' : 'Time limit'}</span><b class="num">${formatRaceTime(deadline)}</b></div>` : ''}
      ${pts}
      <div class="mp-standings">${top
        .map((r) => {
          const cls = r.id === this.net.selfId ? 'me' : '';
          return `<span class="num ${cls}">${r.pos}</span><span class="${cls}">${esc(r.name)}</span><span class="num muted">${gapCell(r)}</span>`;
        })
        .join('')}</div>`);
  }

  private renderLobby(): void {
    const fr = this.fr;
    const w = this.w!;
    const riders = [...this.net.roster.values()];
    const host = this.net.roster.get(this.net.hostId)?.name ?? '';
    const key = `${riders.map((r) => `${r.id}${r.connected ? 1 : 0}`).join(',')}|${this.net.hostId}|${this.discord}`;
    if (key === this.lobbyKey && this.overlay.querySelector('.mp-lobby')) return;
    this.lobbyKey = key;
    const laps = w.route.loop ? (w.options.laps ?? 1) : 1;
    const dist = km(this.targetM());
    this.overlay.innerHTML = `<div class="panel mp-modal mp-lobby">
      <h2>${fr ? 'Course · salle d’attente' : 'Race · waiting room'}</h2>
      <div class="sub">${esc(w.route.name)} · ${dist} km${laps > 1 ? ` · ${laps} ${fr ? 'tours' : 'laps'}` : ''} · ${fr ? 'primes KOM et sprint' : 'KOM and sprint primes'}</div>
      <div class="mp-line"><span>${fr ? 'Code d’invitation' : 'Invite code'}</span><span class="mp-code">${esc(w.inviteCode)}</span></div>
      <div class="mp-roster">${riders
        .map((r) => `<span>${esc(r.name)}${r.id === this.net.selfId ? (fr ? ' (toi)' : ' (you)') : ''}</span><span class="tag">${r.isHost ? (fr ? 'organisateur' : 'host') : r.isAI ? 'IA' : r.isGuest ? (fr ? 'invité · non classé' : 'guest · unranked') : r.connected ? (fr ? 'prêt' : 'ready') : fr ? 'reconnexion…' : 'reconnecting…'}</span>`)
        .join('')}</div>
      <div class="sub">${this.net.isHost ? (fr ? 'Les IA complètent le peloton ; chaque ami qui arrive prend la place d’une IA.' : 'AI riders fill the field; each friend who joins takes an AI’s place.') : fr ? `En attente du départ donné par ${esc(host)}…` : `Waiting for ${esc(host)} to start…`}</div>
      <div class="mp-btns">
        ${this.net.isHost ? `<button class="mp-btn primary" data-act="start">${fr ? 'Donner le départ (10 s)' : 'Start the race (10 s)'}</button>` : ''}
        ${this.discord ? `<a class="mp-btn discord" href="${esc(this.discord)}" target="_blank" rel="noopener noreferrer">${fr ? 'Salon Discord' : 'Discord channel'}</a>` : ''}
        <button class="mp-btn" data-act="leave">${fr ? 'Quitter' : 'Leave'}</button>
      </div></div>`;
    this.overlay.querySelector('[data-act="start"]')?.addEventListener('click', () => this.net.startCountdown(10));
    this.overlay.querySelector('[data-act="leave"]')?.addEventListener('click', () => this.onLeave?.());
  }

  private showResults(results: RideResult[]): void {
    const fr = this.fr;
    this.resultsShown = true;
    this.overlay.innerHTML = `<div class="panel mp-modal">
      <h2>${fr ? 'Résultats' : 'Results'}</h2>
      <div class="sub">${esc(this.o.track.route.name)}</div>
      ${this.resultsTable(results)}
      <div class="mp-btns" style="justify-content:flex-end">
        <button class="mp-btn" data-act="close">${fr ? 'Continuer à rouler' : 'Keep riding'}</button>
        <button class="mp-btn primary" data-act="leave">${fr ? 'Terminer la sortie' : 'End ride'}</button>
      </div></div>`;
    this.overlay.querySelector('[data-act="close"]')?.addEventListener('click', () => {
      this.overlay.innerHTML = '';
    });
    this.overlay.querySelector('[data-act="leave"]')?.addEventListener('click', () => this.onLeave?.());
  }

  /** Tableau des résultats (fenêtre de fin et résumé de la sortie). */
  resultsTable(results: RideResult[]): string {
    const fr = this.fr;
    const hasPts = results.some((r) => (r.komPts ?? 0) + (r.sprintPts ?? 0) > 0);
    const komLeader = Math.max(0, ...results.map((r) => r.komPts ?? 0));
    const sprintLeader = Math.max(0, ...results.map((r) => r.sprintPts ?? 0));
    return `<table class="mp-results"><thead><tr><th class="num">#</th><th>${fr ? 'Coureur' : 'Rider'}</th><th class="num">${fr ? 'Temps' : 'Time'}</th><th class="num">${fr ? 'Écart' : 'Gap'}</th>${hasPts ? '<th class="num">⛰</th><th class="num">⚡</th>' : ''}</tr></thead><tbody>${results
      .map((r) => {
        const st = r.status ?? (r.rank > 0 ? 'finished' : 'unranked');
        const cls = r.riderId === this.net.selfId ? 'me' : '';
        const jersey = (r.komPts ?? 0) > 0 && r.komPts === komLeader ? ' ⛰' : '';
        const green = (r.sprintPts ?? 0) > 0 && r.sprintPts === sprintLeader ? ' ⚡' : '';
        return `<tr class="${cls}"><td class="num">${r.rank > 0 ? r.rank : '–'}</td><td>${esc(r.name)}${r.isAI ? ' <span style="color:var(--ar-muted)">IA</span>' : ''}${jersey}${green}</td><td class="num">${st === 'finished' ? formatRaceTime(r.timeMs) : esc(statusLabel(st, this.o.lang))}</td><td class="num">${st === 'finished' && r.gapMs !== undefined ? formatGap(r.gapMs) : r.distM !== undefined && st !== 'unranked' ? `${km(r.distM)} km` : ''}</td>${hasPts ? `<td class="num">${r.komPts ?? 0}</td><td class="num">${r.sprintPts ?? 0}</td>` : ''}</tr>`;
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
    const fr = this.fr;
    return `<h2>${this.finalResults ? (fr ? 'Résultats de la course' : 'Race results') : fr ? 'Classement au moment de ton départ' : 'Standings when you left'}</h2>${this.resultsTable(res)}`;
  }

  private updateGroup(self: { distM: number; wkg: number }): void {
    const fr = this.fr;
    const w = this.w;
    if (!w) return;
    const pace = w.hostOptions?.paceWkg ?? null;
    const leaderId = this.leaderId;
    const leader = leaderId && leaderId !== this.net.selfId ? this.net.getInterpolated(leaderId) : null;
    const me = this.net.selfId;
    const canRegroup = me === this.net.hostId || me === leaderId;
    const band = pace !== null ? paceBand(self.wkg, pace) : 'ok';
    const nf = (v: number) => v.toFixed(1).replace('.', fr ? ',' : '.');
    setHtml(this.body, `<h4><span>${fr ? 'Sortie de groupe' : 'Group ride'}</span><span>${w.options.stickyGroup ? (fr ? 'groupe soudé' : 'sticky') : ''}</span></h4>
      ${w.regrouping ? `<div class="mp-banner">${fr ? 'Regroupement en cours' : 'Regrouping'}</div>` : ''}
      <div class="mp-line"><span>${fr ? 'Allure annoncée' : 'Announced pace'}</span><b class="num">${pace !== null ? `${nf(pace)} W/kg` : fr ? 'libre' : 'free'}</b></div>
      <div class="mp-line"><span>${fr ? 'Ton allure (3 s)' : 'Your pace (3 s)'}</span><span class="mp-pace num ${pace !== null ? band : ''}">${nf(self.wkg)}</span></div>
      <div class="mp-line"><span>${fr ? 'Meneur' : 'Leader'}</span><b>★ ${esc(this.name(leaderId))}${leader ? ` · ${leader.unwrappedM - self.distM >= 0 ? '+' : '−'}${Math.round(Math.abs(leader.unwrappedM - self.distM))} m` : leaderId === me ? (fr ? ' (toi)' : ' (you)') : ''}</b></div>`);
    setHtml(
      this.btns,
      `
        ${this.net.isHost ? `<button class="mp-btn" data-act="slower" title="[">−</button><button class="mp-btn" data-act="faster" title="]">+</button><button class="mp-btn" data-act="free">${fr ? 'Libre' : 'Free'}</button>` : ''}
        ${canRegroup ? `<button class="mp-btn ${w.regrouping ? '' : 'primary'}" data-act="regroup">${w.regrouping ? (fr ? 'Arrêter (G)' : 'Stop (G)') : fr ? 'Regrouper (G)' : 'Regroup (G)'}</button>` : ''}
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
