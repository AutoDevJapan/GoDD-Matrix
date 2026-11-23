/** Registration text for the retained main MCP distribution. No fetch, write or launch. */
import { createHash } from "node:crypto";
import path from "node:path";

export const FORMAL_MCP_RELEASE = Object.freeze({
  repository: "AutoDevJapan/GoDD-Matrix",
  repositoryId: 1293650669,
  commit: "ece931cb71c191ab1b977629e3fdac1846bb07d1",
  sourceRef: "refs/heads/main",
  workflow: "AutoDevJapan/GoDD-Matrix/.github/workflows/mcp-artifact.yml",
  runId: 44655701843,
  attempt: 1,
  artifactId: 14593605352,
  archiveBytes: 3941903,
  archiveSha256: "14fd21b3e610b0cf7b307eb7746dd9d4ae99c4fb7744722f6c9296f096bb20e3",
  expiresAt: "2026-12-04T01:44:06Z",
  snapshotCommit: "7d3ed9a3d171fee1b3f63f62ac73b71e102e8892",
});

export const FORMAL_MCP_FILES = Object.freeze(
  [
    {
      name: "LICENSE",
      bytes: 1069,
      sha256: "b16a9eb8aff8ba093523553ab3c9b52b87042ef9c18107c5f12d68b6c3c9ad1b",
    },
    {
      name: "SHA256SUMS",
      bytes: 644,
      sha256: "ce05b0d3838b2caa6fc80c14e12530819323a55a7be1568b13e06f2b4be4c5ff",
    },
    {
      name: "THIRD-PARTY-LICENSES.txt",
      bytes: 9449,
      sha256: "54771f49dd49bdb7ab53b97b77d4f2ca38e1a3cb3a922efa3e71a20d9b040de9",
    },
    {
      name: "catalog-verification.json",
      bytes: 311,
      sha256: "0fd39468aa6138514126db5e6e4a25b42140fb623ff0522948952316cdecb514",
    },
    {
      name: "index.json",
      bytes: 32815467,
      sha256: "62eb8dbde50783aba4fc15f4578a979342cf2cb06fa40bc03c67e2412c879fe0",
    },
    {
      name: "jsic.json",
      bytes: 427466,
      sha256: "aae7d353c92cdc17d115ea11ac1a5493041222c1edc0d81722dc00753e053034",
    },
    {
      name: "main.js",
      bytes: 1343129,
      sha256: "5bcda159733f1fb17359a1585de6830ceb0808c901de894331d81505895c560d",
    },
    {
      name: "snapshot.json",
      bytes: 869,
      sha256: "afba76f23149592c2b27199808a8063f070fff0917a1ad1c7b99ffddf987ed5c",
    },
    {
      name: "taxonomy.json",
      bytes: 66486,
      sha256: "ac72de4725369093d2171fe69b9076ff03ca0a364ea5ba21d29c6637ea08a88e",
    },
  ].map((file) => Object.freeze(file)),
);

const SERVER = "godd-matrix-formal";
const TOOLS = ["godd_matrix_compose", "godd_matrix_decide_axes", "godd_matrix_select_cells"];

/** Consumer-side metadata, outside the unchanged nine attested artifact files. */
export const FORMAL_MCP_MODULE_SCOPE = Object.freeze({
  text: '{"type":"module"}\n',
  bytes: 18,
  sha256: "1239d4d885dcad42201a27ed9324f8f0f760b78700d8db9ced39a511cffe7eae",
});

export function assertFormalModuleScope(input: unknown): void {
  if (
    !(input instanceof Uint8Array) ||
    input.byteLength !== FORMAL_MCP_MODULE_SCOPE.bytes ||
    !Buffer.from(input).equals(Buffer.from(FORMAL_MCP_MODULE_SCOPE.text, "utf8"))
  ) {
    throw new Error("host registration: fixed parent module metadata is missing or differs");
  }
}

export interface HostRegistrationOptions {
  /** Syntax selection only; it does not attest to the host's runtime. */
  readonly platform: "posix" | "win32";
  readonly artifactDirectory: string;
  readonly projectDirectory: string;
  /** The normally qualified Node executable in the consuming host, not this machine's fallback. */
  readonly nodeCommand: string;
}

function absolutePath(value: string, platform: "posix" | "win32", field: string): string {
  const syntax = platform === "win32" ? path.win32 : path.posix;
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > 8192 ||
    value.trim() !== value ||
    /[\u0000-\u001f\u007f]/u.test(value) ||
    value.includes("${") ||
    /[<>]/u.test(value) ||
    /(?:^|[\\/])\.\.?(?:[\\/]|$)/u.test(value) ||
    !syntax.isAbsolute(value) ||
    (platform === "win32" && !/^[A-Za-z]:[\\/]/u.test(value))
  ) {
    throw new Error(`host registration: ${field} must be an explicit absolute path`);
  }
  return syntax.normalize(value);
}

export function registrationLocations(options: HostRegistrationOptions) {
  if (options.platform !== "posix" && options.platform !== "win32") {
    throw new Error("host registration: unsupported path syntax");
  }
  const syntax = options.platform === "win32" ? path.win32 : path.posix;
  const artifactDirectory = absolutePath(
    options.artifactDirectory,
    options.platform,
    "artifactDirectory",
  );
  const projectDirectory = absolutePath(
    options.projectDirectory,
    options.platform,
    "projectDirectory",
  );
  const nodeCommand = absolutePath(options.nodeCommand, options.platform, "nodeCommand");
  const basename = syntax.basename(nodeCommand);
  if (options.platform === "win32" ? basename.toLowerCase() !== "node.exe" : basename !== "node") {
    throw new Error(
      "host registration: nodeCommand must name Node directly, without a shell or shim",
    );
  }
  const moduleScopeDirectory = syntax.dirname(artifactDirectory);
  if (moduleScopeDirectory === artifactDirectory) {
    throw new Error("host registration: artifact requires a separate parent module scope");
  }
  const moduleScopeFile = syntax.join(moduleScopeDirectory, "package.json");
  // Node 20 ESM stops on the literal URL suffix, including names such as consumer_node_modules.
  const scopeNames = [syntax.basename(artifactDirectory), syntax.basename(moduleScopeDirectory)];
  if (
    scopeNames.some(
      (name) =>
        (options.platform === "win32" ? name.toLowerCase() : name).endsWith("node_modules"),
    )
  ) {
    throw new Error("host registration: the module scope must not stop at node_modules");
  }
  return { syntax, artifactDirectory, projectDirectory, nodeCommand, moduleScopeFile };
}

/**
 * Formats config TEXT after path syntax checks only. It does not read or validate artifact
 * buffers, parent package metadata, Node identity, provenance or runtime permission.
 * Standalone formatting is supported; use planFormalHostRegistration for the checked plan.
 */
export function formatHostRegistration(options: HostRegistrationOptions) {
  const location = registrationLocations(options);
  const entry = location.syntax.join(location.artifactDirectory, "main.js");
  const env = {
    GODD_DS_SNAPSHOT: location.syntax.join(location.artifactDirectory, "snapshot.json"),
    GODD_DS_INDEX: location.syntax.join(location.artifactDirectory, "index.json"),
    GODD_DS_BASE: `https://raw.githubusercontent.com/AutoDevJapan/GoDD-Design-Systems/${FORMAL_MCP_RELEASE.snapshotCommit}/`,
    GENERATOR_RENDER_URL: "",
    GENERATOR_RENDER_API_KEY: "",
    NODE_OPTIONS: "",
  };
  const claudeProjectJson = `${JSON.stringify({
    mcpServers: { [SERVER]: { type: "stdio", command: location.nodeCommand, args: [entry], env } },
  }, null, 2)}\n`;
  const table = `[mcp_servers.${JSON.stringify(SERVER)}]`;
  const codexProjectToml = [
    table,
    `command = ${JSON.stringify(location.nodeCommand)}`,
    `args = [${JSON.stringify(entry)}]`,
    `cwd = ${JSON.stringify(location.projectDirectory)}`,
    `enabled_tools = ${JSON.stringify(TOOLS)}`,
    "startup_timeout_sec = 60",
    "tool_timeout_sec = 60",
    "",
    `[mcp_servers.${JSON.stringify(SERVER)}.env]`,
    ...Object.entries(env).map(([key, value]) => `${key} = ${JSON.stringify(value)}`),
    "",
  ].join("\n");
  return { entry, claudeProjectJson, codexProjectToml };
}

/**
 * Checks the nine fixed artifact buffers AND the immediate parent's fixed package metadata.
 * The parent metadata is a separate consumer input, not an extra attested artifact member.
 * Matching bytes do not issue acquisition, provenance, execution or installed authority.
 */
export function planFormalHostRegistration(
  files: ReadonlyMap<string, Uint8Array>,
  options: HostRegistrationOptions,
  moduleScopeBytes: Uint8Array,
) {
  const location = registrationLocations(options);
  assertFormalModuleScope(moduleScopeBytes);
  if (files.size !== FORMAL_MCP_FILES.length) {
    throw new Error("host registration: expected exactly nine release files");
  }
  for (const expected of FORMAL_MCP_FILES) {
    const input = files.get(expected.name);
    if (!(input instanceof Uint8Array) || input.byteLength !== expected.bytes) {
      throw new Error(`host registration: missing or wrong size: ${expected.name}`);
    }
    const bytes = Buffer.from(input);
    if (createHash("sha256").update(bytes).digest("hex") !== expected.sha256) {
      throw new Error(`host registration: digest mismatch: ${expected.name}`);
    }
  }
  return {
    schema: "godd-matrix-formal-host-registration-plan-v1",
    release: { ...FORMAL_MCP_RELEASE },
    stage: "registration_text_only",
    extractedFileBytesMatched: true,
    moduleScope: {
      file: location.moduleScopeFile,
      bytes: FORMAL_MCP_MODULE_SCOPE.bytes,
      sha256: FORMAL_MCP_MODULE_SCOPE.sha256,
      bytesMatched: true,
      partOfAttestedArtifact: false,
    },
    buildProvenanceVerifiedHere: false,
    runtimeQualifiedHere: false,
    hostStartedHere: false,
    businessAcceptanceHere: false,
    serverName: SERVER,
    ...formatHostRegistration(options),
    artifactDirectory: location.artifactDirectory,
    projectDirectory: location.projectDirectory,
    nodeCommand: location.nodeCommand,
  };
}
