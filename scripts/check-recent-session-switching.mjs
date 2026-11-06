import { readFile } from "node:fs/promises";

const [preferences, sessionStore, openingStore, agentPicker] = await Promise.all([
  readFile(new URL("../src/stores/preferences-store.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/stores/session-store.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/stores/writer-opening-store.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/agent/AgentChatPanel.tsx", import.meta.url), "utf8"),
]);

const requirements = [
  ["preferences persist recent sessions", /recentSessions:\s*RecentSession\[\]/, preferences],
  ["preferences can add recent sessions", /addRecentSession:\s*\(session:\s*RecentSession\)/, preferences],
  ["preferences can remove stale recent sessions", /removeRecentSession:\s*\(agentId:\s*string\)/, preferences],
  ["session store records recent sessions after create or restore", /addRecentSession\(\{[\s\S]*agentId:/, sessionStore],
  ["recent sessions deduplicate by agent and remain bounded", /addRecentSession: \(session\)[\s\S]*filter\(\(s\) => s\.agentId !== session\.agentId\)[\s\S]*\[session, \.\.\.rest\]\.slice\(0, MAX_RECENT_SESSIONS\)/, preferences],
  ["a missing or archived session clears stale recent history", /if \(!fetched \|\| fetched\.agent\.archivedAt\)[\s\S]*removeRecentSession\(agentId\)[\s\S]*return false;/, sessionStore],
  ["the host opener matches remembered sessions to the selected normalized directory", /rememberedIds = prefs\.recentSessions\s*\.filter\(\(entry\) => normalizeWorkspaceCwd\(entry\.cwd\) === normalizeWorkspaceCwd\(cwd\)\)\s*\.map\(\(entry\) => entry\.agentId\)/, openingStore],
  ["project recovery prefers recent sessions before other directory candidates", /candidates\.sort\([\s\S]*rememberedIds\.indexOf\(id\)[\s\S]*rank\(a\.agent\.id\) - rank\(b\.agent\.id\)/, openingStore],
  ["the live Agent picker opens a selected session through the host flow", /useWriterOpeningStore\.getState\(\)\.open\(\{\s*connectionId,[\s\S]*agentId:\s*agent\.id/, agentPicker],
  ["session selection closes the picker only after a successful open", /const opened = await[\s\S]*if \(opened\)[\s\S]*setSwitcherOpen\(false\)/, agentPicker],
];

const failures = requirements
  .filter(([, pattern, source]) => !pattern.test(source))
  .map(([description]) => description);

if (failures.length) {
  console.error(`Recent session switching contract failed:\n- ${failures.join("\n- ")}`);
  process.exit(1);
}

console.log("Recent session switching contract passed.");
