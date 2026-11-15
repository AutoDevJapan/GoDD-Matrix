import { strict as assert, AssertionError } from "node:assert";
import { createHash } from "node:crypto";
import { lstat, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { it } from "vitest";
import { assertFixedRealDataset } from "./matrix-real-dataset.js";

it("accepts the fixed full DS index through the actual catalog consumer", async () => {
  const filename = process.env.MATRIX_REAL_INDEX_PATH;
  if (!filename) throw new Error("MATRIX_REAL_INDEX_PATH must name the fixed full-index input");
  if (!(await lstat(filename)).isFile()) throw new Error("Non-regular real index input");
  const receiptBytes = await readFile("web/browser-evidence/real-index-input.json");
  const input = JSON.parse(receiptBytes.toString("utf8"));
  assert.equal(input.schema, "matrix-real-index-input-v1");
  assert.equal(input.acquisition, "ci-fixed-public-get");
  assert.equal(input.sameHeldReadback, true);
  assert.equal(path.resolve(input.inputFile), path.resolve(filename));
  const bytes = await readFile(filename);
  assert.equal(bytes.length, 32_815_467);
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const expectedSHA = "62eb8dbde50783aba4fc15f4578a979342cf2cb06fa40bc03c67e2412c879fe0";
  assert.equal(sha256, expectedSHA);
  assert.equal(input.sha256, sha256);
  const gitBlob = createHash("sha1")
    .update(Buffer.from(`blob ${bytes.length}\0`))
    .update(bytes)
    .digest("hex");
  assert.equal(gitBlob, "547a15e4b588189758ab6d68ef06cc957359d846");
  assert.equal(input.gitBlob, gitBlob);
  const mutated = Buffer.from(bytes);
  mutated[0] = (mutated[0] ?? 0) ^ 1;
  assert.notDeepEqual(mutated, bytes);
  const mutatedSHA = createHash("sha256").update(mutated).digest("hex");
  assert.notEqual(mutatedSHA, expectedSHA);
  assert.throws(
    () => assertFixedRealDataset(mutated),
    (error: unknown) =>
      error instanceof AssertionError &&
      error.actual === mutatedSHA &&
      error.expected === expectedSHA,
  );
  const coverage = assertFixedRealDataset(bytes);
  assert.equal(createHash("sha256").update(bytes).digest("hex"), sha256);
  await writeFile(
    "web/browser-evidence/real-catalog.json",
    `${JSON.stringify(
      {
        schema: "matrix-real-catalog-v1",
        inputSHA256: sha256,
        inputBytes: bytes.length,
        inputGitBlob: gitBlob,
        inputReceiptSHA256: createHash("sha256").update(receiptBytes).digest("hex"),
        mutationRejectedAtSHA: true,
        coverage,
        run: { id: process.env.GITHUB_RUN_ID, attempt: process.env.GITHUB_RUN_ATTEMPT },
      },
      null,
      2,
    )}\n`,
    { flag: "wx" },
  );
  console.info(`Matrix real-dataset consumer coverage: ${JSON.stringify(coverage)}`);
}, 120_000);
