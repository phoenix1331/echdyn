import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createCanvas, type Canvas } from "@napi-rs/canvas";
import { eq } from "drizzle-orm";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import type { PageViewport, PDFPageProxy } from "pdfjs-dist/legacy/build/pdf.mjs";
import { documentPages } from "../../db/schema";
import { pageImageKey } from "../../storage/storage";
import type { PipelineStage } from "../pipeline";

/** Sharp enough for small print on a bill without wasting vision model context */
export const RENDER_DPI = 150;
/** Caps oversized pages (posters, wide statements) whatever their DPI */
export const MAX_PAGE_EDGE_PX = 2000;
/** Bills run to a few pages; anything longer is mostly terms and conditions */
export const MAX_RENDERED_PAGES = 10;

// Bills often use the 14 standard PDF fonts without embedding them; pdfjs draws nothing for
// that text unless it can load its own copies of those fonts (trailing slash required)
const standardFontDataUrl = `${resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../../node_modules/pdfjs-dist/standard_fonts",
)}/`;

export interface PageImage {
  pageNumber: number;
  width: number;
  height: number;
  png: Uint8Array;
}

export interface RenderedPage extends Omit<PageImage, "png"> {
  storageKey: string;
  png: Uint8Array;
}

// pdfjs types its canvas as a DOM HTMLCanvasElement, which this Node-only package has no
// types for; @napi-rs/canvas implements the same drawing API, so render is typed for it
type NodeRender = (params: { canvas: Canvas; viewport: PageViewport }) => {
  promise: Promise<void>;
};

function renderTo(page: PDFPageProxy): NodeRender {
  // Through unknown: core (no DOM types) and the web app (DOM types) see pdfjs's signature differently
  const render: unknown = page.render.bind(page);
  return render as NodeRender;
}

export interface RenderOptions {
  dpi?: number;
  maxEdge?: number;
  maxPages?: number;
}

/** Renders each page to a PNG on a white background, as a scanner would produce */
export async function renderPdfPages(
  file: Uint8Array,
  options: RenderOptions = {},
): Promise<PageImage[]> {
  const { dpi = RENDER_DPI, maxEdge = MAX_PAGE_EDGE_PX, maxPages = MAX_RENDERED_PAGES } = options;
  // pdfjs transfers (detaches) the buffer it is given, so hand it a copy
  const task = getDocument({
    data: new Uint8Array(file),
    standardFontDataUrl,
    verbosity: 0,
  });

  try {
    const pdf = await task.promise;
    const images: PageImage[] = [];

    for (let number = 1; number <= Math.min(pdf.numPages, maxPages); number++) {
      const page = await pdf.getPage(number);
      const natural = page.getViewport({ scale: 1 });
      const scale = Math.min(dpi / 72, maxEdge / Math.max(natural.width, natural.height));
      const viewport = page.getViewport({ scale });
      const width = Math.round(viewport.width);
      const height = Math.round(viewport.height);

      const canvas = createCanvas(width, height);
      const context = canvas.getContext("2d");
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, width, height);
      await renderTo(page)({ canvas, viewport }).promise;

      images.push({ pageNumber: number, width, height, png: await canvas.encode("png") });
      page.cleanup();
    }

    return images;
  } finally {
    await task.destroy();
  }
}

/**
 * Scans have no text layer for the text model, so their pages are rendered for the
 * vision model and stored beside the PDF. Documents with text skip this stage.
 */
export const renderPagesStage: PipelineStage = {
  name: "render",
  label: "Rendering pages",
  async run(ctx) {
    if (!ctx.text || ctx.text.hasTextLayer) {
      return;
    }

    const images = await renderPdfPages(ctx.file);
    const pages = images.map((image) => ({
      ...image,
      storageKey: pageImageKey(ctx.documentType.slug, ctx.document.sha256, image.pageNumber),
    }));

    // Content-addressed keys, so a retried job overwrites rather than duplicates
    for (const page of pages) {
      await ctx.deps.storage.put(page.storageKey, page.png, "image/png");
    }

    await ctx.deps.db.transaction(async (tx) => {
      await tx.delete(documentPages).where(eq(documentPages.documentId, ctx.document.id));
      if (pages.length > 0) {
        await tx.insert(documentPages).values(
          pages.map((page) => ({
            documentId: ctx.document.id,
            pageNumber: page.pageNumber,
            storageKey: page.storageKey,
            width: page.width,
            height: page.height,
          })),
        );
      }
    });

    ctx.pages = pages;
  },
};
