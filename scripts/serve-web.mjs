#!/usr/bin/env node
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(fileURLToPath(new URL("../web/dist/", import.meta.url)));
const types = new Map([
  [".css", "text/css; charset=utf-8"],
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".map", "application/json; charset=utf-8"],
]);

const server = createServer(async (req, res) => {
  try {
    const pathname = decodeURIComponent(new URL(req.url ?? "/", "http://localhost").pathname);
    const relative = pathname === "/" ? "index.html" : pathname.slice(1);
    const target = path.resolve(root, relative);
    if (!target.startsWith(`${root}${path.sep}`)) throw new Error("invalid path");
    const info = await stat(target);
    if (!info.isFile()) throw new Error("not a file");
    res.statusCode = 200;
    res.setHeader("content-type", types.get(path.extname(target)) ?? "application/octet-stream");
    createReadStream(target).pipe(res);
  } catch {
    res.statusCode = 404;
    res.end("Not found");
  }
});

server.listen(4173, "127.0.0.1");
