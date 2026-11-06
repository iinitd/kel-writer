// Barrel that forces every built-in plugin module to execute its
// registerPlugin() side-effect. Import this once from the app root (via
// PreviewHost) so no caller has to know which plugins exist.
//
// Order matters only for `match` tie-breaking: register the more specific
// plugins first. See src/plugins/registry.ts for the exact tie rule.

import "./lark-working-copy/plugin";
import "./markdown/plugin";
import "./web-preview/plugin";

export { getPlugin, listPlugins, listPreviewPlugins, previewPluginForFile, registerPlugin } from "./registry";
export type {
  Plugin,
  PluginContext,
  PreviewInstance,
  PreviewPlugin,
  PreviewRendererProps,
  PreviewScope,
  PreviewTarget,
} from "./types";
