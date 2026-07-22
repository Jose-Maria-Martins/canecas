# Caneca — Pub Crawl Hackathon Build Spec

## Product summary

Caneca is a pub-crawl web app. A world map shows nearby pubs. A user checks in at a pub and submits a
photo of their beer; an AI rates the photo; that rating feeds into the pub's aggregate score shown on
the map. On top of that sits a gamification layer: levels/XP, a buddy (friend) system, daily/weekly
challenges, and "BeerReal" — a BeReal-style random daily prompt pushing users to submit a beer photo
within a short window.

**Constraint:** maximize Cloudflare product usage. Do not use competing cloud/infra vendors anywhere
Cloudflare has a native product — no AWS/GCP/Azure, no Vercel/Netlify, no Auth0/Firebase, no Google
Maps/Mapbox, no OpenAI/Anthropic APIs, no MongoDB Atlas/Supabase. The only sanctioned exceptions are
MapLibre GL + OpenStreetMap tiles/data, since Cloudflare has no maps product.

**Time budget:** 3 hours, 4 people, split by layer into the 4 tracks below. The build must be deployed
live on Cloudflare during the event — demo against the real URL, not localhost.

## Architecture — read before starting any track

One Cloudflare Workers project ("caneca") serves both the built SPA (via Workers static assets) and the
API. Do not split this into a separate Pages project — that reintroduces cross-origin/cross-domain-cookie
problems for no benefit.

- **Frontend:** Vite + React + MapLibre GL, built to `dist/`, served by the same Worker.
- **API:** `/api/*` routes, same hostname.
- **Real-time:** exactly one WebSocket route, `/ws/pub/:pubId`, for live pub-score updates only. The
  buddy/social feed is polling-based (`GET /api/feed?since=<ts>`), **not** WebSocket — Cloudflare has no
  native Durable-Object-to-Durable-Object pub/sub, so per-user WebSocket fan-out for a social graph
  is not realistic in this time budget. Poll D1 for the feed; don't build it as WebSocket.
- **Cloudflare products in use:** Workers, D1, KV, R2, Durable Objects, Queues, Workers AI, Cron
  Triggers, Email Sending, Turnstile, Rate Limiting Rules.

## Shared data model (D1)

```sql
users(id TEXT PK, email TEXT UNIQUE, display_name TEXT, created_at DATETIME,
      xp INTEGER DEFAULT 0, level INTEGER DEFAULT 1)

pubs(id TEXT PK /* osm_id */, name TEXT, lat REAL, lon REAL, address TEXT,
     osm_raw TEXT /* JSON */, created_at DATETIME)
-- seeded ONCE from the OSM Overpass API before the event; no live Overpass calls during the demo

submissions(id TEXT PK /* ULID */, user_id TEXT FK, pub_id TEXT FK,
            photo_url TEXT /* R2 key */,
            rating REAL, -- NULL until AI rates it, 0-5, AI-set only, never client-writable
            created_at DATETIME)

pub_scores(pub_id TEXT PK, avg_rating REAL, weighted_score REAL, rating_count INTEGER)

buddies(user_id TEXT FK, buddy_id TEXT FK,
        status TEXT CHECK(status IN ('pending','accepted')) DEFAULT 'pending',
        PRIMARY KEY(user_id, buddy_id))
-- only the invited party (buddy_id) may transition pending -> accepted, never the requester

challenges(id TEXT PK, type TEXT CHECK(type IN ('daily','weekly')), title TEXT,
           xp INTEGER, starts_at DATETIME, ends_at DATETIME)
challenge_completions(challenge_id TEXT FK, user_id TEXT FK, completed_at DATETIME,
                       PRIMARY KEY(challenge_id, user_id))

beerreal_prompts(id TEXT PK, prompt TEXT, created_at DATETIME)
beerreal_responses(id TEXT PK, prompt_id TEXT FK, user_id TEXT FK,
                    submission_id TEXT FK, created_at DATETIME)

activities(id TEXT PK, user_id TEXT FK, type TEXT, target_id TEXT, ts DATETIME,
           demo BOOLEAN DEFAULT 0)
-- backs the polled buddy feed. demo=1 rows use a synthetic "demo_"-prefixed user_id, never a real
-- user's id. `demo` must never be settable through any public/client-facing endpoint.
```

Sessions live in **KV**, not D1: key `sess:{token}` → `userId`, TTL 24h.

## Shared API surface & conventions

- **Auth:** cookie-based session (`caneca_sess`; `Secure; HttpOnly; SameSite=Lax`), looked up in KV.
  Every authenticated route resolves `userId` server-side from this cookie — never trust a
  client-supplied user id anywhere. This matters most for `/api/feed`, which must scope strictly to the
  caller's own session (standard IDOR discipline for a "get my feed" endpoint).
- **Auth endpoints:** `POST /api/auth/magic-link` (Turnstile-checked, rate-limited 3 req/10min/IP) emails
  a link via Cloudflare Email Sending. `GET /api/auth/verify?token=...` validates the token, **deletes it
  from KV on first successful use** (single-use, not just TTL-bound), and issues the session cookie.
  Identity comes only from the KV-stored token association — never from a client-supplied email.
- **WebSocket auth:** the upgrade request is a normal HTTP request and carries the `Cookie` header
  same-origin — read it directly server-side and do the same KV session lookup used for REST. Do not
  build a separate signing/re-auth scheme for the handshake.
- **Photo submission:** `POST /api/photos` — see the AI & Photo Pipeline track for the full flow,
  including rejection handling.
- **Error format:** JSON body `{"error": "MachineReadableCode", "message": "human-readable text"}`.
- **R2:** private bucket, ULID-based object keys, short-TTL signed URLs for reads. The bucket must never
  be made public, including as a shortcut under time pressure — extend the signed-URL TTL instead if
  something isn't working.
- **Secrets:** Turnstile secret, HMAC signing key, any API tokens go through `wrangler secret put`.
  Never a plaintext `vars` block, never committed to the repo.

## Pub rating formula

```
weighted_score = (v / (v + m)) * R + (m / (v + m)) * C
```
- `R` = mean rating for the pub, `v` = number of ratings for the pub, `m` = 5 (confidence constant),
  `C` = global mean rating across all pubs (daily KV snapshot).
- New pubs sit near the global mean until they cross 5 ratings, then converge toward their own average.
- Implemented inside a Durable Object, `PubAggregatorDO` (one instance per pub id), which recalculates on
  every new rating and broadcasts `{"t":"pubScore","pubId":...,"score":...}` over that pub's WebSocket.

## Cloudflare bindings (wrangler.jsonc) — everyone should know what's in here

- D1 database: `caneca_db`
- KV namespaces: `SESSIONS`, `GLOBAL_CACHE`
- R2 bucket: `BEER_PHOTOS` (private)
- Queue: `PHOTO_INFER`
- Workers AI binding
- Durable Object namespaces: `PUB_AGGREGATOR`, `DEMO_SIMULATOR`
- Email Sending binding
- Turnstile secret

## Timeline & integration checkpoints

- **0:00–0:15** — everyone: repo/Cloudflare account access, confirm the bindings list above.
- **1:45** — API route signatures frozen across all four tracks.
- **2:45** — full cross-layer system test.
- **3:00** — submission / demo.

---

## Track A — Map & Frontend

**Objective:** the map, photo-upload UI, buddy feed UI, gamification displays, and the deployed frontend.

**Stack:** Vite + React + MapLibre GL + OpenStreetMap tiles.

**Tasks:**
1. `0:15–0:55` Scaffold the SPA; render the MapLibre map; load pub markers from the pre-seeded static
   JSON (fall back to this directly rather than blocking on `/api/pubs` if it isn't ready yet).
2. `0:55–1:40` Photo upload flow: Turnstile widget, form hitting `POST /api/photos`. On the `202`
   response, poll the submission. If it never resolves to a rating within a few seconds (it was
   rejected — see Track C), show: *"We couldn't find a beer in that photo — try a clearer shot."* Buddy
   feed UI polling `GET /api/feed?since=<ts>` every 4s; visually badge rows where `demo: true` so
   simulated activity is never mistaken for a real teammate's activity.
3. `1:40–2:45` Leaderboard/challenge/XP display; BeerReal modal (triggered when a `beerreal`-type
   `activities` row appears in the feed); general polish.
4. `2:45–3:00` Smoke test against the deployed URL.

**Definition of done:** map renders real pub pins; a user can upload a photo and watch the pub's score
update live via WebSocket; the buddy feed clearly distinguishes real vs. demo activity; the BeerReal
modal appears and accepts a response.

---

## Track B — Gamification & Backend Logic

**Objective:** D1 schema/migrations, the pub/challenge/feed/XP endpoints, and the pub-rating Durable
Object.

**Tasks:**
1. `0:15–0:45` Write the D1 migration for the full schema above (including `buddies.status` and
   `activities`). Generate the pub seed data from the OSM Overpass API for one demo city/area and load
   it as a static JSON (both for Track A's map and for a one-time D1 seed) — do this once, up front; no
   live Overpass calls during the demo.
2. `0:45–1:30` Build `GET /api/feed?since=<ts>` (join `activities` to `buddies` where `status='accepted'`,
   scoped to the caller's session — never a client-supplied user id), `GET/POST /api/challenge`
   (challenge listing + completion, server-derived completion — never trust a client claim of
   "completed"), and the XP/level update logic.
3. `1:30–2:30` Implement `PubAggregatorDO` per the rating formula above; wire it to receive rating
   updates from Track C's queue consumer and broadcast over `/ws/pub/:pubId`.
4. `2:30–3:00` Seed the database, and run the demo activity simulator (writes fake `activities` rows
   every few seconds with `demo=1` and `demo_`-prefixed user ids, so the feed looks populated without
   real concurrent users — this must never touch `pub_scores` or attribute activity to a real user id).

**Definition of done:** feed/challenge/XP endpoints return correct, session-scoped data; pub scores
recompute and broadcast correctly on new ratings; demo simulator populates the feed visibly and
separably from real activity.

---

## Track C — AI & Photo Pipeline

**Objective:** photo upload, the AI rating pipeline (including rejecting non-beer photos), and hooking
results into the pub score.

**Tasks:**
1. `0:15–0:45` R2 signed-URL helper (ULID keys). `POST /api/photos` handler: requires an authenticated
   session, Turnstile-checked, rate-limited 10 req/min. Before anything else, check a KV counter
   `bad_photo:{userId}` (1h TTL) — if already above 15, return `429`
   `{"error":"TooManyRejectedPhotos"}` immediately, no AI spent. Otherwise write the image to R2 (key
   `sub_<ULID>.jpg`), create a `submissions` row with `rating = NULL` ("pending"), enqueue
   `{submissionId, r2Key}`, return `202` right away — **no AI call happens in the request path**, so the
   response never blocks on model latency.
2. `0:45–1:15` Set up the `PHOTO_INFER` queue and enqueue logic from step 1.
3. `1:15–2:00` Queue consumer: fetch the R2 object, call Workers AI (`@cf/llava-hf/llava-1.5-7b-hf`) with
   this single combined prompt:
   > "Look at this photo. If there is no beer (glass, mug, can, or bottle) visible, respond with exactly
   > -1. Otherwise, rate how appealing the beer looks from 0 (awful) to 5 (amazing). Respond with ONLY a
   > number."

   Parse the result:
   - **`-1`** (no beer detected): increment `bad_photo:{userId}`; delete the `submissions` row created
     in step 1 and the R2 object. A rejected photo leaves no lasting DB/storage trace, only the KV
     throttle counter. There's no synchronous error response for this — the client already got `202`
     and detects rejection by the submission never resolving (see Track A).
   - **Otherwise:** parse the float, `UPDATE submissions SET rating = :rating WHERE id = :submissionId`,
     then notify `PubAggregatorDO` via internal fetch so the pub score updates.
   - **Fallback:** an `AI_OFF` env toggle stubs a random rating 2–4 and never returns `-1` (treats
     everything as an accepted beer) — flip this on if inference latency/quota becomes a live problem.
4. `2:00–2:30` Hook the consumer to `PubAggregatorDO`. Write `rating.test.ts` (vitest) covering the
   Bayesian formula against hand-computed cases **and** the `-1`/rejection branch specifically.
5. `2:30–3:00` Load test with a handful of real sample images (including at least one clearly-not-a-beer
   image to confirm the rejection path actually works end to end).

**Notes:**
- One AI call per photo either way — classify and rate happen in the same model call, inside the async
  queue step, never inline in the HTTP request path. Don't add a second, separate classification call
  before upload — that blocks the HTTP response on model latency and risks a Worker timeout.
- The `bad_photo` throttle is a soft cap (KV increments aren't atomic — a concurrent burst could exceed
  15 briefly). That's fine; the endpoint-level 10 req/min rate limit is still a hard backstop regardless.

**Definition of done:** a real beer photo gets rated and updates the pub's score live; a clearly
non-beer photo gets silently rejected (submission disappears, no DB/R2 trace) and the throttle kicks in
after repeated rejections from the same user.

---

## Track D — Auth & Infrastructure

**Objective:** magic-link auth, session/cookie handling, WebSocket auth, cron jobs, and deployment.

**Tasks:**
1. `0:15–0:35` `POST /api/auth/magic-link`: Turnstile + rate limit (3 req/10min/IP) as described above.
2. `0:35–1:10` Magic-link token store/consume with single-use invalidation (delete on verify); session
   cookie helper (`Secure; HttpOnly; SameSite=Lax; Max-Age=86400`).
3. `1:10–1:40` Cookie-based WebSocket auth per the shared conventions above (read `Cookie` off the
   upgrade request, reuse the REST session lookup — no separate signing scheme).
4. `1:40–2:15` Cron Triggers: daily BeerReal prompt (inserts a `beerreal_prompts` row and a matching
   `activities` row so it surfaces in the feed), weekly challenge rotation.
5. `2:15–2:45` `wrangler.jsonc` with the full bindings list above; `wrangler deploy`.
6. `2:45–3:00` End-to-end auth walkthrough against the deployed URL.

**Definition of done:** a real user can request a magic link, verify it once, get a session, and connect
to the pub WebSocket using that session; cron jobs fire on schedule; the whole thing is live on a real
Cloudflare URL.

---

## Open decisions — resolve during implementation, not settled by design review

1. **Dev-mode auth bypass.** A `?devEmail=` query param was considered as a fallback for testing without
   waiting on real magic-link emails. It needs an explicit guard so it can never be reachable in the
   deployed production build — or it should be dropped. Whoever owns Track D should make this call
   before wiring anything up; do not ship an unscoped login bypass on the live URL.
2. **BeerReal's manual "generate prompt" trigger** has no user role/admin concept anywhere in the
   schema. It needs a lightweight gate — a shared secret header or a hardcoded allowlist of user ids for
   the event — rather than being callable by any authenticated user. Track B and Track D should agree on
   the mechanism.
