-- Plateformes utilisées par chaque compte (web, Windows, macOS), pour la répartition dans l'administration.
CREATE TABLE IF NOT EXISTS user_platforms (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  platform text NOT NULL,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, platform)
);
CREATE INDEX IF NOT EXISTS user_platforms_platform_idx ON user_platforms (platform, last_seen_at);
