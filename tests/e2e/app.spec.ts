import { expect, test } from "@playwright/test";

test("primary research surfaces are available", async ({ page }) => {
  await page.route("**/api/dashboard", (route) => route.fulfill({ json: { documentCount: 0, chunkCount: 0, sources: [], recentDocuments: [] } }));
  await page.route("**/api/conversations**", (route) => route.fulfill({ json: { conversations: [] } }));
  await page.route("**/api/integrations", (route) => route.fulfill({ json: { enabled: false, toolkits: [], connections: [] } }));
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Ask the company. See the evidence." })).toBeVisible();
  await page.getByRole("link", { name: "Research" }).click();
  await expect(page.getByRole("heading", { name: "What do you need to understand?" })).toBeVisible();
  await page.getByRole("link", { name: "Integrations" }).click();
  await expect(page.getByRole("heading", { name: "Bring the work with you." })).toBeVisible();
  await page.keyboard.press("Control+k");
  await expect(page).toHaveURL(/\/search/);
  await expect(page.getByPlaceholder("Search the company brain…")).toBeFocused();
});
