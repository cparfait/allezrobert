-- Amis : code ami de chaque compte et relations d'amitié (demande en attente ou acceptée).
-- Comme le reste du schéma, tout dépend de users avec ON DELETE CASCADE (droit à l'effacement).
-- Les invitations à rouler et la présence restent en mémoire (voir src/friends/hub.ts) :
-- elles n'ont de sens que pendant la vie d'une sortie, elle-même en mémoire.

-- Code ami (court, lisible, régénérable) : créé à la première ouverture de l'onglet Amis.
CREATE TABLE IF NOT EXISTS friend_codes (
  user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  code text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Une ligne par paire de comptes, rangée (user_a < user_b) : une seule relation possible entre
-- deux personnes, quel que soit le sens de la demande. Refus et retrait suppriment la ligne.
CREATE TABLE IF NOT EXISTS friendships (
  id uuid PRIMARY KEY,
  user_a uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  user_b uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- auteur de la demande (user_a ou user_b)
  requested_by uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted')),
  created_at timestamptz NOT NULL DEFAULT now(),
  accepted_at timestamptz,
  CONSTRAINT friendships_pair_uniq UNIQUE (user_a, user_b),
  CONSTRAINT friendships_order_chk CHECK (user_a < user_b)
);
CREATE INDEX IF NOT EXISTS friendships_a_idx ON friendships (user_a, status);
CREATE INDEX IF NOT EXISTS friendships_b_idx ON friendships (user_b, status);
