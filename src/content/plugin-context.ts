import type { WriterBackend } from "../backend";
import type { PluginContext } from "../plugins/types";
import type { WorkspaceFiles } from "./workspace-files";
import { useConnectionStore } from "../stores/connection-store";
import { useFilesStore } from "../stores/files-store";
import { useSessionStore } from "../stores/session-store";
import { openWorkspaceDocument } from "../editor/open-document";
import { useWebPreviewStore } from "../web-preview/web-preview-store";

const sources = new WeakMap<WriterBackend, Map<string, WorkspaceFiles>>();

function workspaceFiles(client: WriterBackend, cwd: string, workspaceId: string | null): WorkspaceFiles {
  let byWorkspace = sources.get(client);
  if (!byWorkspace) { byWorkspace = new Map(); sources.set(client, byWorkspace); }
  const key = JSON.stringify([cwd, workspaceId]);
  const existing = byWorkspace.get(key);
  if (existing) return existing;
  const source: WorkspaceFiles = {
    readFile: (path) => client.readFile(cwd, path),
    listDirectory: (path) => client.listDirectory(cwd, path),
    getWorkspaceLabels: async () => {
      if (!workspaceId) return [];
      const workspace = (await client.fetchWorkspaces()).entries.find((entry) => entry.id === workspaceId);
      return workspace
        ? [workspace.title, workspace.name, workspace.projectCustomName].filter((label): label is string => typeof label === "string")
        : [];
    },
  };
  byWorkspace.set(key, source);
  return source;
}

/** The host binds backend operations to content capabilities before invoking a plugin. */
export function createPluginContext(
  client: WriterBackend | null,
  cwd: string | null,
  workspaceId: string | null,
  current?: () => boolean,
): PluginContext {
  const generation = useSessionStore.getState()._restoreGeneration;
  const contextIsCurrent = current ?? (() =>
    useConnectionStore.getState().client === client &&
    useFilesStore.getState().cwd === cwd &&
    useSessionStore.getState().workspaceId === workspaceId);
  const isCurrent = () => useSessionStore.getState()._restoreGeneration === generation && contextIsCurrent();
  return {
    cwd,
    workspaceId,
    files: client && cwd ? workspaceFiles(client, cwd, workspaceId) : null,
    isCurrent,
    openDocument: async (path) => cwd && isCurrent()
      ? openWorkspaceDocument(cwd, path, { isCurrent })
      : false,
    openWebPreview: async (rootPath) => cwd && isCurrent()
      ? useWebPreviewStore.getState().load(cwd, rootPath, true)
      : false,
  };
}
