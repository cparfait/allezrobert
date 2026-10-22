import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Config } from '../config.ts';
import type { RenderWorkerOptions } from './worker.ts';

const here = path.dirname(fileURLToPath(import.meta.url));

/** Options du worker de rendu tirées de l'environnement (conteneur renderer ou RENDER_INLINE). */
export function renderWorkerOptions(config: Config, env: NodeJS.ProcessEnv = process.env): Omit<RenderWorkerOptions, 'queue'> {
  return {
    rendersDir: config.RENDERS_DIR,
    projectDir: env.RENDER_PROJECT_DIR ?? path.join(here, '../../../../packages/sequences'),
    quality: env.RENDER_QUALITY ?? 'looks',
    timeoutS: Number(env.RENDER_TIMEOUT_S ?? 900),
    pollS: Number(env.RENDER_POLL_S ?? 5),
    inline: config.RENDER_INLINE,
  };
}
