#!/usr/bin/env node
/** Emit a plan from an already received distribution; no download, configuration write or launch. */
try {
  const { runHostRegistrationCli } = await import("../dist/release/host-registration-cli.js");
  const output = await runHostRegistrationCli(process.argv.slice(2));
  await new Promise((resolve, reject) => {
    process.stdout.write(output, (error) => (error ? reject(error) : resolve()));
  });
} catch {
  process.stderr.write(
    "MCP registration plan failed; check the built helper, fixed release files and required absolute paths.\n",
  );
  process.exitCode = 1;
}
