/** Read a retained artifact and print a registration plan; never install, fetch or start a host. */
import { constants } from "node:fs";
import { lstat, open, readdir, realpath } from "node:fs/promises";
import path from "node:path";
import {
  FORMAL_MCP_FILES,
  FORMAL_MCP_MODULE_SCOPE,
  FORMAL_MCP_RELEASE,
  type HostRegistrationOptions,
  planFormalHostRegistration,
  registrationLocations,
} from "./host-registration.js";

export function parseRegistrationArgs(args: readonly string[]): HostRegistrationOptions {
  const values = new Map<string, string>();
  const allowed = new Set(["--artifact-dir", "--project-dir", "--node", "--platform"]);
  for (let i = 0; i < args.length; i += 2) {
    const name = args[i];
    const value = args[i + 1];
    if (
      !name ||
      !allowed.has(name) ||
      values.has(name) ||
      value === undefined ||
      value.length === 0
    ) {
      throw new Error("host registration: specify each required option exactly once");
    }
    values.set(name, value);
  }
  if (values.size !== allowed.size) throw new Error("host registration: required option missing");
  const platform = values.get("--platform");
  if (platform !== "posix" && platform !== "win32") {
    throw new Error("host registration: invalid platform");
  }
  const requiredValue = (name: string): string => {
    const value = values.get(name);
    if (value === undefined) throw new Error("host registration: required option missing");
    return value;
  };
  const options: HostRegistrationOptions = {
    platform,
    artifactDirectory: requiredValue("--artifact-dir"),
    projectDirectory: requiredValue("--project-dir"),
    nodeCommand: requiredValue("--node"),
  };
  registrationLocations(options);
  return options;
}

async function readFixedFile(file: string, expectedBytes: number): Promise<Uint8Array> {
  const before = await lstat(file);
  if (!before.isFile() || before.isSymbolicLink() || before.size !== expectedBytes) {
    throw new Error("registration input: unexpected file size or kind");
  }
  const handle = await open(file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const held = await handle.stat();
    if (
      !held.isFile() ||
      held.size !== expectedBytes ||
      held.dev !== before.dev ||
      held.ino !== before.ino
    ) {
      throw new Error("registration input: changed file");
    }
    const bytes = Buffer.alloc(expectedBytes + 1);
    let count = 0;
    while (count < bytes.length) {
      const next = await handle.read(bytes, count, bytes.length - count, count);
      if (next.bytesRead === 0) break;
      count += next.bytesRead;
    }
    const after = await handle.stat();
    if (
      count !== expectedBytes ||
      after.size !== held.size ||
      after.mtimeMs !== held.mtimeMs ||
      after.ctimeMs !== held.ctimeMs
    ) {
      throw new Error("registration input: changed bytes");
    }
    return bytes.subarray(0, count);
  } finally {
    await handle.close();
  }
}

async function readReleaseFiles(directory: string): Promise<Map<string, Uint8Array>> {
  const info = await lstat(directory);
  if (!info.isDirectory() || info.isSymbolicLink() || (await realpath(directory)) !== directory) {
    throw new Error("artifact must be a canonical regular directory");
  }
  const dirents = await readdir(directory, { withFileTypes: true });
  const expectedNames = new Set(FORMAL_MCP_FILES.map((file) => file.name));
  if (
    dirents.length !== expectedNames.size ||
    dirents.some((file) => !file.isFile() || !expectedNames.has(file.name))
  ) {
    throw new Error("artifact must contain only the nine regular release files");
  }
  const result = new Map<string, Uint8Array>();
  for (const expected of FORMAL_MCP_FILES) {
    result.set(
      expected.name,
      await readFixedFile(path.join(directory, expected.name), expected.bytes),
    );
  }
  return result;
}

export async function runHostRegistrationCli(args: readonly string[]): Promise<string> {
  if (args.length === 1 && args[0] === "--release-info") {
    const release = FORMAL_MCP_RELEASE;
    const runUrl = `https://github.com/${release.repository}/actions/runs/${release.runId}`;
    return `${JSON.stringify(
      {
        schema: "godd-matrix-formal-release-info-v1",
        release,
        artifactUrl: `${runUrl}/artifacts/${release.artifactId}`,
        archiveName: `godd-matrix-mcp-${release.commit}.zip`,
      },
      null,
      2,
    )}\n`;
  }
  const options = parseRegistrationArgs(args);
  if (options.platform !== (process.platform === "win32" ? "win32" : "posix")) {
    throw new Error("host registration: path syntax must match the consuming host");
  }
  const location = registrationLocations(options);
  const files = await readReleaseFiles(location.artifactDirectory);
  const moduleScopeBytes = await readFixedFile(
    location.moduleScopeFile,
    FORMAL_MCP_MODULE_SCOPE.bytes,
  );
  return `${JSON.stringify(planFormalHostRegistration(files, options, moduleScopeBytes), null, 2)}\n`;
}
