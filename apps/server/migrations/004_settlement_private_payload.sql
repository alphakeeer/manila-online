ALTER TABLE events ADD COLUMN private_payload jsonb;

CREATE INDEX events_room_revision_index ON events(room_id, revision DESC);
