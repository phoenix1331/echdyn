import { getDocumentType } from "../../document-types/registry";
import {
  extractFields,
  type ExtractionSettings,
  type ExtractionSource,
} from "../../extraction/extract";
import type { PipelineContext, PipelineStage } from "../pipeline";

export interface ExtractStageSettings extends ExtractionSettings {
  /** Reads scans from their rendered pages; without one, scans go to review unread */
  visionModel?: string;
}

/** The text layer when there is one, else the rendered pages if a vision model can read them */
function sourceFor(
  ctx: PipelineContext,
  settings: ExtractStageSettings,
): { source: ExtractionSource; model: string } | null {
  if (ctx.text?.hasTextLayer) {
    return { source: { kind: "text", pages: ctx.text.pages }, model: settings.model };
  }
  const images = ctx.pages?.map((page) => page.png) ?? [];
  if (images.length === 0 || !settings.visionModel) {
    return null;
  }
  return { source: { kind: "images", images }, model: settings.visionModel };
}

export function createExtractStage(settings: ExtractStageSettings): PipelineStage {
  return {
    name: "extract",
    label: "Extracting fields",
    async run(ctx) {
      const chosen = sourceFor(ctx, settings);
      if (!chosen) {
        return;
      }

      const { slug, version } = ctx.documentType;
      const hints = getDocumentType(slug, version)?.extraction ?? {};

      const extraction = await extractFields(
        ctx.deps.db,
        { client: settings.client, model: chosen.model, temperature: settings.temperature ?? 0 },
        {
          ...hints,
          documentId: ctx.document.id,
          documentTypeName: ctx.documentType.name,
          jsonSchema: ctx.documentType.schema,
          source: chosen.source,
          runNumber: ctx.extractions.length + 1,
        },
      );

      ctx.extractions.push(extraction);
    },
  };
}
