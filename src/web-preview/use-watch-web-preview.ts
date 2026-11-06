import { useEffect } from "react";
import { useConnectionStore } from "../stores/connection-store";
import { useContentStore } from "../content/content-store";
import { useWebPreviewStore } from "./web-preview-store";
import { startVisibilityAwarePoller } from "../utils/visibility-poller";

export function useWatchWebPreview(cwd: string | null) {
  const client = useConnectionStore((state) => state.client);
  const activePluginId = useContentStore((state) => state.active.pluginId);
  const refresh = useWebPreviewStore((state) => state.refresh);

  useEffect(() => {
    if (!client || !cwd || activePluginId !== "web-preview") return;
    return startVisibilityAwarePoller(() => refresh(cwd), 2000);
  }, [activePluginId, client, cwd, refresh]);
}
