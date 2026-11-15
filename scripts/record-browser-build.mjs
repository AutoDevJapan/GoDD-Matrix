#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  appendFile,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import path from "node:path";

const mode = process.argv[2];
if (mode !== "before" && mode !== "after" && mode !== "--self-test") {
  throw new Error("Unknown build-proof phase");
}
const digest = (bytes, algorithm = "sha256") => createHash(algorithm).update(bytes).digest("hex");
const git = (...args) => execFileSync("git", args, { encoding: "utf8" }).trim();
const gitList = (...args) =>
  execFileSync("git", args, { encoding: "utf8" }).split("\0").filter(Boolean);
function headBlob(filename) {
  const entry = git("ls-tree", "-z", "HEAD", "--", filename);
  if (!entry) return undefined;
  const match = /^(100644|100755) blob ([0-9a-f]{40})\t([^\0]+)\0$/.exec(entry);
  if (!match || match[3] !== filename) throw new Error("Invalid tracked build input entry");
  return match[2];
}
async function directory(filename) {
  if (!(await lstat(filename)).isDirectory()) {
    const error = new Error(`Not a plain directory: ${filename}`);
    error.code = "NOT_PLAIN_DIRECTORY";
    throw error;
  }
}
async function writeProof(filename, text) {
  await writeFile(filename, text, { flag: "wx", mode: 0o600 });
}
async function inventory(root, prefix = "") {
  await directory(root);
  const files = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const name = prefix + entry.name;
    const filename = path.join(root, entry.name);
    if (entry.isDirectory()) files.push(...(await inventory(filename, `${name}/`)));
    else if (entry.isFile()) {
      const bytes = await readFile(filename);
      files.push({ path: name, bytes: bytes.length, sha256: digest(bytes) });
    } else throw new Error(`Non-regular output: ${name}`);
  }
  return files.sort((left, right) => left.path.localeCompare(right.path, "en"));
}

async function collectEvidence(root, announce) {
  const evidenceFiles = await inventory(root);
  await announce();
  return evidenceFiles;
}
async function completedStreams(root, evidenceFiles, outcomes) {
  const receipts = [];
  for (const phase of ["selection", "stale", "link", "editor", "fixed"]) {
    if (outcomes[phase] !== "success") {
      const error = new Error(`Native phase did not pass: ${phase}`);
      error.code = "NATIVE_PHASE_FAILED";
      throw error;
    }
    const filename = path.join(root, `${phase}.streams.json`);
    if (!(await lstat(filename)).isFile()) throw new Error("Missing completed stream receipt");
    const receipt = JSON.parse(await readFile(filename, "utf8"));
    if (
      receipt.phase !== phase ||
      receipt.stdoutExit !== 0 ||
      receipt.stderrExit !== 0 ||
      !Number.isInteger(receipt.stdoutPID) ||
      !Number.isInteger(receipt.stderrPID) ||
      receipt.stdoutPID <= 0 ||
      receipt.stderrPID <= 0 ||
      receipt.stdoutPID === receipt.stderrPID ||
      receipt.streams?.length !== 2
    ) {
      throw new Error("Native phase stream capture was incomplete");
    }
    for (const stream of ["stdout", "stderr"]) {
      const captured = receipt.streams.find((entry) => entry.stream === stream);
      const file = evidenceFiles.find((entry) => entry.path === `${phase}.${stream}.txt`);
      if (!captured || !file || captured.bytes !== file.bytes || captured.sha256 !== file.sha256) {
        throw new Error("Stream changed after its helper was joined");
      }
    }
    const checkedName = path.join(root, `${phase}.checked.json`);
    if (!(await lstat(checkedName)).isFile()) throw new Error("Missing checked browser report");
    const checked = JSON.parse(await readFile(checkedName, "utf8"));
    const reportFile = evidenceFiles.find((entry) => entry.path === `${phase}.json`);
    const expectedExit = phase === "fixed" ? 0 : 1;
    if (
      checked.phase !== phase ||
      checked.expectedExit !== expectedExit ||
      checked.actualExit !== expectedExit ||
      !reportFile ||
      checked.reportSHA256 !== reportFile.sha256
    ) {
      const error = new Error("Browser report was not checked for the required phase");
      error.code = "BROWSER_REPORT_UNCHECKED";
      throw error;
    }
    receipts.push(receipt);
  }
  return receipts;
}

async function realCatalogEvidence(root, evidenceFiles) {
  if (
    process.env.REAL_INPUT_OUTCOME !== "success" ||
    process.env.REAL_CATALOG_OUTCOME !== "success"
  ) {
    throw new Error("The fixed real-index consumer did not complete successfully");
  }
  const readEvidence = async (name) => {
    const filename = path.join(root, name);
    if (!(await lstat(filename)).isFile()) throw new Error("Missing regular real-data evidence");
    const bytes = await readFile(filename);
    const expected = evidenceFiles.find((entry) => entry.path === name);
    if (!expected || expected.bytes !== bytes.length || expected.sha256 !== digest(bytes)) {
      throw new Error("Real-data evidence changed after inventory");
    }
    return { value: JSON.parse(bytes.toString("utf8")), sha256: digest(bytes) };
  };
  const stdoutFile = evidenceFiles.find((entry) => entry.path === "real-catalog.stdout.txt");
  const stderrFile = evidenceFiles.find((entry) => entry.path === "real-catalog.stderr.txt");
  const exitFile = evidenceFiles.find((entry) => entry.path === "real-catalog.exit.txt");
  if (!stdoutFile || !stderrFile || !exitFile) {
    throw new Error("Missing real consumer stream evidence");
  }
  const exitBytes = await readFile(path.join(root, "real-catalog.exit.txt"));
  if (exitBytes.toString("utf8") !== "0\n" || exitFile.sha256 !== digest(exitBytes)) {
    throw new Error("The real consumer exit receipt was not zero");
  }
  const input = await readEvidence("real-index-input.json");
  const result = await readEvidence("real-catalog.json");
  const tests = await readEvidence("real-catalog.vitest.json");
  const pinnedSHA = "62eb8dbde50783aba4fc15f4578a979342cf2cb06fa40bc03c67e2412c879fe0";
  const pinnedBlob = "547a15e4b588189758ab6d68ef06cc957359d846";
  if (
    input.value.schema !== "matrix-real-index-input-v1" ||
    input.value.acquisition !== "ci-fixed-public-get" ||
    input.value.bytes !== 32_815_467 ||
    input.value.sha256 !== pinnedSHA ||
    input.value.gitBlob !== pinnedBlob ||
    input.value.HTTPstatus !== 200 ||
    input.value.sameHeldReadback !== true ||
    input.value.source?.repositoryID !== 1293586933 ||
    input.value.source?.commit !== "7d3ed9a3d171fee1b3f63f62ac73b71e102e8892" ||
    input.value.source?.path !== "index.json" ||
    input.value.run?.id !== process.env.GITHUB_RUN_ID ||
    input.value.run?.attempt !== process.env.GITHUB_RUN_ATTEMPT
  ) {
    throw new Error("Real-data input is not the pinned published corpus");
  }
  if (
    result.value.schema !== "matrix-real-catalog-v1" ||
    result.value.inputSHA256 !== pinnedSHA ||
    result.value.inputBytes !== 32_815_467 ||
    result.value.inputGitBlob !== pinnedBlob ||
    result.value.inputReceiptSHA256 !== input.sha256 ||
    result.value.mutationRejectedAtSHA !== true ||
    result.value.run?.id !== process.env.GITHUB_RUN_ID ||
    result.value.run?.attempt !== process.env.GITHUB_RUN_ATTEMPT
  ) {
    throw new Error("Real consumer result is not bound to the supplied input");
  }
  const report = tests.value;
  const file = report.testResults?.[0];
  const test = file?.assertionResults?.[0];
  if (
    report.success !== true ||
    report.numTotalTests !== 1 ||
    report.numPassedTests !== 1 ||
    report.numFailedTests !== 0 ||
    report.numPendingTests !== 0 ||
    report.numTodoTests !== 0 ||
    report.testResults.length !== 1 ||
    file.status !== "passed" ||
    !file.name.replaceAll("\\", "/").endsWith("verification/matrix-real-dataset.test.ts") ||
    file.assertionResults.length !== 1 ||
    test.status !== "passed" ||
    test.title !== "accepts the fixed full DS index through the actual catalog consumer"
  ) {
    throw new Error("The mandatory real-data test was skipped, failed, or replaced");
  }
  const coverage = result.value.coverage;
  if (
    coverage?.sha256 !== pinnedSHA ||
    coverage.entryCount !== 51_729 ||
    coverage.uniqueIDs !== 51_729 ||
    coverage.prefixRowsChecked !== 103_458 ||
    !Number.isSafeInteger(coverage.colorRowsChecked) ||
    coverage.colorRowsChecked < 51_729 ||
    coverage.distinctColors !== 295 ||
    coverage.distinctMoods !== 50 ||
    coverage.distinctTags !== 5 ||
    coverage.distinctCategories !== 8 ||
    coverage.distinctStyles !== 7 ||
    coverage.canonicalRows !== 51_729 ||
    coverage.legacyRows !== 0 ||
    coverage.nonRepresentativeColorRows !== 51_727 ||
    !Number.isSafeInteger(coverage.representativeQueries) ||
    coverage.representativeQueries < 2 ||
    coverage.representativeClasses?.length !== 71 ||
    JSON.stringify(coverage.representativeClasses) !== JSON.stringify(coverage.requiredClasses) ||
    JSON.stringify(coverage.knownPositiveIDs) !==
      JSON.stringify(["4121_s-h01_authoritative", "9293_dp-h21_cool"])
  ) {
    throw new Error("The real corpus was not exercised at the required scope");
  }
  return {
    inputReceiptSHA256: input.sha256,
    consumerReportSHA256: result.sha256,
    testReportSHA256: tests.sha256,
    acquisition: input.value.acquisition,
    coverage,
  };
}

async function writeCompletedProof(filename, record, root, evidenceFiles, outcomes) {
  const streamReceipts = await completedStreams(root, evidenceFiles, outcomes);
  await writeProof(filename, `${JSON.stringify({ ...record, streamReceipts }, null, 2)}\n`);
}

let evidenceFiles = [];
if (mode === "after") {
  await directory("web");
  if (!process.env.GITHUB_OUTPUT) throw new Error("Expected CI output file");
  evidenceFiles = await collectEvidence("web/browser-evidence", async () => {
    await appendFile(process.env.GITHUB_OUTPUT, "evidence_validated=true\n");
  });
}
if (!process.env.RUNNER_TEMP || !path.isAbsolute(process.env.RUNNER_TEMP)) {
  throw new Error("Expected owned RUNNER_TEMP");
}
await directory(process.env.RUNNER_TEMP);
const { BuildInputs, verifyBuildOutput, verifyBuildSource, inventoryBuildOutput } = await import(
  "./web-build-inputs.mjs"
);
if (mode === "--self-test") {
  const root = await mkdtemp(path.join(process.env.RUNNER_TEMP, "matrix-outcome-probes-"));
  const errors = [];
  try {
    const evidenceRoot = path.join(root, "evidence");
    await mkdir(evidenceRoot);
    const outcomes = {
      selection: "success",
      stale: "success",
      link: "success",
      editor: "success",
      fixed: "success",
    };
    for (const phase of Object.keys(outcomes)) {
      const streams = [];
      for (const stream of ["stdout", "stderr"]) {
        const text = Buffer.from(phase + stream);
        const name = `${phase}.${stream}.txt`;
        await writeFile(path.join(evidenceRoot, name), text);
        streams.push({ stream, bytes: text.length, sha256: digest(text) });
      }
      const report = Buffer.from("{}");
      await writeFile(path.join(evidenceRoot, `${phase}.json`), report);
      await writeProof(
        path.join(evidenceRoot, `${phase}.streams.json`),
        JSON.stringify({
          phase,
          stdoutExit: 0,
          stderrExit: 0,
          stdoutPID: 10,
          stderrPID: 11,
          streams,
        }),
      );
      const exit = phase === "fixed" ? 0 : 1;
      await writeProof(
        path.join(evidenceRoot, `${phase}.checked.json`),
        JSON.stringify({
          phase,
          expectedExit: exit,
          actualExit: exit,
          reportSHA256: digest(report),
        }),
      );
    }
    let announced = false;
    const announce = async () => {
      announced = true;
    };
    const files = await collectEvidence(evidenceRoot, announce);
    const positiveProof = path.join(root, "positive-proof.json");
    await writeCompletedProof(positiveProof, {}, evidenceRoot, files, outcomes);
    const positive = JSON.parse(await readFile(positiveProof, "utf8"));
    if (!announced || positive.streamReceipts.length !== 5) {
      throw new Error("Artifact outcome positive control did not pass");
    }
    async function rejectedWithoutProof(filename, code, action) {
      let rejected = false;
      try {
        await action();
      } catch (error) {
        if (error.code !== code) throw error;
        rejected = true;
      }
      if (!rejected) throw new Error("Artifact negative control did not reject");
      try {
        await lstat(filename);
        throw new Error("Failed outcome emitted a normal proof");
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
      }
    }
    const failedProof = path.join(root, "failed-phase-proof.json");
    await rejectedWithoutProof(failedProof, "NATIVE_PHASE_FAILED", () =>
      writeCompletedProof(failedProof, {}, evidenceRoot, files, { ...outcomes, fixed: "failure" }),
    );
    for (const phase of ["link", "editor"]) {
      const failedNative = path.join(root, `failed-${phase}-proof.json`);
      await rejectedWithoutProof(failedNative, "NATIVE_PHASE_FAILED", () =>
        writeCompletedProof(failedNative, {}, evidenceRoot, files, {
          ...outcomes,
          [phase]: "failure",
        }),
      );
    }
    const checkedPath = path.join(evidenceRoot, "fixed.checked.json");
    const checked = await readFile(checkedPath);
    await rm(checkedPath);
    const uncheckedProof = path.join(root, "unchecked-proof.json");
    await rejectedWithoutProof(uncheckedProof, "ENOENT", () =>
      writeCompletedProof(uncheckedProof, {}, evidenceRoot, files, outcomes),
    );
    await writeProof(checkedPath, checked);
    await writeFile(path.join(evidenceRoot, "fixed.json"), "changed report");
    const changedFiles = await inventory(evidenceRoot);
    const changedProof = path.join(root, "changed-report-proof.json");
    await rejectedWithoutProof(changedProof, "BROWSER_REPORT_UNCHECKED", () =>
      writeCompletedProof(changedProof, {}, evidenceRoot, changedFiles, outcomes),
    );
    announced = false;
    const missingBuildProof = path.join(root, "missing-build-proof.json");
    await rejectedWithoutProof(missingBuildProof, "ENOENT", async () => {
      const partialFiles = await collectEvidence(evidenceRoot, announce);
      await inventory(path.join(root, "missing-dist"));
      await writeCompletedProof(missingBuildProof, {}, evidenceRoot, partialFiles, outcomes);
    });
    if (!announced) throw new Error("Build failure lost validated diagnostic evidence");
    const fixture = path.join(root, "build-fixture");
    await mkdir(path.join(fixture, "web/src/assets"), { recursive: true });
    await mkdir(path.join(fixture, "src"));
    const fixtureInputs = {
      "package.json": "{}",
      "pnpm-lock.yaml": "lockfileVersion: 9\n",
      "tsconfig.json": "{}",
      "web/tsconfig.json": '{"extends":"../tsconfig.json"}',
      "web/src/index.html": "<html>fixed</html>",
      "web/src/styles.css": "body { color: black; }",
      "web/src/main.ts": 'import { value } from "../../src/shared"; console.log(value);',
      "src/shared.ts": "export const value = 1;",
      "src/unused.ts": "export const unused = 0;",
      "web/src/assets/logo.svg": "<svg/>",
      "web/src/web-index.json": '{"entries":[]}',
    };
    const headInputs = new Map();
    for (const [name, text] of Object.entries(fixtureInputs)) {
      const bytes = Buffer.from(text);
      await writeFile(path.join(fixture, name), bytes);
      headInputs.set(
        name,
        digest(Buffer.concat([Buffer.from(`blob ${bytes.length}\0`), bytes]), "sha1"),
      );
    }
    const lookupHead = (name) =>
      name === "web/src/web-index.json" ? undefined : headInputs.get(name);
    async function verifyFixture(receipt, output, lookup = lookupHead) {
      const current = new Map();
      for (const prefix of ["web/src", "src"]) {
        for (const file of await inventoryBuildOutput(path.join(fixture, prefix))) {
          current.set(`${prefix}/${file.path}`, file.sha256);
        }
      }
      const trackedChanges = [...headInputs.keys()].filter(
        (name) =>
          (name.startsWith("web/src/") || name.startsWith("src/")) &&
          lookup(name) !== undefined &&
          current.get(name) !== digest(Buffer.from(fixtureInputs[name])),
      );
      const untrackedFiles = [...current.keys()].filter((name) => lookup(name) === undefined);
      return verifyBuildSource(fixture, receipt, output, lookup, {
        trackedChanges,
        untrackedFiles,
      });
    }
    async function captureFixture(output, extraImports = []) {
      const ledger = new BuildInputs(fixture);
      await ledger.read("package.json");
      await ledger.read("pnpm-lock.yaml");
      await ledger.config("web/tsconfig.json");
      let loadInput;
      ledger.compilerPlugin().setup({
        onLoad(_options, callback) {
          loadInput = callback;
        },
      });
      const compilerInputs = {};
      for (const name of ["web/src/main.ts", "src/shared.ts", ...extraImports]) {
        const loaded = await loadInput({ path: path.join(fixture, name) });
        if (!loaded.contents.equals(await readFile(path.join(fixture, name)))) {
          throw new Error("Compiler did not receive the captured source bytes");
        }
        compilerInputs[name] = { bytes: loaded.contents.length };
      }
      await mkdir(output, { recursive: true });
      const html = await ledger.read("web/src/index.html");
      await writeFile(path.join(output, "index.html"), html);
      await ledger.copyFile("web/src/styles.css", path.join(output, "styles.css"));
      await ledger.copyTree("web/src/assets", path.join(output, "assets"));
      await ledger.copyFile("web/src/web-index.json", path.join(output, "web-index.json"), true);
      return ledger.receipt({ inputs: compilerInputs }, await inventoryBuildOutput(output));
    }
    const fixedDist = path.join(root, "fixed-dist");
    const buildReceipt = await captureFixture(fixedDist);
    const fixedOutput = await inventoryBuildOutput(fixedDist);
    await verifyFixture(buildReceipt, fixedOutput);
    async function unchangedDist() {
      const current = await inventoryBuildOutput(fixedDist);
      if (JSON.stringify(current) !== JSON.stringify(fixedOutput)) {
        throw new Error("A source-set control changed the retained dist");
      }
      return current;
    }
    let negativeNumber = 0;
    async function rejectsSource(receipt, output, code, lookup = lookupHead) {
      const filename = path.join(root, `input-negative-${negativeNumber++}.proof.json`);
      await rejectedWithoutProof(filename, code, async () => {
        await verifyFixture(receipt, output, lookup);
        await writeProof(filename, "unexpected");
      });
    }
    for (const name of [
      "web/src/index.html",
      "web/src/styles.css",
      "src/shared.ts",
      "tsconfig.json",
      "web/tsconfig.json",
      "package.json",
      "pnpm-lock.yaml",
      "web/src/web-index.json",
    ]) {
      const original = Buffer.from(fixtureInputs[name]);
      const changed = Buffer.concat([Buffer.from("changed\n"), original]);
      if (original.equals(changed)) throw new Error("Build-input negative was unchanged");
      await writeFile(path.join(fixture, name), changed);
      try {
        await rejectsSource(
          buildReceipt,
          await inventoryBuildOutput(fixedDist),
          "BUILD_INPUT_CHANGED",
        );
        if (JSON.stringify(await inventoryBuildOutput(fixedDist)) !== JSON.stringify(fixedOutput)) {
          throw new Error("Input negative changed the retained dist");
        }
      } finally {
        await writeFile(path.join(fixture, name), original);
      }
      await verifyFixture(buildReceipt, fixedOutput);
    }
    const cssPath = path.join(fixture, "web/src/styles.css");
    await writeFile(cssPath, "body { color: red; }");
    try {
      const dirtyDist = path.join(root, "dirty-dist");
      const dirtyReceipt = await captureFixture(dirtyDist);
      const dirtyOutput = await inventoryBuildOutput(dirtyDist);
      await verifyBuildOutput(fixture, dirtyReceipt, dirtyOutput);
      if (JSON.stringify(dirtyOutput) === JSON.stringify(fixedOutput)) {
        throw new Error("Pre-build dirty CSS control did not differ");
      }
      await rejectsSource(dirtyReceipt, dirtyOutput, "BUILD_INPUT_NOT_HEAD");
    } finally {
      await writeFile(cssPath, fixtureInputs["web/src/styles.css"]);
    }
    await verifyFixture(buildReceipt, fixedOutput);
    await rejectsSource(
      {
        ...buildReceipt,
        compilerInputs: [...buildReceipt.compilerInputs, { path: "src/unseen.ts", bytes: 1 }],
      },
      fixedOutput,
      "COMPILER_INPUT_UNCAPTURED",
    );
    const extraImport = path.join(fixture, "src/shared.js");
    await writeFile(extraImport, "export const extra = 2;");
    try {
      await rejectsSource(buildReceipt, await unchangedDist(), "BUILD_SOURCE_SET_CHANGED");
      const importDist = path.join(root, "new-import-dist");
      const importReceipt = await captureFixture(importDist, ["src/shared.js"]);
      const importOutput = await inventoryBuildOutput(importDist);
      await verifyBuildOutput(fixture, importReceipt, importOutput);
      await rejectsSource(importReceipt, importOutput, "BUILD_INPUT_NOT_HEAD");
    } finally {
      await rm(extraImport);
    }
    const unused = path.join(fixture, "src/unused.ts");
    await rm(unused);
    try {
      await rejectsSource(buildReceipt, await unchangedDist(), "BUILD_SOURCE_SET_CHANGED");
    } finally {
      await writeFile(unused, fixtureInputs["src/unused.ts"]);
    }
    await verifyFixture(buildReceipt, fixedOutput);
    const extraAsset = path.join(fixture, "web/src/assets/late.svg");
    await writeFile(extraAsset, "<svg>late</svg>");
    try {
      await rejectsSource(buildReceipt, await unchangedDist(), "BUILD_INPUT_CHANGED");
      const assetDist = path.join(root, "new-asset-dist");
      const assetReceipt = await captureFixture(assetDist);
      const assetOutput = await inventoryBuildOutput(assetDist);
      await verifyBuildOutput(fixture, assetReceipt, assetOutput);
      await rejectsSource(assetReceipt, assetOutput, "BUILD_INPUT_NOT_HEAD");
    } finally {
      await rm(extraAsset);
    }
    await verifyFixture(buildReceipt, fixedOutput);
    const currentCatalogue = path.join(fixture, "web/src/web-index.json");
    await writeFile(currentCatalogue, '{"entries":[1]}');
    try {
      const catalogueDist = path.join(root, "changed-catalogue-dist");
      const catalogueReceipt = await captureFixture(catalogueDist);
      const catalogueOutput = await inventoryBuildOutput(catalogueDist);
      await verifyFixture(catalogueReceipt, catalogueOutput);
      await rejectsSource(catalogueReceipt, catalogueOutput, "BUILD_INPUT_NOT_HEAD", (name) =>
        headInputs.get(name),
      );
    } finally {
      await writeFile(currentCatalogue, fixtureInputs["web/src/web-index.json"]);
    }
    await verifyFixture(buildReceipt, fixedOutput, (name) => headInputs.get(name));
    const catalogue = path.join(fixture, "web/src/web-index.json");
    await rm(catalogue);
    try {
      const absentDist = path.join(root, "absent-catalogue-dist");
      const absentReceipt = await captureFixture(absentDist);
      const absentOutput = await inventoryBuildOutput(absentDist);
      await verifyFixture(absentReceipt, absentOutput);
      await writeFile(catalogue, fixtureInputs["web/src/web-index.json"]);
      await rejectsSource(absentReceipt, absentOutput, "BUILD_INPUT_CHANGED");
    } finally {
      await writeFile(catalogue, fixtureInputs["web/src/web-index.json"]);
    }
    await verifyFixture(buildReceipt, fixedOutput);
  } catch (error) {
    errors.push(error);
  } finally {
    try {
      await rm(root, { recursive: true });
    } catch (error) {
      errors.push(error);
    }
  }
  if (errors.length) throw new AggregateError(errors, "Artifact outcome controls failed");
  process.stdout.write("Artifact outcome controls passed.\n");
} else {
  await directory("web");
  const files = await inventory("web/dist");
  for (const required of ["index.html", "styles.css", "assets/app.js", "assets/app.js.map"]) {
    if (!files.some((file) => file.path === required && file.bytes > 0)) {
      throw new Error(`Missing output: ${required}`);
    }
  }
  const receiptPath = "web/build-inputs.json";
  if (!(await lstat(receiptPath)).isFile()) throw new Error("Missing actual build receipt");
  const receiptBytes = await readFile(receiptPath);
  const buildInputReceipt = JSON.parse(receiptBytes);
  const sourceState = {
    trackedChanges: gitList(
      "diff",
      "--no-ext-diff",
      "--no-textconv",
      "--name-only",
      "-z",
      "HEAD",
      "--",
      "web/src",
      "src",
    ),
    untrackedFiles: gitList("ls-files", "--others", "-z", "--", "web/src", "src"),
  };
  await verifyBuildSource(process.cwd(), buildInputReceipt, files, headBlob, sourceState);
  const inputs = [];
  for (const filename of [
    "web/src/main.ts",
    "web/e2e/virtual-catalog.spec.ts",
    "web/e2e/compiled-mutations.ts",
    "scripts/build-web.mjs",
    "scripts/web-build-inputs.mjs",
    "scripts/prepare-real-index.mjs",
    "verification/matrix-real-dataset.ts",
    "verification/matrix-real-dataset.test.ts",
    "verification/vitest.matrix-real.config.ts",
    "tsconfig.e2e.json",
    "scripts/serve-web.mjs",
    "scripts/check-browser-report.mjs",
    "scripts/browser-log-capture.sh",
    "scripts/record-browser-build.mjs",
    "playwright.config.ts",
    "package.json",
    "pnpm-lock.yaml",
    ".github/workflows/ci.yml",
  ]) {
    if (!(await lstat(filename)).isFile()) throw new Error(`Not a plain input: ${filename}`);
    const bytes = await readFile(filename);
    const gitBlob = digest(Buffer.concat([Buffer.from(`blob ${bytes.length}\0`), bytes]), "sha1");
    if (gitBlob !== git("rev-parse", `HEAD:${filename}`)) {
      throw new Error(`Changed browser/build input: ${filename}`);
    }
    inputs.push({ path: filename, bytes: bytes.length, sha256: digest(bytes), gitBlob });
  }
  for (const input of buildInputReceipt.inputs) {
    if (input.kind !== "file" || input.origin !== "source") continue;
    if (!inputs.some((entry) => entry.path === input.path)) {
      inputs.push({
        path: input.path,
        bytes: input.bytes,
        sha256: input.sha256,
        gitBlob: input.gitBlob,
      });
    }
  }
  inputs.sort((a, b) => a.path.localeCompare(b.path, "en"));
  const checkoutCommit = git("rev-parse", "HEAD");
  const checkoutTree = git("rev-parse", "HEAD^{tree}");
  const snapshot = path.join(process.env.RUNNER_TEMP, "matrix-web-before.json");
  if (mode === "before") {
    await mkdir("web/browser-evidence");
    const probe = await mkdtemp(path.join(process.env.RUNNER_TEMP, "matrix-artifact-probes-"));
    const errors = [];
    let boundaryControls;
    try {
      await mkdir(path.join(probe, "plain"));
      await writeFile(path.join(probe, "plain/.nojekyll"), "");
      await symlink(path.join(probe, "plain"), path.join(probe, "linked"), "dir");
      let directoryRejected = false;
      try {
        await inventory(path.join(probe, "linked"));
      } catch (error) {
        if (error.code !== "NOT_PLAIN_DIRECTORY") throw error;
        directoryRejected = true;
      }
      await writeFile(path.join(probe, "sentinel"), "unchanged");
      await symlink(path.join(probe, "sentinel"), path.join(probe, "proof.json"));
      let proofRejected = false;
      try {
        await writeProof(path.join(probe, "proof.json"), "wrong");
      } catch (error) {
        if (error.code !== "EEXIST") throw error;
        proofRejected = true;
      }
      const sentinel = await readFile(path.join(probe, "sentinel"), "utf8");
      const plain = await inventory(path.join(probe, "plain"));
      if (
        !directoryRejected ||
        !proofRejected ||
        sentinel !== "unchanged" ||
        plain.length !== 1 ||
        plain[0]?.path !== ".nojekyll"
      ) {
        throw new Error("Artifact boundary probe failed");
      }
      boundaryControls = {
        directoryLinkRejected: directoryRejected,
        proofLinkRejected: proofRejected,
        sentinelUnchanged: sentinel === "unchanged",
        sentinelSHA256: digest(Buffer.from(sentinel)),
        regularInventory: plain,
      };
    } catch (error) {
      errors.push(error);
    } finally {
      try {
        await rm(probe, { recursive: true });
      } catch (error) {
        errors.push(error);
      }
    }
    if (errors.length) throw new AggregateError(errors, "Artifact boundary controls failed");
    await writeProof(
      snapshot,
      `${JSON.stringify({
        schema: "matrix-web-before-v2",
        inputs,
        files,
        boundaryControls,
        buildInputReceiptSHA256: digest(receiptBytes),
        sourceState,
        checkoutCommit,
        checkoutTree,
      })}\n`,
    );
  } else {
    if (!(await lstat(snapshot)).isFile()) throw new Error("Invalid initial snapshot");
    const before = JSON.parse(await readFile(snapshot, "utf8"));
    if (
      before.schema !== "matrix-web-before-v2" ||
      !before.boundaryControls?.directoryLinkRejected ||
      !before.boundaryControls?.proofLinkRejected ||
      !before.boundaryControls?.sentinelUnchanged
    ) {
      throw new Error("Initial boundary controls were not completed");
    }
    if (
      JSON.stringify(inputs) !== JSON.stringify(before.inputs) ||
      JSON.stringify(files) !== JSON.stringify(before.files) ||
      digest(receiptBytes) !== before.buildInputReceiptSHA256 ||
      JSON.stringify(sourceState) !== JSON.stringify(before.sourceState) ||
      checkoutCommit !== before.checkoutCommit ||
      checkoutTree !== before.checkoutTree
    ) {
      throw new Error("Source or fixed compiled output changed during browser checks");
    }
    const realDataset = await realCatalogEvidence("web/browser-evidence", evidenceFiles);
    const record = {
      schema: "matrix-web-build-v3",
      repository: process.env.GITHUB_REPOSITORY,
      repositoryId: process.env.GITHUB_REPOSITORY_ID,
      event: process.env.GITHUB_EVENT_NAME,
      sourceHead: process.env.SOURCE_HEAD,
      checkoutCommit,
      checkoutTree,
      runId: process.env.GITHUB_RUN_ID,
      runAttempt: process.env.GITHUB_RUN_ATTEMPT,
      job: process.env.GITHUB_JOB,
      browserPhases: {
        selection: process.env.SELECTION_OUTCOME,
        stale: process.env.STALE_OUTCOME,
        link: process.env.LINK_OUTCOME,
        editor: process.env.EDITOR_OUTCOME,
        fixed: process.env.FIXED_OUTCOME,
      },
      fixedOutputUnchanged: true,
      boundaryControls: before.boundaryControls,
      inputs,
      files,
      evidenceFiles,
      buildInputReceiptSHA256: digest(receiptBytes),
      buildInputReceipt,
      sourceState,
      sourceRoots: ["web/src", "src"],
      realDataset,
    };
    await writeCompletedProof(
      "web/build-proof.json",
      record,
      "web/browser-evidence",
      evidenceFiles,
      {
        selection: process.env.SELECTION_OUTCOME,
        stale: process.env.STALE_OUTCOME,
        link: process.env.LINK_OUTCOME,
        editor: process.env.EDITOR_OUTCOME,
        fixed: process.env.FIXED_OUTCOME,
      },
    );
  }
}
