import { eq } from "drizzle-orm";
import { getDocument, InvalidPDFException } from "pdfjs-dist/legacy/build/pdf.mjs";
import { documents } from "../../db/schema";
import { PermanentPipelineError, type PipelineStage } from "../pipeline";

/** Fewer non-whitespace characters per page than this means there is no usable text layer */
export const MIN_TEXT_CHARS_PER_PAGE = 20;

export interface PdfText {
  pageCount: number;
  pages: string[];
  hasTextLayer: boolean;
}

export async function extractPdfText(file: Uint8Array): Promise<PdfText> {
  // pdfjs transfers (detaches) the buffer it is given, so hand it a copy
  const task = getDocument({ data: new Uint8Array(file), disableFontFace: true, verbosity: 0 });

  try {
    const pdf = await task.promise;
    const pages: string[] = [];

    for (let number = 1; number <= pdf.numPages; number++) {
      const page = await pdf.getPage(number);
      const content = await page.getTextContent();
      pages.push(
        content.items
          // Marked-content entries carry no text, only structure
          .map((item) => ("str" in item ? item.str + (item.hasEOL ? "\n" : "") : ""))
          .join("")
          .trim(),
      );
    }

    const characters = pages.join("").replace(/\s/g, "").length;

    return {
      pageCount: pdf.numPages,
      pages,
      hasTextLayer: characters >= MIN_TEXT_CHARS_PER_PAGE * pdf.numPages,
    };
  } finally {
    await task.destroy();
  }
}

export const preProcessStage: PipelineStage = {
  name: "pre-process",
  async run(ctx) {
    let text: PdfText;
    try {
      text = await extractPdfText(ctx.file);
    } catch (error) {
      // A corrupt or non-PDF file will fail the same way on every retry
      if (error instanceof InvalidPDFException) {
        throw new PermanentPipelineError(`Could not read the PDF: ${error.message}`);
      }
      throw error;
    }

    ctx.text = text;
    await ctx.deps.db
      .update(documents)
      .set({ pageCount: text.pageCount, hasTextLayer: text.hasTextLayer })
      .where(eq(documents.id, ctx.document.id));
  },
};
