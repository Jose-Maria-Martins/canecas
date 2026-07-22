import type { MapSubmission } from "./types";

interface MapSubmissionsResponse {
  submissions: MapSubmission[];
}

export async function fetchMapSubmissions(signal?: AbortSignal): Promise<MapSubmission[]> {
  const response = await fetch("/api/map/submissions?limit=100", { signal });
  if (!response.ok) {
    throw new Error("The pint map could not be loaded.");
  }

  const body = (await response.json()) as MapSubmissionsResponse;
  return body.submissions;
}
