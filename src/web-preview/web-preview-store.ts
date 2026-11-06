import { create } from "zustand";
import { useConnectionStore } from "../stores/connection-store";
import { useContentStore } from "../content/content-store";
import { loadWebPreview } from "./loader";
import type { WebPreviewSnapshot } from "./types";

// Publishing helper. Any time the store opens a preview on behalf of the
// user we route through the generic content-store opener so plugin-specific
// vocabulary stays contained to this file.
function publishActive(rootPath: string): void {
  useContentStore.getState().setActive({
    pluginId: "web-preview",
    target: { rootPath },
    instanceKey: rootPath,
    path: null,
  });
}

// Multi-instance cache. Each `(cwd, rootPath)` pair holds its own snapshot,
// so switching between the workspace-root preview and a `projects/<slug>`
// preview is instant on the second visit and never cross-contaminates the
// data URL caches. `instances` is the discovered list of roots (filled in
// from location.discoverWebPreviewRoots) and drives the picker UI.
interface WebPreviewStore {
  cwd: string | null;
  // Discovered preview roots for the current cwd. Empty until the first
  // discovery call or until a load() populates it as a side effect.
  instances: string[];
  // Currently active instance. "" is the workspace-root preview; non-empty
  // strings are `projects/<slug>` style paths. Mirrors the active snapshot.
  rootPath: string;
  loading: boolean;
  available: boolean;
  // Per-root cache so each instance keeps its own snapshot/error pair.
  snapshotByRoot: Record<string, WebPreviewSnapshot>;
  errorByRoot: Record<string, string>;
  // Convenience selectors derived from the cache for the active root.
  snapshot: WebPreviewSnapshot | null;
  error: string | null;

  setInstances: (instances: string[]) => void;
  load: (cwd: string, rootPath?: string, open?: boolean) => Promise<boolean>;
  refresh: (cwd: string) => Promise<void>;
  reset: () => void;
}

function client() {
  const value = useConnectionStore.getState().client;
  if (!value) throw new Error("Not connected to daemon");
  return value;
}

const inFlightPreviews = new WeakMap<object, Map<string, Promise<WebPreviewSnapshot>>>();
let foregroundLoadGeneration = 0;

function requestWebPreview(cwd: string, rootPath: string): Promise<WebPreviewSnapshot> {
  const activeClient = client();
  let requests = inFlightPreviews.get(activeClient as object);
  if (!requests) {
    requests = new Map();
    inFlightPreviews.set(activeClient as object, requests);
  }
  const key = `${cwd}\u0000${rootPath}`;
  const existing = requests.get(key);
  if (existing) return existing;

  const request = loadWebPreview(activeClient, cwd, rootPath).finally(() => {
    if (requests!.get(key) === request) requests!.delete(key);
  });
  requests.set(key, request);
  return request;
}

export const useWebPreviewStore = create<WebPreviewStore>()((set, get) => ({
  cwd: null,
  instances: [],
  rootPath: "",
  loading: false,
  available: false,
  snapshotByRoot: {},
  errorByRoot: {},
  snapshot: null,
  error: null,

  setInstances: (instances) => {
    // Preserve the active rootPath if it survived the rediscovery; otherwise
    // fall back to the first instance so the UI never points at a vanished
    // root. If no instances exist we don't force a reset — leaving the
    // snapshot/error alone lets `load()` continue to populate on demand.
    set((state) => {
      const sameInstances =
        state.instances.length === instances.length &&
        state.instances.every((value, index) => value === instances[index]);
      const nextRoot = instances.includes(state.rootPath)
        ? state.rootPath
        : instances[0] ?? state.rootPath;
      if (sameInstances && nextRoot === state.rootPath) return state;
      return {
        instances,
        rootPath: nextRoot,
        snapshot: state.snapshotByRoot[nextRoot] ?? null,
        error: state.errorByRoot[nextRoot] ?? null,
      };
    });
  },

  load: async (cwd, rootPath = "", open = true) => {
    const loadGeneration = ++foregroundLoadGeneration;
    const prev = get();
    // Discard caches when switching workspaces; a snapshot from a different
    // cwd is almost certainly stale and the fingerprint check wouldn't catch
    // cross-workspace path collisions.
    if (prev.cwd !== null && prev.cwd !== cwd) {
      set({
        cwd: null,
        instances: [],
        snapshotByRoot: {},
        errorByRoot: {},
        snapshot: null,
        error: null,
        rootPath: "",
        available: false,
      });
    }

    const current = get();
    const cached = current.snapshotByRoot[rootPath];
    const hasError = current.errorByRoot[rootPath];
    if (cached && !hasError) {
      // Instant cache hit — surface the cached snapshot right away, then
      // kick off a background refresh so we're at most one poll stale.
      set({
        cwd,
        rootPath,
        snapshot: cached,
        error: null,
        available: true,
        loading: false,
      });
      if (open) publishActive(rootPath);
      void (async () => {
        try {
          const snapshot = await requestWebPreview(cwd, rootPath);
          const after = get();
          if (after.cwd !== cwd) return;
          if (snapshot.fingerprint === after.snapshotByRoot[rootPath]?.fingerprint) return;
          const nextMap = { ...after.snapshotByRoot, [rootPath]: snapshot };
          set({
            snapshotByRoot: nextMap,
            snapshot: after.rootPath === rootPath ? snapshot : after.snapshot,
          });
        } catch {
          // Transient failure — keep the stale snapshot visible.
        }
      })();
      return true;
    }

    // Cold load. Flip `loading` so the picker can show a spinner on the row
    // being resolved; the active snapshot stays whatever it was so we don't
    // flash an empty state while another root is being fetched.
    set({ cwd, loading: true });
    try {
      const snapshot = await requestWebPreview(cwd, rootPath);
      if (loadGeneration !== foregroundLoadGeneration || get().cwd !== cwd) return false;
      set((state) => {
        const nextSnapshots = { ...state.snapshotByRoot, [rootPath]: snapshot };
        const nextErrors = { ...state.errorByRoot };
        delete nextErrors[rootPath];
        const instances = state.instances.includes(rootPath)
          ? state.instances
          : [...state.instances, rootPath];
        return {
          loading: false,
          available: true,
          rootPath,
          snapshot,
          error: null,
          snapshotByRoot: nextSnapshots,
          errorByRoot: nextErrors,
          instances,
        };
      });
      if (open) publishActive(rootPath);
      return true;
    } catch (error) {
      if (loadGeneration !== foregroundLoadGeneration || get().cwd !== cwd) return false;
      const message = error instanceof Error ? error.message : "Could not load preview/";
      set((state) => ({
        loading: false,
        available: true,
        rootPath,
        error: message,
        errorByRoot: { ...state.errorByRoot, [rootPath]: message },
      }));
      if (open) publishActive(rootPath);
      return false;
    }
  },

  refresh: async (cwd) => {
    const current = get();
    const rootPath = current.rootPath;
    try {
      const snapshot = await requestWebPreview(cwd, rootPath);
      const after = get();
      if (after.cwd !== cwd) return;
      if (snapshot.fingerprint === after.snapshotByRoot[rootPath]?.fingerprint) {
        if (after.errorByRoot[rootPath]) {
          const nextErrors = { ...after.errorByRoot };
          delete nextErrors[rootPath];
          set({
            errorByRoot: nextErrors,
            error: after.rootPath === rootPath ? null : after.error,
          });
        }
        return;
      }
      const nextMap = { ...after.snapshotByRoot, [rootPath]: snapshot };
      const nextErrors = { ...after.errorByRoot };
      delete nextErrors[rootPath];
      set({
        snapshotByRoot: nextMap,
        errorByRoot: nextErrors,
        available: true,
        snapshot: after.rootPath === rootPath ? snapshot : after.snapshot,
        error: after.rootPath === rootPath ? null : after.error,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not refresh preview/";
      set((state) => {
        if (state.cwd !== cwd || state.errorByRoot[rootPath] === message) return state;
        return {
          errorByRoot: { ...state.errorByRoot, [rootPath]: message },
          error: state.rootPath === rootPath ? message : state.error,
        };
      });
    }
  },

  reset: () => {
    foregroundLoadGeneration++;
    set({
      cwd: null,
      instances: [],
      rootPath: "",
      loading: false,
      available: false,
      snapshotByRoot: {},
      errorByRoot: {},
      snapshot: null,
      error: null,
    });
  },
}));
