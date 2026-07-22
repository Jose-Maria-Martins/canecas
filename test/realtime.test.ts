import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

describe("photo result realtime updates", () => {
  it("sends current state and pushes the completed assessment", async () => {
    const submissionId = crypto.randomUUID();
    const results = env.PHOTO_RESULTS.get(
      env.PHOTO_RESULTS.idFromName(submissionId.replaceAll("-", "").slice(0, 2)),
    );
    await results.createPending({
      submissionId,
      objectKey: `submissions/${submissionId}.jpg`,
      contentType: "image/jpeg",
      pubId: null,
    });

    const response = await results.fetch(
      new Request(`https://caneca.test/api/uploads/${submissionId}/events`, {
        headers: { Upgrade: "websocket" },
      }),
    );
    const socket = response.webSocket;
    expect(response.status).toBe(101);
    expect(socket).not.toBeNull();

    const pendingMessage = nextMessage(socket!);
    socket!.accept();
    await expect(pendingMessage).resolves.toMatchObject({ status: "processing" });

    const completedMessage = nextMessage(socket!);
    await results.complete(submissionId, {
      isImage: true,
      isBeer: true,
      score: 4.4,
      reason: "A bright pour with a tidy head.",
    });
    await expect(completedMessage).resolves.toMatchObject({
      status: "complete",
      score: 4.4,
    });

    socket!.close(1000, "Test complete");
  });
});

function nextMessage(socket: WebSocket): Promise<Record<string, unknown>> {
  return new Promise((resolve) => {
    socket.addEventListener(
      "message",
      (event) => resolve(JSON.parse(event.data as string) as Record<string, unknown>),
      { once: true },
    );
  });
}
