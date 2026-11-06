import { readFile } from "node:fs/promises";

const source = await readFile(
  new URL("../src/editor/editor-native.tsx", import.meta.url),
  "utf8",
);

const requirements = [
  ["bridge stores the last non-empty selection range", /var lastRange = null;[\s\S]*lastRange = sel\.getRangeAt\(0\)\.cloneRange\(\);/, source],
  ["working mark can reuse the stored range after selection collapses", /var range = \(!sel\.isCollapsed && sel\.rangeCount > 0\)\s*\?\s*sel\.getRangeAt\(0\)\s*:\s*lastRange;/, source],
  ["sending a selected comment still triggers kelMarkWorking", /__kelMarkWorking && window\.__kelMarkWorking/, source],
];

const failures = requirements
  .filter(([, pattern, text]) => !pattern.test(text))
  .map(([description]) => description);

if (failures.length) {
  console.error(`Native selection working mark contract failed:\n- ${failures.join("\n- ")}`);
  process.exit(1);
}

console.log("Native selection working mark contract passed.");
