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
import { RideRoom } from './ride/RideRoom.ts';
import { mountApi } from './http/api.ts';

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

  const transport = new WebSocketTransport({ pingInterval: 5000, pingMaxRetries: 3, maxPayload: 16 * 1024 });
  const gameServer = new Server({
    transport,
    greet: false,
    gracefullyShutdown: !opts.noSignals,
    express: (app: express.Application) => mountApi(app, ctx),
  });
  gameServer.define('ride', RideRoom);

  const port = opts.port ?? config.PORT;
  await gameServer.listen(port, config.HOST);
  const addr = transport.server?.address();
  const actualPort = typeof addr === 'object' && addr ? addr.port : port;
  ctx.log('info', `Allez Robert ! serveur sur http://${config.HOST}:${actualPort} (API /api, salles Colyseus « ride »)`);

  const purge = setInterval(() => void ctx.repos.purgeExpired().catch(() => undefined), 3600_000);
  purge.unref();

  return {
    ctx,
    gameServer,
    port: actualPort,
    async stop() {
      clearInterval(purge);
      await gameServer.gracefullyShutdown(false);
      await db.close().catch(() => undefined);
    },
  };
}
