import { PDFDocument, StandardFonts } from "pdf-lib";
import type { Page } from "./layouts";

const A4: [number, number] = [595, 842];

export async function renderPdf(pages: readonly Page[], title: string): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);

  pdf.setTitle(title);
  pdf.setProducer("echdyn synthetic generator");
  // Fixed dates keep output byte-identical between runs with the same seed
  pdf.setCreationDate(new Date(0));
  pdf.setModificationDate(new Date(0));

  for (const lines of pages) {
    const page = pdf.addPage(A4);
    for (const line of lines) {
      if (line.text !== "") {
        page.drawText(line.text, {
          x: line.x,
          y: line.y,
          size: line.size ?? 10,
          font: line.bold ? bold : regular,
        });
      }
    }
  }

  return pdf.save({ useObjectStreams: false });
}
