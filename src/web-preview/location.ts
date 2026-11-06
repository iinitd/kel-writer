import type { WorkspaceFiles } from "../content/workspace-files";
import { WEB_PREVIEW_DIRECTORY, WEB_PREVIEW_ENTRY } from "./types";

function safeProjectSlug(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const slug = value.trim();
  return /^[a-z0-9][a-z0-9._-]*$/i.test(slug) ? slug : null;
}

export function joinWorkspacePath(...parts: string[]): string {
  return parts
    .filter(Boolean)
    .join("/")
    .replace(/\\/g, "/")
    .replace(/\/{2,}/g, "/")
    .replace(/^\//, "")
    .replace(/\/$/, "");
}

export function previewEntryPath(rootPath: string): string {
  return joinWorkspacePath(rootPath, WEB_PREVIEW_DIRECTORY, WEB_PREVIEW_ENTRY);
}

export async function discoverWebPreviewRoot(
  files: WorkspaceFiles,
): Promise<string | null> {
  const roots = await discoverWebPreviewRoots(files);
  return roots.length > 0 ? roots[0]! : null;
}

// Enumerate every preview root under `cwd` that resolves to a readable
// `<root>/preview/index.html`. The result preserves candidate order so the
// workspace-root preview (if any) comes before `projects/<slug>` previews,
// and project previews follow the slug order yielded by the workspace entry.
//
// We also probe the top-level `projects/` directory so a workspace that
// doesn't carry a slug in its metadata still surfaces every `projects/*`
// folder with a preview inside. That makes the instance switcher list all
// previews a user might expect to see, without recursing globally.
export async function discoverWebPreviewRoots(
  files: WorkspaceFiles,
): Promise<string[]> {
  const candidates: string[] = [""];
  const seen = new Set<string>();

  try {
    const labels = await files.getWorkspaceLabels();
    const slugs = labels.map(safeProjectSlug).filter((value): value is string => Boolean(value));
    for (const slug of slugs) candidates.push(`projects/${slug}`);
  } catch {
    // File discovery still works when display metadata is unavailable.
  }

  // Scan `projects/` once to pick up every direct subdirectory. Failures
  // (missing directory, permission errors) are swallowed because they don't
  // disqualify the other candidates.
  try {
    const projects = await files.listDirectory("projects");
    for (const entry of projects.entries) {
      if (entry.kind !== "directory") continue;
      const slug = safeProjectSlug(entry.name);
      if (!slug) continue;
      candidates.push(`projects/${slug}`);
    }
  } catch {
    // `projects/` doesn't exist for this workspace — fine, keep the roots we had.
  }

  const uniqueCandidates = candidates.filter((rootPath) => {
    if (seen.has(rootPath)) return false;
    seen.add(rootPath);
    return true;
  });
  const results = await Promise.all(
    uniqueCandidates.map(async (rootPath) => {
      try {
        await files.readFile(previewEntryPath(rootPath));
        return rootPath;
      } catch {
        // Candidate has no readable entry html — skip.
        return null;
      }
    }),
  );
  return results.filter((rootPath): rootPath is string => rootPath !== null);
}
