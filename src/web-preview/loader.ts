import type { WriterBackend } from "../backend";
import { joinWorkspacePath } from "./location";
import { WEB_PREVIEW_DIRECTORY, WEB_PREVIEW_ENTRY, type WebPreviewFile, type WebPreviewSnapshot } from "./types";

const MAX_FILES = 400;
const MAX_TOTAL_BYTES = 24 * 1024 * 1024;
const TEXT_EXTENSIONS = new Set(["html", "htm", "css", "js", "mjs", "json", "txt", "csv", "svg", "xml", "md"]);
const MIME_BY_EXTENSION: Record<string, string> = { html: "text/html", htm: "text/html", css: "text/css", js: "text/javascript", mjs: "text/javascript", json: "application/json", txt: "text/plain", csv: "text/csv", svg: "image/svg+xml", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", ico: "image/x-icon", woff: "font/woff", woff2: "font/woff2", ttf: "font/ttf", otf: "font/otf", mp4: "video/mp4", webm: "video/webm", mp3: "audio/mpeg" };
const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

const ENTRY_PATH_WITHIN_ROOT = joinWorkspacePath(WEB_PREVIEW_DIRECTORY, WEB_PREVIEW_ENTRY);

function extension(path: string): string {
  const match = /\.([a-z0-9]+)$/i.exec(path);
  return match?.[1]?.toLowerCase() ?? "";
}

function normalizeRelativePath(path: string): string {
  const clean = path.replace(/\\/g, "/").replace(/^\.\//, "").replace(/^\//, "");
  if (!clean || clean.split("/").some((part) => part === "..")) {
    throw new Error(`Preview path escapes preview/: ${path}`);
  }
  return clean;
}

// Resolve a reference (href/src/url) against the referrer's own path. The result
// is kept within the project root (rootPath); refs that would pop above it
// return null. This is how sibling-to-preview files (assets/, data/, ...) get
// pulled in.
function resolveRefWithinRoot(ref: string, sourcePathWithinRoot: string): string | null {
  if (!ref) return null;
  const trimmed = ref.trim();
  if (!trimmed || trimmed.startsWith("#") || trimmed.startsWith("//") || /^[a-z]+:/i.test(trimmed)) return null;
  const clean = trimmed.split(/[?#]/, 1)[0]!.replace(/^\.\//, "");
  if (!clean) return null;
  const base = sourcePathWithinRoot.includes("/")
    ? sourcePathWithinRoot.slice(0, sourcePathWithinRoot.lastIndexOf("/") + 1)
    : "";
  const combined = clean.startsWith("/") ? clean.slice(1) : `${base}${clean}`;
  const stack: string[] = [];
  for (const part of combined.split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") {
      if (stack.length === 0) return null;
      stack.pop();
      continue;
    }
    stack.push(part);
  }
  const result = stack.join("/");
  return result || null;
}

function bytesToBase64(bytes: Uint8Array): string {
  let out = "";
  let index = 0;
  for (; index + 2 < bytes.length; index += 3) {
    const n = (bytes[index]! << 16) | (bytes[index + 1]! << 8) | bytes[index + 2]!;
    out += B64[(n >> 18) & 63] + B64[(n >> 12) & 63] + B64[(n >> 6) & 63] + B64[n & 63];
  }
  const remaining = bytes.length - index;
  if (remaining === 1) {
    const n = bytes[index]! << 16;
    out += B64[(n >> 18) & 63] + B64[(n >> 12) & 63] + "==";
  } else if (remaining === 2) {
    const n = (bytes[index]! << 16) | (bytes[index + 1]! << 8);
    out += B64[(n >> 18) & 63] + B64[(n >> 12) & 63] + B64[(n >> 6) & 63] + "=";
  }
  return out;
}

function fingerprint(files: WebPreviewFile[]): string {
  let hash = 2166136261;
  for (const file of files) {
    const value = `${file.path}:${file.size}:${file.modifiedAt}:${file.dataUrl}`;
    for (let index = 0; index < value.length; index += 1) {
      hash ^= value.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
  }
  return `${hash >>> 0}:${files.length}:${files.reduce((sum, file) => sum + file.size, 0)}`;
}

function titleFromHtml(html: string): string {
  return /<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1]?.replace(/<[^>]+>/g, "").trim() || "Web Preview";
}

function extractHtmlReferences(html: string): string[] {
  const refs: string[] = [];
  const linkRe = /<link\b[^>]*?\bhref=["']([^"']+)["'][^>]*>/gi;
  const srcRe = /<(?:script|img|source|video|audio|iframe)\b[^>]*?\bsrc=["']([^"']+)["'][^>]*>/gi;
  for (const re of [linkRe, srcRe]) {
    let match: RegExpExecArray | null;
    while ((match = re.exec(html)) !== null) {
      if (match[1]) refs.push(match[1]);
    }
  }
  return refs;
}

function extractCssReferences(css: string): string[] {
  const refs: string[] = [];
  const re = /url\(\s*(["']?)([^"')]+)\1\s*\)/gi;
  let match: RegExpExecArray | null;
  while ((match = re.exec(css)) !== null) {
    if (match[2]) refs.push(match[2]);
  }
  const importRe = /@import\s+(?:url\(\s*)?["']([^"']+)["']/gi;
  while ((match = importRe.exec(css)) !== null) {
    if (match[1]) refs.push(match[1]);
  }
  return refs;
}

export async function loadWebPreview(
  client: WriterBackend,
  cwd: string,
  rootPath: string,
): Promise<WebPreviewSnapshot> {
  const previewPath = joinWorkspacePath(rootPath, WEB_PREVIEW_DIRECTORY);
  const files = new Map<string, WebPreviewFile>();
  let totalBytes = 0;

  async function loadFileWithinRoot(relativeToRoot: string): Promise<WebPreviewFile | null> {
    if (files.has(relativeToRoot)) return files.get(relativeToRoot) ?? null;
    if (files.size >= MAX_FILES) throw new Error(`preview assets exceed ${MAX_FILES} files`);
    const absolute = joinWorkspacePath(rootPath, relativeToRoot);
    let result: Awaited<ReturnType<WriterBackend["readFile"]>>;
    try {
      result = await client.readFile(cwd, absolute);
    } catch {
      // Missing or unreadable — leave the reference unresolved so the browser
      // can decide what to do with the original URL.
      return null;
    }
    totalBytes += result.size;
    if (totalBytes > MAX_TOTAL_BYTES) throw new Error("preview assets exceed 24 MB");
    const ext = extension(relativeToRoot);
    const mime = result.mime || MIME_BY_EXTENSION[ext] || "application/octet-stream";
    const text = TEXT_EXTENSIONS.has(ext) || mime.startsWith("text/")
      ? new TextDecoder("utf-8").decode(result.bytes)
      : null;
    const file: WebPreviewFile = {
      path: relativeToRoot,
      mime,
      text,
      dataUrl: `data:${mime};base64,${bytesToBase64(result.bytes)}`,
      size: result.size,
      modifiedAt: result.modifiedAt,
    };
    files.set(relativeToRoot, file);
    return file;
  }

  async function walkPreview(relativeDirectory: string): Promise<void> {
    const workspaceDirectory = joinWorkspacePath(previewPath, relativeDirectory);
    const directory = await client.listDirectory(cwd, workspaceDirectory);
    for (const entry of directory.entries) {
      const relativeFromPreview = normalizeRelativePath(
        entry.path.startsWith(`${previewPath}/`)
          ? entry.path.slice(previewPath.length + 1)
          : joinWorkspacePath(relativeDirectory, entry.name),
      );
      if (entry.kind === "directory") {
        await walkPreview(relativeFromPreview);
        continue;
      }
      await loadFileWithinRoot(joinWorkspacePath(WEB_PREVIEW_DIRECTORY, relativeFromPreview));
    }
  }

  await walkPreview("");

  const entry = files.get(ENTRY_PATH_WITHIN_ROOT);
  if (!entry?.text) throw new Error("preview/index.html is missing or is not text");

  // Lazily pull in anything the preview references outside preview/ but inside
  // the project root (e.g. ../assets/foo.png). We walk the dependency graph of
  // HTML/CSS text files; JS parsing is deliberately skipped to keep the loader
  // predictable — scripts can still runtime-fetch via the bridge.
  const scanned = new Set<string>([ENTRY_PATH_WITHIN_ROOT]);
  const queue: WebPreviewFile[] = [entry];
  while (queue.length > 0) {
    const file = queue.shift()!;
    if (!file.text) continue;
    const refs = file.mime.includes("css") || extension(file.path) === "css"
      ? extractCssReferences(file.text)
      : extractHtmlReferences(file.text);
    for (const ref of refs) {
      const resolved = resolveRefWithinRoot(ref, file.path);
      if (!resolved || scanned.has(resolved)) continue;
      scanned.add(resolved);
      const loaded = await loadFileWithinRoot(resolved);
      if (loaded?.text && (loaded.mime.includes("css") || loaded.mime.includes("html"))) {
        queue.push(loaded);
      }
    }
  }

  const orderedFiles = [...files.values()].sort((left, right) =>
    left.path.localeCompare(right.path),
  );
  const map = Object.fromEntries(orderedFiles.map((file) => [file.path, file]));
  return {
    rootPath,
    previewPath,
    entryHtml: entry.text,
    files: map,
    fingerprint: fingerprint(orderedFiles),
    title: titleFromHtml(entry.text),
  };
}
