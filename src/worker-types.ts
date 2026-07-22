import type { PhotoResults } from "./durable-object";
import type { MapSubmissions } from "./map-submissions";

export type PhotoStatus = "processing" | "complete" | "rejected" | "failed";

export interface PhotoWorkflowParams {
  submissionId: string;
  objectKey: string;
  contentType: SupportedImageType;
  pubId: string | null;
  latitude?: number;
  longitude?: number;
}

export interface MapSubmission {
  submissionId: string;
  latitude: number;
  longitude: number;
  score: number;
  reason: string;
  createdAt: number;
}

export interface PhotoAssessment {
  isImage: boolean;
  isBeer: boolean;
  score: number | null;
  reason: string;
}

export interface PhotoResult extends PhotoWorkflowParams {
  status: PhotoStatus;
  isImage: boolean | null;
  isBeer: boolean | null;
  score: number | null;
  reason: string;
  createdAt: number;
  completedAt: number | null;
}

export type SupportedImageType = "image/jpeg" | "image/png" | "image/webp";

export interface Env {
  AI: Ai;
  BEER_PHOTOS: R2Bucket;
  MAP_SUBMISSIONS: DurableObjectNamespace<MapSubmissions>;
  PHOTO_RESULTS: DurableObjectNamespace<PhotoResults>;
  PHOTO_WORKFLOW: Workflow;
  UPLOAD_RATE_LIMITER: RateLimit;
}
