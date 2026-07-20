import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(fileURLToPath(new URL(".", import.meta.url)), "..");
const dsIndexPat = path.join(root, "..", "GoDD-Design-Systems", "index.json");
const outDir = path.join(root, "web", "dist");
const srcDir = path.join(root, "web", "src");

console.log("Loading full index.json...");
const fullIndex = JSON.parse(fs.readFileSync(dsIndexPat, "utf8"));

console.log("Compressing entries for web deployment...");
const compressedEntries = fullIndex.entries.map((e) => ({
  id: e.id,
  jsic: e.jsic,
  color: e.color,
  mood: e.mood,
  tags: e.tags,
}));

const webIndex = {
  version: 2,
  generatedAt: fullIndex.generatedAt,
  entries: compressedEntries,
};

fs.mkdirSync(outDir, { recursive: true });
fs.mkdirSync(srcDir, { recursive: true });

// Write to dist and src
fs.writeFileSync(path.join(outDir, "web-index.json"), JSON.stringify(webIndex), "utf8");
fs.writeFileSync(path.join(srcDir, "web-index.json"), JSON.stringify(webIndex), "utf8");

console.log(
  `Successfully generated web-index.json: ${(fs.statSync(path.join(outDir, "web-index.json")).size / 1024 / 1024).toFixed(2)} MB`,
);
