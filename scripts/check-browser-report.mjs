#!/usr/bin/env node
import { createHash } from "node:crypto";
import { lstat, readFile, realpath, writeFile } from "node:fs/promises";
import path from "node:path";

const phase = process.argv[2];
const exitCode = Number(process.argv[3]);
const stdoutExit = Number(process.argv[4]);
const stderrExit = Number(process.argv[5]);
const stdoutPID = Number(process.argv[6]);
const stderrPID = Number(process.argv[7]);
const names = {
  selection: [
    "keeps an untouched color caret when actual tokens arrive",
    "keeps an untouched color backward selection when tokens arrive",
  ],
  stale: ["ignores an old materialized response after selecting another cell"],
  link: ["does not reopen a waiting link after another cell was closed"],
  editor: [
    "keeps the color editor node, caret and draft on index arrival",
    "keeps an edited color and the page text on index arrival",
    "builds a fresh editor for the cell opened after the first one",
  ],
};
// The unmutated phase runs the whole spec file once; every case is named here.
names.fixed = [
  "browses the virtual catalog, preserves URL state, and jumps by ordinal",
  "opens a virtual cell permalink and reloads the same addressable cell",
  "keeps the materialized cell path fetchable by id",
  "keeps color edits made while a materialized body is loading",
  "keeps incomplete color text and its caret while the body arrives",
  ...names.selection,
  ...names.stale,
  "keeps materialized content while copying its English fine-class request",
  "copies a virtual prompt with consistent fine-class industry identity",
  "opens a delayed materialized link once the index arrives",
  "still opens a waiting link after a language switch",
  "keeps a search typed while a materialized link waited",
  "keeps a sort chosen while a materialized link waited",
  ...names.link,
  ...names.editor,
];
const negativeTitles = [...names.selection, ...names.stale, ...names.link, ...names.editor];
if (
  names.fixed.length !== 18 ||
  new Set(names.fixed).size !== 18 ||
  negativeTitles.some((title) => !names.fixed.includes(title))
) {
  throw new Error("The unmutated phase must name every case of the spec");
}
if (!Object.hasOwn(names, phase)) throw new Error("Unknown browser phase");
const negative = phase !== "fixed";
const evidence = path.resolve("web/browser-evidence");
if (
  stdoutExit !== 0 ||
  stderrExit !== 0 ||
  !Number.isInteger(stdoutPID) ||
  !Number.isInteger(stderrPID) ||
  stdoutPID <= 0 ||
  stderrPID <= 0 ||
  stdoutPID === stderrPID
) {
  throw new Error("Both owned stream helpers must complete successfully");
}
const streams = [];
for (const stream of ["stdout", "stderr"]) {
  const filename = path.join(evidence, `${phase}.${stream}.txt`);
  if (!(await lstat(filename)).isFile()) throw new Error("Missing regular stream file");
  const bytes = await readFile(filename);
  streams.push({
    stream,
    bytes: bytes.length,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  });
}
await writeFile(
  path.join(evidence, `${phase}.streams.json`),
  `${JSON.stringify(
    {
      phase,
      playwrightExit: exitCode,
      stdoutPID,
      stderrPID,
      stdoutExit,
      stderrExit,
      streams,
    },
    null,
    2,
  )}\n`,
  { flag: "wx" },
);
const reportBytes = await readFile(path.join(evidence, `${phase}.json`));
const report = JSON.parse(reportBytes);
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
function tests(suites) {
  return suites.flatMap((suite) => [
    ...(suite.specs ?? []).flatMap((spec) =>
      spec.tests.map((test) => ({ title: spec.title, ...test })),
    ),
    ...tests(suite.suites ?? []),
  ]);
}
const selected = tests(report.suites);
if (
  report.errors.length ||
  exitCode !== (negative ? 1 : 0) ||
  report.stats.skipped !== 0 ||
  report.stats.flaky !== 0 ||
  JSON.stringify(selected.map((test) => test.title).sort()) !==
    JSON.stringify([...names[phase]].sort())
) {
  throw new Error(`Wrong browser exit, test set, skip, or setup error: ${phase}`);
}
const testFile = "web/e2e/virtual-catalog.spec.ts";
const lines = (await readFile(testFile, "utf8")).split("\n");
const end = lines.findIndex((line) => line.trim() === ").toEqual(selection);");
let start = end;
while (start >= 0 && lines[start].trim() !== "expect(") start--;
const staleLine = lines.findIndex((line) =>
  line.includes('await expect(page.locator("#detail-code-block")).toHaveText(current ?? "");'),
);
if (end < 0 || start < end - 15 || staleLine < 0) throw new Error("Missing assertion boundary");
function assertionLine(title, assertion) {
  const first = lines.findIndex((line) => line.startsWith(`test("${title}"`));
  if (first < 0) throw new Error(`Missing native test: ${title}`);
  const next = lines.findIndex((line, index) => index > first && line.startsWith("test("));
  const found = lines.findIndex(
    (line, index) => index > first && (next < 0 || index < next) && line.trim() === assertion,
  );
  if (found < 0) throw new Error(`Missing assertion boundary: ${title}`);
  return found;
}
const linkLine = assertionLine(
  names.link[0],
  'await expect(page.locator("#detail-view")).toBeHidden();',
);
const editorAssertion = 'await expect(input).toHaveAttribute("data-arrival-probe", "same-node");';
const editorLines = Object.fromEntries(
  names.editor.map((title) => [title, assertionLine(title, editorAssertion)]),
);
const app = await readFile("web/dist/assets/app.js", "utf8");
const sourceMap = await readFile("web/dist/assets/app.js.map");
const source = await readFile("web/src/main.ts");
async function attachmentProof(attachment) {
  if (attachment.body) return JSON.parse(Buffer.from(attachment.body, "base64").toString("utf8"));
  const outputRoot = await realpath(path.join(evidence, `${phase}-files`));
  const filename = await realpath(attachment.path);
  if (!filename.startsWith(outputRoot + path.sep) || !(await lstat(attachment.path)).isFile()) {
    throw new Error("Compiled response attachment is outside its owned output");
  }
  return JSON.parse(await readFile(filename, "utf8"));
}
for (const test of selected) {
  const result = test.results[0];
  if (
    test.expectedStatus !== "passed" ||
    test.results.length !== 1 ||
    result.retry !== 0 ||
    result.status !== (negative ? "failed" : "passed")
  ) {
    throw new Error(`No completed native browser result: ${test.title}`);
  }
  const label = negative ? "compiled-mutation" : "compiled-response";
  const attachments = result.attachments.filter((item) => item.name === label);
  // A passing case may navigate more than once; every bundle it was served must be the fixed build.
  if (negative ? attachments.length !== 1 : attachments.length < 1) {
    throw new Error("Missing compiled-response evidence");
  }
  if (!negative) {
    if (result.attachments.some((item) => item.name === "compiled-mutation")) {
      throw new Error("Positive response differs from the retained compiled build");
    }
    for (const attachment of attachments) {
      const served = await attachmentProof(attachment);
      if (
        served.kind !== "fixed" ||
        served.originalSHA256 !== digest(app) ||
        served.servedSHA256 !== digest(app)
      ) {
        throw new Error("Positive response differs from the retained compiled build");
      }
    }
    continue;
  }
  const proof = await attachmentProof(attachments[0]);
  const location = result.errorLocation;
  const editorLine = editorLines[test.title];
  const intended = {
    selection: { range: [start + 1, end + 1], matcher: "toEqual", replacement: "void 0" },
    stale: { range: [staleLine + 1, staleLine + 1], matcher: "toHaveText", replacement: "false" },
    link: { range: [linkLine + 1, linkLine + 1], matcher: "toBeHidden", replacement: "void 0" },
    editor: {
      range: [editorLine + 1, editorLine + 1],
      matcher: "toHaveAttribute",
      replacement: "!1",
    },
  }[phase];
  const { range, matcher, replacement } = intended;
  if (
    !result.error?.message?.includes(matcher) ||
    !location?.file?.replaceAll("\\", "/").endsWith(testFile) ||
    location.line < range[0] ||
    location.line > range[1]
  ) {
    throw new Error(`Mutation failed outside the intended native assertion: ${test.title}`);
  }
  if (
    proof.kind !== phase ||
    proof.siteCount !== 1 ||
    !Number.isInteger(proof.start) ||
    !Number.isInteger(proof.end) ||
    proof.start < 0 ||
    proof.end <= proof.start ||
    proof.end > app.length ||
    proof.removed !== app.slice(proof.start, proof.end) ||
    proof.replacement !== replacement ||
    proof.originalSHA256 !== digest(app) ||
    proof.sourceSHA256 !== digest(source) ||
    proof.sourceMapSHA256 !== digest(sourceMap) ||
    proof.mutatedSHA256 === proof.originalSHA256 ||
    proof.mutatedSHA256 !== digest(app.slice(0, proof.start) + replacement + app.slice(proof.end))
  ) {
    throw new Error("Mutation is not one edit of the fixed compiled build");
  }
}
await writeFile(
  path.join(evidence, `${phase}.checked.json`),
  `${JSON.stringify(
    {
      phase,
      expectedExit: negative ? 1 : 0,
      actualExit: exitCode,
      tests: names[phase],
      reportSHA256: digest(reportBytes),
      compiledAppSHA256: digest(app),
    },
    null,
    2,
  )}\n`,
  { flag: "wx" },
);
process.stdout.write(`Native browser phase verified: ${phase}\n`);
