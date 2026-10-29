import type { ChatClient } from "../../extraction/extract";
import type { PipelineStage } from "../pipeline";
import { createExtractStage } from "./extract";
import { preProcessStage } from "./pre-process";
import { createScoreStage } from "./score";
import { validateStage } from "./validate";

export const CONSISTENCY_TEMPERATURE = 0.4;

export interface PipelineSettings {
  client: ChatClient;
  textModel: string;
  autoApprove: boolean;
}

/**
 * The production stage order, shared by the worker and the eval script so accuracy
 * is always measured on exactly the pipeline that runs in production.
 */
export function createPipelineStages({
  client,
  textModel,
  autoApprove,
}: PipelineSettings): PipelineStage[] {
  return [
    preProcessStage,
    // Primary run at temperature 0, then a consistency run with a little randomness:
    // fields the model is unsure about tend to change between the two
    createExtractStage({ client, model: textModel }),
    createExtractStage({ client, model: textModel, temperature: CONSISTENCY_TEMPERATURE }),
    validateStage,
    createScoreStage({ autoApprove }),
  ];
}
