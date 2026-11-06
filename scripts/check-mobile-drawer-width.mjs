import { readFile } from "node:fs/promises";

const sessionScreen = await readFile(
  new URL("../app/writer/session.tsx", import.meta.url),
  "utf8",
);

const requirements = [
  [
    "mobile drawers use the midpoint viewport ratio",
    /MOBILE_DRAWER_SCREEN_RATIO\s*=\s*0\.85/,
  ],
  [
    "mobile drawers use the midpoint maximum width",
    /MOBILE_DRAWER_MAX_WIDTH\s*=\s*380/,
  ],
  [
    "left and right drawers share one computed width",
    /const drawerWidth = Math\.min\([\s\S]*const chatDrawerWidth = drawerWidth/,
  ],
  [
    "both drawer surfaces share the same maximum width",
    /drawer:[\s\S]*maxWidth: MOBILE_DRAWER_MAX_WIDTH[\s\S]*chatDrawer:[\s\S]*maxWidth: MOBILE_DRAWER_MAX_WIDTH/,
  ],
];

const failures = requirements
  .filter(([, pattern]) => !pattern.test(sessionScreen))
  .map(([description]) => description);

if (failures.length) {
  console.error(`Mobile drawer width contract failed:\n- ${failures.join("\n- ")}`);
  process.exit(1);
}

console.log("Mobile drawer width contract passed.");
