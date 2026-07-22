// Pure helpers shared by the UI and the mock backend.
//
// The pub aggregate-rating formula is the Bayesian/IMDB weighted average from
// TASKS.md §4. It lives here (client-side) only so the mock backend and any
// optimistic UI can compute it identically to the real PubAggregatorDO; the
// authoritative value always comes from the API.

/** Minimum-ratings confidence constant m (TASKS.md §4). */
export const CONFIDENCE_M = 5;

/**
 * Bayesian weighted score (TASKS.md §4):
 *   weighted = (v / (v + m)) * R + (m / (v + m)) * C
 * where R = mean rating for the pub, v = number of ratings, C = global mean.
 * A pub with 1×5.0 stays near C; it only overtakes a 50×4.5 pub once it has
 * enough of its own ratings — which is the whole point of the formula.
 */
export function weightedScore(
  meanRating: number,
  ratingCount: number,
  globalMean: number,
  m: number = CONFIDENCE_M,
): number {
  const v = ratingCount;
  if (v <= 0) return globalMean;
  return (v / (v + m)) * meanRating + (m / (v + m)) * globalMean;
}

// ---- XP / levels --------------------------------------------------------

/** Cumulative XP required to *reach* a given level (L1 = 0). */
export function xpForLevel(level: number): number {
  return 50 * level * (level - 1); // L1:0 L2:100 L3:300 L4:600 L5:1000 ...
}

export function levelFromXp(xp: number): number {
  let level = 1;
  while (xpForLevel(level + 1) <= xp) level++;
  return level;
}

export interface LevelProgress {
  level: number;
  xpIntoLevel: number;
  xpForNext: number; // xp span between this level and the next
  pct: number; // 0..1 progress toward next level
}

export function levelProgress(xp: number): LevelProgress {
  const level = levelFromXp(xp);
  const base = xpForLevel(level);
  const next = xpForLevel(level + 1);
  const span = Math.max(1, next - base);
  const into = xp - base;
  return {
    level,
    xpIntoLevel: into,
    xpForNext: span,
    pct: Math.min(1, into / span),
  };
}

// ---- misc ---------------------------------------------------------------

/** Haversine distance in metres, for "pubs near me" sorting. */
export function distanceMeters(
  a: { lat: number; lon: number },
  b: { lat: number; lon: number },
): number {
  const R = 6371000;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLon = ((b.lon - a.lon) * Math.PI) / 180;
  const lat1 = (a.lat * Math.PI) / 180;
  const lat2 = (b.lat * Math.PI) / 180;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
