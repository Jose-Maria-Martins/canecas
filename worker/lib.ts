// Small server utilities: ULID, JSON responses, cookies, session lookup,
// Turnstile verification, and the shared scoring/XP math (server copy of
// src/api/scoring.ts so the DO computes identical numbers — TASKS.md §4).

import type { Env, SessionUser } from "./types";

// ---- ULID (monotonic-ish, good enough for keys) -------------------------
const ENC = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"; // Crockford base32
export function ulid(now: number = Date.now()): string {
  let ts = "";
  let t = now;
  for (let i = 0; i < 10; i++) {
    ts = ENC[t % 32] + ts;
    t = Math.floor(t / 32);
  }
  const rnd = crypto.getRandomValues(new Uint8Array(16));
  let r = "";
  for (let i = 0; i < 16; i++) r += ENC[rnd[i] % 32];
  return ts + r;
}

// ---- JSON helpers -------------------------------------------------------
export function json(data: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: { "content-type": "application/json; charset=utf-8", ...(init.headers ?? {}) },
  });
}
export function error(code: string, message: string, status = 400): Response {
  return json({ error: code, message }, { status });
}

// ---- cookies ------------------------------------------------------------
export const SESSION_COOKIE = "caneca_sess";

export function parseCookies(req: Request): Record<string, string> {
  const out: Record<string, string> = {};
  const header = req.headers.get("cookie");
  if (!header) return out;
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx < 0) continue;
    out[part.slice(0, idx).trim()] = decodeURIComponent(part.slice(idx + 1).trim());
  }
  return out;
}

export function sessionCookie(token: string, maxAgeSec = 86400): string {
  return `${SESSION_COOKIE}=${token}; Max-Age=${maxAgeSec}; Path=/; Secure; HttpOnly; SameSite=Lax`;
}
export function clearSessionCookie(): string {
  return `${SESSION_COOKIE}=; Max-Age=0; Path=/; Secure; HttpOnly; SameSite=Lax`;
}

// ---- session ------------------------------------------------------------
/** Resolve the signed-in user from the session cookie (KV → D1). */
export async function getSessionUser(req: Request, env: Env): Promise<SessionUser | null> {
  const token = parseCookies(req)[SESSION_COOKIE];
  if (!token) return null;
  const userId = await env.SESSIONS.get(`sess:${token}`);
  if (!userId) return null;
  const row = await env.DB.prepare(
    "SELECT id, email, display_name, xp, level FROM users WHERE id = ?",
  )
    .bind(userId)
    .first<SessionUser>();
  return row ?? null;
}

export async function createSession(env: Env, userId: string): Promise<string> {
  const token = ulid();
  await env.SESSIONS.put(`sess:${token}`, userId, { expirationTtl: 86400 });
  return token;
}

// ---- Turnstile ----------------------------------------------------------
/**
 * Verify a Turnstile token. In local/dev (no secret configured, or the
 * offline mock token) this passes so the demo works without the CF edge.
 */
export async function verifyTurnstile(env: Env, token: string | undefined, ip: string | null): Promise<boolean> {
  if (!token) return false;
  if (!env.TURNSTILE_SECRET) return true; // dev: no secret wired => accept
  if (token === "mock-turnstile-ok") return true; // offline demo fallback
  const body = new FormData();
  body.set("secret", env.TURNSTILE_SECRET);
  body.set("response", token);
  if (ip) body.set("remoteip", ip);
  try {
    const res = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      body,
    });
    const out = (await res.json()) as { success: boolean };
    return out.success === true;
  } catch {
    return false;
  }
}

// ---- scoring / xp (server copy of src/api/scoring.ts) -------------------
export const CONFIDENCE_M = 5;

export function weightedScore(meanRating: number, ratingCount: number, globalMean: number, m = CONFIDENCE_M): number {
  const v = ratingCount;
  if (v <= 0) return globalMean;
  return (v / (v + m)) * meanRating + (m / (v + m)) * globalMean;
}

export function xpForLevel(level: number): number {
  return 50 * level * (level - 1);
}
export function levelFromXp(xp: number): number {
  let level = 1;
  while (xpForLevel(level + 1) <= xp) level++;
  return level;
}

/** Add XP to a user, recompute level, persist; returns the new totals. */
export async function grantXp(env: Env, userId: string, amount: number): Promise<{ xp: number; level: number; leveledUp: boolean }> {
  const row = await env.DB.prepare("SELECT xp, level FROM users WHERE id = ?").bind(userId).first<{ xp: number; level: number }>();
  const prevLevel = row?.level ?? 1;
  const xp = (row?.xp ?? 0) + amount;
  const level = levelFromXp(xp);
  await env.DB.prepare("UPDATE users SET xp = ?, level = ? WHERE id = ?").bind(xp, level, userId).run();
  return { xp, level, leveledUp: level > prevLevel };
}

export function clientIp(req: Request): string | null {
  return req.headers.get("cf-connecting-ip") ?? req.headers.get("x-forwarded-for");
}
