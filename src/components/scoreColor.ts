import type { Pub } from "../types";

const DEMO_PHOTOS = [
  "https://images.unsplash.com/photo-1608270586620-248524c67de9?auto=format&fit=crop&w=480&h=480&q=80",
  "https://images.unsplash.com/photo-1575361204480-aadea25e6e68?auto=format&fit=crop&w=480&h=480&q=80",
  "https://images.unsplash.com/photo-1518099074172-2e47ee6cfdc0?auto=format&fit=crop&w=480&h=480&q=80",
  "https://images.unsplash.com/photo-1535958636474-b021ee887b13?auto=format&fit=crop&w=480&h=480&q=80",
  "https://images.unsplash.com/photo-1566633806327-68e152aaf26d?auto=format&fit=crop&w=480&h=480&q=80",
  "https://images.unsplash.com/photo-1436076863939-06870fe779c2?auto=format&fit=crop&w=480&h=480&q=80",
  "https://images.unsplash.com/photo-1505075106905-fb052892c116?auto=format&fit=crop&w=480&h=480&q=80",
  "https://images.unsplash.com/photo-1567696911980-2eed69a46042?auto=format&fit=crop&w=480&h=480&q=80",
  "https://images.unsplash.com/photo-1571613316887-6f8d5cbf7ef7?auto=format&fit=crop&w=480&h=480&q=80",
  "https://images.unsplash.com/photo-1584225064785-c62a8b43d148?auto=format&fit=crop&w=480&h=480&q=80",
];

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

/** A stable photo for each demo pub; pins fall back to an emoji tile offline. */
export function pubPhoto(pub: Pub): string {
  let hash = 0;
  for (const char of pub.id) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return DEMO_PHOTOS[hash % DEMO_PHOTOS.length];
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
