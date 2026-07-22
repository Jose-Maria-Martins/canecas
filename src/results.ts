import type { Env } from "./worker-types";

export function getPhotoResults(env: Env, submissionId: string) {
  const shard = submissionId.replaceAll("-", "").slice(0, 2);
  return env.PHOTO_RESULTS.get(env.PHOTO_RESULTS.idFromName(shard));
}
