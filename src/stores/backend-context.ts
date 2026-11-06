import { usePreferencesStore } from "./preferences-store";

export async function activateBackendContext(key: string, kind: "paseo" | "openclaw" | "opencode"): Promise<void> {
  if (!usePreferencesStore.persist.hasHydrated()) {
    await new Promise<void>((resolve) => {
      const unsubscribe = usePreferencesStore.persist.onFinishHydration(() => {
        unsubscribe();
        resolve();
      });
      if (usePreferencesStore.persist.hasHydrated()) {
        unsubscribe();
        resolve();
      }
    });
  }
  usePreferencesStore.getState().activateBackend(key, kind);
}

/** Dispose only frontend state; work already running on the backend continues. */
export async function resetBackendViews(): Promise<void> {
  const [sessions, providers, files, editor, content, annotations, preview, assets, plugins] = await Promise.all([
    import("./session-store"),
    import("./providers-store"),
    import("./files-store"),
    import("./editor-store"),
    import("../content/content-store"),
    import("./annotation-store"),
    import("../web-preview/web-preview-store"),
    import("../editor/resolve-doc-images"),
    import("../plugins/plugin-instance-cache"),
  ]);
  sessions.useSessionStore.getState().reset();
  providers.useProvidersStore.getState().reset();
  files.useFilesStore.getState().reset();
  editor.useEditorStore.getState().resetDocument();
  editor.useEditorStore.setState({ reviseTargetsByCwd: {} });
  content.useContentStore.getState().reset();
  content.useContentStore.setState({ rememberedInstanceByPlugin: {} });
  annotations.useAnnotationStore.getState().clearPendingAnnotations();
  preview.useWebPreviewStore.getState().reset();
  assets.clearDocumentAssetCache();
  plugins.clearPluginInstanceCache();
}
