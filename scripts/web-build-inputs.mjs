import { createHash } from "node:crypto";
import { lstat, mkdir, readFile, readdir, realpath, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import ts from "typescript";

const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
const ordered = (values) => [...values].sort((a, b) => a.path.localeCompare(b.path, "en"));
function relativeName(root, filename) {
  const name = path.relative(root, path.resolve(root, filename)).replaceAll("\\", "/");
  if (!name || name === ".." || name.startsWith("../") || path.isAbsolute(name)) {
    throw new Error("Build input is outside the repository");
  }
  return name;
}
async function inputPath(root, name) {
  const filename = path.join(root, name);
  if (name.startsWith("node_modules/")) {
    const resolved = await realpath(path.dirname(filename));
    const base = path.join(await realpath(root), "node_modules");
    if (resolved !== base && !resolved.startsWith(base + path.sep)) {
      throw new Error("Dependency input escaped node_modules");
    }
  } else {
    let directory = path.dirname(filename);
    while (directory !== root) {
      if (!(await lstat(directory)).isDirectory()) throw new Error("Linked build input directory");
      directory = path.dirname(directory);
    }
  }
  return filename;
}
function fileRecord(name, bytes) {
  return {
    path: name,
    kind: "file",
    origin: name.startsWith("node_modules/")
      ? "dependency"
      : name === "web/src/web-index.json"
        ? "generated-catalogue"
        : "source",
    bytes: bytes.length,
    sha256: digest(bytes),
    gitBlob: createHash("sha1")
      .update(Buffer.from(`blob ${bytes.length}\0`))
      .update(bytes)
      .digest("hex"),
  };
}
async function directoryRecord(root, name) {
  const filename = await inputPath(root, name);
  if (!(await lstat(filename)).isDirectory()) throw new Error("Non-plain asset directory");
  const entries = (await readdir(filename, { withFileTypes: true }))
    .map((entry) => {
      if (!entry.isDirectory() && !entry.isFile()) throw new Error("Linked asset entry");
      return { name: entry.name, kind: entry.isDirectory() ? "directory" : "file" };
    })
    .sort((a, b) => a.name.localeCompare(b.name, "en"));
  return { path: name, kind: "directory", entries };
}
export async function verifyCapturedInputs(sourceRoot, receipt) {
  const root = path.resolve(sourceRoot);
  if (
    receipt.schema !== "matrix-build-inputs-v1" ||
    !Array.isArray(receipt.inputs) ||
    !Array.isArray(receipt.compilerInputs)
  ) {
    throw new Error("Missing actual build input receipt");
  }
  const names = new Set();
  for (const expected of receipt.inputs) {
    const name = relativeName(root, expected.path);
    if (name !== expected.path || names.has(name)) throw new Error("Duplicate build input");
    names.add(name);
    const filename = await inputPath(root, name);
    let actual;
    if (expected.kind === "directory") actual = await directoryRecord(root, name);
    else if (expected.kind === "missing") {
      try {
        await lstat(filename);
        const error = new Error(`An absent build input appeared: ${name}`);
        error.code = "BUILD_INPUT_CHANGED";
        throw error;
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
      }
      actual = { path: name, kind: "missing" };
    } else if (expected.kind === "file") {
      if (!(await lstat(filename)).isFile()) throw new Error("Non-plain build input");
      actual = fileRecord(name, await readFile(filename));
    } else throw new Error("Unknown build input kind");
    if (JSON.stringify(actual) !== JSON.stringify(expected)) {
      const error = new Error(`Actual build input changed: ${name}`);
      error.code = "BUILD_INPUT_CHANGED";
      throw error;
    }
  }
  for (const input of receipt.compilerInputs) {
    if (input.path.startsWith("node-mock-ns:node:")) continue;
    const name = relativeName(root, input.path);
    const record = receipt.inputs.find((entry) => entry.path === name && entry.kind === "file");
    if (!record || record.bytes !== input.bytes) {
      const error = new Error("Uncaptured compiler input");
      error.code = "COMPILER_INPUT_UNCAPTURED";
      throw error;
    }
  }
  if (!receipt.compilerInputs.some((input) => input.path === "web/src/main.ts")) {
    throw new Error("The actual compiler entry was not captured");
  }
  return receipt;
}

export class BuildInputs {
  constructor(root) {
    this.root = path.resolve(root);
    this.inputs = new Map();
    this.loaded = new Set();
  }
  remember(record) {
    const previous = this.inputs.get(record.path);
    if (previous && JSON.stringify(previous) !== JSON.stringify(record)) {
      throw new Error(`Build input changed while being consumed: ${record.path}`);
    }
    this.inputs.set(record.path, record);
  }
  async read(filename, optional = false) {
    const name = relativeName(this.root, filename);
    const target = await inputPath(this.root, name);
    let stat;
    try {
      stat = await lstat(target);
    } catch (error) {
      if (!optional || error.code !== "ENOENT") throw error;
      this.remember({ path: name, kind: "missing" });
      return undefined;
    }
    if (!stat.isFile()) throw new Error(`Non-plain build input: ${name}`);
    const bytes = await readFile(target);
    this.remember(fileRecord(name, bytes));
    return bytes;
  }
  async packageControls(filename) {
    let directory = path.dirname(path.resolve(this.root, filename));
    while (directory !== this.root) {
      await this.read(path.join(directory, "package.json"), true);
      directory = path.dirname(directory);
    }
    await this.read("package.json");
  }
  async config(filename, ancestors = []) {
    const name = relativeName(this.root, filename);
    if (ancestors.includes(name)) throw new Error("Cyclic build tsconfig");
    const text = (await this.read(name)).toString("utf8");
    await this.packageControls(name);
    const parsed = ts.parseConfigFileTextToJson(name, text);
    if (parsed.error || !parsed.config) throw new Error("Invalid build tsconfig");
    const parents = parsed.config.extends === undefined ? [] : [parsed.config.extends].flat();
    for (const parent of parents) {
      if (typeof parent !== "string") throw new Error("Invalid tsconfig extends");
      const require = createRequire(path.join(this.root, name));
      const resolved = require.resolve(parent);
      await this.config(resolved, [...ancestors, name]);
    }
  }
  compilerPlugin() {
    const ledger = this;
    return {
      name: "capture-build-inputs",
      setup(build) {
        build.onLoad({ filter: /.*/, namespace: "file" }, async (args) => {
          const loaders = {
            ".ts": "ts",
            ".tsx": "tsx",
            ".js": "js",
            ".mjs": "js",
            ".cjs": "js",
            ".jsx": "jsx",
            ".json": "json",
          };
          const loader = loaders[path.extname(args.path)];
          if (!loader) throw new Error("Unsupported compiler input extension");
          const contents = await ledger.read(args.path);
          await ledger.packageControls(args.path);
          ledger.loaded.add(relativeName(ledger.root, args.path));
          return { contents, loader, resolveDir: path.dirname(args.path) };
        });
      },
    };
  }
  async copyFile(source, destination, optional = false) {
    const bytes = await this.read(source, optional);
    if (bytes !== undefined) {
      await mkdir(path.dirname(destination), { recursive: true });
      await writeFile(destination, bytes);
    }
  }
  async copyTree(source, destination) {
    const name = relativeName(this.root, source);
    const record = await directoryRecord(this.root, name);
    this.remember(record);
    await mkdir(destination, { recursive: true });
    for (const entry of record.entries) {
      const from = path.join(source, entry.name);
      const to = path.join(destination, entry.name);
      if (entry.kind === "directory") await this.copyTree(from, to);
      else await this.copyFile(from, to);
    }
  }
  async receipt(metafile, outputFiles) {
    const compilerInputs = Object.entries(metafile.inputs).map(([filename, input]) => {
      const name = filename.startsWith("node-mock-ns:")
        ? filename
        : relativeName(this.root, filename);
      if (!name.startsWith("node-mock-ns:") && !this.loaded.has(name)) {
        throw new Error("The compiler bypassed input capture");
      }
      return { path: name, bytes: input.bytes };
    });
    const receipt = {
      schema: "matrix-build-inputs-v1",
      activeTSConfig: "web/tsconfig.json",
      compilerInputs: ordered(compilerInputs),
      inputs: ordered(this.inputs.values()),
      outputFiles,
    };
    return verifyCapturedInputs(this.root, receipt);
  }
}

export async function inventoryBuildOutput(root, prefix = "") {
  if (!(await lstat(root)).isDirectory()) throw new Error("Non-plain output directory");
  const result = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const filename = path.join(root, entry.name);
    const name = prefix + entry.name;
    if (entry.isDirectory()) {
      result.push(...(await inventoryBuildOutput(filename, `${name}/`)));
    } else if (entry.isFile()) {
      const bytes = await readFile(filename);
      result.push({ path: name, bytes: bytes.length, sha256: digest(bytes) });
    } else throw new Error("Linked build output");
  }
  return ordered(result);
}

export async function verifyBuildOutput(root, receipt, outputFiles) {
  await verifyCapturedInputs(root, receipt);
  if (JSON.stringify(receipt.outputFiles) !== JSON.stringify(outputFiles)) {
    throw new Error("Output differs from the captured actual build");
  }
  return receipt;
}

export async function verifyBuildSource(root, receipt, outputFiles, gitBlobFor, sourceState) {
  await verifyBuildOutput(root, receipt, outputFiles);
  if (typeof gitBlobFor !== "function") throw new Error("Missing tracked input verification");
  for (const input of receipt.inputs) {
    if (input.kind !== "file" || input.origin === "dependency") continue;
    const expected = await gitBlobFor(input.path);
    if (expected === undefined && input.origin === "generated-catalogue") continue;
    if (expected !== input.gitBlob) {
      const error = new Error(`Build consumed a non-HEAD source: ${input.path}`);
      error.code = "BUILD_INPUT_NOT_HEAD";
      throw error;
    }
  }
  for (const input of receipt.compilerInputs) {
    if (input.path.startsWith("node-mock-ns:") || input.path.startsWith("node_modules/")) continue;
    if (!input.path.startsWith("web/src/") && !input.path.startsWith("src/")) {
      throw new Error("Compiler source is outside the verified source roots");
    }
  }
  if (!Array.isArray(sourceState?.trackedChanges) || !Array.isArray(sourceState?.untrackedFiles)) {
    throw new Error("Missing source membership verification");
  }
  const catalogue = receipt.inputs.some(
    (input) => input.path === "web/src/web-index.json" && input.origin === "generated-catalogue",
  );
  const unexpected = sourceState.untrackedFiles.filter(
    (name) => name !== "web/src/web-index.json" || !catalogue,
  );
  if (sourceState.trackedChanges.length || unexpected.length) {
    const error = new Error("Build source membership differs from HEAD");
    error.code = "BUILD_SOURCE_SET_CHANGED";
    throw error;
  }
  return receipt;
}
