import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const sourcePath = new URL("../src/editor/resolve-doc-images.ts", import.meta.url);
const source = fs.readFileSync(sourcePath, "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;

const connectionStoreStub = {
  useConnectionStore: {
    getState() {
      return { client: null };
    },
  },
};

const module = { exports: {} };
const sandbox = {
  module,
  exports: module.exports,
  require(specifier) {
    if (specifier === "../stores/connection-store") return connectionStoreStub;
    throw new Error(`Unexpected import: ${specifier}`);
  },
  setTimeout,
  clearTimeout,
  Promise,
  Uint8Array,
  Map,
  Set,
  Array,
  String,
  Number,
  JSON,
};
vm.runInNewContext(compiled, sandbox, { filename: String(sourcePath) });

const {
  placeholderDocumentImages,
  applyResolvedDocumentAssetPatch,
} = module.exports;

assert.equal(typeof applyResolvedDocumentAssetPatch, "function");

const base = `
  <div class="kel-figure">
    <img src="kel-file:assets/doc-media/foo.png" alt="figure" />
    <p class="kel-figure-caption">Caption</p>
  </div>
  <div class="kel-figure kel-whiteboard">
    <img src="kel-file:boards/board.jpg" alt="whiteboard" />
  </div>
`;

const placeholder = placeholderDocumentImages(base);
assert.match(placeholder, /kel-media-loading/);

const patchedImage = applyResolvedDocumentAssetPatch(
  placeholder,
  "assets/doc-media/foo.png",
  `<span class="kel-media" data-kind="image" data-format="image" data-kel-src="assets/doc-media/foo.png"><img src="data:image/png;base64,abc" alt="figure" data-kind="image" data-format="image" data-kel-src="assets/doc-media/foo.png" /></span>`,
);
assert.doesNotMatch(patchedImage, /kel-media-loading[^>]+assets\/doc-media\/foo\.png/);
assert.match(patchedImage, /data:image\/png;base64,abc/);
assert.match(patchedImage, /Caption/);
assert.match(patchedImage, /kel-media-loading[^>]+boards\/board\.jpg/);

const patchedBoard = applyResolvedDocumentAssetPatch(
  patchedImage,
  "boards/board.jpg",
  `<span class="kel-media" data-kind="whiteboard" data-format="board" data-kel-src="boards/board.jpg"><img src="data:image/jpeg;base64,xyz" alt="whiteboard" data-kind="whiteboard" data-format="board" data-kel-src="boards/board.jpg" /></span>`,
);
assert.doesNotMatch(patchedBoard, /kel-media-loading/);
assert.match(patchedBoard, /data:image\/jpeg;base64,xyz/);

const untouched = applyResolvedDocumentAssetPatch(
  patchedBoard,
  "missing/path.png",
  `<span class="kel-media" data-kind="image" data-format="image" data-kel-src="missing/path.png"></span>`,
);
assert.equal(untouched, patchedBoard);

console.log("Document asset patch helpers passed.");
