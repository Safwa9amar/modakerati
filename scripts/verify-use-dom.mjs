// Verifies that every 'use dom' module still satisfies babel-preset-expo's
// use-dom-directive-plugin: such a module may have exactly ONE export, and it must
// be the default. A named non-type export throws at BUNDLE time and takes down the
// whole screen that renders it — a blank editor, not a degraded one.
//
// `npx tsc --noEmit` cannot see this. It was found only by running the real babel
// preset over the file, after a named `export function measureBlockHeights` shipped
// into components/workspace/lexical/LexicalDomEditor.tsx and typechecked cleanly.
//
// Run: node scripts/verify-use-dom.mjs
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { transformAsync } from "@babel/core";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** Every .tsx/.ts under components/ app/ hooks/ whose first line is the directive. */
function findUseDomFiles(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) { findUseDomFiles(full, out); continue; }
    if (!/\.(tsx?|jsx?)$/.test(entry.name)) continue;
    const head = fs.readFileSync(full, "utf8").slice(0, 200);
    if (/^\s*['"]use dom['"]/.test(head)) out.push(full);
  }
  return out;
}

const targets = ["components", "app", "hooks"]
  .map((d) => path.join(ROOT, d))
  .filter((d) => fs.existsSync(d))
  .flatMap((d) => findUseDomFiles(d));

if (targets.length === 0) {
  console.log("No 'use dom' modules found — nothing to check.");
  process.exit(0);
}

let failures = 0;
for (const file of targets) {
  const rel = path.relative(ROOT, file);
  try {
    await transformAsync(fs.readFileSync(file, "utf8"), {
      filename: file,
      babelrc: false,
      configFile: false,
      presets: [["babel-preset-expo", { jsxRuntime: "automatic" }]],
    });
    console.log(`  ok  ${rel}`);
  } catch (e) {
    failures++;
    console.log(`FAIL  ${rel}\n        ${String(e.message).split("\n")[0]}`);
  }
}

console.log(failures ? `\n${failures} FAILED` : `\nAll ${targets.length} 'use dom' module(s) bundle cleanly`);
process.exit(failures ? 1 : 0);
