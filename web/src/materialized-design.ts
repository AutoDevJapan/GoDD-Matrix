import type { DesignIndexEntry } from "../../src/ds/types.js";
import { designRawUrl } from "./lib.js";

export interface MaterializedDesign {
  readonly markdown: string;
  readonly source: string;
  readonly hashVerified: boolean;
}

export interface LoadMaterializedDesignOptions {
  readonly fetcher?: typeof fetch;
  readonly subtle?: SubtleCrypto | null;
}

function toHex(bytes: ArrayBuffer): string {
  return [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** Fetch a materialized DESIGN.md and verify its index SHA-256 in the browser. */
export async function loadMaterializedDesign(
  entry: DesignIndexEntry,
  options: LoadMaterializedDesignOptions = {},
): Promise<MaterializedDesign> {
  const source = designRawUrl(entry);
  const response = await (options.fetcher ?? fetch)(source, { cache: "no-cache" });
  if (!response.ok) {
    throw new Error(`DESIGN.md request failed (HTTP ${response.status})`);
  }

  const markdown = await response.text();
  const subtle = options.subtle === undefined ? globalThis.crypto?.subtle : options.subtle;
  if (!subtle) throw new Error("Web Crypto is unavailable");
  const digest = await subtle.digest("SHA-256", new TextEncoder().encode(markdown));

  return {
    markdown,
    source,
    hashVerified: `sha256:${toHex(digest)}` === entry.hash,
  };
}
