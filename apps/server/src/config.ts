/**
 * Configuration du serveur, lue dans l'environnement et validée par zod.
 * Aucun secret dans le dépôt : voir `.env.example` (valeurs factices) et docs/DEPLOY.md.
 */
import { z } from 'zod';

const bool = z
  .union([z.boolean(), z.string()])
  .transform((v) => (typeof v === 'boolean' ? v : ['1', 'true', 'yes', 'on'].includes(v.toLowerCase())));

const optionalString = z
  .string()
  .optional()
  .transform((v) => (v === undefined || v.trim() === '' ? undefined : v.trim()));

export const ConfigSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(2567),
  HOST: z.string().default('0.0.0.0'),
  /** URL publique du jeu (redirections après connexion), ex. https://allezrobert.cparfait.ovh */
  PUBLIC_URL: z.string().url().default('http://localhost:5173'),
  /** URL publique de l'API (rappels OAuth, liens magiques). Défaut : PUBLIC_URL. */
  API_PUBLIC_URL: optionalString,
  /** Origines autorisées (CORS + contrôle d'origine anti-CSRF), séparées par des virgules. */
  CORS_ORIGINS: z.string().default('http://localhost:5173,http://localhost:5174'),
  /** postgres://… ou « memory » (pg-mem, développement uniquement). */
  DATABASE_URL: z.string().min(1).default('memory'),
  DATABASE_SSL: bool.default(false),
  /** Secret de signature des sessions (≥ 32 caractères). */
  SESSION_SECRET: z.string().min(32, 'SESSION_SECRET doit faire au moins 32 caractères'),
  SESSION_TTL_DAYS: z.coerce.number().int().min(1).max(365).default(30),
  /** Clé AES-256-GCM des données sensibles (FC, jetons tiers), 32 octets en base64. */
  DATA_ENCRYPTION_KEY: z.string().refine((v) => Buffer.from(v, 'base64').length === 32, 'DATA_ENCRYPTION_KEY : 32 octets en base64 attendus'),
  COOKIE_SECURE: z
    .union([z.literal('auto'), bool])
    .default('auto'),

  GOOGLE_CLIENT_ID: optionalString,
  GOOGLE_CLIENT_SECRET: optionalString,
  DISCORD_CLIENT_ID: optionalString,
  DISCORD_CLIENT_SECRET: optionalString,
  STRAVA_CLIENT_ID: optionalString,
  STRAVA_CLIENT_SECRET: optionalString,

  /** smtp://user:pass@host:587 ou smtps://… ; vide = les liens magiques sont journalisés (dev). */
  SMTP_URL: optionalString,
  SMTP_FROM: z.string().default('Allez Robert ! <no-reply@allezrobert.cparfait.ovh>'),

  /** URL WebSocket publique de LiveKit, ex. wss://livekit.allezrobert.cparfait.ovh */
  LIVEKIT_URL: optionalString,
  LIVEKIT_API_KEY: optionalString,
  LIVEKIT_API_SECRET: optionalString,
  /**
   * Repli de la voix : lien d'invitation d'un salon Discord (https://discord.gg/… ou
   * https://discord.com/invite/…), proposé dans le jeu quand LiveKit est absent ou échoue.
   */
  DISCORD_VOICE_INVITE: optionalString.refine(
    (v) => v === undefined || /^https:\/\/(discord\.gg|(www\.)?discord(app)?\.com\/invite)\/[A-Za-z0-9-]{2,64}\/?$/.test(v),
    'DISCORD_VOICE_INVITE : lien https://discord.gg/… ou https://discord.com/invite/… attendu',
  ),

  /** Synthèse vocale (voix off du tutoriel) : clé Cartesia, uniquement côté serveur. */
  CARTESIA_API_KEY: optionalString,
  CARTESIA_MODEL: z.string().default('sonic-2'),
  /** Voix : Jules (« Polished Host ») en français, Jameson (« Easygoing Support ») en anglais. */
  CARTESIA_VOICE_FR: z.string().default('8f1e9d27-96ff-405e-9213-7432a784ac0b'),
  CARTESIA_VOICE_EN: z.string().default('a5136bf9-224c-4d76-b823-52bd5efcffcc'),
  /** Cache disque des répliques synthétisées (une même phrase n'est générée qu'une fois). */
  TTS_CACHE_DIR: z.string().default('./tts-cache'),

  /** Dossier des itinéraires JSON (RouteData). Repli : boucle procédurale. */
  ROUTES_DIR: optionalString,
  /** Dossier des vidéos rendues (volume partagé avec le conteneur renderer). */
  RENDERS_DIR: z.string().default('./renders'),
  /**
   * Worker vidéo dans le processus du serveur (petit VPS sans conteneur renderer, développement) :
   * HyperFrames si Chromium est là, sinon repli FFmpeg ; sans FFmpeg, aucun MP4.
   */
  RENDER_INLINE: bool.default(false),

  RECONNECT_GRACE_S: z.coerce.number().int().min(0).max(600).default(30),
  ALLOW_ANONYMOUS_GUESTS: bool.default(true),
  /** Puissance virtuelle maximale d'un invité au clavier / à la manette (W/kg). */
  GUEST_MAX_WKG: z.coerce.number().min(1).max(8).default(3.5),
  /** Connexion de développement sans OAuth (`POST /api/auth/dev`) — interdite en production. */
  DEV_LOGIN: bool.default(false),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
});

export type Config = z.infer<typeof ConfigSchema> & {
  apiPublicUrl: string;
  corsOrigins: string[];
  cookieSecure: boolean;
};

export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  const parsed = ConfigSchema.safeParse(env);
  if (!parsed.success) {
    const lines = parsed.error.issues.map((i) => `  - ${i.path.join('.')} : ${i.message}`);
    throw new Error(`Configuration invalide :\n${lines.join('\n')}`);
  }
  const c = parsed.data;
  if (c.NODE_ENV === 'production') {
    if (c.DATABASE_URL === 'memory') throw new Error('DATABASE_URL=memory est interdit en production');
    if (c.DEV_LOGIN) throw new Error('DEV_LOGIN est interdit en production');
  }
  const apiPublicUrl = (c.API_PUBLIC_URL ?? c.PUBLIC_URL).replace(/\/$/, '');
  const corsOrigins = c.CORS_ORIGINS.split(',')
    .map((s) => s.trim().replace(/\/$/, ''))
    .filter(Boolean);
  const publicOrigin = new URL(c.PUBLIC_URL).origin;
  if (!corsOrigins.includes(publicOrigin)) corsOrigins.push(publicOrigin);
  // Développement : le client peut aussi être ouvert via 127.0.0.1 (adresse exigée par Spotify).
  if (c.NODE_ENV !== 'production' && publicOrigin.includes('//localhost')) corsOrigins.push(publicOrigin.replace('//localhost', '//127.0.0.1'));
  const cookieSecure = c.COOKIE_SECURE === 'auto' ? c.PUBLIC_URL.startsWith('https://') : c.COOKIE_SECURE;
  return { ...c, PUBLIC_URL: c.PUBLIC_URL.replace(/\/$/, ''), apiPublicUrl, corsOrigins, cookieSecure };
}

/** Configuration de test : secrets factices générés, base en mémoire. */
export function testConfig(overrides: Record<string, string> = {}): Config {
  return loadConfig({
    NODE_ENV: 'test',
    SESSION_SECRET: 'test-session-secret-0123456789abcdef0123456789',
    DATA_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64'),
    DATABASE_URL: 'memory',
    PUBLIC_URL: 'http://localhost:5173',
    API_PUBLIC_URL: 'http://localhost:2567',
    ...overrides,
  });
}
