-- Meilleur tour d'un coureur sur un itinéraire (fantôme visible par ses amis).
-- Seulement la distance parcourue chaque seconde depuis le début du tour : ni GPS, ni FC, ni puissance.
-- Lié à users avec ON DELETE CASCADE (droit à l'effacement), exporté avec les données du compte.
CREATE TABLE IF NOT EXISTS ghost_laps (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  route_id text NOT NULL,
  lap_time_ms integer NOT NULL CHECK (lap_time_ms > 0),
  dist jsonb NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, route_id)
);
