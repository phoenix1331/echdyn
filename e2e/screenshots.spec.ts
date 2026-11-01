import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { auth, chooseFile, signIn, startEditing, status } from "./helpers";

// Run by `make screenshots` only (SCREENSHOTS=1): the README and site images, from the bundled
// examples on a fresh isolated stack, so anyone can regenerate them identically
const out = resolve(import.meta.dirname, "../docs/images");
const example = (name: string) => resolve(import.meta.dirname, "../examples", name);

// Full Chromium, not the headless shell, so the review screen's PDF viewer renders
test.use({
  channel: "chromium",
  viewport: { width: 1280, height: 800 },
  deviceScaleFactor: 2,
  colorScheme: "light",
});

async function shot(page: Page, name: string): Promise<void> {
  // Nothing from the session in the picture: no hover, no focus ring, no dev-server badge
  await page.mouse.move(0, 0);
  const focused = page.locator(":focus");
  if ((await focused.count()) > 0) {
    await focused.blur();
  }
  await page.addStyleTag({ content: "nextjs-portal { display: none !important; }" });
  // Let fonts, images and the progress highlight settle
  await page.waitForTimeout(600);
  await page.screenshot({ path: resolve(out, `${name}.png`) });
}

/**
 * The list refreshes itself and streams while documents are processing, so a full page load
 * may never settle: wait only for the response to begin, and let each check wait for content
 */
async function visit(page: Page, path: string): Promise<void> {
  await page.goto(path, { waitUntil: "commit" });
}

test("capture the screenshots @screenshots", async ({ page, request }) => {
  test.setTimeout(300_000);
  await signIn(page);

  // A few typed bills straight through the API, so the list has some history
  for (const name of [
    "northern-power-gas.pdf",
    "cymru-gas-and-power.pdf",
    "northern-power-two-pages.pdf",
  ]) {
    const response = await request.post("/api/documents", {
      headers: auth,
      multipart: {
        document_type: "uk-energy-bill",
        file: {
          name,
          mimeType: "application/pdf",
          buffer: await readFile(example(name)),
        },
      },
    });
    expect(response.ok()).toBe(true);
  }

  // The summary before upload: typed, scanned and mixed together
  await visit(page, "/upload");
  await expect(page.getByRole("heading", { name: "Upload documents" })).toBeVisible();
  await shot(page, "upload");
  const summary = await chooseFile(page, [
    example("vat-trap.pdf"),
    example("mixed-cover-letter.pdf"),
    example("scanned-severn-valley.pdf"),
  ]);
  await expect(summary).toContainText("2 pages: 1 typed, 1 scanned");
  await shot(page, "upload-summary");
  await summary.getByRole("button", { name: "Upload 3 files" }).click();

  // Live progress: the stub model is slowed, so documents are still queued and extracting
  const row = page.getByRole("row", { name: /vat-trap\.pdf/ });
  await expect(page.getByText(/Extracting fields/).first()).toBeVisible({ timeout: 60_000 });
  await shot(page, "progress");

  // Everything read: the list with documents waiting for review
  const id = ((await row.getByRole("link").getAttribute("href")) ?? "").split("/").pop() ?? "";
  // Wait on the API for every document to finish, then load the settled list
  await expect
    .poll(
      async () => {
        const response = await request.get("/api/documents", { headers: auth });
        const { documents } = (await response.json()) as { documents: { status: string }[] };
        return documents.filter((d) => d.status === "queued" || d.status === "extracting").length;
      },
      { timeout: 240_000, intervals: [2_000] },
    )
    .toBe(0);
  expect(await status(request, id)).toBe("needs_review");
  await visit(page, "/");
  await expect(page.getByRole("row", { name: /scanned-severn-valley\.pdf/ })).toContainText(
    "Needs review",
  );
  await shot(page, "documents");

  // The review screen: the misread VAT flagged by both checks, the PDF beside it
  await visit(page, `/documents/${id}`);
  const vat = page.locator("#field-vat_gbp");
  await expect(vat).toContainText("£386.88");
  await shot(page, "review");

  // Fix it and approve
  const input = await startEditing(vat);
  await input.fill("64.48");
  await input.press("Enter");
  const looksRight = page.getByRole("button", { name: "Looks right" });
  while ((await looksRight.count()) > 0) {
    await looksRight.first().click();
  }
  await shot(page, "review-edited");
  await page.getByRole("button", { name: "Approve" }).click();
  await expect(page.getByText("Approved by admin")).toBeVisible();

  await visit(page, "/records");
  await expect(page.getByRole("row", { name: /Northern Power Ltd/ })).toBeVisible();
  await shot(page, "records");

  await page.getByRole("row", { name: /Northern Power Ltd/ }).click();
  await expect(page.getByRole("heading", { name: "Audit trail" })).toBeVisible();
  await shot(page, "audit");

  // The sign-in page last, signed out
  await page.context().clearCookies();
  await visit(page, "/login");
  await shot(page, "login");
});
