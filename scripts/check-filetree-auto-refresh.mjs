import { readFile } from "node:fs/promises";

const store = await readFile(
  new URL("../src/stores/files-store.ts", import.meta.url),
  "utf8",
);
const tree = await readFile(
  new URL("../src/editor/FileTree.tsx", import.meta.url),
  "utf8",
);

const requirements = [
  ["files store exposes visible-directory refresh", /refreshVisibleDirectories:\s*\(\)\s*=>\s*Promise<void>/, store],
  ["visible-directory refresh walks expanded directories", /function collectExpandedDirectoryPaths\(/, store],
  ["visible-directory refresh re-lists root and expanded directories", /await fetchDir\(cwd,\s*\"\"\)[\s\S]*for \(const dirPath of expandedDirs\)/, store],
  ["file tree starts a visibility-aware polling effect", /startVisibilityAwarePoller\(\s*refreshVisibleDirectories,\s*FILE_TREE_REFRESH_MS/, tree],
  ["file tree polling pauses outside the Files tab", /if \(!cwd \|\| tab !== "files"\) return/, tree],
  ["file tree calls refreshVisibleDirectories from the polling effect", /const refreshVisibleDirectories = useFilesStore\(\(s\) => s\.refreshVisibleDirectories\)/, tree],
];

const failures = requirements
  .filter(([, pattern, source]) => !pattern.test(source))
  .map(([description]) => description);

if (failures.length) {
  console.error(`File tree auto-refresh contract failed:\n- ${failures.join("\n- ")}`);
  process.exit(1);
}

console.log("File tree auto-refresh contract passed.");
