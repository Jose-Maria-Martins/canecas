import {
  WorkflowEntrypoint,
  type WorkflowEvent,
  type WorkflowStep,
} from "cloudflare:workers";
import { ASSESSMENT_PROMPT, parseAssessmentResponse } from "./assessment";
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
            delay: "5 seconds",
            backoff: "exponential",
          },
          timeout: "2 minutes",
        },
        async () => {
          const object = await this.env.BEER_PHOTOS.get(params.objectKey);
          if (!object) {
            throw new Error(`R2 object ${params.objectKey} was not found`);
          }

          const bytes = new Uint8Array(await object.arrayBuffer());
          const response = await this.env.AI.run(
            "@cf/meta/llama-3.2-11b-vision-instruct",
            {
              messages: [
                {
                  role: "user",
                  content: [
                    { type: "text", text: ASSESSMENT_PROMPT },
                    {
                      type: "image_url",
                      image_url: {
                        url: toImageDataUrl(bytes, params.contentType),
                      },
                    },
                  ],
                },
              ],
              max_tokens: 180,
              temperature: 0,
            },
            { returnRawResponse: true },
          );

          if (!response.ok) {
            throw new Error(`Workers AI request failed with status ${response.status}`);
          }

          return parseAssessmentResponse(await response.json());
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
