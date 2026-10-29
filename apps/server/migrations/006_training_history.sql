-- Historique d'entraînement : mesures par sortie (NP, IF, TSS…), courbe de puissance, temps par zone,
-- historique des FTP, records de puissance et séances perso. Une sortie peut venir de la base locale
-- du jeu sans fichier FIT (synchronisation) : le FIT devient facultatif et `client_ride_id` rend
-- l'envoi idempotent (même sortie envoyée deux fois = une seule ligne, FIT ajouté plus tard).
-- Tout est lié à users avec ON DELETE CASCADE (droit à l'effacement) et exporté avec le compte.
ALTER TABLE activities ALTER COLUMN fit_enc DROP NOT NULL;
ALTER TABLE activities ALTER COLUMN fit_size DROP NOT NULL;
ALTER TABLE activities ADD COLUMN client_ride_id text;
ALTER TABLE activities ADD COLUMN source text NOT NULL DEFAULT 'upload';
ALTER TABLE activities ADD COLUMN kind text NOT NULL DEFAULT 'free';
ALTER TABLE activities ADD COLUMN workout_id text;
ALTER TABLE activities ADD COLUMN workout_name text;
ALTER TABLE activities ADD COLUMN training_type text;
ALTER TABLE activities ADD COLUMN utc_offset_min integer NOT NULL DEFAULT 0;
ALTER TABLE activities ADD COLUMN ftp_at_ride integer;
ALTER TABLE activities ADD COLUMN np real;
ALTER TABLE activities ADD COLUMN intensity real;
ALTER TABLE activities ADD COLUMN tss real;
ALTER TABLE activities ADD COLUMN work_kj real;
ALTER TABLE activities ADD COLUMN avg_cadence real;
ALTER TABLE activities ADD COLUMN avg_speed_kmh real;
ALTER TABLE activities ADD COLUMN feedback text;
ALTER TABLE activities ADD COLUMN aggregates_at timestamptz;
ALTER TABLE activities ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now();
CREATE UNIQUE INDEX IF NOT EXISTS activities_client_ride_idx ON activities (user_id, client_ride_id);
CREATE INDEX IF NOT EXISTS activities_user_started_idx ON activities (user_id, started_at);
CREATE INDEX IF NOT EXISTS activities_user_updated_idx ON activities (user_id, updated_at);

-- Meilleures moyennes de la sortie aux durées standard (≈ 13 lignes par sortie).
CREATE TABLE IF NOT EXISTS activity_power_curve (
  activity_id uuid NOT NULL REFERENCES activities(id) ON DELETE CASCADE,
  duration_s integer NOT NULL,
  watts real NOT NULL,
  PRIMARY KEY (activity_id, duration_s)
);

-- Secondes passées dans chaque zone de puissance (1 = Z1 … 7 = Z7).
CREATE TABLE IF NOT EXISTS activity_zone_time (
  activity_id uuid NOT NULL REFERENCES activities(id) ON DELETE CASCADE,
  zone integer NOT NULL CHECK (zone BETWEEN 1 AND 7),
  seconds integer NOT NULL,
  PRIMARY KEY (activity_id, zone)
);

-- Chaque changement de FTP, avec sa source. `client_id` : identifiant venu de la base locale.
CREATE TABLE IF NOT EXISTS ftp_history (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  client_id text,
  recorded_at timestamptz NOT NULL,
  ftp_watts integer NOT NULL CHECK (ftp_watts BETWEEN 30 AND 700),
  source text NOT NULL CHECK (source IN ('manual', 'ramp', '20min', 'estimate', 'import')),
  activity_id uuid REFERENCES activities(id) ON DELETE SET NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS ftp_history_client_idx ON ftp_history (user_id, client_id);
CREATE INDEX IF NOT EXISTS ftp_history_user_idx ON ftp_history (user_id, recorded_at);

-- Record de puissance par durée (le meilleur de toutes les sorties, ou importé des anciens records locaux).
CREATE TABLE IF NOT EXISTS power_records (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  duration_s integer NOT NULL,
  watts real NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  activity_id uuid REFERENCES activities(id) ON DELETE SET NULL,
  PRIMARY KEY (user_id, duration_s)
);

-- Séances du coureur (créées, importées .zwo/.erg/.mrc). `deleted` : suppression propagée aux autres appareils.
CREATE TABLE IF NOT EXISTS workouts (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  id text NOT NULL,
  name text NOT NULL,
  source text NOT NULL CHECK (source IN ('custom', 'zwo', 'erg', 'mrc')),
  type text,
  description text,
  steps jsonb NOT NULL,
  deleted boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, id)
);

-- Sorties supprimées (identifiant client) : la suppression se propage aux autres appareils.
CREATE TABLE IF NOT EXISTS deleted_rides (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  client_ride_id text NOT NULL,
  deleted_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, client_ride_id)
);
