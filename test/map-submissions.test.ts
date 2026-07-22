import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

describe("MapSubmissions", () => {
  it("stores a location-tagged rating once and returns newest first", async () => {
    const index = env.MAP_SUBMISSIONS.get(env.MAP_SUBMISSIONS.idFromName("test-map"));
    const submissionId = crypto.randomUUID();

    await index.upsert({
      submissionId,
      latitude: 51.5074,
      longitude: -0.1278,
      score: 4.2,
      reason: "A bright, tidy pour.",
      createdAt: Date.now(),
    });

    await expect(index.list(10)).resolves.toContainEqual({
      submissionId,
      latitude: 51.5074,
      longitude: -0.1278,
      score: 4.2,
      reason: "A bright, tidy pour.",
      createdAt: expect.any(Number),
    });
  });
});
