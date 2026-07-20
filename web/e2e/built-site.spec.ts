import { createHash } from "node:crypto";
import { expect, test } from "@playwright/test";

const materializedBody = "# DESIGN\n\nMaterialized browser fixture.\n";
const materializedId = "6061_white_minimal";
const materializedPath = "design-md/6061/white/minimal/DESIGN.md";
const index = {
  version: 1,
  entries: [
    {
      id: materializedId,
      path: materializedPath,
      jsic: "6061",
      color: "white",
      mood: "minimal",
      title: "Browser fixture",
      hash: `sha256:${createHash("sha256").update(materializedBody).digest("hex")}`,
      createdAt: "2026-07-21T00:00:00Z",
    },
  ],
};

test.beforeEach(async ({ context, page }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.route("**/web-index.json", (route) => route.fulfill({ json: index }));
  await page.route("**/taxonomy.json", (route) =>
    route.fulfill({ json: { version: 1, colors: {}, moods: {} } }),
  );
  await page.route(`**/${materializedPath}`, (route) =>
    route.fulfill({ contentType: "text/markdown", body: materializedBody }),
  );
  await page.route("https://fonts.googleapis.com/**", (route) => route.abort());
  await page.route("https://fonts.gstatic.com/**", (route) => route.abort());
});

test("loads, filters, opens a detail, switches locale, and restores its permalink", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.locator("#results .card")).toHaveCount(1);

  await page.locator("#main-search-input").fill("dashboard minimal");
  await expect(page.locator("#active-pills-bar")).toBeVisible();
  await page.locator("#results .card").first().click();
  await expect(page.locator("#detail-view")).toBeVisible();
  await expect(page).toHaveURL(/cell=virtual_/);

  await page.locator("#locale-select").selectOption("en");
  await expect(page.locator("#back-btn")).toHaveText("← Back to search");
  await expect(page.locator("#detail-code-block")).toContainText("Output language: English");

  const permalink = page.url();
  await page.goto(permalink);
  await expect(page.locator("#detail-view")).toBeVisible();
  await expect(page.locator("#detail-code-block")).toContainText("Output language: English");
});

test("fetches a materialized body and supports copy and download", async ({ page }) => {
  await page.goto(`/?cell=${materializedId}`);
  const preview = page.locator("#detail-code-block");
  await expect(preview).toContainText("Materialized browser fixture.");
  await expect(page.locator("#btn-copy")).toBeEnabled();

  await page.locator("#btn-copy").click();
  const clipboard = await page.evaluate(() => navigator.clipboard.readText());
  expect(clipboard).toContain("Materialized browser fixture.");

  const downloadPromise = page.waitForEvent("download");
  await page.locator("#btn-download").click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe(`${materializedId}.design.md`);
  const stream = await download.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  expect(Buffer.concat(chunks).toString("utf8")).toContain("Materialized browser fixture.");
});
