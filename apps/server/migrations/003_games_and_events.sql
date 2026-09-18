ALTER TABLE rooms DROP CONSTRAINT rooms_status_check;
ALTER TABLE rooms ADD CONSTRAINT rooms_status_check CHECK (status IN ('lobby', 'playing', 'finished', 'isolated', 'closed'));
ALTER TABLE rooms ADD COLUMN isolation_reason text;

CREATE TABLE games (
  room_id text PRIMARY KEY REFERENCES rooms(id),
  snapshot jsonb NOT NULL,
  seed bigint NOT NULL CHECK (seed BETWEEN 0 AND 4294967295),
  state_version integer NOT NULL,
  rules_version integer NOT NULL,
  protocol_version integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE events (
  id bigserial PRIMARY KEY,
  room_id text NOT NULL REFERENCES rooms(id),
  revision integer NOT NULL,
  event_type text NOT NULL,
  public_payload jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (room_id, revision, event_type)
);

ALTER TABLE commands ADD COLUMN accepted_revision integer;
