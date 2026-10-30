import { eq } from "drizzle-orm";
import { firstRow } from "../../db/rows";
import { extractions } from "../../db/schema";
import { getDocumentType } from "../../document-types/registry";
import { validateExtraction } from "../../validation/validate";
import { PermanentPipelineError, type PipelineStage } from "../pipeline";

export const validateStage: PipelineStage = {
  name: "validate",
  label: "Checking figures",
  async run(ctx) {
    const { slug, version } = ctx.documentType;
    const definition = getDocumentType(slug, version);

    if (!definition) {
      throw new PermanentPipelineError(`No definition is registered for ${slug}@${version}`);
    }

    for (const [index, extraction] of ctx.extractions.entries()) {
      // Unparseable output already carries its _root error from the extract stage
      if (extraction.parsed === null) {
        continue;
      }

      const { errors } = validateExtraction(definition, extraction.parsed);
      const rows = await ctx.deps.db
        .update(extractions)
        .set({ validationErrors: errors })
        .where(eq(extractions.id, extraction.id))
        .returning();

      ctx.extractions[index] = firstRow(rows, "extraction update");
    }
  },
};
