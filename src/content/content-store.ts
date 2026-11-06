import { create } from "zustand";

// Active content in the preview pane. The host used to carry a `type`
// discriminator ("document" | "web-preview") that leaked plugin-specific
// vocabulary into the generic layer; the plugin id now covers that job
// entirely. `target` is whatever opaque payload the plugin itself handed us
// in its `open()` call. `path` is a convenience shortcut for file-scope
// plugins so sidebars that highlight the current file don't have to peek
// into every plugin's target shape.
//
// `instanceKey` is what the plugin's `listInstances()` returned, so the
// host can remember/restore the right instance when the user bounces
// between workspaces.
export interface ActiveContent {
  pluginId: string;
  target: Record<string, unknown>;
  instanceKey: string | null;
  // Non-null for file-scope plugins. Shortcut used by the FileTree row
  // highlight so it does not need to understand plugin-specific targets.
  path: string | null;
}

interface ContentStore {
  active: ActiveContent;
  // rememberedInstanceByPlugin[workspaceKey][pluginId] = instanceKey
  // Keeps each workspace's last-active instance per plugin so switching
  // workspaces restores both the plugin pick and the chosen instance.
  rememberedInstanceByPlugin: Record<string, Record<string, string>>;
  // Convenience opener for file-scope plugins (markdown, lark-working-copy).
  // Keeps callers from building the full ActiveContent record for the common
  // "the user opened a file" case.
  openFile: (path: string | null, pluginId?: string) => void;
  // Generic opener. Plugins (and plugin-shaped flows like the web-preview
  // store) call this with whatever target shape they want.
  setActive: (active: ActiveContent) => void;
  rememberInstance: (workspaceKey: string, pluginId: string, instanceKey: string) => void;
  rememberedInstance: (workspaceKey: string, pluginId: string) => string | null;
  reset: () => void;
}

const DEFAULT_ACTIVE: ActiveContent = {
  pluginId: "markdown",
  target: {},
  instanceKey: null,
  path: null,
};

export const useContentStore = create<ContentStore>()((set, get) => ({
  active: DEFAULT_ACTIVE,
  rememberedInstanceByPlugin: {},
  openFile: (path, pluginId = "markdown") =>
    set({
      active: {
        pluginId,
        target: { path },
        instanceKey: path,
        path,
      },
    }),
  setActive: (active) => set({ active }),
  rememberInstance: (workspaceKey, pluginId, instanceKey) =>
    set((state) => {
      const forWorkspace = state.rememberedInstanceByPlugin[workspaceKey] ?? {};
      // Short-circuit if nothing changed — avoids useless subscriber churn.
      if (forWorkspace[pluginId] === instanceKey) return state;
      return {
        rememberedInstanceByPlugin: {
          ...state.rememberedInstanceByPlugin,
          [workspaceKey]: { ...forWorkspace, [pluginId]: instanceKey },
        },
      };
    }),
  rememberedInstance: (workspaceKey, pluginId) =>
    get().rememberedInstanceByPlugin[workspaceKey]?.[pluginId] ?? null,
  reset: () => set({ active: DEFAULT_ACTIVE }),
}));
