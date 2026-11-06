import type { BackendAgentEntry, BackendWorkspaceEntry } from "../backend";
import { normalizeWorkspaceCwd } from "../stores/workspace-session-key";

/** Sidebar projects group a connection's sessions by their working directory. */
export interface DirectoryProject {
  id: string | null;
  label: string;
  cwd: string;
  workspaceIds: string[];
  sessions: BackendAgentEntry[];
}

export function groupDirectoryProjects(
  workspaces: BackendWorkspaceEntry[],
  sessions: BackendAgentEntry[],
): DirectoryProject[] {
  const projects = new Map<string, DirectoryProject>();
  const ensure = (cwd: string, id?: string, label?: string) => {
    const key = normalizeWorkspaceCwd(cwd);
    if (!key) return null;
    let project = projects.get(key);
    if (!project) {
      project = { id: id ?? null, label: label || key.split(/[\\/]/).filter(Boolean).pop() || key,
        cwd: key, workspaceIds: [], sessions: [] };
      projects.set(key, project);
    }
    if (id && !project.workspaceIds.includes(id)) project.workspaceIds.push(id);
    if (id && !project.id) project.id = id;
    return project;
  };
  for (const workspace of workspaces) {
    ensure(workspace.workspaceDirectory || workspace.projectRootPath, workspace.id,
      workspace.title || workspace.name);
  }
  for (const entry of sessions) {
    if (entry.agent.archivedAt) continue;
    ensure(entry.agent.cwd, entry.agent.workspaceId)?.sessions.push(entry);
  }
  for (const project of projects.values()) {
    project.sessions.sort((a, b) => b.agent.updatedAt.localeCompare(a.agent.updatedAt));
  }
  return [...projects.values()];
}
