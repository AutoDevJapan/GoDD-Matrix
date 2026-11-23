import { describe, expect, it } from "vitest";
import {
  assertFormalModuleScope,
  FORMAL_MCP_FILES,
  FORMAL_MCP_MODULE_SCOPE,
  FORMAL_MCP_RELEASE,
  formatHostRegistration,
  planFormalHostRegistration,
  registrationLocations,
} from "./host-registration.js";
import { parseRegistrationArgs, runHostRegistrationCli } from "./host-registration-cli.js";

const options = {
  platform: "posix" as const,
  artifactDirectory: "/work/accepted release/godd-matrix-mcp",
  projectDirectory: "/work/project",
  nodeCommand: "/usr/local/bin/node",
};
const moduleScopeBytes = Buffer.from(FORMAL_MCP_MODULE_SCOPE.text, "utf8");

describe("formal host registration is a text plan, not admission", () => {
  it("points both configs at one absolute entry with explicit snapshot and no Generator", () => {
    const plan = formatHostRegistration(options);
    const claude = JSON.parse(plan.claudeProjectJson).mcpServers["godd-matrix-formal"];
    expect(claude.type).toBe("stdio");
    expect(claude.command).toBe(options.nodeCommand);
    expect(claude.args).toEqual([`${options.artifactDirectory}/main.js`]);
    expect(claude.env.GODD_DS_SNAPSHOT).toBe(`${options.artifactDirectory}/snapshot.json`);
    expect(claude.env.GODD_DS_INDEX).toBe(`${options.artifactDirectory}/index.json`);
    expect(claude.env.GODD_DS_BASE).toContain(FORMAL_MCP_RELEASE.snapshotCommit);
    expect(claude.env.GENERATOR_RENDER_URL).toBe("");
    expect(claude.env.GENERATOR_RENDER_API_KEY).toBe("");
    expect(claude.env.NODE_OPTIONS).toBe("");
    expect(plan.codexProjectToml).toContain(`args = [${JSON.stringify(claude.args[0])}]`);
    expect(plan.codexProjectToml).toContain(`cwd = ${JSON.stringify(options.projectDirectory)}`);
    expect(plan.codexProjectToml).not.toContain("approval_mode");
    expect(plan.codexProjectToml).not.toContain("bearer_token");
    expect(registrationLocations(options).moduleScopeFile).toBe(
      "/work/accepted release/package.json",
    );
  });

  it("requires exact parent module metadata separately from the nine artifact members", () => {
    expect(() => assertFormalModuleScope(moduleScopeBytes)).not.toThrow();
    expect(FORMAL_MCP_FILES.some((file) => file.name === "package.json")).toBe(false);
    expect(moduleScopeBytes.byteLength).toBe(18);
    expect(formatHostRegistration(options).entry).toBe(`${options.artifactDirectory}/main.js`);
    expect(() =>
      registrationLocations({ ...options, artifactDirectory: "/work/node_modules/godd-matrix-mcp" }),
    ).toThrow("node_modules");
    expect(() => registrationLocations({ ...options, artifactDirectory: "/" })).toThrow(
      "separate parent module scope",
    );
  });

  it.each([
    "/work/node_modules",
    "/work/node_modules/",
    "/work/node_modules/godd-matrix-mcp",
    "/work/consumer_node_modules",
    "/work/consumer_node_modules/",
    "/work/consumer_node_modules/godd-matrix-mcp",
  ])("rejects a module-search boundary before registration: %j", (artifactDirectory) => {
    expect(() => registrationLocations({ ...options, artifactDirectory })).toThrow("node_modules");
    expect(() => formatHostRegistration({ ...options, artifactDirectory })).toThrow("node_modules");
    expect(() =>
      planFormalHostRegistration(new Map(), { ...options, artifactDirectory }, moduleScopeBytes),
    ).toThrow("node_modules");
    expect(() =>
      parseRegistrationArgs([
        "--artifact-dir",
        artifactDirectory,
        "--project-dir",
        options.projectDirectory,
        "--node",
        options.nodeCommand,
        "--platform",
        options.platform,
      ]),
    ).toThrow("node_modules");
  });

  it.each([
    "/work/node_modules",
    "/work/node_modules/",
    "/work/consumer_node_modules",
    "/work/consumer_node_modules/",
    "/work/consumer_node_modules/godd-matrix-mcp",
  ])(
    "the public CLI rejects the artifact boundary during argument parsing: %j",
    async (artifactDirectory) => {
      await expect(
        runHostRegistrationCli([
          "--artifact-dir",
          artifactDirectory,
          "--project-dir",
          options.projectDirectory,
          "--node",
          options.nodeCommand,
          "--platform",
          options.platform,
        ]),
      ).rejects.toThrow("node_modules");
    },
  );

  it("retains normal siblings and a nested package's reachable immediate scope", () => {
    for (const artifactDirectory of [
      "/work/node_modules-sibling",
      "/work/godd-matrix-mcp",
      "/work/node_modules/consumer/godd-matrix-mcp",
      "/work/consumer_node_modules/consumer/godd-matrix-mcp",
      "/work/consumer_node_modules-sibling",
    ]) {
      const validOptions = { ...options, artifactDirectory };
      expect(registrationLocations(validOptions).artifactDirectory).toBe(artifactDirectory);
      expect(formatHostRegistration(validOptions).entry).toBe(`${artifactDirectory}/main.js`);
      expect(() => planFormalHostRegistration(new Map(), validOptions, moduleScopeBytes)).toThrow(
        "nine release files",
      );
    }
    for (const artifactDirectory of [
      "D:\\node_modules",
      "D:\\NODE_MODULES",
      "D:\\consumer_node_modules",
      "D:\\CONSUMER_NODE_MODULES\\godd-matrix-mcp",
    ]) {
      expect(() =>
        registrationLocations({
          platform: "win32",
          artifactDirectory,
          projectDirectory: "D:\\project",
          nodeCommand: "C:\\runtime\\node.exe",
        }),
      ).toThrow("node_modules");
    }
    expect(
      registrationLocations({
        platform: "win32",
        artifactDirectory: "D:\\node_modules-sibling",
        projectDirectory: "D:\\project",
        nodeCommand: "C:\\runtime\\node.exe",
      }).moduleScopeFile,
    ).toBe("D:\\package.json");
  });

  it.each([
    undefined,
    null,
    "{\"type\":\"module\"}\n",
    Buffer.from("{}\n"),
    Buffer.from('{"type":"commonjs"}\n'),
    Buffer.from('{"type":"module"}'),
    Buffer.from('{"type":"module"}\r\n'),
    Buffer.from('{"type":"module","extra":true}\n'),
    Buffer.from('{"type":"module","type":"commonjs"}\n'),
  ])("does not accept missing, alternate or ambiguous parent metadata: %j", (bytes) => {
    expect(() => assertFormalModuleScope(bytes)).toThrow("parent module metadata");
  });

  it("keeps the fixed main source and all nine exact file pins", () => {
    expect(FORMAL_MCP_RELEASE.commit).toBe("ece931cb71c191ab1b977629e3fdac1846bb07d1");
    expect(FORMAL_MCP_RELEASE.artifactId).toBe(14593605352);
    expect(FORMAL_MCP_FILES).toHaveLength(9);
    expect(new Set(FORMAL_MCP_FILES.map((file) => file.name)).size).toBe(9);
    expect(FORMAL_MCP_FILES.find((file) => file.name === "main.js")?.sha256).toBe(
      "5bcda159733f1fb17359a1585de6830ceb0808c901de894331d81505895c560d",
    );
    expect(FORMAL_MCP_FILES.find((file) => file.name === "SHA256SUMS")?.sha256).toBe(
      "ce05b0d3838b2caa6fc80c14e12530819323a55a7be1568b13e06f2b4be4c5ff",
    );
  });

  it("refuses absent and arbitrary same-sized bytes before emitting a plan", () => {
    expect(() => planFormalHostRegistration(new Map(), options, moduleScopeBytes)).toThrow("nine");
    const fabricated = new Map(
      FORMAL_MCP_FILES.map((file) => [file.name, new Uint8Array(file.bytes)]),
    );
    expect(() => planFormalHostRegistration(fabricated, options, moduleScopeBytes)).toThrow(
      "digest mismatch",
    );
    const extra = new Map(fabricated);
    extra.set("extra", new Uint8Array());
    expect(() => planFormalHostRegistration(extra, options, moduleScopeBytes)).toThrow("nine");
  });

  it.each([
    "node",
    "./node",
    "/bin/sh",
    "/usr/bin/node --eval x",
    "/usr/bin/no${de}",
    "/usr/bin/node\n",
  ])("does not turn a command, shim or interpolated path into Node: %j", (nodeCommand) => {
    expect(() => registrationLocations({ ...options, nodeCommand })).toThrow();
  });

  it.each(["relative", "/work/../release", "/work/./release", "/work/\u0000release", "<artifact>"])(
    "refuses unresolved artifact path %j",
    (artifactDirectory) => {
      expect(() => registrationLocations({ ...options, artifactDirectory })).toThrow();
    },
  );

  it("retains spaces and supports explicitly selected Windows path syntax", () => {
    expect(registrationLocations(options).artifactDirectory).toBe(options.artifactDirectory);
    expect(
      registrationLocations({
        platform: "win32",
        artifactDirectory: "D:\\accepted release\\godd-matrix-mcp",
        projectDirectory: "D:\\project",
        nodeCommand: "C:\\runtime\\node.exe",
      }).nodeCommand,
    ).toBe("C:\\runtime\\node.exe");
    expect(() =>
      registrationLocations({
        platform: "win32",
        artifactDirectory: "\\implicit-drive\\release",
        projectDirectory: "D:\\project",
        nodeCommand: "C:\\runtime\\node.exe",
      }),
    ).toThrow();
    expect(() =>
      registrationLocations({
        platform: "win32",
        artifactDirectory: "D:\\NODE_MODULES\\godd-matrix-mcp",
        projectDirectory: "D:\\project",
        nodeCommand: "C:\\runtime\\node.exe",
      }),
    ).toThrow("node_modules");
  });

  it("accepts each explicit option once and refuses duplicate/unknown/missing options", () => {
    const args = [
      "--artifact-dir",
      options.artifactDirectory,
      "--project-dir",
      options.projectDirectory,
      "--node",
      options.nodeCommand,
      "--platform",
      options.platform,
    ];
    expect(parseRegistrationArgs(args)).toEqual(options);
    expect(() => parseRegistrationArgs([...args, "--node", "/other/node"])).toThrow();
    expect(() => parseRegistrationArgs([...args, "--source-auth", "true"])).toThrow();
    expect(() => parseRegistrationArgs(args.slice(0, -2))).toThrow();
    expect(() => parseRegistrationArgs([...args.slice(0, -1), "other"])).toThrow();
  });
});
