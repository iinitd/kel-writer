/** Content capabilities exposed to previews. Paths are relative to this workspace. */
export interface ContentFile {
  bytes: Uint8Array;
  mime: string;
  size: number;
  path: string;
  kind: "text" | "image" | "binary";
  modifiedAt: string;
}

export interface ContentDirectory {
  path: string;
  entries: Array<{
    name: string;
    path: string;
    kind: "file" | "directory";
    size: number;
    modifiedAt?: string;
  }>;
}

export interface WorkspaceFiles {
  readFile(path: string): Promise<ContentFile>;
  listDirectory(path: string): Promise<ContentDirectory>;
  /** Optional display metadata used to discover content inside this workspace. */
  getWorkspaceLabels(): Promise<string[]>;
}
