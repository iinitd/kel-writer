import { create } from "zustand";
import type { WriterBackend } from "../backend";
import { useConnectionStore } from "./connection-store";

// A lazily-expanded tree of the workspace's files. Directories are fetched on
// demand via client.listDirectory(cwd, relativePath) the first time they're
// opened; the root ("") is loaded when the session mounts.
export interface FileNode {
  name: string;
  path: string; // relative to cwd
  kind: "file" | "directory";
  size: number;
  // For directories:
  expanded?: boolean;
  loaded?: boolean;
  loading?: boolean;
  children?: FileNode[];
}

interface FilesStore {
  cwd: string | null;
  root: FileNode[];
  rootLoading: boolean;
  error: string | null;

  loadRoot: (cwd: string) => Promise<void>;
  toggleDirectory: (path: string) => Promise<void>;
  refreshVisibleDirectories: () => Promise<void>;
  // Expand every ancestor directory of `filePath` so it becomes visible in the
  // tree. Fetches children on demand, shallowest ancestor first. No-op for
  // root-level files / when nothing is open.
  expandToFile: (filePath: string) => Promise<void>;
  reset: () => void;
}

let filesGeneration = 0;

function getClient(): WriterBackend {
  const client = useConnectionStore.getState().client;
  if (!client) throw new Error("Not connected to backend");
  return client;
}

// Directories first, then files; each alphabetical. Hidden dotfiles sink below.
function sortNodes(nodes: FileNode[]): FileNode[] {
  return [...nodes].sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === "directory" ? -1 : 1;
    const aHidden = a.name.startsWith(".");
    const bHidden = b.name.startsWith(".");
    if (aHidden !== bHidden) return aHidden ? 1 : -1;
    return a.name.localeCompare(b.name);
  });
}

async function fetchDir(client: WriterBackend, cwd: string, path: string): Promise<FileNode[]> {
  const dir = await client.listDirectory(cwd, path);
  const nodes: FileNode[] = dir.entries.map((e) => ({
    name: e.name,
    path: e.path,
    kind: e.kind,
    size: e.size,
    ...(e.kind === "directory"
      ? { expanded: false, loaded: false, loading: false, children: [] }
      : {}),
  }));
  return sortNodes(nodes);
}

// Return a new tree with `updater` applied to the node at `targetPath`.
function updateNode(
  nodes: FileNode[],
  targetPath: string,
  updater: (node: FileNode) => FileNode,
): FileNode[] {
  return nodes.map((node) => {
    if (node.path === targetPath) return updater(node);
    if (node.children && node.children.length > 0) {
      return { ...node, children: updateNode(node.children, targetPath, updater) };
    }
    return node;
  });
}

function findNode(nodes: FileNode[], targetPath: string): FileNode | null {
  for (const node of nodes) {
    if (node.path === targetPath) return node;
    if (node.children) {
      const found = findNode(node.children, targetPath);
      if (found) return found;
    }
  }
  return null;
}

function collectExpandedDirectoryPaths(nodes: FileNode[]): string[] {
  const paths: string[] = [];
  for (const node of nodes) {
    if (node.kind !== "directory") continue;
    if (node.expanded) paths.push(node.path);
    if (node.children && node.children.length > 0) {
      paths.push(...collectExpandedDirectoryPaths(node.children));
    }
  }
  return paths;
}

function fileTreesEqual(left: FileNode[], right: FileNode[]): boolean {
  if (left === right) return true;
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index++) {
    const a = left[index]!;
    const b = right[index]!;
    if (
      a.name !== b.name ||
      a.path !== b.path ||
      a.kind !== b.kind ||
      a.size !== b.size ||
      Boolean(a.expanded) !== Boolean(b.expanded) ||
      Boolean(a.loaded) !== Boolean(b.loaded) ||
      Boolean(a.loading) !== Boolean(b.loading)
    ) {
      return false;
    }
    if (!fileTreesEqual(a.children ?? [], b.children ?? [])) return false;
  }
  return true;
}

export const useFilesStore = create<FilesStore>()((set, get) => ({
  cwd: null,
  root: [],
  rootLoading: false,
  error: null,

  loadRoot: async (cwd: string) => {
    const generation = ++filesGeneration;
    const client = useConnectionStore.getState().client;
    const isCurrent = () => generation === filesGeneration && get().cwd === cwd && useConnectionStore.getState().client === client;
    set({ cwd, rootLoading: true, error: null, root: [] });
    try {
      if (!client) throw new Error("Not connected to backend");
      const nodes = await fetchDir(client, cwd, "");
      // A workspace switch may have started another load while this request
      // was in flight. Never let the older response replace the new tree.
      if (!isCurrent()) return;
      set({ root: nodes, rootLoading: false });
    } catch (err) {
      if (!isCurrent()) return;
      set({
        rootLoading: false,
        error: err instanceof Error ? err.message : "Failed to list directory",
      });
    }
  },

  toggleDirectory: async (path: string) => {
    const { cwd, root } = get();
    if (!cwd) return;
    const client = useConnectionStore.getState().client;
    if (!client) return;
    const generation = filesGeneration;
    const isCurrent = () => generation === filesGeneration && get().cwd === cwd && useConnectionStore.getState().client === client;
    const node = findNode(root, path);
    if (!node || node.kind !== "directory") return;

    // Collapse if already expanded.
    if (node.expanded) {
      set({ root: updateNode(get().root, path, (n) => ({ ...n, expanded: false })) });
      return;
    }

    // Expand; fetch children on first open.
    if (node.loaded) {
      set({ root: updateNode(get().root, path, (n) => ({ ...n, expanded: true })) });
      return;
    }

    set({ root: updateNode(get().root, path, (n) => ({ ...n, loading: true })) });
    try {
      const children = await fetchDir(client, cwd, path);
      if (!isCurrent()) return;
      set({
        root: updateNode(get().root, path, (n) => ({
          ...n,
          children,
          loaded: true,
          loading: false,
          expanded: true,
        })),
      });
    } catch (err) {
      if (!isCurrent()) return;
      set({
        root: updateNode(get().root, path, (n) => ({ ...n, loading: false })),
        error: err instanceof Error ? err.message : "Failed to list directory",
      });
    }
  },

  refreshVisibleDirectories: async () => {
    const { cwd, root, rootLoading } = get();
    if (!cwd || rootLoading) return;
    const client = useConnectionStore.getState().client;
    if (!client) return;
    const generation = filesGeneration;
    const isCurrent = () => generation === filesGeneration && get().cwd === cwd && useConnectionStore.getState().client === client;

    try {
      const nextRoot = await fetchDir(client, cwd, "");
      if (!isCurrent()) return;
      const expandedDirs = collectExpandedDirectoryPaths(root);
      let refreshedRoot = nextRoot;

      for (const dirPath of expandedDirs) {
        const existing = findNode(root, dirPath);
        const nextDirNode = findNode(refreshedRoot, dirPath);
        if (!existing || existing.kind !== "directory" || !nextDirNode || nextDirNode.kind !== "directory") {
          continue;
        }

        try {
          const children = await fetchDir(client, cwd, dirPath);
          if (!isCurrent()) return;
          refreshedRoot = updateNode(refreshedRoot, dirPath, (node) => ({
            ...node,
            expanded: true,
            loaded: true,
            loading: false,
            children,
          }));
        } catch {
          if (!isCurrent()) return;
          refreshedRoot = updateNode(refreshedRoot, dirPath, (node) => ({
            ...node,
            expanded: true,
            loaded: existing.loaded,
            loading: false,
            children: existing.children ?? [],
          }));
        }
      }

      const current = get();
      if (!isCurrent()) return;
      // A user may expand/collapse a directory while the refresh RPCs are in
      // flight. Do not overwrite that newer interaction with this old snapshot.
      if (current.root !== root) return;
      const unchanged = fileTreesEqual(current.root, refreshedRoot);
      if (unchanged && current.error === null) return;
      set({ root: unchanged ? current.root : refreshedRoot, error: null });
    } catch (err) {
      if (!isCurrent()) return;
      const message = err instanceof Error ? err.message : "Failed to refresh directory tree";
      if (get().error !== message) set({ error: message });
    }
  },

  reset: () => {
    filesGeneration++;
    set({ cwd: null, root: [], rootLoading: false, error: null });
  },

  expandToFile: async (filePath: string) => {
    const { cwd } = get();
    if (!cwd || !filePath) return;
    const client = useConnectionStore.getState().client;
    if (!client) return;
    const generation = filesGeneration;
    const isCurrent = () => generation === filesGeneration && get().cwd === cwd && useConnectionStore.getState().client === client;

    // Build the list of ancestor directory paths from the file's relative path,
    // shallowest first: "a/b/c.md" → ["a", "a/b"]. Paths are cwd-relative and
    // POSIX-separated (matching what the daemon returns).
    const parts = filePath.split("/").filter(Boolean);
    if (parts.length <= 1) return; // root-level file: nothing to expand
    const ancestors: string[] = [];
    for (let i = 1; i < parts.length; i++) {
      ancestors.push(parts.slice(0, i).join("/"));
    }

    // Expand each ancestor in order, fetching children when not yet loaded, so
    // deeper directories exist in the tree by the time we reach them.
    for (const dirPath of ancestors) {
      if (!isCurrent()) return;
      const node = findNode(get().root, dirPath);
      if (!node || node.kind !== "directory") continue;
      if (node.expanded && node.loaded) continue;

      if (node.loaded) {
        set({ root: updateNode(get().root, dirPath, (n) => ({ ...n, expanded: true })) });
        continue;
      }

      set({ root: updateNode(get().root, dirPath, (n) => ({ ...n, loading: true })) });
      try {
        const children = await fetchDir(client, cwd, dirPath);
        if (!isCurrent()) return;
        set({
          root: updateNode(get().root, dirPath, (n) => ({
            ...n,
            children,
            loaded: true,
            loading: false,
            expanded: true,
          })),
        });
      } catch {
        if (!isCurrent()) return;
        set({ root: updateNode(get().root, dirPath, (n) => ({ ...n, loading: false })) });
        return;
      }
    }
  },
}));

// Read a text file's contents from the workspace and decode to a string.
export async function readWorkspaceTextFile(
  cwd: string,
  path: string,
): Promise<string> {
  const client = getClient();
  const result = await client.readFile(cwd, path);
  return new TextDecoder("utf-8").decode(result.bytes);
}
