import { readFile } from "node:fs/promises";

const web = await readFile(
  new URL("../src/editor/editor-web.tsx", import.meta.url),
  "utf8",
);
const native = await readFile(
  new URL("../src/editor/editor-native.tsx", import.meta.url),
  "utf8",
);
const commentBar = await readFile(
  new URL("../src/editor/DocumentCommentBar.tsx", import.meta.url),
  "utf8",
);

const requirements = [
  ["web editor ignores collapsed selections instead of clearing active highlight", /if \(from === to\) \{[\s\S]*return;[\s\S]*setToolbar\(HIDDEN_TOOLBAR\);/, web],
  ["native editor ignores empty selection messages instead of clearing selection", /if \(text.length === 0\) break;[\s\S]*setSelectionText\(text\);/, native],
  ["explicit clear action still exists on the selection chip", /onClearSelection/, commentBar],
  ["selection chip still renders explicit dismiss affordance", /chipClear/, commentBar],
];

const failures = requirements
  .filter(([, pattern, source]) => !pattern.test(source))
  .map(([description]) => description);

if (failures.length) {
  console.error(`Selection persistence contract failed:\n- ${failures.join("\n- ")}`);
  process.exit(1);
}

console.log("Selection persistence contract passed.");
