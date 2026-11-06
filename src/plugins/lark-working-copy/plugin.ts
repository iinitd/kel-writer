// Lark working-copy preview plugin.
//
// A lark working copy is a markdown-flavoured file whose frontmatter points
// at a Feishu document (destination: https://.../wiki|docx/...). It renders
// through the same shared HTML renderer as plain markdown, but conceptually
// a workspace can host multiple working copies and users want to switch
// between them like they switch between Web Preview roots. This plugin
// therefore scopes as "workspace" and uses `listInstances` to surface each
// pulled document in the sidebar + top-bar picker.

import type { PluginContext, PreviewInstance, PreviewPlugin, PreviewTarget } from "../types";
import { registerPlugin } from "../registry";
import { EditorView } from "../../editor/EditorView";
import { isLarkWorkingCopySource } from "../../editor/file-content";
import { discoverWorkingCopies, type WorkingCopy } from "../../editor/working-copy";
import { useContentStore } from "../../content/content-store";

function labelFor(copy: WorkingCopy): string {
  return copy.title || copy.slug;
}

function subtitleFor(copy: WorkingCopy): string | undefined {
  if (copy.destination) {
    // Trim scheme + host noise so the row stays readable at narrow widths.
    return copy.destination.replace(/^https?:\/\/[^/]+\//i, "");
  }
  return copy.resolvedPath;
}

export const larkWorkingCopyPlugin: PreviewPlugin = {
  kind: "preview",
  id: "lark-working-copy",
  title: "Lark Working Copy",
  // Scope is "workspace": a single workspace can contain several working
  // copies and the switcher chip will enumerate them.
  scope: "workspace",
  // Lark working copies are backed by XML the TipTap HTML round-trip would
  // discard, so the editor shell suppresses the edit toggle for them.
  capabilities: { editable: false },

  // Winning score is 100 (vs. markdown's 10) so a .md that is a lark working
  // copy routes here. If `raw` is unavailable we can't decide, so defer to
  // markdown — callers that need lark routing already read raw first.
  match: (file) => {
    if (!file.raw) return false;
    return isLarkWorkingCopySource(file.raw) ? 100 : false;
  },

  listInstances: async (ctx: PluginContext): Promise<PreviewInstance[]> => {
    if (!ctx.files) return [];
    try {
      const copies = await discoverWorkingCopies(ctx.files);
      // Keyed by resolvedPath so the host's rememberedInstance table and
      // `plugin.open({ path })` share the same identifier.
      return copies.map((copy) => ({
        key: copy.resolvedPath,
        label: labelFor(copy),
        subtitle: subtitleFor(copy),
        target: { path: copy.resolvedPath },
      }));
    } catch {
      return [];
    }
  },

  open: async (ctx: PluginContext, target: PreviewTarget) => {
    const cwd = ctx.cwd;
    const path = typeof target.path === "string" ? target.path : null;
    if (!cwd || !path) return;
    const opened = await ctx.openDocument(path);
    if (opened) {
      useContentStore
        .getState()
        .rememberInstance(ctx.workspaceId ?? cwd, larkWorkingCopyPlugin.id, path);
    }
    return opened;
  },

  Renderer: EditorView,
};

registerPlugin(larkWorkingCopyPlugin);

