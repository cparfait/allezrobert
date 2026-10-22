/**
 * Conteneur « renderer » (Node 22 + FFmpeg + Chromium + HyperFrames) : boucle du worker de
 * rendu vidéo (voir src/render/worker.ts : HyperFrames, repli FFmpeg, pouls).
 *
 * Variables d'environnement propres au worker :
 *   RENDER_PROJECT_DIR   paquet des séquences (défaut : packages/sequences du dépôt)
 *   RENDER_QUALITY       draft | looks | delivery (défaut looks)
 *   RENDER_TIMEOUT_S     délai maximal d'un rendu (défaut 900)
 *   RENDER_POLL_S        intervalle d'interrogation de la file (défaut 5)
 *   FFMPEG_PATH          FFmpeg à utiliser (défaut : celui du PATH)
 */
import { loadConfig } from '../config.ts';
import { DataCipher } from '../crypto.ts';
import { createDb } from '../db/db.ts';
import { Repos } from '../db/repos.ts';
import { RenderWorker } from '../render/worker.ts';
import { renderWorkerOptions } from '../render/options.ts';

const config = loadConfig();
const db = await createDb(config.DATABASE_URL, config.DATABASE_SSL);
const repos = new Repos(db, new DataCipher(config.DATA_ENCRYPTION_KEY));
const worker = new RenderWorker({ queue: repos, ...renderWorkerOptions(config) });
for (const sig of ['SIGINT', 'SIGTERM'] as const) process.on(sig, () => void worker.stop());
await worker.start();
await db.close();
