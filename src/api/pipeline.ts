interface PipelineUploadResponse {
  submissionId: string;
  error?: string;
}

export interface PipelineResult {
  submissionId: string;
  status: "processing" | "complete" | "rejected" | "failed";
  score: number | null;
  reason: string;
}

export async function uploadPhoto(input: {
  pubId: string;
  file: File;
  latitude: number;
  longitude: number;
}): Promise<string> {
  const response = await fetch("/api/uploads", {
    method: "POST",
    headers: {
      "Content-Type": input.file.type || "image/jpeg",
      "Idempotency-Key": crypto.randomUUID(),
      "X-Caneca-Pub-Id": normalizePubId(input.pubId),
      "X-Caneca-Latitude": String(input.latitude),
      "X-Caneca-Longitude": String(input.longitude),
    },
    body: input.file,
  });
  const body = (await response.json()) as PipelineUploadResponse;
  if (!response.ok) throw new Error(body.error || "Photo upload failed");
  return body.submissionId;
}

export async function getPipelineResult(id: string): Promise<PipelineResult> {
  const response = await fetch(`/api/uploads/${encodeURIComponent(id)}`);
  const body = (await response.json()) as PipelineResult & { error?: string };
  if (!response.ok) throw new Error(body.error || "Could not retrieve the rating");
  return body;
}

function normalizePubId(pubId: string): string {
  const osm = pubId.match(/^(node|way|relation)\/(\d+)$/);
  return osm ? `osm:${osm[1]}:${osm[2]}` : pubId;
}
