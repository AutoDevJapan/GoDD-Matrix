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

test("browses the virtual catalog, preserves URL state, and jumps by ordinal", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("#results .card")).toHaveCount(25);
  await expect(page.locator("#matches-count-display")).toContainText(/[0-9]/);

  await page.locator("#main-search-input").fill("dashboard minimal");
  await expect(page).toHaveURL(/q=dashboard/);
  await expect(page).toHaveURL(/cursor=v3\./);

  await expect(page.locator("#results .card").first()).toBeVisible();
  await expect(page.locator("#results .card-title-ja").first()).not.toBeEmpty();

  await page.locator("#pager-top .pager-jump").fill("500");
  await page.locator("#pager-top button", { hasText: /移動|Go/ }).click();
  await expect(page.locator("#pager-top .pager-info")).toContainText("500 /");
  await expect(page).toHaveURL(/cursor=v3\./);

  const jumpedUrl = page.url();
  await page.goto(jumpedUrl);
  await expect(page.locator("#pager-top .pager-info")).toContainText("500 /");
  await expect(page.locator("#main-search-input")).toHaveValue("dashboard minimal");
});

test("opens a virtual cell permalink and reloads the same addressable cell", async ({ page }) => {
  await page.goto("/?q=dashboard+minimal&sort=newest");
  await page.locator("#results .card").first().click();
  await expect(page.locator("#detail-view")).toBeVisible();
  await expect(page).toHaveURL(/cell=virtual_/);

  const permalink = page.url();
  const cellId = new URL(permalink).searchParams.get("cell");
  expect(cellId).toMatch(/^virtual_/);

  await page.goto(permalink);
  await expect(page.locator("#detail-view")).toBeVisible();
  await expect(page.locator("#detail-filename")).toHaveText(`${cellId}.design.md`);
  await expect(page.locator("#detail-code-block")).not.toBeEmpty();
});

test("keeps the materialized cell path fetchable by id", async ({ page }) => {
  await page.goto(`/?cell=${materializedId}`);
  await expect(page.locator("#detail-view")).toBeVisible();
  await expect(page.locator("#detail-code-block")).toContainText("Materialized browser fixture.");
});

test("copies a virtual prompt with consistent fine-class industry identity", async ({ page }) => {
  await page.goto("/?cell=virtual_0100_h2v-vv_minimal_clp_sminimal_v0");
  await page.locator("#locale-select").selectOption("ja");
  await expect(page.locator("#detail-view")).toBeVisible();
  await expect(page.locator("#detail-code-block")).toContainText(
    "主として管理事務を行う本社等（JSIC 0100）",
  );
  await page.locator("#btn-copy").click();
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  expect(copied).toContain("主として管理事務を行う本社等（JSIC 0100）");
  expect(copied).toContain("- 業種: 主として管理事務を行う本社等");
  expect(copied).not.toContain("農業，林業向けに");
  await page.locator("#locale-select").selectOption("en");
  await expect(page.locator("#detail-code-block")).toContainText("Industry: JSIC 0100");
  await page.locator("#btn-copy").click();
  const english = await page.evaluate(() => navigator.clipboard.readText());
  expect(english).toContain("- Industry: JSIC 0100");
  expect(english).not.toContain("Agriculture and forestry");
});
