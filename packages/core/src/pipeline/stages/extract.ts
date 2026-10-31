import { getDocumentType } from "../../document-types/registry";
import {
  extractFields,
  type ExtractionSettings,
  type ExtractionSource,
} from "../../extraction/extract";
import type { MixedPage } from "../../extraction/prompt";
import type { PipelineContext, PipelineStage } from "../pipeline";

export interface ExtractStageSettings extends ExtractionSettings {
  /** Reads scans from their rendered pages; without one, scans go to review unread */
  visionModel?: string;
}

/**
 * Chosen from the page kinds: all typed pages go to the text model; scanned pages need the
 * vision model, alone (all scanned) or with the typed pages beside them (mixed). Without a
 * vision model a mixed document still gets its typed pages read, as before.
 */
function sourceFor(
  ctx: PipelineContext,
  settings: ExtractStageSettings,
): { source: ExtractionSource; model: string } | null {
  if (!ctx.text) {
    return null;
  }
  const { pages: texts, pageKinds } = ctx.text;
  const typed = pageKinds.flatMap((kind, i) => (kind === "text" ? [i + 1] : []));
  const textOnly = {
    source: { kind: "text" as const, pages: typed.map((n) => texts[n - 1] ?? "") },
    model: settings.model,
  };
  const scans = ctx.pages ?? [];

  if (scans.length === 0 || !settings.visionModel) {
    return typed.length > 0 ? textOnly : null;
  }
  if (typed.length === 0) {
    return {
      source: { kind: "images", images: scans.map((page) => page.png) },
      model: settings.visionModel,
    };
  }

  const pages: MixedPage[] = [
    ...typed.map((pageNumber) => ({ pageNumber, text: texts[pageNumber - 1] ?? "" })),
    ...scans.map((page) => ({ pageNumber: page.pageNumber, image: page.png })),
  ].sort((a, b) => a.pageNumber - b.pageNumber);
  return { source: { kind: "mixed", pages }, model: settings.visionModel };
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
