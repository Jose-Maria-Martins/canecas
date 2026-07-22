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

## Design Report (Round 1, from architect)

### 1. High-level architecture
- Frontend SPA (MapLibre + React/Tailwind) hosted on Cloudflare Pages (static assets + Pages Functions
  if needed), talks to a REST/JSON API on a dedicated Workers service.
- Workers API (TypeScript): routes /auth, /pubs, /photos, /feed, /beerreal, /challenge, etc. Stateless,
  per-route bindings to KV, D1, R2, DOs, Queues, AI.
- Data stores: D1 (relational — users, pubs, submissions, XP), KV (sessions + Overpass cache + feature
  flags), R2 (raw beer photo objects), Durable Objects (① per-user FeedRoom, ② pub RatingAggregator,
  ③ dev DemoSimulator), Queues (photo → AI decoupling).
- AI pipeline: photo → Queue → consumer Worker → Workers AI vibe-rating model → D1 update.
- Real-time: client WebSocket ⇔ DO FeedRoom streaming JSON events (buddy check-ins, new photos,
  level-ups).
- Only non-Cloudflare pieces: MapLibre tile CDN + OSM Overpass API (read-only), justified since
  Cloudflare has no maps product.

### 2. Cloudflare product mapping
- Frontend hosting: Cloudflare Pages + Pages Functions — architect asserts "current docs (2026-07)
  state Pages is preferred for SPAs." **UNVERIFIED — flagged for challenger/security to fact-check**,
  since Cloudflare's guidance has been shifting toward Workers + static assets for new projects.
- API/compute: Cloudflare Workers (separate service from Pages) for routing/secrets isolation.
- Relational data: D1 (SQLite-compat, fits hackathon scale).
- Image storage: R2, signed URLs to avoid proxying blobs through Workers.
- Vision scoring: Workers AI, model slug given as "@cf/unum/uform-v1" — **UNVERIFIED — flagged**,
  a uform-family image-to-text model exists in the Workers AI catalog but the exact slug needs
  confirming before treating it as final.
- Async: Workers Queues, decouples upload latency from AI inference.
- Real-time feed: Durable Objects + WebSockets, per-user room + fan-out.
- Caching/sessions: Workers KV, <1ms reads, TTL for magic-link session tokens + Overpass JSON blobs.
- Cron: Workers Cron Triggers — daily BeerReal prompt 10:00, weekly challenge rotation Sun 00:00.
- Email auth: Cloudflare Email Sending (beta) for magic-link emails, avoids third-party ESP.
- Abuse control: Turnstile on photo submission + Cloudflare Rate Limiting Rules on /photos & AI queue.
- Map tiles: MapLibre GL JS + OSM/MapTiler CDN (documented exception, no CF maps product).

### 3. D1 schema sketch
- users(id PK ULID, email UNIQUE, display_name, created_at, xp, level)
- sessions: KV key "sess:{token}" → userId, TTL 24h (not D1)
- pubs(id PK osm_id, name, lat, lon, address, osm_raw JSON, created_at)
- submissions(id PK ULID, user_id FK, pub_id FK, photo_url [R2 key], rating REAL 0-5 [set by AI],
  created_at)
- pub_scores(pub_id PK, avg_rating, weighted_score, rating_count) — materialized by aggregator DO
- buddies(user_id FK, buddy_id FK, PK(user_id, buddy_id))
- challenges(id PK, type ['daily'|'weekly'], title, xp, starts_at, ends_at)
- challenge_completions(challenge_id FK, user_id FK, completed_at, PK(challenge_id, user_id))
- beerreal_prompts(id PK, prompt, created_at)
- beerreal_responses(id PK, prompt_id FK, user_id FK, submission_id FK, created_at)

### 4. Pub aggregate-rating formula
Bayesian/IMDB-style weighted average:
`weighted_score = (v / (v + m)) * R + (m / (v + m)) * C`
where R = mean rating for the pub, v = number of ratings for the pub, m = 5 (minimum-ratings
confidence constant), C = global mean rating across all pubs (kept as a daily KV snapshot). New pubs
stay near the global mean until 5+ photos are submitted.

### 5. AI pipeline
1. POST /photos (auth'd) → Worker validates Turnstile, writes to R2, enqueues {submissionId, r2Key},
   returns 202.
2. Queue consumer: fetches R2 object, calls Workers AI with prompt "Rate the vibe of this beer photo
   from 0 (unappealing) to 5 (excellent) as a float," parses float, updates submissions.rating, notifies
   RatingAggregator DO via internal fetch.
3. RatingAggregatorDO (one per pub_id): recalculates v/R/weighted_score, persists pub_scores, broadcasts
   `{type:"pubScore", pubId, weightedScore}` to connected FeedRoom DOs.
- Flagged fallback: if inference is fast enough, Queue could be skipped and call made synchronously
  (see risk list below) — architect lists Queue removal as an explicit cut-first fallback, not core.

### 6. Real-time design
- FeedRoomDO (name "feed:{userId}"): verifies session token HMAC on WS connect, loads buddy ids,
  subscribes to their activity, broadcasts JSON lines like
  `{"t":"checkin"|"rating"|"level","uid":...,"pub":{...},"val":...,"ts":...}`.
- RatingAggregatorDO: per-pub, as above.
- DemoSimulatorDO ("simulator"): pushes fake events every 3s during the demo on a separate
  namespace/binding flagged `DEMO=true`, explicitly kept separate from the production path so fake and
  real data aren't conflated.

### 7. Auth flow
1. POST /auth/magic-link: Worker generates token (ULID + HMAC(email, secret)), stores in KV TTL 15min,
   sends email via CF Email Service with a /verify?token=... link.
2. GET /auth/verify: validates token+TTL, upserts user in D1, issues session cookie
   (`Set-Cookie: caneca_sess={signedToken}; Secure; HttpOnly; Path=/; Max-Age=86400`).
3. Subsequent REST calls: cookie → KV lookup → userId.
4. WebSocket auth: frontend re-signs the cookie value with a SHA256 UA salt, passes via
   `Sec-WebSocket-Protocol: sess,<sig>`; FeedRoomDO validates before accepting the connection.

### 8. BeerReal
Cron 10:00 local → Worker inserts a beerreal_prompts row, emits `{t:"beerreal", promptId, text}` to
every online FeedRoomDO. Frontend shows a modal; the next photo upload is tagged with promptId; on
completion the user gains XP via challenges (type=daily).

### 9. Deployment plan
- Pages project "caneca-web" (main branch → production, `npm run build` → /dist).
- Workers project "caneca-api" with wrangler.toml bindings: D1 `caneca_db`, KV `SESSIONS`/
  `GLOBAL_CACHE`, R2 `BEER_PHOTOS`, Queue `PHOTO_INFER`, AI `uform`, DOs `FEED_ROOM`/`PUB_AGG`/
  `SIMULATOR`, Email binding.
- `wrangler deploy` once during the build; Cron + Queues via wrangler. DNS: caneca.dev → Pages,
  api.caneca.dev → Workers route, CORS allow *.caneca.dev.

### 10. 3-hour task breakdown (by layer)
- T-0:00–0:15 (all): kickoff, clone repo, CF account/token access.
- Dev A (map/frontend): 0:15-1:10 Vite+React+MapLibre scaffold & pub markers; 1:10-2:00 photo upload
  UI, BeerReal modal, buddy feed sidebar (WS); 2:00-2:45 challenge/XP display, Turnstile widget,
  polish; 2:45-3:00 smoke test/deploy Pages.
- Dev B (gamification/backend logic): 0:15-0:45 D1 schema + wrangler bindings + migration;
  0:45-1:45 /pubs (Overpass fetch+cache), /challenge, XP update, pub score endpoint;
  1:45-2:45 RatingAggregatorDO; 2:45-3:00 seed DB + run demo feed simulator.
- Dev C (AI+photo pipeline): 0:15-0:45 R2 + signed URL + /photos handler incl. Turnstile verify;
  0:45-1:15 PHOTO_INFER queue + enqueue logic; 1:15-2:00 queue consumer calling Workers AI;
  2:00-2:30 hook to RatingAggregatorDO + local test; 2:30-3:00 load test w/ 10 sample images.
- Dev D (auth+data/infra): 0:15-0:40 magic-link flow, Email service setup, session cookie util;
  0:40-1:30 FeedRoomDO auth handshake/WS upgrade; 1:30-2:15 Cron triggers (BeerReal + weekly
  challenge); 2:15-2:45 rate-limiting rules (dashboard), Turnstile secret intake; 2:45-3:00 e2e auth
  walkthrough.
- Integration gates: 1:45 API route signatures frozen; 2:45 cross-layer system test; 3:00 submission.

### 11. Risk flags & cut-first fallbacks
- Workers AI latency/quota exhaustion → stub random rating 2-4 behind `AI_OFF` env toggle.
- Queue consumer complexity → call AI synchronously in /photos handler, drop the Queue binding.
- Email sending delays → dev-mode auth bypass via `?devEmail=` query param on Pages preview.
- WebSocket handshake bugs → poll /feed every 3s over HTTP until fixed.
- Map/Overpass rate limits → preload a static list of 20 pubs from repo JSON, skip live fetch.
- BeerReal Cron time overrun → manual "Generate prompt" admin-route button.
- Each cut is designed to retain core pub-crawl, photo-rating, and leaderboard demo value.

### Initial setup checklist (plan-level, no code written)
wrangler.toml with all bindings & migrations; Pages project linked to main; R2 bucket "caneca-photos";
D1 DB "caneca_db" + migration 001.sql; Queue "photo_infer"; Email domain verified + Turnstile keys
issued; Rate Limiting rule template saved but disabled until live test.

## Sessions

- architect: ses_0756b992effeC13yH46cbhdh8M (resumed 0x)
- challenger: ses_075686366ffe74AoN0gzSMkjSA (resumed 0x)
- security: ses_0756841eaffepajdDgo7589tRQ (resumed 0x)
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
