-- Empreinte SHA-256 du fichier FIT reçu (tel qu'envoyé), par compte : un même FIT renvoyé ne crée pas une
-- seconde sortie et ne redonne ni XP ni crédits, même sans `client_ride_id`. Nulle pour les sorties
-- existantes et pour celles synchronisées sans FIT (les valeurs nulles ne se gênent pas dans l'index).
ALTER TABLE activities ADD COLUMN fit_sha256 text;
CREATE UNIQUE INDEX IF NOT EXISTS activities_fit_sha_idx ON activities (user_id, fit_sha256);
