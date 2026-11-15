#!/usr/bin/env node
import { createHash } from "node:crypto";
import { appendFile, lstat, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const commit = "7d3ed9a3d171fee1b3f63f62ac73b71e102e8892";
const source = {
  repositoryID: 1293586933,
  commit,
  path: "index.json",
  url: [
    "https://raw.githubusercontent.com/AutoDevJapan/GoDD-Design-Systems",
    commit,
    "index.json",
  ].join("/"),
};
const expected = {
  bytes: 32_815_467,
  sha256: "62eb8dbde50783aba4fc15f4578a979342cf2cb06fa40bc03c67e2412c879fe0",
  gitBlob: "547a15e4b588189758ab6d68ef06cc957359d846",
};
const root = process.env.RUNNER_TEMP;
if (!root || !path.isAbsolute(root) || /[\r\n]/.test(root)) {
  throw new Error("Expected an owned CI input directory");
}
if (!(await lstat(root)).isDirectory()) throw new Error("Non-plain CI input directory");
if (!process.env.GITHUB_ENV) throw new Error("Expected CI environment output");
const evidence = "web/browser-evidence";
if (!(await lstat(evidence)).isDirectory()) throw new Error("Missing regular evidence directory");
const response = await fetch(source.url, {
  redirect: "error",
  headers: { "accept-encoding": "identity" },
  signal: AbortSignal.timeout(120_000),
});
if (response.status !== 200 || !response.body) {
  if (response.body) await response.body.cancel();
  throw new Error("Fixed index GET did not succeed");
}
const declared = response.headers.get("content-length");
const encoding = response.headers.get("content-encoding");
if (
  declared !== null &&
  (!encoding || encoding === "identity") &&
  Number(declared) !== expected.bytes
) {
  await response.body.cancel();
  throw new Error("Unexpected fixed index content length");
}
const chunks = [];
let length = 0;
const reader = response.body.getReader();
const failures = [];
try {
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.byteLength;
    if (length > expected.bytes) throw new Error("Fixed index exceeds its declared input bound");
    chunks.push(value);
  }
} catch (error) {
  failures.push(error);
} finally {
  try {
    await reader.cancel();
  } catch (error) {
    failures.push(error);
  }
  try {
    reader.releaseLock();
  } catch (error) {
    failures.push(error);
  }
}
if (failures.length) throw new AggregateError(failures, "Fixed index read failed");
const bytes = Buffer.concat(chunks, length);
const sha256 = createHash("sha256").update(bytes).digest("hex");
const gitBlob = createHash("sha1")
  .update(Buffer.from(`blob ${bytes.length}\0`))
  .update(bytes)
  .digest("hex");
if (bytes.length !== expected.bytes || sha256 !== expected.sha256 || gitBlob !== expected.gitBlob) {
  throw new Error("Fixed index byte identity mismatch");
}
const inputFile = path.join(root, "matrix-real-index-7d3.json");
await writeFile(inputFile, bytes, { flag: "wx", mode: 0o600 });
const readback = await readFile(inputFile);
if (!readback.equals(bytes)) throw new Error("Fixed input readback mismatch");
const receipt = {
  schema: "matrix-real-index-input-v1",
  acquisition: "ci-fixed-public-get",
  source,
  bytes: bytes.length,
  sha256,
  gitBlob,
  HTTPstatus: response.status,
  inputFile,
  sameHeldReadback: true,
  observedAtUTC: new Date().toISOString(),
  run: { id: process.env.GITHUB_RUN_ID, attempt: process.env.GITHUB_RUN_ATTEMPT },
};
await writeFile(`${evidence}/real-index-input.json`, `${JSON.stringify(receipt, null, 2)}\n`, {
  flag: "wx",
});
await appendFile(process.env.GITHUB_ENV, `MATRIX_REAL_INDEX_PATH=${inputFile}\n`);
process.stdout.write("Fixed real index byte identity verified.\n");
