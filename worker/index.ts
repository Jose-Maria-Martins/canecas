// Caneca Worker — single project serving the SPA (static assets) + the API,
// the photo→AI queue consumer, and the cron jobs. TASKS.md §1/§5/§7/§8/§9.

import { Hono } from "hono";
import type { Env, PhotoJob } from "./types";
import {
  ulid,
  json,
  error,
  getSessionUser,
  createSession,
  sessionCookie,
  clearSessionCookie,
  verifyTurnstile,
  grantXp,
  clientIp,
} from "./lib";
import { PubAggregatorDO } from "./pub-aggregator";
import { DemoSimulatorDO } from "./demo-simulator";

export { PubAggregatorDO, DemoSimulatorDO };

const AI_MODEL = "@cf/llava-hf/llava-1.5-7b-hf";
const RATE_PROMPT =
  "Look at this photo. If there is no beer (glass, mug, can, or bottle) visible, respond with exactly -1. Otherwise, rate how appealing the beer looks from 0 (awful) to 5 (amazing). Respond with ONLY a number.";

const app = new Hono<{ Bindings: Env }>();

// ---- helpers ------------------------------------------------------------
function pubAggregator(env: Env, pubId: string): DurableObjectStub {
  return env.PUB_AGGREGATOR.get(env.PUB_AGGREGATOR.idFromName(pubId));
}

async function writeActivity(
  env: Env,
  a: { userId: string; displayName: string; type: string; targetId?: string | null; targetName?: string | null },
): Promise<void> {
  const now = Date.now();
  await env.DB.prepare(
    `INSERT INTO activities (id, user_id, display_name, type, target_id, target_name, ts, demo)
     VALUES (?, ?, ?, ?, ?, ?, ?, 0)`,
  )
    .bind(ulid(now), a.userId, a.displayName, a.type, a.targetId ?? null, a.targetName ?? null, now)
    .run();
}

// ---- auth ---------------------------------------------------------------
app.post("/api/auth/magic-link", async (c) => {
  const { email, turnstileToken } = await c.req
    .json<{ email?: string; turnstileToken?: string }>()
    .catch(() => ({}) as { email?: string; turnstileToken?: string });
  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return error("BadEmail", "Enter a valid email", 400);
  if (!(await verifyTurnstile(c.env, turnstileToken, clientIp(c.req.raw)))) {
    return error("TurnstileFailed", "Verification failed", 403);
  }
  // rate limit: 3 / 10min / IP
  const ip = clientIp(c.req.raw) ?? "unknown";
  const rlKey = `ml_rl:${ip}`;
  const count = parseInt((await c.env.GLOBAL_CACHE.get(rlKey)) ?? "0", 10);
  if (count >= 3) return error("RateLimited", "Too many requests, try again later", 429);
  await c.env.GLOBAL_CACHE.put(rlKey, String(count + 1), { expirationTtl: 600 });

  const token = ulid();
  await c.env.SESSIONS.put(`ml:${token}`, email, { expirationTtl: 900 });
  const link = `${c.env.APP_ORIGIN}/?token=${encodeURIComponent(token)}`;
  await sendMagicLink(c.env, email, link);
  return json({ ok: true });
});

app.get("/api/auth/verify", async (c) => {
  const token = c.req.query("token");
  if (!token) return error("BadToken", "Missing token", 400);
  const key = `ml:${token}`;
  const email = await c.env.SESSIONS.get(key);
  if (!email) return error("BadToken", "That link is invalid or expired", 400);
  await c.env.SESSIONS.delete(key); // single-use

  let user = await c.env.DB.prepare("SELECT id, email, display_name, xp, level FROM users WHERE email = ?")
    .bind(email)
    .first<{ id: string; email: string; display_name: string; xp: number; level: number }>();
  if (!user) {
    const id = ulid();
    const displayName = email.split("@")[0].replace(/[^a-zA-Z0-9]+/g, " ").trim() || "Drinker";
    await c.env.DB.prepare(
      "INSERT INTO users (id, email, display_name, created_at, xp, level) VALUES (?, ?, ?, ?, 0, 1)",
    )
      .bind(id, email, displayName, Date.now())
      .run();
    user = { id, email, display_name: displayName, xp: 0, level: 1 };
  }
  const sess = await createSession(c.env, user.id);
  return json(user, { headers: { "set-cookie": sessionCookie(sess) } });
});

app.get("/api/auth/session", async (c) => {
  const user = await getSessionUser(c.req.raw, c.env);
  if (!user) return error("Unauthorized", "Not signed in", 401);
  return json(user);
});

app.post("/api/auth/logout", async (c) => {
  const token = (c.req.header("cookie") ?? "").match(/caneca_sess=([^;]+)/)?.[1];
  if (token) await c.env.SESSIONS.delete(`sess:${token}`);
  return json({ ok: true }, { headers: { "set-cookie": clearSessionCookie() } });
});

// ---- pubs ---------------------------------------------------------------
app.get("/api/pubs", async (c) => {
  const { results } = await c.env.DB.prepare("SELECT id, name, lat, lon, address, osm_raw FROM pubs").all<{
    id: string;
    name: string;
    lat: number;
    lon: number;
    address: string;
    osm_raw: string | null;
  }>();
  return json(
    results.map((p) => ({
      id: p.id,
      name: p.name,
      lat: p.lat,
      lon: p.lon,
      address: p.address,
      osm_raw: p.osm_raw ? JSON.parse(p.osm_raw) : undefined,
    })),
  );
});

app.get("/api/pubs/scores", async (c) => {
  const { results } = await c.env.DB.prepare(
    "SELECT pub_id, avg_rating, weighted_score, rating_count FROM pub_scores",
  ).all();
  const map: Record<string, unknown> = {};
  for (const r of results as { pub_id: string }[]) map[r.pub_id] = r;
  return json(map);
});

app.get("/api/pub/:pubId/score", async (c) => {
  const pubId = c.req.param("pubId");
  const row = await c.env.DB.prepare(
    "SELECT pub_id, avg_rating, weighted_score, rating_count FROM pub_scores WHERE pub_id = ?",
  )
    .bind(pubId)
    .first();
  return json(row ?? { pub_id: pubId, avg_rating: 0, weighted_score: 0, rating_count: 0 });
});

app.get("/api/pub/:pubId/submissions", async (c) => {
  const pubId = c.req.param("pubId");
  const { results } = await c.env.DB.prepare(
    "SELECT id, user_id, pub_id, photo_url, rating, created_at FROM submissions WHERE pub_id = ? AND rating IS NOT NULL ORDER BY created_at DESC LIMIT 30",
  )
    .bind(pubId)
    .all<{ id: string; user_id: string; pub_id: string; photo_url: string; rating: number; created_at: number }>();
  return json(results.map((s) => ({ ...s, photo_url: `/api/photo/${s.photo_url}` })));
});

// ---- photos + AI --------------------------------------------------------
app.post("/api/photos", async (c) => {
  const user = await getSessionUser(c.req.raw, c.env);
  if (!user) return error("Unauthorized", "Sign in to submit", 401);

  const form = await c.req.formData().catch(() => null);
  if (!form) return error("BadRequest", "Expected multipart form", 400);
  const pubId = String(form.get("pubId") ?? "");
  const turnstileToken = form.get("turnstileToken") ? String(form.get("turnstileToken")) : undefined;
  const photo = form.get("photo");
  const promptId = form.get("promptId") ? String(form.get("promptId")) : null;
  if (!pubId) return error("BadRequest", "Missing pubId", 400);
  if (!(photo instanceof File)) return error("BadRequest", "Missing photo", 400);
  if (!(await verifyTurnstile(c.env, turnstileToken, clientIp(c.req.raw)))) {
    return error("TurnstileFailed", "Verification failed", 403);
  }

  // soft throttle on repeated non-beer rejections
  const badKey = `bad_photo:${user.id}`;
  const bad = parseInt((await c.env.GLOBAL_CACHE.get(badKey)) ?? "0", 10);
  if (bad > 15) return error("TooManyRejectedPhotos", "Too many rejected photos — take a break", 429);

  const pub = await c.env.DB.prepare("SELECT id FROM pubs WHERE id = ?").bind(pubId).first();
  if (!pub) return error("NotFound", "Unknown pub", 404);

  const submissionId = ulid();
  const r2Key = `sub_${submissionId}.jpg`;
  const bytes = await photo.arrayBuffer();
  await c.env.BEER_PHOTOS.put(r2Key, bytes, {
    httpMetadata: { contentType: photo.type || "image/jpeg" },
  });
  await c.env.DB.prepare(
    "INSERT INTO submissions (id, user_id, pub_id, photo_url, rating, prompt_id, created_at) VALUES (?, ?, ?, ?, NULL, ?, ?)",
  )
    .bind(submissionId, user.id, pubId, r2Key, promptId, Date.now())
    .run();

  await c.env.PHOTO_INFER.send({ submissionId, r2Key, userId: user.id, pubId, promptId });
  return json({ submission_id: submissionId, status: "pending" }, { status: 202 });
});

app.get("/api/submissions/:id", async (c) => {
  const id = c.req.param("id");
  const row = await c.env.DB.prepare(
    "SELECT id, user_id, pub_id, photo_url, rating, created_at FROM submissions WHERE id = ?",
  )
    .bind(id)
    .first<{ id: string; user_id: string; pub_id: string; photo_url: string; rating: number | null; created_at: number }>();
  if (!row) return error("NotFound", "Submission not found", 404); // rejected photos 404 by design
  return json({ ...row, photo_url: `/api/photo/${row.photo_url}` });
});

// stream a private R2 object to an authenticated caller (bucket stays private)
app.get("/api/photo/:key", async (c) => {
  const user = await getSessionUser(c.req.raw, c.env);
  if (!user) return error("Unauthorized", "Sign in", 401);
  const obj = await c.env.BEER_PHOTOS.get(c.req.param("key"));
  if (!obj) return error("NotFound", "No such photo", 404);
  return new Response(obj.body, {
    headers: {
      "content-type": obj.httpMetadata?.contentType ?? "image/jpeg",
      "cache-control": "private, max-age=300",
    },
  });
});

// ---- feed / leaderboard / challenges / beerreal -------------------------
app.get("/api/feed", async (c) => {
  const since = parseInt(c.req.query("since") ?? "0", 10) || 0;
  const user = await getSessionUser(c.req.raw, c.env);
  const self = user?.id ?? "";
  const { results } = await c.env.DB.prepare(
    `SELECT id, user_id, display_name, type, target_id, target_name, ts, demo
       FROM activities
      WHERE ts > ?
        AND ( demo = 1
              OR user_id = ?
              OR user_id IN (SELECT buddy_id FROM buddies WHERE user_id = ? AND status = 'accepted') )
      ORDER BY ts DESC LIMIT 50`,
  )
    .bind(since, self, self)
    .all<{
      id: string;
      user_id: string;
      display_name: string;
      type: string;
      target_id: string | null;
      target_name: string | null;
      ts: number;
      demo: number;
    }>();
  return json({
    activities: results.map((r) => ({
      id: r.id,
      user_id: r.user_id,
      display_name: r.display_name,
      type: r.type,
      target_id: r.target_id,
      target_name: r.target_name,
      ts: r.ts,
      demo: r.demo === 1,
    })),
    now: Date.now(),
  });
});

app.get("/api/leaderboard", async (c) => {
  const user = await getSessionUser(c.req.raw, c.env);
  const { results } = await c.env.DB.prepare(
    "SELECT id, display_name, xp, level FROM users ORDER BY xp DESC, display_name ASC LIMIT 20",
  ).all<{ id: string; display_name: string; xp: number; level: number }>();
  return json(
    results.map((r, i) => ({
      user_id: r.id,
      display_name: r.display_name,
      xp: r.xp,
      level: r.level,
      rank: i + 1,
      is_me: user?.id === r.id,
    })),
  );
});

app.get("/api/challenges", async (c) => {
  const user = await getSessionUser(c.req.raw, c.env);
  const done = new Set<string>();
  if (user) {
    const { results } = await c.env.DB.prepare(
      "SELECT challenge_id FROM challenge_completions WHERE user_id = ?",
    )
      .bind(user.id)
      .all<{ challenge_id: string }>();
    for (const r of results) done.add(r.challenge_id);
  }
  const { results } = await c.env.DB.prepare(
    "SELECT id, type, title, xp, starts_at, ends_at FROM challenges ORDER BY type DESC, xp ASC",
  ).all<{ id: string; type: string; title: string; xp: number; starts_at: number; ends_at: number }>();
  return json(results.map((c2) => ({ ...c2, completed: done.has(c2.id) })));
});

app.get("/api/beerreal/active", async (c) => {
  const user = await getSessionUser(c.req.raw, c.env);
  const now = Date.now();
  const row = await c.env.DB.prepare(
    "SELECT id, prompt, created_at, window_ends_at FROM beerreal_prompts WHERE window_ends_at > ? ORDER BY created_at DESC LIMIT 1",
  )
    .bind(now)
    .first<{ id: string; prompt: string; created_at: number; window_ends_at: number }>();
  if (!row) return json(null);
  let responded = false;
  if (user) {
    const r = await c.env.DB.prepare(
      "SELECT 1 FROM beerreal_responses WHERE prompt_id = ? AND user_id = ?",
    )
      .bind(row.id, user.id)
      .first();
    responded = !!r;
  }
  return json({ ...row, responded });
});

// admin: kick the demo simulator (shared-secret gated — TASKS.md open TODO #2)
app.post("/api/admin/demo/:action", async (c) => {
  if (!c.env.ADMIN_SECRET || c.req.header("x-admin-secret") !== c.env.ADMIN_SECRET) {
    return error("Forbidden", "Admin only", 403);
  }
  const action = c.req.param("action");
  const stub = c.env.DEMO_SIMULATOR.get(c.env.DEMO_SIMULATOR.idFromName("global"));
  await stub.fetch(`https://do/${action}`);
  return json({ ok: true, action });
});

// SPA fallback: hand everything else to the static assets binding.
app.notFound((c) => c.env.ASSETS.fetch(c.req.raw));

// ---- AI rating ----------------------------------------------------------
async function ratePhoto(env: Env, bytes: ArrayBuffer): Promise<number> {
  if (env.AI_OFF === "1") return Math.round((2 + Math.random() * 2) * 10) / 10; // stub 2.0-4.0
  const input = { image: [...new Uint8Array(bytes)], prompt: RATE_PROMPT, max_tokens: 12 };
  // Workers AI llava image-to-text; response shape { description }
  const out = (await (env.AI as unknown as { run: (m: string, i: unknown) => Promise<{ description?: string }> }).run(
    AI_MODEL,
    input,
  )) as { description?: string };
  const text = (out.description ?? "").trim();
  const match = text.match(/-?\d+(\.\d+)?/);
  if (!match) return -1;
  const n = parseFloat(match[0]);
  if (n < 0) return -1;
  return Math.max(0, Math.min(5, n));
}

// ---- exported handlers --------------------------------------------------
export default {
  async fetch(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(req.url);

    // live pub-score WebSocket → forward to the per-pub Durable Object
    if (url.pathname.startsWith("/ws/pub/")) {
      const pubId = decodeURIComponent(url.pathname.slice("/ws/pub/".length));
      if (!pubId) return new Response("bad pub", { status: 400 });
      return pubAggregator(env, pubId).fetch(`https://do/ws?pubId=${encodeURIComponent(pubId)}`, req);
    }

    return app.fetch(req, env, ctx);
  },

  async queue(batch: MessageBatch<PhotoJob>, env: Env): Promise<void> {
    for (const msg of batch.messages) {
      const { submissionId, r2Key, userId, pubId, promptId } = msg.body;
      try {
        const obj = await env.BEER_PHOTOS.get(r2Key);
        if (!obj) {
          msg.ack();
          continue;
        }
        const rating = await ratePhoto(env, await obj.arrayBuffer());

        if (rating < 0) {
          // no beer: leave no trace beyond the throttle counter (TASKS.md §5)
          const badKey = `bad_photo:${userId}`;
          const bad = parseInt((await env.GLOBAL_CACHE.get(badKey)) ?? "0", 10);
          await env.GLOBAL_CACHE.put(badKey, String(bad + 1), { expirationTtl: 3600 });
          await env.DB.prepare("DELETE FROM submissions WHERE id = ?").bind(submissionId).run();
          await env.BEER_PHOTOS.delete(r2Key);
          msg.ack();
          continue;
        }

        await env.DB.prepare("UPDATE submissions SET rating = ? WHERE id = ?").bind(rating, submissionId).run();
        // recompute + broadcast the pub score
        await pubAggregator(env, pubId).fetch(`https://do/recalc?pubId=${encodeURIComponent(pubId)}`, {
          method: "POST",
        });

        // gamification: XP + feed activity
        const pub = await env.DB.prepare("SELECT name FROM pubs WHERE id = ?").bind(pubId).first<{ name: string }>();
        const u = await env.DB.prepare("SELECT display_name FROM users WHERE id = ?").bind(userId).first<{ display_name: string }>();
        const res = await grantXp(env, userId, 30);
        if (u) {
          await writeActivity(env, {
            userId,
            displayName: u.display_name,
            type: "submission",
            targetId: pubId,
            targetName: pub?.name ?? null,
          });
          if (res.leveledUp) {
            await writeActivity(env, { userId, displayName: u.display_name, type: "level_up" });
          }
        }

        // BeerReal fulfilment → response row + daily challenge credit
        if (promptId) {
          await env.DB.prepare(
            "INSERT OR IGNORE INTO beerreal_responses (id, prompt_id, user_id, submission_id, created_at) VALUES (?, ?, ?, ?, ?)",
          )
            .bind(ulid(), promptId, userId, submissionId, Date.now())
            .run();
          await completeChallenge(env, userId, "chl_daily_first");
        }

        msg.ack();
      } catch (e) {
        console.error("photo job failed", submissionId, e);
        msg.retry();
      }
    }
  },

  async scheduled(event: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    void ctx;
    if (event.cron === "0 17 * * *") {
      // daily BeerReal prompt (2h response window) + a feed marker
      const prompts = [
        "Snap your current pint in the next 30 minutes! 🍺",
        "BeerReal time — show us what you're drinking right now 📸",
        "Quick! Capture your beer before it's empty 🍻",
      ];
      const id = ulid();
      const now = Date.now();
      await env.DB.prepare(
        "INSERT INTO beerreal_prompts (id, prompt, created_at, window_ends_at) VALUES (?, ?, ?, ?)",
      )
        .bind(id, prompts[Math.floor(Math.random() * prompts.length)], now, now + 2 * 3600 * 1000)
        .run();
      await env.DB.prepare(
        "INSERT INTO activities (id, user_id, display_name, type, target_id, target_name, ts, demo) VALUES (?, 'system', 'BeerReal', 'beerreal', ?, NULL, ?, 0)",
      )
        .bind(ulid(now), id, now)
        .run();
    }
    if (event.cron === "0 0 * * 1") {
      // weekly challenge rotation: reset weekly completions for a fresh week
      await env.DB.prepare(
        "DELETE FROM challenge_completions WHERE challenge_id IN (SELECT id FROM challenges WHERE type = 'weekly')",
      ).run();
    }
  },
};

async function completeChallenge(env: Env, userId: string, challengeId: string): Promise<void> {
  const chl = await env.DB.prepare("SELECT xp FROM challenges WHERE id = ?").bind(challengeId).first<{ xp: number }>();
  if (!chl) return;
  const inserted = await env.DB.prepare(
    "INSERT OR IGNORE INTO challenge_completions (challenge_id, user_id, completed_at) VALUES (?, ?, ?)",
  )
    .bind(challengeId, userId, Date.now())
    .run();
  if (inserted.meta.changes > 0) await grantXp(env, userId, chl.xp);
}

// ---- email --------------------------------------------------------------
async function sendMagicLink(env: Env, to: string, link: string): Promise<void> {
  const raw =
    `From: Caneca <noreply@caneca.dev>\r\n` +
    `To: ${to}\r\n` +
    `Subject: Your Caneca magic link\r\n` +
    `Content-Type: text/plain; charset=utf-8\r\n\r\n` +
    `Tap to sign in to Caneca:\r\n${link}\r\n\r\nThis link expires in 15 minutes.`;
  try {
    const { EmailMessage } = await import("cloudflare:email");
    const msg = new EmailMessage("noreply@caneca.dev", to, raw);
    await env.EMAIL.send(msg);
  } catch (e) {
    // dev / unverified-domain fallback (TASKS.md §11): log the link so the
    // magic-link flow is testable without live Email Sending.
    console.log(`[magic-link] ${to} -> ${link}`, e instanceof Error ? e.message : "");
  }
}
