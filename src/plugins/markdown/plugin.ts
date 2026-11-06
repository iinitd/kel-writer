// Markdown preview plugin.
//
// Handles .md / .markdown / .mdx / .txt / .html plus a long tail of code
// extensions, by delegating to the shared document renderer. This plugin
// deliberately does not try to be clever about its matcher — it accepts any
// openable file so it stays the "default" preview, with lark-working-copy
// claiming a stricter superset first.

import type { PluginContext, PreviewPlugin, PreviewTarget } from "../types";
import { registerPlugin } from "../registry";
import { EditorView } from "../../editor/EditorView";
import { useWatchOpenFile } from "../../editor/use-watch-open-file";

const OPENABLE_EXTS = new Set([
  ".md",
  ".markdown",
  ".mdx",
  ".txt",
  ".text",
  ".html",
  ".htm",
  ".json",
  ".yaml",
  ".yml",
  ".csv",
  ".log",
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".py",
  ".rs",
  ".go",
  ".java",
  ".c",
  ".cpp",
  ".h",
  ".css",
  ".sh",
]);

function extname(path: string): string {
  const dot = path.lastIndexOf(".");
  return dot >= 0 ? path.slice(dot).toLowerCase() : "";
}

export const markdownPlugin: PreviewPlugin = {
  kind: "preview",
  id: "markdown",
  title: "Document",
  scope: "file",
  capabilities: { editable: true },

  // Base score: 10. Lark working-copy returns 100 for the same path so it
  // wins the tie whenever both would accept the file.
  match: (file) => (OPENABLE_EXTS.has(extname(file.path)) ? 10 : false),

  // Opening a markdown-plugin instance means loading a workspace file into
  // the shared editor store. Host code hands the plugin a target of
  // `{ path }`; the plugin funnels through the same loader the file tree
  // uses so there is exactly one open path for every surface.
  open: async (ctx: PluginContext, target: PreviewTarget) => {
    const path = typeof target.path === "string" ? target.path : null;
    if (!ctx.cwd || !path) return;
    return ctx.openDocument(path);
  },

  Renderer: EditorView,

  // useWatchOpenFile is already mounted from inside the native/web renderers
  // today; wrapping it here as a hook lets Phase 2 pull that call up to the
  // plugin layer without changing per-renderer code. For Phase 1 we invoke
  // it only when the host explicitly mounts us via PreviewHost (not yet in
  // use), so we gate it behind a feature flag — see PreviewHost. Leaving it
  // referenced here keeps the import live for the Phase 2 move.
  useWatcher: () => {
    // Phase 1 no-op: the renderer still mounts the real watcher internally.
    // Phase 2 will replace the renderer's internal mount with this hook.
    void useWatchOpenFile;
  },
};

registerPlugin(markdownPlugin);
