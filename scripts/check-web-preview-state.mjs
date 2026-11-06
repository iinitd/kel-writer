import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const sourcePath = new URL("../src/web-preview/preview-state.ts", import.meta.url);
const source = fs.readFileSync(sourcePath, "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const module = { exports: {} };
vm.runInNewContext(compiled, { module, exports: module.exports, TextEncoder, JSON, Promise });
const { createPreviewStateScope, readPreviewState, writePreviewState } = module.exports;

const scopeA = createPreviewStateScope("/workspace", "projects/trip-a");
const scopeB = createPreviewStateScope("/workspace", "projects/trip-b");
assert.notEqual(scopeA, scopeB);
assert.equal(scopeA.includes("/workspace"), false);
assert.equal(scopeA.includes("trip-a"), false);

const values = new Map();
const storage = {
  getItem: async (key) => values.get(key) ?? null,
  setItem: async (key, value) => values.set(key, value),
};
assert.equal(await writePreviewState(storage, scopeA, "active-day", "d6"), true);
assert.equal(await readPreviewState(storage, scopeA, "active-day"), "d6");
assert.equal(await readPreviewState(storage, scopeB, "active-day"), null);
assert.equal(await writePreviewState(storage, scopeA, "../bad", "x"), false);
assert.equal(await writePreviewState(storage, scopeA, "large", "x".repeat(9000)), false);

const broken = {
  getItem: async () => { throw new Error("disabled"); },
  setItem: async () => { throw new Error("disabled"); },
};
assert.equal(await readPreviewState(broken, scopeA, "active-day"), null);
assert.equal(await writePreviewState(broken, scopeA, "active-day", "d6"), false);

console.log("Web Preview state contract passed.");
