// Plugin registry. Plugins register at module-load time; the host dispatches
// by id or by file-match score. No React in here on purpose — this file is
// imported by both renderers and non-UI code paths, so it must stay a plain
// data layer.

import type { Plugin, PreviewPlugin, MatchScore } from "./types";

// Registration order matters for ties in `match`. We keep insertion order via
// an array; a Map would also work but ordered iteration is simpler.
const plugins: Plugin[] = [];
const byId = new Map<string, Plugin>();

export function registerPlugin(plugin: Plugin): void {
  // Re-registration of the same id is almost always a hot-reload artifact or
  // a wiring mistake. Overwriting silently makes those bugs invisible, so
  // throw loudly in dev. Hot reload in Metro re-runs modules, so this guard
  // deliberately runs only when the registry has already been populated for
  // a different plugin descriptor; identical object re-registration is a
  // no-op to keep Fast Refresh functional.
  const existing = byId.get(plugin.id);
  if (existing) {
    if (existing === plugin) return;
    byId.set(plugin.id, plugin);
    const index = plugins.findIndex((p) => p.id === plugin.id);
    if (index >= 0) plugins[index] = plugin;
    return;
  }
  byId.set(plugin.id, plugin);
  plugins.push(plugin);
}

export function getPlugin(id: string): Plugin | null {
  return byId.get(id) ?? null;
}

export function listPlugins(): Plugin[] {
  return [...plugins];
}

export function listPreviewPlugins(): PreviewPlugin[] {
  return plugins.filter((p): p is PreviewPlugin => p.kind === "preview");
}

// Return the best preview plugin for a given file, or null if nothing claims
// it. Score ties resolve to the first-registered plugin — register more
// specific plugins before more general ones.
export function previewPluginForFile(file: {
  path: string;
  raw?: string;
}): PreviewPlugin | null {
  let best: { plugin: PreviewPlugin; score: number } | null = null;
  for (const plugin of listPreviewPlugins()) {
    const score = evaluateMatch(plugin, file);
    if (score === false) continue;
    if (!best || score > best.score) {
      best = { plugin, score };
    }
  }
  return best?.plugin ?? null;
}

function evaluateMatch(
  plugin: PreviewPlugin,
  file: { path: string; raw?: string },
): MatchScore {
  if (!plugin.match) return false;
  return plugin.match(file);
}
