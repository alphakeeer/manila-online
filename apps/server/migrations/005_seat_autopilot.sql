-- Seat takeover: NULL = the player controls the seat; 'away' = server bot after disconnect/logout
-- (released automatically when the player returns); 'manual' = the player asked the bot to play.
ALTER TABLE room_members ADD COLUMN autopilot text CHECK (autopilot IN ('away', 'manual'));
