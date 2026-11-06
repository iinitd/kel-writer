import type { PluginContext, PreviewInstance, PreviewPlugin } from "./types";
import type { WorkspaceFiles } from "../content/workspace-files";

type Listener = (instances: PreviewInstance[]) => void;

interface CacheEntry {
  instances: PreviewInstance[];
  listeners: Set<Listener>;
  inFlight: Promise<PreviewInstance[]> | null;
}

const entries = new Map<string, CacheEntry>();
const clientIds = new WeakMap<WorkspaceFiles, number>();
let nextClientId = 0;

export function clearPluginInstanceCache(): void {
  entries.clear();
}

function cacheKey(plugin: PreviewPlugin, ctx: PluginContext): string {
  let clientId = ctx.files ? clientIds.get(ctx.files) : 0;
  if (ctx.files && clientId === undefined) {
    clientId = ++nextClientId;
    clientIds.set(ctx.files, clientId);
  }
  return `${clientId}\u0000${ctx.workspaceId ?? ""}\u0000${ctx.cwd ?? ""}\u0000${plugin.id}`;
}

function entryFor(plugin: PreviewPlugin, ctx: PluginContext): CacheEntry {
  const key = cacheKey(plugin, ctx);
  let entry = entries.get(key);
  if (!entry) {
    entry = { instances: [], listeners: new Set(), inFlight: null };
    entries.set(key, entry);
  }
  return entry;
}

function publish(entry: CacheEntry, instances: PreviewInstance[]): void {
  entry.instances = instances;
  for (const listener of entry.listeners) listener(instances);
}

export function getCachedPluginInstances(
  plugin: PreviewPlugin,
  ctx: PluginContext,
): PreviewInstance[] {
  return entryFor(plugin, ctx).instances;
}

export function subscribePluginInstances(
  plugin: PreviewPlugin,
  ctx: PluginContext,
  listener: Listener,
): () => void {
  const entry = entryFor(plugin, ctx);
  entry.listeners.add(listener);
  return () => entry.listeners.delete(listener);
}

// Some metadata is only known after an instance opens (for example an HTML
// document's real <title>). Let the owning plugin enrich the shared snapshot
// without forcing another filesystem discovery round trip.
export function publishPluginInstances(
  plugin: PreviewPlugin,
  ctx: PluginContext,
  instances: PreviewInstance[],
): void {
  publish(entryFor(plugin, ctx), instances);
}

// Publish every successful discovery into the workspace-scoped cache so the
// auto-open flow, sidebar and renderer switchers all see the same snapshot.
// Failures preserve the last good snapshot instead of making rows disappear.
export async function discoverPluginInstances(
  plugin: PreviewPlugin,
  ctx: PluginContext,
): Promise<PreviewInstance[]> {
  const entry = entryFor(plugin, ctx);
  if (!plugin.listInstances) return entry.instances;
  if (entry.inFlight) return entry.inFlight;
  // Start on the next microtask so `entry.inFlight` is assigned before even a
  // malformed plugin that throws synchronously can settle the request.
  const request = Promise.resolve()
    .then(() => plugin.listInstances!(ctx))
    .then((instances) => {
      if (ctx.isCurrent && !ctx.isCurrent()) return entry.instances;
      publish(entry, instances);
      return instances;
    })
    .catch(() => entry.instances)
    .finally(() => {
      if (entry.inFlight === request) entry.inFlight = null;
    });
  entry.inFlight = request;
  return request;
}
