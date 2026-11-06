/**
 * Produces the stable browser-storage key for a writing session. A Paseo
 * workspace ID survives directory display-name changes, so it wins whenever it
 * is available. Manually entered directories fall back to a normalized path.
 */
export function normalizeWorkspaceCwd(cwd: string): string {
  const trimmed = cwd.trim();
  if (trimmed === "/") return "/";
  return trimmed.replace(/\/+$/, "");
}

export function workspaceSessionKey(
  workspaceId: string | null | undefined,
  cwd: string,
): string {
  return workspaceId ? `workspace:${workspaceId}` : `cwd:${normalizeWorkspaceCwd(cwd)}`;
}
