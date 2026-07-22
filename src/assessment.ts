import type { PhotoAssessment, SupportedImageType } from "./worker-types";

export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

export const ASSESSMENT_PROMPT = `Analyze this photo and return only a JSON object with these keys:
- isImage: boolean
- isBeer: boolean
- head: poor, fair, good, or excellent
- pour: poor, fair, good, or excellent
- glass: poor, fair, good, or excellent
- colour: poor, fair, good, or excellent
- presentation: poor, fair, good, or excellent
- reason: one short sentence describing what you actually see

If beer is visible, grade every visual category independently from the image. Use the full range when justified and do not give an overall numeric score. If no beer is visible, the category values may be null. Do not repeat these instructions and do not use markdown.`;

export const ASSESSMENT_RETRY_PROMPT = `Inspect the attached photo again and return only valid JSON. Include isImage and isBeer booleans; independent poor, fair, good, or excellent grades for head, pour, glass, colour, and presentation; and a short reason based on visible evidence. Do not include an overall score, copy instructions, or use placeholder values.`;

const RUBRIC_KEYS = ["head", "pour", "glass", "colour", "presentation"] as const;
const GRADE_SCORES: Record<string, number> = {
  poor: 1,
  fair: 2.4,
  good: 3.7,
  excellent: 4.8,
};

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

  const rubricGrades = RUBRIC_KEYS.map((key) => parsed[key]);
  const hasRubric = rubricGrades.every((grade) => typeof grade === "string");
  let score = hasRubric
    ? scoreRubric(parsed)
    : typeof parsed.score === "number"
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

function scoreRubric(parsed: Record<string, unknown>): number {
  let total = 0;
  for (const key of RUBRIC_KEYS) {
    const grade = String(parsed[key]).trim().toLowerCase();
    const value = GRADE_SCORES[grade];
    if (value === undefined) {
      throw new Error(`Workers AI returned an invalid ${key} grade`);
    }
    total += value;
  }
  return total / RUBRIC_KEYS.length;
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
