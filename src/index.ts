import { detectImageType, MAX_UPLOAD_BYTES } from "./assessment";
import { PhotoResults } from "./durable-object";
import { MapSubmissions } from "./map-submissions";
import { isValidPubId, lookupNearestPub, PUB_SEARCH_RADIUS_METERS } from "./pubs";
import { getPhotoResults } from "./results";
import type { Env, PhotoWorkflowParams, SupportedImageType } from "./worker-types";
import { readBodyWithLimit } from "./upload";
import { PhotoAssessmentWorkflow } from "./workflow";

export { MapSubmissions, PhotoAssessmentWorkflow, PhotoResults };

const EXTENSIONS: Record<SupportedImageType, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === "GET" && url.pathname === "/api/pubs/nearest") {
      return getNearestPub(url, ctx);
    }

    if (request.method === "POST" && url.pathname === "/api/uploads") {
      return createUpload(request, env);
    }

    if (request.method === "GET" && url.pathname === "/api/map/submissions") {
      return getMapSubmissions(url, env);
    }

    const imageMatch = url.pathname.match(/^\/api\/uploads\/([0-9a-f-]+)\/image$/);
    if (request.method === "GET" && imageMatch) {
      return getUploadImage(imageMatch[1], env);
    }

    const match = url.pathname.match(/^\/api\/uploads\/([0-9a-f-]+)$/);
    if (request.method === "GET" && match) {
      return getUpload(match[1], env);
    }

    const eventsMatch = url.pathname.match(/^\/api\/uploads\/([0-9a-f-]+)\/events$/);
    if (request.method === "GET" && eventsMatch) {
      return streamUpload(eventsMatch[1], request, env);
    }

    if (request.method === "GET" && url.pathname === "/") {
      return Response.json({
        service: "Canecas photo pipeline",
        upload: "POST an image body to /api/uploads",
        status: "GET /api/uploads/:submissionId",
      });
    }

    return jsonError(404, "Not found");
  },
} satisfies ExportedHandler<Env>;

async function createUpload(request: Request, env: Env): Promise<Response> {
  const rateLimitKey = request.headers.get("cf-connecting-ip") ?? "unknown";
  const rateLimit = await env.UPLOAD_RATE_LIMITER.limit({ key: rateLimitKey });
  if (!rateLimit.success) {
    return jsonError(429, "Too many uploads. Please wait a minute and try again");
  }

  const idempotencyKey = request.headers.get("idempotency-key");
  if (idempotencyKey && !isUuid(idempotencyKey)) {
    return jsonError(400, "Idempotency-Key must be a UUID v4");
  }
  const submissionId = idempotencyKey ?? crypto.randomUUID();
  const requestedPubId = request.headers.get("x-caneca-pub-id");
  if (requestedPubId && !isValidPubId(requestedPubId)) {
    return jsonError(400, "Invalid pub ID");
  }
  const pubId = requestedPubId || null;
  const latitudeHeader = request.headers.get("x-caneca-latitude");
  const longitudeHeader = request.headers.get("x-caneca-longitude");
  if ((latitudeHeader === null) !== (longitudeHeader === null)) {
    return jsonError(400, "Latitude and longitude must be provided together");
  }
  const latitude = latitudeHeader === null ? undefined : Number(latitudeHeader);
  const longitude = longitudeHeader === null ? undefined : Number(longitudeHeader);
  if (latitude !== undefined && (!Number.isFinite(latitude) || latitude < -90 || latitude > 90)) {
    return jsonError(400, "Invalid upload latitude");
  }
  if (
    longitude !== undefined &&
    (!Number.isFinite(longitude) || longitude < -180 || longitude > 180)
  ) {
    return jsonError(400, "Invalid upload longitude");
  }
  const results = getPhotoResults(env, submissionId);
  const existing = await results.getResult(submissionId);
  if (existing) {
    return Response.json(existing, { status: existing.status === "processing" ? 202 : 200 });
  }

  const declaredLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_UPLOAD_BYTES) {
    return jsonError(413, `Image must be at most ${MAX_UPLOAD_BYTES} bytes`);
  }

  const bytes = await readBodyWithLimit(request.body, MAX_UPLOAD_BYTES);
  if (bytes === null) {
    return jsonError(413, `Image must be at most ${MAX_UPLOAD_BYTES} bytes`);
  }
  if (bytes.byteLength === 0) {
    return jsonError(400, "Request body is empty");
  }

  const contentType = detectImageType(bytes);
  if (!contentType) {
    return jsonError(415, "Only JPEG, PNG, and WebP uploads are supported");
  }

  const declaredType = request.headers.get("content-type")?.split(";", 1)[0];
  if (declaredType?.startsWith("image/") && declaredType !== contentType) {
    return jsonError(415, "Content-Type does not match the image bytes");
  }

  const objectKey = `submissions/${submissionId}.${EXTENSIONS[contentType]}`;
  const params: PhotoWorkflowParams = {
    submissionId,
    objectKey,
    contentType,
    pubId,
    latitude,
    longitude,
  };

  await env.BEER_PHOTOS.put(objectKey, bytes, {
    httpMetadata: { contentType },
    customMetadata: pubId ? { submissionId, pubId } : { submissionId },
  });

  try {
    await results.createPending(params);
  } catch {
    await env.BEER_PHOTOS.delete(objectKey);
    return jsonError(503, "Could not initialize the image assessment");
  }

  try {
    const workflow = await env.PHOTO_WORKFLOW.create({
      id: submissionId,
      params,
    });

    return Response.json(
      {
        submissionId,
        workflowId: workflow.id,
        status: "processing",
        statusUrl: `/api/uploads/${submissionId}`,
      },
      { status: 202 },
    );
  } catch (error) {
    try {
      const existingWorkflow = await env.PHOTO_WORKFLOW.get(submissionId);
      const workflowStatus = await existingWorkflow.status();
      if (workflowStatus.status !== "unknown") {
        return Response.json(
          {
            submissionId,
            workflowId: existingWorkflow.id,
            status: "processing",
            statusUrl: `/api/uploads/${submissionId}`,
          },
          { status: 202 },
        );
      }
    } catch {
      // The original create error below is more useful than a reconciliation error.
    }

    const message = error instanceof Error ? error.message : "Could not start workflow";
    await results.fail(submissionId, message);
    return jsonError(503, "The image was stored, but its assessment could not be started");
  }
}

async function getNearestPub(url: URL, ctx: ExecutionContext): Promise<Response> {
  const lat = Number(url.searchParams.get("lat"));
  const lon = Number(url.searchParams.get("lon"));
  if (!Number.isFinite(lat) || lat < -90 || lat > 90) {
    return jsonError(400, "lat must be between -90 and 90");
  }
  if (!Number.isFinite(lon) || lon < -180 || lon > 180) {
    return jsonError(400, "lon must be between -180 and 180");
  }

  const pub = await lookupNearestPub(lat, lon, ctx);
  return Response.json(
    { pub, searchRadiusMeters: PUB_SEARCH_RADIUS_METERS },
    { headers: { "Cache-Control": "private, max-age=60" } },
  );
}

async function getUpload(submissionId: string, env: Env): Promise<Response> {
  if (!isUuid(submissionId)) {
    return jsonError(400, "Invalid submission ID");
  }

  const result = await getPhotoResults(env, submissionId).getResult(submissionId);
  return result ? Response.json(result) : jsonError(404, "Submission not found");
}

async function getUploadImage(submissionId: string, env: Env): Promise<Response> {
  if (!isUuid(submissionId)) {
    return jsonError(400, "Invalid submission ID");
  }

  const result = await getPhotoResults(env, submissionId).getResult(submissionId);
  if (!result || result.status !== "complete" || !result.isBeer) {
    return jsonError(404, "Completed beer image not found");
  }

  const object = await env.BEER_PHOTOS.get(result.objectKey);
  if (!object) {
    return jsonError(404, "Image not found");
  }

  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("Cache-Control", "public, max-age=3600");
  headers.set("Content-Disposition", "inline");
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("X-Robots-Tag", "noindex, noimageindex");
  return new Response(object.body, { headers });
}

async function getMapSubmissions(url: URL, env: Env): Promise<Response> {
  const requestedLimit = Number(url.searchParams.get("limit") ?? 100);
  const limit = Number.isFinite(requestedLimit) ? requestedLimit : 100;
  const index = env.MAP_SUBMISSIONS.get(env.MAP_SUBMISSIONS.idFromName("global"));
  const submissions = await index.list(limit);

  return Response.json({
    submissions: submissions.map((submission) => ({
      ...submission,
      imageUrl: `/api/uploads/${submission.submissionId}/image`,
    })),
  });
}

async function streamUpload(
  submissionId: string,
  request: Request,
  env: Env,
): Promise<Response> {
  if (!isUuid(submissionId)) {
    return jsonError(400, "Invalid submission ID");
  }
  if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
    return jsonError(426, "Expected a WebSocket upgrade");
  }

  return getPhotoResults(env, submissionId).fetch(request);
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(
    value,
  );
}

function jsonError(status: number, error: string): Response {
  return Response.json({ error }, { status });
}
