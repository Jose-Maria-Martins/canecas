// Shared frontend types. These mirror the API sketch + D1 schema in TASKS.md
// (§3 schema, §5 AI pipeline, §6 real-time, §7 auth). The map/frontend layer
// (Dev A) owns these client-side shapes; Devs B/C/D own the server side.

/** A pub, seeded once from OSM Overpass (TASKS.md §3 `pubs`). */
export interface Pub {
  id: string; // osm_id, e.g. "node/1001"
  name: string;
  lat: number;
  lon: number;
  address: string;
  osm_raw?: Record<string, string>;
  featured?: "cloudflare";
}

/** Materialized pub score (TASKS.md §3 `pub_scores`, §4 formula). */
export interface PubScore {
  pub_id: string;
  avg_rating: number; // R — plain mean of AI ratings
  weighted_score: number; // Bayesian/IMDB weighted score (§4)
  rating_count: number; // v — number of submitted photos
}

export type PubWithScore = Pub & { score: PubScore };

/** Authenticated user (TASKS.md §3 `users`). */
export interface User {
  id: string;
  email: string;
  display_name: string;
  xp: number;
  level: number;
}

/** A beer-photo submission (TASKS.md §3 `submissions`). */
export interface Submission {
  id: string;
  user_id: string;
  pub_id: string;
  photo_url: string; // short-TTL signed R2 URL
  rating: number | null; // null while AI inference is pending (§5)
  created_at: number;
}

/** Result of POST /api/photos — 202 accepted, AI runs async (§5). */
export interface PhotoAccepted {
  submission_id: string;
  status: "pending";
}

export type ActivityType =
  | "submission"
  | "level_up"
  | "check_in"
  | "challenge_complete"
  | "beerreal";

/**
 * Buddy/social feed row (TASKS.md §3 `activities`, §6 polled feed).
 * `demo` is server-set only and never client-writable; the UI badges any
 * `demo === true` row as simulated (§6 DemoSimulatorDO).
 */
export interface Activity {
  id: string;
  user_id: string; // real user id, or a `demo_`-prefixed synthetic id
  display_name: string;
  type: ActivityType;
  target_id: string | null; // e.g. pub id for a submission/check-in
  target_name?: string | null;
  ts: number;
  demo: boolean;
}

export interface FeedResponse {
  activities: Activity[];
  now: number; // server clock, feed back into ?since= on the next poll
}

/** Leaderboard entry (derived from users.xp). */
export interface LeaderboardEntry {
  user_id: string;
  display_name: string;
  xp: number;
  level: number;
  rank: number;
  is_me?: boolean;
}

/** Challenge (TASKS.md §3 `challenges`). */
export interface Challenge {
  id: string;
  type: "daily" | "weekly";
  title: string;
  xp: number;
  starts_at: number;
  ends_at: number;
  completed: boolean;
}

/** BeerReal prompt (TASKS.md §8). */
export interface BeerRealPrompt {
  id: string;
  prompt: string;
  created_at: number;
  window_ends_at: number; // short response window
  responded: boolean;
}

/** Message pushed over /ws/pub/:pubId (TASKS.md §5.3, §6). */
export interface PubScoreMessage {
  t: "pubScore";
  pubId: string;
  score: PubScore;
}
