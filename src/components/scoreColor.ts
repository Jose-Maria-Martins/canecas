import type { Pub } from "../types";

/** Map a 0–5 weighted score to a hue for fallback pin gradients. */
export function scoreColor(score: number): string {
  const t = Math.max(0, Math.min(1, score / 5));
  const hue = 8 + t * 37; // red → gold
  return `hsl(${hue.toFixed(0)} 82% 52%)`;
}

/** Two-stop gradient for a pin's emoji fallback, keyed off score. */
export function pinGradient(score: number): [string, string] {
  const t = Math.max(0, Math.min(1, score / 5));
  const h = 8 + t * 37;
  return [`hsl(${h.toFixed(0)} 85% 58%)`, `hsl(${(h - 8).toFixed(0)} 80% 42%)`];
}

export function stars(score: number): string {
  const full = Math.round(score);
  return "★★★★★".slice(0, full) + "☆☆☆☆☆".slice(0, 5 - full);
}

/** Emoji for a pin fallback, derived from the OSM tags. */
export function categoryEmoji(pub: Pub): string {
  const raw = pub.osm_raw ?? {};
  if (raw.microbrewery === "yes" || raw.cuisine === "craft_beer") return "🍺";
  if (raw["drink:wine"] === "yes") return "🍷";
  if (raw.amenity === "bar") return "🍸";
  return "🍺";
}

/**
 * Deterministic demo "photo" for a pub (looks like the reference photo-map).
 * Seeded so each pub keeps the same image; falls back to an emoji tile offline.
 */
export function pubPhoto(pub: Pub): string {
  const seed = pub.id.replace(/\W+/g, "");
  return `https://picsum.photos/seed/caneca${seed}/240/240`;
}

export function timeAgo(ts: number): string {
  const s = Math.max(1, Math.floor((Date.now() - ts) / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}
