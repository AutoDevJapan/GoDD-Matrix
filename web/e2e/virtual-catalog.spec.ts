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

test("keeps color edits made while a materialized body is loading", async ({ page }) => {
  let releaseBody!: () => void;
  const bodyReady = new Promise<void>((resolve) => {
    releaseBody = resolve;
  });
  const body =
    "# DESIGN\n\n| Background | `--color-bg` | #FAFAFA |\n| Accent | `--color-accent` | #C72323 |\n";
  await page.route(`**/${materializedPath}`, async (route) => {
    await bodyReady;
    await route.fulfill({ contentType: "text/markdown", body });
  });
  await page.goto(`/?cell=${materializedId}`);
  await expect(page.locator("#detail-code-block")).toHaveAttribute("aria-busy", "true");
  await page.locator("#detail-color-editor .color-editor-input").first().fill("#123456");
  releaseBody();
  await expect(page.locator("#detail-code-block")).toHaveAttribute("aria-busy", "false");
  await expect(page.locator("#detail-color-editor .color-editor-input").first()).toHaveValue(
    "#123456",
  );
  await expect(page.locator("#detail-code-block")).toContainText("#123456");
  await expect(page.locator("#detail-color-editor .color-editor-input").nth(1)).toHaveValue(
    "#c72323",
  );
  await page.locator("#locale-select").selectOption("en");
  await expect(page.locator("#detail-code-block")).toContainText("Output language: English");
  await expect(page.locator("#detail-color-editor .color-editor-input").first()).toHaveValue(
    "#123456",
  );
  await page.locator("#btn-copy").click();
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  expect(copied).toContain("#123456");
  expect(copied).toContain("#C72323");
  await page.locator("#back-btn").click();
  await page.goto(`/?cell=${materializedId}`);
  await expect(page.locator("#detail-code-block")).toHaveAttribute("aria-busy", "false");
  await expect(page.locator("#detail-color-editor .color-editor-input").first()).toHaveValue(
    "#fafafa",
  );
});

test("keeps incomplete color text and its caret while the body arrives", async ({ page }) => {
  let releaseBody!: () => void;
  const ready = new Promise<void>((resolve) => {
    releaseBody = resolve;
  });
  const body =
    "# DESIGN\n\n| Background | `--color-bg` | #FAFAFA |\n| Accent | `--color-accent` | #C72323 |\n";
  await page.route(`**/${materializedPath}`, async (route) => {
    await ready;
    await route.fulfill({ contentType: "text/markdown", body });
  });
  await page.goto(`/?cell=${materializedId}`);
  const input = page.locator("#detail-color-editor .color-editor-input").first();
  await input.fill("#123");
  await input.press("ArrowLeft");
  releaseBody();
  await expect(page.locator("#detail-code-block")).toHaveAttribute("aria-busy", "false");
  await expect(input).toHaveValue("#123");
  await expect(input).toBeFocused();
  expect(await input.evaluate((e: HTMLInputElement) => [e.selectionStart, e.selectionEnd])).toEqual(
    [3, 3],
  );
  await expect(page.locator("#detail-code-block")).toContainText("#FAFAFA");
  await input.fill("#123456");
  await expect(page.locator("#detail-code-block")).toContainText("#123456");
});

test("ignores an old materialized response after selecting another cell", async ({ page }) => {
  let releaseBody!: () => void;
  let markRequested!: () => void;
  const requested = new Promise<void>((resolve) => {
    markRequested = resolve;
  });
  const ready = new Promise<void>((resolve) => {
    releaseBody = resolve;
  });
  await page.route(`**/${materializedPath}`, async (route) => {
    markRequested();
    await ready;
    await route.fulfill({ contentType: "text/markdown", body: materializedBody });
  });
  await page.goto(`/?cell=${materializedId}`);
  await requested;
  await page.locator("#back-btn").click();
  await page.locator("#results .card").first().click();
  await expect(page).toHaveURL(/cell=virtual_/);
  await page.locator("#detail-color-editor .color-editor-input").first().fill("#654321");
  const current = await page.locator("#detail-code-block").textContent();
  const response = page.waitForResponse((r) => r.url().endsWith(materializedPath));
  releaseBody();
  await response;
  await expect(page.locator("#detail-code-block")).toHaveText(current ?? "");
  await expect(page.locator("#detail-color-editor .color-editor-input").first()).toHaveValue(
    "#654321",
  );
});

test("keeps materialized content while copying its English fine-class request", async ({
  page,
}) => {
  await page.goto(`/?cell=${materializedId}`);
  await page.locator("#locale-select").selectOption("en");
  await expect(page.locator("#detail-code-block")).toContainText("Materialized browser fixture.");
  await page.locator("#btn-copy").click();
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  expect(copied.replace(/\r\n/g, "\n")).toContain(materializedBody.trim());
  expect(copied).toContain("- Industry: JSIC 6061");
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
