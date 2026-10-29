import { extractText, type ExtractionSettings } from "../../extraction/extract";
import type { PipelineStage } from "../pipeline";

export function createExtractStage(settings: ExtractionSettings): PipelineStage {
  return {
    name: "extract",
    async run(ctx) {
      // Scans have no text to send; the vision path handles them separately
      if (!ctx.text?.hasTextLayer) {
        return;
      }

      const extraction = await extractText(ctx.deps.db, settings, {
        documentId: ctx.document.id,
        documentTypeName: ctx.documentType.name,
        jsonSchema: ctx.documentType.schema,
        pages: ctx.text.pages,
        runNumber: ctx.extractions.length + 1,
      });

      ctx.extractions.push(extraction);
    },
  };
}
