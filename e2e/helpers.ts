import { expect, type APIRequestContext, type Locator, type Page } from "@playwright/test";

const apiToken = process.env.API_TOKEN ?? "";
const username = process.env.ADMIN_USERNAME ?? "admin";
const password = process.env.ADMIN_PASSWORD ?? "";
export const auth = { Authorization: `Bearer ${apiToken}` };

export async function status(request: APIRequestContext, id: string): Promise<string> {
  const response = await request.get(`/api/documents/${id}`, { headers: auth });
  expect(response.ok()).toBe(true);
  return ((await response.json()) as { status: string }).status;
}

// The dev server compiles client code on first use, so a click can land before React has
// hydrated the button; retry until the input actually opens
export async function startEditing(row: Locator): Promise<Locator> {
  const input = row.getByRole("textbox");
  await expect(async () => {
    await row.getByRole("button", { name: /^Edit/ }).click();
    await expect(input).toBeVisible({ timeout: 1_000 });
  }).toPass({ timeout: 30_000 });
  return input;
}

export async function signIn(page: Page): Promise<void> {
  await page.goto("/");
  await expect(page).toHaveURL(/\/login/);
  await page.getByLabel("Username").fill(username);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { name: "Documents" })).toBeVisible();
}

// As with Edit, a file chosen before hydration goes unnoticed; retry until the summary opens
export async function chooseFile(page: Page, path: string | string[]): Promise<Locator> {
  const summary = page.getByRole("dialog", { name: "Before you upload" });
  await expect(async () => {
    await page.locator('input[type="file"]').setInputFiles(path);
    await expect(summary).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 30_000 });
  return summary;
}
