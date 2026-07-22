-- Gamification slice, Round 2 revision (TASKS.md "Sub-goal: Gamification slice
-- detail design"). Additive only: ALTER...ADD COLUMN + CREATE TABLE IF NOT
-- EXISTS, no drops. Builds on the buddies/challenges tables from 0001_init.sql.

-- buddies: needed by the buddy_added challenge/badge evaluator's date-range filter.
ALTER TABLE buddies ADD COLUMN accepted_at INTEGER;

-- challenges: generic criteria for the hardcoded switch(criteria_type) evaluator
-- (Round 1 rejected a fully-dynamic query engine as too slow to build in time).
ALTER TABLE challenges ADD COLUMN criteria_type TEXT
  CHECK (criteria_type IS NULL OR criteria_type IN (
    'submission_count', 'distinct_pubs', 'perfect_rating',
    'first_pub_contributor', 'beerreal_response', 'buddy_added'
  ));
ALTER TABLE challenges ADD COLUMN target_count INTEGER DEFAULT 1;
ALTER TABLE challenges ADD COLUMN meta TEXT; -- JSON, criteria-specific extras

-- buddy invites: shareable link/code. recipient_id starts NULL; the accept
-- handler's `WHERE recipient_id IS NULL` guard makes consumption exactly-once.
CREATE TABLE IF NOT EXISTS buddy_invites (
  code         TEXT PRIMARY KEY,
  inviter_id   TEXT NOT NULL REFERENCES users(id),
  recipient_id TEXT REFERENCES users(id),
  created_at   INTEGER NOT NULL,
  accepted_at  INTEGER
);
CREATE INDEX IF NOT EXISTS idx_buddy_invites_inviter ON buddy_invites(inviter_id);

-- badges: same generic evaluator/criteria shape as challenges, but one-time
-- rather than time-windowed.
CREATE TABLE IF NOT EXISTS badges (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  description   TEXT NOT NULL,
  criteria_type TEXT NOT NULL,
  target_count  INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS user_badges (
  user_id    TEXT NOT NULL REFERENCES users(id),
  badge_id   TEXT NOT NULL REFERENCES badges(id),
  awarded_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, badge_id)
);

-- first-ever-rating-on-this-pub bonus: PK uniqueness on pub_id makes the award
-- exactly-once even if two submissions for a brand-new pub finish concurrently.
CREATE TABLE IF NOT EXISTS pub_first_contributors (
  pub_id     TEXT PRIMARY KEY REFERENCES pubs(id),
  user_id    TEXT NOT NULL REFERENCES users(id),
  awarded_at INTEGER NOT NULL
);

-- wire the existing "Rate your first beer today" daily challenge (0001_init.sql)
-- to the submission_count evaluator instead of adding a duplicate row.
UPDATE challenges SET criteria_type = 'submission_count', target_count = 1
  WHERE id = 'chl_daily_first';

-- starter badge set (stretch item; only first_beer is wired to the evaluator today).
INSERT OR IGNORE INTO badges (id, name, description, criteria_type, target_count) VALUES
  ('first_beer', 'First Beer', 'Submit your first rated beer photo', 'submission_count', 1);
