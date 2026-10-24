-- Temps sur un parcours entier (du départ à l'arrivée, ou un tour complet d'une boucle), envoyés
-- après une sortie solo ; classements « tous » et « amis » comme pour les segments.
-- Lié à users avec ON DELETE CASCADE (droit à l'effacement), exporté avec les données du compte.
CREATE TABLE IF NOT EXISTS route_times (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  route_id text NOT NULL,
  elapsed_ms integer NOT NULL CHECK (elapsed_ms > 0),
  ride_id text,
  ridden_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS route_times_board_idx ON route_times (route_id, elapsed_ms);
CREATE INDEX IF NOT EXISTS route_times_user_idx ON route_times (user_id);
