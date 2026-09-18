CREATE TABLE access_tokens (
  id text PRIMARY KEY,
  token_digest char(64) NOT NULL UNIQUE,
  label text,
  created_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz
);

CREATE TABLE sessions (
  id text PRIMARY KEY,
  credential_digest char(64) NOT NULL UNIQUE,
  token_id text NOT NULL REFERENCES access_tokens(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  last_seen_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX sessions_active_credential_idx ON sessions (credential_digest) WHERE revoked_at IS NULL;
