/**
 * Démarrage du serveur : configuration → base (migrations) → itinéraires → contexte →
 * Colyseus (transport WebSocket + application Express de l'API) → écoute.
 */
import { Server } from '@colyseus/core';
import { WebSocketTransport } from '@colyseus/ws-transport';
import type express from 'express';
import { loadConfig, type Config } from './config.ts';
import { createDb, migrate, type Db } from './db/db.ts';
import { RouteStore } from './ride/routes.ts';
import { createContext, rideServicesFrom, type AppContext } from './context.ts';
import { setRideServices } from './ride/services.ts';
import { PublicRideRoom, RideRoom } from './ride/RideRoom.ts';
import { PairRoom } from './ride/PairRoom.ts';
import { PAIR_ROOM, PUBLIC_ROOM } from '@allezrobert/shared';
import { mountApi } from './http/api.ts';
import { RenderWorker } from './render/worker.ts';
import { renderWorkerOptions } from './render/options.ts';
import { backfillTraining } from './activities/backfill.ts';

export interface RunningServer {
  ctx: AppContext;
  gameServer: Server;
  port: number;
  stop(): Promise<void>;
}

export interface StartOptions {
  config?: Config;
  db?: Db;
  port?: number;
  fetchFn?: typeof fetch;
  /** Ne pas intercepter SIGINT/SIGTERM (tests). */
  noSignals?: boolean;
}

export async function startServer(opts: StartOptions = {}): Promise<RunningServer> {
  const config = opts.config ?? loadConfig();
  const db = opts.db ?? (await createDb(config.DATABASE_URL, config.DATABASE_SSL));
  const ctx = createContext(config, db, await RouteStore.load(config.ROUTES_DIR, (m) => console.log(`[routes] ${m}`)), opts.fetchFn ? { fetchFn: opts.fetchFn } : {});
  const applied = await migrate(db, undefined, (m) => ctx.log('info', m));
  if (applied.length) ctx.log('info', `${applied.length} migration(s) appliquée(s)`);
  if (db.kind === 'memory') ctx.log('warn', 'base en mémoire (pg-mem) : données perdues à l’arrêt');
  setRideServices(rideServicesFrom(ctx));
  // Mesures d'entraînement des anciennes sorties (migration 006), en tâche de fond.
  if (config.NODE_ENV !== 'test') {
    setTimeout(() => {
      void backfillTraining(ctx)
        .then((n) => n && ctx.log('info', `mesures d'entraînement calculées pour ${n} ancienne(s) sortie(s)`))
        .catch((e) => ctx.log('warn', `rattrapage des mesures : ${(e as Error).message}`));
    }, 5000).unref();
  }

  const transport = new WebSocketTransport({ pingInterval: 5000, pingMaxRetries: 3, maxPayload: 16 * 1024 });
  const gameServer = new Server({
    transport,
    greet: false,
    gracefullyShutdown: !opts.noSignals,
    express: (app: express.Application) => mountApi(app, ctx),
  });
  gameServer.define('ride', RideRoom);
  // Monde ouvert : salles publiques par zone (itinéraire), sans hôte.
  gameServer.define(PUBLIC_ROOM, PublicRideRoom).filterBy(['routeId']);
  // Appli compagnon appairée par QR code (solo comme en groupe) : une salle par jeton.
  gameServer.define(PAIR_ROOM, PairRoom).filterBy(['pair']);

  const port = opts.port ?? config.PORT;
  await gameServer.listen(port, config.HOST);
  const addr = transport.server?.address();
  const actualPort = typeof addr === 'object' && addr ? addr.port : port;
  ctx.log('info', `Allez Robert ! serveur sur http://${config.HOST}:${actualPort} (API /api, salles Colyseus « ride »)`);

  // Connexions disponibles, pour voir d'un coup d'œil ce que le .env a (ou n'a pas) activé.
  const on = (id?: string, secret?: string) => (id && secret ? 'activé' : 'absent du .env');
  ctx.log('info', `connexions : Google ${on(config.GOOGLE_CLIENT_ID, config.GOOGLE_CLIENT_SECRET)} · Discord ${on(config.DISCORD_CLIENT_ID, config.DISCORD_CLIENT_SECRET)} · Strava ${on(config.STRAVA_CLIENT_ID, config.STRAVA_CLIENT_SECRET)} · lien magique ${ctx.mailer.enabled ? 'activé' : 'journal seulement'}`);

  const purge = setInterval(() => void ctx.repos.purgeExpired().catch(() => undefined), 3600_000);
  purge.unref();

  // Worker vidéo intégré (sans conteneur renderer) : même file, même dossier de sortie.
  let worker: RenderWorker | null = null;
  if (config.RENDER_INLINE) {
    worker = new RenderWorker({ queue: ctx.repos, ...renderWorkerOptions(config), log: (m) => ctx.log('info', `[rendu] ${m}`) });
    ctx.renderWorker = worker;
    void worker.start().catch((e) => ctx.log('error', `worker vidéo arrêté : ${(e as Error).message}`));
  }

  return {
    ctx,
    gameServer,
    port: actualPort,
    async stop() {
      clearInterval(purge);
      await worker?.stop();
      await gameServer.gracefullyShutdown(false);
      await db.close().catch(() => undefined);
    },
  };
}
