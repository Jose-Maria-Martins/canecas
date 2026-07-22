# Canecas photo pipeline prototype

This Worker accepts an image, stores it in private R2, starts a Cloudflare Workflow, asks Workers AI to validate and rate the visible beer, and records the R2 key and result in a SQLite-backed Durable Object.

The frontend can also request browser location and call `GET /api/pubs/nearest?lat=...&lon=...`. The Worker searches OpenStreetMap via Overpass within 5 km, caches the venue set by coarse location for one day, and returns a stable OSM pub ID. That ID is sent as `X-Caneca-Pub-Id` with the photo and retained with the result for pub-level aggregation. A stable coarse location bucket keeps the prototype usable when Overpass is unavailable.

## Flow

1. `POST /api/uploads` receives a raw JPEG, PNG, or WebP body up to 5 MiB.
2. The Worker checks the actual file signature and writes `submissions/<uuid>.<ext>` to private R2.
3. It creates a Workflow using the UUID as the id. Only metadata and the R2 key enter Workflow state.
4. The Workflow loads the image from R2 and calls `@cf/meta/llama-3.2-11b-vision-instruct`.
5. The Workflow writes the assessment to a sharded `PhotoResults` Durable Object.
6. `GET /api/uploads/:submissionId` returns `processing`, `complete`, `rejected`, or `failed`.
7. `/api/uploads/:submissionId/events` upgrades to a Durable Object WebSocket, sends the current row immediately, and pushes the final result when the Workflow saves it.

The Durable Object stores the private R2 object key, not a duplicate of the image bytes. A valid image without visible beer is retained but has a `null` score and `rejected` status.

## Setup

```bash
npm install
npx wrangler login
npx wrangler r2 bucket create caneca-photos
npm run deploy
```

The upload endpoint permits five attempts per minute per source IP before it reads the image body. Workflows and the SQLite-backed Durable Object namespace are created from `wrangler.jsonc` during deployment. Workers AI uses the account attached to Wrangler.

Before the first inference on a new account, accept the model's Meta license/AUP once:

```bash
curl "https://api.cloudflare.com/client/v4/accounts/$CLOUDFLARE_ACCOUNT_ID/ai/run/@cf/meta/llama-3.2-11b-vision-instruct" \
  -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"prompt":"agree"}'
```

`npm run deploy` builds the React SPA into `dist/` and deploys it with the API as one Worker. SPA fallback serves the frontend while `/api/*` always runs the Worker.

For local development, run `npm run build` and `npm run dev`. R2 and Durable Objects use local state; Workers AI requires access to the remote Cloudflare service. For frontend hot reload, keep the Worker on port 8787 and run `npm run dev:ui` in a second terminal; Vite proxies HTTP and WebSocket API traffic to the Worker.

## Try it

```bash
curl -X POST \
  -H "Content-Type: image/jpeg" \
  -H "Idempotency-Key: $(uuidgen | tr '[:upper:]' '[:lower:]')" \
  --data-binary @beer.jpg \
  https://YOUR-WORKER.workers.dev/api/uploads
```

Poll the returned `statusUrl`:

```bash
curl https://YOUR-WORKER.workers.dev/api/uploads/RETURNED_SUBMISSION_ID
```

The included React client opens an in-app rear-camera viewfinder, captures and compresses a JPEG, and sends it without multipart encoding:

```js
const response = await fetch("/api/uploads", {
  method: "POST",
  headers: {
    "Content-Type": file.type,
    "Idempotency-Key": crypto.randomUUID(),
  },
  body: file,
});
```

Turnstile is intentionally disabled for now. The rate limit remains, but this prototype still omits user sessions, EXIF stripping, and signed image retrieval. Add those controls before broader public exposure.
