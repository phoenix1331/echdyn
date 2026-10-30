import { getDocumentType } from "../../document-types/registry";
import { extractText, type ExtractionSettings } from "../../extraction/extract";
import type { PipelineStage } from "../pipeline";

export function createExtractStage(settings: ExtractionSettings): PipelineStage {
  return {
    name: "extract",
    label: "Extracting fields",
    async run(ctx) {
      // Scans have no text to send; the vision path handles them separately
      if (!ctx.text?.hasTextLayer) {
        return;
      }

      const { slug, version } = ctx.documentType;
      const hints = getDocumentType(slug, version)?.extraction ?? {};

      const extraction = await extractText(ctx.deps.db, settings, {
        ...hints,
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
