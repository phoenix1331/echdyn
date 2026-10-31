import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { expect, test, type APIRequestContext, type Locator } from "@playwright/test";

const apiToken = process.env.API_TOKEN ?? "";
const username = process.env.ADMIN_USERNAME ?? "admin";
const password = process.env.ADMIN_PASSWORD ?? "";
const auth = { Authorization: `Bearer ${apiToken}` };

async function status(request: APIRequestContext, id: string): Promise<string> {
  const response = await request.get(`/api/documents/${id}`, { headers: auth });
  expect(response.ok()).toBe(true);
  return ((await response.json()) as { status: string }).status;
}

// The dev server compiles client code on first use, so a click can land before React has
// hydrated the button; retry until the input actually opens
async function startEditing(row: Locator): Promise<Locator> {
  const input = row.getByRole("textbox");
  await expect(async () => {
    await row.getByRole("button", { name: /^Edit/ }).click();
    await expect(input).toBeVisible({ timeout: 1_000 });
  }).toPass({ timeout: 30_000 });
  return input;
}

test("a reviewer fixes a misread figure and approves the bill into a record", async ({
  page,
  request,
}) => {
  // Upload through the API, as an integration would
  const upload = await request.post("/api/documents", {
    headers: auth,
    multipart: {
      document_type: "uk-energy-bill",
      file: {
        name: "sample-energy-bill.pdf",
        mimeType: "application/pdf",
        buffer: await readFile(resolve(import.meta.dirname, "../fixtures/sample-energy-bill.pdf")),
      },
    },
  });
  expect(upload.status()).toBe(201);
  const { id } = (await upload.json()) as { id: string };

  // The stub model copies the total into VAT, so both VAT checks send it to review
  await expect.poll(() => status(request, id), { timeout: 90_000 }).toBe("needs_review");

  await page.goto("/");
  await expect(page).toHaveURL(/\/login/);
  await page.getByLabel("Username").fill(username);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();

  // Anywhere on the row opens the document, not just its name
  const row = page.getByRole("row", { name: /sample-energy-bill\.pdf/ });
  await expect(row).toContainText("Needs review");
  // The row's centre is the status column, well away from the file name
  await row.click();
  await expect(page).toHaveURL(new RegExp(`/documents/${id}$`));

  const approve = page.getByRole("button", { name: "Approve" });
  await expect(approve).toBeDisabled();
  await expect(page.getByText(/^0 of \d+ flagged fields checked$/)).toBeVisible();

  const vat = page.locator("#field-vat_gbp");
  await expect(vat).toContainText("£386.88");
  await expect(vat).toContainText(/VAT on £322\.40 is £64\.48/);

  // A value that is not a number is refused, and nothing is approved
  const draft = await startEditing(vat);
  await expect(page.getByText("Save or cancel your edit to approve.")).toBeVisible();
  await draft.fill("lots");
  await vat.getByRole("button", { name: "Save" }).click();
  await expect(vat).toContainText("Edited, was £386.88");

  const looksRight = page.getByRole("button", { name: "Looks right" });
  while ((await looksRight.count()) > 0) {
    await looksRight.first().click();
  }
  await expect(approve).toBeEnabled();
  await approve.click();
  await expect(vat).toContainText("Enter a number");
  expect(await status(request, id)).toBe("needs_review");

  // The right figure, saved with Enter
  const fix = await startEditing(vat);
  await fix.fill("64.48");
  await fix.press("Enter");
  await expect(vat).toContainText("£64.48");

  await page.getByLabel(/Add to the labelled set/).check();
  await approve.click();

  await expect(page).toHaveURL(/labelled=reviewed-/);
  await expect(page.getByText(/Added to the labelled set as reviewed-/)).toBeVisible();
  await expect(page.getByText("Approved by admin")).toBeVisible();
  await expect(page.getByText("1 field corrected before approval.")).toBeVisible();
  await expect(vat).toContainText("£64.48");
  await expect(vat).toContainText("Corrected by admin, was £386.88");
  await expect(approve).toHaveCount(0);
  expect(await status(request, id)).toBe("approved");

  // Back on the list, the document has left the review queue
  await page.getByRole("link", { name: "Back to documents" }).click();
  await expect(page.getByRole("row", { name: /sample-energy-bill\.pdf/ })).toContainText(
    "Approved",
  );
});
