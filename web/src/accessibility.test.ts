import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("web accessibility contracts", () => {
  it("exposes search and toast semantics in the static page", async () => {
    const html = await readFile(new URL("./index.html", import.meta.url), "utf8");

    expect(html).toContain('id="main-search-input" aria-label=');
    expect(html).toContain('id="toast" class="toast" role="status" aria-live="polite"');
  });

  it("renders result and related navigation as native buttons", async () => {
    const source = await readFile(new URL("./main.ts", import.meta.url), "utf8");

    expect(source).toContain('el("button", { class: "card" })');
    expect(source).toContain('el("button", { class: "related-card" })');
  });
});
