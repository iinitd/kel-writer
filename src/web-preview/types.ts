export const WEB_PREVIEW_DIRECTORY = "preview" as const;
export const WEB_PREVIEW_ENTRY = "index.html" as const;

export interface WebPreviewFile {
  path: string;
  mime: string;
  text: string | null;
  dataUrl: string;
  size: number;
  modifiedAt: string;
}

export interface WebPreviewSnapshot {
  rootPath: string;
  previewPath: string;
  entryHtml: string;
  files: Record<string, WebPreviewFile>;
  fingerprint: string;
  title: string;
}
