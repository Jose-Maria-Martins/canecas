# TASKS

## Goal

Design (and, once approved, help scaffold) a hackathon project: "Caneca" — a pub crawl web app for a
Cloudflare-sponsored hackathon. Team of 4, 3-hour build window. Deliverable for THIS round: the most
detailed design report possible, maximizing Cloudflare product usage without using competitor products,
covering architecture, data model, API sketch, the pub-rating formula, real-time design, AI prompting
approach, auth flow, deployment plan, and a per-person task breakdown for the 3 hours.

### Core product

- Big world map with pub pins (MapLibre GL + OpenStreetMap tiles/data — Cloudflare has no maps product).
- Pub pins sourced from real data via the OSM Overpass API (not a manually seeded list).
- "Pubs near me" via browser Geolocation API.
- User visits a pub, submits a photo of their beer. Cloudflare Workers AI (vision-language model) gives
  a subjective "vibe" rating (pour, glass, setting) — not a real quality assessment.
- Beer photo rating feeds into the pub's aggregate rating shown on the map. Pub rating must be a function
  of BOTH average beer rating AND the number of submitted photos (a pub with 1 five-star photo should not
  outrank one with 50 photos averaging 4.5) — architect should propose a specific weighted/confidence
  formula (e.g. Bayesian/IMDB-style weighted average), not just a plain mean.
- Gamification: user levels/XP, "drinking buddies" (friends system), challenges (daily/weekly), and
  "BeerReal" — a BeReal-style random-time daily prompt pushing the user to submit a beer photo within a
  short window. Tie BeerReal into the challenge/XP system.

### Decisions already made with the user (do not re-litigate, just execute against them)

- Repo: empty, starting from scratch at /Users/ddacruz/caneca.
- Competitor policy: Cloudflare-first but flexible — maximize Cloudflare products; small non-competing
  OSS utilities are fine where Cloudflare has no direct product (map tiles/library, OSM data). Do not use
  competing cloud/infra vendors (AWS/GCP/Azure, Vercel/Netlify, Auth0/Firebase, Mapbox/Google Maps,
  OpenAI/Anthropic APIs, MongoDB Atlas/Supabase, etc.) anywhere Cloudflare has a native product.
- Map: MapLibre GL + OpenStreetMap tiles.
- Pub data: OSM Overpass API, real pubs (likely scoped to one demo city/area for reliability).
- Auth: lightweight custom auth — email + magic link or password, sessions in D1/KV, no external IdP.
  Consider Cloudflare's own Email Sending service for the magic-link email (avoid a third-party ESP).
- AI rating: Workers AI vision-language model, subjective "vibe" score framing.
- Real-time: full real-time via Durable Objects + WebSockets for live pub-rating updates and buddy/friend
  activity feed. Backend should also seed/simulate fake activity so the live feed looks populated during
  the demo without needing real concurrent users — architect should design this as a clearly-labeled demo
  data seeder, not something that could be mistaken for real user data.
- Deployment: must be live on Cloudflare (Pages/Workers) so judges can hit a real URL during the event.
- Team split: by layer — (1) map/frontend, (2) gamification/backend logic, (3) AI + photo pipeline,
  (4) auth + data model/infra. Report needs a concrete per-person task list for the 3-hour window.
- Judging optimization, in addition to "most Cloudflare products": polished demo/UX, technical
  creativity, idea originality. A working demo with fewer well-integrated products beats a broken demo
  with more — flag any product inclusion that meaningfully risks the 3-hour build finishing.

### Housekeeping

- No .gitignore exists yet. Engineer should add one (and a TASKS.md entry in it) on its first invocation.

## Design Report (Round 2, revised — supersedes Round 1)

### 1. High-level architecture
- Single Workers project ("caneca") serves both the SPA (Vite + React + MapLibre, built to `dist/` and
  attached via Workers static assets) and the API — no separate Pages project, so no cross-origin or
  cross-domain-cookie concerns.
- Routes on one hostname: `/api/*` REST JSON (auth, pubs, photos, feed, beerreal, challenges), plus
  `/ws/pub/:pubId` WebSocket for the live pub-score stream only.
- Data stores: D1 (relational), KV (sessions/cache), R2 (private, beer-photo objects), Durable Objects
  (PubAggregatorDO per pub, DemoSimulatorDO for fake activity), Queues (photo → AI decoupling).
- Buddy/social feed is polling-based (D1 `activities` table), not WebSocket — see §6 for why.
- Only non-Cloudflare pieces: MapLibre tile CDN + a one-time pre-event OSM Overpass pull to seed pub
  data (no live Overpass calls during the demo) — justified since Cloudflare has no maps product.

### 2. Cloudflare product mapping
- Static assets + API: Cloudflare Workers with static assets (single project/deploy) — avoids the
  split-deploy CORS/cookie issues Round 1 had with a separate Pages project.
- Relational data: D1.
- Image storage: R2, private bucket "caneca-photos", ULID-named objects, short-TTL signed URLs.
  Making the bucket public is explicitly ruled out, including as a time-pressure shortcut (see §11).
- Vision scoring: Workers AI model `@cf/llava-hf/llava-1.5-7b-hf` (Image-to-Text, <1s inference) — replaces the
  Round 1 slug `@cf/unum/uform-v1`, which does not exist in the Workers AI catalog.
- Async: Workers Queues, decouples upload latency from AI inference.
- Real-time pub scores: Durable Objects (PubAggregatorDO) + WebSockets — scoped to pub-score updates
  only, not the buddy feed (see §6).
- Caching/sessions: Workers KV.
- Cron: Workers Cron Triggers — daily BeerReal prompt, weekly challenge rotation.
- Email auth: Cloudflare Email Sending, for magic-link emails.
- Abuse control: Turnstile + Cloudflare Rate Limiting Rules on **both** `/api/photos` and
  `/api/auth/magic-link` (Round 1 only covered photos, leaving magic-link open to email-bombing).
- Map tiles: MapLibre GL JS + OSM tiles (documented exception, no CF maps product).

### 3. D1 schema sketch
- users(id PK ULID, email UNIQUE, display_name, created_at, xp, level)
- sessions: KV key "sess:{token}" → userId, TTL 24h (not D1)
- pubs(id PK osm_id, name, lat, lon, address, osm_raw JSON, created_at) — seeded once from Overpass
  pre-event into a static JSON, loaded at deploy time; no live fetching during the demo
- submissions(id PK ULID, user_id FK, pub_id FK, photo_url [R2 key, ULID-based], rating REAL 0-5
  [set by AI only, no client-writable override path], created_at)
- pub_scores(pub_id PK, avg_rating, weighted_score, rating_count) — materialized by PubAggregatorDO
- buddies(user_id FK, buddy_id FK, status TEXT CHECK('pending','accepted') DEFAULT 'pending',
  PK(user_id, buddy_id)) — feed visibility gated on status='accepted' (Round 1 had no status column,
  which modeled unilateral following instead of mutual consent)
- challenges(id PK, type ['daily'|'weekly'], title, xp, starts_at, ends_at)
- challenge_completions(challenge_id FK, user_id FK, completed_at, PK(challenge_id, user_id))
- beerreal_prompts(id PK, prompt, created_at)
- beerreal_responses(id PK, prompt_id FK, user_id FK, submission_id FK, created_at)
- activities(id PK, user_id FK, type, target_id, ts, demo BOOLEAN DEFAULT 0) — new table backing the
  polled buddy feed; demo rows have `demo=1` and a `demo_`-prefixed user_id, never a real user's id

### 4. Pub aggregate-rating formula (unchanged)
Bayesian/IMDB-style weighted average:
`weighted_score = (v / (v + m)) * R + (m / (v + m)) * C`
where R = mean rating for the pub, v = number of ratings for the pub, m = 5 (minimum-ratings
confidence constant), C = global mean rating across all pubs (kept as a daily KV snapshot). New pubs
stay near the global mean until 5+ photos are submitted.

### 5. AI pipeline
1. `POST /api/photos` (Turnstile-checked, rate-limited) → Worker writes to R2 (key `sub_<ULID>.jpg`),
   enqueues `{submissionId, r2Key}`, returns 202.
2. Queue consumer: fetches R2 object, calls Workers AI (`@cf/llava-hf/llava-1.5-7b-hf`) with prompt "You are
   rating a beer photo from 0 (awful) to 5 (amazing). Answer with ONLY a number (0-5)," parses the
   float, updates `submissions.rating`, notifies PubAggregatorDO via internal fetch.
3. PubAggregatorDO (one per pub_id): recalculates v/R/weighted_score, persists `pub_scores`, broadcasts
   `{t:"pubScore", pubId, score}` to connected WebSocket clients on `/ws/pub/:pubId`.
- Fallback: `AI_OFF` env toggle returns a stubbed random rating 2-4 if inference latency/quota becomes
  a problem.

### 6. Real-time design
- PubAggregatorDO: as above — the only thing still on WebSockets, because it's one DO per pub with no
  fan-out problem.
- Buddy/social feed: **not** WebSocket-based (Round 1's per-user FeedRoomDO cross-subscription design
  had no real DO-to-DO pub/sub mechanism in Cloudflare and wasn't buildable in 3 hours). Instead: the
  Worker writes a row into `activities` on every submission/level-up/check-in; the client polls
  `GET /api/feed?since=<ts>` every 4s, and the query joins only `buddies` rows with `status='accepted'`.
- DemoSimulatorDO: writes fake rows into `activities` with `demo=1` and `demo_`-prefixed user ids. The
  `demo` boolean is returned by the API and used by the UI to visibly label simulated activity — the
  separation is enforced both structurally (no binding path from the simulator to `pub_scores` or real
  user attribution) and on the wire (every simulated event is tagged, not just DO-isolated).

### 7. Auth flow
1. `POST /api/auth/magic-link`: requires Turnstile, rate-limited (3 req / 10 min / IP). Token = ULID +
   HMAC(email, secret), stored in KV `ml:<token>` TTL 15 min, emailed via CF Email Service.
2. `GET /api/auth/verify`: validates token + TTL, **deletes the KV entry on first successful verify**
   (single-use, not just TTL-bounded), upserts user in D1, issues session cookie:
   `Set-Cookie: caneca_sess=<signedULID>; Max-Age=86400; Secure; HttpOnly; SameSite=Lax`.
3. Subsequent REST calls: cookie → KV lookup → userId.
4. WebSocket auth: the upgrade request is a normal HTTP request and carries the `Cookie` header
   same-origin; the Worker/DO reads it directly and does the same KV session lookup as REST. (Round 1's
   "frontend re-signs the cookie with a UA salt" scheme is dropped — it was self-contradictory, since an
   `HttpOnly` cookie can't be read by frontend JS to re-sign in the first place, and added complexity
   without real security value.)

### 8. BeerReal
Daily Cron → Worker inserts a `beerreal_prompts` row **and** an `activities` row (so it surfaces via the
polled feed like any other event). Frontend shows a modal; the next photo upload is tagged with
`promptId`; completion grants XP via `challenges` (type=daily).

### 9. Deployment plan
- Single Workers project "caneca": `wrangler.jsonc` with `main = "src/index.ts"`, static assets
  directory `./dist` (serves the built SPA from the same Worker/deploy).
- Bindings: D1 `caneca_db`, KV `SESSIONS`/`GLOBAL_CACHE`, R2 `BEER_PHOTOS`, Queue `PHOTO_INFER`, AI
  binding, DO namespaces `PUB_AGGREGATOR` + `DEMO_SIMULATOR`, Email binding, Turnstile secret.
- `wrangler deploy` once during the build; Cron + Queues configured via wrangler. DNS: `caneca.dev` →
  the Worker route. No separate Pages domain, so no CORS configuration needed.

### 10. 3-hour task breakdown (by layer)
- T-0:00–0:15 (all): kickoff, clone repo, CF account/token access.
- Dev A (map/frontend): 0:15-0:55 SPA/map scaffold, pub markers from the pre-seeded static JSON;
  0:55-1:40 photo upload UI + Turnstile widget, buddy feed polling UI with a demo-flag badge;
  1:40-2:45 leaderboard/challenge/XP display, cookie handling, polish; 2:45-3:00 smoke test/deploy.
- Dev B (gamification/backend logic): 0:15-0:45 D1 migrations incl. `buddies.status` and
  `activities`; 0:45-1:30 `/api/feed` query + pagination, `/api/challenge`, XP update; 1:30-2:30
  PubAggregatorDO + WebSocket route; 2:30-3:00 seed data + run the demo simulator.
- Dev C (AI + photo pipeline): 0:15-0:45 R2 signed URLs (ULID keys) + `/api/photos` handler incl.
  Turnstile; 0:45-1:15 Queue + enqueue logic; 1:15-2:00 queue consumer calling Workers AI
  (`@cf/llava-hf/llava-1.5-7b-hf`); 2:00-2:30 hook to PubAggregatorDO + a `rating.test.ts` vitest check;
  2:30-3:00 load test with sample images.
- Dev D (auth + infra): 0:15-0:35 Turnstile + rate-limit on magic-link; 0:35-1:10 magic-link
  token store/consume with single-use invalidation; 1:10-1:40 session cookie helper (`SameSite=Lax`)
  + cookie-based WS auth; 1:40-2:15 Cron triggers (BeerReal, weekly challenge), demo simulator writer;
  2:15-2:45 `wrangler deploy` + full bindings wiring; 2:45-3:00 e2e auth walkthrough.
- Integration gates: 1:45 API route signatures frozen; 2:45 cross-layer system test; 3:00 submission.

### 11. Risk flags & cut-first fallbacks
- Workers AI latency/quota exhaustion → `AI_OFF` env toggle stubs a random rating 2-4.
- WebSocket failure (pub-score stream only now) → fall back to polling `/api/pub/:id/score` every 5s;
  the buddy feed is unaffected since it already polls.
- Email sending delays → dev-mode auth bypass via `?devEmail=` query param.
  **OPEN TODO, not yet resolved (see Log "Round 2 verdicts"):** this lost its "Pages preview only"
  scoping when the design collapsed to a single Worker/single deploy — as worded it's an unscoped full
  login bypass reachable on the one production URL judges hit. Before Dev D wires this up, either (a)
  gate it behind a build-time-only flag that is guaranteed false in the deployed production build, or
  (b) drop this fallback entirely (email-sending delay risk is arguably better mitigated now anyway
  since Overpass/pub-data is pre-seeded and the rest of the stack has few other live-external-service
  dependencies left). Team decides at implementation time — not resolved by design review.
- Pub data → pre-generate a static JSON seed from Overpass before the event; no live Overpass calls
  during the demo at all (simpler and more reliable for judges than a live-cache design).
- BeerReal Cron time overrun → manual "Generate prompt" admin-route button.
- R2 bucket must never be made public as a time-pressure shortcut — signed URLs only; if the signing
  util is buggy under time pressure, extend the TTL rather than making the bucket public.
- EXIF/GPS metadata in uploaded photos is a known gap — flagged for post-hackathon hardening, not
  in scope for the 3-hour build.
- Minimal automated test plan (non-blocking for deploy, but should exist before the demo):
  `rating.test.ts` (Bayesian formula vs. hand-computed cases), `feed.test.ts` (buddies.status
  filtering correctness), run via `npm test`.
- Each cut is designed to retain core pub-crawl, photo-rating, and leaderboard demo value.

### Initial setup checklist (plan-level, no code written)
`wrangler.jsonc` with all bindings & migrations; R2 bucket "caneca-photos" (private); D1 DB
"caneca_db" + migration `001.sql` (incl. `buddies.status`, `activities` table); Queue "photo_infer";
Email domain verified + Turnstile keys issued; pub seed JSON generated from Overpass pre-event.

## Sessions

- architect: ses_0756b992effeC13yH46cbhdh8M (resumed 1x)
- challenger: ses_075686366ffe74AoN0gzSMkjSA (resumed 1x)
- security: ses_0756841eaffepajdDgo7589tRQ (resumed 1x)
- engineer: not started
- qa: not started

## Log

- Round 1 (design): architect produced full report (arch, CF product mapping, D1 schema, rating
  formula, AI pipeline, DO/WebSocket design, auth flow, BeerReal, deployment plan, 3h task breakdown,
  risk/fallback list). Two specific claims flagged for challenger/security to fact-check rather than
  take at face value: (a) "Pages preferred for SPAs" claim, (b) Workers AI model slug
  "@cf/unum/uform-v1". Sent to challenger + security in parallel.

- Round 1 verdicts: **FAIL / FAIL** (both). Revision count: 1.
  - Challenger FAIL — confirmed both flagged claims were wrong: (1) `@cf/unum/uform-v1` does not
    exist; real option is a current vision model, e.g. `@cf/meta/llama-3.2-11b-vision-instruct` or
    `@cf/llava-hf/llava-1.5-7b-hf`. (2) Pages-preferred claim is outdated — Workers Static Assets
    (single project, `assets.directory` in wrangler config) is current guidance and avoids
    cross-origin/cross-domain cookie issues that a split Pages+Workers deploy would hit. Also flagged:
    FeedRoomDO's per-user cross-subscription fan-out has no native DO-to-DO pub/sub in Cloudflare and is
    unrealistic to build in 3 hours as specified; no automated test plan for the rating-formula math or
    D1 queries.
  - Security FAIL — 2 blocking:
    1. WebSocket auth scheme is broken: can't both mark the session cookie `HttpOnly` *and* have
       frontend JS read it to re-sign — contradictory as written. The UA-salt also provides no real
       device-binding or replay protection. Fix: authenticate the WS upgrade request off the `Cookie`
       header server-side (standard DO pattern), drop the re-sign/salt step entirely (simpler too).
    2. `/auth/magic-link` has no Turnstile/rate-limit — unthrottled email-sending endpoint is an
       email-bombing / CF Email Sending abuse vector. Needs the same Turnstile+rate-limit treatment
       already planned for `/photos`.
    Notable non-blocking notes to fold in if reasonable: explicit `SameSite=Lax` on the session cookie;
    magic-link token should be deleted/invalidated on first use, not just TTL-bounded; `buddies` table
    needs a `status` (pending/accepted) column — as written it's unilateral following, which lets one
    user passively track another's real-time physical check-ins without consent; DemoSimulatorDO fake
    events need an explicit `demo:true`-style marker carried through to the wire payload (DO-level
    separation alone doesn't satisfy the Goal's "clearly labeled" requirement) plus a synthetic
    `demo_*` identity namespace (never reuse/attribute a real user id); R2 object keys should be
    ULID-based with short-TTL signed URLs, and "just make the bucket public" should be explicitly ruled
    out as an unreviewed time-pressure shortcut rather than a silent risk; no EXIF/GPS stripping
    mentioned for uploaded photos; Overpass caching should probably just be "seed D1 once, no live
    fetch during the demo" given the single-city scope. Also listed T2-gate items (DNS, first prod
    deploy, D1 migration, resource creation, secret provisioning) for the Manager to hold until
    engineer's stage, not architect's.
  - Routed: full consolidated feedback sent back to architect (same session) for revision.

- Round 2 (design revision): architect addressed all required + folded-in items. Design Report section
  above now reflects Round 2 directly (Round 1 content replaced, not kept side by side). Key changes:
  real model slug `@cf/llava-hf/llava-1.5-7b-hf`; single Workers-with-static-assets project (no Pages split);
  buddy feed moved from WS fan-out to D1-polling (`activities` table); WS auth reads `Cookie` header
  server-side instead of the broken re-sign scheme; Turnstile+rate-limit added to magic-link;
  `buddies.status`, cookie `SameSite=Lax`, single-use magic-link tokens, `demo:true`-tagged activity
  rows with `demo_`-prefixed ids, ULID R2 keys, and a minimal vitest plan all folded in; Overpass moved
  to a one-time pre-event seed instead of live fetching. Sent back to challenger + security (same
    sessions as Round 1) to verify the fixes actually land.

- Round 2 verdicts: **WARN (challenger) / FAIL (security)** → aggregate FAIL. Both Round 1 blocking
  items confirmed genuinely resolved by both reviewers (not reworded). This is the 2nd consecutive
  FAILed round on the design phase → per policy, stopping the auto-loop here and surfacing to the user
  instead of re-invoking architect a 3rd time.
  - Challenger WARN: model slug still wrong — `@cf/llava-hf/llava-1.5-7b-hf` is missing the `llava-hf`
    namespace segment; correct catalog id is `@cf/llava-hf/llava-1.5-7b-hf`. Everything else
    (single-Worker topology, D1-polling buddy feed, vitest plan) confirmed sound and buildable in 3h.
  - Security FAIL (1 blocking, newly introduced by the Round 2 redesign, not a Round 1 leftover): the
    `?devEmail=` dev-auth-bypass fallback (risk list) lost its "Pages preview only" scoping when the
    redesign collapsed to a single Worker/single deploy — as worded it's now an unscoped full auth
    bypass reachable on the one production URL judges hit. Needs an explicit build-time gate, or should
    be dropped now that the separate preview environment it relied on no longer exists.
  - Security non-blocking (worth folding in if there's another pass): BeerReal admin-route button has
    no admin/role concept anywhere in the schema (miss carried from Round 1, caught now) — needs a
    shared-secret header or hardcoded allowlist gate; `buddies.status` transition should be
    authorized so only the invited party (not the requester) can accept; new `/api/feed` should scope
    strictly to the authenticated session's own user id (IDOR discipline) and `demo` must not be
    client-writable; magic-link rate limit is IP-only, a per-email cap would be more complete; secrets
    must go through `wrangler secret put` now that everything is consolidated into one Worker/one
    blast radius.
  - T2 gate list reconfirmed (simplified — no more api.caneca.dev/CORS entries): DNS for caneca.dev,
    the single `wrangler deploy` (unambiguously production-from-first-deploy now), D1 migration incl.
    `buddies.status`/`activities`,     R2/D1/Queue/Turnstile/Email resource creation, secret provisioning.

- **Design phase closed by user decision**: presented with the 2 remaining items (devEmail-bypass
  scoping [blocking-per-security], model slug [WARN-per-challenger]), user chose "accept as-is with
  these as documented TODOs" rather than a 3rd revision round. Model slug corrected directly in the
  Design Report text above (unambiguous factual fix, sourced from challenger's exact string). devEmail
  bypass scoping left as an explicit open TODO inline in §11 for whoever implements Dev D's part — not
  resolved by design review, by the user's explicit choice. Design report is now FINAL for this round.
  Not proceeding to engineer/qa yet — this was a report/design request, not a build request. Awaiting
  user direction on whether to scaffold the project next.
