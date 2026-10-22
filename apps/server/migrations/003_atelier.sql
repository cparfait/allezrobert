-- Atelier : crédits gagnés en roulant, pièces possédées (achetées ou gagnées), événements
-- débloqués, série de jours de sortie et cumuls qui servent aux récompenses. Tout est sur la
-- ligne de progression du compte (supprimée avec lui, ON DELETE CASCADE).
ALTER TABLE progression ADD COLUMN credits integer NOT NULL DEFAULT 0;
ALTER TABLE progression ADD COLUMN owned jsonb NOT NULL DEFAULT '[]';
ALTER TABLE progression ADD COLUMN events jsonb NOT NULL DEFAULT '[]';
ALTER TABLE progression ADD COLUMN streak_last text;
ALTER TABLE progression ADD COLUMN streak_days integer NOT NULL DEFAULT 0;
-- Parcours bouclés (identifiants distincts) et montées chronométrées bouclées en salle.
ALTER TABLE progression ADD COLUMN routes_done jsonb NOT NULL DEFAULT '[]';
ALTER TABLE progression ADD COLUMN koms integer NOT NULL DEFAULT 0;
