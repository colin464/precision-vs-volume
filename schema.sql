-- Precision vs. Volume — conference lead capture and high scores.

CREATE TABLE IF NOT EXISTS players (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  email       TEXT NOT NULL UNIQUE,
  player_name TEXT NOT NULL,          -- what shows on the board
  full_name   TEXT,
  company     TEXT,
  token       TEXT NOT NULL UNIQUE,   -- how a returning phone is recognised
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS scores (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  player_id     INTEGER NOT NULL REFERENCES players(id),
  side          TEXT NOT NULL,        -- 'precision' | 'volume'
  score         INTEGER NOT NULL,
  seconds       REAL,
  won           INTEGER NOT NULL DEFAULT 0,
  invaders_left INTEGER,
  shots_fired   INTEGER,
  shots_hit     INTEGER,
  shots_blocked INTEGER,
  created_at    TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_scores_score ON scores(score DESC);
CREATE INDEX IF NOT EXISTS idx_players_token ON players(token);
