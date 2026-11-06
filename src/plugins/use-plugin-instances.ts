// Hook that keeps a preview surface's instance list fresh.
//
// Consumers synchronously hydrate from the workspace-scoped cache, subscribe
// to its updates, then trigger a shared background refresh. Remounting a mobile
// drawer therefore keeps its rows while still discovering newly-created
// previews. A plugin whose discovery fails retains the last good snapshot.

import { useEffect, useState } from "react";
import { useFilesStore } from "../stores/files-store";
import { useSessionStore } from "../stores/session-store";
import { useConnectionStore } from "../stores/connection-store";
// Import from the registry module directly, not the plugins barrel, so this
// hook can be used inside plugin Renderers (e.g. WebPreview) without creating
// a module cycle via the barrel re-evaluating itself.
import { getPlugin } from "./registry";
import {
  discoverPluginInstances,
  getCachedPluginInstances,
  subscribePluginInstances,
} from "./plugin-instance-cache";
import type { PreviewInstance } from "./types";
import { createPluginContext } from "../content/plugin-context";

export function usePluginInstances(pluginId: string): PreviewInstance[] {
  const cwd = useFilesStore((state) => state.cwd);
  const workspaceId = useSessionStore((state) => state.workspaceId);
  const generation = useSessionStore((state) => state._restoreGeneration);
  const client = useConnectionStore((state) => state.client);
  const [instances, setInstances] = useState<PreviewInstance[]>(() => {
    const plugin = getPlugin(pluginId);
    if (!plugin || plugin.kind !== "preview" || !plugin.listInstances) return [];
    return getCachedPluginInstances(plugin, createPluginContext(client, cwd, workspaceId));
  });

  useEffect(() => {
    const plugin = getPlugin(pluginId);
    if (!plugin || plugin.kind !== "preview" || !plugin.listInstances) {
      setInstances([]);
      return;
    }
    const ctx = createPluginContext(client, cwd, workspaceId);
    setInstances(getCachedPluginInstances(plugin, ctx));
    const unsubscribe = subscribePluginInstances(plugin, ctx, setInstances);
    void discoverPluginInstances(plugin, ctx);
    return () => {
      unsubscribe();
    };
  }, [pluginId, cwd, workspaceId, client, generation]);

  return instances;
}
