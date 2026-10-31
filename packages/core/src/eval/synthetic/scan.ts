import { createCanvas, loadImage } from "@napi-rs/canvas";
import { PDFDocument } from "pdf-lib";
import { renderPdfPages } from "../../pipeline/stages/render";
import type { Random } from "../random";

/** A flatbed scan at office settings: enough resolution for small print, JPEG compressed */
const SCAN_DPI = 150;
const JPEG_QUALITY = 80;
const PAPER = "#f6f4ee";

/**
 * Turns a text PDF into an image-only one that looks scanned: each page rasterised, tilted
 * by up to a degree on off-white paper, speckled, and saved as JPEG. The text layer is gone,
 * so the pipeline must take the vision path, while the label stays exactly right.
 */
export async function scanPdf(pdf: Uint8Array, random: Random): Promise<Uint8Array> {
  const source = await PDFDocument.load(pdf);
  const sizes = source.getPages().map((page) => page.getSize());
  const pages = await renderPdfPages(pdf, { dpi: SCAN_DPI, maxPages: sizes.length });
  const scanned = await PDFDocument.create();
  // Fixed metadata so the same seed always writes byte-identical files
  scanned.setProducer("echdyn synthetic generator");
  scanned.setCreationDate(new Date(0));
  scanned.setModificationDate(new Date(0));

  for (const [i, page] of pages.entries()) {
    const { width, height } = page;
    const canvas = createCanvas(width, height);
    const context = canvas.getContext("2d");
    context.fillStyle = PAPER;
    context.fillRect(0, 0, width, height);

    const angle = (random.decimal(-1, 1, 2) * Math.PI) / 180;
    context.translate(width / 2, height / 2);
    context.rotate(angle);
    context.translate(-width / 2 + random.int(-6, 6), -height / 2 + random.int(-6, 6));
    // Multiply keeps the paper tone under white areas of the page
    context.globalCompositeOperation = "multiply";
    context.drawImage(await loadImage(page.png), 0, 0);
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.globalCompositeOperation = "source-over";

    // Dust and toner specks
    context.fillStyle = "rgba(60, 60, 60, 0.35)";
    for (let speck = 0; speck < 400; speck++) {
      context.fillRect(random.int(0, width), random.int(0, height), 1, 1);
    }

    const jpeg = await scanned.embedJpg(await canvas.encode("jpeg", JPEG_QUALITY));
    const size = sizes[i] ?? { width: 595.28, height: 841.89 };
    scanned.addPage([size.width, size.height]).drawImage(jpeg, { x: 0, y: 0, ...size });
  }

  return scanned.save();
}
