import { cp, mkdir, readFile, readdir, rm, stat } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const root = process.cwd();
const destination = path.join(root, "dist");
const excluded = new Set([
  ".git",
  ".github",
  "dist",
  "node_modules",
  "scripts",
  "tests",
  "types",
  "supabase",
]);
const deployableExtensions = new Set([".html", ".js", ".css", ".md", ".sql"]);

function localAssetsFromHtml(html) {
  const assets = [];
  const pattern = /<(?:script|link)\b[^>]*(?:src|href)=["']([^"']+)["'][^>]*>/gi;
  for (const match of html.matchAll(pattern)) {
    const value = match[1].split("?")[0].split("#")[0];
    if (!value || /^(?:https?:|data:|mailto:|tel:|#)/i.test(value)) continue;
    assets.push(value.replace(/^\.\//, ""));
  }
  return assets;
}

async function assertLocalAssetsExist(htmlFiles) {
  const missing = [];
  for (const file of htmlFiles) {
    const html = await readFile(path.join(root, file), "utf8");
    for (const asset of localAssetsFromHtml(html)) {
      try {
        const details = await stat(path.join(root, asset));
        if (!details.isFile()) missing.push(`${file} -> ${asset}`);
      } catch (_error) {
        missing.push(`${file} -> ${asset}`);
      }
    }
  }
  if (missing.length) {
    throw new Error(`Missing local assets:\n${missing.join("\n")}`);
  }
}

await rm(destination, { recursive: true, force: true });
await mkdir(destination, { recursive: true });
const rootEntries = await readdir(root);
const htmlFiles = rootEntries.filter((name) => path.extname(name) === ".html");
await assertLocalAssetsExist(htmlFiles);

for (const name of rootEntries) {
  if (excluded.has(name) || name.startsWith(".")) continue;
  const source = path.join(root, name);
  const details = await stat(source);
  if (details.isDirectory()) continue;
  if (!deployableExtensions.has(path.extname(name)) && name !== "README.md")
    continue;
  await cp(source, path.join(destination, name));
}
console.log(`Static build created at ${destination}`);
