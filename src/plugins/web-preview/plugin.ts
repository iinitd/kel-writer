// Web preview plugin.
//
// A "web preview" is a project root containing `<root>/preview/index.html`.
// Each discovered root becomes a PreviewInstance that the user can switch
// between from the preview surface. The plugin owns discovery and dispatch;
// the renderer stays a thin UI around the shared web-preview-store.

import type { PluginContext, PreviewInstance, PreviewPlugin, PreviewTarget } from "../types";
import { registerPlugin } from "../registry";
import { WebPreview } from "../../web-preview/WebPreview";
import { useWatchWebPreview } from "../../web-preview/use-watch-web-preview";
import { useWebPreviewStore } from "../../web-preview/web-preview-store";
import { discoverWebPreviewRoots } from "../../web-preview/location";
import { useFilesStore } from "../../stores/files-store";
import { useContentStore } from "../../content/content-store";
import { publishPluginInstances } from "../plugin-instance-cache";

function labelFor(rootPath: string): string {
  if (!rootPath) return "Workspace";
  // `projects/foo` -> `foo`; keep the full path only when the structure
  // doesn't match the slug convention so the user still sees something.
  const match = /^projects\/([^/]+)$/.exec(rootPath);
  return match ? match[1]! : rootPath;
}

function instancesFor(rootPaths: string[]): PreviewInstance[] {
  const { snapshotByRoot } = useWebPreviewStore.getState();
  return rootPaths.map((rootPath) => ({
    key: rootPath,
    label: snapshotByRoot[rootPath]?.title ?? labelFor(rootPath),
    subtitle: rootPath || "(workspace root)",
    target: { rootPath },
  }));
}

export const webPreviewPlugin: PreviewPlugin = {
  kind: "preview",
  id: "web-preview",
  title: "Web Preview",
  scope: "project",

  // The entry point is the Files sidebar's "Web Preview" row and the auto-
  // open flow in writer/session, so there is no match score to return.
  match: () => false,

  listInstances: async (ctx: PluginContext): Promise<PreviewInstance[]> => {
    if (!ctx.files) {
      // Fall back to whatever the store already knows, so the picker is
      // not forced to re-discover on every open.
      const store = useWebPreviewStore.getState();
      return instancesFor(store.instances);
    }
    try {
      const roots = await discoverWebPreviewRoots(ctx.files);
      if (ctx.isCurrent && !ctx.isCurrent()) return [];
      useWebPreviewStore.getState().setInstances(roots);
      return instancesFor(roots);
    } catch {
      // Discovery failed — surface what we had cached instead of nothing.
      const store = useWebPreviewStore.getState();
      return instancesFor(store.instances);
    }
  },

  open: async (ctx: PluginContext, target: PreviewTarget) => {
    const cwd = ctx.cwd;
    if (!cwd) return;
    const rootPath = typeof target.rootPath === "string" ? target.rootPath : "";
    const opened = await ctx.openWebPreview(rootPath);
    if (opened && (!ctx.isCurrent || ctx.isCurrent())) {
      const store = useWebPreviewStore.getState();
      publishPluginInstances(
        webPreviewPlugin,
        { ...ctx, cwd },
        instancesFor(store.instances),
      );
      useContentStore
        .getState()
        .rememberInstance(ctx.workspaceId ?? cwd, webPreviewPlugin.id, rootPath);
    }
    return opened;
  },

  useWatcher: () => {
    const cwd = useFilesStore((s) => s.cwd);
    useWatchWebPreview(cwd);
  },

  Renderer: WebPreview,
};

registerPlugin(webPreviewPlugin);
