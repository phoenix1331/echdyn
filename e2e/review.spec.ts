import { resolve } from "node:path";
import { expect, test, type APIRequestContext, type Locator, type Page } from "@playwright/test";

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

async function signIn(page: Page): Promise<void> {
  await page.goto("/");
  await expect(page).toHaveURL(/\/login/);
  await page.getByLabel("Username").fill(username);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { name: "Documents" })).toBeVisible();
}

// As with Edit, a file chosen before hydration goes unnoticed; retry until the summary opens
async function chooseFile(page: Page, path: string): Promise<Locator> {
  const summary = page.getByRole("dialog", { name: "Before you upload" });
  await expect(async () => {
    await page.locator('input[type="file"]').setInputFiles(path);
    await expect(summary).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 30_000 });
  return summary;
}

test("a file picked on the upload page is summarised, uploaded, reviewed and approved", async ({
  page,
  request,
}) => {
  await signIn(page);
  await page.getByRole("link", { name: "Upload", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Upload documents" })).toBeVisible();

  // Nothing is stored until Proceed: the summary says what the file holds and how it is read
  const summary = await chooseFile(
    page,
    resolve(import.meta.dirname, "../fixtures/sample-energy-bill.pdf"),
  );
  await expect(summary).toContainText("1 typed page");
  await expect(summary).toContainText("Read from its text");
  await summary.getByRole("button", { name: "Upload 1 file" }).click();

  // Back on the list, the new document is there and the page follows its progress
  const row = page.getByRole("row", { name: /sample-energy-bill\.pdf/ });
  await expect(row).toBeVisible();
  const id = ((await row.getByRole("link").getAttribute("href")) ?? "").split("/").pop() ?? "";

  // The stub model copies the total into VAT, so both VAT checks send it to review
  await expect.poll(() => status(request, id), { timeout: 90_000 }).toBe("needs_review");
  await expect(row).toContainText("Needs review", { timeout: 15_000 });
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

  // The record is searchable by any value, and its audit trail shows how it was reached
  await page
    .getByRole("navigation", { name: "Main" })
    .getByRole("link", { name: "Records" })
    .click();
  // The page compiles on first visit: wait for it before searching
  await expect(page.getByRole("heading", { name: "Records", level: 1 })).toBeVisible();
  await page.getByRole("searchbox").fill("AC-1029384");
  await page.getByRole("button", { name: "Search" }).click();
  const record = page.getByRole("row", { name: /Northern Power Ltd/ });
  await expect(record).toContainText("£386.88");
  await expect(record.getByRole("link", { name: /^PDF/ })).toHaveAttribute(
    "href",
    `/documents/${id}/pdf`,
  );
  await record.click();

  const trail = page.getByRole("heading", { name: "Audit trail" }).locator("..");
  await expect(trail).toContainText("Uploaded sample-energy-bill.pdf");
  await expect(trail).toContainText("Checks flagged");
  await expect(trail).toContainText("admin corrected VAT");
  await expect(trail).toContainText("Approved by admin");
  // Scoped to the visible main: Next keeps the previous page mounted, hidden
  await expect(page.getByRole("main").getByText("Corrected by admin, was £386.88")).toBeVisible();
});

test("an example shows a mixed bill in the summary, and Cancel stores nothing", async ({
  page,
}) => {
  await signIn(page);
  await page.goto("/upload");

  const card = page.getByRole("listitem").filter({ hasText: "Typed letter, scanned bill" });
  const summary = page.getByRole("dialog", { name: "Before you upload" });
  await expect(async () => {
    await card.getByRole("button", { name: "Use this example" }).click();
    await expect(summary).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 30_000 });

  await expect(summary).toContainText("2 pages: 1 typed, 1 scanned");
  await expect(summary).toContainText("Text and scan read together");
  await expect(summary).toContainText("slow without a GPU");

  await summary.getByRole("button", { name: "Cancel" }).click();
  await expect(summary).toBeHidden();

  // Inspecting stored nothing: the example never reaches the list
  await page.goto("/");
  await expect(page.getByRole("row", { name: /mixed-cover-letter\.pdf/ })).toHaveCount(0);
});
