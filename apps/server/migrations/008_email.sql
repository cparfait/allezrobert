-- Adresse e-mail chiffrée (AES-256-GCM, même clé que les autres données sensibles), renseignée à chaque connexion.
-- Sert à l'administration (liste des inscrits) ; l'empreinte email_hash continue d'identifier les comptes.
ALTER TABLE users ADD COLUMN email_enc bytea;
