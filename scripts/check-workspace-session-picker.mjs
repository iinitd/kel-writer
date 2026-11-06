import { readFile } from "node:fs/promises";

const [catalog, agentPicker, openingStore, sessionStore] = await Promise.all([
  readFile(new URL("../src/stores/backend-catalog-store.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/agent/AgentChatPanel.tsx", import.meta.url), "utf8"),
  readFile(new URL("../src/stores/writer-opening-store.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/stores/session-store.ts", import.meta.url), "utf8"),
]);

const requirements = [
  ["the shared catalog fetches active, unarchived agents", /fetchAgents\(\{\s*scope:\s*"active",\s*filter:\s*\{ includeArchived:\s*false \}/, catalog],
  ["the shared catalog follows pagination through all active sessions", /do \{[\s\S]*fetchAgents[\s\S]*hasMore[\s\S]*nextCursor[\s\S]*while \(cursor\)/, catalog],
  ["the Agent picker uses only the current project's source connection", /if \(source\.connectionId !== activeConnectionId \|\| !cwd\) return \[\];/, agentPicker],
  ["the Agent picker includes only unarchived sessions in the current normalized cwd", /data:\s*source\.sessions[\s\S]*filter\(\(\{ agent \}\) => !agent\.archivedAt &&\s*normalizeWorkspaceCwd\(agent\.cwd\) === normalizeWorkspaceCwd\(cwd\)\)[\s\S]*connectionId:\s*source\.connectionId, agent/, agentPicker],
  ["the picker updates when the project or its connection changes", /\[entries, connections, activeConnectionId, cwd\]/, agentPicker],
  ["session rows dispatch the deliberately chosen session", /onPress=\{\(\) => void switchToSession\(item\)\}/, agentPicker],
  ["choosing a session delegates its identity to the shared host opener", /useWriterOpeningStore\.getState\(\)\.open\(\{\s*connectionId,[\s\S]*agentId:\s*agent\.id/, agentPicker],
  ["the shared opener can restore a specific selected agent", /restoreAgentById\(/, openingStore],
  ["the store can restore a deliberately selected agent", /restoreAgentById[\s\S]*fetchAgent[\s\S]*fetchAgentTimeline/, sessionStore],
  ["the Agent picker offers provider and model selection for new sessions", /<ProviderModelPickerModal[\s\S]*title="New session"[\s\S]*onConfirm=\{startNewSession\}/, agentPicker],
];

const failures = requirements
  .filter(([, pattern, source]) => !pattern.test(source))
  .map(([description]) => description);

if (failures.length) {
  console.error(`Workspace session picker contract failed:\n- ${failures.join("\n- ")}`);
  process.exit(1);
}

console.log("Workspace session picker contract passed.");
