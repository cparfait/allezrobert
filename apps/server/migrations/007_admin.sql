-- Administration : comptes suspendus (sessions refusées tant que disabled_at est renseigné).
ALTER TABLE users ADD COLUMN disabled_at timestamptz;
