import { eq } from "drizzle-orm";
import { getDocument, InvalidPDFException, OPS } from "pdfjs-dist/legacy/build/pdf.mjs";
import { documents, type PageKind } from "../../db/schema";
import { PermanentPipelineError, type PipelineStage } from "../pipeline";

/** Fewer non-whitespace characters than this means a page has no usable text layer */
export const MIN_TEXT_CHARS_PER_PAGE = 20;

// Every way a PDF can paint a raster image; a page with one and no text is a scan
const IMAGE_OPS = new Set<number>([
  OPS.paintImageXObject,
  OPS.paintImageXObjectRepeat,
  OPS.paintInlineImageXObject,
  OPS.paintInlineImageXObjectGroup,
  OPS.paintImageMaskXObject,
  OPS.paintImageMaskXObjectGroup,
  OPS.paintImageMaskXObjectRepeat,
]);

export interface PdfText {
  pageCount: number;
  pages: string[];
  /** Per page: text to read, a scan for the vision model, or blank and skipped */
  pageKinds: PageKind[];
  /** No scanned pages: the text model can read all of it */
  hasTextLayer: boolean;
}

/**
 * Decided per page, not per document: an average let a typed cover letter carry a scanned
 * bill behind it as "text", so the page with the figures was never read. Blank pages are
 * told apart from scans by whether they paint an image, so they cost no vision call.
 */
function pageKind(text: string, paintsImage: boolean): PageKind {
  if (text.replace(/\s/g, "").length >= MIN_TEXT_CHARS_PER_PAGE) {
    return "text";
  }
  return paintsImage ? "scan" : "blank";
}

export async function extractPdfText(file: Uint8Array): Promise<PdfText> {
  // pdfjs transfers (detaches) the buffer it is given, so hand it a copy
  const task = getDocument({ data: new Uint8Array(file), disableFontFace: true, verbosity: 0 });

  try {
    const pdf = await task.promise;
    const pages: string[] = [];
    const pageKinds: PageKind[] = [];

    for (let number = 1; number <= pdf.numPages; number++) {
      const page = await pdf.getPage(number);
      const content = await page.getTextContent();
      const text = content.items
        // Marked-content entries carry no text, only structure
        .map((item) => ("str" in item ? item.str + (item.hasEOL ? "\n" : "") : ""))
        .join("")
        .trim();
      const { fnArray } = await page.getOperatorList();
      pages.push(text);
      pageKinds.push(
        pageKind(
          text,
          fnArray.some((op) => IMAGE_OPS.has(op)),
        ),
      );
    }

    return {
      pageCount: pdf.numPages,
      pages,
      pageKinds,
      hasTextLayer: pageKinds.includes("text") && !pageKinds.includes("scan"),
    };
  } finally {
    await task.destroy();
  }
}

export const preProcessStage: PipelineStage = {
  name: "pre-process",
  label: "Reading PDF",
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
      .set({
        pageCount: text.pageCount,
        hasTextLayer: text.hasTextLayer,
        pageKinds: text.pageKinds,
      })
      .where(eq(documents.id, ctx.document.id));
  },
};
