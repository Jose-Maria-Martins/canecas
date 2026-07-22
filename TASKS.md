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
- NEW REQUIREMENT (added after Round 2): the AI pipeline must reject the submission instead of rating
  it when no beer is visible in the photo. Needs a design addition covering the exact check/prompt
  approach, the rejection response contract, whether/how a rejected attempt is persisted, and any
  abuse-angle implications (e.g. spamming junk images to burn Workers AI quota) — route to architect,
  then a fast targeted challenger+security pass, don't redo the whole design review.
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
1. `POST /api/photos` (authenticated session required, Turnstile-checked, rate-limited 10 req/min)
   checks a KV counter `bad_photo:{userId}` (1h TTL, incremented on rejections — see step 3). If
   already above 15, return `429` with `{"error":"TooManyRejectedPhotos"}` immediately, no AI spent.
   Otherwise the Worker writes the image straight to R2 (key `sub_<ULID>.jpg`), creates a `submissions`
   row with `rating = NULL` ("pending"), enqueues `{submissionId, r2Key}`, and returns `202` right
   away — no AI call happens in the request path, so the response never blocks on model latency.
2. Queue consumer: fetches the R2 object, calls Workers AI (`@cf/llava-hf/llava-1.5-7b-hf`) with a
   single combined prompt: *"Look at this photo. If there is no beer (glass, mug, can, or bottle)
   visible, respond with exactly -1. Otherwise, rate how appealing the beer looks from 0 (awful) to 5
   (amazing). Respond with ONLY a number."*
   - If the result is `-1`: increment `bad_photo:{userId}`, delete the `submissions` row created in
     step 1 and the R2 object — a rejected photo leaves no lasting DB/storage trace, only the KV
     throttle counter. (No synchronous response to reject here — the client already got `202` and
     should poll/see the submission disappear; frontend should treat "submission not found after a few
     seconds" as a rejection and show *"We couldn't find a beer in that photo — try a clearer shot."*)
   - Otherwise: parse the float, `UPDATE submissions SET rating = :rating WHERE id = :submissionId`,
     notify PubAggregatorDO via internal fetch.
3. PubAggregatorDO (one per pub_id): recalculates v/R/weighted_score, persists `pub_scores`, broadcasts
   `{t:"pubScore", pubId, score}` to connected WebSocket clients on `/ws/pub/:pubId`.
- Fallback: `AI_OFF` env toggle returns a stubbed random rating 2-4 (never returns -1, i.e. treats
  everything as an accepted beer) if inference latency/quota becomes a problem.
- Still one AI call per photo either way (classify and rate are the same call) — this was revised from
  an earlier two-call inline-classify draft after review found that approach would block the HTTP
  response on model latency and risk a Worker timeout; moving it fully into the async queue step fixes
  that at no extra AI cost.
- Throttle is a soft cap: the KV increment isn't atomic, so a tight concurrent burst could exceed 15
  briefly — acceptable for a hackathon build, and the existing 10 req/min endpoint-level rate limit is
  still a hard backstop on total volume regardless of outcome.
- `rating.test.ts` (§11) should include a case for the `-1` branch, not just valid 0-5 ratings.

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

- architect (main design thread): ses_0756b992effeC13yH46cbhdh8M (resumed 2x)
- architect (spec.md packaging check, separate fresh thread): ses_07541559effeAr8FCb6MEs7OYW (resumed 0x)
- challenger (main design thread): ses_075686366ffe74AoN0gzSMkjSA (resumed 2x)
- challenger (spec.md packaging check, separate fresh thread): ses_0753c37dfffeuw7ntL7WT9U0zQ (resumed 0x)
- security (main design thread): ses_0756841eaffepajdDgo7589tRQ (resumed 2x)
- security (spec.md packaging check, separate fresh thread): ses_0753c291affelU1YANfQTpd6Yc (resumed 0x)
- engineer: ses_07536a966ffeB24tknpazwTw92 (resumed 0x)
- qa: ses_0752dc40cffeUfRyEr1MvTLj3n (resumed 0x)

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

- **New requirement added**: AI pipeline must reject submissions with no beer visible. Trigger
  confirmed as "not a beer / no beer visible" only (not blur/NSFW/duplicate detection — out of scope).
  Routed to architect (resumed 2x) for a focused addendum, then challenger+security (both resumed 2x)
  for a fast targeted check (not a full re-review).
  - Architect's first addendum proposed: inline synchronous classify call in `/api/photos` before
    upload, 422 response on rejection, no DB row on reject, KV throttle 3/hour.
  - Verdicts: WARN (challenger) / PASS (security) → aggregate WARN, no stop-loop needed.
    - Challenger WARN: inline synchronous AI call blocks the HTTP response on model latency (Worker
      timeout risk) and breaks Dev C's existing timebox; recommended moving to a single combined
      classify+rate prompt inside the async Queue consumer instead, and loosening the throttle from
      3/hour (too strict — risks bricking a legitimate user/judge on an AI false-negative) to 10-20/hour.
    - Security PASS: throttle is meaningfully un-bypassable (keyed on server-derived `userId`, endpoint
      already requires auth); silent no-DB-trace rejection is fine (data minimization, no phantom feed
      events); 422/429 response bodies don't leak anything. Non-blocking: state the auth requirement
      explicitly in the pipeline text, and note the KV counter isn't atomic (soft cap only).
  - Since this was WARN (not FAIL) and challenger's fix was fully specified, folded it directly into
    §5 above rather than a 3rd architect round-trip: combined prompt now lives only in the Queue
    consumer (submission row created as "pending" at upload time, deleted on a `-1`/reject result),
    throttle raised to 15/hour, auth requirement stated explicitly, non-atomic-counter noted. This also
    resolved a consistency detail the WARN didn't spell out (what happens to the already-uploaded R2
    object / already-created submissions row when rejection is discovered asynchronously instead of
    synchronously) — deletes both on reject, consistent with the original "no lasting trace" intent.
    No changes needed to §10 task breakdown — Dev C's existing "queue consumer calling Workers AI"
    timebox already covers this, since the check moved into that same step rather than adding a new one.

- **Teammate hand-off document produced** (delivered directly in chat response, not duplicated here in
  full to avoid bloat — this file stays the internal tracking record). Derived from the Design Report
  above with the AI-rejection addendum folded in; all Manager-process content (session ids, resume
  counts, PASS/WARN/FAIL verdicts, revision-round history) stripped, since it's written for teammates'
  agents to act on directly. Split into 4 self-contained tracks matching §10's existing layer split, plus
  a shared section (schema, API surface, conventions, bindings list, timeline). The 2 still-open
  decisions (devEmail-bypass scoping, BeerReal admin-gate mechanism) are carried into it explicitly as
  "resolve during implementation" items, not silently dropped.

## Hand-off Document (final content — write verbatim to spec.md at repo root)

The content between the two "HANDOFF CONTENT" markers below is the exact, final teammate-facing spec.
It was originally delivered wrapped in a single outer markdown code fence for copy/paste purposes only —
that outer fence is NOT part of the document itself and must not appear in the committed spec.md.

<!-- HANDOFF CONTENT START -->

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

<!-- HANDOFF CONTENT END -->

## Sub-task: persist hand-off document as spec.md

New request: create `spec.md` at the repo root containing the hand-off document above, verbatim
(between the START/END markers, excluding the markers themselves and the now-irrelevant outer chat
fence). This is a repo change (new file + first-ever .gitignore), so it goes through the same
design→implement→verify pipeline as any other change, scoped tightly since the content itself is
already finalized and does not need re-design — only placement/formatting needs a design-level look
(e.g. the nested code fences inside the content must survive being written as a real file, and any
header/structure adjustments needed now that it's a standalone document rather than a chat message).

This is engineer's and QA's first invocation on this project. Per Housekeeping above, engineer must
also create `.gitignore` with at least a `TASKS.md` entry as part of this same invocation.

### Verdicts on the spec.md packaging plan

- Architect (fresh session): content is ready to commit as-is — strip only the outer chat-only fence
  and the HANDOFF marker lines, everything else renders fine as a normal .md file.
- Challenger (fresh): PASS, no revisions needed.
- Security (fresh): **WARN** — marker content itself is clean (no secrets/credentials; the
  `wrangler secret put` line is guidance text, not a leaked value). But it surfaced a real, separate
  finding while checking git state, unrelated to the content itself:
  - **`TASKS.md` is already tracked AND already pushed to `origin/main`, across 3 pre-existing commits**
    (`d5ab470`, `c408c96`, `6a55f76` — all titled "feat: report beta"/variants, all touching only
    TASKS.md). This happened outside this session — nothing in this conversation has run a commit or
    push. Corrects the Housekeeping note's "no .gitignore exists yet" framing, which implied an empty
    repo; the repo has history already.
  - Practical effect: adding a `TASKS.md` entry to `.gitignore` now only stops *future* commits of it —
    it's a no-op on the 3 already-pushed commits, whose content (including the Sessions/session-id
    block) stays in shared origin/main history regardless.
  - Those 3 commits also went directly to `main`, not a feature branch.
  - Real fix for the historical commits would be either `git rm --cached TASKS.md` (safe, reversible,
    but still needs a human commit — T3 blocks that for engineer) or, if fully purging it from history
    is wanted, a history rewrite + force-push on `main` — explicitly a "genuinely destructive/irreversible
    action on a shared branch" needing sign-off before anyone runs it, not something to route to
    engineer as a routine fix.
  - T2_GATE_REQUIRED: no, for spec.md/.gitignore creation as scoped (routine additive file ops). Flag
    only if remediation of the historical-commit issue ends up needing the history-rewrite path.
- Aggregate: WARN (security's content-scoped verdict is fine; the git-history finding is a separate,
  out-of-band discovery, not a reason to fail this sub-task's own plan). Proceeding with spec.md +
  forward-looking .gitignore creation now (safe, additive, doesn't foreclose any remediation choice).
  Historical-commit question raised to the user directly rather than resolved automatically.

### Engineer + QA results (both first invocation on this project)

- **Engineer** (ses_07536a966ffeB24tknpazwTw92): created `spec.md` (verbatim per the marked content).
  Ran only read-only git commands to investigate, no mutations. Found mid-task that commit `26d60de`
  ("feat: map/frontend layer...", author Joana Azevedo — a full Vite/React/MapLibre Track-A scaffold,
  34 files) had landed directly on `main` and was already pushed to origin, since the task started —
  this already included its own correct `.gitignore` with a `TASKS.md` entry. Engineer had already
  drafted its own `.gitignore` before noticing this; restored it to byte-identical match with the
  already-pushed version rather than leaving a competing draft (verified via `git diff --exit-code`,
  clean). Drafted a commit message for `spec.md` and recommended a feature branch, not `main`, given
  `main` already has one direct-push incident today.
- **QA** (ses_0752dc40cffeUfRyEr1MvTLj3n): independently byte-diffed `spec.md` against the marker
  section of this file — identical (MD5 match, 253 lines/14893 bytes, no whitespace/newline drift).
  Markdown structurally sound (balanced fences, sequential headings, no truncation/encoding issues).
  `.gitignore`'s `TASKS.md` entry syntactically correct and confirmed via `git check-ignore --no-index`
  (caveat: no practical effect while the file stays tracked — same limitation security already flagged
  for the 3 pre-existing commits, now independently confirmed rather than taken on faith).
  **Working tree is clean** — not because nothing happened, but because everything is already
  committed AND pushed to `origin/main`:
  - `26d60de` Joana Azevedo — the Track A scaffold (as Engineer found).
  - `b06433d` ddacruz — message says "feat: spec.md" but the diff only touches `TASKS.md`.
  - `3511322` ddacruz — also "feat: spec.md" (identical message to the commit above), this is the one
    that actually adds `spec.md`.
  None of these three commits were made by anything in this session — nothing here has git write
  access, and Engineer/QA both confirm they ran read-only commands only. QA verdict: WARN (content
  itself is fully correct; the git-provenance/process findings are what keep it off PASS).

### Status: spec.md sub-task — content complete and verified; git-process findings need user input

`spec.md` exists, is correct, and is (per QA) already on `origin/main`. Given the content has now been
independently confirmed correct four separate times (architect's plan check, challenger's PASS, and now
Engineer's + QA's own byte-level verification), not running a further content-focused
challenger/security pass on the exact same unchanged text — there's no new content-signal left to
review. What's actually new and unresolved is the git situation, raised directly with the user rather
than acted on unilaterally:
1. A second direct-to-`main` push (Joana Azevedo's Track A scaffold), following the same pattern as the
   original TASKS.md commits.
2. Two more direct-to-`main` commits (under the user's own local identity, `ddacruz`) landed the
   TASKS.md sub-task text and `spec.md` itself — bypassing the standing "draft a commit message, never
   commit/push yourself" instruction this Manager operates under. Nothing in this session ran them.
3. Minor hygiene: `b06433d`'s message doesn't match its diff (duplicate "feat: spec.md" message reused
   across two different commits).
No history rewrite, force-push, or any other destructive action has been taken or proposed — flagging
only, per standing policy on git actions of this kind.
