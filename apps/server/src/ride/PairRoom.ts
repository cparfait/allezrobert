/**
 * Salle Colyseus « pair » : relie le jeu et l'appli compagnon appairée par QR code, en solo
 * comme en groupe, sans compte (voir packages/shared/src/companion.ts).
 *
 * Une salle par jeton d'appairage (`filterBy(['pair'])`) : le jeton n'est connu que du jeu et
 * des téléphones qui ont lu le QR. Un seul jeu à la fois (une nouvelle connexion du jeu, après
 * le rechargement de la page entre deux sorties, remplace l'ancienne), au plus
 * PAIR_MAX_PHONES téléphones. La salle vit tant qu'un des deux côtés est là : le téléphone
 * attend le jeu pendant le rechargement, et inversement.
 */
import { CloseCode, Room, ServerError, type Client } from '@colyseus/core';
import { z } from 'zod';
import { PAIR_MAX_PHONES, PAIR_MSG, PAIR_TOKEN_RE, type PairPresence, type PairRole, type PhoneCommand } from '@allezrobert/shared';

const finite = z.number().refine(Number.isFinite, 'nombre fini attendu');

const JoinSchema = z.object({ pair: z.string().regex(PAIR_TOKEN_RE), role: z.enum(['game', 'phone']) });

const PhoneCommandSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('shift'), action: z.enum(['up', 'down']) }),
  z.object({ kind: z.literal('pause') }),
  z.object({ kind: z.literal('resume') }),
  z.object({ kind: z.literal('camera'), camera: z.enum(['chase', 'cockpit', 'gopro', 'drone', 'tv', 'photo']) }),
  z.object({ kind: z.literal('fan'), percent: finite.transform((v) => Math.min(Math.max(Math.round(v), 0), 100)) }),
  z.object({ kind: z.literal('rideOn'), to: z.string().min(1).max(40) }),
  z.object({ kind: z.literal('chat'), text: z.string().trim().min(1).max(280) }),
  z.object({ kind: z.literal('turn'), delta: z.union([z.literal(-1), z.literal(1)]).optional(), index: z.number().int().min(0).max(16).optional() }),
  z.object({ kind: z.literal('uturn') }),
  z.object({ kind: z.literal('music'), action: z.enum(['toggle', 'next', 'previous', 'volume']), volume: finite.transform((v) => Math.min(Math.max(v, 0), 1)).optional() }),
  z.object({ kind: z.literal('hud') }),
  z.object({ kind: z.literal('photo') }),
  z.object({ kind: z.literal('slowDown') }),
  z.object({ kind: z.literal('pace'), delta: z.union([z.literal(-1), z.literal(1)]) }),
  z.object({ kind: z.literal('sync') }),
]);

interface PairClientData {
  role: PairRole;
  /** Jeu remplacé par une connexion plus récente. */
  replaced?: boolean;
}

export class PairRoom extends Room {
  override maxClients = PAIR_MAX_PHONES + 2;
  private game: Client | null = null;
  /** Dernier état et dernière route du jeu, pour un téléphone qui arrive. */
  private lastState: unknown = null;
  private lastRoute: unknown = null;

  override onCreate(): void {
    this.maxMessagesPerSecond = 40;
    this.onMessage(PAIR_MSG.cmd, (client: Client, raw: unknown) => {
      if ((client.userData as PairClientData | undefined)?.role !== 'phone') return;
      const p = PhoneCommandSchema.safeParse(raw);
      if (!p.success) return;
      const cmd = p.data as PhoneCommand;
      // Le téléphone redemande tout : réponse immédiate depuis le cache, et relais au jeu.
      if (cmd.kind === 'sync') this.sendCache(client);
      this.game?.send(PAIR_MSG.cmd, cmd);
    });
    // Jeu → téléphones : relais tel quel (le jeu est la seule source de vérité).
    for (const type of [PAIR_MSG.state, PAIR_MSG.event, PAIR_MSG.route] as const) {
      this.onMessage(type, (client: Client, data: unknown) => {
        if (client !== this.game || data === null || typeof data !== 'object') return;
        if (type === PAIR_MSG.state) this.lastState = data;
        else if (type === PAIR_MSG.route) this.lastRoute = data;
        for (const c of this.clients) if ((c.userData as PairClientData | undefined)?.role === 'phone') c.send(type, data);
      });
    }
  }

  override onAuth(_client: Client, options: unknown): PairRole {
    const p = JoinSchema.safeParse(options ?? {});
    if (!p.success) throw new ServerError(400, "Jeton d'appairage invalide");
    if (p.data.role === 'phone' && this.phones() >= PAIR_MAX_PHONES) throw new ServerError(409, 'Trop de téléphones appairés');
    return p.data.role;
  }

  override onJoin(client: Client): void {
    const role = client.auth as PairRole;
    client.userData = { role } satisfies PairClientData;
    if (role === 'game') {
      const old = this.game;
      this.game = client;
      if (old) {
        (old.userData as PairClientData).replaced = true;
        old.leave(CloseCode.CONSENTED, 'replaced');
      }
      // Nouvelle page du jeu : l'ancien état ne vaut plus.
      this.lastState = null;
      this.lastRoute = null;
    } else this.sendCache(client);
    this.broadcastPresence();
  }

  override onLeave(client: Client): void {
    if (client === this.game) {
      this.game = null;
      this.lastState = null;
    }
    this.broadcastPresence();
  }

  private phones(): number {
    let n = 0;
    for (const c of this.clients) if ((c.userData as PairClientData | undefined)?.role === 'phone') n++;
    return n;
  }

  private sendCache(client: Client): void {
    if (this.lastRoute) client.send(PAIR_MSG.route, this.lastRoute);
    if (this.lastState) client.send(PAIR_MSG.state, this.lastState);
  }

  private broadcastPresence(): void {
    const p: PairPresence = { game: !!this.game, phones: this.phones() };
    this.broadcast(PAIR_MSG.presence, p);
  }
}
