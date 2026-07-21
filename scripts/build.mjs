import { cp, mkdir, readdir, rm, stat } from "node:fs/promises";
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

await rm(destination, { recursive: true, force: true });
await mkdir(destination, { recursive: true });
for (const name of await readdir(root)) {
  if (excluded.has(name) || name.startsWith(".")) continue;
  const source = path.join(root, name);
  const details = await stat(source);
  if (details.isDirectory()) continue;
  if (!deployableExtensions.has(path.extname(name)) && name !== "README.md")
    continue;
  await cp(source, path.join(destination, name));
}
console.log(`Static build created at ${destination}`);
