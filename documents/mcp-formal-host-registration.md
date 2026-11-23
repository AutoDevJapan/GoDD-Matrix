# Register the retained formal MCP distribution

This companion emits registration text for the same retained distribution in both hosts. It does
not download an artifact, modify configuration, start Node or a host, or issue runtime permission.
The source is fixed to Matrix commit `ece931cb71c191ab1b977629e3fdac1846bb07d1`,
main workflow run `44655701843`, attempt 1, artifact `14593605352`. Its archive is 3,941,903 bytes with
SHA-256 `14fd21b3e610b0cf7b307eb7746dd9d4ae99c4fb7744722f6c9296f096bb20e3`.
Actions retention currently ends on `2026-12-04T01:44:06Z`; expiry does not authorize replacing it
with a PR artifact or rebuilding it silently.

## Obtain and verify the distribution

Use the existing authenticated GitHub artifact download operation with repository read access;
a cloud Git repository connection does not prove that its proxy supports Actions downloads.
The retained artifact is linked from
[the formal run](https://github.com/AutoDevJapan/GoDD-Matrix/actions/runs/44655701843).
If that normal operation fails, preserve its stage and response. Do not copy credentials between
hosts, create a token, retry a rejected endpoint through another route, or substitute source builds.
An already normally delivered, qualified copy may be used without another download.

Before registration, keep the archive identity and the normal provenance verification attached
to that exact source/ref/workflow. SHA256SUMS checks alone are not build-signature verification.
The plan checks the nine extracted file buffers against this release's fixed bytes and hashes;
it does not implement Sigstore/TUF verification, artifact authentication, or source admission.
Keep the existing normal provenance verifier's separate receipt. Neither a caller boolean nor
the plan's JSON is an execution grant.

## Establish a separate module scope, then produce the plan

The unchanged archive has nine members and no `package.json`. Its `main.js` is ESM.
Node 20.0 treats an unmarked `.js` as CommonJS; later syntax detection does not override an
explicit `type: commonjs` scope. Setting a different working directory does not change the
package scope of the entry file. `--input-type=module` applies to eval/stdin, not a file entry;
feeding the server through stdin would also consume the MCP protocol pipe.

Use a dedicated, normally owned consumer directory whose direct child is the already accepted
`godd-matrix-mcp` directory. The immediate parent `package.json` must contain exactly the bytes
of [the consumer module metadata](mcp-formal-module-scope.package.json):

```json
{"type":"module"}
```

The file includes one final LF: 18 bytes, SHA-256
`1239d4d885dcad42201a27ed9324f8f0f760b78700d8db9ced39a511cffe7eae`.
This file is consumer-side metadata outside the artifact directory. It is not an attested tenth
member. Do not edit the ZIP, main.js, checksums, or any of the nine files. Do not overwrite a
project's existing `package.json`. If the dedicated parent already has different metadata,
stop that placement and report the conflict through the normal owner; do not silently replace it.
Normal setup must create/read back this exact file as a separate owned operation before planning.
The planner itself does not create it. Keep that metadata's identity in the configuration record.

The registration CLI reads the immediate parent's file and rejects missing/different bytes,
symlinks, noncanonical artifact roots, a `package.json` inside the exact nine-file artifact, or a
scope boundary when the artifact directory itself or its direct parent has a basename ending in
`node_modules`, such as `consumer_node_modules`. Node 20 tests the literal URL pathname suffix
`node_modules/package.json`, not a whole path component. Windows names retain the same
case-insensitive rejection.
This check runs during CLI argument parsing, before artifact or parent-file I/O, and is also
used by the formatter and checked planner. Normal siblings such as `node_modules-sibling` are
not this boundary. A deeper placement such as `consumer_node_modules/consumer/godd-matrix-mcp`
can reach `consumer/package.json` before that suffix boundary and remains supported.
A farther CommonJS ancestor is irrelevant once
this exact nearest module scope is established. Each host may have its own absolute directories,
but both must use these same metadata bytes and the same nine-file release.

After the helper source has passed the normal review/build process, invoke it with that host's
normally usable Node executable and the same accepted artifact. No dependency install or artifact
build is required in the receiving host; the server is the bundled `main.js` with Node.js >=20.

```bash
node scripts/plan-mcp-hosts.mjs \
  --artifact-dir /absolute/accepted/godd-matrix-mcp \
  --project-dir /absolute/project \
  --node /absolute/normal/node \
  --platform posix
```

These are placeholders for qualified paths in that host, not fallback paths on another machine.
Windows callers use `--platform win32` and absolute Windows paths. Parent traversal, unresolved
placeholders, control characters, command strings and environment interpolation are refused.
The source reads the nine release files plus the separate immediate-parent metadata, bounds reads
by their fixed sizes and closes handles.
It does not inspect Node's body, authentication files or the user's other MCP configurations.
Normal ownership coordination must prevent the artifact directory from changing after planning;
the plan has no kernel lease or lifetime guarantee.

The checked JSON result records `moduleScope.file`/size/hash separately from the release and
contains `claudeProjectJson` and `codexProjectToml`. Both point directly to
the same `main.js`; snapshot/index paths are explicit absolute paths, and DESIGN.md uses the pinned
Design-Systems commit. Ambient Generator credentials/URL and Node preload options are cleared in
the server's child environment. This does not change either host's model or authentication.

- Claude Code: merge only the emitted `godd-matrix-formal` entry into the normal project's root
  `.mcp.json` under `mcpServers`. Existing entries stay intact. No undocumented `cwd` field or
  injected-only `CLAUDE_PROJECT_DIR` expansion is needed because all server paths are absolute.
  Resolve a higher-precedence entry of the same name normally; do not count a shadowed entry as used.
- Codex: merge the emitted table into the normal project `.codex/config.toml`. Its explicit `cwd`
  is that host's project, not the old PC's directory. Preserve existing tables and normal trust or
  approval decisions; the generated text changes none of them.

Save config text, its actual normal placement and the artifact identity separately. Discovery,
registration, connection and business results are different stages. A connected catalog or a JSON
plan alone does not satisfy [Issue #119](https://github.com/AutoDevJapan/GoDD-Matrix/issues/119).

`formatHostRegistration` remains usable on its own for unverified text formatting. It checks path
syntax only. The nine-buffer and module-metadata checks belong to `planFormalHostRegistration`
and to the CLI that supplies real file bytes. A standalone formatter result makes no claim about
artifact contents or effective package scope.

## Bounded compatibility acceptance

On a normally qualified Node, compare the same file entry and its unchanged buffers under:

| Runtime / nearest scope | Without the consumer scope | With the fixed consumer scope |
| --- | --- | --- |
| Node 20 before default syntax detection, no type | CommonJS classification, ESM startup fails | ESM classification |
| Node 20.19+ or Node 22 with no explicit type | May detect ESM; do not rely on it | ESM classification |
| Node 20 or Node 22 under explicit CommonJS | ESM startup fails | ESM classification, farther CommonJS ancestor unchanged |

The module-format positive does not by itself prove three MCP operations. A bounded file-mode
`node --check <artifact>/main.js` comparison can isolate parsing without consuming MCP stdin or
fetching data. Keep its exact Node version, current tool qualification, nearest metadata bytes,
exit/stderr and artifact hashes before/after. Missing/wrong/CRLF/duplicate metadata must be
rejected by the checked planner before a registration plan is returned. The parser check and
normal stdio connection remain separate stages; do not turn a VM/source simulation into Node
version acceptance. Do not install another Node or execute an unqualified one to run this table.

## Required business acceptance remains separate

In each actual host, use `godd_matrix_decide_axes`, `godd_matrix_select_cells` and
`godd_matrix_compose` with the same fixed brief and snapshot. Preserve native call IDs, structured
results, selected DESIGN path, full body hash, materialized provenance, axes and synthesized prompt
bytes. The representative selected cell is `7623_lt-h17_calm`, whose body hash is
`3531d8cf256d9bbf56838eb90e2e138293cdbbe448720cd83e45db9ff6974bb7`.
Use the original fixed brief/reference for comparison; this guide does not replace it.

Catalog corruption and body corruption require their own normally owned, qualified negative
inputs and actual runtime rejection. A planner's hash refusal is not that host acceptance.
Do not rerun an earlier refused fixture through a different shell, machine or broker. Startup
failure, missing tool, refusal, timeout, incomplete result and cleanup failure stay visible.
Close only the server/session resources created by the acceptance and retain the required receipts.

## Primary contracts

- [Claude Code MCP](https://code.claude.com/docs/en/mcp): project `.mcp.json`, stdio command/args/env
  and normal configuration precedence.
- [Codex MCP](https://learn.chatgpt.com/docs/extend/mcp): project config.toml command/args/cwd/env.
- [Node 20.0 package rules](https://nodejs.org/download/release/v20.0.0/docs/api/packages.html#determining-module-system)
  and [Node 20.19 syntax detection](https://nodejs.org/download/release/v20.19.0/docs/api/packages.html#syntax-detection):
  file extension and nearest `package.json` determine how `main.js` is interpreted.
- [GitHub artifact downloads](https://docs.github.com/en/actions/how-tos/manage-workflow-runs/download-workflow-artifacts):
  authenticated download and repository read access, distinct from repository cloning.

This is a source candidate for the missing registration handoff. Real helper, cloud delivery,
both hosts' business calls and negative runtime cases have separate acceptance records.
