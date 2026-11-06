import type { WorkspaceFiles } from "../content/workspace-files";

// Working copies live at `lark-working-copy/<doc-slug>/working-copy.json`.
// `working_copy` is always relative to that slug directory, so the whole
// document bundle remains movable as one unit.
export const WORKING_COPY_ROOT = "lark-working-copy";
export const WORKING_COPY_INDEX = "working-copy.json";

// A single pulled Feishu document surfaced to the host. `resolvedPath` is a
// workspace-relative path suitable for openWorkspaceDocument; `slug` is the
// containing directory name. `title` / `destination` are optional labels
// read verbatim from the index JSON — used by the sidebar to make rows
// recognisable without opening the file.
export interface WorkingCopy {
  slug: string;
  resolvedPath: string;
  title?: string;
  destination?: string;
}

function sanitizeRelative(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const cleaned = value.trim().replace(/\\/g, "/").replace(/^\.\//, "");
  if (!cleaned || cleaned.startsWith("/")) return null;
  if (cleaned.split("/").includes("..")) return null;
  return cleaned;
}

function stringOrUndefined(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

function joinPath(...parts: string[]): string {
  return parts
    .filter(Boolean)
    .join("/")
    .replace(/\\/g, "/")
    .replace(/\/{2,}/g, "/");
}

async function readWorkingCopyAt(
  files: WorkspaceFiles,
  slug: string,
): Promise<WorkingCopy | null> {
  try {
    const slugDir = joinPath(WORKING_COPY_ROOT, slug);
    const file = await files.readFile(joinPath(slugDir, WORKING_COPY_INDEX));
    const parsed = JSON.parse(new TextDecoder().decode(file.bytes));
    const relative = sanitizeRelative(parsed?.working_copy);
    if (!relative) return null;
    const resolvedPath = joinPath(slugDir, relative);
    // Keep broken or stale indexes out of instance lists. This also makes the
    // contract match the old single-working-copy discovery flow, which only
    // returned a path after confirming that its target was readable.
    await files.readFile(resolvedPath);
    return {
      slug,
      resolvedPath,
      title: stringOrUndefined(parsed?.title),
      destination: stringOrUndefined(parsed?.destination),
    };
  } catch {
    return null;
  }
}

// Enumerate every readable working copy under `<cwd>/lark-working-copy/`.
// Slugs are returned in stable alphabetical order so multi-doc projects pick
// the same default each time and the switcher UI shows them in a predictable
// sequence. Returns [] when the root directory is missing or every slug has
// an unreadable / malformed index.
export async function discoverWorkingCopies(
  files: WorkspaceFiles,
): Promise<WorkingCopy[]> {
  let entries: Awaited<ReturnType<WorkspaceFiles["listDirectory"]>>;
  try {
    entries = await files.listDirectory(WORKING_COPY_ROOT);
  } catch {
    return [];
  }
  const slugs = entries.entries
    .filter((entry) => entry.kind === "directory")
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b));
  const copies = await Promise.all(
    slugs.map((slug) => readWorkingCopyAt(files, slug)),
  );
  return copies.filter((copy): copy is WorkingCopy => copy !== null);
}

// Convenience wrapper for the auto-open flow that only needs the default
// document path. Returns the first alphabetical slug's resolved path, or
// null when nothing matches.
export async function discoverWorkingCopy(
  files: WorkspaceFiles,
): Promise<string | null> {
  const copies = await discoverWorkingCopies(files);
  return copies[0]?.resolvedPath ?? null;
}
