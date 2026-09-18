CREATE TABLE rooms (
  id text PRIMARY KEY,
  code char(8) NOT NULL UNIQUE,
  status text NOT NULL CHECK (status IN ('lobby', 'closed')) DEFAULT 'lobby',
  pirate_variant text NOT NULL CHECK (pirate_variant IN ('standard', 'strengthened')) DEFAULT 'standard',
  revision integer NOT NULL DEFAULT 0 CHECK (revision >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  closed_at timestamptz
);

ALTER TABLE sessions ADD COLUMN active_room_id text REFERENCES rooms(id);

CREATE TABLE room_members (
  room_id text NOT NULL REFERENCES rooms(id),
  session_id text NOT NULL REFERENCES sessions(id),
  player_id text NOT NULL,
  nickname text NOT NULL,
  seat smallint NOT NULL CHECK (seat BETWEEN 1 AND 5),
  is_ready boolean NOT NULL DEFAULT false,
  joined_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (room_id, session_id),
  UNIQUE (room_id, player_id),
  UNIQUE (room_id, seat)
);

CREATE INDEX room_members_session_idx ON room_members (session_id);

CREATE TABLE commands (
  id bigserial PRIMARY KEY,
  room_id text REFERENCES rooms(id),
  session_id text NOT NULL REFERENCES sessions(id),
  scope_key text NOT NULL,
  command_id text NOT NULL,
  request_digest char(64) NOT NULL,
  accepted boolean NOT NULL,
  result jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (scope_key, session_id, command_id)
);
