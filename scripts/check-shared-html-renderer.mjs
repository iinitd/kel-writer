import { readFile } from "node:fs/promises";

const editorView = await readFile(new URL("../src/editor/EditorView.tsx", import.meta.url), "utf8");
const sharedShell = await readFile(new URL("../src/editor/shared-document-shell.ts", import.meta.url), "utf8");
const sharedWeb = await readFile(new URL("../src/editor/SharedHtmlRenderer.web.tsx", import.meta.url), "utf8");
const sharedNative = await readFile(new URL("../src/editor/SharedHtmlRenderer.native.tsx", import.meta.url), "utf8");
const contentPreview = await readFile(new URL("../src/content/ContentPreview.tsx", import.meta.url), "utf8");

const expectations = [
  [
    "document preview routes through the shared web renderer",
    /import \{ SharedHtmlRendererWeb \} from "\.\/SharedHtmlRenderer\.web"/,
    editorView,
  ],
  [
    "document preview routes through the shared native renderer",
    /import \{ SharedHtmlRendererNative \} from "\.\/SharedHtmlRenderer\.native"/,
    editorView,
  ],
  [
    "document preview no longer imports the old web editor host",
    !/import \{ EditorWeb \} from "\.\/editor-web"/.test(editorView),
    "",
  ],
  [
    "document preview no longer imports the old native editor host",
    !/import \{ EditorNative \} from "\.\/editor-native"/.test(editorView),
    "",
  ],
  [
    "the shared shell includes the document bridge commands",
    /window\.__kelDocumentCommands\s*=\s*\{/,
    sharedShell,
  ],
  [
    "the shared shell prevents in-document external links from replacing the renderer document",
    /window\.open\(link\.href, '_blank', 'noopener,noreferrer'\)/,
    sharedShell,
  ],
  [
    "the shared shell still wraps content in the standard tiptap class for shared css",
    /id="kel-root" class="tiptap"/,
    sharedShell,
  ],
  [
    "web renderer uses an iframe host",
    /<iframe/,
    sharedWeb,
  ],
  [
    "native renderer uses a WebView host",
    /<WebView/,
    sharedNative,
  ],
  [
    "native renderer injects commands directly into the shared shell",
    /window\.__kelDocumentCommands \|\| \{\}/,
    sharedNative,
  ],
  [
    "ContentPreview dispatches through the plugin registry",
    /getPlugin\(activePluginId\)/,
    contentPreview,
  ],
  [
    "ContentPreview reads the active plugin id from content-store",
    /useContentStore\(\(state\)\s*=>\s*state\.active\.pluginId\)/,
    contentPreview,
  ],
];

const failures = expectations
  .filter(([, pattern, source]) =>
    typeof pattern === "boolean" ? !pattern : !pattern.test(source),
  )
  .map(([description]) => description);

if (failures.length) {
  console.error(`Shared HTML renderer contract failed:\n- ${failures.join("\n- ")}`);
  process.exit(1);
}

console.log("Shared HTML renderer contract passed.");
