// Server-side types for the Caneca Worker. The public API shapes deliberately
// mirror src/types.ts (the frontend contract); duplicated here so the Worker
// build has zero dependency on the Vite src/ tree.

export interface Env {
  // static assets (built SPA)
  ASSETS: Fetcher;

  // data stores
  DB: D1Database;
  SESSIONS: KVNamespace;
  GLOBAL_CACHE: KVNamespace;
  BEER_PHOTOS: R2Bucket;

  // async + AI
  PHOTO_INFER: Queue<PhotoJob>;
  AI: Ai;

  // durable objects
  PUB_AGGREGATOR: DurableObjectNamespace;
  DEMO_SIMULATOR: DurableObjectNamespace;

  // email (magic link)
  EMAIL: SendEmail;

  // vars
  APP_ORIGIN: string;
  AI_OFF: string; // "1" => stub ratings
  DEV_AUTH: string; // "1" => allow ?devEmail bypass (never in prod)
  TURNSTILE_SITE_KEY: string;

  // secrets (wrangler secret put)
  TURNSTILE_SECRET?: string;
  SESSION_HMAC_KEY?: string;
  ADMIN_SECRET?: string;
}

/** Minimal shape of Cloudflare's send_email binding. */
export interface SendEmail {
  send(message: unknown): Promise<void>;
}

export interface PhotoJob {
  submissionId: string;
  r2Key: string;
  userId: string;
  pubId: string;
  promptId: string | null;
}

// ---- API row/response shapes (mirror src/types.ts) ----------------------

export interface PubRow {
  id: string;
  name: string;
  lat: number;
  lon: number;
  address: string;
  osm_raw: string | null;
}

export interface PubScore {
  pub_id: string;
  avg_rating: number;
  weighted_score: number;
  rating_count: number;
}

export interface UserRow {
  id: string;
  email: string;
  display_name: string;
  xp: number;
  level: number;
}

export interface SessionUser {
  id: string;
  email: string;
  display_name: string;
  xp: number;
  level: number;
}
