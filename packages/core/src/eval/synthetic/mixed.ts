import { PDFDocument, StandardFonts } from "pdf-lib";

const A4 = { width: 595.28, height: 841.89 };

/**
 * Puts a typed cover letter in front of a scanned bill: the letter has a text layer, the bill
 * has none and carries every figure. Read per document, the letter's text made the whole
 * thing look typed and the bill was never read; read per page, it is a mixed document.
 */
export async function withCoverLetter(scanned: Uint8Array, supplier: string): Promise<Uint8Array> {
  const mixed = await PDFDocument.create();
  // Fixed metadata so the same seed always writes byte-identical files
  mixed.setProducer("echdyn synthetic generator");
  mixed.setCreationDate(new Date(0));
  mixed.setModificationDate(new Date(0));

  const font = await mixed.embedFont(StandardFonts.Helvetica);
  const bold = await mixed.embedFont(StandardFonts.HelveticaBold);
  const cover = mixed.addPage([A4.width, A4.height]);
  const lines = [
    "Dear customer,",
    "",
    "Please find your latest energy statement enclosed. The following page shows",
    "what you used in this billing period, the charges and the amount due.",
    "",
    "If anything looks wrong, call our business team on 0800 000 1331, Monday to",
    "Friday, 8am to 6pm, quoting the account number on your statement.",
    "",
    "Yours sincerely,",
    "Customer Service",
  ];
  cover.drawText(supplier, { x: 56, y: A4.height - 80, size: 20, font: bold });
  lines.forEach((line, i) => {
    cover.drawText(line, { x: 56, y: A4.height - 140 - i * 18, size: 11, font });
  });

  const source = await PDFDocument.load(scanned);
  for (const page of await mixed.copyPages(source, source.getPageIndices())) {
    mixed.addPage(page);
  }

  return mixed.save();
}
