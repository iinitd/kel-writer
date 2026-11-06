import { readFile } from "node:fs/promises";

const [fileTree, workspacePane] = await Promise.all([
  readFile(new URL("../src/editor/FileTree.tsx", import.meta.url), "utf8"),
  readFile(new URL("../src/editor/WorkspacePane.tsx", import.meta.url), "utf8"),
]);

function rowActiveBlock(source) {
  return /rowActive:\s*\{([\s\S]*?)\n\s*\},\n\s*rowInner:/.exec(source)?.[1] ?? "";
}

const fileActive = rowActiveBlock(fileTree);
const workspaceActive = rowActiveBlock(workspacePane);
const requirements = [
  [
    "file selection uses the lighter surface",
    /backgroundColor:\s*"rgba\(255, 255, 255, 0\.62\)"/.test(fileActive),
  ],
  [
    "workspace selection uses the lighter surface",
    /backgroundColor:\s*"rgba\(255, 255, 255, 0\.62\)"/.test(workspaceActive),
  ],
  [
    "file selection uses a subtle border",
    /borderColor:\s*"rgba\(148, 163, 184, 0\.28\)"/.test(fileActive),
  ],
  [
    "workspace selection uses a subtle border",
    /borderColor:\s*"rgba\(148, 163, 184, 0\.28\)"/.test(workspaceActive),
  ],
  [
    "file selection has no shadow",
    !/shadow|elevation/.test(fileActive),
  ],
  [
    "workspace selection has no shadow",
    !/shadow|elevation/.test(workspaceActive),
  ],
];

const failures = requirements
  .filter(([, passed]) => !passed)
  .map(([description]) => description);

if (failures.length) {
  console.error(`Sidebar selected-state contract failed:\n- ${failures.join("\n- ")}`);
  process.exit(1);
}

console.log("Sidebar selected-state contract passed.");
