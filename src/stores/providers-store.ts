import { create } from "zustand";
import type {
  AgentModelDefinition,
  ProviderStatus,
} from "../backend";
import { useConnectionStore } from "./connection-store";
import { normalizeWorkspaceCwd } from "./workspace-session-key";
import { useSessionStore } from "./session-store";

// A single cached view of every provider the daemon knows about, together with
// each provider's models. Project opening and the in-session switcher share it.
//
// We use `getProvidersSnapshot`, which returns ALL providers (not just the
// currently-usable one) along with their models in a single round trip. Each
// entry carries a `status`/`enabled` flag so the UI can indicate which
// providers are actually ready.
export interface ProviderEntry {
  provider: string;
  label: string;
  status: ProviderStatus;
  enabled: boolean;
  available: boolean;
  error?: string;
  models: AgentModelDefinition[];
  defaultModeId?: string | null;
}

interface ProvidersStore {
  entries: ProviderEntry[];
  loading: boolean;
  loadedAt: number | null;
  loadedCwd: string | null;
  loadedProvider: string | null;
  error: string | null;

  loadProviders: (options?: { cwd?: string; force?: boolean }) => Promise<void>;
  getModels: (provider: string) => AgentModelDefinition[];
  reset: () => void;
}

const STALE_MS = 60_000;
let providersGeneration = 0;

export const useProvidersStore = create<ProvidersStore>()((set, get) => ({
  entries: [],
  loading: false,
  loadedAt: null,
  loadedCwd: null,
  loadedProvider: null,
  error: null,

  loadProviders: async (options) => {
    const client = useConnectionStore.getState().client;
    if (!client) {
      set({ error: "Not connected to backend" });
      return;
    }

    const requestedCwd = options?.cwd ? normalizeWorkspaceCwd(options.cwd) : null;
    const requestedProvider = client.kind === "openclaw" || client.kind === "opencode"
      ? useSessionStore.getState().provider
      : null;
    const { loadedAt, loadedCwd, loadedProvider, loading } = get();
    if (loading) {
      const generation = providersGeneration;
      await new Promise<void>((resolve) => {
        const unsubscribe = useProvidersStore.subscribe((state) => {
          if (state.loading) return;
          unsubscribe();
          resolve();
        });
        if (!get().loading) { unsubscribe(); resolve(); }
      });
      if (generation !== providersGeneration || useConnectionStore.getState().client !== client) return;
      // An in-flight snapshot may have been requested for another directory.
      // Scoped opening must await its own snapshot before choosing defaults.
      return get().loadProviders(options);
    }
    if (
      !options?.force &&
      loadedCwd === requestedCwd &&
      loadedProvider === requestedProvider &&
      loadedAt !== null &&
      Date.now() - loadedAt < STALE_MS &&
      get().entries.length > 0
    ) {
      return;
    }

    const generation = providersGeneration;
    const isCurrent = () => generation === providersGeneration && useConnectionStore.getState().client === client;
    set({ loading: true, error: null,
      ...(loadedCwd !== requestedCwd || loadedProvider !== requestedProvider ? { entries: [], loadedAt: null } : {}) });
    try {
      const snapshot = await client.getProvidersSnapshot(
        options?.cwd ? { cwd: options.cwd } : undefined,
      );
      if (!isCurrent()) return;
      const entries: ProviderEntry[] = snapshot.entries.map((e) => ({
        provider: e.provider,
        label: e.label ?? e.provider,
        status: e.status,
        enabled: e.enabled,
        available: e.status === "ready",
        error: e.error,
        models: e.models ?? [],
        defaultModeId: e.defaultModeId,
      }));
      set({ entries, loading: false, loadedAt: Date.now(), loadedCwd: requestedCwd, loadedProvider: requestedProvider });
    } catch (err) {
      if (!isCurrent()) return;
      set({
        loading: false,
        error: err instanceof Error ? err.message : "Failed to load providers",
      });
    }
  },

  getModels: (provider) => {
    return get().entries.find((e) => e.provider === provider)?.models ?? [];
  },

  reset: () => {
    providersGeneration++;
    set({ entries: [], loading: false, loadedAt: null, loadedCwd: null, loadedProvider: null, error: null });
  },
}));
