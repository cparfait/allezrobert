-- Efforts d'une sortie : le contrôle de doublon (`POST /api/efforts`) et le retrait d'une sortie
-- cherchent par (compte, sortie) ; seul l'index par compte existait.
CREATE INDEX IF NOT EXISTS segment_efforts_user_ride_idx ON segment_efforts (user_id, ride_id);

-- `activities_user_idx` (001) et `activities_user_started_idx` (006) portent sur les mêmes colonnes
-- (user_id, started_at) : un seul suffit.
DROP INDEX IF EXISTS activities_user_idx;
