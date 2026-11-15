import { createHash } from "node:crypto";
import { type Locator, type Page, expect, test } from "@playwright/test";
import { parseDesignIndex } from "../../src/ds/validate.js";
import {
  type VirtualCatalogQuery,
  decodeCatalogCursor,
  pageCatalog,
} from "../src/virtual-catalog.js";
import { compiledMutation } from "./compiled-mutations.js";

declare global {
  interface Window {
    __matrixOldDigest?: { complete: Promise<void>; matches: number };
  }
}

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

// Match the loader's normalization (including variant) before deriving corpus-bound cursors.
const readyEntries = parseDesignIndex(JSON.stringify(index)).entries;

test.beforeEach(async ({ context, page }, testInfo) => {
  const requested = process.env.MATRIX_TEST_MUTATION;
  const mutation =
    requested === "selection" ||
    requested === "stale" ||
    requested === "link" ||
    requested === "editor"
      ? requested
      : undefined;
  if (requested && !mutation) throw new Error("Unknown mutation");
  await page.route("**/assets/app.js*", async (route) => {
    const response = await route.fetch();
    if (response.status() !== 200) throw new Error("Missing compiled browser build");
    const script = await response.text();
    const hash = createHash("sha256").update(script).digest("hex");
    const changed = mutation
      ? await compiledMutation(mutation, script)
      : { body: script, proof: { kind: "fixed", originalSHA256: hash, servedSHA256: hash } };
    await testInfo.attach(mutation ? "compiled-mutation" : "compiled-response", {
      body: Buffer.from(JSON.stringify(changed.proof)),
      contentType: "application/json",
    });
    const omittedHeaders = ["content-length", "content-encoding", "transfer-encoding"];
    const headers = Object.fromEntries(
      Object.entries(response.headers()).filter(([name]) => !omittedHeaders.includes(name)),
    );
    await route.fulfill({ status: response.status(), headers, body: changed.body });
  });
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
  await page.locator("#locale-select").selectOption("en");
  await expect(page.locator("#detail-code-block")).toContainText("Output language: English");
  await expect(input).toHaveValue("#123");
  await page.locator("#btn-copy").click();
  const draftCopy = await page.evaluate(() => navigator.clipboard.readText());
  expect(draftCopy).toContain("#FAFAFA");
  expect(draftCopy).not.toContain("#123");
  await input.fill("#123456");
  await expect(page.locator("#detail-code-block")).toContainText("#123456");
});

for (const scenario of [
  { name: "keeps an untouched color caret when actual tokens arrive", moves: 2, extend: 0 },
  { name: "keeps an untouched color backward selection when tokens arrive", moves: 5, extend: 4 },
]) {
  test(scenario.name, async ({ page }) => {
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
    try {
      await page.goto(`/?cell=${materializedId}`);
      await expect(page.locator("#detail-code-block")).toHaveAttribute("aria-busy", "true");
      const input = page.locator("#detail-color-editor .color-editor-input").first();
      await expect(input).toHaveValue("#fcfcfc");
      await input.press("Home");
      for (let move = 0; move < scenario.moves; move++) await input.press("ArrowRight");
      for (let move = 0; move < scenario.extend; move++) await input.press("Shift+ArrowLeft");
      const selection = await input.evaluate((element: HTMLInputElement) => [
        element.selectionStart,
        element.selectionEnd,
        element.selectionDirection,
      ]);
      expect(selection.slice(0, 2)).toEqual([scenario.moves - scenario.extend, scenario.moves]);
      releaseBody();
      await expect(page.locator("#detail-code-block")).toHaveAttribute("aria-busy", "false");
      await expect(input).toHaveValue("#fafafa");
      await expect(input).toBeFocused();
      expect(
        await input.evaluate((element: HTMLInputElement) => [
          element.selectionStart,
          element.selectionEnd,
          element.selectionDirection,
        ]),
      ).toEqual(selection);
      await expect(page.locator("#detail-code-block")).toContainText("#FAFAFA");
    } finally {
      releaseBody();
    }
  });
}

test("ignores an old materialized response after selecting another cell", async ({ page }) => {
  await page.addInitScript((expectedBody) => {
    let markDigested!: () => void;
    const complete = new Promise<void>((resolve) => {
      markDigested = resolve;
    });
    const barrier = { complete, matches: 0 };
    window.__matrixOldDigest = barrier;
    const originalDigest = crypto.subtle.digest.bind(crypto.subtle);
    crypto.subtle.digest = async (algorithm, data) => {
      const isOldBody = new TextDecoder().decode(data) === expectedBody;
      const result = await originalDigest(algorithm, data);
      if (isOldBody) {
        barrier.matches++;
        markDigested();
      }
      return result;
    };
  }, materializedBody);
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
  try {
    await page.goto(`/?cell=${materializedId}`);
    await requested;
    await page.locator("#back-btn").click();
    await page.locator("#results .card").first().click();
    await expect(page).toHaveURL(/cell=virtual_/);
    await page.locator("#detail-color-editor .color-editor-input").first().fill("#654321");
    const current = await page.locator("#detail-code-block").textContent();
    releaseBody();
    const oldDigests = await page.evaluate(async () => {
      const barrier = window.__matrixOldDigest;
      if (!barrier) throw new Error("Old-body digest barrier was not installed");
      await barrier.complete;
      // Digest is the old handler's final async boundary. A posted task observes
      // the subsequent promise continuations after the microtask queue drains.
      await new Promise<void>((resolve) => {
        const channel = new MessageChannel();
        channel.port1.onmessage = () => {
          channel.port1.close();
          channel.port2.close();
          resolve();
        };
        channel.port2.postMessage(null);
      });
      return barrier.matches;
    });
    expect(oldDigests).toBe(1);
    await expect(page.locator("#detail-code-block")).toHaveText(current ?? "");
    await expect(page.locator("#detail-color-editor .color-editor-input").first()).toHaveValue(
      "#654321",
    );
  } finally {
    releaseBody();
  }
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

const openedCell = "virtual_0100_h2v-vv_minimal_clp_sminimal_v0";
const catalogSummary = {
  version: 1,
  generatedAt: "2026-07-21T00:00:00Z",
  sourceGeneratedAt: "2026-07-21T00:00:00Z",
  entryCount: index.entries.length,
  pageSize: 1000,
  pageCount: 1,
  facets: {
    jsic: [{ value: "6061", count: 1 }],
    color: [{ value: "white", count: 1 }],
    mood: [{ value: "minimal", count: 1 }],
    tag: [],
  },
};

// Boots from the summary alone; the only index page stays back until the returned function runs.
async function holdIndexPage(page: Page): Promise<() => void> {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/web-index.json", (route) => route.fulfill({ status: 404 }));
  await page.route("**/index-summary.json", (route) =>
    route.fulfill({ headers: { "access-control-allow-origin": "*" }, json: catalogSummary }),
  );
  await page.route("**/index/pages/0.json", async (route) => {
    await gate;
    await route.fulfill({
      json: {
        version: 1,
        page: 0,
        pageSize: 1000,
        entryCount: index.entries.length,
        generatedAt: catalogSummary.generatedAt,
        entries: index.entries,
      },
    });
  });
  return release;
}

// The index handler sets this attribute and re-renders in one task, so the page is settled here.
async function waitForIndex(page: Page): Promise<void> {
  await expect(page.locator("html")).toHaveAttribute("data-ds-index-source", "shards");
}

// Only the corpus-bound cursor changes when the held index arrives. Keep every other URL value,
// and check the new cursor and page against the real pager for the explicitly expected query.
async function expectReadyBrowse(
  page: Page,
  previousHref: string,
  query: VirtualCatalogQuery,
  requestedPage = 1,
): Promise<void> {
  const options = { pageSize: 25, page: requestedPage };
  const pending = pageCatalog(query, [], options);
  const ready = pageCatalog(query, readyEntries, options);
  const before = new URL(previousHref);
  const after = new URL(page.url());
  const oldCursor = before.searchParams.get("cursor");
  const newCursor = after.searchParams.get("cursor");
  expect(oldCursor).toBe(pending.cursor);
  expect(decodeCatalogCursor(oldCursor ?? "", pending.queryFingerprint)).toBe(pending.startRank);
  expect(ready.queryFingerprint).not.toBe(pending.queryFingerprint);
  expect(newCursor).toBe(ready.cursor);
  expect(decodeCatalogCursor(newCursor ?? "", ready.queryFingerprint)).toBe(ready.startRank);
  expect(newCursor).not.toBe(oldCursor);
  before.searchParams.delete("cursor");
  after.searchParams.delete("cursor");
  expect(after.href).toBe(before.href);
  await expect(page.locator("#pager-top .pager-jump")).toHaveValue(String(requestedPage));
  await expect(page.locator("#pager-top .pager-info")).toHaveText(
    `${ready.page} / ${ready.pageCount}`,
  );
}

async function markNode(input: Locator): Promise<void> {
  await input.evaluate((element: HTMLInputElement) => {
    element.dataset.arrivalProbe = "same-node";
  });
}

function readCaret(input: Locator): Promise<(number | null)[]> {
  return input.evaluate((element: HTMLInputElement) => [
    element.selectionStart,
    element.selectionEnd,
  ]);
}

test("opens a delayed materialized link once the index arrives", async ({ page }) => {
  const release = await holdIndexPage(page);
  try {
    await page.goto(`/?cell=${materializedId}`);
    await expect(page.locator("#results .card").first()).toBeVisible();
    await expect(page.locator("#detail-view")).toBeHidden();
    release();
    await expect(page.locator("#detail-view")).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`cell=${materializedId}`));
    await expect(page.locator("#detail-code-block")).toContainText("Materialized browser fixture.");
  } finally {
    release();
  }
});

test("still opens a waiting link after a language switch", async ({ page }) => {
  const release = await holdIndexPage(page);
  try {
    await page.goto(`/?cell=${materializedId}`);
    await expect(page.locator("#results .card").first()).toBeVisible();
    await page.locator("#locale-select").selectOption("en");
    release();
    await expect(page.locator("#detail-view")).toBeVisible();
    await expect(page.locator("#detail-code-block")).toContainText("Materialized browser fixture.");
  } finally {
    release();
  }
});

test("keeps a search typed while a materialized link waited", async ({ page }) => {
  const release = await holdIndexPage(page);
  try {
    await page.goto(`/?cell=${materializedId}`);
    await expect(page.locator("#results .card").first()).toBeVisible();
    await page.locator("#main-search-input").fill("dashboard minimal");
    await expect(page).toHaveURL(/q=dashboard/);
    const typedUrl = page.url();
    release();
    await waitForIndex(page);
    await expect(page.locator("#detail-view")).toBeHidden();
    await expect(page.locator("#main-search-input")).toHaveValue("dashboard minimal");
    await expectReadyBrowse(page, typedUrl, {
      categories: ["dashboard"],
      styles: ["minimal"],
      sort: "popular",
    });
  } finally {
    release();
  }
});

test("keeps a sort chosen while a materialized link waited", async ({ page }) => {
  const release = await holdIndexPage(page);
  try {
    await page.goto(`/?cell=${materializedId}`);
    await expect(page.locator("#results .card").first()).toBeVisible();
    await page.locator("#sort-btn-newest").click();
    await expect(page).toHaveURL(/sort=newest/);
    await page.locator("#pager-top .pager-jump").fill("3");
    await page.locator("#pager-top button", { hasText: /移動|Go/ }).click();
    await expect(page.locator("#pager-top .pager-info")).toContainText("3 /");
    const sortedUrl = page.url();
    release();
    await waitForIndex(page);
    await expect(page.locator("#detail-view")).toBeHidden();
    await expect(page.locator("#sort-btn-newest")).toHaveAttribute("aria-pressed", "true");
    await expectReadyBrowse(page, sortedUrl, { sort: "newest" }, 3);
  } finally {
    release();
  }
});

test("does not reopen a waiting link after another cell was closed", async ({ page }) => {
  const release = await holdIndexPage(page);
  try {
    await page.goto(`/?cell=${materializedId}`);
    await page.locator("#results .card").first().click();
    await expect(page).toHaveURL(/cell=virtual_/);
    await page.locator("#back-btn").click();
    await expect(page.locator("#search-view")).toBeVisible();
    const closedUrl = page.url();
    release();
    await waitForIndex(page);
    await expect(page.locator("#detail-view")).toBeHidden();
    await expect(page.locator("#search-view")).toBeVisible();
    await expectReadyBrowse(page, closedUrl, { sort: "popular" });
  } finally {
    release();
  }
});

test("keeps the color editor node, caret and draft on index arrival", async ({ page }) => {
  const release = await holdIndexPage(page);
  try {
    await page.goto(`/?cell=${openedCell}`);
    await expect(page.locator("#detail-view")).toBeVisible();
    const input = page.locator("#detail-color-editor .color-editor-input").first();
    await input.fill("#123");
    await input.press("ArrowLeft");
    await markNode(input);
    const caret = await readCaret(input);
    release();
    await waitForIndex(page);
    await expect(input).toHaveAttribute("data-arrival-probe", "same-node");
    await expect(input).toBeFocused();
    await expect(input).toHaveValue("#123");
    expect(await readCaret(input)).toEqual(caret);
  } finally {
    release();
  }
});

test("keeps an edited color and the page text on index arrival", async ({ page }) => {
  const release = await holdIndexPage(page);
  try {
    await page.goto(`/?cell=${openedCell}`);
    await expect(page.locator("#detail-view")).toBeVisible();
    const input = page.locator("#detail-color-editor .color-editor-input").first();
    await input.fill("#123456");
    await expect(input).toHaveValue("#123456");
    const pageText = await page.locator("#detail-code-block").textContent();
    await markNode(input);
    release();
    await waitForIndex(page);
    await expect(input).toHaveAttribute("data-arrival-probe", "same-node");
    await expect(input).toBeFocused();
    await expect(input).toHaveValue("#123456");
    await expect(page.locator("#detail-code-block")).toHaveText(pageText ?? "");
  } finally {
    release();
  }
});

test("builds a fresh editor for the cell opened after the first one", async ({ page }) => {
  const release = await holdIndexPage(page);
  try {
    await page.goto(`/?cell=${openedCell}`);
    await expect(page.locator("#detail-view")).toBeVisible();
    const firstInput = page.locator("#detail-color-editor .color-editor-input").first();
    await firstInput.fill("#12");
    await firstInput.evaluate((element: HTMLInputElement) => {
      element.dataset.arrivalProbe = "first-cell";
    });
    await page.locator("#back-btn").click();
    const pendingPage = pageCatalog({ sort: "popular" }, [], { pageSize: 25, page: 1 });
    const otherIndex = pendingPage.items.findIndex((entry) => entry.id !== openedCell);
    expect(otherIndex).toBeGreaterThanOrEqual(0);
    const otherEntry = pendingPage.items[otherIndex];
    if (!otherEntry) throw new Error("Pending fixture has no different cell");
    expect(otherEntry.id).not.toBe(openedCell);
    const otherCard = page.locator("#results .card").nth(otherIndex);
    await expect(otherCard).toBeVisible();
    await otherCard.click();
    await expect(page.locator("#detail-view")).toBeVisible();
    const secondCell = new URL(page.url()).searchParams.get("cell");
    expect(secondCell).toBe(otherEntry.id);
    expect(secondCell).not.toBe(openedCell);
    await expect(page.locator("#detail-filename")).toHaveText(`${otherEntry.id}.design.md`);
    const input = page.locator("#detail-color-editor .color-editor-input").first();
    const ownValue = await input.inputValue();
    expect(ownValue).not.toBe("#12");
    await expect(input).not.toHaveAttribute("data-arrival-probe", "first-cell");
    await markNode(input);
    release();
    await waitForIndex(page);
    await expect(page).toHaveURL(new RegExp(`cell=${secondCell}`));
    await expect(input).toHaveAttribute("data-arrival-probe", "same-node");
    await expect(input).toHaveValue(ownValue);
  } finally {
    release();
  }
});
