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

// ── Second check: every relative specifier REACHABLE from a 'use dom' entry ──
//
// The transform above only sees the entry file. Once that entry's code lives in
// a folder of modules beside it, a wrong relative path is the same blank screen
// and NOTHING else catches it: `tsc` resolves .ts/.tsx but says nothing about
// `require("../../assets/fonts/x.ttf")`, and a bad asset path throws at module
// init, so the whole editor renders white.
//
// That is not hypothetical — splitting LexicalDomEditor.tsx into
// editor-components/ moved the Liberation Serif require two directories deeper
// and its `../` count was adjusted by one. Both gates passed; the editor was blank.
const EXTS = [".ts", ".tsx", ".js", ".jsx", ".mjs", "/index.ts", "/index.tsx", "/index.js", ""];
const SPEC_RE = /(?:from|require\()\s*["'](\.[^"']+)["']/g;

function resolveModule(file, spec) {
  const base = path.resolve(path.dirname(file), spec);
  for (const ext of EXTS) if (fs.existsSync(base + ext)) return base + ext;
  return null;
}

const visited = new Set();
let unresolved = 0;
function checkGraph(file, viaChain) {
  if (visited.has(file) || !/\.(tsx?|jsx?)$/.test(file)) return;
  visited.add(file);
  const src = fs.readFileSync(file, "utf8");
  for (const [, spec] of src.matchAll(SPEC_RE)) {
    const hit = resolveModule(file, spec);
    if (!hit) {
      unresolved++;
      console.log(`FAIL  ${path.relative(ROOT, file)}\n        unresolved "${spec}"`);
      if (viaChain.length) console.log(`        reached from ${viaChain.map((f) => path.relative(ROOT, f)).join(" → ")}`);
      continue;
    }
    checkGraph(hit, [...viaChain, file]);
  }
}
for (const file of targets) checkGraph(file, []);
console.log(`\n  ok  ${visited.size} module(s) reachable from a 'use dom' entry; every relative path resolves`);

const total = failures + unresolved;
console.log(total ? `\n${total} FAILED` : `\nAll ${targets.length} 'use dom' module(s) bundle cleanly`);
process.exit(total ? 1 : 0);
