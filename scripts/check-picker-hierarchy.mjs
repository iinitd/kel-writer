import { readFile } from "node:fs/promises";

const [directoryProjects, projects, agentPicker, writerShell] = await Promise.all([
  readFile(new URL("../src/editor/directory-projects.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/editor/WorkspacePane.tsx", import.meta.url), "utf8"),
  readFile(new URL("../src/agent/AgentChatPanel.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/writer/session.tsx", import.meta.url), "utf8"),
]);

const requirements = [
  ["projects group a connection's workspaces and sessions by normalized directory", /function groupDirectoryProjects[\s\S]*normalizeWorkspaceCwd\(cwd\)[\s\S]*projects\.get\(key\)[\s\S]*projects\.set\(key, project\)/, directoryProjects],
  ["directory groups include session-only projects and exclude archived agents", /for \(const entry of sessions\)[\s\S]*if \(entry\.agent\.archivedAt\) continue;[\s\S]*ensure\(entry\.agent\.cwd, entry\.agent\.workspaceId\)/, directoryProjects],
  ["Projects groups each backend catalog separately", /entries\.map\(\(source\)[\s\S]*groupDirectoryProjects\(source\.workspaces, source\.sessions\)/, projects],
  ["Projects renders connection sections with directory rows", /sources\.map\([\s\S]*key=\{source\.connectionId\}[\s\S]*workspaces\.map\(\(ws\) => renderRow\(source, contextKey, ws\)\)/, projects],
  ["selected projects are identified by both connection and directory", /source\.connectionId === activeConnectionId && ws\.cwd === activeCwd/, projects],
  ["Agent picker renders individual sessions within connection sections", /sessionSources\.map\(\(section\)[\s\S]*section\.data\.map\(\(item\)/, agentPicker],
  ["Agent picker selects only the current connection and project directory", /source\.connectionId !== activeConnectionId \|\| !cwd[\s\S]*normalizeWorkspaceCwd\(agent\.cwd\) === normalizeWorkspaceCwd\(cwd\)/, agentPicker],
  ["selected sessions are identified by both connection and agent id", /connectionId === activeConnectionId && agent\.id === agentId/, agentPicker],
  ["the writer shell hosts the Agent picker", /<AgentChatPanel\b/, writerShell],
];

const failures = requirements
  .filter(([, pattern, text]) => !pattern.test(text))
  .map(([description]) => description);

if (failures.length) {
  console.error(`Picker hierarchy contract failed:\n- ${failures.join("\n- ")}`);
  process.exit(1);
}

console.log("Picker hierarchy contract passed.");
