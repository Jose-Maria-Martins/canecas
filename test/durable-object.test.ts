import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

describe("PhotoResults", () => {
  it("keeps assessment fields unknown while processing", async () => {
    const submissionId = crypto.randomUUID();
    const results = env.PHOTO_RESULTS.get(env.PHOTO_RESULTS.idFromName(submissionId.slice(0, 2)));

    await results.createPending({
      submissionId,
      objectKey: `submissions/${submissionId}.jpg`,
      contentType: "image/jpeg",
      pubId: "osm:node:123",
    });

    await expect(results.getResult(submissionId)).resolves.toMatchObject({
      status: "processing",
      isImage: null,
      isBeer: null,
      score: null,
    });
  });

  it("does not downgrade a completed result during a replayed failure", async () => {
    const submissionId = crypto.randomUUID();
    const results = env.PHOTO_RESULTS.get(env.PHOTO_RESULTS.idFromName(submissionId.slice(0, 2)));

    await results.createPending({
      submissionId,
      objectKey: `submissions/${submissionId}.jpg`,
      contentType: "image/jpeg",
      pubId: null,
    });
    await results.complete(submissionId, {
      isImage: true,
      isBeer: true,
      score: 4.5,
      reason: "A handsome pint.",
    });
    await results.fail(submissionId, "Late RPC failure");

    await expect(results.getResult(submissionId)).resolves.toMatchObject({
      status: "complete",
      score: 4.5,
      reason: "A handsome pint.",
    });
  });
});
