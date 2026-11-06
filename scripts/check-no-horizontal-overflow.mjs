import { readFile } from "node:fs/promises";

const editor = await readFile(new URL("../src/editor/editor-web.tsx", import.meta.url), "utf8");
const docCss = await readFile(new URL("../src/editor/editor-doc-css.ts", import.meta.url), "utf8");
const session = await readFile(new URL("../app/writer/session.tsx", import.meta.url), "utf8");
const layout = await readFile(new URL("../app/_layout.tsx", import.meta.url), "utf8");
const clippedTableView = await readFile(new URL("../src/editor/tiptap-extensions/clipped-table-view.ts", import.meta.url), "utf8");

const expectations = [
  [
    "the page root clips horizontal overflow (html/body/#root)",
    /html,\s*body,\s*#root[\s\S]{0,120}overflow-x:\s*hidden/,
    layout,
  ],
  [
    "the root container is constrained to the viewport width",
    /container:\s*\{[\s\S]{0,120}overflow:\s*\"hidden\"/,
    layout,
  ],
  [
    "the document scroller only scrolls vertically",
    /overflowY:\s*\"auto\"[\s\S]{0,120}overflowX:\s*\"hidden\"/,
    editor,
  ],
  [
    "the document root includes its padding inside the width cap",
    /\.tiptap\s*\{[\s\S]{0,200}box-sizing:\s*border-box[\s\S]{0,120}width:\s*100%/,
    docCss,
  ],
  [
    "the web editor uses the clipped table node view",
    /Table\.configure\(\{[^}]*View:\s*ClippedTableView/,
    editor,
  ],
  [
    "wide tables are wrapped in a clipping shell before the local scroller",
    /className\s*=\s*\"kel-table-clip\"/,
    clippedTableView,
  ],
  [
    "table wrappers allow local horizontal scrolling",
    /\.tiptap \.tableWrapper\s*\{[\s\S]{0,260}display:\s*block[\s\S]{0,260}width:\s*100%[\s\S]{0,260}overflow-x:\s*auto/,
    docCss,
  ],
  [
    "the clipping shell prevents tables from widening the page",
    /\.tiptap \.kel-table-clip\s*\{[\s\S]{0,240}width:\s*100%[\s\S]{0,240}overflow-x:\s*hidden/,
    docCss,
  ],
  [
    "tables keep natural width inside the local scroller",
    /\.tiptap table\s*\{[\s\S]{0,260}width:\s*max-content[\s\S]{0,260}min-width:\s*100%[\s\S]{0,260}table-layout:\s*auto/,
    docCss,
  ],
  [
    "table cells remain readable while preserving natural columns",
    /\.tiptap th, \.tiptap td[\s\S]{0,360}white-space:\s*normal[\s\S]{0,220}min-width:\s*6em/,
    docCss,
  ],
  [
    "inline code wraps instead of forcing horizontal scroll",
    /\.tiptap code\s*\{[\s\S]{0,240}white-space:\s*break-spaces[\s\S]{0,240}overflow-wrap:\s*anywhere/,
    docCss,
  ],
  [
    "preformatted blocks wrap instead of scrolling horizontally",
    /\.tiptap pre\s*\{[\s\S]{0,260}overflow-x:\s*hidden[\s\S]{0,260}white-space:\s*pre-wrap/,
    docCss,
  ],
  [
    "links wrap instead of widening the document",
    /\.tiptap a\s*\{[\s\S]{0,240}overflow-wrap:\s*anywhere/,
    docCss,
  ],
  [
    "the desktop editor pane may shrink inside the three-pane layout",
    /editorPane:\s*\{[\s\S]{0,100}minWidth:\s*0/,
    session,
  ],
  [
    "the desktop chat pane may shrink inside the three-pane layout",
    /chatPane:\s*\{[\s\S]{0,100}minWidth:\s*0/,
    session,
  ],
];

const failures = expectations
  .filter(([, pattern, source]) => !pattern.test(source))
  .map(([description]) => description);

if (failures.length) {
  console.error(`Horizontal-overflow contract failed:\n- ${failures.join("\n- ")}`);
  process.exit(1);
}

console.log("Horizontal-overflow contract passed.");
