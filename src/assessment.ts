import type { PhotoAssessment, SupportedImageType } from "./worker-types";

export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

export const ASSESSMENT_PROMPT = `Analyze this photo and return only a JSON object with four keys:
- isImage: boolean
- isBeer: boolean
- score: a number from 0 to 5 when beer is visible, otherwise null
- reason: one short sentence describing what you actually see

Judge the beer's visual appeal from its pour, head, glass, colour, and setting. Do not repeat these instructions and do not use markdown.`;

export const ASSESSMENT_RETRY_PROMPT = `Analyze the photo again. Return only valid JSON with isImage and isBeer booleans, a numeric score from 0 to 5 when beer is visible, and a short reason based on the photo. Do not copy the instructions or use placeholder values.`;

export function detectImageType(bytes: Uint8Array): SupportedImageType | null {
  if (
    bytes.length >= 3 &&
    bytes[0] === 0xff &&
    bytes[1] === 0xd8 &&
    bytes[2] === 0xff
  ) {
    return "image/jpeg";
  }

  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return "image/png";
  }

  if (
    bytes.length >= 12 &&
    ascii(bytes, 0, 4) === "RIFF" &&
    ascii(bytes, 8, 12) === "WEBP"
  ) {
    return "image/webp";
  }

  return null;
}

export function parseAssessmentResponse(value: unknown): PhotoAssessment {
  const response = extractResponse(value);
  let parsed = response;

  if (typeof response === "string") {
    const start = response.indexOf("{");
    const end = response.lastIndexOf("}");

    if (start < 0 || end <= start) {
      throw new Error("Workers AI did not return a JSON object");
    }

    try {
      parsed = JSON.parse(response.slice(start, end + 1));
    } catch {
      throw new Error("Workers AI returned invalid JSON");
    }
  }

  if (!isRecord(parsed)) {
    throw new Error("Workers AI returned an invalid assessment");
  }

  if (typeof parsed.isImage !== "boolean" || typeof parsed.isBeer !== "boolean") {
    throw new Error("Workers AI assessment is missing boolean flags");
  }

  const reason = typeof parsed.reason === "string" ? parsed.reason.trim() : "";
  if (!reason) {
    throw new Error("Workers AI assessment is missing a reason");
  }

  if (!parsed.isImage || !parsed.isBeer) {
    return {
      isImage: parsed.isImage,
      isBeer: parsed.isImage && parsed.isBeer,
      score: null,
      reason: reason.slice(0, 280),
    };
  }

  let score =
    typeof parsed.score === "number"
      ? parsed.score
      : typeof parsed.score === "string"
        ? Number.parseFloat(parsed.score)
        : Number.NaN;

  if (!Number.isFinite(score)) {
    throw new Error("Workers AI returned an invalid score");
  }

  if (score > 10 && score <= 100) score /= 20;
  else if (score > 5 && score <= 10) score /= 2;
  score = Math.max(0, Math.min(5, score));

  return {
    isImage: true,
    isBeer: true,
    score: Math.round(score * 10) / 10,
    reason: reason.slice(0, 280),
  };
}

function extractResponse(value: unknown): unknown {
  const result = isRecord(value) && isRecord(value.result) ? value.result : value;
  if (isRecord(result) && Array.isArray(result.tool_calls)) {
    const toolCall = result.tool_calls.find(
      (call) => isRecord(call) && call.name === "submit_assessment",
    );
    if (isRecord(toolCall) && "arguments" in toolCall) {
      return toolCall.arguments;
    }
  }

  if (isRecord(value) && "response" in value) {
    return typeof value.response === "string" ? value.response.trim() : value.response;
  }

  if (isRecord(value) && isRecord(value.result) && "response" in value.result) {
    return typeof value.result.response === "string"
      ? value.result.response.trim()
      : value.result.response;
  }

  const shape = isRecord(value)
    ? `object with keys: ${Object.keys(value).join(", ") || "none"}`
    : typeof value;
  throw new Error(`Workers AI returned an unexpected response (${shape})`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function ascii(bytes: Uint8Array, start: number, end: number): string {
  return String.fromCharCode(...bytes.slice(start, end));
}
