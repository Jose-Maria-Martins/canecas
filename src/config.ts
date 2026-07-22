// Runtime configuration for the map/frontend layer.
//
// The whole app runs against an in-app MOCK backend by default so it is fully
// demoable before Devs B/C/D ship the real API (TASKS.md §10). Flip to the real
// Worker API by setting VITE_API_MODE=real (see .env.example). This is the
// single "real-endpoint switch" the API strategy calls for.

type ApiMode = "mock" | "real";

const rawMode = (import.meta.env.VITE_API_MODE as string | undefined)?.toLowerCase();

export const API_MODE: ApiMode = rawMode === "real" ? "real" : "mock";

/** Cloudflare Turnstile site key (TASKS.md §2 abuse control). Falls back to the
 * official Turnstile "always passes" TEST key so the widget renders locally. */
export const TURNSTILE_SITE_KEY =
  (import.meta.env.VITE_TURNSTILE_SITE_KEY as string | undefined) ??
  "1x00000000000000000000AA";

/** Demo city center — Lisbon bar district (matches pubs.seed.json). */
export const MAP_CENTER: { lat: number; lon: number; zoom: number } = {
  lat: 38.7115,
  lon: -9.1445,
  zoom: 15,
};

/** City label shown top-left (sticker style). */
export const CITY = { name: "Lisbon", region: "PT" };

/** Buddy feed poll interval (TASKS.md §6: client polls every 4s). */
export const FEED_POLL_MS = 4000;

/** Pub-score polling fallback if the WebSocket drops (TASKS.md §11: every 5s). */
export const SCORE_POLL_MS = 5000;

export const IS_MOCK = API_MODE === "mock";
