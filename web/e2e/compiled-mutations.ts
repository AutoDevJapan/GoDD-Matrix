import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { SourceMap } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

export type CompiledMutation = "selection" | "stale" | "link" | "editor";

export async function compiledMutation(kind: CompiledMutation, script: string) {
  const root = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));
  const mapFile = path.join(root, "web/dist/assets/app.js.map");
  const mainFile = path.join(root, "web/src/main.ts");
  const [mapText, source] = await Promise.all([
    readFile(mapFile, "utf8"),
    readFile(mainFile, "utf8"),
  ]);
  const payload = JSON.parse(mapText);
  const sourcePath = (value: string) =>
    value.startsWith("file:") ? fileURLToPath(value) : path.resolve(path.dirname(mapFile), value);
  if (
    payload.version !== 3 ||
    !Array.isArray(payload.sources) ||
    !Array.isArray(payload.sourcesContent) ||
    typeof payload.mappings !== "string" ||
    payload.sourceRoot
  ) {
    throw new Error("Unsupported compiled source map");
  }
  const sourceIndexes = payload.sources
    .map((value: string, index: number) => (sourcePath(value) === mainFile ? index : -1))
    .filter((index: number) => index >= 0);
  const sourceIndex = sourceIndexes[0];
  if (
    sourceIndexes.length !== 1 ||
    sourceIndex === undefined ||
    payload.sourcesContent[sourceIndex] !== source
  ) {
    throw new Error("Compiled source map does not contain the fixed main bytes");
  }
  const lines = source.split("\n");
  const boundary = {
    selection: (line: string) => line.includes("text.setSelectionRange("),
    stale: (line: string) => line.trim() === "if (requestId !== detailRequestId) return;",
    link: (line: string) => line.includes("pendingDeepLink?.noteUrlWrite("),
    editor: (line: string) => line.trim() === "opts.keepColorEditor === true &&",
  }[kind];
  const sourceLine = lines.findIndex(boundary);
  if (sourceLine < 0) throw new Error("Missing source mutation boundary");
  const sourceMap = new SourceMap(payload);
  const mapped = (offset: number) => {
    const prefix = script.slice(0, offset);
    const line = prefix.split("\n").length - 1;
    const column = offset - (prefix.lastIndexOf("\n") + 1);
    const entry = sourceMap.findEntry(line, column);
    return (
      "originalSource" in entry &&
      "originalLine" in entry &&
      typeof entry.originalSource === "string" &&
      typeof entry.originalLine === "number" &&
      sourcePath(entry.originalSource) === mainFile &&
      entry.originalLine >= sourceLine &&
      entry.originalLine <= sourceLine + (kind === "selection" ? 4 : 0)
    );
  };
  const pattern = {
    selection: /[A-Za-z_$][\w$]*\.setSelectionRange\(/g,
    stale: /[A-Za-z_$][\w$]*!==[A-Za-z_$][\w$]*/g,
    link: /[A-Za-z_$][\w$]*(?:\?\.|\.)noteUrlWrite\(/g,
    editor: /[A-Za-z_$][\w$]*\.keepColorEditor\b/g,
  }[kind];
  const sites = [...script.matchAll(pattern)].filter(
    (match) => script[(match.index ?? 0) - 1] !== "." && mapped(match.index ?? 0),
  );
  if (sites.length !== 1 || sites[0]?.index === undefined) {
    throw new Error("Compiled mutation site is missing or ambiguous");
  }
  const start = sites[0].index;
  let end = start + sites[0][0].length;
  if (kind === "selection" || kind === "link") {
    let depth = 1;
    let quote = "";
    let escaped = false;
    for (; end < script.length && depth > 0; end++) {
      const char = script[end];
      if (quote) {
        if (escaped) escaped = false;
        else if (char === "\\") escaped = true;
        else if (char === quote) quote = "";
      } else if (char === '"' || char === "'") quote = char;
      else if (char === "(") depth++;
      else if (char === ")") depth--;
    }
    if (depth !== 0) throw new Error("Unclosed compiled selection call");
  }
  const replacement = {
    selection: "void 0",
    stale: "false",
    link: "void 0",
    editor: "!1",
  }[kind];
  const body = script.slice(0, start) + replacement + script.slice(end);
  const digest = (text: string) => createHash("sha256").update(text).digest("hex");
  return {
    body,
    proof: {
      kind,
      sourceLine: sourceLine + 1,
      sourceSHA256: digest(source),
      sourceMapSHA256: digest(mapText),
      originalSHA256: digest(script),
      mutatedSHA256: digest(body),
      siteCount: sites.length,
      start,
      end,
      removed: script.slice(start, end),
      replacement,
    },
  };
}
