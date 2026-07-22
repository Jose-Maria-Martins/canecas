import { describe, expect, it } from "vitest";
import { detectImageType, parseAssessmentResponse } from "../src/assessment";
import { readBodyWithLimit } from "../src/upload";

describe("detectImageType", () => {
  it("detects supported image signatures", () => {
    expect(detectImageType(Uint8Array.from([0xff, 0xd8, 0xff]))).toBe("image/jpeg");
    expect(
      detectImageType(Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 13, 10, 26, 10])),
    ).toBe("image/png");
    expect(detectImageType(new TextEncoder().encode("RIFF0000WEBP"))).toBe("image/webp");
  });

  it("rejects a claimed image without an image signature", () => {
    expect(detectImageType(new TextEncoder().encode("not an image"))).toBeNull();
  });
});

describe("readBodyWithLimit", () => {
  it("stops reading a chunked body once it exceeds the limit", async () => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(Uint8Array.from([1, 2, 3]));
        controller.enqueue(Uint8Array.from([4, 5, 6]));
        controller.close();
      },
    });

    await expect(readBodyWithLimit(body, 5)).resolves.toBeNull();
  });

  it("combines a body within the limit", async () => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(Uint8Array.from([1, 2]));
        controller.enqueue(Uint8Array.from([3]));
        controller.close();
      },
    });

    await expect(readBodyWithLimit(body, 3)).resolves.toEqual(Uint8Array.from([1, 2, 3]));
  });
});

describe("parseAssessmentResponse", () => {
  it("computes the beer score from independent visual grades", () => {
    expect(
      parseAssessmentResponse({
        response: JSON.stringify({
          isImage: true,
          isBeer: true,
          head: "excellent",
          pour: "good",
          glass: "fair",
          colour: "excellent",
          presentation: "good",
          reason: "A bright pint with a strong head in an ordinary glass.",
        }),
      }),
    ).toEqual({
      isImage: true,
      isBeer: true,
      score: 3.9,
      reason: "A bright pint with a strong head in an ordinary glass.",
    });
  });

  it("normalizes a valid beer score", () => {
    expect(
      parseAssessmentResponse({
        response:
          '```json\n{"isImage":true,"isBeer":true,"score":4.26,"reason":"Great head and colour."}\n```',
      }),
    ).toEqual({
      isImage: true,
      isBeer: true,
      score: 4.3,
      reason: "Great head and colour.",
    });
  });

  it("does not assign a score when no beer is visible", () => {
    expect(
      parseAssessmentResponse({
        response:
          '{"isImage":true,"isBeer":false,"score":4,"reason":"This is a landscape."}',
      }),
    ).toEqual({
      isImage: true,
      isBeer: false,
      score: null,
      reason: "This is a landscape.",
    });
  });

  it("accepts the REST response envelope returned by remote bindings", () => {
    expect(
      parseAssessmentResponse({
        result: {
          response:
            '{"isImage":true,"isBeer":true,"score":3.8,"reason":"A tidy pour."}',
        },
      }),
    ).toEqual({
      isImage: true,
      isBeer: true,
      score: 3.8,
      reason: "A tidy pour.",
    });
  });

  it("accepts a response that Workers AI has already decoded", () => {
    expect(
      parseAssessmentResponse({
        response: {
          isImage: true,
          isBeer: true,
          score: 4.1,
          reason: "Bright colour and a clean head.",
        },
        tool_calls: [],
        usage: { completion_tokens: 42 },
      }),
    ).toEqual({
      isImage: true,
      isBeer: true,
      score: 4.1,
      reason: "Bright colour and a clean head.",
    });
  });

  it("prefers typed assessment tool arguments", () => {
    expect(
      parseAssessmentResponse({
        response: null,
        tool_calls: [
          {
            name: "submit_assessment",
            arguments: {
              isImage: true,
              isBeer: true,
              score: 4.4,
              reason: "A crisp pour with a lasting head.",
            },
          },
        ],
      }),
    ).toEqual({
      isImage: true,
      isBeer: true,
      score: 4.4,
      reason: "A crisp pour with a lasting head.",
    });
  });

  it("normalizes scores returned on other common scales", () => {
    expect(
      parseAssessmentResponse({
        response: '{"isImage":true,"isBeer":true,"score":8,"reason":"Beer."}',
      }).score,
    ).toBe(4);
    expect(
      parseAssessmentResponse({
        response: '{"isImage":true,"isBeer":true,"score":"80/100","reason":"Beer."}',
      }).score,
    ).toBe(4);
  });
});
