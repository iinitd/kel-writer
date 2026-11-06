// Plugin system foundations.
//
// A "plugin" is a module that contributes a capability to the host app. The
// first capability is "preview" — a surface that renders some kind of content
// inside the main preview pane. Future kinds (e.g. "action", "sidebar") will
// extend the Plugin union without disturbing the preview flow.
//
// Phase 1 goal: give every existing preview surface (markdown, lark-working-
// copy, web-preview) a Plugin descriptor and dispatch through a registry,
// without changing any user-visible behaviour. The content-store, open flows,
// and renderer code are intentionally untouched in this phase; the subsequent
// phases migrate those entry points onto the plugin API.

import type { ComponentType } from "react";
import type { WorkspaceFiles } from "../content/workspace-files";

// What "unit" of content a plugin's preview operates on. This is what makes
// lark-working-copy's granularity question tractable: web-preview is bound to
// a project root, markdown to a single file, and lark-working-copy sits
// between the two (a workspace can host multiple working copies, each backed
// by a specific .md file).
export type PreviewScope = "file" | "project" | "workspace";

// Ambient info a plugin needs to resolve "where are we?". The host supplies
// this on every call so plugins never reach into stores directly for scope
// data (keeps plugins unit-testable and makes future workspace-switch
// instrumentation one-stop).
export interface PluginContext {
  cwd: string | null;
  workspaceId: string | null;
  files: WorkspaceFiles | null;
  openDocument: (path: string) => Promise<boolean>;
  openWebPreview: (rootPath: string) => Promise<boolean>;
  // Async opens use this to avoid publishing stale content after the user
  // switches to another workspace while a file/preview is still loading.
  isCurrent?: () => boolean;
}

// Plugin-defined opaque target. For markdown it's `{ path }`, for web-preview
// it's `{ rootPath }`, for lark it's `{ path }` as well. The host does not
// inspect the shape; it just hands it to the plugin's `open`.
export type PreviewTarget = Record<string, unknown>;

// One switchable item in a plugin's instance list — used by the UI to offer a
// chip-style instance switcher at the top of the preview surface. A plugin
// that doesn't need switching (markdown) simply omits `listInstances`.
export interface PreviewInstance {
  key: string;           // Plugin-local identity (e.g. file path, root path)
  label: string;         // Human-readable primary label
  subtitle?: string;     // Optional secondary line (e.g. remote URL fragment)
  target: PreviewTarget; // Opaque payload handed back to this plugin's open()
}

// Props a preview renderer receives from the host. These intentionally mirror
// the current EditorView / WebPreview signatures so existing components can
// be registered as Renderers without wrapping.
export interface PreviewRendererProps {
  hideInlineCommentBar?: boolean;
  onRequestFiles?: () => void;
  onRequestAgent?: () => void;
  active?: boolean;
}

// Score returned by `match` — higher wins. `false` means "I don't handle this
// file". A tie breaks on registration order (stable), so register more
// specific plugins (lark-working-copy) before more general ones (markdown).
export type MatchScore = number | false;

// Capability flags that let the generic editor shell adapt to a plugin
// without hard-coding plugin ids. `editable` controls whether the shell
// shows an edit-mode toggle at all; defaults to true if omitted.
export interface PreviewCapabilities {
  editable?: boolean;
}

export interface PreviewPlugin {
  kind: "preview";
  id: string;              // Stable identifier used in content-store state
  title: string;           // User-facing name for pickers / debug surfaces
  scope: PreviewScope;
  capabilities?: PreviewCapabilities;

  // Decide whether this plugin should handle a given file. `raw` may be
  // undefined when the caller only has a path; return `false` in that case if
  // the match depends on content. Phase 1 is synchronous on purpose — the
  // current open flow already reads `raw` before dispatching, so a sync
  // match covers every real case.
  match?: (file: { path: string; raw?: string }) => MatchScore;

  // Optional: list the switchable instances the user can jump between within
  // this plugin for the current context. Phase 2+ will surface this in the UI
  // (a chip at the top of the preview). Return [] if there is nothing to
  // switch between (file-scope plugins typically do so).
  listInstances?: (ctx: PluginContext) => Promise<PreviewInstance[]>;

  // Open an instance. The host passes the plugin-defined target shape through
  // verbatim. In Phase 1 the actual opening still happens via the existing
  // openWorkspaceDocument / useWebPreviewStore.load entry points — plugins
  // just forward. Phase 2 moves those bodies behind this API.
  // Return false when the target could not be opened so the host may continue
  // to the next default candidate (and eventually README / empty state).
  open?: (ctx: PluginContext, target: PreviewTarget) => Promise<boolean | void> | boolean | void;

  // The React component rendered inside the preview pane for this plugin.
  Renderer: ComponentType<PreviewRendererProps>;

  // Optional hook called from the host whenever this plugin is active, so the
  // plugin can run its own polling / subscription loop. The host guarantees
  // the hook is called at most once per active instance and unmounts cleanly
  // on plugin switch. Must be a hook (follows Rules of Hooks).
  useWatcher?: () => void;
}

export type Plugin = PreviewPlugin;
