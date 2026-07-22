-- Caneca — D1 schema (TASKS.md §3) + one-time seed (pubs from OSM Overpass
-- pre-pull, plus starter challenges). Sessions live in KV, not here.

-- users -------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
  id           TEXT PRIMARY KEY,          -- ULID
  email        TEXT UNIQUE NOT NULL,
  display_name TEXT NOT NULL,
  created_at   INTEGER NOT NULL,          -- epoch ms
  xp           INTEGER NOT NULL DEFAULT 0,
  level        INTEGER NOT NULL DEFAULT 1
);

-- pubs (seeded once, never live-fetched during the demo) ------------------
CREATE TABLE IF NOT EXISTS pubs (
  id         TEXT PRIMARY KEY,            -- osm_id, e.g. node/1001
  name       TEXT NOT NULL,
  lat        REAL NOT NULL,
  lon        REAL NOT NULL,
  address    TEXT,
  osm_raw    TEXT,                        -- JSON
  created_at INTEGER NOT NULL
);

-- submissions -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS submissions (
  id         TEXT PRIMARY KEY,            -- ULID
  user_id    TEXT NOT NULL REFERENCES users(id),
  pub_id     TEXT NOT NULL REFERENCES pubs(id),
  photo_url  TEXT NOT NULL,               -- R2 key
  rating     REAL,                        -- NULL until AI rates (0-5, AI-set only)
  prompt_id  TEXT,                        -- set when fulfilling a BeerReal
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_submissions_pub ON submissions(pub_id);
CREATE INDEX IF NOT EXISTS idx_submissions_user ON submissions(user_id);

-- materialized pub scores (owned by PubAggregatorDO) ----------------------
CREATE TABLE IF NOT EXISTS pub_scores (
  pub_id         TEXT PRIMARY KEY REFERENCES pubs(id),
  avg_rating     REAL NOT NULL DEFAULT 0,
  weighted_score REAL NOT NULL DEFAULT 0,
  rating_count   INTEGER NOT NULL DEFAULT 0
);

-- buddies (mutual consent: only buddy_id may accept) ----------------------
CREATE TABLE IF NOT EXISTS buddies (
  user_id  TEXT NOT NULL REFERENCES users(id),
  buddy_id TEXT NOT NULL REFERENCES users(id),
  status   TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','accepted')),
  PRIMARY KEY (user_id, buddy_id)
);

-- challenges --------------------------------------------------------------
CREATE TABLE IF NOT EXISTS challenges (
  id        TEXT PRIMARY KEY,
  type      TEXT NOT NULL CHECK(type IN ('daily','weekly')),
  title     TEXT NOT NULL,
  xp        INTEGER NOT NULL,
  starts_at INTEGER NOT NULL,
  ends_at   INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS challenge_completions (
  challenge_id TEXT NOT NULL REFERENCES challenges(id),
  user_id      TEXT NOT NULL REFERENCES users(id),
  completed_at INTEGER NOT NULL,
  PRIMARY KEY (challenge_id, user_id)
);

-- BeerReal ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS beerreal_prompts (
  id              TEXT PRIMARY KEY,
  prompt          TEXT NOT NULL,
  created_at      INTEGER NOT NULL,
  window_ends_at  INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS beerreal_responses (
  id            TEXT PRIMARY KEY,
  prompt_id     TEXT NOT NULL REFERENCES beerreal_prompts(id),
  user_id       TEXT NOT NULL REFERENCES users(id),
  submission_id TEXT NOT NULL REFERENCES submissions(id),
  created_at    INTEGER NOT NULL
);

-- activities (backs the polled buddy feed; demo=1 => synthetic demo_ user) -
CREATE TABLE IF NOT EXISTS activities (
  id           TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL,
  display_name TEXT NOT NULL,            -- denormalized (also carries demo names)
  type         TEXT NOT NULL,
  target_id    TEXT,
  target_name  TEXT,
  ts           INTEGER NOT NULL,
  demo         INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_activities_ts ON activities(ts);

-- seed: pubs --------------------------------------------------------------
INSERT OR IGNORE INTO pubs (id, name, lat, lon, address, osm_raw, created_at) VALUES
  ('node/1001', 'Pensão Amor', 38.70722, -9.14562, 'R. do Alecrim 19, Cais do Sodré', '{"amenity":"bar","name":"Pensão Amor","addr:street":"Rua do Alecrim"}', 1753000000000),
  ('node/1002', 'Pistola y Corazón', 38.70801, -9.14631, 'R. da Boavista 16, Cais do Sodré', '{"amenity":"bar","name":"Pistola y Corazón"}', 1753000000000),
  ('node/1003', 'O Bom O Mau e O Vilão', 38.70766, -9.14498, 'R. do Alecrim 21, Cais do Sodré', '{"amenity":"bar","name":"O Bom O Mau e O Vilão"}', 1753000000000),
  ('node/1004', 'Sol e Pesca', 38.70744, -9.14607, 'R. Nova do Carvalho 44, Cais do Sodré', '{"amenity":"bar","name":"Sol e Pesca"}', 1753000000000),
  ('node/1005', 'Musicbox Lisboa', 38.70712, -9.14555, 'R. Nova do Carvalho 24, Cais do Sodré', '{"amenity":"bar","name":"Musicbox","live_music":"yes"}', 1753000000000),
  ('node/1006', 'Bicaense', 38.70998, -9.14712, 'R. da Bica de Duarte Belo 42A, Bica', '{"amenity":"bar","name":"Bicaense"}', 1753000000000),
  ('node/1007', 'Park Bar', 38.71046, -9.14803, 'Calç. do Combro 58 (rooftop), Bairro Alto', '{"amenity":"bar","name":"Park","rooftop":"yes"}', 1753000000000),
  ('node/1008', 'The George — English Pub', 38.71123, -9.14456, 'R. do Norte 92, Bairro Alto', '{"amenity":"pub","name":"The George","cuisine":"british"}', 1753000000000),
  ('node/1009', 'BA Wine Bar do Bairro Alto', 38.71201, -9.14512, 'R. da Rosa 107, Bairro Alto', '{"amenity":"bar","name":"BA Wine Bar","drink:wine":"yes"}', 1753000000000),
  ('node/1010', 'Artis — Bar de Vinhos', 38.71165, -9.14603, 'R. do Diário de Notícias 95, Bairro Alto', '{"amenity":"bar","name":"Artis"}', 1753000000000),
  ('node/1011', 'Cervejaria Trindade', 38.71089, -9.14201, 'R. Nova da Trindade 20C, Chiado', '{"amenity":"pub","name":"Cervejaria Trindade","microbrewery":"no"}', 1753000000000),
  ('node/1012', 'Duque Brewpub', 38.71012, -9.14098, 'Calç. do Duque 49, Chiado', '{"amenity":"pub","name":"Duque Brewpub","microbrewery":"yes"}', 1753000000000),
  ('node/1013', 'Quimera Brewpub', 38.70689, -9.15012, 'R. Prior do Crato 6, Alcântara', '{"amenity":"pub","name":"Quimera Brewpub","microbrewery":"yes"}', 1753000000000),
  ('node/1014', 'Crafty Corner', 38.71322, -9.14367, 'R. da Misericórdia 14, Príncipe Real', '{"amenity":"pub","name":"Crafty Corner","cuisine":"craft_beer"}', 1753000000000);

-- seed: empty pub_scores rows so every pin has a baseline ------------------
INSERT OR IGNORE INTO pub_scores (pub_id, avg_rating, weighted_score, rating_count)
  SELECT id, 0, 0, 0 FROM pubs;

-- seed: starter challenges (open-ended windows for the demo) ---------------
INSERT OR IGNORE INTO challenges (id, type, title, xp, starts_at, ends_at) VALUES
  ('chl_daily_first',   'daily',  'Rate your first beer today', 30, 0, 4102444800000),
  ('chl_daily_three',   'daily',  'Visit 3 different pubs',      60, 0, 4102444800000),
  ('chl_weekly_crawl',  'weekly', 'Complete a 5-pub crawl',     150, 0, 4102444800000),
  ('chl_weekly_variety','weekly', 'Rate a bar, a pub and a brewpub', 120, 0, 4102444800000);
