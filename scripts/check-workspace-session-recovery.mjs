import { readFile } from "node:fs/promises";

const [preferences, session, openingStore, projects, key] = await Promise.all([
  readFile(new URL("../src/stores/preferences-store.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/stores/session-store.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/stores/writer-opening-store.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/editor/WorkspacePane.tsx", import.meta.url), "utf8"),
  readFile(new URL("../src/stores/workspace-session-key.ts", import.meta.url), "utf8"),
]);

const requirements = [
  ["workspace keys prioritise workspaceId and normalise cwd", /workspaceSessionKey[\s\S]*workspace:.*cwd:/, key],
  ["preferences persist an agent id for every workspace key", /agentIdByWorkspaceKey/, preferences],
  ["preferences can remove a stale workspace mapping", /clearAgentForWorkspace/, preferences],
  ["session store restores an agent through the active backend", /restoreAgent[\s\S]*fetchAgent[\s\S]*fetchAgentTimeline/, session],
  ["session restoration recreates realtime subscriptions", /restoreAgent[\s\S]*installAgentSubscriptions/, session],
  ["missing or archived agents clear only their own workspace mapping", /if \(!fetched \|\| fetched\.agent\.archivedAt\)[\s\S]*agentIdForWorkspace\(workspaceKey\) === agentId[\s\S]*clearAgentForWorkspace\(workspaceKey\)/, session],
  ["Projects delegates its connection and directory to the shared host flow", /useWriterOpeningStore\.getState\(\)\.open\(\{\s*connectionId:\s*source\.connectionId, cwd:\s*ws\.cwd, workspaceId:\s*ws\.id, label:\s*ws\.label/, projects],
  ["default startup restores a remembered workspace before discovery or creation", /if \(!target\.cwd && cwd && await measureStartupTrace\([\s\S]*session\.restoreAgent\(workspaceKey\)[\s\S]*return finish\(\);[\s\S]*let source = (?:cached \?\? )?await loadCatalog\(\)[\s\S]*createAgent\(/, openingStore],
  ["fallback refuses to create from a failed or incomplete session catalog", /if \(!source\?\.sessionsLoaded \|\| source\.sessionsError\)\s*\{\s*throw new Error/, openingStore],
  ["fallback sessions match the normalized directory and exclude archived agents", /source\.sessions\.filter\(\(\{ agent \}\) => !agent\.archivedAt &&\s*normalizeWorkspaceCwd\(agent\.cwd\) === normalizeWorkspaceCwd\(cwd\)/, openingStore],
  ["cached or deleted fallback candidates trigger fresh enumeration before creation", /if \(cached \|\| missingIds\.size\)\s*\{\s*source = await loadCatalog\(\);\s*if \(await restoreCandidates\(\)\) return finish\(\);[\s\S]*createAgent\(/, openingStore],
  ["cached project sessions are used only for the selected connection after successful discovery", /const cached = target\.cwd \? useBackendCatalogStore\.getState\(\)\.entries\.find\([\s\S]*entry\.connectionId === target\.connectionId && entry\.sessionsLoaded && !entry\.sessionsError/, openingStore],
  ["an explicit missing session surfaces an error instead of choosing a fallback", /if \(target\.agentId\)\s*\{\s*if \(!await session\.restoreAgentById\(target\.agentId, workspaceKey\)\)\s*\{\s*throw new Error[\s\S]*return finish\(\);/, openingStore],
  ["retry preserves the failed opening target", /retry:\s*\(\) => get\(\)\.open\(get\(\)\.target \?\? undefined\)/, openingStore],
];

const failures = requirements
  .filter(([, pattern, source]) => !pattern.test(source))
  .map(([description]) => description);

if (failures.length) {
  console.error(`Workspace session recovery contract failed:\n- ${failures.join("\n- ")}`);
  process.exit(1);
}

console.log("Workspace session recovery contract passed.");
