-- Schéma initial d'Allez Robert !
-- Principe : données personnelles minimales. Pas d'e-mail en clair (empreinte HMAC),
-- pas d'adresse IP, FC et fichiers FIT chiffrés côté application (AES-256-GCM).
-- Toutes les tables personnelles dépendent de users avec ON DELETE CASCADE (droit à l'effacement).

CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY,
  display_name text NOT NULL,
  -- HMAC-SHA256 de l'e-mail normalisé (liens magiques, rapprochement de comptes)
  email_hash text UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_login_at timestamptz
);

CREATE TABLE IF NOT EXISTS auth_identities (
  provider text NOT NULL,
  subject text NOT NULL,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (provider, subject)
);
CREATE INDEX IF NOT EXISTS auth_identities_user_idx ON auth_identities (user_id);

CREATE TABLE IF NOT EXISTS sessions (
  id text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_user_idx ON sessions (user_id);

-- Jetons de lien magique à usage unique (aucune donnée personnelle : l'e-mail est dans le jeton signé)
CREATE TABLE IF NOT EXISTS magic_links (
  jti text PRIMARY KEY,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz
);

CREATE TABLE IF NOT EXISTS profiles (
  user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  weight_kg real NOT NULL DEFAULT 75,
  height_cm real NOT NULL DEFAULT 178,
  ftp_watts integer NOT NULL DEFAULT 200,
  -- FC max / repos chiffrées (donnée de santé), stockées seulement avec consentement
  hr_settings_enc bytea,
  avatar jsonb NOT NULL,
  equipped jsonb NOT NULL DEFAULT '{}',
  consent_hr boolean NOT NULL DEFAULT false,
  consent_hr_at timestamptz,
  consent_face boolean NOT NULL DEFAULT false,
  consent_face_at timestamptz,
  skip_strava boolean NOT NULL DEFAULT false,
  locale text NOT NULL DEFAULT 'fr',
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS activities (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name text NOT NULL,
  started_at timestamptz NOT NULL,
  duration_s integer NOT NULL,
  moving_s integer NOT NULL,
  distance_m real NOT NULL,
  elevation_m real NOT NULL,
  avg_watts real,
  max_watts real,
  -- { avg, max } chiffré, seulement avec consentement FC
  hr_summary_enc bytea,
  -- fichier FIT complet chiffré
  fit_enc bytea NOT NULL,
  fit_size integer NOT NULL,
  xp integer NOT NULL DEFAULT 0,
  route_id text,
  ride_id text,
  skip_strava boolean NOT NULL DEFAULT false,
  strava_status text,
  strava_ref text,
  intervals_status text,
  intervals_ref text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS activities_user_idx ON activities (user_id, started_at);

CREATE TABLE IF NOT EXISTS segment_efforts (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  route_id text NOT NULL,
  segment_id text NOT NULL,
  elapsed_ms integer NOT NULL,
  ride_id text,
  ridden_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS segment_efforts_board_idx ON segment_efforts (route_id, segment_id, elapsed_ms);
CREATE INDEX IF NOT EXISTS segment_efforts_user_idx ON segment_efforts (user_id);

CREATE TABLE IF NOT EXISTS progression (
  user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  xp integer NOT NULL DEFAULT 0,
  rides integer NOT NULL DEFAULT 0,
  distance_m real NOT NULL DEFAULT 0,
  elevation_m real NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Intégrations tierces : secrets (jetons OAuth Strava, clé API intervals.icu) chiffrés
CREATE TABLE IF NOT EXISTS integrations (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider text NOT NULL,
  secret_enc bytea NOT NULL,
  meta jsonb NOT NULL DEFAULT '{}',
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, provider)
);

-- File de rendu vidéo (consommée par le conteneur renderer)
CREATE TABLE IF NOT EXISTS render_jobs (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'queued',
  composition text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}',
  output_file text,
  error text,
  attempts integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  finished_at timestamptz
);
CREATE INDEX IF NOT EXISTS render_jobs_status_idx ON render_jobs (status, created_at);
