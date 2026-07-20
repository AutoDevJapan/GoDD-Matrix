import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import type { DesignIndexEntry } from "../../src/ds/types.js";
import { loadMaterializedDesign } from "./materialized-design.js";

const markdown = "# DESIGN\nverified body\n";
const entry: DesignIndexEntry = {
  id: "6061_white_minimal",
  path: "design-md/6061/white/minimal/DESIGN.md",
  jsic: "6061",
  color: "white",
  mood: "minimal",
  title: "Bookstore",
  hash: `sha256:${createHash("sha256").update(markdown, "utf8").digest("hex")}`,
  createdAt: "2026-07-21T00:00:00Z",
};

describe("loadMaterializedDesign", () => {
  it("fetches the public raw path and verifies the exact UTF-8 body", async () => {
    const fetcher = vi.fn(async () => new Response(markdown, { status: 200 }));

    await expect(loadMaterializedDesign(entry, { fetcher })).resolves.toMatchObject({
      markdown,
      hashVerified: true,
    });
    expect(fetcher).toHaveBeenCalledWith(
      "https://raw.githubusercontent.com/AutoDevJapan/GoDD-Design-Systems/main/design-md/6061/white/minimal/DESIGN.md",
      { cache: "no-cache" },
    );
  });

  it("reports a hash mismatch without discarding the fetched body", async () => {
    const result = await loadMaterializedDesign(
      { ...entry, hash: `sha256:${"0".repeat(64)}` },
      { fetcher: async () => new Response(markdown, { status: 200 }) },
    );

    expect(result.markdown).toBe(markdown);
    expect(result.hashVerified).toBe(false);
  });

  it("rejects a failed HTTP response", async () => {
    await expect(
      loadMaterializedDesign(entry, {
        fetcher: async () => new Response("missing", { status: 404 }),
      }),
    ).rejects.toThrow("HTTP 404");
  });

  it("fails explicitly when Web Crypto is unavailable", async () => {
    await expect(
      loadMaterializedDesign(entry, {
        fetcher: async () => new Response(markdown, { status: 200 }),
        subtle: null,
      }),
    ).rejects.toThrow("Web Crypto is unavailable");
  });
});
