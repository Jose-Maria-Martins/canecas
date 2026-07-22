import {
  WorkflowEntrypoint,
  type WorkflowEvent,
  type WorkflowStep,
} from "cloudflare:workers";
import {
  ASSESSMENT_PROMPT,
  ASSESSMENT_RETRY_PROMPT,
  parseAssessmentResponse,
} from "./assessment";
import { getPhotoResults } from "./results";
import type { Env, PhotoWorkflowParams } from "./worker-types";

export class PhotoAssessmentWorkflow extends WorkflowEntrypoint<Env, PhotoWorkflowParams> {
  async run(event: WorkflowEvent<PhotoWorkflowParams>, step: WorkflowStep) {
    const params = event.payload;
    let assessment;

    try {
      assessment = await step.do(
        "assess image with Workers AI",
        {
          retries: {
            limit: 3,
            delay: 250,
            backoff: "constant",
          },
          timeout: "2 minutes",
        },
        async () => {
          const object = await this.env.BEER_PHOTOS.get(params.objectKey);
          if (!object) {
            throw new Error(`R2 object ${params.objectKey} was not found`);
          }

          const bytes = new Uint8Array(await object.arrayBuffer());
          const imageUrl = toImageDataUrl(bytes, params.contentType);
          const runInference = async (prompt: string, attempt: string): Promise<unknown> => {
            const response = await this.env.AI.run(
              "@cf/meta/llama-3.2-11b-vision-instruct",
              {
                messages: [
                  {
                    role: "system",
                    content:
                      "You are a strict visual beer judge. Base every grade on the attached image and never use a default rating.",
                  },
                  {
                    role: "user",
                    content: [
                      { type: "text", text: prompt },
                      {
                        type: "image_url",
                        image_url: { url: imageUrl },
                      },
                    ],
                  },
                ],
                max_tokens: 180,
                temperature: 0.2,
              },
              { returnRawResponse: true },
            );

            if (!response.ok) {
              const detail = (await response.text()).replace(/\s+/g, " ").slice(0, 240);
              console.error("Workers AI HTTP error:", {
                attempt,
                status: response.status,
                statusText: response.statusText,
                headers: Object.fromEntries(response.headers),
                detail,
                imageBytes: bytes.byteLength,
                contentType: params.contentType,
              });
              throw new Error(
                `Workers AI request failed with status ${response.status}${detail ? `: ${detail}` : ""}`,
              );
            }

            const output: unknown = await response.json();
            console.log(`Workers AI ${attempt} output:`, JSON.stringify(output));
            return output;
          };

          try {
            return parseAssessmentResponse(
              await runInference(ASSESSMENT_PROMPT, "initial"),
            );
          } catch (error) {
            if (error instanceof Error && error.message.startsWith("Workers AI request failed")) {
              throw error;
            }
            return parseAssessmentResponse(
              await runInference(ASSESSMENT_RETRY_PROMPT, "retry"),
            );
          }
        },
      );

    } catch (error) {
      const message = error instanceof Error ? error.message : "Photo assessment failed";
      await step.do("record assessment failure", async () => {
        await getPhotoResults(this.env, params.submissionId).fail(
          params.submissionId,
          message,
        );
      });
      throw error;
    }

    await step.do("record assessment", async () => {
      await getPhotoResults(this.env, params.submissionId).complete(
        params.submissionId,
        assessment,
      );
    });

    if (
      assessment.isImage &&
      assessment.isBeer &&
      assessment.score !== null &&
      params.latitude !== undefined &&
      params.longitude !== undefined
    ) {
      await step.do("add rated image to map", async () => {
        const index = this.env.MAP_SUBMISSIONS.get(
          this.env.MAP_SUBMISSIONS.idFromName("global"),
        );
        await index.upsert({
          submissionId: params.submissionId,
          latitude: params.latitude!,
          longitude: params.longitude!,
          score: assessment.score!,
          reason: assessment.reason,
          createdAt: Date.now(),
        });
      });
    }

    return assessment;
  }
}

function toImageDataUrl(bytes: Uint8Array, contentType: string): string {
  let binary = "";
  const chunkSize = 32_768;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return `data:${contentType};base64,${btoa(binary)}`;
}
